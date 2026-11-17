import { describe, expect, it } from 'vitest';
import type { GroupCallControllerSnapshot } from './audioEngineTypes';
import { buildDefaultGroupCallControllerSnapshot } from './audioSurfaceBridge';
import {
  buildConnectedSnapshot,
  buildJoinFailureSnapshot,
  buildJoiningSnapshot,
  buildPostLeaveSnapshot,
  projectGroupCallEvent,
} from './audioEngineSessionProjector';

function makeSnapshot(): GroupCallControllerSnapshot {
  return buildDefaultGroupCallControllerSnapshot();
}

describe('audioEngineSessionProjector', () => {
  it('projects a joining snapshot with the local participant', () => {
    const next = buildJoiningSnapshot({
      current: makeSnapshot(),
      roomId: 'room-1',
      user: { address: 'Qabc', publicKey: 'pub-1' },
      options: { memberGateGroupName: ' Group Alpha ' },
    });

    expect(next.roomState).toBe('joining');
    expect(next.roomId).toBe('room-1');
    expect(next.memberGateGroupName).toBe('Group Alpha');
    expect(next.participants).toEqual([
      {
        address: 'Qabc',
        publicKey: 'pub-1',
        speaking: false,
        role: 'participant',
      },
    ]);
  });

  it('projects participant join, leave, and session update events', () => {
    const joining = buildJoiningSnapshot({
      current: makeSnapshot(),
      roomId: 'room-1',
      user: { address: 'Qlocal', publicKey: 'pub-local' },
    });
    const joined = projectGroupCallEvent({
      snapshot: joining,
      event: 'gcall:participant-joined',
      payload: { roomId: 'room-1', address: 'Qpeer', publicKey: 'pub-peer' },
    });
    expect(joined?.participants.map((participant) => participant.address)).toEqual([
      'Qlocal',
      'Qpeer',
    ]);

    const connected = projectGroupCallEvent({
      snapshot: joined!,
      event: 'gcall:session-updated',
      payload: { roomId: 'room-1' },
    });
    expect(connected?.roomState).toBe('connected');

    const afterLeave = projectGroupCallEvent({
      snapshot: connected!,
      event: 'gcall:participant-left',
      payload: { roomId: 'room-1', address: 'Qpeer' },
    });
    expect(afterLeave?.participants.map((participant) => participant.address)).toEqual([
      'Qlocal',
    ]);
  });

  it('preserves local toggles through leave/reset helpers', () => {
    const current = {
      ...makeSnapshot(),
      muted: true,
      hearCall: false,
      audioQualityProfile: 'high-stability' as const,
      roomState: 'connected' as const,
      roomId: 'room-1',
    };

    expect(buildConnectedSnapshot(current, 'room-2').roomId).toBe('room-2');
    expect(buildJoinFailureSnapshot(current, 'join_failed').gcallJoinError).toBe(
      'join_failed'
    );

    const next = buildPostLeaveSnapshot(current);
    expect(next.roomState).toBe('idle');
    expect(next.roomId).toBe('');
    expect(next.muted).toBe(true);
    expect(next.hearCall).toBe(false);
    expect(next.audioQualityProfile).toBe('high-stability');
  });
});
