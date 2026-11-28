/**
 * Sets of accounts (from Q-Mintership+'s data/explorer/sets.ts,
 * data/explorer/funded.ts and pages/explorer/sets/): the accounts a
 * sponsor sponsored, the accounts whose first QORT payment came from an
 * account, and the checks run across a set on request. Pure: no reads,
 * no text. Facts with their denominators, never a verdict.
 */
import { isAtAddress, isQortAddress } from './addresses';
import { isFirstQortPayment } from './compare';
import type { FirstReceived, FundedPage } from './compareReads';
import {
  sponseesOf,
  isRemoval,
  type Funding,
  type Sponsee,
} from './connections';
import { flowsOf } from './money';
import type { OnlineShare, TxRow } from './reads';
import type { TxSentenceSpec } from './txWords';

// ---- The accounts a sponsor sponsored ------------------------------------------------

export interface SponseeRow extends Sponsee {
  /** Reward shares made to it (removals not counted). */
  shares: number;
  /** In a reward share online now; null while the online list isn't read. */
  mintingNow: boolean | null;
}

/** The accounts `sponsor` made reward shares to, in the order of their first share, with who mints now. */
export function sponseeRows(
  rows: readonly TxRow[],
  sponsor: string,
  online: readonly OnlineShare[] | null | undefined
): SponseeRow[] {
  const minting = new Set<string>();
  for (const share of online ?? []) {
    minting.add(share.minterAddress);
    minting.add(share.recipientAddress);
  }
  return sponseesOf(rows, sponsor).map((sponsee) => ({
    ...sponsee,
    shares: sponsee.txs.filter((tx) => !isRemoval(tx)).length,
    mintingNow: online ? minting.has(sponsee.address) : null,
  }));
}

/**
 * Their orders: the first sponsored first (as read), the latest first, the
 * shares still running first, those minting now first, or the most shares
 * first. Ties keep the order of the first share.
 */
export const SPONSEE_SORTS = [
  'first',
  'latest',
  'active',
  'minting',
  'shares',
] as const;
export type SponseeSort = (typeof SPONSEE_SORTS)[number];

export const isSponseeSort = (value: unknown): value is SponseeSort =>
  SPONSEE_SORTS.includes(value as SponseeSort);

const byStart = (a: SponseeRow, b: SponseeRow) =>
  a.start.height - b.start.height || a.start.timestamp - b.start.timestamp;

export function sortSponsees(
  rows: readonly SponseeRow[],
  sort: SponseeSort
): SponseeRow[] {
  const first =
    (yes: (row: SponseeRow) => boolean) => (a: SponseeRow, b: SponseeRow) =>
      Number(yes(b)) - Number(yes(a));
  const primary: Record<SponseeSort, (a: SponseeRow, b: SponseeRow) => number> =
    {
      first: () => 0,
      latest: (a, b) => -byStart(a, b),
      active: first((row) => row.active),
      minting: first((row) => row.mintingNow === true),
      shares: (a, b) => b.shares - a.shares,
    };
  return [...rows].sort((a, b) => primary[sort](a, b) || byStart(a, b));
}

// ---- Whose first QORT payment came from an account -----------------------------------

/** An account it paid, with its own first payment to it. */
export interface Paid {
  address: string;
  height: number;
  timestamp: number;
  amount: string;
  signature: string;
}

export interface PaidAccounts {
  /** The accounts it paid, in the order of its first payment to each (oldest first). */
  paid: Paid[];
  /** AT addresses it paid (programs on the chain), left out. */
  atLeftOut: number;
}

/** The accounts `payer` paid in `rows` (its QORT payments sent, oldest first). */
export function paidAccounts(
  rows: readonly TxRow[],
  payer: string
): PaidAccounts {
  const paid = new Map<string, Paid>();
  const ats = new Set<string>();
  for (const row of rows) {
    if (typeof row.blockHeight !== 'number') continue;
    const to = row.recipient;
    if (to === payer) continue;
    if (isAtAddress(to)) {
      ats.add(to);
      continue;
    }
    if (!isQortAddress(to) || paid.has(to)) continue;
    paid.set(to, {
      address: to,
      height: row.blockHeight,
      timestamp: row.timestamp,
      amount: String(row.amount ?? '0'),
      signature: row.signature,
    });
  }
  return { paid: [...paid.values()], atLeftOut: ats.size };
}

/** What Funded's pages read so far add up to. */
export interface FundedRead {
  /** Its QORT payments sent, oldest first, as far as the pages were read in order. */
  rows: TxRow[];
  /** The node can't read payments between accounts. */
  unsupported: boolean;
  /** Every QORT payment it sent was read. */
  complete: boolean;
  /** The last page the Explorer reads came back full, and one more row showed it sent more. */
  beyond: boolean;
  /** How many pages were read, in order. */
  through: number;
}

