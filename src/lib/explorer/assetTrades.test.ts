import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import i18n from '../../i18n/i18n';
import { sentenceText } from '../../components/Explorer/transactions/sentenceText';
import {
  assetTradesRead,
  FILLED_MAX,
  FILLS_MAX,
  orderFillsRead,
  leftOutTrades,
  qortPerUnit,
  summariseAssetTrades,
  tradeSums,
  tradesByAccount,
  type AssetTrade,
} from './assetTrades';
import { CoreHttpError } from './core';
import { recordedFindings, tradesSentence } from './findings';

// Q-Asset trades, read from the account's filled orders and who filled
// them (Core records a trade against both orders, not as a transaction
// between the two accounts), and how Connections says them.

const ME = `Q${'M'.repeat(33)}`;
const A = `Q${'A'.repeat(33)}`;
const B = `Q${'B'.repeat(33)}`;
const id = (n: number) => `${String(n).padStart(8, '1')}${'o'.repeat(80)}`;

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

const order = (n: number, fulfilled: string, creator = ME) => ({
  orderId: id(n),
  creator,
  fulfilled,
  timestamp: 1_700_000_000_000 + n * 60_000,
});

/** My order `mine` bought 23 GBQ (asset 28) for 529 QORT from `theirs`, placed by A. */
function oneTrade(mine: number, theirs: number) {
  return {
    initiatingOrderId: id(mine),
    targetOrderId: id(theirs),
    initiatorAmount: '529.00000000',
    initiatorAmountAssetId: 0,
    initiatorAmountAssetName: 'QORT',
    targetAmount: '23.00000000',
    targetAmountAssetId: 28,
    targetAmountAssetName: 'GBQ',
    timestamp: 1_700_000_000_000 + mine * 60_000,
  };
}

