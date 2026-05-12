/**
 * DM Reticulum voice inbound: same path as group — jitter buffer → (WASM Opus FEC **or**
 * WebCodecs) → `group-playout-processor`, driven by `gcall-jitter-scheduler` ticks.
 */

import type { DecodedAudioPacket } from '../group-call/audioPacketCodec';
import {
  computeStaticPlayoutTargetMsForTuning,
  postStaticPlayoutTargetForTuning,
} from '../group-call/gcallInboundPlayoutTarget';
import { JitterBuffer } from '../group-call/gcallJitterBuffer';
import { createGcallJitterBufferForIngress } from '../group-call/gcallInboundJitterSetup';
import { GcallOpusFecPlayoutPipeline } from '../group-call/gcallOpusFecPlayoutPipeline';
import {
  GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS,
  computeN1SteadyReserveMs,
  shouldHoldN1SteadyReserve,
  shouldForceN1PostStartReprime,
  shouldForceN1RecoveryPrerollSatisfied,
} from '../group-call/gcallN1PlayoutGate';
import { GCALL_GLOBAL_PLAYOUT_CAP_MS } from '../group-call/gcallPlayoutPolicy';
import { configureWebCodecsOpusDecoderForGcall } from '../group-call/configureWebCodecsOpusDecoderForGcall';
import {
  applyGcallJitterBurstHeadroom,
  createGcallJitterBurstHeadroomState,
  stepGcallJitterBurstHeadroom,
  computeSoftUnprimeMsForTier2,
  getEffectiveJitterTuning,
  getGroupCallAudioTuning,
  readGroupCallAudioProfile,
  type GroupCallAudioQualityProfile,
  type GroupCallAudioTuning,
} from '../group-call/groupCallAudioProfile';
import type { GroupCallPerformanceTracker } from '../group-call/router';
import {
  GCALL_WASM_FEC_EXTRA_HOLD_FRAMES,
  readGcallWasmFecDesired,
} from '../group-call/gcallWasmFecEnv';
import {
  OPUS_CHANNELS,
  OPUS_FRAME_SAMPLES,
  OPUS_SAMPLE_RATE,
} from '../group-call/gcallVoiceAudioConstants';
import { PerSourcePcmRing } from '../group-call/v2/perSourcePcmRing';
import OpusFecWorker from '../../workers/gcall-opus-fec.worker?worker';

export interface DmVoiceGcallPlayoutWorkletMessage {
  type?: string;
  bufferedMs?: number;
  preProcessBufferedMs?: number;
  targetPlayoutMs?: number;
  rate?: number;
  outsideBand?: boolean;
  outsideBandUnder?: boolean;
  outsideBandOver?: boolean;
  deltaMs?: number;
  oldestFrameAgeMs?: number;
  concealmentUsed?: boolean;
  playoutStarted?: boolean;
  panicZoneEntered?: boolean;
}

export interface DmVoiceGcallInboundOptions {
  /** Same tracker as group voice for playout metrics + adaptive mode. */
  metricsRef?: { current: GroupCallPerformanceTracker | null };
  /** Optional explicit quality profile instead of localStorage-backed default. */
  profile?: GroupCallAudioQualityProfile;
  /** After each jitter drain tick (aligned with group `runJitterDrainTick` tail). */
  afterDrain?: (info: { missedFramesThisTick: number }) => void;
  /** Fired after a jitter pop advances the played sequence watermark. */
  onPlayedSeqAdvanced?: (info: {
    sourceAddr: string;
    playedSeq: number;
  }) => void;
  /** `gcallPlayoutMetrics` from `group-playout-processor`. */
  onPlayoutWorkletMessage?: (d: DmVoiceGcallPlayoutWorkletMessage) => void;
  /** One sample per jitter scheduler tick for the active hidden playout path. */
  onJitterTickTelemetry?: (info: {
    sourceAddr: string;
    durationMs: number;
    bufferedFrames: number;
    hasReadyFrame: boolean;
    rawEmpty: boolean;
  }) => void;
  /** WASM FEC decode stats from the active hidden playout path. */
  onWasmFecDecodeStats?: (info: {
    sourceAddr: string;
    plcFrames: number;
    fecAttempts: number;
    fecSuccessCoarse: number;
    deferredPcmTick: boolean;
  }) => void;
  /** Current number of active remote sources on this hidden receive path. */
  getActiveSourceCount?: () => number;
}

