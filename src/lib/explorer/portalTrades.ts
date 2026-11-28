/**
 * The Trade Portal in figures, for the Trades tab (from Q-Mintership+'s
 * rules/explorer/portalTrades.ts): an account's completed cross-chain
 * trades (qortReads.ts `portalTradesRead` reads them on every chain at once,
 * and `portalChainsRead` which coin each was for) added up by coin, by side
 * and over time, and the trade offers it made, each an AT holding the QORT
 * it offered, by how each ended. A trade that no chain the Explorer knows
 * claims is "another coin" (Core may trade one this list doesn't have yet),
 * never left out.
 *
 * Amounts are atomic units: QORT, and each coin as Core writes it, with 8
 * decimals. Pure: no reads, no text.
 */
import { toAtomic } from './txWords';

/** The chains Core trades QORT with, in the order their colours go (coinLook.ts). */
export const TRADE_CHAINS = [
  'LITECOIN',
  'BITCOIN',
  'DIGIBYTE',
  'DOGECOIN',
  'RAVENCOIN',
  'PIRATECHAIN',
] as const;
export type TradeChain = (typeof TRADE_CHAINS)[number];

export const isTradeChain = (value: unknown): value is TradeChain =>
  TRADE_CHAINS.includes(value as TradeChain);

/** Each coin's ticker, as the Trade Portal and Core write it. */
export const COIN_CODE: Record<TradeChain, string> = {
  LITECOIN: 'LTC',
  BITCOIN: 'BTC',
  DIGIBYTE: 'DGB',
  DOGECOIN: 'DOGE',
  RAVENCOIN: 'RVN',
  PIRATECHAIN: 'ARRR',
};

/** A trade's coin: one of TRADE_CHAINS, or another coin, which none of them claims. */
export type CoinKey = TradeChain | 'OTHER';

/** The coins in the order they are shown and coloured: another coin last. */
export const COIN_KEYS: readonly CoinKey[] = [...TRADE_CHAINS, 'OTHER'];

const CHAIN_OF_CODE = new Map<string, TradeChain>(
  TRADE_CHAINS.map((chain) => [COIN_CODE[chain], chain])
);

/** A trade offer's coin, from its DEPLOY_AT's tags ("ACCT QORT LTC") or name ("QORT/LTC ACCT"). */
export function chainOfOffer(tags: unknown, name?: unknown): TradeChain | null {
  const words = `${String(tags ?? '')} ${String(name ?? '')}`
    .toUpperCase()
    .split(/[\s/]+/);
  for (const word of words) {
    const chain = CHAIN_OF_CODE.get(word);
    if (chain) return chain;
  }
  return null;
}

/** It sold QORT (its own offer was taken) or bought it (it took someone else's). */
export type PortalSide = 'sold' | 'bought';

/** A completed trade as Core lists it on every chain at once: no coin named. */
export interface PortalTradeRow {
  side: PortalSide;
  qort: bigint;
  /** The coin paid for the QORT. */
  coin: bigint;
  /** The trade's AT. */
  at: string;
  /** Who bought (where the QORT went) or who sold; '' when Core didn't say. */
  other: string;
  /** When it completed; null when Core couldn't say (it writes 0). */
  timestamp: number | null;
}

export interface PortalTrade extends PortalTradeRow {
  /** Its coin; null while which coin isn't known (not read yet, or that read failed). */
  chain: CoinKey | null;
}

/**
 * The trades with their coins: `chains` is which chain claims each
 * contract (null while that isn't read); a contract none claims is another
 * coin.
 */
export function withCoins(
  rows: readonly PortalTradeRow[],
  chains: Readonly<Record<string, TradeChain>> | null
): PortalTrade[] {
  return rows.map((row) => ({
    ...row,
    chain: chains
      ? Object.prototype.hasOwnProperty.call(chains, row.at)
        ? chains[row.at]
        : 'OTHER'
      : null,
  }));
}

/** A trade's time as Core writes it: null for 0 or anything that isn't one. */
export function tradeTime(value: unknown): number | null {
  const time = Number(value ?? 0);
  return Number.isFinite(time) && time > 0 ? time : null;
}

