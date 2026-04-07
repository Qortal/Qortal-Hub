import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildGroupRoomBootstrapState,
  chooseMainTopologyAuthority,
  GC_JOIN_MAX_AGE_MS,
  decodeGcReticulumActivityWire,
  gcJoinTimestampRejectReason,
  getReticulumOverlayLogicalDedupeKey,
  getLocalSessionBreakMediaSessionGeneration,
  GroupCallManager,
  isRecentRoomStateFresh,
  mergeRoomTopologyEpochWithFloor,
  pendingKeyEnvelopeWinsOver,
  shouldDelayPresenceEvictionForHealthyTransport,
  shouldApplyVerifiedLeaveToParticipant,
  shouldIgnoreLeaveForLocalAddress,
  shouldRefreshParticipantFromVerifiedJoin,
  shouldHoldAudioForReticulumRecoveryReason,
} from './group-call';
import { compactDmVoiceJoinWireChatId } from './dm-voice-wire';
import { encodeJoinWire } from './group-call-wire-reticulum';
import {
  byteLengthUtf8JsonWithBridgeSender,
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
} from './reticulum-wire-size';

/** Valid RNS destination hash hex (32 chars) for GC_JOIN `d` / `reticulumDestinationHash`. */
const TEST_D32 = 'a'.repeat(32);

function reticulumAwarePresenceStub(): PresenceStub {
  return {
    on: () => {},
    off: () => {},
    getRouteForAddress: (address: string) => ({
      kind: 'reticulum' as const,
      destinationHash: `d:${address}`,
    }),
    getReticulumActiveNeighborHashes: () => ['d:Q-peer'],
    getNodeIdForAddress: () => null,
  };
}

type PresenceStub = {
  on: () => void;
  off: () => void;
  getRouteForAddress: (address: string) => {
    kind: 'reticulum';
    destinationHash: string;
  };
  getReticulumActiveNeighborHashes: () => string[];
  getNodeIdForAddress: () => null;
};

function reticulumBridgeReadyStub(
  sent: Array<{ hash: string; msg: Record<string, unknown> }>
): ReticulumBridgeStub {
  return {
    getState: () => 'ready',
    sendGroupCallDetailed: (hash: string, msg: Record<string, unknown>) => {
      sent.push({ hash, msg });
      return Promise.resolve({ ok: true as const });
    },
    sendGroupCall: (hash: string, msg: Record<string, unknown>) => {
      sent.push({ hash, msg });
      return Promise.resolve(true);
    },
    warmGroupAudioPath: (_peerPresenceHash: string) =>
      Promise.resolve({ ok: true as const }),
    openGroupAudioLink: async (_peerPresenceHash: string) => ({
      ok: true as const,
      linkId: 'stub-link',
      established: true,
    }),
    closeGroupAudioLink: async (_linkId: string) => ({ ok: true as const }),
    on: () => {},
    off: () => {},
  };
}

