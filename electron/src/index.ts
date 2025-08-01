import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  getCapacitorElectronConfig,
  setupElectronDeepLinking,
} from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import {
  ElectronCapacitorApp,
  setupContentSecurityPolicy,
  setupReloadWatcher,
} from './setup';

import * as net from 'net';

// Graceful handling of unhandled errors.
unhandled();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  new MenuItem({ label: 'Quit App', role: 'quit' }),
];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
  { role: 'editMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig =
  getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
export const myCapacitorApp = new ElectronCapacitorApp(
  capacitorFileConfig,
  trayMenuTemplate,
  appMenuBarMenuTemplate
);

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
    console.error('Error checking for updates:', error);
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

async function setupMultiInstanceUserData(basePort = 55000, maxInstances = 10) {
  for (let i = 0; i < maxInstances; i++) {
    const port = basePort + i;
    if (!(await isPortTaken(port))) {
      // First instance — use default Electron behavior
      if (i === 0) {
        console.log(
          `🟢 Using default userData path: ${app.getPath('userData')}`
        );
      } else {
        const instanceName = `qortal-instance-${i + 1}`;
        const userDataPath = path.join(app.getPath('appData'), instanceName);
        app.setPath('userData', userDataPath);
        console.log(`🟢 Using custom userData path: ${userDataPath}`);
      }

      // Reserve the port so this instance is considered active
      net.createServer().listen(port, '127.0.0.1');
      return;
    }
  }

  console.error('❌ Too many instances already running.');
  app.quit();
}

// Run Application
(async () => {
  setupMultiInstanceUserData();

  await app.whenReady();

  // Set Content Security Policy
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());

  // Initialize the app
  await myCapacitorApp.init();

  const win = myCapacitorApp.getMainWindow();
  if (win) {
    win.webContents.session.setPreloads([path.join(__dirname, 'preload.js')]); // optional if not using capacitor-managed preload
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  // Start update checks
  checkForUpdates();
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000);
})();

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line
