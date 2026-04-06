/**
 * Initial `group-playout-processor` target for sources without the full adaptive metrics loop
 * (e.g. DM). Uses the same profile caps as group `tickAdaptivePlayoutTargets` baselines.
 */

import type { GroupCallAudioTuning } from './groupCallAudioProfile';
import { GCALL_GLOBAL_PLAYOUT_CAP_MS } from './gcallPlayoutPolicy';

/** Group hook uses 100ms baseline; high-stability nudges slightly for underrun headroom. */
const STATIC_PLAYOUT_BASE_LOW_LATENCY_MS = 100;
const STATIC_PLAYOUT_BASE_HIGH_STABILITY_MS = 110;

export function postStaticPlayoutTargetForTuning(
  playNode: AudioWorkletNode,
  tuning: GroupCallAudioTuning
): void {
  const base =
    tuning.profile === 'high-stability'
      ? STATIC_PLAYOUT_BASE_HIGH_STABILITY_MS
      : STATIC_PLAYOUT_BASE_LOW_LATENCY_MS;
  const capped = Math.min(
    Math.max(40, base),
    Math.min(tuning.adaptiveMaxTargetMs, GCALL_GLOBAL_PLAYOUT_CAP_MS)
  );
  playNode.port.postMessage({
    type: 'target',
    targetPlayoutMs: capped,
  });
}
