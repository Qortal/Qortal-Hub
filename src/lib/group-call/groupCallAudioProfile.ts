/**
 * User-selectable audio quality profiles for group voice.
 * Persisted in localStorage (`GCALL_AUDIO_QUALITY_PROFILE_KEY`).
 *
 * - **low-latency**: Original defaults; minimal playout delay.
 * - **high-stability**: Deeper start buffer, higher adaptive ceilings, slightly
 *   higher Opus bitrate/FEC hints — targets underruns and recovery flapping.
 */

export type GroupCallAudioQualityProfile = 'low-latency' | 'high-stability';

export const GCALL_AUDIO_QUALITY_PROFILE_KEY = 'qortal:gcall-audio-profile';

export interface GroupCallAudioTuning {
  readonly profile: GroupCallAudioQualityProfile;
  /** Nominal uplink bitrate; send-pressure steps down from this (see `opusSendPressure.ts`). */
  readonly opusBitrate: number;
  readonly opusExpectedPacketLossPercent: number;
  readonly jitterBufferSize: number;
  readonly jitterStartBufferSize: number;
  readonly adaptiveMaxTargetMs: number;
  readonly adaptiveSevereMaxTargetMs: number;
  /** Seq gap before Opus FEC worker issues `reset` (WASM path). */
  readonly wasmFecMaxGapReset: number;
}

const LOW_LATENCY_BASE = {
  opusBitrate: 24_000,
  opusExpectedPacketLossPercent: 10,
  jitterBufferSize: 6,
  jitterStartBufferSize: 4,
  /** Balance: below old ~180ms runaway, above ~105ms which forced chronic under-target playout. */
  adaptiveMaxTargetMs: 120,
  adaptiveSevereMaxTargetMs: 170,
  wasmFecMaxGapReset: 32,
} as const;

const HIGH_STABILITY_BASE = {
  opusBitrate: 32_000,
  /** Slightly higher than low-latency so WebCodecs Opus `packetlossperc` + WASM FEC ladder tolerate measured mesh loss. */
  opusExpectedPacketLossPercent: 14,
  /** Deeper steady geometry so high-stability can absorb one-on-one decrypt/network bursts before recovery engages. */
  jitterBufferSize: 8,
  jitterStartBufferSize: 7,
  adaptiveMaxTargetMs: 145,
  adaptiveSevereMaxTargetMs: 185,
  /** Wider seq-gap tolerance before WASM FEC worker reset under high-stability profile. */
  wasmFecMaxGapReset: 42,
} as const;

/**
 * Max `adaptiveSevereMaxTargetMs` across all profiles. Global playout ceiling in
 * `gcallPlayoutPolicy` must be >= this so profile caps are not clamped below intent.
 */
export const GCALL_MAX_ADAPTIVE_SEVERE_MS_ACROSS_PROFILES = Math.max(
  LOW_LATENCY_BASE.adaptiveSevereMaxTargetMs,
  HIGH_STABILITY_BASE.adaptiveSevereMaxTargetMs
);

/** Recovery mode: minimum Opus reorder window (frames) before push trim — Phase C upstream. */
export const GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN = 10;
/** Recovery mode: minimum frames before first drain when unprimed — Phase C upstream. */
export const GCALL_RECOVERY_JITTER_START_MIN = 9;
/** Single-remote recovery (N===1, non–tier-2): between Phase C and tier-2 — 2-way playout plan. */
export const GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_SINGLE_REMOTE = 12;
export const GCALL_RECOVERY_JITTER_START_MIN_SINGLE_REMOTE = 11;
/** Phase D tier-2: recovery + multi-source (N>=2); default on unless `readGcallJitterTier2OptOut()`. */
export const GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_TIER2 = 12;
export const GCALL_RECOVERY_JITTER_START_MIN_TIER2 = 10;
/** Require `adaptiveNetworkMode === 'recovery'` this long before deepening jitter (ms). */
export const GCALL_RECOVERY_JITTER_APPLY_DWELL_MS = 250;
/** Require non-recovery this long before reverting jitter geometry (ms). */
export const GCALL_RECOVERY_JITTER_EXIT_DEBOUNCE_MS = 260;
/** Base delay resetting `primed` after last pop empties the jitter buffer (ms). Phase C/D. */
export const GCALL_JITTER_SOFT_UNPRIME_MS = 50;

