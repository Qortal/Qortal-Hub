import { log as loggerLog, error as loggerError } from './logger';
loggerLog('User Preload!');
import { contextBridge, shell, ipcRenderer } from 'electron';
import { buildBootstrapIceServers } from './stun-bootstrap';
import { isDisabledLegacy } from './feature-flags';
import { AUDIO_SURFACE_WINDOW_ROLE } from './audio-window-policy';
import type {
  AudioSurfaceCommand,
  AudioSurfaceCommandEnvelope,
  AudioSurfaceCommandResultEnvelope,
  AudioSurfaceEvent,
} from './audio-surface-ipc';

// Sandbox-safe minimal Capacitor bridge. The repo's electron-plugins module is
// currently empty, so we only need to preserve the platform marker here.
contextBridge.exposeInMainWorld('CapacitorCustomPlatform', {
  name: 'electron',
  plugins: {},
});

function parseHubBootstrapSeedsFromArgv(): string[] {
  const prefix = '--hub-p2p-seeds=';
  for (const arg of process.argv) {
    if (!arg.startsWith(prefix)) continue;
    try {
      const raw = Buffer.from(arg.slice(prefix.length), 'base64').toString(
        'utf8'
      );
      const j = JSON.parse(raw) as { seeds?: unknown };
      if (!Array.isArray(j.seeds)) return [];
      return j.seeds.filter((s): s is string => typeof s === 'string');
    } catch {
      return [];
    }
  }
  return [];
}

function parseWindowRoleFromArgv(): string {
  const prefix = '--window-role=';
  for (const arg of process.argv) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length) || 'main-shell';
    }
  }
  return 'main-shell';
}

const hubP2pBootstrapIceServers = isDisabledLegacy
  ? []
  : buildBootstrapIceServers(parseHubBootstrapSeedsFromArgv());
const windowRole = parseWindowRoleFromArgv();
const isAudioSurfaceWindow = windowRole === AUDIO_SURFACE_WINDOW_ROLE;

/**
 * Refcount `groupCall.onEvent` lifetimes so the last unsubscribe is the only one that sends
 * `gcall:unsubscribe`. Group voice + DM voice both subscribe; leaving the group must not
 * remove the window from main's fanout while DM still needs `gcall:key` / `gcall:audio`.
 */
let gcallFullStreamOnEventRefCount = 0;
/** Same idea as gcall: avoid dropping main fanout if `call.onEvent` is registered more than once. */
let callOnEventRefCount = 0;

type PresenceUpdatePayload = {
  address: string;
  online: boolean;
  status: 'online' | 'busy' | 'idle' | null;
};

type ChatEventPayload = { event: { chatId: string } };
type ChatTypingPayload = {
  chatId: string;
  authorAddress: string;
  active: boolean;
};
type ChatReadPayload = {
  chatId: string;
  readerAddress: string;
  eventIds: string[];
};

const presenceUpdateSubscribers = new Set<
  (payload: PresenceUpdatePayload) => void
>();
const presenceUpdateBatchSubscribers = new Set<
  (payloads: PresenceUpdatePayload[]) => void
>();
let presenceSubscribed = false;
let queuedPresenceUpdates = new Map<string, PresenceUpdatePayload>();
let presenceFlushTimer: ReturnType<typeof setTimeout> | null = null;

const flushQueuedPresenceUpdates = () => {
  if (presenceFlushTimer) {
    clearTimeout(presenceFlushTimer);
    presenceFlushTimer = null;
  }
  if (queuedPresenceUpdates.size === 0) return;

  const payloads = Array.from(queuedPresenceUpdates.values());
  queuedPresenceUpdates = new Map();
  for (const cb of presenceUpdateBatchSubscribers) cb(payloads);
  for (const payload of payloads) {
    for (const cb of presenceUpdateSubscribers) cb(payload);
  }
};

const handlePresenceUpdateBatch = (_e: unknown, payload: unknown) => {
  if (!Array.isArray(payload)) return;
  for (const item of payload) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as PresenceUpdatePayload).address === 'string'
    ) {
      queuedPresenceUpdates.set(
        (item as PresenceUpdatePayload).address,
        item as PresenceUpdatePayload
      );
    }
  }

  if (presenceFlushTimer) return;
  presenceFlushTimer = setTimeout(() => flushQueuedPresenceUpdates(), 16);
};

const ensurePresenceSubscribed = () => {
  if (presenceSubscribed) return;
  presenceSubscribed = true;
  ipcRenderer.on('presence:update-batch', handlePresenceUpdateBatch);
  ipcRenderer.send('presence:subscribe');
};

const maybeUnsubscribePresence = () => {
  if (
    presenceUpdateSubscribers.size > 0 ||
    presenceUpdateBatchSubscribers.size > 0
  ) {
    return;
  }
  if (presenceFlushTimer) {
    clearTimeout(presenceFlushTimer);
    presenceFlushTimer = null;
  }
  queuedPresenceUpdates.clear();
  if (!presenceSubscribed) return;
  presenceSubscribed = false;
  ipcRenderer.removeListener(
    'presence:update-batch',
    handlePresenceUpdateBatch
  );
  ipcRenderer.send('presence:unsubscribe');
};

const chatEventSubscribers = new Set<(payload: ChatEventPayload) => void>();
const chatEventSubscribersByChatId = new Map<
  string,
  Set<(payload: ChatEventPayload) => void>
>();
let chatEventSubscribed = false;

const handleChatEvent = (_e: unknown, payload: unknown) => {
  const eventPayload = payload as ChatEventPayload;
  for (const cb of chatEventSubscribers) cb(eventPayload);
  const chatId = eventPayload?.event?.chatId;
  if (typeof chatId !== 'string') return;
  for (const cb of chatEventSubscribersByChatId.get(chatId) ?? [])
    cb(eventPayload);
};

const ensureChatEventSubscribed = () => {
  if (chatEventSubscribed) return;
  chatEventSubscribed = true;
  ipcRenderer.on('chat:event', handleChatEvent);
  ipcRenderer.send('chat:event:subscribe');
};

const maybeUnsubscribeChatEvent = () => {
  if (chatEventSubscribers.size > 0 || chatEventSubscribersByChatId.size > 0) {
    return;
  }
  if (!chatEventSubscribed) return;
  chatEventSubscribed = false;
  ipcRenderer.removeListener('chat:event', handleChatEvent);
  ipcRenderer.send('chat:event:unsubscribe');
};

const chatTypingSubscribers = new Set<(payload: ChatTypingPayload) => void>();
const chatTypingSubscribersByChatId = new Map<
  string,
  Set<(payload: ChatTypingPayload) => void>
