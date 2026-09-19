import {
  clearForeignWalletSigner,
  importForeignWalletKeys,
  foreignWalletPublicKey,
  signForeignWalletPayment,
} from './foreign-wallet-signer';
import { createForeignWalletJournal } from './foreign-wallet-journal';
import { QAppFileSaves, SaveError } from './qapp-file-save';
import { qappGuestPartition, qappGuestUrlAllowed, type QAppGuestOwner } from './qapp-guest-policy';
import { restrictQAppGuestWebRtc } from './qapp-guest-network-policy';
import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  CapElectronEventEmitter,
  CapacitorSplashScreen,
  setupCapacitorElectronPlugins,
} from '@capacitor-community/electron';
import chokidar from 'chokidar';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  MenuItem,
  nativeImage,
  Tray,
  session,
  ipcMain,
  dialog,
  net,
  shell,
} from 'electron';
import electronIsDev from 'electron-is-dev';
import windowStateKeeper from 'electron-window-state';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { pathToFileURL } from 'url';
import { materializeReticulumResourceForOpen } from './reticulum-resource-open';
import { installDisplayMediaPicker } from './display-media-picker';
import {
  DEV_LOGS_DISABLED_STORAGE_KEY,
  log as loggerLog,
  error as loggerError,
  setDisableDevLogs,
  warn as loggerWarn,
} from './logger';
import {
  isRendererFrameUnavailableError,
  isRendererMainFrameReady,
  sendToRenderer,
} from './renderer-delivery';
import { createRefcountedSubscriberSet } from './refcounted-subscriber-set';
import { myCapacitorApp, isQuitting, setIsQuitting } from '.';
import {
  bootstrap,
  bootstrapOrClearChainAndStart,
  customQortalInstalledDir,
  dbExists,
  deleteDB,
  determineJavaVersion,
  getApiKey,
  installCore,
  isCoreInstalled,
  isCorePortRunning,
  isCoreRunning,
  removeCustomQortalPath,
  resetApikey,
  startCore,
  stopCore,
} from './core';
import {
  ensureCertForBase,
  installCertificateVerification,
  installLocalNodeHttpsBlock,
  isLocalPrivateHost,
  persistedLocalNodeCaExists,
  setLocalNodeHttpsReady,
} from './local-https-cert';
import {
  startVideoServer,
  stopVideoServer,
  getVideoServerPort,
  isVideoServerRunning,
} from './video-server';
import {
  startP2PNetwork,
  stopP2PNetwork,
  getP2PNetwork,
  type P2PNetworkOptions,
} from './p2p-network';
import {
  startStunCoordinator,
  stopStunCoordinator,
  getStunCoordinator,
  GET_ICE_SERVERS_DEADLINE_MS,
} from './stun-coordinator';
import {
  startPresenceManager,
  stopPresenceManager,
  publishPresenceEnvelope,
  getPresenceManager,
  setPresenceManagerTransports,
} from './presence';
import {
  startChatManager,
  stopChatManager,
  getChatManager,
  flushChatStore,
} from './chat';
import {
  startReticulumChatManager,
  stopReticulumChatManager,
  getReticulumChatManager,
  readReticulumChatHistoryFromDb,
  readReticulumChatMessageHistoryFromDb,
  readReticulumChatMessageWindowAroundEventFromDb,
  readReticulumChatChannelMetadataHistoryFromDb,
  readReticulumChatChannelsFromDb,
  readReticulumChatCategoriesFromDb,
  readReticulumChatSummariesFromDb,
  readReticulumChatSyncStateFromDb,
  markReticulumChatReadInDb,
  searchReticulumChatFromDb,
  applyReticulumChatChannelMetadataInDb,
  indexReticulumChatSearchTextInDb,
  deleteReticulumChatSearchTextInDb,
  replaceReticulumChatMentionsInDb,
  deleteReticulumChatMentionsInDb,
  type ReticulumChatEvent,
  type ReticulumChatHistoryReadOptions,
} from './reticulum-chat';
import { startCallManager, stopCallManager, getCallManager } from './call';
import type { DmCallLinkControlPayload } from './call';
import {
  startGroupCallManager,
  stopGroupCallManager,
  getGroupCallManager,
  GC_MESSAGE_TYPES,
} from './group-call';
import type { DmCallLinkControlInput, GcEnvelope } from './group-call';
import type { GroupCallJoinIpcArguments } from './group-call-ipc-contract';
import {
  getReticulumBridge,
  setReticulumBridgeDeveloperLogsFiltered,
  startReticulumBridge,
  type ReticulumOverlayVerifiedPeer,
} from './reticulum-bridge';
import {
  QAppReticulumManager,
  type QAppReticulumNativeEvent,
  type QAppReticulumOwner,
} from './qapp-reticulum-manager';
import {
  PrivateChannelError,
  PrivateChannelManager,
} from './private-channel-manager';
import {
  createMoqTransport,
  getPrivateTransportFactory,
  shutdownPrivateTransportSidecar,
} from './private-transport-runtime';
import { QAppMoqError, QAppMoqTransportManager } from './moq-transport-manager';
import {
  configureRelaySigner,
  setRelayAccount,
  setRelayGroups,
} from './relay-access-coordinator';
import { attachReticulumStatusBridgeEvents } from './reticulum-daemon';
import {
  startReticulumMeshCoordinator,
  stopReticulumMeshCoordinator,
} from './reticulum-mesh';
import {
  RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES,
  RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
  ReticulumResourceStore,
} from './reticulum-resource-store';
import { reticulumMediaWorkerPool } from './reticulum-media-worker-pool';
import { isDisabledLegacy } from './feature-flags';
import {
  SingleFlightReadiness,
  type ReadinessStatus,
} from './single-flight-readiness';
import {
  getReticulumRuntimeGeneration,
  invalidateReticulumRuntimeGeneration,
  isReticulumRuntimeEnabled,
  setReticulumRuntimeEnabled,
} from './reticulum-runtime-state';
import {
  AUDIO_SURFACE_WINDOW_ROLE,
  AUDIO_SURFACE_ENTRY_PATH,
  MAIN_WINDOW_ROLE,
  buildAudioSurfaceScheme,
  buildAudioSurfaceUrl,
  withAudioSurfaceIsolationHeaders,
} from './audio-window-policy';
import { withEmbeddedFrameWebRtcBlocked } from './embedded-frame-network-policy';
import { ensureAudioSurfaceHttpsServer } from './audio-surface-https';
import {
  buildDefaultAudioSurfaceBridgeStateLike,
  type AudioSurfaceCommand,
  type AudioSurfaceCommandEnvelope,
  type AudioSurfaceCommandResultEnvelope,
  type AudioSurfaceEvent,
  type AudioSurfaceResponseLike,
} from './audio-surface-ipc';
import { registerStaticAppProtocol } from './app-protocol';
import {
  getSystemCallReadinessSnapshot,
  refreshSystemCallReadinessSnapshot,
  startSystemCallReadinessMonitor,
} from './system-call-readiness';
import {
  describeMainPressureState,
  noteMainLoopStallForProfiling,
  runMainPressureTask,
} from './main-pressure';

const GCALL_AUDIO_RENDERER_SEND_AT_MS = Symbol.for(
  'qortal.gcallAudioRendererSendAtMs'
);
const GCALL_AUDIO_MAIN_IPC_AT_MS = Symbol.for('qortal.gcallAudioMainIpcAtMs');
const OPEN_DEVTOOLS_IN_DEVELOPMENT = false;
const GCALL_AUDIO_IPC_DELAY_LOG_THRESHOLD_MS = 80;
const GCALL_MAIN_LOOP_SAMPLE_INTERVAL_MS = 50;
const GCALL_MAIN_LOOP_STALL_LOG_THRESHOLD_MS = 80;
const GCALL_MAIN_LOOP_STALL_RECENT_LIMIT = 16;
const GCALL_MAIN_LOOP_STALL_LOG_THROTTLE_MS = 1000;
const RETICULUM_CHAT_ONLINE_SINCE_MS = Date.now();

type MainLoopStallSample = {
  atMs: number;
  delayMs: number;
};

let mainLoopExpectedAtMs = Date.now() + GCALL_MAIN_LOOP_SAMPLE_INTERVAL_MS;
let mainLoopStallCount = 0;
let mainLoopStallMaxDelayMs = 0;
let mainLoopLastStallAtMs = 0;
let mainLoopLastStallDelayMs = 0;
let mainLoopLastLogAtMs = 0;
const mainLoopRecentStalls: MainLoopStallSample[] = [];

function recordMainLoopStall(delayMs: number, nowMs = Date.now()): void {
  mainLoopStallCount++;
  mainLoopStallMaxDelayMs = Math.max(mainLoopStallMaxDelayMs, delayMs);
  mainLoopLastStallAtMs = nowMs;
  mainLoopLastStallDelayMs = delayMs;
  mainLoopRecentStalls.push({ atMs: nowMs, delayMs });
  while (mainLoopRecentStalls.length > GCALL_MAIN_LOOP_STALL_RECENT_LIMIT) {
    mainLoopRecentStalls.shift();
  }

  if (nowMs - mainLoopLastLogAtMs < GCALL_MAIN_LOOP_STALL_LOG_THROTTLE_MS) {
    return;
  }
  mainLoopLastLogAtMs = nowMs;
  loggerLog(
    `[GCall] target=reticulum-audio-ipc stage=main-event-loop-stall delay_ms=${Math.round(
      delayMs
    )} stall_count=${mainLoopStallCount} max_delay_ms=${Math.round(
      mainLoopStallMaxDelayMs
    )} ${describeMainPressureState()}`
  );
  noteMainLoopStallForProfiling(delayMs);
}

const mainLoopMonitorTimer = setInterval(() => {
  const nowMs = Date.now();
  const delayMs = Math.max(0, nowMs - mainLoopExpectedAtMs);
  mainLoopExpectedAtMs = nowMs + GCALL_MAIN_LOOP_SAMPLE_INTERVAL_MS;
  if (delayMs >= GCALL_MAIN_LOOP_STALL_LOG_THRESHOLD_MS) {
    recordMainLoopStall(delayMs, nowMs);
  }
}, GCALL_MAIN_LOOP_SAMPLE_INTERVAL_MS);
mainLoopMonitorTimer.unref?.();

function getMainLoopIpcTimingDetail(rendererSendAtMs: number, nowMs: number) {
  const lastStallAgeMs =
    mainLoopLastStallAtMs > 0 ? Math.max(0, nowMs - mainLoopLastStallAtMs) : -1;
  const currentLagMs = Math.max(0, nowMs - mainLoopExpectedAtMs);
  let recentStallMaxMs = 0;
  let stallSinceRendererMaxMs = 0;
  for (const sample of mainLoopRecentStalls) {
    if (nowMs - sample.atMs <= 5000) {
      recentStallMaxMs = Math.max(recentStallMaxMs, sample.delayMs);
    }
    if (sample.atMs >= rendererSendAtMs) {
      stallSinceRendererMaxMs = Math.max(
        stallSinceRendererMaxMs,
        sample.delayMs
      );
    }
  }
  return {
    currentLagMs,
    lastStallAgeMs,
    lastStallDelayMs: mainLoopLastStallDelayMs,
    recentStallMaxMs,
    stallSinceRendererMaxMs,
    stallCount: mainLoopStallCount,
    stallMaxDelayMs: mainLoopStallMaxDelayMs,
  };
}

function attachGroupAudioIpcTiming(
  buf: Buffer,
  timing?: { rendererSendAtWallMs?: number },
  context?: {
    channel: 'sendAudio' | 'sendAudioBatch';
    roomId?: string;
    targetCount?: number;
  }
): void {
  const rendererSendAtMs = timing?.rendererSendAtWallMs;
  const mainIpcAtMs = Date.now();
  if (
    typeof rendererSendAtMs === 'number' &&
    Number.isFinite(rendererSendAtMs) &&
    rendererSendAtMs > 0
  ) {
    Object.defineProperty(buf, GCALL_AUDIO_RENDERER_SEND_AT_MS, {
      value: rendererSendAtMs,
      enumerable: false,
      configurable: true,
    });
    const rendererToMainMs = Math.max(0, mainIpcAtMs - rendererSendAtMs);
    if (rendererToMainMs >= GCALL_AUDIO_IPC_DELAY_LOG_THRESHOLD_MS) {
      const mainLoopTiming = getMainLoopIpcTimingDetail(
        rendererSendAtMs,
        mainIpcAtMs
      );
      loggerLog(
        `[GCall] target=reticulum-audio-ipc stage=gcall-audio-ipc-handler-entry-delay channel=${
          context?.channel ?? 'unknown'
        } room=${context?.roomId ?? 'n/a'} target_count=${
          context?.targetCount ?? 0
        } delay_ms=${Math.round(
          rendererToMainMs
        )} main_loop_current_lag_ms=${Math.round(
          mainLoopTiming.currentLagMs
        )} main_loop_last_stall_ms=${Math.round(
          mainLoopTiming.lastStallDelayMs
        )} main_loop_last_stall_age_ms=${Math.round(
          mainLoopTiming.lastStallAgeMs
        )} main_loop_recent_stall_max_ms=${Math.round(
          mainLoopTiming.recentStallMaxMs
        )} main_loop_stall_since_renderer_max_ms=${Math.round(
          mainLoopTiming.stallSinceRendererMaxMs
        )} main_loop_stall_count=${mainLoopTiming.stallCount} main_loop_stall_max_ms=${Math.round(
          mainLoopTiming.stallMaxDelayMs
        )}`
      );
    }
  }
  Object.defineProperty(buf, GCALL_AUDIO_MAIN_IPC_AT_MS, {
    value: mainIpcAtMs,
    enumerable: false,
    configurable: true,
  });
}

const AdmZip = require('adm-zip');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');

const defaultDomains = [
  'capacitor-electron://-',
  'qortal-reticulum-resource://-',
  'http://127.0.0.1:12391',
  'https://127.0.0.1:12391',
  'ws://127.0.0.1:12391',
  'wss://127.0.0.1:12391',
  'https://ext-node.qortal.link',
  'wss://ext-node.qortal.link',
  'https://appnode.qortal.org',
  'wss://appnode.qortal.org',
  'https://api.qortal.org',
  'https://api2.qortal.org',
  'https://apinode.qortalnodes.live',
  'https://apinode1.qortalnodes.live',
  'https://apinode2.qortalnodes.live',
  'https://apinode3.qortalnodes.live',
  'https://apinode4.qortalnodes.live',
];

let reticulumResourceStore: ReticulumResourceStore | null = null;
const RETICULUM_RESOURCE_PROTOCOL = 'qortal-reticulum-resource';
const RETICULUM_RESOURCE_URL_TOKEN_TTL_MS = 20 * 60_000;
const RETICULUM_RESOURCE_URL_TOKEN_MAX = 2_000;
let reticulumResourceProtocolRegistered = false;
const reticulumResourceUrlTokens = new Map<
  string,
  { fileHash: string; expiresAt: number }
>();

function getReticulumResourceStore(): ReticulumResourceStore {
  if (!reticulumResourceStore) {
    reticulumResourceStore = new ReticulumResourceStore();
  }
  return reticulumResourceStore;
}

export function shutdownReticulumResourceStore(): void {
  reticulumMediaWorkerPool.stop();
  reticulumResourceUrlTokens.clear();
  if (reticulumResourceProtocolRegistered) {
    try {
      session.defaultSession.protocol.unhandle(RETICULUM_RESOURCE_PROTOCOL);
    } catch (err) {
      loggerWarn(
        '[ReticulumResource] Failed to unhandle resource protocol:',
        err
      );
    } finally {
      reticulumResourceProtocolRegistered = false;
    }
  }
  if (!reticulumResourceStore) return;
  try {
    reticulumResourceStore.close();
  } catch (err) {
    loggerWarn('[ReticulumResource] Failed to close resource store:', err);
  } finally {
    reticulumResourceStore = null;
  }
}

function pruneReticulumResourceUrlTokens(now = Date.now()): void {
  for (const [token, entry] of reticulumResourceUrlTokens.entries()) {
    if (entry.expiresAt <= now) {
      reticulumResourceUrlTokens.delete(token);
    }
  }
  if (reticulumResourceUrlTokens.size <= RETICULUM_RESOURCE_URL_TOKEN_MAX)
    return;
  const excess =
    reticulumResourceUrlTokens.size - RETICULUM_RESOURCE_URL_TOKEN_MAX;
  const oldest = [...reticulumResourceUrlTokens.entries()]
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    .slice(0, excess);
  for (const [token] of oldest) {
    reticulumResourceUrlTokens.delete(token);
  }
}

function mintReticulumResourceUrlToken(fileHash: string): string {
  pruneReticulumResourceUrlTokens();
  const token = crypto.randomBytes(24).toString('hex');
  reticulumResourceUrlTokens.set(token, {
    fileHash,
    expiresAt: Date.now() + RETICULUM_RESOURCE_URL_TOKEN_TTL_MS,
  });
  return token;
}

function validateReticulumResourceUrlToken(
  fileHash: string,
  token: string
): boolean {
  pruneReticulumResourceUrlTokens();
  const entry = reticulumResourceUrlTokens.get(token);
  return Boolean(entry && entry.fileHash === fileHash);
}

function reticulumResourceUrl(fileHash: string): string {
  const token = mintReticulumResourceUrlToken(fileHash);
  return `${RETICULUM_RESOURCE_PROTOCOL}://-/resource/${encodeURIComponent(fileHash)}?token=${encodeURIComponent(token)}`;
}

async function registerReticulumResourceProtocol(): Promise<void> {
  if (reticulumResourceProtocolRegistered) return;
  const protocol = session.defaultSession.protocol;
  if (protocol.isProtocolHandled(RETICULUM_RESOURCE_PROTOCOL)) {
    protocol.unhandle(RETICULUM_RESOURCE_PROTOCOL);
  }
  protocol.handle(RETICULUM_RESOURCE_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'resource' || !parts[1]) {
        return new Response('Not Found', { status: 404 });
      }
      const fileHash = decodeURIComponent(parts[1]);
      const token = url.searchParams.get('token') || '';
      if (!validateReticulumResourceUrlToken(fileHash, token)) {
        return new Response('Not Found', { status: 404 });
      }
      const store = getReticulumResourceStore();
      const manifest = store.getManifest(fileHash);
      if (!manifest) return new Response('Not Found', { status: 404 });
      const filePath =
        store.getVerifiedAssembledPath(fileHash) ??
        (await store.assembleResourceAsync(fileHash));
      const response = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(response.headers);
      headers.set(
        'content-type',
        manifest.mimeType || 'application/octet-stream'
      );
      headers.set('cache-control', 'no-store');
      headers.set('cross-origin-resource-policy', 'same-origin');
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      loggerWarn('[ReticulumResource] Protocol read failed:', err);
      return new Response('Not Found', { status: 404 });
    }
  });
  reticulumResourceProtocolRegistered = true;
}

function normalizeBase64Payload(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const withoutPrefix = trimmed.includes(',')
    ? trimmed.slice(trimmed.indexOf(',') + 1)
    : trimmed;
  return /^[A-Za-z0-9+/]*={0,2}$/u.test(withoutPrefix) ? withoutPrefix : '';
}

