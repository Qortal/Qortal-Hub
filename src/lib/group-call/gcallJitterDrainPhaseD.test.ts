import { describe, expect, it } from 'vitest';
import {
  computeMultiSourceFairBurstCap,
  computeMultiSourceAccumulationTargetFrames,
  computePhaseDSourceBurstBonus,
  computeGlobalDecodeBudget,
  computeOrderedDrainAddresses,
  computePerSourceCap,
  computeProtectedDecodeCap,
  computeProtectedDecodeCapForBreach,
  computeWeakLegServiceFloor,
  isCollapsedForStarvation,
  isNearCollapsedForStarvation,
  shouldHoldMultiSourceAccumulation,
  shouldEnterProtectedMode,
  shouldExitProtectedMode,
  shouldPrioritizeWeakMultiSourceLeg,
  starvationRecoveryBarSatisfied,
} from './gcallJitterDrainPhaseD';

describe('computePerSourceCap', () => {
  it('matches linear / N split with floor 2', () => {
    expect(computePerSourceCap(11, 1)).toBe(11);
    expect(computePerSourceCap(11, 2)).toBe(6);
    expect(computePerSourceCap(11, 3)).toBe(4);
    expect(computePerSourceCap(8, 4)).toBe(2);
  });
});

describe('computeGlobalDecodeBudget', () => {
  it('caps total decodes at MAX_GLOBAL_DECODES_PER_TICK', () => {
    expect(computeGlobalDecodeBudget(3, 6)).toBe(16);
    expect(computeGlobalDecodeBudget(2, 6)).toBe(12);
    expect(computeGlobalDecodeBudget(1, 11)).toBe(11);
  });
});

describe('computeProtectedDecodeCap', () => {
  it('is min(8, ceil(globalBudget * 0.5))', () => {
    expect(computeProtectedDecodeCap(16)).toBe(8);
    expect(computeProtectedDecodeCap(10)).toBe(5);
    expect(computeProtectedDecodeCap(3)).toBe(2);
  });

  it('adds bounded headroom for multi-breach', () => {
    expect(computeProtectedDecodeCapForBreach(16, 1)).toBe(8);
    expect(computeProtectedDecodeCapForBreach(16, 2)).toBe(10);
  });
});

