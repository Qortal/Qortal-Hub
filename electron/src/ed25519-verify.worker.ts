/**
 * Worker thread: unified Ed25519 verification (group-call, chat, presence, call).
 */

import { parentPort } from 'worker_threads';
import { runEd25519VerifySync, type Ed25519VerifyPayload } from './ed25519-verify-common';

parentPort?.on(
  'message',
  (msg: { id: number; payload: Ed25519VerifyPayload }) => {
    const ok = runEd25519VerifySync(msg.payload);
    parentPort?.postMessage({ id: msg.id, ok });
  }
);
