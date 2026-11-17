import { describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import * as nodeZlib from 'node:zlib';
import {
  GroupCallManager,
  buildParticipantFromVerifiedJoin,
  decodeGroupCallLogicalJoinGeneration,
  isAuthorizedMainRootTransition,
  reticulumAudioResetReasonForVerifiedJoin,
  resolveVerifiedJoinTakeoverAt,
  resolveDmVoiceAudioLinkOpenDecision,
  resolveGroupCallSourcePeerHash,
  resolveVerifiedGroupCallControlPeerHash,
  resolveGroupCallSignedJoinGeneration,
  resolveMainLocalTopologyProvisional,
  resolveMainRootObservationTime,
  shouldApplyGroupCallLeaveToSession,
  shouldProtectHealthyMainTopologyRoot,
  shouldRefreshParticipantFromVerifiedJoin,
} from './group-call';

describe('group-call root authority protection', () => {
  const base = {
    currentRoot: 'Q-current',
    incomingRoot: 'Q-returning',
    incomingAuthor: 'Q-returning',
    currentRootPresent: true,
    currentTopologyObservedAtMs: 10_000,
    nowMs: 15_000,
    localTopologyProvisional: false,
    healthyWindowMs: 11_500,
  };

  it('keeps a healthy incumbent when a returning peer republishes itself as root', () => {
    expect(shouldProtectHealthyMainTopologyRoot(base)).toBe(true);
  });

  it('lets the incumbent author an intentional root transition', () => {
    expect(
      shouldProtectHealthyMainTopologyRoot({
        ...base,
        incomingAuthor: base.currentRoot,
      })
    ).toBe(false);
  });

  it('lets a newly joined provisional root reconcile to the incumbent', () => {
    expect(
      shouldProtectHealthyMainTopologyRoot({
        ...base,
        localTopologyProvisional: true,
      })
    ).toBe(false);
  });

  it('allows standby failover after the incumbent heartbeat expires', () => {
    expect(
      shouldProtectHealthyMainTopologyRoot({
        ...base,
        nowMs: 21_501,
      })
    ).toBe(false);
  });

  it('does not protect a root that has left the verified roster', () => {
    expect(
      shouldProtectHealthyMainTopologyRoot({
        ...base,
        currentRootPresent: false,
      })
    ).toBe(false);
  });

  it('refreshes root liveness only when the claimed root authored the topology', () => {
    expect(
      resolveMainRootObservationTime({
        previousRoot: 'Q-root',
        nextRoot: 'Q-root',
        topologyAuthor: 'Q-root',
        previousObservedAtMs: 10_000,
        nowMs: 12_000,
      })
    ).toBe(12_000);
    expect(
      resolveMainRootObservationTime({
        previousRoot: 'Q-root',
        nextRoot: 'Q-root',
        topologyAuthor: 'Q-member',
        previousObservedAtMs: 10_000,
        nowMs: 12_000,
      })
    ).toBe(10_000);
  });

  it('waits for evidence from a newly selected root', () => {
    expect(
      resolveMainRootObservationTime({
        previousRoot: 'Q-old-root',
        nextRoot: 'Q-new-root',
        topologyAuthor: 'Q-old-root',
        previousObservedAtMs: 10_000,
        nowMs: 12_000,
      })
    ).toBe(0);
  });

  it('does not let an unrelated same-root update erase provisional state', () => {
    expect(
      resolveMainLocalTopologyProvisional({
        currentRoot: 'Q-provisional',
        incomingRoot: 'Q-provisional',
        currentlyProvisional: true,
        reconciledWithIncumbent: false,
      })
    ).toBe(true);
  });

  it('clears provisional state after incumbent reconciliation', () => {
    expect(
      resolveMainLocalTopologyProvisional({
        currentRoot: 'Q-provisional',
        incomingRoot: 'Q-incumbent',
        currentlyProvisional: true,
        reconciledWithIncumbent: true,
      })
    ).toBe(false);
  });

  it('only lets the designated standby replace a present unresponsive root', () => {
    const base = {
      currentRoot: 'Q-root',
      incomingRoot: 'Q-former-root',
      incomingAuthor: 'Q-former-root',
      currentStandby: 'Q-standby',
      currentRootPresent: true,
      reconcileProvisionalLocalRoot: false,
    };
    expect(isAuthorizedMainRootTransition(base)).toBe(false);
    expect(
      isAuthorizedMainRootTransition({
        ...base,
        incomingRoot: 'Q-standby',
        incomingAuthor: 'Q-standby',
      })
    ).toBe(true);
  });

  it('allows a self-authored successor when the old root has left', () => {
    expect(
      isAuthorizedMainRootTransition({
        currentRoot: 'Q-departed',
        incomingRoot: 'Q-successor',
        incomingAuthor: 'Q-successor',
        currentStandby: 'Q-departed-standby',
        currentRootPresent: false,
        reconcileProvisionalLocalRoot: false,
      })
    ).toBe(true);
  });
});

describe('group-call relayed endpoint ownership', () => {
  it('uses the original sender instead of the relay hop', () => {
    expect(resolveGroupCallSourcePeerHash('a'.repeat(32), 'b'.repeat(32))).toBe(
      'a'.repeat(32)
    );
  });

  it('falls back to the transport peer for legacy direct frames', () => {
    expect(resolveGroupCallSourcePeerHash('', 'b'.repeat(32))).toBe(
      'b'.repeat(32)
    );
  });

  it('keeps the wallet-verified participant route for relayed controls', () => {
    expect(
      resolveVerifiedGroupCallControlPeerHash('a'.repeat(32), 'b'.repeat(32))
    ).toBe('a'.repeat(32));
  });
});

describe('DM voice audio-link ownership recovery', () => {
  it('opens immediately for the preferred opener', () => {
    expect(
      resolveDmVoiceAudioLinkOpenDecision({
        role: 'opener',
        createdAtMs: 1_000,
        nowMs: 1_000,
      })
    ).toBe('open');
  });

  it('lets the waiter recover only after the opener grace window', () => {
    expect(
      resolveDmVoiceAudioLinkOpenDecision({
        role: 'waiter',
        createdAtMs: 1_000,
        nowMs: 4_999,
      })
    ).toBe('defer');
    expect(
      resolveDmVoiceAudioLinkOpenDecision({
        role: 'waiter',
        createdAtMs: 1_000,
        nowMs: 5_000,
      })
    ).toBe('open');
  });
});

describe('DM call terminal control', () => {
  const localAddress = 'Q-local';
  const peerAddress = 'Q-peer';
  const peerHash = 'a'.repeat(32);
  const roomId = 'dmv:test-room';
  const chatId = 'direct:Q-local:Q-peer';

  function controlManager(): any {
    const manager = Object.create(GroupCallManager.prototype) as any;
    manager.localAddresses = new Set([localAddress]);
    manager.rooms = new Map([
      [
        roomId,
        {
          roomId,
          chatId,
          callSessionId: 'media-session',
          mediaSessionGeneration: 3,
          dmVoiceCallId: 'call-1',
          dmVoicePeerDestinationHash: peerHash,
          participants: new Map([
            [localAddress, { reticulumDestinationHash: 'b'.repeat(32) }],
            [peerAddress, { reticulumDestinationHash: peerHash }],
          ]),
        },
      ],
    ]);
    manager.reticulumAudioPeersByAddress = new Map([
      [
        peerAddress,
        {
          established: true,
          linkId: 'audio-link-1',
          rooms: new Set([roomId]),
          peerPresenceHash: peerHash,
          peerDestinationHash: peerHash,
        },
      ],
    ]);
    manager.rtcSignalReassemblies = new Map();
    manager.receivedRtcSignalIds = new Map();
    return manager;
  }

  function rtcSignal(
    fromAddress = localAddress,
    toAddress = peerAddress,
    signalId = 'rtc-signal-1'
  ) {
    const payload = JSON.stringify({ version: 1, audio: 'native-track' });
    return {
      roomId,
      callSessionId: 'media-session',
      mediaSessionGeneration: 3,
      fromAddress,
      toAddress,
      connectionId: 'call-1:native-audio-v1',
      signalId,
      signalType: 'capability' as const,
      payload,
      payloadHash: nodeCrypto
        .createHash('sha256')
        .update(payload, 'utf8')
        .digest('hex'),
      timestamp: Date.now(),
      signature: 'signature',
      publicKey:
        fromAddress === localAddress ? 'local-public-key' : 'peer-public-key',
    };
  }

  it('sends hangup on the exact authenticated DM media link', async () => {
    const manager = controlManager();
    const send = vi.fn(async () => ({ ok: true }));
    manager.reticulumBridge = { sendGroupAudioLinkControlDetailed: send };

    await expect(
      manager.sendDmCallLinkControl({
        kind: 'hangup',
        callId: 'call-1',
        chatId,
        controlId: 'control-1',
        fromAddress: localAddress,
        toAddress: peerAddress,
        timestamp: 1_000,
        publicKey: 'public-key',
        signature: 'signature',
      })
    ).resolves.toEqual({ success: true });

    expect(send).toHaveBeenCalledOnce();
    const request = send.mock.calls[0][0];
    expect(request).toMatchObject({
      roomId,
      linkId: 'audio-link-1',
      peerPresenceHash: peerHash,
      signalType: 'call-control',
      signalId: 'control-1',
      callSessionId: 'media-session',
    });
    const decoded = JSON.parse(
      nodeZlib.inflateRawSync(request.payload).toString('utf8')
    );
    expect(decoded).toMatchObject({
      version: 1,
      kind: 'hangup',
      roomId,
      callSessionId: 'media-session',
      mediaSessionGeneration: 3,
      callId: 'call-1',
    });
  });

  it('sends hangup when the authenticated DM link exists before the peer join row', async () => {
    const manager = controlManager();
    manager.rooms.get(roomId).participants.delete(peerAddress);
    const send = vi.fn(async () => ({ ok: true }));
    manager.reticulumBridge = { sendGroupAudioLinkControlDetailed: send };

    await expect(
      manager.sendDmCallLinkControl({
        kind: 'hangup',
        callId: 'call-1',
        chatId,
        controlId: 'control-without-peer-row',
        fromAddress: localAddress,
        toAddress: peerAddress,
        timestamp: Date.now(),
        publicKey: 'local-public-key',
        signature: 'signature',
      })
    ).resolves.toEqual({ success: true });

    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects terminal control delivered by a different endpoint', () => {
    const manager = controlManager();
    const received = vi.fn();
    manager.on('gcall:dm-call-control', received);
    const input = {
      version: 1,
      kind: 'hangup',
      roomId,
      callSessionId: 'media-session',
      mediaSessionGeneration: 3,
      callId: 'call-1',
      chatId,
      controlId: 'control-1',
      fromAddress: peerAddress,
      toAddress: localAddress,
      timestamp: Date.now(),
      publicKey: 'public-key',
      signature: 'signature',
    };

    manager.verifyAndDeliverDmCallLinkControl(
      input,
      'c'.repeat(32),
      'c'.repeat(32),
      Date.now()
    );
    expect(received).not.toHaveBeenCalled();

    manager.verifyAndDeliverDmCallLinkControl(
      input,
      peerHash,
      peerHash,
      Date.now()
    );
    expect(received).toHaveBeenCalledOnce();
  });

  it('accepts terminal control from the pinned DM link before the peer join row', () => {
    const manager = controlManager();
    manager.rooms.get(roomId).participants.delete(peerAddress);
    const received = vi.fn();
    manager.on('gcall:dm-call-control', received);

    manager.verifyAndDeliverDmCallLinkControl(
      {
        version: 1,
        kind: 'hangup',
        roomId,
        callSessionId: 'media-session',
        mediaSessionGeneration: 3,
        callId: 'call-1',
        chatId,
        controlId: 'incoming-without-peer-row',
        fromAddress: peerAddress,
        toAddress: localAddress,
        timestamp: Date.now(),
        publicKey: 'peer-public-key',
        signature: 'signature',
      },
      peerHash,
      peerHash,
      Date.now()
    );

    expect(received).toHaveBeenCalledOnce();
  });

  it('sends signed RTC signaling over the pinned DM link before the peer join row', async () => {
    const manager = controlManager();
    manager.rooms.get(roomId).participants.delete(peerAddress);
    manager.verifyPool = { verify: vi.fn(async () => true) };
    const send = vi.fn(async () => ({ ok: true }));
    manager.reticulumBridge = {
      getState: () => 'ready',
      sendGroupAudioLinkControlDetailed: send,
    };

    await expect(manager.sendRtcSignal(rtcSignal())).resolves.toEqual({
      success: true,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      roomId,
      linkId: 'audio-link-1',
      peerPresenceHash: peerHash,
      signalType: 'capability',
    });
  });

  it('accepts signed RTC signaling from the pinned DM link before the peer join row', async () => {
    const manager = controlManager();
    manager.rooms.get(roomId).participants.delete(peerAddress);
    manager.verifyPool = { verify: vi.fn(async () => true) };
    const received = vi.fn();
    manager.on('gcall:rtc-signal', received);

    await manager.verifyAndDeliverRtcSignal(
      rtcSignal(peerAddress, localAddress, 'incoming-rtc-without-peer-row'),
      peerHash,
      peerHash,
      Date.now()
    );

    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toMatchObject({ verified: true });
  });

  it('sends and accepts capability acknowledgements on the pinned DM link', async () => {
    const manager = controlManager();
    manager.rooms.get(roomId).participants.delete(peerAddress);
    manager.verifyPool = { verify: vi.fn(async () => true) };
    const send = vi.fn(async () => ({ ok: true }));
    manager.reticulumBridge = {
      getState: () => 'ready',
      sendGroupAudioLinkControlDetailed: send,
    };
    const payload = JSON.stringify({
      kind: 'capability-ack',
      generation: 'native_audio_v1',
      capabilityId: 'capability-1',
    });
    const outgoing = {
      ...rtcSignal(),
      signalType: 'ack' as const,
      payload,
      payloadHash: nodeCrypto
        .createHash('sha256')
        .update(payload, 'utf8')
        .digest('hex'),
    };

    await expect(manager.sendRtcSignal(outgoing)).resolves.toEqual({
      success: true,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ signalType: 'ack' })
    );

    const received = vi.fn();
    manager.on('gcall:rtc-signal', received);
    await manager.verifyAndDeliverRtcSignal(
      {
        ...outgoing,
        fromAddress: peerAddress,
        toAddress: localAddress,
        signalId: '00000000-0000-4000-8000-000000000001',
        publicKey: 'peer-public-key',
      },
      peerHash,
      peerHash,
      Date.now()
    );

    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toMatchObject({
      signalType: 'ack',
      verified: true,
    });
  });

  it('does not relax missing-participant validation for group calls', async () => {
    const manager = controlManager();
    const room = manager.rooms.get(roomId);
    manager.rooms.delete(roomId);
    room.roomId = 'gcall-qortal-1144';
    room.chatId = 'group:1144';
    room.dmVoiceCallId = undefined;
    room.dmVoicePeerDestinationHash = undefined;
    room.participants.delete(peerAddress);
    manager.rooms.set(room.roomId, room);
    manager.verifyPool = { verify: vi.fn(async () => true) };
    const input = rtcSignal();
    input.roomId = room.roomId;

    await expect(manager.sendRtcSignal(input)).resolves.toEqual({
      success: false,
      error: 'participant-not-found',
    });
  });

  it('preserves group RTC signaling over an authenticated shared peer link', async () => {
    const manager = controlManager();
    const room = manager.rooms.get(roomId);
    manager.rooms.delete(roomId);
    room.roomId = 'gcall-qortal-1144';
    room.chatId = 'group:1144';
    room.dmVoiceCallId = undefined;
    room.dmVoicePeerDestinationHash = undefined;
    manager.rooms.set(room.roomId, room);
    manager.reticulumAudioPeersByAddress.get(peerAddress).rooms.clear();
    manager.verifyPool = { verify: vi.fn(async () => true) };
    const send = vi.fn(async () => ({ ok: true }));
    manager.reticulumBridge = {
      getState: () => 'ready',
      sendGroupAudioLinkControlDetailed: send,
    };
    const input = rtcSignal();
    input.roomId = room.roomId;

    await expect(manager.sendRtcSignal(input)).resolves.toEqual({
      success: true,
    });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('group-call signed join generation transport', () => {
  it('preserves an already encoded takeover generation across IPC', () => {
    expect(resolveGroupCallSignedJoinGeneration(-4_000_000_001, false)).toBe(
      -4_000_000_001
    );
    expect(resolveGroupCallSignedJoinGeneration(-123, true)).toBe(-123);
  });

  it('still encodes takeover for older callers that send a logical generation', () => {
    expect(resolveGroupCallSignedJoinGeneration(122, true)).toBe(-123);
    expect(resolveGroupCallSignedJoinGeneration(122, false)).toBe(122);
  });
});

describe('group-call multi-device participant ownership', () => {
  function routeManager(): any {
    const manager = Object.create(GroupCallManager.prototype) as any;
    manager.promoteAwaitingRouteReticulumAudio = vi.fn();
    manager.presence = {
      getRouteForAddress: vi.fn(() => ({
        kind: 'reticulum',
        destinationHash: 'c'.repeat(32),
      })),
      getRoutesForAddress: vi.fn(() => [
        {
          kind: 'reticulum',
          destinationHash: 'c'.repeat(32),
        },
      ]),
    };
    manager.rooms = new Map([
      [
        'room-a',
        {
          participants: new Map([
            ['Q-peer', { reticulumDestinationHash: 'a'.repeat(32) }],
          ]),
        },
      ],
      [
        'room-b',
        {
          participants: new Map([
            ['Q-peer', { reticulumDestinationHash: 'b'.repeat(32) }],
          ]),
        },
      ],
      ['room-without-peer', { participants: new Map() }],
    ]);
    return manager;
  }

  it('uses the participant endpoint from the requested room', () => {
    const manager = routeManager();
    expect(manager.resolveReticulumPeerPresenceHash('Q-peer', 'room-b')).toBe(
      'b'.repeat(32)
    );
  });

  it('does not borrow a device endpoint from an unrelated room', () => {
    const manager = routeManager();
    expect(
      manager.resolveReticulumPeerPresenceHash('Q-peer', 'room-without-peer')
    ).toBe('c'.repeat(32));
  });

  it('does not guess between different device endpoints without room context', () => {
    const manager = routeManager();
    manager.presence.getRouteForAddress.mockReturnValue(null);

    expect(manager.resolveReticulumPeerPresenceHash('Q-peer')).toBeNull();
  });

  it('does not attribute a reused device destination to the wrong account across rooms', () => {
    const manager = routeManager();
    const sharedHash = 'd'.repeat(32);
    manager.rooms = new Map([
      [
        'old-account-room',
        {
          participants: new Map([
            ['Q-old', { reticulumDestinationHash: sharedHash }],
          ]),
        },
      ],
      [
        'new-account-room',
        {
          participants: new Map([
            ['Q-new', { reticulumDestinationHash: sharedHash }],
          ]),
        },
      ],
    ]);
    manager.reticulumAudioAddressByLinkId = new Map([['shared-link', 'Q-new']]);
    manager.reticulumAudioPeersByAddress = new Map();
    manager.localAddresses = new Set();

    expect(
      manager.resolveReticulumAudioAddress(
        'shared-link',
        sharedHash,
        'old-account-room'
      )
    ).toBe('Q-old');
    expect(
      manager.resolveReticulumAudioAddress(
        'shared-link',
        sharedHash,
        'new-account-room'
      )
    ).toBe('Q-new');
    expect(
      manager.resolveReticulumAudioAddress('unknown-link', sharedHash)
    ).toBeNull();
  });

  it('keeps the signed room participant route authoritative over another device route', () => {
    const manager = routeManager();
    manager.reticulumAudioAddressByLinkId = new Map();
    manager.reticulumAudioPeersByAddress = new Map();
    manager.localAddresses = new Set();

    expect(
      manager.resolveReticulumAudioAddress(
        'unknown-link',
        'a'.repeat(32),
        'room-b'
      )
    ).toBeNull();
    expect(
      manager.resolveReticulumAudioAddress(
        'unknown-link',
        'b'.repeat(32),
        'room-b'
      )
    ).toBe('Q-peer');
  });

  it('decodes the signed compact takeover generation', () => {
    expect(decodeGroupCallLogicalJoinGeneration(-8)).toBe(7);
    expect(decodeGroupCallLogicalJoinGeneration(7)).toBe(7);
  });

  it('allows same-session reannouncements without changing ownership', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 2_000,
        currentJoinGeneration: 10,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
        incomingJoinGeneration: 10,
      })
    ).toBe(true);
  });

  it('initializes first-seen legacy joins instead of treating two absent generations as an existing session', () => {
    expect(
      resolveVerifiedJoinTakeoverAt({
        incomingJoinTimestamp: 3_000,
      })
    ).toBe(3_000);
    expect(
      buildParticipantFromVerifiedJoin(undefined, {
        type: 'GC_JOIN',
        roomId: 'dmv:test',
        chatId: 'direct:Q-local:Q-peer',
        fromAddress: 'Q-peer',
        fromPublicKey: 'peer-public-key',
        signature: 'signature',
        timestamp: 3_000,
        reticulumDestinationHash: 'A'.repeat(32),
      })
    ).toMatchObject({
      joinedAt: 3_000,
      takeoverAt: 3_000,
      reticulumDestinationHash: 'a'.repeat(32),
    });
  });

  it('preserves takeover time for real same-session reannouncements only', () => {
    expect(
      resolveVerifiedJoinTakeoverAt({
        currentJoinedAt: 2_000,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
      })
    ).toBe(1_000);
    expect(
      resolveVerifiedJoinTakeoverAt({
        currentJoinedAt: 2_000,
        currentJoinGeneration: 10,
        currentTakeoverAt: 1_000,
        incomingJoinGeneration: 20,
        incomingJoinTimestamp: 3_000,
      })
    ).toBe(3_000);
  });

  it('rejects a different device generation unless it is an explicit takeover', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 2_000,
        currentJoinGeneration: 10,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
        incomingJoinGeneration: 20,
      })
    ).toBe(false);
  });

  it('does not let a legacy join overwrite a selected session-aware device', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 2_000,
        currentJoinGeneration: 10,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
      })
    ).toBe(false);
  });

  it('requires an explicit takeover when upgrading a legacy participant slot', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 2_000,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
        incomingJoinGeneration: 10,
      })
    ).toBe(false);
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 2_000,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
        incomingJoinGeneration: 10,
        incomingTakeover: true,
      })
    ).toBe(true);
  });

  it('accepts a newer explicit takeover and rejects a delayed older takeover', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 4_000,
        currentJoinGeneration: 10,
        currentTakeoverAt: 1_000,
        incomingJoinTimestamp: 3_000,
        incomingJoinGeneration: 20,
        incomingTakeover: true,
      })
    ).toBe(true);
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 4_000,
        currentJoinGeneration: 20,
        currentTakeoverAt: 3_000,
        incomingJoinTimestamp: 1_000,
        incomingJoinGeneration: 10,
        incomingTakeover: true,
      })
    ).toBe(false);
  });

  it('only applies a session-aware leave to the selected generation', () => {
    expect(
      shouldApplyGroupCallLeaveToSession({
        activeJoinGeneration: 20,
        leavingJoinGeneration: 10,
      })
    ).toBe(false);
    expect(
      shouldApplyGroupCallLeaveToSession({
        activeJoinGeneration: 20,
        leavingJoinGeneration: 20,
      })
    ).toBe(true);
  });

  it('binds legacy leaves to the selected transport endpoint', () => {
    expect(
      shouldApplyGroupCallLeaveToSession({
        activeJoinGeneration: 20,
        activeReticulumDestinationHash: 'aaaa',
        transportPeerPresenceHash: 'bbbb',
      })
    ).toBe(false);
    expect(
      shouldApplyGroupCallLeaveToSession({
        activeJoinGeneration: 20,
        activeReticulumDestinationHash: 'AAAA',
        transportPeerPresenceHash: 'aaaa',
      })
    ).toBe(true);
  });
});

