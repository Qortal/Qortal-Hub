/**
 * DecryptWorkerPool — orchestrates a small pool of audio-decrypt Web Workers that share
 * one room key and round-robin decrypt batches per stable ingress shard.
 *
 * Why a pool:
 *   A single worker is a serial queue. Under recovery-window bursts (post-join,
 *   post-key-rotate) packets arrive ~30 at a time and the worker finishes them all
 *   before emitting a single `result`, pushing perceived latency into the 300-400 ms
 *   range. By that point the jitter buffer has already advanced past the decrypted
 *   `seq` and the main thread drops the frame as stale. Sharding the burst across
 *   2-4 workers collapses that tail.
 *
 * Invariants:
 *   - `size` is the number of decrypt slots currently *routable* (i.e. have applied
 *     the latest room key). Newly spawned slots only enter the routing ring once they
 *     ack `roomKeyApplied`.
 *   - A given ingress peer address is always routed to the same slot index while the
 *     routing ring size is unchanged. Rehashing on resize is acceptable (decrypt has no
 *     ordering requirement; the jitter buffer re-sorts on insert).
 *   - Every `setRoomKey` / `clearRoomKey` is replicated to every slot and to the
 *     encrypt worker. The Promise returned from those methods resolves only after all
 *     slots have acked.
 *   - Encrypt has a dedicated worker instance (same worker file, separate `Worker`).
 *     Decrypt bursts cannot block mic encode.
 *
 * Batching (Phase 3 of the overhaul):
 *   - Incoming `postDecrypt` calls accumulate into a per-slot `pending.ids/buffers`
 *     arrays. A `queueMicrotask` coalesces all calls in the current turn into one
 *     `decryptBatch` per slot. Worst-case added latency is a single microtask.
 *   - `lastPlayedSeqBySource` snapshot travels with every batch. The worker short-
 *     circuits frames whose `seq` is already at or behind the jitter buffer's
 *     watermark, avoiding the round-trip + main-thread apply for obviously stale work.
 */

import type { DecryptBatchResultEntry, DecryptResult } from '../../workers/audio-decrypt.worker';
import { traceGcallAudioSurface } from './gcallAudioSurfaceTrace';

/**
 * `Worker.onerror` in Chromium often leaves `message` / `filename` empty; the real
 * failure is frequently on `error` (DOMException or Error).
 */
function serializeWorkerErrorEvent(ev: Event): Record<string, unknown> {
  const e = ev as ErrorEvent;
  const nested = (e as { error?: unknown }).error;
  return {
    type: e.type,
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: (e as ErrorEvent & { colno?: number }).colno,
    error:
      nested instanceof Error
        ? { name: nested.name, message: nested.message, stack: nested.stack }
        : nested != null
          ? String(nested)
          : undefined,
  };
}

export type DecryptWorkerFactory = () => Worker;

export interface DecryptPoolDecryptBatchHandlerInput {
  id: number;
  status: 'ok' | 'decode-failed' | 'stale-pre-push';
  decoded?: DecryptResult;
  decodedMulti?: DecryptResult[];
}

export interface DecryptPoolHandlers {
  /** One entry per decrypt submitted to the pool. `status` mirrors the worker-side classification. */
  onDecryptResult(entry: DecryptPoolDecryptBatchHandlerInput): void;
  /** Mirrors the legacy encrypt result. `packet` is the fully-encoded secretbox payload. */
  onEncryptResult(
    id: number,
    packet: ArrayBuffer | null,
    error?: string
  ): void;
  /** All decrypt slots + the encrypt worker have applied `keyVersion`. */
  onAllRoomKeyApplied?(keyVersion: number): void;
  /** All decrypt slots + the encrypt worker have cleared the key. */
  onAllRoomKeyCleared?(keyVersion: number): void;
  /** A slot's libsodium init failed (rare). Pool will auto-recreate that slot. */
  onSlotInitFailed?(slotIndex: number, error: string): void;
  /** Non-fatal slot `onerror`; exposed for diagnostics. */
  onSlotError?(slotIndex: number, err: unknown): void;
  /** Fired on every successful `resize`. */
  onResized?(from: number, to: number, reason: string): void;
  /** Per-batch completion telemetry (sampled by caller). */
  onBatchCompleted?(info: {
    slotIndex: number;
    batchSize: number;
    durationMs: number;
    staleSkipped: number;
    decodeFailed: number;
  }): void;
}

