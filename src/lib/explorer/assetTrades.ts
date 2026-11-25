/**
 * Q-Asset trades between accounts (from Q-Mintership+'s
 * data/explorer/trades.ts and rules/explorer/trades.ts), for Connections.
 * A trade isn't a transaction between two accounts: each places its own
 * order (CREATE_ASSET_ORDER; the order's id is that transaction's
 * signature) and Core matches them, recording the trade against both
 * orders. So who an account traded with is read from its orders:
 *
 * - its orders filled at least in part:
 *   `/assets/orders/<address>?includeClosed=…&includeFulfilled=…`, newest
 *   first, 100 a read, up to 5 reads each. Core's two flags are exact
 *   filters (closed = X and fulfilled = Y), so three reads: closed and
 *   fulfilled, closed but not fulfilled (cancelled after a part was
 *   filled), and still open (perhaps a part filled);
 * - each filled order's trades (`/assets/order/<id>/trades`, 100 a read,
 *   up to 10), and the other order of each (`/assets/order/<id>`), for who
 *   placed it, 4 at a time;
 * - the newest FILLED_MAX filled orders at most, and it says so.
 *
 * The two order transactions behind a trade are read only when its row
 * opens. A failed read throws (Retry reads again); Core's "unknown asset
 * order" is an answer of its own, and so is its "account address unknown"
 * for the orders of an account that never signed a transaction: Core finds
 * orders by the account's public key, and an account without one has
 * placed none. Nothing here writes.
 */
import { CoreHttpError, getJson, isCoreError, queryString, seg } from './core';
import type { ReadSpec } from './reads';
import {
  assetOf,
  fromAtomic,
  toAtomic,
  type Amount,
  type AssetRef,
} from './txWords';

const MINUTE = 60_000;
const ORDERS_PAGE = 100;
const ORDERS_PAGES = 5;
const FILLS_PAGE = 100;
const FILLS_PAGES = 10;
/** Filled orders read at most, newest first. */
export const FILLED_MAX = 100;
const AT_ONCE = 4;
/** Core's "unknown asset order ID". */
const ORDER_UNKNOWN = 603;
/** Core's "account address unknown". */
const ADDRESS_UNKNOWN = 124;

/** One side of a trade: what moved and how much, as Core writes it. */
export interface TradeSide {
  asset: AssetRef;
  amount: string;
}

export interface AssetTrade {
  /** The account's own order (its CREATE_ASSET_ORDER transaction's signature). */
  orderId: string;
  /** The other account's order. */
  otherOrderId: string;
  /** Who placed the other order; null when the node doesn't know that order. */
  other: string | null;
  timestamp: number;
  /** The account's order came in and matched the waiting one. */
  initiated: boolean;
  /** What the account gave, and what it got. */
  gave: TradeSide;
  got: TradeSide;
}

export interface AccountTrades {
  /** Every trade of its filled orders read, newest first. */
  trades: AssetTrade[];
  /** Filled orders read. */
  orders: number;
  /** It has more filled orders than were read. */
  truncated: boolean;
  /** Filled orders with more trades than were read (over FILLS_MAX each). */
  fillsCut: number;
}

/** Trades read at most for one order. */
export const FILLS_MAX = FILLS_PAGES * FILLS_PAGE;

interface OrderRow {
  orderId?: unknown;
  creator?: unknown;
  fulfilled?: unknown;
  timestamp?: unknown;
}

interface TradeRow {
  initiatingOrderId?: unknown;
  targetOrderId?: unknown;
  targetAmount?: unknown;
  initiatorAmount?: unknown;
  timestamp?: unknown;
  targetAmountAssetId?: unknown;
  targetAmountAssetName?: unknown;
  initiatorAmountAssetId?: unknown;
  initiatorAmountAssetName?: unknown;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** Runs `work` on each item, AT_ONCE at a time; the answers in order. */
async function inTurn<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, items.length) }, lane)
  );
  return out;
}

/** Core's exact filters: every order is in one of these (a fulfilled one is closed). */
const ORDER_STATES = [
  { includeClosed: true, includeFulfilled: true },
  { includeClosed: true, includeFulfilled: false },
  { includeClosed: false, includeFulfilled: false },
] as const;

async function ordersIn(
  address: string,
  state: (typeof ORDER_STATES)[number]
): Promise<{ orders: OrderRow[]; more: boolean }> {
  const orders: OrderRow[] = [];
  for (let page = 0; page < ORDERS_PAGES; page++) {
    let chunk: unknown;
    try {
      chunk = await getJson<unknown>(
        `/assets/orders/${seg(address)}?${queryString({
          ...state,
          limit: ORDERS_PAGE,
          offset: page * ORDERS_PAGE,
          reverse: true,
        })}`
      );
    } catch (error) {
      // An account that never signed a transaction: no orders, not a failure.
      if (isCoreError(error, 404, ADDRESS_UNKNOWN))
        return { orders, more: false };
      throw error;
    }
    const rows = Array.isArray(chunk) ? (chunk as OrderRow[]) : [];
    orders.push(...rows);
    if (rows.length < ORDERS_PAGE) return { orders, more: false };
  }
  return { orders, more: true };
}