function guessMimeTypeFromFileName(fileName: string): string {
  const ext = path.extname(fileName || '').toLowerCase();
  switch (ext) {
    case '.apng':
      return 'image/apng';
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

// let allowedDomains: string[] = [...defaultDomains]
const domainHolder = {
  allowedDomains: [...defaultDomains],
};

/** Same path layout as `getSharedSettingsFilePath('wallet-storage.json')` (preload `walletStorage`). */
function getWalletStorageJsonPathSync(): string {
  return path.join(app.getPath('appData'), 'qortal-hub', 'wallet-storage.json');
}

function readCustomNodeUrlsFromWalletStorageFile(): string[] {
  try {
    const filePath = getWalletStorageJsonPathSync();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as { customNodes?: unknown };
    const nodes = data?.customNodes;
    if (!Array.isArray(nodes)) return [];
    return nodes
      .map((n: { url?: unknown }) =>
        typeof n?.url === 'string' ? n.url.trim() : ''
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mergeUserDomainsIntoAllowlist(domains: string[]): string[] {
  const validatedUserDomains = domains
    .flatMap((domain) => {
      try {
        const url = new URL(domain);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socketUrl = `${protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
        return [url.origin, socketUrl];
      } catch {
        return [];
      }
    })
    .filter(Boolean) as string[];

  return [...new Set([...defaultDomains, ...validatedUserDomains])];
}

function applyAllowedDomainsFromUserUrls(
  domains: string[],
  options: { reloadWindow: boolean }
): void {
  if (!Array.isArray(domains)) {
    return;
  }
  const newAllowedDomains = mergeUserDomainsIntoAllowlist(domains);
  const sortedCurrentDomains = [...domainHolder.allowedDomains].sort();
  const sortedNewDomains = [...newAllowedDomains].sort();
  const hasChanged =
    sortedCurrentDomains.length !== sortedNewDomains.length ||
    sortedCurrentDomains.some(
      (domain, index) => domain !== sortedNewDomains[index]
    );

  if (hasChanged) {
    domainHolder.allowedDomains = newAllowedDomains;

    if (options.reloadWindow) {
      const mainWindow = myCapacitorApp.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    }
  }
}

/** Apply custom node URLs from wallet storage before the web app loads (no window reload). */
export function loadPersistedAllowedDomainsAtStartup(): void {
  const urls = readCustomNodeUrlsFromWalletStorageFile();
  applyAllowedDomainsFromUserUrls(urls, { reloadWindow: false });
}
// Define components for a watcher to detect when the webapp is changed so we can reload in Dev mode.
const reloadWatcher = {
  debouncer: null,
  ready: false,
  watcher: null,
};

const isolatedAudioSurfaceContents = new Set<number>();
const audioSurfaceSubscribers = new Set<Electron.WebContents>();
const pendingAudioSurfaceCommands = new Map<
  string,
  {
    resolve: (value: AudioSurfaceResponseLike) => void;
    reject: (reason?: unknown) => void;
  }
>();
const AUDIO_SURFACE_IDLE_CLOSE_MS = 90_000;
const AUDIO_SURFACE_READY_TIMEOUT_MS = 10_000;
let audioSurfaceHostReady = false;
const audioSurfaceReadyResolvers: Array<() => void> = [];
let audioSurfaceBridgeState = buildDefaultAudioSurfaceBridgeStateLike();

function isMainShellSender(sender: Electron.WebContents): boolean {
  const mainWindow = myCapacitorApp?.getMainWindow?.();
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents.id === sender.id
  );
}

/**
 * Trust only the hidden audio-surface window (webContents id captured at creation).
 * Comparing to getAudioSurfaceWindow() is fragile if references or lifetimes diverge.
 */
function isAudioSurfaceHostSender(sender: Electron.WebContents): boolean {
  return isolatedAudioSurfaceContents.has(sender.id);
}

function waitForAudioSurfaceHostReady(): Promise<void> {
  if (audioSurfaceHostReady) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const resolveReady = () => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve();
    };
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const resolverIndex = audioSurfaceReadyResolvers.indexOf(resolveReady);
      if (resolverIndex !== -1) {
        audioSurfaceReadyResolvers.splice(resolverIndex, 1);
      }
      loggerWarn('[GCall:audio-surface] host ready wait timed out', {
        timeoutMs: AUDIO_SURFACE_READY_TIMEOUT_MS,
      });
      resolve();
    }, AUDIO_SURFACE_READY_TIMEOUT_MS);
    audioSurfaceReadyResolvers.push(resolveReady);
  });
}

function markAudioSurfaceHostReady(): void {
  audioSurfaceHostReady = true;
  audioSurfaceBridgeState = {
    ...audioSurfaceBridgeState,
    hostReady: true,
  };
  for (const resolve of audioSurfaceReadyResolvers.splice(0)) {
    resolve();
  }
}

function markAudioSurfaceHostClosed(): void {
  audioSurfaceHostReady = false;
  audioSurfaceBridgeState = buildDefaultAudioSurfaceBridgeStateLike();
  for (const resolve of audioSurfaceReadyResolvers.splice(0)) {
    resolve();
  }
  for (const [, pending] of pendingAudioSurfaceCommands) {
    pending.reject(new Error('audio-surface-window-closed'));
  }
  pendingAudioSurfaceCommands.clear();
  for (const webContents of audioSurfaceSubscribers) {
    if (!webContents.isDestroyed()) {
      webContents.send('audio-surface:event', {
        type: 'engine-closed',
      } satisfies AudioSurfaceEvent);
    }
  }
}

function emitAudioSurfaceEvent(event: AudioSurfaceEvent): void {
  if (event.type === 'engine-ready') {
    audioSurfaceBridgeState = {
      ...audioSurfaceBridgeState,
      hostReady: true,
      bootstrapRevisionApplied: event.bootstrapRevisionApplied,
    };
  } else if (event.type === 'snapshot') {
    audioSurfaceBridgeState = {
      ...audioSurfaceBridgeState,
      snapshot: event.snapshot,
    };
  }
  for (const webContents of audioSurfaceSubscribers) {
    if (!webContents.isDestroyed()) {
      webContents.send('audio-surface:event', event);
    }
  }
}
export function setupReloadWatcher(
  electronCapacitorApp: ElectronCapacitorApp
): void {
  reloadWatcher.watcher = chokidar
    .watch(join(app.getAppPath(), 'app'), {
      ignored: /[/\\]\./,
      persistent: true,
    })
    .on('ready', () => {
      reloadWatcher.ready = true;
    })
    .on('all', (_event, _path) => {
      if (reloadWatcher.ready) {
        clearTimeout(reloadWatcher.debouncer);
        reloadWatcher.debouncer = setTimeout(async () => {
          electronCapacitorApp.getMainWindow().webContents.reload();
          reloadWatcher.ready = false;
          clearTimeout(reloadWatcher.debouncer);
          reloadWatcher.debouncer = null;
          reloadWatcher.watcher = null;
          setupReloadWatcher(electronCapacitorApp);
        }, 1500);
      }
    });
}

// Define our class to manage our app.
export class ElectronCapacitorApp {
  private MainWindow: BrowserWindow | null = null;
  private AudioSurfaceWindow: BrowserWindow | null = null;
  private SplashScreen: CapacitorSplashScreen | null = null;
  private TrayIcon: Tray | null = null;
  private reticulumChatMentionBadgeCount = 0;
  private CapacitorFileConfig: CapacitorElectronConfig;
  private TrayMenuTemplate: (MenuItem | MenuItemConstructorOptions)[] = [
    new MenuItem({ label: 'Quit App', role: 'quit' }),
  ];
  private AppMenuBarMenuTemplate: (MenuItem | MenuItemConstructorOptions)[] = [
    { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
    { role: 'viewMenu' },
    { role: 'editMenu' },
  ];
  private mainWindowState;
  private loadWebApp;
  private customScheme: string;
  private audioSurfaceScheme: string;
  private audioSurfaceHttpsOrigin: string | null = null;
  private audioSurfaceWindowReady: Promise<BrowserWindow> | null = null;
  private audioSurfaceIdleCloseTimer: NodeJS.Timeout | null = null;

  constructor(
    capacitorFileConfig: CapacitorElectronConfig,
    trayMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[],
    appMenuBarMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[]
  ) {
    this.CapacitorFileConfig = capacitorFileConfig;

    this.customScheme =
      this.CapacitorFileConfig.electron?.customUrlScheme ??
      'capacitor-electron';
    this.audioSurfaceScheme = buildAudioSurfaceScheme(this.customScheme);

    if (trayMenuTemplate) {
      this.TrayMenuTemplate = trayMenuTemplate;
    }

    if (appMenuBarMenuTemplate) {
      this.AppMenuBarMenuTemplate = appMenuBarMenuTemplate;
    }

    // Setup our web app loader, this lets us load apps like react, vue, and angular without changing their build chains.
    this.loadWebApp = async (window: BrowserWindow) => {
      await window.loadURL(`${this.customScheme}://-`);
    };
  }

  // Helper function to load in the app.
  private async loadMainWindow(thisRef: any) {
    await thisRef.loadWebApp(thisRef.MainWindow);
  }

  // Expose the mainWindow ref for use outside of the class.
  getMainWindow(): BrowserWindow {
    return this.MainWindow;
  }

  getCustomURLScheme(): string {
    return this.customScheme;
  }

  getAudioSurfaceWindow(): BrowserWindow | null {
    return this.AudioSurfaceWindow;
  }

  updateReticulumChatMentionBadge(count: number): void {
    const badgeCount = Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : 0;
    this.reticulumChatMentionBadgeCount = badgeCount;
    app.setBadgeCount(badgeCount);
    this.updateTrayTooltip();
  }

  private updateTrayTooltip(): void {
    if (!this.TrayIcon) return;
    const appName = app.getName();
    if (this.reticulumChatMentionBadgeCount > 0) {
      const suffix =
        this.reticulumChatMentionBadgeCount === 1
          ? '1 unread mention'
          : `${this.reticulumChatMentionBadgeCount} unread mentions`;
      this.TrayIcon.setToolTip(`${appName} - ${suffix}`);
      return;
    }
    this.TrayIcon.setToolTip(appName);
  }

  async ensureAudioSurfaceWindow(): Promise<BrowserWindow> {
    this.cancelAudioSurfaceIdleClose('ensure');
    if (this.AudioSurfaceWindow && !this.AudioSurfaceWindow.isDestroyed()) {
      return this.AudioSurfaceWindow;
    }
    if (this.audioSurfaceWindowReady) {
      return this.audioSurfaceWindowReady;
    }
    this.audioSurfaceWindowReady = this.createAudioSurfaceWindow();
    try {
      return await this.audioSurfaceWindowReady;
    } finally {
      this.audioSurfaceWindowReady = null;
    }
  }

  private async createAudioSurfaceWindow(): Promise<BrowserWindow> {
    if (!this.MainWindow || this.MainWindow.isDestroyed()) {
      throw new Error('Main window must exist before creating audio surface');
    }
    const preloadPath = join(
      app.getAppPath(),
      'build',
      'src',
      'audio-surface-preload.js'
    );
    const window = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        // The hidden audio surface should behave like a normal isolated web page.
        // Node-enabled or unsandboxed renderers do not qualify for
        // cross-origin isolation / SharedArrayBuffer in Electron.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: preloadPath,
        additionalArguments: [`--window-role=${AUDIO_SURFACE_WINDOW_ROLE}`],
      },
    });
    this.AudioSurfaceWindow = window;
    const webContentsId = window.webContents.id;
    isolatedAudioSurfaceContents.add(webContentsId);
    window.on('closed', () => {
      isolatedAudioSurfaceContents.delete(webContentsId);
      if (this.AudioSurfaceWindow === window) {
        this.AudioSurfaceWindow = null;
      }
      markAudioSurfaceHostClosed();
    });
    const targetUrl = buildAudioSurfaceUrl(
      this.audioSurfaceHttpsOrigin ?? this.MainWindow.webContents.getURL(),
      this.customScheme,
      this.audioSurfaceScheme
    );
    loggerLog('[GCall:audio-surface] create window target', {
      mainWindowUrl: this.MainWindow.webContents.getURL(),
      targetUrl,
      webContentsId,
    });
    window.webContents.on('did-finish-load', () => {
      loggerLog('[GCall:audio-surface] did-finish-load', {
        url: window.webContents.getURL(),
        webContentsId,
      });
      void window.webContents
        .executeJavaScript(
          `({
            href: location.href,
            origin: location.origin,
            crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
            sharedArrayBufferDefined: typeof SharedArrayBuffer !== 'undefined'
          })`,
          true
        )
        .then((state) => {
          loggerLog('[GCall:audio-surface] runtime isolation probe', {
            webContentsId,
            ...(state as Record<string, unknown>),
          });
        })
        .catch((error) => {
          loggerWarn('[GCall:audio-surface] runtime isolation probe failed', {
            webContentsId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    });
    await window.loadURL(targetUrl);
    if (electronIsDev && OPEN_DEVTOOLS_IN_DEVELOPMENT) {
      try {
        window.webContents.openDevTools({ mode: 'detach' });
        loggerLog(
          '[GCall:audio-surface] dev: opened DevTools for audio-surface window'
        );
      } catch (e) {
        loggerWarn('[GCall:audio-surface] dev: openDevTools failed', e);
      }
    }
    return window;
  }

  cancelAudioSurfaceIdleClose(reason: string): void {
    if (!this.audioSurfaceIdleCloseTimer) return;
    clearTimeout(this.audioSurfaceIdleCloseTimer);
    this.audioSurfaceIdleCloseTimer = null;
    loggerLog('[GCall:audio-surface] idle close canceled', { reason });
  }

  scheduleAudioSurfaceIdleClose(reason: string): void {
    if (!this.AudioSurfaceWindow || this.AudioSurfaceWindow.isDestroyed()) {
      return;
    }
    this.cancelAudioSurfaceIdleClose('reschedule');
    loggerLog('[GCall:audio-surface] idle close scheduled', {
      reason,
      delayMs: AUDIO_SURFACE_IDLE_CLOSE_MS,
    });
    this.audioSurfaceIdleCloseTimer = setTimeout(() => {
      this.audioSurfaceIdleCloseTimer = null;
      this.closeAudioSurfaceWindow(`idle-timeout:${reason}`);
    }, AUDIO_SURFACE_IDLE_CLOSE_MS);
  }

  closeAudioSurfaceWindow(reason: string): void {
    this.cancelAudioSurfaceIdleClose('close');
    const audioWindow = this.AudioSurfaceWindow;
    if (!audioWindow || audioWindow.isDestroyed()) {
      markAudioSurfaceHostClosed();
      return;
    }
    loggerLog('[GCall:audio-surface] closing window', {
      reason,
      webContentsId: audioWindow.webContents.id,
    });
    audioWindow.close();
  }

  async init(p2pBootstrapSeeds?: string[]): Promise<void> {
    await registerStaticAppProtocol(
      session.defaultSession,
      this.customScheme,
      join(app.getAppPath(), 'app')
    );
    await registerStaticAppProtocol(
      session.defaultSession,
      this.audioSurfaceScheme,
      join(app.getAppPath(), 'app')
    );
    await registerReticulumResourceProtocol();
    this.audioSurfaceHttpsOrigin = await ensureAudioSurfaceHttpsServer(
      join(app.getAppPath(), 'app')
    );
    const icon = nativeImage.createFromPath(
      join(
        app.getAppPath(),
        'assets',
        process.platform === 'win32' ? 'appIcon.ico' : 'appIcon.png'
      )
    );
    this.mainWindowState = windowStateKeeper({
      defaultWidth: 1000,
      defaultHeight: 800,
    });
    // Setup preload script path and construct our main window.
    const preloadPath = join(app.getAppPath(), 'build', 'src', 'preload.js');
    const seedsPayload = JSON.stringify({
      v: 1,
      seeds: Array.isArray(p2pBootstrapSeeds) ? p2pBootstrapSeeds : [],
    });
    const seedsB64 = Buffer.from(seedsPayload, 'utf8').toString('base64');
    this.MainWindow = new BrowserWindow({
      icon,
      show: false,
      x: this.mainWindowState.x,
      y: this.mainWindowState.y,
      width: this.mainWindowState.width,
      height: this.mainWindowState.height,
      backgroundColor: '#27282c',
      frame: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        webviewTag: true,
        preload: preloadPath,
        backgroundThrottling: false,
        additionalArguments: [
          `--hub-p2p-seeds=${seedsB64}`,
          `--window-role=${MAIN_WINDOW_ROLE}`,
        ],
      },
    });
    configuredQAppSessions.clear();
    this.MainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      const prepared = [...preparedQAppGuests.values()].find(
        (candidate) => qappGuestUrlAllowed(
          candidate.url,
          params.src,
          candidate.owner,
          candidate.isDevMode
        ) &&
          candidate.partition === params.partition &&
          candidate.preloadTokenUrl === params.preload
      );
      if (!prepared) {
        event.preventDefault();
        return;
      }
      webPreferences.preload = qappGuestPreloadPath;
      params.preload = pathToFileURL(qappGuestPreloadPath).toString();
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webviewTag = false;
      webPreferences.partition = prepared.partition;
      webPreferences.additionalArguments = [`--qapp-guest-token=${prepared.guestToken}`];
    });
    this.MainWindow.webContents.on('did-attach-webview', (_event, guest) => {
      attachedQAppGuests.set(guest.id, { contents: guest, prepared: null });
      // Restrict WebRTC on the Q-App guest itself. The iframe response policy
      // does not cover a webview's main document, and this also covers nested
      // frames that share the guest's WebContents.
      restrictQAppGuestWebRtc(guest);
      guest.setWindowOpenHandler(() => ({ action: 'deny' }));
      const allowedGuestUrl = (nextUrl: string) => {
        const bound = attachedQAppGuests.get(guest.id)?.prepared;
        const candidates = bound ? [bound] : [...preparedQAppGuests.values()];
        return candidates.some(
          (candidate) =>
            guest.session === session.fromPartition(candidate.partition) &&
            qappGuestUrlAllowed(candidate.url, nextUrl, candidate.owner, candidate.isDevMode)
        );
      };
      guest.on('will-navigate', (event, nextUrl) => {
        if (!allowedGuestUrl(nextUrl)) event.preventDefault();
      });
      guest.on('will-redirect', (event, nextUrl, _inPlace, isMainFrame) => {
        if (isMainFrame && !allowedGuestUrl(nextUrl)) event.preventDefault();
      });
      guest.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          const owner = attachedQAppGuests.get(guest.id)?.prepared?.owner;
          if (owner) void cleanupQAppOwner(owner);
        }
      });
      const cleanup = () => {
        const attached = attachedQAppGuests.get(guest.id);
        attachedQAppGuests.delete(guest.id);
        if (attached?.prepared) void cleanupQAppOwner(attached.prepared.owner);
      };
      guest.on('destroyed', cleanup);
      guest.on('render-process-gone', cleanup);
    });
    const clearGuestRegistrations = () => {
      for (const attached of attachedQAppGuests.values()) {
        if (attached.prepared) void cleanupQAppOwner(attached.prepared.owner);
      }
      attachedQAppGuests.clear();
      preparedQAppGuests.clear();
    };
    this.MainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) clearGuestRegistrations();
    });
    this.MainWindow.webContents.on('destroyed', clearGuestRegistrations);
    this.mainWindowState.manage(this.MainWindow);
    installDisplayMediaPicker(this.MainWindow);
    this.MainWindow.on('maximize', () => {
      this.MainWindow?.webContents.send('window:state-changed', true);
    });
    this.MainWindow.on('unmaximize', () => {
      this.MainWindow?.webContents.send('window:state-changed', false);
    });

    // Allow microphone access for voice calls.
    const summarizeMediaPermissionDetails = (
      details: unknown
    ): Record<string, unknown> => {
      if (!details || typeof details !== 'object') return {};
      const d = details as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      if (typeof d.requestingUrl === 'string')
        out.requestingUrl = d.requestingUrl;
      if (typeof d.isMainFrame === 'boolean') out.isMainFrame = d.isMainFrame;
      if (Array.isArray(d.mediaTypes)) out.mediaTypes = d.mediaTypes;
      if (typeof d.securityOrigin === 'string')
        out.securityOrigin = d.securityOrigin;
      return out;
    };
    // TODO: Restore if mic permissions don't work
    // this.MainWindow.webContents.session.setPermissionRequestHandler(
    //   (_webContents, permission, callback, details) => {
    //     const summary = summarizeMediaPermissionDetails(details);
    //     const granted = permission === 'media';
    //     loggerLog('[GCall][perm] request', { permission, granted, ...summary });
    //     if (granted) return callback(true);
    //     loggerWarn(
    //       '[GCall][perm] denied — handler only auto-allows "media"; got:',
    //       permission,
    //       summary
    //     );
    //     callback(false);
    //   }
    // );

    if (this.CapacitorFileConfig.backgroundColor) {
      this.MainWindow.setBackgroundColor(
        this.CapacitorFileConfig.electron.backgroundColor
      );
    }

    // Close window: use saved preference (from SharedSettingsFilePath) or ask user.
    // Must call event.preventDefault() synchronously so the window does not close before we decide.
    this.MainWindow.on('close', async (event) => {
      if (!isQuitting) {
        event.preventDefault();

        const appSettings = await readAppSettings();
        const closeAction = appSettings.closeAction ?? 'ask';

        if (closeAction === 'minimizeToTray') {
          this.MainWindow.hide();
          return;
        }
        if (closeAction === 'quit') {
          setIsQuitting(true);
          app.quit();
          return;
        }

        // closeAction === 'ask': show dialog

        const backgroundText =
          process.platform === 'darwin'
            ? 'Minimize to Dock'
            : 'Minimize to Tray';
        const backgroundDetail =
          process.platform === 'darwin'
            ? 'Keep the app running in the dock'
            : 'Keep the app running in the system tray';

        const choice = await dialog.showMessageBox(this.MainWindow, {
          type: 'question',
          buttons: [backgroundText, 'Quit Completely', 'Cancel'],
          defaultId: 0,
          title: 'Close Qortal Hub',
          message: 'What would you like to do?',
          detail: `${backgroundText}: ${backgroundDetail}\n\nQuit Completely: Stop the application entirely`,
          cancelId: 2,
        });

        if (choice.response === 0) {
          this.MainWindow.hide();
        } else if (choice.response === 1) {
          setIsQuitting(true);
          app.quit();
        }
      }
    });

    // If we close the main window with the splashscreen enabled we need to destroy the ref.
    this.MainWindow.on('closed', () => {
      stopPresenceMainHeartbeatScheduler();
      if (
        this.SplashScreen?.getSplashWindow() &&
        !this.SplashScreen.getSplashWindow().isDestroyed()
      ) {
        this.SplashScreen.getSplashWindow().close();
      }
    });

    // When the tray icon is enabled, setup the options.
    if (this.CapacitorFileConfig.electron?.trayIconAndMenuEnabled) {
      // On macOS, use dock instead of menu bar tray icon (more conventional)
      // On Windows and Linux, use the system tray icon
      if (process.platform !== 'darwin') {
        this.TrayIcon = new Tray(icon);

        // On Windows, single-click shows context menu (handled automatically by the OS)
        // On Linux, single-click toggles window visibility
        if (process.platform !== 'win32') {
          this.TrayIcon.on('click', () => {
            if (this.MainWindow) {
              if (this.MainWindow.isVisible()) {
                this.MainWindow.hide();
              } else {
                this.MainWindow.show();
                this.MainWindow.focus();
              }
            }
          });
        }

        // Double-click toggles window visibility on all platforms
        this.TrayIcon.on('double-click', () => {
          if (this.MainWindow) {
            if (this.MainWindow.isVisible()) {
              this.MainWindow.hide();
            } else {
              this.MainWindow.show();
              this.MainWindow.focus();
            }
          }
        });

        this.updateTrayTooltip();
        this.TrayIcon.setContextMenu(
          Menu.buildFromTemplate(this.TrayMenuTemplate)
        );
      }
    }

    // Setup the main manu bar at the top of our window.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(this.AppMenuBarMenuTemplate)
    );

    // If the splashscreen is enabled, show it first while the main window loads then switch it out for the main window, or just load the main window from the start.
    if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
      this.SplashScreen = new CapacitorSplashScreen({
        imageFilePath: join(
          app.getAppPath(),
          'assets',
          this.CapacitorFileConfig.electron?.splashScreenImageName ??
            'splash.png'
        ),
        windowWidth: 400,
        windowHeight: 400,
      });
      this.SplashScreen.init(this.loadMainWindow, this);
    } else {
      this.loadMainWindow(this);
    }

    // Security
    this.MainWindow.webContents.setWindowOpenHandler((details) => {
      if (!details.url.includes(this.customScheme)) {
        return { action: 'deny' };
      } else {
        return { action: 'allow' };
      }
    });

    this.MainWindow.webContents.on('will-navigate', (event, _newURL) => {
      if (!this.MainWindow.webContents.getURL().includes(this.customScheme)) {
        event.preventDefault();
      }
    });

    // Link electron plugins into the system.
    setupCapacitorElectronPlugins();

    // When the web app is loaded we hide the splashscreen if needed and show the mainwindow.
    this.MainWindow.webContents.on('dom-ready', () => {
      if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
        this.SplashScreen.getSplashWindow().hide();
      }
      if (!this.CapacitorFileConfig.electron?.hideMainWindowOnLaunch) {
        this.MainWindow.show();
      }
      setTimeout(() => {
        if (electronIsDev && OPEN_DEVTOOLS_IN_DEVELOPMENT) {
          this.MainWindow.webContents.openDevTools();
        }
        CapElectronEventEmitter.emit(
          'CAPELECTRON_DeeplinkListenerInitialized',
          ''
        );
      }, 400);
    });
  }
}

export function setupContentSecurityPolicy(customScheme: string, targetSession = session.defaultSession): void {
  targetSession.webRequest.onHeadersReceived(
    (details: any, callback) => {
      const requestUrl = details.url;
      const expandedDomains = [...domainHolder.allowedDomains];
      for (const d of domainHolder.allowedDomains) {
        try {
          const url = new URL(d);
          if (isLocalPrivateHost(url.hostname)) {
            const hostPort = url.port
              ? `${url.hostname}:${url.port}`
              : url.hostname;
            expandedDomains.push(
              `http://${hostPort}`,
              `https://${hostPort}`,
              `ws://${hostPort}`,
              `wss://${hostPort}`
            );
          }
        } catch {
          /* ignore */
        }
      }
      const allowedSources = [
        "'self'",
        customScheme,
        ...new Set(expandedDomains),
      ];

      const frameSources = [
        "'self'",
        'http://localhost:*',
        'https://localhost:*',
        'ws://localhost:*',
        'ws://127.0.0.1:*',
        'http://127.0.0.1:*',
        'https://127.0.0.1:*',
        ...allowedSources,
      ];
      const isHubShellRequest = requestUrl.startsWith(`${customScheme}://`);
      const inlineScriptSource = isHubShellRequest ? '' : " 'unsafe-inline'";
      const evalScriptSource = isHubShellRequest ? '' : " 'unsafe-eval'";
      const wasmEvalScriptSource = isHubShellRequest
        ? ''
        : " 'wasm-unsafe-eval'";

      // Create the Content Security Policy (CSP) string
      const csp = `
    default-src 'self' ${frameSources.join(' ')};
    frame-src ${frameSources.join(' ')};
    script-src 'self'${wasmEvalScriptSource}${evalScriptSource}${inlineScriptSource} ${frameSources.join(' ')};
    worker-src 'self' blob: data: ${frameSources.join(' ')};
    object-src 'self';
    connect-src 'self' blob: ${frameSources.join(' ')};
    img-src 'self' data: blob: ${frameSources.join(' ')};
    media-src 'self' blob: ${frameSources.join(' ')};  
    style-src 'self' 'unsafe-inline';
    font-src 'self' data:;
  `
        .replace(/\s+/g, ' ')
        .trim();

      // Get the request URL and origin
      const requestOrigin =
        details.origin || details.referrer || 'capacitor-electron://-';

      // Parse the request URL to get its origin
      let requestUrlOrigin: string;
      try {
        const parsedUrl = new URL(requestUrl);
        requestUrlOrigin = parsedUrl.origin;
      } catch (e) {
        // Handle invalid URLs gracefully
        requestUrlOrigin = '';
      }

      // Determine if the request is cross-origin
      const isCrossOrigin = requestOrigin !== requestUrlOrigin;
      const originalResponseHeaders = details.responseHeaders ?? {};

      // Check if the response already includes Access-Control-Allow-Origin
      const hasAccessControlAllowOrigin = Object.keys(
        originalResponseHeaders
      ).some(
        (header) => header.toLowerCase() === 'access-control-allow-origin'
      );

      // Prepare response headers: remove any existing CSP (e.g. from node over HTTPS)
      // so only our permissive CSP is applied and qapps (e.g. extract7z) can use eval.
      const cspHeaderLower = 'content-security-policy';
      const filtered = Object.fromEntries(
        Object.entries(originalResponseHeaders).filter(
          ([key]) => key.toLowerCase() !== cspHeaderLower
        )
      );
      const responseHeaders = withEmbeddedFrameWebRtcBlocked(
        {
          ...filtered,
          'Content-Security-Policy': [csp],
        },
        { resourceType: details.resourceType }
      );

      Object.assign(
        responseHeaders,
        withAudioSurfaceIsolationHeaders(responseHeaders, {
          url: details.url,
          resourceType: details.resourceType,
          origin: details.origin,
          referrer: details.referrer,
        })
      );

      if (isCrossOrigin && !hasAccessControlAllowOrigin) {
        // Handle CORS for cross-origin requests lacking CORS headers
        // Optionally, check if the requestOrigin is allowed
        responseHeaders['Access-Control-Allow-Origin'] = requestOrigin;
        responseHeaders['Access-Control-Allow-Methods'] =
          'GET, POST, OPTIONS, DELETE';
        responseHeaders['Access-Control-Allow-Headers'] =
          'Content-Type, Authorization, x-api-key';
      }

      // Callback with modified headers
      callback({ responseHeaders });
    }
  );
}

// IPC listener for updating allowed domains
ipcMain.on('set-allowed-domains', (event, domains: string[]) => {
  if (!Array.isArray(domains)) {
    return;
  }
  applyAllowedDomainsFromUserUrls(domains, { reloadWindow: true });
});

// Custom title bar: window controls (minimize, maximize, close)
ipcMain.handle('window:minimize', () => {
  const win = myCapacitorApp.getMainWindow();
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle('window:maximize', () => {
  const win = myCapacitorApp.getMainWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.handle('window:close', () => {
  const win = myCapacitorApp.getMainWindow();
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('window:focus', () => {
  const win = myCapacitorApp.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
});

ipcMain.handle('window:isMaximized', () => {
  const win = myCapacitorApp.getMainWindow();
  return win != null && !win.isDestroyed() && win.isMaximized();
});

ipcMain.handle('window:getPlatform', () => process.platform);

let qortalLandGameRestartBridge: ReturnType<typeof getReticulumBridge> = null;
const attachQortalLandGameRestartListener = () => {
  const bridge = getReticulumBridge();
  if (!bridge || bridge === qortalLandGameRestartBridge) return;
  qortalLandGameRestartBridge = bridge;
  bridge.on('qortalland-game-transport-restarted', () => {
    const mainWindow = myCapacitorApp.getMainWindow();
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('qortalLandGames:transportRestarted');
    }
  });
};

const getQortalLandRealtimeBootstrap = (event: Electron.IpcMainInvokeEvent) => {
  const mainWindow = myCapacitorApp.getMainWindow();
  if (
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) {
    throw new Error(
      'Qortal Land realtime transport is restricted to the main window'
    );
  }
  attachQortalLandGameRestartListener();
  return getReticulumBridge()?.getQortalLandGameTransportBootstrap() ?? null;
};

ipcMain.handle(
  'qortalLandRealtime:getTransportBootstrap',
  getQortalLandRealtimeBootstrap
);
ipcMain.handle(
  'qortalLandGames:getTransportBootstrap',
  getQortalLandRealtimeBootstrap
);

startSystemCallReadinessMonitor();

ipcMain.handle('systemCallReadiness:getSnapshot', () =>
  getSystemCallReadinessSnapshot()
);

ipcMain.handle('systemCallReadiness:refreshSnapshot', () =>
  refreshSystemCallReadinessSnapshot()
);

ipcMain.handle(
  'window:showAppMenu',
  (event, { x, y }: { x?: number; y?: number }) => {
    const win = myCapacitorApp.getMainWindow();
    const menu = Menu.getApplicationMenu();
    if (menu && win && !win.isDestroyed()) {
      menu.popup({
        window: win,
        x: x ?? 0,
        y: y ?? 32,
      });
    }
  }
);

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] }, // Restrict to ZIP files
    ],
  });
  return result.filePaths[0];
});

ipcMain.handle('fs:readFile', async (_, filePath) => {
  try {
    // Ensure the file exists
    if (!fs.existsSync(filePath)) {
      throw new Error('File does not exist.');
    }

    // Ensure the filePath is an absolute path (optional but recommended for safety)
    const absolutePath = path.resolve(filePath);

    // Read the file as a Buffer
    const fileBuffer = fs.readFileSync(absolutePath);

    return fileBuffer;
  } catch (error) {
    loggerError('Error reading file:', error.message);
    return null; // Return null on error
  }
});

ipcMain.handle('fs:selectAndZip', async (_, path) => {
  let directoryPath = path;
  if (!directoryPath) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) {
      loggerError('No directory selected');
      return null;
    }

    directoryPath = filePaths[0];
  }

  try {
    // Add the entire directory to the zip
    const zip = new AdmZip();

    // Add the entire directory to the zip
    zip.addLocalFolder(directoryPath);

    // Generate the zip file as a buffer
    const zipBuffer = zip.toBuffer();

    return { buffer: zipBuffer, directoryPath };
  } catch (error) {
    return null;
  }
});

// Helper to get or create the shared settings directory
export async function getSharedSettingsFilePath(
  fileName: string
): Promise<string> {
  const dir = path.join(app.getPath('appData'), 'qortal-hub');
  await fs.promises.mkdir(dir, { recursive: true });
  return path.join(dir, fileName);
}

// Persistent store: shared across instances via atomic writes to appData/qortal-hub/
// Uses write-file-atomic to prevent partial writes corrupting the file.
// On set/delete: read-from-disk → merge → atomic write, so concurrent instances
// never overwrite each other's keys (only a simultaneous write of the *same* key
// by two instances at the exact same moment could still race, which is acceptable).
const PERSISTENT_STORE_FILENAME = 'qortal-persistent-store.json';
const MISC_PERSISTENT_STORE_FILENAME = 'misc-persist.json';

function parsePersistentStoreRaw(raw: string): Record<string, unknown> {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return {};
  try {
    return (JSON.parse(trimmed) as Record<string, unknown>) || {};
  } catch (_) {
    return {};
  }
}

function createPersistentJsonStore(fileName: string, label: string) {
  let cache: Record<string, unknown> | null = null;
  let loadedFromDisk = false;

  const getFilePath = (): string => {
    const dir = path.join(app.getPath('appData'), 'qortal-hub');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, fileName);
  };

  const readFromDisk = async (): Promise<Record<string, unknown>> => {
    try {
      const filePath = getFilePath();
      const stats = await fs.promises.stat(filePath).catch(() => null);
      if (!stats?.isFile()) return {};
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      return parsePersistentStoreRaw(raw);
    } catch (err) {
      loggerError(`Error reading ${label} from disk`, err);
      return {};
    }
  };

  const load = async (): Promise<Record<string, unknown>> => {
    if (cache !== null) return cache;
    const data = await readFromDisk();
    const hadData = Object.keys(data).length > 0;
    cache = data;
    if (hadData) loadedFromDisk = true;
    return cache;
  };

  const flush = (): void => {
    if (cache === null) return;
    if (!loadedFromDisk && Object.keys(cache).length === 0) {
      return;
    }
    try {
      const filePath = getFilePath();
      let onDisk: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        try {
          onDisk = parsePersistentStoreRaw(fs.readFileSync(filePath, 'utf-8'));
        } catch (_) {
          onDisk = {};
        }
      }
      const merged = { ...onDisk, ...cache };
      writeFileAtomic.sync(filePath, JSON.stringify(merged, null, 2), {
        encoding: 'utf8',
      });
    } catch (err) {
      loggerError(`Error flushing ${label}`, err);
    }
  };

  const get = async (key: string): Promise<unknown> => {
    const store = await load();
    return store[key];
  };

  const set = async (key: string, value: unknown): Promise<void> => {
    // Read-merge-write: fetch fresh disk state, merge the new key, write atomically.
    // This ensures concurrent instances don't clobber each other's unrelated keys.
    const onDisk = await readFromDisk();
    onDisk[key] = value;
    try {
      const filePath = getFilePath();
      await writeFileAtomic(filePath, JSON.stringify(onDisk, null, 2), {
        encoding: 'utf8',
      });
    } catch (err) {
      loggerError(`Error writing ${label} (set)`, err);
    }
    if (cache === null) cache = {};
    cache[key] = value;
    loadedFromDisk = true;
  };

  const deleteKey = async (key: string): Promise<void> => {
    // Read-merge-write: fetch fresh disk state, remove the key, write atomically.
    const onDisk = await readFromDisk();
    delete onDisk[key];
    try {
      const filePath = getFilePath();
      await writeFileAtomic(filePath, JSON.stringify(onDisk, null, 2), {
        encoding: 'utf8',
      });
    } catch (err) {
      loggerError(`Error writing ${label} (delete)`, err);
    }
    if (cache !== null) delete cache[key];
  };

  return { deleteKey, flush, get, set };
}

const persistentStore = createPersistentJsonStore(
  PERSISTENT_STORE_FILENAME,
  'persistent store'
);
const miscPersistentStore = createPersistentJsonStore(
  MISC_PERSISTENT_STORE_FILENAME,
  'misc persistent store'
);

void persistentStore
  .get(DEV_LOGS_DISABLED_STORAGE_KEY)
  .then((value) => {
    const next = value === false ? false : true;
    setDisableDevLogs(next);
    setReticulumBridgeDeveloperLogsFiltered(next);
  })
  .catch((err) => {
    loggerError('Error loading dev log setting from persistent store', err);
  });

export function flushPersistentStore(): void {
  persistentStore.flush();
}

export function flushMiscPersistentStore(): void {
  miscPersistentStore.flush();
}

let foreignSignerOwner: number | null = null;
function requireForeignWalletHost(event: Electron.IpcMainInvokeEvent) {
  if (
    !isMainShellSender(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('Wallet signer is restricted to the main frame');
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) throw new Error('Wallet window unavailable');
  return parent;
}
ipcMain.handle('foreignWalletSigner:import', (event, keys) => {
  requireForeignWalletHost(event);
  const publicKeys = importForeignWalletKeys(keys);
  foreignSignerOwner = event.sender.id;
  return publicKeys;
});
ipcMain.handle('foreignWalletSigner:publicKey', (event, coin) => {
  requireForeignWalletHost(event);
  return foreignWalletPublicKey(coin);
});
ipcMain.handle('foreignWalletSigner:clear', (event) => {
  requireForeignWalletHost(event);
  clearForeignWalletSigner();
});
ipcMain.handle('foreignWalletSigner:sign', (event, request) => {
  requireForeignWalletHost(event);
  return signForeignWalletPayment(request);
});
app.on('before-quit', clearForeignWalletSigner);
app.on('web-contents-created', (_event, contents) => {
  const contentsId = contents.id;
  const clearIfHost = () => {
    if (foreignSignerOwner === contentsId) clearForeignWalletSigner();
  };
  contents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) clearIfHost();
    }
  );
  contents.on('render-process-gone', clearIfHost);
  contents.on('destroyed', clearIfHost);
});

