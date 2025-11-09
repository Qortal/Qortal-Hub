import path from 'path';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { spawn, exec, execFile } from 'child_process';
import readline from 'readline';
import { promises as fsPromise } from 'fs';
import os from 'os';

export const CORE_HTTP_LOCALHOST = 'http://127.0.0.1:12391';
export const CORE_LOCALHOST = '127.0.0.1';

import {
  DOWNLOAD_PATH,
  HOME_PATH,
  javadir,
  linjavaarm64bindir,
  linjavaarm64binfile,
  linjavaarm64file,
  linjavaarm64url,
  linjavaarm64urlbackup,
  linjavaarmbindir,
  linjavaarmbinfile,
  linjavaarmfile,
  linjavaarmurl,
  linjavaarmurlbackup,
  linjavax64bindir,
  linjavax64binfile,
  linjavax64file,
  linjavax64url,
  linjavax64urlbackup,
  macjavaaarch64bindir,
  macjavaaarch64binfile,
  macjavaaarch64file,
  macjavaaarch64url,
  macjavaaarch64urlbackup,
  macjavax64bindir,
  macjavax64binfile,
  macjavax64file,
  macjavax64url,
  macjavax64urlbackup,
  qortaldir,
  qortaljar,
  qortalsettings,
  qortalStopScriptLocation,
  qortalWindir,
  startWinCore,
  winexe,
  winjar,
  winurl,
  zipdir,
  zipfile,
  zipurl,
} from './core-constants';
import extract from 'extract-zip';
import net from 'net';

import { broadcastProgress, getSharedSettingsFilePath } from './setup';
import { promisify } from 'util';
const execAsync = promisify(exec);

function isPortOpen(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;

    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {}
      resolve(result);
    };

    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRunningByProcess(query: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const q = escapeForRegex(query);

    let cmd = '';
    if (platform === 'win32') {
      // Match full command line using PowerShell (no self-match issue)
      cmd =
        `powershell -NoProfile -Command ` +
        `"Get-CimInstance Win32_Process | ` +
        ` Where-Object { $_.CommandLine -match '${q}' } | ` +
        ` Select-Object -First 1 -ExpandProperty ProcessId"`;
    } else {
      // Prefer pgrep (fast, won’t match itself). If pgrep missing, fallback to ps+grep safely.
      // Try pgrep first:
      cmd =
        `command -v pgrep >/dev/null 2>&1 && pgrep -fa "${q}" || ` +
        `(ps -eo pid=,args= | grep -E "${q}" | grep -v -E "(grep|pgrep)")`;
    }

    exec(cmd, (err, stdout) => {
      // Any non-empty stdout means at least one PID matched
      resolve(!err && !!stdout && stdout.trim().length > 0);
    });
  });
}

export const isRunning = (query: string, cb: (running: boolean) => void) => {
  const HOST = '127.0.0.1';
  const PORT = 12391;
  const PORT_TIMEOUT_MS = 600;

  // 1) First check the real signal: is anything listening?
  isPortOpen(HOST, PORT, PORT_TIMEOUT_MS)
    .then((listening) => {
      if (listening) return cb(true);
      // 2) If not listening, double-check processes (avoids rare race conditions)
      return isRunningByProcess(query).then(cb);
    })
    .catch(() => cb(false));
};

export async function isCorePortRunning(): Promise<boolean> {
  const host = CORE_LOCALHOST;
  const port = 12391;
  const timeoutMs = 600;

  // 1) Fast path: check if API port is listening.

  const ok = await isPortOpen(host, port, timeoutMs);
  if (ok) return true;

  return false;
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

function watchForApiStart(
  logFilePath: string,
  startTimestamp: number,
  onDetected: () => void,
  onError: () => void
) {
  let stream: fs.ReadStream | null = null;
  let rl: readline.Interface | null = null;
  let fileCreationTimeout: NodeJS.Timeout | null = null;
  let lineDetectionTimeout: NodeJS.Timeout | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  let pollingStopped = false;

  const clearTimers = () => {
    if (fileCreationTimeout) clearTimeout(fileCreationTimeout);
    if (lineDetectionTimeout) clearTimeout(lineDetectionTimeout);
  };

  const cleanup = () => {
    clearTimers();
    pollingStopped = true;
    if (rl) rl.close();
    if (stream) stream.close();
    fs.unwatchFile(logFilePath);
    if (dirWatcher) dirWatcher.close();
  };

  const checkLine = (line: string) => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (!match) return;

    const logDate = new Date(match[1]);

    if (
      logDate.getTime() > startTimestamp &&
      line.includes('Starting API on port')
    ) {
      cleanup();
      onDetected();
    } else if (
      logDate.getTime() > startTimestamp &&
      line.includes('Unable to start repository')
    ) {
      cleanup();
      onError();
    } else if (
      logDate.getTime() > startTimestamp &&
      line.includes('Downloading full node bootstrap')
    ) {
      broadcastProgress({
        step: 'coreRunning',
        status: 'active',
        progress: 50,
        message: '001',
      });
    } else if (
      logDate.getTime() > startTimestamp &&
      line.includes('Extracting bootstrap')
    ) {
      broadcastProgress({
        step: 'coreRunning',
        status: 'active',
        progress: 75,
        message: '001',
      });
    }
  };

  const watch = () => {
    if (fileCreationTimeout) clearTimeout(fileCreationTimeout);

    lineDetectionTimeout = setTimeout(
      () => {
        cleanup();
        onError(); // no success/error line detected in time
      },
      20 * 60 * 1000
    ); // 20 mins

    stream = fs.createReadStream(logFilePath, {
      encoding: 'utf8',
      start: fs.statSync(logFilePath).size,
    });
    rl = readline.createInterface({ input: stream });
    rl.on('line', checkLine);

    fs.watchFile(logFilePath, { interval: 500 }, () => {
      if (!stream || !rl) return;
      const newStream = fs.createReadStream(logFilePath, {
        encoding: 'utf8',
        start: stream.bytesRead,
      });
      newStream.on('data', (chunk) => {
        chunk
          .toString()
          .split('\n')
          .forEach((line) => checkLine(line));
      });
    });
  };

  const pollApi = async (timeoutMs: number) => {
    const end = Date.now() + timeoutMs;

    while (!pollingStopped && Date.now() < end) {
      try {
        const running = await isCoreRunning();
        if (!running) {
          cleanup();
          onError();
          return;
        }
        const res = await fetch(`${CORE_HTTP_LOCALHOST}/admin/info`);
        if (res.ok) {
          cleanup();
          onDetected();
          return;
        }
      } catch (_) {
        // ignore, try again later
      }
      await delay(20_000); // wait 20 seconds
    }

    if (!pollingStopped) {
      cleanup();
      onError();
    }
  };

  if (fs.existsSync(logFilePath)) {
    watch();
  } else {
    const dir = path.dirname(logFilePath);
    const filename = path.basename(logFilePath);

    fileCreationTimeout = setTimeout(
      () => {
        if (dirWatcher) dirWatcher.close();
        // fallback: poll API for up to 6 minutes
        pollApi(20 * 60 * 1000).catch(() => {
          cleanup();
          onError();
        });
      },
      1 * 60 * 1000
    ); // wait 1 min for file creation

    dirWatcher = fs.watch(dir, (eventType, createdFile) => {
      if (createdFile === filename && fs.existsSync(logFilePath)) {
        if (dirWatcher) dirWatcher.close();
        watch();
      }
    });
  }
}

