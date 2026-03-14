// ------------------- User Preload starts here -------------------
require('./rt/electron-rt');

import { log as loggerLog, error as loggerError } from './logger';
loggerLog('User Preload!');
import { contextBridge, shell, ipcRenderer } from 'electron';

try {
  // Expose Electron API
  contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url) => shell.openExternal(url),
    setAllowedDomains: (domains) => {
      ipcRenderer.send('set-allowed-domains', domains);
    },
    ensureCertForBase: (baseUrl: string, apiKey?: string) =>
      ipcRenderer.invoke('cert:ensureForBase', baseUrl, apiKey),
    // Custom title bar window controls
    windowMinimize: () => ipcRenderer.invoke('window:minimize'),
    windowMaximize: () => ipcRenderer.invoke('window:maximize'),
    windowClose: () => ipcRenderer.invoke('window:close'),
    getWindowState: () =>
      ipcRenderer.invoke('window:isMaximized').then((isMaximized: boolean) => ({ isMaximized })),
    getPlatform: () => ipcRenderer.invoke('window:getPlatform'),
    showAppMenu: (x?: number, y?: number) =>
      ipcRenderer.invoke('window:showAppMenu', { x, y }),
    getAppSettings: () => ipcRenderer.invoke('appSettings:get'),
    setAppSettings: (settings: { closeAction?: 'ask' | 'minimizeToTray' | 'quit' }) =>
      ipcRenderer.invoke('appSettings:set', settings),
  });

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

  ipcRenderer.send('test-ipc');
} catch (error) {
  loggerError('error', error);
}