/**
 * Additive jitter-buffer hold frames while a decrypt-burst recovery window is
 * active (call start, post-key-sync, topology change, participant join). This
 * prevents pops from advancing `lastPlayedSeq` before late-decrypted frames
 * from the worker land at the ingest — those frames would otherwise be
 * rejected as `stale` in `JitterBuffer.push`. 4 frames ≈ 80 ms of extra
 * preroll, sized to cover typical decrypt-worker latency bursts (100–200 ms)
 * observed at call start without adding audible latency to the steady state.
 * The hold is cleared when the burst window expires.
 */
export const GCALL_BURST_RECOVERY_JITTER_EXTRA_HOLD_FRAMES = 4;

/** Phase D: boost decode when physical depth is at or below this (frames). */
export const GCALL_THIN_JITTER_BUFFER_FRAMES = 2;

export type GcallJitterBurstHeadroomLevel = 0 | 1 | 2 | 3;

export interface GcallJitterBurstHeadroomState {
  readonly level: GcallJitterBurstHeadroomLevel;
  readonly holdUntilMs: number;
  readonly calmSinceMs: number | null;
  readonly nearCapPressureCount: number;
}

export const GCALL_JITTER_BURST_HEADROOM_TRIM_TRIGGER = 6;
export const GCALL_JITTER_BURST_HEADROOM_STRONG_TRIM_TRIGGER = 12;
export const GCALL_JITTER_BURST_HEADROOM_EMERGENCY_TRIM_TRIGGER = 96;
export const GCALL_JITTER_BURST_HEADROOM_HOLD_MS = 12_000;
export const GCALL_JITTER_BURST_HEADROOM_CALM_MS = 10_000;
export const GCALL_JITTER_BURST_HEADROOM_UNDERTARGET_MIN = 0.2;
export const GCALL_JITTER_BURST_HEADROOM_PLAYOUT_RATE_MIN = 0.98;
export const GCALL_JITTER_BURST_HEADROOM_STABLE_UNDERTARGET_MAX = 0.15;
export const GCALL_JITTER_BURST_HEADROOM_STABLE_PLAYOUT_RATE_MIN = 0.985;
export const GCALL_JITTER_BURST_HEADROOM_NEAR_CAP_TRIGGER_COUNT = 2;

export function createGcallJitterBurstHeadroomState(): GcallJitterBurstHeadroomState {
  return {
    level: 0,
    holdUntilMs: 0,
    calmSinceMs: null,
    nearCapPressureCount: 0,
  };
}

export function applyGcallJitterBurstHeadroom(
  tuning: { jitterBufferSize: number; jitterStartBufferSize: number },
  level: GcallJitterBurstHeadroomLevel
): { jitterBufferSize: number; jitterStartBufferSize: number } {
  if (level <= 0) return tuning;
  const bufferBoost =
    level >= 3 ? 28 : level >= 2 ? 8 : 4;
  const startBoost =
    level >= 3 ? 8 : level >= 2 ? 4 : 2;
  return {
    jitterBufferSize: tuning.jitterBufferSize + bufferBoost,
    jitterStartBufferSize: tuning.jitterStartBufferSize + startBoost,
  };
}

