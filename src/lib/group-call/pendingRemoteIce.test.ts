import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_REMOTE_ICE_MAX_PER_KEY,
  clearPendingRemoteIceSession,
  drainPendingRemoteIceSession,
  pendingRemoteIceKey,
  pushPendingRemoteIceCandidate,
} from './pendingRemoteIce';

describe('pendingRemoteIce', () => {
  it('builds stable keys', () => {
    expect(pendingRemoteIceKey('a', 'c1')).toBe('a\nc1');
  });

  it('drops newest on cap (does not grow past max)', () => {
    const map = new Map<string, RTCIceCandidateInit[]>();
    for (let i = 0; i < PENDING_REMOTE_ICE_MAX_PER_KEY + 5; i++) {
      pushPendingRemoteIceCandidate(map, 'p', 'c', {
        candidate: `cand-${i}`,
        sdpMid: '0',
        sdpMLineIndex: 0,
      });
    }
    const q = map.get(pendingRemoteIceKey('p', 'c'));
    expect(q?.length).toBe(PENDING_REMOTE_ICE_MAX_PER_KEY);
    expect(q?.[0]?.candidate).toBe('cand-0');
    expect(q?.[PENDING_REMOTE_ICE_MAX_PER_KEY - 1]?.candidate).toBe(
      `cand-${PENDING_REMOTE_ICE_MAX_PER_KEY - 1}`
    );
  });

  it('drains in order and clears key', async () => {
    const map = new Map<string, RTCIceCandidateInit[]>();
    const addIceCandidate = vi.fn().mockResolvedValue(undefined);
    const pc = { addIceCandidate } as unknown as RTCPeerConnection;

    pushPendingRemoteIceCandidate(map, 'p', 'c', {
      candidate: 'one',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    pushPendingRemoteIceCandidate(map, 'p', 'c', {
      candidate: 'two',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });

    await drainPendingRemoteIceSession(pc, map, 'p', 'c');

    expect(addIceCandidate).toHaveBeenCalledTimes(2);
    expect(addIceCandidate.mock.calls[0][0]).toMatchObject({ candidate: 'one' });
    expect(addIceCandidate.mock.calls[1][0]).toMatchObject({ candidate: 'two' });
    expect(map.has(pendingRemoteIceKey('p', 'c'))).toBe(false);
  });

  it('clearPendingRemoteIceSession removes one session only', () => {
    const map = new Map<string, RTCIceCandidateInit[]>();
    pushPendingRemoteIceCandidate(map, 'a', 'c1', {
      candidate: 'x',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    pushPendingRemoteIceCandidate(map, 'a', 'c2', {
      candidate: 'y',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    clearPendingRemoteIceSession(map, 'a', 'c1');
    expect(map.has(pendingRemoteIceKey('a', 'c1'))).toBe(false);
    expect(map.get(pendingRemoteIceKey('a', 'c2'))?.length).toBe(1);
  });
});
