import type { GroupCallSourceWindowMetrics } from './router';
import { GCALL_MAX_ADAPTIVE_SEVERE_MS_ACROSS_PROFILES } from './groupCallAudioProfile';

/**
 * Upper envelope for `effectivePlayoutMaxTargetMs` (ms). Must be >= max profile
 * `adaptiveSevereMaxTargetMs` so high-stability / severe ceilings are reachable.
 */
export const GCALL_GLOBAL_PLAYOUT_CAP_MS = GCALL_MAX_ADAPTIVE_SEVERE_MS_ACROSS_PROFILES;

/** Temporary ceiling lift when micro-widen v1 detects rising inter-arrival variance (ms). */
export const MICRO_WIDEN_CEILING_LIFT_MS = 50;
/** How long micro-widen ceiling lift stays active after last eligible tick (ms). */
export const MICRO_WIDEN_CEILING_TTL_MS = 2500;

/** After a topology commit, suppress aggressive warm / hysteresis advances for this long (wall clock ms). */
export const GCALL_TOPOLOGY_SETTLE_MS = 500;

/** Predictive micro-widen v1 — see plan: inter-arrival variance trend within adaptive cap. */
export const MICRO_WIDEN_V1_ID = 'microWidenV1';
export const MICRO_WIDEN_M = 15;
export const MICRO_WIDEN_EPSILON = 0.08;
export const MICRO_WIDEN_W_MS = 8;
/** Minimum baseline variance (ms²) so near-zero baseline does not explode ratio tests. */
export const MICRO_WIDEN_VARIANCE_FLOOR_MS2 = 0.5;

/** Population variance of a numeric slice (ms² for inter-arrival samples). */
export function varianceOfSliceMs2(samples: readonly number[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const x of samples) sum += x;
  const mean = sum / n;
  let v = 0;
  for (const x of samples) {
    const d = x - mean;
    v += d * d;
  }
  return v / n;
}

/**
 * v1 micro-widen: last M inter-arrival deltas vs previous M in the same ring; rising variance
 * gets up to {@link MICRO_WIDEN_W_MS} ms extra ideal target (caller clamps to profile cap).
 */
export function computeMicroWidenExtraMsV1(input: {
  interArrivalSamplesMs: readonly number[];
  M?: number;
  epsilon?: number;
  Wms?: number;
  varianceFloorMs2?: number;
}): {
  eligible: boolean;
  extraMs: number;
  currentVarMs2: number;
  rawBaselineVarMs2: number;
  effectiveBaselineVarMs2: number;
} {
  const M = input.M ?? MICRO_WIDEN_M;
  const epsilon = input.epsilon ?? MICRO_WIDEN_EPSILON;
  const Wms = input.Wms ?? MICRO_WIDEN_W_MS;
  const floor = input.varianceFloorMs2 ?? MICRO_WIDEN_VARIANCE_FLOOR_MS2;
  const s = input.interArrivalSamplesMs;
  if (s.length < M * 2) {
    return {
      eligible: false,
      extraMs: 0,
      currentVarMs2: 0,
      rawBaselineVarMs2: 0,
      effectiveBaselineVarMs2: 0,
    };
  }
  const current = s.slice(-M);
  const baseline = s.slice(-2 * M, -M);
  const currentVarMs2 = varianceOfSliceMs2(current);
  const rawBaselineVarMs2 = varianceOfSliceMs2(baseline);
  if (rawBaselineVarMs2 <= 0) {
    return {
      eligible: false,
      extraMs: 0,
      currentVarMs2,
      rawBaselineVarMs2,
      effectiveBaselineVarMs2: 0,
    };
  }
  const effectiveBaselineVarMs2 = Math.max(rawBaselineVarMs2, floor);
  const eligible = currentVarMs2 > effectiveBaselineVarMs2 * (1 + epsilon);
  return {
    eligible,
    extraMs: eligible ? Wms : 0,
    currentVarMs2,
    rawBaselineVarMs2,
    effectiveBaselineVarMs2,
  };
}

/** Extra headroom from diminishing function of active source count (ms). */
export function diminishingPlayoutExtraMs(activeSourceCount: number): number {
  const n = Math.max(1, activeSourceCount);
  return Math.min(30, Math.round(15 * Math.log2(n)));
}

/**
 * Multi-source recovery can become self-defeating when the target ceiling stays pinned near the
 * single-peer severe cap while 2-4 remotes share the same decode budget. A 3-way call presents
 * as 2 active remotes on each receiver, so clamp those ceilings too.
 */
