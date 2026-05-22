import {
  applyCallAudioOutput,
  getUserAudioStreamForCall,
} from '../call/audioDevices';
import {
  getGroupCallAudioTuning,
  type GroupCallAudioTuning,
  type GroupCallAudioQualityProfile,
} from './groupCallAudioProfile';
import {
  OPUS_CHANNELS,
  OPUS_FRAME_DURATION_MS,
  OPUS_FRAME_SAMPLES,
  OPUS_SAMPLE_RATE,
} from './gcallSharedVoiceProcessing';
import GcallAudioEncodeWorker from '../../workers/gcall-audio-encode.worker?worker';

function float32ToInt16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(frame[i]! * 32767)));
  }
  return out;
}

function closeAudioContextSafe(ctx: AudioContext | null): void {
  if (!ctx) return;
  void ctx.close().catch(() => {});
}

function disconnectNodeSafe(node: AudioNode | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}

function stopStreamSafe(stream: MediaStream | null): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

const GCALL_SENDER_MAX_ENCODER_QUEUE_SIZE = 4;
const GCALL_SENDER_MAX_REALTIME_FRAME_AGE_MS = 180;
const GCALL_SENDER_ENCODE_TIMING_CACHE_MAX = 256;
const GCALL_SENDER_ENCODER_RESET_QUEUE_PINNED_MS = 500;
const GCALL_SENDER_ENCODER_RESET_STALE_DROPS = 8;
const GCALL_SENDER_ENCODER_RESET_STALE_WINDOW_MS = 2_000;
const GCALL_SENDER_ENCODER_RESET_MAX_OUTPUT_AGE_MS = 400;
const GCALL_SENDER_ENCODER_RESET_COOLDOWN_MS = 7_500;
const GCALL_SENDER_CPU_DEGRADED_OPUS_BITRATE = 16_000;
const GCALL_SENDER_ENCODE_WORKER_PROBE_TIMEOUT_MS = 2_500;
const GCALL_SENDER_SHARED_FRAME_SLOTS = 8;
const GCALL_SENDER_TIMING_DELAY_LOG_THRESHOLD_MS = 80;
const GCALL_SENDER_TIMING_GAP_LOG_THRESHOLD_MS = 320;
const GCALL_SENDER_TIMING_LOG_THROTTLE_MS = 2_000;

async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  const resumable = ctx as AudioContext & { resume?: () => Promise<void> };
  if (ctx.state === 'running' || typeof resumable.resume !== 'function') return;
  await resumable.resume();
}

export interface GroupCallAudioSenderFrame {
  opusFrame: Uint8Array;
  vad: boolean;
  capturePerfMs: number;
  encoderInputPerfMs: number;
  encodeOutPerfMs: number;
}

type CaptureWorkletMessage = {
  frame?: Float32Array;
  vad?: boolean;
  workletPostAudioClockMs?: number;
  inputSampleRate?: number;
  outputSampleRate?: number;
  inputFrameSamples?: number;
};

type EncodeWorkerProbeState =
  | 'not-started'
  | 'probing'
  | 'supported'
  | 'unsupported'
  | 'failed';

type EncodeWorkerProbeDetail = {
  audioEncoderDefined?: boolean;
  audioDataDefined?: boolean;
  configSupported?: boolean | null;
  supportError?: string | null;
  message?: string;
  lastStage?: string | null;
  stages?: EncodeWorkerProbeStage[];
};

type EncodeWorkerProbeStage = {
  stage: string;
  atMs: number;
  detail?: Record<string, unknown>;
};

type SenderEncodeMode = 'main-thread' | 'worker-relay' | 'worker-direct';

type EncodeWorkerStats = {
  encodedFrameCount?: number;
  droppedEncoderBackpressureFrames?: number;
  droppedStaleEncodedFrames?: number;
  encoderResetCount?: number;
  lastEncoderResetAtMs?: number;
  lastEncoderResetReason?: string | null;
  encoderPressureActiveMs?: number;
  staleEncodedDropsInWindow?: number;
  encoderQueueSize?: number | null;
  lastEncoderInputPerfMs?: number;
  capturedFrameCount?: number;
  lastCapturePerfMs?: number;
  captureInputSampleRate?: number | null;
  captureOutputSampleRate?: number | null;
  captureInputFrameSamples?: number | null;
  sharedRingEnabled?: boolean;
  sharedRingSlotCount?: number;
  sharedRingFallbackTransfers?: number;
  encoderErrorCount?: number;
  lastEncoderError?: string | null;
};

export interface GroupCallAudioSenderEngineConfig {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  muted: boolean;
  profile: GroupCallAudioQualityProfile;
  cpuDegraded?: boolean;
  onEncodedFrame: (frame: GroupCallAudioSenderFrame) => void;
  onVadChanged?: (vad: boolean) => void;
  onTimingAnomaly?: (stage: string, detail: Record<string, unknown>) => void;
}

function getSenderAudioTuning(
  profile: GroupCallAudioQualityProfile,
  cpuDegraded: boolean
): GroupCallAudioTuning {
  const base = getGroupCallAudioTuning(profile);
  if (!cpuDegraded) return base;
  return {
    ...base,
    opusBitrate: Math.min(
      base.opusBitrate,
      GCALL_SENDER_CPU_DEGRADED_OPUS_BITRATE
    ),
  };
}

