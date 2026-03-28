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
      getAppSettings?: () => Promise<{
        closeAction?: 'ask' | 'minimizeToTray' | 'quit';
        p2pEnabled?: boolean;
        legacyPublicStunFallback?: boolean;
      }>;
      setAppSettings?: (settings: {
        closeAction?: 'ask' | 'minimizeToTray' | 'quit';
        p2pEnabled?: boolean;
        legacyPublicStunFallback?: boolean;
      }) => Promise<{
        closeAction?: 'ask' | 'minimizeToTray' | 'quit';
        p2pEnabled?: boolean;
        legacyPublicStunFallback?: boolean;
      }>;
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
          remoteStunUdpPort?: number;
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

      /**
       * Clear the support-queue rate-limit map.
       * Call when an agent logs out so re-knocks from users are accepted
       * immediately after the agent logs back in.
       */
      clearQueueRateLimit: () => Promise<{ success: boolean }>;

      /** Returns currently subscribed chatIds. */
      getSubscriptions: () => Promise<string[]>;

      /**
       * Fetch the encrypted attachment blob for an event.
       * Returns the base64 ciphertext string, or null if not available locally.
       * Use for lazy-loading images in history that did not travel with the event.
       */
      getAttachment: (eventId: string) => Promise<string | null>;

      /**
       * Subscribe to incoming chat events.
       * Returns an unsubscribe function.
       */
      onEvent: (cb: (payload: { event: P2PChatEvent }) => void) => () => void;

      /** Subscribe to chat events for one chatId only. */
      onEventForChat: (
        chatId: string,
        cb: (payload: { event: P2PChatEvent }) => void
      ) => () => void;

      /**
       * Subscribe to typing indicators.
       * `active: true` = started typing, `active: false` = stopped.
       * Returns an unsubscribe function.
       */
      onTyping: (
        cb: (payload: { chatId: string; authorAddress: string; active: boolean }) => void
      ) => () => void;

      /** Subscribe to typing events for one chatId only. */
      onTypingForChat: (
        chatId: string,
        cb: (payload: { chatId: string; authorAddress: string; active: boolean }) => void
      ) => () => void;

      /**
       * Subscribe to incoming read receipt events.
       * Returns an unsubscribe function.
       */
      onRead: (
        cb: (payload: { chatId: string; readerAddress: string; eventIds: string[] }) => void
      ) => () => void;

      /** Subscribe to read receipt events for one chatId only. */
      onReadForChat: (
        chatId: string,
        cb: (payload: { chatId: string; readerAddress: string; eventIds: string[] }) => void
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
      /** Subscribe to coalesced presence updates. */
      onUpdateBatch: (
        cb: (
          payloads: Array<{
            address: string;
            online: boolean;
            status: UserStatus | null;
          }>
        ) => void
      ) => () => void;
      /** Subscribe to the "all presence cleared" event (fired when P2P is disabled). */
      onCleared: (cb: () => void) => () => void;
      /** Subscribe to the "P2P started" event (fired when P2P is re-enabled). */
      onStarted: (cb: () => void) => () => void;
    };

    /** Decentralized STUN bootstrap + ICE server list (Electron preload + main). */
    hub?: {
      getBootstrapIceServers: () => { urls: string }[];
      getIceServers: () => Promise<{ urls: string }[]>;
      reportStunCallOutcome: (
        stunUrls: string[],
        success: boolean
      ) => Promise<{ ok?: boolean }>;
      reportObservedStunSources: (
        stunUrls: string[]
      ) => Promise<{ ok?: boolean }>;
    };

    // ── Call (1v1) ────────────────────────────────────────────────────────────
    call?: {
      initiate: (targetAddress: string, chatId: string, localAddress: string, signature: string, publicKey: string, callId: string, timestamp: number) => Promise<{ success: boolean; callId?: string; error?: string }>;
      accept: (callId: string, signature: string, publicKey: string, timestamp: number) => Promise<{ success: boolean }>;
      reject: (callId: string, reason?: string, signature?: string, publicKey?: string, timestamp?: number) => Promise<{ success: boolean }>;
      hangup: (callId: string, signature: string, publicKey: string, timestamp: number) => Promise<{ success: boolean }>;
      sendSignal: (callId: string, type: 'offer' | 'answer' | 'ice', data: unknown, signature?: string, publicKey?: string, timestamp?: number) => Promise<{ success: boolean }>;
      sendAudio: (callId: string, seq: number, data: string) => Promise<{ success: boolean }>;
      getPublicIpPeers: () => Promise<Array<{ id: string; ip: string; port: number }>>;
      whoami: () => Promise<{ ip: string; port: number } | null>;
      setLocalAddresses: (addresses: string[]) => Promise<{ success: boolean }>;
      onEvent: (cb: (event: string, payload: unknown) => void) => () => void;
    };

    // ── Group Call ────────────────────────────────────────────────────────────
    groupCall?: {
      join: (
        roomId: string,
        chatId: string,
        localAddress: string,
        signature: string,
        publicKey: string,
        timestamp: number,
        joinGeneration?: number,
        topologyEpochFloor?: number
      ) => Promise<{
        success: boolean;
        error?: string;
        callSessionId?: string;
        mediaSessionGeneration?: number;
      }>;
      leave: (roomId: string, localAddress: string, signature: string, publicKey: string, timestamp: number) => Promise<{ success: boolean }>;
      leaveSync?: (roomId: string, localAddress: string, signature: string, publicKey: string, timestamp: number) => { success: boolean; error?: string };
      broadcastTopology: (roomId: string, topology: unknown, signature: string, publicKey: string, timestamp: number) => Promise<{ success: boolean }>;
      sendClusterHeartbeat?: (
        roomId: string,
        payload: {
          topologyEpoch: number;
          clusterForwarder: string;
          clusterIndex: number;
          seq: number;
          fromAddress: string;
          fromPublicKey: string;
          timestamp: number;
        },
        signature: string
      ) => Promise<{ success: boolean }>;
      sendAudio: (
        roomId: string,
        toAddress: string,
        data: Uint8Array
      ) => Promise<{ success: boolean; error?: string }>;
      sendKey: (
        roomId: string,
        toAddress: string,
        encryptedKey: string,
        fromAddress: string,
        signature: string,
        publicKey: string,
        timestamp: number,
        meta: {
          keyMessageVersion: number;
          callSessionId: string;
          mediaSessionGeneration: number;
          keyCommitment: string;
          encryptedKeyDigest: string;
        }
      ) => Promise<{ success: boolean }>;
      sendKeyRotate: (
        roomId: string,
        encryptedKeys: Record<string, string>,
        fromAddress: string,
        signature: string,
        publicKey: string,
        timestamp: number,
        meta: {
          keyMessageVersion: number;
          callSessionId: string;
          mediaSessionGeneration: number;
          keyCommitment: string;
          encryptedKeysDigest: string;
        }
      ) => Promise<{ success: boolean }>;
      sendKeyRequest: (
        roomId: string,
        toAddress: string,
        fromAddress: string,
        signature: string,
        publicKey: string,
        timestamp: number,
        callSessionId: string,
        mediaSessionGeneration: number
      ) => Promise<{ success: boolean }>;
      requestSessionBreak: (roomId: string) => Promise<{ success: boolean; error?: string }>;
      sendRtcSignal: (roomId: string, fromAddress: string, toAddress: string, type: 'offer' | 'answer' | 'ice' | 'reconnect', data: unknown, connId: string, signature?: string, publicKey?: string, timestamp?: number) => Promise<{ success: boolean }>;
      setLocalAddresses: (addresses: string[]) => Promise<{ success: boolean }>;
      reportTransportHealth?: (
        roomId: string,
        healthyPeerAddresses: string[]
      ) => Promise<{ success: boolean }>;
      getRoomParticipants: (roomId: string) => Promise<Array<{ address: string; publicKey: string }>>;
      getPendingKeyMetrics?: () => Promise<{
        pending_key_flush_success: number;
        pending_key_expired: number;
        pendingRooms: number;
      }>;
      onEvent: (cb: (event: string, payload: unknown) => void) => () => void;
    };
    __qortalGCallExportDiagnostics?: () => Promise<void>;
  }

  // ── P2P Chat shared types ──────────────────────────────────────────────────

  /**
   * Cleartext metadata for an image attachment.
   * Mirrors electron/src/chat.ts AttachmentMeta.
   */
  interface AttachmentMeta {
    mimeType: string;
    filename?: string;
    width?: number;
    height?: number;
    sizeBytes: number;
  }

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
    /** Cleartext image attachment metadata — included in the signature. */
    attachmentMeta?: AttachmentMeta;
    /** SHA-256 hex digest of the encrypted attachment bytes — included in the signature. */
    attachmentDataHash?: string;
    /**
     * Base64-encoded encrypted attachment blob.
     * Present on live events received from the network.
     * Absent on history events (fetched on demand via window.chat.getAttachment).
     */
    attachmentData?: string;
    /** Base58 Ed25519 detached signature. */
    signature: string;
  }

  interface RenderedMessage {
    /** id of the original 'message' event */
    id: string;
    chatId: string;
    authorAddress: string;
    authorPublicKey: string;
    seq: number;
    timestamp: number;
    /** Current content — mutated by edits, cleared by delete. */
    content: string;
    isEdited: boolean;
    isDeleted: boolean;
    /** Timestamp of the most recent edit, if any. */
    editedAt?: number;
    /** id of the parent message this replies to. */
    replyTo?: string;
    /**
     * emoji → list of authorAddresses who have that reaction active.
     * Toggle semantics: each reaction event from the same author with the same
     * emoji flips the state (add if absent, remove if present).
     */
    reactions: Record<string, string[]>;
    /** The raw original 'message' event, for reference. */
    originalEvent: P2PChatEvent;
    /** Attachment metadata when this message carries an image. */
    attachmentMeta?: AttachmentMeta;
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