export interface DecryptWorkerPoolOptions {
  initialSize: number;
  /** Hard upper bound; callers typically pass `Math.max(1, hardwareConcurrency - 1)` clamped to 4. */
  maxSize: number;
  /** Factory producing a new Worker instance wired to `audio-decrypt.worker.ts`. */
  workerFactory: DecryptWorkerFactory;
  /** Handlers fired on the main thread as workers post results. */
  handlers: DecryptPoolHandlers;
  /**
   * Optional fault tolerance hook: if a slot's libsodium init fails, the pool will
   * terminate that slot and spawn a replacement up to this many times. Default 2.
   */
  maxInitRecoveryAttempts?: number;
}

/**
 * FNV-1a 32-bit — cheap, well-distributed, no deps. Used purely for shard routing; not a
 * security primitive.
 */
export function stableHashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface Slot {
  index: number;
  worker: Worker;
  /** `init` → `ready` once `workerReady` arrives; `draining` while a resize-down is pending; `terminated` after. */
  status: 'init' | 'ready' | 'draining' | 'terminated';
  /** Highest keyVersion this slot has acked via `roomKeyApplied`; `null` after `clearRoomKey`. */
  appliedKeyVersion: number | null;
  /** Highest keyVersion this slot has acked via `roomKeyCleared`. */
  clearedKeyVersion: number;
  /** Per-slot pending batch: ids/buffers pushed by `postDecrypt` since last microtask flush. */
  pending: { ids: number[]; buffers: ArrayBuffer[] };
  /** Monotonic per-slot batchId for cross-ref on `resultBatch`. */
  nextBatchId: number;
  /** Start timestamp per in-flight batchId for latency accounting. */
  inFlightBatchStartedAt: Map<number, number>;
  /** Resolve/reject for `drainAndTerminate` after final pong. */
  drainPingId: number | null;
  drainResolver: (() => void) | null;
  /** Replacement-attempt counter for init-failure recovery. */
  initRecoveryAttempts: number;
}

export class DecryptWorkerPool {
  private readonly workerFactory: DecryptWorkerFactory;
  private readonly handlers: DecryptPoolHandlers;
  private readonly maxSize: number;
  private readonly maxInitRecoveryAttempts: number;

  /** All slots, including those not yet in the routing ring. Index is stable. */
  private slots: Slot[] = [];
  /** Slot indices eligible for routing (ready + applied current key). Order is stable. */
  private routingRing: number[] = [];

  private currentKey: Uint8Array | null = null;
  private currentKeyVersion = 0;

  /** Dedicated worker for outbound mic encode. Never part of the decrypt routing ring. */
  private encryptWorker: Worker | null = null;
  private encryptAppliedKeyVersion: number | null = null;
  private encryptClearedKeyVersion = 0;
  /** Caps `spawnEncryptWorker` retries after `encryptWorker.onerror` (load failures). */
  private encryptWorkerErrorRespawns = 0;

  /** True while a `flush` microtask is already queued. */
  private flushScheduled = false;
  /** Resolver map for setRoomKey/clearRoomKey replication. */
  private pendingKeyApplyResolvers = new Map<number, () => void>();
  private pendingKeyClearResolvers = new Map<number, () => void>();

  /** Latest watermark snapshot from the main thread. Copied per batch. */
  private lastPlayedSeqBySource: Record<string, number> = Object.create(null);

  private terminated = false;

