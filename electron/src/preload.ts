import { log as loggerLog, error as loggerError } from './logger';
loggerLog('User Preload!');
import { contextBridge, shell, ipcRenderer, webUtils } from 'electron';
import { buildBootstrapIceServers } from './stun-bootstrap';
import { isDisabledLegacy } from './feature-flags';
import { AUDIO_SURFACE_WINDOW_ROLE } from './audio-window-policy';
import type {
  AudioSurfaceCommand,
  AudioSurfaceCommandEnvelope,
  AudioSurfaceCommandResultEnvelope,
  AudioSurfaceEvent,
} from './audio-surface-ipc';
import {
  invokeGroupCallJoin,
  type GroupCallJoinIpcArguments,
} from './group-call-ipc-contract';

// Sandbox-safe minimal Capacitor bridge. The repo's electron-plugins module is
// currently empty, so we only need to preserve the platform marker here.
contextBridge.exposeInMainWorld('CapacitorCustomPlatform', {
  name: 'electron',
  plugins: {},
});

const qortalLandRealtimeBridge = {
  getTransportBootstrap: () =>
    ipcRenderer.invoke('qortalLandRealtime:getTransportBootstrap') as Promise<{
      url: string;
      token: string;
      instanceId: string;
    } | null>,
  onTransportRestarted: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('qortalLandGames:transportRestarted', handler);
    return () =>
      ipcRenderer.removeListener('qortalLandGames:transportRestarted', handler);
  },
};

contextBridge.exposeInMainWorld('qortalLandRealtime', qortalLandRealtimeBridge);
// Compatibility for older renderer bundles while the shared transport name rolls out.
contextBridge.exposeInMainWorld('qortalLandGames', qortalLandRealtimeBridge);

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

async function invokePrivateChannel(
  ipcChannel: string,
  ...args: unknown[]
): Promise<unknown> {
  const result = (await ipcRenderer.invoke(ipcChannel, ...args)) as
    | { ok: true; value: unknown }
    | { ok: false; error: { code?: string; message?: string } };
  if (result.ok === true) return result.value;
  const failure = result as {
    ok: false;
    error: { code?: string; message?: string };
  };
  const code = failure.error?.code || 'PRIVATE_CHANNEL_ERROR';
  const error = new Error(failure.error?.message || code) as Error & {
    code?: string;
  };
  error.code = code;
  throw error;
}

