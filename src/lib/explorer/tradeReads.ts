/**
 * The Trades tab's reads beyond its completed trades (qortReads.ts
 * `portalTradesRead`) and its Q-Asset trades (assetTrades.ts), from
 * Q-Mintership+'s data/explorer/portalTrades.ts. All public GETs, each
 * kept under the account's address (its Refresh reads them again); a
 * failed read throws, and "none" is the node's own short list.
 *
 * - The trade offers it made: its DEPLOY_AT transactions (each one AT; the
 *   tags name the coin, "ACCT QORT LTC"), 100 a read, up to OFFERS_MAX; one
 *   more row then says whether it made more.
 * - The payouts it got from contracts (AT transactions to it): a finished
 *   offer pays what it holds back to its creator, so they tell an offer
 *   that ended from one still open; for an account without a public key
 *   they are its purchases. 100 a read, up to PAYOUTS_MAX, one more row
 *   after. Read only when it made an offer, or has no public key.
 * - For an account without a public key: each contract that paid it, by
 *   its own record (`/crosschain/trade/<at>`), the newest CONTRACTS_MAX:
 *   Core can't list its trades by a key it doesn't have, but a contract's
 *   record names where the QORT went, the coin and the seller.
 *
 * Nothing here writes.
 */
import { CoreHttpError, getJson, isCoreError, queryString, seg } from './core';
import { chainOfOffer, type OfferDeployed } from './portalTrades';
import { toTxRows, type ReadSpec, type TxRow } from './reads';
import { toAtomic } from './txWords';

const MINUTE = 60_000;
const PAGE = 100;
/** Its DEPLOY_AT transactions read at most: ten reads. */
export const OFFERS_MAX = 1000;
/** The payouts it got from contracts read at most: twenty reads. */
export const PAYOUTS_MAX = 2000;
/** Contracts that paid an account without a public key, read one by one, at most. */
export const CONTRACTS_MAX = 100;
/** Core's "account address unknown" and "invalid search criteria" (not a trade contract). */
const ADDRESS_UNKNOWN = 124;
const INVALID_CRITERIA = 125;

/**
 * Its confirmed transactions of one type, newest first, 100 a read, at
 * most `max`; past that one more row says whether there are more. Each
 * transaction once (a transaction arriving during the read moves the
 * pages on, so one can come twice).
 */
async function typedRows(
  address: string,
  txType: string,
  max: number
): Promise<{ rows: TxRow[]; more: boolean }> {
  const page = (limit: number, offset: number) =>
    getJson<unknown>(
      `/transactions/search?${queryString({
        address,
        txType,
        confirmationStatus: 'CONFIRMED',
        limit,
        offset,
        reverse: true,
      })}`
    ).then((body) => {
      // Anything but a list is a failure, never "none".
      if (!Array.isArray(body))
        throw new CoreHttpError(200, JSON.stringify(body));
      return toTxRows(body);
    });
  const rows: TxRow[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < max; offset += PAGE) {
    const chunk = await page(PAGE, offset);
    for (const row of chunk)
      if (!seen.has(row.signature)) {
        seen.add(row.signature);
        rows.push(row);
      }
    if (chunk.length < PAGE) return { rows, more: false };
  }
  // Every read was full: the row past them says whether there are more (one
  // already held means rows arrived meanwhile and moved it on: the next).
  for (let offset = max; offset < max + 3; offset++) {
    const [row] = await page(1, offset);
    if (!row) return { rows, more: false };
    if (!seen.has(row.signature)) return { rows, more: true };
  }
  return { rows, more: true };
}

/** A trade offer: a cross-chain trade contract (Core's ACCT). */
const isTradeOffer = (row: TxRow) =>
  row.aTType === 'ACCT' || /\bACCT\b/.test(String(row.tags ?? ''));

export interface Offers {
  /** The trade offers it made, newest first. */
  offers: OfferDeployed[];
  /** It made more DEPLOY_AT transactions than were read. */
  more: boolean;
  /** DEPLOY_AT transactions read (trade offers and other contracts). */
  read: number;
}

/** The trade offers among `rows` (its DEPLOY_AT transactions), newest first. */
export function offersOf(
  rows: readonly TxRow[],
  address: string
): OfferDeployed[] {
  return rows
    .filter(
      (row) =>
        row.type === 'DEPLOY_AT' &&
        row.creatorAddress === address &&
        typeof row.aTAddress === 'string' &&
        isTradeOffer(row)
    )
    .map((row) => ({
      at: row.aTAddress as string,
      chain: chainOfOffer(row.tags, row.name),
      qort: toAtomic(row.amount) ?? 0n,
      timestamp: row.timestamp,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export const offersRead = (address: string): ReadSpec<Offers> => ({
  key: `tradeoffers:${address}`,
  ttlMs: 10 * MINUTE,
  // Only what the tab uses is kept: a DEPLOY_AT carries its contract's code (kilobytes).
  load: async () => {
    const { rows, more } = await typedRows(address, 'DEPLOY_AT', OFFERS_MAX);
    return { offers: offersOf(rows, address), more, read: rows.length };
  },
});

/** A payment a contract made to the account. */
export interface Payout {
  at: string;
  /** QORT, atomic. */
  amount: bigint;
  timestamp: number;
  signature: string;
}

export interface Payouts {
  /** Newest first. */
  payouts: Payout[];
  /** It got more payouts than were read. */
  more: boolean;
  /** The oldest payout read; null with none. */
  oldest: number | null;
}

/** The QORT contracts paid it, among `rows` (its AT transactions, or its whole history), in their order. */
export function payoutsOf(rows: readonly TxRow[], address: string): Payout[] {
  return rows
    .filter(
      (row) =>
        row.type === 'AT' &&
        row.recipient === address &&
        typeof row.atAddress === 'string' &&
        (row.assetId === undefined ||
          row.assetId === null ||
          Number(row.assetId) === 0)
    )
    .map((row) => ({
      at: row.atAddress as string,
      amount: toAtomic(row.amount) ?? 0n,
      timestamp: row.timestamp,
      signature: row.signature,
    }));
}

export const payoutsRead = (address: string): ReadSpec<Payouts> => ({
  key: `tradepayouts:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const { rows, more } = await typedRows(address, 'AT', PAYOUTS_MAX);
    const payouts = payoutsOf(rows, address);
    const oldest = rows.length
      ? Math.min(...rows.map((row) => row.timestamp))
      : null;
    return { payouts, more, oldest };
  },
});

/**
 * A contract's own record (`/crosschain/trade/<at>`), or null when it
 * isn't a trade contract (Core: "invalid search criteria") or the node
 * doesn't know it. A finished trade never changes: kept for half an hour.
 */
export const contractRead = (at: string): ReadSpec<unknown | null> => ({
  key: `tradecontract:${at}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    try {
      return await getJson<unknown>(`/crosschain/trade/${seg(at)}`);
    } catch (error) {
      if (
        isCoreError(error, 400, INVALID_CRITERIA) ||
        isCoreError(error, 404, ADDRESS_UNKNOWN)
      )
        return null;
      throw error;
    }
  },
});

/** The contracts that paid it, each once, newest first: the ones a keyless account bought from. */
export function payingContracts(payouts: readonly Payout[]): Payout[] {
  const seen = new Set<string>();
  return payouts.filter((payout) =>
    seen.has(payout.at) ? false : (seen.add(payout.at), true)
  );
}
