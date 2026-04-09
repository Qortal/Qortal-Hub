import { describe, expect, it, vi } from 'vitest';

type GroupPlayoutProcessorCtor = new (options?: {
  processorOptions?: { sourceAddr?: string };
}) => {
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
  _computeRawTargetRate: (
    bufferedMs: number,
    deltaMs: number,
    quantum: number,
    sampleRateHz: number
  ) => { targetRate: number; inPanic: boolean; panicZoneEntered: boolean };
  _playoutStarted: boolean;
  _available: number;
  _smoothedRate: number;
  _targetPlayoutMs: number;
  _lastTail: Float32Array;
  _lastTailLen: number;
  _lastTailWritePos: number;
  _concealCursor: number;
  _rememberTailSample: (sample: number) => void;
};

async function loadProcessorCtor(): Promise<GroupPlayoutProcessorCtor> {
  vi.resetModules();
  let capturedCtor: GroupPlayoutProcessorCtor | null = null;

  class MockAudioWorkletProcessor {
    port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
  }

  const g = globalThis as Record<string, unknown>;
  g.AudioWorkletProcessor = MockAudioWorkletProcessor;
  g.registerProcessor = vi.fn((_name: string, ctor: GroupPlayoutProcessorCtor) => {
    capturedCtor = ctor;
  });
  g.sampleRate = 48_000;

  await import('../../../public/worklets/group-playout-processor.js');
  expect(capturedCtor).not.toBeNull();
  return capturedCtor!;
}

function nextBlock(
  processor: InstanceType<GroupPlayoutProcessorCtor>,
  size = 128
): Float32Array {
  const block = new Float32Array(size);
  processor.process([], [[block]]);
  return block;
}

function hasAudibleSample(block: Float32Array): boolean {
  return block.some((sample) => Math.abs(sample) > 1e-6);
}

describe('group playout processor concealment', () => {
  it('fades repeated starvation to silence instead of restarting every render quantum', async () => {
    const Processor = await loadProcessorCtor();
    const processor = new Processor({ processorOptions: { sourceAddr: 'peer' } });

    processor._playoutStarted = true;
    processor._available = 0;
    processor._lastTail.fill(0.5);
    processor._lastTailLen = processor._lastTail.length;
    processor._lastTailWritePos = 0;
    processor._concealCursor = 0;

    const first = nextBlock(processor);
    const second = nextBlock(processor);
    const third = nextBlock(processor);
    const fourth = nextBlock(processor);

    expect(hasAudibleSample(first)).toBe(true);
    expect(hasAudibleSample(second)).toBe(true);
    expect(hasAudibleSample(third)).toBe(false);
    expect(hasAudibleSample(fourth)).toBe(false);
  });

  it('uses the most recent tail samples for concealment instead of a frozen bootstrap tail', async () => {
    const Processor = await loadProcessorCtor();
    const processor = new Processor({ processorOptions: { sourceAddr: 'peer' } });

    processor._playoutStarted = true;
    processor._available = 0;

    for (let i = 0; i < processor._lastTail.length; i++) {
      processor._rememberTailSample(0.1);
    }
    for (let i = 0; i < processor._lastTail.length; i++) {
      processor._rememberTailSample(0.8);
    }

    const concealed = nextBlock(processor);
    expect(concealed[0]).toBeGreaterThan(0.7);
  });
});

describe('group playout processor rate control', () => {
  it('uses gentler over-target rates for healthy overshoot', async () => {
    const Processor = await loadProcessorCtor();
    const processor = new Processor({ processorOptions: { sourceAddr: 'peer' } });

    expect(
      processor._computeRawTargetRate(150, 50, 128, 48_000).targetRate
    ).toBe(1.004);
    expect(
      processor._computeRawTargetRate(210, 110, 128, 48_000).targetRate
    ).toBe(1.006);
    expect(
      processor._computeRawTargetRate(300, 200, 128, 48_000).targetRate
    ).toBe(1.01);
  });

  it('avoids fast-alpha speedup on modest over-target blocks', async () => {
    const Processor = await loadProcessorCtor();
    const processor = new Processor({ processorOptions: { sourceAddr: 'peer' } });

    processor._playoutStarted = true;
    processor._targetPlayoutMs = 100;
    processor._smoothedRate = 1;
    processor._available = Math.round((150 / 1000) * 48_000);

    nextBlock(processor);

    expect(processor._smoothedRate).toBeLessThan(1.001);
  });

  it('uses gentler under-target slowdown once the PCM buffer is already usable', async () => {
    const Processor = await loadProcessorCtor();
    const processor = new Processor({ processorOptions: { sourceAddr: 'peer' } });

    processor._playoutStarted = true;
    processor._targetPlayoutMs = 160;

    expect((processor as any)._underTierRate(-50, 110)).toBe(0.992);
    expect((processor as any)._underTierRate(-50, 70)).toBe(0.98);
  });
});
