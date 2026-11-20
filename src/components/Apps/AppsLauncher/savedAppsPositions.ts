/**
 * Where a saved app, folder or bookmark stands in its list, as a short string
 * that sorts as plain text ("fractional indexing"). A new or moved item gets a
 * string that sorts between its new neighbours, so no other item changes: two
 * devices that move two different items both keep their move.
 *
 * Positions use the digits below, in the order JavaScript compares strings,
 * and never end in the first digit, so there is always room before one.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0];
const DIGIT_SET = new Set(DIGITS);

/**
 * A position this code can place things next to. The length bound only keeps
 * damaged data out: moving one item to the front of a list adds about one
 * character per six moves.
 */
export const isPosition = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 1024 &&
  !value.endsWith(ZERO) &&
  [...value].every((char) => DIGIT_SET.has(char));

const digitOf = (char: string) => DIGITS.indexOf(char);

/** A string strictly between `a` ('' for the start) and `b` (null for the end). */
const midpoint = (a: string, b: string | null): string => {
  if (b !== null) {
    // The common start stays; `a` reads as padded with zeros.
    let n = 0;
    while (n < b.length && (a[n] ?? ZERO) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? digitOf(a[0]) : 0;
  const digitB = b !== null && b.length ? digitOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round((digitA + digitB) / 2)];
  }
  // Neighbouring first digits.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
};

/**
 * A position between two others: after `before` (null for the start) and
 * before `after` (null for the end). When the two are out of order, as two
 * devices' moves can leave them, it goes after `before`.
 */
export const positionBetween = (
  before: string | null,
  after: string | null
): string => {
  const a = isPosition(before) ? before : '';
  const b = isPosition(after) && after > a ? after : null;
  return midpoint(a, b);
};

/**
 * `count` positions in order between `before` and `after`, kept short by
 * splitting the room in halves.
 */
export const positionsBetween = (
  before: string | null,
  after: string | null,
  count: number
): string[] => {
  if (count <= 0) return [];
  if (count === 1) return [positionBetween(before, after)];
  const middle = Math.floor(count / 2);
  const at = positionBetween(before, after);
  return [
    ...positionsBetween(before, at, middle),
    at,
    ...positionsBetween(at, after, count - middle - 1),
  ];
};

/**
 * The indexes of the longest run of `values` that is already in increasing
 * order: the items that can keep their position when a list is rearranged.
 */
export const longestIncreasingRun = (values: number[]): Set<number> => {
  // tails[k]: the index of the smallest last value of a run of length k + 1.
  const tails: number[] = [];
  const previous: number[] = new Array(values.length).fill(-1);
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const run = new Set<number>();
  let index = tails.length ? tails[tails.length - 1] : -1;
  while (index !== -1) {
    run.add(index);
    index = previous[index];
  }
  return run;
};

/**
 * New positions for a list put in a new order.
 *
 * `order` is the list as it should be, by key; `positionOf` gives what each
 * item has now (null for an item new to this list). Items sort by position,
 * then by key, so two with the same position are in order when their keys
 * are. The items that are already in order keep their position; the others
 * get one between their new neighbours. The result holds only the items
 * whose position changes.
 */
export const repositionList = (
  order: string[],
  positionOf: (key: string) => string | null
): Map<string, string> => {
  const current = order.map((key) => {
    const position = positionOf(key);
    return isPosition(position) ? position : null;
  });
  // Only items with a position, in increasing order, can stay.
  const placed: number[] = [];
  current.forEach((position, index) => {
    if (position !== null) placed.push(index);
  });
  const byPlace = [...placed].sort((a, b) => {
    const [pa, pb] = [current[a] as string, current[b] as string];
    if (pa !== pb) return pa < pb ? -1 : 1;
    return order[a] < order[b] ? -1 : order[a] > order[b] ? 1 : 0;
  });
  const rank = new Map(byPlace.map((index, place) => [index, place]));
  const keep = new Set(
    [
      ...longestIncreasingRun(placed.map((index) => rank.get(index) as number)),
    ].map((runIndex) => placed[runIndex])
  );

  const moved = new Map<string, string>();
  let index = 0;
  while (index < order.length) {
    if (keep.has(index)) {
      index += 1;
      continue;
    }
    // A run of items to place, between the kept ones around it.
    const start = index;
    while (index < order.length && !keep.has(index)) index += 1;
    const before = start > 0 ? current[start - 1] : null;
    // No position fits between two equal ones: the next one moves too.
    while (
      index < order.length &&
      before !== null &&
      (current[index] as string) <= before
    ) {
      index += 1;
      while (index < order.length && !keep.has(index)) index += 1;
    }
    const after = index < order.length ? current[index] : null;
    const positions = positionsBetween(before, after, index - start);
    positions.forEach((position, offset) => {
      moved.set(order[start + offset], position);
    });
  }
  return moved;
};
