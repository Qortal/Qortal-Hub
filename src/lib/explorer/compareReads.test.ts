import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import { CoreHttpError } from './core';
import {
  FUNDED_PAGE,
  FUNDED_PAGES,
  firstReceivedRead,
  fundedPageRead,
  pairPaymentsRead,
  payerBandRead,
} from './compareReads';

const SENDER = `Q${'S'.repeat(33)}`;
const RECIPIENT = `Q${'R'.repeat(33)}`;

type Answer = { status?: number; body: unknown };
let answer: (path: string) => Answer;
let paths: string[] = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const payment = (n: number, extra: Record<string, unknown> = {}) => ({
  type: 'PAYMENT',
  signature: `sig${n}`,
  timestamp: 1_700_000_000_000 + n,
  blockHeight: 1_000_000 + n,
  creatorAddress: SENDER,
  recipient: RECIPIENT,
  amount: '1.00000000',
  ...extra,
});

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the payments between two compared accounts', () => {
  it('are read exactly, by sender and recipient, 100 at a time; one more row past 1,000 says there are older ones', async () => {
    answer = (path) => {
      const query = params(path);
      const offset = Number(query.get('offset'));
      const limit = Number(query.get('limit'));
      // 1,001 of them.
      const all = Array.from({ length: 1001 }, (_, n) => payment(n));
      return { body: all.slice(offset, offset + limit) };
    };
    const read = await pairPaymentsRead(SENDER, RECIPIENT).load();
    expect(read?.rows).toHaveLength(1000);
    expect(read?.more).toBe(true);
    expect(paths).toHaveLength(11);
    const first = params(paths[0]);
    expect(first.get('senderAddress')).toBe(SENDER);
    expect(first.get('recipientAddress')).toBe(RECIPIENT);
    expect(first.get('limit')).toBe('100');
    expect(first.get('reverse')).toBe('true');
    expect(params(paths[10]).get('limit')).toBe('1');
  });

  it('a short read is all of them', async () => {
    answer = () => ({ body: [payment(1), payment(2)] });
    expect(await pairPaymentsRead(SENDER, RECIPIENT).load()).toEqual({
      rows: [payment(1), payment(2)],
      more: false,
    });
  });

  it('a node without that read: null (the lists say it then); any other failure throws', async () => {
    answer = () => ({ status: 404, body: 'Not Found' });
    expect(await pairPaymentsRead(SENDER, RECIPIENT).load()).toBeNull();
    answer = () => ({ status: 500, body: { error: 5, message: 'repository' } });
    await expect(
      pairPaymentsRead(SENDER, RECIPIENT).load()
    ).rejects.toBeInstanceOf(CoreHttpError);
  });

  it('is kept under a key that ends with the recipient', () => {
    expect(pairPaymentsRead(SENDER, RECIPIENT).key).toBe(
      `pairpay:${SENDER}:${RECIPIENT}`
    );
  });
});

describe('how busy a payer is', () => {
  it('reads one row at 100, 500 and 1,000 payments, while each answers one', async () => {
    let sent = 600;
    answer = (path) => ({
      body: Number(params(path).get('offset')) < sent ? [payment(1)] : [],
    });
    expect(await payerBandRead(SENDER).load()).toBe(500);
    expect(paths.map((path) => params(path).get('offset'))).toEqual([
      '99',
      '499',
      '999',
    ]);
    sent = 40;
    paths = [];
    expect(await payerBandRead(SENDER).load()).toBe(0);
    expect(paths).toHaveLength(1);
    sent = 5000;
    expect(await payerBandRead(SENDER).load()).toBe(1000);
  });

  it('a node without that read: null, never a band', async () => {
    answer = () => ({ status: 404, body: '' });
    expect(await payerBandRead(SENDER).load()).toBeNull();
  });
});

describe('the payments an account sent, page by page', () => {
  it('oldest first, 100 a page; a full page may have more', async () => {
    answer = (path) => {
      const offset = Number(params(path).get('offset'));
      return {
        body: Array.from({ length: offset === 0 ? 100 : 30 }, (_, n) =>
          payment(offset + n)
        ),
      };
    };
    const first = await fundedPageRead(SENDER, 0).load();
    expect(first?.rows).toHaveLength(100);
    expect(first?.full).toBe(true);
    expect(first?.beyond).toBeUndefined();
    expect(params(paths[0]).get('reverse')).toBe('false');
    expect(params(paths[0]).get('senderAddress')).toBe(SENDER);
    expect(params(paths[0]).get('recipientAddress')).toBeNull();
    const second = await fundedPageRead(SENDER, 1).load();
    expect(second).toEqual(expect.objectContaining({ full: false }));
    expect(params(paths[1]).get('offset')).toBe(String(FUNDED_PAGE));
  });

  it('the last page the Explorer reads takes one row more: whether it sent more', async () => {
    const last = FUNDED_PAGES - 1;
    answer = (path) => ({
      body: Array.from({ length: Number(params(path).get('limit')) }, (_, n) =>
        payment(n)
      ),
    });
    const page = await fundedPageRead(SENDER, last).load();
    expect(params(paths[0]).get('limit')).toBe(String(FUNDED_PAGE + 1));
    expect(page?.rows).toHaveLength(FUNDED_PAGE);
    expect(page?.beyond).toBe(true);
    answer = () => ({
      body: Array.from({ length: FUNDED_PAGE }, (_, n) => payment(n)),
    });
    expect((await fundedPageRead(SENDER, last).load())?.beyond).toBe(false);
  });

  it('keeps confirmed payments only, under a key that ends with the account', async () => {
    answer = () => ({
      body: [payment(1), { ...payment(2), blockHeight: undefined }],
    });
    expect((await fundedPageRead(SENDER, 0).load())?.rows).toEqual([
      payment(1),
    ]);
    expect(fundedPageRead(SENDER, 3).key).toBe(`fundedpay:3:${SENDER}`);
  });
});

describe('the earliest QORT payment an account received', () => {
  it('one row, oldest first, by recipient only', async () => {
    answer = () => ({ body: [payment(7)] });
    expect(await firstReceivedRead(RECIPIENT).load()).toEqual({
      from: SENDER,
      height: 1_000_007,
      timestamp: 1_700_000_000_007,
      amount: '1.00000000',
      signature: 'sig7',
    });
    const query = params(paths[0]);
    expect(query.get('recipientAddress')).toBe(RECIPIENT);
    expect(query.get('senderAddress')).toBeNull();
    expect(query.get('limit')).toBe('1');
    expect(query.get('reverse')).toBe('false');
  });

  it('a payer that isn’t a valid account is none; a row without a block is no answer', async () => {
    answer = () => ({
      body: [payment(7, { creatorAddress: 'not-an-account' })],
    });
    expect((await firstReceivedRead(RECIPIENT).load())?.from).toBeNull();
    answer = () => ({ body: [payment(7, { blockHeight: undefined })] });
    expect(await firstReceivedRead(RECIPIENT).load()).toBeNull();
  });

  it('none from the node: null; a failure throws, never “none”', async () => {
    answer = () => ({ body: [] });
    expect(await firstReceivedRead(RECIPIENT).load()).toBeNull();
    answer = () => ({ status: 500, body: { error: 5, message: 'repository' } });
    await expect(firstReceivedRead(RECIPIENT).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});
