export type AudioSurfaceCommand =
  | {
      type: 'set-user';
      userInfo: any | null;
      myStatus: 'online' | 'away' | 'busy' | 'offline';
    }
  | { type: 'set-ui-active'; uiActive: boolean }
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
      options?: {
        memberGateGroupId?: number;
        memberGateGroupName?: string;
      };
    }
  | { type: 'leave-group-call' }
  | { type: 'set-muted'; muted: boolean }
  | { type: 'set-hear-call'; hearCall: boolean }
  | {
      type: 'export-diagnostics';
      options?: { download?: boolean; clipboard?: boolean };
    }
  | {
      type: 'set-audio-quality-profile';
      profile: 'low-latency' | 'high-stability';
    }
  | {
      type: 'start-direct-voice-receive';
      roomId: string;
      peerAddress: string;
      roomKey: ArrayBuffer | Uint8Array;
      outputDeviceId?: string | null;
      hearCall?: boolean;
      profile?: 'low-latency' | 'high-stability';
    }
  | {
      type: 'update-direct-voice-receive';
      outputDeviceId?: string | null;
      hearCall?: boolean;
      profile?: 'low-latency' | 'high-stability';
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
      profile?: 'low-latency' | 'high-stability';
    }
  | {
      type: 'update-direct-voice-media';
      inputDeviceId?: string | null;
      outputDeviceId?: string | null;
      muted?: boolean;
      hearCall?: boolean;
      profile?: 'low-latency' | 'high-stability';
    }
  | { type: 'stop-direct-voice-media' }
  | { type: 'clear-join-error' };

export type AudioSurfaceResponseLike = {
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export interface AudioSurfaceCommandEnvelope {
  commandId: string;
  command: AudioSurfaceCommand;
}

export interface AudioSurfaceCommandResultEnvelope {
  commandId: string;
  response: AudioSurfaceResponseLike;
}

export type AudioSurfaceEvent =
  | {
      type: 'engine-ready';
      bootstrapRevisionApplied: number;
    }
  | {
      type: 'snapshot';
      snapshot: unknown;
    }
  | {
      type: 'diagnostics-exported';
      json: string;
    }
  | {
      type: 'engine-error';
      message: string;
    };

export interface AudioSurfaceBridgeStateLike {
  hostReady: boolean;
  bootstrapRevisionApplied: number;
  snapshot: unknown | null;
}

export function buildDefaultAudioSurfaceBridgeStateLike(): AudioSurfaceBridgeStateLike {
  return {
    hostReady: false,
    bootstrapRevisionApplied: 0,
    snapshot: null,
  };
}