export interface SideTotals {
  count: number;
  qort: bigint;
  coin: bigint;
}

export interface CoinTotals {
  chain: CoinKey;
  sold: SideTotals;
  bought: SideTotals;
  /** Its first and latest trade with a time; null when none has one. */
  first: number | null;
  last: number | null;
}

export interface Partner {
  address: string;
  /** Trades in which it sold to them, and bought from them. */
  sold: number;
  bought: number;
  qort: bigint;
}

export interface PortalSummary {
  /** The coins it traded, in COIN_KEYS order (only trades whose coin is known). */
  coins: CoinTotals[];
  /** Trades whose coin isn't known yet: in every total, in no coin's. */
  unlabeled: number;
  sold: SideTotals;
  bought: SideTotals;
  /** Its first and latest trade with a time; null with none. */
  first: number | null;
  last: number | null;
  /** Trades Core gave no time: in every total, in no span. */
  untimed: number;
  /** By QORT; the earlier of two the same size. */
  biggestSale: PortalTrade | null;
  biggestBuy: PortalTrade | null;
  /** Everyone it traded with, most trades first, then most QORT. */
  partners: Partner[];
}

const noSide = (): SideTotals => ({ count: 0, qort: 0n, coin: 0n });

function addTo(totals: SideTotals, trade: PortalTrade): void {
  totals.count += 1;
  totals.qort += trade.qort;
  totals.coin += trade.coin;
}

/** A trade's time for ordering: one with none sorts after every one with a time. */
const timeOrLast = (trade: PortalTradeRow) =>
  trade.timestamp ?? Number.POSITIVE_INFINITY;

const bigger = (a: PortalTrade | null, b: PortalTrade): PortalTrade =>
  !a || b.qort > a.qort || (b.qort === a.qort && timeOrLast(b) < timeOrLast(a))
    ? b
    : a;

const earlier = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);
const later = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

export function summarisePortal(trades: readonly PortalTrade[]): PortalSummary {
  const byChain = new Map<CoinKey, CoinTotals>();
  const partners = new Map<string, Partner>();
  const sold = noSide();
  const bought = noSide();
  let first: number | null = null;
  let last: number | null = null;
  let untimed = 0;
  let unlabeled = 0;
  let biggestSale: PortalTrade | null = null;
  let biggestBuy: PortalTrade | null = null;
  for (const trade of trades) {
    if (trade.chain === null) unlabeled += 1;
    else {
      let coin = byChain.get(trade.chain);
      if (!coin) {
        coin = {
          chain: trade.chain,
          sold: noSide(),
          bought: noSide(),
          first: null,
          last: null,
        };
        byChain.set(trade.chain, coin);
      }
      addTo(coin[trade.side], trade);
      coin.first = earlier(coin.first, trade.timestamp);
      coin.last = later(coin.last, trade.timestamp);
    }
    addTo(trade.side === 'sold' ? sold : bought, trade);
    if (trade.timestamp === null) untimed += 1;
    first = earlier(first, trade.timestamp);
    last = later(last, trade.timestamp);
    if (trade.side === 'sold') biggestSale = bigger(biggestSale, trade);
    else biggestBuy = bigger(biggestBuy, trade);
    if (trade.other) {
      const partner = partners.get(trade.other) ?? {
        address: trade.other,
        sold: 0,
        bought: 0,
        qort: 0n,
      };
      partner[trade.side] += 1;
      partner.qort += trade.qort;
      partners.set(trade.other, partner);
    }
  }
  return {
    coins: COIN_KEYS.flatMap((chain) => byChain.get(chain) ?? []),
    unlabeled,
    sold,
    bought,
    first,
    last,
    untimed,
    biggestSale,
    biggestBuy,
    partners: [...partners.values()].sort(
      (a, b) =>
        b.sold + b.bought - (a.sold + a.bought) ||
        (b.qort > a.qort ? 1 : b.qort < a.qort ? -1 : 0) ||
        a.address.localeCompare(b.address)
    ),
  };
}

/** Its sales' ATs: the offers of its that were taken. */
export function soldAts(trades: readonly PortalTradeRow[]): Set<string> {
  return new Set(
    trades.filter((trade) => trade.side === 'sold').map((trade) => trade.at)
  );
}

