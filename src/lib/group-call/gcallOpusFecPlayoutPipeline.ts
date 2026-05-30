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

export interface GcallOpusFecPipelineDiagnostics {
  queuedDecodeJobs: number;
  queuedDecodeJobsHighWater: number;
  inflightDecode: boolean;
  inflightDecodeAgeMs: number;
  deferredPcmSlabs: number;
  deferredPcmFrames: number;
  deferredPcmFramesHighWater: number;
  enqueuedDecodeJobs: number;
  completedDecodeJobs: number;
  postedPcmFrames: number;
  rejectedPcmFrames: number;
  deferredPcmTicks: number;
  lastRejectedPcmAtMs: number;
  lastDeferredPcmAtMs: number;
}

export class GcallOpusFecPlayoutPipeline {
  private readonly jobQueues = new Map<
    string,
    Array<{ packet: Uint8Array; gap: number; ingressAtMs: number | null }>
  >();
  private readonly inflight = new Map<string, number | null>();
  private readonly inflightStartedAtMs = new Map<string, number>();
  private readonly deferredPcm = new Map<string, WasmFecPcmSlab[]>();
  private readonly postedThisTick = new Map<string, number>();
  private readonly queuedDecodeJobsHighWater = new Map<string, number>();
  private readonly deferredPcmFramesHighWater = new Map<string, number>();
  private readonly enqueuedDecodeJobs = new Map<string, number>();
  private readonly completedDecodeJobs = new Map<string, number>();
  private readonly postedPcmFrames = new Map<string, number>();
  private readonly rejectedPcmFrames = new Map<string, number>();
  private readonly deferredPcmTicks = new Map<string, number>();
  private readonly lastRejectedPcmAtMs = new Map<string, number>();
  private readonly lastDeferredPcmAtMs = new Map<string, number>();
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

