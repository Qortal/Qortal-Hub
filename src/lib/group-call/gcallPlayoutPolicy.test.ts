import { describe, expect, it } from 'vitest';
import type { GroupCallSourceWindowMetrics } from './router';
import {
  computeRecoveryMultiSourceTargetMaxMs,
  diminishingPlayoutExtraMs,
  effectivePlayoutMaxTargetMs,
  stepWorstIsolationHysteresis,
  createWorstIsolationHysteresisState,
  pickSecondIsolationCandidate,
  computeMicroWidenExtraMsV1,
  varianceOfSliceMs2,
} from './gcallPlayoutPolicy';

describe('gcallPlayoutPolicy', () => {
  it('adds diminishing extra with log-scaled source count', () => {
    expect(diminishingPlayoutExtraMs(1)).toBe(0);
    expect(diminishingPlayoutExtraMs(2)).toBeGreaterThan(0);
    expect(diminishingPlayoutExtraMs(2)).toBeLessThanOrEqual(30);
  });

  it('caps effective max by global cap + extra vs profile', () => {
    const low = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 1,
    });
    expect(low).toBe(145);

    const nWay = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 8,
    });
    expect(nWay).toBeGreaterThanOrEqual(145);
    expect(nWay).toBeLessThanOrEqual(145);
  });

  it('clamps multi-source recovery targets back toward realistic group-call ceilings', () => {
    expect(
      computeRecoveryMultiSourceTargetMaxMs({
        profileAdaptiveMaxMs: 145,
        profileAdaptiveSevereMaxMs: 185,
        activeSourceCount: 2,
        starvationSeverity: 'none',
      })
    ).toBe(null);
    expect(
      computeRecoveryMultiSourceTargetMaxMs({
        profileAdaptiveMaxMs: 145,
        profileAdaptiveSevereMaxMs: 185,
        activeSourceCount: 4,
        starvationSeverity: 'none',
      })
    ).toBe(157);
    expect(
      computeRecoveryMultiSourceTargetMaxMs({
        profileAdaptiveMaxMs: 145,
        profileAdaptiveSevereMaxMs: 185,
        activeSourceCount: 4,
        starvationSeverity: 'strong',
        isolatedSource: true,
      })
    ).toBe(169);
  });

  it('adds dynamic ceiling lift before global cap', () => {
    const base = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 1,
      dynamicCeilingLiftMs: 40,
    });
    const noLift = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 1,
    });
    expect(base).toBe(noLift + 40);
  });

  it('uses one combined dynamic lift (caller passes max of starvation vs micro-widen)', () => {
    const noLift = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 1,
    });
    const maxLift = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 1,
      dynamicCeilingLiftMs: 50,
    });
    const wronglySummed = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 145,
      profileAdaptiveSevereMaxMs: 185,
      useSevereCeiling: false,
      activeSourceCount: 1,
      dynamicCeilingLiftMs: 90,
    });
    expect(maxLift - noLift).toBe(50);
    expect(wronglySummed - noLift).toBe(90);
    expect(maxLift).toBeLessThan(wronglySummed);
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

  it('softens severe ceiling when isolationCeilingSoftened', () => {
    // Use profile caps below global cap so the softened vs severe distinction is visible.
    const severe = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 120,
      profileAdaptiveSevereMaxMs: 140,
      useSevereCeiling: true,
      activeSourceCount: 1,
      isolationCeilingSoftened: true,
    });
    const full = effectivePlayoutMaxTargetMs({
      profileAdaptiveMaxMs: 120,
      profileAdaptiveSevereMaxMs: 140,
      useSevereCeiling: true,
      activeSourceCount: 1,
    });
    expect(severe).toBeLessThan(full);
    expect(severe).toBe(130);
    expect(full).toBe(140);
  });

  it('micro-widen v1 eligible when variance rises vs baseline segment', () => {
    const baselineSeg = Array.from({ length: 15 }, (_, i) => 20 + (i % 3) * 0.2);
    const currentSeg = Array.from({ length: 15 }, (_, i) => 20 + i * 1.5);
    const ring = [...baselineSeg, ...currentSeg];
    const r = computeMicroWidenExtraMsV1({
      interArrivalSamplesMs: ring,
      M: 15,
      epsilon: 0.05,
      Wms: 8,
    });
    expect(r.eligible).toBe(true);
    expect(r.extraMs).toBe(8);
    expect(r.currentVarMs2).toBeGreaterThan(r.effectiveBaselineVarMs2 * 1.05);
  });

  it('micro-widen v1 not eligible with fewer than 2M samples', () => {
    const r = computeMicroWidenExtraMsV1({
      interArrivalSamplesMs: [20, 21, 20],
      M: 15,
    });
    expect(r.eligible).toBe(false);
  });

  it('varianceOfSliceMs2 matches population variance', () => {
    expect(varianceOfSliceMs2([2, 4])).toBe(1);
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
