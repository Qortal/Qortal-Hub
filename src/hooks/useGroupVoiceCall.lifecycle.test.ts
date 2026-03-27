import { describe, expect, it } from 'vitest';
import {
  bumpGroupCallAudioSessionToken,
  clearAdaptiveGroupCallPlayoutMaps,
  getPostJoinHydratedParticipants,
  isCurrentGroupCallAudioStartupToken,
  shouldApplyJoinSessionSnapshot,
  shouldContinueAfterParticipantJoinRefresh,
  shouldIgnoreParticipantLeftEvent,
  shouldMintRootSessionKeyImmediately,
  shouldSendCachedQuitLeave,
  shouldSubscribeToJoinedGroupCallEvents,
  shouldStartGroupCallAudioCapture,
} from './useGroupVoiceCall';

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
