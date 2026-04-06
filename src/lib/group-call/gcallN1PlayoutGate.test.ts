import { describe, expect, it } from 'vitest';
import {
  computeN1BufferEnforceTier,
  computeN1BufferRatio,
  computeN1MinStartMs,
  computeN1TierBurstCap,
  stepN1BufferEnforceTier,
  GCALL_N1_RATIO_DEEP,
  GCALL_N1_RATIO_MODERATE,
} from './gcallN1PlayoutGate';

describe('gcallN1PlayoutGate', () => {
  it('computeN1MinStartMs clamps to floor/ceil', () => {
    expect(computeN1MinStartMs(50)).toBe(100);
    expect(computeN1MinStartMs(120)).toBe(120);
    expect(computeN1MinStartMs(145)).toBe(145);
    expect(computeN1MinStartMs(400)).toBe(185);
  });

  it('computeN1BufferRatio uses max target floor', () => {
    const a = computeN1BufferRatio(45, 145);
    expect(a.denomMs).toBe(145);
    expect(a.ratio).toBeCloseTo(45 / 145, 5);
    const b = computeN1BufferRatio(50, 0);
    expect(b.denomMs).toBe(100);
    expect(b.ratio).toBe(0.5);
  });

  it('computeN1BufferEnforceTier matches bands', () => {
    expect(computeN1BufferEnforceTier(GCALL_N1_RATIO_DEEP - 0.01)).toBe('deep');
    expect(computeN1BufferEnforceTier((GCALL_N1_RATIO_DEEP + GCALL_N1_RATIO_MODERATE) / 2)).toBe(
      'moderate'
    );
    expect(computeN1BufferEnforceTier(0.6)).toBe('normal');
  });

  it('stepN1BufferEnforceTier adds hysteresis around the boundaries', () => {
    expect(stepN1BufferEnforceTier('deep', 0.33)).toBe('deep');
    expect(stepN1BufferEnforceTier('deep', 0.4)).toBe('moderate');
    expect(stepN1BufferEnforceTier('moderate', 0.3)).toBe('moderate');
    expect(stepN1BufferEnforceTier('moderate', 0.27)).toBe('deep');
    expect(stepN1BufferEnforceTier('moderate', 0.5)).toBe('moderate');
    expect(stepN1BufferEnforceTier('moderate', 0.53)).toBe('normal');
    expect(stepN1BufferEnforceTier('normal', 0.47)).toBe('normal');
    expect(stepN1BufferEnforceTier('normal', 0.45)).toBe('moderate');
  });

  it('computeN1TierBurstCap', () => {
    expect(computeN1TierBurstCap('deep', 11)).toBe(1);
    expect(
      computeN1TierBurstCap('deep', 11, { recoverySingleRemote: true })
    ).toBe(4);
    expect(computeN1TierBurstCap('moderate', 11)).toBe(6);
    expect(computeN1TierBurstCap('normal', 11)).toBe(11);
  });
});