const GCALL_READY_STALL_FORCE_PRIMED_HOLD_MS = 5_000;
const GCALL_MULTI_SOURCE_READY_STALL_MIN_BUFFERED_FRAMES = 10;
const GCALL_MULTI_SOURCE_READY_STALL_MIN_MS = 500;
const GCALL_MULTI_SOURCE_READY_STALL_RECENT_PUSH_MAX_MS = 250;

export function decideReadyStallForcePrime(opts: {
  hasObservedPlayoutStart: boolean;
  activeSourceCount: number;
  hasReadyFrame: boolean;
  bufferedFrames: number;
  stallSinceMs: number | null;
  nowMs: number;
  lastPushAgeMs: number;
  targetPlayoutMs: number;
}): { shouldForcePrime: boolean; nextStallSinceMs: number | null } {
  if (opts.hasReadyFrame || opts.bufferedFrames <= 0) {
    return { shouldForcePrime: false, nextStallSinceMs: null };
  }
  if (opts.stallSinceMs === null) {
    return { shouldForcePrime: false, nextStallSinceMs: opts.nowMs };
  }
  const blockedForMs = Math.max(0, opts.nowMs - opts.stallSinceMs);
  if (opts.activeSourceCount >= 2) {
    const hasRecentPush =
      Number.isFinite(opts.lastPushAgeMs) &&
      opts.lastPushAgeMs <= GCALL_MULTI_SOURCE_READY_STALL_RECENT_PUSH_MAX_MS;
    const hasSubstantialFreshPreroll =
      opts.bufferedFrames >=
        GCALL_MULTI_SOURCE_READY_STALL_MIN_BUFFERED_FRAMES && hasRecentPush;
    const shouldForcePrime =
      hasSubstantialFreshPreroll &&
      blockedForMs >= GCALL_MULTI_SOURCE_READY_STALL_MIN_MS;
    return {
      shouldForcePrime,
      nextStallSinceMs: shouldForcePrime
        ? null
        : hasSubstantialFreshPreroll
          ? opts.stallSinceMs
          : null,
    };
  }
  if (opts.activeSourceCount !== 1) {
    return { shouldForcePrime: false, nextStallSinceMs: null };
  }
  const opusBufferedMs = opts.bufferedFrames * 20;
  const shouldForcePrime = opts.hasObservedPlayoutStart
    ? shouldForceN1PostStartReprime({
        blockedForMs,
        lastPushAgeMs: opts.lastPushAgeMs,
        opusBufferedMs,
        sourceActive: true,
        targetMs: opts.targetPlayoutMs,
      })
    : shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs,
        lastPushAgeMs: opts.lastPushAgeMs,
        opusBufferedMs,
        sourceActive: true,
        targetMs: opts.targetPlayoutMs,
      });
  return {
    shouldForcePrime,
    nextStallSinceMs: shouldForcePrime ? null : opts.stallSinceMs,
  };
}

export function computeN1SteadyPrimedHoldFrames(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  hasObservedPlayoutStart: boolean;
  hasReadyFrame: boolean;
  bufferedFrames: number;
  lastPushAgeMs: number;
  targetPlayoutMs: number;
}): number {
  if (opts.activeSourceCount !== 1) return 0;
  if (opts.adaptiveNetworkMode !== 'recovery') return 1;
  if (!opts.hasObservedPlayoutStart) return 0;
  const reserveMs = computeN1SteadyReserveMs(opts.targetPlayoutMs);
  const sourceRecentlyPushed =
    Number.isFinite(opts.lastPushAgeMs) &&
    opts.lastPushAgeMs <= GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS;
  return shouldHoldN1SteadyReserve({
    steadySingleRemote: true,
    sourceRecentlyPushed,
    hasReadyFrame: opts.hasReadyFrame,
    opusBufferedMs: opts.bufferedFrames * 20,
    reserveMs,
  })
    ? 1
    : 0;
}

function disconnectSafe(node: AudioNode | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}

/**
 * One remote peer, one jitter buffer, one decode path (WASM FEC or WebCodecs), one playout worklet.
 */
export class DmVoiceGcallInboundPlayout {
  private jitter: JitterBuffer | null = null;
  private decoder: AudioDecoder | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private schedulerNode: AudioWorkletNode | null = null;
  private schedulerGain: GainNode | null = null;
  private speakerGain: GainNode | null = null;
  private pcmRing: PerSourcePcmRing | null = null;
  private workletsLoadedForContext: WeakMap<AudioContext, Promise<void>> =
    new WeakMap();

