/**
 * The reads for an account's QORT figures and Activity, beyond its own
 * transaction list (lib/explorer/accountTx.ts): its exact balance (the
 * Balance fact's), its balance as of its newest transaction (QORT
 * minted's), each of its asset orders with QORT on one side, its completed
 * trades on the Trade Portal, its first reward share, and the time of a
 * block. All public GETs; a failed read throws, and "the node has none" is
 * an answer of its own.
 */
import { isAtAddress, isQortAddress } from './addresses';
import { CoreHttpError, getJson, getText, queryString, seg } from './core';
import {
  TRADE_CHAINS,
  tradeTime,
  type PortalSide,
  type PortalTradeRow,
  type TradeChain,
} from './portalTrades';
import { orderQort, type OrderState, type OrderTrade } from './qortBook';
import { toTxRows, type ReadSpec } from './reads';
import { fromAtomic, toAtomic } from './txWords';

const MINUTE = 60_000;

// ---- Its balance ---------------------------------------------------------------------

export interface Balance {
  /** In QORT, for display. */
  qort: number;
  /** Exactly, in atomic units (1 QORT = 100,000,000): for adding up. */
  atomic: bigint;
}

/**
 * Its QORT balance, exactly. Core writes it as a decimal ("0E-8" for none,
 * which toAtomic reads too). The Balance fact and QORT minted share this
 * read.
 */
export const balanceRead = (address: string): ReadSpec<Balance> => ({
  key: `balance:${address}`,
  ttlMs: MINUTE,
  load: () => readBalance(address),
});

async function readBalance(address: string): Promise<Balance> {
  const text = (await getText(`/addresses/balance/${seg(address)}`)).trim();
  const atomic = toAtomic(text);
  if (atomic === null) throw new CoreHttpError(200, text);
  return { qort: Number(fromAtomic(atomic)), atomic };
}

/** The signature of the account's newest confirmed transaction, or null when it has none. */
async function newestSignature(address: string): Promise<string | null> {
  const [newest] = toTxRows(
    await getJson<unknown>(
      `/transactions/search?${queryString({
        address,
        confirmationStatus: 'CONFIRMED',
        limit: 1,
        reverse: true,
      })}`
    )
  );
  return newest?.signature ?? null;
}

/** Its balance, and the newest transaction just before and just after it was read. */
export interface BalanceAt {
  balance: Balance;
  /** The node's newest confirmed transaction of the account right before the balance was read (null: none). */
  before: string | null;
  /** The same, right after. */
  after: string | null;
}

/**
 * Its balance as of its newest transaction, for QORT minted: the node's
 * newest confirmed transaction of the account (one row), its balance, then
 * the newest again. The balance goes with the transactions up to `newest`
 * only when both are `newest` (`balanceMatches`): a transaction that came
 * in before or while it was read would otherwise be counted in the balance
 * and not in them. Kept by the list's newest row, under the account's
 * address (Refresh reads it again).
 */
export const balanceAtRead = (
  address: string,
  newest: string | null
): ReadSpec<BalanceAt> => ({
  key: `balanceat:${newest ?? 'none'}:${address}`,
  ttlMs: MINUTE,
  load: async () => {
    const before = await newestSignature(address);
    const balance = await readBalance(address);
    const after = await newestSignature(address);
    return { balance, before, after };
  },
});

/** Whether a balance read (`balanceAtRead`) goes with the transactions up to `newest`. */
export const balanceMatches = (at: BalanceAt, newest: string | null) =>
  at.before === newest && at.after === newest;

// ---- Its asset orders -----------------------------------------------------------------

/** Trades of one order read at most: ten reads of 100. */
export const ORDER_TRADES_MAX = 1000;
const ORDER_TRADES_PAGE = 100;

/** What one of its asset orders moved in QORT; null when it had more trades than are read. */
export interface OrderQort {
  net: bigint | null;
  /** The order is closed (filled or cancelled): it never changes again. */
  closed: boolean;
}

/**
 * What the asset order `id` (the signature of the account's
 * CREATE_ASSET_ORDER) moved in QORT for the account that placed it: the
 * order and its trades, 100 at a time, up to ORDER_TRADES_MAX; one more row
 * then says whether it had more (and the figure can't be worked out). Kept
 * under the account's address, so its Refresh reads an open order again; a
 * closed one never changes, and is kept for the window's life
 * (`closedOrderKey`).
 */
