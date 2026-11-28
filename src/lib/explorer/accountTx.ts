/**
 * One account's confirmed transactions, newest first, for the Transactions
 * tab and the Overview's Latest transactions (they share the All list).
 * One entry in the window's cache per list: `txlist:<types>:<address>`
 * (the family's types, sorted and joined by commas, or `all`), holding
 * every row read so far. Each read is one page of 100:
 *
 *   /transactions/search?address=<a>[&txType=…]&confirmationStatus=CONFIRMED
 *     &limit=100&offset=<n>&reverse=true
 *
 * The node's list grows at its top as transactions arrive, so an offset
 * read later can point further down than it did. The merges never let
 * `nextOffset` run past the rows held (it may fall short, and a page that
 * starts among the rows held only repeats some of them, which are left
 * out):
 *
 * - The first read takes offset 0.
 * - "Show more" reads at `nextOffset`; its page is added only if it follows
 *   on from the list as it is when the page arrives (it starts at the
 *   list's `nextOffset` or among its rows, and the list hasn't started over
 *   since), whatever else changed it meanwhile.
 * - Read again (Refresh): the newest page goes on top of what is held and
 *   the rest stays; when the whole page is new (more than 100 arrived
 *   since), the list starts over from it.
 * - A list holds at most ACCOUNT_TX_MAX rows (the newest), and says so.
 *   The All list holds more only when the Overview asked for an account's
 *   whole history (its QORT figures and Activity, for viewers who see
 *   them): its own ceiling (`max`) is raised then, up to
 *   ACCOUNT_HISTORY_MAX, still read 100 at a time, and the Transactions
 *   tab lists its newest ACCOUNT_TX_MAX (`listedPart`).
 * - A whole-history read goes on while it holds fewer rows than its
 *   ceiling (rows, not offsets: a transaction arriving meanwhile moves the
 *   offsets on, and the page read twice is left out). At ACCOUNT_HISTORY_MAX
 *   one more row says whether the account has more (`longer`), so a history
 *   of exactly that many is never called longer.
 *
 * Unconfirmed transactions aren't in an address search (Core records who
 * took part only at confirmation): reads.ts `waitingRead` has the ones the
 * account sent.
 */
import { getJson, queryString } from './core';
import { toTxRows, type TxRow } from './reads';

/** Rows per read. */
export const ACCOUNT_TX_PAGE = 100;
/** The most rows of one list the Explorer holds: ten reads. */
export const ACCOUNT_TX_MAX = 1000;
/**
 * The most rows of an account's whole history the Explorer reads (the All
 * list, raised on request): 200 reads.
 */
export const ACCOUNT_HISTORY_MAX = 20_000;
/** How long a list is kept: Refresh reads it sooner. */
export const ACCOUNT_TX_TTL_MS = 5 * 60_000;

export interface AccountTxList {
  /** Every row read so far, newest first, each signature once. */
  rows: TxRow[];
  /** Where the next older page starts in Core's list; never past the rows held. */
  nextOffset: number;
  /** Core has no older rows. */
  done: boolean;
  /** Counts the times the list started over: a page read for an earlier one doesn't fit it. */
  epoch: number;
  /** The most rows it holds: ACCOUNT_TX_MAX unless a whole history was asked for. */
  max?: number;
  /** A read showed the node has more than the rows held (some were cut, or a row past them was seen). */
  longer?: boolean;
}

/** The most rows `list` holds. */
export const maxOf = (list: AccountTxList): number =>
  list.max ?? ACCOUNT_TX_MAX;

/** The types part of a key: sorted and joined, or `all` for no type filter. */
export function typesKey(types: readonly string[]): string {
  return types.length ? [...types].sort().join(',') : 'all';
}

/** Its key ends with the address, so the account's Refresh forgets it. */
export function accountTxKey(
  address: string,
  types: readonly string[]
): string {
  return `txlist:${typesKey(types)}:${address}`;
}

/** The node's page of the account's list at `offset` (`limit` rows: a page, or one to check for more). */
export async function readTxPage(
  address: string,
  types: readonly string[],
  offset: number,
  limit = ACCOUNT_TX_PAGE
): Promise<TxRow[]> {
  return toTxRows(
    await getJson<unknown>(
      `/transactions/search?${queryString({
        address,
        txType: types.length ? types : undefined,
        confirmationStatus: 'CONFIRMED',
        limit,
        offset,
        reverse: true,
      })}`
    )
  );
}

