/**
 * Pending decrypt queue limits for the audio decrypt worker path.
 * Burst limits apply after key sync or participant join to absorb post-rejoin bursts.
 */

export const PENDING_DECRYPT_MAX = 96;
export const PENDING_DECRYPT_TTL_MS = 500;

export const PENDING_DECRYPT_RECOVERY_MAX = 192;
export const PENDING_DECRYPT_RECOVERY_TTL_MS = 1000;

/** Extra headroom and TTL only while `decryptBurstUntilMs` is in the future. */
export const PENDING_DECRYPT_BURST_EXTEND_MS = 3000;
export const PENDING_DECRYPT_BURST_MAX = 320;
export const PENDING_DECRYPT_BURST_TTL_MS = 1800;

export function computePendingDecryptLimits(
  nowMs: number,
  globalRecoveryUntilMs: number,
  decryptBurstUntilMs: number
): { max: number; ttlMs: number } {
  if (nowMs < decryptBurstUntilMs) {
    return {
      max: PENDING_DECRYPT_BURST_MAX,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    };
  }
  if (nowMs < globalRecoveryUntilMs) {
    return {
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    };
  }
  return { max: PENDING_DECRYPT_MAX, ttlMs: PENDING_DECRYPT_TTL_MS };
}
