/**
 * An account's names and what it did with them, for the Names tab, and
 * one step back in a name's life (nameLife.ts walks the steps). Pure: no
 * reads, no text (the components put these into words through i18n).
 *
 * - Each name's history comes from the account's name transactions (the
 *   Names kind of its Transactions tab): a rename belongs to both its old
 *   and its new name.
 * - The names it had are the ones in its history it doesn't own now: names
 *   it sold, and old names it renamed; and what each is now.
 * - The orders a Names tab can list its names in. Core lists an account's
 *   names in the order they were registered, oldest first.
 * - Which of its names have notes on how they are written (rules.ts
 *   `nameNotes`), for the Overview's Notes.
 */
import type { NameData, NamesOf, TxRow } from './reads';
import { nameNotes } from './rules';
import { typesFor } from './txFamilies';

/** Core's five name transactions: the Transactions tab's Names kind. */
export const NAME_TX_TYPES = typesFor('names');

// ---- Each name's history ----------------------------------------------------------------

const text = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** The names a name transaction is about: its name, and a rename's new name. */
export function namesOfTx(tx: TxRow): string[] {
  const names: string[] = [];
  const name = text(tx.name);
  const newName = text(tx.newName);
  if (name) names.push(name);
  if (newName && newName !== name) names.push(newName);
  return names;
}

/** Each name's transactions, in the order given (newest first, as Core answers). */
export function historyByName(rows: readonly TxRow[]): Map<string, TxRow[]> {
  const byName = new Map<string, TxRow[]>();
  for (const tx of rows) {
    for (const name of namesOfTx(tx)) {
      const list = byName.get(name);
      if (list) list.push(tx);
      else byName.set(name, [tx]);
    }
  }
  return byName;
}

/**
 * The names in its history it doesn't own now, the most recently touched
 * first: names it sold, and old names it renamed.
 */
export function pastNames(
  byName: ReadonlyMap<string, readonly TxRow[]>,
  owned: readonly string[]
): string[] {
  const now = new Set(owned);
  return [...byName.entries()]
    .filter(([name]) => !now.has(name))
    .sort(([, a], [, b]) => (b[0]?.timestamp ?? 0) - (a[0]?.timestamp ?? 0))
    .map(([name]) => name);
}

/** What a name an account had is now, from the name's record (the node matches it ignoring case and look-alike letters). */
export type PastNameNow =
  /** No one has it, nor anything the node matches with it. */
  | { kind: 'nobody' }
  /**
   * Registered since this account last had anything to do with it (the
   * name was renamed away, then taken again, maybe spelled another way):
   * another registration, whose history isn't this one's.
   */
  | { kind: 'registeredAgain'; name: string; owner: string }
  /** The same registration under another spelling now (a rename that changed only its case or look-alike letters). */
  | { kind: 'respelled'; name: string; owner: string }
  /** The same name, with its owner now. */
  | { kind: 'owned'; owner: string };

/**
 * What `name`, which this account had (its transactions about it: `txs`),
 * is now, given the node's record for it.
 */
export function pastNameNow(
  name: string,
  record: NameData | null,
  txs: readonly TxRow[]
): PastNameNow {
  if (!record) return { kind: 'nobody' };
  const lastHad = txs.reduce(
    (latest, tx) => Math.max(latest, Number(tx.timestamp) || 0),
    0
  );
  if (
    typeof record.registered === 'number' &&
    lastHad > 0 &&
    record.registered > lastHad
  )
    return {
      kind: 'registeredAgain',
      name: record.name,
      owner: record.owner,
    };
  if (record.name !== name)
    return { kind: 'respelled', name: record.name, owner: record.owner };
  return { kind: 'owned', owner: record.owner };
}

/**
 * Nothing more to its whole history than its card shows: its own
 * transactions about the name, read in full, are just its registration.
 * Any rename, sale or update since would be among them (only the owner
 * changes a name), so no read is needed to know it.
 */
export function unchangedSince(
  txs: readonly TxRow[] | undefined,
  capped: boolean
): boolean {
  return !capped && txs?.length === 1 && txs[0].type === 'REGISTER_NAME';
}

// ---- The orders of the Names tab ------------------------------------------------------------

export const NAME_SORTS = [
  'primary',
  'newest',
  'oldest',
  'az',
  'za',
  'activity',
] as const;
export type NameSort = (typeof NAME_SORTS)[number];

export const isNameSort = (value: unknown): value is NameSort =>
  NAME_SORTS.includes(value as NameSort);

/**
 * `names` (Core's order: oldest registered first) in the order picked.
 * "Primary first" is Core's order with the primary name on top; "Latest
 * activity" puts the name whose newest transaction read is the most recent
 * first, and names with none read keep Core's order after them. No order
 * reads anything.
 */
