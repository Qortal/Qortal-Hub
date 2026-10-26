import { EventEmitter } from 'node:events';

export default '/mock/electron';

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
  removeListener: () => undefined,
  handle: () => undefined,
  on: () => undefined,
  removeAllListeners: () => undefined,
  removeHandler: () => undefined,
};

export const systemPreferences = {
  getMediaAccessStatus: (_type: string) => 'granted',
};

export const desktopCapturer = {
  getSources: async (_options?: unknown): Promise<unknown[]> => [],
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

// Renderer/debugger lifecycle fake shared by Electron diagnostic tests.
export class MockWebContents extends EventEmitter {
  id = 42;
  destroyed = false;
  devToolsOpened = false;
  isDevToolsOpened() {
    return this.devToolsOpened;
  }
  isDestroyed() {
    return this.destroyed;
  }
  debugger = new (class extends EventEmitter {
    attached = false;
    isAttached() {
      return this.attached;
    }
    attach(_version?: string) {
      this.attached = true;
    }
    detach() {
      this.attached = false;
      this.emit('detach', {}, 'target closed');
    }
    async sendCommand(_method: string, _params?: object): Promise<any> {
      return {
        profile: { nodes: [], startTime: 0, endTime: 1000, samples: [] },
      };
    }
  })();
  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
    this.debugger.detach();
  }
}
