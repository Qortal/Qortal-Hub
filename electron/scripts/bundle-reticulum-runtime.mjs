#!/usr/bin/env node
/**
 * Creates electron/resources/reticulum-runtime/venv and pip-installs rns + lxmf.
 * Run on the target OS before packaging (venv is not portable across OSes).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(__dirname, '..', 'resources', 'reticulum-runtime');
const venvDir = path.join(runtimeDir, 'venv');

const py =
  process.env.PYTHON ??
  (process.platform === 'win32' ? 'python' : 'python3');

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

const venvCfg = path.join(venvDir, 'pyvenv.cfg');
const venvLooksUsable =
  fs.existsSync(venvCfg) && fs.existsSync(venvPip);

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

console.log('Installing / upgrading rns + lxmf…');
run(venvPip, ['install', '--upgrade', 'pip']);
run(venvPip, ['install', 'rns', 'lxmf']);

const marker = path.join(runtimeDir, 'BUNDLE_READY');
fs.writeFileSync(
  marker,
  `bundled_at=${new Date().toISOString()}\npython=${py}\n`,
  'utf8'
);
console.log(`Done. Wrote ${marker}`);
