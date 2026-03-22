declare global {
  interface Window {
    appStorage?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    coreSetup?: unknown;
    electronAPI?: {
      openExternal?: (url: string) => void;
      setAllowedDomains?: (domains: string[]) => void;
      ensureCertForBase?: (
        baseUrl: string,
        apiKey?: string
      ) => Promise<{ success: boolean; error?: string }>;
      windowMinimize?: () => void;
      windowMaximize?: () => Promise<void>;
      windowClose?: () => void;
      focusWindow?: () => Promise<void>;
      getWindowState?: () => Promise<{ isMaximized: boolean }>;
      getPlatform?: () => Promise<string>;
      showAppMenu?: (x?: number, y?: number) => void;
      getAppSettings?: () => Promise<{ closeAction?: 'ask' | 'minimizeToTray' | 'quit' }>;
      setAppSettings?: (settings: { closeAction?: 'ask' | 'minimizeToTray' | 'quit' }) => Promise<{ closeAction?: 'ask' | 'minimizeToTray' | 'quit' }>;
    };
    videoServer?: {
      start: (port?: number) => Promise<{ success: boolean; port?: number; error?: string }>;
      stop: () => Promise<{ success: boolean; error?: string }>;
      getPort: () => Promise<number | null>;
      isRunning: () => Promise<boolean>;
    };

    // ── P2P Network ──────────────────────────────────────────────────────────
    p2pNetwork?: {
      start: (options?: {
        port?: number;
        maxPeers?: number;
        initialPeers?: string[];
      }) => Promise<{ success: boolean; port?: number; peerId?: string; error?: string }>;
      stop: () => Promise<{ success: boolean; error?: string }>;
      send: (
        to: string | null,
        data: unknown
      ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
      getPeers: () => Promise<
        Array<{
          id: string;
          host: string;
          port: number;
          connected: boolean;
          outbound: boolean;
        }>
      >;
      getStatus: () => Promise<{
        running: boolean;
        port: number | null;
        peerId: string | null;
        connectedPeers: number;
      }>;
      addPeer: (addr: string) => Promise<{ success: boolean; error?: string }>;
      /** Subscribe to incoming data messages. Returns unsubscribe fn. */
      onMessage: (
        cb: (payload: { id: string; from: string; via?: string; to?: string; data: unknown }) => void
      ) => () => void;
      /** Subscribe to peer connect/disconnect events. Returns unsubscribe fn. */
      onPeerChange: (
        cb: (payload: { type: 'connected' | 'disconnected'; id: string }) => void
      ) => () => void;
    };

    // ── Presence ─────────────────────────────────────────────────────────────
    presence?: {
      /**
       * Announce that the local user is online.
       * Build a signed PresenceEnvelope in the renderer and pass it here.
       * See usePresence hook for the signing flow.
       */
      announce: (envelope: PresenceEnvelope) => Promise<{ success: boolean }>;
      /** Send a periodic heartbeat (every 25 s) to keep the session alive. */
      heartbeat: (envelope: PresenceEnvelope) => Promise<{ success: boolean }>;
      /** Announce that the local user is going offline. */
      offline: (envelope: PresenceEnvelope) => Promise<{ success: boolean }>;
      /** Check whether an address currently has an active session. */
      getStatus: (address: string) => Promise<PresenceStatusResult>;
      /** All currently online addresses. */
      getOnlineAddresses: () => Promise<string[]>;
      /** Full session detail for every active user. */
      getAllOnline: () => Promise<PresenceSession[]>;
      /**
       * Subscribe to presence updates pushed from the network.
       * Returns an unsubscribe function.
       */
      onUpdate: (
        cb: (payload: { address: string; online: boolean; status: UserStatus | null }) => void
      ) => () => void;
    };
  }

  // ── Presence shared types ──────────────────────────────────────────────────

  /** User-selectable presence status. All three values mean "present in the network". */
  type UserStatus = 'online' | 'away' | 'busy' | 'idle';

  interface PresenceEnvelope {
    id: string;
    type: 'PRESENCE_ANNOUNCE' | 'PRESENCE_HEARTBEAT' | 'PRESENCE_OFFLINE';
    senderAddress: string;
    timestamp: number;
    payload:
      | PresenceAnnouncePayload
      | PresenceHeartbeatPayload
      | PresenceOfflinePayload;
    signature: string;
  }

  interface PresenceAnnouncePayload {
    address: string;
    publicKey: string;
    sessionId: string;
    status: UserStatus;
    clientVersion: string;
    capabilities?: string[];
  }

  interface PresenceHeartbeatPayload {
    address: string;
    publicKey: string;
    sessionId: string;
    status: UserStatus;
  }

  interface PresenceOfflinePayload {
    address: string;
    publicKey: string;
    sessionId: string;
    status: 'offline';
  }

  interface PresenceSession {
    address: string;
    publicKey: string;
    sessionId: string;
    lastSeen: number;
    firstSeen: number;
    originNodeId: string;
    viaPeerId: string;
    clientVersion?: string;
    status: UserStatus;
    signatureValid: true;
  }

  interface PresenceStatusResult {
    online: boolean;
    lastSeen: number | null;
    sessions: PresenceSession[];
  }
}

export {};
