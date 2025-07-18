require('./rt/electron-rt');

// ------------------- User Preload starts here -------------------
console.log('User Preload!');

const { contextBridge, shell, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Grab `--userDataPath=...` from process arguments (injected from main process)
const userDataArg = process.argv.find((arg) =>
  arg.startsWith('--userDataPath=')
);
const userDataPath = userDataArg?.split('=')[1] || '.';

// Define path to the wallet storage JSON file
const filePath = path.join(userDataPath, 'wallet-storage.json');

// Manual JSON storage functions
function readData() {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeData(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

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

// 👇 New: Expose walletStorage to the frontend
contextBridge.exposeInMainWorld('walletStorage', {
  get: (key) => readData()[key],
  set: (key, value) => {
    const data = readData();
    data[key] = value;
    writeData(data);
  },
  delete: (key) => {
    const data = readData();
    delete data[key];
    writeData(data);
  },
});

ipcRenderer.send('test-ipc');
