/**
 * How often this account opened each Q-App and website on this device. The top
 * bar ranks its suggestions with it, so the apps someone uses come first.
 * Kept in localStorage, one list per account.
 */
export type AppOpenCounts = Record<string, number>;

const STORAGE_PREFIX = 'app_open_counts:';
/** More than anyone's regulars; past it, the least opened are dropped. */
export const MAX_APP_OPEN_COUNTS = 300;
const COUNTED_SERVICES = new Set(['APP', 'WEBSITE']);

/** `APP:q-tube`: the service, and the name in lower case. */
export const appOpenCountKey = (
  service: unknown,
  name: unknown
): string | null => {
  const normalizedService =
    typeof service === 'string' ? service.trim().toUpperCase() : '';
  const normalizedName =
    typeof name === 'string' ? name.trim().toLowerCase() : '';
  return normalizedService && normalizedName
    ? `${normalizedService}:${normalizedName}`
    : null;
};

const storageKey = (address: string) => `${STORAGE_PREFIX}${address}`;

export const readAppOpenCounts = (
  address: string | null | undefined
): AppOpenCounts => {
  if (!address) return {};
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(storageKey(address)) || '{}'
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          !!key &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value > 0
      )
    ) as AppOpenCounts;
  } catch {
    return {};
  }
};

/**
 * Counts one more open of a Q-App or website for `address`, and gives the
 * account's counts. Other services are not counted.
 */
export const recordAppOpen = (
  address: string | null | undefined,
  service: unknown,
  name: unknown
): AppOpenCounts => {
  const counts = readAppOpenCounts(address);
  const key = appOpenCountKey(service, name);
  if (!address || !key || !COUNTED_SERVICES.has(key.split(':')[0])) {
    return counts;
  }

  const opened = (counts[key] ?? 0) + 1;
  const others = Object.entries(counts).filter(([other]) => other !== key);
  const kept =
    others.length < MAX_APP_OPEN_COUNTS
      ? others
      : others
          .sort(([, left], [, right]) => right - left)
          .slice(0, MAX_APP_OPEN_COUNTS - 1);
  const next: AppOpenCounts = Object.fromEntries([...kept, [key, opened]]);

  try {
    localStorage.setItem(storageKey(address), JSON.stringify(next));
  } catch {
    // Storage unavailable: the counts last until Hub closes.
  }
  return next;
};
