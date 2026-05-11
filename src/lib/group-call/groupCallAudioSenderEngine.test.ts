import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserAudioStreamForCall } = vi.hoisted(() => ({
  getUserAudioStreamForCall: vi.fn(),
}));

vi.mock('../call/audioDevices', () => ({
  applyCallAudioOutput: vi.fn().mockResolvedValue(undefined),
  getUserAudioStreamForCall,
}));

import { GroupCallAudioSenderEngine } from './groupCallAudioSenderEngine';

type CapturePort = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

type EncodedFrame = {
  byteLength: number;
  timestamp: number;
  copyTo: (target: Uint8Array) => void;
};

class FakeAudioEncoder {
  static instances: FakeAudioEncoder[] = [];

  state: 'configured' | 'closed' = 'configured';
  encodeQueueSize = 0;
  readonly encode = vi.fn((audioData: { timestamp: number }) => {
    this.encodeQueueSize++;
    this.pending.push(audioData.timestamp);
  });
  readonly configure = vi.fn();
  readonly flush = vi.fn().mockResolvedValue(undefined);
  readonly close = vi.fn(() => {
    this.state = 'closed';
  });
  private readonly pending: number[] = [];
  private readonly output: (chunk: EncodedFrame) => void;

  constructor(init: { output: (chunk: EncodedFrame) => void }) {
    this.output = init.output;
    FakeAudioEncoder.instances.push(this);
  }

  emitNext(): void {
    const timestamp = this.pending.shift();
    if (typeof timestamp !== 'number') return;
    this.encodeQueueSize = Math.max(0, this.encodeQueueSize - 1);
    this.output({
      byteLength: 3,
      timestamp,
      copyTo: (target: Uint8Array) => target.set([1, 2, 3]),
    });
  }

  pendingCount(): number {
    return this.pending.length;
  }
}

