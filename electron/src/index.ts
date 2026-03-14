import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  getCapacitorElectronConfig,
  setupElectronDeepLinking,
} from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem, dialog, session } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import {
  installCertificateVerification,
  installLocalNodeHttpsBlock,
  loadPersistedLocalNodeCa,
} from './local-https-cert';
import { log as loggerLog, error as loggerError } from './logger';
import {
  ElectronCapacitorApp,
  flushPersistentStore,
  setupContentSecurityPolicy,
  setupReloadWatcher,
} from './setup';

import * as net from 'net';

app.commandLine.appendSwitch(
  'disable-features',
  'BlockInsecurePrivateNetworkRequests'
);

// app.commandLine.appendSwitch('ignore-certificate-errors');

// Graceful handling of unhandled errors.
unhandled();

// Flag to track if the app is quitting
export let isQuitting = false;

// Function to set the quitting flag
export function setIsQuitting(value: boolean) {
  isQuitting = value;
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

async function setupMultiInstanceUserData(basePort = 55000, maxInstances = 10) {
  for (let i = 0; i < maxInstances; i++) {
    const port = basePort + i;
    if (!(await isPortTaken(port))) {
      // First instance — use default Electron behavior
      if (i === 0) {
        loggerLog(
          `🟢 Using default userData path: ${app.getPath('userData')}`
        );
      } else {
        const instanceName = `qortal-instance-${i + 1}`;
        const userDataPath = path.join(app.getPath('appData'), instanceName);
        app.setPath('userData', userDataPath);
        loggerLog(`🟢 Using custom userData path: ${userDataPath}`);
      }

      // Reserve the port so this instance is considered active
      net.createServer().listen(port, '127.0.0.1');
      return;
    }
  }

  loggerError('❌ Too many instances already running.');
  app.quit();
}

// Run Application
(async () => {
  setupMultiInstanceUserData();

  await app.whenReady();

  // Set Content Security Policy
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());

  // Install cert verify proc and block HTTPS to local node until ensureCertForBase has run (default session).
  installCertificateVerification(session.defaultSession);
  installLocalNodeHttpsBlock(session.defaultSession);

  // Apply persisted local node CA (if any) so first request has the CA and Chromium doesn't cache a failure.
  loadPersistedLocalNodeCa();

  await myCapacitorApp.init();

  // Also set on main window session (same as default when no partition; ensures activate/recreate path is covered)
  const mainWindow = myCapacitorApp.getMainWindow();
  if (mainWindow) {
    installCertificateVerification(mainWindow.webContents.session);
  }

  // Start update checks
  checkForUpdates();
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000);
})();

// Set isQuitting flag before the app quits
app.on('before-quit', () => {
  setIsQuitting(true);
  flushPersistentStore();
});

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
    await myCapacitorApp.init();
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
