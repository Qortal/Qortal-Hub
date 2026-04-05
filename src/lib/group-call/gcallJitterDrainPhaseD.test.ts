import { describe, expect, it } from 'vitest';
import {
  computeGlobalDecodeBudget,
  computeOrderedDrainAddresses,
  computePerSourceCap,
  computeProtectedDecodeCap,
  computeProtectedDecodeCapForBreach,
  isCollapsedForStarvation,
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
