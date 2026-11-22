/**
 * The reads for an account's Q-Assets (from Q-Mintership+'s
 * data/explorer/assets.ts), for the Assets tab, the Overview's Q-Assets and
 * an asset's own window. All public GETs; a failed read throws, and "the
 * node has none" is an answer of its own (a list that came back short).
 *
 * - Its holdings: `/assets/balances?address=<a>&excludeZero=true`, 100 a
 *   read, up to HOLDINGS_PAGES reads; one more row then says whether it
 *   holds more.
 * - Core's asset list without each asset's data: `/assets?includeData=false`,
 *   100 a read, up to ASSET_LIST_PAGES (every asset's owner, quantity and
 *   description: 96 assets on Qortal on 2026-11-22). Kept for the window's
 *   life, as are the asset avatars.
 * - Their last trades with QORT: `/assets/trades/recent`, both ways round
 *   (Core files a trade under the initiating order's have-asset), 40 assets
 *   a read, at most AT_ONCE reads at a time.
 * - The asset avatars the Q-Assets app published: one search of IMAGE
 *   identifiers starting `asset`, 100 a read, up to AVATAR_PAGES.
 * - What buyers would pay now: an asset's open buy orders,
 *   `/assets/openorders/0/<id>`, the best price first, the first BIDS_READ
 *   (one row more says whether there are more).
 * - When an asset is opened: its biggest holders (the first HOLDERS_READ,
 *   one more row says whether there are more), its latest trades with QORT
 *   both ways round (DEALS_READ each), and its cheapest sell offers by
 *   price (`/assets/orderbook/<id>/0`, the first ASKS_READ prices).
 *
 * What is about an account (its holdings, their prices, and what its page
 * read of an asset) is kept under keys ending in its address, so its
 * Refresh reads them again. Nothing here writes.
 */
import { CoreHttpError, getJson, queryString, seg } from './core';
import {
  assetMetaOf,
  avatarAssetId,
  buyOrderOf,
  dealOf,
  holdingOf,
  orderLevelOf,
  pricesFrom,
  QORT_ASSET_ID,
  recentTradeOf,
  type AssetDeal,
  type AssetMeta,
  type AssetPrice,
  type AvatarResource,
  type BuyOrder,
  type Holding,
  type OrderLevel,
  type RecentTrade,
} from './assets';
import type { ReadSpec } from './reads';
import { toAtomic } from './txWords';

const MINUTE = 60_000;
const PAGE = 100;
/** Its holdings read at most: ten reads of 100. */
export const HOLDINGS_PAGES = 10;
/** Core's asset list read at most: twenty reads of 100. */
export const ASSET_LIST_PAGES = 20;
const AVATAR_PAGES = 5;
/** Assets priced in one read of recent trades (each id is a part of the URL). */
const PRICE_CHUNK = 40;
const AT_ONCE = 4;
/** An asset's biggest holders read when it is opened. */
export const HOLDERS_READ = 100;
/** An asset's latest trades read each way round when it is opened. */
export const DEALS_READ = 10;
/** An asset's open buy orders read, the best first; past these a sale says "at least". */
export const BIDS_READ = 100;
/** Sell offers shown when an asset is opened, by price. */
export const ASKS_READ = 5;

/** Core's answer as a list; anything else is a failure, never "none". */
function listOf(body: unknown): unknown[] {
  if (!Array.isArray(body)) throw new CoreHttpError(200, JSON.stringify(body));
  return body;
}

const isSome = <T>(value: T | null): value is T => value !== null;

/**
 * Pages of PAGE rows until one comes back short, at most `pages`; when all
 * were full, one more row says whether the node has more (`more`).
 */
