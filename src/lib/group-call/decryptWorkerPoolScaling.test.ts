import { describe, expect, it } from 'vitest';
import {
  DECRYPT_POOL_GROW_SUSTAINED_MS,
  DECRYPT_POOL_GROW_TO_3_DEPTH_THRESHOLD,
  DECRYPT_POOL_GROW_TO_3_SOURCES,
  DECRYPT_POOL_GROW_TO_4_DEPTH_THRESHOLD,
  DECRYPT_POOL_GROW_TO_4_SOURCES,
  DECRYPT_POOL_LOW_DEPTH_MAX,
  DECRYPT_POOL_MIN_SIZE,
  DECRYPT_POOL_SHRINK_DWELL_MS,
  computeDesiredPoolSize,
  type DecryptPoolScalingInput,
} from './decryptWorkerPoolScaling';

function baseInput(
  overrides: Partial<DecryptPoolScalingInput> = {}
): DecryptPoolScalingInput {
  return {
    currentSize: DECRYPT_POOL_MIN_SIZE,
    peakDepthRecent: 0,
    sustainedAboveGrow3Ms: 0,
    sustainedAboveGrow4Ms: 0,
    sustainedLowPressureMs: 0,
    burstWindowActive: false,
    activeSourceCount: 0,
    cpuCoreHint: 8,
    ...overrides,
  };
}