async function startQortal() {
  const running = await isCoreRunning();
  if (running) return;
  const isInstalled = await isCoreInstalled();
  if (!isInstalled) return;
  const startTimestamp = Date.now();
  const selectedCustomDir = await customQortalInstalledDir();

  const isWin = process.platform === 'win32';
  let qortalDirLocation = isWin ? qortalWindir : qortaldir;
  let qortalJarLocation = qortaljar;
  let qortalSettingsLocation = qortalsettings;

  if (selectedCustomDir) {
    qortalDirLocation = selectedCustomDir;
    qortalJarLocation = path.join(selectedCustomDir, 'qortal.jar');
    qortalSettingsLocation = path.join(selectedCustomDir, 'settings.json');
  }
  const logPath = path.join(qortalDirLocation, 'qortal.log');

  broadcastProgress({
    step: 'coreRunning',
    status: 'active',
    progress: 10,
    message: '001',
  });
  watchForApiStart(
    logPath,
    startTimestamp,
    () => {
      broadcastProgress({
        step: 'coreRunning',
        status: 'done',
        progress: 100,
        message: '',
      });
    },
    () => {
      broadcastProgress({
        step: 'coreRunning',
        status: 'error',
        progress: 0,
        message: '002',
      });
    }
  );
  if (process.platform === 'linux') {
    switch (process.arch) {
      case 'x64':
        if (fs.existsSync(linjavax64bindir)) {
          try {
            await spawn(
              'nohup',
              [
                'nice',
                '-n',
                '20',
                linjavax64binfile,
                '-Djava.net.preferIPv4Stack=false',
                '-Xss256m',
                '-XX:+UseSerialGC',
                '-jar',
                qortalJarLocation,
                qortalSettingsLocation,
                '1>run.log',
                '2>&1',
                '&',
              ],
              {
                cwd: qortalDirLocation,
                shell: true,
                detached: true,
              }
            );
          } catch (err) {
            broadcastProgress({
              step: 'coreRunning',
              status: 'error',
              progress: 0,
              message: '003',
            });
            console.error('Start qortal error', err);
          }
        } else {
          try {
            await spawn(
              'nohup',
              [
                'nice',
                '-n',
                '20',
                'java',
                '-Djava.net.preferIPv4Stack=false',
                '-Xss256m',
                '-XX:+UseSerialGC',
                '-jar',
                qortalJarLocation,
                qortalSettingsLocation,
                '1>run.log',
                '2>&1',
                '&',
              ],
              {
                cwd: qortalDirLocation,
                shell: true,
                detached: true,
              }
            );
          } catch (err) {
            broadcastProgress({
              step: 'coreRunning',
              status: 'error',
              progress: 0,
              message: '003',
            });
            console.error('Start qortal error', err);
          }
        }
        break;
      case 'arm64':
        if (fs.existsSync(linjavaarm64bindir)) {
          try {
            await spawn(
              'nohup',
              [
                'nice',
                '-n',
                '20',
                linjavaarm64binfile,
                '-Djava.net.preferIPv4Stack=false',
                '-Xss256m',
                '-XX:+UseSerialGC',
                '-jar',
                qortalJarLocation,
                qortalSettingsLocation,
                '1>run.log',
                '2>&1',
                '&',
              ],
              {
                cwd: qortalDirLocation,
                shell: true,
                detached: true,
              }
            );
          } catch (err) {
            broadcastProgress({
              step: 'coreRunning',
              status: 'error',
              progress: 0,
              message: '003',
            });
            console.error('Start qortal error', err);
          }
        } else {
          try {
            await spawn(
              'nohup',
              [
                'nice',
                '-n',
                '20',
                'java',
                '-Djava.net.preferIPv4Stack=false',
                '-Xss256m',
                '-XX:+UseSerialGC',
                '-jar',
                qortalJarLocation,
                qortalSettingsLocation,
                '1>run.log',
                '2>&1',
                '&',
              ],
              {
                cwd: qortalDirLocation,
                shell: true,
                detached: true,
              }
            );
          } catch (err) {
            broadcastProgress({
              step: 'coreRunning',
              status: 'error',
              progress: 0,
              message: '003',
            });
            console.error('Start qortal error', err);
          }
        }
        break;
      case 'arm':
        if (fs.existsSync(linjavaarmbindir)) {
          try {
            await spawn(
              'nohup',
              [
                'nice',
                '-n',
                '20',
                linjavaarmbinfile,
                '-Djava.net.preferIPv4Stack=false',
                '-Xss256m',
                '-XX:+UseSerialGC',
                '-jar',
                qortalJarLocation,
                qortalSettingsLocation,
                '1>run.log',
                '2>&1',
                '&',
              ],
              {
                cwd: qortalDirLocation,
                shell: true,
                detached: true,
              }
            );
          } catch (err) {
            broadcastProgress({
              step: 'coreRunning',
              status: 'error',
              progress: 0,
              message: '003',
            });
            console.error('Start qortal error', err);
          }
        } else {
          try {
            await spawn(
              'nohup',
              [
                'nice',
                '-n',
                '20',
                'java',
                '-Djava.net.preferIPv4Stack=false',
                '-Xss256m',
                '-XX:+UseSerialGC',
                '-jar',
                qortalJarLocation,
                qortalSettingsLocation,
                '1>run.log',
                '2>&1',
                '&',
              ],
              {
                cwd: qortalDirLocation,
                shell: true,
                detached: true,
              }
            );
          } catch (err) {
            broadcastProgress({
              step: 'coreRunning',
              status: 'error',
              progress: 0,
              message: '003',
            });
            console.error('Start qortal error', err);
          }
        }
        break;
    }
  } else if (process.platform === 'darwin') {
    if (process.arch === 'x64') {
      if (fs.existsSync(macjavax64bindir)) {
        try {
          await spawn(
            'nohup',
            [
              'nice',
              '-n',
              '20',
              macjavax64binfile,
              '-Djava.net.preferIPv4Stack=false',
              '-Xss256m',
              '-XX:+UseSerialGC',
              '-jar',
              qortalJarLocation,
              qortalSettingsLocation,
              '1>run.log',
              '2>&1',
              '&',
            ],
            {
              cwd: qortaldir,
              shell: true,
              detached: true,
            }
          );
        } catch (err) {
          broadcastProgress({
            step: 'coreRunning',
            status: 'error',
            progress: 0,
            message: '003',
          });
          console.error('Start qortal error', err);
        }
      } else {
        try {
          await spawn(
            'nohup',
            [
              'nice',
              '-n',
              '20',
              'java',
              '-Djava.net.preferIPv4Stack=false',
              '-Xss256m',
              '-XX:+UseSerialGC',
              '-jar',
              qortalJarLocation,
              qortalSettingsLocation,
              '1>run.log',
              '2>&1',
              '&',
            ],
            {
              cwd: qortalDirLocation,
              shell: true,
              detached: true,
            }
          );
        } catch (err) {
          broadcastProgress({
            step: 'coreRunning',
            status: 'error',
            progress: 0,
            message: '003',
          });
          console.error('Start qortal error', err);
        }
      }
    } else {
      if (fs.existsSync(macjavaaarch64bindir)) {
        try {
          await spawn(
            'nohup',
            [
              'nice',
              '-n',
              '20',
              macjavaaarch64binfile,
              '-Djava.net.preferIPv4Stack=false',
              '-Xss256m',
              '-XX:+UseSerialGC',
              '-jar',
              qortalJarLocation,
              qortalSettingsLocation,
              '1>run.log',
              '2>&1',
              '&',
            ],
            {
              cwd: qortaldir,
              shell: true,
              detached: true,
            }
          );
        } catch (err) {
          broadcastProgress({
            step: 'coreRunning',
            status: 'error',
            progress: 0,
            message: '003',
          });
          console.error('Start qortal error', err);
        }
      } else {
        try {
          await spawn(
            'nohup',
            [
              'nice',
              '-n',
              '20',
              'java',
              '-Djava.net.preferIPv4Stack=false',
              '-Xss256m',
              '-XX:+UseSerialGC',
              '-jar',
              qortalJarLocation,
              qortalSettingsLocation,
              '1>run.log',
              '2>&1',
              '&',
            ],
            {
              cwd: qortalDirLocation,
              shell: true,
              detached: true,
            }
          );
        } catch (err) {
          broadcastProgress({
            step: 'coreRunning',
            status: 'error',
            progress: 0,
            message: '003',
          });
          console.error('Start qortal error', err);
        }
      }
    }
  } else if (process.platform === 'win32') {
    let winCore = startWinCore;
    if (selectedCustomDir) {
      winCore = path.join(selectedCustomDir, 'qortal.exe');
    }
    spawn(winCore, { detached: true });
  }
}

