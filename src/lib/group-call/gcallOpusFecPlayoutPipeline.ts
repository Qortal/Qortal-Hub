/**
 * Shared WASM Opus FEC decode → `group-playout-processor` batching (group voice + DM Reticulum).
 * Mirrors the former inline logic in `useGroupVoiceCall` so both paths stay identical.
 */

import { GCALL_WASM_FEC_MAX_PCM_PER_TICK } from './gcallWasmFecEnv';
import { OPUS_FRAME_SAMPLES } from './gcallVoiceAudioConstants';

export interface WasmFecDecodeStats {
  plcFrames: number;
  fecAttempts: number;
  fecSuccessCoarse: number;
}

/** Contiguous WASM decode output; `consumedFrames` tracks playout posts. */
export interface WasmFecPcmSlab {
  pcm: Float32Array;
  frameCount: number;
  consumedFrames: number;
  ingressAtMs: number | null;
}

export const GCALL_WASM_FEC_EMPTY_STATS = Object.freeze({
  plcFrames: 0,
  fecAttempts: 0,
  fecSuccessCoarse: 0,
});

export const GCALL_EMPTY_PCM = new Float32Array(0);

export type GetPlayoutNode = (sourceAddr: string) => AudioWorkletNode | undefined;
export type PostPcmBatch = (
  sourceAddr: string,
  pcm: Float32Array,
  frameCount: number,
  ingressAtMs: number | null
) => boolean;

export class GcallOpusFecPlayoutPipeline {
  private readonly jobQueues = new Map<
    string,
    Array<{ packet: Uint8Array; gap: number; ingressAtMs: number | null }>
  >();
  private readonly inflight = new Map<string, number | null>();
  private readonly deferredPcm = new Map<string, WasmFecPcmSlab[]>();
  private readonly postedThisTick = new Map<string, number>();
  private requestId = 0;

  constructor(
    private readonly getPlayoutNode: GetPlayoutNode,
    private readonly onWasmFecDecodeStats?: (
      sourceAddr: string,
      stats: WasmFecDecodeStats & { deferredPcmTick: boolean }
    ) => void,
    private readonly postPcmBatch?: PostPcmBatch
  ) {}

  clearPostedThisTick(): void {
    this.postedThisTick.clear();
  }

  /** Same set as the jitter tick prefetch loop (deferred slabs + active speakers). */
  prefetchAddressSet(activeAddrs: Iterable<string>): Set<string> {
    return new Set([...this.deferredPcm.keys(), ...activeAddrs]);
  }

  /** Prefetch deferred slabs + active sources (empty batch drains deferred PCM). */
  prefetchDeferredForAllSources(activeAddrs: Iterable<string>): void {
    for (const addr of this.prefetchAddressSet(activeAddrs)) {
      this.postBatch(
        addr,
        GCALL_EMPTY_PCM,
        0,
        GCALL_WASM_FEC_EMPTY_STATS,
        false
      );
    }
  }