>();
let chatTypingSubscribed = false;

const dispatchChatTyping = (payload: ChatTypingPayload) => {
  for (const cb of chatTypingSubscribers) cb(payload);
  for (const cb of chatTypingSubscribersByChatId.get(payload.chatId) ?? [])
    cb(payload);
};

const handleChatTypingStart = (_e: unknown, payload: unknown) => {
  dispatchChatTyping({
    ...(payload as Record<string, unknown>),
    active: true,
  } as ChatTypingPayload);
};

const handleChatTypingStop = (_e: unknown, payload: unknown) => {
  dispatchChatTyping({
    ...(payload as Record<string, unknown>),
    active: false,
  } as ChatTypingPayload);
};

const ensureChatTypingSubscribed = () => {
  if (chatTypingSubscribed) return;
  chatTypingSubscribed = true;
  ipcRenderer.on('chat:typing', handleChatTypingStart);
  ipcRenderer.on('chat:typingStopped', handleChatTypingStop);
  ipcRenderer.send('chat:typing:subscribe');
};

const maybeUnsubscribeChatTyping = () => {
  if (
    chatTypingSubscribers.size > 0 ||
    chatTypingSubscribersByChatId.size > 0
  ) {
    return;
  }
  if (!chatTypingSubscribed) return;
  chatTypingSubscribed = false;
  ipcRenderer.removeListener('chat:typing', handleChatTypingStart);
  ipcRenderer.removeListener('chat:typingStopped', handleChatTypingStop);
  ipcRenderer.send('chat:typing:unsubscribe');
};

const chatReadSubscribers = new Set<(payload: ChatReadPayload) => void>();
const chatReadSubscribersByChatId = new Map<
  string,
  Set<(payload: ChatReadPayload) => void>
>();
let chatReadSubscribed = false;

const handleChatRead = (_e: unknown, payload: unknown) => {
  const readPayload = payload as ChatReadPayload;
  for (const cb of chatReadSubscribers) cb(readPayload);
  const chatId = readPayload?.chatId;
  if (typeof chatId !== 'string') return;
  for (const cb of chatReadSubscribersByChatId.get(chatId) ?? [])
    cb(readPayload);
};

const ensureChatReadSubscribed = () => {
  if (chatReadSubscribed) return;
  chatReadSubscribed = true;
  ipcRenderer.on('chat:read', handleChatRead);
  ipcRenderer.send('chat:read:subscribe');
};

const maybeUnsubscribeChatRead = () => {
  if (chatReadSubscribers.size > 0 || chatReadSubscribersByChatId.size > 0) {
    return;
  }
  if (!chatReadSubscribed) return;
  chatReadSubscribed = false;
  ipcRenderer.removeListener('chat:read', handleChatRead);
  ipcRenderer.send('chat:read:unsubscribe');
};

function addChatScopedSubscriber<T>(
  subscribersByChatId: Map<string, Set<(payload: T) => void>>,
  chatId: string,
  cb: (payload: T) => void
): () => void {
  let scoped = subscribersByChatId.get(chatId);
  if (!scoped) {
    scoped = new Set<(payload: T) => void>();
    subscribersByChatId.set(chatId, scoped);
  }
  scoped.add(cb);
  return () => {
    const current = subscribersByChatId.get(chatId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) {
      subscribersByChatId.delete(chatId);
    }
  };
}

