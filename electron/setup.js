"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronCapacitorApp = void 0;
exports.loadPersistedAllowedDomainsAtStartup = loadPersistedAllowedDomainsAtStartup;
exports.setupReloadWatcher = setupReloadWatcher;
exports.setupContentSecurityPolicy = setupContentSecurityPolicy;
exports.getSharedSettingsFilePath = getSharedSettingsFilePath;
exports.flushPersistentStore = flushPersistentStore;
exports.flushMiscPersistentStore = flushMiscPersistentStore;
exports.readAppSettings = readAppSettings;
exports.broadcastProgress = broadcastProgress;
exports.notifyPresenceTransportReady = notifyPresenceTransportReady;
exports.setLastP2POptions = setLastP2POptions;
exports.attachP2PListeners = attachP2PListeners;
exports.startDecentralizedStunAfterP2P = startDecentralizedStunAfterP2P;
exports.ensureReticulumManagersStarted = ensureReticulumManagersStarted;
exports.replayReticulumCachedPresence = replayReticulumCachedPresence;
exports.attachPresenceListeners = attachPresenceListeners;
exports.clearLateReticulumBridgeRecovery = clearLateReticulumBridgeRecovery;
exports.registerLateReticulumBridgeRecovery = registerLateReticulumBridgeRecovery;
exports.attachChatListeners = attachChatListeners;
exports.attachCallListeners = attachCallListeners;
exports.attachGroupCallListeners = attachGroupCallListeners;
const tslib_1 = require("tslib");
const electron_1 = require("@capacitor-community/electron");
const chokidar_1 = tslib_1.__importDefault(require("chokidar"));
const electron_2 = require("electron");
const electron_is_dev_1 = tslib_1.__importDefault(require("electron-is-dev"));
const electron_window_state_1 = tslib_1.__importDefault(require("electron-window-state"));
const path_1 = require("path");
const logger_1 = require("./logger");
const _1 = require(".");
const core_1 = require("./core");
const local_https_cert_1 = require("./local-https-cert");
const video_server_1 = require("./video-server");
const p2p_network_1 = require("./p2p-network");
const stun_coordinator_1 = require("./stun-coordinator");
const presence_1 = require("./presence");
const chat_1 = require("./chat");
const call_1 = require("./call");
const group_call_1 = require("./group-call");
const reticulum_bridge_1 = require("./reticulum-bridge");
const reticulum_daemon_1 = require("./reticulum-daemon");
const reticulum_mesh_1 = require("./reticulum-mesh");
const feature_flags_1 = require("./feature-flags");
const audio_window_policy_1 = require("./audio-window-policy");
const audio_surface_https_1 = require("./audio-surface-https");
const audio_surface_ipc_1 = require("./audio-surface-ipc");
const app_protocol_1 = require("./app-protocol");
const system_call_readiness_1 = require("./system-call-readiness");
const GCALL_AUDIO_RENDERER_SEND_AT_MS = Symbol.for('qortal.gcallAudioRendererSendAtMs');
const GCALL_AUDIO_MAIN_IPC_AT_MS = Symbol.for('qortal.gcallAudioMainIpcAtMs');
const OPEN_DEVTOOLS_IN_DEVELOPMENT = false;
const GCALL_AUDIO_IPC_DELAY_LOG_THRESHOLD_MS = 80;
const GCALL_MAIN_LOOP_SAMPLE_INTERVAL_MS = 50;
const GCALL_MAIN_LOOP_STALL_LOG_THRESHOLD_MS = 80;
const GCALL_MAIN_LOOP_STALL_RECENT_LIMIT = 16;
const GCALL_MAIN_LOOP_STALL_LOG_THROTTLE_MS = 1000;
let mainLoopExpectedAtMs = Date.now() + GCALL_MAIN_LOOP_SAMPLE_INTERVAL_MS;
let mainLoopStallCount = 0;
let mainLoopStallMaxDelayMs = 0;
let mainLoopLastStallAtMs = 0;
let mainLoopLastStallDelayMs = 0;
let mainLoopLastLogAtMs = 0;
const mainLoopRecentStalls = [];
function recordMainLoopStall(delayMs, nowMs = Date.now()) {
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
    (0, logger_1.warn)(`[GCall] target=reticulum-audio-ipc stage=main-event-loop-stall delay_ms=${Math.round(delayMs)} stall_count=${mainLoopStallCount} max_delay_ms=${Math.round(mainLoopStallMaxDelayMs)}`);
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
function getMainLoopIpcTimingDetail(rendererSendAtMs, nowMs) {
    const lastStallAgeMs = mainLoopLastStallAtMs > 0 ? Math.max(0, nowMs - mainLoopLastStallAtMs) : -1;
    const currentLagMs = Math.max(0, nowMs - mainLoopExpectedAtMs);
    let recentStallMaxMs = 0;
    let stallSinceRendererMaxMs = 0;
    for (const sample of mainLoopRecentStalls) {
        if (nowMs - sample.atMs <= 5000) {
            recentStallMaxMs = Math.max(recentStallMaxMs, sample.delayMs);
        }
        if (sample.atMs >= rendererSendAtMs) {
            stallSinceRendererMaxMs = Math.max(stallSinceRendererMaxMs, sample.delayMs);
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
function attachGroupAudioIpcTiming(buf, timing, context) {
    const rendererSendAtMs = timing?.rendererSendAtWallMs;
    const mainIpcAtMs = Date.now();
    if (typeof rendererSendAtMs === 'number' &&
        Number.isFinite(rendererSendAtMs) &&
        rendererSendAtMs > 0) {
        Object.defineProperty(buf, GCALL_AUDIO_RENDERER_SEND_AT_MS, {
            value: rendererSendAtMs,
            enumerable: false,
            configurable: true,
        });
        const rendererToMainMs = Math.max(0, mainIpcAtMs - rendererSendAtMs);
        if (rendererToMainMs >= GCALL_AUDIO_IPC_DELAY_LOG_THRESHOLD_MS) {
            const mainLoopTiming = getMainLoopIpcTimingDetail(rendererSendAtMs, mainIpcAtMs);
            (0, logger_1.warn)(`[GCall] target=reticulum-audio-ipc stage=gcall-audio-ipc-handler-entry-delay channel=${context?.channel ?? 'unknown'} room=${context?.roomId ?? 'n/a'} target_count=${context?.targetCount ?? 0} delay_ms=${Math.round(rendererToMainMs)} main_loop_current_lag_ms=${Math.round(mainLoopTiming.currentLagMs)} main_loop_last_stall_ms=${Math.round(mainLoopTiming.lastStallDelayMs)} main_loop_last_stall_age_ms=${Math.round(mainLoopTiming.lastStallAgeMs)} main_loop_recent_stall_max_ms=${Math.round(mainLoopTiming.recentStallMaxMs)} main_loop_stall_since_renderer_max_ms=${Math.round(mainLoopTiming.stallSinceRendererMaxMs)} main_loop_stall_count=${mainLoopTiming.stallCount} main_loop_stall_max_ms=${Math.round(mainLoopTiming.stallMaxDelayMs)}`);
        }
    }
    Object.defineProperty(buf, GCALL_AUDIO_MAIN_IPC_AT_MS, {
        value: mainIpcAtMs,
        enumerable: false,
        configurable: true,
    });
}
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');
const defaultDomains = [
    'capacitor-electron://-',
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
    'https://www.qort.trade',
];
// let allowedDomains: string[] = [...defaultDomains]
const domainHolder = {
    allowedDomains: [...defaultDomains],
};
/** Same path layout as `getSharedSettingsFilePath('wallet-storage.json')` (preload `walletStorage`). */
function getWalletStorageJsonPathSync() {
    return path.join(electron_2.app.getPath('appData'), 'qortal-hub', 'wallet-storage.json');
}
function readCustomNodeUrlsFromWalletStorageFile() {
    try {
        const filePath = getWalletStorageJsonPathSync();
        if (!fs.existsSync(filePath))
            return [];
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const nodes = data?.customNodes;
        if (!Array.isArray(nodes))
            return [];
        return nodes
            .map((n) => typeof n?.url === 'string' ? n.url.trim() : '')
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function mergeUserDomainsIntoAllowlist(domains) {
    const validatedUserDomains = domains
        .flatMap((domain) => {
        try {
            const url = new URL(domain);
            const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            const socketUrl = `${protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
            return [url.origin, socketUrl];
        }
        catch {
            return [];
        }
    })
        .filter(Boolean);
    return [...new Set([...defaultDomains, ...validatedUserDomains])];
}
function applyAllowedDomainsFromUserUrls(domains, options) {
    if (!Array.isArray(domains)) {
        return;
    }
    const newAllowedDomains = mergeUserDomainsIntoAllowlist(domains);
    const sortedCurrentDomains = [...domainHolder.allowedDomains].sort();
    const sortedNewDomains = [...newAllowedDomains].sort();
    const hasChanged = sortedCurrentDomains.length !== sortedNewDomains.length ||
        sortedCurrentDomains.some((domain, index) => domain !== sortedNewDomains[index]);
    if (hasChanged) {
        domainHolder.allowedDomains = newAllowedDomains;
        if (options.reloadWindow) {
            const mainWindow = _1.myCapacitorApp.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.reload();
            }
        }
    }
}
/** Apply custom node URLs from wallet storage before the web app loads (no window reload). */
function loadPersistedAllowedDomainsAtStartup() {
    const urls = readCustomNodeUrlsFromWalletStorageFile();
    applyAllowedDomainsFromUserUrls(urls, { reloadWindow: false });
}
// Define components for a watcher to detect when the webapp is changed so we can reload in Dev mode.
const reloadWatcher = {
    debouncer: null,
    ready: false,
    watcher: null,
};
const isolatedAudioSurfaceContents = new Set();
const audioSurfaceSubscribers = new Set();
const pendingAudioSurfaceCommands = new Map();
const AUDIO_SURFACE_IDLE_CLOSE_MS = 90000;
const AUDIO_SURFACE_READY_TIMEOUT_MS = 10000;
let audioSurfaceHostReady = false;
const audioSurfaceReadyResolvers = [];
let audioSurfaceBridgeState = (0, audio_surface_ipc_1.buildDefaultAudioSurfaceBridgeStateLike)();
function isMainShellSender(sender) {
    const mainWindow = _1.myCapacitorApp?.getMainWindow?.();
    return Boolean(mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents.id === sender.id);
}
/**
 * Trust only the hidden audio-surface window (webContents id captured at creation).
 * Comparing to getAudioSurfaceWindow() is fragile if references or lifetimes diverge.
 */
function isAudioSurfaceHostSender(sender) {
    return isolatedAudioSurfaceContents.has(sender.id);
}
function waitForAudioSurfaceHostReady() {
    if (audioSurfaceHostReady) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        let settled = false;
        let timeout = null;
        const resolveReady = () => {
            if (settled)
                return;
            settled = true;
            if (timeout) {
                clearTimeout(timeout);
            }
            resolve();
        };
        timeout = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            const resolverIndex = audioSurfaceReadyResolvers.indexOf(resolveReady);
            if (resolverIndex !== -1) {
                audioSurfaceReadyResolvers.splice(resolverIndex, 1);
            }
            (0, logger_1.warn)('[GCall:audio-surface] host ready wait timed out', {
                timeoutMs: AUDIO_SURFACE_READY_TIMEOUT_MS,
            });
            resolve();
        }, AUDIO_SURFACE_READY_TIMEOUT_MS);
        audioSurfaceReadyResolvers.push(resolveReady);
    });
}
function markAudioSurfaceHostReady() {
    audioSurfaceHostReady = true;
    audioSurfaceBridgeState = {
        ...audioSurfaceBridgeState,
        hostReady: true,
    };
    for (const resolve of audioSurfaceReadyResolvers.splice(0)) {
        resolve();
    }
}
function markAudioSurfaceHostClosed() {
    audioSurfaceHostReady = false;
    audioSurfaceBridgeState = (0, audio_surface_ipc_1.buildDefaultAudioSurfaceBridgeStateLike)();
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
            });
        }
    }
}
function emitAudioSurfaceEvent(event) {
    if (event.type === 'engine-ready') {
        audioSurfaceBridgeState = {
            ...audioSurfaceBridgeState,
            hostReady: true,
            bootstrapRevisionApplied: event.bootstrapRevisionApplied,
        };
    }
    else if (event.type === 'snapshot') {
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
function setupReloadWatcher(electronCapacitorApp) {
    reloadWatcher.watcher = chokidar_1.default
        .watch((0, path_1.join)(electron_2.app.getAppPath(), 'app'), {
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
class ElectronCapacitorApp {
    constructor(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate) {
        this.MainWindow = null;
        this.AudioSurfaceWindow = null;
        this.SplashScreen = null;
        this.TrayIcon = null;
        this.TrayMenuTemplate = [
            new electron_2.MenuItem({ label: 'Quit App', role: 'quit' }),
        ];
        this.AppMenuBarMenuTemplate = [
            { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
            { role: 'viewMenu' },
            { role: 'editMenu' },
        ];
        this.audioSurfaceHttpsOrigin = null;
        this.audioSurfaceWindowReady = null;
        this.audioSurfaceIdleCloseTimer = null;
        this.CapacitorFileConfig = capacitorFileConfig;
        this.customScheme =
            this.CapacitorFileConfig.electron?.customUrlScheme ??
                'capacitor-electron';
        this.audioSurfaceScheme = (0, audio_window_policy_1.buildAudioSurfaceScheme)(this.customScheme);
        if (trayMenuTemplate) {
            this.TrayMenuTemplate = trayMenuTemplate;
        }
        if (appMenuBarMenuTemplate) {
            this.AppMenuBarMenuTemplate = appMenuBarMenuTemplate;
        }
        // Setup our web app loader, this lets us load apps like react, vue, and angular without changing their build chains.
        this.loadWebApp = async (window) => {
            await window.loadURL(`${this.customScheme}://-`);
        };
    }
    // Helper function to load in the app.
    async loadMainWindow(thisRef) {
        await thisRef.loadWebApp(thisRef.MainWindow);
    }
    // Expose the mainWindow ref for use outside of the class.
    getMainWindow() {
        return this.MainWindow;
    }
    getCustomURLScheme() {
        return this.customScheme;
    }
    getAudioSurfaceWindow() {
        return this.AudioSurfaceWindow;
    }
    async ensureAudioSurfaceWindow() {
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
        }
        finally {
            this.audioSurfaceWindowReady = null;
        }
    }
    async createAudioSurfaceWindow() {
        if (!this.MainWindow || this.MainWindow.isDestroyed()) {
            throw new Error('Main window must exist before creating audio surface');
        }
        const preloadPath = (0, path_1.join)(electron_2.app.getAppPath(), 'build', 'src', 'audio-surface-preload.js');
        const window = new electron_2.BrowserWindow({
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
                additionalArguments: [`--window-role=${audio_window_policy_1.AUDIO_SURFACE_WINDOW_ROLE}`],
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
        const targetUrl = (0, audio_window_policy_1.buildAudioSurfaceUrl)(this.audioSurfaceHttpsOrigin ?? this.MainWindow.webContents.getURL(), this.customScheme, this.audioSurfaceScheme);
        (0, logger_1.log)('[GCall:audio-surface] create window target', {
            mainWindowUrl: this.MainWindow.webContents.getURL(),
            targetUrl,
            webContentsId,
        });
        window.webContents.on('did-finish-load', () => {
            (0, logger_1.log)('[GCall:audio-surface] did-finish-load', {
                url: window.webContents.getURL(),
                webContentsId,
            });
            void window.webContents
                .executeJavaScript(`({
            href: location.href,
            origin: location.origin,
            crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
            sharedArrayBufferDefined: typeof SharedArrayBuffer !== 'undefined'
          })`, true)
                .then((state) => {
                (0, logger_1.log)('[GCall:audio-surface] runtime isolation probe', {
                    webContentsId,
                    ...state,
                });
            })
                .catch((error) => {
                (0, logger_1.warn)('[GCall:audio-surface] runtime isolation probe failed', {
                    webContentsId,
                    message: error instanceof Error ? error.message : String(error),
                });
            });
        });
        await window.loadURL(targetUrl);
        if (electron_is_dev_1.default && OPEN_DEVTOOLS_IN_DEVELOPMENT) {
            try {
                window.webContents.openDevTools({ mode: 'detach' });
                (0, logger_1.log)('[GCall:audio-surface] dev: opened DevTools for audio-surface window');
            }
            catch (e) {
                (0, logger_1.warn)('[GCall:audio-surface] dev: openDevTools failed', e);
            }
        }
        return window;
    }
    cancelAudioSurfaceIdleClose(reason) {
        if (!this.audioSurfaceIdleCloseTimer)
            return;
        clearTimeout(this.audioSurfaceIdleCloseTimer);
        this.audioSurfaceIdleCloseTimer = null;
        (0, logger_1.log)('[GCall:audio-surface] idle close canceled', { reason });
    }
    scheduleAudioSurfaceIdleClose(reason) {
        if (!this.AudioSurfaceWindow || this.AudioSurfaceWindow.isDestroyed()) {
            return;
        }
        this.cancelAudioSurfaceIdleClose('reschedule');
        (0, logger_1.log)('[GCall:audio-surface] idle close scheduled', {
            reason,
            delayMs: AUDIO_SURFACE_IDLE_CLOSE_MS,
        });
        this.audioSurfaceIdleCloseTimer = setTimeout(() => {
            this.audioSurfaceIdleCloseTimer = null;
            this.closeAudioSurfaceWindow(`idle-timeout:${reason}`);
        }, AUDIO_SURFACE_IDLE_CLOSE_MS);
    }
    closeAudioSurfaceWindow(reason) {
        this.cancelAudioSurfaceIdleClose('close');
        const audioWindow = this.AudioSurfaceWindow;
        if (!audioWindow || audioWindow.isDestroyed()) {
            markAudioSurfaceHostClosed();
            return;
        }
        (0, logger_1.log)('[GCall:audio-surface] closing window', {
            reason,
            webContentsId: audioWindow.webContents.id,
        });
        audioWindow.close();
    }
    async init(p2pBootstrapSeeds) {
        await (0, app_protocol_1.registerStaticAppProtocol)(electron_2.session.defaultSession, this.customScheme, (0, path_1.join)(electron_2.app.getAppPath(), 'app'));
        await (0, app_protocol_1.registerStaticAppProtocol)(electron_2.session.defaultSession, this.audioSurfaceScheme, (0, path_1.join)(electron_2.app.getAppPath(), 'app'));
        this.audioSurfaceHttpsOrigin = await (0, audio_surface_https_1.ensureAudioSurfaceHttpsServer)((0, path_1.join)(electron_2.app.getAppPath(), 'app'));
        const icon = electron_2.nativeImage.createFromPath((0, path_1.join)(electron_2.app.getAppPath(), 'assets', process.platform === 'win32' ? 'appIcon.ico' : 'appIcon.png'));
        this.mainWindowState = (0, electron_window_state_1.default)({
            defaultWidth: 1000,
            defaultHeight: 800,
        });
        // Setup preload script path and construct our main window.
        const preloadPath = (0, path_1.join)(electron_2.app.getAppPath(), 'build', 'src', 'preload.js');
        const seedsPayload = JSON.stringify({
            v: 1,
            seeds: Array.isArray(p2pBootstrapSeeds) ? p2pBootstrapSeeds : [],
        });
        const seedsB64 = Buffer.from(seedsPayload, 'utf8').toString('base64');
        this.MainWindow = new electron_2.BrowserWindow({
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
                preload: preloadPath,
                additionalArguments: [
                    `--hub-p2p-seeds=${seedsB64}`,
                    `--window-role=${audio_window_policy_1.MAIN_WINDOW_ROLE}`,
                ],
            },
        });
        this.mainWindowState.manage(this.MainWindow);
        this.MainWindow.on('maximize', () => {
            this.MainWindow?.webContents.send('window:state-changed', true);
        });
        this.MainWindow.on('unmaximize', () => {
            this.MainWindow?.webContents.send('window:state-changed', false);
        });
        // Allow microphone access for voice calls.
        const summarizeMediaPermissionDetails = (details) => {
            if (!details || typeof details !== 'object')
                return {};
            const d = details;
            const out = {};
            if (typeof d.requestingUrl === 'string')
                out.requestingUrl = d.requestingUrl;
            if (typeof d.isMainFrame === 'boolean')
                out.isMainFrame = d.isMainFrame;
            if (Array.isArray(d.mediaTypes))
                out.mediaTypes = d.mediaTypes;
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
            this.MainWindow.setBackgroundColor(this.CapacitorFileConfig.electron.backgroundColor);
        }
        // Close window: use saved preference (from SharedSettingsFilePath) or ask user.
        // Must call event.preventDefault() synchronously so the window does not close before we decide.
        this.MainWindow.on('close', async (event) => {
            if (!_1.isQuitting) {
                event.preventDefault();
                const appSettings = await readAppSettings();
                const closeAction = appSettings.closeAction ?? 'ask';
                if (closeAction === 'minimizeToTray') {
                    this.MainWindow.hide();
                    return;
                }
                if (closeAction === 'quit') {
                    (0, _1.setIsQuitting)(true);
                    electron_2.app.quit();
                    return;
                }
                // closeAction === 'ask': show dialog
                const backgroundText = process.platform === 'darwin'
                    ? 'Minimize to Dock'
                    : 'Minimize to Tray';
                const backgroundDetail = process.platform === 'darwin'
                    ? 'Keep the app running in the dock'
                    : 'Keep the app running in the system tray';
                const choice = await electron_2.dialog.showMessageBox(this.MainWindow, {
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
                }
                else if (choice.response === 1) {
                    (0, _1.setIsQuitting)(true);
                    electron_2.app.quit();
                }
            }
        });
        // If we close the main window with the splashscreen enabled we need to destroy the ref.
        this.MainWindow.on('closed', () => {
            if (this.SplashScreen?.getSplashWindow() &&
                !this.SplashScreen.getSplashWindow().isDestroyed()) {
                this.SplashScreen.getSplashWindow().close();
            }
        });
        // When the tray icon is enabled, setup the options.
        if (this.CapacitorFileConfig.electron?.trayIconAndMenuEnabled) {
            // On macOS, use dock instead of menu bar tray icon (more conventional)
            // On Windows and Linux, use the system tray icon
            if (process.platform !== 'darwin') {
                this.TrayIcon = new electron_2.Tray(icon);
                // On Windows, single-click shows context menu (handled automatically by the OS)
                // On Linux, single-click toggles window visibility
                if (process.platform !== 'win32') {
                    this.TrayIcon.on('click', () => {
                        if (this.MainWindow) {
                            if (this.MainWindow.isVisible()) {
                                this.MainWindow.hide();
                            }
                            else {
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
                        }
                        else {
                            this.MainWindow.show();
                            this.MainWindow.focus();
                        }
                    }
                });
                this.TrayIcon.setToolTip(electron_2.app.getName());
                this.TrayIcon.setContextMenu(electron_2.Menu.buildFromTemplate(this.TrayMenuTemplate));
            }
        }
        // Setup the main manu bar at the top of our window.
        electron_2.Menu.setApplicationMenu(electron_2.Menu.buildFromTemplate(this.AppMenuBarMenuTemplate));
        // If the splashscreen is enabled, show it first while the main window loads then switch it out for the main window, or just load the main window from the start.
        if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
            this.SplashScreen = new electron_1.CapacitorSplashScreen({
                imageFilePath: (0, path_1.join)(electron_2.app.getAppPath(), 'assets', this.CapacitorFileConfig.electron?.splashScreenImageName ??
                    'splash.png'),
                windowWidth: 400,
                windowHeight: 400,
            });
            this.SplashScreen.init(this.loadMainWindow, this);
        }
        else {
            this.loadMainWindow(this);
        }
        // Security
        this.MainWindow.webContents.setWindowOpenHandler((details) => {
            if (!details.url.includes(this.customScheme)) {
                return { action: 'deny' };
            }
            else {
                return { action: 'allow' };
            }
        });
        this.MainWindow.webContents.on('will-navigate', (event, _newURL) => {
            if (!this.MainWindow.webContents.getURL().includes(this.customScheme)) {
                event.preventDefault();
            }
        });
        // Link electron plugins into the system.
        (0, electron_1.setupCapacitorElectronPlugins)();
        // When the web app is loaded we hide the splashscreen if needed and show the mainwindow.
        this.MainWindow.webContents.on('dom-ready', () => {
            if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
                this.SplashScreen.getSplashWindow().hide();
            }
            if (!this.CapacitorFileConfig.electron?.hideMainWindowOnLaunch) {
                this.MainWindow.show();
            }
            setTimeout(() => {
                if (electron_is_dev_1.default && OPEN_DEVTOOLS_IN_DEVELOPMENT) {
                    this.MainWindow.webContents.openDevTools();
                }
                electron_1.CapElectronEventEmitter.emit('CAPELECTRON_DeeplinkListenerInitialized', '');
            }, 400);
        });
    }
}
exports.ElectronCapacitorApp = ElectronCapacitorApp;
function setupContentSecurityPolicy(customScheme) {
    electron_2.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const requestUrl = details.url;
        const expandedDomains = [...domainHolder.allowedDomains];
        for (const d of domainHolder.allowedDomains) {
            try {
                const url = new URL(d);
                if ((0, local_https_cert_1.isLocalPrivateHost)(url.hostname)) {
                    const hostPort = url.port
                        ? `${url.hostname}:${url.port}`
                        : url.hostname;
                    expandedDomains.push(`http://${hostPort}`, `https://${hostPort}`, `ws://${hostPort}`, `wss://${hostPort}`);
                }
            }
            catch {
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
        const requestOrigin = details.origin || details.referrer || 'capacitor-electron://-';
        // Parse the request URL to get its origin
        let requestUrlOrigin;
        try {
            const parsedUrl = new URL(requestUrl);
            requestUrlOrigin = parsedUrl.origin;
        }
        catch (e) {
            // Handle invalid URLs gracefully
            requestUrlOrigin = '';
        }
        // Determine if the request is cross-origin
        const isCrossOrigin = requestOrigin !== requestUrlOrigin;
        // Check if the response already includes Access-Control-Allow-Origin
        const hasAccessControlAllowOrigin = Object.keys(details.responseHeaders).some((header) => header.toLowerCase() === 'access-control-allow-origin');
        // Prepare response headers: remove any existing CSP (e.g. from node over HTTPS)
        // so only our permissive CSP is applied and qapps (e.g. extract7z) can use eval.
        const cspHeaderLower = 'content-security-policy';
        const filtered = Object.fromEntries(Object.entries(details.responseHeaders).filter(([key]) => key.toLowerCase() !== cspHeaderLower));
        const responseHeaders = {
            ...filtered,
            'Content-Security-Policy': [csp],
        };
        Object.assign(responseHeaders, (0, audio_window_policy_1.withAudioSurfaceIsolationHeaders)(responseHeaders, {
            url: details.url,
            resourceType: details.resourceType,
            origin: details.origin,
            referrer: details.referrer,
        }));
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
    });
}
// IPC listener for updating allowed domains
electron_2.ipcMain.on('set-allowed-domains', (event, domains) => {
    if (!Array.isArray(domains)) {
        return;
    }
    applyAllowedDomainsFromUserUrls(domains, { reloadWindow: true });
});
// Custom title bar: window controls (minimize, maximize, close)
electron_2.ipcMain.handle('window:minimize', () => {
    const win = _1.myCapacitorApp.getMainWindow();
    if (win && !win.isDestroyed())
        win.minimize();
});
electron_2.ipcMain.handle('window:maximize', () => {
    const win = _1.myCapacitorApp.getMainWindow();
    if (win && !win.isDestroyed()) {
        if (win.isMaximized())
            win.unmaximize();
        else
            win.maximize();
    }
});
electron_2.ipcMain.handle('window:close', () => {
    const win = _1.myCapacitorApp.getMainWindow();
    if (win && !win.isDestroyed())
        win.close();
});
electron_2.ipcMain.handle('window:focus', () => {
    const win = _1.myCapacitorApp.getMainWindow();
    if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
    }
});
electron_2.ipcMain.handle('window:isMaximized', () => {
    const win = _1.myCapacitorApp.getMainWindow();
    return win != null && !win.isDestroyed() && win.isMaximized();
});
electron_2.ipcMain.handle('window:getPlatform', () => process.platform);
(0, system_call_readiness_1.startSystemCallReadinessMonitor)();
electron_2.ipcMain.handle('systemCallReadiness:getSnapshot', () => (0, system_call_readiness_1.getSystemCallReadinessSnapshot)());
electron_2.ipcMain.handle('systemCallReadiness:refreshSnapshot', () => (0, system_call_readiness_1.refreshSystemCallReadinessSnapshot)());
electron_2.ipcMain.handle('window:showAppMenu', (event, { x, y }) => {
    const win = _1.myCapacitorApp.getMainWindow();
    const menu = electron_2.Menu.getApplicationMenu();
    if (menu && win && !win.isDestroyed()) {
        menu.popup({
            window: win,
            x: x ?? 0,
            y: y ?? 32,
        });
    }
});
electron_2.ipcMain.handle('dialog:openFile', async () => {
    const result = await electron_2.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'ZIP Files', extensions: ['zip'] }, // Restrict to ZIP files
        ],
    });
    return result.filePaths[0];
});
electron_2.ipcMain.handle('fs:readFile', async (_, filePath) => {
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
    }
    catch (error) {
        (0, logger_1.error)('Error reading file:', error.message);
        return null; // Return null on error
    }
});
electron_2.ipcMain.handle('fs:selectAndZip', async (_, path) => {
    let directoryPath = path;
    if (!directoryPath) {
        const { canceled, filePaths } = await electron_2.dialog.showOpenDialog({
            properties: ['openDirectory'],
        });
        if (canceled || filePaths.length === 0) {
            (0, logger_1.error)('No directory selected');
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
    }
    catch (error) {
        return null;
    }
});
// Helper to get or create the shared settings directory
async function getSharedSettingsFilePath(fileName) {
    const dir = path.join(electron_2.app.getPath('appData'), 'qortal-hub');
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
function parsePersistentStoreRaw(raw) {
    const trimmed = raw?.trim() ?? '';
    if (trimmed === '')
        return {};
    try {
        return JSON.parse(trimmed) || {};
    }
    catch (_) {
        return {};
    }
}
function createPersistentJsonStore(fileName, label) {
    let cache = null;
    let loadedFromDisk = false;
    const getFilePath = () => {
        const dir = path.join(electron_2.app.getPath('appData'), 'qortal-hub');
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, fileName);
    };
    const readFromDisk = async () => {
        try {
            const filePath = getFilePath();
            const stats = await fs.promises.stat(filePath).catch(() => null);
            if (!stats?.isFile())
                return {};
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            return parsePersistentStoreRaw(raw);
        }
        catch (err) {
            (0, logger_1.error)(`Error reading ${label} from disk`, err);
            return {};
        }
    };
    const load = async () => {
        if (cache !== null)
            return cache;
        const data = await readFromDisk();
        const hadData = Object.keys(data).length > 0;
        cache = data;
        if (hadData)
            loadedFromDisk = true;
        return cache;
    };
    const flush = () => {
        if (cache === null)
            return;
        if (!loadedFromDisk && Object.keys(cache).length === 0) {
            return;
        }
        try {
            const filePath = getFilePath();
            let onDisk = {};
            if (fs.existsSync(filePath)) {
                try {
                    onDisk = parsePersistentStoreRaw(fs.readFileSync(filePath, 'utf-8'));
                }
                catch (_) {
                    onDisk = {};
                }
            }
            const merged = { ...onDisk, ...cache };
            writeFileAtomic.sync(filePath, JSON.stringify(merged, null, 2), {
                encoding: 'utf8',
            });
        }
        catch (err) {
            (0, logger_1.error)(`Error flushing ${label}`, err);
        }
    };
    const get = async (key) => {
        const store = await load();
        return store[key];
    };
    const set = async (key, value) => {
        // Read-merge-write: fetch fresh disk state, merge the new key, write atomically.
        // This ensures concurrent instances don't clobber each other's unrelated keys.
        const onDisk = await readFromDisk();
        onDisk[key] = value;
        try {
            const filePath = getFilePath();
            await writeFileAtomic(filePath, JSON.stringify(onDisk, null, 2), {
                encoding: 'utf8',
            });
        }
        catch (err) {
            (0, logger_1.error)(`Error writing ${label} (set)`, err);
        }
        if (cache === null)
            cache = {};
        cache[key] = value;
        loadedFromDisk = true;
    };
    const deleteKey = async (key) => {
        // Read-merge-write: fetch fresh disk state, remove the key, write atomically.
        const onDisk = await readFromDisk();
        delete onDisk[key];
        try {
            const filePath = getFilePath();
            await writeFileAtomic(filePath, JSON.stringify(onDisk, null, 2), {
                encoding: 'utf8',
            });
        }
        catch (err) {
            (0, logger_1.error)(`Error writing ${label} (delete)`, err);
        }
        if (cache !== null)
            delete cache[key];
    };
    return { deleteKey, flush, get, set };
}
const persistentStore = createPersistentJsonStore(PERSISTENT_STORE_FILENAME, 'persistent store');
const miscPersistentStore = createPersistentJsonStore(MISC_PERSISTENT_STORE_FILENAME, 'misc persistent store');
function flushPersistentStore() {
    persistentStore.flush();
}
function flushMiscPersistentStore() {
    miscPersistentStore.flush();
}
electron_2.ipcMain.handle('persistentStore:get', async (_event, key) => persistentStore.get(key));
electron_2.ipcMain.handle('persistentStore:set', async (_event, key, value) => {
    await persistentStore.set(key, value);
});
electron_2.ipcMain.handle('persistentStore:delete', async (_event, key) => {
    await persistentStore.deleteKey(key);
});
electron_2.ipcMain.handle('miscPersistentStore:get', async (_event, key) => miscPersistentStore.get(key));
electron_2.ipcMain.handle('miscPersistentStore:set', async (_event, key, value) => {
    await miscPersistentStore.set(key, value);
});
electron_2.ipcMain.handle('miscPersistentStore:delete', async (_event, key) => {
    await miscPersistentStore.deleteKey(key);
});
// App settings (stored in SharedSettingsFilePath) - e.g. close/minimize to tray preference
const APP_SETTINGS_FILENAME = 'app-settings.json';
const DEFAULT_APP_SETTINGS = {
    closeAction: 'ask',
    disableStartupSound: false,
    p2pEnabled: !feature_flags_1.isDisabledLegacy,
    reticulumMeshUpnpEnabled: true,
    reticulumManagedConfigEnabled: true,
};
async function readAppSettings() {
    try {
        const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
        const raw = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
        if (!raw)
            return { ...DEFAULT_APP_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_APP_SETTINGS,
            ...parsed,
            closeAction: parsed.closeAction &&
                ['ask', 'minimizeToTray', 'quit'].includes(parsed.closeAction)
                ? parsed.closeAction
                : DEFAULT_APP_SETTINGS.closeAction,
            disableStartupSound: parsed.disableStartupSound === true,
            p2pEnabled: feature_flags_1.isDisabledLegacy
                ? false
                : parsed.p2pEnabled === false
                    ? false
                    : true,
            legacyPublicStunFallback: feature_flags_1.isDisabledLegacy
                ? false
                : parsed.legacyPublicStunFallback === true,
            reticulumMeshUpnpEnabled: parsed.reticulumMeshUpnpEnabled === false ? false : true,
            reticulumManagedConfigEnabled: parsed.reticulumManagedConfigEnabled === false ? false : true,
        };
    }
    catch {
        return { ...DEFAULT_APP_SETTINGS };
    }
}
async function writeAppSettings(settings) {
    const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
    await fs.promises.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}
// READ handler
electron_2.ipcMain.handle('walletStorage:read', async (_event, fileName) => {
    try {
        const filePath = await getSharedSettingsFilePath(fileName);
        const stats = await fs.promises.stat(filePath).catch(() => null);
        if (!stats || !stats.isFile())
            return null;
        return fs.promises.readFile(filePath, 'utf-8');
    }
    catch (err) {
        (0, logger_1.error)(`Error in walletStorage:read for "${fileName}"`, err);
        return null;
    }
});
// WRITE handler
electron_2.ipcMain.handle('walletStorage:write', async (_event, fileName, contents) => {
    try {
        const filePath = await getSharedSettingsFilePath(fileName);
        await fs.promises.writeFile(filePath, contents, 'utf-8');
        return true;
    }
    catch (err) {
        (0, logger_1.error)(`Error in walletStorage:write for "${fileName}"`, err);
        throw err;
    }
});
// Persistent store: shared across instances via atomic writes to appData/qortal-hub/
// Uses write-file-atomic to prevent partial writes corrupting the file.
// On set/delete: read-from-disk → merge → atomic write, so concurrent instances
// never overwrite each other's keys (only a simultaneous write of the *same* key
// by two instances at the exact same moment could still race, which is acceptable).
let persistentStoreCache = null;
let persistentStoreLoadedFromDisk = false;
function getPersistentStoreFilePath() {
    const dir = path.join(electron_2.app.getPath('appData'), 'qortal-hub');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, PERSISTENT_STORE_FILENAME);
}
async function readPersistentStoreFromDisk() {
    try {
        const filePath = getPersistentStoreFilePath();
        const stats = await fs.promises.stat(filePath).catch(() => null);
        if (!stats?.isFile())
            return {};
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return parsePersistentStoreRaw(raw);
    }
    catch (err) {
        (0, logger_1.error)('Error reading persistent store from disk', err);
        return {};
    }
}
async function loadPersistentStore() {
    if (persistentStoreCache !== null)
        return persistentStoreCache;
    const data = await readPersistentStoreFromDisk();
    const hadData = Object.keys(data).length > 0;
    persistentStoreCache = data;
    if (hadData)
        persistentStoreLoadedFromDisk = true;
    return persistentStoreCache;
}
// App settings (stored in SharedSettingsFilePath) - e.g. close/minimize to tray
electron_2.ipcMain.handle('appSettings:get', async () => {
    return readAppSettings();
});
electron_2.ipcMain.handle('appSettings:set', async (_event, partial) => {
    const current = await readAppSettings();
    const next = {
        ...current,
        ...partial,
        ...(feature_flags_1.isDisabledLegacy
            ? {
                p2pEnabled: false,
                legacyPublicStunFallback: false,
            }
            : {}),
    };
    await writeAppSettings(next);
    if (!feature_flags_1.isDisabledLegacy) {
        (0, stun_coordinator_1.getStunCoordinator)()?.setLegacyPublicStunFallback(next.legacyPublicStunFallback === true);
    }
    return next;
});
electron_2.ipcMain.handle('hub:getIceServers', async () => {
    if (feature_flags_1.isDisabledLegacy)
        return [];
    const c = (0, stun_coordinator_1.getStunCoordinator)();
    if (!c)
        return [];
    return await new Promise((resolve, reject) => {
        const slots = {};
        const timeoutId = setTimeout(() => {
            const im = slots.immediate;
            if (im !== undefined) {
                clearImmediate(im);
            }
            (0, logger_1.log)('[STUN][telemetry] getIceServers ipc deadline — returning last snapshot');
            resolve(c.peekLastServedIceServers());
        }, stun_coordinator_1.GET_ICE_SERVERS_DEADLINE_MS);
        slots.immediate = setImmediate(() => {
            try {
                const list = c.getIceServersForRenderer();
                clearTimeout(timeoutId);
                resolve(list);
            }
            catch (err) {
                clearTimeout(timeoutId);
                reject(err);
            }
        });
    });
});
electron_2.ipcMain.handle('hub:reportStunCallOutcome', async (_event, urls, success) => {
    if (feature_flags_1.isDisabledLegacy)
        return { ok: false };
    const c = (0, stun_coordinator_1.getStunCoordinator)();
    if (!c)
        return { ok: false };
    if (!Array.isArray(urls))
        return { ok: false };
    const u = urls.filter((x) => typeof x === 'string');
    c.recordCallStunBundleOutcome(u, success === true);
    (0, logger_1.log)('[STUN][telemetry] call bundle outcome', {
        urls: u.length,
        success: success === true,
    });
    return { ok: true };
});
electron_2.ipcMain.handle('hub:reportObservedStunSources', async (_event, urls) => {
    if (feature_flags_1.isDisabledLegacy)
        return { ok: false };
    const c = (0, stun_coordinator_1.getStunCoordinator)();
    if (!c)
        return { ok: false };
    if (!Array.isArray(urls))
        return { ok: false };
    const u = urls.filter((x) => typeof x === 'string');
    c.recordObservedStunSources(u);
    return { ok: true };
});
// Handler for initiating a streaming file save
electron_2.ipcMain.handle('file:startStreamSave', async (_event, options) => {
    try {
        // Show save dialog
        const result = await electron_2.dialog.showSaveDialog({
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
    }
    catch (err) {
        (0, logger_1.error)('Error in file:startStreamSave', err);
        throw err;
    }
});
// Handler for writing chunks to a file
electron_2.ipcMain.handle('file:writeChunk', async (_event, filePath, chunk, append) => {
    try {
        const buffer = Buffer.from(chunk);
        const mode = append ? 'append' : 'write';
        (0, logger_1.log)(`[IPC] Writing chunk to ${filePath}: ${buffer.length} bytes (${mode} mode)`);
        if (append) {
            await fs.promises.appendFile(filePath, buffer);
        }
        else {
            await fs.promises.writeFile(filePath, buffer);
        }
        // Get file size after write to verify
        const stats = await fs.promises.stat(filePath);
        (0, logger_1.log)(`[IPC] File size after write: ${stats.size} bytes`);
        return true;
    }
    catch (err) {
        (0, logger_1.error)('[IPC] Error writing chunk to', filePath, ':', err);
        throw err;
    }
});
// Handler for cleaning up failed downloads
electron_2.ipcMain.handle('file:deleteFile', async (_event, filePath) => {
    try {
        await fs.promises.unlink(filePath);
        return true;
    }
    catch (err) {
        (0, logger_1.error)('Error deleting file', filePath, err);
        // Don't throw - file might not exist
        return false;
    }
});
const progressSubscribers = new Set();
electron_2.ipcMain.on('coreSetup:progress:subscribe', (e) => {
    const wc = e.sender;
    progressSubscribers.add(wc);
    broadcastProgress('ready');
    broadcastProgress({
        type: 'osType',
        osType: process.platform,
    });
    wc.once('destroyed', () => progressSubscribers.delete(wc));
});
electron_2.ipcMain.on('coreSetup:progress:unsubscribe', (e) => {
    progressSubscribers.delete(e.sender);
});
function broadcastProgress(p) {
    for (const wc of progressSubscribers) {
        if (!wc.isDestroyed()) {
            wc.send('coreSetup:progress', p);
        }
    }
}
electron_2.ipcMain.handle('coreSetup:isCoreRunning', async () => {
    try {
        try {
            const customPath = await (0, core_1.customQortalInstalledDir)();
            if (!customPath) {
                broadcastProgress({
                    type: 'hasCustomPath',
                    hasCustomPath: false,
                    customPath: null,
                });
            }
            else {
                const isInstalledWithCustomPath = await (0, core_1.isCoreInstalled)();
                if (isInstalledWithCustomPath) {
                    broadcastProgress({
                        type: 'hasCustomPath',
                        hasCustomPath: true,
                        customPath,
                    });
                }
                else {
                    await (0, core_1.removeCustomQortalPath)();
                    broadcastProgress({
                        type: 'hasCustomPath',
                        hasCustomPath: false,
                        customPath: null,
                    });
                }
            }
        }
        catch (error) {
            (0, logger_1.error)(error);
        }
        const running = await (0, core_1.isCoreRunning)();
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
        }
        else {
            const javaVersion = await (0, core_1.determineJavaVersion)();
            const hasCore = await (0, core_1.isCoreInstalled)();
            if (javaVersion != false) {
                broadcastProgress({
                    step: 'hasJava',
                    status: 'done',
                    progress: 100,
                    message: '',
                });
            }
            else {
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
            }
            else {
                broadcastProgress({
                    step: 'downloadedCore',
                    status: 'off',
                    progress: 0,
                    message: '',
                });
            }
        }
        return running;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:isCoreRunningOnSystem', async () => {
    try {
        const running = await (0, core_1.isCoreRunning)(true);
        return running;
    }
    catch (error) {
        return false;
    }
});
electron_2.ipcMain.handle('coreSetup:verifySteps', async () => {
    try {
        const javaVersion = await (0, core_1.determineJavaVersion)();
        if (javaVersion != false) {
            broadcastProgress({
                step: 'hasJava',
                status: 'done',
                progress: 100,
                message: '',
            });
        }
        const hasCore = await (0, core_1.isCoreInstalled)();
        if (hasCore) {
            broadcastProgress({
                step: 'downloadedCore',
                status: 'done',
                progress: 100,
                message: '',
            });
        }
        const running = await (0, core_1.isCorePortRunning)();
        if (running) {
            broadcastProgress({
                step: 'coreRunning',
                status: 'done',
                progress: 100,
                message: '',
            });
        }
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:isCoreInstalled', async () => {
    try {
        const isInstalled = await (0, core_1.isCoreInstalled)();
        if (isInstalled) {
            broadcastProgress({
                step: 'downloadedCore',
                status: 'done',
                progress: 100,
                message: '',
            });
        }
        else {
            broadcastProgress({
                step: 'downloadedCore',
                status: 'off',
                progress: 0,
                message: '',
            });
        }
        return isInstalled;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:isCoreInstalledOnSystem', async () => {
    try {
        const isInstalled = await (0, core_1.isCoreInstalled)();
        return isInstalled;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:installCore', async (event) => {
    try {
        const isInstalled = await (0, core_1.isCoreInstalled)();
        const isRunning = await (0, core_1.isCoreRunning)();
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
        if (isInstalled)
            return true;
        const wc = event.sender;
        const sendProgress = (p) => {
            wc.send('coreSetup:progress', { step: 'download', ...p });
        };
        const running = await (0, core_1.installCore)(sendProgress);
        return running;
    }
    catch (error) {
        console.error('Failed to install Qortal Core:', error);
        broadcastProgress({
            step: 'downloadedCore',
            status: 'error',
            progress: 0,
            message: '010',
        });
        return false;
    }
});
electron_2.ipcMain.handle('coreSetup:startCore', async () => {
    try {
        const running = await (0, core_1.startCore)();
        return running;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:deleteDB', async () => {
    try {
        const isDeleted = await (0, core_1.deleteDB)();
        return isDeleted;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:dbExists', async () => {
    try {
        const isDeleted = await (0, core_1.dbExists)();
        return isDeleted;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:getApiKey', async () => {
    try {
        const running = await (0, core_1.getApiKey)();
        return running;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('cert:ensureForBase', async (_event, baseUrl, apiKey) => {
    const result = await (0, local_https_cert_1.ensureCertForBase)(baseUrl, apiKey);
    if (result.success) {
        (0, local_https_cert_1.setLocalNodeHttpsReady)(true);
        electron_2.session.defaultSession.clearCache().catch(() => { });
        const win = _1.myCapacitorApp.getMainWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.session.clearCache().catch(() => { });
        }
    }
    return result;
});
electron_2.ipcMain.handle('coreSetup:resetApikey', async () => {
    try {
        const running = await (0, core_1.resetApikey)();
        return running;
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:removeCustomPath', async () => {
    try {
        await (0, core_1.removeCustomQortalPath)();
        broadcastProgress({
            type: 'hasCustomPath',
            hasCustomPath: false,
            customPath: null,
        });
    }
    catch (error) { }
});
electron_2.ipcMain.handle('coreSetup:stopCore', async () => {
    try {
        return await (0, core_1.stopCore)();
    }
    catch (error) {
        (0, logger_1.error)('error', error);
    }
});
electron_2.ipcMain.handle('coreSetup:bootstrap', async () => {
    try {
        return await (0, core_1.bootstrap)();
    }
    catch (error) {
        (0, logger_1.error)('error', error);
    }
});
electron_2.ipcMain.handle('coreSetup:bootstrapOrClearChainAndStart', async () => {
    try {
        return await (0, core_1.bootstrapOrClearChainAndStart)();
    }
    catch (error) {
        (0, logger_1.error)('error', error);
    }
});
electron_2.ipcMain.handle('coreSetup:pickQortalDirectory', async () => {
    try {
        const { canceled, filePaths } = await electron_2.dialog.showOpenDialog({
            properties: ['openDirectory'],
        });
        if (canceled || filePaths.length === 0)
            return null;
        const dir = filePaths[0];
        const isInstalled = await (0, core_1.isCoreInstalled)(dir);
        if (isInstalled) {
            const filePath = await getSharedSettingsFilePath('wallet-storage.json');
            const raw = await fs.promises
                .readFile(filePath, 'utf-8')
                .catch(() => null);
            const data = raw ? JSON.parse(raw) : {};
            data['qortalDirectory'] = dir;
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
            broadcastProgress({
                type: 'hasCustomPath',
                hasCustomPath: true,
                customPath: dir,
            });
        }
        else
            return false;
    }
    catch (error) {
        return false;
    }
});
// Video Server IPC Handlers
electron_2.ipcMain.handle('videoServer:start', async (_event, port) => {
    try {
        const serverPort = await (0, video_server_1.startVideoServer)(port);
        return { success: true, port: serverPort };
    }
    catch (error) {
        (0, logger_1.error)('Failed to start video server:', error);
        return { success: false, error: error.message };
    }
});
electron_2.ipcMain.handle('videoServer:stop', async () => {
    try {
        await (0, video_server_1.stopVideoServer)();
        return { success: true };
    }
    catch (error) {
        (0, logger_1.error)('Failed to stop video server:', error);
        return { success: false, error: error.message };
    }
});
electron_2.ipcMain.handle('videoServer:getPort', async () => {
    return (0, video_server_1.getVideoServerPort)();
});
electron_2.ipcMain.handle('videoServer:isRunning', async () => {
    return (0, video_server_1.isVideoServerRunning)();
});
// ── P2P Network IPC Handlers ─────────────────────────────────────────────────
const p2pMessageSubscribers = new Set();
const p2pPeerChangeSubscribers = new Set();
function broadcastToSet(subscribers, channel, payload) {
    for (const wc of subscribers) {
        if (wc.isDestroyed()) {
            subscribers.delete(wc);
        }
        else {
            wc.send(channel, payload);
        }
    }
}
function notifyPresenceTransportReady() {
    broadcastToSet(presenceUpdateSubscribers, 'presence:started', {});
}
/** Stores the options used when P2P was last started so the IPC toggle can
 *  restart with the same ports, seeds, etc. */
let lastP2POptions = {};
function setLastP2POptions(opts) {
    lastP2POptions = opts;
}
function attachP2PListeners(network) {
    if (!network)
        return;
    network.on('message', (payload) => broadcastToSet(p2pMessageSubscribers, 'p2p:message', payload));
    network.on('peer-connected', (payload) => broadcastToSet(p2pPeerChangeSubscribers, 'p2p:peerChange', {
        type: 'connected',
        ...payload,
    }));
    network.on('peer-disconnected', (payload) => broadcastToSet(p2pPeerChangeSubscribers, 'p2p:peerChange', {
        type: 'disconnected',
        ...payload,
    }));
}
/** Start decentralized STUN (UDP server, probes, cache) after P2P is up. */
async function startDecentralizedStunAfterP2P(network, opts) {
    if (feature_flags_1.isDisabledLegacy)
        return;
    const chatDb = opts.dbPath ?? (0, path_1.join)(electron_2.app.getPath('appData'), 'qortal-shared', 'chat.db');
    const stunPath = (0, path_1.join)((0, path_1.dirname)(chatDb), 'stun-cache.db');
    const settings = await readAppSettings();
    await (0, stun_coordinator_1.startStunCoordinator)(network, {
        initialPeers: opts.initialPeers ?? [],
        stunCacheDbPath: stunPath,
        legacyPublicStunFallback: settings.legacyPublicStunFallback === true,
    });
    if ((0, stun_coordinator_1.getStunCoordinator)()?.didBindStunUdp()) {
        await network.mapOwnedStunUdpIfPossible();
    }
}
async function ensureReticulumManagersStarted() {
    let bridgeTransport = (0, reticulum_bridge_1.getReticulumBridge)();
    if (bridgeTransport) {
        try {
            await bridgeTransport.start();
        }
        catch (err) {
            (0, logger_1.error)('[ReticulumBridge] Failed to finish startup:', err);
            registerLateReticulumBridgeRecovery();
        }
    }
    else {
        try {
            bridgeTransport = await (0, reticulum_bridge_1.startReticulumBridge)();
        }
        catch (err) {
            (0, logger_1.error)('[ReticulumBridge] Failed to start:', err);
            bridgeTransport = (0, reticulum_bridge_1.getReticulumBridge)();
            if (bridgeTransport) {
                registerLateReticulumBridgeRecovery();
            }
        }
    }
    if (bridgeTransport && bridgeTransport.getState() !== 'ready') {
        registerLateReticulumBridgeRecovery();
    }
    (0, reticulum_daemon_1.attachReticulumStatusBridgeEvents)(bridgeTransport);
    let pm = (0, presence_1.getPresenceManager)();
    const transports = bridgeTransport ? [bridgeTransport] : [];
    if (pm) {
        (0, presence_1.setPresenceManagerTransports)(transports);
        void syncReticulumOverlayStateToBridge(pm);
    }
    else {
        pm = (0, presence_1.startPresenceManager)(transports);
        attachPresenceListeners(pm);
    }
    const callMgr = (0, call_1.getCallManager)();
    if (callMgr) {
        callMgr.setReticulumBridge(bridgeTransport);
    }
    else {
        const startedCallMgr = (0, call_1.startCallManager)(pm, bridgeTransport);
        attachCallListeners(startedCallMgr);
    }
    const gcallMgr = (0, group_call_1.getGroupCallManager)();
    if (gcallMgr) {
        gcallMgr.setReticulumBridge(bridgeTransport);
    }
    else {
        const startedGcallMgr = (0, group_call_1.startGroupCallManager)(pm, bridgeTransport);
        attachGroupCallListeners(startedGcallMgr);
    }
    (0, reticulum_mesh_1.stopReticulumMeshCoordinator)();
    (0, reticulum_mesh_1.startReticulumMeshCoordinator)((0, reticulum_bridge_1.getReticulumBridge)());
    startReticulumPresenceHealthWatchdog();
}
electron_2.ipcMain.handle('p2p:start', async (_event, options) => {
    if (feature_flags_1.isDisabledLegacy) {
        return { success: false, error: 'Legacy networking is disabled' };
    }
    try {
        // Re-use the last known options if none supplied (e.g. from the settings toggle).
        const opts = options && Object.keys(options).length > 0 ? options : lastP2POptions;
        lastP2POptions = opts;
        await ensureReticulumManagersStarted();
        const network = await (0, p2p_network_1.startP2PNetwork)(opts);
        attachP2PListeners(network);
        await startDecentralizedStunAfterP2P(network, opts);
        // (Re-)start the chat manager backed by the shared SQLite database.
        (0, chat_1.stopChatManager)();
        const sharedDbPath = (0, path_1.join)(electron_2.app.getPath('appData'), 'qortal-shared', 'chat.db');
        const cm = await (0, chat_1.startChatManager)(network, sharedDbPath);
        attachChatListeners(cm);
        notifyPresenceTransportReady();
        return {
            success: true,
            port: network.getPort(),
            peerId: network.getPeerId(),
        };
    }
    catch (err) {
        (0, logger_1.error)('[P2P] Failed to start:', err);
        return { success: false, error: err.message };
    }
});
electron_2.ipcMain.handle('p2p:stop', async () => {
    if (feature_flags_1.isDisabledLegacy) {
        return { success: true };
    }
    try {
        (0, p2p_network_1.stopP2PNetwork)();
        (0, chat_1.stopChatManager)();
        return { success: true };
    }
    catch (err) {
        (0, logger_1.error)('[P2P] Failed to stop:', err);
        return { success: false, error: err.message };
    }
});
electron_2.ipcMain.handle('p2p:send', async (_event, to, data) => {
    if (feature_flags_1.isDisabledLegacy) {
        return { success: false, error: 'Legacy networking is disabled' };
    }
    const network = (0, p2p_network_1.getP2PNetwork)();
    if (!network)
        return { success: false, error: 'P2P network is not running' };
    try {
        const messageId = network.send(to, data);
        return { success: true, messageId };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
electron_2.ipcMain.handle('p2p:getPeers', async () => {
    if (feature_flags_1.isDisabledLegacy)
        return [];
    const network = (0, p2p_network_1.getP2PNetwork)();
    return network ? network.getPeers() : [];
});
electron_2.ipcMain.handle('p2p:getStatus', async () => {
    if (feature_flags_1.isDisabledLegacy) {
        return { running: false, port: null, peerId: null, connectedPeers: 0 };
    }
    const network = (0, p2p_network_1.getP2PNetwork)();
    if (!network)
        return { running: false, port: null, peerId: null, connectedPeers: 0 };
    return {
        running: network.isRunning(),
        port: network.getPort(),
        peerId: network.getPeerId(),
        connectedPeers: network.connectedCount(),
    };
});
electron_2.ipcMain.handle('p2p:addPeer', async (_event, addr) => {
    if (feature_flags_1.isDisabledLegacy) {
        return { success: false, error: 'Legacy networking is disabled' };
    }
    const network = (0, p2p_network_1.getP2PNetwork)();
    if (!network)
        return { success: false, error: 'P2P network is not running' };
    network.addPeer(addr);
    return { success: true };
});
electron_2.ipcMain.on('p2p:message:subscribe', (event) => {
    p2pMessageSubscribers.add(event.sender);
});
electron_2.ipcMain.on('p2p:message:unsubscribe', (event) => {
    p2pMessageSubscribers.delete(event.sender);
});
electron_2.ipcMain.on('p2p:peerChange:subscribe', (event) => {
    p2pPeerChangeSubscribers.add(event.sender);
});
electron_2.ipcMain.on('p2p:peerChange:unsubscribe', (event) => {
    p2pPeerChangeSubscribers.delete(event.sender);
});
// ── Presence IPC Handlers ────────────────────────────────────────────────────
const presenceUpdateSubscribers = new Set();
const queuedPresenceUpdates = new Map();
let presenceUpdateFlushTimer = null;
let lateReticulumRecoveryCleanup = null;
const RETICULUM_OVERLAY_SYNC_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];
const RETICULUM_HEALTH_CHECK_MS = 30000;
const RETICULUM_HEALTH_STALE_INBOUND_MS = 2 * 60000;
const RETICULUM_HEALTH_BRIDGE_RESTART_MS = 5 * 60000;
const RETICULUM_HEALTH_SOFT_COOLDOWN_MS = 2 * 60000;
const RETICULUM_HEALTH_BRIDGE_RESTART_COOLDOWN_MS = 5 * 60000;
const RETICULUM_HEALTH_TIMEOUT_THRESHOLD = 3;
let reticulumOverlaySyncRetryTimer = null;
let reticulumOverlaySyncSequence = 0;
let reticulumHealthTimer = null;
let reticulumHealthRecoveryInFlight = false;
let reticulumHealthLastSoftRecoveryAt = 0;
let reticulumHealthLastBridgeRestartAt = 0;
function flushPresenceUpdates() {
    if (presenceUpdateFlushTimer) {
        clearTimeout(presenceUpdateFlushTimer);
        presenceUpdateFlushTimer = null;
    }
    if (queuedPresenceUpdates.size === 0)
        return;
    const payloads = Array.from(queuedPresenceUpdates.values());
    queuedPresenceUpdates.clear();
    (0, logger_1.log)(`[Presence] Flushing ${payloads.length} queued update(s) to ${presenceUpdateSubscribers.size} renderer subscriber(s)`);
    broadcastToSet(presenceUpdateSubscribers, 'presence:update-batch', payloads);
}
function queuePresenceUpdate(payload) {
    if (payload &&
        typeof payload === 'object' &&
        typeof payload.address === 'string') {
        (0, logger_1.log)(`[Presence] Queueing renderer update for address=${payload.address}`);
        queuedPresenceUpdates.set(payload.address, payload);
    }
    else {
        (0, logger_1.log)('[Presence] Queueing renderer update without address key');
        queuedPresenceUpdates.set(`${Date.now()}:${queuedPresenceUpdates.size}`, payload);
    }
    if (presenceUpdateFlushTimer)
        return;
    presenceUpdateFlushTimer = setTimeout(() => {
        flushPresenceUpdates();
    }, 16);
    presenceUpdateFlushTimer.unref?.();
}
function broadcastPresenceUpdate(payload) {
    (0, logger_1.log)('[Presence] Broadcasting presence update from manager to renderer queue');
    queuePresenceUpdate(payload);
}
async function syncReticulumOverlayStateToBridge(manager, attempt = 0, sequence = ++reticulumOverlaySyncSequence) {
    const bridge = (0, reticulum_bridge_1.getReticulumBridge)();
    if (!bridge || bridge.getState() !== 'ready') {
        scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence);
        return;
    }
    const verifiedPeers = manager
        .getReticulumVerifiedPeers()
        .map((peer) => ({
        destinationHash: peer.destinationHash,
        address: peer.address,
        lastSeen: peer.lastSeen,
    }));
    const activeNeighborHashes = manager.getReticulumActiveNeighborHashes();
    const overlayNeighborHashes = activeNeighborHashes.length > 0
        ? activeNeighborHashes
        : verifiedPeers.map((peer) => peer.destinationHash);
    try {
        const ok = await bridge.syncOverlayState(verifiedPeers, overlayNeighborHashes);
        if (!ok) {
            scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence);
            return;
        }
        if (sequence === reticulumOverlaySyncSequence &&
            reticulumOverlaySyncRetryTimer) {
            clearTimeout(reticulumOverlaySyncRetryTimer);
            reticulumOverlaySyncRetryTimer = null;
        }
    }
    catch (err) {
        (0, logger_1.warn)('[ReticulumOverlay] Failed to sync overlay state to bridge:', err);
        scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence);
    }
}
function scheduleReticulumOverlayStateSyncRetry(manager, attempt, sequence) {
    if (sequence !== reticulumOverlaySyncSequence)
        return;
    if (reticulumOverlaySyncRetryTimer) {
        clearTimeout(reticulumOverlaySyncRetryTimer);
        reticulumOverlaySyncRetryTimer = null;
    }
    const delay = RETICULUM_OVERLAY_SYNC_RETRY_DELAYS_MS[Math.min(attempt, RETICULUM_OVERLAY_SYNC_RETRY_DELAYS_MS.length - 1)];
    reticulumOverlaySyncRetryTimer = setTimeout(() => {
        reticulumOverlaySyncRetryTimer = null;
        if (sequence !== reticulumOverlaySyncSequence)
            return;
        void syncReticulumOverlayStateToBridge(manager, attempt + 1, sequence);
    }, delay);
    reticulumOverlaySyncRetryTimer.unref?.();
}
async function replayReticulumCachedPresence(reason, scheduleFollowup = false) {
    const manager = (0, presence_1.getPresenceManager)();
    const bridge = (0, reticulum_bridge_1.getReticulumBridge)();
    if (!manager || !bridge || bridge.getState() !== 'ready') {
        (0, logger_1.log)(`[ReticulumRecovery] Cached presence replay skipped reason=${reason} manager=${manager ? 'yes' : 'no'} bridge_state=${bridge?.getState() ?? 'missing'}`);
        return false;
    }
    const cached = manager.getLastLocalEnvelope();
    if (!cached) {
        (0, logger_1.log)(`[ReticulumRecovery] Cached presence replay skipped reason=${reason} cached_presence=no`);
        return false;
    }
    await syncReticulumOverlayStateToBridge(manager);
    const ok = await bridge.publish(cached, {
        force: true,
        reason,
    });
    const address = typeof cached.payload?.address === 'string'
        ? cached.payload.address
        : 'unknown';
    (0, logger_1.log)(`[ReticulumRecovery] Cached presence replay reason=${reason} ok=${ok ? 'yes' : 'no'} type=${cached.type} peer_addr=${address} envelope_id=${cached.id ?? 'n/a'}`);
    if (scheduleFollowup) {
        const followup = setTimeout(() => {
            void replayReticulumCachedPresence(`${reason}:followup`, false).catch((err) => {
                (0, logger_1.warn)(`[ReticulumRecovery] Cached presence followup failed reason=${reason}:`, err);
            });
        }, 10000);
        followup.unref?.();
    }
    return ok;
}
function startReticulumPresenceHealthWatchdog() {
    if (reticulumHealthTimer)
        return;
    reticulumHealthTimer = setInterval(() => {
        void checkReticulumPresenceHealth().catch((err) => {
            (0, logger_1.warn)('[ReticulumHealth] Watchdog check failed:', err);
        });
    }, RETICULUM_HEALTH_CHECK_MS);
    reticulumHealthTimer.unref?.();
    (0, logger_1.log)('[ReticulumHealth] Presence watchdog started');
}
async function checkReticulumPresenceHealth() {
    if (_1.isQuitting || reticulumHealthRecoveryInFlight)
        return;
    const manager = (0, presence_1.getPresenceManager)();
    const bridge = (0, reticulum_bridge_1.getReticulumBridge)();
    if (!manager || !bridge || bridge.getState() !== 'ready')
        return;
    if (!manager.getLastLocalEnvelope())
        return;
    const now = Date.now();
    const health = bridge.getPresenceHealthSnapshot();
    const verifiedCount = manager.getReticulumVerifiedPeers().length;
    const fanoutCount = manager.getReticulumActiveNeighborHashes().length;
    const inboundAge = health.lastInboundPresenceAt > 0
        ? now - health.lastInboundPresenceAt
        : Number.POSITIVE_INFINITY;
    const publishOkAge = health.lastPresencePublishOkAt > 0
        ? now - health.lastPresencePublishOkAt
        : Number.POSITIVE_INFINITY;
    const staleInbound = inboundAge >= RETICULUM_HEALTH_STALE_INBOUND_MS;
    const zeroFanout = health.lastPresenceFanoutPeers === 0 ||
        (verifiedCount > 0 && fanoutCount === 0);
    const repeatedTimeouts = health.recentOverlayLinkTimeouts >= RETICULUM_HEALTH_TIMEOUT_THRESHOLD;
    const neverPublished = health.lastPresencePublishOkAt <= 0;
    const needsSoftRecovery = neverPublished ||
        zeroFanout ||
        repeatedTimeouts ||
        (staleInbound && health.lastPresenceFanoutPeers === null);
    if (!needsSoftRecovery)
        return;
    const hardStale = staleInbound &&
        (zeroFanout || repeatedTimeouts) &&
        publishOkAge >= RETICULUM_HEALTH_BRIDGE_RESTART_MS;
    if (hardStale &&
        now - reticulumHealthLastBridgeRestartAt >=
            RETICULUM_HEALTH_BRIDGE_RESTART_COOLDOWN_MS &&
        now - reticulumHealthLastSoftRecoveryAt >= 60000) {
        reticulumHealthLastBridgeRestartAt = now;
        reticulumHealthRecoveryInFlight = true;
        (0, logger_1.warn)(`[ReticulumHealth] Restarting local bridge stale_inbound_ms=${Number.isFinite(inboundAge) ? inboundAge : 'never'} publish_ok_ms=${Number.isFinite(publishOkAge) ? publishOkAge : 'never'} fanout_peers=${health.lastPresenceFanoutPeers ?? 'n/a'} verified=${verifiedCount} active_fanout=${fanoutCount} link_timeouts=${health.recentOverlayLinkTimeouts}`);
        try {
            (0, reticulum_bridge_1.stopReticulumBridge)();
            const restarted = await (0, reticulum_bridge_1.startReticulumBridge)();
            (0, reticulum_daemon_1.attachReticulumStatusBridgeEvents)(restarted);
            await ensureReticulumManagersStarted();
            await replayReticulumCachedPresence('health:bridge-restart', true);
        }
        catch (err) {
            (0, logger_1.warn)('[ReticulumHealth] Local bridge restart failed:', err);
            registerLateReticulumBridgeRecovery();
        }
        finally {
            reticulumHealthRecoveryInFlight = false;
        }
        return;
    }
    if (now - reticulumHealthLastSoftRecoveryAt <
        RETICULUM_HEALTH_SOFT_COOLDOWN_MS) {
        return;
    }
    reticulumHealthLastSoftRecoveryAt = now;
    (0, logger_1.log)(`[ReticulumHealth] Soft replay stale_inbound_ms=${Number.isFinite(inboundAge) ? inboundAge : 'never'} fanout_peers=${health.lastPresenceFanoutPeers ?? 'n/a'} verified=${verifiedCount} active_fanout=${fanoutCount} link_timeouts=${health.recentOverlayLinkTimeouts}`);
    await replayReticulumCachedPresence('health:soft', true);
}
function attachPresenceListeners(manager) {
    if (!manager)
        return;
    (0, logger_1.log)('[Presence] Attaching manager listeners.');
    manager.on('presence-updated', broadcastPresenceUpdate);
    manager.on('reticulum-overlay-changed', () => {
        void syncReticulumOverlayStateToBridge(manager);
    });
    manager.on('reticulum-candidate-failed', ({ destinationHash, reason, }) => {
        const bridge = (0, reticulum_bridge_1.getReticulumBridge)();
        if (!bridge || bridge.getState() !== 'ready')
            return;
        void bridge
            .noteOverlayCandidateFailure(destinationHash, reason)
            .catch(() => { });
    });
    manager.on('reticulum-envelope-accepted', ({ envelope, route, }) => {
        if (route.kind !== 'reticulum')
            return;
        const hops = route.overlayHopsRemaining ?? 0;
        if (hops <= 0)
            return;
        const bridge = (0, reticulum_bridge_1.getReticulumBridge)();
        if (!bridge || bridge.getState() !== 'ready')
            return;
        void bridge
            .forwardPresence(envelope, hops - 1, [route.viaDestinationHash ?? route.destinationHash], route.destinationHash)
            .catch(() => { });
    });
    void syncReticulumOverlayStateToBridge(manager);
}
function clearLateReticulumBridgeRecovery() {
    lateReticulumRecoveryCleanup?.();
    lateReticulumRecoveryCleanup = null;
}
function registerLateReticulumBridgeRecovery() {
    clearLateReticulumBridgeRecovery();
    const bridge = (0, reticulum_bridge_1.getReticulumBridge)();
    if (!bridge) {
        (0, logger_1.warn)('[ReticulumBridge] Late recovery not registered: no bridge instance');
        return;
    }
    let recovered = false;
    const recoverManagers = () => {
        if (recovered)
            return;
        recovered = true;
        clearLateReticulumBridgeRecovery();
        const currentBridge = (0, reticulum_bridge_1.getReticulumBridge)();
        if (!currentBridge || currentBridge.getState() !== 'ready') {
            (0, logger_1.warn)('[ReticulumBridge] Late recovery skipped: bridge missing or not ready');
            return;
        }
        (0, reticulum_daemon_1.attachReticulumStatusBridgeEvents)(currentBridge);
        (0, logger_1.log)('[ReticulumBridge] Bridge became ready after startup timeout; updating presence transport and rebinding call/group-call managers');
        let pm = (0, presence_1.getPresenceManager)();
        if (pm) {
            (0, presence_1.setPresenceManagerTransports)([currentBridge]);
            void syncReticulumOverlayStateToBridge(pm);
        }
        else {
            pm = (0, presence_1.startPresenceManager)([currentBridge]);
            attachPresenceListeners(pm);
        }
        const callMgr = (0, call_1.getCallManager)();
        if (callMgr) {
            callMgr.setReticulumBridge(currentBridge);
        }
        else {
            attachCallListeners((0, call_1.startCallManager)(pm, currentBridge));
        }
        const gcallMgr = (0, group_call_1.getGroupCallManager)();
        if (gcallMgr) {
            gcallMgr.setReticulumBridge(currentBridge);
        }
        else {
            attachGroupCallListeners((0, group_call_1.startGroupCallManager)(pm, currentBridge));
        }
        (0, reticulum_mesh_1.stopReticulumMeshCoordinator)();
        (0, reticulum_mesh_1.startReticulumMeshCoordinator)(currentBridge);
        startReticulumPresenceHealthWatchdog();
        void replayReticulumCachedPresence('late-ready', true);
        // Mirror the normal startup signal so an already-authenticated renderer can
        // retry its initial presence announce after late Reticulum readiness.
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
    (0, logger_1.log)('[ReticulumBridge] Registered late-ready recovery hook');
}
/** Validates a renderer-supplied envelope, applies it locally, then relays. */
async function handleLocalPresenceEnvelope(envelope) {
    const pm = (0, presence_1.getPresenceManager)();
    if (!pm) {
        (0, logger_1.log)('[Presence] Local envelope dropped because manager is unavailable.');
        return false;
    }
    (0, logger_1.log)('[Presence] Handling local renderer presence envelope.');
    return (0, presence_1.publishPresenceEnvelope)(envelope);
}
electron_2.ipcMain.handle('presence:announce', async (_event, envelope) => {
    try {
        const ok = await handleLocalPresenceEnvelope(envelope);
        return { success: ok };
    }
    catch (err) {
        (0, logger_1.error)('[Presence] announce error:', err);
        return { success: false, error: err.message };
    }
});
electron_2.ipcMain.handle('presence:heartbeat', async (_event, envelope) => {
    try {
        const ok = await handleLocalPresenceEnvelope(envelope);
        return { success: ok };
    }
    catch (err) {
        (0, logger_1.error)('[Presence] heartbeat error:', err);
        return { success: false, error: err.message };
    }
});
electron_2.ipcMain.handle('presence:offline', async (_event, envelope) => {
    try {
        const ok = await handleLocalPresenceEnvelope(envelope);
        return { success: ok };
    }
    catch (err) {
        (0, logger_1.error)('[Presence] offline error:', err);
        return { success: false, error: err.message };
    }
});
electron_2.ipcMain.handle('presence:getStatus', async (_event, address) => {
    const pm = (0, presence_1.getPresenceManager)();
    if (!pm)
        return { online: false, lastSeen: null, sessions: [] };
    return pm.getStatus(address);
});
electron_2.ipcMain.handle('presence:getOnlineAddresses', async () => {
    const pm = (0, presence_1.getPresenceManager)();
    return pm ? pm.getOnlineAddresses() : [];
});
electron_2.ipcMain.handle('presence:getAllOnline', async () => {
    const pm = (0, presence_1.getPresenceManager)();
    return pm ? pm.getAllOnline() : [];
});
electron_2.ipcMain.on('presence:subscribe', (event) => {
    presenceUpdateSubscribers.add(event.sender);
    (0, logger_1.log)(`[Presence] Renderer subscribed. subscriber_count=${presenceUpdateSubscribers.size}`);
});
electron_2.ipcMain.on('presence:unsubscribe', (event) => {
    presenceUpdateSubscribers.delete(event.sender);
    (0, logger_1.log)(`[Presence] Renderer unsubscribed. subscriber_count=${presenceUpdateSubscribers.size}`);
});
// ── Chat IPC Handlers ─────────────────────────────────────────────────────────
const chatEventSubscribers = new Set();
const chatTypingSubscribers = new Set();
const chatReadSubscribers = new Set();
function attachChatListeners(manager) {
    if (!manager)
        return;
    manager.on('chat:event', (payload) => broadcastToSet(chatEventSubscribers, 'chat:event', payload));
    manager.on('chat:typing', (payload) => broadcastToSet(chatTypingSubscribers, 'chat:typing', payload));
    manager.on('chat:typingStopped', (payload) => broadcastToSet(chatTypingSubscribers, 'chat:typingStopped', payload));
    manager.on('chat:read', (payload) => broadcastToSet(chatReadSubscribers, 'chat:read', payload));
}
/**
 * Send a signed ChatEventEnvelope from the local renderer.
 * The renderer must have already signed the event before calling this.
 */
electron_2.ipcMain.handle('chat:sendEvent', async (_event, envelope) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return { success: false, error: 'Chat manager is not running' };
    try {
        const ok = await cm.handleLocalEvent(envelope);
        return { success: ok };
    }
    catch (err) {
        (0, logger_1.error)('[Chat] sendEvent error:', err);
        return { success: false, error: err.message };
    }
});
/** Subscribe the local user to a chat and request sync from peers. */
electron_2.ipcMain.handle('chat:subscribe', async (_event, chatId) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return { success: false, error: 'Chat manager is not running' };
    cm.subscribeToChat(chatId);
    return { success: true };
});
/** Unsubscribe the local user from a chat. */
electron_2.ipcMain.handle('chat:unsubscribe', async (_event, chatId) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return { success: false, error: 'Chat manager is not running' };
    cm.unsubscribeFromChat(chatId);
    return { success: true };
});
/**
 * Broadcast a typing indicator.
 * authorAddress is the sender's Qortal address.
 */
electron_2.ipcMain.handle('chat:sendTyping', async (_event, chatId, authorAddress) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return { success: false, error: 'Chat manager is not running' };
    cm.sendTyping(chatId, authorAddress);
    return { success: true };
});
/**
 * Retrieve message history for a chat.
 * `beforeTimestamp` enables reverse-scroll pagination.
 */
electron_2.ipcMain.handle('chat:getHistory', async (_event, chatId, limit, beforeTimestamp) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return [];
    return cm.getHistory(chatId, limit, beforeTimestamp);
});
/** Returns summaries of all known chats (last message + unread count). */
electron_2.ipcMain.handle('chat:getSummaries', async () => {
    const cm = (0, chat_1.getChatManager)();
    return cm ? cm.getChatSummaries() : [];
});
/**
 * Advance the read watermark for a chat.
 * All events with timestamp ≤ upToTimestamp are considered read.
 */
electron_2.ipcMain.handle('chat:markRead', async (_event, chatId, upToTimestamp) => {
    const cm = (0, chat_1.getChatManager)();
    cm?.markRead(chatId, upToTimestamp);
    return { success: true };
});
/**
 * Register the local user's Qortal address so the chat manager can
 * auto-accept incoming DMs addressed to them.
 * Call when the user logs in; call with [] when they log out.
 */
electron_2.ipcMain.handle('chat:setLocalAddresses', async (_event, addresses) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return { success: false, error: 'Chat manager is not running' };
    cm.setLocalAddresses(Array.isArray(addresses) ? addresses : []);
    return { success: true };
});
/**
 * Clear the support-queue rate-limit map.
 * Called when an agent logs out so re-knocks are not silently dropped
 * when the agent logs back in.
 */
electron_2.ipcMain.handle('chat:clearQueueRateLimit', async () => {
    const cm = (0, chat_1.getChatManager)();
    if (cm)
        cm.clearQueueRateLimit();
    return { success: true };
});
/** Returns the list of chatIds the local node is currently subscribed to. */
electron_2.ipcMain.handle('chat:getSubscriptions', async () => {
    const cm = (0, chat_1.getChatManager)();
    return cm ? cm.getLocalSubscriptions() : [];
});
electron_2.ipcMain.on('chat:event:subscribe', (event) => {
    chatEventSubscribers.add(event.sender);
});
electron_2.ipcMain.on('chat:event:unsubscribe', (event) => {
    chatEventSubscribers.delete(event.sender);
});
electron_2.ipcMain.on('chat:typing:subscribe', (event) => {
    chatTypingSubscribers.add(event.sender);
});
electron_2.ipcMain.on('chat:typing:unsubscribe', (event) => {
    chatTypingSubscribers.delete(event.sender);
});
/**
 * Persist and broadcast a batch of read receipts.
 * `eventIds` are the IDs of events the local user has seen.
 */
electron_2.ipcMain.handle('chat:sendReadReceipt', async (_event, chatId, eventIds, readerAddress) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return { success: false, error: 'Chat manager is not running' };
    if (typeof chatId !== 'string' ||
        !Array.isArray(eventIds) ||
        typeof readerAddress !== 'string') {
        return { success: false, error: 'Invalid arguments' };
    }
    cm.sendReadReceipt(chatId, eventIds, readerAddress);
    return { success: true };
});
/**
 * Query-scoped receipt loading.
 * Returns receipts only for the provided event IDs — callers pass the IDs
 * currently held in renderer memory so the result is bounded by the
 * history page size rather than the total message count.
 * Returns Record<eventId, readerAddress[]>.
 */
electron_2.ipcMain.handle('chat:getReadReceipts', async (_event, chatId, eventIds) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return {};
    if (typeof chatId !== 'string' || !Array.isArray(eventIds))
        return {};
    return cm.store.getReadReceiptsForEvents(eventIds);
});
electron_2.ipcMain.on('chat:read:subscribe', (event) => {
    chatReadSubscribers.add(event.sender);
});
electron_2.ipcMain.on('chat:read:unsubscribe', (event) => {
    chatReadSubscribers.delete(event.sender);
});
/**
 * Fetch the encrypted attachment blob for a given event.
 * Returns the base64 ciphertext string, or null when the attachment is not
 * present locally (event was received via sync without attachment data).
 */
electron_2.ipcMain.handle('chat:getAttachment', async (_event, eventId) => {
    const cm = (0, chat_1.getChatManager)();
    if (!cm)
        return null;
    if (typeof eventId !== 'string' || !eventId)
        return null;
    return cm.store.getAttachment(eventId);
});
// ── Call IPC Handlers ─────────────────────────────────────────────────────────
const callSubscribers = new Set();
function attachCallListeners(manager) {
    if (!manager)
        return;
    const forward = (channel) => (payload) => broadcastToSet(callSubscribers, channel, payload);
    manager.on('call:incoming', forward('call:incoming'));
    manager.on('call:accepted', forward('call:accepted'));
    manager.on('call:rejected', forward('call:rejected'));
    manager.on('call:hangup', forward('call:hangup'));
}
electron_2.ipcMain.handle('call:initiate', async (_event, targetAddress, chatId, localAddress, signature, publicKey, callId, timestamp) => {
    const mgr = (0, call_1.getCallManager)();
    if (!mgr)
        return { success: false, error: 'Call manager not running' };
    const resultCallId = await mgr.initiateCall(targetAddress, chatId, localAddress, signature, publicKey, callId, timestamp);
    return resultCallId
        ? { success: true, callId: resultCallId }
        : { success: false, error: 'Target offline' };
});
electron_2.ipcMain.handle('call:accept', async (_event, callId, signature, publicKey, timestamp) => {
    const mgr = (0, call_1.getCallManager)();
    if (!mgr)
        return { success: false, error: 'Call manager not running' };
    mgr.acceptCall(callId, signature, publicKey, timestamp);
    return { success: true };
});
electron_2.ipcMain.handle('call:reject', async (_event, callId, reason, signature, publicKey, timestamp) => {
    const mgr = (0, call_1.getCallManager)();
    if (!mgr)
        return { success: false, error: 'Call manager not running' };
    mgr.rejectCall(callId, reason, signature, publicKey, timestamp);
    return { success: true };
});
electron_2.ipcMain.handle('call:hangup', async (_event, callId, signature, publicKey, timestamp) => {
    const mgr = (0, call_1.getCallManager)();
    if (!mgr)
        return { success: false, error: 'Call manager not running' };
    mgr.hangUp(callId, signature, publicKey, timestamp);
    return { success: true };
});
electron_2.ipcMain.handle('call:setLocalAddresses', async (_event, addresses) => {
    const mgr = (0, call_1.getCallManager)();
    if (!mgr)
        return { success: false, error: 'Call manager not running' };
    mgr.setLocalAddresses(Array.isArray(addresses) ? addresses : []);
    return { success: true };
});
electron_2.ipcMain.on('call:subscribe', (event) => {
    callSubscribers.add(event.sender);
    const mgr = (0, call_1.getCallManager)();
    if (!mgr || event.sender.isDestroyed())
        return;
    for (const p of mgr.getPendingInboundRingingPayloads()) {
        event.sender.send('call:incoming', p);
    }
    for (const p of mgr.getActiveOutboundAcceptedPayloads()) {
        event.sender.send('call:accepted', p);
    }
});
electron_2.ipcMain.on('call:unsubscribe', (event) => {
    callSubscribers.delete(event.sender);
});
// ── Group Call IPC Handlers ───────────────────────────────────────────────────
const gcallSubscribers = new Set();
/** Sidebar / list: lightweight `gcall:qortal-group-call-activity` only (no full GC_* stream). */
const gcallActivitySubscribers = new Set();
/** Throttled [GCall:main] logs for gcall:audio (manager received → IPC forward). */
let gcallMainFirstAudio = false;
let gcallMainAudioCountWindow = 0;
let gcallMainAudioWindowT0 = 0;
const GCALL_MAIN_AUDIO_LOG_MS = 2000;
function gcallAudioPayloadBytes(data) {
    if (data instanceof ArrayBuffer)
        return data.byteLength;
    if (ArrayBuffer.isView(data))
        return data.byteLength;
    return 0;
}
function withGcallAudioMainFanoutTimestamp(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }
    const record = payload;
    const existingStage = record.audioStageTimestamps &&
        typeof record.audioStageTimestamps === 'object' &&
        !Array.isArray(record.audioStageTimestamps)
        ? record.audioStageTimestamps
        : {};
    return {
        ...record,
        audioStageTimestamps: {
            ...existingStage,
            bridgeReceivedAtWallMs: typeof record.bridgeReceivedAtWallMs === 'number' &&
                record.bridgeReceivedAtWallMs > 0
                ? record.bridgeReceivedAtWallMs
                : existingStage.bridgeReceivedAtWallMs,
            mainFanoutAtWallMs: Date.now(),
        },
    };
}
function attachGroupCallListeners(manager) {
    if (!manager)
        return;
    const forward = (channel) => (payload) => broadcastToSet(gcallSubscribers, channel, payload);
    manager.on('gcall:participant-joined', forward('gcall:participant-joined'));
    manager.on('gcall:participant-left', forward('gcall:participant-left'));
    manager.on('gcall:topology', forward('gcall:topology'));
    manager.on('gcall:cluster-heartbeat', forward('gcall:cluster-heartbeat'));
    manager.on('gcall:heartbeat', forward('gcall:heartbeat'));
    manager.on('gcall:audio', (payload) => {
        gcallMainAudioCountWindow += 1;
        const now = Date.now();
        if (gcallMainAudioWindowT0 === 0)
            gcallMainAudioWindowT0 = now;
        if (!gcallMainFirstAudio) {
            gcallMainFirstAudio = true;
            const p0 = payload;
            (0, logger_1.log)(`[GCall:main] gcall:audio first from manager roomId=${p0?.roomId} from=${p0?.fromAddress} bytes~=${gcallAudioPayloadBytes(p0?.data)} → ${gcallSubscribers.size} IPC subscriber(s)`);
        }
        if (now - gcallMainAudioWindowT0 >= GCALL_MAIN_AUDIO_LOG_MS) {
            const p = payload;
            (0, logger_1.log)(`[GCall:main] gcall:audio throttled: ${gcallMainAudioCountWindow} pkt in ~${now - gcallMainAudioWindowT0}ms roomId=${p?.roomId} from=${p?.fromAddress} bytes~=${gcallAudioPayloadBytes(p?.data)} subs=${gcallSubscribers.size}`);
            gcallMainAudioCountWindow = 0;
            gcallMainAudioWindowT0 = now;
        }
        broadcastToSet(gcallSubscribers, 'gcall:audio', withGcallAudioMainFanoutTimestamp(payload));
    });
    manager.on('gcall:key', (payload) => {
        const p = payload;
        (0, logger_1.log)(`[GCall:main] gcall:key from manager roomId=${p?.roomId} from=${p?.fromAddress} verified=${p?.verified} → ${gcallSubscribers.size} subscriber(s)`);
        broadcastToSet(gcallSubscribers, 'gcall:key', payload);
    });
    manager.on('gcall:key-request', forward('gcall:key-request'));
    manager.on('gcall:session-updated', forward('gcall:session-updated'));
    manager.on('gcall:qortal-group-call-activity', (payload) => broadcastToSet(gcallActivitySubscribers, 'gcall:qortal-group-call-activity', payload));
}
electron_2.ipcMain.handle('gcall:join', async (_event, roomId, chatId, localAddress, signature, publicKey, timestamp, reticulumDestinationHash, joinGeneration, topologyEpochFloor, reticulumIdentityPublicKeyBase64, joinRkSignature) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    try {
        const session = mgr.joinRoom(roomId, chatId, localAddress, signature, publicKey, timestamp, reticulumDestinationHash, joinGeneration, topologyEpochFloor, reticulumIdentityPublicKeyBase64, joinRkSignature);
        return {
            success: true,
            callSessionId: session.callSessionId,
            mediaSessionGeneration: session.mediaSessionGeneration,
        };
    }
    catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
});
electron_2.ipcMain.handle('gcall:leave', async (_event, roomId, localAddress, signature, publicKey, timestamp) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.leaveRoom(roomId, localAddress, signature, publicKey, timestamp);
    return { success: true };
});
electron_2.ipcMain.on('gcall:leaveSync', (event, roomId, localAddress, signature, publicKey, timestamp) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr) {
        event.returnValue = {
            success: false,
            error: 'GroupCall manager not running',
        };
        return;
    }
    mgr.leaveRoom(roomId, localAddress, signature, publicKey, timestamp);
    event.returnValue = { success: true };
});
electron_2.ipcMain.handle('gcall:broadcastTopology', async (_event, roomId, topology, signature, publicKey, timestamp) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.broadcastTopology(roomId, topology, signature, publicKey, timestamp);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:sendClusterHeartbeat', async (_event, roomId, payload, signature) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.sendClusterHeartbeat(roomId, payload, signature);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:sendAudio', async (_event, roomId, toAddress, data, timing) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    attachGroupAudioIpcTiming(buf, timing, {
        channel: 'sendAudio',
        roomId,
        targetCount: 1,
    });
    const GCALL_IPC_SEND_AUDIO_MAX_BYTES = 12288;
    if (buf.length > GCALL_IPC_SEND_AUDIO_MAX_BYTES) {
        return { success: false, error: 'payload-too-large' };
    }
    const result = mgr.sendAudio(roomId, toAddress, buf);
    if (result.success) {
        return { success: true, diagnostics: result.diagnostics };
    }
    return {
        success: false,
        error: ('error' in result ? result.error : undefined) ?? 'relay-rejected',
        diagnostics: result.diagnostics,
    };
});
electron_2.ipcMain.handle('gcall:sendAudioBatch', async (_event, roomId, toAddresses, data, timing) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    attachGroupAudioIpcTiming(buf, timing, {
        channel: 'sendAudioBatch',
        roomId,
        targetCount: Array.isArray(toAddresses) ? toAddresses.length : 0,
    });
    const GCALL_IPC_SEND_AUDIO_MAX_BYTES = 12288;
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
        error: ('error' in result ? result.error : undefined) ?? 'relay-rejected',
        diagnostics: result.diagnostics,
    };
});
electron_2.ipcMain.handle('gcall:getAudioDataPlaneSession', async (_event, roomId, toAddresses) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { ok: false, reason: 'manager-unavailable' };
    if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
        return { ok: false, reason: 'no-targets' };
    }
    const result = await mgr.getAudioDataPlaneSession(roomId, toAddresses);
    return result;
});
electron_2.ipcMain.handle('gcall:requestPeerMediaRecovery', async (_event, roomId, address, reason) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.requestPeerMediaRecovery(roomId, address, reason);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:reportGcallAudioEscalation', async (_event, opts) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.reportGcallAudioEscalation(opts ?? {});
    return { success: true };
});
electron_2.ipcMain.handle('gcall:getLinkStats', async (_event, roomId) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    return {
        success: true,
        stats: mgr.getReticulumAudioLinkStats(roomId),
    };
});
electron_2.ipcMain.handle('gcall:sendKey', async (_event, roomId, toAddress, encryptedKey, fromAddress, signature, publicKey, timestamp, meta) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    return mgr.sendKey(roomId, toAddress, encryptedKey, fromAddress, signature, publicKey, timestamp, meta);
});
electron_2.ipcMain.handle('gcall:sendKeyRequest', async (_event, roomId, toAddress, fromAddress, signature, publicKey, timestamp, callSessionId, mediaSessionGeneration) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.sendKeyRequest(roomId, toAddress, fromAddress, signature, publicKey, timestamp, callSessionId, mediaSessionGeneration);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:requestSessionBreak', async (_event, roomId) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    const r = mgr.requestSessionBreak(roomId);
    return r.ok
        ? { success: true }
        : { success: false, error: r.error ?? 'rejected' };
});
electron_2.ipcMain.handle('gcall:setLocalAddresses', async (_event, addresses, source) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.setLocalAddresses(Array.isArray(addresses) ? addresses : [], typeof source === 'string' ? source : undefined);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:setQortalGroupReticulumTargets', async (_event, roomId, addresses) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.setQortalGroupReticulumTargets(typeof roomId === 'string' ? roomId : '', Array.isArray(addresses) ? addresses : []);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:getRoomParticipants', async (_event, roomId) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return [];
    return mgr.getRoomParticipants(roomId);
});
electron_2.ipcMain.handle('gcall:getRoomBootstrapState', async (_event, roomId) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return null;
    return mgr.getRoomBootstrapState(roomId);
});
electron_2.ipcMain.handle('gcall:reportTransportHealth', async (_event, roomId, healthyPeerAddresses) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    mgr.reportTransportHealth(roomId, Array.isArray(healthyPeerAddresses) ? healthyPeerAddresses : []);
    return { success: true };
});
electron_2.ipcMain.handle('gcall:getPendingKeyMetrics', async () => {
    const mgr = (0, group_call_1.getGroupCallManager)();
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
electron_2.ipcMain.handle('gcall:proxySignPresenceMessage', async (event, payload) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
        return { error: 'forbidden' };
    }
    const main = _1.myCapacitorApp.getMainWindow();
    if (!main || main.isDestroyed()) {
        return { error: 'main-window-unavailable' };
    }
    const pJson = JSON.stringify(payload ?? {});
    try {
        return await main.webContents.executeJavaScript(`(async () => {
          const __p = ${pJson};
          const result = await window.sendMessage('signPresenceMessage', __p, 10000);
          if (result && typeof result === 'object' && result.error) {
            return { error: String(result.error), message: result.message };
          }
          if (result && typeof result.signature === 'string') {
            return { signature: result.signature };
          }
          return { error: 'signPresenceMessage returned no signature' };
        })()`, true);
    }
    catch (e) {
        return {
            error: e instanceof Error ? e.message : 'gcall-proxy-sign-failed',
        };
    }
});
electron_2.ipcMain.handle('gcall:proxyDecryptBoxWithMyKey', async (event, payload) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
        return { error: 'forbidden' };
    }
    const main = _1.myCapacitorApp.getMainWindow();
    if (!main || main.isDestroyed()) {
        return { error: 'main-window-unavailable' };
    }
    const pJson = JSON.stringify(payload ?? {});
    try {
        return await main.webContents.executeJavaScript(`(async () => {
          const __p = ${pJson};
          const result = await window.sendMessage('decryptBoxWithMyKey', __p, 10000);
          if (result && typeof result === 'object' && result.error) {
            return { error: String(result.error), message: result.message };
          }
          if (result && typeof result.decryptedKey === 'string') {
            return { decryptedKey: result.decryptedKey };
          }
          return { error: 'decryptBoxWithMyKey returned no key' };
        })()`, true);
    }
    catch (e) {
        return {
            error: e instanceof Error ? e.message : 'gcall-proxy-decrypt-failed',
        };
    }
});
electron_2.ipcMain.handle('audio-surface:ensure-ready', async (event) => {
    if (!isMainShellSender(event.sender)) {
        (0, logger_1.log)('[GCall:audio-surface] ensure-ready: rejected (not main shell)', {
            senderId: event.sender.id,
        });
        return { success: false, error: 'audio-surface-main-shell-required' };
    }
    await _1.myCapacitorApp.ensureAudioSurfaceWindow();
    await waitForAudioSurfaceHostReady();
    const audioWindow = _1.myCapacitorApp.getAudioSurfaceWindow();
    if (!audioWindow || audioWindow.isDestroyed() || !audioSurfaceHostReady) {
        (0, logger_1.log)('[GCall:audio-surface] ensure-ready: window unavailable');
        return { success: false, error: 'audio-surface-window-unavailable' };
    }
    (0, logger_1.log)('[GCall:audio-surface] ensure-ready: ok (audio window + host ready)');
    return { success: true };
});
electron_2.ipcMain.handle('audio-surface:is-ready', async (event) => {
    if (!isMainShellSender(event.sender)) {
        return false;
    }
    const audioWindow = _1.myCapacitorApp.getAudioSurfaceWindow();
    return Boolean(audioWindow && !audioWindow.isDestroyed() && audioSurfaceHostReady);
});
electron_2.ipcMain.handle('audio-surface:send-command', async (_event, command) => {
    if (!isMainShellSender(_event.sender)) {
        (0, logger_1.log)('[GCall:audio-surface] send-command: rejected (not main shell)', {
            type: command.type,
        });
        return { ok: false, error: 'audio-surface-main-shell-required' };
    }
    if (command.type === 'join-group-call') {
        (0, logger_1.log)('[GCall:audio-surface] send-command: join-group-call', {
            roomId: command.roomId,
            chatId: command.chatId,
        });
    }
    const existingAudioWindow = _1.myCapacitorApp.getAudioSurfaceWindow();
    const hasUsableAudioWindow = Boolean(existingAudioWindow && !existingAudioWindow.isDestroyed());
    if (!hasUsableAudioWindow &&
        (command.type === 'logout-cleanup' ||
            command.type === 'leave-group-call' ||
            command.type === 'stop-direct-voice-media' ||
            command.type === 'stop-direct-voice-receive')) {
        return { ok: true };
    }
    await _1.myCapacitorApp.ensureAudioSurfaceWindow();
    await waitForAudioSurfaceHostReady();
    const audioWindow = _1.myCapacitorApp.getAudioSurfaceWindow();
    if (!audioWindow || audioWindow.isDestroyed() || !audioSurfaceHostReady) {
        (0, logger_1.log)('[GCall:audio-surface] send-command: audio window missing/destroyed');
        return { ok: false, error: 'audio-surface-window-unavailable' };
    }
    const commandId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const envelope = { commandId, command };
    const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingAudioSurfaceCommands.delete(commandId);
            reject(new Error('audio-surface-command-timeout'));
        }, 30000);
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
    }).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : 'audio-surface-command-failed',
    }));
    if (command.type === 'join-group-call' ||
        response.ok === false) {
        (0, logger_1.log)('[GCall:audio-surface] send-command: response', {
            type: command.type,
            ok: response.ok,
            error: response.ok === false
                ? response.error
                : undefined,
        });
    }
    const responsePayload = response.payload;
    if (command.type === 'logout-cleanup') {
        _1.myCapacitorApp.closeAudioSurfaceWindow('logout-cleanup');
    }
    else if (response.ok === true &&
        responsePayload?.idle === true &&
        (command.type === 'leave-group-call' ||
            command.type === 'stop-direct-voice-media' ||
            command.type === 'stop-direct-voice-receive')) {
        _1.myCapacitorApp.scheduleAudioSurfaceIdleClose(command.type);
    }
    return response;
});
electron_2.ipcMain.on('audio-surface:subscribe', (event) => {
    if (!isMainShellSender(event.sender)) {
        (0, logger_1.warn)('[AudioSurface] rejecting subscribe from non-main-shell sender', {
            senderId: event.sender.id,
        });
        return;
    }
    audioSurfaceSubscribers.add(event.sender);
    if (audioSurfaceBridgeState.hostReady) {
        event.sender.send('audio-surface:event', {
            type: 'engine-ready',
            bootstrapRevisionApplied: audioSurfaceBridgeState.bootstrapRevisionApplied,
        });
    }
    if (audioSurfaceBridgeState.snapshot !== null) {
        event.sender.send('audio-surface:event', {
            type: 'snapshot',
            snapshot: audioSurfaceBridgeState.snapshot,
        });
    }
});
electron_2.ipcMain.on('audio-surface:unsubscribe', (event) => {
    audioSurfaceSubscribers.delete(event.sender);
});
electron_2.ipcMain.on('audio-surface:host-ready', (event) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
        (0, logger_1.warn)('[AudioSurface] rejecting host-ready from unexpected sender', {
            senderId: event.sender.id,
        });
        return;
    }
    markAudioSurfaceHostReady();
});
electron_2.ipcMain.on('audio-surface:host-event', (event, payload) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
        (0, logger_1.warn)('[AudioSurface] rejecting host-event from unexpected sender', {
            senderId: event.sender.id,
            type: payload?.type ?? 'unknown',
        });
        return;
    }
    emitAudioSurfaceEvent(payload);
});
/**
 * Audio surface must report command results via invoke (not one-way send) so the
 * main process always pairs a reply with the pending `send-command` promise.
 */
