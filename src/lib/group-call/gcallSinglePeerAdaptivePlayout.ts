/**
 * Adaptive playout target for a single remote source (DM Reticulum voice).
 * Aligns with `tickAdaptivePlayoutTargets` in `useGroupVoiceCall` for the N===1, no-topology case.
 */

import {
  computeAdaptiveIdealTargetMs,
  computeAdaptiveJitterMs,
  stepSmoothedAdaptiveTargetMs,
} from './adaptivePlayout';
import {
  computeMicroWidenExtraMsV1,
  effectivePlayoutMaxTargetMs,
  MICRO_WIDEN_CEILING_LIFT_MS,
  MICRO_WIDEN_CEILING_TTL_MS,
  MICRO_WIDEN_EPSILON,
  MICRO_WIDEN_M,
  MICRO_WIDEN_W_MS,
} from './gcallPlayoutPolicy';
import type { GroupCallAudioTuning } from './groupCallAudioProfile';
import { computeSteadyTargetDecayThresholdMs } from './groupCallSteadyTargetDecay';
import {
  summarizeRecentRecoveryStability,
  type RecoveryPlayoutHealthSample,
} from './groupCallRecoveryDecisions';

const ADAPTIVE_BASE_TARGET_MS = 100;
const ADAPTIVE_MIN_TARGET_MS = 100;
const ADAPTIVE_JITTER_K = 2.0;
const ADAPTIVE_ALPHA_UP = 0.32;
const ADAPTIVE_ALPHA_UP_SINGLE_REMOTE_RECOVERY = 0.5;
const ADAPTIVE_ALPHA_DOWN = 0.28;
const ADAPTIVE_ALPHA_DOWN_RECOVERY = 0.18;
const ADAPTIVE_LOSS_MS_CAP = 12;
const ADAPTIVE_RECOVERY_PLAYOUT_BOOST_MS = 20;
const ADAPTIVE_RECOVERY_STABLE_EXIT_WINDOW_MS = 400;
const ADAPTIVE_TARGET_POST_MIN_MS = 40;
const ADAPTIVE_TARGET_MIN_DELTA_MS = 3;
const GCALL_DECAY_GUARD_JITTER_CALM_MAX_MS = 22;
const GCALL_DECAY_GUARD_CALM_DURATION_MS = 2500;
const GCALL_DECAY_GUARD_ALPHA_DOWN = 0.38;
const GCALL_STABLE_RECOVERY_ALPHA_DOWN = 0.34;
const GCALL_STABLE_SINGLE_REMOTE_ALPHA_DOWN = 0.32;

export interface SinglePeerAdaptivePlayoutInput {
  now: number;
  wallNow: number;
  tuning: GroupCallAudioTuning;
  interArrivalSamplesMs: readonly number[];
  missedFramesThisTick: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  /** True while global/session recovery boost applies (matches group `globalRecoveryUntilMsRef`). */
  globalRecoveryBoostActive: boolean;
  /** Proxy for `assessReticulumAudioPressureWindow(...).shouldTightenRecovery`. */
  pressureShouldTightenRecovery: boolean;
  ingressPeerRecovery: boolean;
  failSafeActive: boolean;
  recentPlayoutHealthSamples: readonly RecoveryPlayoutHealthSample[];
  recentUnderrunTimesMs: readonly number[];
  smoothedPlayoutTargetMs: number | undefined;
  lastSentPlayoutTargetMs: number | undefined;
  lastPlayoutTargetPostAt: number;
  microWidenCeilingLiftUntilMs: number;
  decayGuardCalmStartMs: number | undefined;
}

export interface SinglePeerAdaptivePlayoutOutput {
  smoothMs: number;
  lastSentMs: number | undefined;
  lastPostAt: number;
  posted: boolean;
  nextMicroWidenCeilingLiftUntilMs: number;
  nextDecayGuardCalmStartMs: number | undefined;
}

