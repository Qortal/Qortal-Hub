/**
 * Pure functions for {@link DecryptWorkerPool} scaling decisions.
 *
 * Kept separate from `decryptWorkerPool.ts` so the rules (grow/shrink thresholds, hold
 * windows, hardware caps) can be unit-tested without spawning any Web Workers and
 * wired into the metrics tick in `useGroupVoiceCall.ts` as a cheap, stateless call.
 *
 * Tuning anchors (tied to existing pending-decrypt limits so "the pool grows exactly
 * where the queue would otherwise start shedding"):
 *   - `PENDING_DECRYPT_BURST_NOMINAL_BASE / 2` → justifies moving to 3 slots
 *   - `PENDING_DECRYPT_NEWEST_FIRST_DEPTH`     → justifies moving to 4 slots
 *   - 30 s cooldown before any shrink → audio quality is cheaper than ms of extra CPU
 */

import {
  PENDING_DECRYPT_BURST_NOMINAL_BASE,
  PENDING_DECRYPT_NEWEST_FIRST_DEPTH,
} from './pendingDecryptLimits';

export const DECRYPT_POOL_MIN_SIZE = 2;
export const DECRYPT_POOL_HARD_CEILING = 4;

/** Sustained window to trust the growth signal (burst-spikes alone should not grow the pool). */
export const DECRYPT_POOL_GROW_SUSTAINED_MS = 2000;
/** Hold time before any shrink attempt; prevents oscillation during intermittent speakers. */
export const DECRYPT_POOL_SHRINK_DWELL_MS = 30_000;
/** Upper bound for "low-pressure depth" when considering shrink. */
export const DECRYPT_POOL_LOW_DEPTH_MAX = 32;

export const DECRYPT_POOL_GROW_TO_3_DEPTH_THRESHOLD = Math.floor(
  PENDING_DECRYPT_BURST_NOMINAL_BASE / 2
);
export const DECRYPT_POOL_GROW_TO_4_DEPTH_THRESHOLD =
  PENDING_DECRYPT_NEWEST_FIRST_DEPTH;

export const DECRYPT_POOL_GROW_TO_3_SOURCES = 3;
export const DECRYPT_POOL_GROW_TO_4_SOURCES = 5;

export interface DecryptPoolScalingInput {
  currentSize: number;
  /** Rolling peak pending-decrypt depth over a short window (e.g. 2 s) across the full pool. */
  peakDepthRecent: number;
  /** Wall-time ms the depth signal has been at/above the "grow" threshold. */
  sustainedAboveGrow3Ms: number;
  sustainedAboveGrow4Ms: number;
  /** Wall-time ms the pool has been idle (peakDepthRecent < LOW_DEPTH_MAX) AND source count is calm. */
  sustainedLowPressureMs: number;
  /** Whether a decryptBurstRecoveryWindow is currently armed. Grow aggressively; never shrink. */
  burstWindowActive: boolean;
  /** Number of active audio sources (distinct senders currently feeding jitter buffers). */
  activeSourceCount: number;
  /** Hardware hint used as upper cap. Pass `navigator.hardwareConcurrency` (fall back to 4 in tests). */
  cpuCoreHint: number;
}

export interface DecryptPoolScalingDecision {
  desiredSize: number;
  reason:
    | 'initial'
    | 'grow-sources-3'
    | 'grow-sources-4'
    | 'grow-depth-3'
    | 'grow-depth-4'
    | 'grow-burst-window'
    | 'shrink-low-pressure'
    | 'hold';
}

function hardwareCap(cpuCoreHint: number): number {
  const hint = Math.max(
    1,
    Number.isFinite(cpuCoreHint) ? Math.floor(cpuCoreHint) : 2
  );
  return Math.max(
    DECRYPT_POOL_MIN_SIZE,
    Math.min(DECRYPT_POOL_HARD_CEILING, hint - 1)
  );
}

export function computeDesiredPoolSize(
  input: DecryptPoolScalingInput
): DecryptPoolScalingDecision {
  const hwCap = hardwareCap(input.cpuCoreHint);
  const current = Math.max(1, Math.floor(input.currentSize));

  // Stable-hash routing sends every packet from a given ingress peer to the same slot.
  // With fewer than 2 active sources, extra slots sit idle and provide zero latency
  // benefit — growing only costs a Worker + WASM init + ~180 KB libsodium payload per
  // extra slot. Gate every growth signal on at least 2 distinct sources so 1:1 calls
  // stay at `DECRYPT_POOL_MIN_SIZE` and do not flap. (Observed in Kenny+Phil 1:1 logs:
  // 25-39 redundant `grow-burst-window` scale events during one call with activeSources=1.)
  const multiSourceGrowEligible = input.activeSourceCount >= 2;

  // Growth signals — take the strongest match.
  if (input.burstWindowActive && current < hwCap && multiSourceGrowEligible) {
    return {
      desiredSize: Math.min(hwCap, Math.max(current, DECRYPT_POOL_MIN_SIZE + 1)),
      reason: 'grow-burst-window',
    };
  }

  if (
    current < 4 &&
    hwCap >= 4 &&
    multiSourceGrowEligible &&
    (input.activeSourceCount >= DECRYPT_POOL_GROW_TO_4_SOURCES ||
      (input.peakDepthRecent >=
        DECRYPT_POOL_GROW_TO_4_DEPTH_THRESHOLD &&
        input.sustainedAboveGrow4Ms >= DECRYPT_POOL_GROW_SUSTAINED_MS))
  ) {
    const reason =
      input.activeSourceCount >= DECRYPT_POOL_GROW_TO_4_SOURCES
        ? 'grow-sources-4'
        : 'grow-depth-4';
    return { desiredSize: Math.min(hwCap, 4), reason };
  }

  if (
    current < 3 &&
    hwCap >= 3 &&
    multiSourceGrowEligible &&
    (input.activeSourceCount >= DECRYPT_POOL_GROW_TO_3_SOURCES ||
      (input.peakDepthRecent >=
        DECRYPT_POOL_GROW_TO_3_DEPTH_THRESHOLD &&
        input.sustainedAboveGrow3Ms >= DECRYPT_POOL_GROW_SUSTAINED_MS))
  ) {
    const reason =
      input.activeSourceCount >= DECRYPT_POOL_GROW_TO_3_SOURCES
        ? 'grow-sources-3'
        : 'grow-depth-3';
    return { desiredSize: Math.min(hwCap, 3), reason };
  }

  // Shrink only after an extended low-pressure window.
  if (
    !input.burstWindowActive &&
    current > DECRYPT_POOL_MIN_SIZE &&
    input.activeSourceCount <= current - 1 &&
    input.peakDepthRecent < DECRYPT_POOL_LOW_DEPTH_MAX &&
    input.sustainedLowPressureMs >= DECRYPT_POOL_SHRINK_DWELL_MS
  ) {
    return {
      desiredSize: Math.max(DECRYPT_POOL_MIN_SIZE, current - 1),
      reason: 'shrink-low-pressure',
    };
  }

  return { desiredSize: current, reason: 'hold' };
}