export class GroupCallAudioSenderEngine {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private keepAliveGain: GainNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private encoder: AudioEncoder | null = null;
  private encodeWorker: Worker | null = null;
  private encodeWorkerGeneration = 0;
  private encodeWorkerConfiguredGeneration = 0;
  private senderEncodeMode: SenderEncodeMode = 'main-thread';
  private encoderGeneration = 0;
  private startToken = 0;
  private lifecycleChain: Promise<void> = Promise.resolve();
  private activeConfig: Omit<
    GroupCallAudioSenderEngineConfig,
    'onEncodedFrame' | 'onVadChanged'
  > | null = null;
  private onEncodedFrame: ((frame: GroupCallAudioSenderFrame) => void) | null =
    null;
  private onVadChanged: ((vad: boolean) => void) | null = null;
  private onTimingAnomaly:
    | ((stage: string, detail: Record<string, unknown>) => void)
    | null = null;
  private lastReportedVad = false;
  private lastCapturePerfMs = 0;
  private lastWorkletPostAudioClockMs = 0;
  private lastEncoderInputPerfMs = 0;
  private capturedFrameCount = 0;
  private encodedFrameCount = 0;
  private droppedEncoderBackpressureFrames = 0;
  private droppedStaleEncodedFrames = 0;
  private encoderResetCount = 0;
  private lastEncoderResetAtMs = 0;
  private lastEncoderResetReason: string | null = null;
  private lastEncoderResetPerfMs = -Infinity;
  private encoderQueuePressureStartedPerfMs: number | null = null;
  private encoderPressureActiveMs = 0;
  private readonly staleEncodedDropPerfMs: number[] = [];
  private encoderErrorCount = 0;
  private lastEncoderError: string | null = null;
  private encodeWorkerProbeState: EncodeWorkerProbeState = 'not-started';
  private encodeWorkerProbeDetail: EncodeWorkerProbeDetail | null = null;
  private encodeWorkerProbeStartedAtMs = 0;
  private encodeWorkerProbeCompletedAtMs = 0;
  private encodeWorkerProbeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly encodeWorkerProbeStages: EncodeWorkerProbeStage[] = [];
  private encodeWorkerStats: EncodeWorkerStats | null = null;
  private encodeWorkerFallbackReason: string | null = null;
  private encodeWorkerSharedSamples: SharedArrayBuffer | null = null;
  private encodeWorkerSharedState: SharedArrayBuffer | null = null;
  private opusBitrateOverride: number | null = null;
  private lastStartAtMs = 0;
  private lastStopAtMs = 0;
  private unsupportedReason: string | null = null;
  private audioContextSampleRate: number | null = null;
  private captureInputSampleRate: number | null = null;
  private captureOutputSampleRate: number | null = null;
  private captureInputFrameSamples: number | null = null;
  private encodeTimingByTimestampUs = new Map<
    number,
    { capturePerfMs: number; encoderInputPerfMs: number; vad: boolean }
  >();
  private readonly timingAnomalyLastByStage = new Map<string, number>();

  private enqueueLifecycleOperation(
    operation: () => Promise<void>
  ): Promise<void> {
    const run = this.lifecycleChain.then(operation, operation);
    this.lifecycleChain = run.catch(() => {});
    return run;
  }

  private resetDiagnosticsCounters(): void {
    this.lastCapturePerfMs = 0;
    this.lastWorkletPostAudioClockMs = 0;
    this.lastEncoderInputPerfMs = 0;
    this.capturedFrameCount = 0;
    this.encodedFrameCount = 0;
    this.droppedEncoderBackpressureFrames = 0;
    this.droppedStaleEncodedFrames = 0;
    this.encoderResetCount = 0;
    this.lastEncoderResetAtMs = 0;
    this.lastEncoderResetReason = null;
    this.lastEncoderResetPerfMs = -Infinity;
    this.encoderQueuePressureStartedPerfMs = null;
    this.encoderPressureActiveMs = 0;
    this.staleEncodedDropPerfMs.length = 0;
    this.encoderErrorCount = 0;
    this.lastEncoderError = null;
    this.encodeWorkerProbeState = 'not-started';
    this.encodeWorkerProbeDetail = null;
    this.encodeWorkerProbeStartedAtMs = 0;
    this.encodeWorkerProbeCompletedAtMs = 0;
    this.encodeWorkerProbeStages.length = 0;
    if (this.encodeWorkerProbeTimeout !== null) {
      clearTimeout(this.encodeWorkerProbeTimeout);
      this.encodeWorkerProbeTimeout = null;
    }
    this.encodeWorkerStats = null;
    this.encodeWorkerFallbackReason = null;
    this.encodeWorkerSharedSamples = null;
    this.encodeWorkerSharedState = null;
    this.opusBitrateOverride = null;
    this.senderEncodeMode = 'main-thread';
    this.audioContextSampleRate = null;
    this.captureInputSampleRate = null;
    this.captureOutputSampleRate = null;
    this.captureInputFrameSamples = null;
    this.encodeTimingByTimestampUs.clear();
    this.timingAnomalyLastByStage.clear();
  }

  private recordTimingAnomaly(
    stage: string,
    detail: Record<string, unknown>
  ): void {
    const now = Date.now();
    const last = this.timingAnomalyLastByStage.get(stage) ?? 0;
    if (now - last < GCALL_SENDER_TIMING_LOG_THROTTLE_MS) return;
    this.timingAnomalyLastByStage.set(stage, now);
    this.onTimingAnomaly?.(stage, detail);
  }

  async startOrUpdate(config: GroupCallAudioSenderEngineConfig): Promise<void> {
    await this.enqueueLifecycleOperation(() =>
      this.startOrUpdateLocked(config)
    );
  }

