/**
 * Logger for Electron main/preload.
 *
 * Always uses `console` when available so output shows in the terminal if you
 * start the app from a shell (dev or packaged). Preload logs typically appear
 * in DevTools, not the parent terminal.
 *
 * Uses a safe runtime check so it works in preload (where electron.app is undefined).
 */
const noop = (..._args: unknown[]) => {};

function makeLogger(
  method: 'log' | 'error' | 'warn' | 'debug' | 'info'
): (...args: unknown[]) => void {
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