async function paged(
  path: (limit: number, offset: number) => string,
  pages: number
): Promise<{ rows: unknown[]; more: boolean }> {
  const rows: unknown[] = [];
  for (let page = 0; page < pages; page++) {
    const chunk = listOf(await getJson<unknown>(path(PAGE, page * PAGE)));
    rows.push(...chunk);
    if (chunk.length < PAGE) return { rows, more: false };
  }
  const extra = listOf(await getJson<unknown>(path(1, pages * PAGE)));
  return { rows, more: extra.length > 0 };
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

// ---- What it holds -----------------------------------------------------------------

export interface Holdings {
  /** In Core's order (by asset); QORT left out. */
  rows: Holding[];
  /** It holds more than were read (a row past HOLDINGS_PAGES reads was there). */
  more: boolean;
}

export const holdingsRead = (address: string): ReadSpec<Holdings> => ({
  key: `assetholdings:${address}`,
  ttlMs: 5 * MINUTE,
  load: async () => {
    const read = await paged(
      (limit, offset) =>
        `/assets/balances?${queryString({ address, excludeZero: true, limit, offset })}`,
      HOLDINGS_PAGES
    );
    return {
      rows: read.rows.map(holdingOf).filter(isSome),
      more: read.more,
    };
  },
});

export interface AssetList {
  /** Every asset read, by its number. */
  assets: Map<number, AssetMeta>;
  /** Core has more assets than were read. */
  more: boolean;
}

/** Every asset on Qortal, without its data: kept for the window's life. */
export const assetListRead = (): ReadSpec<AssetList> => ({
  key: 'assetlist',
  ttlMs: Number.POSITIVE_INFINITY,
  load: async () => {
    const read = await paged(
      (limit, offset) =>
        `/assets?${queryString({ includeData: false, limit, offset })}`,
      ASSET_LIST_PAGES
    );
    const assets = new Map<number, AssetMeta>();
    for (const row of read.rows) {
      const asset = assetMetaOf(row);
      if (asset) assets.set(asset.assetId, asset);
    }
    return { assets, more: read.more };
  },
});

/**
 * The last trade with QORT of each of these assets (an account's
 * holdings), by asset. Core gives the newest two trades of each pair asked
 * for, so a read of N assets is at most 2N rows: its limit.
 */
export const assetPricesRead = (
  address: string,
  assetIds: readonly number[]
): ReadSpec<Map<number, AssetPrice>> => {
  const ids = [...new Set(assetIds)]
    .filter((id) => id !== QORT_ASSET_ID)
    .sort((a, b) => a - b);
  return {
    // The assets asked for are in its key: another set of holdings is another read.
    key: `assetprices:${ids.join(',')}:${address}`,
    ttlMs: 5 * MINUTE,
    load: async () => {
      const paths: string[] = [];
      for (let i = 0; i < ids.length; i += PRICE_CHUNK) {
        const chunk = ids.slice(i, i + PRICE_CHUNK);
        const limit = chunk.length * 2;
        paths.push(
          // The asset sold for QORT, and QORT paid for it.
          `/assets/trades/recent?${queryString({ assetid: chunk, otherassetid: QORT_ASSET_ID, limit })}`,
          `/assets/trades/recent?${queryString({ assetid: QORT_ASSET_ID, otherassetid: chunk, limit })}`
        );
      }
      const answers = await inTurn(paths, async (path) =>
        listOf(await getJson<unknown>(path))
      );
      return pricesFrom(
        answers
          .flat()
          .map(recentTradeOf)
          .filter((trade): trade is RecentTrade => trade !== null)
      );
    },
  };
};

/** Every IMAGE that may be an asset's avatar (`asset<id>_<name>_aavatar`), by asset: kept for the window's life. */
export const assetAvatarsRead = (): ReadSpec<
  Map<number, AvatarResource[]>
> => ({
  key: 'assetavatars',
  ttlMs: Number.POSITIVE_INFINITY,
  load: async () => {
    const read = await paged(
      (limit, offset) =>
        `/arbitrary/resources/search?${queryString({
          service: 'IMAGE',
          identifier: 'asset',
          prefix: true,
          mode: 'ALL',
          excludeblocked: true,
          limit,
          offset,
        })}`,
      AVATAR_PAGES
    );
    const byAsset = new Map<number, AvatarResource[]>();
    for (const row of read.rows) {
      if (!row || typeof row !== 'object') continue;
      const { name, identifier } = row as {
        name?: unknown;
        identifier?: unknown;
      };
      if (typeof name !== 'string' || typeof identifier !== 'string') continue;
      const assetId = avatarAssetId(identifier);
      if (assetId === null) continue;
      byAsset.set(assetId, [
        ...(byAsset.get(assetId) ?? []),
        { publisher: name, identifier },
      ]);
    }
    return byAsset;
  },
});

// ---- One asset, from an account's page ---------------------------------------------------

export interface BuyOrders {
  /** The best price first. */
  orders: BuyOrder[];
  /** The node has more than were read. */
  more: boolean;
}

/** An asset's open buy orders (QORT offered for it), the best price first, the first BIDS_READ. */
export const assetBidsRead = (
  assetId: number,
  address: string
): ReadSpec<BuyOrders> => ({
  key: `assetbids:${assetId}:${address}`,
  ttlMs: 2 * MINUTE,
  load: async () => {
    const rows = listOf(
      await getJson<unknown>(
        `/assets/openorders/${seg(QORT_ASSET_ID)}/${seg(assetId)}?${queryString(
          {
            limit: BIDS_READ + 1,
            reverse: true,
          }
        )}`
      )
    );
    return {
      orders: rows.slice(0, BIDS_READ).map(buyOrderOf).filter(isSome),
      more: rows.length > BIDS_READ,
    };
  },
});

export interface Holder {
  address: string;
  balance: bigint;
}

export interface Holders {
  /** The biggest first. */
  rows: Holder[];
  /** It has more holders than were read. */
  more: boolean;
}

/** An asset's biggest holders, the first HOLDERS_READ. */
export const assetHoldersRead = (
  assetId: number,
  address: string
): ReadSpec<Holders> => ({
  key: `assetholders:${assetId}:${address}`,
  ttlMs: 5 * MINUTE,
  load: async () => {
    const rows = listOf(
      await getJson<unknown>(
        `/assets/balances?${queryString({
          assetid: assetId,
          ordering: 'ASSET_BALANCE_ACCOUNT',
          excludeZero: true,
          reverse: true,
          limit: HOLDERS_READ + 1,
        })}`
      )
    );
    const holders = rows
      .slice(0, HOLDERS_READ)
      .map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        const balance = toAtomic(r.balance);
        return typeof r.address === 'string' && balance && balance > 0n
          ? { address: r.address, balance }
          : null;
      })
      .filter(isSome);
    return { rows: holders, more: rows.length > HOLDERS_READ };
  },
});

