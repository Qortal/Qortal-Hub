import { describe, expect, it } from 'vitest';
import {
  clampAdaptiveTargetMs,
  computeAdaptiveIdealTargetMs,
  computeAdaptiveJitterMs,
  stepSmoothedAdaptiveTargetMs,
} from './adaptivePlayout';

describe('adaptivePlayout', () => {
  it('clamps the ideal target into the configured range', () => {
    expect(clampAdaptiveTargetMs(40, 80, 180)).toBe(80);
    expect(clampAdaptiveTargetMs(220, 80, 180)).toBe(180);
    expect(clampAdaptiveTargetMs(120, 80, 180)).toBe(120);
  });

  it('shows the BASE < MIN dead-zone until jitter or boost escapes the floor', () => {
    expect(
      computeAdaptiveIdealTargetMs({
        baseTargetMs: 60,
        minTargetMs: 80,
        maxTargetMs: 180,
        jitterMultiplier: 2.5,
        jitterMs: 0,
      })
    ).toBe(80);

    expect(
      computeAdaptiveIdealTargetMs({
        baseTargetMs: 60,
        minTargetMs: 80,
        maxTargetMs: 180,
        jitterMultiplier: 2.5,
        jitterMs: 10,
      })
    ).toBe(85);
  });

  it('grows monotonically as jitter and loss increase', () => {
    const base = computeAdaptiveIdealTargetMs({
      baseTargetMs: 80,
      minTargetMs: 80,
      maxTargetMs: 180,
      jitterMultiplier: 2.2,
      jitterMs: 5,
      lossPenaltyMs: 4,
    });
    const worse = computeAdaptiveIdealTargetMs({
      baseTargetMs: 80,
      minTargetMs: 80,
      maxTargetMs: 180,
      jitterMultiplier: 2.2,
      jitterMs: 18,
      lossPenaltyMs: 10,
    });
    expect(worse).toBeGreaterThan(base);
  });

  it('uses asymmetric smoothing for rising and falling targets', () => {
    expect(
      stepSmoothedAdaptiveTargetMs({
        idealTargetMs: 120,
        previousTargetMs: 80,
        alphaUp: 0.5,
        alphaDown: 0.2,
      })
    ).toBe(100);

    expect(
      stepSmoothedAdaptiveTargetMs({
        idealTargetMs: 80,
        previousTargetMs: 120,
        alphaUp: 0.5,
        alphaDown: 0.2,
      })
    ).toBe(112);
  });

  it('computes zero jitter for tiny samples and variance for real windows', () => {
    expect(computeAdaptiveJitterMs([])).toBe(0);
    expect(computeAdaptiveJitterMs([20, 20])).toBe(0);
    expect(computeAdaptiveJitterMs([20, 20, 30])).toBeGreaterThan(0);
  });
});