export function computeRecoveryMultiSourceTargetMaxMs(input: {
  profileAdaptiveMaxMs: number;
  profileAdaptiveSevereMaxMs: number;
  activeSourceCount: number;
  starvationSeverity: 'none' | 'mild' | 'strong';
  isolatedSource?: boolean;
}): number | null {
  const n = Math.max(1, input.activeSourceCount);
  if (n < 2) return null;
  const baseExtraMs = n >= 4 ? 12 : n === 3 ? 16 : 10;
  const starvationBonusMs =
    input.starvationSeverity === 'strong'
      ? n === 2
        ? 6
        : 8
      : input.starvationSeverity === 'mild'
        ? n === 2
          ? 3
          : 4
        : 0;
  const isolationPenaltyMs = input.isolatedSource ? (n === 2 ? 8 : 10) : 0;
  const maxExtraMs = n === 2 ? 20 : 24;
  return Math.min(
    input.profileAdaptiveSevereMaxMs,
    Math.max(
      input.profileAdaptiveMaxMs,
      input.profileAdaptiveMaxMs +
        Math.min(maxExtraMs, baseExtraMs + starvationBonusMs) -
        isolationPenaltyMs
    )
  );
}

const GCALL_SINGLE_REMOTE_FEASIBILITY_MIN_TARGET_MS = 100;
const GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_UNDERTARGET_MIN = 0.6;
const GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_DELTA_MAX_MS = -50;
const GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_RESERVE_RATIO_MAX = 0.42;
const GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_UNDERTARGET_MIN = 0.45;
const GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_DELTA_MAX_MS = -35;
const GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_RESERVE_RATIO_MAX = 0.5;
const GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_UNDERTARGET_MIN = 0.55;
const GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_DELTA_MAX_MS = -45;
const GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_RESERVE_RATIO_MAX = 0.55;
const GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_HEADROOM_MS = 34;
const GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_HEADROOM_MS = 38;
const GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_HEADROOM_MS = 42;

/**
 * In 1-on-1 recovery, a peer can get stuck chasing a target it never meaningfully rebuilds.
 * Clamp the ceiling toward a reserve the receiver has shown it can actually hold.
 */
export function computeFeasibleSingleRemoteRecoveryTargetMaxMs(input: {
  currentAdaptiveMaxTargetMs: number;
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  starvationSeverity: 'none' | 'mild' | 'strong';
  previousStarvationSeverity?: 'none' | 'mild' | 'strong';
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  avgOpusBufferedMs: number;
  observedTargetMs: number;
}): number | null {
  if (
    input.adaptiveNetworkMode !== 'recovery' ||
    Math.max(1, input.activeSourceCount) !== 1
  ) {
    return null;
  }
  if (
    !Number.isFinite(input.currentAdaptiveMaxTargetMs) ||
    input.currentAdaptiveMaxTargetMs <= GCALL_SINGLE_REMOTE_FEASIBILITY_MIN_TARGET_MS
  ) {
    return null;
  }
  if (
    !Number.isFinite(input.avgOpusBufferedMs) ||
    !Number.isFinite(input.playoutUnderTargetFraction) ||
    !Number.isFinite(input.avgPlayoutDeltaMs)
  ) {
    return null;
  }
  const observedTarget = Math.max(
    1,
    Number.isFinite(input.observedTargetMs) ? input.observedTargetMs : 0
  );
  const reserveRatio = input.avgOpusBufferedMs / observedTarget;
  const acuteMismatch =
    input.playoutUnderTargetFraction >=
      GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <=
      GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_DELTA_MAX_MS &&
    reserveRatio < GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_RESERVE_RATIO_MAX;
  const strongCandidate =
    input.starvationSeverity === 'strong' &&
    input.playoutUnderTargetFraction >=
      GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <=
      GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_DELTA_MAX_MS &&
    reserveRatio < GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_RESERVE_RATIO_MAX;
  const heldCandidate =
    input.starvationSeverity !== 'none' &&
    (input.previousStarvationSeverity ?? 'none') !== 'none' &&
    input.playoutUnderTargetFraction >=
      GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <=
      GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_DELTA_MAX_MS &&
    reserveRatio < GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_RESERVE_RATIO_MAX;
  if (!acuteMismatch && !strongCandidate && !heldCandidate) {
    return null;
  }
  const headroomMs = acuteMismatch
    ? GCALL_SINGLE_REMOTE_FEASIBILITY_ACUTE_HEADROOM_MS
    : strongCandidate
      ? GCALL_SINGLE_REMOTE_FEASIBILITY_STRONG_HEADROOM_MS
      : GCALL_SINGLE_REMOTE_FEASIBILITY_HELD_HEADROOM_MS;
  const feasibleMaxMs = Math.max(
    GCALL_SINGLE_REMOTE_FEASIBILITY_MIN_TARGET_MS,
    Math.round(input.avgOpusBufferedMs + headroomMs)
  );
  return Math.min(input.currentAdaptiveMaxTargetMs, feasibleMaxMs);
}

