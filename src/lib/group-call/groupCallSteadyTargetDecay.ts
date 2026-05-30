/**
 * Steady playout target decay guard (N===1 low-latency), aligned with
 * `tickAdaptivePlayoutTargets` in the legacy group-call hook and
 * `tickSinglePeerAdaptivePlayoutTarget` for single-peer DM path.
 */
const ADAPTIVE_BASE_TARGET_MS = 100;
/** Scaled with low-latency adaptive max (~120 vs original 180): 220 * 120/180 ≈ 147. */
const GCALL_DECAY_GUARD_HIGH_TARGET_MS = 147;
const GCALL_STEADY_TARGET_DECAY_HEADROOM_MS = 18;

export function computeSteadyTargetDecayThresholdMs(opts: {
  adaptiveMaxTargetMs: number;
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
}): number {
  if (opts.activeSourceCount === 1 && opts.adaptiveNetworkMode !== 'recovery') {
    return Math.min(
      GCALL_DECAY_GUARD_HIGH_TARGET_MS,
      Math.max(
        ADAPTIVE_BASE_TARGET_MS + 20,
        opts.adaptiveMaxTargetMs - GCALL_STEADY_TARGET_DECAY_HEADROOM_MS
      )
    );
  }
  return GCALL_DECAY_GUARD_HIGH_TARGET_MS;
}