  private peerAddress = '';
  private tuning: GroupCallAudioTuning | null = null;
  private fecPipeline: GcallOpusFecPlayoutPipeline | null = null;
  private opusFecWorker: Worker | null = null;
  private wasmFecActive = false;
  private callbacks: DmVoiceGcallInboundOptions | null = null;
  /** Last applied `metrics.adaptiveNetworkMode` for jitter geometry. */
  private lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null = null;
  private lastJitterActiveSourceCount = 1;
  private lastPostedTargetPlayoutMs: number | null = null;
  private pendingDecodedIngressAtMs: Array<number | null> = [];
  private lastDrainMetricSampleAtMs = 0;
  private startupReadyStallSinceMs: number | null = null;
  private hasObservedPlayoutStart = false;
  private lastPushAtPerfMs: number | null = null;
  private jitterPushAccepted = 0;
  private jitterPushStale = 0;
  private jitterPushDuplicate = 0;
  private jitterPushTrimmedFrames = 0;
  private jitterPushTrimEvents = 0;
  private jitterPushDepthHighWater = 0;
  private jitterPushDepthHighWaterSinceLastHeadroomStep = 0;
  private jitterLastTrimmedFrames = 0;
  private jitterLastTrimAtMs = 0;
  private jitterTrimmedFramesAtLastHeadroomStep = 0;
  private jitterBurstHeadroomState = createGcallJitterBurstHeadroomState();
  private lastJitterBurstHeadroomReason: string | null = null;

  private resolveActiveSourceCount(): number {
    const n = this.callbacks?.getActiveSourceCount?.() ?? 1;
    return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  }

  private async ensureWebCodecsDecoder(): Promise<void> {
    if (this.decoder && this.decoder.state !== 'closed') return;
    const tuning = this.tuning;
    const node = this.playbackNode;
    if (!tuning || !node) return;
    const AudioDecoderCtor = globalThis.AudioDecoder;
    if (!AudioDecoderCtor) {
      throw new Error('AudioDecoder unavailable');
    }
    const decoder = new AudioDecoderCtor({
      output: (audioData: AudioData) => {
        const pcm = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        audioData.close();
        const ingressAtMs =
          this.pendingDecodedIngressAtMs.length > 0
            ? (this.pendingDecodedIngressAtMs.shift() ?? null)
            : null;
        this.pushPcmToPlayout(pcm, ingressAtMs);
      },
      error: (e: Error) => {
        console.error('[DM voice] inbound AudioDecoder:', e);
      },
    });
    await configureWebCodecsOpusDecoderForGcall(decoder, tuning, {
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
    });
    this.decoder = decoder;
  }

  private fallbackFromWasmFecToWebCodecs(reason: string): void {
    if (!this.wasmFecActive && this.decoder) return;
    this.wasmFecActive = false;
    if (this.opusFecWorker) {
      try {
        this.opusFecWorker.terminate();
      } catch {
        /* ignore */
      }
      this.opusFecWorker = null;
    }
    this.fecPipeline = null;
    void this.ensureWebCodecsDecoder().catch((error) => {
      console.error(
        '[DM voice] WebCodecs fallback failed after WASM FEC error',
        {
          reason,
          message: error instanceof Error ? error.message : String(error),
        }
      );
    });
  }

  getPlaybackWorkletNode(): AudioWorkletNode | null {
    return this.playbackNode;
  }