type ReticulumBridgeStub = {
  getState: () => 'ready';
  sendGroupCallDetailed: (
    hash: string,
    msg: Record<string, unknown>
  ) => Promise<{ ok: true } | { ok: false; reason: string; error?: string }>;
  sendGroupCall: (
    hash: string,
    msg: Record<string, unknown>
  ) => Promise<boolean>;
  warmGroupAudioPath?: (
    peerPresenceHash: string
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  openGroupAudioLink?: (
    peerPresenceHash: string
  ) => Promise<
    | { ok: true; linkId: string; established: boolean }
    | { ok: false; reason: string; error?: string }
  >;
  closeGroupAudioLink?: (
    linkId: string
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  on: () => void;
  off: () => void;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('mergeRoomTopologyEpochWithFloor', () => {
  it('uses max of current and non-negative floor', () => {
    expect(mergeRoomTopologyEpochWithFloor(0, 10)).toBe(10);
    expect(mergeRoomTopologyEpochWithFloor(10, 5)).toBe(10);
    expect(mergeRoomTopologyEpochWithFloor(7, 12)).toBe(12);
  });

  it('ignores undefined or non-finite floor', () => {
    expect(mergeRoomTopologyEpochWithFloor(5, undefined)).toBe(5);
    expect(mergeRoomTopologyEpochWithFloor(5, NaN)).toBe(5);
  });

  it('floors fractional values', () => {
    expect(mergeRoomTopologyEpochWithFloor(0, 9.7)).toBe(9);
  });
});

describe('recent room bootstrap state', () => {
  it('keeps cached room state only within the TTL', () => {
    expect(isRecentRoomStateFresh(10_000, 29_999, 20_000)).toBe(true);
    expect(isRecentRoomStateFresh(10_000, 30_001, 20_000)).toBe(false);
  });

  it('builds a readonly bootstrap snapshot including topology and joinedAt data', () => {
    const snapshot = buildGroupRoomBootstrapState(
      {
        roomId: 'gcall-qortal-812',
        chatId: 'chat-812',
        participants: new Map([
          [
            'Q-self',
            {
              publicKey: 'pk-self',
              joinedAt: 100,
              reticulumDestinationHash: TEST_D32,
            },
          ],
          [
            'Q-root',
            {
              publicKey: 'pk-root',
              joinedAt: 200,
              reticulumDestinationHash: TEST_D32,
            },
          ],
        ]),
        topologyEpoch: 17,
        lastTopology: {
          topologyEpoch: 17,
          rootForwarder: 'Q-root',
          standbyForwarder: 'Q-standby',
          clusters: [
            {
              members: ['Q-root', 'Q-self'],
              forwarder: 'Q-root',
              standby: 'Q-self',
              standby2: '',
            },
          ],
          lastSeen: 9_999,
        },
        callSessionId: 'session-17',
        mediaSessionGeneration: 3,
      },
      12_345,
      true
    );

    expect(snapshot).toEqual({
      roomId: 'gcall-qortal-812',
      chatId: 'chat-812',
      participants: [
        {
          address: 'Q-self',
          publicKey: 'pk-self',
          joinedAt: 100,
          reticulumDestinationHash: TEST_D32,
        },
        {
          address: 'Q-root',
          publicKey: 'pk-root',
          joinedAt: 200,
          reticulumDestinationHash: TEST_D32,
        },
      ],
      topologyEpoch: 17,
      lastTopology: {
        topologyEpoch: 17,
        rootForwarder: 'Q-root',
        standbyForwarder: 'Q-standby',
        clusters: [
          {
            members: ['Q-root', 'Q-self'],
            forwarder: 'Q-root',
            standby: 'Q-self',
            standby2: '',
          },
        ],
        lastSeen: 9_999,
      },
      callSessionId: 'session-17',
      mediaSessionGeneration: 3,
      updatedAtMs: 12_345,
      fromRecentCache: true,
    });
  });

  it('does not revive cached participants into live rejoin bootstrap state', () => {
    const reticulumSent: Array<{ hash: string; msg: Record<string, unknown> }> =
      [];
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      reticulumBridgeReadyStub(reticulumSent) as any
    );

    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user1',
      'sig',
      'pk1',
      100,
      TEST_D32
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user2',
      'sig',
      'pk2',
      200,
      TEST_D32
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      300,
      TEST_D32
    );

    manager.leaveRoom('gcall-qortal-812', 'Q-user3', 'sig', 'pk3', 400);

    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      500,
      TEST_D32
    );

    expect(reticulumSent.length).toBeGreaterThan(0);
    expect(manager.getRoomParticipants('gcall-qortal-812')).toEqual([
      { address: 'Q-user3', publicKey: 'pk3', reticulumDestinationHash: TEST_D32 },
    ]);
    expect(manager.getRoomBootstrapState('gcall-qortal-812')).toMatchObject({
      participants: [
        {
          address: 'Q-user3',
          publicKey: 'pk3',
          joinedAt: 500,
          reticulumDestinationHash: TEST_D32,
        },
      ],
    });
  });

  it('preserves cached topology and session on rejoin without reviving cached participants', () => {
    const t0 = Date.now();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      reticulumBridgeReadyStub([]) as any
    );

    const firstJoin = manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-root',
      'sig',
      'pk-root',
      t0,
      TEST_D32
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user2',
      'sig',
      'pk2',
      t0 + 100,
      TEST_D32
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      t0 + 200,
      TEST_D32
    );

    manager.broadcastTopology(
      'gcall-qortal-812',
      {
        fromAddress: 'Q-root',
        topologyEpoch: 17,
        rootForwarder: 'Q-root',
        standbyForwarder: 'Q-user2',
        clusters: [
          {
            members: ['Q-root', 'Q-user2', 'Q-user3'],
            forwarder: 'Q-root',
            standby: 'Q-user2',
            standby2: 'Q-user3',
          },
        ],
        lastSeen: t0 + 300,
      },
      'sig',
      'pk-root',
      t0 + 300
    );

    manager.leaveRoom('gcall-qortal-812', 'Q-user3', 'sig', 'pk3', t0 + 400);
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      t0 + 500,
      TEST_D32
    );

    const bootstrap = manager.getRoomBootstrapState('gcall-qortal-812');

    expect(bootstrap).toMatchObject({
      participants: [
        {
          address: 'Q-user3',
          publicKey: 'pk3',
          joinedAt: t0 + 500,
          reticulumDestinationHash: TEST_D32,
        },
      ],
      topologyEpoch: 17,
      lastTopology: {
        topologyEpoch: 17,
        rootForwarder: 'Q-root',
        standbyForwarder: 'Q-user2',
      },
      callSessionId: firstJoin.callSessionId,
      mediaSessionGeneration: firstJoin.mediaSessionGeneration,
    });
  });

  it('continues Reticulum overlay fanout when an earlier neighbor fails but a later one succeeds', async () => {
    const sent: Array<{ hash: string; msg: Record<string, unknown> }> = [];
    const manager = new GroupCallManager(
      { send: () => {} } as any,
      {
        on: () => {},
        off: () => {},
        getRouteForAddress: (address: string) => ({
          kind: 'reticulum' as const,
          destinationHash: `d:${address}`,
        }),
        getReticulumActiveNeighborHashes: () => ['d:bad', 'd:good'],
        getNodeIdForAddress: () => null,
      } as any,
      {
        getState: () => 'ready',
        sendGroupCallDetailed: async (
          hash: string,
          msg: Record<string, unknown>
        ) => {
          sent.push({ hash, msg });
          if (hash === 'd:bad') {
            return {
              ok: false as const,
              reason: 'packet-send-false' as const,
              error: 'Packet send returned False',
            };
          }
          return { ok: true as const };
        },
        sendGroupCall: async () => true,
        warmGroupAudioPath: async () => ({ ok: true as const }),
        openGroupAudioLink: async () => ({
          ok: true as const,
          linkId: 'stub-link',
          established: true,
        }),
        closeGroupAudioLink: async () => ({ ok: true as const }),
        on: () => {},
        off: () => {},
      } as any
    );

    manager.setQortalGroupReticulumTargets('gcall-qortal-812', ['Q-peer']);
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(sent.some((e) => e.hash === 'd:bad')).toBe(true);
    expect(sent.some((e) => e.hash === 'd:good')).toBe(true);
    expect(sent.some((e) => e.msg.t === 'GJ')).toBe(true);
  });

  it('retries first-contact Reticulum join fanout after unknown peer discovery lag', async () => {
    vi.useFakeTimers();
    const sent: Array<{ hash: string; msg: Record<string, unknown> }> = [];
    let attempts = 0;
    const manager = new GroupCallManager(
      { send: () => {} } as any,
      reticulumAwarePresenceStub() as any,
      {
        getState: () => 'ready',
        sendGroupCallDetailed: async (
          hash: string,
          msg: Record<string, unknown>
        ) => {
          attempts += 1;
          sent.push({ hash, msg });
          if (attempts === 1) {
            return {
              ok: false as const,
              reason: 'unknown-peer-presence-hash',
              error: 'Unknown peer presence hash',
            };
          }
          return { ok: true as const };
        },
        sendGroupCall: async () => true,
        warmGroupAudioPath: async () => ({ ok: true as const }),
        openGroupAudioLink: async () => ({
          ok: true as const,
          linkId: 'stub-link',
          established: true,
        }),
        closeGroupAudioLink: async () => ({ ok: true as const }),
        on: () => {},
        off: () => {},
      } as any
    );

    manager.setQortalGroupReticulumTargets('gcall-qortal-812', ['Q-peer']);
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );

    expect(attempts).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBeGreaterThan(1);
    expect(sent.some((entry) => entry.msg.t === 'GJ')).toBe(true);
  });

  it('reuses the peer presence hash learned from verified inbound Reticulum join traffic', async () => {
    class ReticulumBridgeStub extends EventEmitter {
      sendGroupCallDetailed = vi.fn(async () => ({ ok: true as const }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'stub-link',
        established: true,
      }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));

      getState() {
        return 'ready' as const;
      }

      sendGroupCall(hash: string, msg: Record<string, unknown>) {
        return Promise.resolve(true);
      }
    }

    const bridge = new ReticulumBridgeStub();
    const manager = new GroupCallManager(
      { send: () => {} } as any,
      {
        on: () => {},
        off: () => {},
        getRouteForAddress: () => null,
        getReticulumActiveNeighborHashes: () => ['d:Q-peer'],
        getNodeIdForAddress: () => null,
      } as any,
      bridge as any
    );

    manager.start();
    (manager as any).verifyPool.verify = vi.fn(async () => true);
    manager.setLocalAddresses(['Q-self']);
    const now = Date.now();
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-self',
      'sig',
      'pk',
      now,
      TEST_D32
    );

    bridge.emit(
      'group-call-message',
      encodeJoinWire({
        roomId: 'gcall-qortal-812',
        chatId: 'chat-812',
        fromAddress: 'Q-peer',
        fromPublicKey: 'pk-peer',
        signature: 'sig-peer',
        timestamp: now + 1,
        reticulumDestinationHash: 'b'.repeat(32),
      }),
      'call-peer',
      'd:Q-peer'
    );
    await Promise.resolve();
    await Promise.resolve();

    manager.sendKey(
      'gcall-qortal-812',
      'Q-peer',
      'ciphertext',
      'Q-self',
      'sig-self',
      'pk-self',
      now + 2,
      {
        keyMessageVersion: 1,
        callSessionId: 'call-session',
        mediaSessionGeneration: 1,
        keyCommitment: 'commitment',
        encryptedKeyDigest: 'digest',
      }
    );
    await Promise.resolve();

    expect(bridge.sendGroupCallDetailed).toHaveBeenCalledWith(
      'd:Q-peer',
      expect.objectContaining({ t: 'GK' })
    );
    manager.stop();
  });
});

