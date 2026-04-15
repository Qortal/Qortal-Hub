import { describe, expect, it } from 'vitest';
import {
  bumpGroupCallAudioSessionToken,
  chooseSameEpochTopologyWinner,
  computeJitterReadyThresholdFrames,
  getRecoveryStabilityThresholds,
  countRecentlyHealthyRemoteSources,
  computeN1AccumulationDecodeCap,
  computeEffectiveN1AccumulationDecodeCap,
  computeN1SevereRebuildAccumulationHoldOpusMs,
  computeSteadyTargetDecayThresholdMs,
  clearAdaptiveGroupCallPlayoutMaps,
  getConflictingRootForAuthorityWait,
  hasOccupiedRoomEvidenceForJoin,
  getTrustedRootForRejoinElection,
  getReticulumTransportTargets,
  getPredictiveWarmPeers,
  getSessionUpdatedKeyRecoveryAction,
  getPostJoinHydratedParticipants,
  isFanoutForwarderRole,
  isCurrentGroupCallAudioStartupToken,
  mergeHydratedParticipantsIntoUiList,
  shouldDeferLocalTopologyElection,
  shouldPromoteStandbyRootAfterHeartbeatTimeout,
  shouldAcceptIncomingRoomKeySender,
  shouldAcceptIncomingRoomKeySenderRelaxed,
  shouldAcceptKeyRecoveryRequestGeneration,
  shouldAdoptTrustedRootSessionDuringRecovery,
  shouldApplyJoinSessionSnapshot,
  shouldBypassRecoveryReentryCooldown,
  shouldContinueAfterParticipantJoinRefresh,
  shouldDelayPostJoinRosterElection,
  shouldEscalateRoomWideKeyRecovery,
  shouldAccelerateMultiSourceRecoveryDecay,
  shouldAccelerateSingleRemoteRecoveryDecay,
  computeN1RoughLinkBitrateCapBps,
  computeN1ReceivePrioritySendBitrateCapBps,
  tickN1ReceivePrioritySendBitrateCapState,
  shouldPreserveN1SevereSingleRemoteTarget,
  shouldUseN1SevereSingleRemoteCeiling,
  computeWeakSingleRemoteRecoveryHoldState,
  computeWeakSingleRemoteRecoveryTargetHoldMaxMs,
  computeSingleRemoteOverbufferTargetMaxMs,
  shouldKeepSingleRemoteDegradedRebuildLocal,
  shouldKeepSingleRemoteSevereRebuildDeadzoneLocal,
  shouldForceN1SustainedSevereRebuildReceiveRelief,
  shouldForceN1SevereRebuildReadyEscape,
  shouldResetN1SevereRebuildDeadzone,
  shouldBlockN1RecoveryExitForCurrentJitter,
  shouldEnableN1DrainReceivePriorityMode,
  shouldExtendN1SevereRebuildAccumulation,
  shouldHoldN1SteadyStarvedAccumulation,
  shouldHoldN1SteadyThinDeadzoneAccumulation,
  shouldPromoteLiveN1PlayoutDeadzoneToStrong,
  shouldTriggerN1InboundMediaWatchdog,
  shouldTriggerN1InboundMediaReannounce,
  shouldTriggerN1SeverePlayoutPathWarm,
  shouldDropActiveJitterSource,
  shouldDropNonParticipantRemoteAudioSource,
  shouldSuppressHealthySingleRemoteMicroWiden,
  shouldKeepMultiSourceWindowRecoveryLocal,
  shouldKeepSingleRemoteWindowRecoveryLocal,
  shouldSuppressSingleRemoteBufferedWindowRecovery,
  shouldRetainN1RecoveryPrerollSatisfied,
  shouldRelaxSingleRemoteWindowRecovery,
  shouldIgnoreParticipantLeftEvent,
  shouldIgnoreRedundantRoomKeyDelivery,
  shouldMintRootSessionKeyImmediately,
  shouldAllowSimultaneousJoinKeyFallback,
  resolveDesignatedRootForSessionKey,
  shouldSendCachedQuitLeave,
  shouldSuppressStartupDecodeFailure,
  shouldSubscribeToJoinedGroupCallEvents,
  shouldStartGroupCallAudioCapture,
  summarizeRecentRecoveryStability,
} from './useGroupVoiceCall';
import type { GroupTopology } from './useGroupVoiceCall';