/** `rows` without repeats (the first of each signature kept). */
function unique(rows: readonly TxRow[]): TxRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.signature)) return false;
    seen.add(row.signature);
    return true;
  });
}

/**
 * At most its `max` rows: the oldest beyond it go, and the list then has
 * more on the node (it reads on from where they were).
 */
function capped(list: AccountTxList): AccountTxList {
  const max = maxOf(list);
  if (list.rows.length <= max) return list;
  return {
    ...list,
    rows: list.rows.slice(0, max),
    nextOffset: max,
    done: false,
    longer: true,
  };
}

/** The list's own ceiling, when it isn't the default: kept by every merge. */
const ceilingOf = (list: AccountTxList): Pick<AccountTxList, 'max'> =>
  list.max === undefined ? {} : { max: list.max };

/** What the newest page on top keeps of `list`: its ceiling, and whether it is known to be longer (its older rows beyond are still there). */
const keptOf = (
  list: AccountTxList
): Pick<AccountTxList, 'max' | 'longer'> => ({
  ...ceilingOf(list),
  ...(list.longer ? { longer: true } : {}),
});

/** A list made from its newest page. */
export function fromFirstPage(
  page: readonly TxRow[],
  epoch = 0,
  max?: number
): AccountTxList {
  return capped({
    rows: unique(page),
    nextOffset: page.length,
    done: page.length < ACCOUNT_TX_PAGE,
    epoch,
    ...(max === undefined ? {} : { max }),
  });
}

/** The newest page read again, on top of what is held. */
export function mergeNewest(
  previous: AccountTxList,
  page: readonly TxRow[]
): AccountTxList {
  // Core had fewer than a page: that is the whole list.
  if (page.length < ACCOUNT_TX_PAGE)
    return fromFirstPage(page, previous.epoch + 1, previous.max);
  const held = new Set(previous.rows.map((row) => row.signature));
  const fresh = page.filter((row) => !held.has(row.signature));
  // Nothing in common: more than a page arrived since, so what is held no
  // longer follows on. Start over from this page.
  if (fresh.length === page.length)
    return fromFirstPage(page, previous.epoch + 1, previous.max);
  const inPage = new Set(page.map((row) => row.signature));
  const rows = unique([
    ...page,
    ...previous.rows.filter((row) => !inPage.has(row.signature)),
  ]);
  return capped({
    rows,
    // The rows held now run unbroken from the top: the next older one is at
    // least that far down (more, if transactions arrived since).
    nextOffset: Math.max(previous.nextOffset, rows.length),
    done: previous.done,
    epoch: previous.epoch,
    ...keptOf(previous),
  });
}

/**
 * An older page, read at `offset` for the list of `epoch`, added to
 * `current` when it follows on from it: it starts at `current`'s
 * `nextOffset` or among its rows, and the list hasn't started over since.
 * Otherwise `current` as it is (Show more reads on from there).
 */
export function mergeOlderAt(
  current: AccountTxList,
  page: readonly TxRow[],
  offset: number,
  epoch: number
): AccountTxList {
  if (current.epoch !== epoch || current.done) return current;
  const held = new Set(current.rows.map((row) => row.signature));
  const follows =
    offset === current.nextOffset ||
    page.some((row) => held.has(row.signature));
  if (!follows) return current;
  return capped({
    rows: unique([...current.rows, ...page]),
    nextOffset: Math.max(current.nextOffset, offset + page.length),
    done: page.length < ACCOUNT_TX_PAGE,
    epoch,
    ...ceilingOf(current),
  });
}

/**
 * One row read at `offset` past a list at ACCOUNT_HISTORY_MAX
 * (`needsCheck`), for the list of `epoch`: none, and the list is the whole
 * history; a row it doesn't hold, and it is longer; one it holds (a
 * transaction arrived since, so the offsets moved on), and the next check
 * reads one further. Otherwise `current` as it is.
 */
