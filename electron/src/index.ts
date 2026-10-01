import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  getCapacitorElectronConfig,
  setupElectronDeepLinking,
} from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import {
  app,
  BrowserWindow,
  MenuItem,
  dialog,
  powerMonitor,
  protocol,
  session,
} from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import {
  installCertificateVerification,
  installLocalNodeHttpsBlock,
  loadPersistedLocalNodeCa,
} from './local-https-cert';
import {
  log as loggerLog,
  error as loggerError,
  warn as loggerWarn,
  debug as loggerDebug,
} from './logger';
import {
  ElectronCapacitorApp,
  flushMiscPersistentStore,
  flushPersistentStore,
  loadPersistedAllowedDomainsAtStartup,
  setupContentSecurityPolicy,
  setupReloadWatcher,
  attachP2PListeners,
  attachChatListeners,
  ensureReticulumManagersStarted,
  notifyPresenceTransportReady,
  replayReticulumCachedPresence,
  startAppSettingsWatcher,
  stopReticulumManagers,
  subscribeToAppSettingsChanges,
  setLastP2POptions,
  startDecentralizedStunAfterP2P,
} from './setup';
import { shutdownPrivateTransportSidecar } from './private-transport-runtime';
import {
  startP2PNetwork,
  DEFAULT_P2P_PORT,
  DEFAULT_API_PORT,
} from './p2p-network';
import { startChatManager, flushChatStore } from './chat';
import { readAppSettings } from './setup';
import {
  isReticulumSharedDaemonOwnedByAnotherLiveInstance,
  planReticulumAppQuit,
  recoverReticulumStateForAppLaunch,
  registerReticulumAppInstance,
  registerReticulumIpcHandlers,
  setReticulumInstanceIndex,
  restartBundledReticulumDaemonAndWaitReady,
  stopSharedReticulumDaemon,
} from './reticulum-daemon';
import { registerReticulumMeshIpcHandlers } from './reticulum-mesh';
import { startReticulumForAppLaunch } from './reticulum-launch';
import { runDevReticulumEnsureIfNeeded } from './reticulum-dev-ensure-loader';
import {
  getReticulumBridge,
  restartReticulumBridge,
  stopReticulumBridgeAndWait,
} from './reticulum-bridge';
import { getPresenceManager } from './presence';
import { isDisabledLegacy } from './feature-flags';
import { buildAudioSurfaceScheme } from './audio-window-policy';
import { setAudioSurfaceHttpsInstanceIndex } from './audio-surface-https';
import { isReticulumRuntimeEnabled } from './reticulum-runtime-state';
import { rebindReticulumBridgeConsumers } from './reticulum-bridge-rebind';

import * as net from 'net';

registerReticulumIpcHandlers();
registerReticulumMeshIpcHandlers();

function isBenignStdioWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return (
    code === 'EPIPE' ||
    code === 'EIO' ||
    code === 'ENOTCONN' ||
    code === 'EBADF'
  );
}

function installStdioErrorGuards(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error) => {
      if (!isBenignStdioWriteError(error)) {
        throw error;
      }
    });
  }
}

installStdioErrorGuards();

autoUpdater.logger = {
  info: (...args: unknown[]) => loggerLog('[Updater]', ...args),
  warn: (...args: unknown[]) => loggerWarn('[Updater]', ...args),
  error: (...args: unknown[]) => loggerError('[Updater]', ...args),
  debug: (...args: unknown[]) => loggerDebug('[Updater]', ...args),
};

app.commandLine.appendSwitch(
  'disable-features',
  'BlockInsecurePrivateNetworkRequests'
);

// Chromium exposes AudioContext.setSinkId but gates the delegable permission
// behind SpeakerSelection. Without it, cross-origin Q-Apps cannot select an
// output even with allow="speaker-selection". Enable only this API feature;
// normal frame policy and device permissions still apply.
app.commandLine.appendSwitch(
  'enable-blink-features',
  Array.from(
    new Set([
      ...app.commandLine.getSwitchValue('enable-blink-features').split(',').filter(Boolean),
      'SpeakerSelection',
    ])
  ).join(',')
);

// app.commandLine.appendSwitch('ignore-certificate-errors');

// Graceful handling of unhandled errors. Route electron-unhandled logging
// through our guarded logger so closed AppImage stdio pipes cannot crash while
// reporting the original error.
unhandled({
  logger: (error) => loggerError('[Unhandled]', error),
});

// Flag to track if the app is quitting
export let isQuitting = false;

// Function to set the quitting flag
export function setIsQuitting(value: boolean) {
  isQuitting = value;
}