describe('retained verified key replay', () => {
  it('replays the latest retained authoritative key state to a late subscriber', () => {
    const manager = new GroupCallManager(
      { send: () => {} } as any,
      reticulumAwarePresenceStub() as any,
      reticulumBridgeReadyStub([]) as any
    );

    manager.joinRoom(
      'room-1',
      'chat-1',
      'Q-self',
      'sig',
      'pk-self',
      100,
      TEST_D32
    );
    manager.broadcastTopology(
      'room-1',
      {
        fromAddress: 'Q-root',
        topologyEpoch: 1,
        rootForwarder: 'Q-root',
        standbyForwarder: 'Q-self',
        clusters: [],
        lastSeen: 101,
      },
      'sig',
      'pk-root',
      101
    );

    (manager as any).applyVerifiedKey({
      roomId: 'room-1',
      toAddress: 'Q-self',
      fromAddress: 'Q-root',
      fromPublicKey: 'pk-root',
      encryptedKey: 'ciphertext',
      signature: 'sig-root',
      timestamp: 102,
      keyMessageVersion: 3,
      callSessionId: 'session-1',
      mediaSessionGeneration: 1,
      keyCommitment: 'commitment-1',
    });

    const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
    manager.replayRetainedVerifiedKeyStatesTo({
      id: 7,
      send: (channel, payload) =>
        sent.push({ channel, payload: payload as Record<string, unknown> }),
    });

    expect(sent).toEqual([
      {
        channel: 'gcall:key',
        payload: expect.objectContaining({
          roomId: 'room-1',
          fromAddress: 'Q-root',
          encryptedKey: 'ciphertext',
          deliveryKind: 'retained-state',
          replayReason: 'subscribe',
          verified: true,
        }),
      },
    ]);
  });

  it('drops retained verified key replay after authoritative root changes', () => {
    const manager = new GroupCallManager(
      { send: () => {} } as any,
      reticulumAwarePresenceStub() as any,
      reticulumBridgeReadyStub([]) as any
    );

    manager.joinRoom(
      'room-2',
      'chat-2',
      'Q-self',
      'sig',
      'pk-self',
      100,
      TEST_D32
    );
    manager.broadcastTopology(
      'room-2',
      {
        fromAddress: 'Q-root-a',
        topologyEpoch: 1,
        rootForwarder: 'Q-root-a',
        standbyForwarder: 'Q-self',
        clusters: [],
        lastSeen: 101,
      },
      'sig',
      'pk-root-a',
      101
    );

    (manager as any).applyVerifiedKey({
      roomId: 'room-2',
      toAddress: 'Q-self',
      fromAddress: 'Q-root-a',
      fromPublicKey: 'pk-root-a',
      encryptedKey: 'ciphertext-a',
      signature: 'sig-root-a',
      timestamp: 102,
      keyMessageVersion: 3,
      callSessionId: 'session-1',
      mediaSessionGeneration: 1,
      keyCommitment: 'commitment-a',
    });

    manager.broadcastTopology(
      'room-2',
      {
        fromAddress: 'Q-root-b',
        topologyEpoch: 2,
        rootForwarder: 'Q-root-b',
        standbyForwarder: 'Q-self',
        clusters: [],
        lastSeen: 103,
      },
      'sig',
      'pk-root-b',
      103
    );

    const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
    manager.replayRetainedVerifiedKeyStatesTo({
      id: 8,
      send: (channel, payload) =>
        sent.push({ channel, payload: payload as Record<string, unknown> }),
    });

    expect(sent).toEqual([]);
  });
});

