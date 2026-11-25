import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { error as loggerError, warn as loggerWarn } from './logger';
import type {
  ReticulumResourceWorkerResult,
  ReticulumResourceWorkerTask,
  ReticulumResourceWorkerTaskInput,
} from './reticulum-resource.worker';

const WORKER_FILENAME = 'reticulum-resource.worker.js';
const MAX_PENDING_TASKS = 256;
const MAX_WAITING_SUBMISSIONS = 256;
const QUEUE_PRESSURE_THRESHOLD = 192;
const SLOW_TASK_MS = 50;
const TASK_TIMEOUT_MS = 10 * 60_000;
const MAX_TASK_RETRIES = 1;
const WORKER_RESTART_DELAY_MS = 100;

type QueueEntry = {
  task: ReticulumResourceWorkerTask;
  priority: number;
  retries: number;
  resolve: (result: ReticulumResourceWorkerResult | null) => void;
};

function resolveWorkerPath(): string {
  if (__dirname.includes('app.asar')) {
    const unpacked = __dirname.replace(
      /app\.asar(\/|\\)/,
      'app.asar.unpacked$1'
    );
    const unpackedPath = path.join(unpacked, WORKER_FILENAME);
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  const adjacent = path.join(__dirname, WORKER_FILENAME);
  if (fs.existsSync(adjacent)) return adjacent;
  const development = path.join(
    __dirname,
    '..',
    'build',
    'src',
    WORKER_FILENAME
  );
  return fs.existsSync(development) ? development : adjacent;
}

export class ReticulumResourceWorkerPool {
  private worker: Worker | null = null;
  private queue: QueueEntry[] = [];
  private active: QueueEntry | null = null;
  private reservedQueueSlots = 0;
  private submissionWaiters: Array<(accepted: boolean) => void> = [];
  private activeTimeout: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;
  private stopping = false;
  private crashCount = 0;
  private fallbackCount = 0;
  private queuePressureLogged = false;

  async run(
    input: ReticulumResourceWorkerTaskInput,
    priority = 2
  ): Promise<ReticulumResourceWorkerResult | null> {
    const accepted = await this.reserveQueueSlot();
    if (!accepted) {
      this.fallbackCount += 1;
      return null;
    }
    this.reservedQueueSlots = Math.max(0, this.reservedQueueSlots - 1);
    if (this.stopping) {
      this.fallbackCount += 1;
      return null;
    }
    return new Promise((resolve) => {
      const task = {
        ...input,
        id: ++this.nextId,
      } as ReticulumResourceWorkerTask;
      this.enqueue({ task, priority, retries: 0, resolve });
      this.pump();
    });
  }

  stop(): void {
    this.stopping = true;
    this.active?.resolve(null);
    this.active = null;
    if (this.activeTimeout) clearTimeout(this.activeTimeout);
    this.activeTimeout = null;
    for (const entry of this.queue) entry.resolve(null);
    this.queue = [];
    for (const resolve of this.submissionWaiters) resolve(false);
    this.submissionWaiters = [];
    this.worker?.removeAllListeners();
    void this.worker?.terminate();
    this.worker = null;
  }

  stats(): {
    queued: number;
    waiting: number;
    active: number;
    crashCount: number;
    fallbackCount: number;
  } {
    return {
      queued: this.queue.length + this.reservedQueueSlots,
      waiting: this.submissionWaiters.length,
      active: this.active ? 1 : 0,
      crashCount: this.crashCount,
      fallbackCount: this.fallbackCount,
    };
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(resolveWorkerPath(), { execArgv: [] });
      worker.on('message', (result: ReticulumResourceWorkerResult) => {
        const entry = this.active;
        if (!entry || entry.task.id !== result.id) return;
        this.active = null;
        if (this.activeTimeout) clearTimeout(this.activeTimeout);
        this.activeTimeout = null;
        if (result.durationMs >= SLOW_TASK_MS) {
          loggerWarn(
            `[ReticulumResourceWorker] task_slow kind=${result.kind} duration_ms=${result.durationMs} queued=${this.queue.length}`
          );
        }
        entry.resolve(result);
        this.releaseQueueSlot();
        this.pump();
      });
      worker.on('error', (error) => {
        loggerError('[ReticulumResourceWorker] worker_error', error);
      });
      worker.on('exit', (code) => {
        if (this.worker === worker) this.worker = null;
        const entry = this.active;
        this.active = null;
        if (this.activeTimeout) clearTimeout(this.activeTimeout);
        this.activeTimeout = null;
        if (code !== 0) this.crashCount += 1;
        if (entry) {
          this.retryOrFail(entry, 'worker_exit');
        }
        if (!this.stopping) this.pump();
      });
      this.worker = worker;
      return worker;
    } catch (error) {
      loggerError('[ReticulumResourceWorker] worker_start_failed', error);
      return null;
    }
  }

  private pump(): void {
    if (this.stopping || this.active || this.queue.length === 0) return;
    const worker = this.ensureWorker();
    const entry = this.queue.shift();
    if (!entry) return;
    if (!worker) {
      this.retryOrFail(entry, 'worker_start');
      const retryTimer = setTimeout(() => this.pump(), WORKER_RESTART_DELAY_MS);
      retryTimer.unref?.();
      return;
    }
    this.active = entry;
    this.updateQueuePressureState();
    this.activeTimeout = setTimeout(() => {
      if (this.active !== entry) return;
      this.active = null;
      this.activeTimeout = null;
      this.crashCount += 1;
      loggerWarn(
        `[ReticulumResourceWorker] task_timeout kind=${entry.task.kind}`
      );
      const timedOutWorker = this.worker;
      timedOutWorker?.removeAllListeners();
      void timedOutWorker?.terminate();
      this.worker = null;
      this.retryOrFail(entry, 'task_timeout');
      this.pump();
    }, TASK_TIMEOUT_MS);
    this.activeTimeout.unref?.();
    try {
      worker.postMessage(entry.task);
    } catch (error) {
      this.active = null;
      if (this.activeTimeout) clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
      this.crashCount += 1;
      loggerWarn(
        `[ReticulumResourceWorker] post_failed kind=${entry.task.kind}`,
        error
      );
      const failedWorker = this.worker;
      failedWorker?.removeAllListeners();
      void failedWorker?.terminate();
      this.worker = null;
      this.retryOrFail(entry, 'post_failed');
      this.pump();
    }
  }

  private enqueue(entry: QueueEntry): void {
    let low = 0;
    let high = this.queue.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = this.queue[middle];
      if (
        candidate.priority < entry.priority ||
        (candidate.priority === entry.priority &&
          candidate.task.id < entry.task.id)
      ) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    this.queue.splice(low, 0, entry);
    this.updateQueuePressureState();
  }

  private reserveQueueSlot(): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false);
    const admitted =
      this.queue.length + this.reservedQueueSlots + (this.active ? 1 : 0);
    if (admitted < MAX_PENDING_TASKS) {
      this.reservedQueueSlots += 1;
      this.updateQueuePressureState();
      return Promise.resolve(true);
    }
    if (this.submissionWaiters.length >= MAX_WAITING_SUBMISSIONS) {
      if (!this.queuePressureLogged) {
        this.queuePressureLogged = true;
        loggerWarn(
          `[ReticulumResourceWorker] queue_pressure admitted=${admitted} waiting=${this.submissionWaiters.length}`
        );
      }
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      this.submissionWaiters.push(resolve);
      this.updateQueuePressureState();
    });
  }

  private releaseQueueSlot(): void {
    if (this.stopping) return;
    const next = this.submissionWaiters.shift();
    if (next) {
      this.reservedQueueSlots += 1;
      next(true);
    }
    this.updateQueuePressureState();
  }

  private pendingTaskCount(): number {
    return (
      this.queue.length +
      this.reservedQueueSlots +
      this.submissionWaiters.length +
      (this.active ? 1 : 0)
    );
  }

  private updateQueuePressureState(): void {
    const pending = this.pendingTaskCount();
    if (!this.queuePressureLogged && pending >= QUEUE_PRESSURE_THRESHOLD) {
      this.queuePressureLogged = true;
      loggerWarn(
        `[ReticulumResourceWorker] queue_pressure admitted=${this.queue.length + this.reservedQueueSlots + (this.active ? 1 : 0)} waiting=${this.submissionWaiters.length}`
      );
      return;
    }
    if (
      this.queuePressureLogged &&
      pending < Math.floor(QUEUE_PRESSURE_THRESHOLD / 2)
    ) {
      this.queuePressureLogged = false;
    }
  }

  private retryOrFail(entry: QueueEntry, reason: string): void {
    if (!this.stopping && entry.retries < MAX_TASK_RETRIES) {
      entry.retries += 1;
      this.enqueue(entry);
      loggerWarn(
        `[ReticulumResourceWorker] task_retry kind=${entry.task.kind} reason=${reason} retry=${entry.retries}`
      );
      return;
    }
    this.fallbackCount += 1;
    entry.resolve(null);
    this.releaseQueueSlot();
  }
}