let shutdownPromise: Promise<void> | null = null;
let shutdownComplete = false;
let shutdownExitScheduled = false;
let reticulumWakeRecovery: Promise<void> | null = null;
let lastReticulumWakeRecoveryAt = 0;
let reticulumGloballyEnabled = true;
let reticulumGlobalTransition: Promise<void> = Promise.resolve();
let reticulumGlobalTransitionFailed = false;
let automaticAppLockDisabled = false;

const RETICULUM_WAKE_RECOVERY_DEBOUNCE_MS = 15_000;
const RETICULUM_WAKE_RECOVERY_BRIDGE_ATTACH_WAIT_MS = 20_000;
const RETICULUM_WAKE_RECOVERY_SHARED_READY_WAIT_MS = 60_000;
const RETICULUM_WAKE_RECOVERY_BRIDGE_RETRY_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestAuthenticatedRendererLock(): void {
  if (automaticAppLockDisabled) return;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send('system:lock-requested');
  }
}

function applyGlobalReticulumSetting(enabled: boolean): Promise<void> {
  reticulumGlobalTransition = reticulumGlobalTransition
    .catch(() => undefined)
    .then(async () => {
      if (
        enabled === reticulumGloballyEnabled &&
        !reticulumGlobalTransitionFailed
      ) {
        return;
      }
      reticulumGloballyEnabled = enabled;
      if (!enabled) {
        loggerLog('[Reticulum] Global setting disabled; stopping managers.');
        stopReticulumManagers();
        myCapacitorApp.updateReticulumChatMentionBadge(0);
        await stopReticulumBridgeAndWait();
        // Give other local Hub instances time to observe the shared setting
        // and stop their per-instance bridges before the shared daemon exits.
        await delay(1_000);
        if (isReticulumRuntimeEnabled()) {
          loggerLog(
            '[Reticulum] Global shutdown was superseded; preserving shared daemon.'
          );
        } else {
          stopSharedReticulumDaemon();
        }
        reticulumGlobalTransitionFailed = false;
        loggerLog('[Reticulum] Global disable transition complete.');
        return;
      }

      loggerLog('[Reticulum] Global setting enabled; starting Reticulum.');
      await startReticulumForAppLaunch();
      await ensureReticulumManagersStarted();
      rebindReticulumBridgeConsumers();
      notifyPresenceTransportReady();
      reticulumGlobalTransitionFailed = false;
      loggerLog('[Reticulum] Global startup complete.');
    })
    .catch((error) => {
      reticulumGlobalTransitionFailed = true;
      loggerError('[Reticulum] Global lifecycle transition failed:', error);
    });
  return reticulumGlobalTransition;
}

function isReticulumDaemonRestartLockError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'Timed out waiting for Reticulum daemon restart lock'
  );
}

function isReticulumSharedInstanceProbeTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('Timed out waiting for Reticulum shared instance')
  );
}

