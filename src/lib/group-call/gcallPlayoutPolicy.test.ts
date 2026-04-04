import { describe, expect, it } from 'vitest';
import type { GroupCallSourceWindowMetrics } from './router';
import {
  diminishingPlayoutExtraMs,
  effectivePlayoutMaxTargetMs,
  stepWorstIsolationHysteresis,
  createWorstIsolationHysteresisState,
  pickSecondIsolationCandidate,
} from './gcallPlayoutPolicy';

describe('gcallPlayoutPolicy', () => {
  it('adds diminishing extra with log-scaled source count', () => {
    expect(diminishingPlayoutExtraMs(1)).toBe(0);
    expect(diminishingPlayoutExtraMs(2)).toBeGreaterThan(0);
    expect(diminishingPlayoutExtraMs(2)).toBeLessThanOrEqual(30);
  });

  it('caps effective max by global cap + extra vs profile', () => {
    const low = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 220,
      profileAdaptiveSevereMaxMs: 280,
      useSevereCeiling: false,
      activeSourceCount: 1,
    });
    expect(low).toBeLessThanOrEqual(150);

    const nWay = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 220,
      profileAdaptiveSevereMaxMs: 280,
      useSevereCeiling: false,
      activeSourceCount: 8,
    });
    expect(nWay).toBeGreaterThanOrEqual(150);
    expect(nWay).toBeLessThanOrEqual(220);
  });

  it('commits worst isolation after hold period', () => {
    let s = createWorstIsolationHysteresisState();
    s = stepWorstIsolationHysteresis(s, 'alice', 0);
    expect(s.committedAddr).toBe(null);
    s = stepWorstIsolationHysteresis(s, 'alice', 400);
    expect(s.committedAddr).toBe(null);
    s = stepWorstIsolationHysteresis(s, 'alice', 2000);
    expect(s.committedAddr).toBe('alice');
  });

  it('picks a second isolation peer when nearly as bad as worst', () => {
    const sources: GroupCallSourceWindowMetrics[] = [
      {
        sourceAddr: 'alice',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 0,
        playoutOutsideTargetFraction: 0,
        avgOpusBufferedMs: 0,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 0,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 200,
      },
      {
        sourceAddr: 'bob',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 0,
        playoutOutsideTargetFraction: 0,
        avgOpusBufferedMs: 0,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 0,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 170,
      },
    ];
    const second = pickSecondIsolationCandidate(sources, 'alice');
    expect(second).toBe('bob');
  });

  it('returns null for second when gap is large', () => {
    const sources: GroupCallSourceWindowMetrics[] = [
      {
        sourceAddr: 'alice',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 0,
        playoutOutsideTargetFraction: 0,
        avgOpusBufferedMs: 0,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 0,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 200,
      },
      {
        sourceAddr: 'bob',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 0,
        playoutOutsideTargetFraction: 0,
        avgOpusBufferedMs: 0,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 0,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 100,
      },
    ];
    const second = pickSecondIsolationCandidate(sources, 'alice');
    expect(second).toBe(null);
  });
});
