declare global {
  interface Window {
    appStorage?: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    coreSetup?: unknown;
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
      getWindowState?: () => Promise<{ isMaximized: boolean }>;
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

