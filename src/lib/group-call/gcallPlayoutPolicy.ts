import type { GroupCallSourceWindowMetrics } from './router';

/** Hard ceiling on playout target growth for multi-party calls (ms). */
export const GCALL_GLOBAL_PLAYOUT_CAP_MS = 150;

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
}): number {
  const base = input.useSevereCeiling
    ? input.profileAdaptiveSevereMaxMs
    : input.profileAdaptiveMaxMs;
  const extra = diminishingPlayoutExtraMs(input.activeSourceCount);
  return Math.min(base, GCALL_GLOBAL_PLAYOUT_CAP_MS + extra);
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
