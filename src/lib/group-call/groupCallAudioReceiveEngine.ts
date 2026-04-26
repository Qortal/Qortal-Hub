import { DmVoiceGcallInboundPlayout } from '../call/dmVoiceGcallInboundPlayout';
import { applyCallAudioOutput } from '../call/audioDevices';
import {
  decodeAudioPackets,
  type DecodedAudioPacket,
} from './audioPacketCodec';
import type { GroupCallAudioQualityProfile } from './groupCallAudioProfile';
import {
  GroupCallPerformanceTracker,
  type GroupCallMetricsSnapshot,
} from './router';
import { tracePipelineReceiveDroppedNoRoomKey } from './gcallAudioSurfaceTrace';
import { traceGcallAudioSurface } from './gcallAudioSurfaceTrace';
import { OPUS_FRAME_DURATION_MS } from './gcallVoiceAudioConstants';

function disconnectNodeSafe(node: AudioNode | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}

export interface GroupCallAudioReceivePayload {
  roomId: string;
  data: ArrayBuffer;
  transport?: 'link' | 'packet' | 'unknown';
  bridgeReceivedAtWallMs?: number | null;
  fromAddress?: string;
  resolvedFromAddress?: string | null;
}

export interface GroupCallAudioReceiveEngineConfig {
  outputDeviceId: string | null;
  hearCall: boolean;
  profile: GroupCallAudioQualityProfile;
}

export class GroupCallAudioReceiveEngine {
  private static readonly METRICS_EMIT_INTERVAL_MS = 1000;
  private metrics = new GroupCallPerformanceTracker();
  private readonly metricsRef = { current: this.metrics };
  private readonly playouts = new Map<string, DmVoiceGcallInboundPlayout>();
  private readonly outputNodeBySource = new Map<string, GainNode>();
  private readonly onMetricsChanged: (
    snapshot: GroupCallMetricsSnapshot
  ) => void;
  private readonly onPlayedSeqAdvanced?: (
    sourceAddr: string,
    playedSeq: number
  ) => void;
  private readonly onDecodedPacketsObserved?: (
    packets: Array<{
      sourceAddr: string;
      seq: number;
      vad: boolean;
      timestampMs: number;
    }>
  ) => void;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private metricsEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private metricsEmitQueued = false;
  private loggedFirstDecodedPacket = false;
  private loggedFirstPlayoutStartBySource = new Set<string>();
  private config: GroupCallAudioReceiveEngineConfig = {
    outputDeviceId: null,
    hearCall: true,
    profile: 'low-latency',
  };

  constructor(
    onMetricsChanged: (snapshot: GroupCallMetricsSnapshot) => void,
    onPlayedSeqAdvanced?: (sourceAddr: string, playedSeq: number) => void,
    onDecodedPacketsObserved?: (
      packets: Array<{
        sourceAddr: string;
        seq: number;
        vad: boolean;
        timestampMs: number;
      }>
    ) => void
  ) {
    this.onMetricsChanged = onMetricsChanged;
    this.onPlayedSeqAdvanced = onPlayedSeqAdvanced;
    this.onDecodedPacketsObserved = onDecodedPacketsObserved;
    this.emitMetricsNow();
  }