describe('computeMultiSourceAccumulationTargetFrames', () => {
  it('holds protected multi-source peers until they rebuild a bounded reserve', () => {
    expect(
      computeMultiSourceAccumulationTargetFrames({
        adaptiveTargetMedianMs: 180,
        protectedMode: true,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(6);
    expect(
      computeMultiSourceAccumulationTargetFrames({
        adaptiveTargetMedianMs: 140,
        protectedMode: true,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(5);
  });

  it('returns null for healthy non-protected sources', () => {
    expect(
      computeMultiSourceAccumulationTargetFrames({
        adaptiveTargetMedianMs: 160,
        protectedMode: false,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(null);
  });
});

describe('shouldHoldMultiSourceAccumulation', () => {
  it('keeps a protected source on hold until it has both frames and reserve', () => {
    expect(
      shouldHoldMultiSourceAccumulation({
        bufferedFrames: 5,
        opusBufferedMs: 55,
        adaptiveTargetMedianMs: 145,
        protectedMode: true,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldHoldMultiSourceAccumulation({
        bufferedFrames: 5,
        opusBufferedMs: 85,
        adaptiveTargetMedianMs: 145,
        protectedMode: true,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
  });

  it('returns false for healthy non-protected sources', () => {
    expect(
      shouldHoldMultiSourceAccumulation({
        bufferedFrames: 5,
        opusBufferedMs: 100,
        adaptiveTargetMedianMs: 145,
        protectedMode: false,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(false);
  });
});

describe('shouldPrioritizeWeakMultiSourceLeg', () => {
  it('prioritizes protected or strongly starved multi-source legs', () => {
    expect(
      shouldPrioritizeWeakMultiSourceLeg({
        activeSourceCount: 2,
        bufferedFrames: 4,
        opusBufferedMs: 80,
        adaptiveTargetMedianMs: 160,
        protectedMode: true,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(true);
    expect(
      shouldPrioritizeWeakMultiSourceLeg({
        activeSourceCount: 2,
        bufferedFrames: 5,
        opusBufferedMs: 100,
        adaptiveTargetMedianMs: 160,
        protectedMode: false,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
  });

  it('prioritizes a mildly starved near-collapsed leg but not a healthy one', () => {
    expect(
      shouldPrioritizeWeakMultiSourceLeg({
        activeSourceCount: 2,
        bufferedFrames: 4,
        opusBufferedMs: 75,
        adaptiveTargetMedianMs: 180,
        protectedMode: false,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(true);
    expect(
      shouldPrioritizeWeakMultiSourceLeg({
        activeSourceCount: 2,
        bufferedFrames: 7,
        opusBufferedMs: 130,
        adaptiveTargetMedianMs: 180,
        protectedMode: false,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
  });
});

describe('computeWeakLegServiceFloor', () => {
  it('reserves a small bounded service floor for weak legs', () => {
    expect(
      computeWeakLegServiceFloor({ globalDecodeBudget: 16, weakLegCount: 1 })
    ).toBe(1);
    expect(
      computeWeakLegServiceFloor({ globalDecodeBudget: 16, weakLegCount: 3 })
    ).toBe(2);
    expect(
      computeWeakLegServiceFloor({ globalDecodeBudget: 6, weakLegCount: 0 })
    ).toBe(0);
  });
});

describe('computeMultiSourceFairBurstCap', () => {
  it('shaves strong-leg burst share only when a weak leg is present', () => {
    expect(
      computeMultiSourceFairBurstCap({
        baseCap: 4,
        weakLegPresent: true,
        prioritizeWeakLeg: false,
      })
    ).toBe(3);
    expect(
      computeMultiSourceFairBurstCap({
        baseCap: 4,
        weakLegPresent: true,
        prioritizeWeakLeg: false,
        strictWeakLegProtection: true,
      })
    ).toBe(2);
    expect(
      computeMultiSourceFairBurstCap({
        baseCap: 4,
        weakLegPresent: true,
        prioritizeWeakLeg: true,
      })
    ).toBe(4);
    expect(
      computeMultiSourceFairBurstCap({
        baseCap: 1,
        weakLegPresent: true,
        prioritizeWeakLeg: false,
      })
    ).toBe(1);
  });
});

describe('starvationRecoveryBarSatisfied', () => {
  it('requires depth floor', () => {
    expect(
      starvationRecoveryBarSatisfied({
        bufferedFrames: 2,
        opusBufferedMs: 200,
        minOpusLastMTicks: 0,
        adaptiveTargetMedianMs: 100,
      })
    ).toBe(false);
  });

  it('accepts (2b) when opus >= beta * target', () => {
    expect(
      starvationRecoveryBarSatisfied({
        bufferedFrames: 3,
        opusBufferedMs: 40,
        minOpusLastMTicks: 0,
        adaptiveTargetMedianMs: 100,
      })
    ).toBe(true);
  });

  it('keeps the recovery bar blocked while playout starvation is still strong', () => {
    expect(
      starvationRecoveryBarSatisfied({
        bufferedFrames: 4,
        opusBufferedMs: 60,
        minOpusLastMTicks: 20,
        adaptiveTargetMedianMs: 100,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
  });
});

describe('isCollapsedForStarvation', () => {
  it('detects thin buffer or opus below beta * target', () => {
    expect(
      isCollapsedForStarvation({
        bufferedFrames: 2,
        opusBufferedMs: 40,
        adaptiveTargetMedianMs: 200,
      })
    ).toBe(true);
    expect(
      isCollapsedForStarvation({
        bufferedFrames: 5,
        opusBufferedMs: 60,
        adaptiveTargetMedianMs: 200,
      })
    ).toBe(true);
    expect(
      isCollapsedForStarvation({
        bufferedFrames: 5,
        opusBufferedMs: 80,
        adaptiveTargetMedianMs: 200,
      })
    ).toBe(false);
  });
});

describe('shouldEnterProtectedMode', () => {
  it('keeps collapsed sources protected regardless of severity', () => {
    expect(
      shouldEnterProtectedMode({
        collapsed: true,
        starvationSeverity: 'none',
      })
    ).toBe(true);
  });

  it('protects strongly starved sources even before opus reserve collapses', () => {
    expect(
      shouldEnterProtectedMode({
        collapsed: false,
        starvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldEnterProtectedMode({
        collapsed: false,
        starvationSeverity: 'mild',
      })
    ).toBe(false);
  });

  it('protects mildly starved sources once they are near collapse', () => {
    expect(
      shouldEnterProtectedMode({
        collapsed: false,
        nearCollapsed: true,
        starvationSeverity: 'mild',
      })
    ).toBe(true);
  });
});

describe('isNearCollapsedForStarvation', () => {
  it('trips before full collapse when the source is still very thin', () => {
    expect(
      isNearCollapsedForStarvation({
        bufferedFrames: 4,
        opusBufferedMs: 80,
        adaptiveTargetMedianMs: 200,
      })
    ).toBe(true);
    expect(
      isNearCollapsedForStarvation({
        bufferedFrames: 5,
        opusBufferedMs: 120,
        adaptiveTargetMedianMs: 200,
      })
    ).toBe(false);
  });
});

describe('shouldExitProtectedMode', () => {
  it('waits for playout starvation to fully clear before exiting protected mode', () => {
    expect(
      shouldExitProtectedMode({
        bufferedFrames: 4,
        recoveryBarSatisfied: true,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
    expect(
      shouldExitProtectedMode({
        bufferedFrames: 4,
        recoveryBarSatisfied: true,
        playoutStarvationSeverity: 'none',
      })
    ).toBe(true);
  });
});

describe('computePhaseDSourceBurstBonus', () => {
  it('gives extra help to protected thin sources without boosting healthy ones', () => {
    expect(
      computePhaseDSourceBurstBonus({
        initialBufferedFrames: 2,
        thinBufferThresholdFrames: 2,
        protectedMode: true,
        starvationSeverity: 'mild',
      })
    ).toBe(2);
    expect(
      computePhaseDSourceBurstBonus({
        initialBufferedFrames: 2,
        thinBufferThresholdFrames: 2,
        protectedMode: false,
        starvationSeverity: 'none',
      })
    ).toBe(1);
    expect(
      computePhaseDSourceBurstBonus({
        initialBufferedFrames: 5,
        thinBufferThresholdFrames: 2,
        protectedMode: true,
        starvationSeverity: 'strong',
      })
    ).toBe(0);
  });
});

describe('computeOrderedDrainAddresses', () => {
  it('orders empty first, then unprimed, then ready by EMA then depth', () => {
    const jb = {
      a: { getBufferedFrames: () => 0, hasReadyFrame: () => false },
      b: { getBufferedFrames: () => 3, hasReadyFrame: () => false },
      c: { getBufferedFrames: () => 5, hasReadyFrame: () => true },
      d: { getBufferedFrames: () => 4, hasReadyFrame: () => true },
    };
    const ema = new Map<string, number>([
      ['c', 0.5],
      ['d', 0.2],
    ]);
    const out = computeOrderedDrainAddresses(
      ['a', 'b', 'c', 'd'],
      (addr) => jb[addr as keyof typeof jb],
      ema,
      0
    );
    expect(out[0]).toBe('a');
    expect(out[1]).toBe('b');
    expect(out[2]).toBe('c');
    expect(out[3]).toBe('d');
  });

  it('breaks ties by thinner buffer when EMA equal', () => {
    const jb = {
      a: { getBufferedFrames: () => 2, hasReadyFrame: () => true },
      b: { getBufferedFrames: () => 5, hasReadyFrame: () => true },
    };
    const ema = new Map<string, number>([
      ['a', 0.1],
      ['b', 0.1],
    ]);
    const out = computeOrderedDrainAddresses(
      ['a', 'b'],
      (addr) => jb[addr as keyof typeof jb],
      ema,
      0
    );
    expect(out[0]).toBe('a');
    expect(out[1]).toBe('b');
  });
});
