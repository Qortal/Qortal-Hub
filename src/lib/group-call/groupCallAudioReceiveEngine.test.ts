import { describe, expect, it, vi } from 'vitest';
import { GroupCallAudioReceiveEngine } from './groupCallAudioReceiveEngine';
import { DmVoiceGcallInboundPlayout } from '../call/dmVoiceGcallInboundPlayout';

describe('GroupCallAudioReceiveEngine', () => {
  it('resumes the hidden playback AudioContext before group playout starts', async () => {
    const resume = vi.fn(async function (this: { state: string }) {
      this.state = 'running';
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        state = 'suspended';
        destination = {};
        resume = resume;
        createGain() {
          return {
            gain: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      }
    );

    const engine = new GroupCallAudioReceiveEngine(() => {});
    const ctx = await (engine as any).ensureAudioContext();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
  });

  it('coalesces frequent metrics updates before notifying the UI-facing runtime', async () => {
    vi.useFakeTimers();
    const onMetricsChanged = vi.fn();
    const engine = new GroupCallAudioReceiveEngine(onMetricsChanged);

    expect(onMetricsChanged).toHaveBeenCalledTimes(1);

    engine.noteIncomingAudio();
    engine.noteIncomingAudio();
    engine.recordDecodeFailure();

    expect(onMetricsChanged).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(onMetricsChanged).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(onMetricsChanged).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('uses shared-ring worklet metrics for latency and not-ready diagnostics', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        state = 'running';
        destination = {};
        async resume() {}
        createGain() {
          return {
            gain: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      }
    );

    let capturedOptions:
      | Parameters<DmVoiceGcallInboundPlayout['start']>[3]
      | undefined;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockReturnValue({
      peerAddress: 'alice',
      decodePath: 'wasm-fec',
      wasmFecActive: true,
      hasOpusFecWorker: true,
      hasWebCodecsDecoder: false,
      decoderState: null,
      hasSharedPcmRing: true,
      sharedRingEnabled: true,
      jitterActive: true,
      jitterBufferedFrames: 0,
      jitterHasReadyFrame: false,
      playbackNodeActive: true,
      schedulerNodeActive: true,
      lastJitterAdaptiveMode: null,
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    expect(capturedOptions).toBeDefined();
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 40,
      preProcessBufferedMs: 60,
      oldestFrameAgeMs: 180,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: 0,
    });

    const snapshot = engine.getSnapshot();
    expect(snapshot.avgReceiverIngressToPlayoutPostMs).toBe(180);
    expect(snapshot.maxReceiverIngressToPlayoutPostMs).toBe(180);
    expect(snapshot.jitterBufferDepthFramesMean).toBe(3);
    expect(snapshot.jitterBufferDepthFramesWorst).toBe(3);
    expect(snapshot.jitterNotReadyFraction).toBe(0);
    expect(snapshot.jitterRawEmptyFraction).toBe(0);
  });

  it('ignores SAB startup gating and only counts audible under-target pressure as not-ready', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        state = 'running';
        destination = {};
        async resume() {}
        createGain() {
          return {
            gain: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      }
    );

    let capturedOptions:
      | Parameters<DmVoiceGcallInboundPlayout['start']>[3]
      | undefined;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockReturnValue({
      peerAddress: 'alice',
      decodePath: 'wasm-fec',
      wasmFecActive: true,
      hasOpusFecWorker: true,
      hasWebCodecsDecoder: false,
      decoderState: null,
      hasSharedPcmRing: true,
      sharedRingEnabled: true,
      jitterActive: true,
      jitterBufferedFrames: 0,
      jitterHasReadyFrame: false,
      playbackNodeActive: true,
      schedulerNodeActive: true,
      lastJitterAdaptiveMode: null,
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 0,
      preProcessBufferedMs: 0,
      oldestFrameAgeMs: 0,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -100,
      playoutStarted: false,
      concealmentUsed: false,
    });
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 12,
      preProcessBufferedMs: 12,
      oldestFrameAgeMs: 120,
      rate: 0.96,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -88,
      playoutStarted: true,
      concealmentUsed: true,
    });

    const snapshot = engine.getSnapshot();
    expect(snapshot.jitterBufferDepthFramesMean).toBe(0.5);
    expect(snapshot.jitterBufferDepthFramesWorst).toBe(1);
    expect(snapshot.jitterNotReadyFraction).toBe(0.5);
    expect(snapshot.jitterRawEmptyFraction).toBe(0);
  });
});
