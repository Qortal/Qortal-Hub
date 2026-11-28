/**
 * An account's Q-Assets, for the Assets tab and the Overview's Q-Assets
 * (from Q-Mintership+'s useAssets): its holdings, joined with Core's asset
 * list (owner, quantity, description) and their last trades with QORT as
 * those come in, and what buyers would pay for each now (its open buy
 * orders, four assets at a time; not on the Overview, which reads no
 * order books). The holdings come first; the rest fill in as they arrive,
 * and each can fail on its own (the holdings still show). Nothing is read
 * until `enabled`. A Refresh that fails keeps what was read before (the
 * buy orders too), with the failure beside it; a last trade that wasn't
 * read is never taken for "never traded" (`priceState`).
 */
import { useMemo } from 'react';
import {
  assetViews,
  ownedNotHeld,
  saleNow,
  type AssetMeta,
  type AssetView,
  type SaleNow,
} from '../../../lib/explorer/assets';
import {
  assetBidsRead,
  assetListRead,
  assetPricesRead,
  holdingsRead,
  type BuyOrders,
} from '../../../lib/explorer/assetReads';
import { useExplorerReads, type ReadsState } from '../ExplorerContext';
import { useKeptRead } from '../useKeptRead';
import type { SaleState } from './assetWords';

/** Assets whose buy orders are read at a time. */
const BOOKS_AT_ONCE = 4;

export function useAssets(
  address: string,
  { enabled = true, sales = true }: { enabled?: boolean; sales?: boolean } = {}
) {
  const holdings = useKeptRead(enabled ? holdingsRead(address) : null);
  const list = useKeptRead(enabled ? assetListRead() : null);
  const idsKey = (holdings.data?.rows ?? []).map((h) => h.assetId).join(',');
  const pricesSpec = useMemo(
    () =>
      enabled && idsKey
        ? assetPricesRead(address, idsKey.split(',').map(Number))
        : null,
    [enabled, address, idsKey]
  );
  const prices = useKeptRead(pricesSpec);
  const bidSpecs = useMemo(
    () =>
      enabled && sales && idsKey
        ? idsKey.split(',').map((id) => assetBidsRead(Number(id), address))
        : null,
    [enabled, sales, address, idsKey]
  );
  const bids: ReadsState<BuyOrders> = useExplorerReads(bidSpecs, {
    concurrency: BOOKS_AT_ONCE,
    keep: true,
  });

  const saleMap = useMemo(() => {
    const map = new Map<number, SaleNow>();
    for (const holding of holdings.data?.rows ?? []) {
      const book = bids.data.get(assetBidsRead(holding.assetId, address).key);
      if (book)
        map.set(
          holding.assetId,
          saleNow(holding.balance, book.orders, address, book.more)
        );
    }
    return map;
  }, [holdings.data, bids.data, address]);

  const views = useMemo<AssetView[] | undefined>(
    () =>
      holdings.data
        ? assetViews(
            holdings.data.rows,
            address,
            list.data?.assets,
            prices.data,
            saleMap
          )
        : undefined,
    [holdings.data, list.data, prices.data, saleMap, address]
  );
  const owned = useMemo<AssetMeta[] | undefined>(
    () =>
      holdings.data && list.data
        ? ownedNotHeld(list.data.assets, holdings.data.rows, address)
        : undefined,
    [holdings.data, list.data, address]
  );
  const failedBooks = useMemo(() => new Set(bids.failed), [bids.failed]);

  /** Where an asset's buy orders stand. */
  const saleState = (assetId: number): SaleState => {
    const key = assetBidsRead(assetId, address).key;
    if (bids.data.has(key)) return 'read';
    return failedBooks.has(key) ? 'failed' : 'reading';
  };

  /**
   * Where a held asset's last trade with QORT stands: read (a price, or
   * none: it never traded), still being read, or that read failed.
   */
  const priceState = (assetId: number): SaleState => {
    if (prices.data && idsKey.split(',').includes(String(assetId)))
      return 'read';
    return prices.status === 'error' ? 'failed' : 'reading';
  };

  return { holdings, list, prices, bids, views, owned, saleState, priceState };
}

export type AccountAssets = ReturnType<typeof useAssets>;
