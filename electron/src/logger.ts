/**
 * Safe logger for Electron main/preload. In production, console.log/error/etc.
 * can crash the app (no DevTools, stdout/stderr not available). This module
 * only uses console in dev; in prod all methods are no-ops.
 * Uses a safe dev check so it works in preload (where electron.app is undefined).
 */
function getIsDev(): boolean {
  try {
    if ('ELECTRON_IS_DEV' in process.env) {
      return Number.parseInt(process.env.ELECTRON_IS_DEV as string, 10) === 1;
    }
    // Dynamic require: preload has no app; static import of electron-is-dev would crash here
    // eslint-disable-next-line -- require() required for preload-safe runtime check
    const electron = require('electron') as { app?: { isPackaged: boolean } };
    return electron?.app ? !electron.app.isPackaged : false;
  } catch {
    return false;
  }
}

const isDev = getIsDev();
const noop = (..._args: unknown[]) => {};

function makeLogger(
  method: 'log' | 'error' | 'warn' | 'debug' | 'info'
): (...args: unknown[]) => void {
  if (!isDev) return noop;
  try {
    const c = typeof console !== 'undefined' ? console : null;
    return c && typeof c[method] === 'function'
      ? (c[method] as (...args: unknown[]) => void).bind(c)
      : noop;
  } catch {
    return noop;
  }
}

export const log = makeLogger('log');
export const error = makeLogger('error');
export const warn = makeLogger('warn');
export const debug = makeLogger('debug');
export const info = makeLogger('info');

export default { log, error, warn, debug, info };
