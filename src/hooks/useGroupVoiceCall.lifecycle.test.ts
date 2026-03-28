import { describe, expect, it } from 'vitest';
import {
  bumpGroupCallAudioSessionToken,
  chooseSameEpochTopologyWinner,
  countRecentlyHealthyRemoteSources,
  clearAdaptiveGroupCallPlayoutMaps,
  getSessionUpdatedKeyRecoveryAction,
  getPostJoinHydratedParticipants,
  isCurrentGroupCallAudioStartupToken,
  shouldAcceptIncomingRoomKeySender,
  shouldAcceptKeyRecoveryRequestGeneration,
  shouldAdoptTrustedRootSessionDuringRecovery,
  shouldApplyJoinSessionSnapshot,
  shouldContinueAfterParticipantJoinRefresh,
  shouldEscalateRoomWideKeyRecovery,
  shouldIgnoreParticipantLeftEvent,
  shouldMintRootSessionKeyImmediately,
  shouldSendCachedQuitLeave,
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

  it('mints a root session key immediately only for cold-start rooms', () => {
    expect(
      shouldMintRootSessionKeyImmediately({
        otherParticipantCount: 0,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(true);

    expect(
      shouldMintRootSessionKeyImmediately({
        otherParticipantCount: 2,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        otherParticipantCount: 2,
        pendingVerifiedKeyCount: 1,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe(false);

    expect(
      shouldMintRootSessionKeyImmediately({
        otherParticipantCount: 2,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 5000,
        decryptFailureStreak: 0,
      })
    ).toBe(false);
  });

  it('reuses or reacquires keys on session-updated without minting in occupied rooms', () => {
    expect(
      getSessionUpdatedKeyRecoveryAction({
        isLocalRoot: true,
        hasOwnedRoomKey: false,
        otherParticipantCount: 0,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe('mint-immediately');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        isLocalRoot: true,
        hasOwnedRoomKey: true,
        otherParticipantCount: 2,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 10,
        decryptFailureStreak: 0,
      })
    ).toBe('redistribute-existing');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        isLocalRoot: true,
        hasOwnedRoomKey: false,
        otherParticipantCount: 2,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 10,
        decryptFailureStreak: 3,
      })
    ).toBe('request-recovery');

    expect(
      getSessionUpdatedKeyRecoveryAction({
        isLocalRoot: false,
        hasOwnedRoomKey: false,
        otherParticipantCount: 2,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 10,
        decryptFailureStreak: 3,
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
      })
    ).toBe(false);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: true,
        repeatedFailures: true,
        noRecentDecode: false,
        recentlyHealthyRemoteSourceCount: 0,
      })
    ).toBe(true);

    expect(
      shouldEscalateRoomWideKeyRecovery({
        hasRoomKey: false,
        repeatedFailures: false,
        noRecentDecode: false,
        recentlyHealthyRemoteSourceCount: healthyCount,
      })
    ).toBe(true);
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
        lastRemoteDecodeAtMs: 5_500,
        nowMs: 6_000,
        noDecodeWindowMs: 4_000,
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
      })
    ).toBe(true);
  });

  it('preserves the established root when same-epoch topology arrives with a different root', () => {
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
      rootForwarder: 'root-b',
      standbyForwarder: 'standby',
      clusters: [],
      timestamp: 100,
      lastSeen: 2_000,
    };

    expect(chooseSameEpochTopologyWinner(current, incoming)).toEqual({
      acceptIncoming: false,
      reason: 'preserve-established-root',
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

    expect(chooseSameEpochTopologyWinner(current, incoming)).toEqual({
      acceptIncoming: true,
      reason: 'lastSeen',
    });
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
