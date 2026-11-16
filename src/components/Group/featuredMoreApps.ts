import { officialAppsConfig } from '../Apps/config/officialApps';

/**
 * More official Q-Apps for a bigger Featured Q-Apps window on Home: it shows
 * them after its own tiles, in whole rows that fit without scrolling.
 *
 * Everything here is pure.
 */

/** Home shows Torq in Quitter's place, so Quitter is never one of them. */
const LEFT_OUT = ['Quitter'];

/**
 * The apps, in order: the official featured apps, then the other official
 * apps. Leaves out the apps the window already shows (`shown`), Quitter and
 * repeats, comparing names without case.
 */
export const featuredMoreApps = (
  shown: readonly string[],
  featured: readonly string[] = officialAppsConfig.featured,
  all: readonly { name: string }[] = officialAppsConfig.all
): string[] => {
  const seen = new Set(
    [...shown, ...LEFT_OUT].map((name) => name.trim().toLowerCase())
  );
  const apps: string[] = [];
  for (const name of [...featured, ...all.map((app) => app?.name)]) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    apps.push(trimmed);
  }
  return apps;
};

type FeaturedMoreAppsFit = {
  /** The height the tiles have, without the area's padding, in px. */
  availableHeight: number;
  /** The cells the window's own tiles take (a wide tile takes two). */
  baseCells: number;
  columns: number;
  /** The gap between rows, in px. */
  gap: number;
  /** How many more apps there are to show. */
  moreApps: number;
  rowHeight: number;
};

/**
 * How many more apps fit under the window's own tiles: as many whole rows
 * as there is room for (the last one is short only when the apps run out),
 * so they never make the tiles scroll. 0 when no whole row fits.
 */
export const featuredMoreAppsFit = ({
  availableHeight,
  baseCells,
  columns,
  gap,
  moreApps,
  rowHeight,
}: FeaturedMoreAppsFit): number => {
  const cols = Math.floor(columns);
  if (
    ![availableHeight, baseCells, cols, gap, moreApps, rowHeight].every(
      Number.isFinite
    ) ||
    cols < 1 ||
    rowHeight <= 0 ||
    gap < 0 ||
    moreApps <= 0
  ) {
    return 0;
  }
  const baseRows = Math.ceil(Math.max(0, baseCells) / cols);
  // n rows take n * rowHeight + (n - 1) * gap.
  const rows = Math.floor((availableHeight + gap) / (rowHeight + gap));
  const moreRows = rows - baseRows;
  return moreRows > 0 ? Math.min(moreRows * cols, Math.floor(moreApps)) : 0;
};

/** Splits a CSS value at the spaces outside brackets. */
const splitCssValue = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let part = '';
  for (const char of value) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      if (part) parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  if (part) parts.push(part);
  return parts;
};

/**
 * How many columns a grid's computed grid-template-columns lists: a
 * browser gives each column's size ("120px 120px 120px"), a declared value
 * may use repeat() ("repeat(4, minmax(0, 1fr))"). 0 when it can't tell
 * (none, auto-fill, auto-fit).
 */
export const countGridTracks = (value: string): number => {
  let count = 0;
  for (const part of splitCssValue(typeof value === 'string' ? value : '')) {
    // Line names, like [main-start].
    if (part.startsWith('[')) continue;
    const repeat = /^repeat\(\s*([^,]+?)\s*,(.*)\)$/s.exec(part);
    if (repeat) {
      const times = Number(repeat[1]);
      const tracks = countGridTracks(repeat[2]);
      if (!Number.isInteger(times) || times < 1 || tracks < 1) return 0;
      count += times * tracks;
    } else if (/^(none|subgrid|masonry|auto-fill|auto-fit)$/i.test(part)) {
      return 0;
    } else {
      count += 1;
    }
  }
  return count;
};

/**
 * The largest px length in a CSS value: 124 for "minmax(108px, 124px)".
 * 0 when there is none.
 */
export const largestPx = (value: string): number => {
  const lengths = Array.from(
    (typeof value === 'string' ? value : '').matchAll(/(\d*\.?\d+)px/g),
    (match) => Number(match[1])
  ).filter(Number.isFinite);
  return lengths.length > 0 ? Math.max(...lengths) : 0;
};