let foreignWalletJournal: ReturnType<typeof createForeignWalletJournal>;
function getForeignWalletJournal(event: Electron.IpcMainInvokeEvent) {
  if (
    !isMainShellSender(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('Foreign wallet journal is restricted to the main frame');
  return (foreignWalletJournal ??= createForeignWalletJournal(
    path.join(app.getPath('appData'), 'qortal-hub', 'foreign-wallet-journal')
  ));
}
ipcMain.handle('foreignWalletJournal:get', (event, key: string) =>
  getForeignWalletJournal(event).get(key)
);
ipcMain.handle(
  'foreignWalletJournal:set',
  (event, key: string, value: string) =>
    getForeignWalletJournal(event).set(key, value)
);
ipcMain.handle(
  'foreignWalletJournal:delete',
  (event, key: string, txId: string) =>
    getForeignWalletJournal(event).delete(key, txId)
);

ipcMain.handle('persistentStore:get', async (_event, key: string) =>
  persistentStore.get(key)
);

ipcMain.handle(
  'persistentStore:set',
  async (_event, key: string, value: unknown) => {
    await persistentStore.set(key, value);
    if (key === DEV_LOGS_DISABLED_STORAGE_KEY) {
      const next = value === false ? false : true;
      setDisableDevLogs(next);
      setReticulumBridgeDeveloperLogsFiltered(next);
    }
  }
);

ipcMain.handle('persistentStore:delete', async (_event, key: string) => {
  await persistentStore.deleteKey(key);
  if (key === DEV_LOGS_DISABLED_STORAGE_KEY) {
    setDisableDevLogs(true);
    setReticulumBridgeDeveloperLogsFiltered(true);
  }
});

ipcMain.handle('logger:setDisableDevLogs', async (_event, value: boolean) => {
  const next = value === false ? false : true;
  setDisableDevLogs(next);
  setReticulumBridgeDeveloperLogsFiltered(next);
  await persistentStore.set(DEV_LOGS_DISABLED_STORAGE_KEY, next);
  return next;
});

ipcMain.handle('miscPersistentStore:get', async (_event, key: string) =>
  miscPersistentStore.get(key)
);

ipcMain.handle(
  'miscPersistentStore:set',
  async (_event, key: string, value: unknown) => {
    await miscPersistentStore.set(key, value);
  }
);

ipcMain.handle('miscPersistentStore:delete', async (_event, key: string) => {
  await miscPersistentStore.deleteKey(key);
});

// App settings (stored in SharedSettingsFilePath) - e.g. close/minimize to tray preference
const APP_SETTINGS_FILENAME = 'app-settings.json';

export type CloseAction = 'ask' | 'minimizeToTray' | 'quit';
export type AutoLockTimeoutMinutes = 0 | 10 | 30 | 60 | 180;

const AUTO_LOCK_TIMEOUT_OPTIONS: readonly AutoLockTimeoutMinutes[] = [
  0, 10, 30, 60, 180,
];
const DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES: AutoLockTimeoutMinutes = 30;

function normalizeAutoLockTimeoutMinutes(
  value: unknown,
  legacyDisabled = false
): AutoLockTimeoutMinutes {
  if (value == null) {
    return legacyDisabled ? 0 : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
  }
  const numericValue = Number(value);
  return AUTO_LOCK_TIMEOUT_OPTIONS.includes(
    numericValue as AutoLockTimeoutMinutes
  )
    ? (numericValue as AutoLockTimeoutMinutes)
    : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
}

export interface AppSettings {
  closeAction?: CloseAction;
  /** When true, skip the intro audio played on the unauthenticated startup screen. */
  disableStartupSound?: boolean;
  /** Minutes of inactivity before locking. Zero disables automatic locking. */
  autoLockTimeoutMinutes?: AutoLockTimeoutMinutes;
  /** @deprecated Compatibility for settings written before timeout selection. */
  disableAutoLockOnIdle?: boolean;
  /** Whether the Hub P2P network auto-starts on launch (default true). */
  p2pEnabled?: boolean;
  /**
   * @deprecated Retained only for settings-file compatibility. Centralized
   * public STUN fallback is no longer used.
   */
  legacyPublicStunFallback?: boolean;
  /** Contribute this device as an anonymously advertised community STUN server. */
  communityStunContributionEnabled?: boolean;
  /** When false, skip UPnP for Reticulum hub mesh TCP listen port (default true). */
  reticulumMeshUpnpEnabled?: boolean;
  /** When false, do not write/regenerate Qortal Hub's managed Reticulum config. */
  reticulumManagedConfigEnabled?: boolean;
  /** Opt in to routing Reticulum traffic for other peers (default false). */
  reticulumTransportEnabled?: boolean;
  /** Global Reticulum feature and process lifecycle switch (default true). */
  reticulumEnabled?: boolean;
  /** Reticulum-backed group chat transport. Default true; users may opt out. */
  reticulumChatEnabled?: boolean;
  /** Maximum disk bytes used by Reticulum chat images and attachments. */
  reticulumResourceLimitBytes?: number;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  closeAction: 'ask',
  disableStartupSound: false,
  autoLockTimeoutMinutes: DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES,
  disableAutoLockOnIdle: false,
  p2pEnabled: !isDisabledLegacy,
  communityStunContributionEnabled: true,
  reticulumMeshUpnpEnabled: true,
  reticulumManagedConfigEnabled: true,
  reticulumTransportEnabled: false,
  reticulumEnabled: true,
  reticulumChatEnabled: true,
  reticulumResourceLimitBytes: RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES,
};

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
    const raw = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const autoLockTimeoutMinutes = normalizeAutoLockTimeoutMinutes(
      parsed.autoLockTimeoutMinutes,
      parsed.disableAutoLockOnIdle === true
    );
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
      closeAction:
        parsed.closeAction &&
        ['ask', 'minimizeToTray', 'quit'].includes(parsed.closeAction)
          ? (parsed.closeAction as CloseAction)
          : DEFAULT_APP_SETTINGS.closeAction,
      disableStartupSound: parsed.disableStartupSound === true,
      autoLockTimeoutMinutes,
      disableAutoLockOnIdle: autoLockTimeoutMinutes === 0,
      p2pEnabled: isDisabledLegacy
        ? false
        : parsed.p2pEnabled === false
          ? false
          : true,
      legacyPublicStunFallback: isDisabledLegacy
        ? false
        : parsed.legacyPublicStunFallback === true,
      communityStunContributionEnabled:
        parsed.communityStunContributionEnabled === false ? false : true,
      reticulumMeshUpnpEnabled:
        parsed.reticulumMeshUpnpEnabled === false ? false : true,
      reticulumManagedConfigEnabled:
        parsed.reticulumManagedConfigEnabled === false ? false : true,
      reticulumTransportEnabled: parsed.reticulumTransportEnabled === true,
      reticulumEnabled: parsed.reticulumEnabled === false ? false : true,
      reticulumChatEnabled:
        parsed.reticulumChatEnabled === false ? false : true,
      reticulumResourceLimitBytes: Math.max(
        RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        Math.min(
          100 * 1024 * 1024 * 1024,
          Math.floor(
            Number(parsed.reticulumResourceLimitBytes) ||
              RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES
          )
        )
      ),
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function isReticulumChatEffectivelyEnabled(settings: AppSettings): boolean {
  return (
    settings.reticulumEnabled !== false &&
    settings.reticulumChatEnabled === true
  );
}

async function writeAppSettings(settings: AppSettings): Promise<void> {
  const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
  await writeFileAtomic(filePath, JSON.stringify(settings, null, 2), {
    encoding: 'utf8',
  });
}

type AppSettingsChangeListener = (
  settings: AppSettings
) => void | Promise<void>;
const appSettingsChangeListeners = new Set<AppSettingsChangeListener>();
let lastObservedAppSettingsJson = '';

async function notifyAppSettingsChanged(settings: AppSettings): Promise<void> {
  setReticulumRuntimeEnabled(settings.reticulumEnabled !== false);
  getStunCoordinator()?.setContributionEnabled(
    settings.communityStunContributionEnabled !== false
  );
  lastObservedAppSettingsJson = JSON.stringify(settings);
  for (const window of BrowserWindow.getAllWindows()) {
    sendToRenderer(window.webContents, 'appSettings:changed', settings);
  }
  for (const listener of appSettingsChangeListeners) {
    await listener(settings);
  }
}

export function subscribeToAppSettingsChanges(
  listener: AppSettingsChangeListener
): () => void {
  appSettingsChangeListeners.add(listener);
  return () => appSettingsChangeListeners.delete(listener);
}

export async function startAppSettingsWatcher(): Promise<() => void> {
  const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
  const initialSettings = await readAppSettings();
  setReticulumRuntimeEnabled(initialSettings.reticulumEnabled !== false);
  lastObservedAppSettingsJson = JSON.stringify(initialSettings);
  fs.watchFile(filePath, { interval: 750 }, () => {
    void readAppSettings().then((settings) => {
      const serialized = JSON.stringify(settings);
      if (serialized === lastObservedAppSettingsJson) return;
      void notifyAppSettingsChanged(settings);
    });
  });
  return () => fs.unwatchFile(filePath);
}

// READ handler
ipcMain.handle('walletStorage:read', async (_event, fileName: string) => {
  try {
    const filePath = await getSharedSettingsFilePath(fileName);

    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) return null;

    return fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    loggerError(`Error in walletStorage:read for "${fileName}"`, err);
    return null;
  }
});

// WRITE handler
ipcMain.handle(
  'walletStorage:write',
  async (_event, fileName: string, contents: string) => {
    try {
      const filePath = await getSharedSettingsFilePath(fileName);

      await fs.promises.writeFile(filePath, contents, 'utf-8');
      return true;
    } catch (err) {
      loggerError(`Error in walletStorage:write for "${fileName}"`, err);
      throw err;
    }
  }
);

// Persistent store: shared across instances via atomic writes to appData/qortal-hub/
// Uses write-file-atomic to prevent partial writes corrupting the file.
// On set/delete: read-from-disk → merge → atomic write, so concurrent instances
// never overwrite each other's keys (only a simultaneous write of the *same* key
// by two instances at the exact same moment could still race, which is acceptable).

let persistentStoreCache: Record<string, unknown> | null = null;
let persistentStoreLoadedFromDisk = false;

function getPersistentStoreFilePath(): string {
  const dir = path.join(app.getPath('appData'), 'qortal-hub');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, PERSISTENT_STORE_FILENAME);
}

async function readPersistentStoreFromDisk(): Promise<Record<string, unknown>> {
  try {
    const filePath = getPersistentStoreFilePath();
    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats?.isFile()) return {};
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return parsePersistentStoreRaw(raw);
  } catch (err) {
    loggerError('Error reading persistent store from disk', err);
    return {};
  }
}

async function loadPersistentStore(): Promise<Record<string, unknown>> {
  if (persistentStoreCache !== null) return persistentStoreCache;
  const data = await readPersistentStoreFromDisk();
  const hadData = Object.keys(data).length > 0;
  persistentStoreCache = data;
  if (hadData) persistentStoreLoadedFromDisk = true;
  return persistentStoreCache;
}

// App settings (stored in SharedSettingsFilePath) - e.g. close/minimize to tray
ipcMain.handle('appSettings:get', async () => {
  return readAppSettings();
});

ipcMain.handle(
  'appSettings:set',
  async (_event, partial: Partial<AppSettings>) => {
    const current = await readAppSettings();
    const autoLockTimeoutMinutes = normalizeAutoLockTimeoutMinutes(
      partial.autoLockTimeoutMinutes ??
        (partial.disableAutoLockOnIdle == null
          ? current.autoLockTimeoutMinutes
          : partial.disableAutoLockOnIdle
            ? 0
            : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES)
    );
    const next: AppSettings = {
      ...current,
      ...partial,
      autoLockTimeoutMinutes,
      disableAutoLockOnIdle: autoLockTimeoutMinutes === 0,
      reticulumResourceLimitBytes: Math.max(
        RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        Math.min(
          100 * 1024 * 1024 * 1024,
          Math.floor(
            Number(
              partial.reticulumResourceLimitBytes ??
                current.reticulumResourceLimitBytes
            ) || RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES
          )
        )
      ),
      ...(isDisabledLegacy
        ? {
            p2pEnabled: false,
            legacyPublicStunFallback: false,
          }
        : {}),
    };
    await writeAppSettings(next);
    await notifyAppSettingsChanged(next);
    if (reticulumResourceStore) {
      reticulumResourceStore.setStoragePolicy({
        limitBytes:
          Number(next.reticulumResourceLimitBytes) ||
          RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES,
      });
    }
    return next;
  }
);

