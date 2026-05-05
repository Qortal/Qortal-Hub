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
  private startToken = 0;
  private activeConfig: Omit<GroupCallAudioSenderEngineConfig, 'onEncodedFrame'> | null =
    null;
  private onVadChanged: ((vad: boolean) => void) | null = null;
  private lastReportedVad = false;
  private lastCapturePerfMs = 0;
  private lastEncoderInputPerfMs = 0;
  private capturedFrameCount = 0;
  private encodedFrameCount = 0;
  private encoderErrorCount = 0;
  private lastEncoderError: string | null = null;
  private lastStartAtMs = 0;
  private lastStopAtMs = 0;
  private unsupportedReason: string | null = null;

  private resetDiagnosticsCounters(): void {
    this.lastCapturePerfMs = 0;
    this.lastEncoderInputPerfMs = 0;
    this.capturedFrameCount = 0;
    this.encodedFrameCount = 0;
    this.encoderErrorCount = 0;
    this.lastEncoderError = null;
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
      this.onVadChanged = config.onVadChanged ?? null;
      await ensureAudioContextRunning(this.audioContext);
      this.captureNode.port.postMessage({ type: 'mute', muted: nextShape.muted });
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
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const frame = new Uint8Array(chunk.byteLength);
        chunk.copyTo(frame);
        this.encodedFrameCount++;
        config.onEncodedFrame({
          opusFrame: frame,
          vad: this.lastVad,
          capturePerfMs: this.lastCapturePerfMs,
          encoderInputPerfMs: this.lastEncoderInputPerfMs,
          encodeOutPerfMs: performance.now(),
        });
      },
      error: (error) => {
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
    captureNode.port.onmessage = (event) => {
      const capturedAtPerfMs = performance.now();
      const { frame, vad } = event.data as {
        frame?: Float32Array;
        vad?: boolean;
      };
      if (!(frame instanceof Float32Array) || encoder.state === 'closed') return;
      this.capturedFrameCount++;
      this.lastCapturePerfMs = capturedAtPerfMs;
      const pcm16 = float32ToInt16(frame);
      const encoderInputPerfMs = performance.now();
      this.lastEncoderInputPerfMs = encoderInputPerfMs;
      const audioData = new AudioData({
        format: 's16',
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfFrames: OPUS_FRAME_SAMPLES,
        numberOfChannels: OPUS_CHANNELS,
        timestamp: encoderInputPerfMs * 1000,
        data: pcm16,
      });
      this.lastVad = typeof vad === 'boolean' ? vad : false;
      this.updateVad(this.lastVad);
      encoder.encode(audioData);
      audioData.close();
    };
    source.connect(captureNode);
    source.connect(keepAliveGain);
    keepAliveGain.connect(ctx.destination);
    await applyCallAudioOutput(nextShape.outputDeviceId, { audioContext: ctx });
    await ensureAudioContextRunning(ctx);
    this.audioContext = ctx;
    this.micStream = stream;
    this.micSource = source;
    this.keepAliveGain = keepAliveGain;
    this.captureNode = captureNode;
    this.encoder = encoder;
  }

  private lastVad = false;

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
      encoderState: this.encoder?.state ?? null,
      activeConfig: this.activeConfig,
      lastVad: this.lastVad,
      capturedFrameCount: this.capturedFrameCount,
      encodedFrameCount: this.encodedFrameCount,
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
    this.onVadChanged = null;
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