  constructor(opts: DecryptWorkerPoolOptions) {
    this.workerFactory = opts.workerFactory;
    this.handlers = opts.handlers;
    this.maxSize = Math.max(1, Math.floor(opts.maxSize));
    this.maxInitRecoveryAttempts = Math.max(
      0,
      Math.floor(opts.maxInitRecoveryAttempts ?? 2)
    );
    const initial = Math.max(
      1,
      Math.min(this.maxSize, Math.floor(opts.initialSize))
    );
    for (let i = 0; i < initial; i++) {
      this.spawnSlot();
    }
    this.spawnEncryptWorker();
  }

  get size(): number {
    return this.routingRing.length;
  }

  /** Raw slot count (including non-routable init/draining slots). */
  get rawSize(): number {
    return this.slots.filter((s) => s.status !== 'terminated').length;
  }

  /**
   * Record that the jitter buffer for `source` has played up to `seq`. Attached to every
   * subsequent batch so workers can skip obviously-stale frames inline.
   */
  setLastPlayedSeq(source: string, seq: number): void {
    if (!source) return;
    const prev = this.lastPlayedSeqBySource[source];
    if (typeof prev === 'number' && prev >= seq) return;
    this.lastPlayedSeqBySource[source] = seq;
  }

  clearLastPlayedSeq(source?: string): void {
    if (source) {
      delete this.lastPlayedSeqBySource[source];
    } else {
      this.lastPlayedSeqBySource = Object.create(null);
    }
  }

  /**
   * Route a single decrypt job to a pool slot. Call sites keep ownership of the
   * `pendingDecryptsRef` metadata by id; the pool only cares about `(id, buffer)`.
   *
   * Returns `false` when no routable slot exists yet — the caller should handle that
   * edge (e.g. fall through to the sync decode path).
   */
  postDecrypt(
    ingressPeerAddress: string,
    id: number,
    buffer: ArrayBuffer
  ): boolean {
    if (this.terminated) return false;
    const slot = this.pickSlotForRouting(ingressPeerAddress);
    if (!slot) return false;
    slot.pending.ids.push(id);
    slot.pending.buffers.push(buffer);
    this.scheduleFlush();
    return true;
  }

  /**
   * Route an encrypt job to the dedicated encrypt worker.
   * `opusFrame` buffer is transferred.
   */
  postEncrypt(
    id: number,
    sourceAddr: string,
    vad: boolean,
    seq: number,
    timestampMs: number,
    opusFrame: ArrayBuffer
  ): boolean {
    if (this.terminated || !this.encryptWorker) return false;
    this.encryptWorker.postMessage(
      {
        type: 'encrypt',
        id,
        sourceAddr,
        vad,
        seq,
        timestampMs,
        opusFrame,
      },
      [opusFrame]
    );
    return true;
  }

  /**
   * Replicate a room key to every slot and the encrypt worker. Resolves after every
   * target has acked `roomKeyApplied` for `keyVersion`.
   */
  setRoomKey(key: Uint8Array, keyVersion: number): Promise<void> {
    if (this.terminated) return Promise.resolve();
    // Flush any pending batches first so they go out ahead of setRoomKey and are
    // decrypted with the outgoing key. The main-thread hook stamps each pending entry
    // with its workerKeyVersion, so stale results are still caught, but flushing first
    // avoids needlessly wasting CPU decrypting with the wrong key.
    this.flushAllSlots();
    this.currentKey = new Uint8Array(key);
    this.currentKeyVersion = keyVersion >>> 0;
    const kv = this.currentKeyVersion;
    for (const slot of this.slots) {
      if (slot.status === 'terminated') continue;
      slot.appliedKeyVersion = null;
      this.sendSetRoomKeyToSlot(slot, key, kv);
    }
    this.encryptAppliedKeyVersion = null;
    if (this.encryptWorker) {
      const keyCopy = key.slice().buffer;
      this.encryptWorker.postMessage(
        { type: 'setRoomKey', roomKey: keyCopy, keyVersion: kv },
        [keyCopy]
      );
    }
    return new Promise<void>((resolve) => {
      this.pendingKeyApplyResolvers.set(kv, resolve);
      this.tryResolveKeyApplied(kv);
    });
  }

