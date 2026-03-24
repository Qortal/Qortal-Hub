/**
 * Pool of Node worker_threads running ed25519-verify.worker.js.
 * Each subsystem (group-call, chat, presence, call) uses its own pool for isolation.
 */

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { log as loggerLog, error as loggerError } from './logger';
import {
  runEd25519VerifySync,
  type Ed25519VerifyPayload,
} from './ed25519-verify-common';

const WORKER_FILENAME = 'ed25519-verify.worker.js';

export function resolveEd25519WorkerPath(): string {
  const inAsar = __dirname.includes('app.asar');
  if (inAsar) {
    const unpackedDir = __dirname.replace(/app\.asar(\/|\\)/, 'app.asar.unpacked$1');
    const unpackedPath = path.join(unpackedDir, WORKER_FILENAME);
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  return path.join(__dirname, WORKER_FILENAME);
}

type PendingEntry = {
  resolve: (ok: boolean) => void;
  payload: Ed25519VerifyPayload;
};

export class VerifyWorkerPool {
  private workers: Worker[] = [];
  private roundRobin = 0;
  private jobId = 0;
  private pending = new Map<number, PendingEntry>();
  private stopping = false;
  private started = false;

  constructor(
    private readonly label: string,
    private readonly workerCount: number,
    private readonly maxPending: number
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const workerPath = resolveEd25519WorkerPath();
    for (let i = 0; i < this.workerCount; i++) {
      try {
        const w = new Worker(workerPath);
        w.on('message', (m: { id: number; ok: boolean }) => {
          this.onWorkerMessage(m);
        });
        w.on('error', (err) => {
          loggerError(`[VerifyPool:${this.label}] Worker error:`, err);
        });
        w.on('exit', (code) => {
          this.onWorkerExit(w, code);
        });
        this.workers.push(w);
      } catch (err) {
        loggerError(
          `[VerifyPool:${this.label}] Failed to spawn worker (will use main thread):`,
          err
        );
      }
    }
    if (this.workers.length > 0) {
      loggerLog(
        `[VerifyPool:${this.label}] Started ${this.workers.length} worker(s).`
      );
    } else {
      loggerLog(
        `[VerifyPool:${this.label}] No workers — verification runs on main thread.`
      );
    }
  }

  stop(): void {
    if (!this.started) return;
    this.stopping = true;
    for (const [, entry] of this.pending) {
      entry.resolve(false);
    }
    this.pending.clear();
    for (const w of this.workers) {
      try {
        w.removeAllListeners();
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    this.workers = [];
    this.roundRobin = 0;
    this.stopping = false;
    this.started = false;
  }

  /**
   * Returns true if signature verifies. Uses worker pool when available;
   * falls back to synchronous main-thread verify when saturated or on post failure.
   */
  verify(payload: Ed25519VerifyPayload): Promise<boolean> {
    if (this.stopping || !this.started) {
      return Promise.resolve(runEd25519VerifySync(payload));
    }

    if (this.workers.length === 0) {
      return Promise.resolve(runEd25519VerifySync(payload));
    }

    if (this.pending.size >= this.maxPending) {
      loggerError(
        `[VerifyPool:${this.label}] Queue saturated (${this.maxPending}) — verifying on main thread`
      );
      return Promise.resolve(runEd25519VerifySync(payload));
    }

    return new Promise<boolean>((resolve) => {
      const id = ++this.jobId;
      this.pending.set(id, { resolve, payload });
      try {
        this.pickWorker().postMessage({ id, payload });
      } catch (err) {
        this.pending.delete(id);
        loggerError(
          `[VerifyPool:${this.label}] postMessage failed — verifying on main thread:`,
          err
        );
        resolve(runEd25519VerifySync(payload));
      }
    });
  }

  private pickWorker(): Worker {
    return this.workers[this.roundRobin++ % this.workers.length];
  }

  private onWorkerMessage(m: { id: number; ok: boolean }): void {
    const entry = this.pending.get(m.id);
    if (!entry) return;
    this.pending.delete(m.id);
    entry.resolve(m.ok);
  }

  private onWorkerExit(w: Worker, code: number): void {
    if (this.stopping) return;
    const idx = this.workers.indexOf(w);
    if (idx >= 0) this.workers.splice(idx, 1);
    if (code !== 0) {
      loggerError(`[VerifyPool:${this.label}] Worker exited abnormally, code:`, code);
    }
    if (this.workers.length === 0 && this.pending.size > 0) {
      loggerLog(
        `[VerifyPool:${this.label}] All workers gone — draining ${this.pending.size} job(s) on main thread`
      );
      this.drainPendingOnMainThread();
    }
  }

  private drainPendingOnMainThread(): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, entry] of entries) {
      entry.resolve(runEd25519VerifySync(entry.payload));
    }
  }
}
