import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import { CoreHttpError } from './core';
import {
  balanceAtRead,
  balanceMatches,
  balanceRead,
  blockTimeRead,
  closedOrderKey,
  firstShareRead,
  ORDER_TRADES_MAX,
  orderQortRead,
  portalChainsRead,
  portalTradesRead,
} from './qortReads';

const ADDRESS = `Q${'P'.repeat(33)}`;
const KEY = 'k'.repeat(44);

type Answer = { status?: number; body: unknown };
let answer: (path: string) => Answer;
let paths: string[] = [];

beforeEach(() => {
  paths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      paths.push(path);
      const { status = 200, body } = answer(path);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () =>
          typeof body === 'string' ? body : JSON.stringify(body),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

const query = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

describe('its balance', () => {
  it('reads it exactly, as Core writes it', async () => {
    answer = () => ({ body: '5416.68020260' });
    expect(await balanceRead(ADDRESS).load()).toEqual({
      qort: 5416.6802026,
      atomic: 541_668_020_260n,
    });
    answer = () => ({ body: '0E-8' });
    expect(await balanceRead(ADDRESS).load()).toEqual({ qort: 0, atomic: 0n });
    expect(paths[0]).toBe(`/addresses/balance/${ADDRESS}`);
  });

  it('fails on an answer that isn’t an amount, and on a failed read', async () => {
    answer = () => ({ body: 'busy' });
    await expect(balanceRead(ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    answer = () => ({ status: 500, body: { error: 5 } });
    await expect(balanceRead(ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('its balance as of its newest transaction', () => {
  const newestRow = (signature: string) => [
    { type: 'PAYMENT', timestamp: 1, signature, blockHeight: 5 },
  ];

  it('reads its newest transaction, then its balance, then its newest again', async () => {
    answer = (path) =>
      path.startsWith('/addresses/balance/')
        ? { body: '7.50000000' }
        : { body: newestRow('s1') };
    const spec = balanceAtRead(ADDRESS, 's1');
    // Kept by the list's newest row, under the address (Refresh reads it again).
    expect(spec.key).toBe(`balanceat:s1:${ADDRESS}`);
    expect(balanceAtRead(ADDRESS, null).key).toBe(`balanceat:none:${ADDRESS}`);
    const at = await spec.load();
    expect(at).toEqual({
      balance: { qort: 7.5, atomic: 750_000_000n },
      before: 's1',
      after: 's1',
    });
    expect(paths[1]).toBe(`/addresses/balance/${ADDRESS}`);
    for (const path of [paths[0], paths[2]]) {
      expect(path.startsWith('/transactions/search?')).toBe(true);
      expect(query(path).get('address')).toBe(ADDRESS);
      expect(query(path).get('confirmationStatus')).toBe('CONFIRMED');
      expect(query(path).get('limit')).toBe('1');
      expect(query(path).get('reverse')).toBe('true');
      expect(query(path).getAll('txType')).toEqual([]);
    }
    expect(balanceMatches(at, 's1')).toBe(true);
  });

  it('goes with the transactions held only when nothing came in before or while it was read', async () => {
    let newest = 's1';
    answer = (path) => {
      if (!path.startsWith('/addresses/balance/'))
        return { body: newestRow(newest) };
      // A payment lands while the balance is read.
      newest = 's2';
      return { body: '8.50000000' };
    };
    const moved = await balanceAtRead(ADDRESS, 's1').load();
    expect(moved).toMatchObject({ before: 's1', after: 's2' });
    expect(balanceMatches(moved, 's1')).toBe(false);
    expect(balanceMatches(moved, 's2')).toBe(false);
    // The list's newest row is older than the node's: no match either.
    expect(
      balanceMatches(
        { balance: { qort: 1, atomic: 1n }, before: 's2', after: 's2' },
        's1'
      )
    ).toBe(false);
    // An account with no transactions: none before and after.
    answer = (path) =>
      path.startsWith('/addresses/balance/') ? { body: '0E-8' } : { body: [] };
    expect(
      balanceMatches(await balanceAtRead(ADDRESS, null).load(), null)
    ).toBe(true);
  });

  it('fails on any failed read, never a balance', async () => {
    answer = (path) =>
      path.startsWith('/addresses/balance/')
        ? { body: '1.00000000' }
        : { status: 503, body: { error: 1 } };
    await expect(balanceAtRead(ADDRESS, 's1').load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('one of its asset orders', () => {
  const ORDER = {
    haveAssetId: 91,
    wantAssetId: 0,
    amount: '3.00000000',
    price: '2.50000000',
    fulfilled: '3.00000000',
    isClosed: true,
    isFulfilled: true,
    amountAssetId: 91,
  };
  const trade = (n: number) => ({
    initiatingOrderId: `other${n}`,
    targetOrderId: 'o/1',
    targetAmount: '0.01000000',
    initiatorAmount: '0.02500000',
  });

  it('reads the order and its trades, 100 at a time, its id as one path part', async () => {
    answer = (path) =>
      path.includes('/trades?')
        ? {
            body: Array.from(
              { length: Number(query(path).get('offset')) === 0 ? 100 : 20 },
              (_, i) => trade(i)
            ),
          }
        : { body: ORDER };
    const spec = orderQortRead('o/1', ADDRESS);
    expect(spec.key).toBe(`orderq:o/1:${ADDRESS}`);
    // 120 trades paid it 0.025 each; it is closed, so it never changes again.
    expect(await spec.load()).toEqual({ net: 300_000_000n, closed: true });
    // Kept apart for the window's life: not under the address Refresh forgets.
    expect(closedOrderKey('o/1')).toBe('orderclosed:o/1');
    expect(closedOrderKey('o/1').endsWith(`:${ADDRESS}`)).toBe(false);
    expect(paths[0]).toBe('/assets/order/o%2F1');
    expect(paths.slice(1).map((path) => query(path).get('offset'))).toEqual([
      '0',
      '100',
    ]);
    expect(query(paths[1]).get('limit')).toBe('100');
  });

  it('can’t be worked out when it had more trades than are read', async () => {
    let more = true;
    answer = (path) =>
      path.includes('/trades?')
        ? {
            body:
              Number(query(path).get('offset')) >= ORDER_TRADES_MAX && !more
                ? []
                : Array.from(
                    { length: Number(query(path).get('limit')) },
                    (_, i) => trade(i)
                  ),
          }
        : { body: ORDER };
    expect(await orderQortRead('o/1', ADDRESS).load()).toEqual({
      net: null,
      closed: true,
    });
    const tradeReads = paths.filter((path) => path.includes('/trades?'));
    expect(tradeReads).toHaveLength(ORDER_TRADES_MAX / 100 + 1);
    expect(query(tradeReads[tradeReads.length - 1]).get('limit')).toBe('1');
    // Exactly 1,000: one more row says there are none, so it adds up.
    more = false;
    paths = [];
    expect((await orderQortRead('o/1', ADDRESS).load()).net).toBe(
      2_500_000_000n
    );
  });

  it('says when an order is still open', async () => {
    answer = (path) =>
      path.includes('/trades?')
        ? { body: [] }
        : { body: { ...ORDER, isClosed: false, isFulfilled: false } };
    expect((await orderQortRead('o/1', ADDRESS).load()).closed).toBe(false);
  });

  it('fails on a failed read of the order', async () => {
    answer = () => ({ status: 404, body: { error: 603 } });
    await expect(orderQortRead('o1', ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    // Its trades answered with something that isn't a list: a failure too.
    answer = (path) =>
      path.includes('/trades?') ? { body: { trades: [] } } : { body: ORDER };
    await expect(orderQortRead('o1', ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('its trades on the Trade Portal', () => {
  const at = (n: number) => `A${String(n).repeat(33)}`;
  const SELLER = `Q${'S'.repeat(33)}`;
  const BUYER = `Q${'B'.repeat(33)}`;

  it('reads each side once, every chain at once, without a limit, and counts each trade once a side', async () => {
    answer = (path) =>
      query(path).get('buyerPublicKey')
        ? {
            body: [
              {
                atAddress: at(1),
                qortAmount: '10.00000000',
                foreignAmount: '0.03000000',
                sellerAddress: SELLER,
                tradeTimestamp: 2_000,
              },
              // The same trade twice: counted once.
              {
                atAddress: at(1),
                qortAmount: '10.00000000',
                tradeTimestamp: 2_000,
              },
              {
                atAddress: at(2),
                qortAmount: '0.50000000',
                btcAmount: '1.00000000',
                // Core couldn't find its block: no time, never 1970.
                tradeTimestamp: 0,
              },
            ],
          }
        : {
            body: [
              {
                atAddress: at(3),
                qortAmount: '7',
                buyerReceivingAddress: BUYER,
                tradeTimestamp: 3_000,
              },
            ],
          };
    const spec = portalTradesRead(ADDRESS, KEY);
    expect(spec.key).toBe(`portaltrades:${ADDRESS}`);
    const read = await spec.load();
    expect(read.bought).toBe(1_050_000_000n);
    expect(read.sold).toBe(700_000_000n);
    // Newest first (one with no time last), each with its side, the other account and its AT; no coin named.
    expect(read.trades).toEqual([
      {
        side: 'sold',
        qort: 700_000_000n,
        coin: 0n,
        at: at(3),
        other: BUYER,
        timestamp: 3_000,
      },
      {
        side: 'bought',
        qort: 1_000_000_000n,
        coin: 3_000_000n,
        at: at(1),
        other: SELLER,
        timestamp: 2_000,
      },
      {
        side: 'bought',
        qort: 50_000_000n,
        coin: 100_000_000n,
        at: at(2),
        other: '',
        timestamp: null,
      },
    ]);
    // Two reads: one a side, on every chain, none with a limit or an offset.
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.startsWith('/crosschain/trades?')).toBe(true);
      expect(query(path).has('foreignBlockchain')).toBe(false);
      expect(query(path).has('limit')).toBe(false);
      expect(query(path).has('offset')).toBe(false);
    }
    expect(
      paths
        .map((path) => (query(path).has('buyerPublicKey') ? 'buyer' : 'seller'))
        .sort()
    ).toEqual(['buyer', 'seller']);
  });

  it('keeps its sales for Compare, newest first, the buyer by where it received the QORT, each once', async () => {
    const SELLER = `Q${'S'.repeat(33)}`;
    const BUYER = `Q${'B'.repeat(33)}`;
    const sale = (at: string, timestamp: number, qort: string) => ({
      tradeTimestamp: timestamp,
      qortAmount: qort,
      btcAmount: '0.10000000',
      foreignAmount: '0.20000000',
      atAddress: at,
      sellerAddress: SELLER,
      buyerReceivingAddress: BUYER,
    });
    // As Core 6.1.9 answers without a limit: every coin's trades, merged.
    answer = (path) =>
      query(path).get('sellerPublicKey')
        ? {
            body: [
              sale(`A${'1'.repeat(33)}`, 100, '1.00000000'),
              sale(`A${'2'.repeat(33)}`, 300, '2.50000000'),
              sale(`A${'2'.repeat(33)}`, 300, '2.50000000'),
              {
                ...sale(`A${'3'.repeat(33)}`, 200, '4'),
                buyerReceivingAddress: '',
              },
            ],
          }
        : { body: [] };
    const read = await portalTradesRead(ADDRESS, KEY).load();
    expect(read.sold).toBe(750_000_000n);
    expect(read.sales).toEqual([
      {
        timestamp: 300,
        qortAmount: '2.50000000',
        foreignAmount: '0.20000000',
        atAddress: `A${'2'.repeat(33)}`,
        seller: SELLER,
        buyer: BUYER,
      },
      {
        timestamp: 100,
        qortAmount: '1.00000000',
        foreignAmount: '0.20000000',
        atAddress: `A${'1'.repeat(33)}`,
        seller: SELLER,
        buyer: BUYER,
      },
    ]);
  });

  it('fails on a failed read, never “no trades”', async () => {
    answer = (path) =>
      query(path).get('sellerPublicKey')
        ? { status: 500, body: { error: 5 } }
        : { body: [] };
    await expect(portalTradesRead(ADDRESS, KEY).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    // An answer that isn't a list is a failure too.
    answer = () => ({ body: { trades: [] } });
    await expect(portalTradesRead(ADDRESS, KEY).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('which coin each of its Trade Portal trades was for', () => {
  const at = (n: number) => `A${String(n).repeat(33)}`;
  const CHAINS = [
    'LITECOIN',
    'BITCOIN',
    'DIGIBYTE',
    'DOGECOIN',
    'RAVENCOIN',
    'PIRATECHAIN',
  ];

  it('reads each chain on each side once, without a limit; each contract by its chain', async () => {
    answer = (path) => {
      const q = query(path);
      const chain = q.get('foreignBlockchain');
      if (q.get('buyerPublicKey'))
        return { body: chain === 'DOGECOIN' ? [{ atAddress: at(2) }] : [] };
      return {
        body:
          chain === 'LITECOIN'
            ? [{ atAddress: at(1) }]
            : // A made-up node that lists one contract under two chains: the first's.
              chain === 'RAVENCOIN' || chain === 'BITCOIN'
              ? [{ atAddress: at(3) }]
              : [],
      };
    };
    const spec = portalChainsRead(ADDRESS, KEY);
    expect(spec.key).toBe(`portalchains:${ADDRESS}`);
    expect(await spec.load()).toEqual({
      [at(1)]: 'LITECOIN',
      [at(2)]: 'DOGECOIN',
      [at(3)]: 'BITCOIN',
    });
    expect(paths).toHaveLength(12);
    const reads = paths.map((path) => {
      const q = query(path);
      expect(q.has('limit')).toBe(false);
      return `${q.get('foreignBlockchain')}:${q.has('buyerPublicKey') ? 'buyer' : 'seller'}`;
    });
    expect(new Set(reads).size).toBe(12);
    for (const chain of CHAINS)
      expect(reads.filter((read) => read.startsWith(`${chain}:`))).toHaveLength(
        2
      );
  });

  it('a read that fails fails it whole, and no read starts after it', async () => {
    answer = (path) =>
      query(path).get('foreignBlockchain') === 'LITECOIN' &&
      query(path).get('sellerPublicKey')
        ? { status: 500, body: { error: 5 } }
        : { body: [] };
    await expect(portalChainsRead(ADDRESS, KEY).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    // The first read failed: only the two read beside it, none after.
    expect(paths.length).toBeLessThanOrEqual(3);
    // An answer that isn't a list is a failure too.
    answer = () => ({ body: { trades: [] } });
    await expect(portalChainsRead(ADDRESS, KEY).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('its first reward share, and a block’s time', () => {
  it('reads the oldest REWARD_SHARE involving it, one row', async () => {
    answer = () => ({
      body: [
        {
          type: 'REWARD_SHARE',
          signature: 's1',
          timestamp: 1_600_000_000_000,
          blockHeight: 655_586,
        },
      ],
    });
    expect(await firstShareRead(ADDRESS).load()).toEqual({
      height: 655_586,
      timestamp: 1_600_000_000_000,
      signature: 's1',
    });
    const q = query(paths[0]);
    expect(q.get('txType')).toBe('REWARD_SHARE');
    expect(q.get('address')).toBe(ADDRESS);
    expect(q.get('limit')).toBe('1');
    expect(q.get('reverse')).toBe('false');
    expect(q.get('confirmationStatus')).toBe('CONFIRMED');
    answer = () => ({ body: [] });
    expect(await firstShareRead(ADDRESS).load()).toBeNull();
  });

  it('reads a block’s time, and fails on anything else', async () => {
    answer = () => ({
      body: { height: 2_000_000, timestamp: 1_700_000_000_000 },
    });
    expect(await blockTimeRead(2_000_000).load()).toBe(1_700_000_000_000);
    expect(paths[0]).toBe('/blocks/byheight/2000000');
    answer = () => ({ body: {} });
    await expect(blockTimeRead(2_000_000).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});