describe('Reticulum group audio transport', () => {
  it('opens a persistent Reticulum audio link and sends queued audio', async () => {
    class ReticulumAudioBridgeStub extends EventEmitter {
      getState() {
        return 'ready' as const;
      }
      sendGroupCallDetailed() {
        return Promise.resolve({ ok: true as const });
      }
      sendGroupCall() {
        return Promise.resolve(true);
      }
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'link-1',
        established: true,
      }));
      getAudioQueueSnapshot = vi.fn(() => ({
        bridgeQueuedFrames: 0,
        bridgeQueuedBytes: 0,
        bridgeBinaryWritesQueued: 0,
        bridgeWaitingForDrain: false,
        perLinkQueuedFrames: 0,
        queuePressureDrops: 0,
        queuePressureDropsLast5s: 0,
        staleDrops: 0,
        staleDropsLast5s: 0,
        decodedQueueDepth: 0,
        decodedQueueMax: 48,
        decodedQueueDrops: 0,
        binaryOutQueueDepth: 0,
        binaryOutQueueMax: 128,
        binaryOutQueueDrops: 0,
        jsonOutQueueDrops: 0,
        packetSendFailures: 0,
        packetPathRequests: 0,
        packetPathResolutions: 0,
        packetPathTimeouts: 0,
        packetFreshSends: 0,
        packetStaleSends: 0,
        packetUnknownSends: 0,
      }));
      enqueueGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      enqueuePacketGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));
    }

    const bridge = new ReticulumAudioBridgeStub();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      bridge as any
    );

    manager.setLocalAddresses(['Q-self']);
    manager.joinRoom(
      'room-1',
      'chat-1',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );

    const ok = manager.sendAudio('room-1', 'Q-peer', Buffer.from([1, 2, 3]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(ok).toMatchObject({
      success: true,
      diagnostics: expect.objectContaining({
        transport: 'packet',
        targetAddress: 'Q-peer',
        pendingFrames: 0,
        queuePressureDrops: 0,
        staleDrops: 0,
        linkUnreadyDrops: 0,
      }),
    });
    expect(bridge.openGroupAudioLink).toHaveBeenCalledWith('d:Q-peer');
    expect(bridge.warmGroupAudioPath).toHaveBeenCalledWith('d:Q-peer');
    expect(bridge.enqueuePacketGroupAudio).toHaveBeenCalledWith(
      'd:Q-peer',
      'room-1',
      Buffer.from([1, 2, 3]),
      ''
    );
  });

  it('buffers audio until the verified Reticulum identity hash is known', async () => {
    class ReticulumAudioBridgeStub extends EventEmitter {
      getState() {
        return 'ready' as const;
      }
      sendGroupCallDetailed() {
        return Promise.resolve({ ok: true as const });
      }
      sendGroupCall() {
        return Promise.resolve(true);
      }
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'link-1',
        established: true,
      }));
      getAudioQueueSnapshot = vi.fn(() => ({
        bridgeQueuedFrames: 0,
        bridgeQueuedBytes: 0,
        bridgeBinaryWritesQueued: 0,
        bridgeWaitingForDrain: false,
        perLinkQueuedFrames: 0,
        queuePressureDrops: 0,
        queuePressureDropsLast5s: 0,
        staleDrops: 0,
        staleDropsLast5s: 0,
        decodedQueueDepth: 0,
        decodedQueueMax: 48,
        decodedQueueDrops: 0,
        binaryOutQueueDepth: 0,
        binaryOutQueueMax: 128,
        binaryOutQueueDrops: 0,
        jsonOutQueueDrops: 0,
        packetSendFailures: 0,
        packetPathRequests: 0,
        packetPathResolutions: 0,
        packetPathTimeouts: 0,
        packetFreshSends: 0,
        packetStaleSends: 0,
        packetUnknownSends: 0,
      }));
      enqueueGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      enqueuePacketGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));
    }

    const bridge = new ReticulumAudioBridgeStub();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      {
        on: () => {},
        off: () => {},
        getRouteForAddress: () => null,
        getReticulumActiveNeighborHashes: () => [],
        getNodeIdForAddress: () => null,
      } as any,
      bridge as any
    );

    manager.setLocalAddresses(['Q-self']);
    manager.joinRoom(
      'room-1',
      'chat-1',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );

    const first = manager.sendAudio('room-1', 'Q-peer', Buffer.from([1, 2, 3]));

    expect(first).toMatchObject({
      success: true,
      diagnostics: expect.objectContaining({
        targetAddress: 'Q-peer',
        pendingFrames: 1,
        recoveryReason: 'awaiting-reticulum-identity',
      }),
    });
    expect(bridge.enqueuePacketGroupAudio).not.toHaveBeenCalled();

    (manager as any).rememberReticulumPeerPresenceHash('Q-peer', TEST_D32);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(bridge.warmGroupAudioPath).toHaveBeenCalledWith(TEST_D32);
    expect(bridge.enqueuePacketGroupAudio).toHaveBeenCalledWith(
      TEST_D32,
      'room-1',
      Buffer.from([1, 2, 3]),
      ''
    );
  });

  it('falls back to the audio link when packet path never resolves', async () => {
    class ReticulumAudioBridgeStub extends EventEmitter {
      getState() {
        return 'ready' as const;
      }
      sendGroupCallDetailed() {
        return Promise.resolve({ ok: true as const });
      }
      sendGroupCall() {
        return Promise.resolve(true);
      }
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'link-1',
        established: true,
      }));
      getAudioQueueSnapshot = vi.fn(() => ({
        bridgeQueuedFrames: 0,
        bridgeQueuedBytes: 0,
        bridgeBinaryWritesQueued: 0,
        bridgeWaitingForDrain: false,
        perLinkQueuedFrames: 0,
        queuePressureDrops: 0,
        queuePressureDropsLast5s: 0,
        staleDrops: 0,
        staleDropsLast5s: 0,
        decodedQueueDepth: 0,
        decodedQueueMax: 48,
        decodedQueueDrops: 0,
        binaryOutQueueDepth: 0,
        binaryOutQueueMax: 128,
        binaryOutQueueDrops: 0,
        jsonOutQueueDrops: 0,
        packetSendFailures: 0,
        packetPathRequests: 3,
        packetPathResolutions: 0,
        packetPathTimeouts: 4,
        packetFreshSends: 0,
        packetStaleSends: 0,
        packetUnknownSends: 2,
      }));
      enqueueGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      enqueuePacketGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));
    }

    const bridge = new ReticulumAudioBridgeStub();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      bridge as any
    );

    manager.setLocalAddresses(['Q-self']);
    manager.joinRoom(
      'room-1',
      'chat-1',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );

    manager.sendAudio('room-1', 'Q-peer', Buffer.from([1, 2, 3]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const second = manager.sendAudio('room-1', 'Q-peer', Buffer.from([4, 5, 6]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(bridge.openGroupAudioLink).toHaveBeenCalledWith('d:Q-peer');
    expect(bridge.enqueuePacketGroupAudio).toHaveBeenCalledTimes(1);
    expect(bridge.enqueueGroupAudio).toHaveBeenCalledWith(
      'link-1',
      'room-1',
      Buffer.from([4, 5, 6])
    );
    expect(second).toMatchObject({
      success: true,
      diagnostics: expect.objectContaining({
        transport: 'link',
        targetAddress: 'Q-peer',
      }),
    });
  });

  it('emits inbound Reticulum audio as gcall:audio with the mapped sender address', async () => {
    class ReticulumAudioBridgeStub extends EventEmitter {
      getState() {
        return 'ready' as const;
      }
      sendGroupCallDetailed() {
        return Promise.resolve({ ok: true as const });
      }
      sendGroupCall() {
        return Promise.resolve(true);
      }
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'link-1',
        established: true,
      }));
      getAudioQueueSnapshot = vi.fn(() => ({
        bridgeQueuedFrames: 0,
        bridgeQueuedBytes: 0,
        bridgeBinaryWritesQueued: 0,
        bridgeWaitingForDrain: false,
        perLinkQueuedFrames: 0,
        queuePressureDrops: 0,
        queuePressureDropsLast5s: 0,
        staleDrops: 0,
        staleDropsLast5s: 0,
        decodedQueueDepth: 0,
        decodedQueueMax: 48,
        decodedQueueDrops: 0,
        binaryOutQueueDepth: 0,
        binaryOutQueueMax: 128,
        binaryOutQueueDrops: 0,
        jsonOutQueueDrops: 0,
        packetSendFailures: 0,
        packetPathRequests: 0,
        packetPathResolutions: 0,
        packetPathTimeouts: 0,
        packetFreshSends: 0,
        packetStaleSends: 0,
        packetUnknownSends: 0,
      }));
      enqueueGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      enqueuePacketGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));
    }

    const bridge = new ReticulumAudioBridgeStub();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      bridge as any
    );
    const seen: Array<Record<string, unknown>> = [];
    manager.on('gcall:audio', (payload) => {
      seen.push(payload as Record<string, unknown>);
    });

    manager.start();
    manager.setLocalAddresses(['Q-self']);
    manager.joinRoom(
      'room-1',
      'chat-1',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );
    manager.sendAudio('room-1', 'Q-peer', Buffer.from([4, 5, 6]));
    await Promise.resolve();
    await Promise.resolve();

    bridge.emit('group-audio-packet', {
      linkId: 'link-1',
      roomId: 'room-1',
      data: Buffer.from([7, 8, 9]),
      peerPresenceHash: 'd:Q-peer',
      peerDestinationHash: 'call-peer',
      incoming: true,
    });

    expect(seen).toEqual([
      {
        roomId: 'room-1',
        data: Buffer.from([7, 8, 9]),
        transport: 'link',
        routeKey: 'link-1',
        peerPresenceHash: 'd:Q-peer',
        peerDestinationHash: 'call-peer',
        resolvedFromAddress: 'Q-peer',
        fromAddress: 'Q-peer',
      },
    ]);
    manager.stop();
  });

  it('emits packet-mode inbound Reticulum audio with route metadata', async () => {
    class ReticulumAudioBridgeStub extends EventEmitter {
      getState() {
        return 'ready' as const;
      }
      sendGroupCallDetailed() {
        return Promise.resolve({ ok: true as const });
      }
      sendGroupCall() {
        return Promise.resolve(true);
      }
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'link-1',
        established: true,
      }));
      getAudioQueueSnapshot = vi.fn(() => ({
        bridgeQueuedFrames: 0,
        bridgeQueuedBytes: 0,
        bridgeBinaryWritesQueued: 0,
        bridgeWaitingForDrain: false,
        perLinkQueuedFrames: 0,
        queuePressureDrops: 0,
        queuePressureDropsLast5s: 0,
        staleDrops: 0,
        staleDropsLast5s: 0,
        decodedQueueDepth: 0,
        decodedQueueMax: 48,
        decodedQueueDrops: 0,
        binaryOutQueueDepth: 0,
        binaryOutQueueMax: 128,
        binaryOutQueueDrops: 0,
        jsonOutQueueDrops: 0,
        packetSendFailures: 0,
        packetPathRequests: 0,
        packetPathResolutions: 0,
        packetPathTimeouts: 0,
        packetFreshSends: 0,
        packetStaleSends: 0,
        packetUnknownSends: 0,
      }));
      enqueueGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      enqueuePacketGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));
    }

    const bridge = new ReticulumAudioBridgeStub();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      bridge as any
    );
    const seen: Array<Record<string, unknown>> = [];
    manager.on('gcall:audio', (payload) => {
      seen.push(payload as Record<string, unknown>);
    });

    manager.start();
    manager.setLocalAddresses(['Q-self']);
    manager.joinRoom(
      'room-1',
      'chat-1',
      'Q-self',
      'sig',
      'pk',
      100,
      TEST_D32
    );
    manager.sendAudio('room-1', 'Q-peer', Buffer.from([4, 5, 6]));
    await Promise.resolve();
    await Promise.resolve();

    bridge.emit('group-audio-packet', {
      linkId: '',
      routeKey: 'packet:d:Q-peer',
      transport: 'packet',
      roomId: 'room-1',
      data: Buffer.from([7, 8, 9]),
      peerPresenceHash: 'd:Q-peer',
      peerDestinationHash: 'call-peer',
      incoming: true,
    });

    expect(seen).toEqual([
      {
        roomId: 'room-1',
        data: Buffer.from([7, 8, 9]),
        transport: 'packet',
        routeKey: 'packet:d:Q-peer',
        peerPresenceHash: 'd:Q-peer',
        peerDestinationHash: 'call-peer',
        resolvedFromAddress: 'Q-peer',
        fromAddress: 'Q-peer',
      },
    ]);
    manager.stop();
  });

  it('resolves DM voice inbound audio from room id when peerPresenceHash is empty', async () => {
    class ReticulumAudioBridgeStub extends EventEmitter {
      getState() {
        return 'ready' as const;
      }
      sendGroupCallDetailed() {
        return Promise.resolve({ ok: true as const });
      }
      sendGroupCall() {
        return Promise.resolve(true);
      }
      openGroupAudioLink = vi.fn(async () => ({
        ok: true as const,
        linkId: 'link-1',
        established: true,
      }));
      getAudioQueueSnapshot = vi.fn(() => ({
        bridgeQueuedFrames: 0,
        bridgeQueuedBytes: 0,
        bridgeBinaryWritesQueued: 0,
        bridgeWaitingForDrain: false,
        perLinkQueuedFrames: 0,
        queuePressureDrops: 0,
        queuePressureDropsLast5s: 0,
        staleDrops: 0,
        staleDropsLast5s: 0,
        decodedQueueDepth: 0,
        decodedQueueMax: 48,
        decodedQueueDrops: 0,
        binaryOutQueueDepth: 0,
        binaryOutQueueMax: 128,
        binaryOutQueueDrops: 0,
        jsonOutQueueDrops: 0,
        packetSendFailures: 0,
        packetPathRequests: 0,
        packetPathResolutions: 0,
        packetPathTimeouts: 0,
        packetFreshSends: 0,
        packetStaleSends: 0,
        packetUnknownSends: 0,
      }));
      enqueueGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      enqueuePacketGroupAudio = vi.fn(() => ({
        ok: true as const,
        dropped: false,
        queuePressureDrops: 0,
        staleDrops: 0,
        snapshot: this.getAudioQueueSnapshot(),
      }));
      warmGroupAudioPath = vi.fn(async () => ({ ok: true as const }));
      closeGroupAudioLink = vi.fn(async () => ({ ok: true as const }));
    }

    const bridge = new ReticulumAudioBridgeStub();
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      bridge as any
    );
    const seen: Array<Record<string, unknown>> = [];
    manager.on('gcall:audio', (payload) => {
      seen.push(payload as Record<string, unknown>);
    });

    const dmChatId = 'direct:Q-peer:Q-self';
    const dmRoomId = `dmv:${createHash('sha256').update(dmChatId, 'utf8').digest('hex').slice(0, 18)}`;

    manager.start();
    manager.setLocalAddresses(['Q-self']);
    manager.joinRoom(dmRoomId, dmChatId, 'Q-self', 'sig', 'pk', 100, TEST_D32);
    manager.sendAudio(dmRoomId, 'Q-peer', Buffer.from([1, 2, 3]));
    await Promise.resolve();
    await Promise.resolve();

    bridge.emit('group-audio-packet', {
      linkId: '',
      routeKey: 'packet:unknown',
      transport: 'packet',
      roomId: dmRoomId,
      data: Buffer.from([7, 8, 9]),
      peerPresenceHash: '',
      peerDestinationHash: '',
      incoming: true,
    });

    expect(seen).toEqual([
      {
        roomId: dmRoomId,
        data: Buffer.from([7, 8, 9]),
        transport: 'packet',
        routeKey: 'packet:unknown',
        peerPresenceHash: '',
        peerDestinationHash: '',
        resolvedFromAddress: 'Q-peer',
        fromAddress: 'Q-peer',
      },
    ]);
    manager.stop();
  });

  it('compact DM voice room id keeps GC_JOIN wire under Reticulum MDU (long direct chatId)', () => {
    /** Long peer addresses in `direct:A:B` (chatId) blow up legacy `R`+`H`; joiner `a` is normal length. */
    const longA = `QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP${'a'.repeat(66)}`;
    const longB = `QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs${'b'.repeat(66)}`;
    const chatId = `direct:${[longA, longB].sort().join(':')}`;
    const roomId = `dmv:${createHash('sha256').update(chatId, 'utf8').digest('hex').slice(0, 18)}`;
    const wireChatId = compactDmVoiceJoinWireChatId(roomId, chatId);
    const pk = 'k'.repeat(52);
    const sig = 's'.repeat(52);
    const common = {
      fromAddress: 'QLocalJoinerAddr34Chars000000000000',
      fromPublicKey: pk,
      signature: sig,
      timestamp: 1_700_000_000_000,
      reticulumDestinationHash: TEST_D32,
    };
    const wireLegacy = encodeJoinWire({
      roomId: `dmv:${chatId}`,
      chatId,
      ...common,
      joinGeneration: 0x9a8bcdef,
    });
    /** DM voice omits `j` on wire to stay under MDU (matches joinDirectVoiceReticulumRoom). */
    const wireCompact = encodeJoinWire({
      roomId,
      chatId: wireChatId,
      ...common,
    });
    const bytesLegacy = byteLengthUtf8JsonWithBridgeSender(wireLegacy);
    const bytesCompact = byteLengthUtf8JsonWithBridgeSender(wireCompact);
    expect(bytesLegacy).toBeGreaterThan(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    expect(bytesCompact).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    expect(bytesCompact).toBeLessThan(bytesLegacy - 100);
  });
});