const GCALL_MULTI_SOURCE_FEASIBILITY_MIN_TARGET_MS = 100;
const GCALL_MULTI_SOURCE_FEASIBILITY_RESERVE_RATIO_MAX = 0.6;
const GCALL_MULTI_SOURCE_FEASIBILITY_STRONG_UNDERTARGET_MIN = 0.7;
const GCALL_MULTI_SOURCE_FEASIBILITY_STRONG_DELTA_MAX_MS = -45;
const GCALL_MULTI_SOURCE_FEASIBILITY_MILD_UNDERTARGET_MIN = 0.8;
const GCALL_MULTI_SOURCE_FEASIBILITY_MILD_DELTA_MAX_MS = -55;
const GCALL_MULTI_SOURCE_FEASIBILITY_STRONG_HEADROOM_MS = 40;
const GCALL_MULTI_SOURCE_FEASIBILITY_MILD_HEADROOM_MS = 50;
const GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_UNDERTARGET_MIN = 0.6;
const GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_DELTA_MAX_MS = -35;
const GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_HEADROOM_MS = 32;
const GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_TARGET_RATIO_MAX = 0.82;
const GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_UNDERTARGET_MIN = 0.55;
const GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_DELTA_MAX_MS = -35;
const GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_RESERVE_RATIO_MAX = 0.58;
const GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_HEADROOM_MS = 36;
const GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_TARGET_RATIO_MAX = 0.74;
const GCALL_USABLE_RECOVERY_PCM_MIN_MS = 80;
const GCALL_USABLE_RECOVERY_SINGLE_PCM_MIN_MS = 48;
const GCALL_USABLE_RECOVERY_SINGLE_UNDERTARGET_MIN = 0.4;
const GCALL_USABLE_RECOVERY_MULTI_UNDERTARGET_MIN = 0.45;
const GCALL_USABLE_RECOVERY_SINGLE_DELTA_MAX_MS = -12;
const GCALL_USABLE_RECOVERY_MULTI_DELTA_MAX_MS = -20;
const GCALL_USABLE_RECOVERY_SINGLE_HEADROOM_MS = 18;
const GCALL_USABLE_RECOVERY_SINGLE_HEADROOM_STRONG_MS = 14;
const GCALL_USABLE_RECOVERY_MULTI_HEADROOM_MS = 22;
const GCALL_USABLE_RECOVERY_MULTI_HEADROOM_STRONG_MS = 18;
const GCALL_USABLE_RECOVERY_SINGLE_TARGET_RATIO_MAX = 0.78;
const GCALL_USABLE_RECOVERY_SINGLE_TARGET_RATIO_STRONG_MAX = 0.72;
const GCALL_USABLE_RECOVERY_MULTI_TARGET_RATIO_MAX = 0.82;
const GCALL_USABLE_RECOVERY_MULTI_TARGET_RATIO_STRONG_MAX = 0.78;

/**
 * Clamp multi-source recovery targets back toward an observed reserve the source can
 * realistically hold. This avoids a steady-state where adaptive target remains high
 * while the source sits chronically under target and never rebuilds.
 */
