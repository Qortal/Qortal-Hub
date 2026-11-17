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
  /**
   * Initial additive hold while a decrypt-burst recovery window is still
   * active (e.g. source appeared mid-burst right after key sync / topology).
   * Pass 0 when no window is armed.
   */
  burstRecoveryExtraHoldFrames?: number;
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
  const burstHold = Math.max(0, opts.burstRecoveryExtraHoldFrames ?? 0);
  if (burstHold > 0) {
    jb.setBurstRecoveryExtraHoldFrames(burstHold);
  }
  return jb;
}