describe('assetTradesRead', () => {
  it('reads its orders in all three states, then each filled one’s trades and who placed the other order', async () => {
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`)) {
        const query = params(path);
        expect(query.get('limit')).toBe('100');
        expect(query.get('reverse')).toBe('true');
        if (
          query.get('includeClosed') === 'true' &&
          query.get('includeFulfilled') === 'true'
        )
          return { body: [order(2, '23.00000000')] };
        if (query.get('includeClosed') === 'true')
          return { body: [order(1, '0.00000000')] };
        return { body: [] };
      }
      if (path.startsWith(`/assets/order/${id(2)}/trades?`))
        return { body: [oneTrade(2, 90)] };
      if (path === `/assets/order/${id(90)}`)
        return { body: { orderId: id(90), creator: A } };
      return undefined;
    };
    const read = await assetTradesRead(ME).load();
    expect(read.orders).toBe(1);
    expect(read.truncated).toBe(false);
    expect(read.trades).toEqual([
      {
        orderId: id(2),
        otherOrderId: id(90),
        other: A,
        timestamp: 1_700_000_000_000 + 2 * 60_000,
        initiated: true,
        gave: { asset: { id: 0, name: 'QORT' }, amount: '529.00000000' },
        got: { asset: { id: 28, name: 'GBQ' }, amount: '23.00000000' },
      },
    ]);
    // An order nothing filled is never asked about.
    expect(paths.some((path) => path.includes(id(1)))).toBe(false);
  });

  it('the newest filled orders only, and says so', async () => {
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`)) {
        const query = params(path);
        if (query.get('includeFulfilled') !== 'true') return { body: [] };
        const offset = Number(query.get('offset'));
        return {
          body: offset
            ? Array.from({ length: 20 }, (_, i) => order(i, '1'))
            : Array.from({ length: 100 }, (_, i) => order(1_000 + i, '1')),
        };
      }
      if (path.includes('/trades?')) return { body: [] };
      return undefined;
    };
    const read = await assetTradesRead(ME).load();
    expect(read.orders).toBe(FILLED_MAX);
    expect(read.truncated).toBe(true);
  });

  it('an order with more than 1,000 trades is marked as read only in part', async () => {
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`))
        return {
          body:
            params(path).get('includeFulfilled') === 'true'
              ? [order(2, '1'), order(3, '1')]
              : [],
        };
      if (path.startsWith(`/assets/order/${id(2)}/trades?`)) {
        // Always full: more than the 1,000 read.
        const limit = Number(params(path).get('limit'));
        return { body: Array.from({ length: limit }, () => oneTrade(2, 90)) };
      }
      if (path.startsWith(`/assets/order/${id(3)}/trades?`)) {
        // Exactly 1,000: read in full.
        const offset = Number(params(path).get('offset'));
        return {
          body:
            offset < 1_000
              ? Array.from({ length: 100 }, () => oneTrade(3, 90))
              : [],
        };
      }
      if (path === `/assets/order/${id(90)}`)
        return { body: { orderId: id(90), creator: A } };
      return undefined;
    };
    const read = await assetTradesRead(ME).load();
    expect(read.fillsCut).toBe(1);
    expect(read.trades).toHaveLength(2_000);
  });

  it('what each side was comes from its own order, not from Core’s labels, which are swapped for a seller’s initiating order', async () => {
    // As Core answers on 2026-11-22: a trade whose initiating order sells an
    // asset for QORT carries its labels the wrong way round (TradeData
    // labels by the initiating order's lower-numbered asset).
    const swapped = (initiating: number, target: number) => ({
      initiatingOrderId: id(initiating),
      targetOrderId: id(target),
      // The seller's order gave 23 GBQ and got 529 QORT…
      initiatorAmount: '23.00000000',
      targetAmount: '529.00000000',
      // …and Core says the other way round.
      initiatorAmountAssetId: 0,
      initiatorAmountAssetName: 'QORT',
      targetAmountAssetId: 28,
      targetAmountAssetName: 'GBQ',
      timestamp: 1_700_000_000_000,
    });
    const sell = {
      ...order(2, '23.00000000'),
      haveAssetId: 28,
      haveAssetName: 'GBQ',
      wantAssetId: 0,
      wantAssetName: 'QORT',
    };
    const buy = {
      ...order(3, '23.00000000'),
      haveAssetId: 0,
      haveAssetName: 'QORT',
      wantAssetId: 28,
      wantAssetName: 'GBQ',
    };
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`))
        return {
          body:
            params(path).get('includeClosed') === 'true' &&
            params(path).get('includeFulfilled') === 'true'
              ? [sell, buy]
              : [],
        };
      // Its sell order came in and matched a waiting buy order of A's.
      if (path.startsWith(`/assets/order/${id(2)}/trades?`))
        return { body: [swapped(2, 90)] };
      // Its buy order waited, and a sell order of A's came in.
      if (path.startsWith(`/assets/order/${id(3)}/trades?`))
        return { body: [swapped(91, 3)] };
      if (
        path === `/assets/order/${id(90)}` ||
        path === `/assets/order/${id(91)}`
      )
        return { body: { creator: A } };
      return undefined;
    };
    const read = await assetTradesRead(ME).load();
    const of = (n: number) =>
      read.trades.find((each) => each.orderId === id(n));
    expect(of(2)).toMatchObject({
      initiated: true,
      gave: { asset: { id: 28, name: 'GBQ' }, amount: '23.00000000' },
      got: { asset: { id: 0, name: 'QORT' }, amount: '529.00000000' },
    });
    expect(of(3)).toMatchObject({
      initiated: false,
      gave: { asset: { id: 0, name: 'QORT' }, amount: '529.00000000' },
      got: { asset: { id: 28, name: 'GBQ' }, amount: '23.00000000' },
    });
    expect(say(tradesSentence(A, [of(2) as AssetTrade]))).toBe(
      'Sold 23 GBQ to Publisher for 529 QORT'
    );
    expect(say(tradesSentence(A, [of(3) as AssetTrade]))).toBe(
      'Bought 23 GBQ from Publisher for 529 QORT'
    );
  });

  it('exactly five full reads of orders in a state, with nothing past them, is all of them', async () => {
    let past: unknown[] = [];
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`)) {
        const query = params(path);
        if (query.get('includeFulfilled') !== 'true') return { body: [] };
        if (query.get('limit') === '1') return { body: past };
        const offset = Number(query.get('offset'));
        // 500 orders, none filled: nothing to read past them.
        return {
          body: Array.from({ length: 100 }, (_, i) =>
            order(5_000 + offset + i, '0')
          ),
        };
      }
      return undefined;
    };
    const all = await assetTradesRead(ME).load();
    expect(all.truncated).toBe(false);
    expect(
      paths.some(
        (path) =>
          params(path).get('limit') === '1' &&
          params(path).get('offset') === '500'
      )
    ).toBe(true);
    past = [order(9_999, '0')];
    expect((await assetTradesRead(ME).load()).truncated).toBe(true);
  });

  it('a trade with an order the node doesn’t know has no other account; any other failure throws', async () => {
    const base = (path: string): Answer | undefined => {
      if (path.startsWith(`/assets/orders/${ME}?`))
        return {
          body:
            params(path).get('includeFulfilled') === 'true'
              ? [order(2, '1')]
              : [],
        };
      if (path.startsWith(`/assets/order/${id(2)}/trades?`))
        return { body: [oneTrade(2, 90)] };
      return undefined;
    };
    route = (path) =>
      base(path) ??
      (path === `/assets/order/${id(90)}`
        ? {
            status: 404,
            body: { error: 603, message: 'unknown asset order ID' },
          }
        : undefined);
    expect((await assetTradesRead(ME).load()).trades[0].other).toBeNull();
    route = (path) =>
      base(path) ??
      (path === `/assets/order/${id(90)}`
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined);
    await expect(assetTradesRead(ME).load()).rejects.toBeTruthy();
  });

  it('an answer that isn’t a list is a failure, never “no trades”', async () => {
    // Its orders.
    route = (path) =>
      path.startsWith(`/assets/orders/${ME}?`)
        ? { body: { orders: [] } }
        : undefined;
    await expect(assetTradesRead(ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    // A filled order's trades.
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`))
        return {
          body:
            params(path).get('includeFulfilled') === 'true'
              ? [order(2, '1')]
              : [],
        };
      if (path.startsWith(`/assets/order/${id(2)}/trades?`))
        return { body: { trades: [] } };
      return undefined;
    };
    await expect(assetTradesRead(ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });

  it('an account that never signed a transaction has placed no order; any other failure throws', async () => {
    // Core finds orders by the account's public key, and says it doesn't
    // know an account without one.
    const orders = (answer: Answer) => (path: string) =>
      path.startsWith(`/assets/orders/${ME}?`) ? answer : undefined;
    route = orders({
      status: 404,
      body: { error: 124, message: 'account address unknown' },
    });
    const read = await assetTradesRead(ME).load();
    expect(read.trades).toEqual([]);
    expect(read.orders).toBe(0);
    expect(read.truncated).toBe(false);
    // One read of each state, and nothing after.
    expect(paths).toHaveLength(3);
    route = orders({
      status: 500,
      body: { error: 5, message: 'repository issue' },
    });
    await expect(assetTradesRead(ME).load()).rejects.toBeTruthy();
    route = orders({ status: 404, body: { error: 999, message: 'other' } });
    await expect(assetTradesRead(ME).load()).rejects.toBeTruthy();
  });
});

