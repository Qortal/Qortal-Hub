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
      outputDeviceId: string | null;
    }
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
