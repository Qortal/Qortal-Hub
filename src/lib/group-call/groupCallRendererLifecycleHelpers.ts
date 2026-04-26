import type { N1ReceivePrioritySendBitrateCapState } from './groupCallReceivePriorityDecisions';

export function shouldStartGroupCallAudioCapture(opts: {
  pipelineActive: boolean;
  startupInFlight: boolean;
}): boolean {
  return !opts.pipelineActive && !opts.startupInFlight;
}

export function bumpGroupCallAudioSessionToken(token: number): number {
  return token + 1;
}

export function isCurrentGroupCallAudioStartupToken(
  expected: number,
  current: number
): boolean {
  return expected === current;
}

export function clearAdaptiveGroupCallPlayoutMaps(maps: {
  lastPacketArrivalAt: Map<string, number>;
  interArrivalSamples: Map<string, number[]>;
  smoothedPlayoutTarget: Map<string, number>;
  lastSentPlayoutTarget: Map<string, number>;
  lastPlayoutTargetPostAt: Map<string, number>;
  lastDrainMissed: Map<string, number>;
  n1WeakLiveHoldUntilPerf?: Map<string, number>;
  n1SteadyThinLiveSincePerf?: Map<string, number>;
  n1ReceivePrioritySendCapState?: Map<
    string,
    N1ReceivePrioritySendBitrateCapState
  >;
}): void {
  maps.lastPacketArrivalAt.clear();
  maps.interArrivalSamples.clear();
  maps.smoothedPlayoutTarget.clear();
  maps.lastSentPlayoutTarget.clear();
  maps.lastPlayoutTargetPostAt.clear();
  maps.lastDrainMissed.clear();
  maps.n1WeakLiveHoldUntilPerf?.clear();
  maps.n1SteadyThinLiveSincePerf?.clear();
  maps.n1ReceivePrioritySendCapState?.clear();
}
