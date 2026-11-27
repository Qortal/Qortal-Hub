import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import {
  error as loggerError,
  log as loggerLog,
  warn as loggerWarn,
} from './logger';
import type {
  ReticulumChatWorkerResult,
  ReticulumChatWorkerTask,
  ReticulumChatWorkerTaskInput,
} from './reticulum-chat.worker';

const WORKER_FILENAME = 'reticulum-chat.worker.js';
const DEFAULT_WORKER_COUNT = 1;
const DEFAULT_MAX_PENDING = 128;
const SLOW_TASK_MS = 50;
const MAX_RESTART_ATTEMPTS = 3;

export function resolveReticulumChatWorkerPath(): string {
  const inAsar = __dirname.includes('app.asar');
  if (inAsar) {
    const unpackedDir = __dirname.replace(
      /app\.asar(\/|\\)/,
      'app.asar.unpacked$1'
    );
    const unpackedPath = path.join(unpackedDir, WORKER_FILENAME);
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  const adjacentPath = path.join(__dirname, WORKER_FILENAME);
  if (fs.existsSync(adjacentPath)) return adjacentPath;
  const developmentBuildPath = path.join(
    __dirname,
    '..',
    'build',
    'src',
    WORKER_FILENAME
  );
  if (fs.existsSync(developmentBuildPath)) return developmentBuildPath;
  return adjacentPath;
}

type PendingEntry = {
  task: ReticulumChatWorkerTask;
  worker: Worker;
  resolve: (result: ReticulumChatWorkerResult | null) => void;
};

export class ReticulumChatWorkerPool {
  private workers: Worker[] = [];
  private roundRobin = 0;
  private jobId = 0;
  private pending = new Map<number, PendingEntry>();
  private started = false;
  private stopping = false;
  private fallbackCount = 0;
  private crashCount = 0;
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly label = 'chat',
    private readonly workerCount = DEFAULT_WORKER_COUNT,
    private readonly maxPending = DEFAULT_MAX_PENDING,
    private readonly slowTaskMs = SLOW_TASK_MS
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.restartAttempts = 0;
    const workerPath = resolveReticulumChatWorkerPath();
    for (let i = 0; i < this.workerCount; i++) {
      this.spawnWorker(workerPath);
    }
    if (this.workers.length > 0) {
      loggerLog(
        `[ReticulumChatWorker:${this.label}] Started ${this.workers.length} worker(s).`
      );
    }
  }

  stop(): void {
    if (!this.started) return;
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    for (const [, entry] of this.pending) entry.resolve(null);
    this.pending.clear();
    for (const worker of this.workers) {
      try {
        worker.removeAllListeners();
        worker.terminate();
      } catch {
        /* ignore */
      }
    }
    this.workers = [];
    this.roundRobin = 0;
    this.stopping = false;
    this.started = false;
    this.restartAttempts = 0;
  }

  run(
    task: ReticulumChatWorkerTaskInput
  ): Promise<ReticulumChatWorkerResult | null> {
    if (!this.started) this.start();
    if (
      this.stopping ||
      this.workers.length === 0 ||
      this.pending.size >= this.maxPending
    ) {
      this.fallbackCount += 1;
      if (this.pending.size >= this.maxPending) {
        loggerWarn(
          `[ReticulumChatWorker:${this.label}] queue_saturated pending=${this.pending.size} max=${this.maxPending} fallback=${this.fallbackCount}`
        );
      }
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const id = ++this.jobId;
      const fullTask = { ...task, id } as unknown as ReticulumChatWorkerTask;
      const worker = this.pickWorker();
      this.pending.set(id, { task: fullTask, worker, resolve });
      try {
        worker.postMessage(fullTask);
      } catch (err) {
        this.pending.delete(id);
        this.fallbackCount += 1;
        loggerWarn(
          `[ReticulumChatWorker:${this.label}] post_failed kind=${fullTask.kind} fallback=${this.fallbackCount}:`,
          err
        );
        resolve(null);
      }
    });
  }

  stats(): {
    pending: number;
    workers: number;
    fallbackCount: number;
    crashCount: number;
  } {
    return {
      pending: this.pending.size,
      workers: this.workers.length,
      fallbackCount: this.fallbackCount,
      crashCount: this.crashCount,
    };
  }

  private pickWorker(): Worker {
    return this.workers[this.roundRobin++ % this.workers.length];
  }

  private spawnWorker(workerPath = resolveReticulumChatWorkerPath()): void {
    try {
      const worker = new Worker(workerPath);
      worker.on('message', (message: ReticulumChatWorkerResult) => {
        this.onWorkerMessage(message);
      });
      worker.on('error', (err) => {
        loggerError(`[ReticulumChatWorker:${this.label}] Worker error:`, err);
      });
      worker.on('exit', (code) => {
        this.onWorkerExit(worker, code);
      });
      this.workers.push(worker);
    } catch (err) {
      this.fallbackCount += 1;
      loggerError(
        `[ReticulumChatWorker:${this.label}] Failed to spawn worker; falling back to main path:`,
        err
      );
    }
  }

  private onWorkerMessage(message: ReticulumChatWorkerResult): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.restartAttempts = 0;
    this.pending.delete(message.id);
    if (message.prepMs >= this.slowTaskMs) {
      loggerWarn(
        `[ReticulumChatWorker:${this.label}] task_slow kind=${message.kind} prep_ms=${message.prepMs} pending=${this.pending.size}`
      );
    }
    entry.resolve(message);
  }

  private onWorkerExit(worker: Worker, code: number): void {
    if (this.stopping) return;
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    if (code !== 0) {
      this.crashCount += 1;
      loggerError(
        `[ReticulumChatWorker:${this.label}] Worker exited abnormally code=${code}`
      );
    }
    // Resolve only work assigned to the worker that exited. With a pool of
    // multiple workers, leaving those entries pending until every worker dies
    // would hang their callers indefinitely even though the rest of the pool
    // remains healthy.
    const abandoned = [...this.pending.entries()].filter(
      ([, entry]) => entry.worker === worker
    );
    this.fallbackCount += abandoned.length;
    for (const [id, entry] of abandoned) {
      this.pending.delete(id);
      entry.resolve(null);
    }
    if (
      !this.stopping &&
      this.workers.length < this.workerCount &&
      !this.restartTimer &&
      this.restartAttempts < MAX_RESTART_ATTEMPTS
    ) {
      this.restartAttempts += 1;
      const delayMs = this.restartAttempts * 1_000;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (
          this.stopping ||
          !this.started ||
          this.workers.length >= this.workerCount
        )
          return;
        this.spawnWorker();
        if (this.workers.length > 0) {
          loggerWarn(
            `[ReticulumChatWorker:${this.label}] Worker replaced after exit attempt=${this.restartAttempts}`
          );
        }
      }, delayMs);
    }
  }
}