electron_2.ipcMain.handle('audio-surface:command-result', (event, envelope) => {
    if (!isAudioSurfaceHostSender(event.sender)) {
        (0, logger_1.warn)('[AudioSurface] command-result: rejected sender', {
            senderId: event.sender.id,
            isolatedIds: [...isolatedAudioSurfaceContents],
        });
        return { ack: false, reason: 'bad-sender' };
    }
    const commandId = envelope?.commandId;
    const response = envelope?.response;
    if (typeof commandId !== 'string' || !commandId) {
        (0, logger_1.warn)('[AudioSurface] command-result: missing commandId', {
            envelope,
        });
        return { ack: false, reason: 'missing-command-id' };
    }
    const pending = pendingAudioSurfaceCommands.get(commandId);
    if (!pending) {
        (0, logger_1.warn)('[AudioSurface] command-result: no pending op', {
            commandId,
            pendingCount: pendingAudioSurfaceCommands.size,
            sampleIds: [...pendingAudioSurfaceCommands.keys()].slice(0, 5),
        });
        return { ack: false, reason: 'unknown-command' };
    }
    pendingAudioSurfaceCommands.delete(commandId);
    pending.resolve(response);
    return { ack: true };
});
electron_2.ipcMain.on('gcall:subscribe', (event) => {
    gcallSubscribers.add(event.sender);
    const url = event.sender.isDestroyed()
        ? ''
        : String(event.sender.getURL() ?? '');
    (0, logger_1.log)(`[GCall:main] gcall:subscribe from sender (total gcall subscribers=${gcallSubscribers.size}) ${url ? `url=${url.slice(0, 80)}` : ''}`);
    (0, group_call_1.getGroupCallManager)()?.replayRetainedVerifiedKeyStatesTo(event.sender);
});
electron_2.ipcMain.on('gcall:unsubscribe', (event) => {
    gcallSubscribers.delete(event.sender);
    (0, logger_1.log)(`[GCall:main] gcall:unsubscribe (remaining=${gcallSubscribers.size})`);
});
/**
 * Audio-surface subscribes before `gcall:join`; retained keys may only exist after
 * joinRoom finishes. Request a second replay so the hidden window receives keys
 * that landed in the manager after the initial subscribe-time replay.
 */
electron_2.ipcMain.on('gcall:request-key-replay', (event) => {
    if (event.sender.isDestroyed())
        return;
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return;
    mgr.replayRetainedVerifiedKeyStatesTo(event.sender);
});
electron_2.ipcMain.on('gcall:subscribe-activity', (event) => {
    gcallActivitySubscribers.add(event.sender);
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr || event.sender.isDestroyed())
        return;
    const activeByGroupId = mgr.getQortalGroupCallActivitySnapshotForSidebar();
    event.sender.send('gcall:qortal-group-call-activity', activeByGroupId);
});
electron_2.ipcMain.on('gcall:unsubscribe-activity', (event) => {
    gcallActivitySubscribers.delete(event.sender);
});
electron_2.ipcMain.handle('gcall:setWatchedQortalGroupIds', async (_event, ids) => {
    const mgr = (0, group_call_1.getGroupCallManager)();
    if (!mgr)
        return { success: false, error: 'GroupCall manager not running' };
    const list = Array.isArray(ids) ? ids : [];
    const activity = mgr.setWatchedQortalGroupIds(list);
    return { success: true, ...activity };
});
