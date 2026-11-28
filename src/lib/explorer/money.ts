/**
 * QORT and Q-Assets that moved between an account and others, grouped by
 * the other account (from Q-Mintership+'s rules/explorer/money.ts): how
 * many transactions, how much (added as whole atomic units, 1 QORT =
 * 100,000,000, never as floats), the first and the last. Sent and
 * received are kept apart; AT addresses (programs on the chain) are told
 * apart from personal accounts. Pure: no reads, no text.
 *
 * The rows are the account's payments, Q-Asset transfers and
 * multi-payments: the Transactions tab's Payments kind
 * (`txlist:MULTI_PAYMENT,PAYMENT,TRANSFER_ASSET:<address>`).
 */
import { isAtAddress } from './addresses';
import type { TxRow } from './reads';
import {
  assetOf,
  fromAtomic,
  toAtomic,
  type Amount,
  type AssetRef,
} from './txWords';

const ACCOUNT_RE = /^[QA][1-9A-HJ-NP-Za-km-z]{33}$/;

/** Where in the chain a transaction is. */
export interface TxRef {
  /** Its block; 0 when it has none (it waits for one). */
  height: number;
  timestamp: number;
  signature: string;
}

export const refOf = (tx: TxRow): TxRef => ({
  height: typeof tx.blockHeight === 'number' ? tx.blockHeight : 0,
  timestamp: tx.timestamp,
  signature: tx.signature,
});

/** Newest first: by block, then by time. */
export const newestFirst = (a: TxRow, b: TxRow): number =>
  (b.blockHeight ?? 0) - (a.blockHeight ?? 0) || b.timestamp - a.timestamp;

export type FlowDirection = 'sent' | 'received';

/** One asset moved, added up (QORT is kept apart, in `qort`). */
export interface AssetSum {
  asset: AssetRef;
  atomic: bigint;
}

/** What moved one way between the account and one other account. */
export interface Flow {
  /** The other account. */
  address: string;
  /** An AT (a program on the chain), not a personal account. */
  isAt: boolean;
  /** Transactions. */
  count: number;
  /** QORT, in atomic units. */
  qort: bigint;
  /** Q-Assets, in the order first seen (newest first). */
  assets: AssetSum[];
  first: TxRef;
  last: TxRef;
  /** The transactions, newest first. */
  txs: TxRow[];
}

interface Part {
  other: string;
  asset: AssetRef;
  atomic: bigint;
}

/** What `tx` moved between `address` and others, one way. */
function partsOf(tx: TxRow, address: string, direction: FlowDirection): Part[] {
  const creator =
    typeof tx.creatorAddress === 'string' ? tx.creatorAddress : null;
  const sent = creator === address;
  if (direction === 'sent' ? !sent : sent || !creator) return [];
  const one = (
    recipient: unknown,
    amount: unknown,
    asset: AssetRef
  ): Part[] => {
    if (typeof recipient !== 'string' || !ACCOUNT_RE.test(recipient)) return [];
    if (direction === 'sent' ? recipient === address : recipient !== address)
      return [];
    const atomic = toAtomic(amount);
    if (atomic === null) return [];
    return [
      {
        other: direction === 'sent' ? recipient : (creator as string),
        asset,
        atomic,
      },
    ];
  };
  switch (tx.type) {
    case 'PAYMENT':
      return one(tx.recipient, tx.amount, { id: 0, name: null });
    case 'TRANSFER_ASSET':
      return one(tx.recipient, tx.amount, assetOf(tx.assetId, tx.assetName));
    case 'MULTI_PAYMENT':
      return (
        Array.isArray(tx.payments)
          ? (tx.payments as Array<Record<string, unknown>>)
          : []
      )
        .filter(Boolean)
        .flatMap((payment) =>
          one(
            payment.recipient,
            payment.amount,
            assetOf(payment.assetId, payment.assetName)
          )
        );
    default:
      return [];
  }
}