  postBatch(
    sourceAddr: string,
    pcm: Float32Array,
    frameCount: number,
    stats: WasmFecDecodeStats,
    recordStats: boolean,
    ingressAtMs: number | null = null
  ): void {
    const playNode = this.postPcmBatch
      ? null
      : this.getPlayoutNode(sourceAddr);
    const queue = this.deferredPcm.get(sourceAddr) ?? [];
    this.deferredPcm.delete(sourceAddr);

    if (frameCount > 0) {
      const expectedLen = frameCount * OPUS_FRAME_SAMPLES;
      if (pcm.length !== expectedLen) {
        console.error('[GCall] opus-fec batch length mismatch', {
          sourceAddr: sourceAddr.slice(0, 12),
          frameCount,
          pcmLength: pcm.length,
          expectedLen,
        });
        if (queue.length > 0) this.deferredPcm.set(sourceAddr, queue);
        return;
      }
      queue.push({ pcm, frameCount, consumedFrames: 0, ingressAtMs });
    }

    if (!this.postPcmBatch && !playNode) {
      if (queue.length > 0) this.deferredPcm.set(sourceAddr, queue);
      return;
    }

    let posted = this.postedThisTick.get(sourceAddr) ?? 0;
    let deferredTick = false;

    outer: while (queue.length > 0) {
      const slab = queue[0];
      if (this.postPcmBatch) {
        const remainingFrames = slab.frameCount - slab.consumedFrames;
        const remainingBudget = GCALL_WASM_FEC_MAX_PCM_PER_TICK - posted;
        if (remainingBudget <= 0) {
          this.deferredPcm.set(sourceAddr, queue);
          deferredTick = true;
          break;
        }
        const frameBatch = Math.min(remainingFrames, remainingBudget);
        const start = slab.consumedFrames * OPUS_FRAME_SAMPLES;
        const end = start + frameBatch * OPUS_FRAME_SAMPLES;
        const pcmBatch =
          start === 0 && end === slab.pcm.length
            ? slab.pcm
            : slab.pcm.subarray(start, end);
        const accepted = this.postPcmBatch(
          sourceAddr,
          pcmBatch,
          frameBatch,
          slab.ingressAtMs
        );
        if (!accepted) {
          if (queue.length > 0) this.deferredPcm.set(sourceAddr, queue);
          return;
        }
        slab.consumedFrames += frameBatch;
        posted += frameBatch;
        if (slab.consumedFrames >= slab.frameCount) {
          queue.shift();
          continue;
        }
        this.deferredPcm.set(sourceAddr, queue);
        deferredTick = true;
        break;
      }
      while (slab.consumedFrames < slab.frameCount) {
        if (posted >= GCALL_WASM_FEC_MAX_PCM_PER_TICK) {
          this.deferredPcm.set(sourceAddr, queue);
          deferredTick = true;
          break outer;
        }
        const o = slab.consumedFrames * OPUS_FRAME_SAMPLES;
        const chunk = new Float32Array(OPUS_FRAME_SAMPLES);
        chunk.set(slab.pcm.subarray(o, o + OPUS_FRAME_SAMPLES));
        playNode.port.postMessage({ pcm: chunk }, [chunk.buffer]);
        slab.consumedFrames++;
        posted++;
      }
      queue.shift();
    }

    this.postedThisTick.set(sourceAddr, posted);
    if (
      recordStats &&
      this.onWasmFecDecodeStats &&
      (stats.plcFrames > 0 ||
        stats.fecAttempts > 0 ||
        stats.fecSuccessCoarse > 0 ||
        deferredTick)
    ) {
      this.onWasmFecDecodeStats(sourceAddr, {
        ...stats,
        deferredPcmTick: deferredTick,
      });
    }
  }

  enqueueDecode(
    worker: Worker,
    sourceAddr: string,
    packet: Uint8Array,
    gap: number,
    ingressAtMs: number | null
  ): void {
    const q = this.jobQueues.get(sourceAddr) ?? [];
    q.push({ packet, gap, ingressAtMs });
    this.jobQueues.set(sourceAddr, q);
    this.pump(worker, sourceAddr);
  }

  pump(worker: Worker, sourceAddr: string): void {
    if (this.inflight.get(sourceAddr)) return;
    const q = this.jobQueues.get(sourceAddr);
    if (!q || q.length === 0) return;
    const job = q.shift()!;
    if (q.length === 0) this.jobQueues.delete(sourceAddr);
    else this.jobQueues.set(sourceAddr, q);
    this.inflight.set(sourceAddr, job.ingressAtMs);
    const requestId = ++this.requestId;
    const buf = job.packet.buffer.slice(
      job.packet.byteOffset,
      job.packet.byteOffset + job.packet.byteLength
    );
    worker.postMessage(
      {
        type: 'decode' as const,
        requestId,
        sourceAddr,
        packet: buf,
        gap: job.gap,
      },
      [buf]
    );
  }

  completeInflight(sourceAddr: string): void {
    this.inflight.delete(sourceAddr);
  }

  consumeInflightIngressAtMs(sourceAddr: string): number | null {
    return this.inflight.get(sourceAddr) ?? null;
  }

  removeSource(sourceAddr: string): void {
    this.jobQueues.delete(sourceAddr);
    this.inflight.delete(sourceAddr);
    this.deferredPcm.delete(sourceAddr);
    this.postedThisTick.delete(sourceAddr);
  }

  resetAll(): void {
    this.jobQueues.clear();
    this.inflight.clear();
    this.deferredPcm.clear();
    this.postedThisTick.clear();
  }
}
