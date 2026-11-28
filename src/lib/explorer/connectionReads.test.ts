import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  coreSponsorRead,
  EXCHANGE_PAGE,
  exchangePaymentsRead,
  fundingRead,
} from './connectionReads';
import { KNOWN_EXCHANGES } from './exchanges';

// The reads only Connections makes: where its first QORT came from (by
// the reference chain, as Q-Mintership+ finds it), its payments with the
// known exchanges, and which sponsor Core counts.

const ME = `Q${'M'.repeat(33)}`;
const A = `Q${'A'.repeat(33)}`;
const B = `Q${'B'.repeat(33)}`;
const KEY = 'k'.repeat(44);
const [TRADEOGRE, NONKYC] = Object.keys(KNOWN_EXCHANGES);
const sig = (n: number) => `${String(n).padStart(8, '1')}${'z'.repeat(80)}`;

type Answer = { status?: number; body: unknown; raw?: boolean };
let route: (path: string) => Answer | undefined = () => undefined;
let paths: string[] = [];

beforeEach(() => {
  paths = [];
  route = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      paths.push(path);
      const answer = route(path) ?? {
        status: 404,
        body: '<html>Not Found</html>',
        raw: true,
      };
      const status = answer.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () =>
          answer.raw ? String(answer.body) : JSON.stringify(answer.body),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const payment = (n: number, from: string, to: string, amount = '1') => ({
  type: 'PAYMENT',
  timestamp: 1_700_000_000_000 + n * 60_000,
  signature: sig(n),
  blockHeight: 1_000 + n,
  creatorAddress: from,
  recipient: to,
  amount,
});

describe('fundingRead', () => {
  it('an account that never sent anything: its reference is its first incoming transaction', async () => {
    route = (path) =>
      path === `/transactions/signature/${sig(1)}`
        ? { body: payment(1, A, ME, '5.4321') }
        : undefined;
    const funding = await fundingRead({
      address: ME,
      publicKey: null,
      reference: sig(1),
    }).load();
    expect(funding).toMatchObject({
      kind: 'payment',
      from: A,
      amount: '5.4321',
    });
    expect(paths).toEqual([`/transactions/signature/${sig(1)}`]);
  });

  it('one that has: its oldest own transaction’s reference', async () => {
    route = (path) => {
      if (path.startsWith(`/transactions/creator/${KEY}?`)) {
        expect(params(path).get('reverse')).toBe('false');
        return {
          body: [{ ...payment(5, ME, B), reference: sig(2) }],
        };
      }
      if (path === `/transactions/signature/${sig(2)}`)
        return { body: payment(2, B, ME) };
      return undefined;
    };
    const funding = await fundingRead({
      address: ME,
      publicKey: KEY,
      reference: sig(9),
    }).load();
    expect(funding).toMatchObject({ kind: 'payment', from: B });
  });

  it('a first PUBLICIZE takes any reference: its first QORT payment received instead', async () => {
    route = (path) => {
      if (path.startsWith(`/transactions/creator/${KEY}?`))
        return {
          body: [
            {
              type: 'PUBLICIZE',
              timestamp: 1,
              signature: sig(7),
              blockHeight: 5,
              reference: sig(8),
            },
          ],
        };
      if (path.startsWith('/transactions/payments/between?')) {
        expect(params(path).get('recipientAddress')).toBe(ME);
        expect(params(path).get('reverse')).toBe('false');
        return { body: [payment(3, A, ME, '2')] };
      }
      return undefined;
    };
    const funding = await fundingRead({
      address: ME,
      publicKey: KEY,
      reference: null,
    }).load();
    expect(funding).toMatchObject({ kind: 'payment', from: A, amount: '2' });
    expect(
      paths.some((path) => path.startsWith('/transactions/signature/'))
    ).toBe(false);
  });

  it('a reference the node doesn’t know falls back; a failure throws, never “none”', async () => {
    route = (path) => {
      if (path === `/transactions/signature/${sig(4)}`)
        return {
          status: 404,
          body: { error: 311, message: 'transaction unknown' },
        };
      if (path.startsWith('/transactions/payments/between?'))
        return { body: [] };
      return undefined;
    };
    await expect(
      fundingRead({ address: ME, publicKey: null, reference: sig(4) }).load()
    ).resolves.toBeNull();
    route = (path) =>
      path === `/transactions/signature/${sig(4)}`
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined;
    await expect(
      fundingRead({ address: ME, publicKey: null, reference: sig(4) }).load()
    ).rejects.toBeTruthy();
  });

  it('is kept under a key ending with the address, so Refresh forgets it', () => {
    expect(
      fundingRead({ address: ME, publicKey: null, reference: null }).key
    ).toBe(`funding:${ME}`);
  });
});

describe('exchangePaymentsRead', () => {
  it('reads each exchange and way exactly, 100 at a time, and says when it stopped short', async () => {
    route = (path) => {
      if (!path.startsWith('/transactions/payments/between?')) return undefined;
      const query = params(path);
      // 100 a read; the one more row after ten full reads is a read of 1.
      expect(query.get('limit')).toBe(
        query.get('offset') === '1000' ? '1' : String(EXCHANGE_PAGE)
      );
      const from = query.get('senderAddress');
      const to = query.get('recipientAddress');
      const offset = Number(query.get('offset'));
      if (from === ME && to === TRADEOGRE)
        // A busy way: every page full.
        return {
          body: Array.from({ length: EXCHANGE_PAGE }, (_, i) =>
            payment(offset + i, ME, TRADEOGRE)
          ),
        };
      if (from === NONKYC && to === ME)
        return { body: offset ? [] : [payment(1, NONKYC, ME, '12')] };
      return { body: [] };
    };
    const flows = await exchangePaymentsRead(ME).load();
    expect(
      flows?.map((flow) => [
        flow.exchange,
        flow.direction,
        flow.rows.length,
        flow.more,
      ])
    ).toEqual([
      ['TradeOgre', 'sent', 1_000, 'older'],
      ['nonkyc.io', 'received', 1, false],
    ]);
    // Ten reads of 100, then one more row that says older ones remain.
    expect(
      paths.filter((path) => params(path).get('recipientAddress') === TRADEOGRE)
    ).toHaveLength(11);
  });

  it('exactly 1,000 payments to an exchange: all of them were read, none is older', async () => {
    const EXACTLY = 1_000;
    route = (path) => {
      if (!path.startsWith('/transactions/payments/between?')) return undefined;
      const query = params(path);
      if (
        query.get('senderAddress') !== ME ||
        query.get('recipientAddress') !== TRADEOGRE
      )
        return { body: [] };
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? EXCHANGE_PAGE);
      return {
        body: Array.from(
          { length: Math.max(0, Math.min(limit, EXACTLY - offset)) },
          (_, i) => payment(offset + i, ME, TRADEOGRE)
        ),
      };
    };
    const flows = await exchangePaymentsRead(ME).load();
    const sent = flows?.find(
      (flow) => flow.address === TRADEOGRE && flow.direction === 'sent'
    );
    expect(sent?.rows).toHaveLength(EXACTLY);
    // The sentence it makes says "there are older ones" when `more`.
    expect(sent?.more).toBe(false);
  });

  it('on an exchange’s own account, it doesn’t ask about itself', async () => {
    route = (path) =>
      path.startsWith('/transactions/payments/between?')
        ? { body: [] }
        : undefined;
    await exchangePaymentsRead(TRADEOGRE).load();
    expect(
      paths.some(
        (path) =>
          params(path).get('senderAddress') === TRADEOGRE &&
          params(path).get('recipientAddress') === TRADEOGRE
      )
    ).toBe(false);
  });

  it('a node without that read: null (the lists say it then); a failure throws', async () => {
    await expect(exchangePaymentsRead(ME).load()).resolves.toBeNull();
    route = () => ({
      status: 500,
      body: { error: 5, message: 'repository issue' },
    });
    await expect(exchangePaymentsRead(ME).load()).rejects.toBeTruthy();
  });
});

describe('coreSponsorRead', () => {
  it('the sponsor Core counts, or none (its own “account unknown”)', async () => {
    route = (path) =>
      path === `/addresses/sponsorship/${ME}/sponsor`
        ? { body: { address: A, level: 7, names: [] } }
        : undefined;
    await expect(coreSponsorRead(ME).load()).resolves.toBe(A);
    route = () => ({
      status: 404,
      body: { error: 124, message: 'account address unknown' },
    });
    await expect(coreSponsorRead(ME).load()).resolves.toBeNull();
    route = () => ({ status: 500, body: { error: 5 } });
    await expect(coreSponsorRead(ME).load()).rejects.toBeTruthy();
  });
});
