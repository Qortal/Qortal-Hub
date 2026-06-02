/// <reference types="vite/client" />

/** Support: run `await window.__qortalGCallExportDiagnostics?.()` in DevTools to save JSON (Electron save dialog when available). */
interface Window {
  __qortalGCallExportDiagnostics?: () => Promise<void>;
  __qortalGCallPerfStats?: () => unknown;
}

export {};
