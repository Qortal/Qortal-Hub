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
  adaptiveMaxTargetMs: 180,
  adaptiveSevereMaxTargetMs: 240,
  wasmFecMaxGapReset: 32,
} as const;

const HIGH_STABILITY_BASE = {
  opusBitrate: 32_000,
  /** Slightly higher than low-latency so WebCodecs Opus `packetlossperc` + WASM FEC ladder tolerate measured mesh loss. */
  opusExpectedPacketLossPercent: 14,
  jitterBufferSize: 6,
  jitterStartBufferSize: 6,
  adaptiveMaxTargetMs: 220,
  adaptiveSevereMaxTargetMs: 280,
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
export const GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_SINGLE_REMOTE = 11;
export const GCALL_RECOVERY_JITTER_START_MIN_SINGLE_REMOTE = 10;
/** Phase D tier-2: recovery + multi-source (N>=2); default on unless `readGcallJitterTier2OptOut()`. */
export const GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_TIER2 = 12;
export const GCALL_RECOVERY_JITTER_START_MIN_TIER2 = 10;
/** Require `adaptiveNetworkMode === 'recovery'` this long before deepening jitter (ms). */
export const GCALL_RECOVERY_JITTER_APPLY_DWELL_MS = 200;
/** Require non-recovery this long before reverting jitter geometry (ms). */
export const GCALL_RECOVERY_JITTER_EXIT_DEBOUNCE_MS = 125;
/** Base delay resetting `primed` after last pop empties the jitter buffer (ms). Phase C/D. */
export const GCALL_JITTER_SOFT_UNPRIME_MS = 50;

/** Phase D: boost decode when physical depth is at or below this (frames). */
export const GCALL_THIN_JITTER_BUFFER_FRAMES = 2;

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