  private async startOrUpdateLocked(
    config: GroupCallAudioSenderEngineConfig
  ): Promise<void> {
    const nextShape = {
      inputDeviceId: config.inputDeviceId ?? null,
      outputDeviceId: config.outputDeviceId ?? null,
      muted: config.muted === true,
      profile: config.profile,
      cpuDegraded: config.cpuDegraded === true,
    };
    const currentShape = this.activeConfig;
    const sameAudioShape =
      currentShape &&
      currentShape.inputDeviceId === nextShape.inputDeviceId &&
      currentShape.outputDeviceId === nextShape.outputDeviceId &&
      currentShape.muted === nextShape.muted &&
      currentShape.profile === nextShape.profile;
    const cpuModeChanged =
      sameAudioShape && currentShape.cpuDegraded !== nextShape.cpuDegraded;
    if (
      sameAudioShape &&
      this.audioContext &&
      this.captureNode &&
      (this.encoder || this.encodeWorker)
    ) {
      this.activeConfig = nextShape;
      this.onEncodedFrame = config.onEncodedFrame;
      this.onVadChanged = config.onVadChanged ?? null;
      this.onTimingAnomaly = config.onTimingAnomaly ?? null;
      await ensureAudioContextRunning(this.audioContext);
      this.captureNode.port.postMessage({
        type: 'mute',
        muted: nextShape.muted,
      });
      if (nextShape.muted) this.updateVad(false);
      if (cpuModeChanged) {
        if (this.senderEncodeMode === 'worker-relay' && this.encodeWorker) {
          this.configureEncodeWorkerForActiveConfig('cpu-mode-change');
        } else {
          this.replaceEncoderForActiveConfig('cpu-mode-change', {
            respectCooldown: false,
          });
        }
      }
      return;
    }
    await this.stopLocked();
    if (
      typeof AudioContext === 'undefined' ||
      typeof AudioWorkletNode === 'undefined' ||
      typeof AudioEncoder === 'undefined' ||
      typeof AudioData === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.activeConfig = nextShape;
      this.unsupportedReason = 'missing-audio-capture-or-webcodecs-api';
      return;
    }
    this.activeConfig = nextShape;
    this.unsupportedReason = null;
    this.onEncodedFrame = config.onEncodedFrame;
    this.onVadChanged = config.onVadChanged ?? null;
    this.onTimingAnomaly = config.onTimingAnomaly ?? null;
    this.resetDiagnosticsCounters();
    this.lastStartAtMs = Date.now();
    const token = ++this.startToken;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let keepAliveGain: GainNode | null = null;
    let captureNode: AudioWorkletNode | null = null;
    let encoder: AudioEncoder | null = null;
    let committed = false;
    try {
      const gum = await getUserAudioStreamForCall(nextShape.inputDeviceId);
      stream = gum.stream;
      if (!stream || token !== this.startToken) return;

      ctx = new AudioContext({ sampleRate: OPUS_SAMPLE_RATE });
      source = ctx.createMediaStreamSource(stream);
      keepAliveGain = ctx.createGain();
      keepAliveGain.gain.value = 0.0001;
      await ctx.audioWorklet.addModule('/worklets/capture-processor.js');
      if (token !== this.startToken) return;

      captureNode = new AudioWorkletNode(ctx, 'capture-processor');
      captureNode.port.postMessage({ type: 'mute', muted: nextShape.muted });
      const tuning = getSenderAudioTuning(
        nextShape.profile,
        nextShape.cpuDegraded
      );
      encoder = this.createEncoder(tuning);
      const captureToken = token;
      captureNode.port.onmessage = (event) => {
        if (captureToken !== this.startToken) {
          return;
        }
        const capturedAtPerfMs = performance.now();
        const {
          frame,
          vad,
          workletPostAudioClockMs,
          inputSampleRate,
          outputSampleRate,
          inputFrameSamples,
        } = event.data as CaptureWorkletMessage;
        this.noteCaptureMetadata(
          inputSampleRate,
          outputSampleRate,
          inputFrameSamples
        );
        if (!(frame instanceof Float32Array)) {
          return;
        }
        this.capturedFrameCount++;
        this.lastCapturePerfMs = capturedAtPerfMs;
        if (
          typeof workletPostAudioClockMs === 'number' &&
          Number.isFinite(workletPostAudioClockMs)
        ) {
          if (this.lastWorkletPostAudioClockMs > 0) {
            const workletFrameGapMs = Math.max(
              0,
              workletPostAudioClockMs - this.lastWorkletPostAudioClockMs
            );
            if (workletFrameGapMs >= GCALL_SENDER_TIMING_GAP_LOG_THRESHOLD_MS) {
              this.recordTimingAnomaly('gcall-audio-worklet-frame-gap', {
                gap_ms: Math.round(workletFrameGapMs),
                mode: this.senderEncodeMode,
                capturedFrameCount: this.capturedFrameCount,
              });
            }
          }
          this.lastWorkletPostAudioClockMs = workletPostAudioClockMs;
          const workletToRendererMainMs = Math.max(
            0,
            (this.audioContext?.currentTime ?? 0) * 1000 -
              workletPostAudioClockMs
          );
          if (
            workletToRendererMainMs >=
            GCALL_SENDER_TIMING_DELAY_LOG_THRESHOLD_MS
          ) {
            this.recordTimingAnomaly(
              'gcall-audio-worklet-to-renderer-main-delay',
              {
                delay_ms: Math.round(workletToRendererMainMs),
                mode: this.senderEncodeMode,
                capturedFrameCount: this.capturedFrameCount,
              }
            );
          }
        }
        this.lastVad = typeof vad === 'boolean' ? vad : false;
        this.updateVad(this.lastVad);
        if (this.senderEncodeMode === 'worker-relay' && this.encodeWorker) {
          this.postFrameToEncodeWorker(frame, this.lastVad, capturedAtPerfMs);
          return;
        }
        const activeEncoder = this.encoder;
        if (!activeEncoder || activeEncoder.state === 'closed') {
          return;
        }
        const queueSize =
          typeof activeEncoder.encodeQueueSize === 'number'
            ? activeEncoder.encodeQueueSize
            : 0;
        if (queueSize >= GCALL_SENDER_MAX_ENCODER_QUEUE_SIZE) {
          this.droppedEncoderBackpressureFrames++;
          if (this.encoderQueuePressureStartedPerfMs === null) {
            this.encoderQueuePressureStartedPerfMs = capturedAtPerfMs;
          }
          this.encoderPressureActiveMs =
            capturedAtPerfMs - this.encoderQueuePressureStartedPerfMs;
          if (
            this.encoderPressureActiveMs >=
            GCALL_SENDER_ENCODER_RESET_QUEUE_PINNED_MS
          ) {
            this.resetEncoderIfAllowed('queue-pinned', capturedAtPerfMs);
          }
          return;
        }
        this.encoderQueuePressureStartedPerfMs = null;
        this.encoderPressureActiveMs = 0;
        this.encodeFrameOnMainThread(
          frame,
          this.lastVad,
          capturedAtPerfMs,
          activeEncoder
        );
      };
      source.connect(captureNode);
      captureNode.connect(keepAliveGain);
      keepAliveGain.connect(ctx.destination);
      await applyCallAudioOutput(nextShape.outputDeviceId, {
        audioContext: ctx,
      });
      await ensureAudioContextRunning(ctx);
      if (token !== this.startToken) return;

      this.audioContext = ctx;
      this.audioContextSampleRate = ctx.sampleRate;
      this.micStream = stream;
      this.micSource = source;
      this.keepAliveGain = keepAliveGain;
      this.captureNode = captureNode;
      this.encoder = encoder;
      committed = true;
      this.startEncodeWorkerRelay(tuning);
    } finally {
      if (!committed) {
        if (captureNode) {
          captureNode.port.onmessage = null;
        }
        disconnectNodeSafe(captureNode);
        disconnectNodeSafe(keepAliveGain);
        disconnectNodeSafe(source);
        stopStreamSafe(stream);
        if (encoder) {
          try {
            encoder.close();
          } catch {
            /* ignore */
          }
        }
        closeAudioContextSafe(ctx);
      }
    }
  }

