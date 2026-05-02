/**
 * Initial `group-playout-processor` target for sources without the full adaptive metrics loop
 * (e.g. DM). Uses the same profile caps as group `tickAdaptivePlayoutTargets` baselines.
 */

import type { GroupCallAudioTuning } from './groupCallAudioProfile';
import { GCALL_GLOBAL_PLAYOUT_CAP_MS } from './gcallPlayoutPolicy';

/** Group hook uses a modest low-latency baseline with a little extra headroom for 1:1 steady-state smoothness. */
const STATIC_PLAYOUT_BASE_LOW_LATENCY_MS = 124;
const STATIC_PLAYOUT_BASE_HIGH_STABILITY_MS = 134;

export function computeStaticPlayoutTargetMsForTuning(
  tuning: GroupCallAudioTuning
): number {
  const base =
    tuning.profile === 'high-stability'
      ? STATIC_PLAYOUT_BASE_HIGH_STABILITY_MS
      : STATIC_PLAYOUT_BASE_LOW_LATENCY_MS;
  return Math.min(
    Math.max(40, base),
    Math.min(tuning.adaptiveMaxTargetMs, GCALL_GLOBAL_PLAYOUT_CAP_MS)
  );
}

export function postStaticPlayoutTargetForTuning(
  playNode: AudioWorkletNode,
  tuning: GroupCallAudioTuning
): void {
  const capped = computeStaticPlayoutTargetMsForTuning(tuning);
  playNode.port.postMessage({
    type: 'target',
    targetPlayoutMs: capped,
  });
}