  async configure(
    config: Partial<GroupCallAudioReceiveEngineConfig>
  ): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };
    if (this.masterGain) {
      this.masterGain.gain.value = this.config.hearCall ? 1 : 0;
    }
    if (this.audioContext) {
      await applyCallAudioOutput(this.config.outputDeviceId, {
        audioContext: this.audioContext,
      });
    }
  }

  getSnapshot(): GroupCallMetricsSnapshot {
    return this.metrics.getSnapshot();
  }

  getDiagnosticsSnapshot(): {
    audioContextState: string | null;
    hasMasterGain: boolean;
    hearCall: boolean;
    outputDeviceId: string | null;
    profile: GroupCallAudioQualityProfile;
    playoutCount: number;
    outputNodeCount: number;
    sourceAddrs: string[];
    playouts: Array<{
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
      playbackNodeActive: boolean;
      schedulerNodeActive: boolean;
      lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null;
    }>;
  } {
    const playouts = [...this.playouts.values()].map((playout) =>
      playout.getDiagnosticsSnapshot()
    );
    return {
      audioContextState: this.audioContext?.state ?? null,
      hasMasterGain: this.masterGain !== null,
      hearCall: this.config.hearCall,
      outputDeviceId: this.config.outputDeviceId,
      profile: this.config.profile,
      playoutCount: this.playouts.size,
      outputNodeCount: this.outputNodeBySource.size,
      sourceAddrs: [...this.playouts.keys()],
      playouts,
    };
  }

  noteIncomingAudio(bridgeReceivedAtWallMs?: number | null): void {
    this.metrics.recordPacketReceived();
    if (
      typeof bridgeReceivedAtWallMs === 'number' &&
      Number.isFinite(bridgeReceivedAtWallMs) &&
      bridgeReceivedAtWallMs > 0
    ) {
      this.metrics.recordReticulumAudioBridgeToRendererIngressLatency(
        Math.max(0, Date.now() - bridgeReceivedAtWallMs)
      );
    }
    this.scheduleMetricsEmit();
  }

  recordDecodeFailure(): void {
    this.metrics.recordPacketDroppedWithReason('decode-failure');
    this.scheduleMetricsEmit();
  }

  async handleDecodedPackets(
    packets: Array<{
      sourceAddr: string;
      seq: number;
      opusFrame: Uint8Array | ArrayBuffer;
      vad: boolean;
      timestampMs: number;
    }>
  ): Promise<void> {
    if (packets.length === 0) {
      this.recordDecodeFailure();
      traceGcallAudioSurface(
        'pipeline: decodeAudioPackets returned 0 packets',
        {}
      );
      return;
    }
    if (!this.loggedFirstDecodedPacket) {
      this.loggedFirstDecodedPacket = true;
      const first = packets[0];
      traceGcallAudioSurface('pipeline: first decoded audio packet', {
        sourceAddr: first?.sourceAddr ?? '',
        decodedCount: packets.length,
        seq: first?.seq ?? null,
      });
    }
    this.metrics.recordPacketDecoded(packets.length);
    this.onDecodedPacketsObserved?.(
      packets.map((packet) => ({
        sourceAddr: packet.sourceAddr,
        seq: packet.seq,
        vad: packet.vad,
        timestampMs: packet.timestampMs,
      }))
    );
    const grouped = new Map<string, DecodedAudioPacket[]>();
    for (const packet of packets) {
      const normalized: DecodedAudioPacket = {
        sourceAddr: packet.sourceAddr,
        seq: packet.seq,
        vad: packet.vad,
        timestampMs: packet.timestampMs,
        opusFrame:
          packet.opusFrame instanceof Uint8Array
            ? packet.opusFrame
            : new Uint8Array(packet.opusFrame),
      };
      const existing = grouped.get(packet.sourceAddr);
      if (existing) existing.push(normalized);
      else grouped.set(packet.sourceAddr, [normalized]);
    }
    for (const [sourceAddr, list] of grouped) {
      const playout = await this.getOrCreatePlayout(sourceAddr);
      playout.pushDecoded(list);
    }
    this.scheduleMetricsEmit();
  }

  async handleIncomingAudio(
    payload: GroupCallAudioReceivePayload,
    roomKey: Uint8Array | null
  ): Promise<number> {
    if (!roomKey) {
      const data = payload.data;
      const n =
        data instanceof ArrayBuffer
          ? data.byteLength
          : ArrayBuffer.isView(data)
            ? data.byteLength
            : 0;
      tracePipelineReceiveDroppedNoRoomKey({
        roomId: payload.roomId,
        from: payload.fromAddress ?? payload.resolvedFromAddress,
        dataBytes: n,
      });
      return 0;
    }
    const startedAt = performance.now();
    this.noteIncomingAudio(payload.bridgeReceivedAtWallMs);
    const packets = decodeAudioPackets(new Uint8Array(payload.data), roomKey);
    await this.handleDecodedPackets(packets);
    this.metrics.recordIncomingPacketDuration(performance.now() - startedAt);
    this.scheduleMetricsEmit();
    return packets.length;
  }

  async reset(): Promise<void> {
    for (const playout of this.playouts.values()) {
      await playout.stop();
    }
    for (const output of this.outputNodeBySource.values()) {
      disconnectNodeSafe(output);
    }
    this.playouts.clear();
    this.outputNodeBySource.clear();
    this.loggedFirstDecodedPacket = false;
    this.loggedFirstPlayoutStartBySource.clear();
    this.clearMetricsEmitTimer();
    this.metrics = new GroupCallPerformanceTracker();
    this.metricsRef.current = this.metrics;
    this.updateResourceCounts();
    this.emitMetricsNow();
  }

  async dispose(): Promise<void> {
    await this.reset();
    const audioContext = this.audioContext;
    const masterGain = this.masterGain;
    this.audioContext = null;
    this.masterGain = null;
    disconnectNodeSafe(masterGain);
    if (audioContext) {
      await audioContext.close().catch(() => {});
    }
    this.clearMetricsEmitTimer();
  }

  private async getOrCreatePlayout(
    sourceAddr: string
  ): Promise<DmVoiceGcallInboundPlayout> {
    const existing = this.playouts.get(sourceAddr);
    if (existing) return existing;
    const ctx = await this.ensureAudioContext();
    const output = ctx.createGain();
    output.gain.value = 1;
    output.connect(this.masterGain!);
    const playout = new DmVoiceGcallInboundPlayout();
    await playout.start(ctx, sourceAddr, output, {
      metricsRef: this.metricsRef,
      profile: this.config.profile,
      afterDrain: ({ missedFramesThisTick }) => {
        if (missedFramesThisTick > 0) {
          this.metrics.recordMissingFrames(missedFramesThisTick, sourceAddr);
          this.scheduleMetricsEmit();
        }
      },
      onPlayedSeqAdvanced: ({ sourceAddr: playedSourceAddr, playedSeq }) => {
        this.onPlayedSeqAdvanced?.(playedSourceAddr, playedSeq);
      },
      onPlayoutWorkletMessage: (message) => {
        const sharedRingEnabled =
          playout.getDiagnosticsSnapshot().sharedRingEnabled;
        if (
          message.playoutStarted &&
          !this.loggedFirstPlayoutStartBySource.has(sourceAddr)
        ) {
          this.loggedFirstPlayoutStartBySource.add(sourceAddr);
          traceGcallAudioSurface('pipeline: playout worklet started', {
            sourceAddr,
            bufferedMs:
              typeof message.bufferedMs === 'number'
                ? message.bufferedMs
                : null,
          });
        }
        if (typeof message.bufferedMs === 'number') {
          if (
            sharedRingEnabled &&
            typeof message.preProcessBufferedMs === 'number'
          ) {
            const bufferedFrames = Math.max(
              0,
              Math.round(message.preProcessBufferedMs / OPUS_FRAME_DURATION_MS)
            );
            const playoutStarted = message.playoutStarted !== false;
            // On the shared-ring path, "not ready" should reflect audible
            // under-run pressure, not strict pre-process frame scarcity.
            // Otherwise startup gating and low-but-still-usable reserve
            // overstate trouble in healthy calls.
            this.metrics.recordJitterDrainTelemetry({
              sourceCount: 1,
              depthSum: bufferedFrames,
              worstDepth: bufferedFrames,
              notReadyCount:
                playoutStarted &&
                (message.concealmentUsed || message.outsideBandUnder)
                  ? 1
                  : 0,
              rawEmptyCount:
                playoutStarted && message.preProcessBufferedMs <= 0 ? 1 : 0,
            });
          }
          if (
            sharedRingEnabled &&
            typeof message.oldestFrameAgeMs === 'number' &&
            Number.isFinite(message.oldestFrameAgeMs) &&
            message.oldestFrameAgeMs > 0
          ) {
            this.metrics.recordReceiverIngressToPlayoutPostLatency(
              sourceAddr,
              message.oldestFrameAgeMs
            );
          }
          this.metrics.recordPlayoutMetricTick(
            message.bufferedMs,
            !!message.outsideBand,
            sourceAddr,
            {
              outsideUnder: !!message.outsideBandUnder,
              outsideOver: !!message.outsideBandOver,
              deltaMs:
                typeof message.deltaMs === 'number'
                  ? message.deltaMs
                  : undefined,
              playoutRate:
                typeof message.rate === 'number' ? message.rate : undefined,
            }
          );
          if (message.concealmentUsed) {
            this.metrics.recordConcealmentTick(1, sourceAddr);
          }
          this.scheduleMetricsEmit();
        }
      },
      onJitterTickTelemetry: () => {
        this.scheduleMetricsEmit();
      },
      onWasmFecDecodeStats: () => {
        this.scheduleMetricsEmit();
      },
    });
    this.playouts.set(sourceAddr, playout);
    this.outputNodeBySource.set(sourceAddr, output);
    this.updateResourceCounts();
    this.emitMetricsNow();
    return playout;
  }

  private updateResourceCounts(): void {
    let decoders = 0;
    let playbackNodes = 0;
    let jitterBuffers = 0;
    for (const playout of this.playouts.values()) {
      const snapshot = playout.getDiagnosticsSnapshot();
      if (snapshot.decodePath === 'wasm-fec' || snapshot.hasWebCodecsDecoder) {
        decoders++;
      }
      if (snapshot.playbackNodeActive) playbackNodes++;
      if (snapshot.jitterActive) jitterBuffers++;
    }
    this.metrics.setResourceCounts({
      decoders,
      playbackNodes,
      jitterBuffers,
    });
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (this.audioContext && this.masterGain) {
      if (this.audioContext.state !== 'running') {
        try {
          await this.audioContext.resume();
        } catch {
          /* ignore */
        }
      }
      return this.audioContext;
    }
    const ctx = new AudioContext({ sampleRate: 48_000 });
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.config.hearCall ? 1 : 0;
    masterGain.connect(ctx.destination);
    await applyCallAudioOutput(this.config.outputDeviceId, {
      audioContext: ctx,
    });
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
    this.audioContext = ctx;
    this.masterGain = masterGain;
    return ctx;
  }

  private emitMetricsNow(): void {
    this.clearMetricsEmitTimer();
    this.onMetricsChanged(this.metrics.getSnapshot());
  }

  private scheduleMetricsEmit(): void {
    if (this.metricsEmitQueued) return;
    this.metricsEmitQueued = true;
    this.metricsEmitTimer = setTimeout(() => {
      this.metricsEmitTimer = null;
      this.metricsEmitQueued = false;
      this.onMetricsChanged(this.metrics.getSnapshot());
    }, GroupCallAudioReceiveEngine.METRICS_EMIT_INTERVAL_MS);
  }

  private clearMetricsEmitTimer(): void {
    if (this.metricsEmitTimer) {
      clearTimeout(this.metricsEmitTimer);
      this.metricsEmitTimer = null;
    }
    this.metricsEmitQueued = false;
  }
}
