/**
 * How an account is linked to other accounts by its own transactions
 * (from Q-Mintership+'s rules/explorer/connections.ts): minting levels
 * moved, reward shares (its sponsor, minting with another account now,
 * the accounts it sponsored), names bought or sold, and where its first
 * QORT came from. Evidence, never a verdict: what happened, with whom,
 * when and how often; nothing here says what it means. Pure: no reads,
 * no text.
 *
 * - Level moved (TRANSFER_PRIVS): sent by the account (to its recipient,
 *   read from the transaction's raw bytes), or received from its creator.
 * - Sponsors: each account that made a reward share to this one (not a
 *   removal), the earliest first; how long the share ran is the blocks
 *   until the first removal after it. A removal is a share with a negative
 *   percent (-1, or -1000000 in old ones).
 * - Sponsees: the accounts it made reward shares to (not itself), with the
 *   first share, and whether the latest row for the pair is a share.
 * - Active shares: pairs whose latest row isn't a removal; with the online
 *   list, "minting with B now".
 * - Names: BUY_NAME bought (it is the buyer) or sold (it is the seller).
 */
import { isAtAddress, isQortAddress } from './addresses';
import { newestFirst, refOf, type TxRef } from './money';
import type { OnlineShare, TxRow } from './reads';
import { assetOf, fromAtomic, toAtomic } from './txWords';

const isAccount = (value: unknown): value is string =>
  isQortAddress(value) || isAtAddress(value);

/** A reward share that ends one: a negative percent. */
export const isRemoval = (tx: TxRow): boolean => Number(tx.sharePercent) < 0;

/** A share's percent as Core writes it ("0.00"). */
export const percentOf = (tx: TxRow): string => String(tx.sharePercent ?? '0');

/** Confirmed rows, oldest first, each once. */
function ascending(rows: readonly TxRow[]): TxRow[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => typeof row.blockHeight === 'number')
    .filter((row) =>
      seen.has(row.signature) ? false : (seen.add(row.signature), true)
    )
    .sort(
      (a, b) =>
        (a.blockHeight ?? 0) - (b.blockHeight ?? 0) || a.timestamp - b.timestamp
    );
}

export interface LevelMove {
  /** `to`: it moved its level to `other`; `from`: it got its level from `other`. */
  direction: 'to' | 'from';
  /** The other account; null when a sent move's recipient couldn't be read. */
  other: string | null;
  ref: TxRef;
  tx: TxRow;
}

export interface Sponsorship {
  sponsor: string;
  /** The first share's percent. */
  percent: string;
  start: TxRef;
  /** The first removal after the first share. */
  removal: TxRef | null;
  /** Blocks from the first share to that removal. */
  blocks: number | null;
  /** Every reward share between the two, newest first. */
  txs: TxRow[];
}

export interface Sponsee {
  address: string;
  percent: string;
  start: TxRef;
  removal: TxRef | null;
  blocks: number | null;
  /** The latest row for the pair is a share, not a removal. */
  active: boolean;
  /** Every reward share between the two, newest first. */
  txs: TxRow[];
}

export interface ActiveShare {
  other: string;
  /** Its part: it made the share (`minter`) or gets it (`recipient`). */
  role: 'minter' | 'recipient';
  percent: string;
  since: TxRef;
  tx: TxRow;
}

export interface NameDeal {
  kind: 'bought' | 'sold';
  name: string;
  /** The other account; null when the transaction doesn't name a valid one. */
  other: string | null;
  ref: TxRef;
  tx: TxRow;
}

export interface Links {
  levelMoves: LevelMove[];
  /** The earliest first: [0] is its sponsor. */
  sponsors: Sponsorship[];
  /** In the order of their first share. */
  sponsees: Sponsee[];
  activeShares: ActiveShare[];
  nameDeals: NameDeal[];
}

/** One pair's shares (oldest first): the first share, the first removal after it, the latest row. */
function pairFacts(rows: readonly TxRow[]) {
  const firstShare = rows.find((row) => !isRemoval(row)) ?? null;
  const removal = firstShare
    ? (rows.find(
        (row) =>
          isRemoval(row) &&
          (row.blockHeight ?? 0) >= (firstShare.blockHeight ?? 0)
      ) ?? null)
    : null;
  const latest = rows[rows.length - 1];
  return {
    firstShare,
    removal,
    blocks:
      firstShare && removal
        ? (removal.blockHeight ?? 0) - (firstShare.blockHeight ?? 0)
        : null,
    active: Boolean(latest) && !isRemoval(latest),
  };
}

function byPair(
  rows: readonly TxRow[],
  keyOf: (row: TxRow) => string | null
): Map<string, TxRow[]> {
  const pairs = new Map<string, TxRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const list = pairs.get(key);
    if (list) list.push(row);
    else pairs.set(key, [row]);
  }
  return pairs;
}

/** Reward shares between two valid accounts, oldest first. */
const shareRows = (rows: readonly TxRow[]) =>
  ascending(rows).filter(
    (row) =>
      row.type === 'REWARD_SHARE' &&
      isQortAddress(row.creatorAddress) &&
      isQortAddress(row.recipient)
  );

