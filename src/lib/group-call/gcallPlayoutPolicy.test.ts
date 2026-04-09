import { describe, expect, it } from 'vitest';
import type { GroupCallSourceWindowMetrics } from './router';
import {
  computeFeasibleSingleRemoteRecoveryTargetMaxMs,
  computeFeasibleMultiSourceRecoveryTargetMaxMs,
  computeRecoveryMultiSourceTargetMaxMs,
  computeUsableRecoveryTargetMaxMs,
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
        activeSourceCount: 1,
        starvationSeverity: 'none',
      })
    ).toBe(null);
    expect(
      computeRecoveryMultiSourceTargetMaxMs({
        profileAdaptiveMaxMs: 145,
        profileAdaptiveSevereMaxMs: 185,
        activeSourceCount: 2,
        starvationSeverity: 'none',
      })
    ).toBe(155);
    expect(
      computeRecoveryMultiSourceTargetMaxMs({
        profileAdaptiveMaxMs: 145,
        profileAdaptiveSevereMaxMs: 185,
        activeSourceCount: 2,
        starvationSeverity: 'strong',
        isolatedSource: true,
      })
    ).toBe(153);
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
    ).toBe(155);
  });

  it('adds a feasibility clamp when a multi-source recovery source cannot hold the target', () => {
    expect(
      computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 164,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'strong',
        isolatedSource: true,
        previousStarvationSeverity: 'mild',
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -164,
        avgOpusBufferedMs: 20,
        observedTargetMs: 164,
      })
    ).toBe(100);
    expect(
      computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 155,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'none',
        isolatedSource: false,
        previousStarvationSeverity: 'none',
        playoutUnderTargetFraction: 0.2,
        avgPlayoutDeltaMs: -10,
        avgOpusBufferedMs: 90,
        observedTargetMs: 140,
      })
    ).toBe(null);
  });

  it('clamps a 1-on-1 recovery target when the peer cannot hold the observed reserve', () => {
    expect(
      computeFeasibleSingleRemoteRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        previousStarvationSeverity: 'mild',
        playoutUnderTargetFraction: 0.633,
        avgPlayoutDeltaMs: -57.264,
        avgOpusBufferedMs: 41.897,
        observedTargetMs: 145,
      })
    ).toBe(100);
  });

  it('does not clamp a healthy 1-on-1 recovery peer just because the target is elevated', () => {
    expect(
      computeFeasibleSingleRemoteRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'none',
        previousStarvationSeverity: 'none',
        playoutUnderTargetFraction: 0.177,
        avgPlayoutDeltaMs: 25.324,
        avgOpusBufferedMs: 88,
        observedTargetMs: 145,
      })
    ).toBe(null);
  });

  it('clamps a weak-but-usable 1-on-1 recovery path closer to the sustained PCM reserve', () => {
    expect(
      computeUsableRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        recentSampleCount: 4,
        recentAvgPcmBufferedMs: 102.456,
        recentPlayoutUnderTargetFraction: 0.5,
        previousWindowAvgPlayoutDeltaMs: -18.967,
      })
    ).toBe(113);
  });

  it('clamps a weak multi-source recovery leg toward usable PCM instead of an inflated ceiling', () => {
    expect(
      computeUsableRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 155,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        isolatedSource: true,
        recentSampleCount: 4,
        recentAvgPcmBufferedMs: 96,
        recentPlayoutUnderTargetFraction: 0.62,
        previousWindowAvgPlayoutDeltaMs: -32,
      })
    ).toBe(114);
  });

  it('can clamp acute 1-on-1 mismatch on the first bad window', () => {
    expect(
      computeFeasibleSingleRemoteRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 142,
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'none',
        previousStarvationSeverity: 'none',
        playoutUnderTargetFraction: 0.7,
        avgPlayoutDeltaMs: -62,
        avgOpusBufferedMs: 46,
        observedTargetMs: 142,
      })
    ).toBe(100);
  });

  it('only applies the mild feasibility clamp after starvation persists across windows', () => {
    expect(
      computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 155,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        isolatedSource: false,
        previousStarvationSeverity: 'none',
        playoutUnderTargetFraction: 0.9,
        avgPlayoutDeltaMs: -80,
        avgOpusBufferedMs: 40,
        observedTargetMs: 150,
      })
    ).toBe(null);
    expect(
      computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 155,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        isolatedSource: false,
        previousStarvationSeverity: 'mild',
        playoutUnderTargetFraction: 0.9,
        avgPlayoutDeltaMs: -80,
        avgOpusBufferedMs: 40,
        observedTargetMs: 150,
      })
    ).toBe(100);
  });

  it('clamps a pressure-tightened 2+ recovery target when observed reserve is far below the ceiling', () => {
    expect(
      computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 185,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        isolatedSource: false,
        shouldTightenRecovery: true,
        previousStarvationSeverity: 'none',
        playoutUnderTargetFraction: 0.775,
        avgPlayoutDeltaMs: -89.944,
        avgOpusBufferedMs: 77.68,
        observedTargetMs: 185,
      })
    ).toBe(114);
  });

  it('clamps an isolated worst source earlier than the generic feasibility path', () => {
    expect(
      computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: 145,
        activeSourceCount: 2,
        adaptiveNetworkMode: 'recovery',
        starvationSeverity: 'mild',
        isolatedSource: true,
        previousStarvationSeverity: 'none',
        playoutUnderTargetFraction: 0.65,
        avgPlayoutDeltaMs: -52,
        avgOpusBufferedMs: 42,
        observedTargetMs: 145,
      })
    ).toBe(100);
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
        playoutOutsideTargetFraction: 1,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -120,
        avgOpusBufferedMs: 20,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 120,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 200,
      },
      {
        sourceAddr: 'bob',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 18,
        playoutOutsideTargetFraction: 0.8,
        playoutUnderTargetFraction: 0.7,
        avgPlayoutDeltaMs: -75,
        avgOpusBufferedMs: 32,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 110,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 170,
      },
    ];
    const second = pickSecondIsolationCandidate(sources, 'alice');
    expect(second).toBe('bob');
  });

  it('does not pick a second isolation peer that is merely high-target but healthy', () => {
    const sources: GroupCallSourceWindowMetrics[] = [
      {
        sourceAddr: 'alice',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 12,
        playoutOutsideTargetFraction: 1,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -110,
        avgOpusBufferedMs: 20,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 120,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 180,
      },
      {
        sourceAddr: 'bob',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 90,
        playoutOutsideTargetFraction: 0.1,
        playoutUnderTargetFraction: 0.1,
        avgPlayoutDeltaMs: -10,
        avgOpusBufferedMs: 92,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 110,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 170,
      },
    ];
    expect(pickSecondIsolationCandidate(sources, 'alice')).toBe(null);
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