const trade = (
  other: string | null,
  n: number,
  gave: [number, string, string],
  got: [number, string, string]
): AssetTrade => ({
  orderId: id(n),
  otherOrderId: id(100 + n),
  other,
  timestamp: Date.UTC(2026, 6, 15, 12) + n * 86_400_000,
  initiated: true,
  gave: { asset: { id: gave[0], name: gave[1] }, amount: gave[2] },
  got: { asset: { id: got[0], name: got[1] }, amount: got[2] },
});

const say = (sentence: Parameters<typeof sentenceText>[0]) =>
  sentenceText(sentence, i18n.getFixedT('en'), 'en', {
    nameOf: (address) =>
      address === A ? 'Publisher' : address === B ? 'Second' : null,
  });

describe('orderFillsRead', () => {
  // A sell order of its own, as Core answers /assets/order/<id>.
  const sell = {
    orderId: id(2),
    creator: ME,
    haveAssetId: 28,
    haveAssetName: 'GBQ',
    wantAssetId: 0,
    wantAssetName: 'QORT',
    fulfilled: '23.00000000',
    isClosed: false,
    isFulfilled: false,
  };
  // Core's labels, the wrong way round for a seller's initiating order.
  const swapped = {
    initiatingOrderId: id(2),
    targetOrderId: id(90),
    initiatorAmount: '23.00000000',
    targetAmount: '529.00000000',
    initiatorAmountAssetId: 0,
    initiatorAmountAssetName: 'QORT',
    targetAmountAssetId: 28,
    targetAmountAssetName: 'GBQ',
    timestamp: 1_700_000_000_000,
  };

  it('reads the order, then its trades, each side from its own two assets, kept under the address', async () => {
    let order: Record<string, unknown> = sell;
    route = (path) => {
      if (path === `/assets/order/${id(2)}`) return { body: order };
      if (path.startsWith(`/assets/order/${id(2)}/trades?`))
        return { body: [swapped] };
      if (path === `/assets/order/${id(90)}`) return { body: { creator: A } };
      return undefined;
    };
    const spec = orderFillsRead(id(2), ME);
    expect(spec.key).toBe(`orderfills:${id(2)}:${ME}`);
    const fills = await spec.load();
    expect(fills).toMatchObject({ cut: false, open: true });
    expect(fills.trades).toHaveLength(1);
    expect(fills.trades[0]).toMatchObject({
      other: A,
      initiated: true,
      gave: { asset: { id: 28, name: 'GBQ' }, amount: '23.00000000' },
      got: { asset: { id: 0, name: 'QORT' }, amount: '529.00000000' },
    });
    expect(paths[0]).toBe(`/assets/order/${id(2)}`);
    // Filled, or cancelled: no longer open.
    order = { ...sell, isClosed: true, isFulfilled: true };
    expect((await orderFillsRead(id(2), ME).load()).open).toBe(false);
  });

  it('exactly the most it reads is all of them; a row past them cuts it', async () => {
    let past: unknown[] = [];
    route = (path) => {
      if (path === `/assets/order/${id(2)}`) return { body: sell };
      if (path.startsWith(`/assets/order/${id(2)}/trades?`)) {
        const query = params(path);
        if (query.get('limit') === '1') return { body: past };
        return {
          body: Array.from({ length: 100 }, (_, i) => ({
            ...swapped,
            targetOrderId: id(100 + Number(query.get('offset')) + i),
          })),
        };
      }
      if (path.startsWith('/assets/order/')) return { body: { creator: A } };
      return undefined;
    };
    const all = await orderFillsRead(id(2), ME).load();
    expect(all.trades).toHaveLength(FILLS_MAX);
    expect(all.cut).toBe(false);
    past = [swapped];
    expect((await orderFillsRead(id(2), ME).load()).cut).toBe(true);
  });

  it('a failed read throws, never “not filled”; an answer that isn’t its order is a failure', async () => {
    route = () => ({
      status: 500,
      body: { error: 5, message: 'repository issue' },
    });
    await expect(orderFillsRead(id(2), ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    route = () => ({ body: [] });
    await expect(orderFillsRead(id(2), ME).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('its filled orders still open', () => {
  it('are known from the state they were read in', async () => {
    route = (path) => {
      if (path.startsWith(`/assets/orders/${ME}?`)) {
        const q = params(path);
        const closed = q.get('includeClosed') === 'true';
        const fulfilled = q.get('includeFulfilled') === 'true';
        return {
          body:
            closed && fulfilled
              ? [order(2, '1')]
              : !closed
                ? [order(3, '1')]
                : [],
        };
      }
      if (path.startsWith('/assets/order/') && path.includes('/trades?'))
        return { body: [] };
      return undefined;
    };
    const read = await assetTradesRead(ME).load();
    expect(read.openOrders).toEqual([id(3)]);
  });
});

describe('Q-Asset trades in words', () => {
  it('one trade whole, from the account’s side', () => {
    expect(
      say(
        tradesSentence(A, [trade(A, 1, [0, 'QORT', '529'], [28, 'GBQ', '23'])])
      )
    ).toBe('Bought 23 GBQ from Publisher for 529 QORT');
    expect(
      say(
        tradesSentence(A, [trade(A, 1, [28, 'GBQ', '23'], [0, 'QORT', '529'])])
      )
    ).toBe('Sold 23 GBQ to Publisher for 529 QORT');
    expect(
      say(
        tradesSentence(A, [trade(A, 1, [5, 'Example', '5'], [28, 'GBQ', '23'])])
      )
    ).toBe('Traded 5 Example for 23 GBQ with Publisher');
  });

  it('several added up by what moved each way, exactly', () => {
    const trades = [
      trade(A, 1, [0, 'QORT', '0.1'], [28, 'GBQ', '1']),
      trade(A, 2, [0, 'QORT', '0.2'], [28, 'GBQ', '2']),
    ];
    expect(tradeSums(trades, 'gave')).toEqual([
      { amount: '0.30000000', asset: { id: 0, name: 'QORT' } },
    ]);
    expect(say(tradesSentence(A, trades))).toBe(
      '2 Q-Asset trades with Publisher: got 3 GBQ, gave 0.3 QORT'
    );
  });

  it('by the other account, the busiest first; one it can’t name, or itself, is left out', () => {
    const trades = [
      trade(A, 1, [0, 'QORT', '1'], [28, 'GBQ', '1']),
      trade(B, 2, [0, 'QORT', '1'], [28, 'GBQ', '1']),
      trade(B, 3, [0, 'QORT', '1'], [28, 'GBQ', '1']),
      trade(null, 4, [0, 'QORT', '1'], [28, 'GBQ', '1']),
      trade(ME, 5, [0, 'QORT', '1'], [28, 'GBQ', '1']),
    ];
    expect(
      tradesByAccount(trades, ME).map(([other, list]) => [other, list.length])
    ).toEqual([
      [B, 2],
      [A, 1],
    ]);
    // Said, never taken for none: the two it left out.
    expect(leftOutTrades(trades, ME)).toBe(2);
    const found = recordedFindings({ address: ME, trades });
    expect(found.map((finding) => [finding.kind, finding.other])).toEqual([
      ['traded', B],
      ['traded', A],
    ]);
    // Behind it: both orders of each trade, read when the row opens.
    expect(found[0].evidenceSignatures).toEqual([
      id(3),
      id(103),
      id(2),
      id(102),
    ]);
    expect(found[0].evidenceKind).toBe('orders');
  });
});

describe('its Q-Asset trades added up (the Trades tab)', () => {
  it('by asset: units each way, the QORT for them, most trades first', () => {
    const summary = summariseAssetTrades([
      trade(A, 1, [0, 'QORT', '529.00000000'], [11, 'Gadget', '23.00000000']),
      trade(A, 2, [0, 'QORT', '100.00000000'], [11, 'Gadget', '4.00000000']),
      trade(B, 3, [11, 'Gadget', '2.00000000'], [0, 'QORT', '50.00000000']),
      // Two assets: one bought, one sold, no QORT.
      trade(A, 4, [6, 'Tokens', '5.00000000'], [11, 'Gadget', '1.00000000']),
    ]);
    expect(summary.count).toBe(4);
    expect(summary.partners).toBe(2);
    expect(summary.qortPaid).toBe(62_900_000_000n);
    expect(summary.qortGot).toBe(5_000_000_000n);
    expect(
      summary.assets.map((asset) => [asset.asset.name, asset.count])
    ).toEqual([
      ['Gadget', 4],
      ['Tokens', 1],
    ]);
    expect(summary.assets[0]).toMatchObject({
      bought: 2_800_000_000n,
      sold: 200_000_000n,
      qortPaid: 62_900_000_000n,
      qortGot: 5_000_000_000n,
      // The unit bought with another asset has no price in QORT.
      boughtForQort: 2_700_000_000n,
      soldForQort: 200_000_000n,
    });
    expect(summary.assets[1]).toMatchObject({
      sold: 500_000_000n,
      qortGot: 0n,
      soldForQort: 0n,
    });
  });

  it('the QORT per unit, on the units traded for QORT only', () => {
    expect(qortPerUnit(62_900_000_000n, 2_700_000_000n)).toBeCloseTo(23.296, 3);
    expect(qortPerUnit(0n, 100n)).toBeNull();
  });
});