describe('Reticulum group activity hints', () => {
  it('accepts fresh GA wires and rejects malformed or stale ones', () => {
    const now = 100_000;
    expect(
      decodeGcReticulumActivityWire({ t: 'GA', g: 812, m: now - 5_000 }, now)
    ).toEqual({
      groupId: 812,
      timestamp: now - 5_000,
    });
    expect(
      decodeGcReticulumActivityWire({ t: 'GA', g: 812.5, m: now }, now)
    ).toBeNull();
    expect(
      decodeGcReticulumActivityWire(
        { t: 'GA', g: 812, m: now - 130_000 },
        now
      )
    ).toBeNull();
  });

  it('feeds valid Reticulum hints into watched group activity snapshots', () => {
    const manager = new GroupCallManager(
      {
        send: () => {},
      } as any,
      reticulumAwarePresenceStub() as any,
      reticulumBridgeReadyStub([]) as any
    );
    expect(manager.setWatchedQortalGroupIds([812])).toEqual({});
    (manager as any).handleReticulumGroupCallWire(
      {
        t: 'GA',
        g: 812,
        m: Date.now(),
      },
      ''
    );
    expect(manager.setWatchedQortalGroupIds([812])).toEqual({
      '812': true,
    });
  });

  it('ignores relayed mesh control traffic for watched sidebar activity', () => {
    const relayed: unknown[] = [];
    const manager = new GroupCallManager(
      {
        send: (_nodeId: string | null, payload: unknown) => {
          relayed.push(payload);
        },
      } as any,
      reticulumAwarePresenceStub() as any,
      reticulumBridgeReadyStub([]) as any
    );
    expect(manager.setWatchedQortalGroupIds([812])).toEqual({});

    manager.handleIncoming({
      type: 'GC_JOIN',
      roomId: 'gcall-qortal-812',
      chatId: 'chat-812',
      fromAddress: 'Q-peer',
      fromPublicKey: 'pk-peer',
      signature: 'sig',
      timestamp: Date.now(),
      reticulumDestinationHash: TEST_D32,
      hopsRemaining: 2,
    });

    manager.handleIncoming({
      type: 'GC_TOPOLOGY',
      roomId: 'gcall-qortal-812',
      fromAddress: 'Q-peer',
      fromPublicKey: 'pk-peer',
      signature: 'sig',
      timestamp: Date.now(),
      topologyEpoch: 1,
      rootForwarder: 'Q-peer',
      standbyForwarder: 'Q-peer2',
      clusters: [],
      lastSeen: Date.now(),
      hopsRemaining: 2,
    });

    expect(relayed.length).toBe(0);
    expect(manager.setWatchedQortalGroupIds([812])).toEqual({});
  });
});