async function waitForReticulumBridgeReady(timeoutMs: number): Promise<void> {
  const bridge = getReticulumBridge();
  if (!bridge) {
    throw new Error('Reticulum bridge is not started');
  }
  if (bridge.getState() === 'ready') {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.off('ready', onReady);
      reject(
        new Error(
          `Timed out waiting for Reticulum bridge ready after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    bridge.once('ready', onReady);
  });
}

async function restartReticulumBridgeAndWaitReady(
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() <= deadline) {
    try {
      await restartReticulumBridge();
      await waitForReticulumBridgeReady(Math.max(1, deadline - Date.now()));
      return;
    } catch (error) {
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await delay(
        Math.min(RETICULUM_WAKE_RECOVERY_BRIDGE_RETRY_MS, remainingMs)
      );
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : String(lastError ?? 'unknown');
  throw new Error(
    `Timed out waiting for Reticulum bridge attach readiness after ${timeoutMs}ms: ${message}`
  );
}

function performAppShutdown(reason: string): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  shutdownPromise = (async () => {
    loggerLog(`[App] Shutdown reason=${reason}`);
    try {
      stopReticulumManagers();
    } catch (error) {
      loggerError('[Reticulum] Manager shutdown failed:', error);
    }
    try {
      await shutdownPrivateTransportSidecar();
    } catch (error) {
      loggerError('[PrivateTransport] Sidecar shutdown failed:', error);
    }
    try {
      // Do not let Electron disappear after merely sending SIGTERM. Waiting
      // here gives the bridge a bounded graceful exit and stopAndWait applies
      // SIGKILL if it does not comply.
      await stopReticulumBridgeAndWait();
    } catch (error) {
      loggerError('[Reticulum] Bridge shutdown failed:', error);
    }
    try {
      const quitPlan = planReticulumAppQuit();
      if (quitPlan.shouldStopSharedDaemon) {
        stopSharedReticulumDaemon();
      } else {
        loggerLog(
          `[Reticulum] Preserving shared rnsd because ${quitPlan.otherActiveInstances} other app instance(s) remain active`
        );
      }
    } catch (error) {
      loggerError('[Reticulum] Shared daemon shutdown planning failed:', error);
    }
    try {
      flushPersistentStore();
    } catch (error) {
      loggerError(
        '[App] Persistent store flush failed during shutdown:',
        error
      );
    }
    try {
      flushChatStore();
    } catch (error) {
      loggerError('[App] Chat store flush failed during shutdown:', error);
    }
    shutdownComplete = true;
  })();
  return shutdownPromise;
}

function exitAfterAppShutdown(reason: string): void {
  if (shutdownExitScheduled) return;
  shutdownExitScheduled = true;
  void performAppShutdown(reason).finally(() => {
    shutdownComplete = true;
    app.exit(0);
  });
}

async function recoverReticulumAfterWake(source: string): Promise<void> {
  if (isQuitting || !reticulumGloballyEnabled) {
    return;
  }

  const now = Date.now();
  if (
    !reticulumWakeRecovery &&
    now - lastReticulumWakeRecoveryAt < RETICULUM_WAKE_RECOVERY_DEBOUNCE_MS
  ) {
    loggerLog(`[Reticulum] Skipping duplicate wake recovery source=${source}`);
    return;
  }

  if (reticulumWakeRecovery) {
    loggerLog(`[Reticulum] Wake recovery already in progress source=${source}`);
    return reticulumWakeRecovery;
  }

  lastReticulumWakeRecoveryAt = now;
  const announceEligible = Boolean(
    getPresenceManager()?.getLastLocalEnvelope()
  );

  reticulumWakeRecovery = (async () => {
    loggerLog(
      `[Reticulum] Wake recovery started source=${source} announceEligible=${announceEligible ? 'yes' : 'no'}`
    );

    try {
      try {
        await restartReticulumBridgeAndWaitReady(
          RETICULUM_WAKE_RECOVERY_BRIDGE_ATTACH_WAIT_MS
        );
        loggerLog(
          '[Reticulum] Wake recovery bridge attach succeeded without daemon restart'
        );
      } catch (error) {
        loggerError(
          '[Reticulum] Wake recovery bridge attach failed; escalating to shared daemon restart:',
          error
        );

        if (isReticulumSharedDaemonOwnedByAnotherLiveInstance()) {
          loggerLog(
            '[Reticulum] Wake recovery skipped shared daemon restart because another app instance is active; retrying bridge attach only'
          );
        } else {
          try {
            await restartBundledReticulumDaemonAndWaitReady(
              RETICULUM_WAKE_RECOVERY_SHARED_READY_WAIT_MS,
              {
                forceKillOnStopTimeout: true,
              }
            );
          } catch (restartError) {
            if (isReticulumSharedInstanceProbeTimeout(restartError)) {
              loggerLog(
                '[Reticulum] Wake recovery shared TCP probe timed out; continuing with bridge attach readiness'
              );
            } else if (!isReticulumDaemonRestartLockError(restartError)) {
              throw restartError;
            } else {
              loggerLog(
                '[Reticulum] Wake recovery restart lock held by another instance; waiting through bridge attach readiness'
              );
            }
          }
        }

        await restartReticulumBridgeAndWaitReady(
          RETICULUM_WAKE_RECOVERY_SHARED_READY_WAIT_MS
        );
      }

      await ensureReticulumManagersStarted();
      rebindReticulumBridgeConsumers();
      notifyPresenceTransportReady();
      await replayReticulumCachedPresence(`wake:${source}`, true);

      const bridgeState = getReticulumBridge()?.getState() ?? 'stopped';
      loggerLog(
        `[Reticulum] Wake recovery complete source=${source} announceEligible=${announceEligible ? 'yes' : 'no'} bridgeState=${bridgeState}`
      );
    } catch (error) {
      loggerError('[Reticulum] Wake recovery failed:', error);
    } finally {
      reticulumWakeRecovery = null;
    }
  })();

  return reticulumWakeRecovery;
}

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  new MenuItem({
    label: 'Show App',
    click: () => {
      const mainWindow = myCapacitorApp.getMainWindow();
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
  }),
  new MenuItem({
    label: 'Quit App',
    click: async () => {
      const mainWindow = myCapacitorApp.getMainWindow();
      const wasHidden = !mainWindow.isVisible();

      // Show the window if it's hidden so the dialog appears properly
      if (wasHidden) {
        mainWindow.show();
      }

      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Cancel', 'Quit'],
        defaultId: 0,
        title: 'Confirm Quit',
        message: 'Are you sure you want to quit Qortal Hub?',
        detail: 'The application will close completely.',
      });

      if (choice.response === 1) {
        setIsQuitting(true);
        app.quit();
      } else if (wasHidden) {
        // Hide the window again if user cancelled and it was hidden
        mainWindow.hide();
      }
    },
  }),
];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
  { role: 'editMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig =
  getCapacitorElectronConfig();
const capacitorRendererScheme =
  capacitorFileConfig.electron?.customUrlScheme ?? 'capacitor-electron';
const audioSurfaceRendererScheme = buildAudioSurfaceScheme(
  capacitorRendererScheme
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: capacitorRendererScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  {
    scheme: audioSurfaceRendererScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  {
    scheme: 'qortal-reticulum-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
export const myCapacitorApp = new ElectronCapacitorApp(
  capacitorFileConfig,
  trayMenuTemplate,
  appMenuBarMenuTemplate
);

/** Default P2P seed peers (2–4 replaceable via settings / p2p:start). */
const HUB_P2P_BOOTSTRAP_SEEDS = ['qortal.home.ro:62391'];

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol:
      capacitorFileConfig.electron.deepLinkingCustomProtocol ??
      'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

const checkForUpdates = async () => {
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    loggerError('Error checking for updates:', error);
  }
};

async function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net
      .createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        server.close(() => resolve(false));
      })
      .listen(port, '127.0.0.1');
  });
}

async function setupMultiInstanceUserData(
  basePort = 55000,
  maxInstances = 10
): Promise<number> {
  for (let i = 0; i < maxInstances; i++) {
    const port = basePort + i;
    if (!(await isPortTaken(port))) {
      // First instance — use default Electron behavior
      if (i === 0) {
        loggerLog(`🟢 Using default userData path: ${app.getPath('userData')}`);
      } else {
        const instanceName = `qortal-instance-${i + 1}`;
        const userDataPath = path.join(app.getPath('appData'), instanceName);
        app.setPath('userData', userDataPath);
        loggerLog(`🟢 Using custom userData path: ${userDataPath}`);
      }

      // Reserve the port so this instance is considered active
      net.createServer().listen(port, '127.0.0.1');
      return i;
    }
  }

  loggerError('❌ Too many instances already running.');
  app.quit();
  return 0;
}

// Run Application
(async () => {
  const instanceIndex = await setupMultiInstanceUserData();
  setAudioSurfaceHttpsInstanceIndex(instanceIndex);
  setReticulumInstanceIndex(instanceIndex);
  const recovery = recoverReticulumStateForAppLaunch(instanceIndex);
  if (recovery.orphanedDaemonFound) {
    loggerLog(
      `[Reticulum] Startup recovery orphanedDaemonStopped=${recovery.orphanedDaemonStopped} daemonStateCleared=${recovery.daemonStateCleared}`
    );
  }
  registerReticulumAppInstance(instanceIndex);

  await app.whenReady();
  const initialAppSettings = await readAppSettings();
  reticulumGloballyEnabled = initialAppSettings.reticulumEnabled !== false;
  automaticAppLockDisabled = initialAppSettings.autoLockTimeoutMinutes === 0;
  subscribeToAppSettingsChanges((settings) => {
    automaticAppLockDisabled = settings.autoLockTimeoutMinutes === 0;
    return applyGlobalReticulumSetting(settings.reticulumEnabled !== false);
  });
  await startAppSettingsWatcher();
  loadPersistedAllowedDomainsAtStartup();
  const reticulumDevEnsureOk = reticulumGloballyEnabled
    ? await runDevReticulumEnsureIfNeeded()
    : true;
  if (!reticulumDevEnsureOk) {
    return;
  }

  // Set Content Security Policy
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());

  for (const desktopAppOrigin of [
    `${capacitorRendererScheme}://-`,
    `${audioSurfaceRendererScheme}://-`,
  ]) {
    await session.defaultSession
      .clearStorageData({
        origin: desktopAppOrigin,
        storages: ['serviceworkers', 'cachestorage'],
      })
      .catch((error) => {
        loggerError(
          `[App] Failed to clear desktop service worker state for ${desktopAppOrigin}:`,
          error
        );
      });
  }

  // Install cert verify proc and block HTTPS to local node until ensureCertForBase has run (default session).
  installCertificateVerification(session.defaultSession);
  installLocalNodeHttpsBlock(session.defaultSession);

  // Apply persisted local node CA (if any) so first request has the CA and Chromium doesn't cache a failure.
  loadPersistedLocalNodeCa();

  await myCapacitorApp.init(HUB_P2P_BOOTSTRAP_SEEDS);

  if (reticulumGloballyEnabled) {
    try {
      await startReticulumForAppLaunch();
    } catch (error) {
      loggerError(
        '[Reticulum] Launch readiness wait failed; continuing with bridge startup:',
        error
      );
    }

    await ensureReticulumManagersStarted();
  } else {
    loggerLog('[Reticulum] Global setting is disabled; startup skipped.');
  }

  if (!isDisabledLegacy) {
    // Each instance gets a unique P2P and API port derived from its index so
    // multiple instances can run side-by-side on the same machine.
    // Instance 0: P2P=62391, API=62490
    // Instance 1: P2P=62392, API=62491  … and so on.
    const p2pPort = DEFAULT_P2P_PORT + instanceIndex;
    const apiPort = DEFAULT_API_PORT + instanceIndex;

    // All instances share one SQLite database in a fixed directory under
    // appData (the common parent of all per-instance userData paths).
    const sharedDbDir = path.join(app.getPath('appData'), 'qortal-shared');
    fs.mkdirSync(sharedDbDir, { recursive: true });
    const sharedDbPath = path.join(sharedDbDir, 'chat.db');

    const p2pOptions = {
      port: p2pPort,
      apiPort,
      initialPeers: [...HUB_P2P_BOOTSTRAP_SEEDS],
      dbPath: sharedDbPath,
    };
    setLastP2POptions(p2pOptions);

    // Auto-start the P2P network unless the user has disabled it in settings.
    const appSettings = await readAppSettings();
    if (appSettings.p2pEnabled !== false) {
      try {
        const p2pNetwork = await startP2PNetwork(p2pOptions);
        attachP2PListeners(p2pNetwork);
        await startDecentralizedStunAfterP2P(p2pNetwork, p2pOptions);
        loggerLog(`[P2P] Auto-started on port ${p2pPort}`);

        // Start the chat manager backed by the shared SQLite database.
        const cm = await startChatManager(p2pNetwork, sharedDbPath);
        attachChatListeners(cm);
        loggerLog('[Chat] Manager auto-started.');
      } catch (err) {
        loggerError('[P2P] Auto-start failed:', err);
      }
    } else {
      loggerLog('[P2P] Disabled by user setting — skipping auto-start.');
    }
  } else {
    loggerLog(
      '[Legacy] Legacy P2P, chat, and STUN startup are disabled by feature flag.'
    );
  }

  // Also set on main window session (same as default when no partition; ensures activate/recreate path is covered)
  const mainWindow = myCapacitorApp.getMainWindow();
  if (mainWindow) {
    installCertificateVerification(mainWindow.webContents.session);
  }

  // Start update checks
  checkForUpdates();
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000);

  powerMonitor.on('resume', () => {
    void recoverReticulumAfterWake('powerMonitor:resume');
    requestAuthenticatedRendererLock();
  });

  // When automatic locking is enabled, lock before sleep where the platform
  // exposes suspend, then repeat on resume in case the renderer was frozen
  // before it received the first IPC.
  powerMonitor.on('suspend', requestAuthenticatedRendererLock);
  powerMonitor.on('lock-screen', requestAuthenticatedRendererLock);
})();

// Set isQuitting flag before the app quits
app.on('before-quit', (event) => {
  setIsQuitting(true);
  if (shutdownComplete) return;
  // Electron does not await async event handlers. Hold the quit until the
  // per-instance bridge has actually exited (or has been force-stopped).
  event.preventDefault();
  flushMiscPersistentStore();
  exitAfterAppShutdown('before-quit');
});

for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    setIsQuitting(true);
    exitAfterAppShutdown(signal);
  });
}

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // Don't quit the app when all windows are closed - let it run in the tray
  // The app will only quit when the user explicitly selects "Quit" from the tray menu
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  let mainWindow = myCapacitorApp.getMainWindow();

  if (mainWindow.isDestroyed()) {
    await myCapacitorApp.init(HUB_P2P_BOOTSTRAP_SEEDS);
    mainWindow = myCapacitorApp.getMainWindow();
    if (mainWindow) {
      installCertificateVerification(mainWindow.webContents.session);
      installLocalNodeHttpsBlock(mainWindow.webContents.session);
    }
  } else if (!mainWindow.isVisible()) {
    // If the window is hidden, show it when dock icon is clicked
    mainWindow.show();
    mainWindow.focus();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line
