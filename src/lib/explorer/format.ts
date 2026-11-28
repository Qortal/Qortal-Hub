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

/** A date format that can also say a range (Intl's `formatRange`, newer than this project's TypeScript library list). */
type RangeFormat = Intl.DateTimeFormat & {
  formatRange?: (from: Date, to: Date) => string;
};

/**
 * When something happened: its day ("18 May 2025") for one moment, else
 * the months it covers ("Mar – May 2025", "May 2023 – Mar 2025"), in the
 * language's own way of saying a range.
 */
export function formatSpan(
  first: number,
  last: number,
  language: string
): string {
  const [from, to] = first <= last ? [first, last] : [last, first];
  if (from === to) return formatDay(from, language);
  const months: RangeFormat = safe(
    (lang) =>
      new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' }),
    language
  );
  return typeof months.formatRange === 'function'
    ? months.formatRange(new Date(from), new Date(to))
    : `${months.format(from)} – ${months.format(to)}`;
}

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

/** The decimal separator of `language` ("." or ","). */
function decimalSeparator(language: string): string {
  return (
    safe((lang) => new Intl.NumberFormat(lang), language)
      .formatToParts(1.5)
      .find((part) => part.type === 'decimal')?.value ?? '.'
  );
}

/**
 * An amount as Core writes it ("637557960.49687541"), exactly, in Hub's
 * language: digits grouped, trailing zeros dropped ("4.30000000" → "4.3",
 * "100.00000000" → "100"). Text that isn't an amount is shown as it is.
 */
export function formatAmountExact(amount: string, language: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(amount ?? '').trim());
  if (!match) return String(amount ?? '');
  const [, sign, whole, fraction = ''] = match;
  const grouped = safe((lang) => new Intl.NumberFormat(lang), language).format(
    BigInt(whole)
  );
  const decimals = fraction.replace(/0+$/, '');
  return `${sign ? '−' : ''}${grouped}${
    decimals ? `${decimalSeparator(language)}${decimals}` : ''
  }`;
}

/** A percent as Core writes it ("5.50"): "5.5 %", "5,5 %", "5.5%"… as the language writes it. */
export function formatPercent(value: string, language: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return safe(
    (lang) =>
      new Intl.NumberFormat(lang, {
        style: 'percent',
        maximumFractionDigits: 2,
      }),
    language
  ).format(n / 100);
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** A size in the language's own units: "240 byte", "1.2 kB", "3.5 MB" (1 kB = 1,000 bytes). */
export function formatSize(bytes: number, language: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return safe(
    (lang) =>
      new Intl.NumberFormat(lang, {
        style: 'unit',
        unit: SIZE_UNITS[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
      }),
    language
  ).format(value);
}

interface ListFormatter {
  format(items: string[]): string;
}

/** Intl.ListFormat, which this project's TypeScript library list predates. */
const ListFormat = (
  Intl as unknown as {
    ListFormat?: new (
      language: string,
      options: { type: 'conjunction' }
    ) => ListFormatter;
  }
).ListFormat;

/** Items as a list, joined the way the language joins them ("A, B and C"). */
export function formatList(items: readonly string[], language: string): string {
  if (!ListFormat) return items.join(', ');
  return safe(
    (lang) => new ListFormat(lang, { type: 'conjunction' }),
    language
  ).format([...items]);
}

/**
 * A period of days in the language's own way of saying a range ("3 – 9
 * Mar 2024"), one day as that day; a period under a day with its times.
 * `end` is where the period stops (not in it).
 */
export function formatPeriod(
  start: number,
  end: number,
  language: string
): string {
  const short = end - start < 86_400_000;
  const days: RangeFormat = safe(
    (lang) =>
      new Intl.DateTimeFormat(lang, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(short ? { hour: '2-digit', minute: '2-digit' } : {}),
      }),
    language
  );
  const last = Math.max(start, end - 1);
  const from = days.format(start);
  const to = days.format(last);
  if (from === to) return from;
  return typeof days.formatRange === 'function'
    ? days.formatRange(new Date(start), new Date(last))
    : `${from} – ${to}`;
}