ipcMain.handle('hub:getIceServers', async () => {
  const c = getStunCoordinator();
  if (!c) return [];
  return await new Promise<{ urls: string }[]>((resolve, reject) => {
    const slots: { immediate?: ReturnType<typeof setImmediate> } = {};
    const timeoutId = setTimeout(() => {
      const im = slots.immediate;
      if (im !== undefined) {
        clearImmediate(im);
      }
      loggerLog(
        '[STUN][telemetry] getIceServers ipc deadline — returning last snapshot'
      );
      resolve(c.peekLastServedIceServers());
    }, GET_ICE_SERVERS_DEADLINE_MS);

    slots.immediate = setImmediate(() => {
      try {
        const list = c.getIceServersForRenderer();
        clearTimeout(timeoutId);
        resolve(list);
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  });
});

ipcMain.handle(
  'hub:reportStunCallOutcome',
  async (_event, urls: unknown, success: unknown) => {
    const c = getStunCoordinator();
    if (!c) return { ok: false };
    if (!Array.isArray(urls)) return { ok: false };
    const u = urls.filter((x): x is string => typeof x === 'string');
    c.recordCallStunBundleOutcome(u, success === true);
    loggerLog('[STUN][telemetry] call bundle outcome', {
      urls: u.length,
      success: success === true,
    });
    return { ok: true };
  }
);

ipcMain.handle(
  'hub:reportObservedStunSources',
  async (_event, urls: unknown) => {
    const c = getStunCoordinator();
    if (!c) return { ok: false };
    if (!Array.isArray(urls)) return { ok: false };
    const u = urls.filter((x): x is string => typeof x === 'string');
    c.recordObservedStunSources(u);
    return { ok: true };
  }
);

// Handler for initiating a streaming file save
ipcMain.handle(
  'file:startStreamSave',
  async (_event, options: { filename: string; mimeType?: string }) => {
    try {
      // Show save dialog
      const result = await dialog.showSaveDialog({
        defaultPath: options.filename,
        filters: options.mimeType
          ? [
              {
                name: 'File',
                extensions: [options.filename.split('.').pop() || '*'],
              },
            ]
          : undefined,
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      return {
        canceled: false,
        filePath: result.filePath,
      };
    } catch (err) {
      loggerError('Error in file:startStreamSave', err);
      throw err;
    }
  }
);

// Handler for writing chunks to a file
ipcMain.handle(
  'file:writeChunk',
  async (_event, filePath: string, chunk: Uint8Array, append: boolean) => {
    try {
      const buffer = Buffer.from(chunk);
      const mode = append ? 'append' : 'write';
      loggerLog(
        `[IPC] Writing chunk to ${filePath}: ${buffer.length} bytes (${mode} mode)`
      );

      if (append) {
        await fs.promises.appendFile(filePath, buffer);
      } else {
        await fs.promises.writeFile(filePath, buffer);
      }

      // Get file size after write to verify
      const stats = await fs.promises.stat(filePath);
      loggerLog(`[IPC] File size after write: ${stats.size} bytes`);

      return true;
    } catch (err) {
      loggerError('[IPC] Error writing chunk to', filePath, ':', err);
      throw err;
    }
  }
);

// Handler for cleaning up failed downloads
ipcMain.handle('file:deleteFile', async (_event, filePath: string) => {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    loggerError('Error deleting file', filePath, err);
    // Don't throw - file might not exist
    return false;
  }
});

const progressSubscribers = new Set<Electron.WebContents>();

ipcMain.on('coreSetup:progress:subscribe', (e) => {
  const wc = e.sender;
  progressSubscribers.add(wc);
  broadcastProgress('ready');
  broadcastProgress({
    type: 'osType',
    osType: process.platform,
  });
  wc.once('destroyed', () => progressSubscribers.delete(wc));
});

ipcMain.on('coreSetup:progress:unsubscribe', (e) => {
  progressSubscribers.delete(e.sender);
});

export function broadcastProgress(p: any) {
  for (const wc of progressSubscribers) {
    if (!wc.isDestroyed()) {
      wc.send('coreSetup:progress', p);
    }
  }
}

ipcMain.handle('coreSetup:isCoreRunning', async () => {
  try {
    try {
      const customPath = await customQortalInstalledDir();
      if (!customPath) {
        broadcastProgress({
          type: 'hasCustomPath',
          hasCustomPath: false,
          customPath: null,
        });
      } else {
        const isInstalledWithCustomPath = await isCoreInstalled();
        if (isInstalledWithCustomPath) {
          broadcastProgress({
            type: 'hasCustomPath',
            hasCustomPath: true,
            customPath,
          });
        } else {
          await removeCustomQortalPath();
          broadcastProgress({
            type: 'hasCustomPath',
            hasCustomPath: false,
            customPath: null,
          });
        }
      }
    } catch (error) {
      loggerError(error);
    }
    const running = await isCoreRunning();
    if (running) {
      broadcastProgress({
        step: 'coreRunning',
        status: 'done',
        progress: 100,
        message: '',
      });
      broadcastProgress({
        step: 'downloadedCore',
        status: 'done',
        progress: 100,
        message: '',
      });
      broadcastProgress({
        step: 'hasJava',
        status: 'done',
        progress: 100,
        message: '',
      });
    } else {
      const javaVersion = await determineJavaVersion();
      const hasCore = await isCoreInstalled();
      if (javaVersion != false) {
        broadcastProgress({
          step: 'hasJava',
          status: 'done',
          progress: 100,
          message: '',
        });
      } else {
        broadcastProgress({
          step: 'hasJava',
          status: 'off',
          progress: 0,
          message: '',
        });
      }
      broadcastProgress({
        step: 'coreRunning',
        status: 'off',
        progress: 0,
        message: '',
      });
      if (hasCore) {
        broadcastProgress({
          step: 'downloadedCore',
          status: 'done',
          progress: 100,
          message: '',
        });
      } else {
        broadcastProgress({
          step: 'downloadedCore',
          status: 'off',
          progress: 0,
          message: '',
        });
      }
    }
    return running;
  } catch (error) {}
});

ipcMain.handle('coreSetup:isCoreRunningOnSystem', async () => {
  try {
    const running = await isCoreRunning(true);

    return running;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('coreSetup:verifySteps', async () => {
  try {
    const javaVersion = await determineJavaVersion();
    if (javaVersion != false) {
      broadcastProgress({
        step: 'hasJava',
        status: 'done',
        progress: 100,
        message: '',
      });
    }
    const hasCore = await isCoreInstalled();
    if (hasCore) {
      broadcastProgress({
        step: 'downloadedCore',
        status: 'done',
        progress: 100,
        message: '',
      });
    }

    const running = await isCorePortRunning();
    if (running) {
      broadcastProgress({
        step: 'coreRunning',
        status: 'done',
        progress: 100,
        message: '',
      });
    }
  } catch (error) {}
});

ipcMain.handle('coreSetup:isCoreInstalled', async () => {
  try {
    const isInstalled = await isCoreInstalled();
    if (isInstalled) {
      broadcastProgress({
        step: 'downloadedCore',
        status: 'done',
        progress: 100,
        message: '',
      });
    } else {
      broadcastProgress({
        step: 'downloadedCore',
        status: 'off',
        progress: 0,
        message: '',
      });
    }
    return isInstalled;
  } catch (error) {}
});

ipcMain.handle('coreSetup:isCoreInstalledOnSystem', async () => {
  try {
    const isInstalled = await isCoreInstalled();

    return isInstalled;
  } catch (error) {}
});

ipcMain.handle('coreSetup:installCore', async (event) => {
  try {
    const isInstalled = await isCoreInstalled();
    const isRunning = await isCoreRunning();
    if (isInstalled) {
      broadcastProgress({
        step: 'downloadedCore',
        status: 'done',
        progress: 100,
        message: '',
      });
    }
    if (isRunning) {
      broadcastProgress({
        step: 'coreRunning',
        status: 'done',
        progress: 100,
        message: '',
      });
    }

    if (isInstalled) return true;
    const wc = event.sender;

    const sendProgress = (p) => {
      wc.send('coreSetup:progress', { step: 'download', ...p });
    };
    const running = await installCore(sendProgress);
    return running;
  } catch (error) {
    loggerError('Failed to install Qortal Core:', error);
    broadcastProgress({
      step: 'downloadedCore',
      status: 'error',
      progress: 0,
      message: '010',
    });
    return false;
  }
});

ipcMain.handle('coreSetup:startCore', async () => {
  try {
    const running = await startCore();
    return running;
  } catch (error) {}
});

ipcMain.handle('coreSetup:deleteDB', async () => {
  try {
    const isDeleted = await deleteDB();
    return isDeleted;
  } catch (error) {}
});

ipcMain.handle('coreSetup:dbExists', async () => {
  try {
    const isDeleted = await dbExists();
    return isDeleted;
  } catch (error) {}
});

ipcMain.handle('coreSetup:getApiKey', async () => {
  try {
    const running = await getApiKey();
    return running;
  } catch (error) {}
});

ipcMain.handle(
  'cert:ensureForBase',
  async (_event, baseUrl: string, apiKey?: string) => {
    const result = await ensureCertForBase(baseUrl, apiKey);
    if (result.success) {
      setLocalNodeHttpsReady(true);
      session.defaultSession.clearCache().catch(() => {});
      const win = myCapacitorApp.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.session.clearCache().catch(() => {});
      }
    }
    return result;
  }
);
ipcMain.handle('coreSetup:resetApikey', async () => {
  try {
    const running = await resetApikey();
    return running;
  } catch (error) {}
});
ipcMain.handle('coreSetup:removeCustomPath', async () => {
  try {
    await removeCustomQortalPath();
    broadcastProgress({
      type: 'hasCustomPath',
      hasCustomPath: false,
      customPath: null,
    });
  } catch (error) {}
});
ipcMain.handle('coreSetup:stopCore', async () => {
  try {
    return await stopCore();
  } catch (error) {
    loggerError('error', error);
  }
});
ipcMain.handle('coreSetup:bootstrap', async () => {
  try {
    return await bootstrap();
  } catch (error) {
    loggerError('error', error);
  }
});

ipcMain.handle('coreSetup:bootstrapOrClearChainAndStart', async () => {
  try {
    return await bootstrapOrClearChainAndStart();
  } catch (error) {
    loggerError('error', error);
  }
});

ipcMain.handle('coreSetup:pickQortalDirectory', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    const dir = filePaths[0];
    const isInstalled = await isCoreInstalled(dir);
    if (isInstalled) {
      const filePath = await getSharedSettingsFilePath('wallet-storage.json');

      const raw = await fs.promises
        .readFile(filePath, 'utf-8')
        .catch(() => null);
      const data = raw ? JSON.parse(raw) : {};
      data['qortalDirectory'] = dir;
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
      broadcastProgress({
        type: 'hasCustomPath',
        hasCustomPath: true,
        customPath: dir,
      });
    } else return false;
  } catch (error) {
    return false;
  }
});

// Video Server IPC Handlers
ipcMain.handle('videoServer:start', async (_event, port?: number) => {
  try {
    const serverPort = await startVideoServer(port);
    return { success: true, port: serverPort };
  } catch (error) {
    loggerError('Failed to start video server:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('videoServer:stop', async () => {
  try {
    await stopVideoServer();
    return { success: true };
  } catch (error) {
    loggerError('Failed to stop video server:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('videoServer:getPort', async () => {
  return getVideoServerPort();
});

ipcMain.handle('videoServer:isRunning', async () => {
  return isVideoServerRunning();
});

// ── P2P Network IPC Handlers ─────────────────────────────────────────────────

const p2pMessageSubscribers = new Set<Electron.WebContents>();
const p2pPeerChangeSubscribers = new Set<Electron.WebContents>();

function broadcastToSet(
  subscribers: Set<Electron.WebContents>,
  channel: string,
  payload: unknown
): void {
  for (const wc of subscribers) {
    if (sendToRenderer(wc, channel, payload) === 'destroyed') {
      subscribers.delete(wc);
    }
  }
}

const PRESENCE_MAIN_HEARTBEAT_INTERVAL_MS = 25_000;
let presenceMainHeartbeatTimer: NodeJS.Timeout | null = null;

function stopPresenceMainHeartbeatScheduler(): void {
  if (presenceMainHeartbeatTimer) {
    clearInterval(presenceMainHeartbeatTimer);
    presenceMainHeartbeatTimer = null;
    loggerLog('[Presence] Main heartbeat scheduler stopped');
  }
  getReticulumBridge()
    ?.clearPresenceCache('heartbeat_scheduler_stopped')
    .catch((err) => {
      loggerWarn('[Presence] Failed to clear Reticulum presence cache:', err);
    });
}

function sendPresenceMainHeartbeatRequest(): void {
  const mainWindow = myCapacitorApp.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    stopPresenceMainHeartbeatScheduler();
    return;
  }
  if (!isRendererMainFrameReady(mainWindow.webContents)) return;
  loggerLog('[Presence] Main heartbeat scheduler tick');
  sendToRenderer(mainWindow.webContents, 'presence:heartbeat-request');
}

function startPresenceMainHeartbeatScheduler(): void {
  if (presenceMainHeartbeatTimer) return;
  presenceMainHeartbeatTimer = setInterval(
    sendPresenceMainHeartbeatRequest,
    PRESENCE_MAIN_HEARTBEAT_INTERVAL_MS
  );
  loggerLog('[Presence] Main heartbeat scheduler started interval_ms=25000');
}

export function notifyPresenceTransportReady(): void {
  broadcastToSet(presenceUpdateSubscribers, 'presence:started', {});
}

/** Stores the options used when P2P was last started so the IPC toggle can
 *  restart with the same ports, seeds, etc. */
let lastP2POptions: P2PNetworkOptions = {};

export function setLastP2POptions(opts: P2PNetworkOptions): void {
  lastP2POptions = opts;
}

export function attachP2PListeners(
  network: ReturnType<typeof getP2PNetwork>
): void {
  if (!network) return;
  network.on('message', (payload) =>
    broadcastToSet(p2pMessageSubscribers, 'p2p:message', payload)
  );
  network.on('peer-connected', (payload) =>
    broadcastToSet(p2pPeerChangeSubscribers, 'p2p:peerChange', {
      type: 'connected',
      ...payload,
    })
  );
  network.on('peer-disconnected', (payload) =>
    broadcastToSet(p2pPeerChangeSubscribers, 'p2p:peerChange', {
      type: 'disconnected',
      ...payload,
    })
  );
}

/** Start decentralized STUN (UDP server, probes, cache) after P2P is up. */
export async function startDecentralizedStunAfterP2P(
  network: NonNullable<ReturnType<typeof getP2PNetwork>>,
  opts: P2PNetworkOptions
): Promise<void> {
  // Compatibility entry point for the disabled TLS P2P stack. Community STUN
  // now starts with the Reticulum bridge so discovery never inherits a normal
  // P2P/presence identity or peer address.
  void network;
  void opts;
}

async function startReticulumManagers(): Promise<void> {
  const lifecycleGeneration = getReticulumRuntimeGeneration();
  const globalSettings = await readAppSettings();
  if (
    globalSettings.reticulumEnabled === false ||
    !isReticulumRuntimeEnabled()
  ) {
    throw new Error('Reticulum is disabled');
  }
  let bridgeTransport = getReticulumBridge();
  if (bridgeTransport) {
    try {
      await bridgeTransport.start();
    } catch (err) {
      loggerError('[ReticulumBridge] Failed to finish startup:', err);
      registerLateReticulumBridgeRecovery();
    }
  } else {
    try {
      bridgeTransport = await startReticulumBridge();
    } catch (err) {
      loggerError('[ReticulumBridge] Failed to start:', err);
      bridgeTransport = getReticulumBridge();
      if (bridgeTransport) {
        registerLateReticulumBridgeRecovery();
      }
    }
  }

  const latestGlobalSettings = await readAppSettings();
  if (
    latestGlobalSettings.reticulumEnabled === false ||
    !isReticulumRuntimeEnabled() ||
    lifecycleGeneration !== getReticulumRuntimeGeneration()
  ) {
    throw new Error('Reticulum was disabled during startup');
  }

  if (bridgeTransport && bridgeTransport.getState() !== 'ready') {
    registerLateReticulumBridgeRecovery();
  }
  attachReticulumStatusBridgeEvents(bridgeTransport);

  if (bridgeTransport) {
    const stunPath = join(
      app.getPath('appData'),
      'qortal-shared',
      'stun-cache.db'
    );
    await startStunCoordinator(bridgeTransport, {
      stunCacheDbPath: stunPath,
      contributionEnabled:
        latestGlobalSettings.communityStunContributionEnabled !== false,
    });
  }

  await registerReticulumResourceProtocol();
  if (
    !isReticulumRuntimeEnabled() ||
    lifecycleGeneration !== getReticulumRuntimeGeneration()
  ) {
    if (!isReticulumRuntimeEnabled()) {
      shutdownReticulumResourceStore();
      attachReticulumStatusBridgeEvents(null);
    }
    throw new Error('Reticulum was disabled during startup');
  }

  const appSettings = await readAppSettings();
  if (
    appSettings.reticulumEnabled === false ||
    !isReticulumRuntimeEnabled() ||
    lifecycleGeneration !== getReticulumRuntimeGeneration()
  ) {
    if (!isReticulumRuntimeEnabled()) {
      shutdownReticulumResourceStore();
      attachReticulumStatusBridgeEvents(null);
    }
    throw new Error('Reticulum was disabled during startup');
  }

  let pm = getPresenceManager();
  const transports = bridgeTransport ? [bridgeTransport] : [];
  if (pm) {
    setPresenceManagerTransports(transports);
    void syncReticulumOverlayStateToBridge(pm);
  } else {
    pm = startPresenceManager(transports);
    attachPresenceListeners(pm);
  }
  const resourceStore = getReticulumResourceStore();
  resourceStore.setStoragePolicy({
    limitBytes:
      Number(appSettings.reticulumResourceLimitBytes) ||
      RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES,
  });
  const reticulumChat = startReticulumChatManager(
    bridgeTransport ?? null,
    undefined,
    {
      signLocalFields: signReticulumChatControlFields,
      validateGroupMember: validateQortalGroupMember,
      validateGroupAdmin: validateQortalGroupAdmin,
      getVerifiedReticulumPeers: () =>
        getPresenceManager()?.getReticulumVerifiedTransportPeers() ?? [],
      getAccountEndpointLeases: () =>
        getPresenceManager()?.getReticulumAccountEndpointLeases() ?? [],
      hasGoodOverlayHealth: () => {
        const manager = getPresenceManager();
        if (!manager) return false;
        return (
          manager.getReticulumActiveNeighborHashes().length > 0 ||
          manager.getReticulumVerifiedTransportPeers().length > 0
        );
      },
      resourceStore,
    }
  );
  attachReticulumChatListeners(reticulumChat);
  startReticulumOverlayMaintenanceSync();

  const callMgr = getCallManager();
  if (callMgr) {
    callMgr.setReticulumBridge(bridgeTransport);
  } else {
    const startedCallMgr = startCallManager(pm, bridgeTransport);
    attachCallListeners(startedCallMgr);
  }

  const gcallMgr = getGroupCallManager();
  if (gcallMgr) {
    gcallMgr.setReticulumBridge(bridgeTransport);
  } else {
    const startedGcallMgr = startGroupCallManager(pm, bridgeTransport);
    attachGroupCallListeners(startedGcallMgr);
  }

  stopReticulumMeshCoordinator();
  startReticulumMeshCoordinator(getReticulumBridge());
}

const reticulumChatReadiness = new SingleFlightReadiness({
  isReady: () => Boolean(getReticulumChatManager()),
  onStatusChange: notifyReticulumChatReadinessChanged,
  start: startReticulumManagers,
});

export function getReticulumChatReadinessStatus(): ReadinessStatus {
  return reticulumChatReadiness.getStatus();
}

export function ensureReticulumManagersStarted(): Promise<void> {
  return reticulumChatReadiness.ensureReady();
}

export function stopReticulumManagers(): void {
  invalidateReticulumRuntimeGeneration();
  clearLateReticulumBridgeRecovery();
  reticulumOverlaySyncSequence += 1;
  reticulumOverlaySyncPending = false;
  if (reticulumOverlaySyncRetryTimer) {
    clearTimeout(reticulumOverlaySyncRetryTimer);
    reticulumOverlaySyncRetryTimer = null;
  }
  if (reticulumOverlayMaintenanceTimer) {
    clearInterval(reticulumOverlayMaintenanceTimer);
    reticulumOverlayMaintenanceTimer = null;
  }
  if (reticulumChatSubscriptionReplayTimer) {
    clearTimeout(reticulumChatSubscriptionReplayTimer);
    reticulumChatSubscriptionReplayTimer = null;
  }
  stopPresenceMainHeartbeatScheduler();
  stopStunCoordinator();
  stopReticulumMeshCoordinator();
  stopGroupCallManager();
  stopCallManager();
  stopReticulumChatManager();
  reticulumChatListenersAttached = false;
  stopPresenceManager();
  privateChannelManager?.destroy();
  privateChannelManager = null;
  qAppMoqTransportManager?.destroy();
  qAppMoqTransportManager = null;
  void shutdownPrivateTransportSidecar();
  qAppReticulumManager?.destroy();
  qAppReticulumManager = null;
  shutdownReticulumResourceStore();
  attachReticulumStatusBridgeEvents(null);
  reticulumChatReadiness.reset();
}

let qAppReticulumManager: QAppReticulumManager | null = null;
let privateChannelManager: PrivateChannelManager | null = null;
let qAppMoqTransportManager: QAppMoqTransportManager | null = null;
let qAppReticulumBridge: ReturnType<typeof getReticulumBridge> = null;
const qAppReticulumNativeListeners = new Set<
  (event: QAppReticulumNativeEvent) => void
>();

function getQAppReticulumManager(): QAppReticulumManager {
  if (qAppReticulumManager) return qAppReticulumManager;
  const transport = {
    invoke: async (action: string, payload: Record<string, unknown>) => {
      await ensureReticulumManagersStarted();
      const bridge = getReticulumBridge() ?? (await startReticulumBridge());
      if (qAppReticulumBridge !== bridge) {
        qAppReticulumBridge = bridge;
        bridge.on('qapp-rns', (event: QAppReticulumNativeEvent) => {
          for (const listener of qAppReticulumNativeListeners) listener(event);
        });
      }
      return bridge.invokeQAppReticulum(action as any, payload);
    },
    onEvent: (listener: (event: QAppReticulumNativeEvent) => void) => {
      qAppReticulumNativeListeners.add(listener);
      return () => qAppReticulumNativeListeners.delete(listener);
    },
  };
  qAppReticulumManager = new QAppReticulumManager(transport);
  qAppReticulumManager.on('event', (event) => {
    const win = myCapacitorApp.getMainWindow();
    if (!win.isDestroyed()) win.webContents.send('qappReticulum:event', event);
  });
  return qAppReticulumManager;
}

function getPrivateChannelManager(): PrivateChannelManager {
  configureRelaySigner(
    signReticulumChatControlFields,
    readRelayWalletAddress,
    readRelayGroupHints
  );
  if (privateChannelManager) return privateChannelManager;
  privateChannelManager = new PrivateChannelManager(
    (owner, connectionId) =>
      getQAppReticulumManager().connectionOwnership(owner, connectionId),
    getPrivateTransportFactory(getQAppReticulumManager(), () =>
      getReticulumBridge()
    )
  );
  privateChannelManager.on('event', (event) => {
    const win = myCapacitorApp.getMainWindow();
    if (!win.isDestroyed()) win.webContents.send('privateChannel:event', event);
  });
  return privateChannelManager;
}

function getQAppMoqTransportManager(): QAppMoqTransportManager {
  configureRelaySigner(
    signReticulumChatControlFields,
    readRelayWalletAddress,
    readRelayGroupHints
  );
  if (qAppMoqTransportManager) return qAppMoqTransportManager;
  qAppMoqTransportManager = new QAppMoqTransportManager(
    (owner, connectionId) =>
      getQAppReticulumManager().connectionOwnership(owner, connectionId),
    (emit) =>
      createMoqTransport(emit, getQAppReticulumManager(), () =>
        getReticulumBridge()
      )
  );
  qAppMoqTransportManager.on('event', (event) => {
    const win = myCapacitorApp.getMainWindow();
    if (!win.isDestroyed()) win.webContents.send('qappMoq:event', event);
  });
  return qAppMoqTransportManager;
}

function validateQAppReticulumIpcSender(
  event: Electron.IpcMainInvokeEvent
): void {
  const win = myCapacitorApp.getMainWindow();
  if (win.isDestroyed() || event.sender.id !== win.webContents.id) {
    throw new Error('RNS_PERMISSION_DENIED');
  }
}

let qappFileSaves: QAppFileSaves;
function fileSaves() {
  return (qappFileSaves ??= new QAppFileSaves(join(app.getPath('userData'), 'file-save-journal')));
}
void app.whenReady().then(() => fileSaves().initialize()).catch(() => undefined);
function saveOwner(owner: any) {
  if (!owner || !['tabId', 'name', 'service'].every(key =>
    typeof owner[key] === 'string' && owner[key].length > 0 && owner[key].length <= 256))
    throw new SaveError('SAVE_INVALID_REQUEST');
  return JSON.stringify([owner.tabId, owner.name, owner.service]);
}
ipcMain.handle('qappFileSave:request', async (event, owner, request) => {
  if (!isMainShellSender(event.sender) || event.senderFrame !== event.sender.mainFrame)
    return { error: 'SAVE_PERMISSION_DENIED' };
  try {
    const key = saveOwner(owner);
    const manager = fileSaves();
    switch (request?.action) {
      case 'FILE_SAVE_OPEN':
        return await manager.open(key, request.filename, request.size, async (filename, _size, checkLive) => {
          const labels = request.labels;
          if (!labels || !['title', 'detail', 'allow', 'cancel'].every(k =>
            typeof labels[k] === 'string' && labels[k].length <= 2048))
            throw new SaveError('SAVE_INVALID_REQUEST');
          const win = myCapacitorApp.getMainWindow();
          const permission = await dialog.showMessageBox(win, {
            type: 'question', message: labels.title, detail: labels.detail,
            buttons: [labels.cancel, labels.allow], defaultId: 0, cancelId: 0,
            noLink: true,
          });
          if (permission.response !== 1) return undefined;
          checkLive();
          const result = await dialog.showSaveDialog(win, {
            defaultPath: filename, title: labels.title,
            properties: ['showOverwriteConfirmation', 'createDirectory'],
          });
          return result.canceled ? undefined : result.filePath;
        });
      case 'FILE_SAVE_WRITE': return await manager.write(key, request.saveId, request.offset, request.data);
      case 'FILE_SAVE_FINISH': return await manager.finish(key, request.saveId);
      case 'FILE_SAVE_ABORT': return await manager.abort(key, request.saveId);
      case 'FILE_SAVE_CLEANUP': await manager.cleanup(key); return { aborted: true };
      default: throw new SaveError('SAVE_INVALID_REQUEST');
    }
  } catch (error) {
    // Never expose OS errors containing filesystem paths to a QApp.
    return { error: error instanceof SaveError ? error.message : 'SAVE_IO_ERROR' };
  }
});
setInterval(() => { void qappFileSaves?.expire(); }, 30_000).unref();
app.on('before-quit', () => { void qappFileSaves?.cleanup(); });
app.on('web-contents-created', (_event, contents) => {
  const cleanup = () => { if (isMainShellSender(contents)) void qappFileSaves?.cleanup(); };
  contents.on('render-process-gone', cleanup);
  contents.on('destroyed', cleanup);
  contents.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) cleanup();
  });
});

async function cleanupQAppOwner(owner: QAppReticulumOwner): Promise<void> {
  // All managers snapshot their old resources before any shutdown is awaited.
  await Promise.allSettled([
    privateChannelManager?.cleanupOwner(owner),
    qAppMoqTransportManager?.cleanupOwner(owner),
    qAppReticulumManager?.cleanupOwner(owner),
    qappFileSaves?.cleanup(saveOwner(owner)),
  ]);
}

type PreparedQAppGuest = {
  owner: QAppGuestOwner;
  url: string;
  partition: string;
  isDevMode: boolean;
  guestToken: string;
  preloadTokenUrl: string;
};
const preparedQAppGuests = new Map<string, PreparedQAppGuest>();
const attachedQAppGuests = new Map<number, { contents: WebContents; prepared: PreparedQAppGuest | null }>();
const configuredQAppSessions = new Set<string>();
const qappGuestPreloadPath = join(__dirname, 'qapp-guest-preload.js');

function qappGuestOwnerKey(owner: QAppGuestOwner): string {
  return `${owner.tabId}\u0000${owner.service}\u0000${owner.name}`;
}

function configureQAppGuestSession(partition: string): void {
  if (configuredQAppSessions.has(partition)) return;
  const guestSession = session.fromPartition(partition);
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme(), guestSession);
  installCertificateVerification(guestSession);
  installLocalNodeHttpsBlock(guestSession);
  installDisplayMediaPicker(
    myCapacitorApp.getMainWindow(),
    process.platform,
    guestSession,
    (contents) => Boolean(attachedQAppGuests.get(contents.id)?.prepared)
  );
  configuredQAppSessions.add(partition);
}

ipcMain.handle('qappGuest:prepare', (event, owner: QAppGuestOwner, url: string, isDevMode: boolean) => {
  validateQAppReticulumIpcSender(event);
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('QAPP_PERMISSION_DENIED');
  saveOwner(owner);
  if (typeof url !== 'string' || url.length > 4096) throw new Error('QAPP_INVALID_URL');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('QAPP_INVALID_URL');
  if (!qappGuestUrlAllowed(url, url, owner, isDevMode === true)) throw new Error('QAPP_INVALID_URL');
  const guestToken = randomUUID();
  const prepared = {
    owner,
    url,
    partition: qappGuestPartition(parsed.origin, owner),
    isDevMode: isDevMode === true,
    guestToken,
    preloadTokenUrl: `${pathToFileURL(qappGuestPreloadPath).toString()}?authorization=${guestToken}`,
  };
  configureQAppGuestSession(prepared.partition);
  preparedQAppGuests.set(qappGuestOwnerKey(owner), prepared);
  return {
    partition: prepared.partition,
    preload: prepared.preloadTokenUrl,
  };
});

ipcMain.handle('qappGuest:hello', (event, guestToken: string) => {
  if (event.sender.getType() !== 'webview' ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof guestToken !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(guestToken))
    throw new Error('QAPP_PERMISSION_DENIED');
  const prepared = [...preparedQAppGuests.values()].find(
    (candidate) => candidate.guestToken === guestToken
  );
  const attached = attachedQAppGuests.get(event.sender.id);
  if (!prepared || !attached ||
      (attached.prepared && attached.prepared !== prepared))
    throw new Error('QAPP_GUEST_UNAVAILABLE');
  if (attached.contents.session !== session.fromPartition(prepared.partition))
    throw new Error('QAPP_GUEST_MISMATCH');
  const currentUrl = attached.contents.getURL();
  if (!qappGuestUrlAllowed(
    prepared.url,
    !currentUrl || currentUrl === 'about:blank' ? prepared.url : currentUrl,
    prepared.owner,
    prepared.isDevMode
  ))
    throw new Error('QAPP_GUEST_MISMATCH');
  attached.prepared = prepared;
  return true;
});

ipcMain.handle('qappGuest:release', (event, owner: QAppGuestOwner) => {
  validateQAppReticulumIpcSender(event);
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('QAPP_PERMISSION_DENIED');
  const key = qappGuestOwnerKey(owner);
  preparedQAppGuests.delete(key);
  for (const [guestId, attached] of attachedQAppGuests) {
    if (!attached.prepared || qappGuestOwnerKey(attached.prepared.owner) !== key)
      continue;
    attachedQAppGuests.delete(guestId);
  }
  void cleanupQAppOwner(owner);
  return true;
});
ipcMain.handle(
  'qappReticulum:request',
  async (event, owner: QAppReticulumOwner, options) => {
    validateQAppReticulumIpcSender(event);
    return getQAppReticulumManager().request(owner, options);
  }
);
ipcMain.handle(
  'qappReticulum:connect',
  async (event, owner: QAppReticulumOwner, destination: string) => {
    validateQAppReticulumIpcSender(event);
    return getQAppReticulumManager().connect(owner, destination);
  }
);
ipcMain.handle(
  'qappReticulum:send',
  async (event, owner: QAppReticulumOwner, connectionId: string, payload) => {
    validateQAppReticulumIpcSender(event);
    return getQAppReticulumManager().send(owner, connectionId, payload);
  }
);
ipcMain.handle(
  'qappReticulum:close',
  async (event, owner: QAppReticulumOwner, connectionId: string) => {
    validateQAppReticulumIpcSender(event);
    await privateChannelManager?.cleanupRnsConnection(owner, connectionId);
    await qAppMoqTransportManager?.cleanupRnsConnection(owner, connectionId);
    await getQAppReticulumManager().close(owner, connectionId);
    return true;
  }
);
ipcMain.handle(
  'qappReticulum:cleanupOwner',
  async (event, owner: QAppReticulumOwner) => {
    validateQAppReticulumIpcSender(event);
    await cleanupQAppOwner(owner);
    return true;
  }
);

async function qAppMoqIpcResult<T>(
  operation: () => Promise<T> | T
): Promise<
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    const code = error instanceof QAppMoqError ? error.code : 'MOQ_ERROR';
    return { ok: false, error: { code, message: code } };
  }
}

ipcMain.handle(
  'qappMoq:open',
  async (
    event,
    owner: QAppReticulumOwner,
    rnsConnectionId: unknown,
    publicationNamespace: unknown,
    publicationTrack: unknown
  ) => {
    validatePrivateChannelIpcSender(event);
    return qAppMoqIpcResult(() =>
      getQAppMoqTransportManager().open(
        owner,
        rnsConnectionId,
        publicationNamespace,
        publicationTrack
      )
    );
  }
);
ipcMain.handle(
  'qappMoq:subscribe',
  async (
    event,
    owner: QAppReticulumOwner,
    sessionId: unknown,
    subscriptionId: unknown,
    namespace: unknown,
    trackName: unknown
  ) => {
    validatePrivateChannelIpcSender(event);
    return qAppMoqIpcResult(() =>
      getQAppMoqTransportManager().subscribe(
        owner,
        sessionId,
        subscriptionId,
        namespace,
        trackName
      )
    );
  }
);
ipcMain.handle(
  'qappMoq:publish',
  async (
    event,
    owner: QAppReticulumOwner,
    sessionId: unknown,
    payload: unknown
  ) => {
    validatePrivateChannelIpcSender(event);
    return qAppMoqIpcResult(() =>
      getQAppMoqTransportManager().publish(owner, sessionId, payload)
    );
  }
);
ipcMain.handle(
  'qappMoq:metrics',
  (event, owner: QAppReticulumOwner, sessionId: unknown) => {
    validatePrivateChannelIpcSender(event);
    return qAppMoqIpcResult(() =>
      getQAppMoqTransportManager().metrics(owner, sessionId)
    );
  }
);
ipcMain.handle(
  'qappMoq:close',
  async (event, owner: QAppReticulumOwner, sessionId: unknown) => {
    validatePrivateChannelIpcSender(event);
    return qAppMoqIpcResult(() =>
      getQAppMoqTransportManager().close(owner, sessionId)
    );
  }
);
ipcMain.handle(
  'qappMoq:cleanupOwner',
  async (event, owner: QAppReticulumOwner) => {
    validatePrivateChannelIpcSender(event);
    return qAppMoqIpcResult(async () => {
      await qAppMoqTransportManager?.cleanupOwner(owner);
      return true;
    });
  }
);

function validatePrivateChannelIpcSender(
  event: Electron.IpcMainInvokeEvent
): void {
  const win = myCapacitorApp.getMainWindow();
  if (win.isDestroyed() || event.sender.id !== win.webContents.id) {
    throw new Error('PERMISSION_DENIED');
  }
}

async function privateChannelIpcResult<T>(
  operation: () => Promise<T> | T
): Promise<
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    const code =
      error instanceof PrivateChannelError
        ? error.code
        : 'PRIVATE_CHANNEL_ERROR';
    return { ok: false, error: { code, message: code } };
  }
}

ipcMain.handle(
  'privateChannel:open',
  async (
    event,
    owner: QAppReticulumOwner,
    rnsConnectionId: unknown,
    purpose: unknown
  ) => {
    validatePrivateChannelIpcSender(event);
    return privateChannelIpcResult(() =>
      getPrivateChannelManager().open(owner, rnsConnectionId, purpose)
    );
  }
);
ipcMain.handle(
  'privateChannel:send',
  async (
    event,
    owner: QAppReticulumOwner,
    channelId: unknown,
    lane: unknown,
    messageId: unknown,
    data: unknown,
    streamOptions?: unknown
  ) => {
    validatePrivateChannelIpcSender(event);
    return privateChannelIpcResult(() =>
      getPrivateChannelManager().send(
        owner,
        channelId,
        lane,
        messageId,
        data,
        streamOptions
      )
    );
  }
);
ipcMain.handle(
  'privateChannel:status',
  (event, owner: QAppReticulumOwner, channelId: unknown) => {
    validatePrivateChannelIpcSender(event);
    return privateChannelIpcResult(() =>
      getPrivateChannelManager().status(owner, channelId)
    );
  }
);
ipcMain.handle(
  'privateChannel:close',
  async (event, owner: QAppReticulumOwner, channelId: unknown) => {
    validatePrivateChannelIpcSender(event);
    return privateChannelIpcResult(() =>
      getPrivateChannelManager().close(owner, channelId)
    );
  }
);
ipcMain.handle(
  'privateChannel:cleanupOwner',
  async (event, owner: QAppReticulumOwner) => {
    validatePrivateChannelIpcSender(event);
    return privateChannelIpcResult(async () => {
      await privateChannelManager?.cleanupOwner(owner);
      return true;
    });
  }
);

async function getReadyReticulumChatManager(): Promise<
  ReturnType<typeof getReticulumChatManager>
> {
  const settings = await readAppSettings();
  if (!isReticulumChatEffectivelyEnabled(settings)) {
    throw new Error('Reticulum chat is disabled');
  }
  const existingManager = getReticulumChatManager();
  if (existingManager) {
    return existingManager;
  }
  await ensureReticulumManagersStarted();
  return getReticulumChatManager();
}