describe('getReticulumOverlayLogicalDedupeKey', () => {
  it('uses the signature for single-frame signed wires', () => {
    expect(
      getReticulumOverlayLogicalDedupeKey({
        t: 'GJ',
        g: 'sig-1',
        X: 'overlay-a',
        L: 3,
        r: 'peer-hash',
      })
    ).toBe('GJ:g:sig-1');
  });

  it('uses the fragment digest and part index for multipart payload frames', () => {
    expect(
      getReticulumOverlayLogicalDedupeKey({
        t: 'GT0',
        z: 'digest-1',
        X: 'overlay-a',
        L: 3,
      })
    ).toBe('GT0:z:digest-1');
    expect(
      getReticulumOverlayLogicalDedupeKey({
        t: 'GT1',
        z: 'digest-1',
        x: 2,
        X: 'overlay-b',
        L: 2,
      })
    ).toBe('GT1:z:digest-1:x:2');
  });

  it('does not dedupe unsigned activity hints by logical body', () => {
    expect(
      getReticulumOverlayLogicalDedupeKey({
        t: 'GA',
        g: 812,
        m: 1000,
        X: 'overlay-a',
        L: 3,
      })
    ).toBeNull();
  });
});

describe('pendingKeyEnvelopeWinsOver', () => {
  it('prefers strictly higher mediaSessionGeneration regardless of timestamp', () => {
    expect(
      pendingKeyEnvelopeWinsOver(
        { mediaSessionGeneration: 2, timestamp: 100 },
        { mediaSessionGeneration: 1, timestamp: 9_999 }
      )
    ).toBe(true);
    expect(
      pendingKeyEnvelopeWinsOver(
        { mediaSessionGeneration: 1, timestamp: 9_999 },
        { mediaSessionGeneration: 2, timestamp: 100 }
      )
    ).toBe(false);
  });

  it('on equal generation prefers newer timestamp', () => {
    expect(
      pendingKeyEnvelopeWinsOver(
        { mediaSessionGeneration: 3, timestamp: 200 },
        { mediaSessionGeneration: 3, timestamp: 100 }
      )
    ).toBe(true);
    expect(
      pendingKeyEnvelopeWinsOver(
        { mediaSessionGeneration: 3, timestamp: 100 },
        { mediaSessionGeneration: 3, timestamp: 200 }
      )
    ).toBe(false);
  });

  it('on equal generation and timestamp does not replace', () => {
    expect(
      pendingKeyEnvelopeWinsOver(
        { mediaSessionGeneration: 1, timestamp: 50 },
        { mediaSessionGeneration: 1, timestamp: 50 }
      )
    ).toBe(false);
  });
});

