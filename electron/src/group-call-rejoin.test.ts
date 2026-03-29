import { describe, expect, it } from 'vitest';
import {
  buildGroupRoomBootstrapState,
  chooseMainTopologyAuthority,
  GC_JOIN_MAX_AGE_MS,
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
    const sent: unknown[] = [];
    const manager = new GroupCallManager(
      {
        send: (_nodeId: string | null, payload: unknown) => {
          sent.push(payload);
        },
      } as any,
      {} as any
    );

    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user1', 'sig', 'pk1', 100);
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user2', 'sig', 'pk2', 200);
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user3', 'sig', 'pk3', 300);

    manager.leaveRoom('gcall-qortal-812', 'Q-user3', 'sig', 'pk3', 400);

    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user3', 'sig', 'pk3', 500);

    expect(sent.length).toBeGreaterThan(0);
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
      {} as any
    );

    const firstJoin = manager.joinRoom(
      'gcall-qortal-812',
      'chat-812',
      'Q-root',
      'sig',
      'pk-root',
      t0
    );
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user2', 'sig', 'pk2', t0 + 100);
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user3', 'sig', 'pk3', t0 + 200);

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
    manager.joinRoom('gcall-qortal-812', 'chat-812', 'Q-user3', 'sig', 'pk3', t0 + 500);

    const bootstrap = manager.getRoomBootstrapState('gcall-qortal-812');

    expect(bootstrap).toMatchObject({
      participants: [{ address: 'Q-user3', publicKey: 'pk3', joinedAt: t0 + 500 }],
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
    expect(gcJoinTimestampRejectReason(t0, t0 + GC_JOIN_MAX_AGE_MS + 1)).toBe('expired');
  });

  it('rejects too far in the future', () => {
    expect(gcJoinTimestampRejectReason(t0 + 31_000, t0)).toBe('future');
  });
});

describe('shouldIgnoreLeaveForLocalAddress', () => {
  it('ignores relayed leave for the active local address', () => {
    expect(
      shouldIgnoreLeaveForLocalAddress(
        new Set(['Q-local']),
        'Q-local'
      )
    ).toBe(true);
  });

  it('does not ignore leave for a remote participant', () => {
    expect(
      shouldIgnoreLeaveForLocalAddress(
        new Set(['Q-local']),
        'Q-remote'
      )
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
