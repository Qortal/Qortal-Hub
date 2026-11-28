import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  assetAsksRead,
  assetAvatarsRead,
  assetBidsRead,
  assetDealsRead,
  assetHoldersRead,
  assetListRead,
  assetPricesRead,
  BIDS_READ,
  HOLDERS_READ,
  holdingsRead,
} from './assetReads';
import { CoreHttpError } from './core';

// The Q-Assets reads against a made-up node: what each asks, how far it
// reads, and that "more" is only ever said after a row past them was seen.

const ME = `Q${'M'.repeat(33)}`;
const OTHER = `Q${'O'.repeat(33)}`;
const U = 100_000_000n;

type Answer = { status?: number; body: unknown };
let route: (path: string) => Answer | undefined = () => undefined;
let paths: string[] = [];

beforeEach(() => {
  paths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      paths.push(path);
      const answer = route(path) ?? {
        status: 404,
        body: { error: 999, message: 'no route' },
      };
      const status = answer.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(answer.body),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const balance = (
  assetId: number,
  amount = '1.00000000',
  name = `Asset ${assetId}`
) => ({
  address: ME,
  assetId,
  balance: amount,
  assetName: name,
});

describe('its holdings', () => {
  it('reads 100 at a time with zero balances left out, and leaves QORT out', async () => {
    route = (path) =>
      path.startsWith('/assets/balances?')
        ? {
            body: [
              balance(0, '12.00000000', 'QORT'),
              balance(6, '2370.00000000', 'Widget'),
            ],
          }
        : undefined;
    const spec = holdingsRead(ME);
    expect(spec.key).toBe(`assetholdings:${ME}`);
    const read = await spec.load();
    expect(read).toEqual({
      rows: [{ assetId: 6, name: 'Widget', balance: 2370n * U }],
      more: false,
    });
    const query = params(paths[0]);
    expect(query.get('address')).toBe(ME);
    expect(query.get('excludeZero')).toBe('true');
    expect(query.get('limit')).toBe('100');
    expect(paths).toHaveLength(1);
  });

  it('exactly ten full reads and nothing past them is all of them; one row past them is more', async () => {
    let past: unknown[] = [];
    route = (path) => {
      if (!path.startsWith('/assets/balances?')) return undefined;
      const query = params(path);
      const offset = Number(query.get('offset'));
      if (query.get('limit') === '1') return { body: past };
      return {
        body: Array.from({ length: 100 }, (_, i) => balance(offset + i + 1)),
      };
    };
    const all = await holdingsRead(ME).load();
    expect(all.rows).toHaveLength(1000);
    expect(all.more).toBe(false);
    expect(paths).toHaveLength(11);
    expect(params(paths[10]).get('offset')).toBe('1000');
    past = [balance(1001)];
    expect((await holdingsRead(ME).load()).more).toBe(true);
  });

  it('an answer that isn’t a list is a failure, never “holds none”', async () => {
    route = () => ({ body: { holdings: [] } });
    await expect(holdingsRead(ME).load()).rejects.toBeInstanceOf(CoreHttpError);
  });
});

describe('the node’s asset list and the avatars', () => {
  it('reads every asset without its data, kept for the window’s life', async () => {
    route = (path) =>
      path.startsWith('/assets?')
        ? {
            body: [
              { assetId: 0, name: 'QORT', owner: OTHER, quantity: 0 },
              {
                assetId: 6,
                name: 'Widget',
                owner: OTHER,
                quantity: 100000000000,
                isDivisible: false,
              },
            ],
          }
        : undefined;
    const spec = assetListRead();
    expect(spec.key).toBe('assetlist');
    expect(spec.ttlMs).toBe(Number.POSITIVE_INFINITY);
    const read = await spec.load();
    expect(read.more).toBe(false);
    expect(read.assets.get(6)).toMatchObject({
      name: 'Widget',
      owner: OTHER,
      quantity: 1000n * U,
      isDivisible: false,
    });
    expect(params(paths[0]).get('includeData')).toBe('false');
  });

  it('one search for every avatar the Q-Assets app published, by asset', async () => {
    route = (path) =>
      path.startsWith('/arbitrary/resources/search?')
        ? {
            body: [
              { name: 'Publisher', identifier: 'asset6_Widget_aavatar' },
              { name: 'Second', identifier: 'asset6_Widget_aavatar' },
              { name: 'Publisher', identifier: 'assetAvatar_default' },
            ],
          }
        : undefined;
    const spec = assetAvatarsRead();
    expect(spec.key).toBe('assetavatars');
    const avatars = await spec.load();
    expect(avatars.get(6)?.map((r) => r.publisher)).toEqual([
      'Publisher',
      'Second',
    ]);
    expect(avatars.size).toBe(1);
    const query = params(paths[0]);
    expect([
      query.get('service'),
      query.get('identifier'),
      query.get('prefix'),
      query.get('limit'),
    ]).toEqual(['IMAGE', 'asset', 'true', '100']);
  });
});

describe('their last trades with QORT', () => {
  it('both ways round, 40 assets a read, at most two rows a pair asked for', async () => {
    route = (path) => {
      if (!path.startsWith('/assets/trades/recent?')) return undefined;
      const query = params(path);
      if (query.get('otherassetid') === '0')
        return {
          body: [
            {
              assetId: 6,
              otherAssetId: 0,
              amount: '6.00000000',
              otherAmount: '120.00000000',
              timestamp: 2,
            },
          ],
        };
      return {
        body: [
          {
            assetId: 0,
            otherAssetId: 7,
            amount: '1.00000000',
            otherAmount: '2.00000000',
            timestamp: 3,
          },
        ],
      };
    };
    const ids = Array.from({ length: 41 }, (_, i) => i + 1);
    const spec = assetPricesRead(ME, ids);
    // The assets asked for are in its key, and it ends with the address.
    expect(spec.key.startsWith('assetprices:1,2,3')).toBe(true);
    expect(spec.key.endsWith(`:${ME}`)).toBe(true);
    const prices = await spec.load();
    expect(paths).toHaveLength(4);
    const [first, second] = paths.map(params);
    expect(first.getAll('assetid')).toHaveLength(40);
    expect(first.get('limit')).toBe('80');
    expect(second.getAll('assetid')).toEqual(['0']);
    expect(prices.get(6)?.perUnit).toBe(20n * U);
    expect(prices.get(7)?.perUnit).toBe(U / 2n);
  });
});

describe('one asset, from an account’s page', () => {
  it('its buy orders: the best 100, and one more row says whether there are more', async () => {
    let rows = 100;
    route = (path) =>
      path.startsWith('/assets/openorders/0/6?')
        ? {
            body: Array.from({ length: rows }, (_, i) => ({
              creator: OTHER,
              price: `${1000 - i}.00000000`,
              amount: '1.00000000',
              fulfilled: '0.00000000',
            })),
          }
        : undefined;
    const spec = assetBidsRead(6, ME);
    expect(spec.key).toBe(`assetbids:6:${ME}`);
    const exactly = await spec.load();
    expect(exactly.orders).toHaveLength(BIDS_READ);
    expect(exactly.more).toBe(false);
    const query = params(paths[0]);
    expect(query.get('limit')).toBe(String(BIDS_READ + 1));
    expect(query.get('reverse')).toBe('true');
    rows = 101;
    const more = await spec.load();
    expect(more.orders).toHaveLength(BIDS_READ);
    expect(more.more).toBe(true);
  });

  it('its biggest holders, the first 100, biggest first, with zero balances left out', async () => {
    route = (path) =>
      path.startsWith('/assets/balances?')
        ? {
            body: [
              { address: OTHER, assetId: 6, balance: '30.00000000' },
              { address: ME, assetId: 6, balance: '6.00000000' },
            ],
          }
        : undefined;
    const holders = await assetHoldersRead(6, ME).load();
    expect(holders).toEqual({
      rows: [
        { address: OTHER, balance: 30n * U },
        { address: ME, balance: 6n * U },
      ],
      more: false,
    });
    const query = params(paths[0]);
    expect([
      query.get('assetid'),
      query.get('ordering'),
      query.get('excludeZero'),
      query.get('reverse'),
    ]).toEqual(['6', 'ASSET_BALANCE_ACCOUNT', 'true', 'true']);
    expect(query.get('limit')).toBe(String(HOLDERS_READ + 1));
  });

  it('exactly the 100 holders read, with none past them, is all of them; one more row is more', async () => {
    let rows = HOLDERS_READ;
    route = (path) =>
      path.startsWith('/assets/balances?')
        ? {
            body: Array.from({ length: rows }, (_, i) => ({
              address: `Q${i}`,
              assetId: 6,
              balance: '1.00000000',
            })),
          }
        : undefined;
    const exactly = await assetHoldersRead(6, ME).load();
    expect(exactly.rows).toHaveLength(HOLDERS_READ);
    expect(exactly.more).toBe(false);
    rows = HOLDERS_READ + 1;
    const more = await assetHoldersRead(6, ME).load();
    expect(more.rows).toHaveLength(HOLDERS_READ);
    expect(more.more).toBe(true);
  });

  it('its latest trades with QORT, both ways round, the newest ten', async () => {
    const deal = (at: number, initiatorBought: boolean) => ({
      trade: {
        initiatingOrderId: `o${at}`,
        targetOrderId: `t${at}`,
        initiatorAmount: initiatorBought ? '120.00000000' : '6.00000000',
        targetAmount: initiatorBought ? '6.00000000' : '120.00000000',
        timestamp: at,
      },
      initiatingOrder: {
        creator: ME,
        haveAssetId: initiatorBought ? 0 : 6,
        wantAssetId: initiatorBought ? 6 : 0,
      },
      targetOrder: {
        creator: OTHER,
        haveAssetId: initiatorBought ? 6 : 0,
        wantAssetId: initiatorBought ? 0 : 6,
      },
    });
    route = (path) => {
      if (path.startsWith('/assets/trades/6/0?'))
        return {
          body: Array.from({ length: 10 }, (_, i) => deal(100 - i, false)),
        };
      if (path.startsWith('/assets/trades/0/6?'))
        return {
          body: Array.from({ length: 10 }, (_, i) => deal(95 - i * 2, true)),
        };
      return undefined;
    };
    const deals = await assetDealsRead(6, ME).load();
    expect(deals).toHaveLength(10);
    expect(deals[0]).toMatchObject({
      at: 100,
      seller: ME,
      buyer: OTHER,
      units: 6n * U,
      qort: 120n * U,
    });
    expect(deals.map((each) => each.at)).toEqual(
      [...deals.map((each) => each.at)].sort((a, b) => b - a)
    );
    expect(paths.map((path) => params(path).get('limit'))).toEqual([
      '10',
      '10',
    ]);
  });

  it('its cheapest sell offers, the first five prices', async () => {
    route = (path) =>
      path.startsWith('/assets/orderbook/6/0?')
        ? { body: [{ price: '22.00000000', unfulfilled: '3.00000000' }] }
        : undefined;
    expect(await assetAsksRead(6, ME).load()).toEqual([
      { price: 22n * U, units: 3n * U },
    ]);
    expect(params(paths[0]).get('limit')).toBe('5');
  });

  it('a failed read throws, never an empty answer', async () => {
    route = () => ({
      status: 500,
      body: { error: 5, message: 'repository issue' },
    });
    await expect(assetBidsRead(6, ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    await expect(assetHoldersRead(6, ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    await expect(assetDealsRead(6, ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});