export function stepGcallJitterBurstHeadroom(input: {
  state: GcallJitterBurstHeadroomState;
  enabled: boolean;
  nowMs: number;
  trimCount: number;
  depthHighWater: number;
  maxDepthFrames: number;
  playoutUnderTargetFraction: number;
  avgPlayoutRate: number;
}): { state: GcallJitterBurstHeadroomState; reason: string | null } {
  const safeState = input.state ?? createGcallJitterBurstHeadroomState();
  if (!input.enabled) {
    return safeState.level === 0 &&
      safeState.holdUntilMs === 0 &&
      safeState.calmSinceMs === null &&
      safeState.nearCapPressureCount === 0
      ? { state: safeState, reason: null }
      : { state: createGcallJitterBurstHeadroomState(), reason: 'disabled' };
  }

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const trimCount = Math.max(
    0,
    Number.isFinite(input.trimCount) ? input.trimCount : 0
  );
  const depthHighWater = Math.max(
    0,
    Number.isFinite(input.depthHighWater) ? input.depthHighWater : 0
  );
  const maxDepthFrames = Math.max(
    1,
    Number.isFinite(input.maxDepthFrames) ? input.maxDepthFrames : 1
  );
  const underTarget = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(input.playoutUnderTargetFraction)
        ? input.playoutUnderTargetFraction
        : 0
    )
  );
  const avgPlayoutRate =
    Number.isFinite(input.avgPlayoutRate) && input.avgPlayoutRate > 0
      ? input.avgPlayoutRate
      : 1;
  const playoutStressed =
    underTarget >= GCALL_JITTER_BURST_HEADROOM_UNDERTARGET_MIN ||
    avgPlayoutRate < GCALL_JITTER_BURST_HEADROOM_PLAYOUT_RATE_MIN;
  const nearCap =
    depthHighWater >= Math.max(1, maxDepthFrames - 1);
  const nearCapPressureCount =
    nearCap && playoutStressed
      ? safeState.nearCapPressureCount + 1
      : 0;
  const directTrimPressure =
    trimCount >= GCALL_JITTER_BURST_HEADROOM_TRIM_TRIGGER ||
    (trimCount > 0 && nearCap);
  const nearCapPressure =
    nearCapPressureCount >= GCALL_JITTER_BURST_HEADROOM_NEAR_CAP_TRIGGER_COUNT;

  if (directTrimPressure || (playoutStressed && nearCapPressure)) {
    const emergencyPressure =
      trimCount >= GCALL_JITTER_BURST_HEADROOM_EMERGENCY_TRIM_TRIGGER;
    const strongPressure =
      emergencyPressure ||
      trimCount >= GCALL_JITTER_BURST_HEADROOM_STRONG_TRIM_TRIGGER ||
      nearCapPressureCount >
        GCALL_JITTER_BURST_HEADROOM_NEAR_CAP_TRIGGER_COUNT;
    const requestedLevel: GcallJitterBurstHeadroomLevel = strongPressure
      ? emergencyPressure
        ? 3
        : 2
      : safeState.level >= 1
        ? 2
        : 1;
    const nextLevel =
      requestedLevel > safeState.level ? requestedLevel : safeState.level;
    return {
      state: {
        level: nextLevel as GcallJitterBurstHeadroomLevel,
        holdUntilMs: nowMs + GCALL_JITTER_BURST_HEADROOM_HOLD_MS,
        calmSinceMs: null,
        nearCapPressureCount,
      },
      reason: directTrimPressure ? 'trim-pressure' : 'near-cap-pressure',
    };
  }

  const stable =
    trimCount === 0 &&
    !nearCap &&
    underTarget <= GCALL_JITTER_BURST_HEADROOM_STABLE_UNDERTARGET_MAX &&
    avgPlayoutRate >= GCALL_JITTER_BURST_HEADROOM_STABLE_PLAYOUT_RATE_MIN;
  if (safeState.level <= 0) {
    return {
      state: {
        ...safeState,
        calmSinceMs: stable ? (safeState.calmSinceMs ?? nowMs) : null,
        nearCapPressureCount,
      },
      reason: null,
    };
  }
  if (!stable || nowMs < safeState.holdUntilMs) {
    return {
      state: {
        ...safeState,
        calmSinceMs: stable ? (safeState.calmSinceMs ?? nowMs) : null,
        nearCapPressureCount,
      },
      reason: null,
    };
  }
  const calmSinceMs = safeState.calmSinceMs ?? nowMs;
  if (nowMs - calmSinceMs < GCALL_JITTER_BURST_HEADROOM_CALM_MS) {
    return {
      state: {
        ...safeState,
        calmSinceMs,
        nearCapPressureCount,
      },
      reason: null,
    };
  }
  const nextLevel = Math.max(0, safeState.level - 1) as GcallJitterBurstHeadroomLevel;
  return {
    state: {
      level: nextLevel,
      holdUntilMs: nextLevel > 0 ? nowMs + GCALL_JITTER_BURST_HEADROOM_HOLD_MS : 0,
      calmSinceMs: nextLevel > 0 ? nowMs : null,
      nearCapPressureCount,
    },
    reason: 'calm-decay',
  };
}

