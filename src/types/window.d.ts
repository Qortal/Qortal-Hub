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
      getAppSettings?: () => Promise<{ closeAction?: 'ask' | 'minimizeToTray' | 'quit'; p2pEnabled?: boolean }>;
      setAppSettings?: (settings: { closeAction?: 'ask' | 'minimizeToTray' | 'quit'; p2pEnabled?: boolean }) => Promise<{ closeAction?: 'ask' | 'minimizeToTray' | 'quit'; p2pEnabled?: boolean }>;
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

    // ── P2P Chat ─────────────────────────────────────────────────────────────
    chat?: {
      /**
       * Send a pre-signed ChatEventEnvelope.
       * Build and sign the event in the renderer, then call this.
       */
      sendEvent: (envelope: {
        type: 'CHAT_EVENT';
        event: P2PChatEvent;
      }) => Promise<{ success: boolean; error?: string }>;

      /** Subscribe to a chat (start receiving events + request sync). */
      subscribe: (chatId: string) => Promise<{ success: boolean; error?: string }>;

      /** Unsubscribe from a chat. */
      unsubscribe: (chatId: string) => Promise<{ success: boolean }>;

      /** Broadcast an ephemeral typing indicator. */
      sendTyping: (chatId: string, authorAddress: string) => Promise<{ success: boolean }>;

      /** Retrieve message history. Pass `beforeTimestamp` for pagination. */
      getHistory: (
        chatId: string,
        limit: number,
        beforeTimestamp?: number
      ) => Promise<P2PChatEvent[]>;

      /** Summary of every known chat (last event + unread count). */
      getSummaries: () => Promise<
        Array<{
          chatId: string;
          lastEvent: P2PChatEvent | null;
          unreadCount: number;
          updatedAt: number;
        }>
      >;

      /** Advance the read watermark for a chat. */
      markRead: (chatId: string, upToTimestamp: number) => Promise<{ success: boolean }>;

      /**
       * Register the local user's address(es) for DM auto-delivery.
       * Call on login with [address]; call with [] on logout.
       */
      setLocalAddresses: (addresses: string[]) => Promise<{ success: boolean }>;

      /** Returns currently subscribed chatIds. */
      getSubscriptions: () => Promise<string[]>;

      /**
       * Subscribe to incoming chat events.
       * Returns an unsubscribe function.
       */
      onEvent: (cb: (payload: { event: P2PChatEvent }) => void) => () => void;

      /**
       * Subscribe to typing indicators.
       * `active: true` = started typing, `active: false` = stopped.
       * Returns an unsubscribe function.
       */
      onTyping: (
        cb: (payload: { chatId: string; authorAddress: string; active: boolean }) => void
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
      /** Subscribe to the "all presence cleared" event (fired when P2P is disabled). */
      onCleared: (cb: () => void) => () => void;
      /** Subscribe to the "P2P started" event (fired when P2P is re-enabled). */
      onStarted: (cb: () => void) => () => void;
    };
  }

  // ── P2P Chat shared types ──────────────────────────────────────────────────

  interface P2PChatEvent {
    /** UUID, assigned by the renderer and included in the signature. */
    id: string;
    /**
     * Conversation identifier:
     *   DM:    [addrA, addrB].sort().join(':')
     *   Group: "group:" + numericGroupId
     */
    chatId: string;
    eventType: 'message' | 'edit' | 'delete' | 'reaction';
    authorAddress: string;
    /** Base58-encoded Ed25519 public key. */
    authorPublicKey: string;
    /** Per-author monotonic counter within this chatId (starts at 1). */
    seq: number;
    /** Unix timestamp in milliseconds. */
    timestamp: number;
    content: string;
    replyTo?: string;
    targetId?: string;
    /** Base58 Ed25519 detached signature. */
    signature: string;
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
