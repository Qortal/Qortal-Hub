/**
 * group-playout-processor — adaptive PCM playout for group voice (per remote speaker).
 *
 * PCM-only bufferedMs; fractional read with clamp + EMA-smoothed rate.
 * Under-target: tiered slowdown (delta-based) + optional panic (buffer hysteresis + dwell cap).
 * Startup: silence until bufferedMs >= max(INITIAL_GATE_MS, target - START_GATE_TARGET_MARGIN_MS).
 * Latency cap: shed when buffered PCM exceeds PCM_LATENCY_HARD_MS.
 * maxPlayoutTargetMs in processorOptions must stay aligned with GCALL_GLOBAL_PLAYOUT_CAP_MS on main.
 */
const RING_CAPACITY = 48000;
const INITIAL_GATE_MS = 100;
const START_GATE_TARGET_MARGIN_MS = 20;
const DEFAULT_TARGET_MS = 100;
const ERROR_CLAMP_MS = 80;
const DEADZONE_MS = 6;
/** Minimum playback rate (over-target catch-up); under-target/panic may go lower. */
const RATE_MIN = 0.98;
const RATE_MAX = 1.01;
const EMA_ALPHA_SLOW = 0.06;
const EMA_ALPHA_FAST = 0.2;
const OUTSIDE_BAND_MS = 35;
const EMERGENCY_BAND_EXTRA_MS = 10;
const METRICS_QUANTA = 47;
const PCM_LATENCY_HARD_MS = 320;
const PCM_LATENCY_RELEASE_MS = 240;
const TARGET_RELEASE_MARGIN_MS = 40;
const OVER_TARGET_TIER_STRONG_MS = 170;
const OVER_TARGET_TIER_MID_MS = 90;
const OVER_TARGET_RATE_MID = 1.0065;
const OVER_TARGET_RATE_LIGHT = 1.0045;
const OVER_TARGET_FAST_ALPHA_MS = 125;
const CONCEALMENT_TAIL_SAMPLES = 240;
const CONCEALMENT_FADE_SAMPLES = 240;

/** Align with main-thread gcallPlayoutPolicy global cap (max severe across profiles). */
const DEFAULT_MAX_PLAYOUT_TARGET_MS = 280;

/** Under-target tiers (deltaMs = bufferedMs - target). */
const UNDER_TIER_DEEP_MS = -120;
const UNDER_TIER_MID_MS = -80;
const UNDER_TIER_SHALLOW_MS = -45;
const UNDER_RATE_DEEP = 0.94;
const UNDER_RATE_MID = 0.96;
const UNDER_RATE_SHALLOW = 0.98;
const UNDER_RATE_DEEP_USABLE = 0.97;
const UNDER_RATE_MID_USABLE = 0.985;
const UNDER_RATE_SHALLOW_USABLE = 0.992;
const UNDER_USABLE_BUFFER_MIN_MS = 85;
const UNDER_USABLE_TARGET_RATIO = 0.62;
const UNDER_USABLE_DELTA_MIN_MS = -70;
const RATE_K_UNDER = 0.000125;
const RATE_K_OVER = 0.0001;

/** Panic: absolute PCM depth (hysteresis + dwell). */
const PANIC_ENTER_MS = 60;
const PANIC_EXIT_MS = 78;
const PANIC_RATE = 0.915;
const PANIC_DWELL_MS = 2500;
const PANIC_RELAX_BLEND_MS = 500;

class GroupPlayoutProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._sourceAddr = options.processorOptions?.sourceAddr ?? '';
    this._maxPlayoutTargetMs =
      typeof options.processorOptions?.maxPlayoutTargetMs === 'number' &&
      Number.isFinite(options.processorOptions.maxPlayoutTargetMs)
        ? Math.max(
            80,
            Math.min(
              DEFAULT_MAX_PLAYOUT_TARGET_MS,
              options.processorOptions.maxPlayoutTargetMs
            )
          )
        : DEFAULT_MAX_PLAYOUT_TARGET_MS;

    this._ring = new Float32Array(RING_CAPACITY);
    this._writePos = 0;
    this._readPos = 0;
    this._available = 0;

    this._readFrac = 0;
    this._smoothedRate = 1;
    this._targetPlayoutMs = DEFAULT_TARGET_MS;
    this._playoutStarted = false;

    this._inPanic = false;
    this._panicSamplesInPanic = 0;
    this._panicZoneEnteredPending = false;

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
        this._targetPlayoutMs = Math.max(
          40,
          Math.min(this._maxPlayoutTargetMs, d.targetPlayoutMs)
        );
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

  /** Tier rate from delta only (under-target path). */
  _underTierRate(deltaMs, bufferedMs) {
    const usableBufferRelaxed =
      this._playoutStarted &&
      deltaMs >= UNDER_USABLE_DELTA_MIN_MS &&
      bufferedMs >=
        Math.max(UNDER_USABLE_BUFFER_MIN_MS, this._targetPlayoutMs * UNDER_USABLE_TARGET_RATIO);
    if (deltaMs < UNDER_TIER_DEEP_MS) {
      return usableBufferRelaxed ? UNDER_RATE_DEEP_USABLE : UNDER_RATE_DEEP;
    }
    if (deltaMs < UNDER_TIER_MID_MS) {
      return usableBufferRelaxed ? UNDER_RATE_MID_USABLE : UNDER_RATE_MID;
    }
    if (deltaMs < UNDER_TIER_SHALLOW_MS) {
      return usableBufferRelaxed ? UNDER_RATE_SHALLOW_USABLE : UNDER_RATE_SHALLOW;
    }
    return 1;
  }

  _computeRawTargetRate(bufferedMs, deltaMs, quantum, sampleRateHz) {
    const emergencyThresh = OUTSIDE_BAND_MS + EMERGENCY_BAND_EXTRA_MS;

    if (this._playoutStarted) {
      if (!this._inPanic && bufferedMs < PANIC_ENTER_MS) {
        this._inPanic = true;
        this._panicSamplesInPanic = 0;
        this._panicZoneEnteredPending = true;
      } else if (this._inPanic && bufferedMs > PANIC_EXIT_MS) {
        this._inPanic = false;
        this._panicSamplesInPanic = 0;
      }
      if (this._inPanic) {
        this._panicSamplesInPanic += quantum;
      }
    }

    const panicMs =
      sampleRateHz > 0
        ? (this._panicSamplesInPanic / sampleRateHz) * 1000
        : 0;
    const tierUnder = this._underTierRate(deltaMs, bufferedMs);

    if (this._inPanic && this._playoutStarted) {
      if (panicMs < PANIC_DWELL_MS) {
        return { targetRate: PANIC_RATE, inPanic: true, panicZoneEntered: false };
      }
      const t = Math.min(
        1,
        Math.max(0, (panicMs - PANIC_DWELL_MS) / PANIC_RELAX_BLEND_MS)
      );
      const blended = PANIC_RATE * (1 - t) + tierUnder * t;
      return { targetRate: blended, inPanic: true, panicZoneEntered: false };
    }

    if (deltaMs < UNDER_TIER_DEEP_MS) {
      return { targetRate: UNDER_RATE_DEEP, inPanic: false, panicZoneEntered: false };
    }
    if (deltaMs < UNDER_TIER_MID_MS) {
      return { targetRate: UNDER_RATE_MID, inPanic: false, panicZoneEntered: false };
    }
    if (deltaMs < UNDER_TIER_SHALLOW_MS) {
      return { targetRate: UNDER_RATE_SHALLOW, inPanic: false, panicZoneEntered: false };
    }
    if (deltaMs > OVER_TARGET_TIER_STRONG_MS) {
      return { targetRate: RATE_MAX, inPanic: false, panicZoneEntered: false };
    }
    if (deltaMs > OVER_TARGET_TIER_MID_MS) {
      return {
        targetRate: OVER_TARGET_RATE_MID,
        inPanic: false,
        panicZoneEntered: false,
      };
    }
    if (deltaMs > emergencyThresh) {
      return {
        targetRate: OVER_TARGET_RATE_LIGHT,
        inPanic: false,
        panicZoneEntered: false,
      };
    }
    let errorMs = Math.max(
      -ERROR_CLAMP_MS,
      Math.min(ERROR_CLAMP_MS, deltaMs)
    );
    if (Math.abs(errorMs) < DEADZONE_MS) errorMs = 0;
    const k = errorMs > 0 ? RATE_K_OVER : RATE_K_UNDER;
    const tr = 1 + Math.max(-0.01, Math.min(0.01, errorMs * k));
    return { targetRate: tr, inPanic: false, panicZoneEntered: false };
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
        this._maybePostMetrics(bufferedMs, quantum, false, 1, false, false);
        return true;
      }
      this._playoutStarted = true;
    }

    const deltaMs = bufferedMs - this._targetPlayoutMs;
    const raw = this._computeRawTargetRate(
      bufferedMs,
      deltaMs,
      quantum,
      sampleRateHz
    );
    let targetRate = raw.targetRate;
    targetRate = Math.min(RATE_MAX, targetRate);
    const floorR = raw.inPanic ? 0.9 : RATE_MIN;
    targetRate = Math.max(floorR, targetRate);

    const underStress =
      raw.inPanic ||
      deltaMs < UNDER_TIER_SHALLOW_MS ||
      deltaMs > OVER_TARGET_FAST_ALPHA_MS;
    const alpha = underStress ? EMA_ALPHA_FAST : EMA_ALPHA_SLOW;
    this._smoothedRate += alpha * (targetRate - this._smoothedRate);
    this._smoothedRate = Math.max(
      raw.inPanic ? 0.9 : RATE_MIN,
      Math.min(RATE_MAX, this._smoothedRate)
    );

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
      this._concealedThisBlock,
      rate,
      raw.inPanic
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

  _maybePostMetrics(
    bufferedMs,
    quantum,
    concealmentUsed,
    smoothedRate,
    panicActive
  ) {
    this._metricsQuantumCount++;
    if (this._metricsQuantumCount < METRICS_QUANTA) return;
    this._metricsQuantumCount = 0;
    const deltaMs = bufferedMs - this._targetPlayoutMs;
    const outsideBandUnder =
      this._playoutStarted && deltaMs < -OUTSIDE_BAND_MS;
    const outsideBandOver =
      this._playoutStarted && deltaMs > OUTSIDE_BAND_MS;
    const outside = outsideBandUnder || outsideBandOver;
    const panicZoneEntered = this._panicZoneEnteredPending;
    this._panicZoneEnteredPending = false;
    this.port.postMessage({
      type: 'gcallPlayoutMetrics',
      sourceAddr: this._sourceAddr,
      bufferedMs,
      targetPlayoutMs: this._targetPlayoutMs,
      rate: smoothedRate,
      panicActive: !!panicActive,
      panicZoneEntered: !!panicZoneEntered,
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