/** The coin paid for one QORT; null when either is 0. A ratio for showing, so a float. */
export function coinPerQort(coin: bigint, qort: bigint): number | null {
  if (coin <= 0n || qort <= 0n) return null;
  return Number(coin) / Number(qort);
}

/** An average: the whole QORT of `count` trades over them, cut to the atomic unit. */
export const averageOf = (totals: SideTotals): bigint =>
  totals.count ? totals.qort / BigInt(totals.count) : 0n;

// ---- Its trade offers ---------------------------------------------------------------

/** A trade offer it made: one AT, holding the QORT it offered. */
export interface OfferDeployed {
  at: string;
  /** Null when its tags name no coin Core trades now. */
  chain: TradeChain | null;
  /** What it put in the AT: the QORT offered and a little for the AT's fees. */
  qort: bigint;
  timestamp: number;
}

/**
 * - completed: Core lists it as a sale;
 * - ended: it paid back without one (cancelled, or refunded when a buyer
 *   didn't finish);
 * - open: still offered, or a trade under way;
 * - unknown: no sale, and older than the payouts read (the account had
 *   more payouts than the Explorer reads), so whether it paid back isn't
 *   known.
 */
export type OfferOutcome = 'completed' | 'ended' | 'open' | 'unknown';

export const OFFER_OUTCOMES: readonly OfferOutcome[] = [
  'completed',
  'ended',
  'open',
  'unknown',
];

export interface OfferMade extends OfferDeployed {
  outcome: OfferOutcome;
}

/**
 * How each offer ended: `sold` are its sales' ATs, `paidBack` the ATs that
 * paid it (a finished AT pays what it holds back to its creator, a sold
 * one too: what is left for its fees). `payoutsFrom`: the oldest payout
 * read, when there were more than were read (null: every payout was read);
 * an offer made by then could have paid back before it.
 */
export function offerOutcomes(
  deployed: readonly OfferDeployed[],
  sold: ReadonlySet<string>,
  paidBack: ReadonlySet<string>,
  payoutsFrom: number | null = null
): OfferMade[] {
  return deployed.map((offer) => ({
    ...offer,
    outcome: sold.has(offer.at)
      ? 'completed'
      : paidBack.has(offer.at)
        ? 'ended'
        : payoutsFrom !== null && offer.timestamp <= payoutsFrom
          ? 'unknown'
          : 'open',
  }));
}

export interface OfferTotals {
  made: number;
  completed: number;
  ended: number;
  open: number;
  unknown: number;
  /** The QORT the open ones hold. */
  openQort: bigint;
}

const noOffers = (): OfferTotals => ({
  made: 0,
  completed: 0,
  ended: 0,
  open: 0,
  unknown: 0,
  openQort: 0n,
});

export function summariseOffers(offers: readonly OfferMade[]): {
  total: OfferTotals;
  /** By coin, in TRADE_CHAINS order; offers with no coin Core trades now last (chain null). */
  byCoin: Array<OfferTotals & { chain: TradeChain | null }>;
} {
  const total = noOffers();
  const byChain = new Map<TradeChain | null, OfferTotals>();
  for (const offer of offers) {
    const coin = byChain.get(offer.chain) ?? noOffers();
    byChain.set(offer.chain, coin);
    for (const totals of [total, coin]) {
      totals.made += 1;
      totals[offer.outcome] += 1;
      if (offer.outcome === 'open') totals.openQort += offer.qort;
    }
  }
  const order: Array<TradeChain | null> = [...TRADE_CHAINS, null];
  return {
    total,
    byCoin: order.flatMap((chain) => {
      const coin = byChain.get(chain);
      return coin ? [{ chain, ...coin }] : [];
    }),
  };
}

// ---- A contract that paid an account without a public key ----------------------------------

/**
 * A completed trade from a trade contract's own record
 * (`/crosschain/trade/<at>`), as a purchase by `address`: the contract
 * paid it, it is redeemed, and it names `address` as where the QORT went.
 * Null for anything else (a contract still offering, refunded, or another
 * buyer's). `timestamp` is when the contract paid it.
 */