describe('GroupCallAudioSenderEngine', () => {
  let latestCapturePort: CapturePort | null = null;
  let nowMs = 0;
  let performanceNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    latestCapturePort = null;
    nowMs = 0;
    FakeAudioEncoder.instances = [];
    getUserAudioStreamForCall.mockResolvedValue({
      stream: {
        getTracks: () => [{ stop: vi.fn() }],
        getAudioTracks: () => [
          { enabled: true, muted: false, readyState: 'live' },
        ],
      },
    });
    performanceNowSpy = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => nowMs);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(),
      },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        state = 'running';
        destination = {};
        audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
        createMediaStreamSource() {
          return { connect: vi.fn(), disconnect: vi.fn() };
        }
        createGain() {
          return {
            gain: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
        resume = vi.fn().mockResolvedValue(undefined);
        close = vi.fn().mockResolvedValue(undefined);
      }
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port: CapturePort = {
          onmessage: null,
          postMessage: vi.fn(),
        };
        constructor(_ctx: unknown, name: string) {
          if (name === 'capture-processor') {
            latestCapturePort = this.port;
          }
        }
        connect = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal(
      'AudioData',
      class {
        timestamp: number;
        constructor(init: { timestamp: number }) {
          this.timestamp = init.timestamp;
        }
        close() {}
      }
    );
    vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
  });

  afterEach(() => {
    performanceNowSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  async function startSender(onEncodedFrame = vi.fn()) {
    const engine = new GroupCallAudioSenderEngine();
    await engine.startOrUpdate({
      inputDeviceId: null,
      outputDeviceId: null,
      muted: false,
      profile: 'low-latency',
      onEncodedFrame,
    });
    const encoder = FakeAudioEncoder.instances[0];
    expect(latestCapturePort).not.toBeNull();
    expect(encoder).toBeDefined();
    return { engine, encoder: encoder!, onEncodedFrame };
  }

  function captureFrame(vad = true): void {
    latestCapturePort?.onmessage?.({
      data: {
        frame: new Float32Array(960),
        vad,
      },
    } as MessageEvent);
  }

  it('drops stale encoder outputs instead of sending a delayed burst', async () => {
    const { engine, encoder, onEncodedFrame } = await startSender();

    nowMs = 10;
    captureFrame(true);
    expect(encoder.pendingCount()).toBe(1);

    nowMs = 250;
    encoder.emitNext();

    expect(onEncodedFrame).not.toHaveBeenCalled();
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      capturedFrameCount: 1,
      encodedFrameCount: 0,
      droppedStaleEncodedFrames: 1,
    });

    await engine.stop();
  });

  it('drops new capture frames while the encoder queue is backed up', async () => {
    const { engine, encoder, onEncodedFrame } = await startSender();

    for (let i = 0; i < 6; i += 1) {
      nowMs = 10 + i;
      captureFrame(true);
    }

    expect(encoder.pendingCount()).toBe(4);
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      capturedFrameCount: 6,
      droppedEncoderBackpressureFrames: 2,
    });

    nowMs = 40;
    for (let i = 0; i < 4; i += 1) {
      encoder.emitNext();
    }

    expect(onEncodedFrame).toHaveBeenCalledTimes(4);
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      encodedFrameCount: 4,
      droppedStaleEncodedFrames: 0,
    });

    await engine.stop();
  });

  it('recreates the encoder when queue pressure stays pinned', async () => {
    const { engine, encoder } = await startSender();

    for (let i = 0; i < 4; i += 1) {
      nowMs = 10 + i;
      captureFrame(true);
    }
    expect(encoder.pendingCount()).toBe(4);

    nowMs = 520;
    captureFrame(true);
    expect(FakeAudioEncoder.instances).toHaveLength(1);

    nowMs = 1_021;
    captureFrame(true);

    expect(encoder.close).toHaveBeenCalledTimes(1);
    expect(FakeAudioEncoder.instances).toHaveLength(2);
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      encoderResetCount: 1,
      lastEncoderResetReason: 'queue-pinned',
      droppedEncoderBackpressureFrames: 2,
    });

    nowMs = 1_040;
    captureFrame(true);
    expect(FakeAudioEncoder.instances[1]?.pendingCount()).toBe(1);

    await engine.stop();
  });

  it('recreates the encoder after repeated stale encoded outputs', async () => {
    const { engine } = await startSender();

    for (let i = 0; i < 4; i += 1) {
      nowMs = 10 + i;
      captureFrame(true);
    }
    nowMs = 250;
    for (let i = 0; i < 4; i += 1) {
      FakeAudioEncoder.instances[0]?.emitNext();
    }
    expect(FakeAudioEncoder.instances).toHaveLength(1);

    for (let i = 0; i < 4; i += 1) {
      nowMs = 260 + i;
      captureFrame(true);
    }
    nowMs = 500;
    for (let i = 0; i < 4; i += 1) {
      FakeAudioEncoder.instances[0]?.emitNext();
    }

    expect(FakeAudioEncoder.instances[0]?.close).toHaveBeenCalledTimes(1);
    expect(FakeAudioEncoder.instances).toHaveLength(2);
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      encoderResetCount: 1,
      lastEncoderResetReason: 'stale-output-drops',
      droppedStaleEncodedFrames: 8,
      staleEncodedDropsInWindow: 0,
    });

    await engine.stop();
  });

  it('resets immediately for extreme encoded output age but respects cooldown', async () => {
    const { engine } = await startSender();

    nowMs = 10;
    captureFrame(true);
    nowMs = 500;
    FakeAudioEncoder.instances[0]?.emitNext();

    expect(FakeAudioEncoder.instances).toHaveLength(2);
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      encoderResetCount: 1,
      lastEncoderResetReason: 'encoded-output-age',
      droppedStaleEncodedFrames: 1,
    });

    nowMs = 1_000;
    captureFrame(true);
    nowMs = 1_501;
    FakeAudioEncoder.instances[1]?.emitNext();

    expect(FakeAudioEncoder.instances).toHaveLength(2);
    expect(engine.getDiagnosticsSnapshot()).toMatchObject({
      encoderResetCount: 1,
      droppedStaleEncodedFrames: 2,
    });

    await engine.stop();
  });
});
