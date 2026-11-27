export const AUTO_LOCK_TIMEOUT_OPTIONS = [0, 10, 30, 60, 180] as const;

export type AutoLockTimeoutMinutes = (typeof AUTO_LOCK_TIMEOUT_OPTIONS)[number];

export const DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES: AutoLockTimeoutMinutes = 30;

export function normalizeAutoLockTimeoutMinutes(
  value: unknown
): AutoLockTimeoutMinutes {
  const numericValue = Number(value);
  return AUTO_LOCK_TIMEOUT_OPTIONS.includes(
    numericValue as AutoLockTimeoutMinutes
  )
    ? (numericValue as AutoLockTimeoutMinutes)
    : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES;
}

export function resolveAutoLockTimeoutMinutes(
  value: unknown,
  legacyDisabled: boolean
): AutoLockTimeoutMinutes {
  return value == null
    ? legacyDisabled
      ? 0
      : DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES
    : normalizeAutoLockTimeoutMinutes(value);
}

export function isAutoLockDue(
  lastActivityAt: number,
  now: number,
  timeoutMinutes: AutoLockTimeoutMinutes
): boolean {
  return (
    timeoutMinutes > 0 && now - lastActivityAt >= timeoutMinutes * 60 * 1_000
  );
}
