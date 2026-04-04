import { describe, expect, it } from 'vitest';
import {
  computePathQualityScoreV1,
  ratiosFromPathWindowFields,
} from './pathQualityScore';

describe('pathQualityScore', () => {
  it('computes dimensionless ratios with safe denominators', () => {
    const r = ratiosFromPathWindowFields({
      reticulumAudioPacketPathResolutions: 8,
      reticulumAudioPacketPathRequests: 10,
      reticulumAudioPacketPathTimeouts: 2,
      reticulumAudioPacketFreshSends: 7,
      reticulumAudioPacketStaleSends: 3,
    });
    expect(r.successRatio).toBeCloseTo(0.8);
    expect(r.timeoutRatio).toBeCloseTo(0.2);
    expect(r.staleRatio).toBeCloseTo(0.3);
  });

  it('clamps pathQualityScoreV1 to [0,1]', () => {
    const bad = computePathQualityScoreV1(
      {
        reticulumAudioPacketPathResolutions: 0,
        reticulumAudioPacketPathRequests: 1,
        reticulumAudioPacketPathTimeouts: 10,
        reticulumAudioPacketFreshSends: 0,
        reticulumAudioPacketStaleSends: 10,
      },
      null
    );
    expect(bad.pathQualityScoreV1).toBe(0);

    const good = computePathQualityScoreV1(
      {
        reticulumAudioPacketPathResolutions: 10,
        reticulumAudioPacketPathRequests: 10,
        reticulumAudioPacketPathTimeouts: 0,
        reticulumAudioPacketFreshSends: 10,
        reticulumAudioPacketStaleSends: 0,
      },
      null,
      { alpha: 0.15, beta: 0.1, gamma: 0 }
    );
    expect(good.pathQualityScoreV1).toBe(1);
  });

  it('applies EMA on top of instantaneous score', () => {
    const first = computePathQualityScoreV1(
      {
        reticulumAudioPacketPathResolutions: 10,
        reticulumAudioPacketPathRequests: 10,
        reticulumAudioPacketPathTimeouts: 0,
        reticulumAudioPacketFreshSends: 10,
        reticulumAudioPacketStaleSends: 0,
      },
      null,
      { lambdaEma: 0.25 }
    );
    const second = computePathQualityScoreV1(
      {
        reticulumAudioPacketPathResolutions: 0,
        reticulumAudioPacketPathRequests: 1,
        reticulumAudioPacketPathTimeouts: 1,
        reticulumAudioPacketFreshSends: 0,
        reticulumAudioPacketStaleSends: 1,
      },
      first.pathQualityScoreEmaV1,
      { lambdaEma: 0.25 }
    );
    expect(second.pathQualityScoreEmaV1).toBeGreaterThan(0);
    expect(second.pathQualityScoreEmaV1).toBeLessThan(first.pathQualityScoreEmaV1);
  });
});
