import { describe, expect, it } from 'vitest';
import {
  chooseMainTopologyAuthority,
  GC_JOIN_MAX_AGE_MS,
  gcJoinTimestampRejectReason,
  getLocalSessionBreakMediaSessionGeneration,
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