export function mergeChecked(
  current: AccountTxList,
  page: readonly TxRow[],
  offset: number,
  epoch: number
): AccountTxList {
  // Read for this list, at where it stands now: anything else is left out.
  if (
    current.epoch !== epoch ||
    !needsCheck(current) ||
    offset !== current.nextOffset
  )
    return current;
  if (!page.length) return { ...current, done: true };
  const held = new Set(current.rows.map((row) => row.signature));
  if (page.some((row) => !held.has(row.signature)))
    return { ...current, longer: true };
  return { ...current, nextOffset: offset + page.length };
}

/** Whether "Show more" can read on: the node has more, and the list isn't at its most. */
export const canReadMore = (list: AccountTxList): boolean =>
  !list.done && list.nextOffset < ACCOUNT_TX_MAX;

/** It stopped at its most while the node has more. */
export const atCeiling = (list: AccountTxList): boolean =>
  !list.done && list.nextOffset >= ACCOUNT_TX_MAX;

/**
 * `list` able to hold up to `max` rows (at most ACCOUNT_HISTORY_MAX): an
 * account's whole history, asked for. Never lowered: the same list when it
 * holds that many already.
 */
export function withCeiling(list: AccountTxList, max: number): AccountTxList {
  const next = Math.min(Math.max(max, ACCOUNT_TX_MAX), ACCOUNT_HISTORY_MAX);
  return next > maxOf(list) ? { ...list, max: next } : list;
}

/**
 * It holds ACCOUNT_HISTORY_MAX rows and no read has shown whether the node
 * has more: one more row says (`mergeChecked`).
 */
export const needsCheck = (list: AccountTxList): boolean =>
  !list.done && !list.longer && list.rows.length >= ACCOUNT_HISTORY_MAX;

/**
 * Whether a whole-history read can read on: the node has more, and the
 * list holds fewer rows than its own most (or, at the Explorer's most,
 * whether there are more isn't known yet).
 */
export const canReadOn = (list: AccountTxList): boolean =>
  !list.done && (list.rows.length < maxOf(list) || needsCheck(list));

/** A whole-history read stopped at the Explorer's most, and a read showed the node has more. */
export const historyAtCeiling = (list: AccountTxList): boolean =>
  !list.done && Boolean(list.longer) && list.rows.length >= ACCOUNT_HISTORY_MAX;

/**
 * What a tab lists of a list: its newest ACCOUNT_TX_MAX rows; `all` when
 * they are every one the account has, `beyond` how many more were read
 * (for the Overview's whole history).
 */
export function listedPart(list: AccountTxList): {
  rows: TxRow[];
  all: boolean;
  beyond: number;
} {
  const beyond = Math.max(0, list.rows.length - ACCOUNT_TX_MAX);
  return {
    rows: beyond ? list.rows.slice(0, ACCOUNT_TX_MAX) : list.rows,
    all: list.done && !beyond,
    beyond,
  };
}

/** How much of a list a tab shows (kept with the history step). */
export interface ShownRows {
  /** Rows shown, counted from `top`. */
  count: number;
  /** The newest row when `count` was set: rows that arrived above it since show too. */
  top: string | null;
}

/** Rows a tab shows at first, and how many more each Show more shows. */
export const SHOWN_STEP = ACCOUNT_TX_PAGE;

/**
 * How many of `rows` (newest first) a tab shows: the first SHOWN_STEP until
 * more is asked for, then `kept.count` counted from its `top`, so rows a
 * Refresh put above it show too and nothing on screen goes. Never more
 * than there are.
 */
export function shownCount(
  rows: readonly TxRow[],
  kept: ShownRows | undefined
): number {
  if (!kept) return Math.min(rows.length, SHOWN_STEP);
  const above =
    kept.top === null
      ? -1
      : rows.findIndex((row) => row.signature === kept.top);
  return Math.min(rows.length, kept.count + Math.max(0, above));
}

/**
 * What Show more asks for: the next SHOWN_STEP of the rows held, with no
 * read; once every row held is shown, SHOWN_STEP more than are held, and
 * the next page is read (`read`), showing once it is in.
 */
export function moreShown(
  rows: readonly TxRow[],
  kept: ShownRows | undefined
): { next: ShownRows; read: boolean } {
  const shown = shownCount(rows, kept);
  const top = rows[0]?.signature ?? null;
  return shown < rows.length
    ? { next: { count: shown + SHOWN_STEP, top }, read: false }
    : { next: { count: rows.length + SHOWN_STEP, top }, read: true };
}