  clearRoomKey(keyVersion: number): Promise<void> {
    if (this.terminated) return Promise.resolve();
    this.flushAllSlots();
    this.currentKey = null;
    this.currentKeyVersion = keyVersion >>> 0;
    const kv = this.currentKeyVersion;
    let decryptPosted = 0;
    for (const slot of this.slots) {
      if (slot.status === 'terminated') continue;
      slot.appliedKeyVersion = null;
      slot.worker.postMessage({ type: 'clearRoomKey', keyVersion: kv });
      decryptPosted++;
    }
    if (this.encryptWorker) {
      this.encryptAppliedKeyVersion = null;
      this.encryptWorker.postMessage({ type: 'clearRoomKey', keyVersion: kv });
    }
    this.routingRing = [];
    traceGcallAudioSurface('decryptPool.clearRoomKey: posted', {
      keyVersion: kv,
      decryptSlots: decryptPosted,
      encrypt: Boolean(this.encryptWorker),
    });
    return new Promise<void>((resolve) => {
      this.pendingKeyClearResolvers.set(kv, resolve);
      this.tryResolveKeyCleared(kv, false);
    });
  }

  /**
   * Grow or shrink to `target`. No-op if already at that size (counts only routable slots
   * for the comparison since new slots are only considered "live" once keyed).
   */
  async resize(
    target: number,
    reason = 'manual'
  ): Promise<{ from: number; to: number }> {
    if (this.terminated) return { from: 0, to: 0 };
    const from = this.routingRing.length;
    const clamped = Math.max(1, Math.min(this.maxSize, Math.floor(target)));
    if (clamped === from) return { from, to: from };

    if (clamped > from) {
      const needed = clamped - this.rawSize;
      if (needed <= 0) {
        // Raw slots already cover `clamped` — they just haven't joined the routing ring
        // yet (still waiting on `roomKeyApplied`). Emitting `onResized` every tick while
        // we wait turns into log spam (see decryptPoolScaled bursts in the Kenny+Phil
        // diagnostic bundle); the next metrics tick will observe the slot either keyed
        // and routing, or genuinely stuck and need `spawnSlot` to retry.
        return { from, to: from };
      }
      for (let i = 0; i < needed; i++) this.spawnSlot();
      this.handlers.onResized?.(from, clamped, reason);
      return { from, to: clamped };
    }

    // Shrink: pick routing-ring tail slots to drain.
    const toDrainCount = from - clamped;
    const drainable = [...this.routingRing]
      .reverse()
      .slice(0, toDrainCount);
    const drainPromises: Promise<void>[] = [];
    for (const idx of drainable) {
      const slot = this.slots[idx];
      if (!slot || slot.status !== 'ready') continue;
      this.routingRing = this.routingRing.filter((i) => i !== idx);
      drainPromises.push(this.drainAndTerminate(slot));
    }
    await Promise.all(drainPromises);
    this.handlers.onResized?.(from, clamped, reason);
    return { from, to: clamped };
  }

  /**
   * Snapshot of per-slot pending + in-flight depth. Used by the observability path so
   * `pendingDecryptPressure` exports can include the per-shard picture at a glance.
   */
  stats(): {
    poolSize: number;
    rawSize: number;
    routingRing: number[];
    perSlotPending: number[];
    perSlotInFlight: number[];
    currentKeyVersion: number;
  } {
    return {
      poolSize: this.routingRing.length,
      rawSize: this.rawSize,
      routingRing: [...this.routingRing],
      perSlotPending: this.slots.map((s) => s.pending.ids.length),
      perSlotInFlight: this.slots.map((s) => s.inFlightBatchStartedAt.size),
      currentKeyVersion: this.currentKeyVersion,
    };
  }

