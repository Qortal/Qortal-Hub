import { describe, expect, it } from 'vitest';
import {
  groupCallLocalConnectionHintFromLevel,
  rawConnectionStressLevel,
} from './groupCallLocalConnectionHint';
import type { GroupCallMetricsSnapshot } from './router';

function baseSnapshot(
  overrides: Partial<GroupCallMetricsSnapshot> = {}
): GroupCallMetricsSnapshot {
  return {
    role: 'participant',
    packetsReceived: 0,
    packetsForwarded: 0,
    packetsDecoded: 0,
    packetsDropped: 0,
    packetsDroppedPendingDecrypt: 0,
    packetsDroppedStaleWorkerDecrypt: 0,
    packetsDroppedStartupGate: 0,
    packetsDroppedDecodeFailure: 0,
    packetsDroppedDecoderThrow: 0,
    relayPacketsSent: 0,
    relayPacketsReceived: 0,
    lastRelayActivityAtMs: 0,
    jitterUnderruns: 0,
    missingFrames: 0,
    concealmentTicks: 0,
    decoderCount: 0,
    playbackNodeCount: 0,
    jitterBufferCount: 0,
    avgIncomingPacketMs: 0,
    maxIncomingPacketMs: 0,
    avgJitterTickMs: 0,
    maxJitterTickMs: 0,
    avgPcmBufferedMs: 0,
    playoutOutsideTargetFraction: 0,
    playoutUnderTargetFraction: 0,
    playoutOverTargetFraction: 0,
    avgPlayoutDeltaMs: 0,
    lastUpdatedAt: 0,
    dcTransportReady: true,
    pcConnectedTransitions: 0,
    pcDisconnectedTransitions: 0,
    pcFailedTransitions: 0,
    pcClosedTransitions: 0,
    dcOpenCount: 0,
    dcCloseCount: 0,
    dcErrorCount: 0,
    iceRestartAttempts: 0,
    iceRestartSuccesses: 0,
    reconnectAttempts: 0,
    persistentDisconnectTeardowns: 0,
    avgRecoveryMs: 0,
    maxRecoveryMs: 0,
    dcBackpressureDrops: 0,
    dcBackoffDrops: 0,
    dcSendErrorDrops: 0,
    relayDwellMs: 0,
    relayDwellFraction: 0,
    adaptiveNetworkMode: 'low-latency',
    relayThrottleDrops: 0,
    relayCoalesceSuperseded: 0,
    relayIpcFailures: 0,
    reticulumAudioPendingFrames: 0,
    reticulumAudioPendingFramesHighWater: 0,
    reticulumAudioBridgeQueuedFrames: 0,
    reticulumAudioBridgeQueuedFramesHighWater: 0,
    reticulumAudioDecodedQueueDepth: 0,
    reticulumAudioDecodedQueueDepthHighWater: 0,
    reticulumAudioBinaryOutQueueDepth: 0,
    reticulumAudioBinaryOutQueueDepthHighWater: 0,
    reticulumAudioBridgeWaitingForDrain: false,
    reticulumAudioQueuePressureDrops: 0,
    reticulumAudioQueuePressureDropsLast5s: 0,
    reticulumAudioStaleDrops: 0,
    reticulumAudioStaleDropsLast5s: 0,
    reticulumAudioLinkUnreadyDrops: 0,
    reticulumAudioPacketSendFailures: 0,
    reticulumAudioPacketPathRequests: 0,
    reticulumAudioPacketPathResolutions: 0,
    reticulumAudioPacketPathTimeouts: 0,
    reticulumAudioPacketFreshSends: 0,
    reticulumAudioPacketStaleSends: 0,
    reticulumAudioPacketUnknownSends: 0,
    mixerActiveSpeakerEstimate: 0,
    mixerMasterGain: 1,
    mixerCurrentReductionDb: 0,
    mixerAvgReductionDb: 0,
    mixerOverloadEvents: 0,
    mixerHeavyReductionFraction: 0,
    wasmFecPlcFrames: 0,
    wasmFecAttempts: 0,
    wasmFecSuccessCoarse: 0,
    wasmFecDeferredPcmTicks: 0,
    clusterFailoverPromotionCount: 0,
    rootFailoverPromotionCount: 0,
    clusterForwarderDemotionCount: 0,
    pendingDecryptDepth: 0,
    pendingDecryptDepthHighWater: 0,
    ...overrides,
  };
}

describe('rawConnectionStressLevel', () => {
  it('returns 0 for healthy snapshot', () => {
    expect(rawConnectionStressLevel(baseSnapshot())).toBe(0);
  });

  it('returns 2 for high relay dwell', () => {
    expect(
      rawConnectionStressLevel(
        baseSnapshot({ relayDwellFraction: 0.25, adaptiveNetworkMode: 'low-latency' })
      )
    ).toBe(2);
  });

  it('returns 2 for recovery with moderate relay', () => {
    expect(
      rawConnectionStressLevel(
        baseSnapshot({ adaptiveNetworkMode: 'recovery', relayDwellFraction: 0.15 })
      )
    ).toBe(2);
  });

  it('returns 1 for recovery alone', () => {
    expect(
      rawConnectionStressLevel(
        baseSnapshot({ adaptiveNetworkMode: 'recovery', relayDwellFraction: 0 })
      )
    ).toBe(1);
  });

  it('returns 1 when dc not ready', () => {
    expect(rawConnectionStressLevel(baseSnapshot({ dcTransportReady: false }))).toBe(1);
  });
});

describe('groupCallLocalConnectionHintFromLevel', () => {
  it('builds warning and severe hints', () => {
    const w = groupCallLocalConnectionHintFromLevel(1);
    expect(w.level).toBe('warning');
    expect(w.headline).toContain('reduced');

    const s = groupCallLocalConnectionHintFromLevel(2);
    expect(s.level).toBe('severe');
    expect(s.headline).toContain('unstable');
  });
});
