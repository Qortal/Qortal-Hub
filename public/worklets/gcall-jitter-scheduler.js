/**
 * gcall-jitter-scheduler — drives group-call jitter-buffer drain on the audio render clock.
 *
 * Fires port.postMessage({ type: 'tick' }) at ~one Opus frame interval (20 ms nominal).
 * Uses render-quantum counting with sampleRate so timing stays correct if the context
 * rate or quantum size differs from 48 kHz / 128.
 *
 * Tick count per drain = ceil(0.02 s * sampleRate / quantum). At 48 kHz and quantum 128,
 * that is ceil(7.5) = 8 (~21.3 ms). Using 7 would be ~18.7 ms (faster than real time)
 * and would starve the jitter buffer; ceil biases slightly slow = stable.
 *
 * Note: postMessage still crosses to the main thread; handler timing can jitter under
 * load. The deeper receive jitter buffer + playback worklet ring absorb that variance.
 */
class GcallJitterSchedulerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._quantumCount = 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    const quantum = output ? output.length : 128;
    const frameSec = 20 / 1000;
    const ticksPerDrain = Math.max(1, Math.ceil((frameSec * sampleRate) / quantum));
    this._quantumCount++;
    if (this._quantumCount >= ticksPerDrain) {
      this._quantumCount = 0;
      this.port.postMessage({ type: 'tick' });
    }
    return true;
  }
}

registerProcessor('gcall-jitter-scheduler', GcallJitterSchedulerProcessor);
