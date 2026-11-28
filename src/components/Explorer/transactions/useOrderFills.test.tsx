import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIVITY_SETTINGS } from '../../../lib/explorer/activitySettings';
import {
  FILLS_MAX,
  type AccountTrades,
  type AssetTrade,
} from '../../../lib/explorer/assetTrades';
import {
  createExplorerCache,
  type ExplorerCache,
} from '../../../lib/explorer/cache';
import type { TxRow } from '../../../lib/explorer/reads';
import { ExplorerContext, type ExplorerContextValue } from '../ExplorerContext';
import { useOrderFills, type OrderFillsState } from './useOrderFills';

// When an asset order's row can say how it was filled from the account's
// Q-Asset trades read already, and when it must read the order's own.

const ME = `Q${'M'.repeat(33)}`;
const OTHER = `Q${'O'.repeat(33)}`;
const ORDER = 'o'.repeat(88);

function contextWith(cache: ExplorerCache): ExplorerContextValue {
  return {
    cache,
    version: 0,
    viewer: null,
    access: 'basic',
    openAccount: vi.fn(),
    openTransaction: vi.fn(),
    openName: vi.fn(),
    openChain: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
    activity: DEFAULT_ACTIVITY_SETTINGS,
    openActivitySettings: vi.fn(),
  };
}

const tx = (extra: Partial<TxRow> = {}): TxRow => ({
  type: 'CREATE_ASSET_ORDER',
  timestamp: 1_700_000_000_000,
  signature: ORDER,
  creatorAddress: ME,
  blockHeight: 100,
  haveAssetId: 28,
  haveAssetName: 'GBQ',
  wantAssetId: 0,
  wantAssetName: 'QORT',
  ...extra,
});

const fill = (n: number, orderId = ORDER): AssetTrade => ({
  orderId,
  otherOrderId: `other${n}`,
  other: OTHER,
  timestamp: 1_700_000_000_000 + n,
  initiated: true,
  gave: { asset: { id: 28, name: 'GBQ' }, amount: '1.00000000' },
  got: { asset: { id: 0, name: 'QORT' }, amount: '20.00000000' },
});

let latest: OrderFillsState | null = null;

function Reader({ row }: { row: TxRow }) {
  latest = useOrderFills(row, false);
  return null;
}

function stateWith(account: AccountTrades | null, row = tx()) {
  const cache = createExplorerCache();
  if (account) cache.put(`assettrades:${ME}`, account, { ttlMs: 60_000 });
  render(
    <ExplorerContext.Provider value={contextWith(cache)}>
      <Reader row={row} />
    </ExplorerContext.Provider>
  );
  return latest;
}

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe('useOrderFills', () => {
  it('only for a confirmed asset order', async () => {
    expect(stateWith(null, tx({ type: 'PAYMENT' }))).toBeNull();
    expect(stateWith(null, tx({ blockHeight: undefined }))).toBeNull();
    expect(stateWith(null)).toEqual({ status: 'waiting' });
    await settle();
  });

  it('says it from the account’s Q-Asset trades read already, not filled when they hold none of it', () => {
    const account = (trades: AssetTrade[], truncated = false) => ({
      trades,
      orders: 1,
      truncated,
      fillsCut: 0,
      openOrders: [ORDER],
    });
    expect(stateWith(account([fill(1), fill(2, 'another')]))).toMatchObject({
      status: 'ready',
      trades: [fill(1)],
      cut: false,
      // Still open: filled so far.
      open: true,
    });
    expect(stateWith(account([fill(2, 'another')]))).toMatchObject({
      status: 'ready',
      trades: [],
    });
    // Its filled orders weren't all read: this one may be among the rest.
    expect(stateWith(account([], true))).toEqual({ status: 'waiting' });
  });

  it('an order with as many trades as are read is read on its own: it may have more', () => {
    const many = Array.from({ length: FILLS_MAX }, (_, i) => fill(i));
    expect(
      stateWith({
        trades: many,
        orders: 1,
        truncated: false,
        fillsCut: 1,
        openOrders: [],
      })
    ).toEqual({ status: 'waiting' });
  });
});