export function computeFeasibleMultiSourceRecoveryTargetMaxMs(input: {
  currentAdaptiveMaxTargetMs: number;
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  starvationSeverity: 'none' | 'mild' | 'strong';
  isolatedSource?: boolean;
  shouldTightenRecovery?: boolean;
  previousStarvationSeverity?: 'none' | 'mild' | 'strong';
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  avgOpusBufferedMs: number;
  observedTargetMs: number;
}): number | null {
  if (
    input.adaptiveNetworkMode !== 'recovery' ||
    Math.max(1, input.activeSourceCount) < 2
  ) {
    return null;
  }
  if (
    !Number.isFinite(input.currentAdaptiveMaxTargetMs) ||
    input.currentAdaptiveMaxTargetMs <= 0
  ) {
    return null;
  }
  if (
    !Number.isFinite(input.avgOpusBufferedMs) ||
    !Number.isFinite(input.playoutUnderTargetFraction) ||
    !Number.isFinite(input.avgPlayoutDeltaMs)
  ) {
    return null;
  }
  const observedTarget = Math.max(
    1,
    Number.isFinite(input.observedTargetMs) ? input.observedTargetMs : 0
  );
  const reserveRatio = input.avgOpusBufferedMs / observedTarget;
  const isolatedCandidate =
    input.isolatedSource === true &&
    input.starvationSeverity !== 'none' &&
    input.playoutUnderTargetFraction >=
      GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <=
      GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_DELTA_MAX_MS &&
    reserveRatio < GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_TARGET_RATIO_MAX;
  const strongCandidate =
    input.starvationSeverity === 'strong' &&
    input.playoutUnderTargetFraction >=
      GCALL_MULTI_SOURCE_FEASIBILITY_STRONG_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <= GCALL_MULTI_SOURCE_FEASIBILITY_STRONG_DELTA_MAX_MS &&
    reserveRatio < GCALL_MULTI_SOURCE_FEASIBILITY_RESERVE_RATIO_MAX;
  const mildHeldCandidate =
    input.starvationSeverity === 'mild' &&
    (input.previousStarvationSeverity ?? 'none') !== 'none' &&
    input.playoutUnderTargetFraction >=
      GCALL_MULTI_SOURCE_FEASIBILITY_MILD_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <= GCALL_MULTI_SOURCE_FEASIBILITY_MILD_DELTA_MAX_MS &&
    reserveRatio < GCALL_MULTI_SOURCE_FEASIBILITY_RESERVE_RATIO_MAX;
  const pressureMismatchCandidate =
    input.shouldTightenRecovery === true &&
    input.playoutUnderTargetFraction >=
      GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_UNDERTARGET_MIN &&
    input.avgPlayoutDeltaMs <=
      GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_DELTA_MAX_MS &&
    reserveRatio < GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_RESERVE_RATIO_MAX;
  if (!strongCandidate && !mildHeldCandidate && !pressureMismatchCandidate) {
    if (!isolatedCandidate) {
      return null;
    }
  }
  const headroomMs = isolatedCandidate
    ? GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_HEADROOM_MS
    : strongCandidate
      ? GCALL_MULTI_SOURCE_FEASIBILITY_STRONG_HEADROOM_MS
      : pressureMismatchCandidate
        ? GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_HEADROOM_MS
      : GCALL_MULTI_SOURCE_FEASIBILITY_MILD_HEADROOM_MS;
  const observedTargetCap =
    isolatedCandidate
      ? Math.round(
          observedTarget * GCALL_MULTI_SOURCE_FEASIBILITY_ISOLATED_TARGET_RATIO_MAX
        )
      : pressureMismatchCandidate
        ? Math.round(
            observedTarget *
              GCALL_MULTI_SOURCE_FEASIBILITY_PRESSURE_TARGET_RATIO_MAX
          )
    : input.currentAdaptiveMaxTargetMs;
  const feasibleMaxMs = Math.max(
    GCALL_MULTI_SOURCE_FEASIBILITY_MIN_TARGET_MS,
    Math.min(
      observedTargetCap,
      Math.round(input.avgOpusBufferedMs + headroomMs)
    )
  );
  return Math.min(input.currentAdaptiveMaxTargetMs, feasibleMaxMs);
}

/**
 * Once recovery has already built a usable PCM reserve, continuing to target a much higher
 * ceiling produces chronic slowed playout and audible roughness. Clamp the target closer to
 * what the receiver is actually sustaining so the worklet can sound stable instead of forever
 * chasing an elevated reserve.
 */
