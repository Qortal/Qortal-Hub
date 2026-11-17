/**
 * Unit tests for {@link DecryptWorkerPool}.
 *
 * We fake the worker boundary: each FakeWorker is a plain object whose `postMessage`
 * (main→worker) records the request and optionally auto-replies by driving `onmessage`
 * (worker→main) synchronously. This keeps the tests deterministic — the real worker
 * is exercised separately through the codec/integration suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DecryptWorkerPool,
  stableHashString,
  type DecryptWorkerFactory,
} from './decryptWorkerPool';
import type { DecryptBatchResultEntry } from '../../workers/audio-decrypt.worker';

interface DecryptBatchMessage {
  type: 'decryptBatch';
  batchId: number;
  ids: number[];
  buffers: ArrayBuffer[];
  lastPlayedSeqByIngress?: Record<string, number>;
}

interface SetRoomKeyMessage {
  type: 'setRoomKey';
  roomKey: ArrayBuffer;
  keyVersion: number;
}

interface ClearRoomKeyMessage {
  type: 'clearRoomKey';
  keyVersion: number;
}

interface EncryptMessage {
  type: 'encrypt';
  id: number;
  sourceAddr: string;
  vad: boolean;
  seq: number;
  timestampMs: number;
  opusFrame: ArrayBuffer;
}

interface PingMessage {
  type: 'ping';
  pingId: number;
}

type OutboundFromMain =
  | DecryptBatchMessage
  | SetRoomKeyMessage
  | ClearRoomKeyMessage
  | EncryptMessage
  | PingMessage
  | { type: 'decrypt'; id: number; buffer: ArrayBuffer };

interface FakeWorkerOptions {
  /** When true, automatically ack `setRoomKey` / `clearRoomKey` with matching keyVersion. */
  autoAckKey?: boolean;
  /** When true, emit a synchronous `workerReady` from the ctor. */
  readyImmediately?: boolean;
}

