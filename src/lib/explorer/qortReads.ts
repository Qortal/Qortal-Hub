/**
 * The reads for an account's QORT figures and Activity, beyond its own
 * transaction list (lib/explorer/accountTx.ts): its exact balance (the
 * Balance fact's), its balance as of its newest transaction (QORT
 * minted's), each of its asset orders with QORT on one side, its completed
 * trades on the Trade Portal, its first reward share, and the time of a
 * block. All public GETs; a failed read throws, and "the node has none" is
 * an answer of its own.
 */
import { CoreHttpError, getJson, getText, queryString, seg } from './core';
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
      ).then((rows) => (Array.isArray(rows) ? (rows as OrderTrade[]) : []));
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

export interface PortalTrades {
  /** QORT it bought, in atomic units. */
  bought: bigint;
  /** QORT it sold, in atomic units. */
  sold: bigint;
}

/**
 * The QORT of its completed trades on the Trade Portal, on every chain, as
 * the buyer and as the seller (`/crosschain/trades?buyerPublicKey=…` and
 * `?sellerPublicKey=…`), each trade counted once (by its contract's
 * address). An account without a public key never made a transaction, so
 * it traded nothing.
 *
 * Each side is one read without a limit, on purpose: Core applies `limit`
 * and `offset` to each kind of trade contract apart, then joins and cuts
 * them, so its pages skip trades. On a node on 2026-11-21, an account with
 * 204 trades on two chains came to 104 when read 100 at a time. Scoped to
 * one account, the whole list is small (about 300 bytes a trade).
 */
export const portalTradesRead = (
  address: string,
  publicKey: string
): ReadSpec<PortalTrades> => ({
  key: `portaltrades:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const side = async (filter: 'buyerPublicKey' | 'sellerPublicKey') => {
      const rows = await getJson<unknown>(
        `/crosschain/trades?${queryString({ [filter]: publicKey })}`
      );
      const seen = new Set<string>();
      let total = 0n;
      for (const trade of Array.isArray(rows) ? rows : []) {
        const at = String((trade as { atAddress?: unknown })?.atAddress ?? '');
        if (at && seen.has(at)) continue;
        seen.add(at);
        total +=
          toAtomic((trade as { qortAmount?: unknown })?.qortAmount) ?? 0n;
      }
      return total;
    };
    const [bought, sold] = await Promise.all([
      side('buyerPublicKey'),
      side('sellerPublicKey'),
    ]);
    return { bought, sold };
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