describe('useGroupVoiceCall lifecycle helpers', () => {
  it('treats only root and cluster roles as active fanout forwarders', () => {
    expect(isFanoutForwarderRole('root-forwarder')).toBe(true);
    expect(isFanoutForwarderRole('cluster-forwarder')).toBe(true);
    expect(isFanoutForwarderRole('standby-forwarder')).toBe(false);
    expect(isFanoutForwarderRole('participant')).toBe(false);
  });

  it('suppresses startup when pipeline is active or startup is in flight', () => {
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: false, startupInFlight: false })
    ).toBe(true);
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: true, startupInFlight: false })
    ).toBe(false);
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: false, startupInFlight: true })
    ).toBe(false);
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: true, startupInFlight: true })
    ).toBe(false);
  });

  it('uses monotonic tokens to invalidate stale async startups', () => {
    const tokenA = bumpGroupCallAudioSessionToken(0);
    const tokenB = bumpGroupCallAudioSessionToken(tokenA);

    expect(isCurrentGroupCallAudioStartupToken(tokenA, tokenA)).toBe(true);
    expect(isCurrentGroupCallAudioStartupToken(tokenA, tokenB)).toBe(false);
    expect(tokenB).toBeGreaterThan(tokenA);
  });

  it('clears all adaptive playout maps during cleanup', () => {
    const lastPacketArrivalAt = new Map([['alice', 10]]);
    const interArrivalSamples = new Map([['alice', [20, 22]]]);
    const smoothedPlayoutTarget = new Map([['alice', 95]]);
    const lastSentPlayoutTarget = new Map([['alice', 90]]);
    const lastPlayoutTargetPostAt = new Map([['alice', 1234]]);
    const lastDrainMissed = new Map([['alice', 2]]);
    const n1WeakLiveHoldUntilPerf = new Map([['alice', 1400]]);
    const n1SteadyThinLiveSincePerf = new Map([['alice', 1500]]);
    const n1ReceivePrioritySendCapState = new Map([
      ['alice', { holdUntilMs: 1700, stableSinceMs: null }],
    ]);

    clearAdaptiveGroupCallPlayoutMaps({
      lastPacketArrivalAt,
      interArrivalSamples,
      smoothedPlayoutTarget,
      lastSentPlayoutTarget,
      lastPlayoutTargetPostAt,
      lastDrainMissed,
      n1WeakLiveHoldUntilPerf,
      n1SteadyThinLiveSincePerf,
      n1ReceivePrioritySendCapState,
    });

    expect(lastPacketArrivalAt.size).toBe(0);
    expect(interArrivalSamples.size).toBe(0);
    expect(smoothedPlayoutTarget.size).toBe(0);
    expect(lastSentPlayoutTarget.size).toBe(0);
    expect(lastPlayoutTargetPostAt.size).toBe(0);
    expect(lastDrainMissed.size).toBe(0);
    expect(n1WeakLiveHoldUntilPerf.size).toBe(0);
    expect(n1SteadyThinLiveSincePerf.size).toBe(0);
    expect(n1ReceivePrioritySendCapState.size).toBe(0);
  });

  it('summarizes recent recovery stability from existing playout signals', () => {
    expect(
      summarizeRecentRecoveryStability({
        nowMs: 1_000,
        windowMs: 400,
        samples: [
          { atMs: 700, bufferedMs: 130, underTarget: false },
          { atMs: 850, bufferedMs: 140, underTarget: false },
          { atMs: 980, bufferedMs: 125, underTarget: false },
        ],
        underrunTimesMs: [650],
      }).stable
    ).toBe(true);

    const unstable = summarizeRecentRecoveryStability({
      nowMs: 1_000,
      windowMs: 400,
      samples: [
        { atMs: 700, bufferedMs: 95, underTarget: true },
        { atMs: 850, bufferedMs: 90, underTarget: true },
        { atMs: 980, bufferedMs: 100, underTarget: false },
      ],
      underrunTimesMs: [700, 760, 810, 900],
    });
    expect(unstable.stable).toBe(false);
    expect(unstable.severeInstability).toBe(true);
  });

  it('allows severe instability to bypass recovery re-entry cooldown', () => {
    expect(
      shouldBypassRecoveryReentryCooldown({
        severity: 2,
        severeInstability: false,
      })
    ).toBe(false);
    expect(
      shouldBypassRecoveryReentryCooldown({
        severity: 3,
        severeInstability: false,
      })
    ).toBe(true);
    expect(
      shouldBypassRecoveryReentryCooldown({
        severity: 1,
        severeInstability: true,
      })
    ).toBe(true);
  });

  it('uses looser recovery-exit thresholds for exact-1-remote calls', () => {
    expect(getRecoveryStabilityThresholds(1)).toEqual({
      minBufferedMs: 105,
      maxUnderTargetFraction: 0.35,
      maxUnderruns: 4,
    });
    expect(getRecoveryStabilityThresholds(2)).toEqual({
      minBufferedMs: 120,
      maxUnderTargetFraction: 0.2,
      maxUnderruns: 2,
    });
  });

  it('starts calm target decay sooner in stable single-remote low-latency calls', () => {
    expect(
      computeSteadyTargetDecayThresholdMs({
        adaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'low-latency',
      })
    ).toBe(127);
    expect(
      computeSteadyTargetDecayThresholdMs({
        adaptiveMaxTargetMs: 145,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'low-latency',
      })
    ).toBe(147);
    expect(
      computeSteadyTargetDecayThresholdMs({
        adaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
      })
    ).toBe(147);
  });

  it('suppresses micro-widen only for clearly healthy single-remote low-latency calls', () => {
    expect(
      shouldSuppressHealthySingleRemoteMicroWiden({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'low-latency',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 165,
          playoutUnderTargetFraction: 0.08,
          underrunCount: 0,
          stable: true,
          severeInstability: false,
        },
      })
    ).toBe(true);

    expect(
      shouldSuppressHealthySingleRemoteMicroWiden({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 165,
          playoutUnderTargetFraction: 0.08,
          underrunCount: 0,
          stable: true,
          severeInstability: false,
        },
      })
    ).toBe(false);

    expect(
      shouldSuppressHealthySingleRemoteMicroWiden({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'low-latency',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 108,
          playoutUnderTargetFraction: 0.32,
          underrunCount: 1,
          stable: false,
          severeInstability: false,
        },
      })
    ).toBe(false);
  });

  it('keeps the normal startup threshold when the jitter buffer is not primed', () => {
    expect(
      computeJitterReadyThresholdFrames({
        primed: false,
        jitterStartBufferSize: 6,
        extraHoldFrames: 0,
        steadyPrimedHoldFrames: 1,
      })
    ).toBe(6);
  });

  it('adds a one-frame steady floor after priming for exact-1-remote calls', () => {
    expect(
      computeJitterReadyThresholdFrames({
        primed: true,
        jitterStartBufferSize: 6,
        extraHoldFrames: 0,
        steadyPrimedHoldFrames: 1,
      })
    ).toBe(2);
    expect(
      computeJitterReadyThresholdFrames({
        primed: true,
        jitterStartBufferSize: 6,
        extraHoldFrames: 1,
        steadyPrimedHoldFrames: 1,
      })
    ).toBe(3);
  });

  it('keeps a jitter source active while inbound audio is still recent', () => {
    expect(
      shouldDropActiveJitterSource({
        emptyTicks: 3,
        playoutActive: true,
      })
    ).toBe(false);
    expect(
      shouldDropActiveJitterSource({
        emptyTicks: 3,
        playoutActive: false,
      })
    ).toBe(true);
  });

  it('drops non-participant remote audio only after startup/topology grace', () => {
    const base = {
      sourceAddr: 'Qghost',
      localAddress: 'Qlocal',
      participantAddresses: ['Qpeer'],
      nowMs: 2_000,
      startupMediaGateUntilMs: 0,
      topologySettleUntilMs: 0,
      startupSessionGraceUntilMs: 0,
      authoritySettleUntilMs: 0,
    };

    expect(
      shouldDropNonParticipantRemoteAudioSource({
        ...base,
        sourceAddr: 'Qpeer',
      })
    ).toBe(false);
    expect(
      shouldDropNonParticipantRemoteAudioSource({
        ...base,
        sourceAddr: 'Qlocal',
      })
    ).toBe(false);
    expect(
      shouldDropNonParticipantRemoteAudioSource({
        ...base,
        topologySettleUntilMs: 2_500,
      })
    ).toBe(false);
    expect(shouldDropNonParticipantRemoteAudioSource(base)).toBe(true);
  });

  it('accelerates decay for chronically under-target multi-source recovery peers', () => {
    expect(
      shouldAccelerateMultiSourceRecoveryDecay({
        activeSourceCount: 4,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'strong',
        bufferAdequacy: 0.4,
        avgPlayoutDeltaMs: -85,
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
      })
    ).toBe(true);
    expect(
      shouldAccelerateMultiSourceRecoveryDecay({
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'strong',
        bufferAdequacy: 0.4,
        avgPlayoutDeltaMs: -85,
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
      })
    ).toBe(true);
    expect(
      shouldAccelerateMultiSourceRecoveryDecay({
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        bufferAdequacy: 0.8,
        avgPlayoutDeltaMs: -20,
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
      })
    ).toBe(false);
  });

  it('accelerates decay for single-remote recovery once playout is mostly stable', () => {
    expect(
      shouldAccelerateSingleRemoteRecoveryDecay({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 130,
          playoutUnderTargetFraction: 0.2,
          underrunCount: 3,
          stable: true,
          severeInstability: false,
        },
      })
    ).toBe(true);
    expect(
      shouldAccelerateSingleRemoteRecoveryDecay({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 94,
          playoutUnderTargetFraction: 0.44,
          underrunCount: 2,
          stable: false,
          severeInstability: false,
        },
      })
    ).toBe(true);
    expect(
      shouldAccelerateSingleRemoteRecoveryDecay({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 2,
          avgPcmBufferedMs: 90,
          playoutUnderTargetFraction: 0.2,
          underrunCount: 1,
          stable: false,
          severeInstability: false,
        },
      })
    ).toBe(false);
    expect(
      shouldAccelerateSingleRemoteRecoveryDecay({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        shouldTightenRecovery: false,
        severeWindowSource: false,
        ingressPeerRecovery: false,
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 154,
          playoutUnderTargetFraction: 0.38,
          underrunCount: 2,
          stable: false,
          severeInstability: false,
        },
      })
    ).toBe(true);
  });

  it('holds severe single-remote recovery so N===1 can re-accumulate', () => {
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 20,
        tier: 'deep',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 40,
        tier: 'deep',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 60,
        tier: 'deep',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 60,
        tier: 'moderate',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 100,
        tier: 'moderate',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 120,
        tier: 'moderate',
      })
    ).toBe(5);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 120,
        targetMs: 185,
        tier: 'moderate',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        forcedReleaseRebuildActive: true,
        opusBufferedMs: 140,
        targetMs: 185,
        tier: 'moderate',
      })
    ).toBe(5);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        opusBufferedMs: 20,
        tier: 'deep',
      })
    ).toBe(0);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: true,
        opusBufferedMs: 40,
        tier: 'deep',
      })
    ).toBe(1);
    expect(
      computeN1AccumulationDecodeCap({
        accumulationActive: true,
        recoverySingleRemote: false,
        opusBufferedMs: 20,
        tier: 'deep',
      })
    ).toBe(1);
  });

  it('scales severe rebuild accumulation hold with the active target', () => {
    expect(computeN1SevereRebuildAccumulationHoldOpusMs(100)).toBe(100);
    expect(computeN1SevereRebuildAccumulationHoldOpusMs(145)).toBe(108.75);
    expect(computeN1SevereRebuildAccumulationHoldOpusMs(185)).toBe(138.75);
    expect(computeN1SevereRebuildAccumulationHoldOpusMs(260)).toBe(160);
  });

  it('keeps severe accumulation hold absolute while PCM rebuild is active', () => {
    expect(
      computeEffectiveN1AccumulationDecodeCap({
        accumulationDecodeCap: 0,
        n1PcmRebuildActive: true,
        n1ReceivePriorityModeActive: false,
      })
    ).toBe(0);
    expect(
      computeEffectiveN1AccumulationDecodeCap({
        accumulationDecodeCap: 1,
        n1PcmRebuildActive: true,
        n1ReceivePriorityModeActive: false,
      })
    ).toBe(5);
    expect(
      computeEffectiveN1AccumulationDecodeCap({
        accumulationDecodeCap: 1,
        n1PcmRebuildActive: false,
        n1ReceivePriorityModeActive: true,
      })
    ).toBe(3);
    expect(
      computeEffectiveN1AccumulationDecodeCap({
        accumulationDecodeCap: 1,
        n1PcmRebuildActive: false,
        n1ReceivePriorityModeActive: false,
      })
    ).toBe(1);
  });

  it('preserves the high target for the severe isolated one-on-one source', () => {
    expect(
      shouldPreserveN1SevereSingleRemoteTarget({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: true,
        isolatedSource: true,
        liveN1DeadzoneStrong: false,
      })
    ).toBe(true);
    expect(
      shouldPreserveN1SevereSingleRemoteTarget({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: false,
        isolatedSource: false,
        liveN1DeadzoneStrong: true,
      })
    ).toBe(true);
    expect(
      shouldPreserveN1SevereSingleRemoteTarget({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: false,
        isolatedSource: false,
        liveN1DeadzoneStrong: false,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldPreserveN1SevereSingleRemoteTarget({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: false,
        isolatedSource: false,
        liveN1DeadzoneStrong: false,
        starvationCooldownActive: true,
      })
    ).toBe(true);
    expect(
      shouldPreserveN1SevereSingleRemoteTarget({
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: true,
        isolatedSource: true,
        liveN1DeadzoneStrong: false,
      })
    ).toBe(false);
    expect(
      shouldPreserveN1SevereSingleRemoteTarget({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'low-latency',
        severeWindowSource: true,
        isolatedSource: true,
        liveN1DeadzoneStrong: false,
      })
    ).toBe(false);
  });

  it('allows the severe ceiling only while one-on-one recovery is strongly starved', () => {
    expect(
      shouldUseN1SevereSingleRemoteCeiling({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: false,
        isolatedSource: false,
        liveN1DeadzoneStrong: false,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldUseN1SevereSingleRemoteCeiling({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: true,
        isolatedSource: true,
        liveN1DeadzoneStrong: false,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(true);
    expect(
      shouldUseN1SevereSingleRemoteCeiling({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: false,
        isolatedSource: false,
        liveN1DeadzoneStrong: false,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
    expect(
      shouldUseN1SevereSingleRemoteCeiling({
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        severeWindowSource: true,
        isolatedSource: true,
        liveN1DeadzoneStrong: false,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
  });

  it('extends severe rebuild accumulation for live one-on-one PCM collapses', () => {
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: true,
        opusBufferedMs: 40,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: true,
        opusBufferedMs: 160,
        targetMs: 185,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: false,
        opusBufferedMs: 40,
        recentStability: null,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: false,
        opusBufferedMs: 120,
        targetMs: 185,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(true);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: false,
        opusBufferedMs: 120,
        targetMs: 185,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 60,
          playoutUnderTargetFraction: 0.8,
          underrunCount: 2,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(true);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: false,
        opusBufferedMs: 120,
        targetMs: 185,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 90,
          playoutUnderTargetFraction: 0.8,
          underrunCount: 2,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: false,
        opusBufferedMs: 120,
        targetMs: 185,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 60,
          playoutUnderTargetFraction: 0.55,
          underrunCount: 2,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
    expect(
      shouldExtendN1SevereRebuildAccumulation({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        sourceRecentlyPushed: true,
        opusBufferedMs: 120,
        targetMs: 185,
        recentStability: null,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
  });

  it('waits before forcing a live severe rebuild out of a two-frame deadlock', () => {
    expect(
      shouldForceN1SevereRebuildReadyEscape({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_200,
        sourceRecentlyPushed: true,
        hasReadyFrame: false,
        bufferedFrames: 2,
        targetMs: 100,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldForceN1SevereRebuildReadyEscape({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 4_000,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        bufferedFrames: 2,
        targetMs: 185,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldForceN1SevereRebuildReadyEscape({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_200,
        sourceRecentlyPushed: true,
        hasReadyFrame: false,
        bufferedFrames: 5,
        targetMs: 100,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldForceN1SevereRebuildReadyEscape({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_200,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        bufferedFrames: 1,
        targetMs: 100,
        recentStability: null,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldForceN1SevereRebuildReadyEscape({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_200,
        sourceRecentlyPushed: false,
        hasReadyFrame: false,
        bufferedFrames: 1,
        targetMs: 100,
        recentStability: null,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
  });

  it('re-prerolls a sustained severe rebuild that is live but stuck in a PCM deadzone', () => {
    expect(
      shouldResetN1SevereRebuildDeadzone({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 6_500,
        sourceRecentlyPushed: true,
        lastRecvAgeMs: 140,
        bufferedFrames: 2,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldResetN1SevereRebuildDeadzone({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 6_500,
        sourceRecentlyPushed: true,
        lastRecvAgeMs: 140,
        bufferedFrames: 3,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldResetN1SevereRebuildDeadzone({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 5_500,
        sourceRecentlyPushed: true,
        lastRecvAgeMs: 140,
        bufferedFrames: 2,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldResetN1SevereRebuildDeadzone({
        recoverySingleRemote: true,
        prerollActive: false,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 6_500,
        sourceRecentlyPushed: true,
        lastRecvAgeMs: 140,
        bufferedFrames: 5,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
  });

  it('blocks N===1 recovery exit while current jitter is still thin or unready', () => {
    expect(
      shouldBlockN1RecoveryExitForCurrentJitter({
        activeSourceCount: 1,
        bufferedFrames: 1,
        hasReadyFrame: false,
      })
    ).toBe(true);
    expect(
      shouldBlockN1RecoveryExitForCurrentJitter({
        activeSourceCount: 1,
        bufferedFrames: 2,
        hasReadyFrame: true,
      })
    ).toBe(true);
    expect(
      shouldBlockN1RecoveryExitForCurrentJitter({
        activeSourceCount: 1,
        bufferedFrames: 3,
        hasReadyFrame: true,
      })
    ).toBe(true);
    expect(
      shouldBlockN1RecoveryExitForCurrentJitter({
        activeSourceCount: 1,
        bufferedFrames: 5,
        hasReadyFrame: true,
      })
    ).toBe(false);
    expect(
      shouldBlockN1RecoveryExitForCurrentJitter({
        activeSourceCount: 2,
        bufferedFrames: 1,
        hasReadyFrame: false,
      })
    ).toBe(false);
    expect(
      shouldBlockN1RecoveryExitForCurrentJitter({
        activeSourceCount: 1,
        bufferedFrames: 0,
        hasReadyFrame: false,
      })
    ).toBe(false);
  });

  it('holds steady one-on-one drain when live playout is starved at a thin Opus floor', () => {
    expect(
      shouldHoldN1SteadyStarvedAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        opusBufferedMs: 40,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 49.766,
          playoutUnderTargetFraction: 0.764,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldHoldN1SteadyStarvedAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        opusBufferedMs: 100,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 49.766,
          playoutUnderTargetFraction: 0.764,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldHoldN1SteadyStarvedAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: false,
        hasReadyFrame: true,
        opusBufferedMs: 40,
        recentStability: null,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldHoldN1SteadyStarvedAccumulation({
        steadySingleRemote: false,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        opusBufferedMs: 40,
        recentStability: null,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
  });

  it('holds steady one-on-one drain after a persistent two-frame live deadzone', () => {
    expect(
      shouldHoldN1SteadyThinDeadzoneAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        tier: 'moderate',
        opusBufferedMs: 40,
        targetMs: 100,
        thinLiveForMs: 2_500,
        recentStability: null,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(true);
    expect(
      shouldHoldN1SteadyThinDeadzoneAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        tier: 'moderate',
        opusBufferedMs: 40,
        targetMs: 100,
        thinLiveForMs: 1_500,
        recentStability: null,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(false);
    expect(
      shouldHoldN1SteadyThinDeadzoneAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        tier: 'moderate',
        opusBufferedMs: 60,
        targetMs: 100,
        thinLiveForMs: 2_500,
        recentStability: null,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(false);
    expect(
      shouldHoldN1SteadyThinDeadzoneAccumulation({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        tier: 'normal',
        opusBufferedMs: 40,
        targetMs: 100,
        thinLiveForMs: 2_500,
        recentStability: null,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(false);
  });

  it('promotes live one-on-one PCM deadzone to strong starvation before the next metrics window', () => {
    expect(
      shouldPromoteLiveN1PlayoutDeadzoneToStrong({
        activeSourceCount: 1,
        lastRecvAgeMs: 140,
        recentStability: {
          sampleCount: 12,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 0,
          stable: false,
          severeInstability: true,
        },
      })
    ).toBe(true);
    expect(
      shouldPromoteLiveN1PlayoutDeadzoneToStrong({
        activeSourceCount: 1,
        lastRecvAgeMs: 2_000,
        recentStability: {
          sampleCount: 12,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 0,
          stable: false,
          severeInstability: true,
        },
      })
    ).toBe(false);
    expect(
      shouldPromoteLiveN1PlayoutDeadzoneToStrong({
        activeSourceCount: 1,
        lastRecvAgeMs: 140,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 0.021,
          playoutUnderTargetFraction: 1,
          underrunCount: 0,
          stable: false,
          severeInstability: true,
        },
      })
    ).toBe(false);
  });

  it('retains released N===1 recovery preroll across brief empty refills', () => {
    expect(
      shouldRetainN1RecoveryPrerollSatisfied({
        bufferedFrames: 0,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        lastPushAgeMs: 90,
      })
    ).toBe(true);
    expect(
      shouldRetainN1RecoveryPrerollSatisfied({
        bufferedFrames: 0,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        lastPushAgeMs: 450,
      })
    ).toBe(false);
    expect(
      shouldRetainN1RecoveryPrerollSatisfied({
        bufferedFrames: 0,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        lastPushAgeMs: 90,
      })
    ).toBe(false);
  });

  it('keeps a weak single-remote recovery hold active until local stability improves', () => {
    const armed = computeWeakSingleRemoteRecoveryHoldState({
      activeSourceCount: 1,
      adaptiveNetworkMode: 'recovery',
      recentStability: {
        sampleCount: 3,
        avgPcmBufferedMs: 50.95,
        playoutUnderTargetFraction: 0.782,
        underrunCount: 6,
        stable: false,
        severeInstability: true,
      },
      lastPushAgeMs: 80,
      nowMs: 1_000,
      holdUntilMs: 0,
    });
    expect(armed.holdActive).toBe(true);
    expect(armed.nextHoldUntilMs).toBe(1_650);

    expect(
      computeWeakSingleRemoteRecoveryHoldState({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 138,
          playoutUnderTargetFraction: 0.18,
          underrunCount: 1,
          stable: true,
          severeInstability: false,
        },
        lastPushAgeMs: 80,
        nowMs: 1_200,
        holdUntilMs: armed.nextHoldUntilMs,
      })
    ).toEqual({
      holdActive: true,
      nextHoldUntilMs: 1_650,
    });

    expect(
      computeWeakSingleRemoteRecoveryHoldState({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 50.95,
          playoutUnderTargetFraction: 0.782,
          underrunCount: 6,
          stable: false,
          severeInstability: true,
        },
        lastPushAgeMs: 220,
        nowMs: 1_200,
        holdUntilMs: 0,
      })
    ).toEqual({
      holdActive: false,
      nextHoldUntilMs: 0,
    });

    expect(
      computeWeakSingleRemoteRecoveryTargetHoldMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        holdActive: true,
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 50.95,
          playoutUnderTargetFraction: 0.782,
          underrunCount: 6,
          stable: false,
          severeInstability: true,
        },
      })
    ).toBe(100);
    expect(
      computeWeakSingleRemoteRecoveryTargetHoldMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        holdActive: true,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 116.199,
          playoutUnderTargetFraction: 0.467,
          underrunCount: 3,
          stable: false,
          severeInstability: false,
        },
      })
    ).toBe(119);
    expect(
      computeWeakSingleRemoteRecoveryTargetHoldMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        holdActive: false,
        recentStability: {
          sampleCount: 3,
          avgPcmBufferedMs: 50.95,
          playoutUnderTargetFraction: 0.782,
          underrunCount: 6,
          stable: false,
          severeInstability: true,
        },
      })
    ).toBe(null);
  });

  it('relaxes single-remote window recovery when the receiver already has usable reserve', () => {
    expect(
      shouldRelaxSingleRemoteWindowRecovery({
        activeSourceCount: 1,
        shouldTightenRecovery: false,
        avgOpusBufferedMs: 117,
        adaptiveTargetMedianMs: 183,
        avgPcmBufferedMs: 100,
        playoutUnderTargetFraction: 0.58,
        avgPlayoutDeltaMs: -78,
        concealmentTicks: 87,
      })
    ).toBe(true);
    expect(
      shouldRelaxSingleRemoteWindowRecovery({
        activeSourceCount: 1,
        shouldTightenRecovery: false,
        avgOpusBufferedMs: 60,
        adaptiveTargetMedianMs: 165,
        avgPcmBufferedMs: 35,
        playoutUnderTargetFraction: 0.88,
        avgPlayoutDeltaMs: -146,
        concealmentTicks: 133,
      })
    ).toBe(false);
    expect(
      shouldRelaxSingleRemoteWindowRecovery({
        activeSourceCount: 1,
        shouldTightenRecovery: false,
        avgOpusBufferedMs: 52,
        adaptiveTargetMedianMs: 176,
        avgPcmBufferedMs: 154,
        playoutUnderTargetFraction: 0.35,
        avgPlayoutDeltaMs: -23,
        concealmentTicks: 3,
      })
    ).toBe(true);
    expect(
      shouldRelaxSingleRemoteWindowRecovery({
        activeSourceCount: 2,
        shouldTightenRecovery: false,
        avgOpusBufferedMs: 117,
        adaptiveTargetMedianMs: 183,
        avgPcmBufferedMs: 100,
        playoutUnderTargetFraction: 0.58,
        avgPlayoutDeltaMs: -78,
        concealmentTicks: 87,
      })
    ).toBe(false);
  });

  it('keeps weak live single-remote collapse local while still allowing real failures to escalate', () => {
    expect(
      shouldKeepSingleRemoteWindowRecoveryLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 106,
        adaptiveTargetMedianMs: 100,
        adaptiveTargetMaxMs: 120,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -127.5,
        missingFrames: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(true);

    expect(
      shouldKeepSingleRemoteWindowRecoveryLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 180,
        avgOpusBufferedMs: 74.298,
        adaptiveTargetMedianMs: 100,
        adaptiveTargetMaxMs: 145,
        avgPcmBufferedMs: 56.424,
        playoutUnderTargetFraction: 0.734,
        avgPlayoutDeltaMs: -54.719,
        missingFrames: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(true);

    expect(
      shouldKeepSingleRemoteWindowRecoveryLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 900,
        avgOpusBufferedMs: 106,
        adaptiveTargetMedianMs: 100,
        adaptiveTargetMaxMs: 120,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -127.5,
        missingFrames: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);

    expect(
      shouldKeepSingleRemoteWindowRecoveryLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 60,
        adaptiveTargetMedianMs: 100,
        adaptiveTargetMaxMs: 120,
        avgPcmBufferedMs: 52,
        playoutUnderTargetFraction: 0.92,
        avgPlayoutDeltaMs: -90,
        missingFrames: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);

    expect(
      shouldKeepSingleRemoteWindowRecoveryLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 106,
        adaptiveTargetMedianMs: 100,
        adaptiveTargetMaxMs: 120,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -127.5,
        missingFrames: 0,
        packetsDroppedPendingDecrypt: 3,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);

    expect(
      shouldKeepSingleRemoteWindowRecoveryLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 106,
        adaptiveTargetMedianMs: 100,
        adaptiveTargetMaxMs: 120,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -127.5,
        missingFrames: 72,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);
  });

  it('keeps the 40ms severe rebuild deadzone local when packet delivery is healthy', () => {
    expect(
      shouldKeepSingleRemoteSevereRebuildDeadzoneLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 40,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -99.979,
        missingFrames: 0,
        jitterBufferDepthFramesMean: 2,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 300_000,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(true);

    expect(
      shouldKeepSingleRemoteSevereRebuildDeadzoneLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 40,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -99.979,
        missingFrames: 0,
        jitterBufferDepthFramesMean: 2,
        severeForcedReleaseRebuildActive: false,
        severeForcedReleaseRebuildActiveForMs: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(true);

    expect(
      shouldKeepSingleRemoteSevereRebuildDeadzoneLocal({
        activeSourceCount: 1,
        lastRecvAgeMs: 120,
        avgOpusBufferedMs: 40,
        avgPcmBufferedMs: 0.021,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -99.979,
        missingFrames: 0,
        jitterBufferDepthFramesMean: 2,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 300_000,
        packetsDroppedPendingDecrypt: 1,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);
  });

  it('suppresses remote media recovery for healthy one-on-one over-buffering', () => {
    expect(
      shouldSuppressSingleRemoteBufferedWindowRecovery({
        activeSourceCount: 1,
        avgPcmBufferedMs: 193,
        adaptiveTargetMedianMs: 145,
        avgPlayoutDeltaMs: 53,
        playoutUnderTargetFraction: 0.05,
        jitterNotReadyFraction: 0,
        jitterRawEmptyFraction: 0,
        packetsDropped: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(true);

    expect(
      shouldSuppressSingleRemoteBufferedWindowRecovery({
        activeSourceCount: 1,
        avgPcmBufferedMs: 193,
        adaptiveTargetMedianMs: 145,
        avgPlayoutDeltaMs: 53,
        playoutUnderTargetFraction: 0.05,
        jitterNotReadyFraction: 0,
        jitterRawEmptyFraction: 0,
        packetsDropped: 0,
        packetsDroppedPendingDecrypt: 1,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);

    expect(
      shouldSuppressSingleRemoteBufferedWindowRecovery({
        activeSourceCount: 2,
        avgPcmBufferedMs: 193,
        adaptiveTargetMedianMs: 145,
        avgPlayoutDeltaMs: 53,
        playoutUnderTargetFraction: 0.05,
        jitterNotReadyFraction: 0,
        jitterRawEmptyFraction: 0,
        packetsDropped: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(false);
  });

  it('caps one-on-one target max downward when the playout buffer is safely above target', () => {
    expect(
      computeSingleRemoteOverbufferTargetMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        avgPcmBufferedMs: 193,
        avgPlayoutDeltaMs: 53,
        playoutUnderTargetFraction: 0.05,
        jitterNotReadyFraction: 0,
        jitterRawEmptyFraction: 0,
        observedTargetMs: 145,
        packetsDropped: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBe(130);

    expect(
      computeSingleRemoteOverbufferTargetMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        avgPcmBufferedMs: 193,
        avgPlayoutDeltaMs: 53,
        playoutUnderTargetFraction: 0.05,
        jitterNotReadyFraction: 0.2,
        jitterRawEmptyFraction: 0,
        observedTargetMs: 145,
        packetsDropped: 0,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPacketPathTimeouts: 0,
      })
    ).toBeNull();
  });

  it('keeps degraded-link severe rebuild local for a live one-on-one path stuck at 20-40ms', () => {
    expect(
      shouldKeepSingleRemoteDegradedRebuildLocal({
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 17.33,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgOpusBufferedMs: 20,
        avgPlayoutDeltaMs: -107.096,
        severeForcedReleaseRebuildActive: true,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
      })
    ).toBe(true);

    expect(
      shouldKeepSingleRemoteDegradedRebuildLocal({
        activeSourceCount: 1,
        pathDegradedUntilMs: 5_000,
        nowMs: 4_000,
        lastRecvAgeMs: 1_500,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 17.33,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgOpusBufferedMs: 20,
        avgPlayoutDeltaMs: -107.096,
        severeForcedReleaseRebuildActive: true,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
      })
    ).toBe(false);
  });

  it('keeps severe rebuild local even when the degraded-path flag is no longer present in the current window', () => {
    expect(
      shouldKeepSingleRemoteDegradedRebuildLocal({
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 17.33,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgOpusBufferedMs: 20,
        avgPlayoutDeltaMs: -107.096,
        severeForcedReleaseRebuildActive: true,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
      })
    ).toBe(true);
  });

  it('keeps sustained severe rebuild local even when opus reserve is high', () => {
    expect(
      shouldKeepSingleRemoteDegradedRebuildLocal({
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 4.888,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: false,
        },
        avgOpusBufferedMs: 254.232,
        avgPlayoutDeltaMs: -32.424,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_500,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
      })
    ).toBe(true);

    expect(
      shouldKeepSingleRemoteDegradedRebuildLocal({
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 4.888,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: false,
        },
        avgOpusBufferedMs: 254.232,
        avgPlayoutDeltaMs: -32.424,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 400,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
      })
    ).toBe(false);
  });

  it('keeps exact one-frame severe rebuild local even when recent summary is sparse', () => {
    expect(
      shouldKeepSingleRemoteDegradedRebuildLocal({
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 0,
          avgPcmBufferedMs: 0,
          playoutUnderTargetFraction: 0,
          underrunCount: 0,
          stable: false,
          severeInstability: false,
        },
        avgOpusBufferedMs: 20,
        avgPlayoutDeltaMs: -99.979,
        windowAvgPcmBufferedMs: 0.021,
        windowPlayoutUnderTargetFraction: 1,
        windowJitterBufferDepthFramesMean: 1,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_500,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
      })
    ).toBe(true);
  });

  it('forces local receive relief for sustained severe rebuild on a live one-on-one path', () => {
    expect(
      shouldForceN1SustainedSevereRebuildReceiveRelief({
        activeSourceCount: 1,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 0,
          avgPcmBufferedMs: 0,
          playoutUnderTargetFraction: 0,
          underrunCount: 0,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -32.424,
        playoutStarvationSeverity: 'strong',
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_500,
      })
    ).toBe(true);

    expect(
      shouldForceN1SustainedSevereRebuildReceiveRelief({
        activeSourceCount: 1,
        lastRecvAgeMs: 1_800,
        recentStability: {
          sampleCount: 0,
          avgPcmBufferedMs: 0,
          playoutUnderTargetFraction: 0,
          underrunCount: 0,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -32.424,
        playoutStarvationSeverity: 'strong',
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_500,
      })
    ).toBe(false);
  });

  it('forces local receive relief for an exact one-frame dead zone during severe rebuild', () => {
    expect(
      shouldForceN1SustainedSevereRebuildReceiveRelief({
        activeSourceCount: 1,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 0,
          avgPcmBufferedMs: 0,
          playoutUnderTargetFraction: 0,
          underrunCount: 0,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: 0,
        playoutStarvationSeverity: 'none',
        avgOpusBufferedMs: 20,
        jitterBufferedFrames: 1,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_000,
      })
    ).toBe(true);
  });

  it('keeps severe local multi-source overload local instead of blaming peers', () => {
    expect(
      shouldKeepMultiSourceWindowRecoveryLocal({
        activeSourceCount: 2,
        shouldTightenRecovery: true,
        severePressure: true,
        packetsDroppedPendingDecrypt: 1145,
        reticulumAudioQueuePressureDrops: 23,
        reticulumAudioDecodedQueueDepthHighWater: 40,
        reticulumAudioBinaryOutQueueDepthHighWater: 43,
        reticulumAudioBridgeQueuedFramesHighWater: 16,
        degradedSourceCount: 2,
      })
    ).toBe(true);

    expect(
      shouldKeepMultiSourceWindowRecoveryLocal({
        activeSourceCount: 2,
        shouldTightenRecovery: true,
        severePressure: true,
        packetsDroppedPendingDecrypt: 0,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioDecodedQueueDepthHighWater: 5,
        reticulumAudioBinaryOutQueueDepthHighWater: 2,
        reticulumAudioBridgeQueuedFramesHighWater: 6,
        degradedSourceCount: 2,
      })
    ).toBe(false);

    expect(
      shouldKeepMultiSourceWindowRecoveryLocal({
        activeSourceCount: 1,
        shouldTightenRecovery: true,
        severePressure: true,
        packetsDroppedPendingDecrypt: 1145,
        reticulumAudioQueuePressureDrops: 23,
        reticulumAudioDecodedQueueDepthHighWater: 40,
        reticulumAudioBinaryOutQueueDepthHighWater: 43,
        reticulumAudioBridgeQueuedFramesHighWater: 16,
        degradedSourceCount: 2,
      })
    ).toBe(false);
  });

  it('caps one-on-one send bitrate when local send pressure coincides with receive collapse', () => {
    expect(
      computeN1ReceivePrioritySendBitrateCapBps({
        activeSourceCount: 1,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 27.572,
          playoutUnderTargetFraction: 0.871,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -87.876,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 900,
        nowMs: 1_000,
        localSendPressure: true,
        nominalBitrateBps: 40_000,
      })
    ).toBe(24_000);
    expect(
      computeN1ReceivePrioritySendBitrateCapBps({
        activeSourceCount: 1,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 40,
          playoutUnderTargetFraction: 0.8,
          underrunCount: 5,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -55,
        starvationSeverity: 'mild',
        lastRemoteDecodeAtMs: 900,
        nowMs: 1_000,
        localSendPressure: true,
        nominalBitrateBps: 40_000,
      })
    ).toBe(28_000);
    expect(
      computeN1ReceivePrioritySendBitrateCapBps({
        activeSourceCount: 1,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 27.572,
          playoutUnderTargetFraction: 0.871,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -87.876,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 100,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
      })
    ).toBe(null);
  });

  it('caps one-on-one send bitrate only for genuine rough-link collapse', () => {
    expect(
      computeN1RoughLinkBitrateCapBps({
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 58.449,
          playoutUnderTargetFraction: 0.729,
          underrunCount: 6,
          stable: false,
          severeInstability: true,
        },
        avgOpusBufferedMs: 135.579,
        avgPlayoutDeltaMs: -73.251,
        missingFrames: 141,
        concealmentTicks: 129,
        avgIncomingPacketMs: 49.669,
        lastRemoteDecodeAtMs: 3_800,
        nominalBitrateBps: 24_000,
      })
    ).toBe(20_000);

    expect(
      computeN1RoughLinkBitrateCapBps({
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 98.371,
          playoutUnderTargetFraction: 0.529,
          underrunCount: 6,
          stable: false,
          severeInstability: false,
        },
        avgOpusBufferedMs: 87.212,
        avgPlayoutDeltaMs: -45.004,
        missingFrames: 23,
        concealmentTicks: 15,
        avgIncomingPacketMs: 19.947,
        lastRemoteDecodeAtMs: 3_800,
        nominalBitrateBps: 24_000,
      })
    ).toBe(20_000);

    expect(
      computeN1RoughLinkBitrateCapBps({
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 170,
          playoutUnderTargetFraction: 0.12,
          underrunCount: 1,
          stable: true,
          severeInstability: false,
        },
        avgOpusBufferedMs: 80,
        avgPlayoutDeltaMs: 18,
        missingFrames: 3,
        concealmentTicks: 2,
        avgIncomingPacketMs: 9,
        lastRemoteDecodeAtMs: 3_800,
        nominalBitrateBps: 24_000,
      })
    ).toBe(null);

    expect(
      computeN1RoughLinkBitrateCapBps({
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 113.568,
          playoutUnderTargetFraction: 0.455,
          underrunCount: 4,
          stable: false,
          severeInstability: true,
        },
        avgOpusBufferedMs: 40,
        avgPlayoutDeltaMs: -9.498,
        missingFrames: 0,
        concealmentTicks: 2,
        avgIncomingPacketMs: 12.324,
        lastRemoteDecodeAtMs: 3_800,
        nominalBitrateBps: 24_000,
        severeForcedReleaseRebuildActive: true,
      })
    ).toBe(null);
  });

  it('caps one-on-one send bitrate on a degraded path even when severe rebuild is stuck at low opus', () => {
    expect(
      computeN1RoughLinkBitrateCapBps({
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        nowMs: 4_000,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 17.33,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgOpusBufferedMs: 20,
        avgPlayoutDeltaMs: -107.096,
        missingFrames: 0,
        concealmentTicks: 308,
        avgIncomingPacketMs: 91.829,
        lastRemoteDecodeAtMs: 3_000,
        nominalBitrateBps: 24_000,
        severeForcedReleaseRebuildActive: true,
      })
    ).toBe(20_000);
  });

  it('holds the one-on-one receive-priority cap until stability is sustained', () => {
    const entered = tickN1ReceivePrioritySendBitrateCapState({
      previousState: null,
      activeSourceCount: 1,
      pathDegradedUntilMs: 0,
      recentStability: {
        sampleCount: 4,
        avgPcmBufferedMs: 27.572,
        playoutUnderTargetFraction: 0.871,
        underrunCount: 8,
        stable: false,
        severeInstability: true,
      },
      avgPlayoutDeltaMs: -87.876,
      avgOpusBufferedMs: 92,
      starvationSeverity: 'strong',
      lastRemoteDecodeAtMs: 900,
      lastRecvAgeMs: 100,
      nowMs: 1_000,
      localSendPressure: true,
      nominalBitrateBps: 40_000,
    });
    expect(entered.capBps).toBe(24_000);
    expect(entered.nextState).toEqual({
      holdUntilMs: 1_900,
      stableSinceMs: null,
    });

    const stabilizing = tickN1ReceivePrioritySendBitrateCapState({
      previousState: entered.nextState,
      activeSourceCount: 1,
      pathDegradedUntilMs: 0,
      recentStability: {
        sampleCount: 4,
        avgPcmBufferedMs: 118,
        playoutUnderTargetFraction: 0.22,
        underrunCount: 0,
        stable: true,
        severeInstability: false,
      },
      avgPlayoutDeltaMs: -12,
      avgOpusBufferedMs: 118,
      starvationSeverity: 'none',
      lastRemoteDecodeAtMs: 1_250,
      lastRecvAgeMs: 100,
      nowMs: 1_400,
      localSendPressure: false,
      nominalBitrateBps: 40_000,
    });
    expect(stabilizing.capBps).toBe(24_000);
    expect(stabilizing.nextState).toEqual({
      holdUntilMs: 1_900,
      stableSinceMs: 1_400,
    });

    const released = tickN1ReceivePrioritySendBitrateCapState({
      previousState: stabilizing.nextState,
      activeSourceCount: 1,
      pathDegradedUntilMs: 0,
      recentStability: {
        sampleCount: 4,
        avgPcmBufferedMs: 118,
        playoutUnderTargetFraction: 0.22,
        underrunCount: 0,
        stable: true,
        severeInstability: false,
      },
      avgPlayoutDeltaMs: -12,
      avgOpusBufferedMs: 118,
      starvationSeverity: 'none',
      lastRemoteDecodeAtMs: 1_850,
      lastRecvAgeMs: 100,
      nowMs: 1_950,
      localSendPressure: false,
      nominalBitrateBps: 40_000,
    });
    expect(released.capBps).toBe(24_000);

    const releasedAfterStableWindow = tickN1ReceivePrioritySendBitrateCapState({
      previousState: stabilizing.nextState,
      activeSourceCount: 1,
      pathDegradedUntilMs: 0,
      recentStability: {
        sampleCount: 4,
        avgPcmBufferedMs: 118,
        playoutUnderTargetFraction: 0.22,
        underrunCount: 0,
        stable: true,
        severeInstability: false,
      },
      avgPlayoutDeltaMs: -12,
      avgOpusBufferedMs: 118,
      starvationSeverity: 'none',
      lastRemoteDecodeAtMs: 2_000,
      lastRecvAgeMs: 100,
      nowMs: 2_050,
      localSendPressure: false,
      nominalBitrateBps: 40_000,
    });
    expect(releasedAfterStableWindow).toEqual({
      capBps: null,
      nextState: null,
    });
  });

  it('enters one-on-one receive-priority mode for a live high-opus low-pcm collapse even when the instant send-pressure sample is calm', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 46.008,
          playoutUnderTargetFraction: 0.782,
          underrunCount: 6,
          stable: false,
        severeInstability: true,
      },
      avgPlayoutDeltaMs: -87.48,
      avgOpusBufferedMs: 106,
      starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 900,
        lastRecvAgeMs: 100,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
      },
    });
  });

  it('enters one-on-one receive-priority mode during prolonged severe rebuild even before opus reserve fully recovers', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 113.568,
          playoutUnderTargetFraction: 0.455,
          underrunCount: 4,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -9.498,
        avgOpusBufferedMs: 40,
        starvationSeverity: 'none',
        lastRemoteDecodeAtMs: 900,
        lastRecvAgeMs: 100,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
        severeForcedReleaseRebuildActive: true,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
      },
    });
  });

  it('does not enter one-on-one receive-priority mode when opus reserve is not actually present', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 27.572,
          playoutUnderTargetFraction: 0.871,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -87.876,
        avgOpusBufferedMs: 40,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 900,
        lastRecvAgeMs: 100,
        nowMs: 1_000,
        localSendPressure: true,
        nominalBitrateBps: 40_000,
      })
    ).toEqual({
      capBps: null,
      nextState: null,
    });
  });

  it('drops the one-on-one receive-priority cap when remote decode goes stale', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: {
          holdUntilMs: 1_900,
          stableSinceMs: null,
        },
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 80,
          playoutUnderTargetFraction: 0.55,
          underrunCount: 1,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -35,
        avgOpusBufferedMs: 80,
        starvationSeverity: 'mild',
        lastRemoteDecodeAtMs: 600,
        lastRecvAgeMs: 100,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
      })
    ).toEqual({
      capBps: null,
      nextState: null,
    });
  });

  it('enters one-on-one receive-priority mode on a degraded path even when decode cadence is sparse during severe rebuild', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 10_000,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 17.33,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -107.096,
        avgOpusBufferedMs: 20,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 200,
        lastRecvAgeMs: 180,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
        severeForcedReleaseRebuildActive: true,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
      },
    });
  });

  it('enters one-on-one receive-priority mode for a severe rebuild collapse even without an active degraded-path flag', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 17.33,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -107.096,
        avgOpusBufferedMs: 20,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 200,
        lastRecvAgeMs: 180,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
        severeForcedReleaseRebuildActive: true,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
        },
      });
  });

  it('enters one-on-one receive-priority mode for a sustained severe rebuild even when opus reserve is high', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 4.888,
          playoutUnderTargetFraction: 1,
          underrunCount: 8,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -32.424,
        avgOpusBufferedMs: 254.232,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 200,
        lastRecvAgeMs: 180,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_500,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
      },
    });
  });

  it('enters one-on-one receive-priority mode for sustained severe rebuild even without a populated recent summary', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 0,
          avgPcmBufferedMs: 0,
          playoutUnderTargetFraction: 0,
          underrunCount: 0,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -32.424,
        avgOpusBufferedMs: 254.232,
        starvationSeverity: 'strong',
        lastRemoteDecodeAtMs: 0,
        lastRecvAgeMs: 180,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_500,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
      },
    });
  });

  it('enters one-on-one receive-priority mode for an exact one-frame dead zone even when recent summary is empty', () => {
    expect(
      tickN1ReceivePrioritySendBitrateCapState({
        previousState: null,
        activeSourceCount: 1,
        pathDegradedUntilMs: 0,
        recentStability: {
          sampleCount: 0,
          avgPcmBufferedMs: 0,
          playoutUnderTargetFraction: 0,
          underrunCount: 0,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: 0,
        avgOpusBufferedMs: 20,
        jitterBufferedFrames: 1,
        starvationSeverity: 'none',
        lastRemoteDecodeAtMs: 0,
        lastRecvAgeMs: 180,
        nowMs: 1_000,
        localSendPressure: false,
        nominalBitrateBps: 40_000,
        severeForcedReleaseRebuildActive: true,
        severeForcedReleaseRebuildActiveForMs: 1_000,
      })
    ).toEqual({
      capBps: 24_000,
      nextState: {
        holdUntilMs: 1_900,
        stableSinceMs: null,
      },
    });
  });

  it('keeps drain-side receive-priority active while live severe rebuild is still active and hold state exists', () => {
    expect(
      shouldEnableN1DrainReceivePriorityMode({
        recoverySingleRemote: true,
        prerollActive: false,
        forceReceivePriorityModeActive: false,
        hasReceivePrioritySendCapState: true,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 53.957,
          playoutUnderTargetFraction: 0.709,
          underrunCount: 10,
          stable: false,
          severeInstability: true,
        },
        severeForcedReleaseRebuildActive: true,
      })
    ).toBe(true);
  });

  it('drops drain-side receive-priority when the stream is no longer live even if hold state exists', () => {
    expect(
      shouldEnableN1DrainReceivePriorityMode({
        recoverySingleRemote: true,
        prerollActive: false,
        forceReceivePriorityModeActive: false,
        hasReceivePrioritySendCapState: true,
        lastRecvAgeMs: 2_000,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 53.957,
          playoutUnderTargetFraction: 0.709,
          underrunCount: 10,
          stable: false,
          severeInstability: true,
        },
        severeForcedReleaseRebuildActive: true,
      })
    ).toBe(false);
  });

  it('triggers one-on-one inbound-media watchdog for sustained zero-source outbound-only calls', () => {
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        roomConnected: true,
        hasRoomKey: true,
        remotePeerCount: 1,
        activeSourceCount: 0,
        packetsReceived: 0,
        packetsDecoded: 0,
        relayPacketsSent: 40,
        reticulumAudioPacketFreshSends: 80,
        missingForMs: 4_500,
        lastActionAgeMs: 4_000,
      })
    ).toBe(true);
  });

  it('keeps inbound-media watchdog active for trickle packets until a source exists', () => {
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        roomConnected: true,
        hasRoomKey: true,
        remotePeerCount: 1,
        activeSourceCount: 0,
        packetsReceived: 11,
        packetsDecoded: 11,
        relayPacketsSent: 40,
        reticulumAudioPacketFreshSends: 80,
        missingForMs: 10_000,
        lastActionAgeMs: 10_000,
      })
    ).toBe(true);
  });

  it('does not trigger inbound-media watchdog once an inbound source exists', () => {
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        roomConnected: true,
        hasRoomKey: true,
        remotePeerCount: 1,
        activeSourceCount: 1,
        packetsReceived: 0,
        packetsDecoded: 0,
        relayPacketsSent: 40,
        reticulumAudioPacketFreshSends: 80,
        missingForMs: 10_000,
        lastActionAgeMs: 10_000,
      })
    ).toBe(false);
  });

  it('gates inbound-media watchdog on outbound activity, dwell, cooldown, and one-on-one scope', () => {
    const base = {
      roomConnected: true,
      hasRoomKey: true,
      remotePeerCount: 1,
      activeSourceCount: 0,
      packetsReceived: 0,
      packetsDecoded: 0,
      relayPacketsSent: 40,
      reticulumAudioPacketFreshSends: 80,
      missingForMs: 4_500,
      lastActionAgeMs: 4_000,
    };
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        ...base,
        reticulumAudioPacketFreshSends: 0,
        relayPacketsSent: 8,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        ...base,
        missingForMs: 2_000,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        ...base,
        lastActionAgeMs: 3_000,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1InboundMediaWatchdog({
        ...base,
        remotePeerCount: 2,
      })
    ).toBe(false);
  });

  it('reannounces local join after sustained one-on-one inbound-media missing', () => {
    expect(
      shouldTriggerN1InboundMediaReannounce({
        roomConnected: true,
        hasRoomKey: true,
        remotePeerCount: 1,
        activeSourceCount: 0,
        relayPacketsSent: 500,
        reticulumAudioPacketFreshSends: 500,
        missingForMs: 4_500,
        lastReannounceAgeMs: 4_000,
      })
    ).toBe(true);
  });

  it('gates inbound-media local join reannounce on dwell, cooldown, and one-on-one scope', () => {
    const base = {
      roomConnected: true,
      hasRoomKey: true,
      remotePeerCount: 1,
      activeSourceCount: 0,
      relayPacketsSent: 500,
      reticulumAudioPacketFreshSends: 500,
      missingForMs: 4_500,
      lastReannounceAgeMs: 4_000,
    };
    expect(
      shouldTriggerN1InboundMediaReannounce({
        ...base,
        missingForMs: 3_000,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1InboundMediaReannounce({
        ...base,
        lastReannounceAgeMs: 3_000,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1InboundMediaReannounce({
        ...base,
        remotePeerCount: 2,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1InboundMediaReannounce({
        ...base,
        activeSourceCount: 1,
      })
    ).toBe(false);
  });

  it('triggers one-on-one severe playout path warm for live underfed streams', () => {
    expect(
      shouldTriggerN1SeverePlayoutPathWarm({
        remotePeerCount: 1,
        activeSourceCount: 1,
        lastRecvAgeMs: 180,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 32,
          playoutUnderTargetFraction: 0.81,
          underrunCount: 12,
          stable: false,
          severeInstability: true,
        },
        avgPlayoutDeltaMs: -68,
        starvationSeverity: 'strong',
        lastActionAgeMs: 9_000,
      })
    ).toBe(true);
    expect(
      shouldTriggerN1SeverePlayoutPathWarm({
        remotePeerCount: 1,
        activeSourceCount: 1,
        lastRecvAgeMs: 220,
        recentStability: {
          sampleCount: 4,
          avgPcmBufferedMs: 78,
          playoutUnderTargetFraction: 0.62,
          underrunCount: 8,
          stable: false,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -66,
        starvationSeverity: 'strong',
        lastActionAgeMs: 9_000,
      })
    ).toBe(true);
  });

  it('does not warm one-on-one severe playout path for stale, stable, or cooldown-limited streams', () => {
    const base = {
      remotePeerCount: 1,
      activeSourceCount: 1,
      lastRecvAgeMs: 180,
      recentStability: {
        sampleCount: 4,
        avgPcmBufferedMs: 32,
        playoutUnderTargetFraction: 0.81,
        underrunCount: 12,
        stable: false,
        severeInstability: true,
      },
      avgPlayoutDeltaMs: -68,
      starvationSeverity: 'strong' as const,
      lastActionAgeMs: 9_000,
    };
    expect(
      shouldTriggerN1SeverePlayoutPathWarm({
        ...base,
        lastRecvAgeMs: 2_000,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1SeverePlayoutPathWarm({
        ...base,
        recentStability: {
          ...base.recentStability,
          avgPcmBufferedMs: 90,
          playoutUnderTargetFraction: 0.2,
          stable: true,
          severeInstability: false,
        },
        avgPlayoutDeltaMs: -5,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1SeverePlayoutPathWarm({
        ...base,
        lastActionAgeMs: 2_000,
      })
    ).toBe(false);
    expect(
      shouldTriggerN1SeverePlayoutPathWarm({
        ...base,
        remotePeerCount: 2,
      })
    ).toBe(false);
  });

  it('only seeds join session state before the root session is adopted', () => {
    expect(
      shouldApplyJoinSessionSnapshot({
        currentCallSessionId: '',
        hasInstalledRoomKey: false,
        needsSessionKey: true,
      })
    ).toBe(true);

    expect(
      shouldApplyJoinSessionSnapshot({
        currentCallSessionId: 'local-session',
        hasInstalledRoomKey: false,
        needsSessionKey: true,
      })
    ).toBe(false);

    expect(
      shouldApplyJoinSessionSnapshot({
        currentCallSessionId: 'root-session',
        hasInstalledRoomKey: true,
        needsSessionKey: false,
      })
    ).toBe(false);
  });

  it('mints a root session key only after the startup authority wait expires', () => {
    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 0,
        nowMs: 1_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 0,
        nowMs: 1_300,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(true);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 2,
        nowMs: 1_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 2,
        nowMs: 2_500,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(true);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        designatedRoot: 'root-a',
        otherParticipantCount: 2,
        nowMs: 2_500,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 0,
        nowMs: 2_500,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
        hasOccupiedRoomEvidence: true,
        hydratedRemoteParticipantCount: 2,
        bootstrapHasTopology: true,
      })
    ).toBe(true);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 2,
        nowMs: 1_300,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 1,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 0,
        nowMs: 6_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 5_000,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 0,
        nowMs: 6_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
        trustedRemoteRoot: 'root-a',
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        myAddress: 'self',
        otherParticipantCount: 2,
        nowMs: 6_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 5000,
        decryptFailureStreak: 0,
      })
    ).toBe(false);
  });

  it('reuses or reacquires keys on session-updated without minting in occupied rooms', () => {
    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'self',
        isLocalRoot: true,
        hasOwnedRoomKey: false,
        otherParticipantCount: 0,
        nowMs: 1_300,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe('mint-immediately');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'self',
        isLocalRoot: true,
        hasOwnedRoomKey: true,
        otherParticipantCount: 2,
        nowMs: 1_300,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 10,
        decryptFailureStreak: 0,
      })
    ).toBe('redistribute-existing');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'self',
        isLocalRoot: true,
        hasOwnedRoomKey: false,
        otherParticipantCount: 2,
        nowMs: 1_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 10,
        decryptFailureStreak: 3,
      })
    ).toBe('request-recovery');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'self',
        isLocalRoot: true,
        hasOwnedRoomKey: false,
        otherParticipantCount: 2,
        nowMs: 2_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
        hasOccupiedRoomEvidence: true,
      })
    ).toBe('mint-immediately');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'self',
        isLocalRoot: false,
        hasOwnedRoomKey: false,
        otherParticipantCount: 2,
        nowMs: 1_300,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 10,
        decryptFailureStreak: 3,
      })
    ).toBe('request-recovery');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'self',
        isLocalRoot: true,
        hasOwnedRoomKey: false,
        designatedRoot: 'root-a',
        otherParticipantCount: 2,
        nowMs: 2_000,
        authoritySettleUntilMs: 1_200,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe('request-recovery');
  });

  it('subscribes to joined group-call events only after main join succeeds', () => {
    expect(
      shouldSubscribeToJoinedGroupCallEvents({
        roomState: 'idle',
        mainJoinReady: false,
      })
    ).toBe(false);

    expect(
      shouldSubscribeToJoinedGroupCallEvents({
        roomState: 'joining',
        mainJoinReady: false,
      })
    ).toBe(false);

    expect(
      shouldSubscribeToJoinedGroupCallEvents({
        roomState: 'joining',
        mainJoinReady: true,
      })
    ).toBe(false);

    expect(
      shouldSubscribeToJoinedGroupCallEvents({
        roomState: 'connected',
        mainJoinReady: false,
      })
    ).toBe(false);

    expect(
      shouldSubscribeToJoinedGroupCallEvents({
        roomState: 'connected',
        mainJoinReady: true,
      })
    ).toBe(true);
  });

  it('computes Reticulum transport targets per role without changing routing logic', () => {
    const topology: GroupTopology = {
      topologyEpoch: 4,
      rootForwarder: 'Q-root',
      standbyForwarder: 'Q-standby',
      clusters: [
        {
          members: ['Q-root', 'Q-a', 'Q-b'],
          forwarder: 'Q-root',
          standby: 'Q-a',
          standby2: 'Q-b',
        },
        {
          members: ['Q-cf', 'Q-c', 'Q-d'],
          forwarder: 'Q-cf',
          standby: 'Q-c',
          standby2: 'Q-d',
        },
      ],
    };

    expect(getReticulumTransportTargets('Q-root', topology).sort()).toEqual(
      ['Q-a', 'Q-b', 'Q-cf', 'Q-standby'].sort()
    );
    expect(getReticulumTransportTargets('Q-cf', topology)).toEqual([
      'Q-root',
      'Q-c',
      'Q-d',
    ]);
    expect(getReticulumTransportTargets('Q-c', topology)).toEqual(['Q-cf']);
    expect(getReticulumTransportTargets('Q-standby', topology)).toEqual([
      'Q-root',
    ]);

    const predictiveRoot = getPredictiveWarmPeers('Q-root', topology);
    expect(new Set(predictiveRoot).size).toBe(predictiveRoot.length);
    for (const p of getReticulumTransportTargets('Q-root', topology)) {
      expect(predictiveRoot).toContain(p);
    }
  });

  it('hydrates only missing remote participants from the main roster after join', () => {
    const existingParticipants = new Map([
      [
        'self',
        {
          publicKey: 'self-pk',
          lastJoinTs: 10,
          joinGeneration: 1,
        },
      ],
      [
        'alice',
        {
          publicKey: 'alice-pk',
          lastJoinTs: 20,
        },
      ],
    ]);

    expect(
      getPostJoinHydratedParticipants({
        localAddress: 'self',
        existingParticipants,
        mainRoster: [
          { address: 'self', publicKey: 'self-pk' },
          { address: 'alice', publicKey: 'alice-pk' },
          { address: ' bob ', publicKey: ' bob-pk ' },
          { address: 'bob', publicKey: 'ignored-duplicate' },
          { address: '', publicKey: 'missing-address' },
        ],
      })
    ).toEqual([{ address: 'bob', publicKey: 'bob-pk' }]);
  });

  it('merges later authoritative roster repairs without disturbing existing participants', () => {
    const initial = [
      {
        address: 'self',
        publicKey: 'self-pk',
        speaking: false,
        role: 'participant' as const,
      },
      {
        address: 'alice',
        publicKey: 'alice-pk',
        speaking: true,
        role: 'cluster-forwarder' as const,
      },
    ];

    const once = mergeHydratedParticipantsIntoUiList({
      previousParticipants: initial,
      hydratedParticipants: [{ address: 'bob', publicKey: 'bob-pk' }],
    });
    const twice = mergeHydratedParticipantsIntoUiList({
      previousParticipants: once,
      hydratedParticipants: [
        { address: 'alice', publicKey: 'ignored-refresh' },
        { address: 'carol', publicKey: 'carol-pk' },
      ],
    });

    expect(once).toEqual([
      ...initial,
      {
        address: 'bob',
        publicKey: 'bob-pk',
        speaking: false,
        role: 'participant',
      },
    ]);
    expect(twice).toEqual([
      ...initial,
      {
        address: 'bob',
        publicKey: 'bob-pk',
        speaking: false,
        role: 'participant',
      },
      {
        address: 'carol',
        publicKey: 'carol-pk',
        speaking: false,
        role: 'participant',
      },
    ]);
  });

  it('delays the first post-join election only for occupied rooms without a known root', () => {
    expect(
      shouldDelayPostJoinRosterElection({
        hydratedRemoteParticipantCount: 2,
        currentRoot: '',
        trustedRemoteRoot: '',
      })
    ).toBe(true);

    expect(
      shouldDelayPostJoinRosterElection({
        hydratedRemoteParticipantCount: 2,
        currentRoot: 'root-a',
        trustedRemoteRoot: '',
      })
    ).toBe(false);

    expect(
      shouldDelayPostJoinRosterElection({
        hydratedRemoteParticipantCount: 2,
        currentRoot: '',
        trustedRemoteRoot: 'root-a',
      })
    ).toBe(false);

    expect(
      shouldDelayPostJoinRosterElection({
        hydratedRemoteParticipantCount: 0,
        currentRoot: '',
        trustedRemoteRoot: '',
        hasOccupiedRoomEvidence: true,
      })
    ).toBe(true);

    expect(
      shouldDelayPostJoinRosterElection({
        hydratedRemoteParticipantCount: 0,
        currentRoot: '',
        trustedRemoteRoot: '',
        hasOccupiedRoomEvidence: false,
      })
    ).toBe(false);
  });

  it('treats empty hydration with bootstrap/topology evidence as an occupied-room rejoin', () => {
    expect(
      hasOccupiedRoomEvidenceForJoin({
        sameRoomRejoin: true,
        hydratedRemoteParticipantCount: 0,
        bootstrapParticipantCount: 0,
        bootstrapTopologyEpoch: 17,
        bootstrapHasTopology: true,
        lastObservedEpoch: 17,
        trustedRemoteRoot: 'root-a',
        bootstrapCallSessionId: 'session-a',
        bootstrapMediaSessionGeneration: 2,
      })
    ).toBe(true);

    expect(
      hasOccupiedRoomEvidenceForJoin({
        sameRoomRejoin: false,
        hydratedRemoteParticipantCount: 0,
        bootstrapParticipantCount: 0,
        bootstrapTopologyEpoch: 0,
        bootstrapHasTopology: false,
        lastObservedEpoch: 0,
        trustedRemoteRoot: '',
        bootstrapCallSessionId: '',
        bootstrapMediaSessionGeneration: 1,
      })
    ).toBe(false);
  });

  it('defers local topology elections while the join authority window is active', () => {
    expect(
      shouldDeferLocalTopologyElection({
        nowMs: 1_000,
        authorityDelayUntilMs: 1_500,
      })
    ).toBe(true);

    expect(
      shouldDeferLocalTopologyElection({
        nowMs: 1_500,
        authorityDelayUntilMs: 1_500,
      })
    ).toBe(false);
  });

  it('continues join handling when a hydrated peer reveals its first joinGeneration', () => {
    expect(
      shouldContinueAfterParticipantJoinRefresh({
        existingJoinGeneration: undefined,
        incomingJoinGeneration: 42,
      })
    ).toBe(true);

    expect(
      shouldContinueAfterParticipantJoinRefresh({
        existingJoinGeneration: undefined,
        incomingJoinGeneration: undefined,
      })
    ).toBe(false);

    expect(
      shouldContinueAfterParticipantJoinRefresh({
        existingJoinGeneration: 7,
        incomingJoinGeneration: 7,
      })
    ).toBe(false);
  });

  it('ignores participant-left events for the local address', () => {
    expect(
      shouldIgnoreParticipantLeftEvent({
        localAddress: 'self',
        leavingAddress: 'self',
      })
    ).toBe(true);

    expect(
      shouldIgnoreParticipantLeftEvent({
        localAddress: 'self',
        leavingAddress: 'other',
      })
    ).toBe(false);
  });

  it('accepts incoming room keys only from the elected root once topology converges', () => {
    expect(
      shouldAcceptIncomingRoomKeySender({
        currentRoot: 'root',
        senderAddress: 'root',
        senderInRoster: true,
      })
    ).toBe(true);

    expect(
      shouldAcceptIncomingRoomKeySender({
        currentRoot: 'root',
        senderAddress: 'peer',
        senderInRoster: true,
      })
    ).toBe(false);

    expect(
      shouldAcceptIncomingRoomKeySender({
        currentRoot: '',
        senderAddress: 'peer',
        senderInRoster: true,
      })
    ).toBe(true);

    expect(
      shouldAcceptIncomingRoomKeySender({
        currentRoot: '',
        senderAddress: 'stranger',
        senderInRoster: false,
      })
    ).toBe(false);
  });

  it('relaxes room-key sender checks while awaiting authoritative key (reordered GC_KEY vs topology)', () => {
    const base = {
      senderAddress: 'rootPeer',
      senderInRoster: true,
      myAddress: 'standbyPeer',
      participantCount: 2,
    };
    expect(
      shouldAcceptIncomingRoomKeySenderRelaxed({
        ...base,
        currentRoot: 'standbyPeer',
        awaitingAuthoritativeKey: true,
        trustedRemoteRoot: 'rootPeer',
        designatedRoot: null,
      })
    ).toBe(true);

    expect(
      shouldAcceptIncomingRoomKeySenderRelaxed({
        ...base,
        currentRoot: 'standbyPeer',
        awaitingAuthoritativeKey: true,
        trustedRemoteRoot: '',
        designatedRoot: 'rootPeer',
      })
    ).toBe(true);

    expect(
      shouldAcceptIncomingRoomKeySenderRelaxed({
        ...base,
        currentRoot: 'standbyPeer',
        awaitingAuthoritativeKey: true,
        trustedRemoteRoot: '',
        designatedRoot: null,
      })
    ).toBe(true);

    expect(
      shouldAcceptIncomingRoomKeySenderRelaxed({
        ...base,
        currentRoot: 'standbyPeer',
        awaitingAuthoritativeKey: false,
        trustedRemoteRoot: 'rootPeer',
        designatedRoot: null,
      })
    ).toBe(false);

    expect(
      shouldAcceptIncomingRoomKeySenderRelaxed({
        ...base,
        currentRoot: 'rootPeer',
        awaitingAuthoritativeKey: true,
        trustedRemoteRoot: '',
        designatedRoot: null,
      })
    ).toBe(true);
  });

  it('accepts recovery key requests for the current or newer authoritative generation', () => {
    expect(
      shouldAcceptKeyRecoveryRequestGeneration({
        requestMediaSessionGeneration: 7,
        localMediaSessionGeneration: 7,
      })
    ).toBe(true);

    expect(
      shouldAcceptKeyRecoveryRequestGeneration({
        requestMediaSessionGeneration: 8,
        localMediaSessionGeneration: 7,
      })
    ).toBe(true);

    expect(
      shouldAcceptKeyRecoveryRequestGeneration({
        requestMediaSessionGeneration: 6,
        localMediaSessionGeneration: 7,
      })
    ).toBe(false);
  });

  it('counts recently healthy remote sources before escalating room-wide recovery', () => {
    const nowMs = 10_000;
    const healthyCount = countRecentlyHealthyRemoteSources({
      lastSuccessfulDecodeAtBySource: new Map([
        ['root', nowMs - 500],
        ['third', nowMs - 4_500],
      ]),
      nowMs,
      healthyWindowMs: 4_000,
    });

    expect(healthyCount).toBe(1);
    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: true,
        repeatedFailures: true,
        noRecentDecode: false,
        recentlyHealthyRemoteSourceCount: healthyCount,
        withinPostKeyGrace: false,
        prolongedNoRecentDecode: false,
      })
    ).toBe(false);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: true,
        repeatedFailures: true,
        noRecentDecode: false,
        recentlyHealthyRemoteSourceCount: 0,
        withinPostKeyGrace: false,
        prolongedNoRecentDecode: false,
      })
    ).toBe(true);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: false,
        repeatedFailures: false,
        noRecentDecode: false,
        recentlyHealthyRemoteSourceCount: healthyCount,
        withinPostKeyGrace: false,
        prolongedNoRecentDecode: false,
      })
    ).toBe(true);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: true,
        repeatedFailures: false,
        noRecentDecode: true,
        recentlyHealthyRemoteSourceCount: 0,
        withinPostKeyGrace: true,
        prolongedNoRecentDecode: false,
      })
    ).toBe(false);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: true,
        repeatedFailures: false,
        noRecentDecode: true,
        recentlyHealthyRemoteSourceCount: 0,
        withinPostKeyGrace: false,
        prolongedNoRecentDecode: false,
      })
    ).toBe(false);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: true,
        repeatedFailures: false,
        noRecentDecode: true,
        recentlyHealthyRemoteSourceCount: 0,
        withinPostKeyGrace: false,
        prolongedNoRecentDecode: true,
      })
    ).toBe(true);
  });

  it('ignores redundant room key deliveries for installed or in-flight identities', () => {
    expect(
      shouldIgnoreRedundantRoomKeyDelivery({
        hasInstalledRoomKey: true,
        payloadCallSessionId: 'session-1',
        localCallSessionId: 'session-1',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        payloadKeyCommitment: 'commitment-1',
        installedKeyCommitment: 'commitment-1',
        sameIdentityInstallInFlight: false,
      })
    ).toBe(true);

    expect(
      shouldIgnoreRedundantRoomKeyDelivery({
        hasInstalledRoomKey: false,
        payloadCallSessionId: 'session-1',
        localCallSessionId: 'session-1',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        payloadKeyCommitment: 'commitment-1',
        installedKeyCommitment: null,
        sameIdentityInstallInFlight: true,
      })
    ).toBe(true);

    expect(
      shouldIgnoreRedundantRoomKeyDelivery({
        hasInstalledRoomKey: true,
        payloadCallSessionId: 'session-2',
        localCallSessionId: 'session-1',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        payloadKeyCommitment: 'commitment-1',
        installedKeyCommitment: 'commitment-1',
        sameIdentityInstallInFlight: false,
      })
    ).toBe(false);

    expect(
      shouldIgnoreRedundantRoomKeyDelivery({
        hasInstalledRoomKey: true,
        payloadCallSessionId: 'session-1',
        localCallSessionId: 'session-1',
        payloadMediaSessionGeneration: 2,
        localMediaSessionGeneration: 1,
        payloadKeyCommitment: 'commitment-1',
        installedKeyCommitment: 'commitment-1',
        sameIdentityInstallInFlight: false,
      })
    ).toBe(false);
  });

  it('allows the trusted current root to replace a stale installed session during recovery', () => {
    expect(
      shouldAdoptTrustedRootSessionDuringRecovery({
        hasInstalledRoomKey: true,
        senderAddress: 'root',
        currentRoot: 'root',
        payloadCallSessionId: 'root-session',
        localCallSessionId: 'stale-session',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        decryptFailureStreak: 9,
        lastRemoteDecodeAtMs: 1_000,
        nowMs: 6_000,
        noDecodeWindowMs: 4_000,
        startupGraceUntilMs: 0,
      })
    ).toBe(true);

    expect(
      shouldAdoptTrustedRootSessionDuringRecovery({
        hasInstalledRoomKey: true,
        senderAddress: 'peer',
        currentRoot: 'root',
        payloadCallSessionId: 'root-session',
        localCallSessionId: 'stale-session',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        decryptFailureStreak: 9,
        lastRemoteDecodeAtMs: 1_000,
        nowMs: 6_000,
        noDecodeWindowMs: 4_000,
        startupGraceUntilMs: 0,
      })
    ).toBe(false);

    expect(
      shouldAdoptTrustedRootSessionDuringRecovery({
        hasInstalledRoomKey: true,
        senderAddress: 'root',
        currentRoot: 'root',
        payloadCallSessionId: 'root-session',
        localCallSessionId: 'stale-session',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        decryptFailureStreak: 0,
        lastRemoteDecodeAtMs: 2_000,
        nowMs: 5_200,
        noDecodeWindowMs: 3_000,
        startupGraceUntilMs: 6_000,
      })
    ).toBe(true);

    expect(
      shouldAdoptTrustedRootSessionDuringRecovery({
        hasInstalledRoomKey: true,
        senderAddress: 'root',
        currentRoot: 'root',
        payloadCallSessionId: 'root-session',
        localCallSessionId: 'stale-session',
        payloadMediaSessionGeneration: 1,
        localMediaSessionGeneration: 1,
        decryptFailureStreak: 0,
        lastRemoteDecodeAtMs: 5_500,
        nowMs: 6_000,
        noDecodeWindowMs: 4_000,
        startupGraceUntilMs: 0,
      })
    ).toBe(false);

    expect(
      shouldAdoptTrustedRootSessionDuringRecovery({
        hasInstalledRoomKey: true,
        senderAddress: 'root',
        currentRoot: 'root',
        payloadCallSessionId: 'root-session',
        localCallSessionId: 'stale-session',
        payloadMediaSessionGeneration: 2,
        localMediaSessionGeneration: 1,
        decryptFailureStreak: 0,
        lastRemoteDecodeAtMs: 5_500,
        nowMs: 6_000,
        noDecodeWindowMs: 4_000,
        startupGraceUntilMs: 0,
      })
    ).toBe(true);
  });

  it('converges same-epoch different-root conflicts to the shared hash winner', () => {
    const current: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'alpha',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    const incoming: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'beta',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 2_000,
    };
    const electionDigests = new Map<string, string>([
      ['alpha', 'dd957904'],
      ['beta', 'cdc71363'],
    ]);

    expect(
      chooseSameEpochTopologyWinner(
        current,
        incoming,
        'gcall-qortal-812',
        electionDigests
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
    });
  });

  it('ignores same-epoch root lastSeen deltas and keeps the digest winner', () => {
    const base = {
      topologyEpoch: 8,
      standbyForwarder: 'standby',
      clusters: [],
    };
    expect(
      chooseSameEpochTopologyWinner(
        { ...base, rootForwarder: 'alpha', lastSeen: 1_000 },
        { ...base, rootForwarder: 'beta', lastSeen: 1_080 },
        'gcall-qortal-812'
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
    });
    expect(
      chooseSameEpochTopologyWinner(
        { ...base, rootForwarder: 'alpha', lastSeen: 1_000 },
        { ...base, rootForwarder: 'beta', lastSeen: 1_200 },
        'gcall-qortal-812'
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
    });
  });

  it('still refreshes same-root duplicate heartbeats by lastSeen', () => {
    const current: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'root-a',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    const incoming: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'root-a',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 2_000,
    };

    expect(
      chooseSameEpochTopologyWinner(current, incoming, 'gcall-qortal-812')
    ).toEqual({
      acceptIncoming: true,
      reason: 'lastSeen',
    });
  });

  it('reuses the current topology root when it is still in the roster', () => {
    expect(
      getTrustedRootForRejoinElection({
        currentRoot: 'root-a',
        trustedRemoteRoot: 'root-b',
        trustedRemoteRootLastSeenAtMs: 9_000,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'root-a', 'root-b'],
      })
    ).toBe('root-a');
  });

  it('keeps a recently seen remote root sticky across same-room rejoin', () => {
    expect(
      getTrustedRootForRejoinElection({
        currentRoot: null,
        trustedRemoteRoot: 'root-a',
        trustedRemoteRootLastSeenAtMs: 9_000,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'root-a', 'peer-b'],
      })
    ).toBe('root-a');
  });

  it('drops the cached remote root once it is stale or absent', () => {
    expect(
      getTrustedRootForRejoinElection({
        currentRoot: null,
        trustedRemoteRoot: 'root-a',
        trustedRemoteRootLastSeenAtMs: 1_000,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'root-a', 'peer-b'],
      })
    ).toBeNull();

    expect(
      getTrustedRootForRejoinElection({
        currentRoot: null,
        trustedRemoteRoot: 'root-a',
        trustedRemoteRootLastSeenAtMs: 9_000,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'peer-b'],
      })
    ).toBeNull();
  });

  it('ignores unusable cached roots and conflicting roots outside the live roster window', () => {
    expect(
      getTrustedRootForRejoinElection({
        currentRoot: null,
        trustedRemoteRoot: 'root-a',
        trustedRemoteRootLastSeenAtMs: 0,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'root-a'],
      })
    ).toBeNull();

    expect(
      getConflictingRootForAuthorityWait({
        currentRoot: 'root-a',
        conflictingRemoteRoot: 'root-b',
        conflictingRemoteRootLastSeenAtMs: 9_000,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'root-a', 'root-b'],
      })
    ).toBe('root-b');

    expect(
      getConflictingRootForAuthorityWait({
        currentRoot: 'root-a',
        conflictingRemoteRoot: 'root-b',
        conflictingRemoteRootLastSeenAtMs: 1_000,
        nowMs: 10_000,
        staleAfterMs: 7_500,
        rosterAddresses: ['self', 'root-a', 'root-b'],
      })
    ).toBeNull();
  });

  it('prefers topology root-forwarder over digest-min when they disagree', () => {
    const digestSaysStandby = new Map([
      ['rootA', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
      ['standbyB', '0000000000000000000000000000000000000000000000000000000000000001'],
    ]);
    expect(
      resolveDesignatedRootForSessionKey({
        rosterAddresses: ['rootA', 'standbyB'],
        electionDigests: digestSaysStandby,
        topologyRootForwarder: 'rootA',
      })
    ).toBe('rootA');

    const digestSaysRoot = new Map([
      ['rootA', '0000000000000000000000000000000000000000000000000000000000000001'],
      ['standbyB', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
    ]);
    expect(
      resolveDesignatedRootForSessionKey({
        rosterAddresses: ['rootA', 'standbyB'],
        electionDigests: digestSaysRoot,
        topologyRootForwarder: 'rootA',
      })
    ).toBe('rootA');

    expect(
      resolveDesignatedRootForSessionKey({
        rosterAddresses: ['rootA', 'standbyB'],
        electionDigests: digestSaysStandby,
        topologyRootForwarder: null,
      })
    ).toBe('standbyB');
  });

  it('blocks simultaneous-join fallback until authority is settled', () => {
    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        otherParticipantCount: 2,
        trustedRemoteRoot: 'root-a',
        conflictingRemoteRoot: null,
        nowMs: 10_000,
        authoritySettleUntilMs: 9_000,
      })
    ).toBe(false);

    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        otherParticipantCount: 2,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: 'root-b',
        nowMs: 10_000,
        authoritySettleUntilMs: 9_000,
      })
    ).toBe(false);

    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        otherParticipantCount: 0,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: null,
        nowMs: 10_000,
        authoritySettleUntilMs: 20_000,
      })
    ).toBe(false);

    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        otherParticipantCount: 0,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: null,
        nowMs: 20_100,
        authoritySettleUntilMs: 20_000,
      })
    ).toBe(true);

    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        designatedRoot: 'root-a',
        otherParticipantCount: 0,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: null,
        nowMs: 20_100,
        authoritySettleUntilMs: 20_000,
      })
    ).toBe(false);

    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        otherParticipantCount: 2,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: null,
        nowMs: 10_000,
        authoritySettleUntilMs: 9_000,
        pendingVerifiedKeyCount: 1,
      })
    ).toBe(false);

    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'self',
        otherParticipantCount: 2,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: null,
        nowMs: 10_000,
        authoritySettleUntilMs: 9_000,
        lastRemoteDecodeAtMs: 7_500,
        recentMediaEvidenceWindowMs: 3_000,
      })
    ).toBe(false);
  });

  it('suppresses hard decode failure handling only during the short startup gate', () => {
    expect(
      shouldSuppressStartupDecodeFailure({
        nowMs: 1_000,
        startupMediaGateUntilMs: 1_200,
      })
    ).toBe(true);

    expect(
      shouldSuppressStartupDecodeFailure({
        nowMs: 1_000,
        startupMediaGateUntilMs: 900,
      })
    ).toBe(false);
  });

  it('does not promote standby root on heartbeat silence alone while transport is healthy', () => {
    expect(
      shouldPromoteStandbyRootAfterHeartbeatTimeout({
        heartbeatSilentMs: 4_000,
        heartbeatTimeoutMs: 11_000,
        rootPeerRequiresReconnect: false,
      })
    ).toBe(false);
  });

  it('promotes standby root only once heartbeat is stale and the root peer needs reconnect', () => {
    expect(
      shouldPromoteStandbyRootAfterHeartbeatTimeout({
        heartbeatSilentMs: 12_000,
        heartbeatTimeoutMs: 11_000,
        rootPeerRequiresReconnect: true,
      })
    ).toBe(true);
  });

  it('sends cached quit leave only while connected and only once', () => {
    expect(
      shouldSendCachedQuitLeave({
        roomState: 'connected',
        hasGroupCallApi: true,
        hasCachedLeave: true,
        alreadySent: false,
      })
    ).toBe(true);

    expect(
      shouldSendCachedQuitLeave({
        roomState: 'idle',
        hasGroupCallApi: true,
        hasCachedLeave: true,
        alreadySent: false,
      })
    ).toBe(false);

    expect(
      shouldSendCachedQuitLeave({
        roomState: 'connected',
        hasGroupCallApi: false,
        hasCachedLeave: true,
        alreadySent: false,
      })
    ).toBe(false);

    expect(
      shouldSendCachedQuitLeave({
        roomState: 'connected',
        hasGroupCallApi: true,
        hasCachedLeave: false,
        alreadySent: false,
      })
    ).toBe(false);

    expect(
      shouldSendCachedQuitLeave({
        roomState: 'connected',
        hasGroupCallApi: true,
        hasCachedLeave: true,
        alreadySent: true,
      })
    ).toBe(false);
  });
});