export function computeUsableRecoveryTargetMaxMs(input: {
  currentAdaptiveMaxTargetMs: number;
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  starvationSeverity: 'none' | 'mild' | 'strong';
  isolatedSource?: boolean;
  recentSampleCount: number;
  recentAvgPcmBufferedMs: number;
  recentPlayoutUnderTargetFraction: number;
  previousWindowAvgPlayoutDeltaMs: number;
}): number | null {
  if (
    input.adaptiveNetworkMode !== 'recovery' ||
    input.currentAdaptiveMaxTargetMs <= GCALL_MULTI_SOURCE_FEASIBILITY_MIN_TARGET_MS ||
    input.recentSampleCount < 2 ||
    !Number.isFinite(input.recentAvgPcmBufferedMs) ||
    !Number.isFinite(input.recentPlayoutUnderTargetFraction) ||
    !Number.isFinite(input.previousWindowAvgPlayoutDeltaMs)
  ) {
    return null;
  }

  if (Math.max(1, input.activeSourceCount) === 1) {
    if (input.recentAvgPcmBufferedMs < GCALL_USABLE_RECOVERY_SINGLE_PCM_MIN_MS) {
      return null;
    }
    if (
      input.recentPlayoutUnderTargetFraction <
        GCALL_USABLE_RECOVERY_SINGLE_UNDERTARGET_MIN ||
      input.previousWindowAvgPlayoutDeltaMs >
        GCALL_USABLE_RECOVERY_SINGLE_DELTA_MAX_MS
    ) {
      return null;
    }
    const strongMismatch =
      input.starvationSeverity === 'strong' ||
      input.recentPlayoutUnderTargetFraction >= 0.6 ||
      input.previousWindowAvgPlayoutDeltaMs <= -40;
    const headroomMs = strongMismatch
      ? GCALL_USABLE_RECOVERY_SINGLE_HEADROOM_STRONG_MS
      : GCALL_USABLE_RECOVERY_SINGLE_HEADROOM_MS;
    const targetRatioCap = Math.round(
      input.currentAdaptiveMaxTargetMs *
        (strongMismatch
          ? GCALL_USABLE_RECOVERY_SINGLE_TARGET_RATIO_STRONG_MAX
          : GCALL_USABLE_RECOVERY_SINGLE_TARGET_RATIO_MAX)
    );
    return Math.min(
      input.currentAdaptiveMaxTargetMs,
      Math.max(
        GCALL_MULTI_SOURCE_FEASIBILITY_MIN_TARGET_MS,
        Math.min(
          targetRatioCap,
          Math.round(input.recentAvgPcmBufferedMs + headroomMs)
        )
      )
    );
  }

  if (
    input.recentAvgPcmBufferedMs < GCALL_USABLE_RECOVERY_PCM_MIN_MS ||
    input.starvationSeverity === 'none' &&
    input.isolatedSource !== true
  ) {
    return null;
  }
  if (
    input.recentPlayoutUnderTargetFraction <
      GCALL_USABLE_RECOVERY_MULTI_UNDERTARGET_MIN ||
    input.previousWindowAvgPlayoutDeltaMs >
      GCALL_USABLE_RECOVERY_MULTI_DELTA_MAX_MS
  ) {
    return null;
  }
  const strongMismatch =
    input.starvationSeverity === 'strong' ||
    input.isolatedSource === true ||
    input.recentPlayoutUnderTargetFraction >= 0.65 ||
    input.previousWindowAvgPlayoutDeltaMs <= -35;
  const headroomMs = strongMismatch
    ? GCALL_USABLE_RECOVERY_MULTI_HEADROOM_STRONG_MS
    : GCALL_USABLE_RECOVERY_MULTI_HEADROOM_MS;
  const targetRatioCap = Math.round(
    input.currentAdaptiveMaxTargetMs *
      (strongMismatch
        ? GCALL_USABLE_RECOVERY_MULTI_TARGET_RATIO_STRONG_MAX
        : GCALL_USABLE_RECOVERY_MULTI_TARGET_RATIO_MAX)
  );
  return Math.min(
    input.currentAdaptiveMaxTargetMs,
    Math.max(
      GCALL_MULTI_SOURCE_FEASIBILITY_MIN_TARGET_MS,
      Math.min(
        targetRatioCap,
        Math.round(input.recentAvgPcmBufferedMs + headroomMs)
      )
    )
  );
}

/**
 * Effective ceiling for adaptive playout max target: profile cap, global cap, and
 * diminishing margin vs participant count.
 */