/**
 * Funded's pages in order (undefined: not read yet; null: the node can't
 * read them), as far as each page before it came back full: a short page
 * is the end, and so is the last page the Explorer reads when no row came
 * past it.
 */
export function fundedRead(
  pages: ReadonlyArray<FundedPage | null | undefined>
): FundedRead {
  const read: FundedRead = {
    rows: [],
    unsupported: false,
    complete: false,
    beyond: false,
    through: 0,
  };
  for (const page of pages) {
    if (page === undefined) break;
    if (page === null) {
      read.unsupported = true;
      break;
    }
    read.rows.push(...page.rows);
    read.through += 1;
    if (!page.full) {
      read.complete = true;
      break;
    }
    if (page.beyond !== undefined) {
      read.beyond = page.beyond;
      read.complete = !page.beyond;
    }
  }
  return read;
}

/**
 * The accounts whose earliest QORT payment received came from `payer`,
 * among those checked (`checks` holds each checked account's answer).
 */
export function firstPaidBy(
  paid: readonly Paid[],
  checks: ReadonlyMap<string, FirstReceived | null>,
  payer: string
): Paid[] {
  return paid.filter((each) => checks.get(each.address)?.from === payer);
}

// ---- Checks across a set ---------------------------------------------------------------

/**
 * A check's sentence, "… of the N accounts checked": counted (and its
 * words chosen) by the accounts whose check came back, never the set's
 * size (one stopped, or whose read failed, isn't one of them); one account
 * checked has a sentence of its own.
 */
export function setSentence(
  key: 'first_payer' | 'went_to',
  checked: number,
  slots: TxSentenceSpec['slots']
): TxSentenceSpec {
  return checked === 1
    ? { base: 'explorer:sets.say', key: `${key}_single`, slots }
    : {
        base: 'explorer:sets.say',
        key,
        count: checked,
        slots: { ...slots, total: { kind: 'number', value: checked } },
      };
}

export interface FirstPayerGroup {
  from: string;
  /** The accounts of the set whose first QORT payment it made. */
  accounts: string[];
}

/**
 * Where each account's first QORT came from, grouped by who paid it (the
 * most accounts first); `other` counts first transactions of another kind
 * (a multi-payment, a reward share, a level move, an asset transfer, an AT,
 * the genesis block), `none` those with none found.
 */
export function groupFirstPayers(
  funding: ReadonlyMap<string, Funding | null>
): { payers: FirstPayerGroup[]; other: number; none: number } {
  const payers = new Map<string, string[]>();
  let other = 0;
  let none = 0;
  for (const [address, first] of funding) {
    if (!first) none += 1;
    else if (isFirstQortPayment(first) && first.from)
      payers.set(first.from, [...(payers.get(first.from) ?? []), address]);
    else other += 1;
  }
  return {
    payers: [...payers]
      .map(([from, accounts]) => ({ from, accounts }))
      .sort(
        (a, b) =>
          b.accounts.length - a.accounts.length || a.from.localeCompare(b.from)
      ),
    other,
    none,
  };
}

export interface WentTo {
  address: string;
  /** The accounts of the set that paid it. */
  from: string[];
  /** Payments to it, from all of them. */
  count: number;
  /** QORT to it, in atomic units. */
  qort: bigint;
}

/**
 * Where a set of accounts sent QORT, from each one's payments sent: the
 * accounts paid by the most of them first (the set's own accounts too).
 * AT addresses are left out and counted.
 */
export function wentTo(sent: ReadonlyMap<string, readonly TxRow[]>): {
  recipients: WentTo[];
  atLeftOut: number;
} {
  const recipients = new Map<
    string,
    { from: Set<string>; count: number; qort: bigint }
  >();
  const ats = new Set<string>();
  for (const [payer, rows] of sent)
    for (const flow of flowsOf(rows, payer, 'sent')) {
      if (flow.isAt) {
        ats.add(flow.address);
        continue;
      }
      const entry = recipients.get(flow.address) ?? {
        from: new Set<string>(),
        count: 0,
        qort: 0n,
      };
      entry.from.add(payer);
      entry.count += flow.count;
      entry.qort += flow.qort;
      recipients.set(flow.address, entry);
    }
  return {
    recipients: [...recipients]
      .map(([address, entry]) => ({
        address,
        from: [...entry.from],
        count: entry.count,
        qort: entry.qort,
      }))
      .sort(
        (a, b) =>
          b.from.length - a.from.length ||
          b.count - a.count ||
          (a.qort === b.qort ? 0 : a.qort > b.qort ? -1 : 1) ||
          a.address.localeCompare(b.address)
      ),
    atLeftOut: ats.size,
  };
}