ipcMain.handle('p2p:start', async (_event, options?: P2PNetworkOptions) => {
  if (isDisabledLegacy) {
    return { success: false, error: 'Legacy networking is disabled' };
  }
  try {
    // Re-use the last known options if none supplied (e.g. from the settings toggle).
    const opts =
      options && Object.keys(options).length > 0 ? options : lastP2POptions;
    lastP2POptions = opts;
    const settings = await readAppSettings();
    if (settings.reticulumEnabled !== false) {
      await ensureReticulumManagersStarted();
    }
    const network = await startP2PNetwork(opts);
    attachP2PListeners(network);
    await startDecentralizedStunAfterP2P(network, opts);
    // (Re-)start the chat manager backed by the shared SQLite database.
    stopChatManager();
    const sharedDbPath = join(
      app.getPath('appData'),
      'qortal-shared',
      'chat.db'
    );
    const cm = await startChatManager(network, sharedDbPath);
    attachChatListeners(cm);
    notifyPresenceTransportReady();
    return {
      success: true,
      port: network.getPort(),
      peerId: network.getPeerId(),
    };
  } catch (err) {
    loggerError('[P2P] Failed to start:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('p2p:stop', async () => {
  if (isDisabledLegacy) {
    return { success: true };
  }
  try {
    stopP2PNetwork();
    stopChatManager();
    return { success: true };
  } catch (err) {
    loggerError('[P2P] Failed to stop:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('p2p:send', async (_event, to: string | null, data: unknown) => {
  if (isDisabledLegacy) {
    return { success: false, error: 'Legacy networking is disabled' };
  }
  const network = getP2PNetwork();
  if (!network) return { success: false, error: 'P2P network is not running' };
  try {
    const messageId = network.send(to, data);
    return { success: true, messageId };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('p2p:getPeers', async () => {
  if (isDisabledLegacy) return [];
  const network = getP2PNetwork();
  return network ? network.getPeers() : [];
});

ipcMain.handle('p2p:getStatus', async () => {
  if (isDisabledLegacy) {
    return { running: false, port: null, peerId: null, connectedPeers: 0 };
  }
  const network = getP2PNetwork();
  if (!network)
    return { running: false, port: null, peerId: null, connectedPeers: 0 };
  return {
    running: network.isRunning(),
    port: network.getPort(),
    peerId: network.getPeerId(),
    connectedPeers: network.connectedCount(),
  };
});

ipcMain.handle('p2p:addPeer', async (_event, addr: string) => {
  if (isDisabledLegacy) {
    return { success: false, error: 'Legacy networking is disabled' };
  }
  const network = getP2PNetwork();
  if (!network) return { success: false, error: 'P2P network is not running' };
  network.addPeer(addr);
  return { success: true };
});

ipcMain.on('p2p:message:subscribe', (event) => {
  p2pMessageSubscribers.add(event.sender);
});
ipcMain.on('p2p:message:unsubscribe', (event) => {
  p2pMessageSubscribers.delete(event.sender);
});

ipcMain.on('p2p:peerChange:subscribe', (event) => {
  p2pPeerChangeSubscribers.add(event.sender);
});
ipcMain.on('p2p:peerChange:unsubscribe', (event) => {
  p2pPeerChangeSubscribers.delete(event.sender);
});

// ── Presence IPC Handlers ────────────────────────────────────────────────────

const presenceUpdateSubscribers = new Set<Electron.WebContents>();
const queuedPresenceUpdates = new Map<string, unknown>();
let presenceUpdateFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lateReticulumRecoveryCleanup: (() => void) | null = null;
const RETICULUM_OVERLAY_SYNC_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];
const RETICULUM_OVERLAY_MAINTENANCE_SYNC_MS = 25_000;
const RETICULUM_CHAT_SUBSCRIPTION_REPLAY_DEBOUNCE_MS = 1_000;
let reticulumOverlaySyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
let reticulumOverlaySyncSequence = 0;
let reticulumOverlaySyncInFlight = false;
let reticulumOverlaySyncPending = false;
let reticulumOverlayMaintenanceTimer: ReturnType<typeof setInterval> | null =
  null;
let reticulumChatSubscriptionReplayTimer: ReturnType<typeof setTimeout> | null =
  null;

function flushPresenceUpdates(): void {
  if (presenceUpdateFlushTimer) {
    clearTimeout(presenceUpdateFlushTimer);
    presenceUpdateFlushTimer = null;
  }
  if (queuedPresenceUpdates.size === 0) return;

  const payloads = Array.from(queuedPresenceUpdates.values());
  queuedPresenceUpdates.clear();
  loggerLog(
    `[Presence] Flushing ${payloads.length} queued update(s) to ${presenceUpdateSubscribers.size} renderer subscriber(s)`
  );
  broadcastToSet(presenceUpdateSubscribers, 'presence:update-batch', payloads);
}

function queuePresenceUpdate(payload: unknown): void {
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { address?: unknown }).address === 'string'
  ) {
    loggerLog(
      `[Presence] Queueing renderer update for address=${(payload as { address: string }).address}`
    );
    queuedPresenceUpdates.set(
      (payload as { address: string }).address,
      payload
    );
  } else {
    loggerLog('[Presence] Queueing renderer update without address key');
    queuedPresenceUpdates.set(
      `${Date.now()}:${queuedPresenceUpdates.size}`,
      payload
    );
  }

  if (presenceUpdateFlushTimer) return;
  presenceUpdateFlushTimer = setTimeout(() => {
    flushPresenceUpdates();
  }, 16);
  presenceUpdateFlushTimer.unref?.();
}

function broadcastPresenceUpdate(payload: unknown): void {
  loggerLog(
    '[Presence] Broadcasting presence update from manager to renderer queue'
  );
  queuePresenceUpdate(payload);
}

async function syncReticulumOverlayStateToBridge(
  manager: NonNullable<ReturnType<typeof getPresenceManager>>,
  attempt = 0,
  sequence?: number
): Promise<void> {
  if (sequence === undefined) {
    if (reticulumOverlaySyncInFlight) {
      reticulumOverlaySyncPending = true;
      return;
    }
    sequence = ++reticulumOverlaySyncSequence;
  } else if (sequence !== reticulumOverlaySyncSequence) {
    return;
  } else if (reticulumOverlaySyncInFlight) {
    reticulumOverlaySyncPending = true;
    return;
  }

  const bridge = getReticulumBridge();
  if (!bridge || bridge.getState() !== 'ready') {
    scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence);
    return;
  }
  let syncOk = false;
  // Snapshot getters may prune expired topology and synchronously emit a
  // topology-change event. Mark the operation in flight before reading them so
  // that re-entrant changes become one trailing refresh instead of recursively
  // starting another full sync.
  reticulumOverlaySyncInFlight = true;
  try {
    const verifiedPeers: ReticulumOverlayVerifiedPeer[] = manager
      .getReticulumVerifiedTransportPeers()
      .map((peer) => ({
        destinationHash: peer.destinationHash,
        lastSeen: peer.lastSeen,
      }));
    const accountEndpointLeases = manager.getReticulumAccountEndpointLeases();
    const activeNeighborHashes = manager.getReticulumActiveNeighborHashes();
    const overlayNeighborHashes =
      activeNeighborHashes.length > 0
        ? activeNeighborHashes
        : verifiedPeers.map((peer) => peer.destinationHash);
    const ok = await bridge.syncOverlayState(
      verifiedPeers,
      overlayNeighborHashes,
      accountEndpointLeases
    );
    if (!ok) {
      scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence);
      return;
    }
    getReticulumChatManager()?.refreshSelfDmWarmLinks();
    if (
      sequence === reticulumOverlaySyncSequence &&
      reticulumOverlaySyncRetryTimer
    ) {
      clearTimeout(reticulumOverlaySyncRetryTimer);
      reticulumOverlaySyncRetryTimer = null;
    }
    syncOk = true;
  } catch (err) {
    loggerWarn(
      '[ReticulumOverlay] Failed to sync overlay state to bridge:',
      err
    );
    scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence);
  } finally {
    reticulumOverlaySyncInFlight = false;
    if (syncOk && reticulumOverlaySyncPending) {
      reticulumOverlaySyncPending = false;
      setImmediate(() => {
        void syncReticulumOverlayStateToBridge(manager);
      });
    }
  }
}

function scheduleReticulumOverlayStateSyncRetry(
  manager: NonNullable<ReturnType<typeof getPresenceManager>>,
  attempt: number,
  sequence: number
): void {
  if (sequence !== reticulumOverlaySyncSequence) return;
  if (reticulumOverlaySyncRetryTimer) {
    clearTimeout(reticulumOverlaySyncRetryTimer);
    reticulumOverlaySyncRetryTimer = null;
  }
  const delay =
    RETICULUM_OVERLAY_SYNC_RETRY_DELAYS_MS[
      Math.min(attempt, RETICULUM_OVERLAY_SYNC_RETRY_DELAYS_MS.length - 1)
    ];
  reticulumOverlaySyncRetryTimer = setTimeout(() => {
    reticulumOverlaySyncRetryTimer = null;
    if (sequence !== reticulumOverlaySyncSequence) return;
    void syncReticulumOverlayStateToBridge(manager, attempt + 1, sequence);
  }, delay);
  reticulumOverlaySyncRetryTimer.unref?.();
}

async function readRelayGroupHints(address: string): Promise<number[] | null> {
  const main = myCapacitorApp.getMainWindow();
  if (
    !main ||
    main.isDestroyed() ||
    !isRendererMainFrameReady(main.webContents)
  )
    return null;
  const result = await main.webContents.executeJavaScript(
    `(async () => {
    const result = await window.sendMessage('getRelayGroupHints', {address:${JSON.stringify(address)}}, 3000);
    return result?.groups ?? null;
  })()`,
    true
  );
  return Array.isArray(result) &&
    result.length <= 4096 &&
    result.every((id) => Number.isInteger(id) && id > 0 && id <= 2147483647)
    ? result
    : null;
}

async function readRelayWalletAddress(): Promise<string> {
  const main = myCapacitorApp.getMainWindow();
  if (
    !main ||
    main.isDestroyed() ||
    !isRendererMainFrameReady(main.webContents)
  )
    return '';
  const result = await main.webContents.executeJavaScript(
    `(async () => {
    const result = await window.sendMessage('getWalletInfo', {}, 5000);
    return result?.hasKeyPair && typeof result?.walletInfo?.address0 === 'string' ? result.walletInfo.address0 : '';
  })()`,
    true
  );
  return typeof result === 'string' ? result : '';
}

async function signReticulumChatControlFields(
  fields: Record<string, unknown>
): Promise<{
  authorAddress: string;
  authorPublicKey: string;
  signature: string;
} | null> {
  const main = myCapacitorApp.getMainWindow();
  if (!main || main.isDestroyed()) return null;
  if (!isRendererMainFrameReady(main.webContents)) return null;
  const pJson = JSON.stringify(fields ?? {});
  try {
    const result = await main.webContents.executeJavaScript(
      `(async () => {
        const __p = ${pJson};
        const result = await window.sendMessage('signReticulumChatEvent', __p, 10000);
        if (result && typeof result === 'object' && result.error) {
          return { error: String(result.error), message: result.message };
        }
        return result;
      })()`,
      true
    );
    if (
      result &&
      typeof result.authorAddress === 'string' &&
      typeof result.authorPublicKey === 'string' &&
      typeof result.signature === 'string'
    ) {
      return {
        authorAddress: result.authorAddress,
        authorPublicKey: result.authorPublicKey,
        signature: result.signature,
      };
    }
  } catch (err) {
    if (
      isRendererFrameUnavailableError(err) ||
      !isRendererMainFrameReady(main.webContents)
    )
      return null;
    loggerWarn('[ReticulumChat] Control signing failed:', err);
  }
  return null;
}

async function validateQortalGroupMember(
  groupId: number,
  address: string
): Promise<boolean | null> {
  const normalizedAddress = address.trim();
  if (!Number.isInteger(groupId) || groupId <= 0 || !normalizedAddress) {
    return false;
  }
  const main = myCapacitorApp.getMainWindow();
  if (!main || main.isDestroyed()) return null;
  const payloadJson = JSON.stringify({
    groupId,
    address: normalizedAddress,
  });
  try {
    loggerLog(
      `[ReticulumChat] group_member_validation_start group=${groupId} address=${normalizedAddress}`
    );
    const result = await main.webContents.executeJavaScript(
      `(async () => {
        const payload = ${payloadJson};
        const rows = await window.sendMessage(
          'validateGroupMembers',
          { groupId: payload.groupId, addresses: [payload.address] },
          10000
        ).catch(() => '__RETICULUM_VALIDATION_UNAVAILABLE__');
        if (rows === '__RETICULUM_VALIDATION_UNAVAILABLE__' || !Array.isArray(rows)) {
          return null;
        }
        return rows.some((item) =>
          item &&
          typeof item === 'object' &&
          item.address === payload.address &&
          item.isMember === true
        );
      })()`,
      true
    );
    if (result === true) return true;
    if (result === false) return false;
    return null;
  } catch (err) {
    loggerWarn(
      '[ReticulumChat] Selected-node group membership validation failed:',
      err
    );
    return null;
  }
}

type PendingGroupAdminValidation = {
  address: string;
  resolve: (isAdmin: boolean) => void;
  reject: (error: unknown) => void;
};

const pendingGroupAdminValidations = new Map<
  number,
  {
    requests: PendingGroupAdminValidation[];
  }
>();

async function resolveQortalGroupAdminBatch(
  groupId: number,
  addresses: string[]
): Promise<Map<string, boolean>> {
  const main = myCapacitorApp.getMainWindow();
  if (!main || main.isDestroyed()) {
    throw new Error('No renderer available for group admin validation');
  }
  const payloadJson = JSON.stringify({
    groupId,
    addresses,
  });
  const rows = await main.webContents.executeJavaScript(
    `(async () => {
      const payload = ${payloadJson};
      const rows = await window.sendMessage(
        'validateGroupAdmins',
        { groupId: payload.groupId, addresses: payload.addresses },
        10000
      );
      if (!Array.isArray(rows)) {
        throw new Error('Invalid group admin validation response');
      }
      return rows;
    })()`,
    true
  );
  if (!Array.isArray(rows)) {
    throw new Error('Invalid group admin validation response');
  }
  const statusByAddress = new Map(addresses.map((address) => [address, false]));
  for (const row of rows) {
    if (
      row &&
      typeof row === 'object' &&
      typeof row.address === 'string' &&
      statusByAddress.has(row.address)
    ) {
      statusByAddress.set(row.address, row.isAdmin === true);
    }
  }
  return statusByAddress;
}

function flushQortalGroupAdminBatch(groupId: number): void {
  const batch = pendingGroupAdminValidations.get(groupId);
  if (!batch) return;
  pendingGroupAdminValidations.delete(groupId);
  const addresses = [
    ...new Set(batch.requests.map((request) => request.address)),
  ];
  void resolveQortalGroupAdminBatch(groupId, addresses)
    .then((statusByAddress) => {
      for (const request of batch.requests) {
        const isAdmin = statusByAddress.get(request.address) === true;
        loggerLog(
          `[ReticulumChat] group_admin_validation_result group=${groupId} address=${request.address} isAdmin=${isAdmin}`
        );
        request.resolve(isAdmin);
      }
    })
    .catch((error) => {
      loggerWarn(
        `[ReticulumChat] group_admin_validation_failed group=${groupId}:`,
        error
      );
      for (const request of batch.requests) request.reject(error);
    });
}

async function validateQortalGroupAdmin(
  groupId: number,
  address: string
): Promise<boolean> {
  const normalizedAddress = address.trim();
  if (!Number.isInteger(groupId) || groupId <= 0 || !normalizedAddress) {
    return false;
  }
  return new Promise<boolean>((resolve, reject) => {
    const existing = pendingGroupAdminValidations.get(groupId);
    if (existing) {
      existing.requests.push({ address: normalizedAddress, resolve, reject });
      return;
    }
    const timer = setTimeout(() => flushQortalGroupAdminBatch(groupId), 10);
    timer.unref?.();
    pendingGroupAdminValidations.set(groupId, {
      requests: [{ address: normalizedAddress, resolve, reject }],
    });
  });
}

function startReticulumOverlayMaintenanceSync(): void {
  if (reticulumOverlayMaintenanceTimer) return;
  reticulumOverlayMaintenanceTimer = setInterval(() => {
    if (isQuitting) return;
    const manager = getPresenceManager();
    const bridge = getReticulumBridge();
    if (!manager || !bridge || bridge.getState() !== 'ready') return;
    void syncReticulumOverlayStateToBridge(manager);
  }, RETICULUM_OVERLAY_MAINTENANCE_SYNC_MS);
  reticulumOverlayMaintenanceTimer.unref?.();
  loggerLog(
    `[ReticulumOverlay] Maintenance sync started interval_ms=${RETICULUM_OVERLAY_MAINTENANCE_SYNC_MS}`
  );
}

function scheduleReticulumChatSubscriptionReplay(): void {
  if (reticulumChatSubscriptionReplayTimer) {
    clearTimeout(reticulumChatSubscriptionReplayTimer);
  }
  reticulumChatSubscriptionReplayTimer = setTimeout(() => {
    reticulumChatSubscriptionReplayTimer = null;
    getReticulumChatManager()?.reannounceSubscriptions();
  }, RETICULUM_CHAT_SUBSCRIPTION_REPLAY_DEBOUNCE_MS);
  reticulumChatSubscriptionReplayTimer.unref?.();
}

export async function replayReticulumCachedPresence(
  reason: string,
  scheduleFollowup = false
): Promise<boolean> {
  const manager = getPresenceManager();
  const bridge = getReticulumBridge();
  if (!manager || !bridge || bridge.getState() !== 'ready') {
    loggerLog(
      `[ReticulumRecovery] Cached presence replay skipped reason=${reason} manager=${manager ? 'yes' : 'no'} bridge_state=${bridge?.getState() ?? 'missing'}`
    );
    return false;
  }

  const cached = manager.getLastLocalEnvelope();
  if (!cached) {
    loggerLog(
      `[ReticulumRecovery] Cached presence replay skipped reason=${reason} cached_presence=no`
    );
    return false;
  }

  await syncReticulumOverlayStateToBridge(manager);
  const ok = await bridge.publish(cached, {
    force: true,
    reason,
  });
  const address =
    typeof (cached.payload as { address?: string })?.address === 'string'
      ? (cached.payload as { address: string }).address
      : 'unknown';
  loggerLog(
    `[ReticulumRecovery] Cached presence replay reason=${reason} ok=${ok ? 'yes' : 'no'} type=${cached.type} peer_addr=${address} envelope_id=${cached.id ?? 'n/a'}`
  );

  if (scheduleFollowup) {
    const followup = setTimeout(() => {
      void replayReticulumCachedPresence(`${reason}:followup`, false).catch(
        (err) => {
          loggerWarn(
            `[ReticulumRecovery] Cached presence followup failed reason=${reason}:`,
            err
          );
        }
      );
    }, 10_000);
    followup.unref?.();
  }

  return ok;
}

export function attachPresenceListeners(
  manager: ReturnType<typeof getPresenceManager>
): void {
  if (!manager) return;
  loggerLog('[Presence] Attaching manager listeners.');
  let hasObservedUsableReticulumTopology = false;
  let hasObservedAdmittedReticulumTopology = false;
  manager.on('presence-updated', broadcastPresenceUpdate);
  manager.on('reticulum-overlay-changed', (payload: unknown) => {
    const state = payload as {
      activeNeighbors?: unknown;
      publishFanout?: unknown;
      verified?: unknown;
      topologyChanged?: unknown;
    };
    const activeNeighbors =
      typeof state?.activeNeighbors === 'number' ? state.activeNeighbors : 0;
    const publishFanout =
      typeof state?.publishFanout === 'number' ? state.publishFanout : 0;
    const verified = typeof state?.verified === 'number' ? state.verified : 0;
    const hasUsableTopology =
      activeNeighbors > 0 || publishFanout > 0 || verified > 0;
    const hasAdmittedTopology = activeNeighbors > 0 || verified > 0;
    const topologyChanged = state?.topologyChanged === true;
    const firstUsableTopology =
      hasUsableTopology && !hasObservedUsableReticulumTopology;
    const lostUsableTopology =
      !hasUsableTopology && hasObservedUsableReticulumTopology;
    const firstAdmittedTopology =
      hasAdmittedTopology && !hasObservedAdmittedReticulumTopology;
    // Candidate announce refreshes do not change anything sent to the bridge.
    // Actual route transitions are synchronized immediately; the maintenance
    // timer remains the recovery fallback for a missed or failed sync.
    if (topologyChanged || firstUsableTopology || lostUsableTopology) {
      void syncReticulumOverlayStateToBridge(manager);
    }
    // Candidates are sufficient to bootstrap dialing, but only an
    // authenticated admitted overlay is allowed to trigger the one-time full
    // subscription replay. The newly admitted peer also receives its targeted
    // introduction through reticulum-peer-verified below.
    if (firstAdmittedTopology) {
      scheduleReticulumChatSubscriptionReplay();
    }
    if (hasUsableTopology && (topologyChanged || firstUsableTopology)) {
      getReticulumChatManager()?.notifyOverlayHealthChanged(true);
    }
    hasObservedUsableReticulumTopology = hasUsableTopology;
    hasObservedAdmittedReticulumTopology = hasAdmittedTopology;
  });
  manager.on(
    'reticulum-peer-verified',
    ({ destinationHash }: { destinationHash: string }) => {
      getReticulumChatManager()?.announceSubscriptionsToPeer(destinationHash);
    }
  );
  manager.on('reticulum-account-endpoints-changed', () => {
    void syncReticulumOverlayStateToBridge(manager);
  });
  manager.on(
    'reticulum-candidate-failed',
    ({
      destinationHash,
      reason,
    }: {
      destinationHash: string;
      reason: string;
    }) => {
      const bridge = getReticulumBridge();
      if (!bridge || bridge.getState() !== 'ready') return;
      void bridge
        .noteOverlayCandidateFailure(destinationHash, reason)
        .catch(() => {});
    }
  );
  manager.on(
    'reticulum-envelope-accepted',
    ({
      envelope,
      route,
    }: {
      envelope: import('./presence').PresenceEnvelope;
      route: import('./presence').PresenceRoute;
    }) => {
      if (route.kind !== 'reticulum') return;
      const hops = route.overlayHopsRemaining ?? 0;
      if (hops <= 0) return;
      const bridge = getReticulumBridge();
      if (!bridge || bridge.getState() !== 'ready') return;
      void bridge
        .forwardPresence(
          envelope,
          hops - 1,
          [route.viaDestinationHash ?? route.destinationHash],
          route.destinationHash
        )
        .catch(() => {});
    }
  );
  void syncReticulumOverlayStateToBridge(manager);
}

export function clearLateReticulumBridgeRecovery(): void {
  lateReticulumRecoveryCleanup?.();
  lateReticulumRecoveryCleanup = null;
}

export function registerLateReticulumBridgeRecovery(): void {
  clearLateReticulumBridgeRecovery();
  const bridge = getReticulumBridge();
  if (!bridge) {
    loggerWarn(
      '[ReticulumBridge] Late recovery not registered: no bridge instance'
    );
    return;
  }

  let recovered = false;
  const recoverManagers = () => {
    if (recovered) return;
    recovered = true;
    clearLateReticulumBridgeRecovery();
    if (!isReticulumRuntimeEnabled()) return;

    const currentBridge = getReticulumBridge();
    if (!currentBridge || currentBridge.getState() !== 'ready') {
      loggerWarn(
        '[ReticulumBridge] Late recovery skipped: bridge missing or not ready'
      );
      return;
    }
    attachReticulumStatusBridgeEvents(currentBridge);

    loggerLog(
      '[ReticulumBridge] Bridge became ready after startup timeout; updating presence transport and rebinding call/group-call/chat managers'
    );
    startReticulumOverlayMaintenanceSync();

    let pm = getPresenceManager();
    try {
      if (pm) {
        setPresenceManagerTransports([currentBridge]);
        void syncReticulumOverlayStateToBridge(pm);
      } else {
        pm = startPresenceManager([currentBridge]);
        attachPresenceListeners(pm);
      }
    } catch (err) {
      loggerWarn(
        '[ReticulumBridge] Late recovery presence rebind failed:',
        err
      );
    }
    if (!pm) {
      pm = getPresenceManager();
    }
    if (pm) {
      void replayReticulumCachedPresence('late-ready', true);
    } else {
      loggerWarn(
        '[ReticulumBridge] Late recovery could not start presence manager; skipping cached presence replay'
      );
    }

    const callMgr = getCallManager();
    try {
      if (callMgr) {
        callMgr.setReticulumBridge(currentBridge);
      } else if (pm) {
        attachCallListeners(startCallManager(pm, currentBridge));
      }
    } catch (err) {
      loggerWarn('[ReticulumBridge] Late recovery call rebind failed:', err);
    }
    const gcallMgr = getGroupCallManager();
    try {
      if (gcallMgr) {
        gcallMgr.setReticulumBridge(currentBridge);
      } else if (pm) {
        attachGroupCallListeners(startGroupCallManager(pm, currentBridge));
      }
    } catch (err) {
      loggerWarn(
        '[ReticulumBridge] Late recovery group-call rebind failed:',
        err
      );
    }
    try {
      getReticulumChatManager()?.setBridge(currentBridge);
    } catch (err) {
      loggerWarn('[ReticulumBridge] Late recovery chat rebind failed:', err);
    }
    try {
      stopReticulumMeshCoordinator();
      startReticulumMeshCoordinator(currentBridge);
    } catch (err) {
      loggerWarn('[ReticulumBridge] Late recovery mesh rebind failed:', err);
    }
    // Mirror the normal startup signal so an already-authenticated renderer can
    // retry its initial presence announce after late Reticulum readiness.
    scheduleReticulumChatSubscriptionReplay();
    notifyPresenceTransportReady();
  };

  if (bridge.getState() === 'ready') {
    recoverManagers();
    return;
  }

  bridge.once('ready', recoverManagers);
  lateReticulumRecoveryCleanup = () => {
    bridge.off('ready', recoverManagers);
  };
  loggerLog('[ReticulumBridge] Registered late-ready recovery hook');
}

/** Validates a renderer-supplied envelope, applies it locally, then relays. */
async function handleLocalPresenceEnvelope(
  envelope: unknown
): Promise<boolean> {
  if (!isReticulumRuntimeEnabled()) return false;
  const pm = getPresenceManager();
  if (!pm) {
    loggerLog(
      '[Presence] Local envelope dropped because manager is unavailable.'
    );
    return false;
  }
  loggerLog('[Presence] Handling local renderer presence envelope.');
  return publishPresenceEnvelope(envelope as any);
}

ipcMain.handle('presence:announce', async (_event, envelope: unknown) => {
  try {
    const ok = await handleLocalPresenceEnvelope(envelope);
    return { success: ok };
  } catch (err) {
    loggerError('[Presence] announce error:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('presence:heartbeat', async (_event, envelope: unknown) => {
  try {
    const ok = await handleLocalPresenceEnvelope(envelope);
    return { success: ok };
  } catch (err) {
    loggerError('[Presence] heartbeat error:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('presence:offline', async (_event, envelope: unknown) => {
  try {
    const ok = await handleLocalPresenceEnvelope(envelope);
    if (ok) stopPresenceMainHeartbeatScheduler();
    return { success: ok };
  } catch (err) {
    loggerError('[Presence] offline error:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('presence:heartbeatSchedulerStart', async () => {
  if (!isReticulumRuntimeEnabled()) {
    return { success: false, error: 'Reticulum is disabled' };
  }
  loggerLog('[Presence] Main heartbeat scheduler start requested');
  startPresenceMainHeartbeatScheduler();
  return { success: true };
});

ipcMain.handle('presence:heartbeatSchedulerStop', async () => {
  stopPresenceMainHeartbeatScheduler();
  return { success: true };
});

ipcMain.handle('presence:getStatus', async (_event, address: string) => {
  const pm = getPresenceManager();
  if (!pm) return { online: false, lastSeen: null, sessions: [] };
  return pm.getStatus(address);
});

ipcMain.handle('presence:getOnlineAddresses', async () => {
  const pm = getPresenceManager();
  return pm ? pm.getOnlineAddresses() : [];
});

ipcMain.handle('presence:getAllOnline', async () => {
  const pm = getPresenceManager();
  return pm ? pm.getAllOnline() : [];
});

ipcMain.on('presence:subscribe', (event) => {
  presenceUpdateSubscribers.add(event.sender);
  loggerLog(
    `[Presence] Renderer subscribed. subscriber_count=${presenceUpdateSubscribers.size}`
  );
});
ipcMain.on('presence:unsubscribe', (event) => {
  presenceUpdateSubscribers.delete(event.sender);
  loggerLog(
    `[Presence] Renderer unsubscribed. subscriber_count=${presenceUpdateSubscribers.size}`
  );
});

// ── Chat IPC Handlers ─────────────────────────────────────────────────────────

const chatEventSubscribers = new Set<Electron.WebContents>();
const chatTypingSubscribers = new Set<Electron.WebContents>();
const chatReadSubscribers = new Set<Electron.WebContents>();
const reticulumChatEventSubscription =
  createRefcountedSubscriberSet<Electron.WebContents>();
const reticulumChatReadinessSubscribers = new Set<Electron.WebContents>();
const reticulumChatTypingSubscribers = new Set<Electron.WebContents>();
const reticulumChatLandStateSubscription =
  createRefcountedSubscriberSet<Electron.WebContents>();
const reticulumChatLandChatSubscribers = new Set<Electron.WebContents>();
const reticulumChatLandActionSubscribers = new Set<Electron.WebContents>();
const reticulumChatLandCallSubscribers = new Set<Electron.WebContents>();
const reticulumChatSummarySubscription =
  createRefcountedSubscriberSet<Electron.WebContents>();
const reticulumDirectEventSubscribers = new Set<Electron.WebContents>();
const reticulumDirectCallHistorySubscribers = new Set<Electron.WebContents>();
const reticulumDirectTypingSubscribers = new Set<Electron.WebContents>();
const reticulumDirectSummarySubscribers = new Set<Electron.WebContents>();
const reticulumChatResourceSubscribers = new Set<Electron.WebContents>();
const reticulumChatSilenceSubscribers = new Set<Electron.WebContents>();
const reticulumCalendarSubscribers = new Set<Electron.WebContents>();
const reticulumCalendarReminderSubscribers = new Set<Electron.WebContents>();
const pendingReticulumCalendarReminders: Array<{
  payload: unknown;
  queuedAt: number;
}> = [];
const RETICULUM_CALENDAR_REMINDER_STARTUP_GRACE_MS = 60 * 60_000;

function deliverReticulumCalendarReminder(payload: unknown): void {
  let delivered = false;
  for (const webContents of reticulumCalendarReminderSubscribers) {
    const result = sendToRenderer(
      webContents,
      'reticulumChat:calendarReminderDue',
      payload
    );
    if (result === 'sent') delivered = true;
    if (result === 'destroyed')
      reticulumCalendarReminderSubscribers.delete(webContents);
  }
  if (!delivered) {
    pendingReticulumCalendarReminders.push({ payload, queuedAt: Date.now() });
    if (pendingReticulumCalendarReminders.length > 256) {
      pendingReticulumCalendarReminders.splice(
        0,
        pendingReticulumCalendarReminders.length - 256
      );
    }
  }
}

function notifyReticulumChatReadinessChanged(status: ReadinessStatus): void {
  broadcastToSet(
    reticulumChatReadinessSubscribers,
    'reticulumChat:readinessChanged',
    status
  );
}
let reticulumChatListenersAttached = false;

export function attachChatListeners(
  manager: ReturnType<typeof getChatManager>
): void {
  if (!manager) return;

  manager.on('chat:event', (payload: unknown) =>
    broadcastToSet(chatEventSubscribers, 'chat:event', payload)
  );

  manager.on('chat:typing', (payload: unknown) =>
    broadcastToSet(chatTypingSubscribers, 'chat:typing', payload)
  );

  manager.on('chat:typingStopped', (payload: unknown) =>
    broadcastToSet(chatTypingSubscribers, 'chat:typingStopped', payload)
  );

  manager.on('chat:read', (payload: unknown) =>
    broadcastToSet(chatReadSubscribers, 'chat:read', payload)
  );
}

export function attachReticulumChatListeners(
  manager: ReturnType<typeof getReticulumChatManager>
): void {
  if (!manager || reticulumChatListenersAttached) return;
  reticulumChatListenersAttached = true;

  manager.on('event', (payload: unknown) => {
    for (const wc of reticulumChatEventSubscription.subscribers) {
      if (sendToRenderer(wc, 'reticulumChat:event', payload) === 'destroyed') {
        reticulumChatEventSubscription.drop(wc);
      }
    }
  });

  manager.on('typing', (payload: unknown) =>
    broadcastToSet(
      reticulumChatTypingSubscribers,
      'reticulumChat:typing',
      payload
    )
  );

  manager.on('landState', (payload: unknown) => {
    for (const wc of reticulumChatLandStateSubscription.subscribers) {
      if (
        sendToRenderer(wc, 'reticulumChat:landState', payload) === 'destroyed'
      ) {
        reticulumChatLandStateSubscription.drop(wc);
      }
    }
  });

  manager.on('landChat', (payload: unknown) =>
    broadcastToSet(
      reticulumChatLandChatSubscribers,
      'reticulumChat:landChat',
      payload
    )
  );

  manager.on('landAction', (payload: unknown) =>
    broadcastToSet(
      reticulumChatLandActionSubscribers,
      'reticulumChat:landAction',
      payload
    )
  );

  manager.on('landCall', (payload: unknown) =>
    broadcastToSet(
      reticulumChatLandCallSubscribers,
      'reticulumChat:landCall',
      payload
    )
  );

  manager.on('summaryChanged', (payload: unknown) => {
    if (
      payload &&
      typeof payload === 'object' &&
      (payload as { readStateChanged?: unknown }).readStateChanged === true
    ) {
      myCapacitorApp.updateReticulumChatMentionBadge(
        manager.getTotalUnreadMentionCount(RETICULUM_CHAT_ONLINE_SINCE_MS)
      );
    }
    for (const wc of reticulumChatSummarySubscription.subscribers) {
      if (
        sendToRenderer(wc, 'reticulumChat:summaryChanged', payload) ===
        'destroyed'
      ) {
        reticulumChatSummarySubscription.drop(wc);
      }
    }
  });

  manager.on('directEvent', (payload: unknown) =>
    broadcastToSet(
      reticulumDirectEventSubscribers,
      'reticulumChat:directEvent',
      payload
    )
  );

  manager.on('directCallHistory', (payload: unknown) =>
    broadcastToSet(
      reticulumDirectCallHistorySubscribers,
      'reticulumChat:directCallHistory',
      payload
    )
  );

  manager.on('directTyping', (payload: unknown) =>
    broadcastToSet(
      reticulumDirectTypingSubscribers,
      'reticulumChat:directTyping',
      payload
    )
  );

  manager.on('directSummaryChanged', (payload: unknown) =>
    broadcastToSet(
      reticulumDirectSummarySubscribers,
      'reticulumChat:directSummaryChanged',
      payload
    )
  );

  manager.on('resource', (payload: unknown) =>
    broadcastToSet(
      reticulumChatResourceSubscribers,
      'reticulumChat:resource',
      payload
    )
  );

  manager.on('silenceChanged', (payload: unknown) =>
    broadcastToSet(
      reticulumChatSilenceSubscribers,
      'reticulumChat:silenceChanged',
      payload
    )
  );

  manager.on('calendarChanged', (payload: unknown) =>
    broadcastToSet(
      reticulumCalendarSubscribers,
      'reticulumChat:calendarChanged',
      payload
    )
  );

  manager.on('calendarReminderDue', deliverReticulumCalendarReminder);
}

ipcMain.handle('reticulumChat:isEnabled', async () => {
  const settings = await readAppSettings();
  return isReticulumChatEffectivelyEnabled(settings);
});

ipcMain.handle('reticulumChat:getReadinessStatus', () =>
  getReticulumChatReadinessStatus()
);

let reticulumLocalAccountLifecycleGeneration = 0;

ipcMain.handle(
  'reticulumChat:setLocalGroupMemberships',
  async (
    _event,
    groupIds: Array<
      | number
      | {
          groupId?: unknown;
          isPrivate?: unknown;
          isOpen?: unknown;
          localAddress?: unknown;
          address?: unknown;
          isAdmin?: unknown;
          adminStatusAuthoritative?: unknown;
        }
    >
  ) => {
    const accountGeneration = reticulumLocalAccountLifecycleGeneration;
    let manager: ReturnType<typeof getReticulumChatManager>;
    try {
      manager = await getReadyReticulumChatManager();
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Reticulum chat manager failed to start',
      };
    }
    if (!manager) {
      return {
        success: false,
        error: 'Reticulum chat manager is not running',
      };
    }
    if (accountGeneration !== reticulumLocalAccountLifecycleGeneration) {
      return { success: false, error: 'Account session changed' };
    }
    manager.setLocalGroupMemberships(Array.isArray(groupIds) ? groupIds : []);
    setRelayGroups(
      (Array.isArray(groupIds) ? groupIds : []).map((value) =>
        typeof value === 'number' ? value : Number(value.groupId)
      )
    );
    return { success: true };
  }
);

ipcMain.handle(
  'reticulumChat:setPublicGroupDirectory',
  async (_event, groupIds: number[]) => {
    let manager: ReturnType<typeof getReticulumChatManager>;
    try {
      manager = await getReadyReticulumChatManager();
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Reticulum chat manager failed to start',
      };
    }
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    manager.setPublicGroupDirectory(Array.isArray(groupIds) ? groupIds : []);
    return { success: true };
  }
);

ipcMain.handle('reticulumChat:getPublicGroupActivity', async () => {
  const manager = getReticulumChatManager();
  return manager?.getPublicGroupActivitySummaries() ?? [];
});

ipcMain.handle('reticulumChat:getPublicGroupActivitySnapshot', async () => {
  const manager = getReticulumChatManager();
  return (
    manager?.getPublicGroupActivitySnapshot() ?? {
      availableGroupIds: [],
      observedAt: Date.now(),
      summaries: [],
    }
  );
});

ipcMain.handle(
  'reticulumChat:setLocalDmAddresses',
  async (_event, addresses: string[]) => {
    const accountGeneration = reticulumLocalAccountLifecycleGeneration;
    const normalizedAddresses = Array.isArray(addresses) ? addresses : [];
    const settings = await readAppSettings();
    if (accountGeneration !== reticulumLocalAccountLifecycleGeneration) {
      return { success: false, error: 'Account session changed' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      if (normalizedAddresses.length === 0) return { success: true };
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      manager.setLocalDmAddresses([]);
      if (normalizedAddresses.length === 0) return { success: true };
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    manager.setLocalDmAddresses(normalizedAddresses);
    return { success: true };
  }
);

ipcMain.handle('reticulumChat:clearLocalAccountState', async () => {
  await qappFileSaves?.cleanup();
  setRelayAccount('', true);
  reticulumLocalAccountLifecycleGeneration += 1;
  // These managers live for the lifetime of the main process too. Clear their
  // account routing at the same explicit logout boundary so a later login
  // cannot inherit calls or verified inbound work from the previous account.
  getCallManager()?.clearLocalAccountState();
  getGroupCallManager()?.clearLocalAccountState();
  getChatManager()?.setLocalAddresses([]);
  stopPresenceMainHeartbeatScheduler();
  getPresenceManager()?.clearLocalAccountState();
  const manager = getReticulumChatManager();
  if (manager) await manager.clearLocalAccountState();
  return { success: true };
});

ipcMain.handle(
  'reticulumChat:getSilence',
  async (
    _event,
    ownerAddress: string,
    targetAddress: string,
    scopeType: 'group' | 'dm',
    groupId?: number
  ) => {
    const manager = getReticulumChatManager();
    return manager
      ? manager.getSilence(ownerAddress, targetAddress, scopeType, groupId)
      : null;
  }
);

ipcMain.handle(
  'reticulumChat:listSilences',
  async (
    _event,
    ownerAddress: string,
    scopeType: 'group' | 'dm',
    groupId?: number
  ) => {
    const manager = getReticulumChatManager();
    return manager
      ? manager.listSilences(ownerAddress, scopeType, groupId)
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:setSilence',
  async (
    _event,
    ownerAddress: string,
    targetAddress: string,
    scopeType: 'group' | 'dm',
    durationMs: number | null,
    groupId?: number
  ) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      const silence = manager.setSilence(
        ownerAddress,
        targetAddress,
        scopeType,
        durationMs,
        groupId
      );
      return { success: true, silence };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:clearSilence',
  async (
    _event,
    ownerAddress: string,
    targetAddress: string,
    scopeType: 'group' | 'dm',
    groupId?: number
  ) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      const silence = manager.clearSilence(
        ownerAddress,
        targetAddress,
        scopeType,
        groupId
      );
      return { success: true, silence };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:setActiveDirectChat',
  async (
    _event,
    localAddress: string,
    peerAddress: string,
    active: boolean
  ) => {
    const settings = await readAppSettings();
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      manager.clearActiveDirectChats();
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    manager.setActiveDirectChat(localAddress, peerAddress, active === true);
    return { success: true };
  }
);

ipcMain.handle(
  'reticulumChat:publishDirectEvent',
  async (_event, event: unknown) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    const result = await manager.publishDirectEvent(event as any);
    if (result.ok) return { success: true };
    const failed = result as Exclude<typeof result, { ok: true }>;
    return { success: false, error: failed.error ?? failed.reason };
  }
);

ipcMain.handle(
  'reticulumChat:getDirectAuthorStreamId',
  async (_event, authorAddress: string) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.getDirectAuthorStreamId(authorAddress);
  }
);

ipcMain.handle(
  'reticulumChat:getDirectExpiryPreference',
  async (_event, ownerAddress: string, peerAddress: string) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    return {
      success: true,
      preference: manager.getDirectExpiryPreference(
        String(ownerAddress || '').trim(),
        String(peerAddress || '').trim()
      ),
    };
  }
);

ipcMain.handle(
  'reticulumChat:setDirectExpiryPreference',
  async (
    _event,
    ownerAddress: string,
    peerAddress: string,
    durationMs: number | null
  ) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    const preference = manager.setDirectExpiryPreference(
      String(ownerAddress || '').trim(),
      String(peerAddress || '').trim(),
      durationMs == null ? null : Number(durationMs)
    );
    return preference
      ? { success: true, preference }
      : { success: false, error: 'Invalid DM expiry preference' };
  }
);

ipcMain.handle(
  'reticulumChat:getCalendarEvents',
  async (_event, groupId: number, rangeStart: number, rangeEnd: number) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.getCalendarEvents(
      Number(groupId),
      Number(rangeStart),
      Number(rangeEnd)
    );
  }
);

ipcMain.handle(
  'reticulumChat:getCalendarEvent',
  async (
    _event,
    groupId: number,
    eventId: string,
    preferredOccurrenceStart?: number
  ) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.getCalendarEvent(
      Number(groupId),
      String(eventId || ''),
      preferredOccurrenceStart == null
        ? undefined
        : Number(preferredOccurrenceStart)
    );
  }
);

ipcMain.handle(
  'reticulumChat:createCalendarEvent',
  async (_event, groupId: number, input: unknown, eventId?: string) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.createCalendarEvent(Number(groupId), input, eventId);
  }
);

ipcMain.handle(
  'reticulumChat:updateCalendarEvent',
  async (_event, groupId: number, eventId: string, input: unknown) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.updateCalendarEvent(Number(groupId), String(eventId), input);
  }
);

