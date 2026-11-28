/**
 * Numbers and dates in Hub's language (pass i18next's `language`). A
 * language the browser doesn't know falls back to English formats.
 */
import { formatQortAmount } from '../../utils/numberFunctions';

function safe<T>(make: (language: string) => T, language: string): T {
  try {
    return make(language);
  } catch {
    return make('en');
  }
}

/** "1,798,699". */
export const formatCount = (value: number, language: string): string =>
  safe((lang) => new Intl.NumberFormat(lang), language).format(value);

/** "12.50": a QORT amount with 2 decimals, as Hub shows balances. */
export const formatQort = (value: number, language: string): string =>
  formatQortAmount(value, language, { expandSmallAmounts: true }) ?? '—';

/** "12.50000000": every decimal Core keeps. */
export const formatQortExact = (value: number, language: string): string =>
  formatQortAmount(value, language, { fractionDigits: 8 }) ?? '—';

/** "May 2025". */
export const formatMonthYear = (timestamp: number, language: string): string =>
  safe(
    (lang) =>
      new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' }),
    language
  ).format(new Date(timestamp));

/** "18 May 2025". */
export const formatDay = (timestamp: number, language: string): string =>
  safe(
    (lang) =>
      new Intl.DateTimeFormat(lang, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    language
  ).format(new Date(timestamp));

/** "18 May 2025, 14:05". */
export const formatDayTime = (timestamp: number, language: string): string =>
  safe(
    (lang) =>
      new Intl.DateTimeFormat(lang, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    language
  ).format(new Date(timestamp));

const AGO_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 days ago", "11 months ago", "now". */
export function formatAgo(
  timestamp: number,
  language: string,
  now = Date.now()
): string {
  const formatter = safe(
    (lang) => new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }),
    language
  );
  // A time ahead of this PC's clock (the node's clock runs ahead) reads as now.
  const diff = Math.min(0, timestamp - now);
  for (const [unit, ms] of AGO_UNITS) {
    if (Math.abs(diff) >= ms)
      return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(0, 'minute');
}