  getDiagnosticsSnapshot(): {
    peerAddress: string;
    decodePath: 'wasm-fec' | 'webcodecs' | 'uninitialized';
    wasmFecActive: boolean;
    hasOpusFecWorker: boolean;
    hasWebCodecsDecoder: boolean;
    decoderState: string | null;
    hasSharedPcmRing: boolean;
    sharedRingEnabled: boolean;
    jitterActive: boolean;
    jitterBufferedFrames: number;
    jitterHasReadyFrame: boolean;
    jitterMaxEntries: number;
    jitterPushAccepted: number;
    jitterPushStale: number;
    jitterPushDuplicate: number;
    jitterPushTrimmedFrames: number;
    jitterPushTrimEvents: number;
    jitterPushDepthHighWater: number;
    jitterLastTrimmedFrames: number;
    jitterLastTrimAtMs: number;
    jitterBurstHeadroomLevel: number;
    jitterBurstHeadroomHoldUntilMs: number;
    jitterBurstHeadroomReason: string | null;
    playbackNodeActive: boolean;
    schedulerNodeActive: boolean;
    lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null;
  } {
    this.syncJitterGeometryFromMetrics(false);
    return {
      peerAddress: this.peerAddress,
      decodePath: this.wasmFecActive
        ? 'wasm-fec'
        : this.decoder
          ? 'webcodecs'
          : 'uninitialized',
      wasmFecActive: this.wasmFecActive,
      hasOpusFecWorker: this.opusFecWorker !== null,
      hasWebCodecsDecoder: this.decoder !== null,
      decoderState: this.decoder?.state ?? null,
      hasSharedPcmRing: this.pcmRing !== null,
      sharedRingEnabled: this.pcmRing !== null,
      jitterActive: this.jitter !== null,
      jitterBufferedFrames: this.jitter?.getBufferedFrames() ?? 0,
      jitterHasReadyFrame: this.jitter?.hasReadyFrame() ?? false,
      jitterMaxEntries: this.jitter?.getMaxEntries() ?? 0,
      jitterPushAccepted: this.jitterPushAccepted,
      jitterPushStale: this.jitterPushStale,
      jitterPushDuplicate: this.jitterPushDuplicate,
      jitterPushTrimmedFrames: this.jitterPushTrimmedFrames,
      jitterPushTrimEvents: this.jitterPushTrimEvents,
      jitterPushDepthHighWater: this.jitterPushDepthHighWater,
      jitterLastTrimmedFrames: this.jitterLastTrimmedFrames,
      jitterLastTrimAtMs: this.jitterLastTrimAtMs,
      jitterBurstHeadroomLevel: this.jitterBurstHeadroomState.level,
      jitterBurstHeadroomHoldUntilMs: this.jitterBurstHeadroomState.holdUntilMs,
      jitterBurstHeadroomReason: this.lastJitterBurstHeadroomReason,
      playbackNodeActive: this.playbackNode !== null,
      schedulerNodeActive: this.schedulerNode !== null,
      lastJitterAdaptiveMode: this.lastJitterAdaptiveMode,
    };
  }

  syncAdaptiveJitterGeometry(): void {
    this.syncJitterGeometryFromMetrics();
  }

  setDynamicTargetPlayoutMs(targetPlayoutMs: number): void {
    const node = this.playbackNode;
    if (!node || !Number.isFinite(targetPlayoutMs)) return;
    const rounded = Math.max(40, Math.round(targetPlayoutMs));
    if (this.lastPostedTargetPlayoutMs === rounded) return;
    this.lastPostedTargetPlayoutMs = rounded;
    node.port.postMessage({
      type: 'target',
      targetPlayoutMs: rounded,
    });
  }

  resetDynamicTargetPlayoutMs(): void {
    const tuning = this.tuning;
    if (!tuning) return;
    this.setDynamicTargetPlayoutMs(
      computeStaticPlayoutTargetMsForTuning(tuning)
    );
  }

  setBurstRecoveryExtraHoldFrames(frames: number): number {
    return this.jitter?.setBurstRecoveryExtraHoldFrames(frames) ?? 0;
  }

  private canUseSharedPcmRing(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
  }

  private pushPcmToPlayout(
    pcm: Float32Array,
    ingressAtMs: number | null = null
  ): boolean {
    const ring = this.pcmRing;
    if (ring) {
      ring.write(pcm, { ingressAtMs });
      return true;
    }
    const currentNode = this.playbackNode;
    if (!currentNode) return false;
    if (
      typeof ingressAtMs === 'number' &&
      Number.isFinite(ingressAtMs) &&
      this.callbacks?.metricsRef?.current
    ) {
      this.callbacks.metricsRef.current.recordReceiverIngressToPlayoutPostLatency(
        this.peerAddress,
        Math.max(0, Date.now() - ingressAtMs)
      );
    }
    const copy = new Float32Array(pcm.length);
    copy.set(pcm);
    currentNode.port.postMessage({ pcm: copy }, [copy.buffer]);
    return true;
  }

