/**
 * playback-processor.js — AudioWorkletProcessor for per-speaker audio playback.
 *
 * Runs on the dedicated audio worklet thread (off the main JS thread).
 *
 * Responsibilities:
 *   - Maintain a Float32 ring buffer (~1 second at 48 kHz).
 *   - Accept { pcm: Float32Array } messages (transferable ArrayBuffer) written
 *     by the main thread after AudioDecoder.decode() produces output.
 *   - Drain the ring buffer into the output channel on each process() call;
 *     output silence when the buffer is empty (natural jitter absorption).
 *
 * One instance is created per remote speaker alongside its AudioDecoder.
 */

const RING_CAPACITY = 48000; // 1 second @ 48 kHz

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._ring = new Float32Array(RING_CAPACITY);
    this._writePos = 0; // next write index (mod RING_CAPACITY)
    this._readPos = 0;  // next read index (mod RING_CAPACITY)
    this._available = 0; // samples currently buffered

    this.port.onmessage = (e) => {
      const pcm = e.data?.pcm;
      if (!(pcm instanceof Float32Array) || pcm.length === 0) return;

      // If the incoming chunk would overflow the ring, drop the oldest data
      if (pcm.length > RING_CAPACITY) return; // chunk larger than ring — skip

      if (this._available + pcm.length > RING_CAPACITY) {
        // Discard oldest samples to make room
        const discard = this._available + pcm.length - RING_CAPACITY;
        this._readPos = (this._readPos + discard) % RING_CAPACITY;
        this._available -= discard;
      }

      // Write samples into ring buffer (may wrap)
      let toWrite = pcm.length;
      let src = 0;
      while (toWrite > 0) {
        const chunk = Math.min(toWrite, RING_CAPACITY - this._writePos);
        this._ring.set(pcm.subarray(src, src + chunk), this._writePos);
        this._writePos = (this._writePos + chunk) % RING_CAPACITY;
        src += chunk;
        toWrite -= chunk;
      }
      this._available += pcm.length;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;

    const count = Math.min(output.length, this._available);

    if (count === 0) {
      // Silence when buffer is empty
      output.fill(0);
      return true;
    }

    // Drain ring buffer into output (may wrap)
    let toRead = count;
    let dst = 0;
    while (toRead > 0) {
      const chunk = Math.min(toRead, RING_CAPACITY - this._readPos);
      output.set(this._ring.subarray(this._readPos, this._readPos + chunk), dst);
      this._readPos = (this._readPos + chunk) % RING_CAPACITY;
      dst += chunk;
      toRead -= chunk;
    }
    this._available -= count;

    // Zero-pad if we ran short (shouldn't happen, but guard for safety)
    if (count < output.length) {
      output.fill(0, count);
    }

    return true; // keep processor alive
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
