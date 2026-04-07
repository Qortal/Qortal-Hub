/**
 * Phase D: multi-source jitter drain fairness — pure helpers (unit-tested).
 * See multi-source jitter fairness plan (per-source cap f(N), global ceiling, ordering).
 */

/**
 * Hard ceiling on total Opus decodes per ~20ms drain tick (tunable in field).
 * Bump only after D3 + starvation protection are validated in the field; gate on
 * per-source spread / worst-source underruns (fairness), not aggregate not-ready alone.
 */
export const MAX_GLOBAL_DECODES_PER_TICK = 16;

/** SLA: max consecutive drain ticks in starvation without recovery-bar satisfaction (~100ms @ 20ms/tick). */
export const GCALL_JITTER_STARVATION_MAX_TICKS_WITHOUT_PROTECTED_SERVICE = 5;
/** Recovery bar: minimum jitter depth (frames) before SLA may reset. */
export const GCALL_JITTER_STARVATION_RECOVERY_DEPTH_F_MIN = 3;
/** Recovery bar (2a): opus buffer must improve by this many ms vs trough over last M ticks. */
export const GCALL_JITTER_STARVATION_RECOVERY_IMPROVE_DELTA_MS = 20;
/** Recovery bar: lookback window length (drain ticks) for trough min. */
export const GCALL_JITTER_STARVATION_RECOVERY_TRACE_TICKS = 3;
/** Recovery bar (2b): fraction of adaptive target median (ms). */
export const GCALL_JITTER_STARVATION_RECOVERY_BETA_TARGET = 0.35;
/** Earlier warning band: protect thin sources before full collapse during multi-source recovery. */
export const GCALL_JITTER_STARVATION_NEAR_COLLAPSE_BETA_TARGET = 0.5;
/** De-escalation: consecutive ticks at/above depth floor before exiting protected scheduling. */
export const GCALL_JITTER_STARVATION_PROTECTED_EXIT_CONSEC_TICKS = 3;

/**
 * Protected decode budget per tick: at most half of global decode budget, never more than 8.
 * Scales when globalBudget or MAX_GLOBAL_DECODES_PER_TICK changes.
 */
export function computeProtectedDecodeCap(globalBudget: number): number {
  const g = Math.max(1, Math.floor(globalBudget));
  return Math.min(8, Math.ceil(g * 0.5));
}

/**
 * When multiple sources are simultaneously near SLA breach, allow extra combined protected
 * headroom while staying bounded by global budget.
 */
export function computeProtectedDecodeCapForBreach(
  globalBudget: number,
  slaNearBreachCount: number
): number {
  const base = computeProtectedDecodeCap(globalBudget);
  if (slaNearBreachCount <= 1) return base;
  const g = Math.max(1, Math.floor(globalBudget));
  const extra = (slaNearBreachCount - 1) * 2;
  return Math.min(g, base + extra);
}

export function starvationRecoveryBarSatisfied(input: {
  bufferedFrames: number;
  opusBufferedMs: number;
  minOpusLastMTicks: number;
  adaptiveTargetMedianMs: number;
  playoutStarvationSeverity?: 'none' | 'mild' | 'strong';
}): boolean {
  if (input.playoutStarvationSeverity === 'strong') {
    return false;
  }
  if (input.bufferedFrames < GCALL_JITTER_STARVATION_RECOVERY_DEPTH_F_MIN) {
    return false;
  }
  const improveA =
    input.opusBufferedMs >=
    input.minOpusLastMTicks + GCALL_JITTER_STARVATION_RECOVERY_IMPROVE_DELTA_MS;
  const improveB =
    input.opusBufferedMs >=
    input.adaptiveTargetMedianMs * GCALL_JITTER_STARVATION_RECOVERY_BETA_TARGET;
  return improveA || improveB;
}

/** Collapsed vs adaptive target — needs protected scheduling when true (recovery multi-source). */
export function isCollapsedForStarvation(input: {
  bufferedFrames: number;
  opusBufferedMs: number;
  adaptiveTargetMedianMs: number;
}): boolean {
  return (
    input.bufferedFrames < GCALL_JITTER_STARVATION_RECOVERY_DEPTH_F_MIN ||
    input.opusBufferedMs <
      input.adaptiveTargetMedianMs * GCALL_JITTER_STARVATION_RECOVERY_BETA_TARGET
  );
}