const reversed = (rows: readonly TxRow[]) => [...rows].sort(newestFirst);

/** The accounts `sponsor` made reward shares to, in the order of their first share. */
export function sponseesOf(rows: readonly TxRow[], sponsor: string): Sponsee[] {
  const made = shareRows(rows).filter(
    (row) => row.creatorAddress === sponsor && row.recipient !== sponsor
  );
  const sponsees: Sponsee[] = [];
  for (const [address, pair] of byPair(made, (row) => row.recipient ?? null)) {
    const facts = pairFacts(pair);
    if (!facts.firstShare) continue;
    sponsees.push({
      address,
      percent: percentOf(facts.firstShare),
      start: refOf(facts.firstShare),
      removal: facts.removal ? refOf(facts.removal) : null,
      blocks: facts.blocks,
      active: facts.active,
      txs: reversed(pair),
    });
  }
  return sponsees.sort((a, b) => a.start.height - b.start.height);
}

/**
 * Everything `rows` (its minting and name transactions) say about how
 * `address` is linked. `privs` holds the recipient of each level move it
 * sent (null when its bytes couldn't be read; absent while unread).
 */
export function linksOf(
  rows: readonly TxRow[],
  address: string,
  privs: Readonly<Record<string, string | null>> = {}
): Links {
  const sorted = ascending(rows);

  const levelMoves: LevelMove[] = sorted
    .filter((row) => row.type === 'TRANSFER_PRIVS')
    .map((row): LevelMove => {
      const mine = row.creatorAddress === address;
      const recipient = privs[row.signature];
      return {
        direction: mine ? 'to' : 'from',
        other: mine
          ? isQortAddress(recipient)
            ? recipient
            : null
          : isQortAddress(row.creatorAddress)
            ? row.creatorAddress
            : null,
        ref: refOf(row),
        tx: row,
      };
    })
    .filter((move) => move.direction === 'to' || move.other !== null);

  const shares = shareRows(sorted);
  const toIt = shares.filter(
    (row) => row.recipient === address && row.creatorAddress !== address
  );
  const sponsors: Sponsorship[] = [];
  for (const [sponsor, pair] of byPair(
    toIt,
    (row) => row.creatorAddress ?? null
  )) {
    const facts = pairFacts(pair);
    if (!facts.firstShare) continue;
    sponsors.push({
      sponsor,
      percent: percentOf(facts.firstShare),
      start: refOf(facts.firstShare),
      removal: facts.removal ? refOf(facts.removal) : null,
      blocks: facts.blocks,
      txs: reversed(pair),
    });
  }
  sponsors.sort((a, b) => a.start.height - b.start.height);

  const activeShares: ActiveShare[] = [];
  for (const pair of byPair(shares, (row) =>
    row.creatorAddress === row.recipient
      ? null
      : `${row.creatorAddress}>${row.recipient}`
  ).values()) {
    const latest = pair[pair.length - 1];
    if (isRemoval(latest)) continue;
    const minter = latest.creatorAddress as string;
    const recipient = latest.recipient as string;
    if (minter !== address && recipient !== address) continue;
    activeShares.push({
      other: minter === address ? recipient : minter,
      role: minter === address ? 'minter' : 'recipient',
      percent: percentOf(latest),
      since: refOf(latest),
      tx: latest,
    });
  }

  const nameDeals: NameDeal[] = [];
  for (const row of sorted) {
    if (row.type !== 'BUY_NAME') continue;
    const seller = isAccount(row.seller) ? row.seller : null;
    const buyer = isAccount(row.creatorAddress) ? row.creatorAddress : null;
    const deal = {
      name: typeof row.name === 'string' ? row.name : '',
      ref: refOf(row),
      tx: row,
    };
    if (buyer === address)
      nameDeals.push({ kind: 'bought', other: seller, ...deal });
    else if (seller === address)
      nameDeals.push({ kind: 'sold', other: buyer, ...deal });
  }

  return {
    levelMoves,
    sponsors,
    sponsees: sponseesOf(sorted, address),
    activeShares,
    nameDeals,
  };
}

/** The account's active shares minting now (in the online list). */
export function mintingWithNow(
  links: Pick<Links, 'activeShares'>,
  address: string,
  online: readonly OnlineShare[]
): ActiveShare[] {
  const live = new Set(
    online.map((share) => `${share.minterAddress}>${share.recipientAddress}`)
  );
  return links.activeShares.filter((share) =>
    live.has(
      share.role === 'minter'
        ? `${address}>${share.other}`
        : `${share.other}>${address}`
    )
  );
}

/** Whether the online list pairs `address` with another account now. */
export const pairedOnline = (
  online: readonly OnlineShare[],
  address: string
): boolean =>
  online.some(
    (share) =>
      share.minterAddress !== share.recipientAddress &&
      (share.minterAddress === address || share.recipientAddress === address)
  );

/**
 * Level moves between the same two accounts the same way, together (one
 * account can send another several in one block), in the order of their
 * first move. A sent move whose recipient couldn't be read stands alone.
 */