  /** Terminate every worker. After `terminate()`, the pool is unusable. */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    this.flushScheduled = false;
    const drainPromises: Promise<void>[] = [];
    for (const slot of this.slots) {
      if (slot.status === 'terminated') continue;
      drainPromises.push(this.drainAndTerminate(slot));
    }
    if (this.encryptWorker) {
      this.encryptWorker.terminate();
      this.encryptWorker = null;
    }
    await Promise.all(drainPromises);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  private spawnSlot(): Slot {
    const index = this.slots.length;
    const worker = this.workerFactory();
    const slot: Slot = {
      index,
      worker,
      status: 'init',
      appliedKeyVersion: null,
      clearedKeyVersion: 0,
      pending: { ids: [], buffers: [] },
      nextBatchId: 1,
      inFlightBatchStartedAt: new Map(),
      drainPingId: null,
      drainResolver: null,
      initRecoveryAttempts: 0,
    };
    this.slots.push(slot);
    this.attachSlotHandlers(slot);
    // If a room key is already installed, seed this slot immediately so the first
    // `roomKeyApplied` ack arrives as soon as libsodium init completes and the slot can
    // join the routing ring without a second round-trip through `setRoomKey`. Without
    // this, `resize()` growths spawn workers that never apply the active key — the pool
    // stays at its pre-grow `size` and every subsequent scaling tick re-requests the same
    // `resize` target, producing `decryptPoolScaled` log spam with no real growth.
    if (this.currentKey) {
      this.sendSetRoomKeyToSlot(slot, this.currentKey, this.currentKeyVersion);
    }
    return slot;
  }

  private spawnEncryptWorker(): void {
    this.encryptWorker = this.workerFactory();
    this.encryptWorker.onmessage = (e) => this.handleEncryptMessage(e);
    this.encryptWorker.onerror = (ev) => {
      this.handleEncryptWorkerLoadOrRuntimeError(ev);
    };
    if (this.currentKey) {
      const keyCopy = this.currentKey.slice().buffer;
      this.encryptWorker.postMessage(
        {
          type: 'setRoomKey',
          roomKey: keyCopy,
          keyVersion: this.currentKeyVersion,
        },
        [keyCopy]
      );
    }
  }

  private attachSlotHandlers(slot: Slot): void {
    slot.worker.onmessage = (e) => this.handleSlotMessage(slot, e);
    slot.worker.onerror = (ev) => {
      this.handleDecryptSlotLoadOrRuntimeError(slot, ev);
    };
  }

  private sendSetRoomKeyToSlot(
    slot: Slot,
    key: Uint8Array,
    keyVersion: number
  ): void {
    const keyCopy = key.slice().buffer;
    slot.worker.postMessage(
      { type: 'setRoomKey', roomKey: keyCopy, keyVersion },
      [keyCopy]
    );
  }

