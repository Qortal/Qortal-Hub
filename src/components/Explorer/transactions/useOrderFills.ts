/**
 * How an asset order (a confirmed CREATE_ASSET_ORDER row) was filled: its
 * trades, each with the other account (lib/explorer/assetTrades.ts), from
 * Q-Mintership+'s useOrderFills. From the account's own Q-Asset trades when
 * another part read them already (its Trades or Connections tab: nothing is
 * read for that), else from this order's own read, made once its row is
 * opened, and kept for the row after it closes. Null for any other
 * transaction, and for one still waiting for a block (Core has no order for
 * it yet).
 */
import { useMemo, useRef } from 'react';
import {
  assetTradesRead,
  FILLS_MAX,
  orderFillsRead,
  type AccountTrades,
  type AssetTrade,
} from '../../../lib/explorer/assetTrades';
import type { TxRow } from '../../../lib/explorer/reads';
import { useExplorerKept } from '../ExplorerContext';
import { useKeptRead } from '../useKeptRead';

export type OrderFillsState =
  /** Not read: its row hasn't been opened. */
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'failed'; retry: () => void }
  | {
      status: 'ready';
      /** Newest first. */
      trades: AssetTrade[];
      /** It had more trades than are read: these are the first FILLS_MAX. */
      cut: boolean;
      /** It is still open: filled so far (partly, with trades), if at all. */
      open: boolean;
      /** A read again failed: what is shown is the last answer, with Retry. */
      failedAgain: (() => void) | null;
    };

const ADDRESS = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/;

export function useOrderFills(
  tx: TxRow,
  open: boolean
): OrderFillsState | null {
  const creator =
    tx.type === 'CREATE_ASSET_ORDER' &&
    typeof tx.blockHeight === 'number' &&
    typeof tx.creatorAddress === 'string' &&
    ADDRESS.test(tx.creatorAddress)
      ? tx.creatorAddress
      : null;
  const account = useExplorerKept<AccountTrades>(
    creator ? assetTradesRead(creator).key : null
  );
  const fromAccount = useMemo(() => {
    if (!account) return undefined;
    const mine = account.trades.filter(
      (trade) => trade.orderId === tx.signature
    );
    // Only its newest filled orders are read, and only so many trades of
    // each: an order not among them, or one with as many trades as are
    // read, is read on its own.
    if (mine.length >= FILLS_MAX) return undefined;
    return mine.length || !account.truncated ? mine : undefined;
  }, [account, tx.signature]);
  // Once opened, its own read stays: closing the row doesn't forget it.
  const opened = useRef(false);
  if (open) opened.current = true;
  const own = useKeptRead(
    creator && opened.current && fromAccount === undefined
      ? orderFillsRead(tx.signature, creator)
      : null
  );
  if (!creator) return null;
  if (fromAccount !== undefined)
    return {
      status: 'ready',
      trades: fromAccount,
      cut: false,
      open: Boolean(account?.openOrders?.includes(tx.signature)),
      failedAgain: null,
    };
  if (own.data)
    return {
      status: 'ready',
      trades: own.data.trades,
      cut: own.data.cut,
      open: own.data.open,
      failedAgain: own.status === 'error' ? own.retry : null,
    };
  if (own.status === 'error') return { status: 'failed', retry: own.retry };
  if (own.status === 'loading') return { status: 'loading' };
  return { status: 'waiting' };
}
