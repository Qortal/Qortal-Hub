#!/usr/bin/env node
/**
 * Invokes build-rnsd-frozen.py with a working Python (python3, python, or py -3 on Windows).
 * The Python builder emits both `rnsd` and `presence_bridge`.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const script = path.join(__dirname, 'build-rnsd-frozen.py');

if (!fs.existsSync(script)) {
  console.error('Missing', script);
  process.exit(1);
}

/** @type {readonly (readonly string[])[]} */
const attempts =
  process.platform === 'win32'
    ? [['py', '-3'], ['python3'], ['python']]
    : [['python3'], ['python']];

for (const argv of attempts) {
  const r = spawnSync(argv[0], [...argv.slice(1), script], {
    stdio: 'inherit',
    cwd: electronRoot,
    env: process.env,
    windowsHide: true,
  });
  if (r.status === 0) process.exit(0);
  if (r.error && r.error.code !== 'ENOENT') {
    console.error(r.error);
    process.exit(1);
  }
}

console.error(
  'bundle:reticulum failed. Need Python 3.9+ on PATH and internet access. The build script bootstraps pip if needed; on Windows use the Python installer or `py -3`.'
);
process.exit(1);
