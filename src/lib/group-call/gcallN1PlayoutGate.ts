/**
 * Single-remote (N===1) recovery playout gating: preroll min-ms, buffer-vs-target tier,
 * and helpers shared with tests. See 2-way jitter playout plan.
 */

/** Initial stall escape: no ingress this long → allow one minimal decode (ms). */
export const GCALL_N1_STALL_ESCAPE_MS = 300;

/** Min start buffer before "preroll satisfied" (ms), lower bound of clamp — below low-latency adaptive max (120). */
export const GCALL_N1_MIN_START_MS_FLOOR = 100;

/** Upper clamp for min-start ms (align with max severe across profiles). */
export const GCALL_N1_MIN_START_MS_CEIL = 185;

/** Micro-accumulation after refill when preroll already satisfied (ms). */
export const GCALL_N1_ACCUMULATION_MS = 75;

/** Short refill accumulation outside recovery so 2-way steady state does not collapse back to 1 frame. */
export const GCALL_N1_STEADY_ACCUMULATION_MS = 40;

/** Denominator floor for r = bufferMs / max(target, floor) — matches adaptive min order. */
export const GCALL_N1_MIN_TARGET_MS_FLOOR = 100;

/** Small steady-state reserve for exact-1-remote calls after recovery exits. */
export const GCALL_N1_STEADY_MIN_HOLD_MS_FLOOR = 20;
export const GCALL_N1_STEADY_MIN_HOLD_MS_CEIL = 40;

/** Tier A: deep deficit — very aggressive throttle (typically 1 decode/tick max). */
export const GCALL_N1_RATIO_DEEP = 0.3;
export const GCALL_N1_RATIO_DEEP_ENTER = 0.28;
export const GCALL_N1_RATIO_DEEP_EXIT = 0.34;
export const GCALL_N1_RATIO_DEEP_ENTER_STEADY = 0.22;
export const GCALL_N1_RATIO_DEEP_EXIT_STEADY = 0.28;

/** Tier B: moderate throttle upper edge (below this band = moderate; above = normal burst). */
export const GCALL_N1_RATIO_MODERATE = 0.48;
export const GCALL_N1_RATIO_MODERATE_ENTER = 0.46;
export const GCALL_N1_RATIO_MODERATE_EXIT = 0.52;
export const GCALL_N1_RATIO_MODERATE_ENTER_STEADY = 0.38;
export const GCALL_N1_RATIO_MODERATE_EXIT_STEADY = 0.44;

/** Throttle [GCall] bufferEnforceActive diagnostics (ms per source). */
export const GCALL_N1_BUFFER_ENFORCE_LOG_MIN_MS = 2000;

export type GcallN1BufferEnforceTier = 'deep' | 'moderate' | 'normal';

export function computeN1MinStartMs(smoothedTargetMs: number): number {
  const t = Number.isFinite(smoothedTargetMs) ? smoothedTargetMs : GCALL_N1_MIN_TARGET_MS_FLOOR;
  return Math.max(
    GCALL_N1_MIN_START_MS_FLOOR,
    Math.min(t, GCALL_N1_MIN_START_MS_CEIL)
  );
}

export function computeN1SteadyMinHoldMs(smoothedTargetMs: number): number {
  const t = Math.max(
    Number.isFinite(smoothedTargetMs)
      ? smoothedTargetMs
      : GCALL_N1_MIN_TARGET_MS_FLOOR,
    GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  return Math.max(
    GCALL_N1_STEADY_MIN_HOLD_MS_FLOOR,
    Math.min(GCALL_N1_STEADY_MIN_HOLD_MS_CEIL, Math.round(t * 0.3))
  );
}

export function computeN1BufferRatio(
  opusBufferedMs: number,
  smoothedTargetMs: number
): { ratio: number; denomMs: number } {
  const denomMs = Math.max(
    Number.isFinite(smoothedTargetMs) ? smoothedTargetMs : GCALL_N1_MIN_TARGET_MS_FLOOR,
    GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  const ratio =
    denomMs > 0 ? opusBufferedMs / denomMs : opusBufferedMs > 0 ? 1 : 0;
  return { ratio, denomMs };
}

export function computeN1BufferEnforceTier(
  ratio: number
): GcallN1BufferEnforceTier {
  if (ratio < GCALL_N1_RATIO_DEEP) return 'deep';
  if (ratio <= GCALL_N1_RATIO_MODERATE) return 'moderate';
  return 'normal';
}

export function stepN1BufferEnforceTier(
  previousTier: GcallN1BufferEnforceTier | null,
  ratio: number
): GcallN1BufferEnforceTier {
  if (previousTier === 'deep') {
    if (ratio <= GCALL_N1_RATIO_DEEP_EXIT) return 'deep';
    return ratio < GCALL_N1_RATIO_MODERATE_EXIT ? 'moderate' : 'normal';
  }
  if (previousTier === 'moderate') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER) return 'deep';
    if (ratio <= GCALL_N1_RATIO_MODERATE_EXIT) return 'moderate';
    return 'normal';
  }
  if (previousTier === 'normal') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER) return 'deep';
    if (ratio < GCALL_N1_RATIO_MODERATE_ENTER) return 'moderate';
    return 'normal';
  }
  return computeN1BufferEnforceTier(ratio);
}

export function stepN1SteadyBufferEnforceTier(
  previousTier: GcallN1BufferEnforceTier | null,
  ratio: number
): GcallN1BufferEnforceTier {
  if (previousTier === 'deep') {
    if (ratio <= GCALL_N1_RATIO_DEEP_EXIT_STEADY) return 'deep';
    return ratio < GCALL_N1_RATIO_MODERATE_EXIT_STEADY ? 'moderate' : 'normal';
  }
  if (previousTier === 'moderate') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER_STEADY) return 'deep';
    if (ratio <= GCALL_N1_RATIO_MODERATE_EXIT_STEADY) return 'moderate';
    return 'normal';
  }
  if (previousTier === 'normal') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER_STEADY) return 'deep';
    if (ratio < GCALL_N1_RATIO_MODERATE_ENTER_STEADY) return 'moderate';
    return 'normal';
  }
  return computeN1BufferEnforceTier(ratio);
}

export interface ComputeN1TierBurstCapOpts {
  /** When true, allow extra decodes/tick in deep tier under recovery (main-thread stalls starve buffer). */
  recoverySingleRemote?: boolean;
}

/**
 * Effective scaled burst cap for N===1 tier (upper bound; caller still clamps in loop).
 */
export function computeN1TierBurstCap(
  tier: GcallN1BufferEnforceTier,
  scaledBurstCap: number,
  opts?: ComputeN1TierBurstCapOpts
): number {
  if (tier === 'deep') {
    return opts?.recoverySingleRemote ? 4 : 1;
  }
  if (tier === 'moderate') return Math.min(6, scaledBurstCap);
  return scaledBurstCap;
}

export function computeN1SteadyTierBurstCap(
  tier: GcallN1BufferEnforceTier,
  scaledBurstCap: number
): number {
  if (tier === 'deep') return Math.min(2, scaledBurstCap);
  if (tier === 'moderate') return Math.min(4, scaledBurstCap);
  return Math.min(6, scaledBurstCap);
}