class FakeWorker {
  readonly id: number;
  readonly sent: OutboundFromMain[] = [];
  readonly decryptBatches: DecryptBatchMessage[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  terminated = false;

  private readonly opts: FakeWorkerOptions;
  private static nextId = 1;

  constructor(opts: FakeWorkerOptions = {}) {
    this.opts = opts;
    this.id = FakeWorker.nextId++;
    if (opts.readyImmediately) {
      queueMicrotask(() => this.emit({ type: 'workerReady' }));
    }
  }

  postMessage(message: OutboundFromMain, _transfer?: Transferable[]): void {
    this.sent.push(message);
    if (message.type === 'decryptBatch') {
      this.decryptBatches.push(message);
    }
    if (this.opts.autoAckKey && message.type === 'setRoomKey') {
      this.emit({ type: 'roomKeyApplied', keyVersion: message.keyVersion });
    }
    if (this.opts.autoAckKey && message.type === 'clearRoomKey') {
      this.emit({ type: 'roomKeyCleared', keyVersion: message.keyVersion });
    }
    if (message.type === 'ping') {
      this.emit({ type: 'pong', pingId: message.pingId });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Drive a worker→main message synchronously. Tests use this to emit results / acks. */
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  respondToLastDecryptBatch(build: (msg: DecryptBatchMessage) => DecryptBatchResultEntry[]): void {
    const last = this.decryptBatches[this.decryptBatches.length - 1];
    if (!last) throw new Error('no decryptBatch was sent');
    this.emit({
      type: 'resultBatch',
      batchId: last.batchId,
      results: build(last),
    });
  }
}

function makeFactory(opts: FakeWorkerOptions): {
  factory: DecryptWorkerFactory;
  workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const factory: DecryptWorkerFactory = () => {
    const w = new FakeWorker(opts);
    workers.push(w);
    return w as unknown as Worker;
  };
  return { factory, workers };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('stableHashString', () => {
  it('is deterministic and well-distributed across bucket counts', () => {
    const addrs = Array.from({ length: 500 }, (_, i) => `peer-${i.toString(36)}`);
    for (const a of addrs) {
      expect(stableHashString(a)).toBe(stableHashString(a));
    }
    const buckets = [0, 0, 0, 0] as number[];
    for (const a of addrs) buckets[stableHashString(a) % 4]! += 1;
    // No bucket should be starved; any <1% is a distribution bug.
    for (const count of buckets) expect(count).toBeGreaterThan(addrs.length / 20);
  });
});

describe('DecryptWorkerPool', () => {
  const dummyKey = new Uint8Array(32).fill(7);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replicates setRoomKey to every slot and the encrypt worker, and resolves once all ack', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });

    // 2 decrypt slots + 1 encrypt worker.
    expect(workers).toHaveLength(3);

    await pool.setRoomKey(dummyKey, 5);

    for (const w of workers) {
      const setMsg = w.sent.find((m) => m.type === 'setRoomKey') as
        | SetRoomKeyMessage
        | undefined;
      expect(setMsg).toBeTruthy();
      expect(setMsg!.keyVersion).toBe(5);
    }
    expect(pool.size).toBe(2);
  });

  it('routes ingress peer addresses stably to the same slot', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    // Decrypt workers are `workers[0]` and `workers[1]`; encrypt worker is last.
    const [slotA, slotB] = workers;
    const addr = 'QpeerAAA';
    const expectedSlot = stableHashString(addr) % 2;

    pool.postDecrypt(addr, 100, new ArrayBuffer(8));
    pool.postDecrypt(addr, 101, new ArrayBuffer(8));
    pool.postDecrypt(addr, 102, new ArrayBuffer(8));
    await flushMicrotasks();

    const targetSlot = expectedSlot === 0 ? slotA! : slotB!;
    const otherSlot = expectedSlot === 0 ? slotB! : slotA!;
    expect(targetSlot.decryptBatches).toHaveLength(1);
    expect(targetSlot.decryptBatches[0]!.ids).toEqual([100, 101, 102]);
    expect(otherSlot.decryptBatches).toHaveLength(0);
  });

  it('coalesces multiple postDecrypt calls in the same turn into one batch per slot', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    const [slotA, slotB] = workers;
    // Addresses hashing into different slots.
    const aAddr = 'peerA-0';
    let bAddr = 'peerB-0';
    let tries = 0;
    while (stableHashString(aAddr) % 2 === stableHashString(bAddr) % 2) {
      tries += 1;
      if (tries > 50) throw new Error('could not find addresses hashing to different slots');
      bAddr = `peerB-${tries}`;
    }

    for (let i = 0; i < 5; i++) pool.postDecrypt(aAddr, i, new ArrayBuffer(4));
    for (let i = 100; i < 103; i++) pool.postDecrypt(bAddr, i, new ArrayBuffer(4));
    await flushMicrotasks();

    const slotForA =
      stableHashString(aAddr) % 2 === 0 ? slotA! : slotB!;
    const slotForB =
      stableHashString(bAddr) % 2 === 0 ? slotA! : slotB!;
    expect(slotForA.decryptBatches).toHaveLength(1);
    expect(slotForA.decryptBatches[0]!.ids).toEqual([0, 1, 2, 3, 4]);
    expect(slotForB.decryptBatches).toHaveLength(1);
    expect(slotForB.decryptBatches[0]!.ids).toEqual([100, 101, 102]);
  });

  it('attaches the latest lastPlayedSeqByIngress watermark to each batch', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 2,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    pool.setLastPlayedSeq('Qfoo', 123);
    pool.setLastPlayedSeq('Qbar', 55);
    pool.postDecrypt('Qfoo', 1, new ArrayBuffer(4));
    pool.postDecrypt('Qbar', 2, new ArrayBuffer(4));
    await flushMicrotasks();

    for (const w of workers.slice(0, 2)) {
      if (w.decryptBatches.length === 0) continue;
      expect(w.decryptBatches[0]!.lastPlayedSeqByIngress).toEqual({
        Qfoo: 123,
        Qbar: 55,
      });
    }
  });

