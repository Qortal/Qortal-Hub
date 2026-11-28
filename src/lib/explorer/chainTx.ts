/**
 * Transactions on Qortal: the whole chain's confirmed transactions of the
 * kinds picked in a range of blocks, 20 a page, newest or oldest first,
 * and what waits for a block, apart. Pure rules and reads, no text.
 *
 * Core's rules for a search (TransactionsResource.searchTransactions): one
 * without an address needs a type or asks for 20 rows or fewer, and a block
 * range goes only with confirmationStatus=CONFIRMED. So every search here
 * names its types, is confirmed, has a block range and asks for 20:
 *
 *   /transactions/search?txType=…&startBlock=<s>&blockLimit=<n>
 *     &confirmationStatus=CONFIRMED&limit=20&offset=<o>&reverse=<true|false>
 *
 * Core counts blocks [startBlock, startBlock + blockLimit) and orders by each
 * transaction's own time (`reverse=true`: newest first). A range past the
 * tip comes back empty, so a range never reaches past the tip its list
 * pinned when it opened: the latest 1,000 or 10,000 blocks up to it, or 1 to
 * 10,000 blocks from a block. Its rows then don't move while it is paged. A
 * type Core doesn't know, or a number it can't read, is a 400 (`Bad parameter
 * "txType"`): a failure, never an empty answer.
 *
 * Messages (MESSAGE, CHAT) aren't listed, as in Q-Mintership+: an account's
 * own Transactions tab shows the ones it took part in, but a chain-wide feed
 * of who messages whom is more than an explorer of accounts needs. So "All"
 * here names every other type, and no search goes out without its types.
 *
 * What waits for a block is the node's own list, read apart:
 * `/transactions/unconfirmed?txType=…&limit=20&reverse=true`.
 */
import { CoreHttpError, getJson, queryString } from './core';
import { typesKey } from './accountTx';
import { toTxRows, type ReadSpec, type TxRow } from './reads';
import {
  ALL_TRANSACTIONS,
  ALL_TX_TYPES,
  cleanFilter,
  TX_FAMILIES,
  typesFor,
  typesToAsk,
  type TxFilter,
  type TxType,
} from './txFamilies';

/** Rows per page: Core's most for a search without an address and a type. */
export const CHAIN_PAGE = 20;
/** The most pages one search shows: 1,000 rows. */
export const CHAIN_MAX_PAGES = 50;
export const CHAIN_MAX_ROWS = CHAIN_PAGE * CHAIN_MAX_PAGES;

/** The latest blocks a list can cover, up to its pinned tip. */
export const LATEST_SPANS = [1000, 10_000] as const;
export type LatestSpan = (typeof LATEST_SPANS)[number];
/** How many blocks a "from a block" range covers: just that block, up to 10,000. */
export const FROM_SPANS = [1, 10, 100, 1000, 10_000] as const;
export type FromSpan = (typeof FROM_SPANS)[number];
export const FROM_SPAN: FromSpan = 10_000;

export type BlocksChoice =
  | { kind: 'latest'; blocks: LatestSpan }
  | { kind: 'from'; start: number; span: FromSpan };

/** What a list shows unless another range is picked. */
export const LATEST_BLOCKS = {
  kind: 'latest',
  blocks: 1000,
} as const satisfies BlocksChoice;

/** Newest first (Core's `reverse=true`) or oldest first. */
export type ChainOrder = 'newest' | 'oldest';

/** Blocks [start, start + limit). */
export interface BlockRange {
  start: number;
  limit: number;
}

/** What a list opened from elsewhere starts with (its tip, its blocks, its order, its kind). */
export interface ChainPreset {
  /** A tip already pinned (the start page's), so the list shows the same rows. */
  tip?: number | null;
  blocks?: BlocksChoice;
  order?: ChainOrder;
  filter?: TxFilter;
}

/** A block height: a whole number from 1. */
export const isBlockHeight = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** The blocks a choice covers, never past the pinned tip. */
export function rangeFor(choice: BlocksChoice, tip: number): BlockRange {
  const top = Math.max(1, Math.floor(tip));
  if (choice.kind === 'latest') {
    const start = Math.max(1, top - choice.blocks + 1);
    return { start, limit: top - start + 1 };
  }
  const start = Math.min(Math.max(1, Math.floor(choice.start)), top);
  return { start, limit: Math.max(1, Math.min(choice.span, top - start + 1)) };
}

