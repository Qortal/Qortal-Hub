/**
 * DM Reticulum voice inbound: same path as group — jitter buffer → (WASM Opus FEC **or**
 * WebCodecs) → `group-playout-processor`, driven by `gcall-jitter-scheduler` ticks.
 */

import type { DecodedAudioPacket } from '../group-call/audioPacketCodec';
import { postStaticPlayoutTargetForTuning } from '../group-call/gcallInboundPlayoutTarget';
import { JitterBuffer } from '../group-call/gcallJitterBuffer';
import { createGcallJitterBufferForIngress } from '../group-call/gcallInboundJitterSetup';
import {
  GcallOpusFecPlayoutPipeline,
} from '../group-call/gcallOpusFecPlayoutPipeline';
import { GCALL_GLOBAL_PLAYOUT_CAP_MS } from '../group-call/gcallPlayoutPolicy';
import { configureWebCodecsOpusDecoderForGcall } from '../group-call/configureWebCodecsOpusDecoderForGcall';
import {
  computeSoftUnprimeMsForTier2,
  getEffectiveJitterTuning,
  getGroupCallAudioTuning,
  readGroupCallAudioProfile,
  type GroupCallAudioTuning,
} from '../group-call/groupCallAudioProfile';
import type { GroupCallPerformanceTracker } from '../group-call/router';
import {
  GCALL_WASM_FEC_EXTRA_HOLD_FRAMES,
  readGcallWasmFecDesired,
} from '../group-call/gcallWasmFecEnv';
import { OPUS_CHANNELS, OPUS_SAMPLE_RATE } from '../group-call/gcallVoiceAudioConstants';
import OpusFecWorker from '../../workers/gcall-opus-fec.worker?worker';

export interface DmVoiceGcallPlayoutWorkletMessage {
  type?: string;
  bufferedMs?: number;
  targetPlayoutMs?: number;
  rate?: number;
  outsideBand?: boolean;
  outsideBandUnder?: boolean;
  outsideBandOver?: boolean;
  deltaMs?: number;
  concealmentUsed?: boolean;
  playoutStarted?: boolean;
  panicZoneEntered?: boolean;
}

export interface DmVoiceGcallInboundOptions {
  /** Same tracker as group voice for playout metrics + adaptive mode. */
  metricsRef?: { current: GroupCallPerformanceTracker | null };
  /** After each jitter drain tick (aligned with group `runJitterDrainTick` tail). */
  afterDrain?: (info: { missedFramesThisTick: number }) => void;
  /** `gcallPlayoutMetrics` from `group-playout-processor`. */
  onPlayoutWorkletMessage?: (d: DmVoiceGcallPlayoutWorkletMessage) => void;
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