  getDiagnostics(sourceAddr: string): GcallOpusFecPipelineDiagnostics {
    const queuedDecodeJobs = this.jobQueues.get(sourceAddr)?.length ?? 0;
    const deferred = this.deferredPcm.get(sourceAddr) ?? [];
    const deferredPcmFrames = deferred.reduce(
      (sum, slab) => sum + Math.max(0, slab.frameCount - slab.consumedFrames),
      0
    );
    const startedAtMs = this.inflightStartedAtMs.get(sourceAddr) ?? 0;
    return {
      queuedDecodeJobs,
      queuedDecodeJobsHighWater:
        this.queuedDecodeJobsHighWater.get(sourceAddr) ?? queuedDecodeJobs,
      inflightDecode: this.inflight.has(sourceAddr),
      inflightDecodeAgeMs:
        startedAtMs > 0 && this.inflight.has(sourceAddr)
          ? Math.max(0, Date.now() - startedAtMs)
          : 0,
      deferredPcmSlabs: deferred.length,
      deferredPcmFrames,
      deferredPcmFramesHighWater:
        this.deferredPcmFramesHighWater.get(sourceAddr) ?? deferredPcmFrames,
      enqueuedDecodeJobs: this.enqueuedDecodeJobs.get(sourceAddr) ?? 0,
      completedDecodeJobs: this.completedDecodeJobs.get(sourceAddr) ?? 0,
      postedPcmFrames: this.postedPcmFrames.get(sourceAddr) ?? 0,
      rejectedPcmFrames: this.rejectedPcmFrames.get(sourceAddr) ?? 0,
      deferredPcmTicks: this.deferredPcmTicks.get(sourceAddr) ?? 0,
      lastRejectedPcmAtMs: this.lastRejectedPcmAtMs.get(sourceAddr) ?? 0,
      lastDeferredPcmAtMs: this.lastDeferredPcmAtMs.get(sourceAddr) ?? 0,
    };
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
          this.noteDeferredPcm(sourceAddr, queue);
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
          this.rejectedPcmFrames.set(
            sourceAddr,
            (this.rejectedPcmFrames.get(sourceAddr) ?? 0) + frameBatch
          );
          this.lastRejectedPcmAtMs.set(sourceAddr, Date.now());
          if (queue.length > 0) this.deferredPcm.set(sourceAddr, queue);
          this.noteDeferredPcm(sourceAddr, queue);
          return;
        }
        this.postedPcmFrames.set(
          sourceAddr,
          (this.postedPcmFrames.get(sourceAddr) ?? 0) + frameBatch
        );
        slab.consumedFrames += frameBatch;
        posted += frameBatch;
        if (slab.consumedFrames >= slab.frameCount) {
          queue.shift();
          continue;
        }
        this.deferredPcm.set(sourceAddr, queue);
        this.noteDeferredPcm(sourceAddr, queue);
        deferredTick = true;
        break;
      }
      while (slab.consumedFrames < slab.frameCount) {
        if (posted >= GCALL_WASM_FEC_MAX_PCM_PER_TICK) {
          this.deferredPcm.set(sourceAddr, queue);
          this.noteDeferredPcm(sourceAddr, queue);
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

  private noteDeferredPcm(sourceAddr: string, queue: WasmFecPcmSlab[]): void {
    const frames = queue.reduce(
      (sum, slab) => sum + Math.max(0, slab.frameCount - slab.consumedFrames),
      0
    );
    this.deferredPcmFramesHighWater.set(
      sourceAddr,
      Math.max(this.deferredPcmFramesHighWater.get(sourceAddr) ?? 0, frames)
    );
    this.deferredPcmTicks.set(
      sourceAddr,
      (this.deferredPcmTicks.get(sourceAddr) ?? 0) + 1
    );
    this.lastDeferredPcmAtMs.set(sourceAddr, Date.now());
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
    this.enqueuedDecodeJobs.set(
      sourceAddr,
      (this.enqueuedDecodeJobs.get(sourceAddr) ?? 0) + 1
    );
    this.queuedDecodeJobsHighWater.set(
      sourceAddr,
      Math.max(this.queuedDecodeJobsHighWater.get(sourceAddr) ?? 0, q.length)
    );
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
    this.inflightStartedAtMs.set(sourceAddr, Date.now());
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
    this.inflightStartedAtMs.delete(sourceAddr);
    this.completedDecodeJobs.set(
      sourceAddr,
      (this.completedDecodeJobs.get(sourceAddr) ?? 0) + 1
    );
  }

  consumeInflightIngressAtMs(sourceAddr: string): number | null {
    return this.inflight.get(sourceAddr) ?? null;
  }

  removeSource(sourceAddr: string): void {
    this.jobQueues.delete(sourceAddr);
    this.inflight.delete(sourceAddr);
    this.inflightStartedAtMs.delete(sourceAddr);
    this.deferredPcm.delete(sourceAddr);
    this.postedThisTick.delete(sourceAddr);
    this.queuedDecodeJobsHighWater.delete(sourceAddr);
    this.deferredPcmFramesHighWater.delete(sourceAddr);
    this.enqueuedDecodeJobs.delete(sourceAddr);
    this.completedDecodeJobs.delete(sourceAddr);
    this.postedPcmFrames.delete(sourceAddr);
    this.rejectedPcmFrames.delete(sourceAddr);
    this.deferredPcmTicks.delete(sourceAddr);
    this.lastRejectedPcmAtMs.delete(sourceAddr);
    this.lastDeferredPcmAtMs.delete(sourceAddr);
  }

  resetAll(): void {
    this.jobQueues.clear();
    this.inflight.clear();
    this.inflightStartedAtMs.clear();
    this.deferredPcm.clear();
    this.postedThisTick.clear();
    this.queuedDecodeJobsHighWater.clear();
    this.deferredPcmFramesHighWater.clear();
    this.enqueuedDecodeJobs.clear();
    this.completedDecodeJobs.clear();
    this.postedPcmFrames.clear();
    this.rejectedPcmFrames.clear();
    this.deferredPcmTicks.clear();
    this.lastRejectedPcmAtMs.clear();
    this.lastDeferredPcmAtMs.clear();
  }
}
