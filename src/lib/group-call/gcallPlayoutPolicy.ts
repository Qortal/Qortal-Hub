import type { GroupCallSourceWindowMetrics } from './router';

/** Hard ceiling on playout target growth for multi-party calls (ms). */
export const GCALL_GLOBAL_PLAYOUT_CAP_MS = 150;

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
  /** Mode 2 playout starvation: extra headroom (ms), applied before global cap. */
  starvationCeilingLiftMs?: number;
}): number {
  const lift = input.starvationCeilingLiftMs ?? 0;
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
  const sorted = [...sources].sort(
    (a, b) => b.adaptiveTargetMaxMs - a.adaptiveTargetMaxMs
  );
  const second = sorted.find((s) => s.sourceAddr !== primary);
  if (!second || second.adaptiveTargetMaxMs <= 0) return null;
  const top = sorted[0];
  if (!top || top.sourceAddr !== primary) return null;
  if (second.adaptiveTargetMaxMs < top.adaptiveTargetMaxMs - 45) return null;
  return second.sourceAddr;
}
