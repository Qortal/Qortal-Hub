import type {
  AudioEngineJoinOptions,
  AudioEngineParticipant,
  AudioEngineUserIdentity,
  GroupCallControllerSnapshot,
} from './audioEngineTypes';
import { buildDefaultGroupCallControllerSnapshot } from './audioSurfaceBridge';

export function buildJoiningSnapshot(params: {
  current: GroupCallControllerSnapshot;
  roomId: string;
  user: AudioEngineUserIdentity;
  options?: AudioEngineJoinOptions;
}): GroupCallControllerSnapshot {
  return {
    ...params.current,
    roomId: params.roomId,
    roomState: 'joining',
    gcallJoinError: null,
    memberGateGroupName: params.options?.memberGateGroupName?.trim?.() ?? '',
    participants: [
      {
        address: params.user.address,
        publicKey: params.user.publicKey,
        speaking: false,
        role: 'participant',
      },
    ],
  };
}

export function buildJoinFailureSnapshot(
  current: GroupCallControllerSnapshot,
  error: string
): GroupCallControllerSnapshot {
  return {
    ...current,
    roomState: 'idle',
    gcallJoinError: error,
  };
}

export function buildConnectedSnapshot(
  current: GroupCallControllerSnapshot,
  roomId: string
): GroupCallControllerSnapshot {
  return {
    ...current,
    roomState: 'connected',
    roomId,
  };
}

export function buildPostLeaveSnapshot(
  current: GroupCallControllerSnapshot
): GroupCallControllerSnapshot {
  return {
    ...buildDefaultGroupCallControllerSnapshot(),
    muted: current.muted,
    hearCall: current.hearCall,
    audioQualityProfile: current.audioQualityProfile,
  };
}

export function projectGroupCallEvent(params: {
  snapshot: GroupCallControllerSnapshot;
  event: string;
  payload: unknown;
}): GroupCallControllerSnapshot | null {
  const { snapshot, event, payload } = params;
  switch (event) {
    case 'gcall:participant-joined': {
      const joined = payload as {
        roomId?: string;
        address?: string;
        publicKey?: string;
      };
      if (joined.roomId !== snapshot.roomId || !joined.address) return null;
      return {
        ...snapshot,
        participants: upsertParticipant(snapshot.participants, {
          address: joined.address,
          publicKey: joined.publicKey ?? '',
          speaking: false,
          role: 'participant',
        }),
      };
    }
    case 'gcall:participant-left': {
      const left = payload as { roomId?: string; address?: string };
      if (left.roomId !== snapshot.roomId || !left.address) return null;
      return {
        ...snapshot,
        participants: snapshot.participants.filter(
          (participant) => participant.address !== left.address
        ),
        activeSpeakers: snapshot.activeSpeakers.filter(
          (address) => address !== left.address
        ),
      };
    }
    case 'gcall:session-updated':
      if (snapshot.roomState !== 'joining') return null;
      return {
        ...snapshot,
        roomState: 'connected',
      };
    default:
      return null;
  }
}

function upsertParticipant(
  participants: AudioEngineParticipant[],
  participant: AudioEngineParticipant
): AudioEngineParticipant[] {
  const existingIndex = participants.findIndex(
    (current) => current.address === participant.address
  );
  if (existingIndex === -1) return [...participants, participant];
  const next = [...participants];
  next[existingIndex] = { ...next[existingIndex], ...participant };
  return next;
}
