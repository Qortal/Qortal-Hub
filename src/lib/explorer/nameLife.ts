/**
 * A name's whole history: every name transaction of its current
 * registration, by each account that had it and under its earlier
 * spellings, newest first.
 *
 * Core has no history by name, so it is walked back from the name's
 * record (`/names/<name>`: its owner now, and the spelling it is registered
 * under): each owner's name transactions (the Names kind of its
 * Transactions tab, read 100 at a time, newest first), down to how that
 * owner got the name (names.ts `ownerSpan`): bought it (the seller's come
 * next, before the sale), renamed an earlier name to it (the same
 * account's, under that name), or registered it, where the walk ends.
 *
 * - Each owner is read only as far as it takes to find how it got the
 *   name, and at most NAME_LIFE_ROWS of its name transactions (ten reads).
 *   An account met again on the way (a rename, a name bought back) goes on
 *   from what was read of it.
 * - At most NAME_LIFE_HOPS owners and spellings are gone back through, one
 *   after another.
 * - Where it stops short it says so: an owner's name transactions go back
 *   further than can be read (`capped`), they don't say how it got the name
 *   (`notFound`), or too many steps (`hops`).
 * - The registration found is checked against the record's, which Core
 *   keeps through sales and renames. A name renamed away and registered
 *   again is a new registration: Core keeps no link to the one before.
 *
 * Kept as one entry of the window's cache, `namelife:<name>` (the name as
 * asked for), so the name step's Refresh reads all of it again. GETs only.
 */
import { ACCOUNT_TX_PAGE, readTxPage } from './accountTx';
import {
  CHAIN_NOW,
  NAME_TX_TYPES,
  ownerSpan,
  positionOf,
  type ChainPosition,
  type OwnerSpan,
} from './names';
import type { NameData, ReadSpec, TxRow } from './reads';

/** Owners and spellings gone back through at most. */
export const NAME_LIFE_HOPS = 12;
/** The most name transactions of one account read for it: ten reads of 100. */
export const NAME_LIFE_ROWS = 1000;

export type NameLifeEnd =
  /** Down to its registration; `matches`: the one its record gives. */
  | { kind: 'registered'; tx: TxRow; matches: boolean }
  /**
   * Cut short at `at`, the account whose part couldn't be read through:
   * its name transactions go back further than can be read (`capped`), they
   * don't say how it got the name (`notFound`), or too many steps (`hops`).
   */
  | { kind: 'cut'; at: string; why: 'capped' | 'notFound' | 'hops' };

export interface NameLife {
  /** The name as registered (the node matches names ignoring case and look-alike letters). */
  name: string;
  /** Its owner now. */
  owner: string;
  /** Newest first. */
  steps: TxRow[];
  /** The accounts that had it, its owner first (one that had it twice, twice). */
  owners: string[];
  end: NameLifeEnd;
  /** When its record says it was registered (Core's ms), if it says. */
  registered: number | null;
  /** How many pages of name transactions were read for it. */
  reads: number;
}

/** One page of an account's name transactions, newest first, from `offset`. */
export type NamePageReader = (
  address: string,
  offset: number
) => Promise<TxRow[]>;

const readNamePage: NamePageReader = (address, offset) =>
  readTxPage(address, NAME_TX_TYPES, offset);

/** What one walk has read of an account's name transactions, newest first. */
interface AccountRows {
  rows: TxRow[];
  seen: Set<string>;
  /** Where the next older page starts. */
  next: number;
  /** Core has no older ones. */
  done: boolean;
}

/**
 * How `account` got the name `spelling` (before `before`), from what this
 * walk read of its name transactions, reading on a page at a time until
 * its span is decided, they end, or NAME_LIFE_ROWS of them were read. An
 * account met again (a rename, a name bought back) goes on from what was
 * read of it.
 */
async function spanOf(
  held: AccountRows,
  account: string,
  spelling: string,
  before: ChainPosition,
  readPage: NamePageReader
): Promise<{ span: OwnerSpan; capped: boolean; reads: number }> {
  let reads = 0;
  for (;;) {
    const span = ownerSpan(held.rows, account, spelling, before);
    if (span.got.kind !== 'notFound' || held.done)
      return { span, capped: false, reads };
    if (held.next >= NAME_LIFE_ROWS) return { span, capped: true, reads };
    const page = await readPage(account, held.next);
    reads += 1;
    // The list grows at its top while it is read: a page may repeat rows.
    for (const row of page)
      if (!held.seen.has(row.signature)) {
        held.seen.add(row.signature);
        held.rows.push(row);
      }
    held.next += ACCOUNT_TX_PAGE;
    held.done = page.length < ACCOUNT_TX_PAGE;
  }
}

/** The name's whole history, walked back from its record. */
export async function walkNameLife(
  record: NameData,
  readPage: NamePageReader = readNamePage
): Promise<NameLife> {
  const registered =
    typeof record.registered === 'number' ? record.registered : null;
  const steps: TxRow[] = [];
  const owners: string[] = [];
  let reads = 0;
  let account = record.owner;
  let spelling = record.name;
  let before: ChainPosition = CHAIN_NOW;
  const read = new Map<string, AccountRows>();
  const life = (end: NameLifeEnd): NameLife => ({
    name: record.name,
    owner: record.owner,
    steps,
    owners,
    end,
    registered,
    reads,
  });
  for (let hop = 0; hop < NAME_LIFE_HOPS; hop += 1) {
    if (owners[owners.length - 1] !== account) owners.push(account);
    const held = read.get(account) ?? {
      rows: [],
      seen: new Set<string>(),
      next: 0,
      done: false,
    };
    read.set(account, held);
    const part = await spanOf(held, account, spelling, before, readPage);
    reads += part.reads;
    steps.push(...part.span.steps);
    const got = part.span.got;
    if (got.kind === 'registered')
      return life({
        kind: 'registered',
        tx: got.tx,
        matches: registered === null || registered === got.tx.timestamp,
      });
    if (got.kind === 'notFound' || got.kind === 'mismatch')
      return life({
        kind: 'cut',
        at: account,
        why: part.capped ? 'capped' : 'notFound',
      });
    before = positionOf(got.tx);
    if (got.kind === 'bought') account = got.seller;
    else spelling = got.from;
  }
  return life({ kind: 'cut', at: account, why: 'hops' });
}

/** The cache key of a name's whole history: ends with the name, so its Refresh forgets it. */
export const nameLifeKey = (name: string) => `namelife:${name}`;

/**
 * A name's whole history, or null when no one has the name now.
 * `readRecord` reads its record through the window's cache, so the page
 * showing the record and this walk share one read.
 */
export const nameLifeRead = (
  name: string,
  readRecord: () => Promise<NameData | null>,
  readPage: NamePageReader = readNamePage
): ReadSpec<NameLife | null> => ({
  key: nameLifeKey(name),
  ttlMs: 10 * 60_000,
  load: async () => {
    const record = await readRecord();
    return record ? walkNameLife(record, readPage) : null;
  },
});