ipcMain.handle(
  'reticulumChat:deleteCalendarEvent',
  async (_event, groupId: number, eventId: string) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.deleteCalendarEvent(Number(groupId), String(eventId));
  }
);

ipcMain.handle(
  'reticulumChat:getCalendarReminder',
  async (_event, ownerAddress: string, groupId: number, eventId: string) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.getCalendarReminder(
      String(ownerAddress || '').trim(),
      Number(groupId),
      String(eventId || '')
    );
  }
);

ipcMain.handle(
  'reticulumChat:setCalendarReminder',
  async (
    _event,
    ownerAddress: string,
    groupId: number,
    eventId: string,
    offsetMs: number | null
  ) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    return manager.setCalendarReminder(
      String(ownerAddress || '').trim(),
      Number(groupId),
      String(eventId || ''),
      offsetMs == null ? null : Number(offsetMs)
    );
  }
);

ipcMain.handle(
  'reticulumChat:sendDirectTyping',
  async (
    _event,
    localAddress: string,
    peerAddress: string,
    active: boolean
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    const result = await manager.sendDirectTyping(
      localAddress,
      peerAddress,
      active === true
    );
    if (result.ok) return { success: true };
    const failed = result as Exclude<typeof result, { ok: true }>;
    return { success: false, error: failed.error ?? failed.reason };
  }
);

ipcMain.handle(
  'reticulumChat:getDirectHistory',
  async (_event, myAddress: string, peerAddress: string, limit?: number) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) return [];
    const manager = getReticulumChatManager();
    return manager
      ? manager.getDirectHistory(myAddress, peerAddress, limit)
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getDirectSummaries',
  async (_event, myAddress: string, peerAddress?: string) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) return [];
    const manager = getReticulumChatManager();
    if (!manager) return [];
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    return manager.getDirectSummaries(
      address,
      typeof peerAddress === 'string' ? peerAddress.trim() : undefined
    );
  }
);

ipcMain.handle(
  'reticulumChat:getDirectCallHistory',
  async (
    _event,
    ownerAddress: string,
    peerAddress?: string,
    limit?: number,
    unreadOnly?: boolean
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) return [];
    const manager = getReticulumChatManager();
    return manager
      ? manager.getDirectCallHistory(
          String(ownerAddress || '').trim(),
          typeof peerAddress === 'string' ? peerAddress.trim() : undefined,
          Number(limit) || 100,
          unreadOnly === true
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:markDirectRead',
  async (
    _event,
    myAddress: string,
    peerAddress: string,
    upToTimestamp: number
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    manager.markDirectRead(myAddress, peerAddress, Number(upToTimestamp));
    return { success: true };
  }
);

ipcMain.handle(
  'reticulumChat:subscribeGroup',
  async (_event, groupId: number) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      manager.subscribeGroup(groupId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum chat subscribe failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:subscribeChannel',
  async (_event, groupId: number, channelId: string) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      manager.subscribeChannel(groupId, channelId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum channel subscribe failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:unsubscribeChannel',
  async (_event, groupId: number, channelId: string) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    manager.unsubscribeChannel(groupId, channelId);
    return { success: true };
  }
);

ipcMain.handle(
  'reticulumChat:unsubscribeGroup',
  async (_event, groupId: number) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    manager.unsubscribeGroup(groupId);
    return { success: true };
  }
);

type ReticulumChatSequenceReservation = {
  groupId: number;
  authorAddress: string;
  authorStreamId: string;
  authorSeq: number;
};

const reticulumChatReservationsByWebContents = new Map<
  number,
  Map<string, ReticulumChatSequenceReservation>
>();
const reticulumChatReservationEpochs = new Map<number, number>();
const reticulumChatReservationLifecycleWired = new Set<number>();

function reticulumChatReservationKey(
  reservation: ReticulumChatSequenceReservation
): string {
  return `${reservation.groupId}:${reservation.authorAddress}:${reservation.authorStreamId}:${reservation.authorSeq}`;
}

function releaseReticulumChatReservationsForWebContents(
  webContentsId: number
): void {
  reticulumChatReservationEpochs.set(
    webContentsId,
    (reticulumChatReservationEpochs.get(webContentsId) ?? 0) + 1
  );
  const reservations =
    reticulumChatReservationsByWebContents.get(webContentsId);
  reticulumChatReservationsByWebContents.delete(webContentsId);
  const manager = getReticulumChatManager();
  if (!manager || !reservations) return;
  for (const reservation of reservations.values()) {
    manager.releaseAuthorSequence(
      reservation.groupId,
      reservation.authorAddress,
      reservation.authorStreamId,
      reservation.authorSeq
    );
  }
}

function ensureReticulumChatReservationLifecycle(sender: WebContents): number {
  const webContentsId = sender.id;
  if (!reticulumChatReservationLifecycleWired.has(webContentsId)) {
    reticulumChatReservationLifecycleWired.add(webContentsId);
    reticulumChatReservationEpochs.set(webContentsId, 0);
    sender.on(
      'did-start-navigation',
      (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame)
          releaseReticulumChatReservationsForWebContents(webContentsId);
      }
    );
    sender.once('destroyed', () => {
      releaseReticulumChatReservationsForWebContents(webContentsId);
      reticulumChatReservationLifecycleWired.delete(webContentsId);
      reticulumChatReservationEpochs.delete(webContentsId);
    });
  }
  return reticulumChatReservationEpochs.get(webContentsId) ?? 0;
}

function untrackReticulumChatReservation(
  webContentsId: number,
  reservation: ReticulumChatSequenceReservation
): void {
  const reservations =
    reticulumChatReservationsByWebContents.get(webContentsId);
  if (!reservations) return;
  reservations.delete(reticulumChatReservationKey(reservation));
  if (reservations.size === 0) {
    reticulumChatReservationsByWebContents.delete(webContentsId);
  }
}

ipcMain.handle(
  'reticulumChat:publishEvent',
  async (ipcEvent, event: ReticulumChatEvent) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    const result = await manager.publishEvent(event);
    if (result.ok) {
      untrackReticulumChatReservation(ipcEvent.sender.id, {
        groupId: event.groupId,
        authorAddress: event.authorAddress,
        authorStreamId: event.authorStreamId,
        authorSeq: event.authorSeq,
      });
      return { success: true };
    }
    const failed = result as Exclude<typeof result, { ok: true }>;
    return { success: false, error: failed.error ?? failed.reason };
  }
);

ipcMain.handle(
  'reticulumChat:reserveAuthorSequence',
  async (ipcEvent, groupId: number, authorAddress: string) => {
    const manager = getReticulumChatManager();
    if (!manager) throw new Error('Reticulum chat manager is not running');
    const epoch = ensureReticulumChatReservationLifecycle(ipcEvent.sender);
    const reserved = await manager.reserveAuthorSequence(
      groupId,
      authorAddress
    );
    if (
      ipcEvent.sender.isDestroyed() ||
      (reticulumChatReservationEpochs.get(ipcEvent.sender.id) ?? 0) !== epoch
    ) {
      manager.releaseAuthorSequence(
        groupId,
        authorAddress,
        reserved.authorStreamId,
        reserved.authorSeq
      );
      throw new Error(
        'Reticulum chat renderer changed while reserving sequence'
      );
    }
    const reservation = { groupId, authorAddress, ...reserved };
    const reservations =
      reticulumChatReservationsByWebContents.get(ipcEvent.sender.id) ??
      new Map();
    reservations.set(reticulumChatReservationKey(reservation), reservation);
    reticulumChatReservationsByWebContents.set(
      ipcEvent.sender.id,
      reservations
    );
    return reserved;
  }
);

ipcMain.handle(
  'reticulumChat:releaseAuthorSequence',
  async (
    ipcEvent,
    groupId: number,
    authorAddress: string,
    authorStreamId: string,
    authorSeq: number
  ) => {
    untrackReticulumChatReservation(ipcEvent.sender.id, {
      groupId,
      authorAddress,
      authorStreamId,
      authorSeq,
    });
    const manager = getReticulumChatManager();
    if (!manager) return false;
    return manager.releaseAuthorSequence(
      groupId,
      authorAddress,
      authorStreamId,
      authorSeq
    );
  }
);