/**
 * Opt out of Phase D tier-2 geometry (12/10) + scaled soft un-prime for local debugging.
 * Shipped behavior: tier-2 is on for recovery + multi-source unless disabled via
 * `VITE_GCALL_JITTER_TIER2=0` or `localStorage gcallJitterTier2=0`.
 */
export function readGcallJitterTier2OptOut(): boolean {
  try {
    if (
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_GCALL_JITTER_TIER2 === '0'
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('gcallJitterTier2') === '0'
    ) {
      return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

/** @deprecated Use readGcallJitterTier2OptOut — tier-2 defaults on for recovery multi-source. */
export function readGcallJitterTier2Enabled(): boolean {
  return !readGcallJitterTier2OptOut();
}

export interface EffectiveJitterTuningOpts {
  /** Tier-2 floors when recovery + multi-source (requires activeSourceCount >= 2). */
  tier2MultiSource?: boolean;
  activeSourceCount?: number;
}

/**
 * Deeper jitter geometry in recovery so Opus ingress can match adaptive playout targets.
 * Identity when `adaptiveNetworkMode` is not recovery.
 * Phase D: tier-2 when `tier2MultiSource`, `activeSourceCount >= 2`, and not opted out.
 */
export function getEffectiveJitterTuning(
  tuning: GroupCallAudioTuning,
  adaptiveNetworkMode: 'low-latency' | 'recovery',
  opts?: EffectiveJitterTuningOpts
): { jitterBufferSize: number; jitterStartBufferSize: number } {
  if (adaptiveNetworkMode !== 'recovery') {
    return {
      jitterBufferSize: tuning.jitterBufferSize,
      jitterStartBufferSize: tuning.jitterStartBufferSize,
    };
  }
  const n = opts?.activeSourceCount ?? 0;
  const tier2 =
    Boolean(opts?.tier2MultiSource) && !readGcallJitterTier2OptOut() && n >= 2;
  if (tier2) {
    return {
      jitterBufferSize: Math.max(
        tuning.jitterBufferSize,
        GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_TIER2
      ),
      jitterStartBufferSize: Math.max(
        tuning.jitterStartBufferSize,
        GCALL_RECOVERY_JITTER_START_MIN_TIER2
      ),
    };
  }
  if (n === 1) {
    return {
      jitterBufferSize: Math.max(
        tuning.jitterBufferSize,
        GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_SINGLE_REMOTE
      ),
      jitterStartBufferSize: Math.max(
        tuning.jitterStartBufferSize,
        GCALL_RECOVERY_JITTER_START_MIN_SINGLE_REMOTE
      ),
    };
  }
  return {
    jitterBufferSize: Math.max(
      tuning.jitterBufferSize,
      GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN
    ),
    jitterStartBufferSize: Math.max(
      tuning.jitterStartBufferSize,
      GCALL_RECOVERY_JITTER_START_MIN
    ),
  };
}

/**
 * Phase D: scaled soft un-prime when tier-2 path active (recovery + multi-source, unless opt-out).
 */
export function computeSoftUnprimeMsForTier2(
  activeSourceCount: number,
  recoveryMultiSource: boolean
): number {
  if (
    activeSourceCount < 2 ||
    !recoveryMultiSource ||
    readGcallJitterTier2OptOut()
  ) {
    return GCALL_JITTER_SOFT_UNPRIME_MS;
  }
  return GCALL_JITTER_SOFT_UNPRIME_MS + (activeSourceCount - 1) * 20;
}

export function getGroupCallAudioTuning(
  profile: GroupCallAudioQualityProfile
): GroupCallAudioTuning {
  if (profile === 'high-stability') {
    return { profile, ...HIGH_STABILITY_BASE };
  }
  return { profile, ...LOW_LATENCY_BASE };
}

export function readGroupCallAudioProfile(): GroupCallAudioQualityProfile {
  try {
    const v = localStorage.getItem(GCALL_AUDIO_QUALITY_PROFILE_KEY);
    if (v === 'low-latency' || v === 'high-stability') return v;
  } catch {
    /* private mode */
  }
  return 'high-stability';
}

export function writeGroupCallAudioProfile(
  profile: GroupCallAudioQualityProfile
): void {
  try {
    localStorage.setItem(GCALL_AUDIO_QUALITY_PROFILE_KEY, profile);
  } catch {
    /* private mode */
  }
}
