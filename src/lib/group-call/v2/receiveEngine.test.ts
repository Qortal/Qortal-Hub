import { test, expect } from 'vitest';
import type { IDecodeService } from './decodeService';
import { ReceiveEngine } from './receiveEngine';
import { PerSourcePcmRing } from './perSourcePcmRing';
import type { ReceivePolicyOutput, StreamIdentity } from './spec';

const STREAM_ID: StreamIdentity = {
  sourceAddr: 'peer-A',
  streamEpoch: 0,
  joinGeneration: 1,
};

const FRAME_SAMPLES = 960;

class FakeDecodeService implements IDecodeService {
  async decode(): Promise<Float32Array | null> {
    return new Float32Array(FRAME_SAMPLES);
  }

  async conceal(): Promise<Float32Array | null> {
    return new Float32Array(FRAME_SAMPLES);
  }

  reset(): void {}
  dispose(): void {}
  disposeAll(): void {}
}

function makePolicy(
  overrides: Partial<ReceivePolicyOutput> = {}
): ReceivePolicyOutput {
  return {
    state: 'steady',
    maxDecodePerTick: 3,
    targetBufferMs: 120,
    holdPlayout: false,
    aggressiveDrain: false,
    enableConcealment: true,
    ...overrides,
  };
}

test('ReceiveEngine: skips decode when decoded pcm latency is already high', async () => {
  const pcmRing = new PerSourcePcmRing({ sampleRateHz: 48_000 });
  pcmRing.write(new Float32Array(FRAME_SAMPLES * 11)); // ~220ms
  const engine = new ReceiveEngine({
    streamId: STREAM_ID,
    decodeService: new FakeDecodeService(),
    pcmRing,
    jitterStartThreshold: 1,
  });

  engine.pushDecodedPacket({
    seq: 1,
    opusFrame: new Uint8Array([1]),
    vad: true,
    timestampMs: 0,
    sourceAddr: STREAM_ID.sourceAddr,
  });

  const out = await engine.tick({ policy: makePolicy(), nowMs: 0 });
  expect(out.framesDecoded).toBe(0);
  expect(out.pcmBufferedMs).toBeGreaterThanOrEqual(200);
  expect(out.opusBufferedMs).toBeGreaterThan(0);
});

test('ReceiveEngine: hysteresis resumes decode after pcm ring drains below resume floor', async () => {
  const pcmRing = new PerSourcePcmRing({ sampleRateHz: 48_000 });
  pcmRing.write(new Float32Array(FRAME_SAMPLES * 11)); // ~220ms
  const engine = new ReceiveEngine({
    streamId: STREAM_ID,
    decodeService: new FakeDecodeService(),
    pcmRing,
    jitterStartThreshold: 1,
  });

  engine.pushDecodedPacket({
    seq: 1,
    opusFrame: new Uint8Array([1]),
    vad: true,
    timestampMs: 0,
    sourceAddr: STREAM_ID.sourceAddr,
  });

  const held = await engine.tick({ policy: makePolicy(), nowMs: 0 });
  expect(held.framesDecoded).toBe(0);

  const drain = new Float32Array(FRAME_SAMPLES * 4); // drain ~80ms -> ~140ms left
  pcmRing.read(drain, drain.length);

  const resumed = await engine.tick({ policy: makePolicy(), nowMs: 20 });
  expect(resumed.framesDecoded).toBe(1);
  expect(resumed.opusBufferedMs).toBe(0);
});

test('ReceiveEngine: aggressive drain does not bypass pcm latency clamp', async () => {
  const pcmRing = new PerSourcePcmRing({ sampleRateHz: 48_000 });
  pcmRing.write(new Float32Array(FRAME_SAMPLES * 12)); // ~240ms
  const engine = new ReceiveEngine({
    streamId: STREAM_ID,
    decodeService: new FakeDecodeService(),
    pcmRing,
    jitterStartThreshold: 1,
  });

  engine.pushDecodedPacket({
    seq: 1,
    opusFrame: new Uint8Array([1]),
    vad: true,
    timestampMs: 0,
    sourceAddr: STREAM_ID.sourceAddr,
  });

  const out = await engine.tick({
    policy: makePolicy({
      state: 'backlogDrain',
      aggressiveDrain: true,
      maxDecodePerTick: 8,
    }),
    nowMs: 0,
  });
  expect(out.framesDecoded).toBe(0);
  expect(out.opusBufferedMs).toBeGreaterThan(0);
});