export const orderQortRead = (
  id: string,
  address: string
): ReadSpec<OrderQort> => ({
  key: `orderq:${id}:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const order = await getJson<OrderState>(`/assets/order/${seg(id)}`);
    const closed = order?.isClosed === true;
    const trades: OrderTrade[] = [];
    const page = (offset: number, limit: number) =>
      getJson<unknown>(
        `/assets/order/${seg(id)}/trades?${queryString({ limit, offset })}`
      ).then((rows) => {
        // Anything but a list is a failure, never "no trades".
        if (!Array.isArray(rows))
          throw new CoreHttpError(200, JSON.stringify(rows));
        return rows as OrderTrade[];
      });
    for (
      let offset = 0;
      offset < ORDER_TRADES_MAX;
      offset += ORDER_TRADES_PAGE
    ) {
      const rows = await page(offset, ORDER_TRADES_PAGE);
      trades.push(...rows);
      if (rows.length < ORDER_TRADES_PAGE)
        return { net: orderQort(id, order, trades), closed };
    }
    // Every page was full: one more row says whether it had more.
    const more = await page(ORDER_TRADES_MAX, 1);
    return { net: more.length ? null : orderQort(id, order, trades), closed };
  },
});

/**
 * Where a closed order's answer is kept for the window's life: not under
 * an address, so Refresh leaves it (a closed order never changes).
 */
export const closedOrderKey = (id: string) => `orderclosed:${id}`;

// ---- Its trades on the Trade Portal -----------------------------------------------------

/** One of its completed sales on the Trade Portal (Core's trade summary): QORT for another coin. */
export interface PortalSale {
  /** When it completed. */
  timestamp: number;
  /** QORT sold, as Core writes it. */
  qortAmount: string;
  /** What the buyer paid, in the other coin (Core doesn't name the coin here). */
  foreignAmount: string;
  /** The trade's contract (the AT that held the QORT). */
  atAddress: string | null;
  seller: string;
  /** Where the buyer received the QORT: found this way, a buyer needs no public key. */
  buyer: string;
}

export interface PortalTrades {
  /** QORT it bought, in atomic units. */
  bought: bigint;
  /** QORT it sold, in atomic units. */
  sold: bigint;
  /**
   * Every completed trade, as the seller and as the buyer, each once a
   * side, newest first (those Core gave no time last): the Trades tab's.
   * Core doesn't name a trade's coin here: `portalChainsRead` does.
   */
  trades: PortalTradeRow[];
  /**
   * Its sales, newest first, each once: Compare's trades between two
   * accounts (a sale whose buyer received the QORT at the other's address).
   * A row without a seller and a buyer address is counted in `sold` only.
   */
  sales: PortalSale[];
}

/** Reads of one account's trades at a time, for the coins: a buyer's read searches every contract's payouts (seconds). */
const TRADE_READS_AT_ONCE = 3;

const SIDE_FILTER: Record<PortalSide, 'sellerPublicKey' | 'buyerPublicKey'> = {
  sold: 'sellerPublicKey',
  bought: 'buyerPublicKey',
};

/** Core's trade summaries as a list; anything else is a failure, never "no trades". */
async function summaries(
  query: Record<string, string>
): Promise<Array<Record<string, unknown>>> {
  const body = await getJson<unknown>(
    `/crosschain/trades?${queryString(query)}`
  );
  if (!Array.isArray(body)) throw new CoreHttpError(200, JSON.stringify(body));
  return body.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object'
  );
}

/** A row of Core's trade summaries as one of its sales, or null when it doesn't name both accounts. */
function saleOf(row: Record<string, unknown>): PortalSale | null {
  const seller = row.sellerAddress;
  const buyer = row.buyerReceivingAddress;
  if (!isQortAddress(seller) || !isQortAddress(buyer)) return null;
  return {
    timestamp: Number(row.tradeTimestamp ?? 0),
    qortAmount: String(row.qortAmount ?? '0'),
    foreignAmount: String(row.foreignAmount ?? row.btcAmount ?? '0'),
    atAddress: isAtAddress(row.atAddress) ? row.atAddress : null,
    seller,
    buyer,
  };
}

/** A row of Core's trade summaries as one of its trades, from its side. */
function tradeOf(
  side: PortalSide,
  row: Record<string, unknown>
): PortalTradeRow {
  const other = side === 'sold' ? row.buyerReceivingAddress : row.sellerAddress;
  return {
    side,
    qort: toAtomic(row.qortAmount) ?? 0n,
    coin: toAtomic(row.foreignAmount ?? row.btcAmount) ?? 0n,
    at: typeof row.atAddress === 'string' ? row.atAddress : '',
    other: typeof other === 'string' ? other : '',
    timestamp: tradeTime(row.tradeTimestamp),
  };
}

/** Newest first; a trade Core gave no time after every one with a time. */
const newestFirst = (a: PortalTradeRow, b: PortalTradeRow) =>
  (b.timestamp ?? Number.NEGATIVE_INFINITY) -
  (a.timestamp ?? Number.NEGATIVE_INFINITY);

/**
 * Its completed trades on the Trade Portal, on every chain, as the buyer
 * and as the seller (`/crosschain/trades?buyerPublicKey=…` and
 * `?sellerPublicKey=…`), each trade counted once a side (by its contract's
 * address), and its sales themselves, for Compare (the Overview, Compare
 * and the Trades tab share this read: two reads in all). An account without
 * a public key never made a transaction, so nothing can be asked by its key
 * (its purchases are found from the contracts that paid it, tradeReads.ts).
 *
 * Each side is one read without a limit, on purpose: Core applies `limit`
 * and `offset` to each kind of trade contract apart, then joins and cuts
 * them, so its pages repeat and skip trades. On a node on 2026-11-21, an
 * account with 204 trades on two chains came to 104 when read 100 at a
 * time; on 2026-11-22 one with 59 sales came to 57 read 20 at a time.
 * Scoped to one account, the whole list is small (about 300 bytes a trade).
 */
export const portalTradesRead = (
  address: string,
  publicKey: string
): ReadSpec<PortalTrades> => ({
  key: `portaltrades:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const side = async (which: PortalSide) => {
      const rows = await summaries({ [SIDE_FILTER[which]]: publicKey });
      // Core can list a contract twice: each once a side.
      const seen = new Set<string>();
      const kept: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        const at = String(row.atAddress ?? '');
        if (at && seen.has(at)) continue;
        seen.add(at);
        kept.push(row);
      }
      return kept;
    };
    const [boughtRows, soldRows] = await Promise.all([
      side('bought'),
      side('sold'),
    ]);
    const trades = [
      ...soldRows.map((row) => tradeOf('sold', row)),
      ...boughtRows.map((row) => tradeOf('bought', row)),
    ].sort(newestFirst);
    let bought = 0n;
    let sold = 0n;
    for (const trade of trades)
      if (trade.side === 'bought') bought += trade.qort;
      else sold += trade.qort;
    const sales = soldRows
      .map(saleOf)
      .filter((sale): sale is PortalSale => sale !== null)
      .sort((a, b) => b.timestamp - a.timestamp);
    return { bought, sold, trades, sales };
  },
});