  private pickSlotForRouting(ingressPeerAddress: string): Slot | null {
    if (this.routingRing.length === 0) return null;
    const h = stableHashString(ingressPeerAddress || '∅');
    const idx = this.routingRing[h % this.routingRing.length]!;
    return this.slots[idx] ?? null;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushAllSlots();
    });
  }

  private flushAllSlots(): void {
    if (this.terminated) return;
    // Snapshot watermark once per flush so all batches leaving this turn agree.
    const watermark = { ...this.lastPlayedSeqBySource };
    for (const slot of this.slots) {
      if (slot.status !== 'ready') continue;
      if (slot.pending.ids.length === 0) continue;
      const batchId = slot.nextBatchId++;
      const ids = slot.pending.ids;
      const buffers = slot.pending.buffers;
      slot.pending = { ids: [], buffers: [] };
      slot.inFlightBatchStartedAt.set(batchId, performance.now());
      slot.worker.postMessage(
        {
          type: 'decryptBatch',
          batchId,
          ids,
          buffers,
          lastPlayedSeqByIngress: watermark,
        },
        buffers
      );
    }
  }

  private handleSlotMessage(slot: Slot, e: MessageEvent): void {
    const data = e.data as
      | { type: 'workerReady' }
      | { type: 'workerInitFailed'; error: string }
      | { type: 'roomKeyApplied'; keyVersion: number }
      | { type: 'roomKeyCleared'; keyVersion: number }
      | { type: 'result'; id: number; decoded?: DecryptResult | null; decodedMulti?: DecryptResult[] }
      | { type: 'resultBatch'; batchId: number; results: DecryptBatchResultEntry[] }
      | { type: 'encryptResult'; id: number; packet: ArrayBuffer | null; error?: string }
      | { type: 'pong'; pingId: number };

    switch (data.type) {
      case 'workerReady':
        slot.status = 'ready';
        return;

      case 'workerInitFailed':
        this.handlers.onSlotInitFailed?.(slot.index, data.error);
        this.recoverSlotAfterInitFailure(slot);
        return;

      case 'roomKeyApplied': {
        const kv = data.keyVersion >>> 0;
        slot.appliedKeyVersion = Math.max(slot.appliedKeyVersion ?? 0, kv);
        if (slot.status === 'init' || slot.status === 'ready') {
          slot.status = 'ready';
          if (!this.routingRing.includes(slot.index)) {
            this.routingRing = [...this.routingRing, slot.index].sort(
              (a, b) => a - b
            );
          }
        }
        this.tryResolveKeyApplied(kv);
        return;
      }

      case 'roomKeyCleared': {
        const kv = data.keyVersion >>> 0;
        slot.clearedKeyVersion = Math.max(slot.clearedKeyVersion, kv);
        slot.appliedKeyVersion = null;
        this.routingRing = this.routingRing.filter((i) => i !== slot.index);
        traceGcallAudioSurface('decryptPool.roomKeyCleared: decrypt slot', {
          keyVersion: kv,
          slotIndex: slot.index,
          slotClearedKeyVersion: slot.clearedKeyVersion,
        });
        this.tryResolveKeyCleared(kv, true);
        return;
      }

      case 'resultBatch': {
        const started = slot.inFlightBatchStartedAt.get(data.batchId);
        if (typeof started === 'number') {
          slot.inFlightBatchStartedAt.delete(data.batchId);
          let staleSkipped = 0;
          let decodeFailed = 0;
          for (const r of data.results) {
            if (r.status === 'stale-pre-push') staleSkipped++;
            else if (r.status === 'decode-failed') decodeFailed++;
            this.handlers.onDecryptResult(r);
          }
          this.handlers.onBatchCompleted?.({
            slotIndex: slot.index,
            batchSize: data.results.length,
            durationMs: performance.now() - started,
            staleSkipped,
            decodeFailed,
          });
        } else {
          for (const r of data.results) this.handlers.onDecryptResult(r);
        }
        return;
      }

      case 'result': {
        // Legacy single-packet shape — still handled so the old `decrypt` path works.
        const decoded = data.decoded ?? undefined;
        const decodedMulti = data.decodedMulti;
        const status: 'ok' | 'decode-failed' =
          decoded || (decodedMulti && decodedMulti.length > 0)
            ? 'ok'
            : 'decode-failed';
        this.handlers.onDecryptResult({
          id: data.id,
          status,
          decoded,
          decodedMulti,
        });
        return;
      }

      case 'encryptResult':
        // Encrypt should not run on decrypt slots (dedicated worker for mic). If it
        // somehow does, forward so we don't lose the frame.
        this.handlers.onEncryptResult(data.id, data.packet, data.error);
        return;

      case 'pong':
        if (slot.drainPingId === data.pingId && slot.drainResolver) {
          const r = slot.drainResolver;
          slot.drainPingId = null;
          slot.drainResolver = null;
          r();
        }
        return;
    }
  }

  private handleEncryptMessage(e: MessageEvent): void {
    const data = e.data as
      | { type: 'workerReady' }
      | { type: 'workerInitFailed'; error: string }
      | { type: 'roomKeyApplied'; keyVersion: number }
      | { type: 'roomKeyCleared'; keyVersion: number }
      | { type: 'encryptResult'; id: number; packet: ArrayBuffer | null; error?: string }
      | { type: 'result' };

    if (data.type === 'encryptResult') {
      this.encryptWorkerErrorRespawns = 0;
      this.handlers.onEncryptResult(data.id, data.packet, data.error);
      return;
    }
    if (data.type === 'roomKeyApplied') {
      const kv = data.keyVersion >>> 0;
      this.encryptAppliedKeyVersion = Math.max(
        this.encryptAppliedKeyVersion ?? 0,
        kv
      );
      this.tryResolveKeyApplied(kv);
      return;
    }
    if (data.type === 'roomKeyCleared') {
      const kv = data.keyVersion >>> 0;
      this.encryptClearedKeyVersion = Math.max(this.encryptClearedKeyVersion, kv);
      this.encryptAppliedKeyVersion = null;
      traceGcallAudioSurface('decryptPool.roomKeyCleared: encrypt worker', {
        keyVersion: kv,
        encryptClearedKeyVersion: this.encryptClearedKeyVersion,
      });
      this.tryResolveKeyCleared(kv, true);
      return;
    }
    if (data.type === 'workerInitFailed') {
      this.handlers.onSlotInitFailed?.(-1, data.error);
      // Rebuild encrypt worker once; persistent failure escalates via onSlotError path.
      try {
        this.encryptWorker?.terminate();
      } catch {
        // ignore
      }
      this.encryptWorker = null;
      this.spawnEncryptWorker();
    }
  }

  /**
   * When a Web Worker never loads or crashes, it will not emit `roomKeyCleared` /
   * `roomKeyApplied`, so a pending set/clear key promise would hang forever.
   * `tryResolveKey*` already skips `terminated` slots and allows completion when
   * `encryptWorker` is null.
   */
  private nudgeKeyApplyAndClearResolvers(): void {
    for (const kv of Array.from(this.pendingKeyApplyResolvers.keys())) {
      this.tryResolveKeyApplied(kv);
    }
    for (const kv of Array.from(this.pendingKeyClearResolvers.keys())) {
      this.tryResolveKeyCleared(kv, true);
    }
  }

  private handleDecryptSlotLoadOrRuntimeError(slot: Slot, ev: Event): void {
    if (this.terminated) return;
    if (slot.status === 'terminated') return;
    traceGcallAudioSurface('decryptPool: decrypt slot worker error', {
      slotIndex: slot.index,
      ...serializeWorkerErrorEvent(ev),
    });
    try {
      slot.worker.terminate();
    } catch {
      // ignore
    }
    slot.status = 'terminated';
    this.routingRing = this.routingRing.filter((i) => i !== slot.index);
    this.nudgeKeyApplyAndClearResolvers();
    this.handlers.onSlotError?.(slot.index, ev);
  }

  private handleEncryptWorkerLoadOrRuntimeError(ev: Event): void {
    if (this.terminated) return;
    traceGcallAudioSurface('decryptPool: encrypt worker error', {
      ...serializeWorkerErrorEvent(ev),
    });
    const w = this.encryptWorker;
    this.encryptWorker = null;
    try {
      w?.terminate();
    } catch {
      // ignore
    }
    this.nudgeKeyApplyAndClearResolvers();
    this.handlers.onSlotError?.(-1, ev);
    if (
      !this.terminated &&
      this.encryptWorkerErrorRespawns < 3
    ) {
      this.encryptWorkerErrorRespawns += 1;
      this.spawnEncryptWorker();
    }
  }

  private tryResolveKeyApplied(keyVersion: number): void {
    const resolver = this.pendingKeyApplyResolvers.get(keyVersion);
    if (!resolver) return;
    // Every live slot must match, plus the encrypt worker.
    for (const slot of this.slots) {
      if (slot.status === 'terminated' || slot.status === 'draining') continue;
      if ((slot.appliedKeyVersion ?? -1) < keyVersion) return;
    }
    if (
      this.encryptWorker &&
      (this.encryptAppliedKeyVersion ?? -1) < keyVersion
    ) {
      return;
    }
    this.pendingKeyApplyResolvers.delete(keyVersion);
    resolver();
    this.handlers.onAllRoomKeyApplied?.(keyVersion);
  }

  private keyClearDebugSnapshot(needKeyVersion: number) {
    return {
      needKeyVersion,
      perSlot: this.slots.map((s) => ({
        i: s.index,
        st: s.status,
        cleared: s.clearedKeyVersion,
        ok: s.status === 'terminated' || s.clearedKeyVersion >= needKeyVersion,
      })),
      encrypt: this.encryptWorker
        ? { cleared: this.encryptClearedKeyVersion, ok: this.encryptClearedKeyVersion >= needKeyVersion }
        : { skipped: true as const },
    };
  }

  private tryResolveKeyCleared(keyVersion: number, fromWorkerAck: boolean): void {
    const resolver = this.pendingKeyClearResolvers.get(keyVersion);
    if (!resolver) return;
    for (const slot of this.slots) {
      if (slot.status === 'terminated') continue;
      if (slot.clearedKeyVersion < keyVersion) {
        if (fromWorkerAck) {
          traceGcallAudioSurface('decryptPool.clearRoomKey: still waiting (decrypt slot)', {
            ...this.keyClearDebugSnapshot(keyVersion),
            blockingSlotIndex: slot.index,
          });
        }
        return;
      }
    }
    if (this.encryptWorker && this.encryptClearedKeyVersion < keyVersion) {
      if (fromWorkerAck) {
        traceGcallAudioSurface('decryptPool.clearRoomKey: still waiting (encrypt worker)', {
          ...this.keyClearDebugSnapshot(keyVersion),
        });
      }
      return;
    }
    this.pendingKeyClearResolvers.delete(keyVersion);
    traceGcallAudioSurface('decryptPool.clearRoomKey: resolved', { keyVersion });
    resolver();
    this.handlers.onAllRoomKeyCleared?.(keyVersion);
  }

  private async drainAndTerminate(slot: Slot): Promise<void> {
    if (slot.status === 'terminated') return;
    // Remove from routing ring immediately so no new work lands on this slot.
    this.routingRing = this.routingRing.filter((i) => i !== slot.index);
    // Flush anything queued, then ping and wait for pong — the worker processes messages
    // in order, so pong arrives after the final resultBatch.
    this.flushAllSlots();
    slot.status = 'draining';
    await new Promise<void>((resolve) => {
      const pingId = slot.nextBatchId++;
      slot.drainPingId = pingId;
      slot.drainResolver = resolve;
      slot.worker.postMessage({ type: 'ping', pingId });
      // Safety fallback: if the worker is wedged, force-resolve after 500 ms.
      setTimeout(() => {
        if (slot.drainPingId === pingId) {
          slot.drainPingId = null;
          slot.drainResolver = null;
          resolve();
        }
      }, 500);
    });
    try {
      slot.worker.terminate();
    } catch {
      // ignore
    }
    slot.status = 'terminated';
  }

  private recoverSlotAfterInitFailure(slot: Slot): void {
    if (slot.initRecoveryAttempts >= this.maxInitRecoveryAttempts) return;
    slot.initRecoveryAttempts += 1;
    try {
      slot.worker.terminate();
    } catch {
      // ignore
    }
    const replacement = this.workerFactory();
    slot.worker = replacement;
    slot.status = 'init';
    slot.appliedKeyVersion = null;
    slot.clearedKeyVersion = 0;
    slot.pending = { ids: [], buffers: [] };
    slot.inFlightBatchStartedAt = new Map();
    this.attachSlotHandlers(slot);
    if (this.currentKey) {
      this.sendSetRoomKeyToSlot(slot, this.currentKey, this.currentKeyVersion);
    }
  }
}
