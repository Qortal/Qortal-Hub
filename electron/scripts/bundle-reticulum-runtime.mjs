#!/usr/bin/env node
/**
 * Creates electron/resources/reticulum-runtime/venv and installs the
 * Reticulum runtime dependencies used by chat and Qortal Land transport.
 * Run on the target OS before packaging (venv is not portable across OSes).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(
  __dirname,
  '..',
  'resources',
  'reticulum-runtime'
);
const venvDir = path.join(runtimeDir, 'venv');
const RETICULUM_PIP_PACKAGE =
  process.env.QORTAL_RETICULUM_PIP_PACKAGE ??
  'git+https://github.com/Philreact/Reticulum.git@master';
const WEBSOCKETS_PIP_PACKAGE = 'websockets==14.2';

const py =
  process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

fs.mkdirSync(runtimeDir, { recursive: true });

const venvPip =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');
const venvPython =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

const venvCfg = path.join(venvDir, 'pyvenv.cfg');
const venvLooksUsable = fs.existsSync(venvCfg) && fs.existsSync(venvPip);

if (venvLooksUsable) {
  console.log(`Reusing existing venv: ${venvDir}`);
} else {
  if (fs.existsSync(venvDir)) {
    console.log(`Removing incomplete or broken venv: ${venvDir}`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }
  console.log(`Creating venv with ${py} at ${venvDir}`);
  run(py, ['-m', 'venv', venvDir]);
}

if (!fs.existsSync(venvPip)) {
  console.error('pip not found in venv:', venvPip);
  process.exit(1);
}

console.log(
  `Installing / upgrading Reticulum from ${RETICULUM_PIP_PACKAGE} + lxmf…`
);
run(venvPip, ['install', '--upgrade', 'pip']);
run(venvPip, [
  'install',
  '--upgrade',
  RETICULUM_PIP_PACKAGE,
  'lxmf',
  WEBSOCKETS_PIP_PACKAGE,
]);
run(venvPython, [
  '-c',
  'import RNS, LXMF, websockets; raise SystemExit(0 if websockets.__version__ == "14.2" else 1)',
]);

const marker = path.join(runtimeDir, 'BUNDLE_READY');
fs.writeFileSync(
  marker,
  `bundled_at=${new Date().toISOString()}\npython=${py}\nreticulum=${RETICULUM_PIP_PACKAGE}\nwebsockets=${WEBSOCKETS_PIP_PACKAGE}\n`,
  'utf8'
);
console.log(`Done. Wrote ${marker}`);
