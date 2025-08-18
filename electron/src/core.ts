import path from 'path';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import { spawn, exec, execFile } from 'child_process';
import readline from 'readline';

import {
  downloadPath,
  homePath,
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
  startWinCore,
  winexe,
  winjar,
  winurl,
  zipdir,
  zipfile,
  zipurl,
} from './core-constants';
import extract from 'extract-zip';
import { broadcastProgress } from './setup';
const isRunning = (query, cb) => {
  const platform = process.platform;
  let cmd = '';

  switch (platform) {
    case 'win32':
      cmd = `tasklist`;
      break;
    case 'darwin':
      cmd = `ps -ax | grep [q]ortal.jar`;
      break;
    case 'linux':
      cmd = `ps ax | grep [q]ortal.jar`;
      break;
    default:
      break;
  }

  exec(cmd, (err, stdout, stderr) => {
    cb(stdout.toLowerCase().indexOf(query.toLowerCase()) > -1);
  });
};

function watchForApiStart(
  logFilePath: string,
  startTimestamp: number,
  onDetected: () => void,
  onError: () => void
) {
  let stream: fs.ReadStream | null = null;
  let rl: readline.Interface | null = null;

  const checkLine = (line: string) => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/); // timestamp at start of line
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
    }
  };

  const cleanup = () => {
    if (rl) rl.close();
    if (stream) stream.close();
    fs.unwatchFile(logFilePath);
  };

  const watch = () => {
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

  if (fs.existsSync(logFilePath)) {
    watch();
  } else {
    const dir = path.dirname(logFilePath);
    const filename = path.basename(logFilePath);
    const watcher = fs.watch(dir, (eventType, createdFile) => {
      if (createdFile === filename && fs.existsSync(logFilePath)) {
        watcher.close();
        watch();
      }
    });
  }
}

async function startQortal() {
  const logPath = path.join(qortaldir, 'qortal.log');
  const startTimestamp = Date.now();
  broadcastProgress({
    step: 'coreRunning',
    status: 'active',
    progress: 10,
    message: 'Starting up the core... please wait.',
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
        message: 'Error: Unable to start repository',
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
                qortaljar,
                qortalsettings,
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
              message: err?.message
                ? `Error running Qortal Core: ${err?.message}`
                : 'Error running Qortal Core',
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
                qortaljar,
                qortalsettings,
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
              message: err?.message
                ? `Error running Qortal Core: ${err?.message}`
                : 'Error running Qortal Core',
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
                qortaljar,
                qortalsettings,
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
              message: err?.message
                ? `Error running Qortal Core: ${err?.message}`
                : 'Error running Qortal Core',
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
                qortaljar,
                qortalsettings,
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
              message: err?.message
                ? `Error running Qortal Core: ${err?.message}`
                : 'Error running Qortal Core',
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
                qortaljar,
                qortalsettings,
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
              message: err?.message
                ? `Error running Qortal Core: ${err?.message}`
                : 'Error running Qortal Core',
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
                qortaljar,
                qortalsettings,
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
              message: err?.message
                ? `Error running Qortal Core: ${err?.message}`
                : 'Error running Qortal Core',
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
              qortaljar,
              qortalsettings,
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
            message: err?.message
              ? `Error running Qortal Core: ${err?.message}`
              : 'Error running Qortal Core',
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
              qortaljar,
              qortalsettings,
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
            message: err?.message
              ? `Error running Qortal Core: ${err?.message}`
              : 'Error running Qortal Core',
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
              qortaljar,
              qortalsettings,
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
            message: err?.message
              ? `Error running Qortal Core: ${err?.message}`
              : 'Error running Qortal Core',
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
              qortaljar,
              qortalsettings,
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
            message: err?.message
              ? `Error running Qortal Core: ${err?.message}`
              : 'Error running Qortal Core',
          });
          console.error('Start qortal error', err);
        }
      }
    }
  }
}

async function startElectronWin() {
  if (fs.existsSync(winjar)) {
    isRunning('qortal.exe', (status) => {
      if (status == true) {
        console.log('Core is running, perfect !');
      } else {
        spawn(startWinCore, { detached: true });
      }
    });
  }
}

