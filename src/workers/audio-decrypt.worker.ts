/**
 * audio-decrypt.worker.ts — Web Worker for off-thread audio packet decrypt/encrypt.
 *
 * Offloads the per-packet XSalsa20-Poly1305 hot path off the renderer's main JS thread.
 * Crypto primitive: libsodium WASM (`libsodium-wrappers-sumo`), wire-compatible with the
 * NaCl secretbox format used by peers running the tweetnacl fallback on the main thread.
 *
 * The worker is spawned by the {@link DecryptWorkerPool} (see
 * `src/lib/group-call/decryptWorkerPool.ts`); the pool handles stable ingress-shard
 * routing so this file sees one peer's packets per slot at a time.
 *
 * Message protocol (main → worker):
 *   { type: 'setRoomKey', roomKey: ArrayBuffer, keyVersion: number }
 *   { type: 'clearRoomKey', keyVersion: number }
 *
 *   Legacy single-packet shapes (kept for call sites that have not migrated yet):
 *     { type: 'decrypt', id: number, buffer: ArrayBuffer } — buffer transferred
 *     { type: 'encrypt', id, sourceAddr, vad, seq, timestampMs, opusFrame } — transfer opusFrame
 *
 *   Batched shapes (preferred; one round-trip per microtask):
 *     { type: 'decryptBatch', batchId: number,
 *       ids: number[], buffers: ArrayBuffer[],
 *       lastPlayedSeqByIngress?: Record<string, number> }
 *
 * Message protocol (worker → main):
 *   { type: 'workerReady' }                      — emitted once after libsodium is ready
 *   { type: 'result', id, decoded | decodedMulti | null }
 *   { type: 'resultBatch', batchId, results: Array<BatchResultEntry> }
 *   { type: 'encryptResult', id, packet: ArrayBuffer | null, error? }
 *   { type: 'roomKeyApplied', keyVersion }       — emitted AFTER libsodium init completes
 *   { type: 'roomKeyCleared', keyVersion }
 *
 * Note on stale-seq pre-skip: for every inbound batch the main thread can attach
 * `lastPlayedSeqByIngress` (the per-peer seq already played by the jitter buffer). If a
 * freshly decrypted packet's `seq` is already at or behind that watermark, we emit
 * `status: 'stale-pre-push'` instead of transferring the Opus frame back. This mirrors
 * the push-side stale-seq drop in `gcallJitterBuffer.ts` but saves the round-trip +
 * main-thread apply work during recovery bursts.
 */

import {
  decodeAudioPackets,
  encodeAudioPacketV2,
  type SecretBoxProvider,
} from '../lib/group-call/audioPacketCodec';
import { initLibsodiumSecretBoxProvider } from '../lib/group-call/audioPacketCodecSodium';

export interface DecryptResult {
  sourceAddr: string;
  vad: boolean;
  seq: number;
  timestampMs: number;
  opusFrame: ArrayBuffer;
}

type DecryptBatchStatus = 'ok' | 'decode-failed' | 'stale-pre-push';

export interface DecryptBatchResultEntry {
  id: number;
  status: DecryptBatchStatus;
  decoded?: DecryptResult;
  decodedMulti?: DecryptResult[];
}

type InboundMessage =
  | { type: 'setRoomKey'; roomKey: ArrayBuffer; keyVersion: number }
  | { type: 'clearRoomKey'; keyVersion: number }
  | { type: 'decrypt'; id: number; buffer: ArrayBuffer }
  | {
      type: 'encrypt';
      id: number;
      sourceAddr: string;
      vad: boolean;
      seq: number;
      timestampMs: number;
      opusFrame: ArrayBuffer;
    }
  | {
      type: 'decryptBatch';
      batchId: number;
      ids: number[];
      buffers: ArrayBuffer[];
      lastPlayedSeqByIngress?: Record<string, number>;
    }
  | { type: 'ping'; pingId: number };