async function startElectronWin() {
  startCore();
}

async function startElectronUnix() {
  const selectedCustomDir = await customQortalInstalledDir();
  let qortalJarLocation = qortaljar;
  if (selectedCustomDir) {
    qortalJarLocation = path.join(selectedCustomDir, 'qortal.jar');
  }
  if (fs.existsSync(qortalJarLocation)) {
    isRunning('qortal.jar', (status) => {
      if (status == true) {
        // Core is running, perfect !
      } else {
        startQortal();
      }
    });
  }
}

export async function checkOsPlatform() {
  if (process.platform === 'win32') {
    await startElectronWin();
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    startElectronUnix();
  }
}

export async function isCoreRunning(onSystem = false) {
  return new Promise(async (res, rej) => {
    if (process.platform === 'win32') {
      if (!onSystem) {
        const isPortRunning = await isCorePortRunning();
        if (isPortRunning) {
          res(true);
          return;
        }
      }

      isRunning('qortal.exe', (status) => {
        if (status == true) {
          res(true);
        } else {
          res(false);
        }
      });
    } else if (process.platform === 'linux' || process.platform === 'darwin') {
      isRunning('qortal.jar', (status) => {
        if (status == true) {
          res(true);
        } else {
          res(false);
        }
      });
    } else {
      rej('Cannot determine OS');
    }
  });
}

export async function customQortalInstalledDir() {
  const filePath = await getSharedSettingsFilePath('wallet-storage.json');

  const stats = await fs.promises.stat(filePath).catch(() => null);
  if (!stats || !stats.isFile()) return null;

  const raw = await fs.promises.readFile(filePath, 'utf-8');

  const data = raw ? JSON.parse(raw) : {};
  return data['qortalDirectory'] || null;
}