describe('chooseMainTopologyAuthority', () => {
  it('breaks same-epoch root conflicts by higher lastSeen before digest tie-break', () => {
    expect(
      chooseMainTopologyAuthority(
        {
          topologyEpoch: 11,
          rootForwarder: 'alpha',
          lastSeen: 1_000,
        },
        {
          topologyEpoch: 11,
          rootForwarder: 'beta',
          lastSeen: 2_000,
        },
        'gcall-qortal-812'
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'lastSeen-root-conflict',
    });
  });

  it('keeps newer same-root heartbeats and rejects stale epochs', () => {
    expect(
      chooseMainTopologyAuthority(
        {
          topologyEpoch: 11,
          rootForwarder: 'root-a',
          lastSeen: 1_000,
        },
        {
          topologyEpoch: 11,
          rootForwarder: 'root-a',
          lastSeen: 2_000,
        },
        'gcall-qortal-812'
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'lastSeen',
    });

    expect(
      chooseMainTopologyAuthority(
        {
          topologyEpoch: 11,
          rootForwarder: 'root-a',
          lastSeen: 1_000,
        },
        {
          topologyEpoch: 10,
          rootForwarder: 'root-b',
          lastSeen: 2_000,
        },
        'gcall-qortal-812'
      )
    ).toEqual({
      acceptIncoming: false,
      reason: 'stale-epoch',
    });
  });
});

