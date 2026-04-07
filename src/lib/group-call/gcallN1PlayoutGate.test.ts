import { describe, expect, it } from 'vitest';
import {
  computeN1BufferEnforceTier,
  computeN1BufferRatio,
  computeN1MinStartMs,
  shouldForceN1RecoveryPrerollSatisfied,
  computeN1SteadyMinHoldMs,
  computeN1SteadyTierBurstCap,
  computeN1TierBurstCap,
  stepN1SteadyBufferEnforceTier,
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

  it('computeN1SteadyMinHoldMs keeps a small steady-state reserve', () => {
    expect(computeN1SteadyMinHoldMs(0)).toBe(30);
    expect(computeN1SteadyMinHoldMs(120)).toBe(36);
    expect(computeN1SteadyMinHoldMs(145)).toBe(40);
    expect(computeN1SteadyMinHoldMs(400)).toBe(40);
  });

  it('allows recovery preroll to release early for a live thin source', () => {
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 200,
        lastPushAgeMs: 40,
        opusBufferedMs: 20,
        sourceActive: true,
      })
    ).toBe(true);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 120,
        lastPushAgeMs: 40,
        opusBufferedMs: 20,
        sourceActive: true,
      })
    ).toBe(false);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 200,
        lastPushAgeMs: 180,
        opusBufferedMs: 20,
        sourceActive: true,
      })
    ).toBe(false);
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

  it('stepN1SteadyBufferEnforceTier is weaker than recovery hysteresis', () => {
    expect(stepN1SteadyBufferEnforceTier('deep', 0.27)).toBe('deep');
    expect(stepN1SteadyBufferEnforceTier('deep', 0.3)).toBe('moderate');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.23)).toBe('moderate');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.21)).toBe('deep');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.41)).toBe('moderate');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.43)).toBe('normal');
    expect(stepN1SteadyBufferEnforceTier('normal', 0.36)).toBe('normal');
    expect(stepN1SteadyBufferEnforceTier('normal', 0.35)).toBe('moderate');
  });

  it('computeN1TierBurstCap', () => {
    expect(computeN1TierBurstCap('deep', 11)).toBe(1);
    expect(
      computeN1TierBurstCap('deep', 11, { recoverySingleRemote: true })
    ).toBe(4);
    expect(computeN1TierBurstCap('moderate', 11)).toBe(6);
    expect(computeN1TierBurstCap('normal', 11)).toBe(11);
  });

  it('computeN1SteadyTierBurstCap is gentler than recovery shaping', () => {
    expect(computeN1SteadyTierBurstCap('deep', 11)).toBe(2);
    expect(computeN1SteadyTierBurstCap('moderate', 11)).toBe(5);
    expect(computeN1SteadyTierBurstCap('normal', 11)).toBe(7);
  });
});
