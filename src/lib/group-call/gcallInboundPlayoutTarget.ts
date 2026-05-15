/**
 * Initial `group-playout-processor` target for sources without the full adaptive metrics loop
 * (e.g. DM). Uses the same profile caps as group `tickAdaptivePlayoutTargets` baselines.
 */

import type { GroupCallAudioTuning } from './groupCallAudioProfile';
import { GCALL_GLOBAL_PLAYOUT_CAP_MS } from './gcallPlayoutPolicy';

/** Clean low-latency steady state should not keep a recovery-sized reserve. */
const STATIC_PLAYOUT_BASE_LOW_LATENCY_MS = 96;
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