  it('advances lastPlayedSeqByIngress across 16-bit sequence wraparound', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 1,
      maxSize: 1,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    pool.setLastPlayedSeq('Qwrap', 65535);
    pool.setLastPlayedSeq('Qwrap', 0);
    pool.postDecrypt('Qwrap', 1, new ArrayBuffer(4));
    await flushMicrotasks();

    expect(workers[0]!.decryptBatches[0]!.lastPlayedSeqByIngress).toEqual({
      Qwrap: 0,
    });
  });

  it('returns false from postDecrypt when no slot has applied the current key yet', () => {
    const { factory } = makeFactory({ autoAckKey: false });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    // No setRoomKey yet → routingRing empty.
    const accepted = pool.postDecrypt('Qfoo', 1, new ArrayBuffer(4));
    expect(accepted).toBe(false);
  });

  it('forwards resultBatch entries and fires onBatchCompleted telemetry', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const decrypted: number[] = [];
    const batchCompletions: Array<{ batchSize: number; staleSkipped: number }> = [];
    const pool = new DecryptWorkerPool({
      initialSize: 1,
      maxSize: 4,
      workerFactory: factory,
      handlers: {
        onDecryptResult: (r) => decrypted.push(r.id),
        onEncryptResult: () => {},
        onBatchCompleted: (info) =>
          batchCompletions.push({
            batchSize: info.batchSize,
            staleSkipped: info.staleSkipped,
          }),
      },
    });
    await pool.setRoomKey(dummyKey, 1);

    const slot = workers[0]!;
    pool.postDecrypt('Qonly', 10, new ArrayBuffer(4));
    pool.postDecrypt('Qonly', 11, new ArrayBuffer(4));
    pool.postDecrypt('Qonly', 12, new ArrayBuffer(4));
    await flushMicrotasks();

    slot.respondToLastDecryptBatch((msg) =>
      msg.ids.map((id, idx) => ({
        id,
        status: idx === 0 ? 'stale-pre-push' : 'ok',
      }))
    );
    expect(decrypted).toEqual([10, 11, 12]);
    expect(batchCompletions).toHaveLength(1);
    expect(batchCompletions[0]).toMatchObject({ batchSize: 3, staleSkipped: 1 });
  });

  it('grows on resize, auto-propagates the active room key, and enters routing ring immediately', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const resizedEvents: Array<{ from: number; to: number; reason: string }> = [];
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: {
        onDecryptResult: () => {},
        onEncryptResult: () => {},
        onResized: (from, to, reason) => resizedEvents.push({ from, to, reason }),
      },
    });
    await pool.setRoomKey(dummyKey, 1);
    expect(pool.size).toBe(2);

    const before = workers.length;
    await pool.resize(3, 'test');
    expect(workers.length).toBe(before + 1);

    // Grown slot MUST receive the currently-installed key from `spawnSlot` (not just
    // a later `setRoomKey` replay). Without this, the new slot never acks
    // `roomKeyApplied` and `pool.size` stays at 2, which caused the Kenny+Phil
    // `grow-burst-window` log spam in production.
    const newSlot = workers[workers.length - 1]!;
    const setMsg = newSlot.sent.find((m) => m.type === 'setRoomKey') as
      | SetRoomKeyMessage
      | undefined;
    expect(setMsg).toBeTruthy();
    expect(setMsg!.keyVersion).toBe(1);
    expect(pool.size).toBe(3);
    expect(resizedEvents).toEqual([{ from: 2, to: 3, reason: 'test' }]);
  });

  it('is idempotent on resize when rawSize already covers target (no onResized spam)', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: false });
    const resizedEvents: Array<{ from: number; to: number; reason: string }> = [];
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: {
        onDecryptResult: () => {},
        onEncryptResult: () => {},
        onResized: (from, to, reason) => resizedEvents.push({ from, to, reason }),
      },
    });
    // Do not ack key — the spawned slot stays in `init`, pool.size stays at 0.
    pool.setRoomKey(dummyKey, 1);
    expect(pool.size).toBe(0);
    const before = workers.length;

    // First resize grows rawSize from 2→3 and fires `onResized`.
    await pool.resize(3, 'first');
    expect(workers.length).toBe(before + 1);
    expect(resizedEvents).toHaveLength(1);

    // A second resize to the same target must NOT spawn another worker, and must NOT
    // fire `onResized` — the original grow is still settling. The scaling tick in
    // useGroupVoiceCall.ts runs ~every 250 ms, so without this guard a stuck-in-init
    // slot produced 25+ duplicate `decryptPoolScaled` events per burst window.
    await pool.resize(3, 'second');
    expect(workers.length).toBe(before + 1);
    expect(resizedEvents).toHaveLength(1);
  });

  it('drains and terminates excess slots on resize-down', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 3,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);
    expect(pool.size).toBe(3);

    const terminatedPromise = pool.resize(2, 'shrink');
    await flushMicrotasks();
    await terminatedPromise;

    // One of the first 3 workers (the encrypt worker is appended last) should be terminated.
    const terminatedCount = workers.slice(0, 3).filter((w) => w.terminated).length;
    expect(terminatedCount).toBe(1);
    expect(pool.size).toBe(2);
  });

  it('flushes pending decrypt batches before a setRoomKey rotation is replicated', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 1,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    const slot = workers[0]!;
    pool.postDecrypt('Qfoo', 1, new ArrayBuffer(4));
    pool.postDecrypt('Qfoo', 2, new ArrayBuffer(4));
    // Rotate synchronously — the pool must flush the batch first so it is decrypted
    // with the outgoing key.
    pool.setRoomKey(new Uint8Array(32).fill(8), 2);

    // Main-thread order: the decryptBatch must appear *before* the second setRoomKey.
    const setRoomKeyMsgs = slot.sent.filter((m) => m.type === 'setRoomKey');
    const decryptBatchIdx = slot.sent.findIndex((m) => m.type === 'decryptBatch');
    const secondSetRoomKeyIdx = slot.sent.lastIndexOf(
      setRoomKeyMsgs[setRoomKeyMsgs.length - 1]!
    );
    expect(decryptBatchIdx).toBeGreaterThan(-1);
    expect(decryptBatchIdx).toBeLessThan(secondSetRoomKeyIdx);
  });

  it('routes encrypt work to the dedicated encrypt worker', async () => {
    const { factory, workers } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    pool.postEncrypt(42, 'QsrcAddress', true, 7, 100, new ArrayBuffer(16));
    // Encrypt worker is the 3rd spawned (after the two decrypt slots).
    const encryptWorker = workers[2]!;
    const encryptMsg = encryptWorker.sent.find((m) => m.type === 'encrypt');
    expect(encryptMsg).toBeTruthy();
    for (const decryptSlot of workers.slice(0, 2)) {
      expect(decryptSlot.sent.some((m) => m.type === 'encrypt')).toBe(false);
    }
  });

  it('exposes per-slot depth through stats()', async () => {
    const { factory } = makeFactory({ autoAckKey: true });
    const pool = new DecryptWorkerPool({
      initialSize: 2,
      maxSize: 4,
      workerFactory: factory,
      handlers: { onDecryptResult: () => {}, onEncryptResult: () => {} },
    });
    await pool.setRoomKey(dummyKey, 1);

    // Before microtask flush, pending should show queue depth.
    pool.postDecrypt('Qfoo', 1, new ArrayBuffer(4));
    pool.postDecrypt('Qfoo', 2, new ArrayBuffer(4));
    const stats = pool.stats();
    expect(stats.poolSize).toBe(2);
    expect(stats.perSlotPending.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
