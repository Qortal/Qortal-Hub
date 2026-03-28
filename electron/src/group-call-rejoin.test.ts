import { describe, expect, it } from 'vitest';
import {
  GC_JOIN_MAX_AGE_MS,
  gcJoinTimestampRejectReason,
  getLocalSessionBreakMediaSessionGeneration,
  mergeRoomTopologyEpochWithFloor,
  pendingKeyEnvelopeWinsOver,
  shouldIgnoreLeaveForLocalAddress,
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

describe('getLocalSessionBreakMediaSessionGeneration', () => {
  it('does not bump the local generation ahead of the mesh', () => {
    expect(getLocalSessionBreakMediaSessionGeneration(7)).toBe(7);
  });

  it('normalizes an invalid zero generation to one', () => {
    expect(getLocalSessionBreakMediaSessionGeneration(0)).toBe(1);
  });
});
