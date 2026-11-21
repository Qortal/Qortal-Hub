/**
 * Recent explorations: the last accounts opened in the Explorer, newest
 * first, kept on this device for each Hub account apart, and only while
 * "Remember accounts I explore on this device" is on (it is unless turned
 * off; turning it off forgets them). Addresses only, nothing else.
 *
 * Every storage access is guarded: a private window or blocked site data
 * leaves the list empty and the Explorer working.
 */
import { isQortAddress } from './addresses';

export const RECENT_MAX = 8;

export const recentKey = (hubAddress: string) =>
  `explorer-recent:${hubAddress}`;
export const rememberKey = (hubAddress: string) =>
  `explorer-remember:${hubAddress}`;

/** What this device remembers for `hubAddress`, newest first. */
export function readRecent(hubAddress: string | null | undefined): string[] {
  if (!hubAddress) return [];
  try {
    const raw = window.localStorage.getItem(recentKey(hubAddress));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter(isQortAddress).slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Whether accounts explored are remembered (false where storage can't be read). */
export function readRemember(hubAddress: string | null | undefined): boolean {
  if (!hubAddress) return false;
  try {
    return window.localStorage.getItem(rememberKey(hubAddress)) !== 'false';
  } catch {
    return false;
  }
}

/** Turn remembering on or off; off also forgets the list. */
export function writeRemember(hubAddress: string, on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(rememberKey(hubAddress));
    else {
      window.localStorage.setItem(rememberKey(hubAddress), 'false');
      window.localStorage.removeItem(recentKey(hubAddress));
    }
  } catch {
    // Nothing can be remembered where storage can't be written.
  }
}

/**
 * The list after opening `address`: it first, without its older place,
 * at most RECENT_MAX. Stored when remembering is on; otherwise unchanged.
 */
export function addRecent(hubAddress: string, address: string): string[] {
  const list = readRecent(hubAddress);
  if (!isQortAddress(address) || !readRemember(hubAddress)) return list;
  const next = [address, ...list.filter((a) => a !== address)].slice(
    0,
    RECENT_MAX
  );
  try {
    window.localStorage.setItem(recentKey(hubAddress), JSON.stringify(next));
  } catch {
    // Kept for this window only.
  }
  return next;
}

/** Forget every recent exploration of `hubAddress` on this device. */
export function clearRecent(hubAddress: string): void {
  try {
    window.localStorage.removeItem(recentKey(hubAddress));
  } catch {
    // Nothing stored that could be read either.
  }
}