describe('computeDesiredPoolSize', () => {
  it('holds at current size when no growth or shrink signals are present', () => {
    const decision = computeDesiredPoolSize(baseInput());
    expect(decision.desiredSize).toBe(DECRYPT_POOL_MIN_SIZE);
    expect(decision.reason).toBe('hold');
  });

  it('grows to 3 when active sources crosses the 3-source threshold', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        activeSourceCount: DECRYPT_POOL_GROW_TO_3_SOURCES,
      })
    );
    expect(decision.desiredSize).toBe(3);
    expect(decision.reason).toBe('grow-sources-3');
  });

  it('grows to 4 when active sources crosses the 4-source threshold', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: 3,
        activeSourceCount: DECRYPT_POOL_GROW_TO_4_SOURCES,
      })
    );
    expect(decision.desiredSize).toBe(4);
    expect(decision.reason).toBe('grow-sources-4');
  });

  it('requires sustained depth before growing on depth alone', () => {
    // Depth at threshold but not sustained: hold.
    const notYet = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        peakDepthRecent: DECRYPT_POOL_GROW_TO_3_DEPTH_THRESHOLD,
        sustainedAboveGrow3Ms: DECRYPT_POOL_GROW_SUSTAINED_MS - 1,
        activeSourceCount: 2,
      })
    );
    expect(notYet.desiredSize).toBe(DECRYPT_POOL_MIN_SIZE);
    expect(notYet.reason).toBe('hold');

    // Once sustained, we grow and report a depth reason.
    const sustained = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        peakDepthRecent: DECRYPT_POOL_GROW_TO_3_DEPTH_THRESHOLD,
        sustainedAboveGrow3Ms: DECRYPT_POOL_GROW_SUSTAINED_MS,
        activeSourceCount: 2,
      })
    );
    expect(sustained.desiredSize).toBe(3);
    expect(sustained.reason).toBe('grow-depth-3');
  });

  it('reports grow-depth-4 when depth threshold is sustained and sources are calm but plural', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: 3,
        peakDepthRecent: DECRYPT_POOL_GROW_TO_4_DEPTH_THRESHOLD,
        sustainedAboveGrow4Ms: DECRYPT_POOL_GROW_SUSTAINED_MS,
        activeSourceCount: 2,
      })
    );
    expect(decision.desiredSize).toBe(4);
    expect(decision.reason).toBe('grow-depth-4');
  });

  it('grows on an active burst window when at least two sources are active', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        burstWindowActive: true,
        activeSourceCount: 2,
      })
    );
    expect(decision.desiredSize).toBeGreaterThan(DECRYPT_POOL_MIN_SIZE);
    expect(decision.reason).toBe('grow-burst-window');
  });

  it('does NOT grow on a burst window when only a single source is active', () => {
    // Stable-hash routing sends every packet from one ingress to the same slot, so
    // growing a 1:1 call is all-cost / no-benefit. This guards against the Kenny+Phil
    // production log spam (25+ `grow-burst-window` events over ~6 s in a 1:1 call).
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        burstWindowActive: true,
        activeSourceCount: 1,
      })
    );
    expect(decision.desiredSize).toBe(DECRYPT_POOL_MIN_SIZE);
    expect(decision.reason).toBe('hold');
  });

  it('does NOT grow on sustained depth when only a single source is active', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        peakDepthRecent: DECRYPT_POOL_GROW_TO_3_DEPTH_THRESHOLD,
        sustainedAboveGrow3Ms: DECRYPT_POOL_GROW_SUSTAINED_MS,
        activeSourceCount: 1,
      })
    );
    expect(decision.desiredSize).toBe(DECRYPT_POOL_MIN_SIZE);
    expect(decision.reason).toBe('hold');
  });

  it('respects the cpu-core hardware cap', () => {
    // 2 cores → hwCap = max(MIN, min(HARD_CEILING, 2 - 1)) = MIN_SIZE.
    // Even with strong grow signals we stay at MIN.
    const decision = computeDesiredPoolSize(
      baseInput({
        cpuCoreHint: 2,
        currentSize: DECRYPT_POOL_MIN_SIZE,
        activeSourceCount: DECRYPT_POOL_GROW_TO_4_SOURCES,
      })
    );
    expect(decision.desiredSize).toBeLessThanOrEqual(DECRYPT_POOL_MIN_SIZE);
  });

  it('never shrinks while a burst window is active', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: 4,
        burstWindowActive: true,
        activeSourceCount: 0,
        peakDepthRecent: 0,
        sustainedLowPressureMs: DECRYPT_POOL_SHRINK_DWELL_MS * 2,
      })
    );
    // Burst window blocks the shrink branch (`burstWindowActive` gate on the shrink
    // conditional). With only 0-1 sources we won't also grow, but we must never
    // produce a `shrink-low-pressure` decision while a burst is live.
    expect(decision.reason).not.toBe('shrink-low-pressure');
    expect(decision.desiredSize).toBeGreaterThanOrEqual(4);
  });

  it('shrinks by one after an extended low-pressure window', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: 4,
        activeSourceCount: 1,
        peakDepthRecent: DECRYPT_POOL_LOW_DEPTH_MAX - 1,
        sustainedLowPressureMs: DECRYPT_POOL_SHRINK_DWELL_MS,
      })
    );
    expect(decision.desiredSize).toBe(3);
    expect(decision.reason).toBe('shrink-low-pressure');
  });

  it('holds at MIN_SIZE rather than shrinking below it', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        activeSourceCount: 0,
        peakDepthRecent: 0,
        sustainedLowPressureMs: DECRYPT_POOL_SHRINK_DWELL_MS * 2,
      })
    );
    expect(decision.desiredSize).toBe(DECRYPT_POOL_MIN_SIZE);
    expect(decision.reason).toBe('hold');
  });

  it('does not shrink while low-pressure dwell has not elapsed', () => {
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: 3,
        activeSourceCount: 1,
        peakDepthRecent: 4,
        sustainedLowPressureMs: DECRYPT_POOL_SHRINK_DWELL_MS - 1,
      })
    );
    expect(decision.reason).toBe('hold');
    expect(decision.desiredSize).toBe(3);
  });

  it('prefers the strongest grow signal when multiple are present', () => {
    // Both 3-source and 4-source thresholds met → 4-source wins.
    const decision = computeDesiredPoolSize(
      baseInput({
        currentSize: DECRYPT_POOL_MIN_SIZE,
        activeSourceCount: DECRYPT_POOL_GROW_TO_4_SOURCES + 1,
      })
    );
    expect(decision.desiredSize).toBe(4);
    expect(decision.reason).toBe('grow-sources-4');
  });
});
