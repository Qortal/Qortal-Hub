#!/usr/bin/env node
/**
 * Before `electron:start`: make Reticulum (rns) available without apt-installing pip/venv.
 *
 * 1. Frozen `resources/reticulum/rnsd` — no Python (use `npm run bundle:reticulum` in CI).
 * 2. Existing dev venv or system Python with RNS.
 * 3. Otherwise: download PyPA `get-pip.py`, bootstrap pip into user site, `pip install --user rns`.
 *
 * Requires: Python **3.9+** on PATH (standard on Ubuntu desktop) and network once for get-pip + PyPI.
 * Skip: QORTAL_RETICULUM_SKIP_ENSURE=1
 *
 * Progress lines for UI: __RET_ENSURE__:<key> on stdout.
 * Quiet pip output when: RETICULUM_ENSURE_QUIET=1 (Electron loader).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const resources = path.join(electronRoot, 'resources');

const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const quiet = process.env.RETICULUM_ENSURE_QUIET === '1';

const systemNames =
  process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];

function progress(step) {
  console.log(`__RET_ENSURE__:${step}`);
}

function spawnPy(name, args, opts = {}) {
  const { stdio: stdioOpt, env: envExtra, ...rest } = opts;
  return spawnSync(name, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    ...rest,
    env: envExtra ? { ...process.env, ...envExtra } : { ...process.env },
    stdio: stdioOpt ?? (quiet ? 'ignore' : 'inherit'),
  });
}

const pipEnv = {
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  PIP_BREAK_SYSTEM_PACKAGES: '1',
};

function canImportRNS(pythonPath) {
  if (!pythonPath || !fs.existsSync(pythonPath)) return false;
  return spawnPy(pythonPath, ['-c', 'import RNS']).status === 0;
}

function isPython39Plus(name) {
  const r = spawnPy(name, [
    '-c',
    'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)',
  ]);
  return r.status === 0;
}

function hasPipModule(name) {
  return spawnPy(name, ['-m', 'pip', '--version']).status === 0;
}

async function downloadGetPip(destPath) {
  const res = await fetch(GET_PIP_URL, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`GET ${GET_PIP_URL} failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(destPath, buf);
}

/** Bootstrap pip with official get-pip.py (no OS python3-pip package required). */
async function ensureUserPip(name) {
  if (hasPipModule(name)) return true;

  if (!isPython39Plus(name)) return false;

  console.log(`[ensure-reticulum] No pip for ${name}; bootstrapping with get-pip.py (PyPA)…`);
  progress('get_pip_download');

  const tmp = path.join(
    os.tmpdir(),
    `qortal-get-pip-${Date.now()}.py`
  );
  try {
    await downloadGetPip(tmp);
  } catch (e) {
    console.error('[ensure-reticulum] Could not download get-pip.py:', e.message);
    return false;
  }

  progress('get_pip_run');
  const stdioOpt = quiet ? 'ignore' : 'inherit';
  // Debian/Ubuntu PEP 668 blocks get-pip.py --user unless --break-system-packages is passed.
  let boot;
  if (process.platform === 'win32') {
    boot = spawnPy(name, [tmp, '--user'], { stdio: stdioOpt, env: pipEnv });
  } else {
    boot = spawnPy(name, [tmp, '--user', '--break-system-packages'], {
      stdio: stdioOpt,
      env: pipEnv,
    });
    if (boot.status !== 0) {
      boot = spawnPy(name, [tmp, '--user'], { stdio: stdioOpt, env: pipEnv });
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    // ignore
  }

  if (boot.status !== 0) {
    console.error(`[ensure-reticulum] get-pip.py failed for ${name} (exit ${boot.status}).`);
    return false;
  }

  return hasPipModule(name);
}

function tryPipUserInstallRns() {
  const attempts =
    process.platform === 'win32'
      ? [
          ['-m', 'pip', 'install', '--user', 'rns'],
          ['-m', 'pip', 'install', '--user', '--break-system-packages', 'rns'],
        ]
      : [
          ['-m', 'pip', 'install', '--user', '--break-system-packages', 'rns'],
          ['-m', 'pip', 'install', '--user', 'rns'],
        ];
  for (const name of systemNames) {
    if (!isPython39Plus(name)) continue;
    for (const args of attempts) {
      const pip = spawnPy(name, args, {
        env: pipEnv,
      });
      if (pip.status !== 0) continue;
      if (spawnPy(name, ['-c', 'import RNS']).status === 0) return true;
    }
  }
  return false;
}

async function main() {
  if (process.env.QORTAL_RETICULUM_SKIP_ENSURE === '1') {
    return;
  }

  const frozen =
    process.platform === 'win32'
      ? path.join(resources, 'reticulum', 'rnsd.exe')
      : path.join(resources, 'reticulum', 'rnsd');
  if (fs.existsSync(frozen)) {
    return;
  }

  const venvPythonCandidates =
    process.platform === 'win32'
      ? [path.join(resources, 'reticulum-runtime', 'venv', 'Scripts', 'python.exe')]
      : [
          path.join(resources, 'reticulum-runtime', 'venv', 'bin', 'python3'),
          path.join(resources, 'reticulum-runtime', 'venv', 'bin', 'python'),
        ];

  for (const p of venvPythonCandidates) {
    if (canImportRNS(p)) return;
  }

  for (const name of systemNames) {
    if (spawnPy(name, ['-c', 'import RNS']).status === 0) return;
  }

  progress('need_install');
  progress('get_pip_check');
  console.log('[ensure-reticulum] Ensuring pip + rns (user install, no sudo)…');

  for (const name of systemNames) {
    if (!isPython39Plus(name)) continue;
    await ensureUserPip(name);
  }

  progress('pip_install_rns');
  if (tryPipUserInstallRns()) {
    console.log('[ensure-reticulum] rns is ready (user site-packages).');
    progress('done');
    return;
  }

  console.error(`
[ensure-reticulum] Could not install rns automatically.

  • Need Python 3.9+ on PATH and internet (downloads get-pip.py + PyPI once).

  • Release builds: run on CI/macOS/Windows/Linux per arch:
      npm run bundle:reticulum
    and commit or ship the frozen binary under resources/reticulum/
    so end users need no Python at all.

  • Skip this step when developing: QORTAL_RETICULUM_SKIP_ENSURE=1
`);
  process.exit(1);
}

main().catch((e) => {
  console.error('[ensure-reticulum]', e);
  process.exit(1);
});
