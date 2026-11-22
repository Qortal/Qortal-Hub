import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import { CoreHttpError } from './core';
import {
  contractRead,
  OFFERS_MAX,
  offersOf,
  offersRead,
  payingContracts,
  payoutsRead,
} from './tradeReads';
import type { TxRow } from './reads';

// The Trades tab's offers and payouts against a made-up node.

const ME = `Q${'M'.repeat(33)}`;
const OTHER = `Q${'O'.repeat(33)}`;
const QORT = 100_000_000n;

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

let n = 0;
const deploy = (over: Partial<TxRow> = {}): TxRow => ({
  type: 'DEPLOY_AT',
  timestamp: 1_000 + (n += 1),
  signature: `s${n}`,
  creatorAddress: ME,
  aTType: 'ACCT',
  tags: 'ACCT QORT LTC',
  amount: '25.01000000',
  aTAddress: `A${n}`,
  creationBytes: 'x'.repeat(2000),
  ...over,
});

const payout = (over: Partial<TxRow> = {}): TxRow => ({
  type: 'AT',
  timestamp: 5_000 + (n += 1),
  signature: `p${n}`,
  recipient: ME,
  atAddress: `A${n}`,
  amount: '0.00999232',
  assetId: 0,
  ...over,
});

describe('the trade offers it made', () => {
  it('keeps its own trade contracts, with their coin and QORT, newest first, and not their code', () => {
    const offers = offersOf(
      [
        deploy({ aTAddress: 'A1', timestamp: 1 }),
        deploy({
          aTAddress: 'A2',
          aTType: undefined,
          tags: 'ACCT QORT DOGE',
          amount: '12',
          timestamp: 2,
        }),
        // Not a trade contract, and one that isn't its own.
        deploy({ aTAddress: 'A3', aTType: 'LOTTERY', tags: 'game' }),
        deploy({ aTAddress: 'A4', creatorAddress: OTHER }),
      ],
      ME
    );
    expect(offers).toEqual([
      { at: 'A2', chain: 'DOGECOIN', qort: 12n * QORT, timestamp: 2 },
      { at: 'A1', chain: 'LITECOIN', qort: 2_501_000_000n, timestamp: 1 },
    ]);
  });

  it('reads its DEPLOY_AT transactions 100 at a time, kept under its address', async () => {
    route = (path) =>
      path.startsWith('/transactions/search?')
        ? { body: [deploy({ aTAddress: 'A9' })] }
        : undefined;
    const spec = offersRead(ME);
    expect(spec.key).toBe(`tradeoffers:${ME}`);
    const read = await spec.load();
    expect(read).toMatchObject({ more: false, read: 1 });
    expect(read.offers.map((offer) => offer.at)).toEqual(['A9']);
    const query = params(paths[0]);
    expect([
      query.get('address'),
      query.get('txType'),
      query.get('limit'),
      query.get('reverse'),
    ]).toEqual([ME, 'DEPLOY_AT', '100', 'true']);
    expect(query.get('confirmationStatus')).toBe('CONFIRMED');
  });

  it('exactly the most it reads, with nothing past them, is all of them; a row past them is more', async () => {
    let past: TxRow[] = [];
    route = (path) => {
      if (!path.startsWith('/transactions/search?')) return undefined;
      const query = params(path);
      const offset = Number(query.get('offset'));
      if (query.get('limit') === '1')
        return { body: offset === OFFERS_MAX ? past : [] };
      return {
        body: Array.from({ length: 100 }, (_, i) =>
          deploy({ signature: `d${offset + i}`, aTAddress: `Ad${offset + i}` })
        ),
      };
    };
    const all = await offersRead(ME).load();
    expect(all.read).toBe(OFFERS_MAX);
    expect(all.more).toBe(false);
    expect(params(paths[paths.length - 1]).get('offset')).toBe(
      String(OFFERS_MAX)
    );
    past = [deploy({ signature: 'older', aTAddress: 'Aolder' })];
    expect((await offersRead(ME).load()).more).toBe(true);
    // A row past them it already holds (a transaction arrived meanwhile): the next one says.
    past = [deploy({ signature: 'd999', aTAddress: 'Ad999' })];
    paths = [];
    expect((await offersRead(ME).load()).more).toBe(false);
    expect(
      paths
        .filter((path) => params(path).get('limit') === '1')
        .map((path) => params(path).get('offset'))
    ).toEqual(['1000', '1001']);
  });
});

describe('a read that isn’t a list', () => {
  it('is a failure, never “no offers” or “no payouts”', async () => {
    route = () => ({ body: { transactions: [] } });
    await expect(offersRead(ME).load()).rejects.toBeInstanceOf(CoreHttpError);
    await expect(payoutsRead(ME).load()).rejects.toBeInstanceOf(CoreHttpError);
  });
});

describe('the payouts it got from contracts', () => {
  it('only QORT paid to it, newest first, with the oldest read', async () => {
    route = (path) =>
      path.startsWith('/transactions/search?')
        ? {
            body: [
              payout({ atAddress: 'A1', timestamp: 30 }),
              payout({ atAddress: 'A2', recipient: OTHER, timestamp: 20 }),
              payout({ atAddress: 'A3', assetId: 6, timestamp: 10 }),
            ],
          }
        : undefined;
    const spec = payoutsRead(ME);
    expect(spec.key).toBe(`tradepayouts:${ME}`);
    const read = await spec.load();
    expect(read.payouts.map((each) => each.at)).toEqual(['A1']);
    expect(read.payouts[0].amount).toBe(999_232n);
    expect(read.oldest).toBe(10);
    expect(read.more).toBe(false);
    expect(params(paths[0]).get('txType')).toBe('AT');
  });

  it('each paying contract once, newest first', () => {
    const payouts = [
      { at: 'A1', amount: 1n, timestamp: 3, signature: 'a' },
      { at: 'A2', amount: 1n, timestamp: 2, signature: 'b' },
      { at: 'A1', amount: 1n, timestamp: 1, signature: 'c' },
    ];
    expect(payingContracts(payouts).map((each) => each.signature)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('a contract’s own record', () => {
  it('is the record, or null when it isn’t a trade contract or the node doesn’t know it', async () => {
    route = (path) =>
      path === '/crosschain/trade/Aone'
        ? { body: { mode: 'REDEEMED' } }
        : path === '/crosschain/trade/Alottery'
          ? {
              status: 400,
              body: { error: 125, message: 'invalid search criteria' },
            }
          : path === '/crosschain/trade/Agone'
            ? {
                status: 404,
                body: { error: 124, message: 'account address unknown' },
              }
            : undefined;
    expect(contractRead('Aone').key).toBe('tradecontract:Aone');
    expect(await contractRead('Aone').load()).toEqual({ mode: 'REDEEMED' });
    expect(await contractRead('Alottery').load()).toBeNull();
    expect(await contractRead('Agone').load()).toBeNull();
  });

  it('a failed read throws, never “not a trade”', async () => {
    route = () => ({
      status: 500,
      body: { error: 5, message: 'repository issue' },
    });
    await expect(contractRead('Aone').load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });

  it('every part of the path is encoded', async () => {
    route = () => ({ body: {} });
    await contractRead('A/b?c#d').load();
    expect(paths[0]).toBe(`/crosschain/trade/${encodeURIComponent('A/b?c#d')}`);
  });
});