async function invokeMoqTransport(
  ipcChannel: string,
  ...args: unknown[]
): Promise<unknown> {
  const result = (await ipcRenderer.invoke(ipcChannel, ...args)) as
    | { ok: true; value: unknown }
    | { ok: false; error: { code?: string; message?: string } };
  if (result.ok === true) return result.value;
  const failure = result as {
    ok: false;
    error: { code?: string; message?: string };
  };
  const code = failure.error?.code || 'MOQ_ERROR';
  const error = new Error(failure.error?.message || code) as Error & {
    code?: string;
  };
  error.code = code;
  throw error;
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
/** DM voice, group calls, and Qortal Land share the same hidden audio-surface stream. */
let audioSurfaceOnEventRefCount = 0;
/** Group and DM chat can both observe local hide-state changes in the same renderer. */
let reticulumChatSilenceChangedRefCount = 0;
/**
 * The global DM badge, missed-call notifications, and an open DM all observe
 * summary changes. Keep main-process delivery alive until the final observer
 * leaves; otherwise closing one view unsubscribes the entire renderer.
 */
let reticulumChatDirectSummaryChangedRefCount = 0;

function subscribeReticulumChatSilenceChanged(): void {
  reticulumChatSilenceChangedRefCount += 1;
  if (reticulumChatSilenceChangedRefCount === 1) {
    ipcRenderer.send('reticulumChat:silenceChanged:subscribe');
  }
}

function unsubscribeReticulumChatSilenceChanged(): void {
  reticulumChatSilenceChangedRefCount -= 1;
  if (reticulumChatSilenceChangedRefCount <= 0) {
    reticulumChatSilenceChangedRefCount = 0;
    ipcRenderer.send('reticulumChat:silenceChanged:unsubscribe');
  }
}

function subscribeReticulumChatDirectSummaryChanged(): void {
  reticulumChatDirectSummaryChangedRefCount += 1;
  if (reticulumChatDirectSummaryChangedRefCount === 1) {
    ipcRenderer.send('reticulumChat:directSummaryChanged:subscribe');
  }
}

function unsubscribeReticulumChatDirectSummaryChanged(): void {
  reticulumChatDirectSummaryChangedRefCount -= 1;
  if (reticulumChatDirectSummaryChangedRefCount <= 0) {
    reticulumChatDirectSummaryChangedRefCount = 0;
    ipcRenderer.send('reticulumChat:directSummaryChanged:unsubscribe');
  }
}

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

type ReticulumChatReadinessPayload = {
  state: 'idle' | 'starting' | 'ready' | 'failed';
  revision: number;
  error?: string;
};

const reticulumChatReadinessSubscribers = new Set<
  (status: ReticulumChatReadinessPayload) => void
>();
let reticulumChatReadinessSubscribed = false;

const handleReticulumChatReadinessChanged = (
  _event: unknown,
  status: unknown
) => {
  for (const subscriber of reticulumChatReadinessSubscribers) {
    subscriber(status as ReticulumChatReadinessPayload);
  }
};

const subscribeToReticulumChatReadiness = (
  subscriber: (status: ReticulumChatReadinessPayload) => void
): (() => void) => {
  reticulumChatReadinessSubscribers.add(subscriber);
  if (!reticulumChatReadinessSubscribed) {
    reticulumChatReadinessSubscribed = true;
    ipcRenderer.on(
      'reticulumChat:readinessChanged',
      handleReticulumChatReadinessChanged
    );
    ipcRenderer.send('reticulumChat:readinessChanged:subscribe');
  }
  return () => {
    reticulumChatReadinessSubscribers.delete(subscriber);
    if (
      reticulumChatReadinessSubscribed &&
      reticulumChatReadinessSubscribers.size === 0
    ) {
      reticulumChatReadinessSubscribed = false;
      ipcRenderer.removeListener(
        'reticulumChat:readinessChanged',
        handleReticulumChatReadinessChanged
      );
      ipcRenderer.send('reticulumChat:readinessChanged:unsubscribe');
    }
  };
};

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
    onSystemLockRequested: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('system:lock-requested', handler);
      return () => ipcRenderer.removeListener('system:lock-requested', handler);
    },
    getPlatform: () => ipcRenderer.invoke('window:getPlatform'),
    onDisplayMediaRequest: (callback: (request: { requestId: string; origin: string }) => void) => {
      const handler = (_event, request) => callback(request);
      ipcRenderer.on('display-media:request', handler);
      return () => ipcRenderer.removeListener('display-media:request', handler);
    },
    onDisplayMediaCancel: (callback: (requestId: string) => void) => {
      const handler = (_event, requestId) => callback(requestId);
      ipcRenderer.on('display-media:cancel', handler);
      return () => ipcRenderer.removeListener('display-media:cancel', handler);
    },
    selectDisplayMedia: (requestId: string, sourceId?: string) => ipcRenderer.send('display-media:select', { requestId, sourceId }),
    authorizeDisplayMedia: (requestId: string, accepted: boolean) => ipcRenderer.send('display-media:authorize', { requestId, accepted }),
    listScreenShareSources: () =>
      ipcRenderer.invoke('screenShare:listSources') as Promise<{
        success: boolean;
        error?: string;
        sources: Array<{
          id: string;
          name: string;
          thumbnail: string;
          appIcon: string;
        }>;
      }>,
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
    setDisableDevLogs: (value: boolean) =>
      ipcRenderer.invoke('logger:setDisableDevLogs', value),
    setAppSettings: (settings: {
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
    }) => ipcRenderer.invoke('appSettings:set', settings),
    onAppSettingsChanged: (
      callback: (settings: {
        autoLockTimeoutMinutes?: 0 | 10 | 30 | 60 | 180;
        disableAutoLockOnIdle?: boolean;
        reticulumEnabled?: boolean;
        reticulumManagedConfigEnabled?: boolean;
        reticulumTransportEnabled?: boolean;
        reticulumChatEnabled?: boolean;
        communityStunContributionEnabled?: boolean;
      }) => void
    ) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: any) =>
        callback(settings);
      ipcRenderer.on('appSettings:changed', listener);
      return () => ipcRenderer.removeListener('appSettings:changed', listener);
    },
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
        p2pOutboundOverlayPeers?: number;
        p2pInboundOverlayPeers?: number;
        p2pActiveOverlayPeers?: number;
        p2pReceivingOverlayPeers?: number;
        p2pReceivingOverlayPeersStableMs?: number;
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
        p2pOutboundOverlayPeers?: number;
        p2pInboundOverlayPeers?: number;
        p2pActiveOverlayPeers?: number;
        p2pReceivingOverlayPeers?: number;
        p2pReceivingOverlayPeersStableMs?: number;
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
          addresses?: string[];
          connectedAt: number;
        }>
      >,
    reticulumGetDetails: () =>
      ipcRenderer.invoke('reticulum:getDetails') as Promise<{
        destinationHash: string | null;
        overlayPeers: Array<{
          linkId: string;
          peerPresenceHash: string;
          incoming?: boolean;
          address?: string;
          addresses?: string[];
          connectedAt: number;
        }>;
      }>,
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
    qappReticulumRequest: (owner, options) =>
      ipcRenderer.invoke('qappReticulum:request', owner, options),
    qappReticulumConnect: (owner, destination: string) =>
      ipcRenderer.invoke('qappReticulum:connect', owner, destination),
    qappReticulumSend: (owner, connectionId: string, payload) =>
      ipcRenderer.invoke('qappReticulum:send', owner, connectionId, payload),
    qappReticulumClose: (owner, connectionId: string) =>
      ipcRenderer.invoke('qappReticulum:close', owner, connectionId),
    qappReticulumCleanupOwner: (owner) =>
      ipcRenderer.invoke('qappReticulum:cleanupOwner', owner),
    qappGuestPrepare: (owner, url: string, isDevMode: boolean) =>
      ipcRenderer.invoke('qappGuest:prepare', owner, url, isDevMode),
    qappGuestRelease: (owner) =>
      ipcRenderer.invoke('qappGuest:release', owner),
    onQAppReticulumEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload);
      ipcRenderer.on('qappReticulum:event', listener);
      return () => ipcRenderer.removeListener('qappReticulum:event', listener);
    },
    qappFileSave: (owner, request) => ipcRenderer.invoke('qappFileSave:request', owner, request),
    privateChannelOpen: (owner, rnsConnectionId, purpose) =>
      invokePrivateChannel(
        'privateChannel:open',
        owner,
        rnsConnectionId,
        purpose
      ),
    privateChannelSend: (
      owner,
      channelId,
      lane,
      messageId,
      data,
      streamOptions
    ) =>
      invokePrivateChannel(
        'privateChannel:send',
        owner,
        channelId,
        lane,
        messageId,
        data,
        streamOptions
      ),
    privateChannelStatus: (owner, channelId) =>
      invokePrivateChannel('privateChannel:status', owner, channelId),
    privateChannelClose: (owner, channelId) =>
      invokePrivateChannel('privateChannel:close', owner, channelId),
    privateChannelCleanupOwner: (owner) =>
      invokePrivateChannel('privateChannel:cleanupOwner', owner),
    onPrivateChannelEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload);
      ipcRenderer.on('privateChannel:event', listener);
      return () => ipcRenderer.removeListener('privateChannel:event', listener);
    },
    qappMoqOpen: (
      owner,
      rnsConnectionId,
      publicationNamespace,
      publicationTrack
    ) =>
      invokeMoqTransport(
        'qappMoq:open',
        owner,
        rnsConnectionId,
        publicationNamespace,
        publicationTrack
      ),
    qappMoqSubscribe: (
      owner,
      sessionId,
      subscriptionId,
      namespace,
      trackName
    ) =>
      invokeMoqTransport(
        'qappMoq:subscribe',
        owner,
        sessionId,
        subscriptionId,
        namespace,
        trackName
      ),
    qappMoqPublish: (owner, sessionId, payload) =>
      invokeMoqTransport('qappMoq:publish', owner, sessionId, payload),
    qappMoqMetrics: (owner, sessionId) =>
      invokeMoqTransport('qappMoq:metrics', owner, sessionId),
    qappMoqClose: (owner, sessionId) =>
      invokeMoqTransport('qappMoq:close', owner, sessionId),
    qappMoqCleanupOwner: (owner) =>
      invokeMoqTransport('qappMoq:cleanupOwner', owner),
    onQAppMoqEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload);
      ipcRenderer.on('qappMoq:event', listener);
      return () => ipcRenderer.removeListener('qappMoq:event', listener);
    },
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
      audioSurfaceOnEventRefCount += 1;
      if (audioSurfaceOnEventRefCount === 1) {
        ipcRenderer.send('audio-surface:subscribe');
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipcRenderer.removeListener(channel, handler);
        audioSurfaceOnEventRefCount -= 1;
        if (audioSurfaceOnEventRefCount <= 0) {
          audioSurfaceOnEventRefCount = 0;
          ipcRenderer.send('audio-surface:unsubscribe');
        }
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
  contextBridge.exposeInMainWorld('foreignWalletSigner', {
    importKeys: (keys: Record<string, unknown>) =>
      ipcRenderer.invoke('foreignWalletSigner:import', keys),
    publicKey: (coin: string) =>
      ipcRenderer.invoke('foreignWalletSigner:publicKey', coin),
    clear: () => ipcRenderer.invoke('foreignWalletSigner:clear'),
    sign: (request: unknown, language: string) =>
      ipcRenderer.invoke('foreignWalletSigner:sign', request, language),
  });
  contextBridge.exposeInMainWorld('foreignWalletJournal', {
    get: (key: string) => ipcRenderer.invoke('foreignWalletJournal:get', key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke('foreignWalletJournal:set', key, value),
    delete: (key: string, txId: string) =>
      ipcRenderer.invoke('foreignWalletJournal:delete', key, txId),
  });
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

  contextBridge.exposeInMainWorld('reticulumResources', {
    getPathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
    convertGifToWebp: async (payload: {
      filePath?: string;
      bytes?: Uint8Array;
      fileName?: string;
      targetBytes?: number;
    }) =>
      ipcRenderer.invoke(
        'reticulumResource:convertGifToWebp',
        payload
      ) as Promise<{
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
      }>,
    releaseConvertedMedia: async (filePath: string) =>
      ipcRenderer.invoke(
        'reticulumResource:releaseConvertedMedia',
        filePath
      ) as Promise<{
        success: boolean;
        error?: string;
      }>,
    importBase64: async (payload: unknown) =>
      ipcRenderer.invoke('reticulumResource:importBase64', payload) as Promise<{
        success: boolean;
        manifest?: unknown;
        error?: string;
      }>,
    importFilePath: async (payload: unknown) =>
      ipcRenderer.invoke(
        'reticulumResource:importFilePath',
        payload
      ) as Promise<{
        success: boolean;
        manifest?: unknown;
        error?: string;
      }>,
    getUrl: async (fileHash: string) =>
      ipcRenderer.invoke('reticulumResource:getUrl', fileHash) as Promise<{
        success: boolean;
        url?: string;
        manifest?: unknown;
        error?: string;
      }>,
    getStatus: async (fileHash: string) =>
      ipcRenderer.invoke('reticulumResource:getStatus', fileHash) as Promise<{
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
          currentBytesPerSecond?: number;
          averageBytesPerSecond?: number;
          nextRequestAt?: number | null;
        } | null;
        error?: string;
      }>,
    getStorageStatus: async () =>
      ipcRenderer.invoke('reticulumResource:getStorageStatus') as Promise<{
        success: boolean;
        status?: unknown;
        error?: string;
      }>,
    cleanupStorage: async () =>
      ipcRenderer.invoke('reticulumResource:cleanupStorage') as Promise<{
        success: boolean;
        result?: unknown;
        status?: unknown;
        error?: string;
      }>,
    saveAs: async (fileHash: string, suggestedFileName?: string) =>
      ipcRenderer.invoke(
        'reticulumResource:saveAs',
        fileHash,
        suggestedFileName
      ) as Promise<{
        success: boolean;
        canceled?: boolean;
        path?: string;
        error?: string;
      }>,
    open: async (fileHash: string, suggestedFileName?: string) =>
      ipcRenderer.invoke(
        'reticulumResource:open',
        fileHash,
        suggestedFileName
      ) as Promise<{
        success: boolean;
        error?: string;
      }>,
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

    /** Start the main-process heartbeat scheduler. */
    startHeartbeatScheduler: async () =>
      ipcRenderer.invoke('presence:heartbeatSchedulerStart'),

    /** Stop the main-process heartbeat scheduler. */
    stopHeartbeatScheduler: async () =>
      ipcRenderer.invoke('presence:heartbeatSchedulerStop'),

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

    /** Subscribe to main-process heartbeat ticks. */
    onHeartbeatRequested: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('presence:heartbeat-request', handler);
      return () =>
        ipcRenderer.removeListener('presence:heartbeat-request', handler);
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
          channelId: string;
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
          channelId: string;
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

    contextBridge.exposeInMainWorld('reticulumChat', {
      isEnabled: async () =>
        ipcRenderer.invoke('reticulumChat:isEnabled') as Promise<boolean>,
      getReadinessStatus: async () =>
        ipcRenderer.invoke('reticulumChat:getReadinessStatus') as Promise<{
          state: 'idle' | 'starting' | 'ready' | 'failed';
          revision: number;
          error?: string;
        }>,
      onReadinessChanged: (
        cb: (status: {
          state: 'idle' | 'starting' | 'ready' | 'failed';
          revision: number;
          error?: string;
        }) => void
      ) => subscribeToReticulumChatReadiness(cb),
      setLocalGroupMemberships: async (
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
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setLocalGroupMemberships',
          groupIds
        ) as Promise<{ success: boolean; error?: string }>,
      setPublicGroupDirectory: async (groupIds: number[]) =>
        ipcRenderer.invoke(
          'reticulumChat:setPublicGroupDirectory',
          groupIds
        ) as Promise<{ success: boolean; error?: string }>,
      getPublicGroupActivity: async () =>
        ipcRenderer.invoke('reticulumChat:getPublicGroupActivity') as Promise<
          Array<{
            groupId: number;
            messages24h: number;
            messages7d: number;
            activeAuthors7d: number;
            observedAt: number;
            confidence: number;
          }>
        >,
      getPublicGroupActivitySnapshot: async () =>
        ipcRenderer.invoke(
          'reticulumChat:getPublicGroupActivitySnapshot'
        ) as Promise<{
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
        }>,
      setLocalDmAddresses: async (addresses: string[]) =>
        ipcRenderer.invoke(
          'reticulumChat:setLocalDmAddresses',
          addresses
        ) as Promise<{ success: boolean; error?: string }>,
      clearLocalAccountState: async () =>
        ipcRenderer.invoke('reticulumChat:clearLocalAccountState') as Promise<{
          success: boolean;
          error?: string;
        }>,
      getSilence: async (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getSilence',
          ownerAddress,
          targetAddress,
          scopeType,
          groupId
        ) as Promise<unknown | null>,
      listSilences: async (
        ownerAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:listSilences',
          ownerAddress,
          scopeType,
          groupId
        ) as Promise<unknown[]>,
      setSilence: async (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        durationMs: number | null,
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setSilence',
          ownerAddress,
          targetAddress,
          scopeType,
          durationMs,
          groupId
        ) as Promise<{ success: boolean; silence?: unknown; error?: string }>,
      clearSilence: async (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:clearSilence',
          ownerAddress,
          targetAddress,
          scopeType,
          groupId
        ) as Promise<{ success: boolean; silence?: unknown; error?: string }>,
      setActiveDirectChat: async (
        localAddress: string,
        peerAddress: string,
        active: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setActiveDirectChat',
          localAddress,
          peerAddress,
          active
        ) as Promise<{ success: boolean; error?: string }>,
      subscribeGroup: async (groupId: number) =>
        ipcRenderer.invoke('reticulumChat:subscribeGroup', groupId) as Promise<{
          success: boolean;
          error?: string;
        }>,
      subscribeChannel: async (groupId: number, channelId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:subscribeChannel',
          groupId,
          channelId
        ) as Promise<{ success: boolean; error?: string }>,
      unsubscribeChannel: async (groupId: number, channelId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:unsubscribeChannel',
          groupId,
          channelId
        ) as Promise<{ success: boolean; error?: string }>,
      unsubscribeGroup: async (groupId: number) =>
        ipcRenderer.invoke(
          'reticulumChat:unsubscribeGroup',
          groupId
        ) as Promise<{ success: boolean; error?: string }>,
      publishEvent: async (event: unknown) =>
        ipcRenderer.invoke('reticulumChat:publishEvent', event) as Promise<{
          success: boolean;
          error?: string;
        }>,
      reserveAuthorSequence: async (groupId: number, authorAddress: string) =>
        ipcRenderer.invoke(
          'reticulumChat:reserveAuthorSequence',
          groupId,
          authorAddress
        ) as Promise<{ authorStreamId: string; authorSeq: number }>,
      releaseAuthorSequence: async (
        groupId: number,
        authorAddress: string,
        authorStreamId: string,
        authorSeq: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:releaseAuthorSequence',
          groupId,
          authorAddress,
          authorStreamId,
          authorSeq
        ) as Promise<boolean>,
      publishDirectEvent: async (event: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:publishDirectEvent',
          event
        ) as Promise<{
          success: boolean;
          error?: string;
        }>,
      getDirectAuthorStreamId: async (authorAddress: string) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectAuthorStreamId',
          authorAddress
        ) as Promise<string>,
      getDirectExpiryPreference: async (
        ownerAddress: string,
        peerAddress: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectExpiryPreference',
          ownerAddress,
          peerAddress
        ) as Promise<{
          success: boolean;
          preference?: {
            ownerAddress: string;
            peerAddress: string;
            durationMs: number | null;
            updatedAt: number;
          };
          error?: string;
        }>,
      setDirectExpiryPreference: async (
        ownerAddress: string,
        peerAddress: string,
        durationMs: number | null
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setDirectExpiryPreference',
          ownerAddress,
          peerAddress,
          durationMs
        ) as Promise<{
          success: boolean;
          preference?: {
            ownerAddress: string;
            peerAddress: string;
            durationMs: number | null;
            updatedAt: number;
          };
          error?: string;
        }>,
      getCalendarEvents: async (
        groupId: number,
        rangeStart: number,
        rangeEnd: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getCalendarEvents',
          groupId,
          rangeStart,
          rangeEnd
        ) as Promise<unknown[]>,
      getCalendarEvent: async (
        groupId: number,
        eventId: string,
        preferredOccurrenceStart?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getCalendarEvent',
          groupId,
          eventId,
          preferredOccurrenceStart
        ) as Promise<unknown | null>,
      createCalendarEvent: async (
        groupId: number,
        input: unknown,
        eventId?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:createCalendarEvent',
          groupId,
          input,
          eventId
        ) as Promise<unknown>,
      updateCalendarEvent: async (
        groupId: number,
        eventId: string,
        input: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:updateCalendarEvent',
          groupId,
          eventId,
          input
        ) as Promise<unknown>,
      deleteCalendarEvent: async (groupId: number, eventId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:deleteCalendarEvent',
          groupId,
          eventId
        ) as Promise<unknown>,
      getCalendarReminder: async (
        ownerAddress: string,
        groupId: number,
        eventId: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getCalendarReminder',
          ownerAddress,
          groupId,
          eventId
        ) as Promise<unknown>,
      setCalendarReminder: async (
        ownerAddress: string,
        groupId: number,
        eventId: string,
        offsetMs: number | null
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setCalendarReminder',
          ownerAddress,
          groupId,
          eventId,
          offsetMs
        ) as Promise<unknown>,
      sendDirectTyping: async (
        localAddress: string,
        peerAddress: string,
        active: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:sendDirectTyping',
          localAddress,
          peerAddress,
          active
        ) as Promise<{ success: boolean; error?: string }>,
      getDirectHistory: async (
        myAddress: string,
        peerAddress: string,
        limit?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectHistory',
          myAddress,
          peerAddress,
          limit
        ) as Promise<unknown[]>,
      getDirectSummaries: async (myAddress: string, peerAddress?: string) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectSummaries',
          myAddress,
          peerAddress
        ) as Promise<unknown[]>,
      getDirectCallHistory: async (
        ownerAddress: string,
        peerAddress?: string,
        limit?: number,
        unreadOnly?: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectCallHistory',
          ownerAddress,
          peerAddress,
          limit,
          unreadOnly
        ) as Promise<unknown[]>,
      markDirectRead: async (
        myAddress: string,
        peerAddress: string,
        upToTimestamp: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:markDirectRead',
          myAddress,
          peerAddress,
          upToTimestamp
        ) as Promise<{ success: boolean; error?: string }>,
      sendTyping: async (
        groupId: number,
        channelId: string,
        authorAddress: string,
        active: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:sendTyping',
          groupId,
          channelId,
          authorAddress,
          active
        ) as Promise<{ success: boolean; error?: string }>,
      sendLandState: async (
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
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:sendLandState',
          groupId,
          authorAddress,
          state
        ) as Promise<{ success: boolean; error?: string }>,
      sendLandChat: async (message: unknown) =>
        ipcRenderer.invoke('reticulumChat:sendLandChat', message) as Promise<{
          success: boolean;
          error?: string;
        }>,
      sendLandAction: async (groupId: number, action: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:sendLandAction',
          groupId,
          action
        ) as Promise<{ success: boolean; error?: string }>,
      sendLandCall: async (groupId: number, call: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:sendLandCall',
          groupId,
          call
        ) as Promise<{ success: boolean; error?: string }>,
      requestResource: async (
        groupId: number,
        manifest: unknown,
        eventId?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:requestResource',
          groupId,
          manifest,
          eventId
        ) as Promise<{ success: boolean; error?: string }>,
      requestDirectResource: async (
        myAddress: string,
        peerAddress: string,
        manifest: unknown,
        eventId?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:requestDirectResource',
          myAddress,
          peerAddress,
          manifest,
          eventId
        ) as Promise<{ success: boolean; error?: string }>,
      cancelResource: async (fileHash: string) =>
        ipcRenderer.invoke(
          'reticulumChat:cancelResource',
          fileHash
        ) as Promise<{ success: boolean; canceled?: boolean; error?: string }>,
      getHistory: async (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getHistory',
          groupId,
          channelId,
          limit,
          options
        ) as Promise<unknown[]>,
      getMessageHistory: async (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageHistory',
          groupId,
          channelId,
          limit,
          options
        ) as Promise<unknown[]>,
      getMessageHistoryPage: async (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageHistoryPage',
          groupId,
          channelId,
          limit,
          options
        ) as Promise<unknown>,
      getDiscussionIndex: async (groupId: number, channelId?: string) =>
        ipcRenderer.invoke(
          'reticulumChat:getDiscussionIndex',
          groupId,
          channelId
        ) as Promise<{
          replyCounts: Record<string, number>;
          rootByEventId: Record<string, string>;
        }>,
      getDiscussionMessages: async (
        groupId: number,
        channelId: string,
        eventId: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDiscussionMessages',
          groupId,
          channelId,
          eventId
        ) as Promise<unknown[]>,
      getChannelMetadataHistory: async (groupId: number, limit?: number) =>
        ipcRenderer.invoke(
          'reticulumChat:getChannelMetadataHistory',
          groupId,
          limit
        ) as Promise<unknown[]>,
      getChannels: async (groupId: number, includeArchived?: boolean) =>
        ipcRenderer.invoke(
          'reticulumChat:getChannels',
          groupId,
          includeArchived
        ) as Promise<unknown[]>,
      getCategories: async (groupId: number) =>
        ipcRenderer.invoke('reticulumChat:getCategories', groupId) as Promise<
          unknown[]
        >,
      getChannelMetadataBundle: async (
        groupId: number,
        includeArchived?: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getChannelMetadataBundle',
          groupId,
          includeArchived
        ) as Promise<{
          channels: unknown[];
          categories: unknown[];
          ready: boolean;
          snapshotVersion: number;
        }>,
      applyChannelMetadata: async (eventId: string, payload: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:applyChannelMetadata',
          eventId,
          payload
        ) as Promise<{ success: boolean }>,
      getSyncState: async (groupId: number) =>
        ipcRenderer.invoke('reticulumChat:getSyncState', groupId) as Promise<
          Record<string, number>
        >,
      getSummaries: async (myAddress?: string) =>
        ipcRenderer.invoke('reticulumChat:getSummaries', myAddress) as Promise<
          unknown[]
        >,
      search: async (
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
      ) =>
        ipcRenderer.invoke('reticulumChat:search', query, options) as Promise<
          unknown[]
        >,
      getMessageWindowAroundEvent: async (
        groupId: number,
        channelId: string,
        eventId: string,
        options?: {
          beforeLimit?: number;
          afterLimit?: number;
        }
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageWindowAroundEvent',
          groupId,
          channelId,
          eventId,
          options
        ) as Promise<unknown[]>,
      getMessageWindowPageAroundEvent: async (
        groupId: number,
        channelId: string,
        eventId: string,
        options?: {
          beforeLimit?: number;
          afterLimit?: number;
        }
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageWindowPageAroundEvent',
          groupId,
          channelId,
          eventId,
          options
        ) as Promise<unknown>,
      indexSearchText: async (eventId: string, text: string) =>
        ipcRenderer.invoke(
          'reticulumChat:indexSearchText',
          eventId,
          text
        ) as Promise<{ success: boolean }>,
      deleteSearchText: async (eventId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:deleteSearchText',
          eventId
        ) as Promise<{ success: boolean }>,
      replaceMentions: async (eventId: string, mentionedAddresses: string[]) =>
        ipcRenderer.invoke(
          'reticulumChat:replaceMentions',
          eventId,
          mentionedAddresses
        ) as Promise<{ success: boolean }>,
      deleteMentions: async (eventId: string) =>
        ipcRenderer.invoke('reticulumChat:deleteMentions', eventId) as Promise<{
          success: boolean;
        }>,
      markRead: async (
        groupId: number,
        channelId: string,
        upToTimestamp: number,
        myAddress?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:markRead',
          groupId,
          channelId,
          upToTimestamp,
          myAddress
        ) as Promise<{ success: boolean }>,
      markGroupsRead: async (groupIds: number[], myAddress?: string) =>
        ipcRenderer.invoke(
          'reticulumChat:markGroupsRead',
          groupIds,
          myAddress
        ) as Promise<{
          success: boolean;
          error?: string;
          groupsMarked: number;
          channelsMarked: number;
        }>,
      getSubscriptions: async () =>
        ipcRenderer.invoke('reticulumChat:getSubscriptions') as Promise<
          number[]
        >,
      updateMentionBadge: async (mentionCount: number) =>
        ipcRenderer.invoke(
          'reticulumChat:updateMentionBadge',
          mentionCount
        ) as Promise<{ success: boolean }>,
      onEvent: (cb: (payload: { event: unknown }) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(payload as { event: unknown });
        };
        ipcRenderer.on('reticulumChat:event', handler);
        ipcRenderer.send('reticulumChat:event:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:event', handler);
          ipcRenderer.send('reticulumChat:event:unsubscribe');
        };
      },
      onSummaryChanged: (
        cb: (payload: {
          groupId: number;
          eventId?: string;
          timestamp?: number;
          metadataChanged?: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              eventId?: string;
              timestamp?: number;
              metadataChanged?: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:summaryChanged', handler);
        ipcRenderer.send('reticulumChat:summaryChanged:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:summaryChanged', handler);
          ipcRenderer.send('reticulumChat:summaryChanged:unsubscribe');
        };
      },
      onCalendarChanged: (
        cb: (payload: { groupId: number; eventId?: string }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) =>
          cb(payload as { groupId: number; eventId?: string });
        ipcRenderer.on('reticulumChat:calendarChanged', handler);
        ipcRenderer.send('reticulumChat:calendarChanged:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:calendarChanged', handler);
          ipcRenderer.send('reticulumChat:calendarChanged:unsubscribe');
        };
      },
      onCalendarReminderDue: (cb: (payload: unknown) => void) => {
        const handler = (_event: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on('reticulumChat:calendarReminderDue', handler);
        ipcRenderer.send('reticulumChat:calendarReminderDue:subscribe');
        return () => {
          ipcRenderer.removeListener(
            'reticulumChat:calendarReminderDue',
            handler
          );
          ipcRenderer.send('reticulumChat:calendarReminderDue:unsubscribe');
        };
      },
      onDirectEvent: (cb: (payload: { event: unknown }) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(payload as { event: unknown });
        };
        ipcRenderer.on('reticulumChat:directEvent', handler);
        ipcRenderer.send('reticulumChat:directEvent:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:directEvent', handler);
          ipcRenderer.send('reticulumChat:directEvent:unsubscribe');
        };
      },
      onDirectCallHistory: (cb: (payload: { record: unknown }) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(payload as { record: unknown });
        };
        ipcRenderer.on('reticulumChat:directCallHistory', handler);
        ipcRenderer.send('reticulumChat:directCallHistory:subscribe');
        return () => {
          ipcRenderer.removeListener(
            'reticulumChat:directCallHistory',
            handler
          );
          ipcRenderer.send('reticulumChat:directCallHistory:unsubscribe');
        };
      },
      onDirectTyping: (
        cb: (payload: {
          conversationId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              conversationId: string;
              authorAddress: string;
              active: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:directTyping', handler);
        ipcRenderer.send('reticulumChat:directTyping:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:directTyping', handler);
          ipcRenderer.send('reticulumChat:directTyping:unsubscribe');
        };
      },
      onDirectSummaryChanged: (
        cb: (payload: {
          conversationId?: string;
          peerAddress?: string;
          reason?: 'expiry' | 'call';
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              conversationId?: string;
              peerAddress?: string;
              reason?: 'expiry' | 'call';
            }
          );
        };
        ipcRenderer.on('reticulumChat:directSummaryChanged', handler);
        subscribeReticulumChatDirectSummaryChanged();
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          ipcRenderer.removeListener(
            'reticulumChat:directSummaryChanged',
            handler
          );
          unsubscribeReticulumChatDirectSummaryChanged();
        };
      },
      onSilenceChanged: (
        cb: (payload: {
          ownerAddress: string;
          targetAddress: string;
          scopeType: 'group' | 'dm';
          scopeId: string;
          expiresAt: number | null;
          active: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              ownerAddress: string;
              targetAddress: string;
              scopeType: 'group' | 'dm';
              scopeId: string;
              expiresAt: number | null;
              active: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:silenceChanged', handler);
        subscribeReticulumChatSilenceChanged();
        return () => {
          ipcRenderer.removeListener('reticulumChat:silenceChanged', handler);
          unsubscribeReticulumChatSilenceChanged();
        };
      },
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
          failureReason?: 'verification_failed';
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId?: number;
              eventId?: string;
              fileHash?: string;
              bytesTransferred?: number;
              totalBytes?: number;
              progress?: number;
              complete?: boolean;
              failed?: boolean;
              failureReason?: 'verification_failed';
            }
          );
        };
        ipcRenderer.on('reticulumChat:resource', handler);
        ipcRenderer.send('reticulumChat:resource:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:resource', handler);
          ipcRenderer.send('reticulumChat:resource:unsubscribe');
        };
      },
      onTyping: (
        cb: (payload: {
          groupId: number;
          channelId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              channelId: string;
              authorAddress: string;
              active: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:typing', handler);
        ipcRenderer.send('reticulumChat:typing:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:typing', handler);
          ipcRenderer.send('reticulumChat:typing:unsubscribe');
        };
      },
      onLandState: (
        cb: (payload: {
          groupId: number;
          authorAddress: string;
          sessionId: string;
          destinationHash?: string;
          sequence: number;
          x: number;
          y: number;
          direction?: string;
          movement?: string;
          afk?: boolean;
          dnd?: boolean;
          voiceEnabled?: boolean;
          voiceMuted?: boolean;
          skinId?: number;
          timestamp?: number;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              authorAddress: string;
              sessionId: string;
              destinationHash?: string;
              sequence: number;
              x: number;
              y: number;
              direction?: string;
              movement?: string;
              afk?: boolean;
              dnd?: boolean;
              voiceEnabled?: boolean;
              voiceMuted?: boolean;
              skinId?: number;
              timestamp?: number;
            }
          );
        };
        ipcRenderer.on('reticulumChat:landState', handler);
        ipcRenderer.send('reticulumChat:landState:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landState', handler);
          ipcRenderer.send('reticulumChat:landState:unsubscribe');
        };
      },
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
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              messageId: string;
              authorAddress: string;
              sessionId: string;
              sequence: number;
              timestamp: number;
              text: string;
            }
          );
        };
        ipcRenderer.on('reticulumChat:landChat', handler);
        ipcRenderer.send('reticulumChat:landChat:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landChat', handler);
          ipcRenderer.send('reticulumChat:landChat:unsubscribe');
        };
      },
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
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
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
            }
          );
        };
        ipcRenderer.on('reticulumChat:landAction', handler);
        ipcRenderer.send('reticulumChat:landAction:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landAction', handler);
          ipcRenderer.send('reticulumChat:landAction:unsubscribe');
        };
      },
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
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
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
            }
          );
        };
        ipcRenderer.on('reticulumChat:landCall', handler);
        ipcRenderer.send('reticulumChat:landCall:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landCall', handler);
          ipcRenderer.send('reticulumChat:landCall:unsubscribe');
        };
      },
    });
  }

  // WebRTC DM calls use this even when the legacy P2P transport is disabled.
  // Keeping it outside the legacy block ensures direct calls receive their
  // STUN configuration without re-enabling any legacy data channel behavior.
  contextBridge.exposeInMainWorld('hub', {
    getBootstrapIceServers: () => hubP2pBootstrapIceServers,
    getIceServers: () =>
      ipcRenderer.invoke('hub:getIceServers') as Promise<{ urls: string }[]>,
    reportStunCallOutcome: (stunUrls: string[], success: boolean) =>
      ipcRenderer.invoke('hub:reportStunCallOutcome', stunUrls, success),
    reportObservedStunSources: (stunUrls: string[]) =>
      ipcRenderer.invoke('hub:reportObservedStunSources', stunUrls),
  });

  if (isDisabledLegacy) {
    contextBridge.exposeInMainWorld('reticulumChat', {
      isEnabled: async () =>
        ipcRenderer.invoke('reticulumChat:isEnabled') as Promise<boolean>,
      getMessageHistoryPage: async (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageHistoryPage',
          groupId,
          channelId,
          limit,
          options
        ) as Promise<unknown>,
      getMessageWindowPageAroundEvent: async (
        groupId: number,
        channelId: string,
        eventId: string,
        options?: {
          beforeLimit?: number;
          afterLimit?: number;
        }
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageWindowPageAroundEvent',
          groupId,
          channelId,
          eventId,
          options
        ) as Promise<unknown>,
      getReadinessStatus: async () =>
        ipcRenderer.invoke('reticulumChat:getReadinessStatus') as Promise<{
          state: 'idle' | 'starting' | 'ready' | 'failed';
          revision: number;
          error?: string;
        }>,
      onReadinessChanged: (
        cb: (status: {
          state: 'idle' | 'starting' | 'ready' | 'failed';
          revision: number;
          error?: string;
        }) => void
      ) => subscribeToReticulumChatReadiness(cb),
      setLocalGroupMemberships: async (
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
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setLocalGroupMemberships',
          groupIds
        ) as Promise<{ success: boolean; error?: string }>,
      setPublicGroupDirectory: async (groupIds: number[]) =>
        ipcRenderer.invoke(
          'reticulumChat:setPublicGroupDirectory',
          groupIds
        ) as Promise<{ success: boolean; error?: string }>,
      getPublicGroupActivity: async () =>
        ipcRenderer.invoke('reticulumChat:getPublicGroupActivity') as Promise<
          Array<{
            groupId: number;
            messages24h: number;
            messages7d: number;
            activeAuthors7d: number;
            observedAt: number;
            confidence: number;
          }>
        >,
      getPublicGroupActivitySnapshot: async () =>
        ipcRenderer.invoke(
          'reticulumChat:getPublicGroupActivitySnapshot'
        ) as Promise<{
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
        }>,
      setLocalDmAddresses: async (addresses: string[]) =>
        ipcRenderer.invoke(
          'reticulumChat:setLocalDmAddresses',
          addresses
        ) as Promise<{ success: boolean; error?: string }>,
      clearLocalAccountState: async () =>
        ipcRenderer.invoke('reticulumChat:clearLocalAccountState') as Promise<{
          success: boolean;
          error?: string;
        }>,
      getSilence: async (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getSilence',
          ownerAddress,
          targetAddress,
          scopeType,
          groupId
        ) as Promise<unknown | null>,
      listSilences: async (
        ownerAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:listSilences',
          ownerAddress,
          scopeType,
          groupId
        ) as Promise<unknown[]>,
      setSilence: async (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        durationMs: number | null,
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setSilence',
          ownerAddress,
          targetAddress,
          scopeType,
          durationMs,
          groupId
        ) as Promise<{ success: boolean; silence?: unknown; error?: string }>,
      clearSilence: async (
        ownerAddress: string,
        targetAddress: string,
        scopeType: 'group' | 'dm',
        groupId?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:clearSilence',
          ownerAddress,
          targetAddress,
          scopeType,
          groupId
        ) as Promise<{ success: boolean; silence?: unknown; error?: string }>,
      setActiveDirectChat: async (
        localAddress: string,
        peerAddress: string,
        active: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setActiveDirectChat',
          localAddress,
          peerAddress,
          active
        ) as Promise<{ success: boolean; error?: string }>,
      subscribeGroup: async (groupId: number) =>
        ipcRenderer.invoke('reticulumChat:subscribeGroup', groupId) as Promise<{
          success: boolean;
          error?: string;
        }>,
      subscribeChannel: async (groupId: number, channelId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:subscribeChannel',
          groupId,
          channelId
        ) as Promise<{ success: boolean; error?: string }>,
      unsubscribeChannel: async (groupId: number, channelId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:unsubscribeChannel',
          groupId,
          channelId
        ) as Promise<{ success: boolean; error?: string }>,
      unsubscribeGroup: async (groupId: number) =>
        ipcRenderer.invoke(
          'reticulumChat:unsubscribeGroup',
          groupId
        ) as Promise<{ success: boolean; error?: string }>,
      publishEvent: async (event: unknown) =>
        ipcRenderer.invoke('reticulumChat:publishEvent', event) as Promise<{
          success: boolean;
          error?: string;
        }>,
      reserveAuthorSequence: async (groupId: number, authorAddress: string) =>
        ipcRenderer.invoke(
          'reticulumChat:reserveAuthorSequence',
          groupId,
          authorAddress
        ) as Promise<{ authorStreamId: string; authorSeq: number }>,
      releaseAuthorSequence: async (
        groupId: number,
        authorAddress: string,
        authorStreamId: string,
        authorSeq: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:releaseAuthorSequence',
          groupId,
          authorAddress,
          authorStreamId,
          authorSeq
        ) as Promise<boolean>,
      publishDirectEvent: async (event: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:publishDirectEvent',
          event
        ) as Promise<{
          success: boolean;
          error?: string;
        }>,
      getDirectAuthorStreamId: async (authorAddress: string) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectAuthorStreamId',
          authorAddress
        ) as Promise<string>,
      getDirectExpiryPreference: async (
        ownerAddress: string,
        peerAddress: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectExpiryPreference',
          ownerAddress,
          peerAddress
        ) as Promise<{
          success: boolean;
          preference?: {
            ownerAddress: string;
            peerAddress: string;
            durationMs: number | null;
            updatedAt: number;
          };
          error?: string;
        }>,
      setDirectExpiryPreference: async (
        ownerAddress: string,
        peerAddress: string,
        durationMs: number | null
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setDirectExpiryPreference',
          ownerAddress,
          peerAddress,
          durationMs
        ) as Promise<{
          success: boolean;
          preference?: {
            ownerAddress: string;
            peerAddress: string;
            durationMs: number | null;
            updatedAt: number;
          };
          error?: string;
        }>,
      getCalendarEvents: async (
        groupId: number,
        rangeStart: number,
        rangeEnd: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getCalendarEvents',
          groupId,
          rangeStart,
          rangeEnd
        ) as Promise<unknown[]>,
      getCalendarEvent: async (
        groupId: number,
        eventId: string,
        preferredOccurrenceStart?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getCalendarEvent',
          groupId,
          eventId,
          preferredOccurrenceStart
        ) as Promise<unknown | null>,
      createCalendarEvent: async (
        groupId: number,
        input: unknown,
        eventId?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:createCalendarEvent',
          groupId,
          input,
          eventId
        ) as Promise<unknown>,
      updateCalendarEvent: async (
        groupId: number,
        eventId: string,
        input: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:updateCalendarEvent',
          groupId,
          eventId,
          input
        ) as Promise<unknown>,
      deleteCalendarEvent: async (groupId: number, eventId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:deleteCalendarEvent',
          groupId,
          eventId
        ) as Promise<unknown>,
      getCalendarReminder: async (
        ownerAddress: string,
        groupId: number,
        eventId: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getCalendarReminder',
          ownerAddress,
          groupId,
          eventId
        ) as Promise<unknown>,
      setCalendarReminder: async (
        ownerAddress: string,
        groupId: number,
        eventId: string,
        offsetMs: number | null
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:setCalendarReminder',
          ownerAddress,
          groupId,
          eventId,
          offsetMs
        ) as Promise<unknown>,
      sendDirectTyping: async (
        localAddress: string,
        peerAddress: string,
        active: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:sendDirectTyping',
          localAddress,
          peerAddress,
          active
        ) as Promise<{ success: boolean; error?: string }>,
      getDirectHistory: async (
        myAddress: string,
        peerAddress: string,
        limit?: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectHistory',
          myAddress,
          peerAddress,
          limit
        ) as Promise<unknown[]>,
      getDirectSummaries: async (myAddress: string, peerAddress?: string) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectSummaries',
          myAddress,
          peerAddress
        ) as Promise<unknown[]>,
      getDirectCallHistory: async (
        ownerAddress: string,
        peerAddress?: string,
        limit?: number,
        unreadOnly?: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDirectCallHistory',
          ownerAddress,
          peerAddress,
          limit,
          unreadOnly
        ) as Promise<unknown[]>,
      markDirectRead: async (
        myAddress: string,
        peerAddress: string,
        upToTimestamp: number
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:markDirectRead',
          myAddress,
          peerAddress,
          upToTimestamp
        ) as Promise<{ success: boolean; error?: string }>,
      sendTyping: async (
        groupId: number,
        channelId: string,
        authorAddress: string,
        active: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:sendTyping',
          groupId,
          channelId,
          authorAddress,
          active
        ) as Promise<{ success: boolean; error?: string }>,
      sendLandState: async (
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
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:sendLandState',
          groupId,
          authorAddress,
          state
        ) as Promise<{ success: boolean; error?: string }>,
      sendLandChat: async (message: unknown) =>
        ipcRenderer.invoke('reticulumChat:sendLandChat', message) as Promise<{
          success: boolean;
          error?: string;
        }>,
      sendLandAction: async (groupId: number, action: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:sendLandAction',
          groupId,
          action
        ) as Promise<{ success: boolean; error?: string }>,
      sendLandCall: async (groupId: number, call: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:sendLandCall',
          groupId,
          call
        ) as Promise<{ success: boolean; error?: string }>,
      requestResource: async (
        groupId: number,
        manifest: unknown,
        eventId?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:requestResource',
          groupId,
          manifest,
          eventId
        ) as Promise<{ success: boolean; error?: string }>,
      requestDirectResource: async (
        myAddress: string,
        peerAddress: string,
        manifest: unknown,
        eventId?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:requestDirectResource',
          myAddress,
          peerAddress,
          manifest,
          eventId
        ) as Promise<{ success: boolean; error?: string }>,
      cancelResource: async (fileHash: string) =>
        ipcRenderer.invoke(
          'reticulumChat:cancelResource',
          fileHash
        ) as Promise<{ success: boolean; canceled?: boolean; error?: string }>,
      getHistory: async (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getHistory',
          groupId,
          channelId,
          limit,
          options
        ) as Promise<unknown[]>,
      getMessageHistory: async (
        groupId: number,
        channelId?: string,
        limit?: number,
        options?: unknown
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageHistory',
          groupId,
          channelId,
          limit,
          options
        ) as Promise<unknown[]>,
      getDiscussionIndex: async (groupId: number, channelId?: string) =>
        ipcRenderer.invoke(
          'reticulumChat:getDiscussionIndex',
          groupId,
          channelId
        ) as Promise<{
          replyCounts: Record<string, number>;
          rootByEventId: Record<string, string>;
        }>,
      getDiscussionMessages: async (
        groupId: number,
        channelId: string,
        eventId: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getDiscussionMessages',
          groupId,
          channelId,
          eventId
        ) as Promise<unknown[]>,
      getChannelMetadataHistory: async (groupId: number, limit?: number) =>
        ipcRenderer.invoke(
          'reticulumChat:getChannelMetadataHistory',
          groupId,
          limit
        ) as Promise<unknown[]>,
      getChannels: async (groupId: number, includeArchived?: boolean) =>
        ipcRenderer.invoke(
          'reticulumChat:getChannels',
          groupId,
          includeArchived
        ) as Promise<unknown[]>,
      getCategories: async (groupId: number) =>
        ipcRenderer.invoke('reticulumChat:getCategories', groupId) as Promise<
          unknown[]
        >,
      getChannelMetadataBundle: async (
        groupId: number,
        includeArchived?: boolean
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getChannelMetadataBundle',
          groupId,
          includeArchived
        ) as Promise<{
          channels: unknown[];
          categories: unknown[];
          ready: boolean;
          snapshotVersion: number;
        }>,
      applyChannelMetadata: async (eventId: string, payload: unknown) =>
        ipcRenderer.invoke(
          'reticulumChat:applyChannelMetadata',
          eventId,
          payload
        ) as Promise<{ success: boolean }>,
      getSyncState: async (groupId: number) =>
        ipcRenderer.invoke('reticulumChat:getSyncState', groupId) as Promise<
          Record<string, number>
        >,
      getSummaries: async (myAddress?: string) =>
        ipcRenderer.invoke('reticulumChat:getSummaries', myAddress) as Promise<
          unknown[]
        >,
      search: async (
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
      ) =>
        ipcRenderer.invoke('reticulumChat:search', query, options) as Promise<
          unknown[]
        >,
      getMessageWindowAroundEvent: async (
        groupId: number,
        channelId: string,
        eventId: string,
        options?: {
          beforeLimit?: number;
          afterLimit?: number;
        }
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:getMessageWindowAroundEvent',
          groupId,
          channelId,
          eventId,
          options
        ) as Promise<unknown[]>,
      indexSearchText: async (eventId: string, text: string) =>
        ipcRenderer.invoke(
          'reticulumChat:indexSearchText',
          eventId,
          text
        ) as Promise<{ success: boolean }>,
      deleteSearchText: async (eventId: string) =>
        ipcRenderer.invoke(
          'reticulumChat:deleteSearchText',
          eventId
        ) as Promise<{ success: boolean }>,
      replaceMentions: async (eventId: string, mentionedAddresses: string[]) =>
        ipcRenderer.invoke(
          'reticulumChat:replaceMentions',
          eventId,
          mentionedAddresses
        ) as Promise<{ success: boolean }>,
      deleteMentions: async (eventId: string) =>
        ipcRenderer.invoke('reticulumChat:deleteMentions', eventId) as Promise<{
          success: boolean;
        }>,
      markRead: async (
        groupId: number,
        channelId: string,
        upToTimestamp: number,
        myAddress?: string
      ) =>
        ipcRenderer.invoke(
          'reticulumChat:markRead',
          groupId,
          channelId,
          upToTimestamp,
          myAddress
        ) as Promise<{ success: boolean }>,
      markGroupsRead: async (groupIds: number[], myAddress?: string) =>
        ipcRenderer.invoke(
          'reticulumChat:markGroupsRead',
          groupIds,
          myAddress
        ) as Promise<{
          success: boolean;
          error?: string;
          groupsMarked: number;
          channelsMarked: number;
        }>,
      getSubscriptions: async () =>
        ipcRenderer.invoke('reticulumChat:getSubscriptions') as Promise<
          number[]
        >,
      updateMentionBadge: async (mentionCount: number) =>
        ipcRenderer.invoke(
          'reticulumChat:updateMentionBadge',
          mentionCount
        ) as Promise<{ success: boolean }>,
      onEvent: (cb: (payload: { event: unknown }) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(payload as { event: unknown });
        };
        ipcRenderer.on('reticulumChat:event', handler);
        ipcRenderer.send('reticulumChat:event:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:event', handler);
          ipcRenderer.send('reticulumChat:event:unsubscribe');
        };
      },
      onSummaryChanged: (
        cb: (payload: {
          groupId: number;
          eventId?: string;
          timestamp?: number;
          metadataChanged?: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              eventId?: string;
              timestamp?: number;
              metadataChanged?: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:summaryChanged', handler);
        ipcRenderer.send('reticulumChat:summaryChanged:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:summaryChanged', handler);
          ipcRenderer.send('reticulumChat:summaryChanged:unsubscribe');
        };
      },
      onCalendarChanged: (
        cb: (payload: { groupId: number; eventId?: string }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) =>
          cb(payload as { groupId: number; eventId?: string });
        ipcRenderer.on('reticulumChat:calendarChanged', handler);
        ipcRenderer.send('reticulumChat:calendarChanged:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:calendarChanged', handler);
          ipcRenderer.send('reticulumChat:calendarChanged:unsubscribe');
        };
      },
      onCalendarReminderDue: (cb: (payload: unknown) => void) => {
        const handler = (_event: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on('reticulumChat:calendarReminderDue', handler);
        ipcRenderer.send('reticulumChat:calendarReminderDue:subscribe');
        return () => {
          ipcRenderer.removeListener(
            'reticulumChat:calendarReminderDue',
            handler
          );
          ipcRenderer.send('reticulumChat:calendarReminderDue:unsubscribe');
        };
      },
      onDirectEvent: (cb: (payload: { event: unknown }) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(payload as { event: unknown });
        };
        ipcRenderer.on('reticulumChat:directEvent', handler);
        ipcRenderer.send('reticulumChat:directEvent:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:directEvent', handler);
          ipcRenderer.send('reticulumChat:directEvent:unsubscribe');
        };
      },
      onDirectCallHistory: (cb: (payload: { record: unknown }) => void) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(payload as { record: unknown });
        };
        ipcRenderer.on('reticulumChat:directCallHistory', handler);
        ipcRenderer.send('reticulumChat:directCallHistory:subscribe');
        return () => {
          ipcRenderer.removeListener(
            'reticulumChat:directCallHistory',
            handler
          );
          ipcRenderer.send('reticulumChat:directCallHistory:unsubscribe');
        };
      },
      onDirectTyping: (
        cb: (payload: {
          conversationId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              conversationId: string;
              authorAddress: string;
              active: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:directTyping', handler);
        ipcRenderer.send('reticulumChat:directTyping:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:directTyping', handler);
          ipcRenderer.send('reticulumChat:directTyping:unsubscribe');
        };
      },
      onDirectSummaryChanged: (
        cb: (payload: {
          conversationId?: string;
          peerAddress?: string;
          reason?: 'expiry' | 'call';
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              conversationId?: string;
              peerAddress?: string;
              reason?: 'expiry' | 'call';
            }
          );
        };
        ipcRenderer.on('reticulumChat:directSummaryChanged', handler);
        subscribeReticulumChatDirectSummaryChanged();
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          ipcRenderer.removeListener(
            'reticulumChat:directSummaryChanged',
            handler
          );
          unsubscribeReticulumChatDirectSummaryChanged();
        };
      },
      onSilenceChanged: (
        cb: (payload: {
          ownerAddress: string;
          targetAddress: string;
          scopeType: 'group' | 'dm';
          scopeId: string;
          expiresAt: number | null;
          active: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              ownerAddress: string;
              targetAddress: string;
              scopeType: 'group' | 'dm';
              scopeId: string;
              expiresAt: number | null;
              active: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:silenceChanged', handler);
        subscribeReticulumChatSilenceChanged();
        return () => {
          ipcRenderer.removeListener('reticulumChat:silenceChanged', handler);
          unsubscribeReticulumChatSilenceChanged();
        };
      },
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
          failureReason?: 'verification_failed';
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId?: number;
              eventId?: string;
              fileHash?: string;
              bytesTransferred?: number;
              totalBytes?: number;
              progress?: number;
              complete?: boolean;
              failed?: boolean;
              failureReason?: 'verification_failed';
            }
          );
        };
        ipcRenderer.on('reticulumChat:resource', handler);
        ipcRenderer.send('reticulumChat:resource:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:resource', handler);
          ipcRenderer.send('reticulumChat:resource:unsubscribe');
        };
      },
      onTyping: (
        cb: (payload: {
          groupId: number;
          channelId: string;
          authorAddress: string;
          active: boolean;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              channelId: string;
              authorAddress: string;
              active: boolean;
            }
          );
        };
        ipcRenderer.on('reticulumChat:typing', handler);
        ipcRenderer.send('reticulumChat:typing:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:typing', handler);
          ipcRenderer.send('reticulumChat:typing:unsubscribe');
        };
      },
      onLandState: (
        cb: (payload: {
          groupId: number;
          authorAddress: string;
          sessionId: string;
          destinationHash?: string;
          sequence: number;
          x: number;
          y: number;
          direction?: string;
          movement?: string;
          afk?: boolean;
          dnd?: boolean;
          voiceEnabled?: boolean;
          voiceMuted?: boolean;
          skinId?: number;
          timestamp?: number;
        }) => void
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              authorAddress: string;
              sessionId: string;
              destinationHash?: string;
              sequence: number;
              x: number;
              y: number;
              direction?: string;
              movement?: string;
              afk?: boolean;
              dnd?: boolean;
              voiceEnabled?: boolean;
              voiceMuted?: boolean;
              skinId?: number;
              timestamp?: number;
            }
          );
        };
        ipcRenderer.on('reticulumChat:landState', handler);
        ipcRenderer.send('reticulumChat:landState:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landState', handler);
          ipcRenderer.send('reticulumChat:landState:unsubscribe');
        };
      },
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
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
              groupId: number;
              messageId: string;
              authorAddress: string;
              sessionId: string;
              sequence: number;
              timestamp: number;
              text: string;
            }
          );
        };
        ipcRenderer.on('reticulumChat:landChat', handler);
        ipcRenderer.send('reticulumChat:landChat:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landChat', handler);
          ipcRenderer.send('reticulumChat:landChat:unsubscribe');
        };
      },
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
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
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
            }
          );
        };
        ipcRenderer.on('reticulumChat:landAction', handler);
        ipcRenderer.send('reticulumChat:landAction:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landAction', handler);
          ipcRenderer.send('reticulumChat:landAction:unsubscribe');
        };
      },
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
      ) => {
        const handler = (_event: unknown, payload: unknown) => {
          cb(
            payload as {
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
            }
          );
        };
        ipcRenderer.on('reticulumChat:landCall', handler);
        ipcRenderer.send('reticulumChat:landCall:subscribe');
        return () => {
          ipcRenderer.removeListener('reticulumChat:landCall', handler);
          ipcRenderer.send('reticulumChat:landCall:unsubscribe');
        };
      },
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
      timestamp: number,
      cancellationSignature?: string,
      cancellationPublicKey?: string,
      cancellationTimestamp?: number
    ) =>
      ipcRenderer.invoke(
        'call:initiate',
        targetAddress,
        chatId,
        localAddress,
        signature,
        publicKey,
        callId,
        timestamp,
        cancellationSignature,
        cancellationPublicKey,
        cancellationTimestamp
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
      timestamp?: number,
      reasonSignature?: string
    ) =>
      ipcRenderer.invoke(
        'call:reject',
        callId,
        reason,
        signature,
        publicKey,
        timestamp,
        reasonSignature
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

    /** Send wallet-authenticated WebRTC negotiation over the selected direct link. */
    sendRtcSignal: async (input: {
      callId: string;
      generation: string;
      signalId: string;
      signalType: 'capability' | 'offer' | 'answer' | 'candidate';
      payload: string;
      payloadHash: string;
      timestamp: number;
      signature: string;
      publicKey: string;
    }) => ipcRenderer.invoke('call:rtc-signal', input),

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
        'call:rtc-signal',
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
    join: async (...args: GroupCallJoinIpcArguments) =>
      invokeGroupCallJoin(
        (channel, ...invokeArgs) => ipcRenderer.invoke(channel, ...invokeArgs),
        ...args
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
      timestamp: number,
      joinGeneration?: number
    ) =>
      ipcRenderer.invoke(
        'gcall:leave',
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp,
        joinGeneration
      ),

    leaveSync: (
      roomId: string,
      localAddress: string,
      signature: string,
      publicKey: string,
      timestamp: number,
      joinGeneration?: number
    ) =>
      ipcRenderer.sendSync(
        'gcall:leaveSync',
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp,
        joinGeneration
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
      timestamp: number,
      localAuthorityProvisional = false
    ) =>
      ipcRenderer.invoke(
        'gcall:broadcastTopology',
        roomId,
        topology,
        signature,
        publicKey,
        timestamp,
        localAuthorityProvisional
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

    sendRtcSignal: async (input: {
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
    }) => ipcRenderer.invoke('gcall:sendRtcSignal', input),

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
        'gcall:local-session-taken-over',
        'gcall:topology',
        'gcall:cluster-heartbeat',
        'gcall:heartbeat',
        'gcall:audio',
        'gcall:key',
        'gcall:key-request',
        'gcall:session-updated',
        'gcall:rtc-signal',
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
