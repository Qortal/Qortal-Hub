import type { GroupCallAudioQualityProfile } from './groupCallAudioProfile';
import type {
  AudioEngineJoinOptions,
  AudioEngineSelectableStatus,
  AudioEngineUserIdentity,
  GroupCallControllerApi,
  GroupCallControllerSnapshot,
} from './audioEngineTypes';
import { traceGcallAudioSurface } from './gcallAudioSurfaceTrace';
import { GroupCallPerformanceTracker } from './router';

export interface AudioSurfaceBridgeState {
  hostReady: boolean;
  bootstrapRevisionApplied: number;
  snapshot: GroupCallControllerSnapshot;
}

export interface AudioSurfaceBootstrap {
  revision: number;
  userInfo: AudioEngineUserIdentity | null;
  myStatus: AudioEngineSelectableStatus;
  uiActive: boolean;
  devices?: {
    inputDeviceId: string | null;
    outputDeviceId: string | null;
  };
}

export type AudioSurfaceCommand =
  | {
      type: 'set-user';
      userInfo: AudioEngineUserIdentity | null;
      myStatus: AudioEngineSelectableStatus;
    }
  | {
      type: 'set-ui-active';
      uiActive: boolean;
    }
  | {
      type: 'set-device-preferences';
      inputDeviceId: string | null;
      inputDeviceLabel?: string | null;
      inputDeviceGroupId?: string | null;
      outputDeviceId: string | null;
      outputDeviceLabel?: string | null;
      outputDeviceGroupId?: string | null;
    }
  | { type: 'list-audio-devices' }
  | {
      type: 'join-group-call';
      roomId: string;
      chatId: string;
      options?: AudioEngineJoinOptions;
    }
  | { type: 'logout-cleanup' }
  | { type: 'leave-group-call' }
  | { type: 'set-muted'; muted: boolean }
  | { type: 'set-hear-call'; hearCall: boolean }
  | {
      type: 'export-diagnostics';
      options?: { download?: boolean; clipboard?: boolean };
    }
  | {
      type: 'set-audio-quality-profile';
      profile: GroupCallAudioQualityProfile;
    }
  | {
      type: 'start-direct-voice-receive';
      roomId: string;
      peerAddress: string;
      roomKey: ArrayBuffer | Uint8Array;
      outputDeviceId?: string | null;
      hearCall?: boolean;
      profile?: GroupCallAudioQualityProfile;
    }
  | {
      type: 'update-direct-voice-receive';
      outputDeviceId?: string | null;
      hearCall?: boolean;
      profile?: GroupCallAudioQualityProfile;
    }
  | { type: 'stop-direct-voice-receive' }
  | {
      type: 'start-direct-voice-media';
      roomId: string;
      peerAddress: string;
      localAddress: string;
      roomKey: ArrayBuffer | Uint8Array;
      inputDeviceId?: string | null;
      outputDeviceId?: string | null;
      muted?: boolean;
      hearCall?: boolean;
      profile?: GroupCallAudioQualityProfile;
    }
  | {
      type: 'update-direct-voice-media';
      inputDeviceId?: string | null;
      outputDeviceId?: string | null;
      muted?: boolean;
      hearCall?: boolean;
      profile?: GroupCallAudioQualityProfile;
    }
  | { type: 'stop-direct-voice-media' }
  | { type: 'clear-join-error' };

export type AudioSurfaceResponse =
  | { ok: true; payload?: unknown }
  | { ok: false; error: string };

export interface AudioSurfaceCommandEnvelope {
  commandId: string;
  command: AudioSurfaceCommand;
}

export interface AudioSurfaceCommandResultEnvelope {
  commandId: string;
  response: AudioSurfaceResponse;
}

export type AudioSurfaceEvent =
  | {
      type: 'engine-ready';
      bootstrapRevisionApplied: number;
    }
  | {
      type: 'snapshot';
      snapshot: GroupCallControllerSnapshot;
    }
  | {
      type: 'diagnostics-exported';
      json: string;
    }
  | {
      type: 'engine-error';
      message: string;
    };

export function buildDefaultGroupCallControllerSnapshot(): GroupCallControllerSnapshot {
  return {
    roomState: 'idle',
    participants: [],
    myRole: 'participant',
    activeSpeakers: [],
    metrics: new GroupCallPerformanceTracker().getSnapshot(),
    mediaViable: false,
    localConnectionHint: null,
    topologyLabel: 'Reticulum',
    gcallJoinError: null,
    muted: false,
    hearCall: true,
    roomId: '',
    memberPrimaryNames: {},
    memberGateGroupName: '',
    audioQualityProfile: 'low-latency',
    startupStatus: {
      stage: 'idle',
      headline: '',
      detail: null,
      tone: 'neutral',
      showProgress: false,
      delayed: false,
    },
  };
}

export function buildDefaultAudioSurfaceBridgeState(): AudioSurfaceBridgeState {
  return {
    hostReady: false,
    bootstrapRevisionApplied: 0,
    snapshot: buildDefaultGroupCallControllerSnapshot(),
  };
}

const noop = (): void => {};
const joinUnavailable: GroupCallControllerApi['joinGroupCall'] = async (
  roomId,
  chatId,
  options
) => {
  traceGcallAudioSurface(
    'unavailable-api.joinGroupCall: window.audioSurface is missing; join is a no-op',
    {
      roomId,
      chatId,
      hasMemberGate: options?.memberGateGroupId != null,
    }
  );
};

const leaveUnavailable: GroupCallControllerApi['leaveGroupCall'] = async () => {
  traceGcallAudioSurface(
    'unavailable-api.leaveGroupCall: no window.audioSurface'
  );
};

/**
 * Read-only, no-op `GroupCallControllerApi` for environments that do not expose
 * `window.audioSurface` (browser dev, unit tests). Production Electron always
 * uses the isolated audio window via {@link useAudioSurfaceGroupCallController}.
 */
export function buildUnavailableGroupCallControllerApi(): GroupCallControllerApi {
  const base = buildDefaultGroupCallControllerSnapshot();
  return {
    ...base,
    joinGroupCall: joinUnavailable,
    leaveGroupCall: leaveUnavailable,
    clearGcallJoinError: noop,
    exportGroupCallDiagnostics: async () => null,
    setMuted: noop,
    setHearCall: noop,
    toggleHearCall: noop,
  };
}

export function isAudioSurfaceSnapshotEvent(
  event: AudioSurfaceEvent
): event is Extract<AudioSurfaceEvent, { type: 'snapshot' }> {
  return event.type === 'snapshot';
}

export function normalizeAudioSurfaceBridgeState(
  value: Partial<AudioSurfaceBridgeState> | null | undefined
): AudioSurfaceBridgeState {
  const fallback = buildDefaultAudioSurfaceBridgeState();
  if (!value || typeof value !== 'object') return fallback;
  return {
    hostReady: value.hostReady === true,
    bootstrapRevisionApplied:
      typeof value.bootstrapRevisionApplied === 'number'
        ? value.bootstrapRevisionApplied
        : 0,
    snapshot:
      value.snapshot && typeof value.snapshot === 'object'
        ? {
            ...fallback.snapshot,
            ...value.snapshot,
          }
        : fallback.snapshot,
  };
}
