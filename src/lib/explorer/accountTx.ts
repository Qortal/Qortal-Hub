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
}

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

/** The node's page of the account's list at `offset`. */
export async function readTxPage(
  address: string,
  types: readonly string[],
  offset: number
): Promise<TxRow[]> {
  return toTxRows(
    await getJson<unknown>(
      `/transactions/search?${queryString({
        address,
        txType: types.length ? types : undefined,
        confirmationStatus: 'CONFIRMED',
        limit: ACCOUNT_TX_PAGE,
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
 * At most ACCOUNT_TX_MAX rows: the oldest beyond it go, and the list then
 * has more on the node (it reads on from where they were).
 */
function capped(list: AccountTxList): AccountTxList {
  if (list.rows.length <= ACCOUNT_TX_MAX) return list;
  return {
    ...list,
    rows: list.rows.slice(0, ACCOUNT_TX_MAX),
    nextOffset: ACCOUNT_TX_MAX,
    done: false,
  };
}

/** A list made from its newest page. */
export function fromFirstPage(
  page: readonly TxRow[],
  epoch = 0
): AccountTxList {
  return capped({
    rows: unique(page),
    nextOffset: page.length,
    done: page.length < ACCOUNT_TX_PAGE,
    epoch,
  });
}

/** The newest page read again, on top of what is held. */
export function mergeNewest(
  previous: AccountTxList,
  page: readonly TxRow[]
): AccountTxList {
  // Core had fewer than a page: that is the whole list.
  if (page.length < ACCOUNT_TX_PAGE)
    return fromFirstPage(page, previous.epoch + 1);
  const held = new Set(previous.rows.map((row) => row.signature));
  const fresh = page.filter((row) => !held.has(row.signature));
  // Nothing in common: more than a page arrived since, so what is held no
  // longer follows on. Start over from this page.
  if (fresh.length === page.length)
    return fromFirstPage(page, previous.epoch + 1);
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
  });
}

/** Whether "Show more" can read on: the node has more, and the list isn't at its most. */
export const canReadMore = (list: AccountTxList): boolean =>
  !list.done && list.nextOffset < ACCOUNT_TX_MAX;

/** It stopped at its most while the node has more. */
export const atCeiling = (list: AccountTxList): boolean =>
  !list.done && list.nextOffset >= ACCOUNT_TX_MAX;