const sameAsset = (a: AssetRef, b: AssetRef) =>
  a.id === b.id && (a.id !== null || a.name === b.name);

/**
 * `rows` grouped by the other account, one way, the newest first. Each
 * confirmed transaction counts once per account (a multi-payment paying
 * one account twice is one transaction); one waiting for a block isn't
 * counted.
 */
export function flowsOf(
  rows: readonly TxRow[],
  address: string,
  direction: FlowDirection
): Flow[] {
  const seen = new Set<string>();
  const flows = new Map<string, Flow>();
  const ordered = rows
    .filter((row) => typeof row.blockHeight === 'number')
    .filter((row) =>
      seen.has(row.signature) ? false : (seen.add(row.signature), true)
    )
    .sort(newestFirst);
  for (const tx of ordered) {
    const counted = new Set<string>();
    for (const part of partsOf(tx, address, direction)) {
      let flow = flows.get(part.other);
      if (!flow) {
        flow = {
          address: part.other,
          isAt: isAtAddress(part.other),
          count: 0,
          qort: 0n,
          assets: [],
          first: refOf(tx),
          last: refOf(tx),
          txs: [],
        };
        flows.set(part.other, flow);
      }
      if (!counted.has(part.other)) {
        counted.add(part.other);
        flow.count += 1;
        flow.txs.push(tx);
        // Newest first: each older one moves `first` back.
        flow.first = refOf(tx);
      }
      if (part.asset.id === 0) flow.qort += part.atomic;
      else {
        const sum = flow.assets.find((each) =>
          sameAsset(each.asset, part.asset)
        );
        if (sum) sum.atomic += part.atomic;
        else flow.assets.push({ asset: part.asset, atomic: part.atomic });
      }
    }
  }
  return [...flows.values()];
}

/** What a flow moved, for its sentence: QORT first (also when nothing else moved), then each Q-Asset. */
export function flowAmounts(flow: Pick<Flow, 'qort' | 'assets'>): Amount[] {
  const amounts: Amount[] = [];
  if (flow.qort > 0n || flow.assets.length === 0)
    amounts.push({
      amount: fromAtomic(flow.qort),
      asset: { id: 0, name: null },
    });
  for (const sum of flow.assets)
    amounts.push({ amount: fromAtomic(sum.atomic), asset: sum.asset });
  return amounts;
}

export const FLOW_SORTS = ['count', 'total', 'latest', 'first'] as const;
export type FlowSort = (typeof FLOW_SORTS)[number];

export const isFlowSort = (value: unknown): value is FlowSort =>
  FLOW_SORTS.includes(value as FlowSort);

/**
 * Most transactions first, most QORT first, the latest payment first or
 * the earliest first; ties by the latest, then the other's address.
 */
export function sortFlows(flows: readonly Flow[], sort: FlowSort): Flow[] {
  const byQort = (a: Flow, b: Flow) =>
    a.qort === b.qort ? 0 : a.qort > b.qort ? -1 : 1;
  const primary = (a: Flow, b: Flow): number => {
    switch (sort) {
      case 'count':
        return b.count - a.count || byQort(a, b);
      case 'total':
        return byQort(a, b) || b.count - a.count;
      case 'latest':
        return (
          b.last.height - a.last.height || b.last.timestamp - a.last.timestamp
        );
      case 'first':
        return (
          a.first.height - b.first.height ||
          a.first.timestamp - b.first.timestamp
        );
    }
  };
  return [...flows].sort(
    (a, b) =>
      primary(a, b) ||
      b.last.height - a.last.height ||
      a.address.localeCompare(b.address)
  );
}

/** Personal accounts and AT addresses apart, each in the order given. */
export function splitAt(flows: readonly Flow[]): {
  people: Flow[];
  ats: Flow[];
} {
  return {
    people: flows.filter((flow) => !flow.isAt),
    ats: flows.filter((flow) => flow.isAt),
  };
}