/**
 * Which coin each of its Trade Portal trades was for, for the Trades tab
 * only: Core's summaries don't name the coin, so each chain it trades is
 * read on its own, on each side (`foreignBlockchain=<chain>&
 * sellerPublicKey=…`, `…&buyerPublicKey=…`), each without a limit (as
 * portalTradesRead), three at a time. The answer is each contract's chain,
 * by its address; a contract two chains list is the first's, in
 * TRADE_CHAINS order. A contract none of them lists is another coin
 * (portalTrades.ts `withCoins`). A read that fails fails it whole, and no
 * read starts after it.
 */
export const portalChainsRead = (
  address: string,
  publicKey: string
): ReadSpec<Record<string, TradeChain>> => ({
  key: `portalchains:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const reads = TRADE_CHAINS.flatMap((chain) =>
      (['sold', 'bought'] as const).map((side) => ({ chain, side }))
    );
    const found: string[][] = new Array(reads.length);
    let next = 0;
    let failed = false;
    const lane = async () => {
      while (!failed && next < reads.length) {
        const index = next++;
        const { chain, side } = reads[index];
        try {
          const rows = await summaries({
            foreignBlockchain: chain,
            [SIDE_FILTER[side]]: publicKey,
          });
          found[index] = rows.map((row) => String(row.atAddress ?? ''));
        } catch (error) {
          // One read failed: the answer can't be whole, so none starts after it.
          failed = true;
          throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: TRADE_READS_AT_ONCE }, lane));
    const chains: Record<string, TradeChain> = {};
    reads.forEach(({ chain }, index) => {
      for (const at of found[index])
        if (at && !Object.prototype.hasOwnProperty.call(chains, at))
          chains[at] = chain;
    });
    return chains;
  },
});

// ---- Its first reward share, and a block's time ------------------------------------------

export interface FirstShare {
  height: number;
  timestamp: number;
  signature: string;
}

/**
 * Its first reward share, as the minter or the recipient: the oldest
 * REWARD_SHARE involving it in its whole history (one row, oldest first),
 * or null when it never had one.
 */
export const firstShareRead = (
  address: string
): ReadSpec<FirstShare | null> => ({
  key: `firstshare:${address}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    const [first] = toTxRows(
      await getJson<unknown>(
        `/transactions/search?${queryString({
          txType: 'REWARD_SHARE',
          address,
          confirmationStatus: 'CONFIRMED',
          limit: 1,
          reverse: false,
        })}`
      )
    );
    return first && typeof first.blockHeight === 'number'
      ? {
          height: first.blockHeight,
          timestamp: first.timestamp,
          signature: first.signature,
        }
      : null;
  },
});

/** When the block at `height` was made (a block never changes: kept 30 minutes). */
export const blockTimeRead = (height: number): ReadSpec<number> => ({
  key: `blocktime:${height}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    const block = await getJson<{ timestamp?: unknown }>(
      `/blocks/byheight/${seg(height)}`
    );
    if (typeof block?.timestamp !== 'number')
      throw new CoreHttpError(200, JSON.stringify(block));
    return block.timestamp;
  },
});