export function tickSinglePeerAdaptivePlayoutTarget(
  input: SinglePeerAdaptivePlayoutInput
): SinglePeerAdaptivePlayoutOutput {
  const {
    now,
    wallNow,
    tuning,
    interArrivalSamplesMs,
    missedFramesThisTick,
    adaptiveNetworkMode,
    globalRecoveryBoostActive,
    pressureShouldTightenRecovery,
    ingressPeerRecovery,
    failSafeActive,
    recentPlayoutHealthSamples,
    recentUnderrunTimesMs,
    smoothedPlayoutTargetMs,
    lastSentPlayoutTargetMs,
    lastPlayoutTargetPostAt,
    microWidenCeilingLiftUntilMs,
    decayGuardCalmStartMs,
  } = input;

  const baseAlphaDown =
    adaptiveNetworkMode === 'recovery'
      ? ADAPTIVE_ALPHA_DOWN_RECOVERY
      : ADAPTIVE_ALPHA_DOWN;
  const playoutBoostMs = globalRecoveryBoostActive
    ? ADAPTIVE_RECOVERY_PLAYOUT_BOOST_MS
    : 0;

  let jitterMs = computeAdaptiveJitterMs(interArrivalSamplesMs);
  if (failSafeActive) {
    jitterMs = Math.max(jitterMs, 6 * 20);
  }
  const lossPenalty = Math.min(ADAPTIVE_LOSS_MS_CAP, missedFramesThisTick * 2);

  const smoothedTargetMsForAdequacy =
    smoothedPlayoutTargetMs ?? ADAPTIVE_BASE_TARGET_MS;
  const recentStability = summarizeRecentRecoveryStability({
    samples: recentPlayoutHealthSamples,
    underrunTimesMs: recentUnderrunTimesMs,
    nowMs: now,
    windowMs: ADAPTIVE_RECOVERY_STABLE_EXIT_WINDOW_MS,
  });

  const stableSingleRemoteLowLatency =
    adaptiveNetworkMode !== 'recovery' &&
    pressureShouldTightenRecovery !== true &&
    !ingressPeerRecovery &&
    recentStability.stable;

  const adaptiveMaxTargetMs = effectivePlayoutMaxTargetMs({
    profileAdaptiveMaxMs: tuning.adaptiveMaxTargetMs,
    profileAdaptiveSevereMaxMs: tuning.adaptiveSevereMaxTargetMs,
    useSevereCeiling: ingressPeerRecovery,
    isolationCeilingSoftened: false,
    activeSourceCount: 1,
    dynamicCeilingLiftMs: 0,
  });

  let ideal = computeAdaptiveIdealTargetMs({
    baseTargetMs: ADAPTIVE_BASE_TARGET_MS,
    minTargetMs: ADAPTIVE_MIN_TARGET_MS,
    maxTargetMs: adaptiveMaxTargetMs,
    jitterMultiplier: ADAPTIVE_JITTER_K,
    jitterMs,
    lossPenaltyMs: lossPenalty,
    playoutBoostMs,
  });

  const microWiden = computeMicroWidenExtraMsV1({
    interArrivalSamplesMs,
    M: MICRO_WIDEN_M,
    epsilon: MICRO_WIDEN_EPSILON,
    Wms: MICRO_WIDEN_W_MS,
  });
  let nextMicroCeilingUntil = microWidenCeilingLiftUntilMs;
  if (!ingressPeerRecovery && microWiden.eligible) {
    nextMicroCeilingUntil = wallNow + MICRO_WIDEN_CEILING_TTL_MS;
  }
  let microWidenCeilingLiftMs = 0;
  if (wallNow < nextMicroCeilingUntil) {
    microWidenCeilingLiftMs = MICRO_WIDEN_CEILING_LIFT_MS;
  } else if (nextMicroCeilingUntil > 0) {
    nextMicroCeilingUntil = 0;
  }

  if (microWiden.eligible) {
    ideal = Math.min(ideal + microWiden.extraMs, adaptiveMaxTargetMs);
  }

  let alphaDown = baseAlphaDown;
  const steadyTargetDecayThresholdMs = computeSteadyTargetDecayThresholdMs({
    adaptiveMaxTargetMs,
    activeSourceCount: 1,
    adaptiveNetworkMode,
  });
  let nextDecayGuardCalmStart = decayGuardCalmStartMs;
  if (
    smoothedTargetMsForAdequacy > steadyTargetDecayThresholdMs &&
    jitterMs < GCALL_DECAY_GUARD_JITTER_CALM_MAX_MS &&
    (adaptiveNetworkMode === 'recovery' || stableSingleRemoteLowLatency)
  ) {
    if (nextDecayGuardCalmStart === undefined) {
      nextDecayGuardCalmStart = wallNow;
    }
  } else {
    nextDecayGuardCalmStart = undefined;
  }
  const decayGuardActive =
    nextDecayGuardCalmStart !== undefined &&
    wallNow - nextDecayGuardCalmStart >= GCALL_DECAY_GUARD_CALM_DURATION_MS;
  if (decayGuardActive) {
    alphaDown = Math.max(alphaDown, GCALL_DECAY_GUARD_ALPHA_DOWN);
  }
  if (
    adaptiveNetworkMode === 'recovery' &&
    pressureShouldTightenRecovery !== true &&
    recentStability.stable
  ) {
    alphaDown = Math.max(alphaDown, GCALL_STABLE_RECOVERY_ALPHA_DOWN);
  }
  if (
    stableSingleRemoteLowLatency &&
    smoothedTargetMsForAdequacy > steadyTargetDecayThresholdMs
  ) {
    alphaDown = Math.max(alphaDown, GCALL_STABLE_SINGLE_REMOTE_ALPHA_DOWN);
  }

  const alphaUpForSmooth =
    adaptiveNetworkMode === 'recovery'
      ? Math.max(ADAPTIVE_ALPHA_UP, ADAPTIVE_ALPHA_UP_SINGLE_REMOTE_RECOVERY)
      : ADAPTIVE_ALPHA_UP;

  const smooth = stepSmoothedAdaptiveTargetMs({
    idealTargetMs: ideal,
    previousTargetMs: smoothedPlayoutTargetMs,
    alphaUp: alphaUpForSmooth,
    alphaDown,
    maxTargetMs: adaptiveMaxTargetMs + microWidenCeilingLiftMs,
  });

  let posted = false;
  let nextLastSent = lastSentPlayoutTargetMs;
  let nextLastPost = lastPlayoutTargetPostAt;
  if (
    lastSentPlayoutTargetMs !== undefined &&
    Math.abs(smooth - lastSentPlayoutTargetMs) <= ADAPTIVE_TARGET_MIN_DELTA_MS
  ) {
    /* skip post */
  } else if (
    lastSentPlayoutTargetMs !== undefined &&
    now - lastPlayoutTargetPostAt < ADAPTIVE_TARGET_POST_MIN_MS
  ) {
    /* skip post */
  } else {
    posted = true;
    nextLastSent = smooth;
    nextLastPost = now;
  }

  return {
    smoothMs: smooth,
    lastSentMs: nextLastSent,
    lastPostAt: nextLastPost,
    posted,
    nextMicroWidenCeilingLiftUntilMs: nextMicroCeilingUntil,
    nextDecayGuardCalmStartMs: nextDecayGuardCalmStart,
  };
}