export function isNearCollapsedForStarvation(input: {
  bufferedFrames: number;
  opusBufferedMs: number;
  adaptiveTargetMedianMs: number;
}): boolean {
  return (
    input.bufferedFrames <= GCALL_JITTER_STARVATION_RECOVERY_DEPTH_F_MIN + 1 ||
    input.opusBufferedMs <
      input.adaptiveTargetMedianMs *
        GCALL_JITTER_STARVATION_NEAR_COLLAPSE_BETA_TARGET
  );
}

/**
 * Multi-source recovery can be playout-starved even when Opus reserve still looks healthy.
 * Promote sources with proven strong starvation into protected scheduling before the buffer
 * fully collapses so they can recover PCM/playout deadlines sooner.
 */
export function shouldEnterProtectedMode(input: {
  collapsed: boolean;
  nearCollapsed?: boolean;
  starvationSeverity: 'none' | 'mild' | 'strong';
}): boolean {
  return (
    input.collapsed ||
    input.starvationSeverity === 'strong' ||
    (input.nearCollapsed === true && input.starvationSeverity === 'mild')
  );
}

export function shouldExitProtectedMode(input: {
  bufferedFrames: number;
  recoveryBarSatisfied: boolean;
  playoutStarvationSeverity: 'none' | 'mild' | 'strong';
}): boolean {
  return (
    input.recoveryBarSatisfied &&
    input.bufferedFrames >= GCALL_JITTER_STARVATION_RECOVERY_DEPTH_F_MIN &&
    input.playoutStarvationSeverity === 'none'
  );
}

export function computePhaseDSourceBurstBonus(input: {
  initialBufferedFrames: number;
  thinBufferThresholdFrames: number;
  protectedMode: boolean;
  starvationSeverity: 'none' | 'mild' | 'strong';
}): number {
  if (input.initialBufferedFrames > input.thinBufferThresholdFrames) {
    return 0;
  }
  if (input.protectedMode || input.starvationSeverity === 'strong') {
    return 2;
  }
  return 1;
}

export function computePerSourceCap(scaledBurstCap: number, n: number): number {
  const N = Math.max(1, n);
  return Math.min(
    scaledBurstCap,
    Math.max(2, Math.ceil(scaledBurstCap / N))
  );
}

export function computeGlobalDecodeBudget(
  n: number,
  perSourceCap: number,
  maxGlobal = MAX_GLOBAL_DECODES_PER_TICK
): number {
  const N = Math.max(1, n);
  return Math.min(N * perSourceCap, maxGlobal);
}

export interface JitterDrainJbProbe {
  getBufferedFrames(): number;
  hasReadyFrame(): boolean;
}

/**
 * D2 ordering when N >= 2: empty buffer first, then unprimed (frames but !ready),
 * then ready sources by underrun EMA desc, then thinnest buffer.
 * Rotation within each bucket so no fixed last peer.
 */
export function computeOrderedDrainAddresses(
  activeAddrs: readonly string[],
  getJb: (addr: string) => JitterDrainJbProbe | undefined,
  underrunEma: ReadonlyMap<string, number>,
  rotationTick: number
): string[] {
  const bucket0: string[] = [];
  const bucket1: string[] = [];
  const bucket2: string[] = [];

  for (const addr of activeAddrs) {
    const jb = getJb(addr);
    if (!jb) continue;
    const frames = jb.getBufferedFrames();
    if (frames === 0) {
      bucket0.push(addr);
    } else if (!jb.hasReadyFrame()) {
      bucket1.push(addr);
    } else {
      bucket2.push(addr);
    }
  }

  const rotate = <T>(arr: T[], tick: number): T[] => {
    if (arr.length === 0) return arr;
    const start = tick % arr.length;
    return [...arr.slice(start), ...arr.slice(0, start)];
  };

  bucket2.sort((a, b) => {
    const emaA = underrunEma.get(a) ?? 0;
    const emaB = underrunEma.get(b) ?? 0;
    if (emaB !== emaA) return emaB - emaA;
    const fa = getJb(a)!.getBufferedFrames();
    const fb = getJb(b)!.getBufferedFrames();
    return fa - fb;
  });

  return [
    ...rotate(bucket0, rotationTick),
    ...rotate(bucket1, rotationTick + 1),
    ...rotate(bucket2, rotationTick + 2),
  ];
}