export function groupLevelMoves(moves: readonly LevelMove[]): LevelMove[][] {
  const groups = new Map<string, LevelMove[]>();
  for (const move of moves) {
    const key = `${move.direction}:${move.other ?? move.tx.signature}`;
    groups.set(key, [...(groups.get(key) ?? []), move]);
  }
  return [...groups.values()];
}

// ---- Where its first QORT came from -------------------------------------------------------

export type FundingKind =
  | 'payment'
  | 'multiPayment'
  | 'transferAsset'
  | 'at'
  | 'rewardShare'
  | 'transferPrivs'
  | 'genesis';

export interface Funding {
  /**
   * The kind of transaction. A multi-payment counts as 'multiPayment' only
   * when it paid the account QORT; one that paid it another asset is an
   * asset transfer.
   */
  kind: FundingKind;
  /** Who it came from (an AT's own address for an AT's payout); null for the genesis block. */
  from: string | null;
  /** What it gave, as Core writes it (payments, transfers, an AT, the genesis block). */
  amount?: string;
  /** The asset of `amount`: 0 is QORT. */
  assetId?: number | null;
  assetName?: string | null;
  /** A reward share's percent. */
  sharePercent?: string;
  height: number;
  timestamp: number;
  signature: string;
  /** The transaction itself, as the evidence behind it. */
  tx: TxRow;
}

/** What `tx` gave `address`, if it is a confirmed transaction that sends something to it. */
export function fundingFrom(tx: TxRow, address: string): Funding | null {
  if (typeof tx.blockHeight !== 'number') return null;
  const base = {
    height: tx.blockHeight,
    timestamp: tx.timestamp,
    signature: tx.signature,
    tx,
  };
  const creator = isAccount(tx.creatorAddress) ? tx.creatorAddress : null;
  const asset = (id: unknown, name: unknown) => {
    const ref = assetOf(id, name);
    return { assetId: ref.id, assetName: ref.name };
  };
  switch (tx.type) {
    case 'PAYMENT':
      return tx.recipient === address
        ? {
            ...base,
            kind: 'payment',
            from: creator,
            amount: String(tx.amount ?? '0'),
            assetId: 0,
          }
        : null;
    case 'TRANSFER_ASSET':
      return tx.recipient === address
        ? {
            ...base,
            kind: 'transferAsset',
            from: creator,
            amount: String(tx.amount ?? '0'),
            ...asset(tx.assetId, tx.assetName),
          }
        : null;
    case 'MULTI_PAYMENT': {
      // Core takes a multi-payment of any asset as a new account's first
      // transaction: it is a QORT payment only when it paid QORT.
      const payments = Array.isArray(tx.payments)
        ? (tx.payments as Array<Record<string, unknown>>)
        : [];
      const its = payments.filter((payment) => payment?.recipient === address);
      const qort = its.filter((payment) => assetOf(payment.assetId).id === 0);
      // All it paid this account in QORT, else all of the first asset it paid it.
      const first = its[0];
      const paid = qort.length
        ? qort
        : its.filter(
            (payment) =>
              first && assetOf(payment.assetId).id === assetOf(first.assetId).id
          );
      if (!paid.length) return null;
      const total = paid.reduce(
        (sum, payment) => sum + (toAtomic(payment.amount) ?? 0n),
        0n
      );
      return {
        ...base,
        kind: qort.length ? 'multiPayment' : 'transferAsset',
        from: creator,
        amount: fromAtomic(total),
        ...asset(paid[0].assetId, paid[0].assetName),
      };
    }
    case 'AT':
      return tx.recipient === address
        ? {
            ...base,
            kind: 'at',
            from: isAtAddress(tx.atAddress) ? tx.atAddress : null,
            amount: String(tx.amount ?? '0'),
            ...asset(tx.assetId, tx.assetName),
          }
        : null;
    case 'REWARD_SHARE':
      return tx.recipient === address && creator !== address
        ? {
            ...base,
            kind: 'rewardShare',
            from: creator,
            sharePercent: percentOf(tx),
          }
        : null;
    case 'TRANSFER_PRIVS':
      // Its recipient isn't in Core's JSON; the reference chain names it.
      return creator && creator !== address
        ? { ...base, kind: 'transferPrivs', from: creator }
        : null;
    case 'GENESIS':
      // The genesis block gave out other assets than QORT: keep which one.
      return tx.recipient === address
        ? {
            ...base,
            kind: 'genesis',
            from: null,
            amount: String(tx.amount ?? '0'),
            ...asset(tx.assetId, tx.assetName),
          }
        : null;
    default:
      return null;
  }
}

/** First transactions that take any reference, so theirs isn't the one that funded it. */
export const NO_REAL_REFERENCE: ReadonlySet<string> = new Set([
  'PUBLICIZE',
  'ARBITRARY',
]);

// ---- What was checked and found nothing -----------------------------------------------------

/** A part of what was read that found nothing, in the order the page lists them (its key under `explorer:connections.empty`). */
export type EmptyCheck =
  | 'level_moves'
  | 'sponsor'
  | 'sponsees'
  | 'minting_with'
  | 'name_sales'
  | 'asset_trades'
  | 'payments'
  | 'first_qort';
