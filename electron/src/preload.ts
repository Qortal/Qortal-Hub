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
    focusWindow: () => ipcRenderer.invoke('window:focus'),
    getWindowState: () =>
      ipcRenderer
        .invoke('window:isMaximized')
        .then((isMaximized: boolean) => ({ isMaximized })),
    getPlatform: () => ipcRenderer.invoke('window:getPlatform'),
    showAppMenu: (x?: number, y?: number) =>
      ipcRenderer.invoke('window:showAppMenu', { x, y }),
    getAppSettings: () => ipcRenderer.invoke('appSettings:get'),
    setAppSettings: (settings: {
      closeAction?: 'ask' | 'minimizeToTray' | 'quit';
      p2pEnabled?: boolean;
    }) => ipcRenderer.invoke('appSettings:set', settings),
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

  // P2P Network API
  contextBridge.exposeInMainWorld('p2pNetwork', {
    start: async (options?: {
      port?: number;
      maxPeers?: number;
      initialPeers?: string[];
    }) => ipcRenderer.invoke('p2p:start', options),

    stop: async () => ipcRenderer.invoke('p2p:stop'),

    send: async (to: string | null, data: unknown) =>
      ipcRenderer.invoke('p2p:send', to, data),

    getPeers: async () => ipcRenderer.invoke('p2p:getPeers'),

    getStatus: async () => ipcRenderer.invoke('p2p:getStatus'),

    addPeer: async (addr: string) => ipcRenderer.invoke('p2p:addPeer', addr),

    /** Subscribe to incoming messages. Returns an unsubscribe function. */
    onMessage: (cb: (payload: { id: string; from: string; via?: string; to?: string; data: unknown }) => void) => {
      const handler = (_e: unknown, payload: unknown) => cb(payload as any);
      ipcRenderer.on('p2p:message', handler);
      ipcRenderer.send('p2p:message:subscribe');
      return () => {
        ipcRenderer.removeListener('p2p:message', handler);
        ipcRenderer.send('p2p:message:unsubscribe');
      };
    },

    /** Subscribe to peer connect/disconnect events. Returns an unsubscribe function. */
    onPeerChange: (cb: (payload: { type: 'connected' | 'disconnected'; id: string }) => void) => {
      const handler = (_e: unknown, payload: unknown) => cb(payload as any);
      ipcRenderer.on('p2p:peerChange', handler);
      ipcRenderer.send('p2p:peerChange:subscribe');
      return () => {
        ipcRenderer.removeListener('p2p:peerChange', handler);
        ipcRenderer.send('p2p:peerChange:unsubscribe');
      };
    },
  });

  // Presence API — see electron/src/presence.ts for full type definitions.
  //
  // Renderer responsibilities:
  //   1. Generate sessionId (crypto.randomUUID())
  //   2. Build the canonical signed-data object (sorted keys → JSON → UTF-8)
  //   3. Sign with nacl.sign.detached(bytes, privateKeyBytes) → Base58-encode
  //   4. Call window.presence.announce(envelope) on login
  //   5. Call window.presence.heartbeat(envelope) every 25 s
  //   6. Call window.presence.offline(envelope) on logout / close
  //
  // Canonical signed data shape:
  //   announce:  { type, address, publicKey, sessionId, timestamp, clientVersion }
  //   heartbeat: { type, address, publicKey, sessionId, timestamp }
  //   offline:   { type, address, publicKey, sessionId, timestamp }
  //   (keys sorted alphabetically before JSON.stringify)
  contextBridge.exposeInMainWorld('presence', {
    /**
     * Announce that the local user is online.
     * The renderer must sign the envelope before calling this.
     */
    announce: async (envelope: unknown) =>
      ipcRenderer.invoke('presence:announce', envelope),

    /** Send a periodic heartbeat to keep the session alive (every 25 s). */
    heartbeat: async (envelope: unknown) =>
      ipcRenderer.invoke('presence:heartbeat', envelope),

    /** Announce that the local user is going offline. */
    offline: async (envelope: unknown) =>
      ipcRenderer.invoke('presence:offline', envelope),

    /** Check whether an address is currently online. */
    getStatus: async (address: string) =>
      ipcRenderer.invoke('presence:getStatus', address),

    /** Get an array of all currently online addresses. */
    getOnlineAddresses: async () =>
      ipcRenderer.invoke('presence:getOnlineAddresses'),

    /** Get full session info for all online users. */
    getAllOnline: async () =>
      ipcRenderer.invoke('presence:getAllOnline'),

    /**
     * Subscribe to presence updates (connect / timeout / logout).
     * `cb` receives `{ address: string; online: boolean }`.
     * Returns an unsubscribe function.
     */
    onUpdate: (cb: (payload: { address: string; online: boolean; status: 'online' | 'away' | 'busy' | 'idle' | null }) => void) => {
      const handler = (_e: unknown, payload: unknown) => cb(payload as any);
      ipcRenderer.on('presence:update', handler);
      ipcRenderer.send('presence:subscribe');
      return () => {
        ipcRenderer.removeListener('presence:update', handler);
        ipcRenderer.send('presence:unsubscribe');
      };
    },

    /**
     * Subscribe to a one-shot "all presence cleared" event that fires when
     * P2P is disabled.  Returns an unsubscribe function.
     */
    onCleared: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('presence:cleared', handler);
      return () => ipcRenderer.removeListener('presence:cleared', handler);
    },

    /** Subscribe to the "P2P started" event (fired when P2P is re-enabled). */
    onStarted: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('presence:started', handler);
      return () => ipcRenderer.removeListener('presence:started', handler);
    },
  });

  ipcRenderer.send('test-ipc');
} catch (error) {
  loggerError('error', error);
}