export function sortNames(
  names: readonly string[],
  sort: NameSort,
  primary: string | null,
  byName: ReadonlyMap<string, readonly TxRow[]> | null,
  language?: string
): string[] {
  const collator = new Intl.Collator(language, {
    numeric: true,
    sensitivity: 'base',
  });
  switch (sort) {
    case 'primary':
      return primary !== null && names.includes(primary)
        ? [primary, ...names.filter((name) => name !== primary)]
        : [...names];
    case 'oldest':
      return [...names];
    case 'newest':
      return [...names].reverse();
    case 'az':
      return [...names].sort(collator.compare);
    case 'za':
      return [...names].sort((a, b) => collator.compare(b, a));
    case 'activity': {
      const latest = (name: string) =>
        byName?.get(name)?.[0]?.timestamp ?? -Infinity;
      // Array.sort is stable: names with no activity read keep Core's order.
      return [...names].sort((a, b) => latest(b) - latest(a));
    }
  }
}

// ---- Notes on its other names, for the Overview -----------------------------------------------

export interface NamesWithNotes {
  /** How many of the names counted have notes. */
  withNotes: number;
  /** How many names were counted: every name listed but the primary one. */
  total: number;
  /** The primary name is left out ("of its 3 other names"). */
  besidePrimary: boolean;
  /** The names list stopped at its most (500): only the names listed are counted. */
  listed: boolean;
}

/**
 * How many of its names besides the primary one (all of them, when it has
 * none) have notes on how they are written. Null when none have, or while
 * whether it has a primary name isn't known (`primary` undefined).
 */
export function namesWithNotes(
  names: NamesOf,
  primary: string | null | undefined,
  address: string
): NamesWithNotes | null {
  if (primary === undefined) return null;
  const besidePrimary = primary !== null && names.names.includes(primary);
  const counted = besidePrimary
    ? names.names.filter((name) => name !== primary)
    : names.names;
  const withNotes = counted.filter(
    (name) => nameNotes(name, address).length > 0
  ).length;
  if (!withNotes) return null;
  return {
    withNotes,
    total: counted.length,
    besidePrimary,
    listed: names.truncated,
  };
}

// ---- One step back in a name's life --------------------------------------------------------

/** Where a transaction is on the chain: its block, then its time within it. */
export interface ChainPosition {
  height: number;
  timestamp: number;
}

/** After every transaction: where the walk starts, at the owner's latest. */
export const CHAIN_NOW: ChainPosition = {
  height: Infinity,
  timestamp: Infinity,
};

export function positionOf(tx: TxRow): ChainPosition {
  return {
    height: typeof tx.blockHeight === 'number' ? tx.blockHeight : Infinity,
    timestamp: tx.timestamp,
  };
}

/** Whether `a` comes before `b` on the chain. */
export function isBefore(a: ChainPosition, b: ChainPosition): boolean {
  return (
    a.height < b.height || (a.height === b.height && a.timestamp < b.timestamp)
  );
}

export type HowGot =
  | { kind: 'registered'; tx: TxRow }
  | { kind: 'bought'; tx: TxRow; seller: string }
  | { kind: 'renamed'; tx: TxRow; from: string }
  /** Not in the rows given: older rows may say. */
  | { kind: 'notFound' }
  /**
   * The rows don't fit together (the name was sold, or renamed away, by an
   * account before it got it): older rows can't change that.
   */
  | { kind: 'mismatch' };

export interface OwnerSpan {
  /** What it did with the name, newest first, how it got it last. */
  steps: TxRow[];
  got: HowGot;
}

/**
 * What `account` did with the name `spelling` before `before` (the next
 * owner's purchase, or a rename to the name after it), newest first, down
 * to how it got it: registered it, bought it (the seller had it before),
 * or renamed an earlier name to it (the same account had it under that
 * name). Its own transactions only: a purchase of the name from it, or the
 * name renamed away, before that point means the rows don't fit together
 * (or another time it had the name), and the span stops there.
 *
 * `rows` may be only the newest of its name transactions: the span is
 * decided by the newest row that ends it, so what older rows hold changes
 * it only when these end nowhere ("notFound").
 */
export function ownerSpan(
  rows: readonly TxRow[],
  account: string,
  spelling: string,
  before: ChainPosition
): OwnerSpan {
  const steps: TxRow[] = [];
  const newestFirst = [...rows].sort((a, b) =>
    isBefore(positionOf(a), positionOf(b))
      ? 1
      : isBefore(positionOf(b), positionOf(a))
        ? -1
        : 0
  );
  for (const tx of newestFirst) {
    if (!isBefore(positionOf(tx), before)) continue;
    const name = text(tx.name);
    const newName = text(tx.newName);
    if (name !== spelling && newName !== spelling) continue;
    if (tx.creatorAddress !== account)
      return { steps, got: { kind: 'mismatch' } };
    if (
      tx.type === 'UPDATE_NAME' &&
      name === spelling &&
      newName &&
      newName !== spelling
    )
      return { steps, got: { kind: 'mismatch' } };
    steps.push(tx);
    if (tx.type === 'REGISTER_NAME' && name === spelling)
      return { steps, got: { kind: 'registered', tx } };
    if (tx.type === 'BUY_NAME' && name === spelling) {
      const seller = text(tx.seller);
      if (seller) return { steps, got: { kind: 'bought', tx, seller } };
    }
    if (
      tx.type === 'UPDATE_NAME' &&
      newName === spelling &&
      name &&
      name !== spelling
    )
      return { steps, got: { kind: 'renamed', tx, from: name } };
  }
  return { steps, got: { kind: 'notFound' } };
}