  getPlaybackWorkletNode(): AudioWorkletNode | null {
    return this.playbackNode;
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
    this.peerAddress = peerAddress;
    const tuning = getGroupCallAudioTuning(readGroupCallAudioProfile());
    this.tuning = tuning;

    const fecDesired = readGcallWasmFecDesired();
    this.jitter = createGcallJitterBufferForIngress({
      tuning,
      adaptiveNetworkMode: 'low-latency',
      extraHoldFrames: fecDesired ? GCALL_WASM_FEC_EXTRA_HOLD_FRAMES : 0,
      activeSourceCount: 1,
      tier2MultiSource: false,
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

    const playNode = new AudioWorkletNode(ctx, 'group-playout-processor', {
      processorOptions: {
        sourceAddr: peerAddress,
        maxPlayoutTargetMs: GCALL_GLOBAL_PLAYOUT_CAP_MS,
      },
    } as AudioWorkletNodeOptions);

    postStaticPlayoutTargetForTuning(playNode, tuning);

    playNode.port.onmessage = (e: MessageEvent) => {
      const d = e.data as DmVoiceGcallPlayoutWorkletMessage;
      if (d?.type !== 'gcallPlayoutMetrics') return;
      this.callbacks?.onPlayoutWorkletMessage?.(d);
    };

    const speakerGain = ctx.createGain();
    speakerGain.gain.value = 1;
    playNode.connect(speakerGain);
    speakerGain.connect(connectTo);

    this.playbackNode = playNode;

    if (fecDesired) {
      this.fecPipeline = new GcallOpusFecPlayoutPipeline((addr) =>
        addr === this.peerAddress ? this.playbackNode ?? undefined : undefined
      );
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
          if (d.sourceAddr && this.fecPipeline && this.opusFecWorker) {
            this.fecPipeline.completeInflight(d.sourceAddr);
            this.fecPipeline.pump(this.opusFecWorker, d.sourceAddr);
          }
          return;
        }
        if (d.type !== 'decoded' || !this.fecPipeline || !this.opusFecWorker) return;
        this.fecPipeline.completeInflight(d.sourceAddr);
        this.fecPipeline.postBatch(
          d.sourceAddr,
          d.pcm,
          d.frameCount,
          d.stats,
          false
        );
        this.fecPipeline.pump(this.opusFecWorker, d.sourceAddr);
      };
      w.onerror = (err) => {
        console.error('[DM voice] opus-fec worker error', err);
        this.wasmFecActive = false;
      };
      this.opusFecWorker = w;
      this.wasmFecActive = true;
    } else {
      const AudioDecoderCtor = globalThis.AudioDecoder;
      if (!AudioDecoderCtor) {
        throw new Error('AudioDecoder unavailable');
      }
      const decoder = new AudioDecoderCtor({
        output: (audioData: AudioData) => {
          const pcm = new Float32Array(audioData.numberOfFrames);
          audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
          audioData.close();
          const node = this.playbackNode;
          if (node) {
            node.port.postMessage({ pcm }, [pcm.buffer]);
          }
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
      this.wasmFecActive = false;
    }

    const jitterSched = new AudioWorkletNode(ctx, 'gcall-jitter-scheduler');
    jitterSched.port.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type !== 'tick') return;
      this.syncJitterGeometryFromMetrics();
      const jb = this.jitter;
      let missedFramesThisTick = 0;
      if (!jb) {
        this.callbacks?.afterDrain?.({ missedFramesThisTick: 0 });
        return;
      }
      if (!jb.hasReadyFrame()) {
        missedFramesThisTick = 1;
      } else {
        if (this.wasmFecActive && this.fecPipeline && this.opusFecWorker) {
          this.fecPipeline.clearPostedThisTick();
          this.fecPipeline.prefetchDeferredForAllSources([this.peerAddress]);
        }
        this.drainOneFrame();
      }
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

  private syncJitterGeometryFromMetrics(): void {
    const jb = this.jitter;
    const tuning = this.tuning;
    const m = this.callbacks?.metricsRef?.current;
    if (!jb || !tuning || !m) return;
    const mode = m.getSnapshot().adaptiveNetworkMode;
    if (this.lastJitterAdaptiveMode === mode) return;
    this.lastJitterAdaptiveMode = mode;
    const eff =
      mode === 'recovery'
        ? getEffectiveJitterTuning(tuning, 'recovery', {
            tier2MultiSource: false,
            activeSourceCount: 1,
          })
        : getEffectiveJitterTuning(tuning, 'low-latency');
    jb.applyJitterTuning(eff);
    jb.setSoftUnprimeMs(computeSoftUnprimeMsForTier2(1, mode === 'recovery'));
    jb.setSteadyPrimedHoldFrames(mode !== 'recovery' ? 1 : 0);
  }

  private drainOneFrame(): void {
    if (this.wasmFecActive) {
      this.drainOneWasmFrame();
    } else {
      this.drainOneWebCodecsFrame();
    }
  }

  private drainOneWasmFrame(): void {
    const jb = this.jitter;
    const w = this.opusFecWorker;
    const pipeline = this.fecPipeline;
    const tuning = this.tuning;
    if (!jb || !w || !pipeline || !tuning) return;
    if (!jb.hasReadyFrame()) return;
    const frame = jb.pop();
    if (!frame) return;
    const rawGap = jb.consumeLastRawGapAfterPop();
    if (rawGap > tuning.wasmFecMaxGapReset) {
      w.postMessage({ type: 'reset', sourceAddr: this.peerAddress });
    }
    const gapForWorker = Math.min(rawGap, 48);
    const packetCopy = new Uint8Array(frame.byteLength);
    packetCopy.set(frame);
    pipeline.enqueueDecode(w, this.peerAddress, packetCopy, gapForWorker);
  }

  private drainOneWebCodecsFrame(): void {
    const jb = this.jitter;
    const decoder = this.decoder;
    if (!jb || !decoder || decoder.state === 'closed') return;
    if (!jb.hasReadyFrame()) return;
    const frame = jb.pop();
    if (!frame) return;
    try {
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: frame,
      });
      decoder.decode(chunk);
    } catch {
      /* ignore */
    }
  }

  pushDecoded(packets: DecodedAudioPacket[]): void {
    const jb = this.jitter;
    if (!jb) return;
    for (const p of packets) {
      if (p.opusFrame?.length) jb.push(p.seq, p.opusFrame);
    }
  }

  async stop(): Promise<void> {
    const dec = this.decoder;
    const playNode = this.playbackNode;
    const spGain = this.speakerGain;
    const sched = this.schedulerNode;
    const schedGain = this.schedulerGain;
    const w = this.opusFecWorker;

    this.decoder = null;
    this.playbackNode = null;
    this.speakerGain = null;
    this.schedulerNode = null;
    this.schedulerGain = null;
    this.jitter = null;
    this.tuning = null;
    this.fecPipeline = null;
    this.opusFecWorker = null;
    this.wasmFecActive = false;
    this.peerAddress = '';
    this.callbacks = null;
    this.lastJitterAdaptiveMode = null;

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
