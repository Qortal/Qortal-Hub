import { describe, expect, it } from 'vitest';
import {
  computePendingDecryptLimits,
  PENDING_DECRYPT_BURST_MAX,
  PENDING_DECRYPT_BURST_TTL_MS,
  PENDING_DECRYPT_MAX,
  PENDING_DECRYPT_RECOVERY_MAX,
  PENDING_DECRYPT_RECOVERY_TTL_MS,
  PENDING_DECRYPT_TTL_MS,
} from './pendingDecryptLimits';

describe('computePendingDecryptLimits', () => {
  it('uses steady-state limits when no recovery or burst window', () => {
    const now = 10_000;
    expect(
      computePendingDecryptLimits(now, 0, 0)
    ).toEqual({ max: PENDING_DECRYPT_MAX, ttlMs: PENDING_DECRYPT_TTL_MS });
  });

  it('prefers burst limits over global recovery when both are active', () => {
    const now = 5_000;
    const globalUntil = 20_000;
    const burstUntil = 8_000;
    expect(computePendingDecryptLimits(now, globalUntil, burstUntil)).toEqual({
      max: PENDING_DECRYPT_BURST_MAX,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    });
  });

  it('uses recovery limits after burst expires but global recovery remains', () => {
    const now = 10_000;
    const globalUntil = 20_000;
    const burstUntil = 5_000;
    expect(computePendingDecryptLimits(now, globalUntil, burstUntil)).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
  });

  it('uses recovery limits when global recovery active and no burst', () => {
    const now = 10_000;
    const globalUntil = 20_000;
    expect(computePendingDecryptLimits(now, globalUntil, 0)).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
  });

  it('treats boundary at exactly globalRecoveryUntilMs as steady state', () => {
    const t = 10_000;
    expect(computePendingDecryptLimits(t, t, 0)).toEqual({
      max: PENDING_DECRYPT_MAX,
      ttlMs: PENDING_DECRYPT_TTL_MS,
    });
  });

  it('treats boundary at exactly decryptBurstUntilMs as recovery or steady', () => {
    const t = 10_000;
    expect(computePendingDecryptLimits(t, 0, t)).toEqual({
      max: PENDING_DECRYPT_MAX,
      ttlMs: PENDING_DECRYPT_TTL_MS,
    });
  });
});