  private lastVad = false;

  private noteCaptureMetadata(
    inputSampleRate: number | undefined,
    outputSampleRate: number | undefined,
    inputFrameSamples: number | undefined
  ): void {
    if (
      typeof inputSampleRate === 'number' &&
      Number.isFinite(inputSampleRate)
    ) {
      this.captureInputSampleRate = inputSampleRate;
    }
    if (
      typeof outputSampleRate === 'number' &&
      Number.isFinite(outputSampleRate)
    ) {
      this.captureOutputSampleRate = outputSampleRate;
    }
    if (
      typeof inputFrameSamples === 'number' &&
      Number.isFinite(inputFrameSamples)
    ) {
      this.captureInputFrameSamples = inputFrameSamples;
    }
  }

  private encodeFrameOnMainThread(
    frame: Float32Array,
    vad: boolean,
    capturedAtPerfMs: number,
    activeEncoder: AudioEncoder
  ): void {
    const pcm16 = float32ToInt16(frame);
    const encoderInputPerfMs = performance.now();
    this.lastEncoderInputPerfMs = encoderInputPerfMs;
    const timestampUs = Math.trunc(encoderInputPerfMs * 1000);
    this.encodeTimingByTimestampUs.set(timestampUs, {
      capturePerfMs: capturedAtPerfMs,
      encoderInputPerfMs,
      vad,
    });
    while (
      this.encodeTimingByTimestampUs.size > GCALL_SENDER_ENCODE_TIMING_CACHE_MAX
    ) {
      const oldest = this.encodeTimingByTimestampUs.keys().next().value;
      if (typeof oldest !== 'number') break;
      this.encodeTimingByTimestampUs.delete(oldest);
    }
    const audioData = new AudioData({
      format: 's16',
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfFrames: OPUS_FRAME_SAMPLES,
      numberOfChannels: OPUS_CHANNELS,
      timestamp: timestampUs,
      data: pcm16 as unknown as BufferSource,
    });
    activeEncoder.encode(audioData);
    audioData.close();
  }

  private postFrameToEncodeWorker(
    frame: Float32Array,
    vad: boolean,
    capturedAtPerfMs: number
  ): void {
    const worker = this.encodeWorker;
    if (!worker || this.encodeWorkerConfiguredGeneration <= 0) return;
    try {
      worker.postMessage(
        {
          type: 'encodeFrame',
          generation: this.encodeWorkerConfiguredGeneration,
          frame: frame.buffer,
          byteOffset: frame.byteOffset,
          byteLength: frame.byteLength,
          vad,
          capturePerfMs: capturedAtPerfMs,
        },
        [frame.buffer]
      );
    } catch (error) {
      this.lastEncoderError =
        error instanceof Error ? error.message : String(error);
      this.encoderErrorCount++;
      this.fallbackToMainThreadEncoder('worker-post-failed');
    }
  }

  private createEncoder(tuning: GroupCallAudioTuning): AudioEncoder {
    const generation = ++this.encoderGeneration;
    const encoder = new AudioEncoder({
      output: (chunk) => {
        if (generation !== this.encoderGeneration || this.encoder !== encoder) {
          return;
        }
        const encodeOutPerfMs = performance.now();
        const chunkTimestampUs =
          typeof chunk.timestamp === 'number' ? chunk.timestamp : null;
        const timing =
          chunkTimestampUs !== null
            ? this.encodeTimingByTimestampUs.get(chunkTimestampUs)
            : undefined;
        if (chunkTimestampUs !== null) {
          this.encodeTimingByTimestampUs.delete(chunkTimestampUs);
        }
        const capturePerfMs = timing?.capturePerfMs ?? this.lastCapturePerfMs;
        const encoderInputPerfMs =
          timing?.encoderInputPerfMs ?? this.lastEncoderInputPerfMs;
        const outputAgeMs = encodeOutPerfMs - capturePerfMs;
        const encoderPipelineMs = encodeOutPerfMs - encoderInputPerfMs;
        if (encoderPipelineMs >= GCALL_SENDER_TIMING_DELAY_LOG_THRESHOLD_MS) {
          this.recordTimingAnomaly('gcall-audio-encoder-output-delay', {
            delay_ms: Math.round(encoderPipelineMs),
            mode: this.senderEncodeMode,
            queueSize:
              typeof encoder.encodeQueueSize === 'number'
                ? encoder.encodeQueueSize
                : null,
          });
        }
        if (outputAgeMs > GCALL_SENDER_MAX_REALTIME_FRAME_AGE_MS) {
          this.recordTimingAnomaly('gcall-audio-stale-encoder-output-drop', {
            age_ms: Math.round(outputAgeMs),
            mode: this.senderEncodeMode,
            droppedStaleEncodedFrames: this.droppedStaleEncodedFrames + 1,
          });
          this.droppedStaleEncodedFrames++;
          this.noteStaleEncodedDrop(encodeOutPerfMs);
          if (outputAgeMs > GCALL_SENDER_ENCODER_RESET_MAX_OUTPUT_AGE_MS) {
            this.resetEncoderIfAllowed('encoded-output-age', encodeOutPerfMs);
          } else if (
            this.staleEncodedDropPerfMs.length >=
            GCALL_SENDER_ENCODER_RESET_STALE_DROPS
          ) {
            this.resetEncoderIfAllowed('stale-output-drops', encodeOutPerfMs);
          }
          return;
        }
        const frame = new Uint8Array(chunk.byteLength);
        chunk.copyTo(frame);
        this.encodedFrameCount++;
        this.onEncodedFrame?.({
          opusFrame: frame,
          vad: timing?.vad ?? this.lastVad,
          capturePerfMs,
          encoderInputPerfMs,
          encodeOutPerfMs,
        });
      },
      error: (error) => {
        if (generation !== this.encoderGeneration) return;
        this.encoderErrorCount++;
        this.lastEncoderError =
          error instanceof Error ? error.message : String(error);
        console.error('[AudioSurface] AudioEncoder error:', error);
      },
    });
    encoder.configure(this.buildEncoderConfig(tuning));
    return encoder;
  }

