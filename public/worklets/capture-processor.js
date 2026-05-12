/**
 * capture-processor.js — AudioWorkletProcessor for microphone capture.
 *
 * Runs on the dedicated audio worklet thread (off the main JS thread).
 *
 * Responsibilities:
 *   - Accumulate incoming 128-sample Web Audio blocks into a staging buffer.
 *   - Drain the staging buffer in 960-sample chunks (20ms Opus frames @ 48kHz).
 *   - Compute adaptive RMS VAD per frame.
 *   - Post each complete frame + VAD flag to the main thread via a transferable
 *     ArrayBuffer so the main thread can call AudioEncoder.encode().
 *   - Accept { type: 'mute', muted: boolean } messages to silence output.
 */

const OPUS_OUTPUT_SAMPLE_RATE = 48000;
const OPUS_FRAME_DURATION_MS = 20;
const OPUS_FRAME_SAMPLES = 960; // 20ms @ 48 kHz

function resampleLinear(input, outputLength) {
  if (input.length === outputLength) {
    const out = new Float32Array(outputLength);
    out.set(input);
    return out;
  }
  const out = new Float32Array(outputLength);
  if (outputLength <= 1 || input.length <= 1) {
    out[0] = input[0] || 0;
    return out;
  }
  if (input.length > outputLength) {
    const scale = input.length / outputLength;
    for (let i = 0; i < outputLength; i++) {
      const start = i * scale;
      const end = (i + 1) * scale;
      const first = Math.floor(start);
      const last = Math.min(input.length - 1, Math.ceil(end) - 1);
      let sum = 0;
      let weight = 0;
      for (let j = first; j <= last; j++) {
        const segmentStart = Math.max(start, j);
        const segmentEnd = Math.min(end, j + 1);
        const w = Math.max(0, segmentEnd - segmentStart);
        sum += input[j] * w;
        weight += w;
      }
      out[i] = weight > 0 ? sum / weight : input[first] || 0;
    }
    return out;
  }
  const scale = (input.length - 1) / (outputLength - 1);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * scale;
    const left = Math.floor(pos);
    const right = Math.min(input.length - 1, left + 1);
    const frac = pos - left;
    out[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return out;
}

// Adaptive RMS VAD constants (noise-tracking worklet only).
const VAD_ALPHA = 0.99;
// Slightly sensitive so quiet mics still set vad=true (forwarder gates on vad).
const VAD_MULTIPLIER = 2.3;
const VAD_MIN_THRESHOLD = 0.01;
const VAD_INITIAL_FLOOR = 0.005;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._inputFrameSamples = Math.max(
      1,
      Math.round((sampleRate * OPUS_FRAME_DURATION_MS) / 1000)
    );

    // Staging buffer: grows on demand, pre-sized for two input-rate frames.
    this._buf = new Float32Array(this._inputFrameSamples * 2);
    this._offset = 0;

    // Adaptive VAD state
    this._noiseFloor = VAD_INITIAL_FLOOR;

    // Mute gate
    this._muted = false;

    this.port.onmessage = (e) => {
      if (e.data?.type === 'mute') {
        this._muted = !!e.data.muted;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]; // mono channel
    const output = outputs[0]?.[0];

    // Always pass audio through to the output channel.
    // This keeps the node "active" in Chrome/Electron's Web Audio rendering graph:
    // Chrome only delivers real microphone samples to inputs[0][0] when it can
    // observe non-zero audio flowing through the node's output.  Without this
    // passthrough, Chrome's silence optimiser detects that captureNode always
    // outputs zeros and stops populating inputs[0][0] — the same bug that caused
    // the ScriptProcessorNode to work (it passes through) while AudioWorkletNode
    // produced silent frames.
    // The downstream keepAliveGain(0.0001) attenuates the passthrough to -100 dB
    // at the destination so no echo is audible.
    if (input && output) output.set(input);

    if (!input || input.length === 0) return true;

    // When muted, still pass audio through above (keeps the graph active),
    // but do not accumulate or post frames to the main thread.
    if (this._muted) return true;

    // Grow staging buffer if needed
    const needed = this._offset + input.length;
    if (needed > this._buf.length) {
      const bigger = new Float32Array(needed * 2);
      bigger.set(this._buf.subarray(0, this._offset));
      this._buf = bigger;
    }

    this._buf.set(input, this._offset);
    this._offset += input.length;

    // Drain complete 20 ms frames at the actual AudioContext sample rate, then
    // resample to the canonical 48 kHz/960-sample Opus input expected by sender.
    while (this._offset >= this._inputFrameSamples) {
      const inputFrame = new Float32Array(this._inputFrameSamples);
      inputFrame.set(this._buf.subarray(0, this._inputFrameSamples));
      const frame = resampleLinear(inputFrame, OPUS_FRAME_SAMPLES);

      // Slide remaining samples to front
      this._buf.copyWithin(0, this._inputFrameSamples, this._offset);
      this._offset -= this._inputFrameSamples;

      // Adaptive RMS VAD
      let sum = 0;
      for (let i = 0; i < OPUS_FRAME_SAMPLES; i++) {
        sum += frame[i] * frame[i];
      }
      const rms = Math.sqrt(sum / OPUS_FRAME_SAMPLES);
      // Threshold from the *previous* noise estimate only. We must not blend every
      // frame's RMS into the noise floor: sustained vowels have stable RMS, and
      // updating the floor toward speech makes threshold drift up until vad flips
      // false (chopped "aaaaaa…"). Track ambient noise only on sub-threshold frames.
      const threshold = Math.max(
        VAD_MIN_THRESHOLD,
        this._noiseFloor * VAD_MULTIPLIER
      );
      if (rms < threshold) {
        this._noiseFloor = VAD_ALPHA * this._noiseFloor + (1 - VAD_ALPHA) * rms;
      }
      const vad = rms > threshold;

      // Use the audio render clock here; comparing this against the window's
      // `performance.now()` produced bogus multi-minute deltas in exports.
      const workletPostAudioClockMs = currentTime * 1000;

      // Transfer the frame buffer to avoid copying
      this.port.postMessage(
        {
          frame,
          vad,
          workletPostAudioClockMs,
          inputSampleRate: sampleRate,
          outputSampleRate: OPUS_OUTPUT_SAMPLE_RATE,
          inputFrameSamples: this._inputFrameSamples,
        },
        [frame.buffer]
      );
    }

    return true; // keep processor alive
  }
}

registerProcessor('capture-processor', CaptureProcessor);
