/// <reference types="vite/client" />

/** Support: run `await window.__qortalGCallExportDiagnostics?.()` in DevTools to download JSON. */
interface Window {
  __qortalGCallExportDiagnostics?: () => Promise<void>;
  __qortalGCallPerfStats?: () => unknown;
}

export {};
