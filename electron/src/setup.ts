import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  CapElectronEventEmitter,
  CapacitorSplashScreen,
  setupCapacitorElectronPlugins,
} from '@capacitor-community/electron';
import chokidar from 'chokidar';
import type { MenuItemConstructorOptions } from 'electron';
import { app, BrowserWindow, Menu, MenuItem, nativeImage, Tray, session, ipcMain, dialog } from 'electron';
import electronIsDev from 'electron-is-dev';
import electronServe from 'electron-serve';
import windowStateKeeper from 'electron-window-state';
const AdmZip = require('adm-zip');
import { join } from 'path';
import { myCapacitorApp } from '.';
const fs = require('fs');
const path = require('path')

const defaultDomains = [
  'capacitor-electron://-',
  'http://127.0.0.1:12391',
  'ws://127.0.0.1:12391',
  'https://ext-node.qortal.link',
  'wss://ext-node.qortal.link',           
  'https://appnode.qortal.org',             
  'wss://appnode.qortal.org',               
  "https://api.qortal.org",                   
  "https://api2.qortal.org",                  
  "https://apinode.qortalnodes.live",       
  "https://apinode1.qortalnodes.live",
  "https://apinode2.qortalnodes.live",
  "https://apinode3.qortalnodes.live",
  "https://apinode4.qortalnodes.live",
  "https://www.qort.trade"                    
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
export function setupReloadWatcher(electronCapacitorApp: ElectronCapacitorApp): void {
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

    this.customScheme = this.CapacitorFileConfig.electron?.customUrlScheme ?? 'capacitor-electron';

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
      join(app.getAppPath(), 'assets', process.platform === 'win32' ? 'appIcon.ico' : 'appIcon.png')
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
        // Use preload to inject the electron varriant overrides for capacitor plugins.
        // preload: join(app.getAppPath(), "node_modules", "@capacitor-community", "electron", "dist", "runtime", "electron-rt.js"),
        preload: preloadPath      },
    });
    this.mainWindowState.manage(this.MainWindow);

    if (this.CapacitorFileConfig.backgroundColor) {
      this.MainWindow.setBackgroundColor(this.CapacitorFileConfig.electron.backgroundColor);
    }

    // If we close the main window with the splashscreen enabled we need to destory the ref.
    this.MainWindow.on('closed', () => {
      if (this.SplashScreen?.getSplashWindow() && !this.SplashScreen.getSplashWindow().isDestroyed()) {
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
      this.TrayIcon.setContextMenu(Menu.buildFromTemplate(this.TrayMenuTemplate));
    }

    // Setup the main manu bar at the top of our window.
    Menu.setApplicationMenu(Menu.buildFromTemplate(this.AppMenuBarMenuTemplate));

    // If the splashscreen is enabled, show it first while the main window loads then switch it out for the main window, or just load the main window from the start.
    if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
      this.SplashScreen = new CapacitorSplashScreen({
        imageFilePath: join(
          app.getAppPath(),
          'assets',
          this.CapacitorFileConfig.electron?.splashScreenImageName ?? 'splash.png'
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
        CapElectronEventEmitter.emit('CAPELECTRON_DeeplinkListenerInitialized', '');
      }, 400);
    });
  }
}




export function setupContentSecurityPolicy(customScheme: string): void {
  session.defaultSession.webRequest.onHeadersReceived((details: any, callback) => {
    const allowedSources = ["'self'", customScheme, ...domainHolder.allowedDomains];
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
  `.replace(/\s+/g, ' ').trim();
  
   
    // Get the request URL and origin
    const requestUrl = details.url;
    const requestOrigin = details.origin || details.referrer || 'capacitor-electron://-';

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
    const hasAccessControlAllowOrigin = Object.keys(details.responseHeaders).some(
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
      responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, DELETE';
      responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, x-api-key';
    }

    // Callback with modified headers
    callback({ responseHeaders });
  });
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
  const newAllowedDomains = [...new Set([...defaultDomains, ...validatedUserDomains])];

  // Sort both current allowed domains and new domains for comparison
  const sortedCurrentDomains = [...domainHolder.allowedDomains].sort();
  const sortedNewDomains = [...newAllowedDomains].sort();

  // Check if the lists are different
  const hasChanged =
    sortedCurrentDomains.length !== sortedNewDomains.length ||
    sortedCurrentDomains.some((domain, index) => domain !== sortedNewDomains[index]);

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
      { name: 'ZIP Files', extensions: ['zip'] } // Restrict to ZIP files
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
    
    return fileBuffer

  } catch (error) {
    console.error('Error reading file:', error.message);
    return null; // Return null on error
  }
});

ipcMain.handle('fs:selectAndZip', async (_, path) => {
  let directoryPath = path
  if(!directoryPath){
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

   return {buffer: zipBuffer, directoryPath}
} catch (error) {
    return null
}
});

