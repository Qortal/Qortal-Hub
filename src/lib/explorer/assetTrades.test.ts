import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import i18n from '../../i18n/i18n';
import { sentenceText } from '../../components/Explorer/transactions/sentenceText';
import {
  assetTradesRead,
  FILLED_MAX,
  leftOutTrades,
  tradeSums,
  tradesByAccount,
  type AssetTrade,
} from './assetTrades';
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
