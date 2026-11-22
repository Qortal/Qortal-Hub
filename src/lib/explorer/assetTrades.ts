/**
 * Q-Asset trades between accounts (from Q-Mintership+'s
 * data/explorer/trades.ts and rules/explorer/trades.ts), for Connections
 * and the Trades tab.
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
 * - the newest FILLED_MAX filled orders at most, and it says so (a state
 *   with every read full gets one more row, so exactly 500 is all of them).
 *
 * What each side of a trade is comes from the account's own order (it gave
 * its have-asset and got its want-asset), never from Core's labels on the
 * trade, which are swapped for an initiating order that sells an asset
 * for QORT.
 *
 * The two order transactions behind a trade are read only when its row
 * opens. A failed read throws (Retry reads again); Core's "unknown asset
 * order" is an answer of its own. Nothing here writes.
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
  /** Its filled orders still open: partly filled so far. */
  openOrders: string[];
}

/** Trades read at most for one order. */
export const FILLS_MAX = FILLS_PAGES * FILLS_PAGE;

interface OrderRow {
  orderId?: unknown;
  creator?: unknown;
  fulfilled?: unknown;
  timestamp?: unknown;
  haveAssetId?: unknown;
  haveAssetName?: unknown;
  wantAssetId?: unknown;
  wantAssetName?: unknown;
  isClosed?: unknown;
  isFulfilled?: unknown;
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

/** Core's answer as a list; anything else is a failure, never "none". */
function listOf<T>(body: unknown): T[] {
  if (!Array.isArray(body)) throw new CoreHttpError(200, JSON.stringify(body));
  return body as T[];
}

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
    const chunk = await getJson<unknown>(
      `/assets/orders/${seg(address)}?${queryString({
        ...state,
        limit: ORDERS_PAGE,
        offset: page * ORDERS_PAGE,
        reverse: true,
      })}`
    );
    const rows = listOf<OrderRow>(chunk);
    orders.push(...rows);
    if (rows.length < ORDERS_PAGE) return { orders, more: false };
  }
  // Every read was full: one more row says whether it has more (exactly
  // ORDERS_PAGES × 100 orders in this state is all of them).
  const extra = await getJson<unknown>(
    `/assets/orders/${seg(address)}?${queryString({
      ...state,
      limit: 1,
      offset: ORDERS_PAGES * ORDERS_PAGE,
      reverse: true,
    })}`
  );
  return { orders, more: listOf(extra).length > 0 };
}

const side = (id: unknown, name: unknown, amount: unknown): TradeSide => ({
  asset: assetOf(id, name),
  amount: String(amount ?? '0'),
});

/** Who placed each other order, once per order (a trade never changes); none for an order the node doesn't know. */
function creatorReader(): (orderId: string) => Promise<string | null> {
  const creators = new Map<string, Promise<string | null>>();
  return (orderId) => {
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
}

/**
 * One order's trades from the account's side, the first FILLS_MAX
 * (`cut` when one more row says it had more), oldest first as Core lists
 * them.
 */
async function fillsOf(
  order: OrderRow,
  creatorOf: (orderId: string) => Promise<string | null>
): Promise<{ trades: AssetTrade[]; cut: boolean }> {
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
    const list = listOf<TradeRow>(chunk);
    rows.push(...list);
    if (list.length < FILLS_PAGE) {
      full = false;
      break;
    }
  }
  let cut = false;
  if (full) {
    // Every read was full: one more says whether it has more trades.
    const more = await getJson<unknown>(
      `/assets/order/${seg(orderId)}/trades?${queryString({
        limit: 1,
        offset: FILLS_MAX,
      })}`
    );
    cut = listOf(more).length > 0;
  }
  // One order's trades in turn: at most AT_ONCE reads at a time in all.
  const out: AssetTrade[] = [];
  const ownAssets =
    order.haveAssetId !== undefined && order.wantAssetId !== undefined;
  for (const trade of rows) {
    const initiated = trade.initiatingOrderId === orderId;
    const otherOrderId = text(
      initiated ? trade.targetOrderId : trade.initiatingOrderId
    );
    if (!otherOrderId) throw new CoreHttpError(200, 'trade without orders');
    // The initiator gave `initiatorAmount` of its have-asset and got
    // `targetAmount` of its want-asset; so the account's order, either
    // way, gave its own have-asset and got its own want-asset. Core's
    // own asset labels on a trade are swapped whenever the initiating
    // order's have-asset is the higher-numbered one (TradeData
    // `beforeMarshal` labels by the lower-numbered asset): selling an
    // asset for QORT. They are used only for an order that doesn't say.
    const gaveAmount = initiated ? trade.initiatorAmount : trade.targetAmount;
    const gotAmount = initiated ? trade.targetAmount : trade.initiatorAmount;
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
      gave: ownAssets
        ? side(order.haveAssetId, order.haveAssetName, gaveAmount)
        : initiated
          ? initiator
          : target,
      got: ownAssets
        ? side(order.wantAssetId, order.wantAssetName, gotAmount)
        : initiated
          ? target
          : initiator,
    });
  }
  return { trades: out, cut };
}

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
    const creatorOf = creatorReader();
    let fillsCut = 0;
    const fills = await inTurn(read, async (order) => {
      const { trades, cut } = await fillsOf(order, creatorOf);
      if (cut) fillsCut += 1;
      return trades;
    });
    const trades = fills.flat().sort((a, b) => b.timestamp - a.timestamp);
    // The last of ORDER_STATES lists its open orders: a filled one is partly filled so far.
    const open = new Set(
      reads[ORDER_STATES.length - 1].orders.map((order) => text(order.orderId))
    );
    return {
      trades,
      orders: read.length,
      truncated: reads.some((each) => each.more) || filled.length > read.length,
      fillsCut,
      openOrders: read
        .map((order) => order.orderId as string)
        .filter((id) => open.has(id)),
    };
  },
});

