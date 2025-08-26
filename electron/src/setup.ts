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
import { join } from 'path';
import { myCapacitorApp } from '.';
import {
  checkOsPlatform,
  customQortalInstalledDir,
  determineJavaVersion,
  getApiKey,
  installCore,
  isCoreInstalled,
  isCoreRunning,
  removeCustomQortalPath,
  resetApikey,
  startCore,
} from './core';

const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const defaultDomains = [
  'capacitor-electron://-',
  'http://127.0.0.1:12391',
  'ws://127.0.0.1:12391',
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

  async init(): Promise<void> {
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
    this.MainWindow = new BrowserWindow({
      icon,
      show: false,
      x: this.mainWindowState.x,
      y: this.mainWindowState.y,
      width: this.mainWindowState.width,
      height: this.mainWindowState.height,
      backgroundColor: '#27282c',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: preloadPath,
      },
    });
    this.mainWindowState.manage(this.MainWindow);

    if (this.CapacitorFileConfig.backgroundColor) {
      this.MainWindow.setBackgroundColor(
        this.CapacitorFileConfig.electron.backgroundColor
      );
    }

    // If we close the main window with the splashscreen enabled we need to destory the ref.
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
      this.TrayIcon = new Tray(icon);
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
      this.TrayIcon.setToolTip(app.getName());
      this.TrayIcon.setContextMenu(
        Menu.buildFromTemplate(this.TrayMenuTemplate)
      );
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
      const allowedSources = [
        "'self'",
        customScheme,
        ...domainHolder.allowedDomains,
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

      // Prepare response headers
      const responseHeaders: Record<string, string | string[]> = {
        ...details.responseHeaders,
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
    console.error('Error reading file:', error.message);
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
      console.log('No directory selected');
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

// READ handler
ipcMain.handle('walletStorage:read', async (_event, fileName: string) => {
  try {
    const filePath = await getSharedSettingsFilePath(fileName);

    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) return null;

    return fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    console.error(`Error in walletStorage:read for "${fileName}"`, err);
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
      console.error(`Error in walletStorage:write for "${fileName}"`, err);
      throw err;
    }
  }
);

const progressSubscribers = new Set<Electron.WebContents>();

ipcMain.on('coreSetup:progress:subscribe', (e) => {
  const wc = e.sender;
  progressSubscribers.add(wc);
  broadcastProgress('ready');
  broadcastProgress({
    type: 'osType',
    osType: process.platform
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
      console.error(error);
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
  } catch (error) { }
});

ipcMain.handle('coreSetup:isCoreInstalled', async (event) => {
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
  } catch (error) { }
});

ipcMain.handle('coreSetup:installCore', async (event) => {
  try {
    const wc = event.sender;

    const sendProgress = (p) => {
      wc.send('coreSetup:progress', { step: 'download', ...p });
    };
    const running = await installCore(sendProgress);
    return running;
  } catch (error) { }
});

ipcMain.handle('coreSetup:startCore', async () => {
  try {
    const running = await startCore();
    return running;
  } catch (error) { }
});

ipcMain.handle('coreSetup:getApiKey', async () => {
  try {
    const running = await getApiKey();
    return running;
  } catch (error) { }
});
ipcMain.handle('coreSetup:resetApikey', async () => {
  try {
    const running = await resetApikey();
    return running;
  } catch (error) { }
});
ipcMain.handle('coreSetup:removeCustomPath', async () => {
  try {
    await removeCustomQortalPath();
    broadcastProgress({
      type: 'hasCustomPath',
      hasCustomPath: false,
      customPath: null,
    });
  } catch (error) { }
});

ipcMain.handle('coreSetup:pickQortalDirectory', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    console.log('canceled, filePaths', canceled, filePaths);
    if (canceled || filePaths.length === 0) return null;
    const dir = filePaths[0];
    const isInstalled = await isCoreInstalled(dir);
    console.log('isInstalled', isInstalled);
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
    console.log('error', error);
  }
});

ipcMain.handle('start-core-electron', async () => {
  try {
    checkOsPlatform();
  } catch (error) { }
});
