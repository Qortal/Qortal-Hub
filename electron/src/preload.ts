require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below
console.log('User Preload!');
const { contextBridge, shell, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => shell.openExternal(url),
  setAllowedDomains: (domains) => {
    ipcRenderer.send('set-allowed-domains', domains);
  },
});

contextBridge.exposeInMainWorld('electron', {
  onUpdateAvailable: (callback) => ipcRenderer.on('update_available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update_downloaded', callback),
  restartApp: () => ipcRenderer.send('restart_app'),
  selectFile: async () => ipcRenderer.invoke('dialog:openFile'),
  readFile: async (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  selectAndZipDirectory: async (filePath) => ipcRenderer.invoke('fs:selectAndZip', filePath),

});

ipcRenderer.send('test-ipc');