export function effectivePlayoutMaxTargetMs(input: {
  profileAdaptiveMaxMs: number;
  profileAdaptiveSevereMaxMs: number;
  useSevereCeiling: boolean;
  activeSourceCount: number;
  /**
   * When the worst isolated source is also the active speaker, use a ceiling between
   * profile max and severe instead of full severe (product: do not nuke speech).
   */
  isolationCeilingSoftened?: boolean;
  /**
   * Combined dynamic ceiling lift (ms): caller should pass `max(starvationLift, microWidenLift)`,
   * not the sum of both.
   */
  dynamicCeilingLiftMs?: number;
}): number {
  const lift = input.dynamicCeilingLiftMs ?? 0;
  const base = input.useSevereCeiling
    ? input.isolationCeilingSoftened
      ? input.profileAdaptiveMaxMs +
        0.5 *
          (input.profileAdaptiveSevereMaxMs - input.profileAdaptiveMaxMs)
      : input.profileAdaptiveSevereMaxMs
    : input.profileAdaptiveMaxMs;
  const extra = diminishingPlayoutExtraMs(input.activeSourceCount);
  return Math.min(base + lift, GCALL_GLOBAL_PLAYOUT_CAP_MS + extra + lift);
}

export interface WorstIsolationHysteresisState {
  committedAddr: string | null;
  pendingAddr: string | null;
  pendingSinceMs: number;
}

const DEFAULT_WORST_ISOLATION_HOLD_MS = 1_500;

export function createWorstIsolationHysteresisState(): WorstIsolationHysteresisState {
  return {
    committedAddr: null,
    pendingAddr: null,
    pendingSinceMs: 0,
  };
}

/**
 * Single-worst-peer isolation: follow `worstSourceAddr` from the last window with
 * hysteresis so the isolated peer does not flap every tick.
 */
export function stepWorstIsolationHysteresis(
  state: WorstIsolationHysteresisState,
  candidateWorstSourceAddr: string | null,
  nowMs: number,
  holdMs = DEFAULT_WORST_ISOLATION_HOLD_MS
): WorstIsolationHysteresisState {
  if (candidateWorstSourceAddr === null) {
    return createWorstIsolationHysteresisState();
  }
  if (candidateWorstSourceAddr !== state.pendingAddr) {
    return {
      ...state,
      pendingAddr: candidateWorstSourceAddr,
      pendingSinceMs: nowMs,
    };
  }
  if (nowMs - state.pendingSinceMs >= holdMs) {
    return {
      committedAddr: candidateWorstSourceAddr,
      pendingAddr: candidateWorstSourceAddr,
      pendingSinceMs: state.pendingSinceMs,
    };
  }
  return state;
}

export function pickSecondIsolationCandidate(
  sources: readonly GroupCallSourceWindowMetrics[],
  primary: string | null
): string | null {
  if (!primary || sources.length < 2) return null;
  const sorted = [...sources].sort((a, b) => {
    const aObservedTarget = Math.max(1, a.adaptiveTargetMedianMs || a.adaptiveTargetMaxMs || 1);
    const bObservedTarget = Math.max(1, b.adaptiveTargetMedianMs || b.adaptiveTargetMaxMs || 1);
    const aReserveRatio = a.avgOpusBufferedMs / aObservedTarget;
    const bReserveRatio = b.avgOpusBufferedMs / bObservedTarget;
    const aBadness =
      (a.playoutUnderTargetFraction ?? 0) * 4 +
      (a.playoutOutsideTargetFraction ?? 0) * 2 +
      Math.max(0, -(a.avgPlayoutDeltaMs ?? 0)) / 80 +
      (1 - Math.min(1, aReserveRatio));
    const bBadness =
      (b.playoutUnderTargetFraction ?? 0) * 4 +
      (b.playoutOutsideTargetFraction ?? 0) * 2 +
      Math.max(0, -(b.avgPlayoutDeltaMs ?? 0)) / 80 +
      (1 - Math.min(1, bReserveRatio));
    if (aBadness !== bBadness) return bBadness - aBadness;
    return b.adaptiveTargetMaxMs - a.adaptiveTargetMaxMs;
  });
  const second = sorted.find((s) => s.sourceAddr !== primary);
  if (!second || second.adaptiveTargetMaxMs <= 0) return null;
  const top = sorted[0];
  if (!top || top.sourceAddr !== primary) return null;
  const secondObservedTarget = Math.max(
    1,
    second.adaptiveTargetMedianMs || second.adaptiveTargetMaxMs || 1
  );
  const secondReserveRatio = second.avgOpusBufferedMs / secondObservedTarget;
  const secondClearlyDegraded =
    (second.playoutUnderTargetFraction ?? 0) >= 0.6 ||
    (second.avgPlayoutDeltaMs ?? 0) <= -45 ||
    secondReserveRatio < 0.55;
  if (!secondClearlyDegraded) return null;
  if (second.adaptiveTargetMaxMs < top.adaptiveTargetMaxMs - 45) return null;
  return second.sourceAddr;
}
