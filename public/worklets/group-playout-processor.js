/**
 * group-playout-processor — adaptive PCM playout for group voice (per remote speaker).
 *
 * PCM-only bufferedMs; fractional read with clamp + deadzone + EMA-smoothed rate.
 * Startup: silence until bufferedMs >= max(INITIAL_GATE_MS, target - START_GATE_TARGET_MARGIN_MS)
 * so playout does not begin far below the active adaptive target.
 * Latency cap: every audio quantum (including before playout starts), if buffered PCM exceeds
 * PCM_LATENCY_HARD_MS, discard oldest samples until <= max(PCM_LATENCY_RELEASE_MS, target+40)
 * so one bursty peer cannot accumulate 500ms+ queues (interactive voice).
 * When |bufferedMs - target| is large, tiered over-target rates (80ms / 150ms steps) before EMA.
 * Concealment: reuse short tail with gentler fade.
 * Posts { type:'gcallPlayoutMetrics', ... } periodically for main-thread metrics
 * (outsideBand, outsideBandUnder, outsideBandOver, deltaMs).
 */
const RING_CAPACITY = 48000;
const INITIAL_GATE_MS = 100;
/** Start playout when buffered >= target minus this margin (scheduling / target-post jitter). */
const START_GATE_TARGET_MARGIN_MS = 16;
const DEFAULT_TARGET_MS = 100;
const ERROR_CLAMP_MS = 80;
const DEADZONE_MS = 8;
const RATE_MIN = 0.985;
const RATE_MAX = 1.012;
const EMA_ALPHA = 0.04;
const OUTSIDE_BAND_MS = 25;
/** Emergency rate path when |delta| exceeds band + this (aligned with KPI band). */
const EMERGENCY_BAND_EXTRA_MS = 10;
const METRICS_QUANTA = 47; // ~100ms at 48kHz/128
/** If buffered PCM exceeds this, shed oldest down to release level (live voice latency bound). */
const PCM_LATENCY_HARD_MS = 280;
/** Floor for post-shed target ms; release uses max(this, targetPlayoutMs + margin). */
const PCM_LATENCY_RELEASE_MS = 200;
const TARGET_RELEASE_MARGIN_MS = 40;
/** Tiered catch-up when buffer is far over adaptive target (before EMA). */
const OVER_TARGET_TIER_STRONG_MS = 150;
const OVER_TARGET_TIER_MID_MS = 80;
const CONCEALMENT_TAIL_SAMPLES = 240; // 5ms @ 48kHz
const CONCEALMENT_FADE_SAMPLES = 240;

class GroupPlayoutProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._sourceAddr = options.processorOptions?.sourceAddr ?? '';

    this._ring = new Float32Array(RING_CAPACITY);
    this._writePos = 0;
    this._readPos = 0;
    this._available = 0;

    this._readFrac = 0;
    this._smoothedRate = 1;
    this._targetPlayoutMs = DEFAULT_TARGET_MS;
    this._playoutStarted = false;

    this._lastTail = new Float32Array(CONCEALMENT_TAIL_SAMPLES);
    this._lastTailLen = 0;
    this._lastTailWritePos = 0;
    this._concealCursor = 0;

    this._metricsQuantumCount = 0;
    this._concealedThisBlock = false;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d?.pcm instanceof Float32Array && d.pcm.length > 0) {
        this._pushPcm(d.pcm);
        return;
      }
      if (d?.type === 'target' && typeof d.targetPlayoutMs === 'number') {
        this._targetPlayoutMs = Math.max(40, Math.min(250, d.targetPlayoutMs));
      }
    };
  }

  _pushPcm(pcm) {
    if (pcm.length > RING_CAPACITY) return;
    if (this._available + pcm.length > RING_CAPACITY) {
      const discard = this._available + pcm.length - RING_CAPACITY;
      this._advanceReadInt(discard);
    }
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
  }

  _advanceReadInt(n) {
    if (n <= 0) return;
    const take = Math.min(n, this._available);
    this._readPos = (this._readPos + take) % RING_CAPACITY;
    this._available -= take;
  }

  _sampleAtRead() {
    if (this._available < 2) return 0;
    const i0 = this._readPos % RING_CAPACITY;
    const i1 = (this._readPos + 1) % RING_CAPACITY;
    const s0 = this._ring[i0];
    const s1 = this._ring[i1];
    return s0 * (1 - this._readFrac) + s1 * this._readFrac;
  }

  _rememberTailSample(sample) {
    this._lastTail[this._lastTailWritePos] = sample;
    this._lastTailWritePos = (this._lastTailWritePos + 1) % this._lastTail.length;
    if (this._lastTailLen < this._lastTail.length) {
      this._lastTailLen++;
    }
  }

  _tailSampleAt(offset) {
    if (offset < 0 || offset >= this._lastTailLen) return 0;
    const firstValid =
      this._lastTailLen === this._lastTail.length ? this._lastTailWritePos : 0;
    const idx = (firstValid + offset) % this._lastTail.length;
    return this._lastTail[idx];
  }

  _stepReadOne(rate) {
    this._readFrac += rate;
    while (this._readFrac >= 1 && this._available > 0) {
      this._readFrac -= 1;
      this._readPos = (this._readPos + 1) % RING_CAPACITY;
      this._available -= 1;
    }
  }

  /**
   * Drop oldest PCM if queue exceeds hard cap; target release tracks adaptive target.
   * Runs every quantum, including before startup gate, to avoid pre-roll explosion.
   */
  _shedExcessPcmLatency(sampleRateHz) {
    const bufferedMs = (this._available / sampleRateHz) * 1000;
    if (bufferedMs <= PCM_LATENCY_HARD_MS) return;
    const releaseMs = Math.max(
      PCM_LATENCY_RELEASE_MS,
      this._targetPlayoutMs + TARGET_RELEASE_MARGIN_MS
    );
    const maxSamples = (releaseMs / 1000) * sampleRateHz;
    const toDrop = Math.floor(this._available - maxSamples);
    if (toDrop > 0) {
      this._advanceReadInt(toDrop);
      this._readFrac = 0;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;

    const sampleRateHz = globalThis.sampleRate;
    const quantum = output.length;

    this._shedExcessPcmLatency(sampleRateHz);
    let bufferedMs = (this._available / sampleRateHz) * 1000;

    this._concealedThisBlock = false;

    if (!this._playoutStarted) {
      const startGateMs = Math.max(
        INITIAL_GATE_MS,
        this._targetPlayoutMs - START_GATE_TARGET_MARGIN_MS
      );
      if (bufferedMs < startGateMs) {
        output.fill(0);
        this._concealCursor = 0;
        this._maybePostMetrics(bufferedMs, quantum, false);
        return true;
      }
      this._playoutStarted = true;
    }

    const deltaMs = bufferedMs - this._targetPlayoutMs;
    const emergencyThresh = OUTSIDE_BAND_MS + EMERGENCY_BAND_EXTRA_MS;
    let targetRate;
    if (deltaMs < -emergencyThresh) {
      targetRate = 0.992;
    } else if (deltaMs > OVER_TARGET_TIER_STRONG_MS) {
      targetRate = RATE_MAX;
    } else if (deltaMs > OVER_TARGET_TIER_MID_MS) {
      targetRate = 1.01;
    } else if (deltaMs > emergencyThresh) {
      targetRate = 1.008;
    } else {
      let errorMs = Math.max(
        -ERROR_CLAMP_MS,
        Math.min(ERROR_CLAMP_MS, deltaMs)
      );
      if (Math.abs(errorMs) < DEADZONE_MS) errorMs = 0;
      const k = 0.000125;
      targetRate = 1 + Math.max(-0.01, Math.min(0.01, errorMs * k));
    }
    targetRate = Math.max(RATE_MIN, Math.min(RATE_MAX, targetRate));

    this._smoothedRate += EMA_ALPHA * (targetRate - this._smoothedRate);
    this._smoothedRate = Math.max(RATE_MIN, Math.min(RATE_MAX, this._smoothedRate));

    const rate = this._smoothedRate;

    for (let i = 0; i < quantum; i++) {
      if (this._available < 2) {
        this._concealedThisBlock = true;
        const conceal = this._concealSample();
        output[i] = conceal;
        continue;
      }
      const s = this._sampleAtRead();
      output[i] = s;
      this._rememberTailSample(s);
      this._concealCursor = 0;
      this._stepReadOne(rate);
    }

    this._maybePostMetrics(
      (this._available / sampleRateHz) * 1000,
      quantum,
      this._concealedThisBlock
    );
    return true;
  }

  _concealSample() {
    if (this._lastTailLen < 2) return 0;
    const fadeLen = Math.min(this._lastTailLen, CONCEALMENT_FADE_SAMPLES);
    if (this._concealCursor >= fadeLen) return 0;
    const tailStart = this._lastTailLen - fadeLen;
    const sample = this._tailSampleAt(tailStart + this._concealCursor);
    const t = fadeLen <= 1 ? 1 : this._concealCursor / (fadeLen - 1);
    const g = 1 - t;
    this._concealCursor++;
    return sample * g * g;
  }

  _maybePostMetrics(bufferedMs, quantum, concealmentUsed) {
    this._metricsQuantumCount++;
    if (this._metricsQuantumCount < METRICS_QUANTA) return;
    this._metricsQuantumCount = 0;
    const deltaMs = bufferedMs - this._targetPlayoutMs;
    const outsideBandUnder =
      this._playoutStarted && deltaMs < -OUTSIDE_BAND_MS;
    const outsideBandOver =
      this._playoutStarted && deltaMs > OUTSIDE_BAND_MS;
    const outside = outsideBandUnder || outsideBandOver;
    this.port.postMessage({
      type: 'gcallPlayoutMetrics',
      sourceAddr: this._sourceAddr,
      bufferedMs,
      targetPlayoutMs: this._targetPlayoutMs,
      rate: this._smoothedRate,
      outsideBand: outside,
      outsideBandUnder,
      outsideBandOver,
      deltaMs,
      playoutStarted: this._playoutStarted,
      concealmentUsed: !!concealmentUsed,
    });
  }
}

registerProcessor('group-playout-processor', GroupPlayoutProcessor);
