/**
 * DM voice diagnostics: **console output always runs** (filter DevTools by `[DM voice]`).
 * The on-screen ring buffer + `DirectVoiceDebugPanel` are opt-in:
 * `localStorage.setItem('qortal:dmvoice-debug', '1')` (or dev builds unless set to `0`).
 */

export type DirectVoiceUiLogLevel = 'log' | 'warn';

export interface DirectVoiceUiLogEntry {
  t: number;
  level: DirectVoiceUiLogLevel;
  msg: string;
  detail?: Record<string, unknown>;
}

const STORAGE_KEY = 'qortal:dmvoice-debug';
const MAX_ENTRIES = 150;

const entries: DirectVoiceUiLogEntry[] = [];
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const l of listeners) l();
}

export function isDirectVoiceUiLogEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === '1' || v === 'on') return true;
    if (v === '0' || v === 'off') return false;
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

export function clearDirectVoiceUiLogs(): void {
  entries.length = 0;
  bump();
}

export function pushDirectVoiceUiLog(
  level: DirectVoiceUiLogLevel,
  msg: string,
  detail?: Record<string, unknown>,
  /** Throttled/noisy lines: use `debug` so default DevTools level stays readable (enable “Verbose” to see). */
  consoleKind: 'log' | 'warn' | 'debug' = level === 'warn' ? 'warn' : 'log'
): void {
  const line =
    detail && Object.keys(detail).length > 0
      ? `[DM voice] ${msg} ${JSON.stringify(detail)}`
      : `[DM voice] ${msg}`;
  if (consoleKind === 'warn') {
    console.warn(line);
  } else if (consoleKind === 'debug') {
    console.debug(line);
  } else {
    console.log(line);
  }

  if (!isDirectVoiceUiLogEnabled()) return;

  entries.push({
    t: Date.now(),
    level,
    msg,
    detail,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  bump();
}

export function getDirectVoiceUiLogsVersion(): number {
  return version;
}

export function getDirectVoiceUiLogsSnapshot(): readonly DirectVoiceUiLogEntry[] {
  return entries;
}

export function subscribeDirectVoiceUiLogs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}
