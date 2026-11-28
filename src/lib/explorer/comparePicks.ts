/**
 * The accounts picked to compare: up to COMPARE_MAX, each once, in the
 * order they were picked, kept for this Hub session (sessionStorage) for
 * each Hub account apart, so another Hub account never finds them, and
 * cleared when Hub switches accounts. Addresses only, nothing else.
 *
 * Every storage access is guarded: where storage can't be read or
 * written, the picks live in the window only (and start empty).
 */
import { isQortAddress } from './addresses';

/** The most accounts Compare holds. */
export const COMPARE_MAX = 4;

export const picksKey = (hubAddress: string) =>
  `explorer-compare:${hubAddress}`;

/** `list` as picks: Qortal addresses only, each once, at most COMPARE_MAX, in its order. */
export function cleanPicks(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const picks: string[] = [];
  for (const value of list) {
    if (!isQortAddress(value) || picks.includes(value)) continue;
    picks.push(value);
    if (picks.length === COMPARE_MAX) break;
  }
  return picks;
}

/** The picks kept for `hubAddress` (none where storage can't be read). */
export function readPicks(hubAddress: string | null | undefined): string[] {
  if (!hubAddress) return [];
  try {
    const raw = window.sessionStorage.getItem(picksKey(hubAddress));
    return cleanPicks(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

/** Keep `picks` for `hubAddress`; none left forgets the entry. */
export function writePicks(hubAddress: string, picks: readonly string[]): void {
  const clean = cleanPicks(picks);
  try {
    if (clean.length)
      window.sessionStorage.setItem(
        picksKey(hubAddress),
        JSON.stringify(clean)
      );
    else window.sessionStorage.removeItem(picksKey(hubAddress));
  } catch {
    // Kept in the window only.
  }
}

/** Forget the picks of `hubAddress`. */
export function clearPicks(hubAddress: string): void {
  try {
    window.sessionStorage.removeItem(picksKey(hubAddress));
  } catch {
    // Nothing kept that could be read either.
  }
}

/**
 * - `added`: it is picked now;
 * - `removed`: it was picked, and isn't now;
 * - `full`: COMPARE_MAX are picked already: nothing changed;
 * - `invalid`: not a Qortal address: nothing changed.
 */
export type PickResult = 'added' | 'removed' | 'full' | 'invalid';

/** `picks` with `address` added, or taken out when it is picked already. */
export function togglePick(
  picks: readonly string[],
  address: string
): { picks: string[]; result: PickResult } {
  const clean = cleanPicks(picks);
  if (clean.includes(address))
    return {
      picks: clean.filter((pick) => pick !== address),
      result: 'removed',
    };
  if (!isQortAddress(address)) return { picks: clean, result: 'invalid' };
  if (clean.length >= COMPARE_MAX) return { picks: clean, result: 'full' };
  return { picks: [...clean, address], result: 'added' };
}