  /**
   * Wire capture-time AudioContext: scheduler + playout + decode to `connectTo` (e.g. remote gain).
   */
  async start(
    ctx: AudioContext,
    peerAddress: string,
    connectTo: AudioNode,
    options?: DmVoiceGcallInboundOptions
  ): Promise<void> {
    await this.stop();

    this.callbacks = options ?? null;
    this.lastJitterAdaptiveMode = null;
    this.startupReadyStallSinceMs = null;
    this.hasObservedPlayoutStart = false;
    this.lastPushAtPerfMs = null;
    this.resetJitterPushDiagnostics();
    this.peerAddress = peerAddress;
    const tuning = getGroupCallAudioTuning(
      options?.profile ?? readGroupCallAudioProfile()
    );
    this.tuning = tuning;

    const fecDesired = readGcallWasmFecDesired();
    this.jitter = createGcallJitterBufferForIngress({
      tuning,
      adaptiveNetworkMode: 'low-latency',
      extraHoldFrames: fecDesired ? GCALL_WASM_FEC_EXTRA_HOLD_FRAMES : 0,
      activeSourceCount: this.resolveActiveSourceCount(),
      tier2MultiSource: true,
      applySteadyPrimedHoldNow: true,
    });

    let load = this.workletsLoadedForContext.get(ctx);
    if (!load) {
      load = Promise.all([
        ctx.audioWorklet.addModule('/worklets/gcall-jitter-scheduler.js'),
        ctx.audioWorklet.addModule('/worklets/group-playout-processor.js'),
      ]).then(() => {});
      this.workletsLoadedForContext.set(ctx, load);
    }
    await load;

    const pcmRing = this.canUseSharedPcmRing()
      ? new PerSourcePcmRing({ sampleRateHz: OPUS_SAMPLE_RATE })
      : null;
    const playNode = new AudioWorkletNode(ctx, 'group-playout-processor', {
      processorOptions: {
        sourceAddr: peerAddress,
        maxPlayoutTargetMs: GCALL_GLOBAL_PLAYOUT_CAP_MS,
        ...(pcmRing
          ? {
              sharedRing: pcmRing.getSharedBridgeConfig(),
            }
          : {}),
      },
    } as AudioWorkletNodeOptions);

    postStaticPlayoutTargetForTuning(playNode, tuning);
    this.lastPostedTargetPlayoutMs =
      computeStaticPlayoutTargetMsForTuning(tuning);

    playNode.port.onmessage = (e: MessageEvent) => {
      const d = e.data as DmVoiceGcallPlayoutWorkletMessage;
      if (d?.type !== 'gcallPlayoutMetrics') return;
      if (d.playoutStarted) {
        this.hasObservedPlayoutStart = true;
        this.startupReadyStallSinceMs = null;
      }
      this.callbacks?.onPlayoutWorkletMessage?.(d);
    };

    const speakerGain = ctx.createGain();
    speakerGain.gain.value = 1;
    playNode.connect(speakerGain);
    speakerGain.connect(connectTo);

    this.playbackNode = playNode;
    this.pcmRing = pcmRing;

    if (fecDesired) {
      this.fecPipeline = new GcallOpusFecPlayoutPipeline(
        (addr) =>
          addr === this.peerAddress
            ? (this.playbackNode ?? undefined)
            : undefined,
        (addr, stats) => {
          this.callbacks?.metricsRef?.current?.recordWasmFecDecodeStats(
            addr,
            stats
          );
          this.callbacks?.onWasmFecDecodeStats?.({
            sourceAddr: addr,
            ...stats,
          });
        },
        (addr, pcmBatch, _frameCount, ingressAtMs) => {
          if (addr !== this.peerAddress) return false;
          return this.pushPcmToPlayout(pcmBatch, ingressAtMs);
        }
      );
      try {
        const w = new OpusFecWorker();
        w.onmessage = (
          ev: MessageEvent<
            | {
                type: 'decoded';
                sourceAddr: string;
                pcm: Float32Array;
                frameCount: number;
                stats: {
                  plcFrames: number;
                  fecAttempts: number;
                  fecSuccessCoarse: number;
                };
              }
            | { type: 'error'; sourceAddr?: string; message: string }
          >
        ) => {
          const d = ev.data;
          if (d.type === 'error') {
            console.error('[DM voice] opus-fec worker:', d.message);
            this.fallbackFromWasmFecToWebCodecs('worker-message-error');
            return;
          }
          if (d.type !== 'decoded' || !this.fecPipeline || !this.opusFecWorker)
            return;
          const ingressAtMs = this.fecPipeline.consumeInflightIngressAtMs(
            d.sourceAddr
          );
          this.fecPipeline.completeInflight(d.sourceAddr);
          this.fecPipeline.postBatch(
            d.sourceAddr,
            d.pcm,
            d.frameCount,
            d.stats,
            true,
            ingressAtMs
          );
          this.fecPipeline.pump(this.opusFecWorker, d.sourceAddr);
        };
        w.onerror = (err) => {
          console.error('[DM voice] opus-fec worker error', err);
          this.fallbackFromWasmFecToWebCodecs('worker-onerror');
        };
        this.opusFecWorker = w;
        this.wasmFecActive = true;
      } catch (error) {
        console.error('[DM voice] opus-fec worker init failed', error);
        this.fallbackFromWasmFecToWebCodecs('worker-init');
      }
    } else {
      await this.ensureWebCodecsDecoder();
      this.wasmFecActive = false;
    }

    const jitterSched = new AudioWorkletNode(ctx, 'gcall-jitter-scheduler');
    jitterSched.port.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type !== 'tick') return;
      const tickStartedAt = performance.now();
      this.syncJitterGeometryFromMetrics(true);
      const jb = this.jitter;
      let missedFramesThisTick = 0;
      if (!jb) {
        this.callbacks?.afterDrain?.({ missedFramesThisTick: 0 });
        return;
      }
      const activeSourceCount = this.resolveActiveSourceCount();
      const targetPlayoutMs =
        this.lastPostedTargetPlayoutMs ??
        computeStaticPlayoutTargetMsForTuning(tuning);
      const lastPushAgeMs =
        this.lastPushAtPerfMs === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, tickStartedAt - this.lastPushAtPerfMs);
      const bufferedFrames = jb.getBufferedFrames();
      jb.setSteadyPrimedHoldFrames(
        computeN1SteadyPrimedHoldFrames({
          activeSourceCount,
          adaptiveNetworkMode: this.lastJitterAdaptiveMode ?? 'low-latency',
          hasObservedPlayoutStart: this.hasObservedPlayoutStart,
          hasReadyFrame: jb.hasReadyFrame(),
          bufferedFrames,
          lastPushAgeMs,
          targetPlayoutMs,
        })
      );
      let hasReadyFrame = jb.hasReadyFrame();
      if (!hasReadyFrame) {
        const readyStallForcePrime = decideReadyStallForcePrime({
          hasObservedPlayoutStart: this.hasObservedPlayoutStart,
          activeSourceCount,
          hasReadyFrame,
          bufferedFrames,
          stallSinceMs: this.startupReadyStallSinceMs,
          nowMs: tickStartedAt,
          lastPushAgeMs,
          targetPlayoutMs,
        });
        this.startupReadyStallSinceMs = readyStallForcePrime.nextStallSinceMs;
        if (readyStallForcePrime.shouldForcePrime) {
          const preserveBurstRecoveryHold =
            this.jitterBurstHeadroomState.level > 0;
          jb.forcePrimeForRecoveryEscape(
            GCALL_READY_STALL_FORCE_PRIMED_HOLD_MS,
            { clearBurstRecoveryHold: !preserveBurstRecoveryHold }
          );
          hasReadyFrame = jb.hasReadyFrame();
        }
      } else {
        this.startupReadyStallSinceMs = null;
      }
      if (!hasReadyFrame) {
        missedFramesThisTick = 0;
      } else {
        if (this.wasmFecActive && this.fecPipeline && this.opusFecWorker) {
          this.fecPipeline.clearPostedThisTick();
          this.fecPipeline.prefetchDeferredForAllSources([this.peerAddress]);
        }
        missedFramesThisTick = this.drainOneFrame();
      }
      const tickFinishedAt = performance.now();
      if (
        tickFinishedAt - this.lastDrainMetricSampleAtMs >=
        (OPUS_FRAME_SAMPLES / OPUS_SAMPLE_RATE) * 1000
      ) {
        this.lastDrainMetricSampleAtMs = tickFinishedAt;
        this.callbacks?.metricsRef?.current?.recordJitterTickDuration(
          tickFinishedAt - tickStartedAt
        );
        if (!this.pcmRing) {
          this.callbacks?.metricsRef?.current?.recordJitterDrainTelemetry({
            sourceCount: 1,
            depthSum: bufferedFrames,
            worstDepth: bufferedFrames,
            notReadyCount: hasReadyFrame ? 0 : 1,
            rawEmptyCount: bufferedFrames === 0 ? 1 : 0,
          });
        }
        if (!hasReadyFrame && !this.pcmRing) {
          this.callbacks?.metricsRef?.current?.recordJitterUnderrun(
            1,
            this.peerAddress
          );
        }
      }
      this.callbacks?.onJitterTickTelemetry?.({
        sourceAddr: this.peerAddress,
        durationMs: tickFinishedAt - tickStartedAt,
        bufferedFrames,
        hasReadyFrame,
        rawEmpty: bufferedFrames === 0,
      });
      this.callbacks?.afterDrain?.({ missedFramesThisTick });
    };
    const jitterSchedGain = ctx.createGain();
    jitterSchedGain.gain.value = 0.0001;
    jitterSched.connect(jitterSchedGain);
    jitterSchedGain.connect(ctx.destination);

    this.schedulerNode = jitterSched;
    this.schedulerGain = jitterSchedGain;
    this.speakerGain = speakerGain;
  }

  private resetJitterPushDiagnostics(): void {
    this.jitterPushAccepted = 0;
    this.jitterPushStale = 0;
    this.jitterPushDuplicate = 0;
    this.jitterPushTrimmedFrames = 0;
    this.jitterPushTrimEvents = 0;
    this.jitterPushDepthHighWater = 0;
    this.jitterPushDepthHighWaterSinceLastHeadroomStep = 0;
    this.jitterLastTrimmedFrames = 0;
    this.jitterLastTrimAtMs = 0;
    this.jitterTrimmedFramesAtLastHeadroomStep = 0;
    this.jitterBurstHeadroomState = createGcallJitterBurstHeadroomState();
    this.lastJitterBurstHeadroomReason = null;
  }

  private syncJitterGeometryFromMetrics(stepHeadroom = true): void {
    const jb = this.jitter;
    const tuning = this.tuning;
    const m = this.callbacks?.metricsRef?.current;
    if (!jb || !tuning || !m) return;
    const mode = m.getSnapshot().adaptiveNetworkMode;
    const activeSourceCount = this.resolveActiveSourceCount();
    const snapshot = m.getSnapshot();
    if (stepHeadroom) {
      const trimCount =
        this.jitterPushTrimmedFrames -
        this.jitterTrimmedFramesAtLastHeadroomStep;
      this.jitterTrimmedFramesAtLastHeadroomStep =
        this.jitterPushTrimmedFrames;
      const depthHighWater =
        this.jitterPushDepthHighWaterSinceLastHeadroomStep;
      this.jitterPushDepthHighWaterSinceLastHeadroomStep =
        jb.getBufferedFrames();
      const stepped = stepGcallJitterBurstHeadroom({
        state: this.jitterBurstHeadroomState,
        enabled: mode === 'recovery',
        nowMs: Date.now(),
        trimCount,
        depthHighWater,
        maxDepthFrames: jb.getMaxEntries(),
        playoutUnderTargetFraction: snapshot.playoutUnderTargetFraction,
        avgPlayoutRate: snapshot.avgPlayoutRate,
      });
      this.jitterBurstHeadroomState = stepped.state;
      if (stepped.reason) this.lastJitterBurstHeadroomReason = stepped.reason;
    }
    if (
      this.lastJitterAdaptiveMode === mode &&
      this.lastJitterActiveSourceCount === activeSourceCount &&
      !stepHeadroom
    ) {
      return;
    }
    this.lastJitterAdaptiveMode = mode;
    this.lastJitterActiveSourceCount = activeSourceCount;
    const base =
      mode === 'recovery'
        ? getEffectiveJitterTuning(tuning, 'recovery', {
            tier2MultiSource: true,
            activeSourceCount,
          })
        : getEffectiveJitterTuning(tuning, 'low-latency');
    const eff = applyGcallJitterBurstHeadroom(
      base,
      this.jitterBurstHeadroomState.level
    );
    jb.applyJitterTuning(eff);
    jb.setSoftUnprimeMs(
      computeSoftUnprimeMsForTier2(
        activeSourceCount,
        mode === 'recovery' && activeSourceCount >= 2
      )
    );
    jb.setSteadyPrimedHoldFrames(mode !== 'recovery' ? 1 : 0);
  }

  private drainOneFrame(): number {
    if (this.wasmFecActive) {
      return this.drainOneWasmFrame();
    } else {
      return this.drainOneWebCodecsFrame();
    }
  }

  private drainOneWasmFrame(): number {
    const jb = this.jitter;
    const w = this.opusFecWorker;
    const pipeline = this.fecPipeline;
    const tuning = this.tuning;
    if (!jb || !w || !pipeline || !tuning) return 0;
    if (!jb.hasReadyFrame()) return 0;
    const frame = jb.pop();
    if (!frame) return 0;
    const missedInc = jb.consumePendingMissedFrames();
    const ingressAtMs = jb.consumeLastPoppedReceivedAtMs();
    const playedSeq = jb.getLastPlayedSeq();
    if (playedSeq >= 0) {
      this.callbacks?.onPlayedSeqAdvanced?.({
        sourceAddr: this.peerAddress,
        playedSeq,
      });
    }
    const rawGap = jb.consumeLastRawGapAfterPop();
    if (rawGap > tuning.wasmFecMaxGapReset) {
      w.postMessage({ type: 'reset', sourceAddr: this.peerAddress });
    }
    const gapForWorker = Math.min(rawGap, 48);
    const packetCopy = new Uint8Array(frame.byteLength);
    packetCopy.set(frame);
    pipeline.enqueueDecode(
      w,
      this.peerAddress,
      packetCopy,
      gapForWorker,
      ingressAtMs
    );
    return missedInc;
  }

  private drainOneWebCodecsFrame(): number {
    const jb = this.jitter;
    const decoder = this.decoder;
    if (!jb || !decoder || decoder.state === 'closed') return 0;
    if (!jb.hasReadyFrame()) return 0;
    const frame = jb.pop();
    if (!frame) return 0;
    const missedInc = jb.consumePendingMissedFrames();
    const ingressAtMs = jb.consumeLastPoppedReceivedAtMs();
    const playedSeq = jb.getLastPlayedSeq();
    if (playedSeq >= 0) {
      this.callbacks?.onPlayedSeqAdvanced?.({
        sourceAddr: this.peerAddress,
        playedSeq,
      });
    }
    try {
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: frame,
      });
      this.pendingDecodedIngressAtMs.push(ingressAtMs);
      decoder.decode(chunk);
    } catch {
      /* ignore */
    }
    return missedInc;
  }

  pushDecoded(packets: DecodedAudioPacket[]): void {
    const jb = this.jitter;
    if (!jb) return;
    let pushedAny = false;
    for (const p of packets) {
      if (p.opusFrame?.length) {
        const result = jb.push(p.seq, p.opusFrame);
        if (result.status === 'accepted') {
          this.jitterPushAccepted++;
          pushedAny = true;
        } else if (result.status === 'stale') {
          this.jitterPushStale++;
        } else {
          this.jitterPushDuplicate++;
        }
        this.jitterPushDepthHighWater = Math.max(
          this.jitterPushDepthHighWater,
          result.depth
        );
        this.jitterPushDepthHighWaterSinceLastHeadroomStep = Math.max(
          this.jitterPushDepthHighWaterSinceLastHeadroomStep,
          result.depth
        );
        if (result.trimmed > 0) {
          this.jitterPushTrimmedFrames += result.trimmed;
          this.jitterPushTrimEvents++;
          this.jitterLastTrimmedFrames = result.trimmed;
          this.jitterLastTrimAtMs = Date.now();
        }
      }
    }
    if (pushedAny) this.lastPushAtPerfMs = performance.now();
  }

  async stop(): Promise<void> {
    const dec = this.decoder;
    const playNode = this.playbackNode;
    const spGain = this.speakerGain;
    const sched = this.schedulerNode;
    const schedGain = this.schedulerGain;
    const pcmRing = this.pcmRing;
    const w = this.opusFecWorker;

    this.decoder = null;
    this.playbackNode = null;
    this.speakerGain = null;
    this.schedulerNode = null;
    this.schedulerGain = null;
    this.pcmRing = null;
    this.jitter = null;
    this.tuning = null;
    this.fecPipeline = null;
    this.opusFecWorker = null;
    this.wasmFecActive = false;
    this.peerAddress = '';
    this.callbacks = null;
    this.lastJitterAdaptiveMode = null;
    this.lastPostedTargetPlayoutMs = null;
    this.pendingDecodedIngressAtMs = [];
    this.lastDrainMetricSampleAtMs = 0;
    this.startupReadyStallSinceMs = null;
    this.hasObservedPlayoutStart = false;
    this.lastPushAtPerfMs = null;
    this.resetJitterPushDiagnostics();

    pcmRing?.reset();
    disconnectSafe(playNode);
    disconnectSafe(spGain);
    disconnectSafe(sched);
    disconnectSafe(schedGain);
    if (w) {
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    if (dec && dec.state !== 'closed') {
      try {
        dec.close();
      } catch {
        /* ignore */
      }
    }
  }
}
