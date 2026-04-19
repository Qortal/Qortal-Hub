/**
 * Logger for Electron main/preload.
 *
 * Always uses `console` when available so output shows in the terminal if you
 * start the app from a shell (dev or packaged). Preload logs typically appear
 * in DevTools, not the parent terminal.
 *
 * In the main process only, logs are also appended asynchronously to
 * userData/logs/qortalHub.log (batched, non-blocking). Rotates at ~10 MiB to
 * qortalHub.log.1. Preload does not touch the filesystem here (no electron.app).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { format } from 'util';

const nodeRequire = createRequire(__filename);

const noop = (..._args: unknown[]) => {};

const LOG_FILE = 'qortalHub.log';
const MAX_LOG_BYTES = 10 * 1024 * 1024;

const pendingLines: string[] = [];
let flushScheduled = false;
let logFilePath: string | null = null;
let fileSinkTried = false;
/** Byte length of current log file on disk (UTF-8), best-effort. */
let currentFileBytes = 0;

let ioChain: Promise<void> = Promise.resolve();

function resolveLogFilePath(): string | null {
  if (logFilePath !== null) return logFilePath;
  if (fileSinkTried) return null;
  if (process.type !== 'browser') return null;
  fileSinkTried = true;
  try {
    const { app } = nodeRequire('electron') as typeof import('electron');
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, LOG_FILE);
    if (fs.existsSync(logFilePath)) {
      currentFileBytes = fs.statSync(logFilePath).size;
    }
    return logFilePath;
  } catch {
    logFilePath = null;
    return null;
  }
}

function rotateLogFileSync(): void {
  if (!logFilePath) return;
  const rotated = `${logFilePath}.1`;
  try {
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(logFilePath)) fs.renameSync(logFilePath, rotated);
  } catch {
    /* ignore */
  }
  currentFileBytes = 0;
}

function scheduleFileFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(() => {
    flushScheduled = false;
    const chunk = pendingLines.splice(0, pendingLines.length).join('');
    if (!chunk || !logFilePath) return;
    ioChain = ioChain
      .then(async () => {
        const byteLen = Buffer.byteLength(chunk, 'utf8');
        try {
          if (currentFileBytes + byteLen > MAX_LOG_BYTES) {
            rotateLogFileSync();
          }
          await fs.promises.appendFile(logFilePath!, chunk, 'utf8');
          currentFileBytes += byteLen;
        } catch {
          /* disk full / permissions — avoid throwing into unhandledRejection */
        }
      })
      .catch(() => {});
  });
}

function queueFileLine(level: string, args: readonly unknown[]): void {
  if (process.type !== 'browser') return;
  if (!resolveLogFilePath()) return;
  const line = `[${new Date().toISOString()}] [${level}] ${format(...args)}\n`;
  pendingLines.push(line);
  scheduleFileFlush();
}

function makeLogger(
  method: 'log' | 'error' | 'warn' | 'debug' | 'info',
  fileLevel: string
): (...args: unknown[]) => void {
  try {
    const c = typeof console !== 'undefined' ? console : null;
    return c && typeof c[method] === 'function'
      ? (...args: unknown[]) => {
          (c[method] as (...args: unknown[]) => void).apply(c, args);
          queueFileLine(fileLevel, args);
        }
      : noop;
  } catch {
    return noop;
  }
}

export const log = makeLogger('log', 'LOG');
export const error = makeLogger('error', 'ERROR');
export const warn = makeLogger('warn', 'WARN');
export const debug = makeLogger('debug', 'DEBUG');
export const info = makeLogger('info', 'INFO');

export default { log, error, warn, debug, info };
