/**
 * Shared jitter buffer construction for group voice and DM Reticulum voice ingress.
 * Keeps profile tuning, recovery geometry, WASM FEC extra hold, and soft-unprime aligned.
 */

import { JitterBuffer } from './gcallJitterBuffer';
import {
  computeSoftUnprimeMsForTier2,
  getEffectiveJitterTuning,
  type GroupCallAudioTuning,
} from './groupCallAudioProfile';

export type GcallInboundAdaptiveNetworkMode = 'low-latency' | 'recovery';

export function createGcallJitterBufferForIngress(opts: {
  tuning: GroupCallAudioTuning;
  adaptiveNetworkMode: GcallInboundAdaptiveNetworkMode;
  /** e.g. WASM FEC extra hold in group; 0 for DM WebCodecs-only path. */
  extraHoldFrames: number;
  activeSourceCount: number;
  /** Recovery branch: tier-2 multi-source geometry when N≥2. */
  tier2MultiSource: boolean;
  /**
   * Group defers steady primed hold to the jitter scheduler tick (uses live recovery metrics).
   * DM applies immediately for single-peer low-latency profile.
   */
  applySteadyPrimedHoldNow: boolean;
}): JitterBuffer {
  const mode = opts.adaptiveNetworkMode;
  const effective =
    mode === 'recovery'
      ? getEffectiveJitterTuning(opts.tuning, 'recovery', {
          tier2MultiSource: opts.tier2MultiSource,
          activeSourceCount: opts.activeSourceCount,
        })
      : getEffectiveJitterTuning(opts.tuning, 'low-latency');
  const jb = new JitterBuffer(opts.extraHoldFrames, effective);
  jb.setSoftUnprimeMs(
    computeSoftUnprimeMsForTier2(
      opts.activeSourceCount,
      mode === 'recovery'
    )
  );
  if (opts.applySteadyPrimedHoldNow) {
    const n = Math.max(0, Math.floor(opts.activeSourceCount));
    const inRecovery = mode === 'recovery';
    jb.setSteadyPrimedHoldFrames(!inRecovery && n === 1 ? 1 : 0);
  }
  return jb;
}