/** A "from a block" range that starts past the pinned tip: nothing to search there yet. */
export const startsPastTip = (choice: BlocksChoice, tip: number): boolean =>
  choice.kind === 'from' && choice.start > tip;

/** The range's last block. */
export const rangeEnd = (range: BlockRange): number =>
  range.start + range.limit - 1;

/** The blocks as kept, made safe: anything else is the latest 1,000. */
export function cleanBlocks(value: unknown): BlocksChoice {
  const raw = (value ?? {}) as Partial<{
    kind: unknown;
    blocks: unknown;
    start: unknown;
    span: unknown;
  }>;
  if (raw.kind === 'latest' && LATEST_SPANS.includes(raw.blocks as LatestSpan))
    return { kind: 'latest', blocks: raw.blocks as LatestSpan };
  if (raw.kind === 'from' && isBlockHeight(raw.start))
    return {
      kind: 'from',
      start: raw.start,
      span: FROM_SPANS.includes(raw.span as FromSpan)
        ? (raw.span as FromSpan)
        : FROM_SPAN,
    };
  return LATEST_BLOCKS;
}

export const cleanOrder = (value: unknown): ChainOrder =>
  value === 'oldest' ? 'oldest' : 'newest';

/** The types never listed chain-wide: messages. */
const NOT_LISTED: ReadonlySet<string> = new Set(typesFor('messages'));

/** Every type a chain-wide search may name. */
export const CHAIN_TYPES: readonly TxType[] = ALL_TX_TYPES.filter(
  (type) => !NOT_LISTED.has(type)
);

/** The kinds offered for the whole chain: every one but Messages. */
export const CHAIN_FAMILIES = TX_FAMILIES.filter(
  (family) => family.key !== 'messages'
);

/** The kind as kept, made safe: Messages (or a type of it) is All. */
export function cleanChainFilter(value: unknown): TxFilter {
  const filter = cleanFilter(value);
  return filter.kind === 'messages' ? ALL_TRANSACTIONS : filter;
}

/** The types to ask Core for: every listed type for All, never a message. */
export function chainTypes(filter: TxFilter): readonly TxType[] {
  const types =
    filter.kind === 'all' && !filter.type ? CHAIN_TYPES : typesToAsk(filter);
  return types.filter((type) => !NOT_LISTED.has(type));
}