export function purchaseFromContract(
  record: unknown,
  at: string,
  address: string,
  timestamp: number
): PortalTrade | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (r.mode !== 'REDEEMED') return null;
  if (r.qortalPartnerReceivingAddress !== address) return null;
  const qort = toAtomic(r.qortAmount);
  const coin = toAtomic(r.expectedForeignAmount ?? r.expectedBitcoin);
  if (qort === null || coin === null) return null;
  return {
    // A chain this list doesn't have yet is another coin, never left out.
    chain: isTradeChain(r.foreignBlockchain) ? r.foreignBlockchain : 'OTHER',
    side: 'bought',
    qort,
    coin,
    at,
    other: typeof r.qortalCreator === 'string' ? r.qortalCreator : '',
    timestamp: tradeTime(timestamp),
  };
}

// ---- Over time ----------------------------------------------------------------------------

/** Months for up to two years of trading, quarters for up to eight, years past that. */
export type PeriodUnit = 'month' | 'quarter' | 'year';

export interface VolumePeriod {
  /** Its first moment (local time). */
  start: number;
  /**
   * QORT sold and bought in it, by coin: only trades whose coin is known
   * (the rest of `soldQort` and `boughtQort` is of trades whose coin isn't).
   */
  sold: Partial<Record<CoinKey, bigint>>;
  bought: Partial<Record<CoinKey, bigint>>;
  soldQort: bigint;
  boughtQort: bigint;
  soldCount: number;
  boughtCount: number;
}

const MONTHS_IN: Record<PeriodUnit, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

/** Months between `from` and `to`'s calendar months, counting both. */
function monthSpan(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  return (
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1
  );
}

export function periodUnit(first: number, last: number): PeriodUnit {
  const months = monthSpan(first, last);
  return months <= 24 ? 'month' : months <= 96 ? 'quarter' : 'year';
}

/** The start of the period `timestamp` falls in. */
export function periodStart(timestamp: number, unit: PeriodUnit): number {
  const date = new Date(timestamp);
  const month = date.getMonth() - (date.getMonth() % MONTHS_IN[unit]);
  return new Date(date.getFullYear(), month, 1).getTime();
}

const nextPeriod = (start: number, unit: PeriodUnit): number => {
  const date = new Date(start);
  return new Date(
    date.getFullYear(),
    date.getMonth() + MONTHS_IN[unit],
    1
  ).getTime();
};

/**
 * Every period from its first trade's to its latest's, empty ones too,
 * oldest first. A trade Core gave no time is in no period (`untimed`).
 */
export function volumeByPeriod(trades: readonly PortalTrade[]): {
  unit: PeriodUnit;
  periods: VolumePeriod[];
  untimed: number;
} {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  let untimed = 0;
  for (const trade of trades)
    if (trade.timestamp === null) untimed += 1;
    else {
      first = Math.min(first, trade.timestamp);
      last = Math.max(last, trade.timestamp);
    }
  if (!Number.isFinite(first)) return { unit: 'month', periods: [], untimed };
  const unit = periodUnit(first, last);
  const periods: VolumePeriod[] = [];
  const index = new Map<number, VolumePeriod>();
  for (
    let start = periodStart(first, unit);
    start <= last;
    start = nextPeriod(start, unit)
  ) {
    const period: VolumePeriod = {
      start,
      sold: {},
      bought: {},
      soldQort: 0n,
      boughtQort: 0n,
      soldCount: 0,
      boughtCount: 0,
    };
    periods.push(period);
    index.set(start, period);
  }
  for (const trade of trades) {
    if (trade.timestamp === null) continue;
    const period = index.get(periodStart(trade.timestamp, unit));
    if (!period) continue;
    if (trade.chain !== null) {
      const byCoin = period[trade.side];
      byCoin[trade.chain] = (byCoin[trade.chain] ?? 0n) + trade.qort;
    }
    if (trade.side === 'sold') {
      period.soldQort += trade.qort;
      period.soldCount += 1;
    } else {
      period.boughtQort += trade.qort;
      period.boughtCount += 1;
    }
  }
  return { unit, periods, untimed };
}

/** The quarter (1–4) a period starts in. */
export const quarterOf = (start: number): number =>
  Math.floor(new Date(start).getMonth() / 3) + 1;
