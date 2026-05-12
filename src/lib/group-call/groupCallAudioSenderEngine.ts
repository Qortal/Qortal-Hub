import {
  applyCallAudioOutput,
  getUserAudioStreamForCall,
} from '../call/audioDevices';
import {
  getGroupCallAudioTuning,
  type GroupCallAudioQualityProfile,
} from './groupCallAudioProfile';
import {
  OPUS_CHANNELS,
  OPUS_FRAME_DURATION_MS,
  OPUS_FRAME_SAMPLES,
  OPUS_SAMPLE_RATE,
} from './gcallSharedVoiceProcessing';

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
  inputSampleRate?: number;
  outputSampleRate?: number;
  inputFrameSamples?: number;
};

export interface GroupCallAudioSenderEngineConfig {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  muted: boolean;
  profile: GroupCallAudioQualityProfile;
  onEncodedFrame: (frame: GroupCallAudioSenderFrame) => void;
  onVadChanged?: (vad: boolean) => void;
}

export class GroupCallAudioSenderEngine {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private keepAliveGain: GainNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private encoder: AudioEncoder | null = null;
  private encoderGeneration = 0;
  private startToken = 0;
  private activeConfig: Omit<
    GroupCallAudioSenderEngineConfig,
    'onEncodedFrame'
  > | null = null;
  private onEncodedFrame: ((frame: GroupCallAudioSenderFrame) => void) | null =
    null;
  private onVadChanged: ((vad: boolean) => void) | null = null;
  private lastReportedVad = false;
  private lastCapturePerfMs = 0;
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

  private resetDiagnosticsCounters(): void {
    this.lastCapturePerfMs = 0;
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
    this.audioContextSampleRate = null;
    this.captureInputSampleRate = null;
    this.captureOutputSampleRate = null;
    this.captureInputFrameSamples = null;
    this.encodeTimingByTimestampUs.clear();
  }

