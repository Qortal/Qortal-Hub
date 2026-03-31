import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildGroupRoomBootstrapState,
  chooseMainTopologyAuthority,
  GC_JOIN_MAX_AGE_MS,
  decodeGcReticulumActivityWire,
  gcJoinTimestampRejectReason,
  getLocalSessionBreakMediaSessionGeneration,
  GroupCallManager,
  isRecentRoomStateFresh,
  mergeRoomTopologyEpochWithFloor,
  pendingKeyEnvelopeWinsOver,
  shouldDelayPresenceEvictionForHealthyTransport,
  shouldApplyVerifiedLeaveToParticipant,
  shouldIgnoreLeaveForLocalAddress,
  shouldRefreshParticipantFromVerifiedJoin,
} from './group-call';
import { encodeJoinWire } from './group-call-wire-reticulum';

function reticulumAwarePresenceStub(): PresenceStub {
  return {
    on: () => {},
    off: () => {},
    getRouteForAddress: (address: string) => ({
      kind: 'reticulum' as const,
      destinationHash: `d:${address}`,
    }),
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
          ['Q-self', { publicKey: 'pk-self', joinedAt: 100 }],
          ['Q-root', { publicKey: 'pk-root', joinedAt: 200 }],
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
        { address: 'Q-self', publicKey: 'pk-self', joinedAt: 100 },
        { address: 'Q-root', publicKey: 'pk-root', joinedAt: 200 },
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
      100
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user2',
      'sig',
      'pk2',
      200
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      300
    );

    manager.leaveRoom('gcall-qortal-812', 'Q-user3', 'sig', 'pk3', 400);

    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      500
    );

    expect(reticulumSent.length).toBeGreaterThan(0);
    expect(manager.getRoomParticipants('gcall-qortal-812')).toEqual([
      { address: 'Q-user3', publicKey: 'pk3' },
    ]);
    expect(manager.getRoomBootstrapState('gcall-qortal-812')).toMatchObject({
      participants: [{ address: 'Q-user3', publicKey: 'pk3', joinedAt: 500 }],
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
      t0
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user2',
      'sig',
      'pk2',
      t0 + 100
    );
    manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-user3',
      'sig',
      'pk3',
      t0 + 200
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
      t0 + 500
    );

    const bootstrap = manager.getRoomBootstrapState('gcall-qortal-812');

    expect(bootstrap).toMatchObject({
      participants: [
        { address: 'Q-user3', publicKey: 'pk3', joinedAt: t0 + 500 },
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
        on: () => {},
        off: () => {},
      } as any
    );

    manager.setQortalGroupReticulumTargets('gcall-qortal-812', ['Q-peer']);
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-self', 'sig', 'pk', 100);

    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBeGreaterThan(1);
    expect(sent.some((entry) => entry.msg.t === 'GJ')).toBe(true);
  });

  it('reuses the peer presence hash learned from verified inbound Reticulum join traffic', async () => {
    class ReticulumBridgeStub extends EventEmitter {
      sendGroupCallDetailed = vi.fn(async () => ({ ok: true as const }));

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
        getNodeIdForAddress: () => null,
      } as any,
      bridge as any
    );

    manager.start();
    (manager as any).verifyPool.verify = vi.fn(async () => true);
    manager.setLocalAddresses(['Q-self']);
    const now = Date.now();
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-self', 'sig', 'pk', now);

    bridge.emit(
      'group-call-message',
      encodeJoinWire({
        roomId: 'gcall-qortal-812',
        chatId: 'chat-812',
        fromAddress: 'Q-peer',
        fromPublicKey: 'pk-peer',
        signature: 'sig-peer',
        timestamp: now + 1,
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
      sendGroupAudio = vi.fn(async () => ({ ok: true as const }));
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
    manager.joinRoom('room-1', 'chat-1', 'Q-self', 'sig', 'pk', 100);

    const ok = manager.sendAudio('room-1', 'Q-peer', Buffer.from([1, 2, 3]));
    await Promise.resolve();
    await Promise.resolve();

    expect(ok).toBe(true);
    expect(bridge.openGroupAudioLink).toHaveBeenCalledWith('d:Q-peer');
    expect(bridge.sendGroupAudio).toHaveBeenCalledWith(
      'link-1',
      'room-1',
      Buffer.from([1, 2, 3]).toString('base64')
    );
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
      sendGroupAudio = vi.fn(async () => ({ ok: true as const }));
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
    manager.joinRoom('room-1', 'chat-1', 'Q-self', 'sig', 'pk', 100);
    manager.sendAudio('room-1', 'Q-peer', Buffer.from([4, 5, 6]));
    await Promise.resolve();
    await Promise.resolve();

    bridge.emit('group-audio-packet', {
      linkId: 'link-1',
      roomId: 'room-1',
      data: Buffer.from([7, 8, 9]).toString('base64'),
      peerPresenceHash: 'd:Q-peer',
      peerCallHash: 'call-peer',
      incoming: true,
    });

    expect(seen).toEqual([
      {
        roomId: 'room-1',
        data: Buffer.from([7, 8, 9]),
        fromAddress: 'Q-peer',
      },
    ]);
    manager.stop();
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
      decodeGcReticulumActivityWire({ t: 'GA', g: 812, m: now - 50_000 }, now)
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
  it('breaks same-epoch root conflicts deterministically', () => {
    expect(
      chooseMainTopologyAuthority(
        {
          topologyEpoch: 11,
          rootForwarder: 'root-b',
          lastSeen: 1_000,
        },
        {
          topologyEpoch: 11,
          rootForwarder: 'root-a',
          lastSeen: 2_000,
        }
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
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
        }
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
        }
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
