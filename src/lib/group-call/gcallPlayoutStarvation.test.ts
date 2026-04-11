import { describe, expect, it } from 'vitest';
import type { GroupCallSourceWindowMetrics } from './router';
import {
  classifyStrongStarvationCandidate,
  computeBufferAdequacy,
  computeMildEntryCandidate,
  hasPlayoutStarvationMinSample,
  starvationCeilingLiftForSeverity,
  stepPlayoutStarvationSeverity,
} from './gcallPlayoutStarvation';

function baseSource(
  overrides: Partial<GroupCallSourceWindowMetrics> = {}
): GroupCallSourceWindowMetrics {
  return {
    sourceAddr: 'alice',
    jitterUnderruns: 0,
    missingFrames: 0,
    concealmentTicks: 0,
    avgPcmBufferedMs: 40,
    playoutOutsideTargetFraction: 0,
    avgOpusBufferedMs: 0,
    maxOpusBufferedMs: 0,
    adaptiveTargetMedianMs: 100,
    adaptiveTargetP95Ms: 120,
    adaptiveTargetMaxMs: 140,
    playoutMetricTicks: 100,
    ...overrides,
  };
}

describe('gcallPlayoutStarvation', () => {
  it('computes buffer adequacy relative to smoothed target', () => {
    expect(
      computeBufferAdequacy({
        avgPcmBufferedMs: 14,
        smoothedTargetMs: 150,
      })
    ).toBeCloseTo(14 / 150, 5);
  });

  it('classifies strong-A when adequacy below strong entry', () => {
    const r = classifyStrongStarvationCandidate(
      baseSource({ playoutUnderTargetFraction: 0, avgPlayoutDeltaMs: 0 }),
      0.25,
      0
    );
    expect(r).toEqual({ strong: true, reason: 'strong-A' });
  });

  it('classifies strong-B in moderate band with high under-target fraction', () => {
    const r = classifyStrongStarvationCandidate(
      baseSource({
        playoutUnderTargetFraction: 0.9,
        avgPlayoutDeltaMs: -10,
      }),
      0.35,
      0
    );
    expect(r).toEqual({ strong: true, reason: 'strong-B' });
  });

  it('classifies strong-C when middling adequacy stress is sustained', () => {
    const r = classifyStrongStarvationCandidate(
      baseSource({
        playoutUnderTargetFraction: 0.6,
        avgPlayoutDeltaMs: -40,
      }),
      0.65,
      2
    );
    expect(r).toEqual({ strong: true, reason: 'strong-C' });
  });

  it('does not classify strong-C when buffer adequacy has already recovered', () => {
    const r = classifyStrongStarvationCandidate(
      baseSource({
        playoutUnderTargetFraction: 0.6,
        avgPlayoutDeltaMs: -40,
      }),
      0.77,
      2
    );
    expect(r).toEqual({ strong: false, reason: null });
  });

  it('does not classify strong-B without stress signals', () => {
    const r = classifyStrongStarvationCandidate(
      baseSource({
        playoutUnderTargetFraction: 0.2,
        avgPlayoutDeltaMs: -10,
      }),
      0.35,
      0
    );
    expect(r.strong).toBe(false);
  });

  it('gates evaluation on min sample OR duration', () => {
    expect(
      hasPlayoutStarvationMinSample({
        windowDurationMs: 100,
        playoutMetricTicks: 30,
      })
    ).toBe(true);
    expect(
      hasPlayoutStarvationMinSample({
        windowDurationMs: 600,
        playoutMetricTicks: 0,
      })
    ).toBe(true);
    expect(
      hasPlayoutStarvationMinSample({
        windowDurationMs: 100,
        playoutMetricTicks: 10,
      })
    ).toBe(false);
  });

  it('steps strong to mild when strong exit met', () => {
    const stepped = stepPlayoutStarvationSeverity({
      held: 'strong',
      bufferAdequacy: 0.45,
      strongMeta: { strong: false, reason: null },
      mildCandidate: true,
    });
    expect(stepped.next).toBe('mild');
    expect(stepped.severityReason).toBe('mild-adequacy');
  });

  it('steps mild to none at mild exit', () => {
    const stepped = stepPlayoutStarvationSeverity({
      held: 'mild',
      bufferAdequacy: 0.65,
      strongMeta: { strong: false, reason: null },
      mildCandidate: false,
    });
    expect(stepped.next).toBe('none');
  });

  it('maps ceiling lift by severity', () => {
    expect(starvationCeilingLiftForSeverity('none')).toBe(0);
    expect(starvationCeilingLiftForSeverity('mild')).toBe(20);
    expect(starvationCeilingLiftForSeverity('strong')).toBe(40);
  });

  it('computes mild candidate when not strong and adequacy below mild entry', () => {
    expect(computeMildEntryCandidate(0.45, false)).toBe(true);
    expect(computeMildEntryCandidate(0.45, true)).toBe(false);
    expect(computeMildEntryCandidate(0.55, false)).toBe(false);
  });
});
