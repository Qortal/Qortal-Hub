/**
 * gcall-jitter-scheduler — drives group-call jitter-buffer drain on the audio render clock.
 *
 * Fires port.postMessage({ type: 'tick' }) at ~one Opus frame interval (20 ms nominal).
 * Uses a sample accumulator so timing stays correct if the context rate or quantum
 * size differs from 48 kHz / 128.
 *
 * At 48 kHz and quantum 128, one 20 ms Opus frame is 960 samples, i.e. 7.5 render
 * quanta. Rounding every drain to 8 quanta runs at ~46.875 Hz while senders produce
 * 50 Hz, so the jitter buffer slowly overfills and trims good frames. The accumulator
 * alternates 7/8 quantum intervals as needed, which averages exactly 20 ms.
 *
 * Note: postMessage still crosses to the main thread; handler timing can jitter under
 * load. The deeper receive jitter buffer + playback worklet ring absorb that variance.
 */
class GcallJitterSchedulerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._accumulatedSamples = 0;
    this._frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    const quantum = output ? output.length : 128;
    this._accumulatedSamples += quantum;
    while (this._accumulatedSamples >= this._frameSamples) {
      this._accumulatedSamples -= this._frameSamples;
      this.port.postMessage({ type: 'tick' });
    }
    return true;
  }
}

registerProcessor('gcall-jitter-scheduler', GcallJitterSchedulerProcessor);
