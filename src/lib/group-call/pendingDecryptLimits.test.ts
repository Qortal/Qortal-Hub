import { describe, expect, it } from 'vitest';
import {
  computePendingDecryptLimits,
  computeRequestedBurstMaxFromSignals,
  GLOBAL_MAX_BURST_MAX,
  PENDING_DECRYPT_BURST_NOMINAL_BASE,
  PENDING_DECRYPT_BURST_TTL_MS,
  PENDING_DECRYPT_MAX,
  PENDING_DECRYPT_RECOVERY_MAX,
  PENDING_DECRYPT_RECOVERY_TTL_MS,
  PENDING_DECRYPT_TTL_MS,
  slewBurstMaxTowardRequested,
} from './pendingDecryptLimits';

describe('computePendingDecryptLimits', () => {
  it('uses steady-state limits when no recovery or burst window', () => {
    const now = 10_000;
    expect(computePendingDecryptLimits(now, 0, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual(
      { max: PENDING_DECRYPT_MAX, ttlMs: PENDING_DECRYPT_TTL_MS }
    );
  });

  it('prefers burst limits over global recovery when both are active', () => {
    const now = 5_000;
    const globalUntil = 20_000;
    const burstUntil = 8_000;
    expect(
      computePendingDecryptLimits(now, globalUntil, burstUntil, PENDING_DECRYPT_BURST_NOMINAL_BASE)
    ).toEqual({
      max: PENDING_DECRYPT_BURST_NOMINAL_BASE,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    });
  });

  it('uses recovery limits after burst expires but global recovery remains', () => {
    const now = 10_000;
    const globalUntil = 20_000;
    const burstUntil = 5_000;
    expect(
      computePendingDecryptLimits(now, globalUntil, burstUntil, PENDING_DECRYPT_BURST_NOMINAL_BASE)
    ).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
  });

  it('uses recovery limits when global recovery active and no burst', () => {
    const now = 10_000;
    const globalUntil = 20_000;
    expect(computePendingDecryptLimits(now, globalUntil, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
  });

  it('treats boundary at exactly globalRecoveryUntilMs as steady state', () => {
    const t = 10_000;
    expect(computePendingDecryptLimits(t, t, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual({
      max: PENDING_DECRYPT_MAX,
      ttlMs: PENDING_DECRYPT_TTL_MS,
    });
  });

  it('treats boundary at exactly decryptBurstUntilMs as recovery or steady', () => {
    const t = 10_000;
    expect(computePendingDecryptLimits(t, 0, t, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual({
      max: PENDING_DECRYPT_MAX,
      ttlMs: PENDING_DECRYPT_TTL_MS,
    });
  });

  it('clamps dynamic burst max to global ceiling', () => {
    const now = 10_000;
    expect(
      computePendingDecryptLimits(now, 0, 20_000, GLOBAL_MAX_BURST_MAX + 1_000)
    ).toEqual({
      max: GLOBAL_MAX_BURST_MAX,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    });
  });

  it('uses dynamic burst limits while decrypt overload is active', () => {
    const now = 10_000;
    expect(
      computePendingDecryptLimits(now, 0, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE, true)
    ).toEqual({
      max: PENDING_DECRYPT_BURST_NOMINAL_BASE,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    });
  });
});

describe('computeRequestedBurstMaxFromSignals', () => {
  it('returns at least nominal base and at most global max', () => {
    const r = computeRequestedBurstMaxFromSignals({
      peerCount: 50,
      ingressPacketsPerSec: 200,
      peakDepthRecent: 500,
    });
    expect(r).toBeGreaterThanOrEqual(PENDING_DECRYPT_BURST_NOMINAL_BASE);
    expect(r).toBeLessThanOrEqual(GLOBAL_MAX_BURST_MAX);
  });

  it('adds forwarder boost when isForwarder is true', () => {
    // Signals above nominal floor but below GLOBAL cap so +24 is visible (not swallowed by floor/cap).
    const base = computeRequestedBurstMaxFromSignals({
      peerCount: 10,
      ingressPacketsPerSec: 0,
      peakDepthRecent: 127,
      isForwarder: false,
    });
    const boosted = computeRequestedBurstMaxFromSignals({
      peerCount: 10,
      ingressPacketsPerSec: 0,
      peakDepthRecent: 127,
      isForwarder: true,
    });
    expect(boosted - base).toBe(24);
  });
});

describe('slewBurstMaxTowardRequested', () => {
  it('ramps downward immediately to requested', () => {
    expect(slewBurstMaxTowardRequested(320, 200, 1000)).toBe(200);
  });

  it('limits upward steps per second', () => {
    expect(slewBurstMaxTowardRequested(320, 400, 1000)).toBe(320 + 48);
  });
});
