// ------------------- User Preload starts here -------------------
require('./rt/electron-rt');

console.log('User Preload!');
import { contextBridge, shell, ipcRenderer } from 'electron';

try {
  // Expose Electron API
  contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url) => shell.openExternal(url),
    setAllowedDomains: (domains) => {
      ipcRenderer.send('set-allowed-domains', domains);
    },
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
    isCoreInstalled: async () => {
      const raw = await ipcRenderer.invoke('coreSetup:isCoreInstalled');
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

  ipcRenderer.send('test-ipc');
} catch (error) {
  console.log('error', error);
}