const side = (id: unknown, name: unknown, amount: unknown): TradeSide => ({
  asset: assetOf(id, name),
  amount: String(amount ?? '0'),
});

/** Every trade of an account's filled orders (`assettrades:<address>`), newest first. */
export const assetTradesRead = (address: string): ReadSpec<AccountTrades> => ({
  key: `assettrades:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const reads = await Promise.all(
      ORDER_STATES.map((state) => ordersIn(address, state))
    );
    const filled = reads
      .flatMap((read) => read.orders)
      .filter(
        (order) =>
          text(order.orderId) !== null && (toAtomic(order.fulfilled) ?? 0n) > 0n
      )
      .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));
    const read = filled.slice(0, FILLED_MAX);
    // Who placed each other order, once per order (a trade never changes).
    const creators = new Map<string, Promise<string | null>>();
    const creatorOf = (orderId: string) => {
      let known = creators.get(orderId);
      if (!known) {
        known = getJson<OrderRow>(`/assets/order/${seg(orderId)}`).then(
          (order) => text(order?.creator),
          (error) => {
            if (isCoreError(error, 404, ORDER_UNKNOWN)) return null;
            throw error;
          }
        );
        creators.set(orderId, known);
      }
      return known;
    };
    let fillsCut = 0;
    const fills = await inTurn(read, async (order) => {
      const orderId = order.orderId as string;
      const rows: TradeRow[] = [];
      let full = true;
      for (let page = 0; page < FILLS_PAGES; page++) {
        const chunk = await getJson<unknown>(
          `/assets/order/${seg(orderId)}/trades?${queryString({
            limit: FILLS_PAGE,
            offset: page * FILLS_PAGE,
          })}`
        );
        const list = Array.isArray(chunk) ? (chunk as TradeRow[]) : [];
        rows.push(...list);
        if (list.length < FILLS_PAGE) {
          full = false;
          break;
        }
      }
      if (full) {
        // Every read was full: one more says whether it has more trades.
        const more = await getJson<unknown>(
          `/assets/order/${seg(orderId)}/trades?${queryString({
            limit: 1,
            offset: FILLS_MAX,
          })}`
        );
        if (Array.isArray(more) && more.length) fillsCut += 1;
      }
      // One order's trades in turn: at most AT_ONCE reads at a time in all.
      const out: AssetTrade[] = [];
      for (const trade of rows) {
        const initiated = trade.initiatingOrderId === orderId;
        const otherOrderId = text(
          initiated ? trade.targetOrderId : trade.initiatingOrderId
        );
        if (!otherOrderId) throw new CoreHttpError(200, 'trade without orders');
        const initiator = side(
          trade.initiatorAmountAssetId,
          trade.initiatorAmountAssetName,
          trade.initiatorAmount
        );
        const target = side(
          trade.targetAmountAssetId,
          trade.targetAmountAssetName,
          trade.targetAmount
        );
        out.push({
          orderId,
          otherOrderId,
          other: await creatorOf(otherOrderId),
          timestamp: Number(trade.timestamp ?? 0),
          initiated,
          // The initiator gave its amount and got the target's.
          gave: initiated ? initiator : target,
          got: initiated ? target : initiator,
        });
      }
      return out;
    });
    const trades = fills.flat().sort((a, b) => b.timestamp - a.timestamp);
    return {
      trades,
      orders: read.length,
      truncated: reads.some((each) => each.more) || filled.length > read.length,
      fillsCut,
    };
  },
});

// ---- In words ------------------------------------------------------------------------------

/**
 * The trades `tradesByAccount` leaves out: with itself (its own orders
 * matched), or with an order the node doesn't know (so no account to name).
 */
export const leftOutTrades = (
  trades: readonly AssetTrade[],
  self: string
): number =>
  trades.filter((trade) => !trade.other || trade.other === self).length;

/** Trades by the other account, each list newest first, the busiest account first. */
export function tradesByAccount(
  trades: readonly AssetTrade[],
  self: string
): Array<[string, AssetTrade[]]> {
  const by = new Map<string, AssetTrade[]>();
  for (const trade of trades) {
    if (!trade.other || trade.other === self) continue;
    by.set(trade.other, [...(by.get(trade.other) ?? []), trade]);
  }
  return [...by.entries()]
    .map(([other, list]): [string, AssetTrade[]] => [
      other,
      [...list].sort((a, b) => b.timestamp - a.timestamp),
    ])
    .sort(
      (a, b) =>
        b[1].length - a[1].length || b[1][0].timestamp - a[1][0].timestamp
    );
}

/** What moved one way over `trades`, each asset added up (exactly), in the order first seen. */
export function tradeSums(
  trades: readonly AssetTrade[],
  way: 'gave' | 'got'
): Amount[] {
  const sums: Array<{ asset: AssetRef; atomic: bigint }> = [];
  for (const trade of trades) {
    const { asset, amount } = trade[way];
    const atomic = toAtomic(amount) ?? 0n;
    const same = sums.find(
      (sum) =>
        sum.asset.id === asset.id &&
        (asset.id !== null || sum.asset.name === asset.name)
    );
    if (same) same.atomic += atomic;
    else sums.push({ asset, atomic });
  }
  return sums.map((sum) => ({
    amount: fromAtomic(sum.atomic),
    asset: sum.asset,
  }));
}
