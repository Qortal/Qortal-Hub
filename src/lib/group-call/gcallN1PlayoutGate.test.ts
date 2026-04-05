import { describe, expect, it } from 'vitest';
import {
  computeN1BufferEnforceTier,
  computeN1BufferRatio,
  computeN1MinStartMs,
  computeN1TierBurstCap,
  GCALL_N1_RATIO_DEEP,
  GCALL_N1_RATIO_MODERATE,
} from './gcallN1PlayoutGate';

describe('gcallN1PlayoutGate', () => {
  it('computeN1MinStartMs clamps to floor/ceil', () => {
    expect(computeN1MinStartMs(50)).toBe(180);
    expect(computeN1MinStartMs(220)).toBe(220);
    expect(computeN1MinStartMs(400)).toBe(280);
  });

  it('computeN1BufferRatio uses max target floor', () => {
    const a = computeN1BufferRatio(45, 220);
    expect(a.denomMs).toBe(220);
    expect(a.ratio).toBeCloseTo(45 / 220, 5);
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

  it('computeN1TierBurstCap', () => {
    expect(computeN1TierBurstCap('deep', 11)).toBe(1);
    expect(
      computeN1TierBurstCap('deep', 11, { recoverySingleRemote: true })
    ).toBe(2);
    expect(computeN1TierBurstCap('moderate', 11)).toBe(4);
    expect(computeN1TierBurstCap('normal', 11)).toBe(11);
  });
});