try {
  // Expose Electron API
  contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url: string) => {
      if (typeof url !== 'string') {
        return;
      }
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return;
        }
        if (!parsed.hostname) {
          return;
        }
        void shell.openExternal(parsed.toString());
      } catch {
        // Invalid URL
      }
    },
    setAllowedDomains: (domains) => {
      ipcRenderer.send('set-allowed-domains', domains);
    },
    ensureCertForBase: (baseUrl: string, apiKey?: string) =>
      ipcRenderer.invoke('cert:ensureForBase', baseUrl, apiKey),
    // Custom title bar window controls
    windowMinimize: () => ipcRenderer.invoke('window:minimize'),
    windowMaximize: () => ipcRenderer.invoke('window:maximize'),
    windowClose: () => ipcRenderer.invoke('window:close'),
    focusWindow: () => ipcRenderer.invoke('window:focus'),
    getWindowState: () =>
      ipcRenderer
        .invoke('window:isMaximized')
        .then((isMaximized: boolean) => ({ isMaximized })),
    onWindowStateChange: (
      callback: (state: { isMaximized: boolean }) => void
    ) => {
      const handler = (_event, isMaximized: boolean) => {
        callback({ isMaximized });
      };
      ipcRenderer.on('window:state-changed', handler);
      return () => {
        ipcRenderer.removeListener('window:state-changed', handler);
      };
    },
    getPlatform: () => ipcRenderer.invoke('window:getPlatform'),
    getSystemCallReadiness: () =>
      ipcRenderer.invoke('systemCallReadiness:getSnapshot') as Promise<{
        status: 'good' | 'warning' | 'blocked' | 'unknown';
        reasons: string[];
        cpuLoad: number | null;
        memoryPressure: number;
        eventLoopLagMs: number;
        measuredAt: number;
      }>,
    refreshSystemCallReadiness: () =>
      ipcRenderer.invoke('systemCallReadiness:refreshSnapshot') as Promise<{
        status: 'good' | 'warning' | 'blocked' | 'unknown';
        reasons: string[];
        cpuLoad: number | null;
        memoryPressure: number;
        eventLoopLagMs: number;
        measuredAt: number;
      }>,
    showAppMenu: (x?: number, y?: number) =>
      ipcRenderer.invoke('window:showAppMenu', { x, y }),
    getAppSettings: () => ipcRenderer.invoke('appSettings:get'),
    setAppSettings: (settings: {
      closeAction?: 'ask' | 'minimizeToTray' | 'quit';
      disableStartupSound?: boolean;
      p2pEnabled?: boolean;
      legacyPublicStunFallback?: boolean;
      reticulumMeshUpnpEnabled?: boolean;
      reticulumManagedConfigEnabled?: boolean;
    }) => ipcRenderer.invoke('appSettings:set', settings),
    reticulumGetStatus: () =>
      ipcRenderer.invoke('reticulum:getStatus') as Promise<{
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
        p2pActiveOverlayPeers?: number;
        verifiedOverlayPeerCount?: number;
      }>,
    reticulumGetConfigEditorInfo: () =>
      ipcRenderer.invoke('reticulum:getConfigEditorInfo') as Promise<{
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
      }>,
    reticulumSaveConfigEditorContents: (contents: string) =>
      ipcRenderer.invoke(
        'reticulum:saveConfigEditorContents',
        contents
      ) as Promise<{
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
      }>,
    reticulumGetGeneratedDefaultConfig: () =>
      ipcRenderer.invoke('reticulum:getGeneratedDefaultConfig') as Promise<{
        ok: boolean;
        contents: string;
        error?: string;
      }>,
    reticulumRevealConfigInFileExplorer: () =>
      ipcRenderer.invoke('reticulum:revealConfigInFileExplorer') as Promise<{
        ok: boolean;
        error?: string;
        configPath: string;
        configDir: string;
      }>,
    onReticulumStatus: (
      callback: (status: {
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
        p2pActiveOverlayPeers?: number;
        verifiedOverlayPeerCount?: number;
      }) => void
    ) => {
      const handler = (_event: unknown, status: unknown) => {
        callback(status as any);
      };
      ipcRenderer.on('reticulum:status', handler);
      ipcRenderer.send('reticulum:status:subscribe');
      return () => {
        ipcRenderer.removeListener('reticulum:status', handler);
        ipcRenderer.send('reticulum:status:unsubscribe');
      };
    },
    reticulumGetOverlayPeers: () =>
      ipcRenderer.invoke('reticulum:getOverlayPeers') as Promise<
        Array<{
          linkId: string;
          peerPresenceHash: string;
          incoming?: boolean;
          address?: string;
          connectedAt: number;
        }>
      >,
    reticulumGetMeshStatus: () =>
      ipcRenderer.invoke('reticulum:getMeshStatus') as Promise<{
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
      }>,
    reticulumEnsureMeshNetworkIdentity: () =>
      ipcRenderer.invoke('reticulum:ensureMeshNetworkIdentity') as Promise<{
        ok: boolean;
        error?: string;
        created?: boolean;
      }>,
    reticulumGetLocalDestinationHash: () =>
      ipcRenderer.invoke('reticulum:getLocalDestinationHash') as Promise<{
        destinationHash: string | null;
      }>,
    reticulumGetLocalIdentityPublicKeyBase64: () =>
      ipcRenderer.invoke(
        'reticulum:getLocalIdentityPublicKeyBase64'
      ) as Promise<{
        publicKeyBase64: string | null;
      }>,
    qchatFileSelect: () =>
      ipcRenderer.invoke('reticulum:qchatFileSelect') as Promise<{
        ok: boolean;
        canceled?: boolean;
        error?: string;
        file?: { path: string; name: string; size: number; sha256: string };
      }>,
    qchatFileChooseSavePath: (fileName: string) =>
      ipcRenderer.invoke(
        'reticulum:qchatFileChooseSavePath',
        fileName
      ) as Promise<{
        ok: boolean;
        canceled?: boolean;
        error?: string;
        path?: string;
      }>,
    qchatFileAccept: (payload: {
      transferId: string;
      senderAddress: string;
      recipientAddress?: string;
      authMessage?: Record<string, unknown>;
      senderReticulumDestinationHash?: string;
      senderReticulumIdentityPublicKeyBase64?: string;
      savePath: string;
      fileName: string;
      size: number;
      sha256?: string;
    }) =>
      ipcRenderer.invoke('reticulum:qchatFileAccept', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    qchatFileSend: (payload: {
      transferId: string;
      senderAddress?: string;
      allowedRecipientAddress?: string;
      recipientAddress: string;
      filePath: string;
      fileName: string;
      size: number;
      sha256?: string;
      expiresAt?: number;
    }) =>
      ipcRenderer.invoke('reticulum:qchatFileSend', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    onQchatFileTransferEvent: (cb: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        cb(payload);
      ipcRenderer.on('reticulum:qchatFileTransferEvent', listener);
      return () =>
        ipcRenderer.removeListener(
          'reticulum:qchatFileTransferEvent',
          listener
        );
    },
    ...(isAudioSurfaceWindow
      ? {
          /**
           * The audio window cannot use in-memory `keyPair` decryption with
           * `window.sendMessage` → `signPresenceMessage` (see groupCallJoinSigning).
           * IPC runs signing in the main shell renderer.
           */
          gcallProxySignPresenceMessage: (payload: Record<string, unknown>) =>
            ipcRenderer.invoke(
              'gcall:proxySignPresenceMessage',
              payload
            ) as Promise<{
              signature?: string;
              error?: string;
              message?: string;
            }>,
          gcallProxyDecryptBoxWithMyKey: (payload: {
            ephemeralPublicKey: string;
            nonce: string;
            ciphertext: string;
          }) =>
            ipcRenderer.invoke(
              'gcall:proxyDecryptBoxWithMyKey',
              payload
            ) as Promise<{
              decryptedKey?: string;
              error?: string;
              message?: string;
            }>,
        }
      : {}),
  });

  contextBridge.exposeInMainWorld('audioSurface', {
    isReady: () =>
      ipcRenderer.invoke('audio-surface:is-ready') as Promise<boolean>,
    ensureReady: () =>
      ipcRenderer.invoke('audio-surface:ensure-ready') as Promise<{
        success: boolean;
        error?: string;
      }>,
    sendCommand: (command: AudioSurfaceCommand) =>
      ipcRenderer.invoke('audio-surface:send-command', command) as Promise<{
        ok: boolean;
        payload?: unknown;
        error?: string;
      }>,
    onEvent: (cb: (event: AudioSurfaceEvent) => void) => {
      const channel = 'audio-surface:event';
      const handler = (_event: unknown, payload: unknown) => {
        cb(payload as AudioSurfaceEvent);
      };
      ipcRenderer.on(channel, handler);
      ipcRenderer.send('audio-surface:subscribe');
      return () => {
        ipcRenderer.send('audio-surface:unsubscribe');
        ipcRenderer.removeListener(channel, handler);
      };
    },
    getWindowRole: async () => windowRole,
  });

  if (isAudioSurfaceWindow) {
    /**
     * Main sends `audio-surface:host-command` as soon as the user joins; the page
     * module may still be loading (heavy imports) before it calls `onCommand`.
     * Register the IPC listener in preload so commands are never dropped; queue
     * until the page provides a handler.
     */
    const HOST_COMMAND = 'audio-surface:host-command' as const;
    let onHostCommand: ((e: AudioSurfaceCommandEnvelope) => void) | null = null;
    const hostCommandBacklog: AudioSurfaceCommandEnvelope[] = [];
    ipcRenderer.on(HOST_COMMAND, (_e, payload: unknown) => {
      const envelope = payload as AudioSurfaceCommandEnvelope;
      if (onHostCommand) {
        try {
          onHostCommand(envelope);
        } catch (err) {
          loggerError('[audio-surface] onHostCommand', err);
        }
      } else {
        hostCommandBacklog.push(envelope);
      }
    });
    contextBridge.exposeInMainWorld('audioSurfaceHost', {
      notifyReady: () => {
        ipcRenderer.send('audio-surface:host-ready');
      },
      emitEvent: (event: AudioSurfaceEvent) => {
        ipcRenderer.send('audio-surface:host-event', event);
      },
      resolveCommand: (envelope: AudioSurfaceCommandResultEnvelope) => {
        void ipcRenderer
          .invoke('audio-surface:command-result', envelope)
          .then((ack: { ack?: boolean; reason?: string }) => {
            if (ack && ack.ack === false) {
              loggerError('[audio-surface] command-result not applied', ack);
            }
          })
          .catch((err) => {
            loggerError('[audio-surface] command-result invoke failed', err);
          });
      },
      onCommand: (cb: (envelope: AudioSurfaceCommandEnvelope) => void) => {
        onHostCommand = (envelope) => {
          void Promise.resolve(cb(envelope)).catch((err) => {
            loggerError('[audio-surface] onCommand async', err);
          });
        };
        for (const e of hostCommandBacklog.splice(0)) {
          onHostCommand(e);
        }
        return () => {
          onHostCommand = null;
        };
      },
    });
  }

  // Expose other utility functions
  contextBridge.exposeInMainWorld('electron', {
    onUpdateAvailable: (callback) =>
      ipcRenderer.on('update_available', callback),
    onUpdateDownloaded: (callback) =>
      ipcRenderer.on('update_downloaded', callback),
    restartApp: () => ipcRenderer.send('restart_app'),
    selectFile: async () => ipcRenderer.invoke('dialog:openFile'),
    readFile: async (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    selectAndZipDirectory: async (filePath) =>
      ipcRenderer.invoke('fs:selectAndZip', filePath),
    // Streaming file save methods
    startStreamSave: async (options: { filename: string; mimeType?: string }) =>
      ipcRenderer.invoke('file:startStreamSave', options),
    writeChunk: async (filePath: string, chunk: Uint8Array, append: boolean) =>
      ipcRenderer.invoke('file:writeChunk', filePath, chunk, append),
    deleteFile: async (filePath: string) =>
      ipcRenderer.invoke('file:deleteFile', filePath),
  });

  // Generic persistent store (persistent-store.json, in-memory cache + debounced writes in main)
  contextBridge.exposeInMainWorld('appStorage', {
    get: async (key) => {
      return ipcRenderer.invoke('persistentStore:get', key);
    },
    set: async (key, value) => {
      return ipcRenderer.invoke('persistentStore:set', key, value);
    },
    delete: async (key) => {
      return ipcRenderer.invoke('persistentStore:delete', key);
    },
  });

  contextBridge.exposeInMainWorld('miscStorage', {
    get: async (key) => {
      return ipcRenderer.invoke('miscPersistentStore:get', key);
    },
    set: async (key, value) => {
      return ipcRenderer.invoke('miscPersistentStore:set', key, value);
    },
    delete: async (key) => {
      return ipcRenderer.invoke('miscPersistentStore:delete', key);
    },
  });

  // Expose it
  contextBridge.exposeInMainWorld('walletStorage', {
    get: async (key) => {
      const raw = await ipcRenderer.invoke(
        'walletStorage:read',
        'wallet-storage.json'
      );
      const data = raw ? JSON.parse(raw) : {};
      return data[key];
    },
    set: async (key, value) => {
      const raw = await ipcRenderer.invoke(
        'walletStorage:read',
        'wallet-storage.json'
      );
      const data = raw ? JSON.parse(raw) : {};
      data[key] = value;
      await ipcRenderer.invoke(
        'walletStorage:write',
        'wallet-storage.json',
        JSON.stringify(data, null, 2)
      );
    },
    delete: async (key) => {
      const raw = await ipcRenderer.invoke(
        'walletStorage:read',
        'wallet-storage.json'
      );
      const data = raw ? JSON.parse(raw) : {};
      delete data[key];
      await ipcRenderer.invoke(
        'walletStorage:write',
        'wallet-storage.json',
        JSON.stringify(data, null, 2)
      );
    },
  });

  // Expose it
  contextBridge.exposeInMainWorld('coreSetup', {
    isCoreRunning: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:isCoreRunning');
      return raw;
    },
    isCoreRunningOnSystem: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:isCoreRunning');
      return raw;
    },
    isCoreInstalledOnSystem: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:isCoreInstalledOnSystem');
      return raw;
    },
    isCoreInstalled: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:isCoreInstalled');
      return raw;
    },
    verifySteps: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:verifySteps');
      return raw;
    },
    deleteDB: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:deleteDB');
      return raw;
    },
    dbExists: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:dbExists');
      return raw;
    },
    installCore: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:installCore');
      return raw;
    },
    startCore: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:startCore');
      return raw;
    },
    getApiKey: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:getApiKey');
      return raw;
    },
    resetApikey: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:resetApikey');
      return raw;
    },
    pickQortalDirectory: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:pickQortalDirectory');
      return raw;
    },
    removeCustomPath: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:removeCustomPath');
      return raw;
    },
    stopCore: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:stopCore');
      return raw;
    },
    bootstrap: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:bootstrap');
      return raw;
    },
    bootstrapOrClearChainAndStart: async () => {
      const raw = await ipcRenderer.invoke(
        'coreSetup:bootstrapOrClearChainAndStart'
      );
      return raw;
    },
    onProgress: (cb: (p: any) => void) => {
      const h = (_e: unknown, p: any) => cb(p);
      ipcRenderer.on('coreSetup:progress', h);
      ipcRenderer.send('coreSetup:progress:subscribe');

      return () => {
        ipcRenderer.removeListener('coreSetup:progress', h);
        ipcRenderer.send('coreSetup:progress:unsubscribe');
      };
    },
  });

  // Video Server API
  contextBridge.exposeInMainWorld('videoServer', {
    start: async (port?: number) => {
      return await ipcRenderer.invoke('videoServer:start', port);
    },
    stop: async () => {
      return await ipcRenderer.invoke('videoServer:stop');
    },
    getPort: async () => {
      return await ipcRenderer.invoke('videoServer:getPort');
    },
    isRunning: async () => {
      return await ipcRenderer.invoke('videoServer:isRunning');
    },
  });

  if (!isDisabledLegacy) {
    // P2P Network API
    contextBridge.exposeInMainWorld('p2pNetwork', {
      start: async (options?: {
        port?: number;
        maxPeers?: number;
        initialPeers?: string[];
      }) => ipcRenderer.invoke('p2p:start', options),

      stop: async () => ipcRenderer.invoke('p2p:stop'),

      send: async (to: string | null, data: unknown) =>
        ipcRenderer.invoke('p2p:send', to, data),

      getPeers: async () => ipcRenderer.invoke('p2p:getPeers'),

      getStatus: async () => ipcRenderer.invoke('p2p:getStatus'),

      addPeer: async (addr: string) => ipcRenderer.invoke('p2p:addPeer', addr),

      /** Subscribe to incoming messages. Returns an unsubscribe function. */
      onMessage: (
        cb: (payload: {
          id: string;
          from: string;
          via?: string;
          to?: string;
          data: unknown;
        }) => void
      ) => {
        const handler = (_e: unknown, payload: unknown) => cb(payload as any);
        ipcRenderer.on('p2p:message', handler);
        ipcRenderer.send('p2p:message:subscribe');
        return () => {
          ipcRenderer.removeListener('p2p:message', handler);
          ipcRenderer.send('p2p:message:unsubscribe');
        };
      },

      /** Subscribe to peer connect/disconnect events. Returns an unsubscribe function. */
      onPeerChange: (
        cb: (payload: {
          type: 'connected' | 'disconnected';
          id: string;
        }) => void
      ) => {
        const handler = (_e: unknown, payload: unknown) => cb(payload as any);
        ipcRenderer.on('p2p:peerChange', handler);
        ipcRenderer.send('p2p:peerChange:subscribe');
        return () => {
          ipcRenderer.removeListener('p2p:peerChange', handler);
          ipcRenderer.send('p2p:peerChange:unsubscribe');
        };
      },
    });
  }

  // Presence API — see electron/src/presence.ts for full type definitions.
  //   1. Generate sessionId (crypto.randomUUID())
  //   2. Build the canonical signed-data object (sorted keys → JSON → UTF-8)
  //   3. Sign with nacl.sign.detached(bytes, privateKeyBytes) → Base58-encode
  //   4. Call window.presence.announce(envelope) on login
  //   5. Call window.presence.heartbeat(envelope) every 25 s
  //   6. Call window.presence.offline(envelope) on logout / close
  //
  // Canonical signed data shape:
  //   announce:  { type, address, publicKey, sessionId, timestamp, clientVersion }
  //   heartbeat: { type, address, publicKey, sessionId, timestamp }
  //   offline:   { type, address, publicKey, sessionId, timestamp }
  //   (keys sorted alphabetically before JSON.stringify)
  contextBridge.exposeInMainWorld('presence', {
    /**
     * Announce that the local user is online.
     * The renderer must sign the envelope before calling this.
     */
    announce: async (envelope: unknown) =>
      ipcRenderer.invoke('presence:announce', envelope),

    /** Send a periodic heartbeat to keep the session alive (every 25 s). */
    heartbeat: async (envelope: unknown) =>
      ipcRenderer.invoke('presence:heartbeat', envelope),

    /** Announce that the local user is going offline. */
    offline: async (envelope: unknown) =>
      ipcRenderer.invoke('presence:offline', envelope),

    /** Check whether an address is currently online. */
    getStatus: async (address: string) =>
      ipcRenderer.invoke('presence:getStatus', address),

    /** Get an array of all currently online addresses. */
    getOnlineAddresses: async () =>
      ipcRenderer.invoke('presence:getOnlineAddresses'),

    /** Get full session info for all online users. */
    getAllOnline: async () => ipcRenderer.invoke('presence:getAllOnline'),

    /**
     * Subscribe to presence updates (connect / timeout / logout).
     * `cb` receives `{ address: string; online: boolean }`.
     * Returns an unsubscribe function.
     */
    onUpdate: (
      cb: (payload: {
        address: string;
        online: boolean;
        status: 'online' | 'busy' | 'idle' | null;
      }) => void
    ) => {
      ensurePresenceSubscribed();
      presenceUpdateSubscribers.add(
        cb as (payload: PresenceUpdatePayload) => void
      );
      return () => {
        presenceUpdateSubscribers.delete(
          cb as (payload: PresenceUpdatePayload) => void
        );
        maybeUnsubscribePresence();
      };
    },

    /** Subscribe to coalesced presence updates. */
    onUpdateBatch: (
      cb: (
        payloads: Array<{
          address: string;
          online: boolean;
          status: 'online' | 'busy' | 'idle' | null;
        }>
      ) => void
    ) => {
      ensurePresenceSubscribed();
      presenceUpdateBatchSubscribers.add(
        cb as (payloads: PresenceUpdatePayload[]) => void
      );
      return () => {
        presenceUpdateBatchSubscribers.delete(
          cb as (payloads: PresenceUpdatePayload[]) => void
        );
        maybeUnsubscribePresence();
      };
    },

    /**
     * Subscribe to a one-shot "all presence cleared" event that fires when
     * P2P is disabled.  Returns an unsubscribe function.
     */
    onCleared: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('presence:cleared', handler);
      return () => ipcRenderer.removeListener('presence:cleared', handler);
    },

    /** Subscribe to the "presence transport ready" event (fired after transport start or wake recovery). */
    onStarted: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('presence:started', handler);
      return () => ipcRenderer.removeListener('presence:started', handler);
    },
  });

  ipcRenderer.send('test-ipc');

  if (!isDisabledLegacy) {
    // ── Chat API ──────────────────────────────────────────────────────────────
    //
    // Renderer responsibilities for sending a message:
    //   1. Generate a UUID for the event id.
    //   2. Compute seq = (lastKnownSeqForAuthorInChat + 1).
    //   3. Build canonical signed-data:
    //        { authorAddress, authorPublicKey, chatId, content, eventType,
    //          id, seq, timestamp }
    //      (plus replyTo / targetId if present, keys sorted alphabetically)
    //   4. Sign with nacl.sign.detached(canonicalBytes, privateKeyBytes).
    //   5. Base58-encode the signature.
    //   6. Call window.chat.sendEvent({ type: 'CHAT_EVENT', event: { ...fields, signature } }).
    //
    // chatId conventions:
    //   DM:    [addrA, addrB].sort().join(':')   e.g. "Qaddr1:Qaddr2"
    //   Group: "group:" + numericGroupId         e.g. "group:12345"
    contextBridge.exposeInMainWorld('chat', {
      /**
       * Send a signed ChatEventEnvelope (message, edit, delete, or reaction).
       * The renderer must sign the event before calling this.
       * Returns { success: boolean }.
       */
      sendEvent: async (envelope: unknown) =>
        ipcRenderer.invoke('chat:sendEvent', envelope),

      /**
       * Subscribe the local user to a chat.
       * Announces subscription to peers and requests a sync so missed
       * messages are recovered.  Returns { success: boolean }.
       */
      subscribe: async (chatId: string) =>
        ipcRenderer.invoke('chat:subscribe', chatId),

      /** Unsubscribe the local user from a chat. */
      unsubscribe: async (chatId: string) =>
        ipcRenderer.invoke('chat:unsubscribe', chatId),

      /**
       * Broadcast a typing indicator for a chat.
       * Ephemeral — not stored.  Returns { success: boolean }.
       */
      sendTyping: async (chatId: string, authorAddress: string) =>
        ipcRenderer.invoke('chat:sendTyping', chatId, authorAddress),

      /**
       * Retrieve message history for a chat.
       * Pass `beforeTimestamp` for reverse-scroll pagination.
       * Returns ChatEvent[].
       */
      getHistory: async (
        chatId: string,
        limit: number,
        beforeTimestamp?: number
      ) =>
        ipcRenderer.invoke('chat:getHistory', chatId, limit, beforeTimestamp),

      /**
       * Returns a summary of every known chat (last event + unread count).
       * Returns ChatSummary[].
       */
      getSummaries: async () => ipcRenderer.invoke('chat:getSummaries'),

      /**
       * Advance the read watermark for a chat.
       * Events with timestamp ≤ upToTimestamp are marked read.
       */
      markRead: async (chatId: string, upToTimestamp: number) =>
        ipcRenderer.invoke('chat:markRead', chatId, upToTimestamp),

      /**
       * Register the local user's Qortal address(es).
       * The chat manager uses this to auto-accept incoming DMs.
       * Call on login with the user's address; call with [] on logout.
       */
      setLocalAddresses: async (addresses: string[]) =>
        ipcRenderer.invoke('chat:setLocalAddresses', addresses),

      /**
       * Clear the support-queue rate-limit map.
       * Call when an agent logs out so re-knocks from users are not silently
       * dropped when the agent logs back in.
       */
      clearQueueRateLimit: async () =>
        ipcRenderer.invoke('chat:clearQueueRateLimit'),

      /** Returns the chatIds the local node is currently subscribed to. */
      getSubscriptions: async () => ipcRenderer.invoke('chat:getSubscriptions'),

      /**
       * Subscribe to incoming chat events (messages, edits, deletes, reactions).
       * `cb` receives `{ event: ChatEvent }`.
       * Returns an unsubscribe function.
       */
      onEvent: (cb: (payload: { event: unknown }) => void) => {
        ensureChatEventSubscribed();
        chatEventSubscribers.add(cb as (payload: ChatEventPayload) => void);
        return () => {
          chatEventSubscribers.delete(
            cb as (payload: ChatEventPayload) => void
          );
          maybeUnsubscribeChatEvent();
        };
      },

      /** Subscribe to incoming chat events for one chatId only. */
      onEventForChat: (
        chatId: string,
        cb: (payload: { event: unknown }) => void
      ) => {
        ensureChatEventSubscribed();
        const unsubscribeScoped = addChatScopedSubscriber(
          chatEventSubscribersByChatId,
          chatId,
          cb as (payload: ChatEventPayload) => void
        );
        return () => {
          unsubscribeScoped();
          maybeUnsubscribeChatEvent();
        };
      },

      /**
       * Subscribe to typing indicator events.
       * `cb` receives `{ chatId: string; authorAddress: string }`.
       * Returns an unsubscribe function.
       * Both 'chat:typing' (started) and 'chat:typingStopped' are forwarded
       * with an additional `active` boolean field for convenience.
       */
      onTyping: (
        cb: (payload: {
          chatId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => {
        ensureChatTypingSubscribed();
        chatTypingSubscribers.add(cb as (payload: ChatTypingPayload) => void);
        return () => {
          chatTypingSubscribers.delete(
            cb as (payload: ChatTypingPayload) => void
          );
          maybeUnsubscribeChatTyping();
        };
      },

      /** Subscribe to typing indicators for one chatId only. */
      onTypingForChat: (
        chatId: string,
        cb: (payload: {
          chatId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => {
        ensureChatTypingSubscribed();
        const unsubscribeScoped = addChatScopedSubscriber(
          chatTypingSubscribersByChatId,
          chatId,
          cb as (payload: ChatTypingPayload) => void
        );
        return () => {
          unsubscribeScoped();
          maybeUnsubscribeChatTyping();
        };
      },

      /**
       * Persist and broadcast read receipts for a batch of event IDs.
       * Call when the local user has seen events authored by others.
       */
      sendReadReceipt: async (
        chatId: string,
        eventIds: string[],
        readerAddress: string
      ) =>
        ipcRenderer.invoke(
          'chat:sendReadReceipt',
          chatId,
          eventIds,
          readerAddress
        ),

      /**
       * Query-scoped receipt loading.
       * Pass exactly the event IDs currently held in renderer memory;
       * the backend returns receipts only for those IDs.
       * Returns Record<eventId, readerAddress[]>.
       */
      getReadReceipts: async (chatId: string, eventIds: string[]) =>
        ipcRenderer.invoke('chat:getReadReceipts', chatId, eventIds),

      /**
       * Fetch the encrypted attachment blob for an event.
       * Returns the base64 ciphertext string, or null if not locally available.
       * Used for lazy-loading history images that were not included in
       * getHistory results (attachment data is kept in a separate table).
       */
      getAttachment: async (eventId: string) =>
        ipcRenderer.invoke('chat:getAttachment', eventId),

      /**
       * Subscribe to incoming read receipt events.
       * `cb` receives `{ chatId, readerAddress, eventIds }`.
       * Returns an unsubscribe function.
       */
      onRead: (
        cb: (payload: {
          chatId: string;
          readerAddress: string;
          eventIds: string[];
        }) => void
      ) => {
        ensureChatReadSubscribed();
        chatReadSubscribers.add(cb as (payload: ChatReadPayload) => void);
        return () => {
          chatReadSubscribers.delete(cb as (payload: ChatReadPayload) => void);
          maybeUnsubscribeChatRead();
        };
      },

      /** Subscribe to read receipts for one chatId only. */
      onReadForChat: (
        chatId: string,
        cb: (payload: {
          chatId: string;
          readerAddress: string;
          eventIds: string[];
        }) => void
      ) => {
        ensureChatReadSubscribed();
        const unsubscribeScoped = addChatScopedSubscriber(
          chatReadSubscribersByChatId,
          chatId,
          cb as (payload: ChatReadPayload) => void
        );
        return () => {
          unsubscribeScoped();
          maybeUnsubscribeChatRead();
        };
      },
    });

    contextBridge.exposeInMainWorld('hub', {
      getBootstrapIceServers: () => hubP2pBootstrapIceServers,
      getIceServers: () =>
        ipcRenderer.invoke('hub:getIceServers') as Promise<{ urls: string }[]>,
      reportStunCallOutcome: (stunUrls: string[], success: boolean) =>
        ipcRenderer.invoke('hub:reportStunCallOutcome', stunUrls, success),
      reportObservedStunSources: (stunUrls: string[]) =>
        ipcRenderer.invoke('hub:reportObservedStunSources', stunUrls),
    });
  }

  // ── Call API ─────────────────────────────────────────────────────────────────
  //
  // Direct 1:1 call signaling uses Reticulum only.
  //
  // Renderer responsibilities for initiating a call:
  //   1. Build canonical signed-data:
  //        { callId, chatId, fromAddress, fromPublicKey, timestamp, type: 'CALL_REQUEST' }
  //        (keys sorted alphabetically)
  //   2. Sign with nacl.sign.detached(canonicalBytes, privateKeyBytes).
  //   3. Base58-encode the signature.
  //   4. Call window.call.initiate(targetAddress, chatId, localAddress, sig, pubKey).
  contextBridge.exposeInMainWorld('call', {
    /**
     * Initiate an outbound call to `targetAddress`.
     * The renderer must pre-sign the request before calling this.
     * Returns { success, callId? }.
     */
    initiate: async (
      targetAddress: string,
      chatId: string,
      localAddress: string,
      signature: string,
      publicKey: string,
      callId: string,
      timestamp: number
    ) =>
      ipcRenderer.invoke(
        'call:initiate',
        targetAddress,
        chatId,
        localAddress,
        signature,
        publicKey,
        callId,
        timestamp
      ),

    /** Accept an incoming call identified by callId. */
    accept: async (
      callId: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) =>
      ipcRenderer.invoke(
        'call:accept',
        callId,
        signature,
        publicKey,
        timestamp
      ),

    /** Reject an incoming call. */
    reject: async (
      callId: string,
      reason?: string,
      signature?: string,
      publicKey?: string,
      timestamp?: number
    ) =>
      ipcRenderer.invoke(
        'call:reject',
        callId,
        reason,
        signature,
        publicKey,
        timestamp
      ),

    /** Hang up an active or pending call. */
    hangup: async (
      callId: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) =>
      ipcRenderer.invoke(
        'call:hangup',
        callId,
        signature,
        publicKey,
        timestamp
      ),

    /** Register the local user's address with the call manager. */
    setLocalAddresses: async (addresses: string[]) =>
      ipcRenderer.invoke('call:setLocalAddresses', addresses),

    /**
     * Subscribe to all call events.
     * `cb` receives typed payloads keyed by event name.
     * Returns an unsubscribe function.
     */
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      const channels = [
        'call:incoming',
        'call:accepted',
        'call:rejected',
        'call:hangup',
      ] as const;

      const handlers: Map<string, (...args: unknown[]) => void> = new Map();

      for (const channel of channels) {
        const handler = (_e: unknown, payload: unknown) => cb(channel, payload);
        handlers.set(channel, handler);
        ipcRenderer.on(channel, handler);
      }

      callOnEventRefCount++;
      if (callOnEventRefCount === 1) {
        ipcRenderer.send('call:subscribe');
      }

      return () => {
        for (const [channel, handler] of handlers) {
          ipcRenderer.removeListener(channel, handler);
        }
        callOnEventRefCount--;
        if (callOnEventRefCount <= 0) {
          callOnEventRefCount = 0;
          ipcRenderer.send('call:unsubscribe');
        }
      };
    },
  });
  // ── Group Call API ────────────────────────────────────────────────────────────
  contextBridge.exposeInMainWorld('groupCall', {
    /**
     * Join a group call room.
     * The renderer must pre-sign the join envelope before calling this.
     */
    join: async (
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
      joinRkSignature?: string
    ) =>
      ipcRenderer.invoke(
        'gcall:join',
        roomId,
        chatId,
        localAddress,
        signature,
        publicKey,
        timestamp,
        reticulumDestinationHash,
        joinGeneration,
        topologyEpochFloor,
        reticulumIdentityPublicKeyBase64,
        joinRkSignature
      ) as Promise<{
        success: boolean;
        error?: string;
        callSessionId?: string;
        mediaSessionGeneration?: number;
      }>,

    /** Leave a group call room. */
    leave: async (
      roomId: string,
      localAddress: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) =>
      ipcRenderer.invoke(
        'gcall:leave',
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp
      ),

    leaveSync: (
      roomId: string,
      localAddress: string,
      signature: string,
      publicKey: string,
      timestamp: number
    ) =>
      ipcRenderer.sendSync(
        'gcall:leaveSync',
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp
      ) as { success: boolean; error?: string },

    reportTransportHealth: async (
      roomId: string,
      healthyPeerAddresses: string[]
    ) =>
      ipcRenderer.invoke(
        'gcall:reportTransportHealth',
        roomId,
        healthyPeerAddresses
      ) as Promise<{ success: boolean }>,

    /** Broadcast topology (root forwarder only). */
    broadcastTopology: async (
      roomId: string,
      topology: unknown,
      signature: string,
      publicKey: string,
      timestamp: number
    ) =>
      ipcRenderer.invoke(
        'gcall:broadcastTopology',
        roomId,
        topology,
        signature,
        publicKey,
        timestamp
      ),

    sendClusterHeartbeat: async (
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
    ) =>
      ipcRenderer.invoke(
        'gcall:sendClusterHeartbeat',
        roomId,
        payload,
        signature
      ),

    /** Send a group audio packet to a specific participant via the main transport. */
    sendAudio: async (
      roomId: string,
      toAddress: string,
      data: Uint8Array,
      timing?: { rendererSendAtWallMs?: number }
    ) => ipcRenderer.invoke('gcall:sendAudio', roomId, toAddress, data, timing),

    /** Same encoded frame to multiple peers in one IPC round-trip (chunked in renderer). */
    sendAudioBatch: async (
      roomId: string,
      toAddresses: string[],
      data: Uint8Array,
      timing?: { rendererSendAtWallMs?: number }
    ) =>
      ipcRenderer.invoke(
        'gcall:sendAudioBatch',
        roomId,
        toAddresses,
        data,
        timing
      ),

    requestPeerMediaRecovery: async (
      roomId: string,
      address: string,
      reason: string
    ) =>
      ipcRenderer.invoke(
        'gcall:requestPeerMediaRecovery',
        roomId,
        address,
        reason
      ) as Promise<{ success: boolean; error?: string }>,

    reportGcallAudioEscalation: async (opts: { failSafeActive?: boolean }) =>
      ipcRenderer.invoke('gcall:reportGcallAudioEscalation', opts) as Promise<{
        success: boolean;
        error?: string;
      }>,

    getLinkStats: async (roomId: string) =>
      ipcRenderer.invoke('gcall:getLinkStats', roomId) as Promise<{
        success: boolean;
        error?: string;
        stats?: {
          roomId: string;
          establishedLinks: number;
          participants: number;
        };
      }>,

    /** Send room media key (nacl.box encrypted) to a participant. */
    sendKey: async (
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
    ) =>
      ipcRenderer.invoke(
        'gcall:sendKey',
        roomId,
        toAddress,
        encryptedKey,
        fromAddress,
        signature,
        publicKey,
        timestamp,
        meta
      ),

    sendKeyRequest: async (
      roomId: string,
      toAddress: string,
      fromAddress: string,
      signature: string,
      publicKey: string,
      timestamp: number,
      callSessionId: string,
      mediaSessionGeneration: number
    ) =>
      ipcRenderer.invoke(
        'gcall:sendKeyRequest',
        roomId,
        toAddress,
        fromAddress,
        signature,
        publicKey,
        timestamp,
        callSessionId,
        mediaSessionGeneration
      ),

    requestSessionBreak: async (roomId: string) =>
      ipcRenderer.invoke('gcall:requestSessionBreak', roomId) as Promise<{
        success: boolean;
        error?: string;
      }>,

    /** Register the local user's address with the group call manager. */
    setLocalAddresses: async (addresses: string[], source?: string) =>
      ipcRenderer.invoke('gcall:setLocalAddresses', addresses, source),

    getAudioDataPlaneSession: async (roomId: string, toAddresses: string[]) =>
      ipcRenderer.invoke('gcall:getAudioDataPlaneSession', roomId, toAddresses),

    /** Sync authoritative Qortal group member addresses for Reticulum call-activity fanout. */
    setQortalGroupReticulumTargets: async (
      roomId: string,
      addresses: string[]
    ) =>
      ipcRenderer.invoke(
        'gcall:setQortalGroupReticulumTargets',
        roomId,
        addresses
      ) as Promise<{
        success: boolean;
        error?: string;
      }>,

    /** Get current participants in a room. */
    getRoomParticipants: async (roomId: string) =>
      ipcRenderer.invoke('gcall:getRoomParticipants', roomId),

    /** Get authoritative bootstrap state for a room join/rejoin. */
    getRoomBootstrapState: async (roomId: string) =>
      ipcRenderer.invoke('gcall:getRoomBootstrapState', roomId),

    /**
     * Member-group numeric ids used to derive which `gcall-qortal-*` rooms get sidebar indicators
     * from relayed mesh traffic (cheap path; debounced updates).
     */
    setWatchedQortalGroupIds: async (ids: number[]) =>
      ipcRenderer.invoke('gcall:setWatchedQortalGroupIds', ids) as Promise<{
        success: boolean;
        error?: string;
        activeByGroupId?: Record<string, boolean>;
        participantCountByGroupId?: Record<string, number>;
        maxParticipantsByGroupId?: Record<string, number>;
      }>,

    /**
     * Subscribe only to coalesced group-call activity for the groups list (not full GC_* IPC).
     */
    onQortalGroupCallActivity: (
      cb: (payload: {
        activeByGroupId: Record<string, boolean>;
        participantCountByGroupId?: Record<string, number>;
        maxParticipantsByGroupId?: Record<string, number>;
      }) => void
    ) => {
      const channel = 'gcall:qortal-group-call-activity';
      const handler = (_e: unknown, payload: unknown) => {
        const p = payload as {
          activeByGroupId?: Record<string, boolean>;
          participantCountByGroupId?: Record<string, number>;
          maxParticipantsByGroupId?: Record<string, number>;
        };
        if (p?.activeByGroupId && typeof p.activeByGroupId === 'object') {
          cb({
            activeByGroupId: p.activeByGroupId,
            participantCountByGroupId:
              p.participantCountByGroupId &&
              typeof p.participantCountByGroupId === 'object'
                ? p.participantCountByGroupId
                : undefined,
            maxParticipantsByGroupId:
              p.maxParticipantsByGroupId &&
              typeof p.maxParticipantsByGroupId === 'object'
                ? p.maxParticipantsByGroupId
                : undefined,
          });
        }
      };
      ipcRenderer.on(channel, handler);
      ipcRenderer.send('gcall:subscribe-activity');
      return () => {
        ipcRenderer.send('gcall:unsubscribe-activity');
        ipcRenderer.removeListener(channel, handler);
      };
    },

    getPendingKeyMetrics: async () =>
      ipcRenderer.invoke('gcall:getPendingKeyMetrics') as Promise<{
        pending_key_flush_success: number;
        pending_key_expired: number;
        pendingRooms: number;
      }>,

    /** Ask main to re-send retained verified `gcall:key` frames (e.g. after joinRoom). */
    requestRetainedKeyReplay: () => {
      ipcRenderer.send('gcall:request-key-replay');
    },

    /**
     * Subscribe to all group call events.
     * Returns an unsubscribe function.
     */
    onEvent: (cb: (event: string, payload: unknown) => void) => {
      const channels = [
        'gcall:participant-joined',
        'gcall:participant-left',
        'gcall:topology',
        'gcall:cluster-heartbeat',
        'gcall:heartbeat',
        'gcall:audio',
        'gcall:key',
        'gcall:key-request',
        'gcall:session-updated',
      ] as const;

      const handlers: Map<string, (...args: unknown[]) => void> = new Map();
      for (const channel of channels) {
        const handler = (_e: unknown, payload: unknown) => cb(channel, payload);
        handlers.set(channel, handler);
        ipcRenderer.on(channel, handler);
      }
      ipcRenderer.send('gcall:subscribe');
      gcallFullStreamOnEventRefCount++;

      return () => {
        for (const [channel, handler] of handlers) {
          ipcRenderer.removeListener(channel, handler);
        }
        gcallFullStreamOnEventRefCount--;
        if (gcallFullStreamOnEventRefCount <= 0) {
          gcallFullStreamOnEventRefCount = 0;
          ipcRenderer.send('gcall:unsubscribe');
        }
      };
    },
  });
} catch (error) {
  loggerError('error', error);
}
