import type {
  AudioSurfaceCommand,
  AudioSurfaceCommandEnvelope,
  AudioSurfaceCommandResultEnvelope,
  AudioSurfaceEvent,
} from '../lib/group-call/audioSurfaceBridge';

declare global {
  interface ReticulumCalendarRecurrenceInput {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    untilLocalDate?: string;
  }

  interface ReticulumCalendarEventInput {
    title: string;
    description?: string;
    startLocal: string;
    endLocal: string;
    allDay: boolean;
    timezone: string;
    location?: string;
    link?: string;
    coverImage?: {
      namespace: 'reticulum-group-resource';
      ownerId?: string;
      fileName: string;
      mimeType: 'image/webp';
      sizeBytes: number;
      fileHash: string;
      encrypted: false;
      createdAt: number;
      metadata: {
        feature: 'reticulum-calendar-cover';
        groupId: number;
        width: number;
        height: number;
      };
    } | null;
    recurrence?: ReticulumCalendarRecurrenceInput | null;
  }

  interface ReticulumCalendarOccurrence extends ReticulumCalendarEventInput {
    creatorAddress: string;
    createdAt?: number;
    groupId: number;
    eventId: string;
    occurrenceId: string;
    occurrenceStart: number;
    occurrenceEnd: number;
    sourceMutationId: string;
    updatedAt: number;
  }

  interface ReticulumCalendarReminder {
    ownerAddress: string;
    groupId: number;
    eventId: string;
    offsetMs: number | null;
    lastFiredOccurrenceId: string;
    updatedAt: number;
  }

  interface Window {
    qortalLandRealtime?: {
      getTransportBootstrap: () => Promise<{
        url: string;
        token: string;
        instanceId: string;
      } | null>;
      onTransportRestarted: (callback: () => void) => () => void;
    };
    qortalLandGames?: {
      getTransportBootstrap: () => Promise<{
        url: string;
        token: string;
        instanceId: string;
      } | null>;
      onTransportRestarted: (callback: () => void) => () => void;
    };
    sendMessage?: (
      action: string,
      data?: unknown,
      timeout?: number,
      isExtension?: unknown,
      appInfo?: unknown
    ) => Promise<unknown>;
    foreignWalletSigner?: {
      importKeys: (
        keys: Record<string, unknown>
      ) => Promise<Record<string, string>>;
      publicKey: (coin: string) => Promise<string>;
      clear: () => Promise<void>;
      sign: (
        request: import('../lib/foreign-wallet/desktop-engine').DesktopSignRequest,
        language: string
      ) => Promise<{
        signed?: import('../lib/foreign-wallet/foreign-wallet-transaction').ForeignWalletSignedTransaction;
        error?: 'invalid' | 'changed' | 'declined' | 'pending';
      }>;
    };
    foreignWalletJournal?: {
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string) => Promise<void>;
      delete: (key: string, txId: string) => Promise<void>;
    };
    appStorage?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    miscStorage?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    coreSetup?: {
      isCoreRunning?: () => Promise<boolean>;
      isCoreRunningOnSystem?: () => Promise<boolean>;
      isCoreInstalledOnSystem?: () => Promise<boolean>;
      isCoreInstalled?: () => Promise<boolean>;
      verifySteps?: () => Promise<void>;
      deleteDB?: () => Promise<boolean>;
      dbExists?: () => Promise<boolean>;
      installCore?: () => Promise<unknown>;
      startCore?: () => Promise<unknown>;
      getApiKey?: () => Promise<string>;
      resetApikey?: () => Promise<boolean>;
      pickQortalDirectory?: () => Promise<unknown>;
      removeCustomPath?: () => Promise<void>;
      stopCore?: () => Promise<boolean>;
      bootstrap?: () => Promise<boolean>;
      bootstrapOrClearChainAndStart?: () => Promise<boolean>;
      onProgress?: (cb: (p: unknown) => void) => () => void;
    };
    electronAPI?: {
      openExternal?: (url: string) => void;
      setAllowedDomains?: (domains: string[]) => void;
      ensureCertForBase?: (
        baseUrl: string,
        apiKey?: string
      ) => Promise<{ success: boolean; error?: string }>;
      windowMinimize?: () => Promise<void>;
      windowMaximize?: () => Promise<void>;
      windowClose?: () => Promise<void>;
      focusWindow?: () => Promise<void>;
      getWindowState?: () => Promise<{ isMaximized: boolean }>;
      onWindowStateChange?: (
        callback: (state: { isMaximized: boolean }) => void
      ) => () => void;
      onSystemLockRequested?: (callback: () => void) => () => void;
      getPlatform?: () => Promise<string>;
      onDisplayMediaRequest?: (callback: (request: { requestId: string; origin: string }) => void) => () => void;
      onDisplayMediaCancel?: (callback: (requestId: string) => void) => () => void;
      selectDisplayMedia?: (requestId: string, sourceId?: string) => void;
      authorizeDisplayMedia?: (requestId: string, accepted: boolean) => void;
      listScreenShareSources?: () => Promise<{
        success: boolean;
        error?: string;
        sources: Array<{
          id: string;
          name: string;
          thumbnail: string;
          appIcon: string;
        }>;
      }>;
      getSystemCallReadiness?: () => Promise<{
        status: 'good' | 'warning' | 'blocked' | 'unknown';
        reasons: string[];
        cpuLoad: number | null;
        memoryPressure: number;
        eventLoopLagMs: number;
        measuredAt: number;
      }>;
      refreshSystemCallReadiness?: () => Promise<{
        status: 'good' | 'warning' | 'blocked' | 'unknown';
        reasons: string[];
        cpuLoad: number | null;
        memoryPressure: number;
        eventLoopLagMs: number;
        measuredAt: number;
      }>;
      showAppMenu?: (x?: number, y?: number) => Promise<void>;
      setDisableDevLogs?: (value: boolean) => Promise<boolean>;
      getAppSettings?: () => Promise<{
        closeAction?: 'ask' | 'minimizeToTray' | 'quit';
        disableStartupSound?: boolean;
        autoLockTimeoutMinutes?: 0 | 10 | 30 | 60 | 180;
        disableAutoLockOnIdle?: boolean;
        p2pEnabled?: boolean;
        legacyPublicStunFallback?: boolean;
        communityStunContributionEnabled?: boolean;
        reticulumMeshUpnpEnabled?: boolean;
        reticulumManagedConfigEnabled?: boolean;
        reticulumTransportEnabled?: boolean;
        reticulumEnabled?: boolean;
        reticulumChatEnabled?: boolean;
        reticulumResourceLimitBytes?: number;
      }>;
      setAppSettings?: (settings: {
        closeAction?: 'ask' | 'minimizeToTray' | 'quit';
        disableStartupSound?: boolean;
        autoLockTimeoutMinutes?: 0 | 10 | 30 | 60 | 180;
        disableAutoLockOnIdle?: boolean;
        p2pEnabled?: boolean;
        legacyPublicStunFallback?: boolean;
        communityStunContributionEnabled?: boolean;
        reticulumMeshUpnpEnabled?: boolean;
        reticulumManagedConfigEnabled?: boolean;
        reticulumTransportEnabled?: boolean;
        reticulumEnabled?: boolean;
        reticulumChatEnabled?: boolean;
        reticulumResourceLimitBytes?: number;
      }) => Promise<{
        closeAction?: 'ask' | 'minimizeToTray' | 'quit';
        disableStartupSound?: boolean;
        autoLockTimeoutMinutes?: 0 | 10 | 30 | 60 | 180;
        disableAutoLockOnIdle?: boolean;
        p2pEnabled?: boolean;
        legacyPublicStunFallback?: boolean;
        communityStunContributionEnabled?: boolean;
        reticulumMeshUpnpEnabled?: boolean;
        reticulumManagedConfigEnabled?: boolean;
        reticulumTransportEnabled?: boolean;
        reticulumEnabled?: boolean;
        reticulumChatEnabled?: boolean;
        reticulumResourceLimitBytes?: number;
      }>;
      onAppSettingsChanged?: (
        callback: (settings: {
          autoLockTimeoutMinutes?: 0 | 10 | 30 | 60 | 180;
          disableAutoLockOnIdle?: boolean;
          reticulumEnabled?: boolean;
          reticulumManagedConfigEnabled?: boolean;
          reticulumTransportEnabled?: boolean;
          reticulumChatEnabled?: boolean;
          communityStunContributionEnabled?: boolean;
        }) => void
      ) => () => void;
      /** Reticulum (rnsd) child process status from main process. */
      reticulumGetStatus?: () => Promise<{
        running: boolean;
        pid?: number;
        mode: 'frozen' | 'venv' | 'system' | null;
        configDir: string;
        reason?: string;
        bridgeState?: 'stopped' | 'starting' | 'ready' | 'degraded';
        reachability: 'unknown' | 'lan-only' | 'hub-connected' | 'disconnected';
        transportEnabled?: boolean;
        configuredHubInterfaces?: number;
        onlineHubInterfaces?: number;
        configuredRemoteHubInterfaces?: number;
        onlineRemoteHubInterfaces?: number;
        hubSummary?: string;
        overlayLinksConnected?: number;
        p2pOutboundOverlayPeers?: number;
        p2pInboundOverlayPeers?: number;
        p2pActiveOverlayPeers?: number;
        p2pReceivingOverlayPeers?: number;
        p2pReceivingOverlayPeersStableMs?: number;
        verifiedOverlayPeerCount?: number;
      }>;
      reticulumGetConfigEditorInfo?: () => Promise<{
        ok: boolean;
        error?: string;
        contents: string;
        configPath: string;
        configDir: string;
        instanceIndex: number;
        instanceLabel: string;
        managedConfigEnabled: boolean;
        sharedDaemon: boolean;
        maxBytes: number;
        updatedAt?: number;
      }>;
      reticulumSaveConfigEditorContents?: (contents: string) => Promise<{
        ok: boolean;
        error?: string;
        contents: string;
        configPath: string;
        configDir: string;
        instanceIndex: number;
        instanceLabel: string;
        managedConfigEnabled: boolean;
        sharedDaemon: boolean;
        maxBytes: number;
        updatedAt?: number;
      }>;
      reticulumGetGeneratedDefaultConfig?: () => Promise<{
        ok: boolean;
        contents: string;
        error?: string;
      }>;
      reticulumRevealConfigInFileExplorer?: () => Promise<{
        ok: boolean;
        error?: string;
        configPath: string;
        configDir: string;
      }>;
      onReticulumStatus?: (
        callback: (status: {
          running: boolean;
          pid?: number;
          mode: 'frozen' | 'venv' | 'system' | null;
          configDir: string;
          reason?: string;
          bridgeState?: 'stopped' | 'starting' | 'ready' | 'degraded';
          reachability:
            | 'unknown'
            | 'lan-only'
            | 'hub-connected'
            | 'disconnected';
          transportEnabled?: boolean;
          configuredHubInterfaces?: number;
          onlineHubInterfaces?: number;
          configuredRemoteHubInterfaces?: number;
          onlineRemoteHubInterfaces?: number;
          hubSummary?: string;
          overlayLinksConnected?: number;
          p2pOutboundOverlayPeers?: number;
          p2pInboundOverlayPeers?: number;
          p2pActiveOverlayPeers?: number;
          p2pReceivingOverlayPeers?: number;
          p2pReceivingOverlayPeersStableMs?: number;
          verifiedOverlayPeerCount?: number;
        }) => void
      ) => () => void;
      reticulumGetOverlayPeers?: () => Promise<
        Array<{
          linkId: string;
          peerPresenceHash: string;
          incoming?: boolean;
          address?: string;
          addresses?: string[];
          connectedAt: number;
        }>
      >;
      reticulumGetDetails?: () => Promise<{
        destinationHash: string | null;
        overlayPeers: Array<{
          linkId: string;
          peerPresenceHash: string;
          incoming?: boolean;
          address?: string;
          addresses?: string[];
          connectedAt: number;
        }>;
      }>;
      reticulumGetMeshStatus?: () => Promise<{
        enabled: boolean;
        listenPort: number;
        meshListenEnabled: boolean;
        upnpMapped: boolean;
        reachableSelf: boolean;
        meshDiscoveryClient: boolean;
        meshPrivateGateway: boolean;
        networkIdentityPath: string;
        discoveryReachableHost?: string;
        meshReachableOnHost?: string;
        meshReachableOnEffective: string | null;
      }>;
      reticulumEnsureMeshNetworkIdentity?: () => Promise<{
        ok: boolean;
        error?: string;
        created?: boolean;
      }>;
      /** Local Reticulum hub destination hash (hex); null if bridge not ready. */
      reticulumGetLocalDestinationHash?: () => Promise<{
        destinationHash: string | null;
      }>;
      /** RNS.Identity public key (64 bytes, standard base64); null if bridge not ready. */
      reticulumGetLocalIdentityPublicKeyBase64?: () => Promise<{
        publicKeyBase64: string | null;
      }>;
      qappReticulumRequest?: (owner: any, options: any) => Promise<any>;
      qappReticulumConnect?: (owner: any, destination: string) => Promise<any>;
      qappReticulumSend?: (
        owner: any,
        connectionId: string,
        payload: unknown
      ) => Promise<any>;
      qappReticulumClose?: (
        owner: any,
        connectionId: string
      ) => Promise<boolean>;
      qappReticulumCleanupOwner?: (owner: any) => Promise<boolean>;
      qappFrameRegister?: (frameName: string, owner: any) => Promise<boolean>;
      qappFrameUnregister?: (frameName: string) => Promise<boolean>;
      onQAppReticulumEvent?: (callback: (payload: any) => void) => () => void;
      qappFileSave?: (owner: any, request: any) => Promise<any>;
      privateChannelOpen?: (
        owner: any,
        rnsConnectionId: unknown,
        purpose: unknown
      ) => Promise<any>;
      privateChannelSend?: (
        owner: any,
        channelId: unknown,
        lane: unknown,
        messageId: unknown,
        data: unknown,
        streamOptions?: unknown
      ) => Promise<any>;
      privateChannelStatus?: (owner: any, channelId: unknown) => Promise<any>;
      privateChannelClose?: (owner: any, channelId: unknown) => Promise<any>;
      privateChannelCleanupOwner?: (owner: any) => Promise<boolean>;
      onPrivateChannelEvent?: (callback: (payload: any) => void) => () => void;
      qappMoqOpen?: (
        owner: any,
        rnsConnectionId: unknown,
        publicationNamespace: unknown,
        publicationTrack: unknown
      ) => Promise<any>;
      qappMoqSubscribe?: (
        owner: any,
        sessionId: unknown,
        subscriptionId: unknown,
        namespace: unknown,
        trackName: unknown
      ) => Promise<any>;
      qappMoqPublish?: (
        owner: any,
        sessionId: unknown,
        payload: unknown
      ) => Promise<any>;
      qappMoqMetrics?: (owner: any, sessionId: unknown) => Promise<any>;
      qappMoqClose?: (owner: any, sessionId: unknown) => Promise<any>;
      qappMoqCleanupOwner?: (owner: any) => Promise<any>;
      onQAppMoqEvent?: (callback: (payload: any) => void) => () => void;
      /** Hidden audio-surface: proxy signing to the main shell (wallet key in-memory). */
      gcallProxySignPresenceMessage?: (
        payload: Record<string, unknown>
      ) => Promise<{
        signature?: string;
        error?: string;
        message?: string;
      }>;
      gcallProxyDecryptBoxWithMyKey?: (payload: {
        ephemeralPublicKey: string;
        nonce: string;
        ciphertext: string;
      }) => Promise<{
        decryptedKey?: string;
        error?: string;
        message?: string;
      }>;
    };
    videoServer?: {
      start: (
        port?: number
      ) => Promise<{ success: boolean; port?: number; error?: string }>;
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
      }) => Promise<{
        success: boolean;
        port?: number;
        peerId?: string;
        error?: string;
      }>;
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
        cb: (payload: {
          id: string;
          from: string;
          via?: string;
          to?: string;
          data: unknown;
        }) => void
      ) => () => void;
      /** Subscribe to peer connect/disconnect events. Returns unsubscribe fn. */
      onPeerChange: (
        cb: (payload: {
          type: 'connected' | 'disconnected';
          id: string;
        }) => void
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
      subscribe: (
        chatId: string
      ) => Promise<{ success: boolean; error?: string }>;

      /** Unsubscribe from a chat. */
      unsubscribe: (chatId: string) => Promise<{ success: boolean }>;

      /** Broadcast an ephemeral typing indicator. */
      sendTyping: (
        chatId: string,
        authorAddress: string
      ) => Promise<{ success: boolean }>;

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
      markRead: (
        chatId: string,
        upToTimestamp: number
      ) => Promise<{ success: boolean }>;

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
        cb: (payload: {
          chatId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => () => void;

      /** Subscribe to typing events for one chatId only. */
      onTypingForChat: (
        chatId: string,
        cb: (payload: {
          chatId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => () => void;

      /**
       * Subscribe to incoming read receipt events.
       * Returns an unsubscribe function.
       */
      onRead: (
        cb: (payload: {
          chatId: string;
          readerAddress: string;
          eventIds: string[];
        }) => void
      ) => () => void;

      /** Subscribe to read receipt events for one chatId only. */
      onReadForChat: (
        chatId: string,
        cb: (payload: {
          chatId: string;
          readerAddress: string;
          eventIds: string[];
        }) => void
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
      /** Start the main-process heartbeat scheduler. */
      startHeartbeatScheduler?: () => Promise<{ success: boolean }>;
      /** Stop the main-process heartbeat scheduler. */
      stopHeartbeatScheduler?: () => Promise<{ success: boolean }>;
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
        cb: (payload: {
          address: string;
          online: boolean;
          status: UserStatus | null;
        }) => void
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
      /** Subscribe to the "presence transport ready" event (fired after transport start or wake recovery). */
      onStarted: (cb: () => void) => () => void;
      /** Subscribe to heartbeat ticks emitted by the main process. */
      onHeartbeatRequested?: (cb: () => void) => () => void;
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
      initiate: (
        targetAddress: string,
        chatId: string,
        localAddress: string,
        signature: string,
        publicKey: string,
        callId: string,
        timestamp: number,
        cancellationSignature?: string,
        cancellationPublicKey?: string,
        cancellationTimestamp?: number
      ) => Promise<{ success: boolean; callId?: string; error?: string }>;
      accept: (
        callId: string,
        signature: string,
        publicKey: string,
        timestamp: number
      ) => Promise<{ success: boolean }>;
      reject: (
        callId: string,
        reason?: string,
        signature?: string,
        publicKey?: string,
        timestamp?: number,
        reasonSignature?: string
      ) => Promise<{ success: boolean }>;
      hangup: (
        callId: string,
        signature: string,
        publicKey: string,
        timestamp: number
      ) => Promise<{ success: boolean }>;
      sendRtcSignal: (input: {
        callId: string;
        generation: string;
        signalId: string;
        signalType: 'capability' | 'offer' | 'answer' | 'candidate';
        payload: string;
        payloadHash: string;
        timestamp: number;
        signature: string;
        publicKey: string;
      }) => Promise<{ success: boolean; error?: string }>;
      setLocalAddresses: (
        addresses: string[],
        source?: string
      ) => Promise<{ success: boolean }>;
      onEvent: (cb: (event: string, payload: unknown) => void) => () => void;
    };

    reticulumChat?: {
      isEnabled: () => Promise<boolean>;
      getReadinessStatus: () => Promise<{
        state: 'idle' | 'starting' | 'ready' | 'failed';
        revision: number;
        error?: string;
      }>;
      onReadinessChanged: (
        cb: (status: {
          state: 'idle' | 'starting' | 'ready' | 'failed';
          revision: number;
          error?: string;
        }) => void
      ) => () => void;
      setLocalGroupMemberships: (
        groupIds: Array<
          | number
          | {
              groupId: number;
              isPrivate?: boolean;
              isOpen?: boolean;
              localAddress?: string;
              address?: string;
              isAdmin?: boolean;
              adminStatusAuthoritative?: boolean;
            }
        >
      ) => Promise<{ success: boolean; error?: string }>;
      setPublicGroupDirectory: (
        groupIds: number[]
      ) => Promise<{ success: boolean; error?: string }>;
      getPublicGroupActivity: () => Promise<
        Array<{
          groupId: number;
          messages24h: number;
          messages7d: number;
          activeAuthors7d: number;
          observedAt: number;
          confidence: number;
        }>
      >;
      getPublicGroupActivitySnapshot: () => Promise<{
        availableGroupIds: number[];
        observedAt: number;
        summaries: Array<{
          groupId: number;
          messages24h: number;
          messages7d: number;
          activeAuthors7d: number;
          observedAt: number;
          confidence: number;
        }>;
      }>;
      setLocalDmAddresses: (
        addresses: string[]
      ) => Promise<{ success: boolean; error?: string }>;
      clearLocalAccountState: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      getSilence: (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) => Promise<{
        ownerAddress: string;
        targetAddress: string;
        scopeType: 'group' | 'dm';
        scopeId: string;
        expiresAt: number | null;
        ignoredThrough: number;
        active: boolean;
      } | null>;
      listSilences: (
        ownerAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) => Promise<
        Array<{
          ownerAddress: string;
          targetAddress: string;
          scopeType: 'group' | 'dm';
          scopeId: string;
          createdAt: number;
          expiresAt: number | null;
          ignoredThrough: number;
          updatedAt: number;
          active: boolean;
        }>
      >;
      setSilence: (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        durationMs: number | null,
        groupId?: number
      ) => Promise<{ success: boolean; silence?: unknown; error?: string }>;
      clearSilence: (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) => Promise<{ success: boolean; silence?: unknown; error?: string }>;
      setActiveDirectChat: (
        localAddress: string,
        peerAddress: string,
        active: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      subscribeGroup: (
        groupId: number
      ) => Promise<{ success: boolean; error?: string }>;
      subscribeChannel: (
        groupId: number,
        channelId: string
      ) => Promise<{ success: boolean; error?: string }>;
      unsubscribeChannel: (
        groupId: number,
        channelId: string
      ) => Promise<{ success: boolean; error?: string }>;
      unsubscribeGroup: (
        groupId: number
      ) => Promise<{ success: boolean; error?: string }>;
      publishEvent: (
        event: unknown
      ) => Promise<{ success: boolean; error?: string }>;
      reserveAuthorSequence: (
        groupId: number,
        authorAddress: string
      ) => Promise<{ authorStreamId: string; authorSeq: number }>;
      releaseAuthorSequence: (
        groupId: number,
        authorAddress: string,
        authorStreamId: string,
        authorSeq: number
      ) => Promise<boolean>;
      publishDirectEvent: (
        event: unknown
      ) => Promise<{ success: boolean; error?: string }>;
      getDirectAuthorStreamId: (authorAddress: string) => Promise<string>;
      getDirectExpiryPreference: (
        ownerAddress: string,
        peerAddress: string
      ) => Promise<{
        success: boolean;
        preference?: {
          ownerAddress: string;
          peerAddress: string;
          durationMs: number | null;
          updatedAt: number;
        };
        error?: string;
      }>;
      setDirectExpiryPreference: (
        ownerAddress: string,
        peerAddress: string,
        durationMs: number | null
      ) => Promise<{
        success: boolean;
        preference?: {
          ownerAddress: string;
          peerAddress: string;
          durationMs: number | null;
          updatedAt: number;
        };
        error?: string;
      }>;
      getCalendarEvents: (
        groupId: number,
        rangeStart: number,
        rangeEnd: number
      ) => Promise<ReticulumCalendarOccurrence[]>;
      getCalendarEvent: (
        groupId: number,
        eventId: string,
        preferredOccurrenceStart?: number
      ) => Promise<ReticulumCalendarOccurrence | null>;
      createCalendarEvent: (
        groupId: number,
        input: ReticulumCalendarEventInput,
        eventId?: string
      ) => Promise<unknown>;
      updateCalendarEvent: (
        groupId: number,
        eventId: string,
        input: ReticulumCalendarEventInput
      ) => Promise<unknown>;
      deleteCalendarEvent: (
        groupId: number,
        eventId: string
      ) => Promise<unknown>;
      getCalendarReminder: (
        ownerAddress: string,
        groupId: number,
        eventId: string
      ) => Promise<ReticulumCalendarReminder | null>;
      setCalendarReminder: (
        ownerAddress: string,
        groupId: number,
        eventId: string,
        offsetMs: number | null
      ) => Promise<ReticulumCalendarReminder>;
      sendDirectTyping: (
        localAddress: string,
        peerAddress: string,
        active: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      getDirectHistory: (
        myAddress: string,
        peerAddress: string,
        limit?: number
      ) => Promise<unknown[]>;
      getDirectSummaries: (
        myAddress: string,
        peerAddress?: string
      ) => Promise<unknown[]>;
      getDirectCallHistory: (
        ownerAddress: string,
        peerAddress?: string,
        limit?: number,
        unreadOnly?: boolean
      ) => Promise<unknown[]>;
      markDirectRead: (
        myAddress: string,
        peerAddress: string,
        upToTimestamp: number
      ) => Promise<{ success: boolean; error?: string }>;
      sendTyping: (
        groupId: number,
        channelId: string,
        authorAddress: string,
        active: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      sendLandState: (
        groupId: number,
        authorAddress: string,
        state: {
          sessionId?: unknown;
          sequence?: unknown;
          x?: unknown;
          y?: unknown;
          roomId?: unknown;
          direction?: unknown;
          movement?: unknown;
          afk?: unknown;
          dnd?: unknown;
          voiceEnabled?: unknown;
          voiceMuted?: unknown;
          skinId?: unknown;
        }
      ) => Promise<{ success: boolean; error?: string }>;
      sendLandChat: (
        message: unknown
      ) => Promise<{ success: boolean; error?: string }>;
      sendLandAction: (
        groupId: number,
        action: unknown
      ) => Promise<{ success: boolean; error?: string }>;
      sendLandCall: (
        groupId: number,
        call: unknown
      ) => Promise<{ success: boolean; error?: string }>;
      requestResource: (
        groupId: number,
        manifest: unknown,
        eventId?: string
      ) => Promise<{ success: boolean; error?: string }>;
      requestDirectResource: (
        myAddress: string,
        peerAddress: string,
        manifest: unknown,
        eventId?: string
      ) => Promise<{ success: boolean; error?: string }>;
      cancelResource: (
        fileHash: string
      ) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
      getHistory: (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: {
          beforeTimestamp?: number;
          beforeEventId?: string;
          afterTimestamp?: number;
          afterEventId?: string;
          repairNetwork?: boolean;
        }
      ) => Promise<unknown[]>;
      getMessageHistory: (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: {
          beforeTimestamp?: number;
          beforeEventId?: string;
          afterTimestamp?: number;
          afterEventId?: string;
          repairNetwork?: boolean;
        }
      ) => Promise<unknown[]>;
      getMessageHistoryPage: (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: {
          beforeTimestamp?: number;
          beforeEventId?: string;
          afterTimestamp?: number;
          afterEventId?: string;
          repairNetwork?: boolean;
        }
      ) => Promise<{
        events: unknown[];
        oldestCursor: { timestamp: number; eventId: string } | null;
        newestCursor: { timestamp: number; eventId: string } | null;
        hasMore: boolean;
      }>;
      getDiscussionIndex: (
        groupId: number,
        channelId?: string
      ) => Promise<{
        replyCounts: Record<string, number>;
        rootByEventId: Record<string, string>;
      }>;
      getDiscussionMessages: (
        groupId: number,
        channelId: string,
        eventId: string
      ) => Promise<unknown[]>;
      getChannelMetadataHistory: (
        groupId: number,
        limit?: number
      ) => Promise<unknown[]>;
      getChannels: (
        groupId: number,
        includeArchived?: boolean
      ) => Promise<unknown[]>;
      getCategories: (groupId: number) => Promise<unknown[]>;
      getChannelMetadataBundle: (
        groupId: number,
        includeArchived?: boolean
      ) => Promise<{
        channels: unknown[];
        categories: unknown[];
        ready: boolean;
        snapshotVersion: number;
      }>;
      applyChannelMetadata: (
        eventId: string,
        payload: unknown
      ) => Promise<{ success: boolean }>;
      getSyncState: (groupId: number) => Promise<Record<string, number>>;
      getSummaries: (myAddress?: string) => Promise<unknown[]>;
      search: (
        query: string,
        options?: {
          groupIds?: number[];
          channelIds?: string[];
          authorAddresses?: string[];
          eventTypes?: Array<'message' | 'attachment_manifest'>;
          beforeTimestamp?: number;
          afterTimestamp?: number;
          hasAttachment?: boolean;
          hasLink?: boolean;
          sort?: 'relevance' | 'newest' | 'oldest';
          limit?: number;
          offset?: number;
          cursor?: {
            createdAt: number;
            eventId: string;
          };
        }
      ) => Promise<unknown[]>;
      getMessageWindowAroundEvent: (
        groupId: number,
        channelId: string,
        eventId: string,
        options?: {
          beforeLimit?: number;
          afterLimit?: number;
        }
      ) => Promise<unknown[]>;
      getMessageWindowPageAroundEvent: (
        groupId: number,
        channelId: string,
        eventId: string,
        options?: {
          beforeLimit?: number;
          afterLimit?: number;
        }
      ) => Promise<{
        events: unknown[];
        oldestCursor: { timestamp: number; eventId: string } | null;
        newestCursor: { timestamp: number; eventId: string } | null;
        hasOlder: boolean;
        hasNewer: boolean;
      }>;
      indexSearchText: (
        eventId: string,
        text: string
      ) => Promise<{ success: boolean }>;
      deleteSearchText: (eventId: string) => Promise<{ success: boolean }>;
      replaceMentions: (
        eventId: string,
        mentionedAddresses: string[]
      ) => Promise<{ success: boolean }>;
      deleteMentions: (eventId: string) => Promise<{ success: boolean }>;
      markRead: (
        groupId: number,
        channelId: string,
        upToTimestamp: number,
        myAddress?: string
      ) => Promise<{ success: boolean }>;
      markGroupsRead: (
        groupIds: number[],
        myAddress?: string
      ) => Promise<{
        success: boolean;
        error?: string;
        groupsMarked: number;
        channelsMarked: number;
      }>;
      getSubscriptions: () => Promise<number[]>;
      updateMentionBadge: (
        mentionCount: number
      ) => Promise<{ success: boolean }>;
      onEvent: (cb: (payload: { event: unknown }) => void) => () => void;
      onSummaryChanged: (
        cb: (payload: {
          groupId: number;
          eventId?: string;
          timestamp?: number;
          metadataChanged?: boolean;
        }) => void
      ) => () => void;
      onCalendarChanged: (
        cb: (payload: { groupId: number; eventId?: string }) => void
      ) => () => void;
      onCalendarReminderDue: (cb: (payload: unknown) => void) => () => void;
      onDirectEvent: (cb: (payload: { event: unknown }) => void) => () => void;
      onDirectCallHistory: (
        cb: (payload: { record: unknown }) => void
      ) => () => void;
      onDirectTyping: (
        cb: (payload: {
          conversationId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => () => void;
      onDirectSummaryChanged: (
        cb: (payload: {
          conversationId?: string;
          peerAddress?: string;
          reason?: 'expiry' | 'call';
        }) => void
      ) => () => void;
      onSilenceChanged: (
        cb: (payload: {
          ownerAddress: string;
          targetAddress: string;
          scopeType: 'group' | 'dm';
          scopeId: string;
          expiresAt: number | null;
          active: boolean;
        }) => void
      ) => () => void;
      onTyping: (
        cb: (payload: {
          groupId: number;
          channelId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => () => void;
      onLandState: (
        cb: (payload: {
          groupId: number;
          authorAddress: string;
          sessionId: string;
          destinationHash?: string;
          sequence: number;
          x: number;
          y: number;
          roomId?: string;
          direction?: string;
          movement?: string;
          afk?: boolean;
          dnd?: boolean;
          voiceEnabled?: boolean;
          voiceMuted?: boolean;
          skinId?: number;
          timestamp?: number;
        }) => void
      ) => () => void;
      onLandChat: (
        cb: (payload: {
          groupId: number;
          messageId: string;
          authorAddress: string;
          sessionId: string;
          sequence: number;
          timestamp: number;
          text: string;
        }) => void
      ) => () => void;
      onLandAction: (
        cb: (payload: {
          groupId: number;
          actionId: string;
          actionType: string;
          fromAddress: string;
          sourceSessionId: string;
          sequence: number;
          toAddress: string;
          targetSessionId: string;
          amount: number;
          roomId?: string;
          timestamp?: number;
        }) => void
      ) => () => void;
      onLandCall: (
        cb: (payload: {
          groupId: number;
          callType: string;
          callId: string;
          fromAddress: string;
          toAddress: string;
          chatId?: string;
          fromPublicKey?: string;
          signature?: string;
          reason?: string;
          roomId?: string;
          sourceSessionId?: string;
          targetSessionId?: string;
          sourceDestinationHash?: string;
          targetDestinationHash?: string;
          timestamp?: number;
        }) => void
      ) => () => void;
      onResource: (
        cb: (payload: {
          groupId?: number;
          eventId?: string;
          fileHash?: string;
          bytesTransferred?: number;
          totalBytes?: number;
          progress?: number;
          complete?: boolean;
          failed?: boolean;
          canceled?: boolean;
          failureReason?: 'verification_failed';
        }) => void
      ) => () => void;
    };

    reticulumResources?: {
      getPathForFile: (file: File) => string;
      convertGifToWebp: (payload: {
        filePath?: string;
        bytes?: Uint8Array;
        fileName?: string;
        targetBytes?: number;
      }) => Promise<{
        success: boolean;
        filePath?: string;
        fileName?: string;
        mimeType?: string;
        originalSizeBytes?: number;
        sizeBytes?: number;
        width?: number;
        height?: number;
        pages?: number;
        targetAchieved?: boolean;
        error?: string;
      }>;
      releaseConvertedMedia: (
        filePath: string
      ) => Promise<{ success: boolean; error?: string }>;
      importBase64: (payload: {
        base64?: string;
        namespace?: string;
        ownerId?: string;
        fileName?: string;
        mimeType?: string;
        encrypted?: boolean;
        metadata?: Record<string, unknown>;
      }) => Promise<{ success: boolean; manifest?: unknown; error?: string }>;
      importFilePath: (payload: {
        filePath?: string;
        namespace?: string;
        ownerId?: string;
        fileName?: string;
        mimeType?: string;
        encrypted?: boolean;
        metadata?: Record<string, unknown>;
      }) => Promise<{ success: boolean; manifest?: unknown; error?: string }>;
      getUrl: (fileHash: string) => Promise<{
        success: boolean;
        url?: string;
        manifest?: unknown;
        error?: string;
      }>;
      getStatus: (fileHash: string) => Promise<{
        success: boolean;
        manifest?: unknown;
        bytesTransferred?: number;
        totalBytes?: number;
        progress?: number;
        complete?: boolean;
        latestRangeUpdatedAt?: number | null;
        checkedAt?: number;
        runtime?: {
          active?: boolean;
          peerCount?: number;
          candidatePeerCount?: number;
          advertisedPeerCount?: number;
          activeTransfers?: number;
          pendingTransfers?: number;
          requestedRangeCount?: number;
          inFlightRangeCount?: number;
          bytesTransferred?: number;
          totalBytes?: number;
          progress?: number;
          nextRequestAt?: number | null;
        } | null;
        error?: string;
      }>;
      getStorageStatus: () => Promise<{
        success: boolean;
        status?: {
          limitBytes: number;
          lowWatermarkBytes: number;
          totalResidentBytes: number;
          authoredResidentBytes: number;
          remoteResidentBytes: number;
          partialResidentBytes: number;
          reservedBytes: number;
          protectedBytes: number;
          evictableBytes: number;
          blobCount: number;
          residentBlobCount: number;
          lastCleanupAt: number | null;
          lastCleanupFreedBytes: number;
          blockedAuthoredPublishes: number;
        };
        error?: string;
      }>;
      cleanupStorage: () => Promise<{
        success: boolean;
        result?: {
          freedBytes: number;
          evictedBlobs: number;
        };
        status?: {
          limitBytes: number;
          totalResidentBytes: number;
          authoredResidentBytes: number;
          remoteResidentBytes: number;
          partialResidentBytes: number;
          reservedBytes: number;
        };
        error?: string;
      }>;
      saveAs: (
        fileHash: string,
        suggestedFileName?: string
      ) => Promise<{
        success: boolean;
        canceled?: boolean;
        path?: string;
        error?: string;
      }>;
      open: (
        fileHash: string,
        suggestedFileName?: string
      ) => Promise<{
        success: boolean;
        error?: string;
      }>;
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
        reticulumDestinationHash: string,
        joinGeneration?: number,
        topologyEpochFloor?: number,
        reticulumIdentityPublicKeyBase64?: string,
        joinRkSignature?: string,
        dmVoiceAudioLinkRole?: 'opener' | 'waiter',
        takeover?: boolean,
        dmVoicePeerDestinationHash?: string,
        dmVoiceCallId?: string
      ) => Promise<{
        success: boolean;
        error?: string;
        callSessionId?: string;
        mediaSessionGeneration?: number;
      }>;
      leave: (
        roomId: string,
        localAddress: string,
        signature: string,
        publicKey: string,
        timestamp: number,
        joinGeneration?: number
      ) => Promise<{ success: boolean }>;
      leaveSync?: (
        roomId: string,
        localAddress: string,
        signature: string,
        publicKey: string,
        timestamp: number,
        joinGeneration?: number
      ) => { success: boolean; error?: string };
      broadcastTopology: (
        roomId: string,
        topology: unknown,
        signature: string,
        publicKey: string,
        timestamp: number,
        localAuthorityProvisional?: boolean
      ) => Promise<{ success: boolean }>;
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
        data: Uint8Array,
        timing?: { rendererSendAtWallMs?: number }
      ) => Promise<{
        success: boolean;
        error?: string;
        diagnostics?: {
          transport: 'link' | 'packet';
          pendingFrames: number;
          queuePressureDrops: number;
          staleDrops: number;
          linkUnreadyDrops: number;
          packetSendFailures: number;
          targetAddress?: string;
          peerPresenceHash?: string;
          routeKey?: string;
          lastInboundAtMs?: number;
          recoveryReason?: string;
          recoveryHoldUntilMs?: number;
          linkFallbackActive?: boolean;
          linkFallbackReason?: string;
          linkFallbackDwellMs?: number;
          linkFallbackProbeCount?: number;
          linkFallbackExitCount?: number;
          linkFallbackLastDwellMs?: number;
          pathDiversityActive?: boolean;
          pathDiversityReason?: string;
          pathDiversityMirrorAttempts?: number;
          pathDiversityMirrorSuccesses?: number;
          pathDiversityMirrorFailures?: number;
          rendererToMainIpcMsMax?: number;
          mainIpcToManagerEnqueueMsMax?: number;
          managerPendingDwellMsMax?: number;
          managerFlushToBridgeEnqueueMsMax?: number;
          bridge?: {
            bridgeQueuedFrames: number;
            bridgeQueuedBytes: number;
            bridgeBinaryWritesQueued: number;
            bridgeWaitingForDrain: boolean;
            perLinkQueuedFrames: number;
            queuePressureDrops: number;
            queuePressureDropsLast5s: number;
            staleDrops: number;
            staleDropsLast5s: number;
            decodedQueueDepth: number;
            decodedQueueMax: number;
            decodedQueueDrops: number;
            binaryOutQueueDepth: number;
            binaryOutQueueMax: number;
            binaryOutQueueDrops: number;
            jsonOutQueueDrops: number;
            packetSendFailures: number;
            packetPathRequests: number;
            packetPathResolutions: number;
            packetPathTimeouts: number;
            packetFreshSends: number;
            packetStaleSends: number;
            packetUnknownSends: number;
            deadlineDropCount: number;
            decodedQueueEvictOldestCount: number;
            decodedQueueDropNewestCount: number;
            fd3DecodedAgeMsMax: number;
            decodedQueueDwellMsMax: number;
            rnsSendDurationMsMax: number;
            packetPathCheckMsMax: number;
            executorLoopGapMsMax: number;
            executorGapWhileQueuedMsMax: number;
            executorAudioPassMsMax: number;
            processBatchMsMax: number;
            processBatchFramesMax: number;
            rnsSendSlowCount: number;
            executorStallCount: number;
            executorCommandMsMax: number;
            executorCommandWhileQueuedMsMax: number;
            executorCommandSlowCount: number;
            rnsCallbackSchedulerGapMsMax: number;
            rnsCallbackSchedulerGapOver100Count: number;
            rnsCallbackSchedulerGapOver250Count: number;
            rnsCallbackSchedulerGapOver500Count: number;
            rnsCallbackSchedulerGapOver1000Count: number;
            rnsRawInboundGapMsMax: number;
            rnsRawInboundGapOver80Count: number;
            rnsRawInboundGapOver160Count: number;
            rnsRawInboundGapOver320Count: number;
            rnsRawInboundGapOver640Count: number;
            rnsRawInboundGapOver1000Count: number;
            rnsRawInboundToLinkReceiveMsMax: number;
            rnsRawInboundToLinkReceiveOver80Count: number;
            rnsRawInboundToLinkReceiveOver160Count: number;
            rnsRawInboundToLinkReceiveOver320Count: number;
            rnsRawInboundToLinkReceiveOver640Count: number;
            rnsRawInboundToLinkReceiveOver1000Count: number;
            rnsRawInboundToLinkReceiveSamples: number;
            rnsRawInboundInterfaceLast: string;
            rnsRawInboundInterfaceWorst: string;
            rnsSharedFrameGapMsMax: number;
            rnsSharedFrameGapOver80Count: number;
            rnsSharedFrameGapOver160Count: number;
            rnsSharedFrameGapOver320Count: number;
            rnsSharedFrameGapOver640Count: number;
            rnsSharedFrameGapOver1000Count: number;
            rnsSharedFrameToTransportInboundMsMax: number;
            rnsSharedFrameToTransportInboundOver80Count: number;
            rnsSharedFrameToTransportInboundOver160Count: number;
            rnsSharedFrameToTransportInboundOver320Count: number;
            rnsSharedFrameToTransportInboundOver640Count: number;
            rnsSharedFrameToTransportInboundOver1000Count: number;
            rnsSharedFrameToTransportInboundSamples: number;
            rnsSharedFrameInterfaceLast: string;
            rnsSharedFrameInterfaceWorst: string;
            schedulerDiagnostics?: Array<Record<string, unknown>>;
            rendererToBridgeEnqueueMsMax: number;
            managerFlushToBridgeEnqueueMsMax: number;
            bridgeEnqueueToFd3WriteMsMax: number;
            bridgeEnqueueToFd3WriteQueueDwellMsMax: number;
            rendererToFd3WriteMsMax: number;
          };
        };
      }>;
      sendRtcSignal: (input: {
        roomId: string;
        callSessionId: string;
        mediaSessionGeneration: number;
        fromAddress: string;
        toAddress: string;
        connectionId: string;
        signalId: string;
        signalType:
          | 'capability'
          | 'offer'
          | 'answer'
          | 'candidate'
          | 'candidates'
          | 'ack'
          | 'reconnect';
        payload: string;
        payloadHash: string;
        timestamp: number;
        signature: string;
        publicKey: string;
      }) => Promise<{ success: boolean; error?: string }>;
      sendAudioBatch?: (
        roomId: string,
        toAddresses: string[],
        data: Uint8Array,
        timing?: { rendererSendAtWallMs?: number }
      ) => Promise<{
        success: boolean;
        error?: string;
        diagnostics?: {
          transport: 'link' | 'packet';
          pendingFrames: number;
          queuePressureDrops: number;
          staleDrops: number;
          linkUnreadyDrops: number;
          packetSendFailures: number;
          targetAddress?: string;
          peerPresenceHash?: string;
          routeKey?: string;
          lastInboundAtMs?: number;
          recoveryReason?: string;
          recoveryHoldUntilMs?: number;
          linkFallbackActive?: boolean;
          linkFallbackReason?: string;
          linkFallbackDwellMs?: number;
          linkFallbackProbeCount?: number;
          linkFallbackExitCount?: number;
          linkFallbackLastDwellMs?: number;
          pathDiversityActive?: boolean;
          pathDiversityReason?: string;
          pathDiversityMirrorAttempts?: number;
          pathDiversityMirrorSuccesses?: number;
          pathDiversityMirrorFailures?: number;
          rendererToMainIpcMsMax?: number;
          mainIpcToManagerEnqueueMsMax?: number;
          managerPendingDwellMsMax?: number;
          managerFlushToBridgeEnqueueMsMax?: number;
          bridge?: {
            bridgeQueuedFrames: number;
            bridgeQueuedBytes: number;
            bridgeBinaryWritesQueued: number;
            bridgeWaitingForDrain: boolean;
            perLinkQueuedFrames: number;
            queuePressureDrops: number;
            queuePressureDropsLast5s: number;
            staleDrops: number;
            staleDropsLast5s: number;
            decodedQueueDepth: number;
            decodedQueueMax: number;
            decodedQueueDrops: number;
            binaryOutQueueDepth: number;
            binaryOutQueueMax: number;
            binaryOutQueueDrops: number;
            jsonOutQueueDrops: number;
            packetSendFailures: number;
            packetPathRequests: number;
            packetPathResolutions: number;
            packetPathTimeouts: number;
            packetFreshSends: number;
            packetStaleSends: number;
            packetUnknownSends: number;
            deadlineDropCount: number;
            decodedQueueEvictOldestCount: number;
            decodedQueueDropNewestCount: number;
            fd3DecodedAgeMsMax: number;
            decodedQueueDwellMsMax: number;
            rnsSendDurationMsMax: number;
            packetPathCheckMsMax: number;
            executorLoopGapMsMax: number;
            executorGapWhileQueuedMsMax: number;
            executorAudioPassMsMax: number;
            processBatchMsMax: number;
            processBatchFramesMax: number;
            rnsSendSlowCount: number;
            executorStallCount: number;
            executorCommandMsMax: number;
            executorCommandWhileQueuedMsMax: number;
            executorCommandSlowCount: number;
            rnsCallbackSchedulerGapMsMax: number;
            rnsCallbackSchedulerGapOver100Count: number;
            rnsCallbackSchedulerGapOver250Count: number;
            rnsCallbackSchedulerGapOver500Count: number;
            rnsCallbackSchedulerGapOver1000Count: number;
            rnsRawInboundGapMsMax: number;
            rnsRawInboundGapOver80Count: number;
            rnsRawInboundGapOver160Count: number;
            rnsRawInboundGapOver320Count: number;
            rnsRawInboundGapOver640Count: number;
            rnsRawInboundGapOver1000Count: number;
            rnsRawInboundToLinkReceiveMsMax: number;
            rnsRawInboundToLinkReceiveOver80Count: number;
            rnsRawInboundToLinkReceiveOver160Count: number;
            rnsRawInboundToLinkReceiveOver320Count: number;
            rnsRawInboundToLinkReceiveOver640Count: number;
            rnsRawInboundToLinkReceiveOver1000Count: number;
            rnsRawInboundToLinkReceiveSamples: number;
            rnsRawInboundInterfaceLast: string;
            rnsRawInboundInterfaceWorst: string;
            rnsSharedFrameGapMsMax: number;
            rnsSharedFrameGapOver80Count: number;
            rnsSharedFrameGapOver160Count: number;
            rnsSharedFrameGapOver320Count: number;
            rnsSharedFrameGapOver640Count: number;
            rnsSharedFrameGapOver1000Count: number;
            rnsSharedFrameToTransportInboundMsMax: number;
            rnsSharedFrameToTransportInboundOver80Count: number;
            rnsSharedFrameToTransportInboundOver160Count: number;
            rnsSharedFrameToTransportInboundOver320Count: number;
            rnsSharedFrameToTransportInboundOver640Count: number;
            rnsSharedFrameToTransportInboundOver1000Count: number;
            rnsSharedFrameToTransportInboundSamples: number;
            rnsSharedFrameInterfaceLast: string;
            rnsSharedFrameInterfaceWorst: string;
            schedulerDiagnostics?: Array<Record<string, unknown>>;
            rendererToBridgeEnqueueMsMax: number;
            managerFlushToBridgeEnqueueMsMax: number;
            bridgeEnqueueToFd3WriteMsMax: number;
            bridgeEnqueueToFd3WriteQueueDwellMsMax: number;
            rendererToFd3WriteMsMax: number;
          };
        };
      }>;
      requestPeerMediaRecovery?: (
        roomId: string,
        address: string,
        reason: string
      ) => Promise<{ success: boolean; error?: string }>;
      getAudioDataPlaneSession?: (
        roomId: string,
        toAddresses: string[]
      ) => Promise<
        | {
            ok: true;
            endpoint: string;
            token: string;
            version: 2;
            routeCount: number;
            routes?: Array<{
              address?: string;
              transport?: 'link' | 'packet';
              linkId?: string;
              peerPresenceHash?: string;
              peerDestinationHash?: string;
            }>;
          }
        | { ok: false; reason?: string; error?: string }
      >;
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
      ) => Promise<{ success: boolean; error?: string }>;
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
      requestSessionBreak: (
        roomId: string
      ) => Promise<{ success: boolean; error?: string }>;
      setLocalAddresses: (
        addresses: string[],
        source?: string
      ) => Promise<{ success: boolean }>;
      setQortalGroupReticulumTargets?: (
        roomId: string,
        addresses: string[]
      ) => Promise<{ success: boolean; error?: string }>;
      reportTransportHealth?: (
        roomId: string,
        healthyPeerAddresses: string[]
      ) => Promise<{ success: boolean }>;
      reportGcallAudioEscalation?: (opts: {
        failSafeActive?: boolean;
      }) => Promise<{ success: boolean; error?: string }>;
      getLinkStats?: (roomId: string) => Promise<{
        success: boolean;
        error?: string;
        stats?: {
          roomId: string;
          establishedLinks: number;
          participants: number;
        };
      }>;
      getRoomParticipants: (
        roomId: string
      ) => Promise<Array<{ address: string; publicKey: string }>>;
      getRoomBootstrapState?: (roomId: string) => Promise<{
        roomId: string;
        chatId: string;
        participants: Array<{
          address: string;
          publicKey: string;
          joinedAt: number;
        }>;
        topologyEpoch: number;
        lastTopology?: {
          topologyEpoch: number;
          rootForwarder: string;
          standbyForwarder: string;
          clusters: Array<{
            members: string[];
            forwarder: string;
            standby: string;
            standby2?: string;
          }>;
          lastSeen?: number | null;
        };
        callSessionId: string;
        mediaSessionGeneration: number;
        updatedAtMs: number;
        fromRecentCache: boolean;
      } | null>;
      setWatchedQortalGroupIds?: (ids: number[]) => Promise<{
        success: boolean;
        error?: string;
        activeByGroupId?: Record<string, boolean>;
        participantCountByGroupId?: Record<string, number>;
        maxParticipantsByGroupId?: Record<string, number>;
      }>;
      onQortalGroupCallActivity?: (
        cb: (payload: {
          activeByGroupId: Record<string, boolean>;
          participantCountByGroupId?: Record<string, number>;
          maxParticipantsByGroupId?: Record<string, number>;
        }) => void
      ) => () => void;
      getPendingKeyMetrics?: () => Promise<{
        pending_key_flush_success: number;
        pending_key_expired: number;
        pendingRooms: number;
      }>;
      /** Replays retained verified keys from main (use after join if initial replay was empty). */
      requestRetainedKeyReplay?: () => void;
      onEvent: (cb: (event: string, payload: unknown) => void) => () => void;
    };
    audioSurface?: {
      isReady?: () => Promise<boolean>;
      ensureReady: () => Promise<{ success: boolean; error?: string }>;
      sendCommand: (command: AudioSurfaceCommand) => Promise<{
        ok: boolean;
        payload?: unknown;
        error?: string;
      }>;
      onEvent: (cb: (event: AudioSurfaceEvent) => void) => () => void;
      getWindowRole: () => Promise<string>;
    };
    audioSurfaceHost?: {
      notifyReady: () => void;
      emitEvent: (event: AudioSurfaceEvent) => void;
      resolveCommand: (envelope: AudioSurfaceCommandResultEnvelope) => void;
      onCommand: (
        cb: (envelope: AudioSurfaceCommandEnvelope) => void
      ) => () => void;
    };
    __qortalGCallExportDiagnostics?: () => Promise<void>;
    __qortalGCallPerfStats?: () => unknown;
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

  /** Presence status values that mean "present in the network". */
  type UserStatus = 'online' | 'busy' | 'idle';

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