describe('gcJoinTimestampRejectReason', () => {
  const t0 = 1_000_000;

  it('accepts fresh timestamps', () => {
    expect(gcJoinTimestampRejectReason(t0, t0)).toBeNull();
    expect(gcJoinTimestampRejectReason(t0, t0 + GC_JOIN_MAX_AGE_MS)).toBeNull();
    expect(gcJoinTimestampRejectReason(t0, t0 + 29_000)).toBeNull();
  });

  it('rejects too old', () => {
    expect(gcJoinTimestampRejectReason(t0, t0 + GC_JOIN_MAX_AGE_MS + 1)).toBe(
      'expired'
    );
  });

  it('rejects too far in the future', () => {
    expect(gcJoinTimestampRejectReason(t0 + 31_000, t0)).toBe('future');
  });
});

describe('shouldIgnoreLeaveForLocalAddress', () => {
  it('ignores relayed leave for the active local address', () => {
    expect(
      shouldIgnoreLeaveForLocalAddress(new Set(['Q-local']), 'Q-local')
    ).toBe(true);
  });

  it('does not ignore leave for a remote participant', () => {
    expect(
      shouldIgnoreLeaveForLocalAddress(new Set(['Q-local']), 'Q-remote')
    ).toBe(false);
  });
});

describe('shouldRefreshParticipantFromVerifiedJoin', () => {
  it('refreshes room participant state for newer rejoins', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 100,
        incomingJoinTimestamp: 200,
      })
    ).toBe(true);
  });

  it('does not regress room participant state for older duplicate joins', () => {
    expect(
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: 200,
        incomingJoinTimestamp: 100,
      })
    ).toBe(false);
  });
});

describe('shouldApplyVerifiedLeaveToParticipant', () => {
  it('accepts a leave for the active participant session', () => {
    expect(
      shouldApplyVerifiedLeaveToParticipant({
        participantJoinedAt: 100,
        leaveTimestamp: 100,
      })
    ).toBe(true);
    expect(
      shouldApplyVerifiedLeaveToParticipant({
        participantJoinedAt: 100,
        leaveTimestamp: 150,
      })
    ).toBe(true);
  });

  it('rejects stale leaves from before a rejoin', () => {
    expect(
      shouldApplyVerifiedLeaveToParticipant({
        participantJoinedAt: 200,
        leaveTimestamp: 150,
      })
    ).toBe(false);
  });
});

describe('getLocalSessionBreakMediaSessionGeneration', () => {
  it('does not bump the local generation ahead of the mesh', () => {
    expect(getLocalSessionBreakMediaSessionGeneration(7)).toBe(7);
  });

  it('normalizes an invalid zero generation to one', () => {
    expect(getLocalSessionBreakMediaSessionGeneration(0)).toBe(1);
  });
});

describe('shouldDelayPresenceEvictionForHealthyTransport', () => {
  it('delays eviction when the peer was recently reported healthy', () => {
    expect(
      shouldDelayPresenceEvictionForHealthyTransport({
        lastReportAtMs: 10_000,
        healthyPeerAddresses: new Set(['Q-remote']),
        address: 'Q-remote',
        nowMs: 22_000,
        staleAfterMs: 15_000,
      })
    ).toBe(true);
  });

  it('does not delay eviction when the transport report is stale', () => {
    expect(
      shouldDelayPresenceEvictionForHealthyTransport({
        lastReportAtMs: 10_000,
        healthyPeerAddresses: new Set(['Q-remote']),
        address: 'Q-remote',
        nowMs: 26_000,
        staleAfterMs: 15_000,
      })
    ).toBe(false);
  });

  it('does not delay eviction for peers missing from the healthy set', () => {
    expect(
      shouldDelayPresenceEvictionForHealthyTransport({
        lastReportAtMs: 10_000,
        healthyPeerAddresses: new Set(['Q-other']),
        address: 'Q-remote',
        nowMs: 12_000,
        staleAfterMs: 15_000,
      })
    ).toBe(false);
  });
});

describe('shouldHoldAudioForReticulumRecoveryReason', () => {
  it('returns false for path-warm and topology-tagged warm reasons', () => {
    expect(
      shouldHoldAudioForReticulumRecoveryReason('topology-startup-warm')
    ).toBe(false);
    expect(
      shouldHoldAudioForReticulumRecoveryReason('topology-root-inbound-warm')
    ).toBe(false);
    expect(
      shouldHoldAudioForReticulumRecoveryReason(
        'topology-root-inbound-stress-warm'
      )
    ).toBe(false);
    expect(
      shouldHoldAudioForReticulumRecoveryReason('topology-predictive-warm')
    ).toBe(false);
    expect(
      shouldHoldAudioForReticulumRecoveryReason('peer-joined-inbound-warm')
    ).toBe(false);
    expect(
      shouldHoldAudioForReticulumRecoveryReason('peer-joined-startup-warm')
    ).toBe(false);
  });

  it('returns true for stall and window recovery reasons', () => {
    expect(
      shouldHoldAudioForReticulumRecoveryReason('window-media-recovery')
    ).toBe(true);
    expect(
      shouldHoldAudioForReticulumRecoveryReason('live-source-stall')
    ).toBe(true);
    expect(shouldHoldAudioForReticulumRecoveryReason('')).toBe(true);
  });
});
