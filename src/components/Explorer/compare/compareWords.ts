/**
 * Compare's small helpers for words: a list of letters, a duration, and a
 * read's part named for its account.
 */
import { formatList } from '../../../lib/explorer/format';
import type { Letter } from '../../../lib/explorer/compare';

/** "A and C", "A, B and D": joined the way the language joins a list. */
export const lettersText = (
  letters: readonly Letter[],
  language: string
): string => formatList([...letters], language);

const UNITS: Array<[string, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "2 days", "3 months", "1 year": a span of time in its largest whole unit, in the reader's language. */
export function durationText(ms: number, language: string): string {
  const [unit, size] =
    UNITS.find(([, length]) => Math.abs(ms) >= length) ??
    UNITS[UNITS.length - 1];
  const value = Math.max(1, Math.round(Math.abs(ms) / size));
  const format = (lang: string) =>
    new Intl.NumberFormat(lang, {
      style: 'unit',
      unit,
      unitDisplay: 'long',
      maximumFractionDigits: 0,
    }).format(value);
  try {
    return format(language);
  } catch {
    return format('en');
  }
}
