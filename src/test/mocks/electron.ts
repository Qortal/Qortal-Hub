export const app = {
  getAppPath: () => process.cwd(),
  getPath: (name: string) =>
    name === 'userData' ? '/tmp/qortal-userdata' : '/tmp/qortal-appdata',
  isPackaged: false,
};

export class BrowserWindow {
  static getAllWindows() {
    return [];
  }
}

export const dialog = {
  showErrorBox: () => undefined,
  showMessageBox: async () => ({ response: 0 }),
};

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
  removeAllListeners: () => undefined,
  removeHandler: () => undefined,
};

export const ipcRenderer = {
  invoke: async () => undefined,
  on: () => undefined,
  removeAllListeners: () => undefined,
  send: () => undefined,
};

export const contextBridge = {
  exposeInMainWorld: () => undefined,
};

export const shell = {
  openExternal: async () => undefined,
};