  private buildEncoderConfig(tuning: GroupCallAudioTuning): AudioEncoderConfig {
    const bitrate =
      typeof this.opusBitrateOverride === 'number' &&
      Number.isFinite(this.opusBitrateOverride)
        ? Math.max(6_000, Math.round(this.opusBitrateOverride))
        : tuning.opusBitrate;
    return {
      codec: 'opus',
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
      bitrate,
      opus: {
        application: 'voip',
        signal: 'voice',
        frameDuration: OPUS_FRAME_DURATION_MS * 1000,
        packetlossperc: tuning.opusExpectedPacketLossPercent,
        useinbandfec: true,
        usedtx: false,
      },
    } as unknown as AudioEncoderConfig;
  }

  private startEncodeWorkerRelay(tuning: GroupCallAudioTuning): void {
    if (this.encodeWorkerProbeState !== 'not-started') return;
    if (typeof Worker === 'undefined') {
      this.encodeWorkerProbeState = 'unsupported';
      this.encodeWorkerProbeCompletedAtMs = Date.now();
      this.encodeWorkerProbeDetail = { message: 'worker-api-unavailable' };
      return;
    }

    this.encodeWorkerProbeState = 'probing';
    this.encodeWorkerProbeStartedAtMs = Date.now();
    const workerGeneration = ++this.encodeWorkerGeneration;
    this.noteEncodeWorkerProbeStage('main-worker-create-start', Date.now());
    const finishUnsupported = (detail: EncodeWorkerProbeDetail): void => {
      if (this.encodeWorkerProbeTimeout !== null) {
        clearTimeout(this.encodeWorkerProbeTimeout);
        this.encodeWorkerProbeTimeout = null;
      }
      this.encodeWorkerProbeState = detail.message ? 'failed' : 'unsupported';
      this.encodeWorkerProbeDetail = {
        ...detail,
        lastStage: this.latestEncodeWorkerProbeStage()?.stage ?? null,
        stages: [...this.encodeWorkerProbeStages],
      };
      this.encodeWorkerProbeCompletedAtMs = Date.now();
      this.fallbackToMainThreadEncoder('worker-unsupported');
    };

    try {
      const worker = new GcallAudioEncodeWorker();
      this.noteEncodeWorkerProbeStage('main-worker-created', Date.now());
      this.encodeWorker = worker;
      worker.onmessage = (event: MessageEvent) => {
        this.handleEncodeWorkerMessage(workerGeneration, event);
      };
      worker.onerror = (event) => {
        if (workerGeneration !== this.encodeWorkerGeneration) return;
        const errorEvent = event as ErrorEvent;
        finishUnsupported({
          message: errorEvent.message || 'encode-worker-probe-error',
        });
      };
      this.encodeWorkerProbeTimeout = setTimeout(() => {
        if (workerGeneration !== this.encodeWorkerGeneration) return;
        finishUnsupported({ message: 'encode-worker-probe-timeout' });
      }, GCALL_SENDER_ENCODE_WORKER_PROBE_TIMEOUT_MS);
      this.noteEncodeWorkerProbeStage('main-configure-post', Date.now());
      worker.postMessage({
        type: 'configure',
        generation: workerGeneration,
        encoderConfig: this.buildEncoderConfig(tuning),
      });
    } catch (error) {
      finishUnsupported({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleEncodeWorkerMessage(
    workerGeneration: number,
    event: MessageEvent
  ): void {
    if (workerGeneration !== this.encodeWorkerGeneration) return;
    const data = event.data as {
      type?: string;
      generation?: number;
      supported?: boolean;
      audioEncoderDefined?: boolean;
      audioDataDefined?: boolean;
      configSupported?: boolean | null;
      supportError?: string | null;
      opusFrame?: ArrayBuffer;
      vad?: boolean;
      capturePerfMs?: number;
      encoderInputPerfMs?: number;
      encodeOutPerfMs?: number;
      message?: string;
      stage?: string;
      atMs?: number;
      detail?: Record<string, unknown>;
      stats?: EncodeWorkerStats;
    };
    if (
      typeof data.generation === 'number' &&
      data.generation !== this.encodeWorkerConfiguredGeneration &&
      data.type !== 'configured' &&
      data.type !== 'probeStage'
    ) {
      return;
    }
    if (data.type === 'probeStage') {
      this.noteEncodeWorkerProbeStage(data.stage, data.atMs, data.detail);
      return;
    }
    if (data.type === 'timingAnomaly') {
      this.recordTimingAnomaly(data.stage ?? 'gcall-audio-worker-anomaly', {
        ...(data.detail ?? {}),
        mode: this.senderEncodeMode,
      });
      return;
    }
    if (data.type === 'configured') {
      if (this.encodeWorkerProbeTimeout !== null) {
        clearTimeout(this.encodeWorkerProbeTimeout);
        this.encodeWorkerProbeTimeout = null;
      }
      this.applyEncodeWorkerStats(data.stats);
      this.encodeWorkerProbeState =
        data.supported === true ? 'supported' : 'unsupported';
      this.encodeWorkerProbeDetail = {
        audioEncoderDefined: data.audioEncoderDefined === true,
        audioDataDefined: data.audioDataDefined === true,
        configSupported:
          typeof data.configSupported === 'boolean'
            ? data.configSupported
            : null,
        supportError: data.supportError ?? null,
        lastStage: this.latestEncodeWorkerProbeStage()?.stage ?? null,
        stages: [...this.encodeWorkerProbeStages],
      };
      this.encodeWorkerProbeCompletedAtMs = Date.now();
      if (data.supported === true && typeof data.generation === 'number') {
        this.encodeWorkerConfiguredGeneration = data.generation;
        this.senderEncodeMode = this.installDirectEncodePort(data.generation)
          ? 'worker-direct'
          : 'worker-relay';
        this.encodeWorkerFallbackReason =
          this.senderEncodeMode === 'worker-relay'
            ? 'direct-message-channel-unavailable'
            : null;
        this.closeMainThreadEncoderWithoutFlush();
      } else {
        this.fallbackToMainThreadEncoder('worker-configure-unsupported');
      }
      return;
    }
    if (data.type === 'encoded' && data.opusFrame instanceof ArrayBuffer) {
      this.applyEncodeWorkerStats(data.stats);
      this.encodedFrameCount++;
      this.lastVad = data.vad === true;
      this.onEncodedFrame?.({
        opusFrame: new Uint8Array(data.opusFrame),
        vad: data.vad === true,
        capturePerfMs: data.capturePerfMs ?? this.lastCapturePerfMs,
        encoderInputPerfMs:
          data.encoderInputPerfMs ?? this.lastEncoderInputPerfMs,
        encodeOutPerfMs: data.encodeOutPerfMs ?? performance.now(),
      });
      return;
    }
    if (data.type === 'stats') {
      this.applyEncodeWorkerStats(data.stats);
      return;
    }
    if (data.type === 'vad') {
      this.applyEncodeWorkerStats(data.stats);
      this.lastVad = data.vad === true;
      this.updateVad(this.lastVad);
      return;
    }
    if (data.type === 'error') {
      this.applyEncodeWorkerStats(data.stats);
      this.encoderErrorCount++;
      this.lastEncoderError = data.message ?? 'encode-worker-error';
      this.fallbackToMainThreadEncoder('worker-error');
    }
  }

  private noteEncodeWorkerProbeStage(
    stage: string | undefined,
    atMs?: number,
    detail?: Record<string, unknown>
  ): void {
    if (!stage) return;
    this.encodeWorkerProbeStages.push({
      stage,
      atMs:
        typeof atMs === 'number' && Number.isFinite(atMs) ? atMs : Date.now(),
      ...(detail ? { detail } : {}),
    });
    while (this.encodeWorkerProbeStages.length > 24) {
      this.encodeWorkerProbeStages.shift();
    }
  }

  private latestEncodeWorkerProbeStage(): EncodeWorkerProbeStage | null {
    return (
      this.encodeWorkerProbeStages[this.encodeWorkerProbeStages.length - 1] ??
      null
    );
  }

  private applyEncodeWorkerStats(stats: EncodeWorkerStats | undefined): void {
    if (!stats) return;
    this.encodeWorkerStats = stats;
    if (typeof stats.capturedFrameCount === 'number') {
      this.capturedFrameCount = stats.capturedFrameCount;
    }
    if (typeof stats.lastCapturePerfMs === 'number') {
      this.lastCapturePerfMs = stats.lastCapturePerfMs;
    }
    this.noteCaptureMetadata(
      stats.captureInputSampleRate ?? undefined,
      stats.captureOutputSampleRate ?? undefined,
      stats.captureInputFrameSamples ?? undefined
    );
    if (typeof stats.droppedEncoderBackpressureFrames === 'number') {
      this.droppedEncoderBackpressureFrames =
        stats.droppedEncoderBackpressureFrames;
    }
    if (typeof stats.droppedStaleEncodedFrames === 'number') {
      this.droppedStaleEncodedFrames = stats.droppedStaleEncodedFrames;
    }
    if (typeof stats.encoderResetCount === 'number') {
      this.encoderResetCount = stats.encoderResetCount;
    }
    if (typeof stats.lastEncoderResetAtMs === 'number') {
      this.lastEncoderResetAtMs = stats.lastEncoderResetAtMs;
    }
    if ('lastEncoderResetReason' in stats) {
      this.lastEncoderResetReason = stats.lastEncoderResetReason ?? null;
    }
    if (typeof stats.encoderPressureActiveMs === 'number') {
      this.encoderPressureActiveMs = stats.encoderPressureActiveMs;
    }
    if (typeof stats.lastEncoderInputPerfMs === 'number') {
      this.lastEncoderInputPerfMs = stats.lastEncoderInputPerfMs;
    }
    if (typeof stats.encoderErrorCount === 'number') {
      this.encoderErrorCount = stats.encoderErrorCount;
    }
    if ('lastEncoderError' in stats) {
      this.lastEncoderError = stats.lastEncoderError ?? null;
    }
  }

  private installDirectEncodePort(generation: number): boolean {
    const worker = this.encodeWorker;
    const captureNode = this.captureNode;
    if (!worker || !captureNode || typeof MessageChannel === 'undefined') {
      return false;
    }
    try {
      const channel = new MessageChannel();
      const sharedRing = this.createEncodeWorkerSharedRing();
      worker.postMessage(
        {
          type: 'setInputPort',
          generation,
          port: channel.port1,
          ...(sharedRing
            ? {
                sharedSamples: sharedRing.samples,
                sharedState: sharedRing.state,
                sharedSlotCount: sharedRing.slotCount,
                sharedFrameSamples: OPUS_FRAME_SAMPLES,
              }
            : {}),
        },
        [channel.port1]
      );
      captureNode.port.postMessage(
        {
          type: 'set-frame-port',
          generation,
          ...(sharedRing
            ? {
                sharedSamples: sharedRing.samples,
                sharedState: sharedRing.state,
                sharedSlotCount: sharedRing.slotCount,
                sharedFrameSamples: OPUS_FRAME_SAMPLES,
              }
            : {}),
        },
        [channel.port2]
      );
      return true;
    } catch (error) {
      this.lastEncoderError =
        error instanceof Error ? error.message : String(error);
      this.encoderErrorCount++;
      return false;
    }
  }

  private createEncodeWorkerSharedRing(): {
    samples: SharedArrayBuffer;
    state: SharedArrayBuffer;
    slotCount: number;
  } | null {
    if (typeof SharedArrayBuffer === 'undefined') return null;
    try {
      const slotCount = GCALL_SENDER_SHARED_FRAME_SLOTS;
      const samples = new SharedArrayBuffer(
        slotCount * OPUS_FRAME_SAMPLES * Float32Array.BYTES_PER_ELEMENT
      );
      const state = new SharedArrayBuffer(
        slotCount * Int32Array.BYTES_PER_ELEMENT
      );
      new Int32Array(state).fill(0);
      this.encodeWorkerSharedSamples = samples;
      this.encodeWorkerSharedState = state;
      return { samples, state, slotCount };
    } catch {
      this.encodeWorkerSharedSamples = null;
      this.encodeWorkerSharedState = null;
      return null;
    }
  }

  private configureEncodeWorkerForActiveConfig(reason: string): void {
    const worker = this.encodeWorker;
    const config = this.activeConfig;
    if (!worker || !config) return;
    const generation = this.encodeWorkerConfiguredGeneration + 1;
    this.encodeWorkerConfiguredGeneration = generation;
    this.senderEncodeMode = 'worker-relay';
    this.encodeWorkerFallbackReason = 'worker-reconfigure';
    worker.postMessage({
      type: 'configure',
      generation,
      encoderConfig: this.buildEncoderConfig(
        getSenderAudioTuning(config.profile, config.cpuDegraded === true)
      ),
    });
    this.lastEncoderResetReason = reason;
    this.lastEncoderResetAtMs = Date.now();
  }

  private closeMainThreadEncoderWithoutFlush(): void {
    const current = this.encoder;
    if (!current) return;
    this.encoderGeneration++;
    this.encoder = null;
    this.encodeTimingByTimestampUs.clear();
    try {
      current.close();
    } catch {
      /* ignore */
    }
  }

  private fallbackToMainThreadEncoder(reason: string): void {
    const worker = this.encodeWorker;
    if (this.encodeWorkerProbeTimeout !== null) {
      clearTimeout(this.encodeWorkerProbeTimeout);
      this.encodeWorkerProbeTimeout = null;
    }
    this.encodeWorker = null;
    this.encodeWorkerSharedSamples = null;
    this.encodeWorkerSharedState = null;
    this.encodeWorkerGeneration++;
    this.encodeWorkerConfiguredGeneration = 0;
    this.senderEncodeMode = 'main-thread';
    this.encodeWorkerFallbackReason = reason;
    try {
      this.captureNode?.port.postMessage({ type: 'clear-frame-port' });
      worker?.postMessage({ type: 'stop' });
      worker?.terminate();
    } catch {
      /* ignore */
    }
    if (!this.encoder && this.activeConfig) {
      try {
        this.encoder = this.createEncoder(
          getSenderAudioTuning(
            this.activeConfig.profile,
            this.activeConfig.cpuDegraded === true
          )
        );
      } catch (error) {
        this.lastEncoderError =
          error instanceof Error ? error.message : String(error);
        this.encoderErrorCount++;
      }
    }
    this.lastEncoderResetReason = reason;
  }

  private noteStaleEncodedDrop(nowPerfMs: number): void {
    this.staleEncodedDropPerfMs.push(nowPerfMs);
    const oldestAllowed =
      nowPerfMs - GCALL_SENDER_ENCODER_RESET_STALE_WINDOW_MS;
    while (
      this.staleEncodedDropPerfMs.length > 0 &&
      this.staleEncodedDropPerfMs[0]! < oldestAllowed
    ) {
      this.staleEncodedDropPerfMs.shift();
    }
  }

  private resetEncoderIfAllowed(reason: string, nowPerfMs: number): boolean {
    if (
      nowPerfMs - this.lastEncoderResetPerfMs <
      GCALL_SENDER_ENCODER_RESET_COOLDOWN_MS
    ) {
      return false;
    }
    return this.replaceEncoderForActiveConfig(reason, {
      nowPerfMs,
      respectCooldown: true,
    });
  }

  private replaceEncoderForActiveConfig(
    reason: string,
    options: { nowPerfMs?: number; respectCooldown: boolean }
  ): boolean {
    const nowPerfMs =
      typeof options.nowPerfMs === 'number'
        ? options.nowPerfMs
        : typeof performance !== 'undefined'
          ? performance.now()
          : Date.now();
    if (
      options.respectCooldown &&
      nowPerfMs - this.lastEncoderResetPerfMs <
        GCALL_SENDER_ENCODER_RESET_COOLDOWN_MS
    ) {
      return false;
    }
    const current = this.encoder;
    const config = this.activeConfig;
    if (!current || current.state === 'closed' || !config) return false;
    this.lastEncoderResetPerfMs = nowPerfMs;
    this.encoderResetCount++;
    this.lastEncoderResetAtMs = Date.now();
    this.lastEncoderResetReason = reason;
    this.encoderQueuePressureStartedPerfMs = null;
    this.encoderPressureActiveMs = 0;
    this.staleEncodedDropPerfMs.length = 0;
    this.encodeTimingByTimestampUs.clear();
    this.encoderGeneration++;
    this.encoder = null;
    try {
      current.close();
    } catch {
      /* ignore */
    }
    this.encoder = this.createEncoder(
      getSenderAudioTuning(config.profile, config.cpuDegraded === true)
    );
    return true;
  }

  getVad(): boolean {
    return this.lastVad;
  }

  setOpusBitrate(bps: number | null): void {
    const next =
      typeof bps === 'number' && Number.isFinite(bps)
        ? Math.max(6_000, Math.round(bps))
        : null;
    if (this.opusBitrateOverride === next) return;
    this.opusBitrateOverride = next;
    if (!this.activeConfig) return;
    if (this.senderEncodeMode !== 'main-thread' && this.encodeWorker) {
      this.configureEncodeWorkerForActiveConfig('bitrate-update');
      return;
    }
    const current = this.encoder;
    if (!current || current.state === 'closed') return;
    try {
      current.configure(
        this.buildEncoderConfig(
          getSenderAudioTuning(
            this.activeConfig.profile,
            this.activeConfig.cpuDegraded === true
          )
        )
      );
      this.lastEncoderResetReason = 'bitrate-update';
      this.lastEncoderResetAtMs = Date.now();
    } catch (error) {
      this.lastEncoderError =
        error instanceof Error ? error.message : String(error);
      this.encoderErrorCount++;
    }
  }

  getDiagnosticsSnapshot(): Record<string, unknown> {
    const tracks = this.micStream?.getAudioTracks?.() ?? [];
    return {
      audioContextState: this.audioContext?.state ?? null,
      hasMicStream: this.micStream !== null,
      micTrackCount: tracks.length,
      micTracks: tracks.map((track) => ({
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      })),
      hasCaptureNode: this.captureNode !== null,
      audioContextSampleRate: this.audioContextSampleRate,
      captureInputSampleRate: this.captureInputSampleRate,
      captureOutputSampleRate: this.captureOutputSampleRate,
      captureInputFrameSamples: this.captureInputFrameSamples,
      encoderState: this.encoder?.state ?? null,
      senderEncodeSummary: {
        mode: this.senderEncodeMode,
        label:
          this.senderEncodeMode === 'worker-direct'
            ? 'worker-direct active'
            : this.senderEncodeMode === 'worker-relay'
              ? 'worker-relay fallback'
              : 'main-thread fallback',
        workerDirect: this.senderEncodeMode === 'worker-direct',
        workerRelay: this.senderEncodeMode === 'worker-relay',
        mainThreadFallback: this.senderEncodeMode === 'main-thread',
        fallbackReason:
          this.senderEncodeMode === 'main-thread' ||
          this.senderEncodeMode === 'worker-relay'
            ? this.encodeWorkerFallbackReason
            : null,
        workerProbeState: this.encodeWorkerProbeState,
        workerProbeDetail: this.encodeWorkerProbeDetail,
        workerProbeStartedAtMs: this.encodeWorkerProbeStartedAtMs || null,
        workerProbeCompletedAtMs: this.encodeWorkerProbeCompletedAtMs || null,
        workerProbeLastStage: this.latestEncodeWorkerProbeStage(),
        workerProbeStages: [...this.encodeWorkerProbeStages],
        transport:
          this.senderEncodeMode === 'worker-direct'
            ? this.encodeWorkerStats?.sharedRingEnabled
              ? 'shared-ring'
              : 'transfer'
            : null,
      },
      senderEncodeMode: this.senderEncodeMode,
      encodeWorkerProbe: {
        state: this.encodeWorkerProbeState,
        startedAtMs: this.encodeWorkerProbeStartedAtMs || null,
        completedAtMs: this.encodeWorkerProbeCompletedAtMs || null,
        detail: this.encodeWorkerProbeDetail,
        lastStage: this.latestEncodeWorkerProbeStage(),
        stages: [...this.encodeWorkerProbeStages],
      },
      encodeWorkerActive: this.encodeWorker !== null,
      encodeWorkerGeneration: this.encodeWorkerGeneration,
      encodeWorkerFallbackReason: this.encodeWorkerFallbackReason,
      encodeWorkerSharedRing: {
        enabled: this.encodeWorkerStats?.sharedRingEnabled === true,
        slotCount: this.encodeWorkerStats?.sharedRingSlotCount ?? 0,
        fallbackTransfers:
          this.encodeWorkerStats?.sharedRingFallbackTransfers ?? 0,
        localBuffersPresent:
          this.encodeWorkerSharedSamples !== null &&
          this.encodeWorkerSharedState !== null,
      },
      encodeWorkerStats: this.encodeWorkerStats,
      activeConfig: this.activeConfig,
      opusBitrateOverride: this.opusBitrateOverride,
      cpuDegraded: this.activeConfig?.cpuDegraded === true,
      effectiveTuning: this.activeConfig
        ? getSenderAudioTuning(
            this.activeConfig.profile,
            this.activeConfig.cpuDegraded === true
          )
        : null,
      lastVad: this.lastVad,
      capturedFrameCount: this.capturedFrameCount,
      encodedFrameCount: this.encodedFrameCount,
      droppedEncoderBackpressureFrames: this.droppedEncoderBackpressureFrames,
      droppedStaleEncodedFrames: this.droppedStaleEncodedFrames,
      encoderResetCount: this.encoderResetCount,
      lastEncoderResetAtMs: this.lastEncoderResetAtMs,
      lastEncoderResetReason: this.lastEncoderResetReason,
      encoderPressureActiveMs: this.encoderPressureActiveMs,
      staleEncodedDropsInWindow:
        this.encodeWorkerStats?.staleEncodedDropsInWindow ??
        this.staleEncodedDropPerfMs.length,
      encoderQueueSize:
        typeof this.encodeWorkerStats?.encoderQueueSize === 'number'
          ? this.encodeWorkerStats.encoderQueueSize
          : typeof this.encoder?.encodeQueueSize === 'number'
            ? this.encoder.encodeQueueSize
            : null,
      lastCapturePerfMs: this.lastCapturePerfMs,
      lastEncoderInputPerfMs: this.lastEncoderInputPerfMs,
      encoderErrorCount: this.encoderErrorCount,
      lastEncoderError: this.lastEncoderError,
      lastStartAtMs: this.lastStartAtMs,
      lastStopAtMs: this.lastStopAtMs,
      unsupportedReason: this.unsupportedReason,
    };
  }

  setMuted(muted: boolean): void {
    this.activeConfig = this.activeConfig
      ? { ...this.activeConfig, muted }
      : this.activeConfig;
    this.captureNode?.port.postMessage({ type: 'mute', muted });
    if (muted) this.updateVad(false);
  }

  private updateVad(vad: boolean): void {
    if (this.lastReportedVad === vad) return;
    this.lastReportedVad = vad;
    this.onVadChanged?.(vad);
  }

  async stop(): Promise<void> {
    await this.enqueueLifecycleOperation(() => this.stopLocked());
  }

  private async stopLocked(): Promise<void> {
    this.startToken += 1;
    this.encoderGeneration += 1;
    const captureNode = this.captureNode;
    const keepAliveGain = this.keepAliveGain;
    const micSource = this.micSource;
    const micStream = this.micStream;
    const audioContext = this.audioContext;
    const encoder = this.encoder;
    const encodeWorker = this.encodeWorker;
    this.captureNode = null;
    this.keepAliveGain = null;
    this.micSource = null;
    this.micStream = null;
    this.audioContext = null;
    this.encoder = null;
    this.encodeWorker = null;
    this.encodeWorkerSharedSamples = null;
    this.encodeWorkerSharedState = null;
    if (this.encodeWorkerProbeTimeout !== null) {
      clearTimeout(this.encodeWorkerProbeTimeout);
      this.encodeWorkerProbeTimeout = null;
    }
    this.encodeWorkerGeneration++;
    this.encodeWorkerConfiguredGeneration = 0;
    this.senderEncodeMode = 'main-thread';
    this.lastVad = false;
    this.lastStopAtMs = Date.now();
    this.updateVad(false);
    this.onEncodedFrame = null;
    this.onVadChanged = null;
    this.onTimingAnomaly = null;
    this.encoderQueuePressureStartedPerfMs = null;
    this.encoderPressureActiveMs = 0;
    this.staleEncodedDropPerfMs.length = 0;
    this.encodeTimingByTimestampUs.clear();
    if (captureNode) {
      captureNode.port.postMessage({ type: 'clear-frame-port' });
      captureNode.port.onmessage = null;
    }
    disconnectNodeSafe(captureNode);
    disconnectNodeSafe(keepAliveGain);
    disconnectNodeSafe(micSource);
    stopStreamSafe(micStream);
    if (encoder) {
      try {
        await encoder.flush().catch(() => {});
      } catch {
        /* ignore */
      }
      try {
        encoder.close();
      } catch {
        /* ignore */
      }
    }
    if (encodeWorker) {
      try {
        encodeWorker.postMessage({ type: 'stop' });
        encodeWorker.terminate();
      } catch {
        /* ignore */
      }
    }
    closeAudioContextSafe(audioContext);
  }
}
