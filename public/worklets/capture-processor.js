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

const OPUS_FRAME_SAMPLES = 960; // 20ms @ 48 kHz

// Adaptive VAD constants — must match useGroupVoiceCall.ts
const VAD_ALPHA = 0.99;
const VAD_MULTIPLIER = 2.5;
const VAD_MIN_THRESHOLD = 0.01;
const VAD_INITIAL_FLOOR = 0.005;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Staging buffer: grows on demand, pre-sized for two Opus frames
    this._buf = new Float32Array(OPUS_FRAME_SAMPLES * 2);
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

    // Drain complete Opus frames
    while (this._offset >= OPUS_FRAME_SAMPLES) {
      // Copy frame into a fresh ArrayBuffer so it can be transferred
      const frame = new Float32Array(OPUS_FRAME_SAMPLES);
      frame.set(this._buf.subarray(0, OPUS_FRAME_SAMPLES));

      // Slide remaining samples to front
      this._buf.copyWithin(0, OPUS_FRAME_SAMPLES, this._offset);
      this._offset -= OPUS_FRAME_SAMPLES;

      // Adaptive RMS VAD
      let sum = 0;
      for (let i = 0; i < OPUS_FRAME_SAMPLES; i++) {
        sum += frame[i] * frame[i];
      }
      const rms = Math.sqrt(sum / OPUS_FRAME_SAMPLES);
      this._noiseFloor =
        VAD_ALPHA * this._noiseFloor + (1 - VAD_ALPHA) * rms;
      const threshold = Math.max(
        VAD_MIN_THRESHOLD,
        this._noiseFloor * VAD_MULTIPLIER
      );
      const vad = rms > threshold;

      // Transfer the frame buffer to avoid copying
      this.port.postMessage({ frame, vad }, [frame.buffer]);
    }

    return true; // keep processor alive
  }
}

registerProcessor('capture-processor', CaptureProcessor);