export async function removeCustomQortalPath() {
  const filePath = await getSharedSettingsFilePath('wallet-storage.json');

  const stats = await fs.promises.stat(filePath).catch(() => null);
  if (!stats || !stats.isFile()) return null;

  const raw = await fs.promises.readFile(filePath, 'utf-8');

  const data = raw ? JSON.parse(raw) : {};
  data['qortalDirectory'] = null;
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function parseJarFromCmdline(cmdline: string | null | undefined) {
  if (!cmdline) return null;
  // Matches: -jar "/path with spaces/qortal.jar"  OR  -jar C:\path\qortal.jar  OR  -jar /path/qortal.jar
  const m = cmdline.match(/-jar\s+("([^"]+)"|(\S+))/i);
  const jarPath = m ? m[2] || m[3] : null;
  if (!jarPath) return null;
  const jarDir = path.dirname(jarPath);
  return { jarPath, jarDir };
}

async function findQortalJarWindows(): Promise<{
  pid: string;
  jarPath: string;
  jarDir: string;
} | null> {
  // Try PowerShell first (modern & reliable)
  try {
    const psCmd = [
      'powershell',
      '-NoProfile',
      '-Command',
      // Find the first Java process whose CommandLine contains qortal.jar; return PID and CommandLine
      "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'qortal\\.jar' } | Select-Object -First 1 ProcessId,CommandLine | ConvertTo-Json -Compress)",
    ].join(' ');

    const { stdout } = await execAsync(psCmd, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const obj = stdout ? JSON.parse(stdout) : null;
    const cmdline: string | undefined = obj?.CommandLine;
    const pid: number | undefined = obj?.ProcessId;
    const parsed = parseJarFromCmdline(cmdline);
    if (pid && parsed?.jarPath) {
      return {
        pid: String(pid),
        jarPath: parsed.jarPath,
        jarDir: parsed.jarDir,
      };
    }
  } catch {
    /* fall through to WMIC */
  }

  // Fallback to WMIC (deprecated but often present)
  try {
    const { stdout } = await execAsync(
      'wmic process where "CommandLine like \'%qortal.jar%\'" get ProcessId,CommandLine /VALUE',
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
    const block = stdout.trim();
    if (!block) return null;

    // Pick the first match block
    const cmdMatch = block.match(/CommandLine=(.+)/i);
    const pidMatch = block.match(/ProcessId=(\d+)/i);
    const cmdline = cmdMatch?.[1]?.trim();
    const pid = pidMatch?.[1];
    const parsed = parseJarFromCmdline(cmdline);
    if (pid && parsed?.jarPath) {
      return { pid, jarPath: parsed.jarPath, jarDir: parsed.jarDir };
    }
  } catch {
    /* ignore */
  }

  return null;
}

async function findQortalJarPosix(): Promise<{
  pid: string;
  jarPath: string;
  jarDir: string;
} | null> {
  // Works on Linux and macOS
  // -eo pid,command is portable enough; some macs prefer 'args' but 'command' usually works
  const { stdout } = await execAsync(
    'ps -eo pid,command | grep qortal.jar | grep -v grep',
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const line = stdout
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return null;

  // Example: "12345 java -jar /Users/me/qortal/qortal.jar ..."
  const pidMatch = line.match(/^(\d+)\s+/);
  const pid = pidMatch?.[1];
  const cmdline = line.replace(/^(\d+)\s+/, '');
  const parsed = parseJarFromCmdline(cmdline);
  if (pid && parsed?.jarPath) {
    return { pid, jarPath: parsed.jarPath, jarDir: parsed.jarDir };
  }
  return null;
}

export async function findQortalJar(): Promise<{
  pid: string;
  jarPath: string;
  jarDir: string;
} | null> {
  if (process.platform === 'win32') {
    return await findQortalJarWindows();
  }
  return await findQortalJarPosix();
}

/**
 * Calls the Admin API to stop the core, then polls every 10s for up to 2 minutes
 * to ensure it has fully stopped.
 */
async function stopViaAdminApi(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${CORE_HTTP_LOCALHOST}/admin/stop`, {
      method: 'GET',
      headers: {
        accept: 'text/plain',
        'X-API-KEY': apiKey,
      },
    });

    if (!res.ok) {
      console.warn(`Stop request failed (status ${res.status})`);
      return false;
    }

    // 🔁 Poll every 10s for up to 2 minutes
    const maxAttempts = 12;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await delay(10_000);
      const stillRunning = await isCoreRunning();
      if (!stillRunning) {
        return true;
      }
    }

    console.warn('⚠️ Timed out: Qortal Core did not stop after 2 minutes.');
    return false;
  } catch (err) {
    console.error('Failed to call /admin/stop:', err);
    return false;
  }
}

async function waitForStop(
  maxMs = 120_000,
  intervalMs = 10_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const still = await isCoreRunning();
    if (!still) return true;
  }
  return false;
}

export async function stopCore() {
  const running = await isCoreRunning();
  if (!running) return true;

  // Windows: use Admin API (assumes stopViaAdminApi already does its own 2-min polling)
  if (process.platform === 'win32') {
    const apiKey = await getApiKey();
    if (!apiKey) return false;
    return await stopViaAdminApi(apiKey);
  }

  const settings = await getSettings();
  const apiKeyPath = (settings?.apiKeyPath ?? '').trim();

  const stopScriptName = 'stop.sh';

  // Prefer jarDir/stop.sh; else use your configured path (which may already be stop.sh); else selectedCustomDir
  const selectedCustomDir = await customQortalInstalledDir();
  const candidates: string[] = [
    ...(apiKeyPath ? [path.join(apiKeyPath, stopScriptName)] : []),
    qortalStopScriptLocation, // assume this may already be the absolute path to stop.sh
    ...(selectedCustomDir
      ? [path.join(selectedCustomDir, stopScriptName)]
      : []),
  ];
  const stopPath = candidates.find((p) => p && fs.existsSync(p));

  if (!stopPath) {
    console.error(
      'Stop script not found in expected locations. Falling back to Admin API if possible.'
    );
    const apiKey = await getApiKey();
    if (!apiKey) return false;
    return await stopViaAdminApi(apiKey); // this does the 2-min polling internally
  }

  try {
    const cwd = path.dirname(stopPath);
    // Ensure executable (no-op if already set)
    try {
      await execAsync(`chmod +x "${stopPath}"`);
    } catch {}

    await execFileAsync(stopPath, [], { cwd });

    // Poll every 10s for up to 2 minutes to confirm shutdown
    const stopped = await waitForStop(120_000, 10_000);
    if (stopped) {
      return true;
    }

    // As a last resort, try Admin API (maybe the script couldn’t reach the process)
    const apiKey = await getApiKey();
    if (!apiKey) return false;
    return await stopViaAdminApi(apiKey); // includes its own polling
  } catch (err) {
    console.error('Failed to execute stop.sh:', err);
    return false;
  }
}

export async function isCoreInstalled(customDir?: string) {
  const selectedCustomDir = await customQortalInstalledDir();

  return new Promise((res, rej) => {
    if (process.platform === 'win32') {
      const dir = customDir
        ? path.join(customDir, 'qortal.jar')
        : selectedCustomDir
          ? path.join(selectedCustomDir, 'qortal.jar')
          : winjar;
      const dirExe = customDir
        ? path.join(customDir, 'qortal.exe')
        : selectedCustomDir
          ? path.join(selectedCustomDir, 'qortal.exe')
          : winjar;
      if (fs.existsSync(dir) && fs.existsSync(dirExe)) {
        res(true);
      } else res(false);
    } else if (process.platform === 'linux' || process.platform === 'darwin') {
      const dir = customDir
        ? path.join(customDir, 'qortal.jar')
        : selectedCustomDir
          ? path.join(selectedCustomDir, 'qortal.jar')
          : qortaljar;
      if (fs.existsSync(dir)) {
        res(true);
      } else res(false);
    } else {
      rej('Cannot determine OS');
    }
  });
}

async function unzipQortal() {
  try {
    await extract(zipfile, { dir: zipdir });
    broadcastProgress({
      step: 'downloadedCore',
      status: 'done',
      progress: 100,
      message: '',
    });
  } catch (err) {
    broadcastProgress({
      step: 'downloadedCore',
      status: 'error',
      progress: 0,
      message: '004',
    });
  }

  await chmodQortal();
}

async function chmodQortal() {
  try {
    await spawn('chmod', ['-R', '+x', qortaldir], {
      cwd: HOME_PATH,
      shell: true,
    });
  } catch (err) {
    // ignore error
  }

  await removeQortalZip();
}

async function removeQortalZip() {
  try {
    await spawn('rm', ['-rf', zipfile], { cwd: HOME_PATH, shell: true });
  } catch (err) {
    //ignore error
  }

  await startCore();
}

type Progress = { received: number; total: number; percent?: number };

function downloadWithNode(
  urlStr: string,
  destPath: string,
  onProgress?: (p: Progress) => void,
  maxRedirects = 10
): Promise<string> {
  return new Promise((resolve, reject) => {
    const visited = new Set<string>();

    const go = (currentUrl: string, redirects = 0) => {
      if (redirects > maxRedirects) {
        return reject(new Error('Too many redirects'));
      }

      const u = new URL(currentUrl);
      const client = u.protocol === 'https:' ? https : http;

      const req = client.get(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: {
            // Some hosts throttle odd UAs; set something normal:
            'User-Agent': 'QortalDesktop/1.0 (+https://qortal.org)',
            Accept: 'application/octet-stream,*/*',
          },
          timeout: 30_000,
        },
        (res) => {
          // Handle redirects
          if (
            res.statusCode &&
            [301, 302, 303, 307, 308].includes(res.statusCode)
          ) {
            const loc = res.headers.location;
            res.resume(); // drain
            if (!loc)
              return reject(
                new Error(`Redirect ${res.statusCode} without Location`)
              );
            const next = new URL(loc, currentUrl).toString();
            if (visited.has(next))
              return reject(new Error('Redirect loop detected'));
            visited.add(next);
            return go(next, redirects + 1);
          }

          if (res.statusCode && res.statusCode >= 400) {
            return reject(
              new Error(`HTTP ${res.statusCode} ${res.statusMessage}`)
            );
          }

          // Ensure directory exists
          fs.mkdirSync(path.dirname(destPath), { recursive: true });

          const total = Number(res.headers['content-length'] || 0);
          let received = 0;

          const out = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) {
              const percent = total
                ? Math.floor((received * 100) / total)
                : undefined;
              onProgress({ received, total, percent });
            }
          });

          out.on('finish', () => resolve(destPath));
          out.on('error', reject);
          res.on('error', reject);

          res.pipe(out);
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Request timeout'));
      });
      req.on('error', reject);
    };

    go(urlStr);
  });
}

let isDownloadingQortal = false;

async function downloadQortal() {
  try {
    if (isDownloadingQortal) return;
    isDownloadingQortal = true;
    broadcastProgress({
      step: 'downloadedCore',
      status: 'active',
      progress: 0,
      message: '005',
    });
    await fs.promises.mkdir(zipdir, { recursive: true });

    await downloadWithNode(zipurl, zipfile, ({ received, total, percent }) => {
      if (percent !== undefined) {
        broadcastProgress({
          step: 'downloadedCore',
          status: 'active',
          progress: percent,
          message: '005',
        });
      }
    });

    await unzipQortal();
  } catch (err) {
    broadcastProgress({
      step: 'downloadedCore',
      status: 'error',
      progress: 0,
      message: '005',
    });
  } finally {
    isDownloadingQortal = false;
  }
}

export function doesFileExist(
  urlStr: string,
  timeoutMs = 10_000,
  maxRedirects = 5
): Promise<boolean> {
  return new Promise((resolve) => {
    const seen = new Set<string>();
    const go = (cur: string, redirects = 0) => {
      if (redirects > maxRedirects) return resolve(false);
      const u = new URL(cur);
      const client = u.protocol === 'https:' ? https : http;

      const req = client.request(
        {
          method: 'HEAD',
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: { 'User-Agent': `QortalDesktop/${process.versions.node}` },
          timeout: timeoutMs,
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
            const loc = res.headers.location;
            res.resume();
            if (!loc) return resolve(false);
            const next = new URL(loc, cur).toString();
            if (seen.has(next)) return resolve(false);
            seen.add(next);
            return go(next, redirects + 1);
          }
          if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400)
            return resolve(true);
          if (res.statusCode === 405 || res.statusCode === 501) {
            // Fallback: tiny GET (Range) to avoid downloading full file
            const getReq = client.request(
              {
                method: 'GET',
                protocol: u.protocol,
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + u.search,
                headers: { Range: 'bytes=0-0' },
                timeout: timeoutMs,
              },
              (getRes) => {
                resolve(
                  !!getRes &&
                    (getRes.statusCode === 200 || getRes.statusCode === 206)
                );
                getRes.resume();
              }
            );
            getReq.on('timeout', () => {
              getReq.destroy();
              resolve(false);
            });
            getReq.on('error', () => resolve(false));
            getReq.end();
            return;
          }
          resolve(false);
          res.resume();
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    };
    go(urlStr);
  });
}

function destPathForUrl(urlStr: string): string {
  // Save into homePath with the URL's basename (matches your previous behavior)
  const base = path.basename(new URL(urlStr).pathname) || 'java-archive';
  return path.join(HOME_PATH, base);
}

async function pickUrl(primary: string, backup: string): Promise<string> {
  // Keep your existing availability check logic
  const res = (await doesFileExist(primary)) === true ? primary : backup;
  return res;
}

let isDownloadingJava = false;

async function downloadJavaArchive(url: string): Promise<string> {
  const dest = destPathForUrl(url);

  try {
    if (isDownloadingJava) return null;
    isDownloadingJava = true;
    await downloadWithNode(url, dest, ({ percent }) => {
      if (percent !== undefined)
        broadcastProgress({
          step: 'hasJava',
          status: 'active',
          progress: percent,
          message: '006',
        });
    });
    isDownloadingJava = false;
  } catch (err) {
    isDownloadingJava = false;
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: '007',
    });
    console.error('Download JAVA error', err);
    return null;
    // We still return dest so your unzip function can try (same behavior you had)
  }

  return dest;
}

// ---------------------------------------------------------
// Refactored installJava using downloadWithNode

async function installJava() {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      const url = await pickUrl(linjavax64url, linjavax64urlbackup);
      const archivePath = await downloadJavaArchive(url);

      if (archivePath) {
        await unzipJavaX64Linux();
      }
    } else if (process.arch === 'arm64') {
      const url = await pickUrl(linjavaarm64url, linjavaarm64urlbackup);

      const archivePath = await downloadJavaArchive(url);
      if (archivePath) {
        await unzipJavaArm64Linux();
      }
    } else if (process.arch === 'arm') {
      const url = await pickUrl(linjavaarmurl, linjavaarmurlbackup);
      const archivePath = await downloadJavaArchive(url);
      if (archivePath) {
        await unzipJavaArmLinux();
      }
    }
  } else if (process.platform === 'darwin') {
    if (process.arch === 'x64') {
      const url = await pickUrl(macjavax64url, macjavax64urlbackup);
      const archivePath = await downloadJavaArchive(url);
      if (archivePath) {
        await unzipJavaX64Mac();
      }
    } else {
      const url = await pickUrl(macjavaaarch64url, macjavaaarch64urlbackup);
      const archivePath = await downloadJavaArchive(url);
      if (archivePath) {
        await unzipJavaAarch64Mac();
      }
    }
  }
}
async function unzipJavaX64Linux() {
  try {
    await extract(linjavax64file, { dir: HOME_PATH });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: '008',
    });
  }

  await chmodJava();
}

async function unzipJavaArm64Linux() {
  try {
    await extract(linjavaarm64file, { dir: HOME_PATH });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: '008',
    });
  }

  await chmodJava();
}

async function unzipJavaArmLinux() {
  try {
    await extract(linjavaarmfile, { dir: HOME_PATH });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: '008',
    });
  }

  await chmodJava();
}

async function unzipJavaX64Mac() {
  try {
    await extract(macjavax64file, { dir: HOME_PATH });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: '008',
    });
    console.error('Unzip Java error', err);
  }

  await chmodJava();
}

async function unzipJavaAarch64Mac() {
  try {
    await extract(macjavaaarch64file, { dir: HOME_PATH });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: '008',
    });
  }

  await chmodJava();
}

async function chmodJava() {
  try {
    await spawn('chmod', ['-R', '+x', javadir], {
      cwd: HOME_PATH,
      shell: true,
    });
  } catch (err) {
    console.error('chmod error', err);
  }

  await removeJavaZip();
}

async function checkQortal() {
  const selectedCustomDir = await customQortalInstalledDir();
  let qortalJarLocation = qortaljar;
  if (selectedCustomDir) {
    qortalJarLocation = path.join(selectedCustomDir, 'qortal.jar');
  }
  if (fs.existsSync(qortalJarLocation)) {
    isRunning('qortal.jar', (status) => {
      if (status == true) {
        // core running
      } else {
        startQortal();
      }
    });
  } else {
    downloadQortal();
  }
}
async function removeJavaZip() {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      try {
        await spawn('rm', ['-rf', linjavax64file], {
          cwd: HOME_PATH,
          shell: true,
        });
      } catch (err) {
        //ignore error
      }

      checkQortal();
    } else if (process.arch === 'arm64') {
      try {
        await spawn('rm', ['-rf', linjavaarm64file], {
          cwd: HOME_PATH,
          shell: true,
        });
      } catch (err) {
        //ignore error
      }

      checkQortal();
    } else if (process.arch === 'arm') {
      try {
        await spawn('rm', ['-rf', linjavaarmfile], {
          cwd: HOME_PATH,
          shell: true,
        });
      } catch (err) {
        //ignore error
      }

      checkQortal();
    }
  } else if (process.platform === 'darwin') {
    if (process.arch === 'x64') {
      try {
        await spawn('rm', ['-rf', macjavax64file], {
          cwd: HOME_PATH,
          shell: true,
        });
      } catch (err) {
        //ignore error
      }

      checkQortal();
    } else {
      try {
        await spawn('rm', ['-rf', macjavaaarch64file], {
          cwd: HOME_PATH,
          shell: true,
        });
      } catch (err) {
        //ignore error
      }

      checkQortal();
    }
  }
}

export async function determineJavaVersion(): Promise<string | false> {
  const spawnJava = (cmd: string) => {
    return new Promise<string | false>((resolve) => {
      const proc = spawn(cmd, ['-version'], { shell: true });
      const stderrChunks: Buffer[] = [];

      proc.stderr.on('data', (data) => {
        stderrChunks.push(data);
      });

      proc.stderr.on('end', () => {
        const output = Buffer.concat(stderrChunks).toString();
        const firstLine = output.split('\n')[0];
        const match = /(?:java|openjdk) version\s+"([^"]+)"/.exec(firstLine);
        resolve(match ? match[1] : false);
      });

      proc.on('error', () => resolve(false));
    });
  };

  // Check bundled Java paths first
  if (process.platform === 'linux') {
    if (process.arch === 'x64' && fs.existsSync(linjavax64binfile)) {
      return await spawnJava(linjavax64binfile);
    } else if (process.arch === 'arm64' && fs.existsSync(linjavaarm64binfile)) {
      return await spawnJava(linjavaarm64binfile);
    } else if (process.arch === 'arm' && fs.existsSync(linjavaarmbinfile)) {
      return await spawnJava(linjavaarmbinfile);
    }
  } else if (process.platform === 'darwin') {
    if (process.arch === 'x64' && fs.existsSync(macjavax64binfile)) {
      return await spawnJava(macjavax64binfile);
    } else if (fs.existsSync(macjavaaarch64binfile)) {
      return await spawnJava(macjavaaarch64binfile);
    }
  }

  // Fallback to system Java
  return await spawnJava('java');
}

async function javaversion() {
  const javaVersion = await determineJavaVersion();

  if (javaVersion != false) {
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
    downloadQortal();
  } else {
    broadcastProgress({
      step: 'hasJava',
      status: 'active',
      progress: 0,
      message: '',
    });
    installJava();
  }
}

function downloadWithNodeWindows(
  urlStr: string,
  destPath: string,
  onProgress?: (p: Progress) => void,
  maxRedirects = 10
): Promise<string> {
  return new Promise((resolve, reject) => {
    const visited = new Set<string>();

    const go = (currentUrl: string, redirects = 0) => {
      if (redirects > maxRedirects)
        return reject(new Error('Too many redirects'));
      const u = new URL(currentUrl);
      const client = u.protocol === 'https:' ? https : http;

      const req = client.get(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: {
            'User-Agent': 'QortalDesktop/1.0 (+https://qortal.org)',
            Accept: 'application/octet-stream,*/*',
          },
          timeout: 30_000, // inactivity timeout
        },
        (res) => {
          if (
            res.statusCode &&
            [301, 302, 303, 307, 308].includes(res.statusCode)
          ) {
            const loc = res.headers.location;
            res.resume();
            if (!loc)
              return reject(
                new Error(`Redirect ${res.statusCode} without Location`)
              );
            const next = new URL(loc, currentUrl).toString();
            if (visited.has(next)) return reject(new Error('Redirect loop'));
            visited.add(next);
            return go(next, redirects + 1);
          }

          if (res.statusCode && res.statusCode >= 400) {
            return reject(
              new Error(`HTTP ${res.statusCode} ${res.statusMessage}`)
            );
          }

          fs.mkdirSync(path.dirname(destPath), { recursive: true });

          const total = Number(res.headers['content-length'] || 0);
          let received = 0;

          const out = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            received += chunk.length;
            onProgress?.({
              received,
              total,
              percent: total ? Math.floor((received * 100) / total) : undefined,
            });
          });

          out.on('finish', () => resolve(destPath));
          out.on('error', reject);
          res.on('error', reject);

          res.pipe(out);
        }
      );

      req.on('timeout', () => req.destroy(new Error('Request timeout')));
      req.on('error', reject);
    };

    go(urlStr);
  });
}

// --- execFile as a promise ---
function execFileAsync(file: string, args: string[] = [], opts: any = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, ...opts },
      (e, stdout, stderr) => {
        if (e) return reject(Object.assign(e, { stdout, stderr }));
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      }
    );
  });
}

async function removeQortalExe() {
  try {
    await fs.promises.rm(winexe, { force: true });
  } catch (err) {
    // ignore error
  }

  await startElectronWin();
}

// --- main flow (matches your old API shape) ---
export async function downloadCoreWindows() {
  try {
    await fs.promises.mkdir(DOWNLOAD_PATH, { recursive: true });

    await downloadWithNodeWindows(
      winurl,
      winexe,
      ({ percent, received, total }) => {
        if (percent !== undefined) {
          broadcastProgress({
            step: 'downloadedCore',
            status: 'active',
            progress: percent,
            message: '009',
          });
        }
      }
    );

    // Pick flags if you want silent install (depends on installer tech)
    const lower = winexe.toLowerCase();
    let args: string[] = [];
    if (lower.endsWith('.msi')) {
      // For MSI, install via msiexec instead of executing the MSI directly:
      const msiexec = path.join(
        process.env['SystemRoot'] || 'C:\\Windows',
        'System32',
        'msiexec.exe'
      );
      args = ['/i', winexe, '/quiet', '/norestart'];
      await execFileAsync(msiexec, args);
    } else {
      broadcastProgress({
        step: 'downloadedCore',
        status: 'done',
        progress: 100,
        message: '',
      });
    }
  } catch (e) {
    broadcastProgress({
      step: 'downloadedCore',
      status: 'error',
      progress: 0,
      message: '010',
    });
  }

  await removeQortalExe();
}

export async function installCore(executeProgress) {
  executeProgress();
  return new Promise(async (res, rej) => {
    if (process.platform === 'win32') {
      await downloadCoreWindows();
    } else {
      await javaversion();
    }
  });
}

export async function startCore() {
  startQortal();
}

type SettingsResponse = {
  apiKeyPath?: string;
  // ...other settings fields you might have
};

async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${CORE_HTTP_LOCALHOST}/admin/settings`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `GET /admin/settings failed: ${res.status} ${res.statusText} ${text}`
    );
  }
  return res.json() as Promise<SettingsResponse>;
}

async function readApiKeyFile(filePath: string): Promise<string> {
  try {
    const contents = await fsPromise.readFile(filePath, 'utf8');
    return contents.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return ''; // file missing
    throw err;
  }
}

async function deleteIfExists(filePath: string): Promise<void> {
  try {
    await fsPromise.unlink(filePath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') throw err; // ignore "not found"
  }
}

async function generateApiKey(): Promise<string> {
  const res = await fetch(`${CORE_HTTP_LOCALHOST}/admin/apikey/generate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `POST /admin/apikey/generate failed: ${res.status} ${res.statusText} ${text}`
    );
  }
  const key = (await res.text()).trim();
  if (!key) throw new Error('Generated API key response was empty.');
  return key;
}

export async function getApiKey(): Promise<string> {
  const settings = await getSettings();
  const apiKeyPath = (settings?.apiKeyPath ?? '').trim();
  // If apiKeyPath is empty, default to current working directory (matches Qortal behavior)
  const dir = apiKeyPath;
  if (!dir) throw new Error('No apiKey path found');
  const filePath = path.join(dir, 'apikey.txt');

  const existing = await readApiKeyFile(filePath);

  if (existing) {
    return existing;
  }

  // Empty or missing: delete file if present, then generate
  await deleteIfExists(filePath);

  const newKey = await generateApiKey();

  return newKey;
}

export async function resetApikey(): Promise<boolean> {
  const settings = await getSettings();
  const apiKeyPath = (settings?.apiKeyPath ?? '').trim();
  // If apiKeyPath is empty, default to current working directory (matches Qortal behavior)
  const dir = apiKeyPath;
  if (!dir) throw new Error('No apiKey path found');
  const filePath = path.join(dir, 'apikey.txt');

  // Empty or missing: delete file if present, then generate
  await deleteIfExists(filePath);

  await generateApiKey();

  return true;
}
export async function watchForBootstrap(
  logFilePath: string,
  startTimestamp: number,
  {
    bootstrapStartTimeout = 60_000, // must see a "start" line within this window
    restartGraceMs = 120_000, // after "Restarting node", if no failure in this window -> success
  }: { bootstrapStartTimeout?: number; restartGraceMs?: number } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    let stream: fs.ReadStream | null = null;
    let rl: readline.Interface | null = null;
    let dirWatcher: fs.FSWatcher | null = null;

    let fileCreationTimeout: NodeJS.Timeout | null = null;
    let bootstrapStartTimer: NodeJS.Timeout | null = null;
    let restartGraceTimer: NodeJS.Timeout | null = null;

    let done = false;
    let seenBootstrapStart = false;

    // ✅ Track the absolute file offset we’ve read up to
    let readOffset = 0;

    const START_MARKERS = [
      'Bootstrapping node', // BootstrapNode: "... Bootstrapping node..."
      'Bootstrapping...', // ApplyBootstrap: "Bootstrapping..."
      'Applying bootstrap',
      'Downloading full node bootstrap',
      'Restarting node with:', // BootstrapNode/ApplyBootstrap
    ];
    const FAILURE_MARKERS = [
      'Failed to restart node',
      'Bootstrap failed',
      'Unable to start repository',
    ];
    const RESTART_MARKER = 'Restarting node';
    const API_START_MARKER = 'Starting API on port';

    const cleanup = (result?: boolean) => {
      if (done) return;
      done = true;

      if (fileCreationTimeout) clearTimeout(fileCreationTimeout);
      if (bootstrapStartTimer) clearTimeout(bootstrapStartTimer);
      if (restartGraceTimer) clearTimeout(restartGraceTimer);

      rl?.close();
      stream?.close();
      fs.unwatchFile(logFilePath);
      dirWatcher?.close();

      if (typeof result === 'boolean') resolve(result);
    };

    const checkLine = (line: string) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (!match) return;

      const logDate = new Date(match[1]);
      if (logDate.getTime() <= startTimestamp) return;

      // 1) require a bootstrap "start" line first
      if (!seenBootstrapStart) {
        for (const s of START_MARKERS) {
          if (line.includes(s)) {
            seenBootstrapStart = true;
            if (bootstrapStartTimer) clearTimeout(bootstrapStartTimer);
            break;
          }
        }
        if (!seenBootstrapStart) return;
      }

      // 2) fail fast on clear failures
      for (const f of FAILURE_MARKERS) {
        if (line.includes(f)) {
          cleanup(false);
          return;
        }
      }

      // 4) immediate success if API starts after bootstrap began
      if (line.includes(API_START_MARKER)) {
        cleanup(true);
        return;
      }

      // 5) "Restarting node" → arm grace; if no failure shows up in that time, succeed
      if (line.includes(RESTART_MARKER)) {
        if (restartGraceTimer) clearTimeout(restartGraceTimer);
        restartGraceTimer = setTimeout(() => {
          cleanup(true);
        }, restartGraceMs);
      }
    };

    // ---- Tail helpers (fixed offsets) ----

    const attachLineReader = (s: fs.ReadStream) => {
      rl = readline.createInterface({ input: s });
      rl.on('line', (raw) => {
        // readline strips \n; handle Windows \r\n safely
        const line = raw.replace(/\r$/, '');
        checkLine(line);
      });
    };

    const openFromOffset = (offset: number) => {
      stream = fs.createReadStream(logFilePath, {
        encoding: 'utf8',
        start: offset,
      });
      attachLineReader(stream);
    };

    const startWatchingFile = () => {
      // keep a simple file watcher to notice growth
      fs.watchFile(logFilePath, { interval: 500 }, (curr, prev) => {
        if (done) return;
        if (curr.size <= readOffset) return; // nothing new

        // Read only the new region [readOffset, curr.size)
        const newStream = fs.createReadStream(logFilePath, {
          encoding: 'utf8',
          start: readOffset,
          end: curr.size - 1,
        });

        let bytes = 0;
        let buffer = '';
        newStream.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          buffer += chunk;
          // manually split, like readline
          const parts = buffer.split(/\n/);
          buffer = parts.pop() || '';
          for (const part of parts) {
            checkLine(part.replace(/\r$/, ''));
          }
        });
        newStream.on('end', () => {
          readOffset += bytes; // ✅ advance absolute offset
          // flush last partial line if it actually ended with newline next time
        });
      });
    };

    const watch = () => {
      if (fileCreationTimeout) clearTimeout(fileCreationTimeout);

      // must see a start marker within bootstrapStartTimeout
      bootstrapStartTimer = setTimeout(() => {
        if (!seenBootstrapStart) cleanup(false);
      }, bootstrapStartTimeout);

      // initialize readOffset to EOF and tail from there
      const stat = fs.statSync(logFilePath);
      readOffset = stat.size;
      openFromOffset(readOffset);
      startWatchingFile();
    };

    if (fs.existsSync(logFilePath)) {
      watch();
    } else {
      const dir = path.dirname(logFilePath);
      const filename = path.basename(logFilePath);

      fileCreationTimeout = setTimeout(() => {
        dirWatcher?.close();
        // If the log never appears, we can’t prove anything → fail
        cleanup(false);
      }, 60_000);

      dirWatcher = fs.watch(dir, (eventType, createdFile) => {
        if (createdFile === filename && fs.existsSync(logFilePath)) {
          dirWatcher?.close();
          watch();
        }
      });
    }
  });
}

async function bootstrapViaAdminApi(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${CORE_HTTP_LOCALHOST}/admin/bootstrap`, {
      method: 'GET',
      headers: {
        accept: 'text/plain',
        'X-API-KEY': apiKey,
      },
    });

    if (!res.ok) {
      return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

export async function bootstrap(): Promise<boolean> {
  try {
    const isInstalled = await isCoreInstalled();

    if (!isInstalled) return false;
    const apiKey = await getApiKey();
    if (!apiKey) return false;
    const response = await bootstrapViaAdminApi(apiKey);
    if (!response) return false;
    const startTimestamp = Date.now();
    const selectedCustomDir = await customQortalInstalledDir();

    const isWin = process.platform === 'win32';
    let qortalDirLocation = isWin ? qortalWindir : qortaldir;

    if (selectedCustomDir) {
      qortalDirLocation = selectedCustomDir;
    }
    const logPath = path.join(qortalDirLocation, 'qortal.log');
    const success = await watchForBootstrap(logPath, startTimestamp);
    if (success) {
      broadcastProgress({
        step: 'coreRunning',
        status: 'active',
        progress: 10,
        message: '001',
      });
      watchForApiStart(
        logPath,
        startTimestamp,
        () => {
          broadcastProgress({
            step: 'coreRunning',
            status: 'done',
            progress: 100,
            message: '',
          });
        },
        () => {
          broadcastProgress({
            step: 'coreRunning',
            status: 'error',
            progress: 0,
            message: '002',
          });
        }
      );
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

const rmAsync = promisify(fs.rm ?? fs.rmdir); // Node 14+ supports fs.rm

async function readJsonIfExists<T = any>(file: string): Promise<T | null> {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = await fs.promises.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function deleteDB(): Promise<boolean> {
  try {
    const isInstalled = await isCoreInstalled();
    if (!isInstalled) return false;

    const selectedCustomDir = await customQortalInstalledDir();
    const isWin = process.platform === 'win32';
    let qortalDirLocation = isWin ? qortalWindir : qortaldir;

    if (isWin) {
      // Windows: get repositoryPath via Program Files + userPath + settings.json chain
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pfSettingsPath = path.join(programFiles, 'Qortal', 'settings.json');
      const pfSettings = await readJsonIfExists<{ userPath?: string }>(
        pfSettingsPath
      );
      const userPath = pfSettings?.userPath;

      let repositoryPath: string | undefined;
      if (userPath) {
        const userSettingsPath = path.join(userPath, 'settings.json');
        const userSettings = await readJsonIfExists<{
          repositoryPath?: string;
        }>(userSettingsPath);
        repositoryPath = userSettings?.repositoryPath;
      }

      const defaultRepo = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Qortal'
      );
      qortalDirLocation = repositoryPath || defaultRepo;

      qortalDirLocation = qortalDirLocation.replace(/[\\/]+db[\\/]?$/i, '');
    } else {
      // 🐧 macOS/Linux
      if (selectedCustomDir) {
        qortalDirLocation = selectedCustomDir;
      }

      // Check if qortalDirLocation has a settings.json with repositoryPath
      const settingsPath = path.join(qortalDirLocation, 'settings.json');
      const settings = await readJsonIfExists<{ repositoryPath?: string }>(
        settingsPath
      );
      if (settings?.repositoryPath) {
        qortalDirLocation = settings.repositoryPath;
      }
    }

    qortalDirLocation = qortalDirLocation.replace(/[\\/]+db[\\/]?$/i, '');

    const dbPath = path.join(qortalDirLocation, 'db');

    if (fs.existsSync(dbPath)) {
      const isRunning = await isCoreRunning();
      if (isRunning) {
        const isCoreStopped = await stopCore();
        if (!isCoreStopped) return false;
        broadcastProgress({
          step: 'coreRunning',
          status: 'off',
          progress: 0,
          message: '',
        });
      }

      await rmAsync(dbPath, { recursive: true, force: true });
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

export async function dbExists(): Promise<boolean> {
  try {
    const isInstalled = await isCoreInstalled();
    if (!isInstalled) return false;

    const selectedCustomDir = await customQortalInstalledDir();
    const isWin = process.platform === 'win32';
    let qortalDirLocation = isWin ? qortalWindir : qortaldir;

    if (isWin) {
      // Windows: get repositoryPath via Program Files + userPath + settings.json chain
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pfSettingsPath = path.join(programFiles, 'Qortal', 'settings.json');
      const pfSettings = await readJsonIfExists<{ userPath?: string }>(
        pfSettingsPath
      );
      const userPath = pfSettings?.userPath;

      let repositoryPath: string | undefined;
      if (userPath) {
        const userSettingsPath = path.join(userPath, 'settings.json');
        const userSettings = await readJsonIfExists<{
          repositoryPath?: string;
        }>(userSettingsPath);
        repositoryPath = userSettings?.repositoryPath;
      }

      const defaultRepo = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Qortal'
      );
      qortalDirLocation = repositoryPath || defaultRepo;

      qortalDirLocation = qortalDirLocation.replace(/[\\/]+db[\\/]?$/i, '');
    } else {
      // 🐧 macOS/Linux
      if (selectedCustomDir) {
        qortalDirLocation = selectedCustomDir;
      }

      // Check if qortalDirLocation has a settings.json with repositoryPath
      const settingsPath = path.join(qortalDirLocation, 'settings.json');
      const settings = await readJsonIfExists<{ repositoryPath?: string }>(
        settingsPath
      );
      if (settings?.repositoryPath) {
        qortalDirLocation = settings.repositoryPath;
      }
    }

    qortalDirLocation = qortalDirLocation.replace(/[\\/]+db[\\/]?$/i, '');

    const dbPath = path.join(qortalDirLocation, 'db');

    if (fs.existsSync(dbPath)) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to delete DB folder:', error);
    return false;
  }
}
