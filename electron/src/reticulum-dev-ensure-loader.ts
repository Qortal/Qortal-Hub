/**
 * Dev-only: first-run Reticulum (rns + lxmf) setup with a small loader window while
 * scripts/ensure-reticulum-for-dev.mjs runs (get-pip + pip install).
 */

import { spawn, spawnSync } from 'child_process';
import { app, BrowserWindow, dialog } from 'electron';
import electronIsDev from 'electron-is-dev';
import fs from 'fs';
import path from 'path';

const PROGRESS_PREFIX = '__RET_ENSURE__:';
const RETICULUM_REQUIRED_SOURCE = 'github.com/Philreact/Reticulum';

function resourcesDir(): string {
  return path.join(__dirname, '..', '..', 'resources');
}

function canImportModule(
  py: string,
  module: string,
  shell: boolean
): boolean {
  const r = spawnSync(py, ['-c', `import ${module}`], {
    encoding: 'utf8',
    windowsHide: true,
    shell,
  });
  return r.status === 0;
}

function canImportRequiredReticulum(py: string, shell: boolean): boolean {
  const code = `
import importlib.metadata as md
try:
    import RNS
    dist = md.distribution("rns")
    direct = dist.read_text("direct_url.json") or ""
    raise SystemExit(0 if "${RETICULUM_REQUIRED_SOURCE}" in direct else 1)
except Exception:
    raise SystemExit(1)
`;
  const r = spawnSync(py, ['-c', code], {
    encoding: 'utf8',
    windowsHide: true,
    shell,
  });
  return r.status === 0;
}

/** Same fast checks as ensure-reticulum-for-dev.mjs (keep in sync). */
export function needsDevReticulumEnsure(): boolean {
  if (!electronIsDev) return false;
  if (process.env.QORTAL_RETICULUM_SKIP_ENSURE === '1') return false;
  if (app.isPackaged) return false;

  const res = resourcesDir();
  const venvCandidates =
    process.platform === 'win32'
      ? [path.join(res, 'reticulum-runtime', 'venv', 'Scripts', 'python.exe')]
      : [
          path.join(res, 'reticulum-runtime', 'venv', 'bin', 'python3'),
          path.join(res, 'reticulum-runtime', 'venv', 'bin', 'python'),
        ];

  for (const py of venvCandidates) {
    if (!py || !fs.existsSync(py)) continue;
    if (!canImportRequiredReticulum(py, false)) return true;
    if (canImportModule(py, 'LXMF', false)) return false;
    return true;
  }

  const names =
    process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  const shell = process.platform === 'win32';
  for (const name of names) {
    if (!canImportRequiredReticulum(name, shell)) continue;
    if (canImportModule(name, 'LXMF', shell)) return false;
    return true;
  }

  return true;
}

function loaderHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, sans-serif;
    background: #0d1117; color: #e6edf3;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh; -webkit-app-region: drag; user-select: none;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 16px; letter-spacing: 0.02em; }
  .spinner {
    width: 40px; height: 40px; border: 3px solid #30363d; border-top-color: #09b6e8;
    border-radius: 50%; animation: spin 0.85s linear infinite; margin-bottom: 20px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #status { font-size: 13px; color: #8b949e; text-align: center; max-width: 360px; line-height: 1.45; }
</style></head>
<body>
  <div class="spinner"></div>
  <h1>Setting up networking</h1>
  <p id="status">Starting…</p>
</body></html>`;
}

const STATUS_MAP: Record<string, string> = {
  need_install:
    'Installing Reticulum dependencies. First run may take a minute — please wait.',
  get_pip_check: 'Checking Python environment…',
  get_pip_download: 'Downloading Python tooling…',
  get_pip_run: 'Installing pip…',
  pip_install_rns: 'Installing Qortal Reticulum runtime and LXMF…',
  done: 'Done.',
};

/**
 * @returns false if setup failed (app will exit after error dialog)
 */
export async function runDevReticulumEnsureIfNeeded(): Promise<boolean> {
  if (!needsDevReticulumEnsure()) return true;

  const win = new BrowserWindow({
    width: 440,
    height: 300,
    frame: false,
    show: false,
    resizable: false,
    center: true,
    title: 'Qortal Hub',
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  await win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(loaderHtml())
  );
  win.once('ready-to-show', () => {
    win.show();
  });

  const electronRoot = path.join(__dirname, '..', '..');
  const script = path.join(electronRoot, 'scripts', 'ensure-reticulum-for-dev.mjs');

  let stderrBuf = '';

  return await new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: electronRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        RETICULUM_ENSURE_QUIET: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const setStatus = (text: string) => {
      if (win.isDestroyed()) return;
      const escaped = JSON.stringify(text);
      win.webContents
        .executeJavaScript(
          `document.getElementById('status').textContent = ${escaped}`
        )
        .catch(() => {});
    };

    setStatus(STATUS_MAP.need_install ?? 'Please wait…');

    let outBuf = '';
    const onOut = (chunk: Buffer) => {
      outBuf += chunk.toString();
      const parts = outBuf.split('\n');
      outBuf = parts.pop() ?? '';
      for (const line of parts) {
        if (line.startsWith(PROGRESS_PREFIX)) {
          const key = line.slice(PROGRESS_PREFIX.length).trim();
          if (STATUS_MAP[key]) setStatus(STATUS_MAP[key]);
        }
      }
    };

    child.stdout?.on('data', onOut);
    child.stderr?.on('data', (c) => {
      stderrBuf += c.toString();
    });

    child.on('error', async (err) => {
      if (!win.isDestroyed()) win.close();
      await dialog.showMessageBox({
        type: 'error',
        title: 'Reticulum setup failed',
        message: 'Could not start the Reticulum setup process.',
        detail: String(err),
      });
      app.exit(1);
      resolve(false);
    });

    child.on('close', (code) => {
      const finishFail = async () => {
        if (!win.isDestroyed()) win.close();
        await dialog.showMessageBox({
          type: 'error',
          title: 'Reticulum setup failed',
          message: 'Could not install Reticulum (rns) and LXMF automatically.',
          detail: `${stderrBuf.trim().slice(-1800) || `Process exited with code ${code}.`}

You need Python 3.9+ on PATH and a working internet connection.

Release builds: ship resources/reticulum/rnsd (run npm run bundle:reticulum in CI) so users do not need Python.

Skip this step: QORTAL_RETICULUM_SKIP_ENSURE=1`,
        });
        app.exit(1);
        resolve(false);
      };

      if (code === 0) {
        setStatus(STATUS_MAP.done);
        setTimeout(() => {
          if (!win.isDestroyed()) win.close();
          resolve(true);
        }, 450);
      } else {
        void finishFail();
      }
    });
  });
}
