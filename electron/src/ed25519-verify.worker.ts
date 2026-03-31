/**
 * Worker thread: unified Ed25519 verification (group-call, chat, presence, call).
 */

import { parentPort } from 'worker_threads';
import type { Ed25519VerifyPayload } from './ed25519-verify-common';

const path = require('path') as typeof import('path');

function loadVerifier(): typeof import('./ed25519-verify-common') {
  // In packaged builds the worker file is unpacked, but its shared helpers stay
  // inside app.asar. Load the packed helper module explicitly in that case.
  if (__dirname.includes('app.asar.unpacked')) {
    const packedDir = __dirname.replace('app.asar.unpacked', 'app.asar');
    return require(path.join(packedDir, 'ed25519-verify-common.js')) as typeof import('./ed25519-verify-common');
  }
  return require('./ed25519-verify-common') as typeof import('./ed25519-verify-common');
}

const { runEd25519VerifySync } = loadVerifier();

parentPort?.on(
  'message',
  (msg: { id: number; payload: Ed25519VerifyPayload }) => {
    const ok = runEd25519VerifySync(msg.payload);
    parentPort?.postMessage({ id: msg.id, ok });
  }
);