/** How one asset order was filled. */
export interface OrderFills {
  /** Its trades from the account's side, newest first. */
  trades: AssetTrade[];
  /** It had more than FILLS_MAX trades: these are the first read. */
  cut: boolean;
  /** It is still open (not filled, not cancelled): filled so far, if at all. */
  open: boolean;
}

/**
 * How one of its asset orders was filled (the Transactions tab's row of a
 * CREATE_ASSET_ORDER, once opened, when the account's Q-Asset trades
 * aren't read already): the order (`/assets/order/<id>`: its own two
 * assets, and whether it is still open), then its trades as
 * assetTradesRead reads them. Its key ends with the account's address, so
 * Refresh reads it again.
 */
export const orderFillsRead = (
  orderId: string,
  address: string
): ReadSpec<OrderFills> => ({
  key: `orderfills:${orderId}:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const order = await getJson<OrderRow>(`/assets/order/${seg(orderId)}`);
    if (text(order?.orderId) !== orderId)
      throw new CoreHttpError(200, JSON.stringify(order));
    const { trades, cut } = await fillsOf(order, creatorReader());
    return {
      trades: [...trades].sort((a, b) => b.timestamp - a.timestamp),
      cut,
      open: order.isClosed !== true && order.isFulfilled !== true,
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

/** One Q-Asset's trades by an account, added up (the Trades tab's breakdown). */
export interface AssetTradeTotals {
  /** Never QORT: QORT is the other side. */
  asset: AssetRef;
  /** Units it bought and sold, atomic. */
  bought: bigint;
  sold: bigint;
  /** QORT it paid for those it bought with QORT, and got for those it sold for QORT. */
  qortPaid: bigint;
  qortGot: bigint;
  /** Units bought with QORT, and sold for QORT: what the prices are worked out on. */
  boughtForQort: bigint;
  soldForQort: bigint;
  count: number;
  last: number;
}

export interface AssetTradesSummary {
  count: number;
  /** Most trades first, then the latest. */
  assets: AssetTradeTotals[];
  qortPaid: bigint;
  qortGot: bigint;
  /** Accounts it traded with. */
  partners: number;
}

const isQortSide = (side: TradeSide) => side.asset.id === 0;

/**
 * An account's Q-Asset trades by asset. A trade of two assets counts for
 * both (one bought, one sold), with no QORT.
 */
export function summariseAssetTrades(
  trades: readonly AssetTrade[]
): AssetTradesSummary {
  const by = new Map<string, AssetTradeTotals>();
  const partners = new Set<string>();
  let qortPaid = 0n;
  let qortGot = 0n;
  const totalsOf = (side: TradeSide, timestamp: number): AssetTradeTotals => {
    const key =
      side.asset.id === null ? `?${side.asset.name}` : `${side.asset.id}`;
    const totals = by.get(key) ?? {
      asset: side.asset,
      bought: 0n,
      sold: 0n,
      qortPaid: 0n,
      qortGot: 0n,
      boughtForQort: 0n,
      soldForQort: 0n,
      count: 0,
      last: timestamp,
    };
    totals.count += 1;
    totals.last = Math.max(totals.last, timestamp);
    by.set(key, totals);
    return totals;
  };
  for (const trade of trades) {
    if (trade.other) partners.add(trade.other);
    const gave = toAtomic(trade.gave.amount) ?? 0n;
    const got = toAtomic(trade.got.amount) ?? 0n;
    if (!isQortSide(trade.got)) {
      const totals = totalsOf(trade.got, trade.timestamp);
      totals.bought += got;
      if (isQortSide(trade.gave)) {
        totals.qortPaid += gave;
        totals.boughtForQort += got;
        qortPaid += gave;
      }
    }
    if (!isQortSide(trade.gave)) {
      const totals = totalsOf(trade.gave, trade.timestamp);
      totals.sold += gave;
      if (isQortSide(trade.got)) {
        totals.qortGot += got;
        totals.soldForQort += gave;
        qortGot += got;
      }
    }
  }
  return {
    count: trades.length,
    assets: [...by.values()].sort(
      (a, b) => b.count - a.count || b.last - a.last
    ),
    qortPaid,
    qortGot,
    partners: partners.size,
  };
}

/** QORT per unit of an asset; null when either is 0. A ratio for showing, so a float. */
export function qortPerUnit(qort: bigint, units: bigint): number | null {
  if (qort <= 0n || units <= 0n) return null;
  return Number(qort) / Number(units);
}