function startElectronUnix() {
  if (fs.existsSync(qortaljar)) {
    isRunning('qortal.jar', (status) => {
      if (status == true) {
        console.log('Core is running, perfect !');
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

export async function isCoreRunning() {
  return new Promise((res, rej) => {
    if (process.platform === 'win32') {
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

export async function isCoreInstalled() {
  return new Promise((res, rej) => {
    if (process.platform === 'win32') {
      if (fs.existsSync(winjar)) {
        res(true);
      } else res(false);
    } else if (process.platform === 'linux' || process.platform === 'darwin') {
      if (fs.existsSync(qortaljar)) {
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
    console.log('Unzip Qortal complete');
  } catch (err) {
    broadcastProgress({
      step: 'downloadedCore',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error unzipping Qortal Core: ${err?.message}`
        : 'Error unzipping Qortal Core',
    });
    console.log('Unzip Qortal error', err);
  }

  await chmodQortal();
}

async function chmodQortal() {
  try {
    await spawn('chmod', ['-R', '+x', qortaldir], {
      cwd: homePath,
      shell: true,
    });
  } catch (err) {
    console.log('chmod error', err);
  }

  await removeQortalZip();
}

async function removeQortalZip() {
  try {
    await spawn('rm', ['-rf', zipfile], { cwd: homePath, shell: true });
  } catch (err) {
    console.log('rm error', err);
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

async function downloadQortal() {
  try {
    console.log('Starting Download Qortal');
    broadcastProgress({
      step: 'downloadedCore',
      status: 'active',
      progress: 0,
      message: 'Downloading the Qortal Core... please wait.',
    });
    await fs.promises.mkdir(zipdir, { recursive: true });

    await downloadWithNode(zipurl, zipfile, ({ received, total, percent }) => {
      if (percent !== undefined) {
        broadcastProgress({
          step: 'downloadedCore',
          status: 'active',
          progress: percent,
          message: 'Downloading the Qortal Core... please wait.',
        });
      }
    });
  } catch (err) {
    broadcastProgress({
      step: 'downloadedCore',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error downloading Qortal Core: ${err?.message}`
        : 'Error downloading Qortal Core',
    });
    console.log('Download Qortal error', err);
    // (We’ll continue to unzip attempt, same as your original flow)
  }

  await unzipQortal();
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
  return path.join(homePath, base);
}

async function pickUrl(primary: string, backup: string): Promise<string> {
  // Keep your existing availability check logic
  const res = (await doesFileExist(primary)) === true ? primary : backup;
  return res;
}

async function downloadJavaArchive(url: string): Promise<string> {
  const dest = destPathForUrl(url);

  console.log('Starting Download JAVA');
  try {
    await downloadWithNode(url, dest, ({ percent }) => {
      if (percent !== undefined)
        broadcastProgress({
          step: 'hasJava',
          status: 'active',
          progress: percent,
          message: 'Setting up Java... please wait.',
        });
    });
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error downloading JAVA: ${err?.message}`
        : 'Error downloading JAVA archive',
    });
    console.error('Download JAVA error', err);
    // We still return dest so your unzip function can try (same behavior you had)
  }
  console.log('Saved Java archive to:', dest);

  return dest;
}

// ---------------------------------------------------------
// Refactored installJava using downloadWithNode

async function installJava() {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      const url = await pickUrl(linjavax64url, linjavax64urlbackup);
      const archivePath = await downloadJavaArchive(url);

      // If your unzip functions expect a known variable, set it here:
      // global.javaZipPath = archivePath;
      await unzipJavaX64Linux(); // or pass archivePath if your unzip accepts it
    } else if (process.arch === 'arm64') {
      const url = await pickUrl(linjavaarm64url, linjavaarm64urlbackup);
      const archivePath = await downloadJavaArchive(url);
      // global.javaZipPath = archivePath;
      await unzipJavaArm64Linux();
    } else if (process.arch === 'arm') {
      const url = await pickUrl(linjavaarmurl, linjavaarmurlbackup);
      const archivePath = await downloadJavaArchive(url);
      // global.javaZipPath = archivePath;
      await unzipJavaArmLinux();
    }
  } else if (process.platform === 'darwin') {
    if (process.arch === 'x64') {
      const url = await pickUrl(macjavax64url, macjavax64urlbackup);
      const archivePath = await downloadJavaArchive(url);
      // global.javaZipPath = archivePath;
      await unzipJavaX64Mac();
    } else {
      const url = await pickUrl(macjavaaarch64url, macjavaaarch64urlbackup);
      const archivePath = await downloadJavaArchive(url);
      // global.javaZipPath = archivePath;
      await unzipJavaAarch64Mac();
    }
  }
}
async function unzipJavaX64Linux() {
  try {
    await extract(linjavax64file, { dir: homePath });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
    console.log('Unzip Java complete');
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error unzipping Java: ${err?.message}`
        : 'Error unzipping Java',
    });
    console.error('Unzip Java error', err);
  }

  await chmodJava();
}

async function unzipJavaArm64Linux() {
  try {
    await extract(linjavaarm64file, { dir: homePath });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
    console.log('Unzip Java complete');
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error unzipping Java: ${err?.message}`
        : 'Error unzipping Java',
    });
    console.error('Unzip Java error', err);
  }

  await chmodJava();
}

async function unzipJavaArmLinux() {
  try {
    await extract(linjavaarmfile, { dir: homePath });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
    console.log('Unzip Java complete');
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error unzipping Java: ${err?.message}`
        : 'Error unzipping Java',
    });
    console.error('Unzip Java error', err);
  }

  await chmodJava();
}

async function unzipJavaX64Mac() {
  try {
    await extract(macjavax64file, { dir: homePath });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
    console.log('Unzip Java complete');
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error unzipping Java: ${err?.message}`
        : 'Error unzipping Java',
    });
    console.error('Unzip Java error', err);
  }

  await chmodJava();
}

async function unzipJavaAarch64Mac() {
  try {
    await extract(macjavaaarch64file, { dir: homePath });
    broadcastProgress({
      step: 'hasJava',
      status: 'done',
      progress: 100,
      message: '',
    });
    console.log('Unzip Java complete');
  } catch (err) {
    broadcastProgress({
      step: 'hasJava',
      status: 'error',
      progress: 0,
      message: err?.message
        ? `Error unzipping Java: ${err?.message}`
        : 'Error unzipping Java',
    });
    console.error('Unzip Java error', err);
  }

  await chmodJava();
}

async function chmodJava() {
  try {
    await spawn('chmod', ['-R', '+x', javadir], { cwd: homePath, shell: true });
  } catch (err) {
    console.error('chmod error', err);
  }

  await removeJavaZip();
}

function checkQortal() {
  if (fs.existsSync(qortaljar)) {
    isRunning('qortal.jar', (status) => {
      if (status == true) {
        console.log('Core is running, perfect !');
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
          cwd: homePath,
          shell: true,
        });
      } catch (err) {
        console.log('rm error', err);
      }

      checkQortal();
    } else if (process.arch === 'arm64') {
      try {
        await spawn('rm', ['-rf', linjavaarm64file], {
          cwd: homePath,
          shell: true,
        });
      } catch (err) {
        console.log('rm error', err);
      }

      checkQortal();
    } else if (process.arch === 'arm') {
      try {
        await spawn('rm', ['-rf', linjavaarmfile], {
          cwd: homePath,
          shell: true,
        });
      } catch (err) {
        console.log('rm error', err);
      }

      checkQortal();
    }
  } else if (process.platform === 'darwin') {
    if (process.arch === 'x64') {
      try {
        await spawn('rm', ['-rf', macjavax64file], {
          cwd: homePath,
          shell: true,
        });
      } catch (err) {
        console.log('rm error', err);
      }

      checkQortal();
    } else {
      try {
        await spawn('rm', ['-rf', macjavaaarch64file], {
          cwd: homePath,
          shell: true,
        });
      } catch (err) {
        console.log('rm error', err);
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
    console.log('remove error', err);
  }
  await startElectronWin();
}

// --- main flow (matches your old API shape) ---
export async function downloadCoreWindows() {
  console.log('Starting Download Qortal Core Installer');
  try {
    await fs.promises.mkdir(downloadPath, { recursive: true });

    await downloadWithNodeWindows(
      winurl,
      winexe,
      ({ percent, received, total }) => {
        if (percent !== undefined) {
          // console.log('percent', percent);
        } else console.log(`received ${received} / ${total || 0} bytes`);
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
      // Common EXE installer flags:
      // NSIS: /S, Inno Setup: /VERYSILENT /NORESTART (depends on your installer)
      // If you don't want silent install, keep args = []
      // args = ['/S'];
      const { stdout, stderr } = await execFileAsync(winexe, args);
      console.log('Qortal Core Installation Done', stdout, stderr);
    }
  } catch (e) {
    console.log('Download/Install error', e);
  }

  await removeQortalExe();
}

export async function installCore(installCore) {
  installCore();
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
