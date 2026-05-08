declare global {
  interface Window {
    appStorage?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    coreSetup?: {
      isCoreRunning?: () => Promise<boolean>;
      isCoreRunningOnSystem?: () => Promise<boolean>;
      isCoreInstalledOnSystem?: () => Promise<boolean>;
      isCoreInstalled?: () => Promise<boolean>;
      verifySteps?: () => Promise<void>;
      deleteDB?: () => Promise<boolean>;
      dbExists?: () => Promise<boolean>;
      installCore?: () => Promise<unknown>;
      startCore?: () => Promise<unknown>;
      getApiKey?: () => Promise<string>;
      resetApikey?: () => Promise<boolean>;
      pickQortalDirectory?: () => Promise<unknown>;
      removeCustomPath?: () => Promise<void>;
      stopCore?: () => Promise<boolean>;
      bootstrap?: () => Promise<boolean>;
      bootstrapOrClearChainAndStart?: () => Promise<boolean>;
      onProgress?: (cb: (p: unknown) => void) => () => void;
    };
    electronAPI?: {
      openExternal?: (url: string) => void;
      setAllowedDomains?: (domains: string[]) => void;
      ensureCertForBase?: (
        baseUrl: string,
        apiKey?: string
      ) => Promise<{ success: boolean; error?: string }>;
      windowMinimize?: () => void;
      windowMaximize?: () => Promise<void>;
      windowClose?: () => void;
      focusWindow?: () => Promise<void>;
      getWindowState?: () => Promise<{ isMaximized: boolean }>;
      onWindowStateChange?: (
        callback: (state: { isMaximized: boolean }) => void
      ) => () => void;
      getPlatform?: () => Promise<string>;
      showAppMenu?: (x?: number, y?: number) => void;
      getAppSettings?: () => Promise<{ closeAction?: 'ask' | 'minimizeToTray' | 'quit' }>;
      setAppSettings?: (settings: { closeAction?: 'ask' | 'minimizeToTray' | 'quit' }) => Promise<{ closeAction?: 'ask' | 'minimizeToTray' | 'quit' }>;
    };
    videoServer?: {
      start: (port?: number) => Promise<{ success: boolean; port?: number; error?: string }>;
      stop: () => Promise<{ success: boolean; error?: string }>;
      getPort: () => Promise<number | null>;
      isRunning: () => Promise<boolean>;
    };
  }
}

export {};

