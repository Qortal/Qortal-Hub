/**
 * Tests for PerSourcePcmRing — the bounded PCM FIFO.
 *
 * Regression guards for:
 *  - Correct circular buffer semantics
 *  - Underrun counting (not silent corruption)
 *  - Overrun handling (oldest dropped, not newest)
 *  - Reset clears all state including underrun counters
 *  - bufferedMs accuracy
 */

import { test, expect } from 'vitest';
import { PerSourcePcmRing } from './perSourcePcmRing';

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 960; // 20ms @ 48kHz

function frameOf(value: number, samples = FRAME_SAMPLES): Float32Array {
  return Float32Array.from({ length: samples }, () => value);
}

// ---------------------------------------------------------------------------
// Basic write / read
// ---------------------------------------------------------------------------

test('PerSourcePcmRing: read returns written samples', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  const input = frameOf(0.5);
  ring.write(input);

  const out = new Float32Array(FRAME_SAMPLES);
  const n = ring.read(out, FRAME_SAMPLES);
  expect(n).toBe(FRAME_SAMPLES);
  expect(out[0]).toBeCloseTo(0.5);
  expect(ring.underruns).toBe(0);
});

// ---------------------------------------------------------------------------
// Underrun on empty ring
// ---------------------------------------------------------------------------

test('PerSourcePcmRing: read from empty ring returns zeros and increments underrun', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  const out = new Float32Array(FRAME_SAMPLES);
  ring.read(out, FRAME_SAMPLES);
  expect(ring.underruns).toBe(1);
  expect(out.every((v) => v === 0)).toBe(true);
});

// ---------------------------------------------------------------------------
// bufferedMs
// ---------------------------------------------------------------------------

test('PerSourcePcmRing: bufferedMs reflects fill level', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  expect(ring.bufferedMs()).toBeCloseTo(0, 0);

  ring.write(frameOf(0, FRAME_SAMPLES)); // 20ms
  expect(ring.bufferedMs()).toBeCloseTo(20, 0);

  ring.write(frameOf(0, FRAME_SAMPLES * 5)); // 5×20ms
  expect(ring.bufferedMs()).toBeCloseTo(120, 0);
});

// ---------------------------------------------------------------------------
// Overrun drops oldest, not newest
// ---------------------------------------------------------------------------

test('PerSourcePcmRing: overrun drops oldest data, keeps newest', () => {
  const ring = new PerSourcePcmRing({
    sampleRateHz: SAMPLE_RATE,
    capacityMs: 20, // Only room for 1 frame (960 samples)
  });

  ring.write(frameOf(1.0)); // first frame (value=1.0)
  ring.write(frameOf(2.0)); // second frame — overruns, first is dropped

  expect(ring.overruns).toBe(1);

  const out = new Float32Array(FRAME_SAMPLES);
  ring.read(out, FRAME_SAMPLES);
  // Should read the newest frame (2.0), not the dropped oldest (1.0).
  expect(out[0]).toBeCloseTo(2.0);
});

// ---------------------------------------------------------------------------
// Reset clears everything
// ---------------------------------------------------------------------------

test('PerSourcePcmRing: reset clears buffer and counters', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  ring.write(frameOf(1.0));
  // Read with a buffer large enough to cover more than what's buffered,
  // so the ring exhausts available samples and reports an underrun.
  const out = new Float32Array(FRAME_SAMPLES * 2);
  ring.read(out, FRAME_SAMPLES * 2); // 1920 samples: first 960 from ring, rest = underrun
  expect(ring.underruns).toBeGreaterThan(0);

  ring.reset();
  expect(ring.bufferedMs()).toBe(0);
  expect(ring.underruns).toBe(0);
  expect(ring.overruns).toBe(0);
  expect(ring.hasData()).toBe(false);
});

// ---------------------------------------------------------------------------
// hasData
// ---------------------------------------------------------------------------

test('PerSourcePcmRing: hasData returns false for less than one frame', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  expect(ring.hasData()).toBe(false);

  ring.write(new Float32Array(FRAME_SAMPLES - 1));
  expect(ring.hasData()).toBe(false);

  ring.write(new Float32Array(1));
  expect(ring.hasData()).toBe(true);
});

test('PerSourcePcmRing: readWithFrameMetadata returns ingress timestamps per frame', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  ring.write(frameOf(1.0), { ingressAtMs: 100 });
  ring.write(frameOf(2.0), { ingressAtMs: 120 });

  const out = new Float32Array(FRAME_SAMPLES * 2);
  const result = ring.readWithFrameMetadata(out, out.length);

  expect(result.samplesRead).toBe(FRAME_SAMPLES * 2);
  expect(result.frameIngressAtMs).toEqual([100, 120]);
  expect(ring.bufferedMs()).toBe(0);
});

test('PerSourcePcmRing: reports oldest frame age and drops stale PCM frames', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  ring.write(frameOf(1.0), { ingressAtMs: 100 });
  ring.write(frameOf(2.0), { ingressAtMs: 160 });

  expect(ring.oldestFrameAgeMs(220)).toBe(120);
  expect(ring.dropFramesOlderThan(80, 220)).toBe(1);
  expect(ring.staleDrops).toBe(1);
  expect(ring.oldestFrameAgeMs(220)).toBe(60);

  const out = new Float32Array(FRAME_SAMPLES);
  ring.read(out, FRAME_SAMPLES);
  expect(out[0]).toBeCloseTo(2.0);
});

test('PerSourcePcmRing: exposes shared bridge buffers', () => {
  const ring = new PerSourcePcmRing({ sampleRateHz: SAMPLE_RATE });
  const bridge = ring.getSharedBridgeConfig();

  expect(bridge.sampleBuffer).toBeInstanceOf(SharedArrayBuffer);
  expect(bridge.stateBuffer).toBeInstanceOf(SharedArrayBuffer);
  expect(bridge.ingressTimestampBuffer).toBeInstanceOf(SharedArrayBuffer);
  expect(bridge.capacitySamples).toBeGreaterThan(0);
  expect(bridge.frameSamples).toBe(FRAME_SAMPLES);
});