/**
 * Local typed alias for the worker scope's `postMessage`. The project tsconfig lib set is
 * DOM-only (no `WebWorker` lib), so `self.postMessage(msg, transferables)` trips the
 * Window.postMessage overloads. This helper forces the correct shape.
 */
function workerPost(message: unknown, transfer?: Transferable[]): void {
  const s = self as unknown as {
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  if (transfer && transfer.length > 0) {
    s.postMessage(message, transfer);
  } else {
    s.postMessage(message);
  }
}

let roomKeyBytes: Uint8Array | null = null;
let roomKeyVersion = 0;

/**
 * libsodium is ready asynchronously (<100 ms on modern hardware). Any messages that
 * arrive before `sodium.ready` resolves are stashed here and drained in order as soon as
 * the provider is available, preserving per-peer sequencing while avoiding drops during
 * the init window.
 */
let libsodiumProvider: SecretBoxProvider | null = null;
const deferredInbound: InboundMessage[] = [];

function postWorkerReady(): void {
  workerPost({ type: 'workerReady' });
}

initLibsodiumSecretBoxProvider()
  .then((provider) => {
    libsodiumProvider = provider;
    postWorkerReady();
    const drain = deferredInbound.splice(0, deferredInbound.length);
    for (const msg of drain) {
      dispatchMessage(msg);
    }
  })
  .catch((err) => {
    // libsodium failed to load — fall back is handled by the main thread (sync decode path).
    // Surface the error so the pool can decide to terminate/reconstitute the slot.
    workerPost({
      type: 'workerInitFailed',
      error: (err as Error)?.message ?? String(err),
    });
  });

/**
 * Cheap lookup: `null` when no per-peer watermark was attached to the batch or the peer
 * is not yet tracked. Keep the Record<string, number> untouched — it is owned by the
 * main thread and must not be mutated here.
 */
function getLastPlayedSeq(
  watermark: Record<string, number> | undefined,
  addr: string
): number | null {
  if (!watermark) return null;
  const v = watermark[addr];
  return typeof v === 'number' ? v : null;
}

/**
 * Decode a single wire packet with the active libsodium provider. Returns a list so
 * multi-frame v3 packets are handled uniformly with v2/v1. Caller must check
 * `libsodiumProvider` is non-null (guaranteed by {@link dispatchMessage}).
 */
function decodeWithProvider(buf: ArrayBuffer): DecryptResult[] {
  const list = decodeAudioPackets(
    new Uint8Array(buf),
    roomKeyBytes as Uint8Array,
    libsodiumProvider as SecretBoxProvider
  );
  if (list.length === 0) return [];
  return list.map((d) => {
    const opusFrame = new ArrayBuffer(d.opusFrame.length);
    new Uint8Array(opusFrame).set(d.opusFrame);
    return {
      sourceAddr: d.sourceAddr,
      vad: d.vad,
      seq: d.seq,
      timestampMs: d.timestampMs,
      opusFrame,
    };
  });
}

function handleDecryptSingle(id: number, buffer: ArrayBuffer): void {
  const decoded = decodeWithProvider(buffer);
  if (decoded.length === 0) {
    workerPost({ type: 'result', id, decoded: null });
    return;
  }
  if (decoded.length === 1) {
    const d = decoded[0]!;
    workerPost({ type: 'result', id, decoded: d }, [d.opusFrame]);
    return;
  }
  const transferables = decoded.map((d) => d.opusFrame);
  workerPost(
    { type: 'result', id, decodedMulti: decoded },
    transferables
  );
}

function handleDecryptBatch(
  batchId: number,
  ids: number[],
  buffers: ArrayBuffer[],
  watermark: Record<string, number> | undefined
): void {
  const results: DecryptBatchResultEntry[] = [];
  const transferables: ArrayBuffer[] = [];
  const n = Math.min(ids.length, buffers.length);
  for (let i = 0; i < n; i++) {
    const id = ids[i]!;
    const buf = buffers[i]!;
    const decoded = decodeWithProvider(buf);
    if (decoded.length === 0) {
      results.push({ id, status: 'decode-failed' });
      continue;
    }

    // Stale-seq pre-skip: if every frame in the decoded list is already at or behind
    // the jitter buffer watermark for its source, there is nothing worth sending back.
    // This targets recovery-window bursts where the main thread would otherwise push
    // and immediately reject the frame (see `jitterPushStaleBySourceTick`).
    let anyFresh = false;
    for (const d of decoded) {
      const cutoff = getLastPlayedSeq(watermark, d.sourceAddr);
      if (cutoff === null || d.seq > cutoff) {
        anyFresh = true;
        break;
      }
    }
    if (!anyFresh) {
      results.push({ id, status: 'stale-pre-push' });
      continue;
    }

    if (decoded.length === 1) {
      const d = decoded[0]!;
      transferables.push(d.opusFrame);
      results.push({ id, status: 'ok', decoded: d });
    } else {
      for (const d of decoded) transferables.push(d.opusFrame);
      results.push({ id, status: 'ok', decodedMulti: decoded });
    }
  }
  workerPost(
    { type: 'resultBatch', batchId, results },
    transferables
  );
}

function dispatchMessage(data: InboundMessage): void {
  // Key management always runs, including before libsodium is ready — the main thread
  // needs to be able to queue up the initial `setRoomKey` during init.
  if (data.type === 'setRoomKey') {
    roomKeyBytes = new Uint8Array(data.roomKey);
    roomKeyVersion = data.keyVersion >>> 0;
    // Only ack after libsodium is ready; the main thread gates on `roomKeyApplied`
    // (and the pool only routes to a slot after its first `roomKeyApplied` lands).
    if (libsodiumProvider) {
      workerPost({ type: 'roomKeyApplied', keyVersion: roomKeyVersion });
    } else {
      deferredInbound.push(data);
    }
    return;
  }

  if (data.type === 'clearRoomKey') {
    roomKeyBytes = null;
    roomKeyVersion = data.keyVersion >>> 0;
    workerPost({ type: 'roomKeyCleared', keyVersion: roomKeyVersion });
    return;
  }

  if (!libsodiumProvider) {
    // Crypto not ready yet — buffer and drain once init resolves. This window is only
    // the first <100 ms of the worker's lifetime; main thread already tolerates this
    // via the `decryptWorkerAppliedKeyVersionRef` gate.
    deferredInbound.push(data);
    return;
  }

  if (!roomKeyBytes) {
    if (data.type === 'encrypt') {
      workerPost({
        type: 'encryptResult',
        id: data.id,
        packet: null,
        error: 'missing-room-key',
      });
    } else if (data.type === 'decryptBatch') {
      workerPost({
        type: 'resultBatch',
        batchId: data.batchId,
        results: data.ids.map((id) => ({
          id,
          status: 'decode-failed' as const,
        })),
      });
    }
    return;
  }

  if (data.type === 'encrypt') {
    try {
      const u8 = encodeAudioPacketV2(
        data.sourceAddr,
        data.vad,
        data.seq,
        data.timestampMs,
        new Uint8Array(data.opusFrame),
        roomKeyBytes,
        libsodiumProvider
      );
      workerPost(
        { type: 'encryptResult', id: data.id, packet: u8.buffer },
        [u8.buffer as ArrayBuffer]
      );
    } catch {
      workerPost({
        type: 'encryptResult',
        id: data.id,
        packet: null,
        error: 'encode-failed',
      });
    }
    return;
  }

  if (data.type === 'decrypt') {
    handleDecryptSingle(data.id, data.buffer);
    return;
  }

  if (data.type === 'decryptBatch') {
    handleDecryptBatch(
      data.batchId,
      data.ids,
      data.buffers,
      data.lastPlayedSeqByIngress
    );
    return;
  }

  if (data.type === 'ping') {
    // Drain round-trip for pool shrink. Sent AFTER the last decryptBatch in the slot's
    // out-queue so the pong arrives only once every in-flight batch has been processed.
    workerPost({ type: 'pong', pingId: data.pingId });
    return;
  }
}

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  dispatchMessage(e.data);
};