ipcMain.handle(
  'reticulumChat:sendTyping',
  async (
    _event,
    groupId: number,
    channelIdOrAuthorAddress: string,
    authorAddressOrActive: string | boolean,
    activeMaybe?: boolean
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      const channelId =
        typeof activeMaybe === 'boolean' ? channelIdOrAuthorAddress : 'general';
      const authorAddress =
        typeof activeMaybe === 'boolean'
          ? String(authorAddressOrActive || '')
          : channelIdOrAuthorAddress;
      const active =
        typeof activeMaybe === 'boolean'
          ? activeMaybe
          : authorAddressOrActive === true;
      manager.sendTyping(groupId, channelId, authorAddress, active);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum chat typing send failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:sendLandState',
  async (
    _event,
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
      skinId?: unknown;
    }
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      await manager.sendLandState(groupId, authorAddress, state);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand state send failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:sendLandChat',
  async (_event, message: unknown) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      const result = await manager.sendLandChat(
        message as Parameters<typeof manager.sendLandChat>[0]
      );
      if (!result.ok) {
        const failed = result as Exclude<typeof result, { ok: true }>;
        return { success: false, error: failed.error ?? failed.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand chat send failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:sendLandAction',
  async (
    _event,
    groupId: number,
    action: {
      actionId?: unknown;
      actionType?: unknown;
      fromAddress?: unknown;
      sourceSessionId?: unknown;
      sequence?: unknown;
      toAddress?: unknown;
      targetSessionId?: unknown;
      amount?: unknown;
      roomId?: unknown;
    }
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      const result = await manager.sendLandAction(groupId, action);
      if (!result.ok) {
        const failed = result as Exclude<typeof result, { ok: true }>;
        return { success: false, error: failed.error ?? failed.reason };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand action send failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:sendLandCall',
  async (
    _event,
    groupId: number,
    call: {
      callType?: unknown;
      callId?: unknown;
      fromAddress?: unknown;
      toAddress?: unknown;
      chatId?: unknown;
      fromPublicKey?: unknown;
      signature?: unknown;
      reason?: unknown;
      roomId?: unknown;
      sourceSessionId?: unknown;
      targetSessionId?: unknown;
      targetDestinationHash?: unknown;
      timestamp?: unknown;
    }
  ) => {
    const callType = String(call?.callType ?? 'unknown').slice(0, 16);
    const callId = String(call?.callId ?? '').slice(0, 12);
    if (['request', 'accept', 'reject', 'hangup'].includes(callType)) {
      loggerLog(
        `[ReticulumChat] land_call_send_attempt group=${groupId} type=${callType} call=${callId}`
      );
    }
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      const result = await manager.sendLandCall(groupId, call);
      if (!result.ok) {
        const failed = result as Exclude<typeof result, { ok: true }>;
        loggerWarn(
          `[ReticulumChat] land_call_send_rejected group=${groupId} type=${callType} call=${callId} reason=${failed.error ?? failed.reason}`
        );
        return { success: false, error: failed.error ?? failed.reason };
      }
      return { success: true };
    } catch (err) {
      loggerWarn(
        `[ReticulumChat] land_call_send_exception group=${groupId} type=${callType} call=${callId} reason=${err instanceof Error ? err.message : String(err)}`
      );
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'QortalLand call send failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:requestResource',
  async (_event, groupId: number, manifest: unknown, eventId?: string) => {
    const manifestRecord =
      manifest && typeof manifest === 'object'
        ? (manifest as Record<string, unknown>)
        : null;
    const fileHash =
      typeof manifestRecord?.fileHash === 'string'
        ? manifestRecord.fileHash
        : '';
    const resourceName =
      typeof manifestRecord?.fileName === 'string'
        ? manifestRecord.fileName
        : '';
    const resourceSize =
      typeof manifestRecord?.sizeBytes === 'number'
        ? manifestRecord.sizeBytes
        : 0;
    const shortHash = fileHash ? fileHash.slice(0, 12) : 'missing';
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      loggerLog(
        `[ReticulumResource] request_resource_received group=${groupId} file=${shortHash} size=${resourceSize} name=${resourceName || 'unknown'} event=${
          typeof eventId === 'string' && eventId ? eventId : 'none'
        }`
      );
      const result = await manager.requestResource(
        groupId,
        manifest as any,
        typeof eventId === 'string' && eventId ? eventId : undefined
      );
      if (result.ok) {
        loggerLog(
          `[ReticulumResource] request_resource_accepted group=${groupId} file=${shortHash}`
        );
        return { success: true };
      }
      const failed = result as Exclude<typeof result, { ok: true }>;
      loggerWarn(
        `[ReticulumResource] request_resource_rejected group=${groupId} file=${shortHash} reason=${
          failed.error ?? failed.reason ?? 'unknown'
        }`
      );
      return { success: false, error: failed.error ?? failed.reason };
    } catch (err) {
      loggerWarn(
        `[ReticulumResource] request_resource_error group=${groupId} file=${shortHash} reason=${
          err instanceof Error ? err.message : 'unknown'
        }`
      );
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource request failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:requestDirectResource',
  async (
    _event,
    myAddress: string,
    peerAddress: string,
    manifest: unknown,
    eventId?: string
  ) => {
    const manifestRecord =
      manifest && typeof manifest === 'object'
        ? (manifest as Record<string, unknown>)
        : null;
    const fileHash =
      typeof manifestRecord?.fileHash === 'string'
        ? manifestRecord.fileHash
        : '';
    const resourceName =
      typeof manifestRecord?.fileName === 'string'
        ? manifestRecord.fileName
        : '';
    const resourceSize =
      typeof manifestRecord?.sizeBytes === 'number'
        ? manifestRecord.sizeBytes
        : 0;
    const shortHash = fileHash ? fileHash.slice(0, 12) : 'missing';
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      loggerLog(
        `[ReticulumResource] request_direct_resource_received conversation=${String(myAddress || '').slice(0, 8)}:${String(peerAddress || '').slice(0, 8)} file=${shortHash} size=${resourceSize} name=${resourceName || 'unknown'} event=${
          typeof eventId === 'string' && eventId ? eventId : 'none'
        }`
      );
      const result = await manager.requestDirectResource(
        myAddress,
        peerAddress,
        manifest as any,
        typeof eventId === 'string' && eventId ? eventId : undefined
      );
      if (result.ok) {
        loggerLog(
          `[ReticulumResource] request_direct_resource_accepted file=${shortHash}`
        );
        return { success: true };
      }
      const failed = result as Exclude<typeof result, { ok: true }>;
      loggerWarn(
        `[ReticulumResource] request_direct_resource_rejected file=${shortHash} reason=${
          failed.error ?? failed.reason ?? 'unknown'
        }`
      );
      return { success: false, error: failed.error ?? failed.reason };
    } catch (err) {
      loggerWarn(
        `[ReticulumResource] request_direct_resource_error file=${shortHash} reason=${
          err instanceof Error ? err.message : 'unknown'
        }`
      );
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum direct resource request failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumChat:cancelResource',
  async (_event, fileHash: string) => {
    const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
    if (!hash) return { success: false, error: 'Invalid file hash' };
    const manager = getReticulumChatManager();
    if (!manager) {
      return { success: false, error: 'Reticulum chat manager is not running' };
    }
    try {
      return { success: true, canceled: await manager.cancelResource(hash) };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource cancel failed',
      };
    }
  }
);

function managedReticulumChatResourceNamespace(value: unknown): string | null {
  const namespace = typeof value === 'string' ? value.trim() : '';
  return namespace === 'reticulum-group-resource' ||
    namespace === 'reticulum-dm-resource'
    ? namespace
    : null;
}

ipcMain.handle(
  'reticulumResource:convertGifToWebp',
  async (
    _event,
    payload: {
      filePath?: string;
      bytes?: Uint8Array | ArrayBuffer;
      fileName?: string;
      targetBytes?: number;
    }
  ) => {
    let inputPath =
      typeof payload?.filePath === 'string' && payload.filePath.trim()
        ? path.resolve(payload.filePath.trim())
        : '';
    const byteView = ArrayBuffer.isView(payload?.bytes)
      ? new Uint8Array(
          payload.bytes.buffer,
          payload.bytes.byteOffset,
          payload.bytes.byteLength
        )
      : payload?.bytes instanceof ArrayBuffer
        ? new Uint8Array(payload.bytes)
        : null;
    if (!inputPath && !byteView) {
      return { success: false, error: 'Invalid GIF input' };
    }

    const targetBytes = Math.min(
      4 * 1024 * 1024,
      Math.max(
        128 * 1024,
        Math.floor(Number(payload?.targetBytes) || 500 * 1024)
      )
    );
    const outputDir = path.join(app.getPath('temp'), 'qortal-reticulum-media');
    const outputPath = path.join(
      outputDir,
      `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webp`
    );
    const requestedFileName =
      typeof payload?.fileName === 'string' && payload.fileName.trim()
        ? path.basename(payload.fileName.trim())
        : '';
    let stagedInputPath = '';
    try {
      await fs.promises.mkdir(outputDir, { recursive: true });
      if (!inputPath && byteView) {
        if (
          byteView.byteLength <= 0 ||
          byteView.byteLength > 100 * 1024 * 1024
        ) {
          return {
            success: false,
            error: 'GIF must be between 1 byte and 100 MB',
          };
        }
        const header = byteView.subarray(0, 6);
        const isGif =
          header.length === 6 &&
          header[0] === 0x47 &&
          header[1] === 0x49 &&
          header[2] === 0x46 &&
          header[3] === 0x38 &&
          (header[4] === 0x37 || header[4] === 0x39) &&
          header[5] === 0x61;
        if (!isGif) {
          return { success: false, error: 'Clipboard image is not a GIF' };
        }
        stagedInputPath = path.join(
          outputDir,
          `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.gif`
        );
        await fs.promises.writeFile(stagedInputPath, byteView);
        inputPath = stagedInputPath;
      }
      const stat = await fs.promises.stat(inputPath);
      if (!stat.isFile())
        return { success: false, error: 'Selected GIF is not a file' };
      if (stat.size <= 0 || stat.size > 100 * 1024 * 1024) {
        return {
          success: false,
          error: 'GIF must be between 1 byte and 100 MB',
        };
      }
      const result = await reticulumMediaWorkerPool.run({
        kind: 'gif_to_webp',
        inputPath,
        outputPath,
        targetBytes,
      });
      if (!result || !result.ok) {
        await fs.promises.unlink(outputPath).catch(() => undefined);
        return {
          success: false,
          error:
            (result && 'error' in result ? result.error : undefined) ||
            'Animated WebP conversion is unavailable',
        };
      }
      const outputNameSource =
        requestedFileName || (stagedInputPath ? 'animation.gif' : inputPath);
      return {
        success: true,
        filePath: result.outputPath,
        fileName: `${
          path.basename(outputNameSource, path.extname(outputNameSource)) ||
          'animation'
        }.webp`,
        mimeType: 'image/webp',
        originalSizeBytes: stat.size,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        pages: result.pages,
        targetAchieved: result.targetAchieved,
      };
    } catch (err) {
      await fs.promises.unlink(outputPath).catch(() => undefined);
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Animated WebP conversion failed',
      };
    } finally {
      if (stagedInputPath) {
        await fs.promises.unlink(stagedInputPath).catch(() => undefined);
      }
    }
  }
);

ipcMain.handle(
  'reticulumResource:releaseConvertedMedia',
  async (_event, candidatePath: string) => {
    const mediaDir = path.resolve(
      path.join(app.getPath('temp'), 'qortal-reticulum-media')
    );
    const resolvedPath =
      typeof candidatePath === 'string' && candidatePath.trim()
        ? path.resolve(candidatePath.trim())
        : '';
    if (
      !resolvedPath ||
      (resolvedPath !== mediaDir &&
        !resolvedPath.startsWith(`${mediaDir}${path.sep}`))
    ) {
      return { success: false, error: 'Invalid converted media path' };
    }
    try {
      await fs.promises.unlink(resolvedPath);
      return { success: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT')
        return { success: true };
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'Converted media cleanup failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumResource:importBase64',
  async (
    _event,
    payload: {
      base64?: string;
      namespace?: string;
      ownerId?: string;
      fileName?: string;
      mimeType?: string;
      encrypted?: boolean;
      metadata?: Record<string, unknown>;
    }
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const base64 = normalizeBase64Payload(payload?.base64);
    if (!base64)
      return { success: false, error: 'Invalid base64 resource data' };
    const mimeType =
      typeof payload?.mimeType === 'string' && payload.mimeType.trim()
        ? payload.mimeType.trim()
        : 'application/octet-stream';
    const fileName =
      typeof payload?.fileName === 'string' && payload.fileName.trim()
        ? payload.fileName.trim()
        : 'resource.bin';
    const namespace = managedReticulumChatResourceNamespace(payload?.namespace);
    if (!namespace)
      return { success: false, error: 'Invalid chat resource namespace' };
    const tempDir = path.join(
      app.getPath('temp'),
      'qortal-reticulum-resource-imports'
    );
    const tempPath = path.join(
      tempDir,
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${path.basename(fileName)}`
    );
    try {
      await fs.promises.mkdir(tempDir, { recursive: true });
      await fs.promises.writeFile(tempPath, Buffer.from(base64, 'base64'));
      const manifest = await getReticulumResourceStore().importLocalFileAsync({
        sourcePath: tempPath,
        namespace,
        ownerId:
          typeof payload?.ownerId === 'string' && payload.ownerId.trim()
            ? payload.ownerId.trim()
            : undefined,
        fileName,
        mimeType,
        encrypted: payload?.encrypted === true,
        metadata:
          payload?.metadata && typeof payload.metadata === 'object'
            ? payload.metadata
            : undefined,
      });
      return { success: true, manifest };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource import failed',
      };
    } finally {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
  }
);

ipcMain.handle(
  'reticulumResource:importFilePath',
  async (
    _event,
    payload: {
      filePath?: string;
      namespace?: string;
      ownerId?: string;
      fileName?: string;
      mimeType?: string;
      encrypted?: boolean;
      metadata?: Record<string, unknown>;
    }
  ) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const sourcePath =
      typeof payload?.filePath === 'string' && payload.filePath.trim()
        ? path.resolve(payload.filePath.trim())
        : '';
    if (!sourcePath) return { success: false, error: 'Invalid file path' };
    try {
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile())
        return { success: false, error: 'Selected path is not a file' };
      const fileName =
        typeof payload?.fileName === 'string' && payload.fileName.trim()
          ? payload.fileName.trim()
          : path.basename(sourcePath);
      const mimeType =
        typeof payload?.mimeType === 'string' && payload.mimeType.trim()
          ? payload.mimeType.trim()
          : guessMimeTypeFromFileName(fileName);
      const namespace = managedReticulumChatResourceNamespace(
        payload?.namespace
      );
      if (!namespace)
        return { success: false, error: 'Invalid chat resource namespace' };
      const manifest = await getReticulumResourceStore().importLocalFileAsync({
        sourcePath,
        namespace,
        ownerId:
          typeof payload?.ownerId === 'string' && payload.ownerId.trim()
            ? payload.ownerId.trim()
            : undefined,
        fileName,
        mimeType,
        encrypted: payload?.encrypted === true,
        metadata:
          payload?.metadata && typeof payload.metadata === 'object'
            ? payload.metadata
            : undefined,
      });
      return { success: true, manifest };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource file import failed',
      };
    }
  }
);

ipcMain.handle('reticulumResource:getUrl', async (_event, fileHash: string) => {
  const settings = await readAppSettings();
  if (!isReticulumChatEffectivelyEnabled(settings)) {
    return { success: false, error: 'Reticulum chat is disabled' };
  }
  const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
  if (!hash) return { success: false, error: 'Invalid file hash' };
  try {
    const store = getReticulumResourceStore();
    const manifest = store.getManifest(hash);
    if (!manifest) return { success: false, error: 'Unknown resource' };
    const assembledPath =
      store.getVerifiedAssembledPath(hash) ??
      (await store.assembleResourceAsync(hash));
    if (!assembledPath)
      return { success: false, error: 'Resource not assembled' };
    store.acquireLease(hash, 'viewer', RETICULUM_RESOURCE_URL_TOKEN_TTL_MS);
    return {
      success: true,
      url: reticulumResourceUrl(hash),
      manifest,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : 'Reticulum resource URL failed',
    };
  }
});

ipcMain.handle('reticulumResource:getStorageStatus', async () => {
  try {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const store = getReticulumResourceStore();
    store.setStoragePolicy({
      limitBytes:
        Number(settings.reticulumResourceLimitBytes) ||
        RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES,
    });
    return { success: true, status: store.getStorageStatus() };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : 'Reticulum storage status failed',
    };
  }
});

ipcMain.handle('reticulumResource:cleanupStorage', async () => {
  try {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const store = getReticulumResourceStore();
    const result = await store.cleanupStorage('manual');
    return { success: true, result, status: store.getStorageStatus() };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : 'Reticulum storage cleanup failed',
    };
  }
});

ipcMain.handle(
  'reticulumResource:getStatus',
  async (_event, fileHash: string) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
    if (!hash) return { success: false, error: 'Invalid file hash' };
    try {
      const store = getReticulumResourceStore();
      const manifest = store.getManifest(hash);
      if (!manifest) return { success: false, error: 'Unknown resource' };
      const complete = Boolean(store.getVerifiedAssembledPath(hash));
      const completedBytes = complete
        ? manifest.sizeBytes
        : store.getCompletedBytes(hash);
      const latestRangeUpdatedAt = store.getLatestRangeUpdatedAt(hash);
      const runtime =
        getReticulumChatManager()?.getResourceDownloadStatus(hash) ?? null;
      const runtimeProgress =
        runtime && typeof runtime.progress === 'number'
          ? Math.max(0, Math.min(1, runtime.progress))
          : null;
      const totalBytes = Math.max(0, Number(manifest.sizeBytes || 0));
      const runtimeBytes =
        runtime && typeof runtime.bytesTransferred === 'number'
          ? Math.max(0, Math.min(totalBytes, runtime.bytesTransferred))
          : null;
      return {
        success: true,
        manifest,
        bytesTransferred: runtimeBytes ?? completedBytes,
        totalBytes,
        progress: Math.max(
          totalBytes > 0 ? Math.min(1, completedBytes / totalBytes) : 0,
          runtimeProgress ?? 0
        ),
        complete,
        latestRangeUpdatedAt: latestRangeUpdatedAt || null,
        checkedAt: Date.now(),
        runtime,
      };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Reticulum resource status failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumResource:saveAs',
  async (_event, fileHash: string, suggestedFileName?: string) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
    if (!hash) return { success: false, error: 'Invalid file hash' };
    try {
      const store = getReticulumResourceStore();
      const manifest = store.getManifest(hash);
      if (!manifest) return { success: false, error: 'Unknown resource' };
      const leaseId = store.acquireLease(hash, 'save', 60 * 60_000);
      try {
        const assembledPath =
          store.getVerifiedAssembledPath(hash) ??
          (await store.assembleResourceAsync(hash));
        const defaultPath = path.basename(
          typeof suggestedFileName === 'string' && suggestedFileName.trim()
            ? suggestedFileName.trim()
            : manifest.fileName || 'resource.bin'
        );
        const result = await dialog.showSaveDialog({ defaultPath });
        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }
        await fs.promises.mkdir(path.dirname(result.filePath), {
          recursive: true,
        });
        await pipeline(
          fs.createReadStream(assembledPath),
          fs.createWriteStream(result.filePath)
        );
        return { success: true, path: result.filePath };
      } finally {
        store.releaseLease(leaseId);
      }
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'Reticulum resource save failed',
      };
    }
  }
);

ipcMain.handle(
  'reticulumResource:open',
  async (_event, fileHash: string, suggestedFileName?: string) => {
    const settings = await readAppSettings();
    if (!isReticulumChatEffectivelyEnabled(settings)) {
      return { success: false, error: 'Reticulum chat is disabled' };
    }
    const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
    if (!hash) return { success: false, error: 'Invalid file hash' };
    try {
      const store = getReticulumResourceStore();
      const manifest = store.getManifest(hash);
      if (!manifest) return { success: false, error: 'Unknown resource' };
      const leaseId = store.acquireLease(hash, 'save', 60 * 60_000);
      try {
        const assembledPath =
          store.getVerifiedAssembledPath(hash) ??
          (await store.assembleResourceAsync(hash));
        const openPath = await materializeReticulumResourceForOpen({
          sourcePath: assembledPath,
          tempRoot: app.getPath('temp'),
          fileHash: hash,
          suggestedFileName,
          fallbackFileName: manifest.fileName || 'attachment.bin',
        });
        const openError = await shell.openPath(openPath);
        if (openError) {
          return { success: false, error: openError };
        }
        return { success: true };
      } finally {
        store.releaseLease(leaseId);
      }
    } catch (err) {
      loggerError('[Reticulum] Failed to open attachment:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unable to open attachment',
      };
    }
  }
);

async function readReticulumGroupState<T>(
  fallback: T,
  read: () => T | Promise<T>
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Local user is not a member of this group')
    ) {
      return fallback;
    }
    throw err;
  }
}

ipcMain.handle(
  'reticulumChat:getHistory',
  async (
    _event,
    groupId: number,
    channelIdOrLimit?: string | number,
    limitMaybe?: number,
    optionsMaybe?: unknown
  ) => {
    const manager = getReticulumChatManager();
    const channelId =
      typeof channelIdOrLimit === 'string' && channelIdOrLimit
        ? channelIdOrLimit
        : 'general';
    const limit =
      typeof channelIdOrLimit === 'number' ? channelIdOrLimit : limitMaybe;
    return manager
      ? readReticulumGroupState([], () =>
          manager.getHistory(
            groupId,
            channelId,
            limit,
            optionsMaybe as ReticulumChatHistoryReadOptions
          )
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getMessageHistory',
  async (
    _event,
    groupId: number,
    channelIdOrLimit?: string | number,
    limitMaybe?: number,
    optionsMaybe?: unknown
  ) => {
    const manager = getReticulumChatManager();
    const channelId =
      typeof channelIdOrLimit === 'string' && channelIdOrLimit
        ? channelIdOrLimit
        : 'general';
    const limit =
      typeof channelIdOrLimit === 'number' ? channelIdOrLimit : limitMaybe;
    return manager
      ? readReticulumGroupState([], () =>
          manager.getMessageHistory(
            groupId,
            channelId,
            limit,
            optionsMaybe as ReticulumChatHistoryReadOptions
          )
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getMessageHistoryPage',
  async (
    _event,
    groupId: number,
    channelId?: string,
    limit?: number,
    options?: unknown
  ) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState(
          {
            events: [],
            oldestCursor: null,
            newestCursor: null,
            hasMore: false,
          },
          () =>
            manager.getMessageHistoryPage(
              groupId,
              channelId || 'general',
              limit,
              options as ReticulumChatHistoryReadOptions
            )
        )
      : {
          events: [],
          oldestCursor: null,
          newestCursor: null,
          hasMore: false,
        };
  }
);

ipcMain.handle(
  'reticulumChat:getDiscussionIndex',
  async (_event, groupId: number, channelId?: string) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState({ replyCounts: {}, rootByEventId: {} }, () =>
          manager.getDiscussionIndex(groupId, channelId || 'general')
        )
      : { replyCounts: {}, rootByEventId: {} };
  }
);

ipcMain.handle(
  'reticulumChat:getDiscussionMessages',
  async (_event, groupId: number, channelId: string, eventId: string) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState([], () =>
          manager.getDiscussionMessages(groupId, channelId, eventId)
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getChannelMetadataHistory',
  async (_event, groupId: number, limit?: number) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState([], () =>
          manager.getChannelMetadataHistory(groupId, limit)
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getChannels',
  async (_event, groupId: number, includeArchived?: boolean) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState([], () =>
          manager.getChannels(groupId, includeArchived === true)
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getCategories',
  async (_event, groupId: number) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState([], () => manager.getCategories(groupId))
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getChannelMetadataBundle',
  async (_event, groupId: number, includeArchived?: boolean) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState(
          {
            channels: [],
            categories: [],
            ready: false,
            snapshotVersion: 0,
          },
          () =>
            manager.getChannelMetadataBundle(groupId, includeArchived === true)
        )
      : {
          channels: [],
          categories: [],
          ready: false,
          snapshotVersion: 0,
        };
  }
);

ipcMain.handle(
  'reticulumChat:applyChannelMetadata',
  async (_event, eventId: string, payload: unknown) => {
    if (typeof eventId !== 'string' || !eventId) return { success: false };
    const manager = getReticulumChatManager();
    const applied = manager
      ? await manager.applyChannelMetadataEvent(eventId, payload)
      : await applyReticulumChatChannelMetadataInDb(eventId, payload);
    return { success: applied };
  }
);

ipcMain.handle(
  'reticulumChat:getSyncState',
  async (_event, groupId: number) => {
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState({}, () => manager.getSyncState(groupId))
      : {};
  }
);

ipcMain.handle(
  'reticulumChat:getSummaries',
  async (_event, myAddress?: string) => {
    const manager = getReticulumChatManager();
    const address = typeof myAddress === 'string' ? myAddress : '';
    return manager
      ? manager.getChatSummaries(address, RETICULUM_CHAT_ONLINE_SINCE_MS)
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:search',
  async (
    _event,
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
  ) => {
    const safeQuery = typeof query === 'string' ? query : '';
    const safeOptions = options && typeof options === 'object' ? options : {};
    const manager = getReticulumChatManager();
    return manager ? manager.searchEvents(safeQuery, safeOptions) : [];
  }
);

ipcMain.handle(
  'reticulumChat:getMessageWindowAroundEvent',
  async (
    _event,
    groupId: number,
    channelId: string,
    eventId: string,
    options?: {
      beforeLimit?: number;
      afterLimit?: number;
    }
  ) => {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState([], () =>
          manager.getMessageWindowAroundEvent(
            groupId,
            channelId,
            eventId,
            safeOptions
          )
        )
      : [];
  }
);

ipcMain.handle(
  'reticulumChat:getMessageWindowPageAroundEvent',
  async (
    _event,
    groupId: number,
    channelId: string,
    eventId: string,
    options?: {
      beforeLimit?: number;
      afterLimit?: number;
    }
  ) => {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const manager = getReticulumChatManager();
    return manager
      ? readReticulumGroupState(
          {
            events: [],
            oldestCursor: null,
            newestCursor: null,
            hasOlder: false,
            hasNewer: false,
          },
          () =>
            manager.getMessageWindowPageAroundEvent(
              groupId,
              channelId,
              eventId,
              safeOptions
            )
        )
      : {
          events: [],
          oldestCursor: null,
          newestCursor: null,
          hasOlder: false,
          hasNewer: false,
        };
  }
);

ipcMain.handle(
  'reticulumChat:indexSearchText',
  async (_event, eventId: string, text: string) => {
    if (typeof eventId !== 'string' || typeof text !== 'string') {
      return { success: false };
    }
    const manager = getReticulumChatManager();
    const indexed = manager
      ? manager.indexSearchText(eventId, text)
      : indexReticulumChatSearchTextInDb(eventId, text);
    return { success: indexed };
  }
);

ipcMain.handle(
  'reticulumChat:deleteSearchText',
  async (_event, eventId: string) => {
    if (typeof eventId !== 'string') {
      return { success: false };
    }
    const manager = getReticulumChatManager();
    const deleted = manager
      ? manager.deleteSearchText(eventId)
      : deleteReticulumChatSearchTextInDb(eventId);
    return { success: deleted };
  }
);

ipcMain.handle(
  'reticulumChat:replaceMentions',
  async (_event, eventId: string, mentionedAddresses: string[]) => {
    if (typeof eventId !== 'string' || !Array.isArray(mentionedAddresses)) {
      return { success: false };
    }
    const manager = getReticulumChatManager();
    const replaced = manager
      ? manager.replaceMentionsForEvent(eventId, mentionedAddresses)
      : replaceReticulumChatMentionsInDb(eventId, mentionedAddresses);
    return { success: replaced };
  }
);

ipcMain.handle(
  'reticulumChat:deleteMentions',
  async (_event, eventId: string) => {
    if (typeof eventId !== 'string') {
      return { success: false };
    }
    const manager = getReticulumChatManager();
    const deleted = manager
      ? manager.deleteMentionsForEvent(eventId)
      : deleteReticulumChatMentionsInDb(eventId);
    return { success: deleted };
  }
);

ipcMain.handle(
  'reticulumChat:markRead',
  async (
    _event,
    groupId: number,
    channelIdOrTimestamp: string | number,
    upToTimestamp?: string | number,
    myAddress?: string
  ) => {
    const channelId =
      typeof channelIdOrTimestamp === 'string'
        ? channelIdOrTimestamp
        : 'general';
    const timestamp =
      typeof channelIdOrTimestamp === 'number'
        ? channelIdOrTimestamp
        : Number(upToTimestamp);
    const address =
      typeof channelIdOrTimestamp === 'number'
        ? typeof upToTimestamp === 'string'
          ? upToTimestamp
          : myAddress
        : myAddress;
    const normalizedAddress = typeof address === 'string' ? address : '';
    const manager = getReticulumChatManager();
    if (manager) {
      manager.markRead(groupId, channelId, timestamp, normalizedAddress);
    } else {
      markReticulumChatReadInDb(
        groupId,
        channelId,
        timestamp,
        normalizedAddress
      );
    }
    return { success: true };
  }
);

ipcMain.handle(
  'reticulumChat:markGroupsRead',
  async (_event, groupIds: number[], myAddress?: string) => {
    const manager = getReticulumChatManager();
    if (!manager) {
      return {
        success: false,
        error: 'Reticulum chat is unavailable',
        groupsMarked: 0,
        channelsMarked: 0,
      };
    }
    const normalizedGroupIds = Array.isArray(groupIds)
      ? groupIds
          .map((groupId) => Number(groupId))
          .filter((groupId) => Number.isInteger(groupId) && groupId > 0)
      : [];
    const address = typeof myAddress === 'string' ? myAddress.trim() : '';
    const result = manager.markGroupsRead(normalizedGroupIds, address);
    return { success: true, ...result };
  }
);

ipcMain.handle('reticulumChat:getSubscriptions', async () => {
  const manager = getReticulumChatManager();
  return manager ? manager.getSubscriptions() : [];
});

ipcMain.handle(
  'reticulumChat:updateMentionBadge',
  async (_event, mentionCount: number) => {
    const count = typeof mentionCount === 'number' ? mentionCount : 0;
    myCapacitorApp.updateReticulumChatMentionBadge(count);
    return { success: true };
  }
);

ipcMain.on('reticulumChat:event:subscribe', (event) => {
  reticulumChatEventSubscription.subscribe(event.sender);
});
ipcMain.on('reticulumChat:event:unsubscribe', (event) => {
  reticulumChatEventSubscription.unsubscribe(event.sender);
});
ipcMain.on('reticulumChat:readinessChanged:subscribe', (event) => {
  reticulumChatReadinessSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:readinessChanged:unsubscribe', (event) => {
  reticulumChatReadinessSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:typing:subscribe', (event) => {
  reticulumChatTypingSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:typing:unsubscribe', (event) => {
  reticulumChatTypingSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:landState:subscribe', (event) => {
  reticulumChatLandStateSubscription.subscribe(event.sender);
});
ipcMain.on('reticulumChat:landState:unsubscribe', (event) => {
  reticulumChatLandStateSubscription.unsubscribe(event.sender);
});
ipcMain.on('reticulumChat:landChat:subscribe', (event) => {
  reticulumChatLandChatSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:landChat:unsubscribe', (event) => {
  reticulumChatLandChatSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:landAction:subscribe', (event) => {
  reticulumChatLandActionSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:landAction:unsubscribe', (event) => {
  reticulumChatLandActionSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:landCall:subscribe', (event) => {
  reticulumChatLandCallSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:landCall:unsubscribe', (event) => {
  reticulumChatLandCallSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:summaryChanged:subscribe', (event) => {
  reticulumChatSummarySubscription.subscribe(event.sender);
});
ipcMain.on('reticulumChat:summaryChanged:unsubscribe', (event) => {
  reticulumChatSummarySubscription.unsubscribe(event.sender);
});
ipcMain.on('reticulumChat:directEvent:subscribe', (event) => {
  reticulumDirectEventSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:directEvent:unsubscribe', (event) => {
  reticulumDirectEventSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:directCallHistory:subscribe', (event) => {
  reticulumDirectCallHistorySubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:directCallHistory:unsubscribe', (event) => {
  reticulumDirectCallHistorySubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:directTyping:subscribe', (event) => {
  reticulumDirectTypingSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:directTyping:unsubscribe', (event) => {
  reticulumDirectTypingSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:directSummaryChanged:subscribe', (event) => {
  reticulumDirectSummarySubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:directSummaryChanged:unsubscribe', (event) => {
  reticulumDirectSummarySubscribers.delete(event.sender);
});

ipcMain.on('reticulumChat:resource:subscribe', (event) => {
  reticulumChatResourceSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:resource:unsubscribe', (event) => {
  reticulumChatResourceSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:silenceChanged:subscribe', (event) => {
  reticulumChatSilenceSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:silenceChanged:unsubscribe', (event) => {
  reticulumChatSilenceSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:calendarChanged:subscribe', (event) => {
  reticulumCalendarSubscribers.add(event.sender);
});
ipcMain.on('reticulumChat:calendarChanged:unsubscribe', (event) => {
  reticulumCalendarSubscribers.delete(event.sender);
});
ipcMain.on('reticulumChat:calendarReminderDue:subscribe', (event) => {
  reticulumCalendarReminderSubscribers.add(event.sender);
  if (pendingReticulumCalendarReminders.length === 0) return;
  const pending = pendingReticulumCalendarReminders.splice(0);
  const now = Date.now();
  for (const item of pending) {
    if (now - item.queuedAt > RETICULUM_CALENDAR_REMINDER_STARTUP_GRACE_MS) {
      continue;
    }
    if (
      sendToRenderer(
        event.sender,
        'reticulumChat:calendarReminderDue',
        item.payload
      ) !== 'sent'
    ) {
      pendingReticulumCalendarReminders.push(item);
    }
  }
});
ipcMain.on('reticulumChat:calendarReminderDue:unsubscribe', (event) => {
  reticulumCalendarReminderSubscribers.delete(event.sender);
});

/**
 * Send a signed ChatEventEnvelope from the local renderer.
 * The renderer must have already signed the event before calling this.
 */
ipcMain.handle('chat:sendEvent', async (_event, envelope: unknown) => {
  const cm = getChatManager();
  if (!cm) return { success: false, error: 'Chat manager is not running' };
  try {
    const ok = await cm.handleLocalEvent(envelope);
    return { success: ok };
  } catch (err) {
    loggerError('[Chat] sendEvent error:', err);
    return { success: false, error: (err as Error).message };
  }
});

/** Subscribe the local user to a chat and request sync from peers. */
ipcMain.handle('chat:subscribe', async (_event, chatId: string) => {
  const cm = getChatManager();
  if (!cm) return { success: false, error: 'Chat manager is not running' };
  cm.subscribeToChat(chatId);
  return { success: true };
});

/** Unsubscribe the local user from a chat. */
ipcMain.handle('chat:unsubscribe', async (_event, chatId: string) => {
  const cm = getChatManager();
  if (!cm) return { success: false, error: 'Chat manager is not running' };
  cm.unsubscribeFromChat(chatId);
  return { success: true };
});

/**
 * Broadcast a typing indicator.
 * authorAddress is the sender's Qortal address.
 */
ipcMain.handle(
  'chat:sendTyping',
  async (_event, chatId: string, authorAddress: string) => {
    const cm = getChatManager();
    if (!cm) return { success: false, error: 'Chat manager is not running' };
    cm.sendTyping(chatId, authorAddress);
    return { success: true };
  }
);

/**
 * Retrieve message history for a chat.
 * `beforeTimestamp` enables reverse-scroll pagination.
 */
ipcMain.handle(
  'chat:getHistory',
  async (_event, chatId: string, limit: number, beforeTimestamp?: number) => {
    const cm = getChatManager();
    if (!cm) return [];
    return cm.getHistory(chatId, limit, beforeTimestamp);
  }
);

/** Returns summaries of all known chats (last message + unread count). */
ipcMain.handle('chat:getSummaries', async () => {
  const cm = getChatManager();
  return cm ? cm.getChatSummaries() : [];
});

/**
 * Advance the read watermark for a chat.
 * All events with timestamp ≤ upToTimestamp are considered read.
 */
ipcMain.handle(
  'chat:markRead',
  async (_event, chatId: string, upToTimestamp: number) => {
    const cm = getChatManager();
    cm?.markRead(chatId, upToTimestamp);
    return { success: true };
  }
);

/**
 * Register the local user's Qortal address so the chat manager can
 * auto-accept incoming DMs addressed to them.
 * Call when the user logs in; call with [] when they log out.
 */
ipcMain.handle(
  'chat:setLocalAddresses',
  async (_event, addresses: string[]) => {
    const cm = getChatManager();
    if (!cm) return { success: false, error: 'Chat manager is not running' };
    cm.setLocalAddresses(Array.isArray(addresses) ? addresses : []);
    return { success: true };
  }
);

/**
 * Clear the support-queue rate-limit map.
 * Called when an agent logs out so re-knocks are not silently dropped
 * when the agent logs back in.
 */
ipcMain.handle('chat:clearQueueRateLimit', async () => {
  const cm = getChatManager();
  if (cm) cm.clearQueueRateLimit();
  return { success: true };
});

/** Returns the list of chatIds the local node is currently subscribed to. */
ipcMain.handle('chat:getSubscriptions', async () => {
  const cm = getChatManager();
  return cm ? cm.getLocalSubscriptions() : [];
});

ipcMain.on('chat:event:subscribe', (event) => {
  chatEventSubscribers.add(event.sender);
});
ipcMain.on('chat:event:unsubscribe', (event) => {
  chatEventSubscribers.delete(event.sender);
});

ipcMain.on('chat:typing:subscribe', (event) => {
  chatTypingSubscribers.add(event.sender);
});
ipcMain.on('chat:typing:unsubscribe', (event) => {
  chatTypingSubscribers.delete(event.sender);
});

/**
 * Persist and broadcast a batch of read receipts.
 * `eventIds` are the IDs of events the local user has seen.
 */
ipcMain.handle(
  'chat:sendReadReceipt',
  async (_event, chatId: string, eventIds: string[], readerAddress: string) => {
    const cm = getChatManager();
    if (!cm) return { success: false, error: 'Chat manager is not running' };
    if (
      typeof chatId !== 'string' ||
      !Array.isArray(eventIds) ||
      typeof readerAddress !== 'string'
    ) {
      return { success: false, error: 'Invalid arguments' };
    }
    cm.sendReadReceipt(chatId, eventIds, readerAddress);
    return { success: true };
  }
);

/**
 * Query-scoped receipt loading.
 * Returns receipts only for the provided event IDs — callers pass the IDs
 * currently held in renderer memory so the result is bounded by the
 * history page size rather than the total message count.
 * Returns Record<eventId, readerAddress[]>.
 */
ipcMain.handle(
  'chat:getReadReceipts',
  async (_event, chatId: string, eventIds: string[]) => {
    const cm = getChatManager();
    if (!cm) return {};
    if (typeof chatId !== 'string' || !Array.isArray(eventIds)) return {};
    return cm.store.getReadReceiptsForEvents(eventIds);
  }
);

ipcMain.on('chat:read:subscribe', (event) => {
  chatReadSubscribers.add(event.sender);
});
ipcMain.on('chat:read:unsubscribe', (event) => {
  chatReadSubscribers.delete(event.sender);
});

/**
 * Fetch the encrypted attachment blob for a given event.
 * Returns the base64 ciphertext string, or null when the attachment is not
 * present locally (event was received via sync without attachment data).
 */
ipcMain.handle('chat:getAttachment', async (_event, eventId: string) => {
  const cm = getChatManager();
  if (!cm) return null;
  if (typeof eventId !== 'string' || !eventId) return null;
  return cm.store.getAttachment(eventId);
});

// ── Call IPC Handlers ─────────────────────────────────────────────────────────

const callSubscribers = new Set<Electron.WebContents>();

ipcMain.handle('screenShare:listSources', async (event) => {
  if (!isMainShellSender(event.sender)) {
    return { success: false, error: 'Main shell required', sources: [] };
  }
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 240, height: 135 },
      fetchWindowIcons: true,
    });
    return {
      success: true,
      sources: sources.slice(0, 60).map((source) => ({
        id: source.id,
        name: source.name.slice(0, 160),
        thumbnail: source.thumbnail.isEmpty()
          ? ''
          : source.thumbnail.toDataURL(),
        appIcon:
          source.appIcon && !source.appIcon.isEmpty()
            ? source.appIcon.resize({ width: 24, height: 24 }).toDataURL()
            : '',
      })),
    };
  } catch (error) {
    loggerWarn('[ScreenShare] Failed to enumerate capture sources', {
      platform: process.platform,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: 'Unable to access screens and windows',
      sources: [],
    };
  }
});

export function attachCallListeners(
  manager: ReturnType<typeof getCallManager>
): void {
  if (!manager) return;

  manager.setDmCallLinkControlSender(async (input) => {
    const groupCallManager = getGroupCallManager();
    if (!groupCallManager) {
      return { success: false, error: 'GroupCall manager not running' };
    }
    return groupCallManager.sendDmCallLinkControl(input);
  });

  const forward = (channel: string) => (payload: unknown) =>
    broadcastToSet(callSubscribers, channel, payload);

  manager.on('call:incoming', forward('call:incoming'));
  manager.on('call:accepted', forward('call:accepted'));
  manager.on('call:rejected', forward('call:rejected'));
  manager.on('call:hangup', forward('call:hangup'));
  manager.on('call:rtc-signal', (payload: unknown) => {
    for (const webContents of callSubscribers) {
      if (!webContents.isDestroyed() && isMainShellSender(webContents)) {
        webContents.send('call:rtc-signal', payload);
      }
    }
  });
  manager.on('call:history', (payload: unknown) => {
    void getReticulumChatManager()?.recordDirectCallHistory(payload as any);
  });
}

ipcMain.handle(
  'call:initiate',
  async (
    _event,
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
  ) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    const resultCallId = await mgr.initiateCall(
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
    );
    return resultCallId
      ? { success: true, callId: resultCallId }
      : { success: false, error: 'Target offline' };
  }
);

ipcMain.handle(
  'call:accept',
  async (
    _event,
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    return mgr.acceptCall(callId, signature, publicKey, timestamp)
      ? { success: true }
      : { success: false, error: 'Call is no longer ringing' };
  }
);

ipcMain.handle(
  'call:reject',
  async (
    _event,
    callId: string,
    reason?: string,
    signature?: string,
    publicKey?: string,
    timestamp?: number,
    reasonSignature?: string
  ) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    mgr.rejectCall(
      callId,
      reason,
      signature,
      publicKey,
      timestamp,
      reasonSignature
    );
    return { success: true };
  }
);

ipcMain.handle(
  'call:hangup',
  async (
    _event,
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    await mgr.hangUp(callId, signature, publicKey, timestamp);
    return { success: true };
  }
);

ipcMain.handle(
  'call:rtc-signal',
  async (
    _event,
    input: {
      callId: string;
      generation: string;
      signalId: string;
      signalType: 'capability' | 'offer' | 'answer' | 'candidate';
      payload: string;
      payloadHash: string;
      timestamp: number;
      signature: string;
      publicKey: string;
    }
  ) => {
    if (!isMainShellSender(_event.sender)) {
      return { success: false, error: 'Main shell required' };
    }
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    return mgr.sendRtcSignal(input);
  }
);

ipcMain.handle(
  'call:setLocalAddresses',
  async (_event, addresses: string[]) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    mgr.setLocalAddresses(Array.isArray(addresses) ? addresses : []);
    return { success: true };
  }
);

ipcMain.on('call:subscribe', (event) => {
  callSubscribers.add(event.sender);
  const mgr = getCallManager();
  if (!mgr || event.sender.isDestroyed()) return;
  for (const p of mgr.getPendingInboundRingingPayloads()) {
    event.sender.send('call:incoming', p);
  }
  for (const p of mgr.getActiveOutboundAcceptedPayloads()) {
    event.sender.send('call:accepted', p);
  }
});
ipcMain.on('call:unsubscribe', (event) => {
  callSubscribers.delete(event.sender);
});

// ── Group Call IPC Handlers ───────────────────────────────────────────────────

const gcallSubscribers = new Set<Electron.WebContents>();
/** Sidebar / list: lightweight `gcall:qortal-group-call-activity` only (no full GC_* stream). */
const gcallActivitySubscribers = new Set<Electron.WebContents>();

/** Throttled [GCall:main] logs for gcall:audio (manager received → IPC forward). */
let gcallMainFirstAudio = false;
let gcallMainAudioCountWindow = 0;
let gcallMainAudioWindowT0 = 0;
const GCALL_MAIN_AUDIO_LOG_MS = 2000;

function gcallAudioPayloadBytes(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

function withGcallAudioMainFanoutTimestamp(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const existingStage =
    record.audioStageTimestamps &&
    typeof record.audioStageTimestamps === 'object' &&
    !Array.isArray(record.audioStageTimestamps)
      ? (record.audioStageTimestamps as Record<string, unknown>)
      : {};
  return {
    ...record,
    audioStageTimestamps: {
      ...existingStage,
      bridgeReceivedAtWallMs:
        typeof record.bridgeReceivedAtWallMs === 'number' &&
        record.bridgeReceivedAtWallMs > 0
          ? record.bridgeReceivedAtWallMs
          : existingStage.bridgeReceivedAtWallMs,
      mainFanoutAtWallMs: Date.now(),
    },
  };
}

export function attachGroupCallListeners(
  manager: ReturnType<typeof getGroupCallManager>
): void {
  if (!manager) return;

  const forward = (channel: string) => (payload: unknown) =>
    broadcastToSet(gcallSubscribers, channel, payload);

  manager.on('gcall:participant-joined', forward('gcall:participant-joined'));
  manager.on('gcall:participant-left', forward('gcall:participant-left'));
  manager.on(
    'gcall:local-session-taken-over',
    forward('gcall:local-session-taken-over')
  );
  manager.on('gcall:topology', forward('gcall:topology'));
  manager.on('gcall:cluster-heartbeat', forward('gcall:cluster-heartbeat'));
  manager.on('gcall:heartbeat', forward('gcall:heartbeat'));
  manager.on('gcall:audio', (payload: unknown) => {
    gcallMainAudioCountWindow += 1;
    const now = Date.now();
    if (gcallMainAudioWindowT0 === 0) gcallMainAudioWindowT0 = now;
    if (!gcallMainFirstAudio) {
      gcallMainFirstAudio = true;
      const p0 = payload as {
        roomId?: string;
        fromAddress?: string;
        data?: unknown;
      };
      loggerLog(
        `[GCall:main] gcall:audio first from manager roomId=${p0?.roomId} from=${p0?.fromAddress} bytes~=${gcallAudioPayloadBytes(p0?.data)} → ${gcallSubscribers.size} IPC subscriber(s)`
      );
    }
    if (now - gcallMainAudioWindowT0 >= GCALL_MAIN_AUDIO_LOG_MS) {
      const p = payload as {
        roomId?: string;
        fromAddress?: string;
        data?: unknown;
      };
      loggerLog(
        `[GCall:main] gcall:audio throttled: ${gcallMainAudioCountWindow} pkt in ~${now - gcallMainAudioWindowT0}ms roomId=${p?.roomId} from=${p?.fromAddress} bytes~=${gcallAudioPayloadBytes(p?.data)} subs=${gcallSubscribers.size}`
      );
      gcallMainAudioCountWindow = 0;
      gcallMainAudioWindowT0 = now;
    }
    broadcastToSet(
      gcallSubscribers,
      'gcall:audio',
      withGcallAudioMainFanoutTimestamp(payload)
    );
  });
  manager.on('gcall:key', (payload: unknown) => {
    const p = payload as {
      roomId?: string;
      fromAddress?: string;
      verified?: boolean;
    };
    loggerLog(
      `[GCall:main] gcall:key from manager roomId=${p?.roomId} from=${p?.fromAddress} verified=${p?.verified} → ${gcallSubscribers.size} subscriber(s)`
    );
    broadcastToSet(gcallSubscribers, 'gcall:key', payload);
  });
  manager.on('gcall:key-request', forward('gcall:key-request'));
  manager.on('gcall:session-updated', forward('gcall:session-updated'));
  manager.on('gcall:rtc-signal', forward('gcall:rtc-signal'));
  manager.on('gcall:dm-call-control', (payload: unknown) => {
    const control = payload as DmCallLinkControlInput & {
      verifiedPeerDestinationHash: string;
    };
    const callManager = getCallManager();
    if (!callManager) return;
    const callPayload: DmCallLinkControlPayload = {
      kind: control.kind,
      callId: control.callId,
      chatId: control.chatId,
      controlId: control.controlId,
      fromAddress: control.fromAddress,
      toAddress: control.toAddress,
      timestamp: control.timestamp,
      publicKey: control.publicKey,
      signature: control.signature,
      verifiedPeerDestinationHash: control.verifiedPeerDestinationHash,
    };
    if (control.kind === 'hangup-ack') {
      callManager.acknowledgeDmCallLinkHangup(callPayload);
      return;
    }
    void callManager.handleDmCallLinkHangup(callPayload, (ack) =>
      manager.sendDmCallLinkControl(ack)
    );
  });
  manager.on('gcall:qortal-group-call-activity', (payload: unknown) =>
    broadcastToSet(
      gcallActivitySubscribers,
      'gcall:qortal-group-call-activity',
      payload
    )
  );
}

ipcMain.handle(
  'gcall:join',
  async (_event, ...args: GroupCallJoinIpcArguments) => {
    const [
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
      joinRkSignature,
      dmVoiceAudioLinkRole,
      takeover,
      dmVoicePeerDestinationHash,
      dmVoiceCallId,
    ] = args;
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    try {
      const isDirectVoiceRoom =
        roomId.startsWith('dmv:') && chatId.startsWith('direct:');
      const authenticatedCallDestination = isDirectVoiceRoom
        ? (getCallManager()?.getActiveMediaPeerDestinationHash(
            chatId,
            localAddress,
            dmVoiceCallId
          ) ?? null)
        : null;
      const authenticatedLandCallDestination =
        isDirectVoiceRoom && dmVoiceCallId
          ? (getReticulumChatManager()?.getActiveLandCallMediaPeerDestinationHash(
              chatId,
              localAddress,
              dmVoiceCallId
            ) ?? null)
          : null;
      const authenticatedMediaDestination =
        authenticatedCallDestination ?? authenticatedLandCallDestination;
      // Current direct-call clients always provide a call id. When they do,
      // never downgrade to a renderer or account-presence route: wait for an
      // exact main-process authenticated call record instead.
      if (
        isDirectVoiceRoom &&
        dmVoiceCallId &&
        !authenticatedMediaDestination
      ) {
        throw new Error('unverified_dm_voice_peer_destination');
      }
      const selectedDmVoicePeerDestinationHash =
        authenticatedMediaDestination ?? dmVoicePeerDestinationHash;
      const session = mgr.joinRoom(
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
        joinRkSignature,
        dmVoiceAudioLinkRole,
        takeover,
        selectedDmVoicePeerDestinationHash,
        Boolean(authenticatedMediaDestination),
        authenticatedMediaDestination ? dmVoiceCallId : undefined
      );
      return {
        success: true,
        callSessionId: session.callSessionId,
        mediaSessionGeneration: session.mediaSessionGeneration,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'gcall:leave',
  async (
    _event,
    roomId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    joinGeneration?: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.leaveRoom(
      roomId,
      localAddress,
      signature,
      publicKey,
      timestamp,
      joinGeneration
    );
    return { success: true };
  }
);

ipcMain.on(
  'gcall:leaveSync',
  (
    event,
    roomId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    joinGeneration?: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) {
      event.returnValue = {
        success: false,
        error: 'GroupCall manager not running',
      };
      return;
    }
    mgr.leaveRoom(
      roomId,
      localAddress,
      signature,
      publicKey,
      timestamp,
      joinGeneration
    );
    event.returnValue = { success: true };
  }
);

ipcMain.handle(
  'gcall:broadcastTopology',
  async (
    _event,
    roomId: string,
    topology: unknown,
    signature: string,
    publicKey: string,
    timestamp: number,
    localAuthorityProvisional = false
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.broadcastTopology(
      roomId,
      topology as any,
      signature,
      publicKey,
      timestamp,
      localAuthorityProvisional
    );
    return { success: true };
  }
);

ipcMain.handle(
  'gcall:sendClusterHeartbeat',
  async (
    _event,
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
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.sendClusterHeartbeat(roomId, payload, signature);
    return { success: true };
  }
);

ipcMain.handle(
  'gcall:sendRtcSignal',
  async (_event, input: import('./group-call').GroupCallRtcSignalInput) => {
    const fromAudioSurface = isAudioSurfaceHostSender(_event.sender);
    const fromMainShell = isMainShellSender(_event.sender);
    const isDirectVoiceRoom =
      typeof input?.roomId === 'string' && input.roomId.startsWith('dmv:');
    if (!fromAudioSurface && !(fromMainShell && isDirectVoiceRoom)) {
      return {
        success: false,
        error: isDirectVoiceRoom
          ? 'Main shell or audio surface required'
          : 'Audio surface required',
      };
    }
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    return await mgr.sendRtcSignal(input);
  }
);

ipcMain.handle(
  'gcall:sendAudio',
  async (
    _event,
    roomId: string,
    toAddress: string,
    data: Buffer | Uint8Array,
    timing?: { rendererSendAtWallMs?: number }
  ) => {
    return runMainPressureTask(
      'gcall.sendAudio',
      {
        roomId,
        targetCount: 1,
        bytes: Buffer.isBuffer(data) ? data.length : data?.byteLength,
      },
      () => {
        const mgr = getGroupCallManager();
        if (!mgr)
          return { success: false, error: 'GroupCall manager not running' };
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        attachGroupAudioIpcTiming(buf, timing, {
          channel: 'sendAudio',
          roomId,
          targetCount: 1,
        });
        const GCALL_IPC_SEND_AUDIO_MAX_BYTES = 12_288;
        if (buf.length > GCALL_IPC_SEND_AUDIO_MAX_BYTES) {
          return { success: false, error: 'payload-too-large' };
        }
        const result = mgr.sendAudio(roomId, toAddress, buf);
        if (result.success) {
          return { success: true, diagnostics: result.diagnostics };
        }
        return {
          success: false,
          error:
            ('error' in result ? result.error : undefined) ?? 'relay-rejected',
          diagnostics: result.diagnostics,
        };
      }
    );
  }
);

ipcMain.handle(
  'gcall:sendAudioBatch',
  async (
    _event,
    roomId: string,
    toAddresses: string[],
    data: Buffer | Uint8Array,
    timing?: { rendererSendAtWallMs?: number }
  ) => {
    return runMainPressureTask(
      'gcall.sendAudioBatch',
      {
        roomId,
        targetCount: Array.isArray(toAddresses) ? toAddresses.length : 0,
        bytes: Buffer.isBuffer(data) ? data.length : data?.byteLength,
      },
      () => {
        const mgr = getGroupCallManager();
        if (!mgr)
          return { success: false, error: 'GroupCall manager not running' };
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        attachGroupAudioIpcTiming(buf, timing, {
          channel: 'sendAudioBatch',
          roomId,
          targetCount: Array.isArray(toAddresses) ? toAddresses.length : 0,
        });
        const GCALL_IPC_SEND_AUDIO_MAX_BYTES = 12_288;
        if (buf.length > GCALL_IPC_SEND_AUDIO_MAX_BYTES) {
          return { success: false, error: 'payload-too-large' };
        }
        if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
          return { success: true, diagnostics: undefined };
        }
        const result = mgr.sendAudioBatch(roomId, toAddresses, buf);
        if (result.success) {
          return { success: true, diagnostics: result.diagnostics };
        }
        return {
          success: false,
          error:
            ('error' in result ? result.error : undefined) ?? 'relay-rejected',
          diagnostics: result.diagnostics,
        };
      }
    );
  }
);

ipcMain.handle(
  'gcall:getAudioDataPlaneSession',
  async (_event, roomId: string, toAddresses: string[]) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { ok: false, reason: 'manager-unavailable' };
    if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
      return { ok: false, reason: 'no-targets' };
    }
    const result = await mgr.getAudioDataPlaneSession(roomId, toAddresses);
    return result;
  }
);

ipcMain.handle(
  'gcall:requestPeerMediaRecovery',
  async (_event, roomId: string, address: string, reason: string) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.requestPeerMediaRecovery(roomId, address, reason);
    return { success: true };
  }
);

ipcMain.handle(
  'gcall:reportGcallAudioEscalation',
  async (_event, opts: { failSafeActive?: boolean }) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.reportGcallAudioEscalation(opts ?? {});
    return { success: true };
  }
);

ipcMain.handle('gcall:getLinkStats', async (_event, roomId: string) => {
  const mgr = getGroupCallManager();
  if (!mgr) return { success: false, error: 'GroupCall manager not running' };
  return {
    success: true,
    stats: mgr.getReticulumAudioLinkStats(roomId),
  };
});

ipcMain.handle(
  'gcall:sendKey',
  async (
    _event,
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
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    return mgr.sendKey(
      roomId,
      toAddress,
      encryptedKey,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      meta
    );
  }
);

ipcMain.handle(
  'gcall:sendKeyRequest',
  async (
    _event,
    roomId: string,
    toAddress: string,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    callSessionId: string,
    mediaSessionGeneration: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.sendKeyRequest(
      roomId,
      toAddress,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      callSessionId,
      mediaSessionGeneration
    );
    return { success: true };
  }
);

ipcMain.handle('gcall:requestSessionBreak', async (_event, roomId: string) => {
  const mgr = getGroupCallManager();
  if (!mgr) return { success: false, error: 'GroupCall manager not running' };
  const r = mgr.requestSessionBreak(roomId);
  return r.ok
    ? { success: true }
    : { success: false, error: r.error ?? 'rejected' };
});

ipcMain.handle(
  'gcall:setLocalAddresses',
  async (_event, addresses: string[], source?: string) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.setLocalAddresses(
      Array.isArray(addresses) ? addresses : [],
      typeof source === 'string' ? source : undefined
    );
    return { success: true };
  }
);

ipcMain.handle(
  'gcall:setQortalGroupReticulumTargets',
  async (_event, roomId: string, addresses: string[]) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.setQortalGroupReticulumTargets(
      typeof roomId === 'string' ? roomId : '',
      Array.isArray(addresses) ? addresses : []
    );
    return { success: true };
  }
);

ipcMain.handle('gcall:getRoomParticipants', async (_event, roomId: string) => {
  const mgr = getGroupCallManager();
  if (!mgr) return [];
  return mgr.getRoomParticipants(roomId);
});

ipcMain.handle(
  'gcall:getRoomBootstrapState',
  async (_event, roomId: string) => {
    const mgr = getGroupCallManager();
    if (!mgr) return null;
    return mgr.getRoomBootstrapState(roomId);
  }
);

ipcMain.handle(
  'gcall:reportTransportHealth',
  async (_event, roomId: string, healthyPeerAddresses: string[]) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.reportTransportHealth(
      roomId,
      Array.isArray(healthyPeerAddresses) ? healthyPeerAddresses : []
    );
    return { success: true };
  }
);

ipcMain.handle('gcall:getPendingKeyMetrics', async () => {
  const mgr = getGroupCallManager();
  if (!mgr) {
    return {
      pending_key_flush_success: 0,
      pending_key_expired: 0,
      pendingRooms: 0,
    };
  }
  return mgr.getPendingKeyMetrics();
});

/**
 * The hidden audio-surface cannot decrypt the wallet for `signPresenceMessage` (per-
 * renderer in-memory key). Forward signing/decrypt to the main shell where the
 * `background` message listener and keyPair are valid.
 */
ipcMain.handle(
  'gcall:proxySignPresenceMessage',
  async (event, payload: Record<string, unknown>) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
      return { error: 'forbidden' };
    }
    const main = myCapacitorApp.getMainWindow();
    if (!main || main.isDestroyed()) {
      return { error: 'main-window-unavailable' };
    }
    const pJson = JSON.stringify(payload ?? {});
    try {
      return await main.webContents.executeJavaScript(
        `(async () => {
          const __p = ${pJson};
          const result = await window.sendMessage('signPresenceMessage', __p, 10000);
          if (result && typeof result === 'object' && result.error) {
            return { error: String(result.error), message: result.message };
          }
          if (result && typeof result.signature === 'string') {
            return { signature: result.signature };
          }
          return { error: 'signPresenceMessage returned no signature' };
        })()`,
        true
      );
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : 'gcall-proxy-sign-failed',
      };
    }
  }
);

ipcMain.handle(
  'gcall:proxyDecryptBoxWithMyKey',
  async (
    event,
    payload: {
      ephemeralPublicKey: string;
      nonce: string;
      ciphertext: string;
    }
  ) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
      return { error: 'forbidden' };
    }
    const main = myCapacitorApp.getMainWindow();
    if (!main || main.isDestroyed()) {
      return { error: 'main-window-unavailable' };
    }
    const pJson = JSON.stringify(payload ?? {});
    try {
      return await main.webContents.executeJavaScript(
        `(async () => {
          const __p = ${pJson};
          const result = await window.sendMessage('decryptBoxWithMyKey', __p, 10000);
          if (result && typeof result === 'object' && result.error) {
            return { error: String(result.error), message: result.message };
          }
          if (result && typeof result.decryptedKey === 'string') {
            return { decryptedKey: result.decryptedKey };
          }
          return { error: 'decryptBoxWithMyKey returned no key' };
        })()`,
        true
      );
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : 'gcall-proxy-decrypt-failed',
      };
    }
  }
);

ipcMain.handle('audio-surface:ensure-ready', async (event) => {
  if (!isMainShellSender(event.sender)) {
    loggerLog('[GCall:audio-surface] ensure-ready: rejected (not main shell)', {
      senderId: event.sender.id,
    });
    return { success: false, error: 'audio-surface-main-shell-required' };
  }
  await myCapacitorApp.ensureAudioSurfaceWindow();
  await waitForAudioSurfaceHostReady();
  const audioWindow = myCapacitorApp.getAudioSurfaceWindow();
  if (!audioWindow || audioWindow.isDestroyed() || !audioSurfaceHostReady) {
    loggerLog('[GCall:audio-surface] ensure-ready: window unavailable');
    return { success: false, error: 'audio-surface-window-unavailable' };
  }
  loggerLog(
    '[GCall:audio-surface] ensure-ready: ok (audio window + host ready)'
  );
  return { success: true };
});

ipcMain.handle('audio-surface:is-ready', async (event) => {
  if (!isMainShellSender(event.sender)) {
    return false;
  }
  const audioWindow = myCapacitorApp.getAudioSurfaceWindow();
  return Boolean(
    audioWindow && !audioWindow.isDestroyed() && audioSurfaceHostReady
  );
});

ipcMain.handle(
  'audio-surface:send-command',
  async (_event, command: AudioSurfaceCommand) => {
    const commandStartedAt = Date.now();
    if (!isMainShellSender(_event.sender)) {
      loggerLog(
        '[GCall:audio-surface] send-command: rejected (not main shell)',
        {
          type: command.type,
        }
      );
      return { ok: false, error: 'audio-surface-main-shell-required' };
    }
    if (command.type === 'join-group-call') {
      loggerLog('[GCall:audio-surface] send-command: join-group-call', {
        roomId: command.roomId,
        chatId: command.chatId,
      });
    }
    const existingAudioWindow = myCapacitorApp.getAudioSurfaceWindow();
    const hasUsableAudioWindow = Boolean(
      existingAudioWindow && !existingAudioWindow.isDestroyed()
    );
    if (
      !hasUsableAudioWindow &&
      (command.type === 'logout-cleanup' ||
        command.type === 'leave-group-call' ||
        command.type === 'stop-direct-voice-rtc' ||
        command.type === 'stop-direct-voice-media' ||
        command.type === 'stop-direct-voice-receive')
    ) {
      return { ok: true };
    }
    await myCapacitorApp.ensureAudioSurfaceWindow();
    await waitForAudioSurfaceHostReady();
    const audioWindow = myCapacitorApp.getAudioSurfaceWindow();
    if (!audioWindow || audioWindow.isDestroyed() || !audioSurfaceHostReady) {
      loggerLog(
        '[GCall:audio-surface] send-command: audio window missing/destroyed'
      );
      return { ok: false, error: 'audio-surface-window-unavailable' };
    }
    const commandId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const envelope: AudioSurfaceCommandEnvelope = { commandId, command };
    const response = await new Promise<AudioSurfaceResponseLike>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingAudioSurfaceCommands.delete(commandId);
          reject(new Error('audio-surface-command-timeout'));
        }, 30_000);
        pendingAudioSurfaceCommands.set(commandId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (reason) => {
            clearTimeout(timeout);
            reject(reason);
          },
        });
        audioWindow.webContents.send('audio-surface:host-command', envelope);
      }
    ).catch((error) => ({
      ok: false,
      error:
        error instanceof Error ? error.message : 'audio-surface-command-failed',
    }));
    const commandDurationMs = Date.now() - commandStartedAt;
    if (
      commandDurationMs >= 250 &&
      (command.type === 'stop-direct-voice-media' ||
        command.type === 'stop-direct-voice-rtc' ||
        command.type === 'stop-direct-voice-receive')
    ) {
      loggerWarn('[GCall:audio-surface] slow direct-voice stop', {
        type: command.type,
        durationMs: commandDurationMs,
        ok: (response as { ok?: boolean }).ok,
        error: (response as { error?: string }).error,
      });
    }
    if (
      command.type === 'join-group-call' ||
      (response as { ok?: boolean }).ok === false
    ) {
      loggerLog('[GCall:audio-surface] send-command: response', {
        type: command.type,
        ok: (response as { ok?: boolean }).ok,
        error:
          (response as { ok?: boolean; error?: string }).ok === false
            ? (response as { error?: string }).error
            : undefined,
      });
    }
    const responsePayload = (response as { payload?: unknown }).payload as
      | { idle?: unknown }
      | undefined;
    if (command.type === 'logout-cleanup') {
      myCapacitorApp.closeAudioSurfaceWindow('logout-cleanup');
    } else if (
      (response as { ok?: boolean }).ok === true &&
      responsePayload?.idle === true &&
      (command.type === 'leave-group-call' ||
        command.type === 'stop-direct-voice-rtc' ||
        command.type === 'stop-direct-voice-media' ||
        command.type === 'stop-direct-voice-receive')
    ) {
      myCapacitorApp.scheduleAudioSurfaceIdleClose(command.type);
    }
    return response;
  }
);

ipcMain.on('audio-surface:subscribe', (event) => {
  if (!isMainShellSender(event.sender)) {
    loggerWarn(
      '[AudioSurface] rejecting subscribe from non-main-shell sender',
      {
        senderId: event.sender.id,
      }
    );
    return;
  }
  audioSurfaceSubscribers.add(event.sender);
  if (audioSurfaceBridgeState.hostReady) {
    event.sender.send('audio-surface:event', {
      type: 'engine-ready',
      bootstrapRevisionApplied:
        audioSurfaceBridgeState.bootstrapRevisionApplied,
    } satisfies AudioSurfaceEvent);
  }
  if (audioSurfaceBridgeState.snapshot !== null) {
    event.sender.send('audio-surface:event', {
      type: 'snapshot',
      snapshot: audioSurfaceBridgeState.snapshot,
    } satisfies AudioSurfaceEvent);
  }
});

ipcMain.on('audio-surface:unsubscribe', (event) => {
  audioSurfaceSubscribers.delete(event.sender);
});

ipcMain.on('audio-surface:host-ready', (event) => {
  if (!isAudioSurfaceHostSender(event.sender)) {
    loggerWarn('[AudioSurface] rejecting host-ready from unexpected sender', {
      senderId: event.sender.id,
    });
    return;
  }
  markAudioSurfaceHostReady();
});

ipcMain.on('audio-surface:host-event', (event, payload: AudioSurfaceEvent) => {
  runMainPressureTask(
    'audio-surface.host-event',
    {
      type: payload?.type ?? 'unknown',
    },
    () => {
      if (!isAudioSurfaceHostSender(event.sender)) {
        loggerWarn(
          '[AudioSurface] rejecting host-event from unexpected sender',
          {
            senderId: event.sender.id,
            type: payload?.type ?? 'unknown',
          }
        );
        return;
      }
      if (payload.type === 'direct-voice-rtc-state') {
        loggerLog('[Call][RTC] transport state', {
          state: payload.state,
          room: payload.roomId.slice(0, 24),
          peer: payload.peerAddress.slice(0, 8),
        });
      } else if (payload.type === 'direct-voice-rtc-diagnostic') {
        loggerLog('[Call][RTC] ICE diagnostic', {
          stage: payload.stage,
          room: payload.roomId.slice(0, 24),
          peer: payload.peerAddress.slice(0, 8),
          ...payload.detail,
        });
      } else if (payload.type === 'group-call-rtc-state') {
        loggerLog('[GCall][RTC] transport state', {
          state: payload.state,
          room: payload.roomId.slice(0, 24),
          peer: payload.peerAddress.slice(0, 8),
        });
      } else if (
        payload.type === 'direct-voice-rtc-signal' &&
        payload.signal.kind === 'description'
      ) {
        // Never log SDP, candidates, keys, or network addresses.
        loggerLog('[Call][RTC] local description ready', {
          signalType: payload.signal.description.type,
          room: payload.roomId.slice(0, 24),
          peer: payload.peerAddress.slice(0, 8),
        });
      }
      emitAudioSurfaceEvent(payload);
    }
  );
});

/**
 * Audio surface must report command results via invoke (not one-way send) so the
 * main process always pairs a reply with the pending `send-command` promise.
 */
ipcMain.handle(
  'audio-surface:command-result',
  (event, envelope: AudioSurfaceCommandResultEnvelope) => {
    return runMainPressureTask(
      'audio-surface.command-result',
      {
        commandId: envelope?.commandId,
        pendingCount: pendingAudioSurfaceCommands.size,
      },
      () => {
        if (!isAudioSurfaceHostSender(event.sender)) {
          loggerWarn('[AudioSurface] command-result: rejected sender', {
            senderId: event.sender.id,
            isolatedIds: [...isolatedAudioSurfaceContents],
          });
          return { ack: false as const, reason: 'bad-sender' };
        }
        const commandId = envelope?.commandId;
        const response = envelope?.response;
        if (typeof commandId !== 'string' || !commandId) {
          loggerWarn('[AudioSurface] command-result: missing commandId', {
            envelope,
          });
          return { ack: false as const, reason: 'missing-command-id' };
        }
        const pending = pendingAudioSurfaceCommands.get(commandId);
        if (!pending) {
          loggerWarn('[AudioSurface] command-result: no pending op', {
            commandId,
            pendingCount: pendingAudioSurfaceCommands.size,
            sampleIds: [...pendingAudioSurfaceCommands.keys()].slice(0, 5),
          });
          return { ack: false as const, reason: 'unknown-command' };
        }
        pendingAudioSurfaceCommands.delete(commandId);
        pending.resolve(response);
        return { ack: true as const };
      }
    );
  }
);

ipcMain.on('gcall:subscribe', (event) => {
  gcallSubscribers.add(event.sender);
  const url = event.sender.isDestroyed()
    ? ''
    : String(event.sender.getURL() ?? '');
  loggerLog(
    `[GCall:main] gcall:subscribe from sender (total gcall subscribers=${gcallSubscribers.size}) ${url ? `url=${url.slice(0, 80)}` : ''}`
  );
  getGroupCallManager()?.replayRetainedVerifiedKeyStatesTo(event.sender);
});
ipcMain.on('gcall:unsubscribe', (event) => {
  gcallSubscribers.delete(event.sender);
  loggerLog(
    `[GCall:main] gcall:unsubscribe (remaining=${gcallSubscribers.size})`
  );
});
/**
 * Audio-surface subscribes before `gcall:join`; retained keys may only exist after
 * joinRoom finishes. Request a second replay so the hidden window receives keys
 * that landed in the manager after the initial subscribe-time replay.
 */
ipcMain.on('gcall:request-key-replay', (event) => {
  if (event.sender.isDestroyed()) return;
  const mgr = getGroupCallManager();
  if (!mgr) return;
  mgr.replayRetainedVerifiedKeyStatesTo(event.sender);
});
ipcMain.on('gcall:subscribe-activity', (event) => {
  gcallActivitySubscribers.add(event.sender);
  const mgr = getGroupCallManager();
  if (!mgr || event.sender.isDestroyed()) return;
  const activeByGroupId = mgr.getQortalGroupCallActivitySnapshotForSidebar();
  event.sender.send('gcall:qortal-group-call-activity', activeByGroupId);
});
ipcMain.on('gcall:unsubscribe-activity', (event) => {
  gcallActivitySubscribers.delete(event.sender);
});

ipcMain.handle(
  'gcall:setWatchedQortalGroupIds',
  async (_event, ids: unknown) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    const list = Array.isArray(ids) ? (ids as number[]) : [];
    const activity = mgr.setWatchedQortalGroupIds(list);
    return { success: true, ...activity };
  }
);
