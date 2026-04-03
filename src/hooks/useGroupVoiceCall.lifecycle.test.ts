import { describe, expect, it } from 'vitest';
import {
  bumpGroupCallAudioSessionToken,
  chooseSameEpochTopologyWinner,
  countRecentlyHealthyRemoteSources,
  clearAdaptiveGroupCallPlayoutMaps,
  getConflictingRootForAuthorityWait,
  hasOccupiedRoomEvidenceForJoin,
  getTrustedRootForRejoinElection,
  getReticulumTransportTargets,
  getSessionUpdatedKeyRecoveryAction,
  getPostJoinHydratedParticipants,
  isCurrentGroupCallAudioStartupToken,
  mergeHydratedParticipantsIntoUiList,
  shouldDeferLocalTopologyElection,
  shouldPromoteStandbyRootAfterHeartbeatTimeout,
  shouldAcceptIncomingRoomKeySender,
  shouldAcceptIncomingRoomKeySenderRelaxed,
  shouldAcceptKeyRecoveryRequestGeneration,
  shouldAdoptTrustedRootSessionDuringRecovery,
  shouldApplyJoinSessionSnapshot,
  shouldContinueAfterParticipantJoinRefresh,
  shouldDelayPostJoinRosterElection,
  shouldEscalateRoomWideKeyRecovery,
  shouldIgnoreParticipantLeftEvent,
  shouldIgnoreRedundantRoomKeyDelivery,
  shouldMintRootSessionKeyImmediately,
  shouldAllowSimultaneousJoinKeyFallback,
  shouldSendCachedQuitLeave,
  shouldSuppressStartupDecodeFailure,
  shouldSubscribeToJoinedGroupCallEvents,
  shouldStartGroupCallAudioCapture,
} from './useGroupVoiceCall';
import type { GroupTopology } from '../lib/group-call/types';

describe('useGroupVoiceCall lifecycle helpers', () => {
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

    clearAdaptiveGroupCallPlayoutMaps({
      lastPacketArrivalAt,
      interArrivalSamples,
      smoothedPlayoutTarget,
      lastSentPlayoutTarget,
      lastPlayoutTargetPostAt,
      lastDrainMissed,
    });

    expect(lastPacketArrivalAt.size).toBe(0);
    expect(interArrivalSamples.size).toBe(0);
    expect(smoothedPlayoutTarget.size).toBe(0);
    expect(lastSentPlayoutTarget.size).toBe(0);
    expect(lastPlayoutTargetPostAt.size).toBe(0);
    expect(lastDrainMissed.size).toBe(0);
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

    expect(getReticulumTransportTargets('Q-root', topology)).toEqual([
      'Q-a',
      'Q-b',
      'Q-cf',
    ]);
    expect(getReticulumTransportTargets('Q-cf', topology)).toEqual([
      'Q-root',
      'Q-c',
      'Q-d',
    ]);
    expect(getReticulumTransportTargets('Q-c', topology)).toEqual(['Q-cf']);
    expect(getReticulumTransportTargets('Q-standby', topology)).toEqual([
      'Q-root',
    ]);
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
      timestamp: 100,
      lastSeen: 1_000,
    };
    const incoming: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'beta',
      standbyForwarder: 'standby',
      clusters: [],
      timestamp: 100,
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

  it('still refreshes same-root duplicate heartbeats by lastSeen', () => {
    const current: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'root-a',
      standbyForwarder: 'standby',
      clusters: [],
      timestamp: 100,
      lastSeen: 1_000,
    };
    const incoming: GroupTopology = {
      topologyEpoch: 8,
      rootForwarder: 'root-a',
      standbyForwarder: 'standby',
      clusters: [],
      timestamp: 100,
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
        heartbeatTimeoutMs: 3_200,
        rootPeerRequiresReconnect: false,
      })
    ).toBe(false);
  });

  it('promotes standby root only once heartbeat is stale and the root peer needs reconnect', () => {
    expect(
      shouldPromoteStandbyRootAfterHeartbeatTimeout({
        heartbeatSilentMs: 4_000,
        heartbeatTimeoutMs: 3_200,
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
