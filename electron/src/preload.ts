require('./rt/electron-rt');

// ------------------- User Preload starts here -------------------
console.log('User Preload!');

const { contextBridge, shell, ipcRenderer } = require('electron');

// Expose Electron API
contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => shell.openExternal(url),
  setAllowedDomains: (domains) => {
    ipcRenderer.send('set-allowed-domains', domains);
  },
});

// Expose other utility functions
contextBridge.exposeInMainWorld('electron', {
  onUpdateAvailable: (callback) => ipcRenderer.on('update_available', callback),
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

ipcRenderer.send('test-ipc');
