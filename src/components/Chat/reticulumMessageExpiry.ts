import {
  TIME_DAYS_1_IN_MILLISECONDS,
  TIME_MONTHS_1_IN_MILLISECONDS,
  TIME_WEEKS_1_IN_MILLISECONDS,
} from '../../constants/constants';

export type ReticulumMessageExpiryOption = {
  durationMs: number;
  label: string;
  shortLabel: string;
};

export const RETICULUM_MESSAGE_EXPIRY_OPTIONS: readonly ReticulumMessageExpiryOption[] =
  [
    {
      durationMs: TIME_DAYS_1_IN_MILLISECONDS,
      label: '1 day',
      shortLabel: '1D',
    },
    {
      durationMs: 2 * TIME_DAYS_1_IN_MILLISECONDS,
      label: '2 days',
      shortLabel: '2D',
    },
    {
      durationMs: 3 * TIME_DAYS_1_IN_MILLISECONDS,
      label: '3 days',
      shortLabel: '3D',
    },
    {
      durationMs: TIME_WEEKS_1_IN_MILLISECONDS,
      label: '1 week',
      shortLabel: '1W',
    },
    {
      durationMs: TIME_MONTHS_1_IN_MILLISECONDS,
      label: '1 month',
      shortLabel: '1M',
    },
  ];

const RETICULUM_EXPIRY_PREFERENCE_STORAGE_PREFIX =
  'qchat-reticulum-expiry-preference-v1';

function normalizeExpiryDurationMs(value: unknown): number | undefined {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return Math.floor(duration);
}

function normalizeMessageExpiryOption(value: unknown): number | undefined {
  const duration = normalizeExpiryDurationMs(value);
  return RETICULUM_MESSAGE_EXPIRY_OPTIONS.some(
    (option) => option.durationMs === duration
  )
    ? duration
    : undefined;
}

export function resolveReticulumPreferredMessageExpiryDurationMs(
  preferredDurationMs: number | null | undefined,
  channelExpiryDurationMs?: number
): number | null | undefined {
  if (preferredDurationMs === null) return null;
  const preferredDuration = normalizeMessageExpiryOption(preferredDurationMs);
  return preferredDuration !== undefined &&
    isReticulumMessageExpiryOptionAllowed(
      preferredDuration,
      channelExpiryDurationMs
    )
    ? preferredDuration
    : undefined;
}

export function reticulumMessageExpiryPreferenceStorageKey(
  accountAddress: string,
  groupId: number | string,
  channelId?: string
): string | null {
  const normalizedAddress = String(accountAddress || '')
    .trim()
    .toLowerCase();
  const normalizedGroupId = Number(groupId);
  if (
    !normalizedAddress ||
    !Number.isInteger(normalizedGroupId) ||
    normalizedGroupId <= 0
  ) {
    return null;
  }
  const channelSuffix = channelId
    ? `:${encodeURIComponent(String(channelId).toLowerCase())}`
    : '';
  return `${RETICULUM_EXPIRY_PREFERENCE_STORAGE_PREFIX}:${encodeURIComponent(
    normalizedAddress
  )}:${normalizedGroupId}${channelSuffix}`;
}

const RETICULUM_EXPIRY_PREFERENCE_SENTINEL_NULL = '__null__';

export function loadReticulumMessageExpiryPreference(
  accountAddress: string,
  groupId: number | string,
  channelId?: string,
  storage?: Pick<Storage, 'getItem'>
): number | null | undefined {
  const key = reticulumMessageExpiryPreferenceStorageKey(
    accountAddress,
    groupId,
    channelId
  );
  if (!key) return undefined;
  try {
    const resolvedStorage =
      storage ??
      (typeof window === 'undefined' ? undefined : window.localStorage);
    const raw = resolvedStorage?.getItem(key);
    if (raw === RETICULUM_EXPIRY_PREFERENCE_SENTINEL_NULL) return null;
    return normalizeMessageExpiryOption(raw);
  } catch {
    return undefined;
  }
}

export function saveReticulumMessageExpiryPreference(
  accountAddress: string,
  groupId: number | string,
  durationMs: number | null | undefined,
  channelId?: string,
  storage?: Pick<Storage, 'removeItem' | 'setItem'>
): boolean {
  const key = reticulumMessageExpiryPreferenceStorageKey(
    accountAddress,
    groupId,
    channelId
  );
  if (!key) return false;
  try {
    const resolvedStorage =
      storage ??
      (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolvedStorage) return false;
    if (durationMs === null) {
      resolvedStorage.setItem(key, RETICULUM_EXPIRY_PREFERENCE_SENTINEL_NULL);
    } else {
      const normalizedDuration = normalizeMessageExpiryOption(durationMs);
      if (normalizedDuration === undefined) {
        resolvedStorage.removeItem(key);
      } else {
        resolvedStorage.setItem(key, String(normalizedDuration));
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function formatReticulumExpiryDuration(value: unknown): string {
  const duration = normalizeExpiryDurationMs(value);
  if (duration === undefined) return 'No expiry';
  const option = RETICULUM_MESSAGE_EXPIRY_OPTIONS.find(
    (candidate) => candidate.durationMs === duration
  );
  if (option) return option.label;
  const hours = duration / (60 * 60 * 1_000);
  if (Number.isInteger(hours) && hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = duration / TIME_DAYS_1_IN_MILLISECONDS;
  if (Number.isInteger(days)) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${Math.max(1, Math.round(hours))} hours`;
}

export function isReticulumMessageExpiryOptionAllowed(
  durationMs: number,
  channelExpiryDurationMs?: number
): boolean {
  const duration = normalizeExpiryDurationMs(durationMs);
  if (
    duration === undefined ||
    !RETICULUM_MESSAGE_EXPIRY_OPTIONS.some(
      (option) => option.durationMs === duration
    )
  ) {
    return false;
  }
  const channelExpiry = normalizeExpiryDurationMs(channelExpiryDurationMs);
  return channelExpiry === undefined || duration <= channelExpiry;
}

export function resolveReticulumMessageExpiryDurationMs(
  selectedDurationMs: number | null | undefined,
  channelExpiryDurationMs?: number
): number | null | undefined {
  if (selectedDurationMs === null) return null;
  if (selectedDurationMs === undefined) return undefined;
  return isReticulumMessageExpiryOptionAllowed(
    selectedDurationMs,
    channelExpiryDurationMs
  )
    ? selectedDurationMs
    : undefined;
}

export function buildReticulumMessageExpiryPayload(
  selectedDurationMs: number | null | undefined,
  channelExpiryDurationMs?: number
): { expiryDurationMs?: number } {
  if (selectedDurationMs === null) return { expiryDurationMs: 0 };
  const expiryDurationMs = resolveReticulumMessageExpiryDurationMs(
    selectedDurationMs,
    channelExpiryDurationMs
  );
  return expiryDurationMs === undefined ? {} : { expiryDurationMs };
}