/** An asset's latest trades with QORT, both ways round, the newest DEALS_READ. */
export const assetDealsRead = (
  assetId: number,
  address: string
): ReadSpec<AssetDeal[]> => ({
  key: `assetdeals:${assetId}:${address}`,
  ttlMs: 5 * MINUTE,
  load: async () => {
    const params = queryString({ limit: DEALS_READ, reverse: true });
    const [sold, bought] = await Promise.all([
      getJson<unknown>(
        `/assets/trades/${seg(assetId)}/${seg(QORT_ASSET_ID)}?${params}`
      ).then(listOf),
      getJson<unknown>(
        `/assets/trades/${seg(QORT_ASSET_ID)}/${seg(assetId)}?${params}`
      ).then(listOf),
    ]);
    return [...sold, ...bought]
      .map(dealOf)
      .filter(isSome)
      .sort((a, b) => b.at - a.at)
      .slice(0, DEALS_READ);
  },
});

/** An asset's cheapest sell offers (it offered for QORT), by price, the first ASKS_READ prices. */
export const assetAsksRead = (
  assetId: number,
  address: string
): ReadSpec<OrderLevel[]> => ({
  key: `assetasks:${assetId}:${address}`,
  ttlMs: 2 * MINUTE,
  load: async () =>
    listOf(
      await getJson<unknown>(
        `/assets/orderbook/${seg(assetId)}/${seg(QORT_ASSET_ID)}?${queryString({
          limit: ASKS_READ,
        })}`
      )
    )
      .map(orderLevelOf)
      .filter(isSome),
});