const ARABIC_DIGIT = /[\u0660-\u0669\u06f0-\u06f9]/g;
/** Digits grouped by thousands, as people type them or Hub shows them. */
const GROUPED = /^\d{1,3}(?:[,.'\u2019_\s\u066c]\d{3})+$/;

/**
 * A block number as typed or pasted, or null: "2700000", "2,700,000",
 * "2.700.000", "2 700 000" (with a narrow space, as French shows it),
 * "٢٬٧٠٠٬٠٠٠" (Arabic digits), "#2700000". Separators must group by
 * thousands, so "1.5" isn't read as 15.
 */
export function parseBlockNumber(text: string): number | null {
  const value = String(text ?? '')
    .replace(ARABIC_DIGIT, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
    })
    .trim()
    .replace(/^#\s*/, '');
  const digits = /^\d{1,9}$/.test(value)
    ? value
    : GROUPED.test(value)
      ? value.replace(/\D/g, '')
      : null;
  if (digits === null || digits.length > 9) return null;
  const n = Number(digits);
  return isBlockHeight(n) ? n : null;
}

// ---- Reads ----------------------------------------------------------------------------

/** Ends the keys the window's Refresh reads again on this list (the tip, what waits). */
export const CHAIN_SCOPE = 'chain';

/** The chain's newest block, kept 30 seconds; a list pins it when it opens. */
export const chainTipRead = (): ReadSpec<number> => ({
  key: `tip:${CHAIN_SCOPE}`,
  ttlMs: 30_000,
  load: async () => {
    const height = await getJson<unknown>('/blocks/height');
    if (!isBlockHeight(height)) throw new CoreHttpError(200, String(height));
    return height;
  },
});

/** One page of a list: its rows, and whether the node gave a full page (it may have more). */
export interface ChainPage {
  rows: TxRow[];
  full: boolean;
}

/** A search that would leave Core's bounds is never sent. */
function checkSearch(types: readonly string[], range?: BlockRange): void {
  if (!types.length || types.some((type) => NOT_LISTED.has(type)))
    throw new RangeError('A chain-wide search names its types, never messages');
  if (
    range &&
    !(
      isBlockHeight(range.start) &&
      Number.isSafeInteger(range.limit) &&
      range.limit >= 1 &&
      range.limit <= FROM_SPAN
    )
  )
    throw new RangeError('A chain-wide search needs a block range');
}

/** The node's list as a page: a full page says it may have more. Anything but a list is a failure. */
function asPage(body: unknown): ChainPage {
  if (!Array.isArray(body)) throw new CoreHttpError(200, JSON.stringify(body));
  return { rows: toTxRows(body), full: body.length >= CHAIN_PAGE };
}

/** One list: its types, its blocks and its order. */
export const chainListKey = (
  types: readonly string[],
  range: BlockRange,
  order: ChainOrder
): string => `chain:${typesKey(types)}:${range.start}:${range.limit}:${order}`;

/** One page of confirmed transactions (kept 30 minutes: rows in blocks already made don't change). */
export const chainPageRead = (
  types: readonly string[],
  range: BlockRange,
  order: ChainOrder,
  offset: number
): ReadSpec<ChainPage> => ({
  key: `${chainListKey(types, range, order)}:${offset}`,
  ttlMs: 30 * 60_000,
  load: async () => {
    checkSearch(types, range);
    return asPage(
      await getJson<unknown>(
        `/transactions/search?${queryString({
          txType: types,
          startBlock: range.start,
          blockLimit: range.limit,
          confirmationStatus: 'CONFIRMED',
          limit: CHAIN_PAGE,
          offset,
          reverse: order === 'newest',
        })}`
      )
    );
  },
});

/** Up to 20 of the types waiting for a block, newest first (kept 20 seconds, never polled). */
export const chainWaitingRead = (
  types: readonly string[]
): ReadSpec<ChainPage> => ({
  key: `chainwaiting:${typesKey(types)}:${CHAIN_SCOPE}`,
  ttlMs: 20_000,
  load: async () => {
    checkSearch(types);
    return asPage(
      await getJson<unknown>(
        `/transactions/unconfirmed?${queryString({
          txType: types,
          limit: CHAIN_PAGE,
          reverse: true,
        })}`
      )
    );
  },
});

// ---- A list's pages ------------------------------------------------------------------------

export interface ChainList {
  /** The rows of the pages read, in order, before the first one not read; each signature once. */
  rows: TxRow[];
  /** How many pages, from the first, are read. */
  read: number;
  /** A page came back short: the node has no more rows in the range. */
  done: boolean;
  /** The first page not read: still on its way, or failed. Null when every page asked is read. */
  pending: 'loading' | 'failed' | null;
  /**
   * A row came on two pages. Core orders by each transaction's time alone,
   * so two made at the same moment can trade places between reads: another
   * may have been passed over, and the list never claims to hold them all.
   */
  repeated: boolean;
}

/**
 * The pages of one list joined, as far as they are read in order: a page
 * that failed (or is still on its way) keeps the rows above it, and the ones
 * after it wait for it. A short page ends the list.
 */
export function joinPages(
  keys: readonly string[],
  data: ReadonlyMap<string, ChainPage>,
  failed: readonly string[]
): ChainList {
  const rows: TxRow[] = [];
  const seen = new Set<string>();
  let read = 0;
  let repeated = false;
  for (const key of keys) {
    const page = data.get(key);
    if (!page)
      return {
        rows,
        read,
        done: false,
        pending: failed.includes(key) ? 'failed' : 'loading',
        repeated,
      };
    read += 1;
    // A row the node gives on two pages shows once.
    for (const row of page.rows) {
      if (seen.has(row.signature)) {
        repeated = true;
        continue;
      }
      seen.add(row.signature);
      rows.push(row);
    }
    if (!page.full) return { rows, read, done: true, pending: null, repeated };
  }
  return { rows, read, done: false, pending: null, repeated };
}

/** Which line says what the list holds: none, the only one, all of them, or the newest / oldest so far. */
export type ChainCoverage = 'none' | 'only' | 'all' | ChainOrder;

/** `repeated`: a row came on two pages, so "all" isn't certain (ChainList). */
export function chainCoverage(
  count: number,
  done: boolean,
  order: ChainOrder,
  repeated = false
): ChainCoverage {
  if (!done || repeated) return order;
  if (count === 0) return 'none';
  return count === 1 ? 'only' : 'all';
}
