import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  CapElectronEventEmitter,
  CapacitorSplashScreen,
  setupCapacitorElectronPlugins,
} from '@capacitor-community/electron';
import chokidar from 'chokidar';
import type { MenuItemConstructorOptions } from 'electron';
import {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  nativeImage,
  Tray,
  session,
  ipcMain,
  dialog,
} from 'electron';
import electronIsDev from 'electron-is-dev';
import electronServe from 'electron-serve';
import windowStateKeeper from 'electron-window-state';
import { dirname, join } from 'path';
import {
  log as loggerLog,
  error as loggerError,
  warn as loggerWarn,
} from './logger';
import { myCapacitorApp, isQuitting, setIsQuitting } from '.';
import {
  bootstrap,
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
  getStunCoordinator,
  GET_ICE_SERVERS_DEADLINE_MS,
} from './stun-coordinator';
import {
  startPresenceManager,
  stopPresenceManager,
  publishPresenceEnvelope,
  getPresenceManager,
} from './presence';
import {
  startChatManager,
  stopChatManager,
  getChatManager,
  flushChatStore,
} from './chat';
import { startCallManager, stopCallManager, getCallManager } from './call';
import {
  startGroupCallManager,
  stopGroupCallManager,
  getGroupCallManager,
  GC_MESSAGE_TYPES,
} from './group-call';
import type { GcEnvelope } from './group-call';
import {
  startReticulumBridge,
  stopReticulumBridge,
  getReticulumBridge,
} from './reticulum-bridge';

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
// Define components for a watcher to detect when the webapp is changed so we can reload in Dev mode.
const reloadWatcher = {
  debouncer: null,
  ready: false,
  watcher: null,
};
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
  private SplashScreen: CapacitorSplashScreen | null = null;
  private TrayIcon: Tray | null = null;
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

  constructor(
    capacitorFileConfig: CapacitorElectronConfig,
    trayMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[],
    appMenuBarMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[]
  ) {
    this.CapacitorFileConfig = capacitorFileConfig;

    this.customScheme =
      this.CapacitorFileConfig.electron?.customUrlScheme ??
      'capacitor-electron';

    if (trayMenuTemplate) {
      this.TrayMenuTemplate = trayMenuTemplate;
    }

    if (appMenuBarMenuTemplate) {
      this.AppMenuBarMenuTemplate = appMenuBarMenuTemplate;
    }

    // Setup our web app loader, this lets us load apps like react, vue, and angular without changing their build chains.
    this.loadWebApp = electronServe({
      directory: join(app.getAppPath(), 'app'),
      scheme: this.customScheme,
    });
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

  async init(p2pBootstrapSeeds?: string[]): Promise<void> {
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
        preload: preloadPath,
        additionalArguments: [`--hub-p2p-seeds=${seedsB64}`],
      },
    });
    this.mainWindowState.manage(this.MainWindow);

    // Allow microphone access for WebRTC voice calls.
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

        this.TrayIcon.setToolTip(app.getName());
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
        if (electronIsDev) {
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

export function setupContentSecurityPolicy(customScheme: string): void {
  session.defaultSession.webRequest.onHeadersReceived(
    (details: any, callback) => {
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

      // Create the Content Security Policy (CSP) string
      const csp = `
    default-src 'self' ${frameSources.join(' ')};
    frame-src ${frameSources.join(' ')};
    script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' ${frameSources.join(' ')};
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
      const requestUrl = details.url;
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

      // Check if the response already includes Access-Control-Allow-Origin
      const hasAccessControlAllowOrigin = Object.keys(
        details.responseHeaders
      ).some(
        (header) => header.toLowerCase() === 'access-control-allow-origin'
      );

      // Prepare response headers: remove any existing CSP (e.g. from node over HTTPS)
      // so only our permissive CSP is applied and qapps (e.g. extract7z) can use eval.
      const cspHeaderLower = 'content-security-policy';
      const filtered = Object.fromEntries(
        Object.entries(details.responseHeaders).filter(
          ([key]) => key.toLowerCase() !== cspHeaderLower
        )
      );
      const responseHeaders: Record<string, string | string[]> = {
        ...filtered,
        'Content-Security-Policy': [csp],
      };

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
  // Validate and transform user-provided domains
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

  // Combine default and validated user domains
  const newAllowedDomains = [
    ...new Set([...defaultDomains, ...validatedUserDomains]),
  ];

  // Sort both current allowed domains and new domains for comparison
  const sortedCurrentDomains = [...domainHolder.allowedDomains].sort();
  const sortedNewDomains = [...newAllowedDomains].sort();

  // Check if the lists are different
  const hasChanged =
    sortedCurrentDomains.length !== sortedNewDomains.length ||
    sortedCurrentDomains.some(
      (domain, index) => domain !== sortedNewDomains[index]
    );

  // If there's a change, update allowedDomains and reload the window
  if (hasChanged) {
    domainHolder.allowedDomains = newAllowedDomains;

    const mainWindow = myCapacitorApp.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  }
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

// App settings (stored in SharedSettingsFilePath) - e.g. close/minimize to tray preference
const APP_SETTINGS_FILENAME = 'app-settings.json';

export type CloseAction = 'ask' | 'minimizeToTray' | 'quit';

export interface AppSettings {
  closeAction?: CloseAction;
  /** Whether the Hub P2P network auto-starts on launch (default true). */
  p2pEnabled?: boolean;
  /**
   * When true, append public Google/Cloudflare STUN URLs to ICE (rollback / lab).
   * Default false — use decentralized peer STUN + bootstrap.
   */
  legacyPublicStunFallback?: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  closeAction: 'ask',
  p2pEnabled: true,
};

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
    const raw = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
      closeAction:
        parsed.closeAction &&
        ['ask', 'minimizeToTray', 'quit'].includes(parsed.closeAction)
          ? (parsed.closeAction as CloseAction)
          : DEFAULT_APP_SETTINGS.closeAction,
      p2pEnabled: parsed.p2pEnabled === false ? false : true,
      legacyPublicStunFallback: parsed.legacyPublicStunFallback === true,
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

async function writeAppSettings(settings: AppSettings): Promise<void> {
  const filePath = await getSharedSettingsFilePath(APP_SETTINGS_FILENAME);
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(settings, null, 2),
    'utf-8'
  );
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
const PERSISTENT_STORE_FILENAME = 'qortal-persistent-store.json';

let persistentStoreCache: Record<string, unknown> | null = null;
let persistentStoreLoadedFromDisk = false;

function getPersistentStoreFilePath(): string {
  const dir = path.join(app.getPath('appData'), 'qortal-hub');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, PERSISTENT_STORE_FILENAME);
}

function parsePersistentStoreRaw(raw: string): Record<string, unknown> {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return {};
  try {
    return (JSON.parse(trimmed) as Record<string, unknown>) || {};
  } catch (_) {
    return {};
  }
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

export function flushPersistentStore(): void {
  if (persistentStoreCache === null) return;
  if (
    !persistentStoreLoadedFromDisk &&
    Object.keys(persistentStoreCache).length === 0
  ) {
    return;
  }
  try {
    const filePath = getPersistentStoreFilePath();
    // Read current on-disk state, merge our cache on top, write atomically (sync).
    let onDisk: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      try {
        onDisk = parsePersistentStoreRaw(fs.readFileSync(filePath, 'utf-8'));
      } catch (_) {
        onDisk = {};
      }
    }
    const merged = { ...onDisk, ...persistentStoreCache };
    writeFileAtomic.sync(filePath, JSON.stringify(merged, null, 2), {
      encoding: 'utf8',
    });
  } catch (err) {
    loggerError('Error flushing persistent store', err);
  }
}

ipcMain.handle('persistentStore:get', async (_event, key: string) => {
  const store = await loadPersistentStore();
  return store[key];
});

ipcMain.handle(
  'persistentStore:set',
  async (_event, key: string, value: unknown) => {
    // Read-merge-write: fetch fresh disk state, merge the new key, write atomically.
    // This ensures concurrent instances don't clobber each other's unrelated keys.
    const onDisk = await readPersistentStoreFromDisk();
    onDisk[key] = value;
    try {
      const filePath = getPersistentStoreFilePath();
      await writeFileAtomic(filePath, JSON.stringify(onDisk, null, 2), {
        encoding: 'utf8',
      });
    } catch (err) {
      loggerError('Error writing persistent store (set)', err);
    }
    // Keep local cache in sync.
    if (persistentStoreCache === null) persistentStoreCache = {};
    persistentStoreCache[key] = value;
    persistentStoreLoadedFromDisk = true;
  }
);

ipcMain.handle('persistentStore:delete', async (_event, key: string) => {
  // Read-merge-write: fetch fresh disk state, remove the key, write atomically.
  const onDisk = await readPersistentStoreFromDisk();
  delete onDisk[key];
  try {
    const filePath = getPersistentStoreFilePath();
    await writeFileAtomic(filePath, JSON.stringify(onDisk, null, 2), {
      encoding: 'utf8',
    });
  } catch (err) {
    loggerError('Error writing persistent store (delete)', err);
  }
  // Keep local cache in sync.
  if (persistentStoreCache !== null) delete persistentStoreCache[key];
});

// App settings (stored in SharedSettingsFilePath) - e.g. close/minimize to tray
ipcMain.handle('appSettings:get', async () => {
  return readAppSettings();
});

ipcMain.handle(
  'appSettings:set',
  async (_event, partial: Partial<AppSettings>) => {
    const current = await readAppSettings();
    const next: AppSettings = { ...current, ...partial };
    await writeAppSettings(next);
    getStunCoordinator()?.setLegacyPublicStunFallback(
      next.legacyPublicStunFallback === true
    );
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

    if (isInstalled) return;
    const wc = event.sender;

    const sendProgress = (p) => {
      wc.send('coreSetup:progress', { step: 'download', ...p });
    };
    const running = await installCore(sendProgress);
    return running;
  } catch (error) {}
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

      const stats = await fs.promises.stat(filePath).catch(() => null);
      if (!stats || !stats.isFile()) return null;

      const raw = await fs.promises.readFile(filePath, 'utf-8');

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
        customPath: filePath,
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
    if (wc.isDestroyed()) {
      subscribers.delete(wc);
    } else {
      wc.send(channel, payload);
    }
  }
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
  const chatDb =
    opts.dbPath ?? join(app.getPath('appData'), 'qortal-shared', 'chat.db');
  const stunPath = join(dirname(chatDb), 'stun-cache.db');
  const settings = await readAppSettings();
  await startStunCoordinator(network, {
    initialPeers: opts.initialPeers ?? [],
    stunCacheDbPath: stunPath,
    legacyPublicStunFallback: settings.legacyPublicStunFallback === true,
  });
  if (getStunCoordinator()?.didBindStunUdp()) {
    await network.mapOwnedStunUdpIfPossible();
  }
}

ipcMain.handle('p2p:start', async (_event, options?: P2PNetworkOptions) => {
  try {
    clearLateReticulumBridgeRecovery();
    // Re-use the last known options if none supplied (e.g. from the settings toggle).
    const opts =
      options && Object.keys(options).length > 0 ? options : lastP2POptions;
    lastP2POptions = opts;
    const network = await startP2PNetwork(opts);
    attachP2PListeners(network);
    await startDecentralizedStunAfterP2P(network, opts);
    let bridgeTransport = getReticulumBridge();
    try {
      bridgeTransport = await startReticulumBridge();
    } catch (err) {
      loggerError('[ReticulumBridge] Failed to start:', err);
      bridgeTransport = null;
      registerLateReticulumBridgeRecovery(network);
    }
    // (Re-)start the presence manager wired to the new network instance.
    stopPresenceManager();
    const pm = startPresenceManager(bridgeTransport ? [bridgeTransport] : []);
    attachPresenceListeners(pm);
    // (Re-)start the chat manager backed by the shared SQLite database.
    stopChatManager();
    const sharedDbPath = join(
      app.getPath('appData'),
      'qortal-shared',
      'chat.db'
    );
    const cm = await startChatManager(network, sharedDbPath);
    attachChatListeners(cm);
    // (Re-)start the call manager wired to the network + presence manager.
    stopCallManager();
    const callMgr = startCallManager(network, pm, bridgeTransport);
    attachCallListeners(callMgr);
    // (Re-)start the group call manager.
    stopGroupCallManager();
    const gcallMgr = startGroupCallManager(network, pm, bridgeTransport);
    attachGroupCallListeners(gcallMgr);
    // Notify renderers that P2P / presence is live again.
    flushPresenceUpdates();
    broadcastToSet(presenceUpdateSubscribers, 'presence:started', {});
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
  try {
    clearLateReticulumBridgeRecovery();
    stopP2PNetwork();
    queuedPresenceUpdates.clear();
    flushPresenceUpdates();
    broadcastToSet(presenceUpdateSubscribers, 'presence:cleared', {});
    stopReticulumBridge();
    stopPresenceManager();
    stopChatManager();
    stopCallManager();
    stopGroupCallManager();
    return { success: true };
  } catch (err) {
    loggerError('[P2P] Failed to stop:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('p2p:send', async (_event, to: string | null, data: unknown) => {
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
  const network = getP2PNetwork();
  return network ? network.getPeers() : [];
});

ipcMain.handle('p2p:getStatus', async () => {
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
  loggerLog('[Presence] Broadcasting presence update from manager to renderer queue');
  queuePresenceUpdate(payload);
}

export function attachPresenceListeners(
  manager: ReturnType<typeof getPresenceManager>
): void {
  if (!manager) return;
  loggerLog('[Presence] Attaching manager listeners.');
  manager.on('presence-updated', broadcastPresenceUpdate);
}

export function clearLateReticulumBridgeRecovery(): void {
  lateReticulumRecoveryCleanup?.();
  lateReticulumRecoveryCleanup = null;
}

export function registerLateReticulumBridgeRecovery(
  network: NonNullable<ReturnType<typeof getP2PNetwork>>
): void {
  clearLateReticulumBridgeRecovery();
  const bridge = getReticulumBridge();
  if (!bridge) {
    loggerWarn('[ReticulumBridge] Late recovery not registered: no bridge instance');
    return;
  }

  let recovered = false;
  const recoverManagers = () => {
    if (recovered) return;
    recovered = true;
    clearLateReticulumBridgeRecovery();

    const currentBridge = getReticulumBridge();
    if (!currentBridge || currentBridge.getState() !== 'ready') {
      loggerWarn(
        '[ReticulumBridge] Late recovery skipped: bridge missing or not ready'
      );
      return;
    }

    loggerLog(
      '[ReticulumBridge] Bridge became ready after startup timeout; reattaching presence/call managers'
    );
    stopPresenceManager();
    const pm = startPresenceManager([currentBridge]);
    attachPresenceListeners(pm);
    stopCallManager();
    const callMgr = startCallManager(network, pm, currentBridge);
    attachCallListeners(callMgr);
    stopGroupCallManager();
    const gcallMgr = startGroupCallManager(network, pm, currentBridge);
    attachGroupCallListeners(gcallMgr);
    flushPresenceUpdates();
    broadcastToSet(presenceUpdateSubscribers, 'presence:started', {});
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
  const pm = getPresenceManager();
  if (!pm) {
    loggerLog('[Presence] Local envelope dropped because manager is unavailable.');
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
    return { success: ok };
  } catch (err) {
    loggerError('[Presence] offline error:', err);
    return { success: false, error: (err as Error).message };
  }
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

export function attachCallListeners(
  manager: ReturnType<typeof getCallManager>
): void {
  if (!manager) return;

  const forward = (channel: string) => (payload: unknown) =>
    broadcastToSet(callSubscribers, channel, payload);

  manager.on('call:incoming', forward('call:incoming'));
  manager.on('call:accepted', forward('call:accepted'));
  manager.on('call:rejected', forward('call:rejected'));
  manager.on('call:signal', forward('call:signal'));
  manager.on('call:hangup', forward('call:hangup'));
  manager.on('call:audio', forward('call:audio'));
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
    timestamp: number
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
      timestamp
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
    mgr.acceptCall(callId, signature, publicKey, timestamp);
    return { success: true };
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
    timestamp?: number
  ) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    mgr.rejectCall(callId, reason, signature, publicKey, timestamp);
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
    mgr.hangUp(callId, signature, publicKey, timestamp);
    return { success: true };
  }
);

ipcMain.handle(
  'call:sendSignal',
  async (
    _event,
    callId: string,
    type: 'offer' | 'answer' | 'ice',
    data: unknown,
    signature?: string,
    publicKey?: string,
    timestamp?: number,
    sdpHash?: string
  ) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    mgr.sendSignal(callId, type, data, signature, publicKey, timestamp, sdpHash);
    return { success: true };
  }
);

ipcMain.handle(
  'call:sendAudio',
  async (_event, callId: string, seq: number, data: string) => {
    const mgr = getCallManager();
    if (!mgr) return { success: false, error: 'Call manager not running' };
    mgr.sendAudioChunk(callId, seq, data);
    return { success: true };
  }
);

ipcMain.handle('call:getPublicIpPeers', async () => {
  const network = getP2PNetwork();
  return network ? network.getPublicIpPeers() : [];
});

ipcMain.handle('call:whoami', async () => {
  const network = getP2PNetwork();
  if (!network) return null;
  return network.askWhoAmI();
});

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
});
ipcMain.on('call:unsubscribe', (event) => {
  callSubscribers.delete(event.sender);
});

// ── Group Call IPC Handlers ───────────────────────────────────────────────────

const gcallSubscribers = new Set<Electron.WebContents>();
/** Sidebar / list: lightweight `gcall:qortal-group-call-activity` only (no full GC_* stream). */
const gcallActivitySubscribers = new Set<Electron.WebContents>();

export function attachGroupCallListeners(
  manager: ReturnType<typeof getGroupCallManager>
): void {
  if (!manager) return;

  const forward = (channel: string) => (payload: unknown) =>
    broadcastToSet(gcallSubscribers, channel, payload);

  manager.on('gcall:participant-joined', forward('gcall:participant-joined'));
  manager.on('gcall:participant-left', forward('gcall:participant-left'));
  manager.on('gcall:topology', forward('gcall:topology'));
  manager.on('gcall:cluster-heartbeat', forward('gcall:cluster-heartbeat'));
  manager.on('gcall:heartbeat', forward('gcall:heartbeat'));
  manager.on('gcall:audio', forward('gcall:audio'));
  manager.on('gcall:key', forward('gcall:key'));
  manager.on('gcall:key-request', forward('gcall:key-request'));
  manager.on('gcall:session-updated', forward('gcall:session-updated'));
  manager.on('gcall:qortal-group-call-activity', (payload: unknown) =>
    broadcastToSet(gcallActivitySubscribers, 'gcall:qortal-group-call-activity', payload)
  );
}

ipcMain.handle(
  'gcall:join',
  async (
    _event,
    roomId: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    joinGeneration?: number,
    topologyEpochFloor?: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    const session = mgr.joinRoom(
      roomId,
      chatId,
      localAddress,
      signature,
      publicKey,
      timestamp,
      joinGeneration,
      topologyEpochFloor
    );
    return {
      success: true,
      callSessionId: session.callSessionId,
      mediaSessionGeneration: session.mediaSessionGeneration,
    };
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
    timestamp: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.leaveRoom(roomId, localAddress, signature, publicKey, timestamp);
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
    timestamp: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) {
      event.returnValue = {
        success: false,
        error: 'GroupCall manager not running',
      };
      return;
    }
    mgr.leaveRoom(roomId, localAddress, signature, publicKey, timestamp);
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
    timestamp: number
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.broadcastTopology(
      roomId,
      topology as any,
      signature,
      publicKey,
      timestamp
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
  'gcall:sendAudio',
  async (
    _event,
    roomId: string,
    toAddress: string,
    data: Buffer | Uint8Array
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const GCALL_IPC_SEND_AUDIO_MAX_BYTES = 12_288;
    if (buf.length > GCALL_IPC_SEND_AUDIO_MAX_BYTES) {
      return { success: false, error: 'payload-too-large' };
    }
    const ok = mgr.sendAudio(roomId, toAddress, buf);
    return ok ? { success: true } : { success: false, error: 'relay-rejected' };
  }
);

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
    mgr.sendKey(
      roomId,
      toAddress,
      encryptedKey,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      meta
    );
    return { success: true };
  }
);

ipcMain.handle(
  'gcall:sendKeyRotate',
  async (
    _event,
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
  ) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.sendKeyRotate(
      roomId,
      encryptedKeys,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      meta
    );
    return { success: true };
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
  async (_event, addresses: string[]) => {
    const mgr = getGroupCallManager();
    if (!mgr) return { success: false, error: 'GroupCall manager not running' };
    mgr.setLocalAddresses(Array.isArray(addresses) ? addresses : []);
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

ipcMain.handle('gcall:getRoomBootstrapState', async (_event, roomId: string) => {
  const mgr = getGroupCallManager();
  if (!mgr) return null;
  return mgr.getRoomBootstrapState(roomId);
});

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

ipcMain.on('gcall:subscribe', (event) => {
  gcallSubscribers.add(event.sender);
});
ipcMain.on('gcall:unsubscribe', (event) => {
  gcallSubscribers.delete(event.sender);
});
ipcMain.on('gcall:subscribe-activity', (event) => {
  gcallActivitySubscribers.add(event.sender);
});
ipcMain.on('gcall:unsubscribe-activity', (event) => {
  gcallActivitySubscribers.delete(event.sender);
});

ipcMain.handle('gcall:setWatchedQortalGroupIds', async (_event, ids: unknown) => {
  const mgr = getGroupCallManager();
  if (!mgr) return { success: false, error: 'GroupCall manager not running' };
  const list = Array.isArray(ids) ? (ids as number[]) : [];
  const activeByGroupId = mgr.setWatchedQortalGroupIds(list);
  return { success: true, activeByGroupId };
});
