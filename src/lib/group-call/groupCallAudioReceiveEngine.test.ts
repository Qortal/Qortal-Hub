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

  it('retries resuming the hidden playback AudioContext when late playout readiness appears', async () => {
    const contexts: Array<{ state: string; resume: ReturnType<typeof vi.fn> }> =
      [];
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        state = 'suspended';
        destination = {};
        resume = vi.fn(async function (this: { state: string }) {
          this.state = 'running';
        });
        constructor() {
          contexts.push(this as unknown as { state: string; resume: ReturnType<typeof vi.fn> });
        }
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
      jitterBufferedFrames: 12,
      jitterHasReadyFrame: true,
      playbackNodeActive: true,
      schedulerNodeActive: true,
      lastJitterAdaptiveMode: null,
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');
    const ctx = contexts[0];
    expect(ctx).toBeDefined();
    expect(ctx?.resume).toHaveBeenCalledTimes(1);

    ctx!.state = 'suspended';
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 84,
      preProcessBufferedMs: 120,
      oldestFrameAgeMs: 180,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: 0,
      playoutStarted: true,
    });
    await Promise.resolve();

    expect(ctx?.resume).toHaveBeenCalledTimes(2);
    expect(ctx?.state).toBe('running');
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

  it('switches the audio-surface path into recovery on severe live playout collapse', async () => {
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
      bufferedMs: 2.628,
      preProcessBufferedMs: 0,
      oldestFrameAgeMs: 417.873,
      rate: 0.992,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -97.372,
      playoutStarted: true,
      concealmentUsed: true,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');

    for (let i = 0; i < 3; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 120,
        preProcessBufferedMs: 120,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -5,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
  });

  it('enables multi-source recovery tuning when a second live source appears', async () => {
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

    const capturedOptions = new Map<
      string,
      Parameters<DmVoiceGcallInboundPlayout['start']>[3]
    >();
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, peerAddress, _connectTo, options) {
        capturedOptions.set(peerAddress, options);
      }
    );
    const syncSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'syncAdaptiveJitterGeometry'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 10,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');
    expect(capturedOptions.get('alice')?.getActiveSourceCount?.()).toBe(1);

    await (engine as any).getOrCreatePlayout('bob');

    expect(capturedOptions.get('alice')?.getActiveSourceCount?.()).toBe(2);
    expect(capturedOptions.get('bob')?.getActiveSourceCount?.()).toBe(2);
    expect(syncSpy).toHaveBeenCalled();
  });

  it('boosts target and extra hold for the weak leg in multi-source recovery', async () => {
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

    const capturedOptions = new Map<
      string,
      Parameters<DmVoiceGcallInboundPlayout['start']>[3]
    >();
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, peerAddress, _connectTo, options) {
        capturedOptions.set(peerAddress, options);
      }
    );
    const syncSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'syncAdaptiveJitterGeometry'
    ).mockImplementation(() => {});
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const holdSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');
    await (engine as any).getOrCreatePlayout('bob');

    const alice = capturedOptions.get('alice');
    const bob = capturedOptions.get('bob');
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    alice?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 2.628,
      preProcessBufferedMs: 0,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 417.873,
      rate: 0.992,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -97.372,
      playoutStarted: true,
      concealmentUsed: true,
    });
    bob?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 120,
      preProcessBufferedMs: 120,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -5,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    expect(syncSpy).toHaveBeenCalled();
    expect(targetSpy).toHaveBeenCalled();
    expect(holdSpy).toHaveBeenCalled();
    expect(resetTargetSpy).toHaveBeenCalled();
  });

  it('holds multi-source protected mode until the modeled recovery exit streak is satisfied', async () => {
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

    const capturedOptions = new Map<
      string,
      Parameters<DmVoiceGcallInboundPlayout['start']>[3]
    >();
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, peerAddress, _connectTo, options) {
        capturedOptions.set(peerAddress, options);
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');
    await (engine as any).getOrCreatePlayout('bob');

    const alice = capturedOptions.get('alice');
    const bob = capturedOptions.get('bob');
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    alice?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 2.628,
      preProcessBufferedMs: 0,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 417.873,
      rate: 0.992,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -97.372,
      playoutStarted: true,
      concealmentUsed: true,
    });
    bob?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 120,
      preProcessBufferedMs: 120,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -5,
      playoutStarted: true,
      concealmentUsed: false,
    });

    const aliceState = (engine as any).liveMultiSourceStateBySource.get('alice');
    expect(aliceState?.protectedMode).toBe(true);

    alice?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 120,
      preProcessBufferedMs: 120,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -5,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(aliceState?.protectedMode).toBe(true);

    for (let i = 0; i < 8; i += 1) {
      alice?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 120,
        preProcessBufferedMs: 120,
        targetPlayoutMs: 100,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -5,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(aliceState?.protectedMode).toBe(false);
  });

  it('raises target and extra hold for weak single-source recovery', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const holdSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 2.159,
      preProcessBufferedMs: 0,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 310.5,
      rate: 0.997,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -97.841,
      playoutStarted: true,
      concealmentUsed: true,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    expect(targetSpy).toHaveBeenCalled();
    expect(holdSpy).toHaveBeenCalled();

    const targetCallsAfterRecovery = targetSpy.mock.calls.length;
    const holdCallsAfterRecovery = holdSpy.mock.calls.length;

    for (let i = 0; i < 3; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 120,
        preProcessBufferedMs: 120,
        targetPlayoutMs: 100,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -5,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(resetTargetSpy.mock.calls.length).toBeGreaterThan(0);
    expect(targetSpy.mock.calls.length).toBeGreaterThanOrEqual(
      targetCallsAfterRecovery
    );
    expect(holdSpy.mock.calls.length).toBeGreaterThanOrEqual(
      holdCallsAfterRecovery
    );
  });

  it('latches stronger single-source recovery after a severe stall', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const holdSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 4.181,
      preProcessBufferedMs: 0,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 1684,
      rate: 0.992,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -138.543,
      playoutStarted: true,
      concealmentUsed: true,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    const severeTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    const severeHoldFrames = holdSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(severeTargetMs).toBeGreaterThanOrEqual(184);
    expect(severeHoldFrames).toBeGreaterThan(0);
    const resetCallsAfterSevere = resetTargetSpy.mock.calls.length;

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 48,
      preProcessBufferedMs: 48,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 180,
      rate: 0.998,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -24,
      playoutStarted: true,
      concealmentUsed: false,
    });

    const latchedTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    const latchedHoldFrames = holdSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(latchedTargetMs).toBeGreaterThanOrEqual(184);
    expect(latchedHoldFrames).toBeGreaterThan(0);

    for (let i = 0; i < 3; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 120,
        preProcessBufferedMs: 120,
        targetPlayoutMs: 100,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -5,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
    const postRecoveryTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(postRecoveryTargetMs).toBeGreaterThanOrEqual(160);
    expect(resetTargetSpy.mock.calls.length).toBe(resetCallsAfterSevere);

    vi.setSystemTime(Date.now() + 3_000);
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 120,
      preProcessBufferedMs: 120,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -5,
      playoutStarted: true,
      concealmentUsed: false,
    });
    expect(resetTargetSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not escalate past the explicit weak-listener recovery band once full collapse pressure has eased', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 24,
      preProcessBufferedMs: 24,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 180,
      rate: 0.997,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -62,
      playoutStarted: true,
      concealmentUsed: true,
    });
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 24,
      preProcessBufferedMs: 24,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 180,
      rate: 0.997,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -62,
      playoutStarted: true,
      concealmentUsed: true,
    });
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 57.228,
      preProcessBufferedMs: 57.228,
      targetPlayoutMs: 100,
      oldestFrameAgeMs: 120,
      rate: 0.983,
      outsideBand: true,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -66.754,
      playoutStarted: true,
      concealmentUsed: false,
    });

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeLessThanOrEqual(176);
  });

  it('adds stronger steady single-source headroom when playout keeps rate-chasing with only mild reserve', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 52,
        preProcessBufferedMs: 52,
        targetPlayoutMs: 120,
        oldestFrameAgeMs: 140,
        rate: 0.989,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -24,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(160);
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
  });

  it('adds steady single-source headroom for low-grade concealment/static before collapse', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 28,
        preProcessBufferedMs: 28,
        targetPlayoutMs: 120,
        oldestFrameAgeMs: 120,
        rate: 0.997,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -28,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(156);
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
  });

  it('adds lighter steady single-source assist for artifact pressure even before heavier pressure gates trip', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 44,
        preProcessBufferedMs: 44,
        targetPlayoutMs: 120,
        oldestFrameAgeMs: 140,
        rate: 0.996,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -18,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(158);
    expect(targetMs).toBeLessThanOrEqual(176);
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
  });

  it('adds steady single-source assist when concealment persists despite moderate reserve', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 58,
        preProcessBufferedMs: 58,
        targetPlayoutMs: 120,
        oldestFrameAgeMs: 150,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -16,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(162);
    expect(targetMs).toBeLessThanOrEqual(176);
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
  });

  it('adds stronger repair-heavy single-source assist when concealment keeps accumulating with subnormal rate', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 70,
        preProcessBufferedMs: 70,
        targetPlayoutMs: 120,
        oldestFrameAgeMs: 165,
        rate: 0.996,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -22,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(170);
    expect(targetMs).toBeLessThanOrEqual(176);
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
  });

  it('adds repair-heavy assist when under-target and rate churn persist even if concealment stays relatively low', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 18,
        preProcessBufferedMs: 18,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 140,
        rate: 0.996,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -42,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(168);
    expect(targetMs).toBeLessThanOrEqual(176);
  });

  it('keeps healthy-reserve under-target churn out of repair-heavy assist', async () => {
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 3,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: null,
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 64,
        preProcessBufferedMs: 64,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 140,
        rate: 0.997,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -76,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-heavy-connected',
      },
    ]);
  });

  it('escapes repair-heavy hold once reserve is healthy and repair pressure decays', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 3,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: null,
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 70,
        preProcessBufferedMs: 70,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 165,
        rate: 0.996,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -22,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-heavy-connected',
      },
    ]);

    for (let i = 0; i < 12; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 64,
        preProcessBufferedMs: 64,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 140,
        rate: 0.997,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -76,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-heavy-connected',
      },
    ]);
    vi.useRealTimers();
  });

  it('adds stronger headroom for a repair-heavy collapse when concealment stays high and reserve is still very shallow', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 6,
        preProcessBufferedMs: 6,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 220,
        rate: 0.995,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -86,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(176);
  });

  it('keeps repair-collapse playout in recovery while reserve is still empty or not ready', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    const syncSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'syncAdaptiveJitterGeometry'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 10,
        jitterHasReadyFrame: false,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 1,
        preProcessBufferedMs: 20,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 220,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -138,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-collapse',
      },
    ]);

    (engine as any).peerRecoveryState.peerRecoveryProfile.set(
      'alice',
      'low-latency'
    );
    (engine as any).metrics.setAdaptiveNetworkMode('low-latency');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 1.3,
      preProcessBufferedMs: 20,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 180,
      rate: 0.998,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -138,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    expect(syncSpy).toHaveBeenCalled();
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-collapse',
      },
    ]);
    vi.useRealTimers();
  });

  it('adds sustained headroom for a persistent lean single-source listener even before severe collapse signals trip', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 10,
        preProcessBufferedMs: 10,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 140,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -66,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const leanTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(leanTargetMs).toBeGreaterThanOrEqual(192);

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 24,
      preProcessBufferedMs: 24,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 130,
      rate: 0.999,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -40,
      playoutStarted: true,
      concealmentUsed: false,
    });

    const heldTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(heldTargetMs).toBeGreaterThanOrEqual(168);

    vi.setSystemTime(Date.now() + 9_000);
    for (let i = 0; i < 2; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 72,
        preProcessBufferedMs: 72,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -20,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(resetTargetSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('treats sustained ingress-age stress as a persistent weak-listener signal even before the prebuffer collapses fully', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 20,
        preProcessBufferedMs: 30,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -52,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(176);
    vi.useRealTimers();
  });

  it('does not keep a ready higher-reserve damaged listener in persistent-lean once the current reserve is out of the lean band', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 11,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 20,
        preProcessBufferedMs: 30,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -52,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'persistent-lean',
      },
    ]);

    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 44,
        preProcessBufferedMs: 44,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 150,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -92,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'persistent-lean',
      },
    ]);
    vi.useRealTimers();
  });

  it('does not keep a ready-false listener in persistent-lean once the live path matches buffered-not-ready instead', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = true;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 11 : 10,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 20,
        preProcessBufferedMs: 20,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -52,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'persistent-lean',
      },
    ]);

    jitterHasReadyFrame = false;
    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 25,
        preProcessBufferedMs: 24,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 140,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -86,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    vi.useRealTimers();
  });

  it('does not keep a ready-false decent-reserve listener in persistent-lean when the latest sample dips below the buffered-not-ready floor', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = true;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 11 : 10,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 20,
        preProcessBufferedMs: 20,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -52,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'persistent-lean',
      },
    ]);

    jitterHasReadyFrame = false;
    const liveState = (engine as any).liveMultiSourceStateBySource.get('alice');
    liveState.bufferedMsEma = 32;
    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 22,
        preProcessBufferedMs: 22,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 145,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -88,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    vi.useRealTimers();
  });

  it('adds sustained headroom for a silently lean listener even when concealment and missing-frame pressure stay at zero', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 4,
        preProcessBufferedMs: 4,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -172,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(192);

    vi.setSystemTime(Date.now() + 11_000);
    for (let i = 0; i < 2; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 80,
        preProcessBufferedMs: 80,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -20,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(resetTargetSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not keep a ready damaged listener in silent-lean once the path is actually ready', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = false;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 22 : 0,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: jitterHasReadyFrame ? 'recovery' : null,
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 4,
        preProcessBufferedMs: 4,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -172,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'silent-lean',
      },
    ]);

    jitterHasReadyFrame = true;
    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 33,
        preProcessBufferedMs: 33,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 150,
        rate: 0.997,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -100,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'silent-lean',
      },
    ]);
    vi.useRealTimers();
  });

  it('holds repair-heavy single-source headroom briefly after concealment pressure eases so rough calls do not oscillate', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 70,
        preProcessBufferedMs: 70,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 165,
        rate: 0.996,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -22,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const repairTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(repairTargetMs).toBeGreaterThanOrEqual(170);
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-heavy-connected',
      },
    ]);

    for (let i = 0; i < 2; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 86,
        preProcessBufferedMs: 86,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 130,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -16,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const heldTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(heldTargetMs).toBeGreaterThanOrEqual(170);
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-heavy-connected',
      },
    ]);

    vi.setSystemTime(Date.now() + 4_000);
    for (let i = 0; i < 2; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 112,
        preProcessBufferedMs: 112,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -6,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(resetTargetSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps the stronger repair-collapse profile latched while its hold is still active', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 16,
        preProcessBufferedMs: 16,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 180,
        rate: 0.994,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -82,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const collapseTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(collapseTargetMs).toBeGreaterThanOrEqual(176);
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-collapse',
      },
    ]);

    for (let i = 0; i < 2; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 30,
        preProcessBufferedMs: 30,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 150,
        rate: 0.998,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -36,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const heldTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(heldTargetMs).toBeGreaterThanOrEqual(176);
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-collapse',
      },
    ]);

    vi.useRealTimers();
  });

  it('keeps light single-source headroom briefly after recovery clears so the path does not go lean immediately again', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 2; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 24,
        preProcessBufferedMs: 24,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 180,
        rate: 0.997,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -62,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 96,
        preProcessBufferedMs: 96,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -8,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
    const heldTargetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(heldTargetMs).toBeGreaterThanOrEqual(158);

    targetSpy.mockClear();
    for (let i = 0; i < 3; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 124,
        preProcessBufferedMs: 124,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 1,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -4,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(
      engine.getDiagnosticsSnapshot().livePolicyProfilesBySource[0]?.profile
    ).not.toBe('steady-weak-listener');

    vi.setSystemTime(Date.now() + 3_000);
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 120,
      preProcessBufferedMs: 120,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -4,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(resetTargetSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('adds stronger temporary headroom for a newly promoted root after failover', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await engine.configure({
      postFailoverRootHoldUntilMs: Date.now() + 12_000,
    });
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 28,
        preProcessBufferedMs: 28,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 180,
        rate: 0.998,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -22,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(172);
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'post-failover-stabilization',
      },
    ]);
    vi.useRealTimers();
  });

  it('keeps a healthy single-source listener in clean-low-latency even if playout delta is still somewhat negative', async () => {
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');
    targetSpy.mockClear();
    resetTargetSpy.mockClear();

    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 48,
        preProcessBufferedMs: 48,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 60,
        rate: 1.001,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: true,
        deltaMs: -84,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('low-latency');
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'clean-low-latency',
      },
    ]);
    expect(targetSpy).not.toHaveBeenCalled();
    expect(resetTargetSpy).toHaveBeenCalled();
  });

  it('classifies a buffered-but-not-ready weak listener separately from true collapse recovery', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 7,
        jitterHasReadyFrame: false,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 58,
        preProcessBufferedMs: 14,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -56,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(190);
    vi.useRealTimers();
  });

  it('does not keep a ready moderate-reserve listener in buffered-not-ready once actual readiness failure has cleared', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = false;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 12 : 7,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 58,
        preProcessBufferedMs: 14,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -56,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);

    jitterHasReadyFrame = true;
    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 46,
        preProcessBufferedMs: 46,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 150,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -88,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    vi.useRealTimers();
  });

  it('does not classify an actively concealing moderate-reserve path as buffered-not-ready', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 11,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 18,
        preProcessBufferedMs: 18,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 170,
        rate: 0.975,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -133,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    vi.useRealTimers();
  });

  it('does not surface buffered-not-ready once the current path is ready even if the old hold is still armed', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = false;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 11 : 7,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 58,
        preProcessBufferedMs: 14,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -56,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);

    const liveState = (engine as any).liveMultiSourceStateBySource.get('alice');
    liveState.bufferedNotReadyHoldUntilMs = Date.now() + 5_000;
    jitterHasReadyFrame = true;
    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 34,
      preProcessBufferedMs: 34,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 150,
      rate: 0.999,
      outsideBand: true,
      outsideBandUnder: true,
      outsideBandOver: false,
      deltaMs: -92,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    vi.useRealTimers();
  });

  it('escalates from buffered-not-ready into collapse-recovery when a true severe collapse begins', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
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
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 58,
        preProcessBufferedMs: 14,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 260,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -56,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);

    for (let i = 0; i < 5; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 10,
        preProcessBufferedMs: 1,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 980,
        rate: 0.992,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -96,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'collapse-recovery',
      },
    ]);
    expect(targetMs).toBeGreaterThanOrEqual(200);
    vi.useRealTimers();
  });

  it('gives true single-source collapse enough target and hold headroom to rebuild reserve', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const holdSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 21,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 8; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 7.3,
        preProcessBufferedMs: 0,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 613,
        rate: 0.998,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -115,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    const extraHoldFrames = holdSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'collapse-recovery',
      },
    ]);
    expect(targetMs).toBeGreaterThanOrEqual(240);
    expect(extraHoldFrames).toBeGreaterThan(8);
    vi.useRealTimers();
  });

  it('reclassifies a latched severe listener into buffered-not-ready once current symptoms are ready-false with decent reserve', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = false;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 22 : 6,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 10,
        preProcessBufferedMs: 0,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 1_200,
        rate: 0.96,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -96,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    jitterHasReadyFrame = false;
    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 25,
        preProcessBufferedMs: 24,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 120,
        rate: 0.99,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -44,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(190);
    vi.useRealTimers();
  });

  it('classifies a ready-false moderate-reserve high-damage listener as buffered-not-ready instead of collapse-recovery', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 9,
        jitterHasReadyFrame: false,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 8; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 22,
        preProcessBufferedMs: 18,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 240,
        rate: 0.985,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -118,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    vi.useRealTimers();
  });

  it('clears buffered-not-ready as soon as the jitter path has a ready frame again', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = false;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 5 : 9,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 6; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 25,
        preProcessBufferedMs: 24,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 140,
        rate: 0.99,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -86,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);

    jitterHasReadyFrame = true;
    for (let i = 0; i < 3; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 37.192,
        preProcessBufferedMs: 100,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 415,
        rate: 0.96,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -96.983,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const profile =
      engine.getDiagnosticsSnapshot().livePolicyProfilesBySource[0]?.profile;
    expect(profile).not.toBe('buffered-not-ready');
    expect(['steady-weak-listener', 'repair-heavy-connected']).toContain(profile);
    vi.useRealTimers();
  });

  it('lets a ready buffered repair path escape a stale severe hold instead of staying in collapse-recovery', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});

    let jitterHasReadyFrame = false;
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 12 : 0,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 10,
        preProcessBufferedMs: 0,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 1_000,
        rate: 0.96,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -100,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'collapse-recovery',
      },
    ]);

    jitterHasReadyFrame = true;
    for (let i = 0; i < 16; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 31,
        preProcessBufferedMs: 240,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 450,
        rate: 0.997,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -99,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-heavy-connected',
      },
    ]);
    vi.useRealTimers();
  });

  it('does not flatten a true collapse-shaped listener into persistent-lean when current concealment and reserve match a stronger recovery profile', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 24,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 8; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 1.1,
        preProcessBufferedMs: 22,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 320,
        rate: 0.996,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -120,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-collapse',
      },
    ]);
    const targetMs = targetSpy.mock.calls.at(-1)?.[0] ?? 0;
    expect(targetMs).toBeGreaterThanOrEqual(188);
    vi.useRealTimers();
  });

  it('does not keep an actively concealing low-reserve recovery path in persistent-lean', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 22,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 8; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 5.3,
        preProcessBufferedMs: 22,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 320,
        rate: 0.996,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -116,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).not.toEqual([
      {
        peerAddress: 'alice',
        profile: 'persistent-lean',
      },
    ]);
    vi.useRealTimers();
  });

  it('enters recovery for a silent-lean path with buffered jitter frames but no ready frame', async () => {
    vi.useFakeTimers();
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
    const targetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 10,
        jitterHasReadyFrame: false,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 2.366,
      preProcessBufferedMs: 0,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -118.416,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'silent-lean',
      },
    ]);
    expect(targetSpy.mock.calls.at(-1)?.[0] ?? 0).toBeGreaterThanOrEqual(192);
    vi.useRealTimers();
  });

  it('clears steady-weak-listener classification for a ready healthy-reserve listener during recovery', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    const resetTargetSpy = vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 23,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');
    (engine as any).peerRecoveryState.peerRecoveryProfile.set(
      'alice',
      'recovery'
    );
    (engine as any).peerRecoveryState.globalRecoveryUntilMs =
      Date.now() + 12_000;
    (engine as any).metrics.setAdaptiveNetworkMode('recovery');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 73.273,
      preProcessBufferedMs: 460,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 120,
      rate: 1,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -56.606,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'clean-low-latency',
      },
    ]);
    expect(resetTargetSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('promotes a shallow buffered-but-not-ready listener out of ordinary weak-listener classification', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 9,
        jitterHasReadyFrame: false,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'low-latency',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    capturedOptions?.onPlayoutWorkletMessage?.({
      type: 'gcallPlayoutMetrics',
      bufferedMs: 11.997,
      preProcessBufferedMs: 180,
      targetPlayoutMs: 124,
      oldestFrameAgeMs: 120,
      rate: 0.999,
      outsideBand: false,
      outsideBandUnder: false,
      outsideBandOver: false,
      deltaMs: -159.095,
      playoutStarted: true,
      concealmentUsed: false,
    });

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'buffered-not-ready',
      },
    ]);
    expect(engine.getSnapshot().adaptiveNetworkMode).toBe('recovery');
    vi.useRealTimers();
  });

  it('escapes collapse-recovery for a ready buffered low-concealment shallow listener', async () => {
    vi.useFakeTimers();
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
    let jitterHasReadyFrame = false;
    vi.spyOn(DmVoiceGcallInboundPlayout.prototype, 'start').mockImplementation(
      async function (_ctx, _peerAddress, _connectTo, options) {
        capturedOptions = options;
      }
    );
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: jitterHasReadyFrame ? 22 : 0,
        jitterHasReadyFrame,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 4; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 8,
        preProcessBufferedMs: 0,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 1_000,
        rate: 0.96,
        outsideBand: true,
        outsideBandUnder: true,
        outsideBandOver: false,
        deltaMs: -116,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'collapse-recovery',
      },
    ]);

    jitterHasReadyFrame = true;
    for (let i = 0; i < 18; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 12.416,
        preProcessBufferedMs: 440,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 450,
        rate: 0.998,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -113.001,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    const profile =
      engine.getDiagnosticsSnapshot().livePolicyProfilesBySource[0]?.profile;
    expect(profile).not.toBe('collapse-recovery');
    expect(['persistent-lean', 'silent-lean', 'steady-weak-listener']).toContain(
      profile
    );
    vi.useRealTimers();
  });

  it('keeps high-concealment near-empty ready paths out of persistent-lean', async () => {
    vi.useFakeTimers();
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
      'setDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'resetDynamicTargetPlayoutMs'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'setBurstRecoveryExtraHoldFrames'
    ).mockImplementation(() => {});
    vi.spyOn(
      DmVoiceGcallInboundPlayout.prototype,
      'getDiagnosticsSnapshot'
    ).mockImplementation(function (this: DmVoiceGcallInboundPlayout) {
      return {
        peerAddress: (this as any).peerAddress ?? '',
        decodePath: 'wasm-fec',
        wasmFecActive: true,
        hasOpusFecWorker: true,
        hasWebCodecsDecoder: false,
        decoderState: null,
        hasSharedPcmRing: true,
        sharedRingEnabled: true,
        jitterActive: true,
        jitterBufferedFrames: 19,
        jitterHasReadyFrame: true,
        playbackNodeActive: true,
        schedulerNodeActive: true,
        lastJitterAdaptiveMode: 'recovery',
      };
    });

    const engine = new GroupCallAudioReceiveEngine(() => {});
    await (engine as any).getOrCreatePlayout('alice');

    for (let i = 0; i < 3; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 1.877,
        preProcessBufferedMs: 380,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 640,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -118.673,
        playoutStarted: true,
        concealmentUsed: true,
      });
    }

    for (let i = 0; i < 8; i += 1) {
      capturedOptions?.onPlayoutWorkletMessage?.({
        type: 'gcallPlayoutMetrics',
        bufferedMs: 1.877,
        preProcessBufferedMs: 380,
        targetPlayoutMs: 124,
        oldestFrameAgeMs: 640,
        rate: 0.999,
        outsideBand: false,
        outsideBandUnder: false,
        outsideBandOver: false,
        deltaMs: -118.673,
        playoutStarted: true,
        concealmentUsed: false,
      });
    }

    expect(engine.getDiagnosticsSnapshot().livePolicyProfilesBySource).toEqual([
      {
        peerAddress: 'alice',
        profile: 'repair-collapse',
      },
    ]);
    vi.useRealTimers();
  });
});