describe('group-call verified join audio reset decision', () => {
  it('keeps matching audio state when a fresh join arrives before roster catches up', () => {
    expect(
      reticulumAudioResetReasonForVerifiedJoin({
        existingReticulumDestinationHash: '',
        incomingReticulumDestinationHash: '4fe300e8dd1288580600a2c5f1952092',
        currentAudioPeerPresenceHash: '4fe300e8dd1288580600a2c5f1952092',
        refreshedExistingJoin: false,
        rejoinsAfterLeave: false,
      })
    ).toBe('');
  });

  it('resets absent-participant audio state when it points at a different destination', () => {
    expect(
      reticulumAudioResetReasonForVerifiedJoin({
        existingReticulumDestinationHash: '',
        incomingReticulumDestinationHash: '4fe300e8dd1288580600a2c5f1952092',
        currentAudioPeerPresenceHash: 'b0f911489514f8f4255e9207755e9157',
        refreshedExistingJoin: false,
        rejoinsAfterLeave: false,
      })
    ).toBe('join-identity-changed');
  });

  it('resets existing participant audio state on real identity changes', () => {
    expect(
      reticulumAudioResetReasonForVerifiedJoin({
        existingReticulumDestinationHash: 'b0f911489514f8f4255e9207755e9157',
        incomingReticulumDestinationHash: '4fe300e8dd1288580600a2c5f1952092',
        currentAudioPeerPresenceHash: 'b0f911489514f8f4255e9207755e9157',
        refreshedExistingJoin: true,
        rejoinsAfterLeave: false,
      })
    ).toBe('join-identity-changed');
  });

  it('resets when a verified rejoin follows a real leave tombstone', () => {
    expect(
      reticulumAudioResetReasonForVerifiedJoin({
        existingReticulumDestinationHash: '4fe300e8dd1288580600a2c5f1952092',
        incomingReticulumDestinationHash: '4fe300e8dd1288580600a2c5f1952092',
        currentAudioPeerPresenceHash: '4fe300e8dd1288580600a2c5f1952092',
        refreshedExistingJoin: true,
        rejoinsAfterLeave: true,
      })
    ).toBe('fresh-verified-rejoin-after-leave');
  });
});