  async startOrUpdate(config: GroupCallAudioSenderEngineConfig): Promise<void> {
    const nextShape = {
      inputDeviceId: config.inputDeviceId ?? null,
      outputDeviceId: config.outputDeviceId ?? null,
      muted: config.muted === true,
      profile: config.profile,
    };
    const currentShape = this.activeConfig;
    const sameShape =
      currentShape &&
      currentShape.inputDeviceId === nextShape.inputDeviceId &&
      currentShape.outputDeviceId === nextShape.outputDeviceId &&
      currentShape.muted === nextShape.muted &&
      currentShape.profile === nextShape.profile;
    if (sameShape && this.audioContext && this.captureNode && this.encoder) {
      this.onEncodedFrame = config.onEncodedFrame;
      this.onVadChanged = config.onVadChanged ?? null;
      await ensureAudioContextRunning(this.audioContext);
      this.captureNode.port.postMessage({
        type: 'mute',
        muted: nextShape.muted,
      });
      if (nextShape.muted) this.updateVad(false);
      return;
    }
    await this.stop();
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
    this.resetDiagnosticsCounters();
    this.lastStartAtMs = Date.now();
    const token = ++this.startToken;
    const gum = await getUserAudioStreamForCall(nextShape.inputDeviceId);
    const stream = gum.stream;
    if (!stream || token !== this.startToken) {
      stopStreamSafe(stream);
      return;
    }
    const ctx = new AudioContext({ sampleRate: OPUS_SAMPLE_RATE });
    const source = ctx.createMediaStreamSource(stream);
    const keepAliveGain = ctx.createGain();
    keepAliveGain.gain.value = 0.0001;
    await ctx.audioWorklet.addModule('/worklets/capture-processor.js');
    if (token !== this.startToken) {
      stopStreamSafe(stream);
      closeAudioContextSafe(ctx);
      return;
    }
    const captureNode = new AudioWorkletNode(ctx, 'capture-processor');
    captureNode.port.postMessage({ type: 'mute', muted: nextShape.muted });
    const tuning = getGroupCallAudioTuning(nextShape.profile);
    const encoder = this.createEncoder(tuning);
    captureNode.port.onmessage = (event) => {
      const capturedAtPerfMs = performance.now();
      const {
        frame,
        vad,
        inputSampleRate,
        outputSampleRate,
        inputFrameSamples,
      } = event.data as CaptureWorkletMessage;
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
      const activeEncoder = this.encoder;
      if (
        !(frame instanceof Float32Array) ||
        !activeEncoder ||
        activeEncoder.state === 'closed'
      ) {
        return;
      }
      this.capturedFrameCount++;
      this.lastCapturePerfMs = capturedAtPerfMs;
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
      const pcm16 = float32ToInt16(frame);
      const encoderInputPerfMs = performance.now();
      this.lastEncoderInputPerfMs = encoderInputPerfMs;
      const timestampUs = Math.trunc(encoderInputPerfMs * 1000);
      this.encodeTimingByTimestampUs.set(timestampUs, {
        capturePerfMs: capturedAtPerfMs,
        encoderInputPerfMs,
        vad: typeof vad === 'boolean' ? vad : false,
      });
      while (
        this.encodeTimingByTimestampUs.size >
        GCALL_SENDER_ENCODE_TIMING_CACHE_MAX
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
        data: pcm16,
      });
      this.lastVad = typeof vad === 'boolean' ? vad : false;
      this.updateVad(this.lastVad);
      activeEncoder.encode(audioData);
      audioData.close();
    };
    source.connect(captureNode);
    captureNode.connect(keepAliveGain);
    keepAliveGain.connect(ctx.destination);
    await applyCallAudioOutput(nextShape.outputDeviceId, { audioContext: ctx });
    await ensureAudioContextRunning(ctx);
    this.audioContext = ctx;
    this.audioContextSampleRate = ctx.sampleRate;
    this.micStream = stream;
    this.micSource = source;
    this.keepAliveGain = keepAliveGain;
    this.captureNode = captureNode;
    this.encoder = encoder;
  }

  private lastVad = false;

  private createEncoder(
    tuning: ReturnType<typeof getGroupCallAudioTuning>
  ): AudioEncoder {
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
        if (outputAgeMs > GCALL_SENDER_MAX_REALTIME_FRAME_AGE_MS) {
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
    encoder.configure({
      codec: 'opus',
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
      bitrate: tuning.opusBitrate,
      opus: {
        application: 'voip',
        signal: 'voice',
        frameDuration: OPUS_FRAME_DURATION_MS * 1000,
        packetlossperc: tuning.opusExpectedPacketLossPercent,
        useinbandfec: true,
        usedtx: false,
      },
    } as unknown as AudioEncoderConfig);
    return encoder;
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
    this.encoder = this.createEncoder(getGroupCallAudioTuning(config.profile));
    return true;
  }

  getVad(): boolean {
    return this.lastVad;
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
      activeConfig: this.activeConfig,
      lastVad: this.lastVad,
      capturedFrameCount: this.capturedFrameCount,
      encodedFrameCount: this.encodedFrameCount,
      droppedEncoderBackpressureFrames: this.droppedEncoderBackpressureFrames,
      droppedStaleEncodedFrames: this.droppedStaleEncodedFrames,
      encoderResetCount: this.encoderResetCount,
      lastEncoderResetAtMs: this.lastEncoderResetAtMs,
      lastEncoderResetReason: this.lastEncoderResetReason,
      encoderPressureActiveMs: this.encoderPressureActiveMs,
      staleEncodedDropsInWindow: this.staleEncodedDropPerfMs.length,
      encoderQueueSize:
        typeof this.encoder?.encodeQueueSize === 'number'
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
    this.startToken += 1;
    this.encoderGeneration += 1;
    const captureNode = this.captureNode;
    const keepAliveGain = this.keepAliveGain;
    const micSource = this.micSource;
    const micStream = this.micStream;
    const audioContext = this.audioContext;
    const encoder = this.encoder;
    this.captureNode = null;
    this.keepAliveGain = null;
    this.micSource = null;
    this.micStream = null;
    this.audioContext = null;
    this.encoder = null;
    this.lastVad = false;
    this.lastStopAtMs = Date.now();
    this.updateVad(false);
    this.onEncodedFrame = null;
    this.onVadChanged = null;
    this.encoderQueuePressureStartedPerfMs = null;
    this.encoderPressureActiveMs = 0;
    this.staleEncodedDropPerfMs.length = 0;
    this.encodeTimingByTimestampUs.clear();
    if (captureNode) {
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
    closeAudioContextSafe(audioContext);
  }
}
