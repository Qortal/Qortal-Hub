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