describe('group-call Reticulum forwarding recipients', () => {
  const room = {
    participants: new Map(
      ['Q-root', 'Q-a', 'Q-forwarder', 'Q-b', 'Q-c'].map((address) => [
        address,
        {},
      ])
    ),
    lastTopology: {
      topologyEpoch: 3,
      rootForwarder: 'Q-root',
      standbyForwarder: 'Q-forwarder',
      clusters: [
        { forwarder: 'Q-root', members: ['Q-root', 'Q-a'] },
        {
          forwarder: 'Q-forwarder',
          members: ['Q-forwarder', 'Q-b', 'Q-c'],
        },
      ],
      lastSeen: {},
    },
  };

  function managerFor(localAddress: string): any {
    const manager = Object.create(GroupCallManager.prototype) as any;
    manager.localAddresses = new Set([localAddress]);
    return manager;
  }

  it('keeps root forwarding identical for member and cluster ingress', () => {
    const manager = managerFor('Q-root');
    expect(
      [...manager.computeReticulumAudioForwardRecipients(room, 'Q-a')].sort()
    ).toEqual(['Q-forwarder']);
    expect(
      [
        ...manager.computeReticulumAudioForwardRecipients(room, 'Q-forwarder'),
      ].sort()
    ).toEqual(['Q-a']);
  });

  it('keeps cluster forwarding identical for root and member ingress', () => {
    const manager = managerFor('Q-forwarder');
    expect(
      [...manager.computeReticulumAudioForwardRecipients(room, 'Q-root')].sort()
    ).toEqual(['Q-b', 'Q-c']);
    expect(
      [...manager.computeReticulumAudioForwardRecipients(room, 'Q-b')].sort()
    ).toEqual(['Q-c', 'Q-root']);
  });

  it('invalidates forwarding plans when a peer transport route changes', () => {
    const manager = managerFor('Q-root');
    manager.reticulumAudioAddressByLinkId = new Map([
      ['packet:peer-hash', 'Q-peer'],
    ]);
    manager.scheduleReticulumAudioForwardingPlanSync = vi.fn();
    const state = {
      transport: 'packet',
      routeKey: 'packet:peer-hash',
      peerPresenceHash: 'peer-hash',
      linkId: 'link-1',
    };

    manager.setReticulumAudioTransport('Q-peer', state, 'link', 'fallback');

    expect(state.transport).toBe('link');
    expect(state.routeKey).toBe('link-1');
    expect(
      manager.scheduleReticulumAudioForwardingPlanSync
    ).toHaveBeenCalledOnce();
  });

  it('removes forwarding during recovery and refreshes it after the hold', () => {
    vi.useFakeTimers();
    try {
      const manager = managerFor('Q-root');
      manager.reticulumAudioForwardingPlanRecoveryTimersByAddress = new Map();
      manager.reticulumAudioPeersByAddress = new Map();
      manager.scheduleReticulumAudioForwardingPlanSync = vi.fn();
      manager.logReticulumFailureThrottled = vi.fn();
      manager.scheduleReticulumAudioFlush = vi.fn();
      const state = {
        recoveryHoldUntilMs: 0,
        recoveryReason: '',
        pending: [{}],
      };
      manager.reticulumAudioPeersByAddress.set('Q-peer', state);

      manager.holdReticulumAudioRouteRecovery(
        'Q-peer',
        state,
        'packet-failed',
        100
      );

      expect(state.pending).toEqual([]);
      expect(
        manager.scheduleReticulumAudioForwardingPlanSync
      ).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(101);
      expect(
        manager.scheduleReticulumAudioForwardingPlanSync
      ).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets an urgent forwarding update preempt a delayed retry', () => {
    vi.useFakeTimers();
    try {
      const manager = managerFor('Q-root');
      manager.started = true;
      manager.reticulumBridge = {};
      manager.reticulumAudioForwardingPlanRevision = 0;
      manager.reticulumAudioForwardingPlanTimer = null;
      manager.reticulumAudioForwardingPlanTimerDueAtMs = 0;
      manager.applyReticulumAudioForwardingPlans = vi.fn();

      manager.scheduleReticulumAudioForwardingPlanSync(1_000);
      vi.advanceTimersByTime(100);
      manager.scheduleReticulumAudioForwardingPlanSync(25);
      vi.advanceTimersByTime(24);
      expect(manager.applyReticulumAudioForwardingPlans).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(manager.applyReticulumAudioForwardingPlans).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a forwarding plan that finishes after the manager stops', async () => {
    let resolveConfigure: ((value: { ok: true }) => void) | undefined;
    const configureResult = new Promise<{ ok: true }>((resolve) => {
      resolveConfigure = resolve;
    });
    const bridge = {
      getState: vi.fn(() => 'ready'),
      configureGroupAudioForwarding: vi
        .fn()
        .mockReturnValueOnce(configureResult)
        .mockResolvedValue({ ok: true }),
    };
    const manager = managerFor('Q-root');
    manager.started = true;
    manager.reticulumBridge = bridge;
    manager.reticulumAudioForwardingPlanSyncInFlight = false;
    manager.reticulumAudioForwardingPlanRevision = 1;
    manager.reticulumAudioForwardingPlanGeneration = 0;
    manager.reticulumAudioForwardingPlanAppliedKey = '';
    manager.buildReticulumAudioForwardingPlans = vi.fn(() => []);

    const applying = manager.applyReticulumAudioForwardingPlans();
    manager.started = false;
    manager.reticulumAudioForwardingPlanGeneration++;
    resolveConfigure?.({ ok: true });
    await applying;
    await Promise.resolve();

    expect(bridge.configureGroupAudioForwarding).toHaveBeenNthCalledWith(1, []);
    expect(bridge.configureGroupAudioForwarding).toHaveBeenNthCalledWith(
      2,
      [],
      { startIfNeeded: false }
    );
    expect(manager.reticulumAudioForwardingPlanAppliedKey).toBe('');
  });

  it('releases and retries forwarding sync after plan preparation throws', async () => {
    const manager = managerFor('Q-root');
    manager.started = true;
    manager.reticulumBridge = {};
    manager.reticulumAudioForwardingPlanSyncInFlight = false;
    manager.reticulumAudioForwardingPlanRevision = 1;
    manager.reticulumAudioForwardingPlanGeneration = 0;
    manager.buildReticulumAudioForwardingPlans = vi.fn(() => {
      throw new Error('bad-plan');
    });
    manager.logReticulumFailureThrottled = vi.fn();
    manager.scheduleReticulumAudioForwardingPlanSync = vi.fn();

    await manager.applyReticulumAudioForwardingPlans();

    expect(manager.reticulumAudioForwardingPlanSyncInFlight).toBe(false);
    expect(manager.logReticulumFailureThrottled).toHaveBeenCalledWith(
      'audio-forward-plan:prepare-exception',
      expect.stringContaining('bad-plan')
    );
    expect(
      manager.scheduleReticulumAudioForwardingPlanSync
    ).toHaveBeenCalledWith(1_000);
  });

  it('ignores stale fast-path activity and preserves newer recovery state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T12:00:30.000Z'));
    try {
      const manager = managerFor('Q-root');
      const roomId = 'gcall-qortal-716';
      const address = 'Q-source';
      const state = {
        transport: 'packet',
        lastInboundAtMs: 0,
        lastInboundPacketAtMs: 0,
        lastRecoveryActionAtMs: Date.now() - 1_000,
        recoveryHoldUntilMs: Date.now() + 5_000,
        recoveryReason: 'packet-failed',
      };
      manager.rooms = new Map([
        [roomId, { participants: new Map([[address, {}]]) }],
      ]);
      manager.reticulumAudioPeersByAddress = new Map([[address, state]]);
      manager.shouldRejectQortalGroupCallAddress = vi.fn(() => false);
      manager.isReticulumAudioLinkVerifiedForAddress = vi.fn(() => true);
      manager.noteRecentCallActivity = vi.fn();
      manager.noteBootstrapParticipantActivity = vi.fn();
      manager.clearReticulumAudioRecoveryHold = vi.fn();

      manager.handleReticulumGroupAudioFastPathActivity({
        roomId,
        sourceAddress: address,
        linkId: '',
        peerPresenceHash: 'peer-hash',
        peerDestinationHash: 'destination-hash',
        forwardedTargets: 1,
        receivedAtWallMs: Date.now() - 12_000,
      });
      expect(manager.noteRecentCallActivity).not.toHaveBeenCalled();

      const beforeRecoveryAtMs = Date.now() - 2_000;
      manager.handleReticulumGroupAudioFastPathActivity({
        roomId,
        sourceAddress: address,
        linkId: '',
        peerPresenceHash: 'peer-hash',
        peerDestinationHash: 'destination-hash',
        forwardedTargets: 1,
        receivedAtWallMs: beforeRecoveryAtMs,
      });
      expect(state.lastInboundAtMs).toBe(beforeRecoveryAtMs);
      expect(manager.clearReticulumAudioRecoveryHold).not.toHaveBeenCalled();

      const afterRecoveryAtMs = Date.now() - 500;
      manager.handleReticulumGroupAudioFastPathActivity({
        roomId,
        sourceAddress: address,
        linkId: '',
        peerPresenceHash: 'peer-hash',
        peerDestinationHash: 'destination-hash',
        forwardedTargets: 1,
        receivedAtWallMs: afterRecoveryAtMs,
      });
      expect(state.lastInboundAtMs).toBe(afterRecoveryAtMs);
      expect(state.lastInboundPacketAtMs).toBe(afterRecoveryAtMs);
      expect(manager.clearReticulumAudioRecoveryHold).toHaveBeenCalledWith(
        address,
        state
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
