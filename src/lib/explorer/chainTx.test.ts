import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import { CoreHttpError } from './core';
import {
  CHAIN_TYPES,
  chainCoverage,
  chainPageRead,
  chainTipRead,
  chainTypes,
  chainWaitingRead,
  cleanBlocks,
  cleanChainFilter,
  cleanOrder,
  joinPages,
  parseBlockNumber,
  rangeFor,
  startsPastTip,
  type ChainPage,
} from './chainTx';
import { typesFor } from './txFamilies';

// The whole chain's transactions: the reads (always confirmed, always in a
// block range, 20 rows, never messages), the ranges (never past the pinned
// tip), what is typed for a block, and how a list's pages join.

type Answer = { status?: number; body: unknown };
let answer: (path: string) => Answer;
let paths: string[] = [];

beforeEach(() => {
  paths = [];
  answer = () => ({ body: [] });
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

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');
const row = (n: number) => ({
  type: 'PAYMENT',
  signature: `sig${n}`,
  timestamp: 1_000 + n,
});

describe('rangeFor', () => {
  it('covers the latest 1,000 or 10,000 blocks up to the tip, or as many as picked from a block', () => {
    expect(rangeFor({ kind: 'latest', blocks: 1000 }, 2_804_338)).toEqual({
      start: 2_803_339,
      limit: 1000,
    });
    expect(rangeFor({ kind: 'latest', blocks: 10_000 }, 2_804_338)).toEqual({
      start: 2_794_339,
      limit: 10_000,
    });
    expect(
      rangeFor({ kind: 'from', start: 2_600_000, span: 10_000 }, 2_804_338)
    ).toEqual({ start: 2_600_000, limit: 10_000 });
    expect(
      rangeFor({ kind: 'from', start: 2_401_221, span: 1 }, 2_804_338)
    ).toEqual({ start: 2_401_221, limit: 1 });
  });

  it('never reaches past the tip, so a range’s rows don’t move while it is paged', () => {
    expect(
      rangeFor({ kind: 'from', start: 2_804_300, span: 100 }, 2_804_338)
    ).toEqual({ start: 2_804_300, limit: 39 });
    expect(rangeFor({ kind: 'latest', blocks: 1000 }, 400)).toEqual({
      start: 1,
      limit: 400,
    });
    expect(rangeFor({ kind: 'from', start: 0, span: 10 }, 400).start).toBe(1);
  });

  it('knows a block to start from that is past the tip', () => {
    expect(startsPastTip({ kind: 'from', start: 501, span: 10 }, 500)).toBe(
      true
    );
    expect(startsPastTip({ kind: 'from', start: 500, span: 10 }, 500)).toBe(
      false
    );
    expect(startsPastTip({ kind: 'latest', blocks: 1000 }, 5)).toBe(false);
  });
});

describe('what a step keeps, made safe', () => {
  it('reads the blocks, the order and the kind as kept, anything else as the default', () => {
    expect(cleanBlocks({ kind: 'latest', blocks: 10_000 })).toEqual({
      kind: 'latest',
      blocks: 10_000,
    });
    expect(cleanBlocks({ kind: 'latest', blocks: 5 })).toEqual({
      kind: 'latest',
      blocks: 1000,
    });
    expect(cleanBlocks({ kind: 'from', start: 7, span: 7 })).toEqual({
      kind: 'from',
      start: 7,
      span: 10_000,
    });
    expect(cleanBlocks({ kind: 'from', start: -3, span: 1 })).toEqual({
      kind: 'latest',
      blocks: 1000,
    });
    expect(cleanBlocks(null)).toEqual({ kind: 'latest', blocks: 1000 });
    expect(cleanOrder('oldest')).toBe('oldest');
    expect(cleanOrder('sideways')).toBe('newest');
  });

  it('never lists messages: their kind, or a type of it, reads as all the others', () => {
    expect(cleanChainFilter({ kind: 'messages', type: null })).toEqual({
      kind: 'all',
      type: null,
    });
    expect(cleanChainFilter({ kind: 'messages', type: 'CHAT' })).toEqual({
      kind: 'all',
      type: null,
    });
    expect(CHAIN_TYPES).not.toContain('MESSAGE');
    expect(CHAIN_TYPES).not.toContain('CHAT');
    expect(CHAIN_TYPES).toHaveLength(39);
    expect(chainTypes({ kind: 'all', type: null })).toEqual(CHAIN_TYPES);
    expect(chainTypes({ kind: 'payments', type: null })).toEqual(
      typesFor('payments')
    );
    expect(chainTypes({ kind: 'names', type: 'BUY_NAME' })).toEqual([
      'BUY_NAME',
    ]);
    expect(chainTypes({ kind: 'messages', type: null })).toEqual([]);
  });
});

describe('parseBlockNumber', () => {
  it('reads a block number as people type it, or as Hub shows it in their language', () => {
    for (const text of [
      '2700000',
      ' 2700000 ',
      '2,700,000',
      '2.700.000',
      "2'700'000",
      '2 700 000',
      '2\u00a0700\u00a0000',
      '2\u202f700\u202f000',
      '#2,700,000',
      '\u0662\u066c\u0667\u0660\u0660\u066c\u0660\u0660\u0660',
      '\u06f2\u06f7\u06f0\u06f0\u06f0\u06f0\u06f0',
    ])
      expect(parseBlockNumber(text), text).toBe(2_700_000);
    expect(parseBlockNumber('621')).toBe(621);
  });

  it('turns down what isn’t one', () => {
    for (const text of [
      '',
      'abc',
      '0',
      '-5',
      '1.5',
      '27,00,000',
      '2,7000,00',
      '1e6',
      '1234567890',
      '2700000x',
    ])
      expect(parseBlockNumber(text), text).toBeNull();
  });
});

describe('chainTipRead', () => {
  it('reads the chain’s height, and takes nothing else for one', async () => {
    answer = () => ({ body: 2_804_338 });
    expect(await chainTipRead().load()).toBe(2_804_338);
    expect(paths).toEqual(['/blocks/height']);
    answer = () => ({ body: 'busy' });
    await expect(chainTipRead().load()).rejects.toBeInstanceOf(CoreHttpError);
    answer = () => ({ body: 0 });
    await expect(chainTipRead().load()).rejects.toBeInstanceOf(CoreHttpError);
  });
});

describe('chainPageRead', () => {
  const range = { start: 2_803_339, limit: 1000 };

  it('asks for 20 confirmed rows of the types in the block range, newest first', async () => {
    answer = () => ({ body: [row(1)] });
    const page = await chainPageRead(
      ['PAYMENT', 'TRANSFER_ASSET'],
      range,
      'newest',
      40
    ).load();
    expect(paths).toEqual([
      '/transactions/search?txType=PAYMENT&txType=TRANSFER_ASSET&startBlock=2803339&blockLimit=1000&confirmationStatus=CONFIRMED&limit=20&offset=40&reverse=true',
    ]);
    expect(page).toEqual({ rows: [row(1)], full: false });
  });

  it('asks oldest first under a key of its own, and keys the types in any order alike', () => {
    expect(
      chainPageRead(['TRANSFER_ASSET', 'PAYMENT'], range, 'newest', 0).key
    ).toBe('chain:PAYMENT,TRANSFER_ASSET:2803339:1000:newest:0');
    expect(chainPageRead(['PAYMENT'], range, 'oldest', 20).key).toBe(
      'chain:PAYMENT:2803339:1000:oldest:20'
    );
  });

  it('reads oldest first with reverse=false', async () => {
    await chainPageRead(['PAYMENT'], range, 'oldest', 0).load();
    expect(params(paths[0]).get('reverse')).toBe('false');
  });

  it('calls a page full by what the node sent, so a row it couldn’t read doesn’t end the list', async () => {
    answer = () => ({
      body: [...Array.from({ length: 19 }, (_, i) => row(i)), { type: 1 }],
    });
    const page = await chainPageRead(['PAYMENT'], range, 'newest', 0).load();
    expect(page.rows).toHaveLength(19);
    expect(page.full).toBe(true);
  });

  it('takes a failure, or anything but a list, for a failure, never for no rows', async () => {
    answer = () => ({ status: 400, body: 'Bad parameter "txType"' });
    await expect(
      chainPageRead(['PAYMENT'], range, 'newest', 0).load()
    ).rejects.toBeInstanceOf(CoreHttpError);
    answer = () => ({ body: { rows: [] } });
    await expect(
      chainPageRead(['PAYMENT'], range, 'newest', 0).load()
    ).rejects.toBeInstanceOf(CoreHttpError);
  });

  it('never sends a search without types, with a message type, or without a block range', async () => {
    await expect(chainPageRead([], range, 'newest', 0).load()).rejects.toThrow(
      RangeError
    );
    await expect(
      chainPageRead(['PAYMENT', 'CHAT'], range, 'newest', 0).load()
    ).rejects.toThrow(RangeError);
    await expect(
      chainPageRead(['PAYMENT'], { start: 0, limit: 10 }, 'newest', 0).load()
    ).rejects.toThrow(RangeError);
    await expect(
      chainPageRead(
        ['PAYMENT'],
        { start: 5, limit: 20_000 },
        'newest',
        0
      ).load()
    ).rejects.toThrow(RangeError);
    expect(paths).toEqual([]);
  });
});

describe('chainWaitingRead', () => {
  it('reads what waits apart: 20 of the types, newest first, no block range', async () => {
    answer = () => ({ body: [row(1)] });
    const page = await chainWaitingRead(['PAYMENT']).load();
    const p = params(paths[0]);
    expect(paths[0].startsWith('/transactions/unconfirmed?')).toBe(true);
    expect(p.getAll('txType')).toEqual(['PAYMENT']);
    expect(p.get('limit')).toBe('20');
    expect(p.get('reverse')).toBe('true');
    expect(p.get('startBlock')).toBeNull();
    expect(p.get('confirmationStatus')).toBeNull();
    expect(page).toEqual({ rows: [row(1)], full: false });
    // Refresh on the list forgets it (its key ends with the list's scope).
    expect(chainWaitingRead(['PAYMENT']).key).toBe(
      'chainwaiting:PAYMENT:chain'
    );
    expect(chainTipRead().key).toBe('tip:chain');
    await expect(chainWaitingRead(['MESSAGE']).load()).rejects.toThrow(
      RangeError
    );
  });
});

describe('joinPages', () => {
  const page = (
    from: number,
    count: number,
    full = count === 20
  ): ChainPage => ({
    rows: Array.from({ length: count }, (_, i) => row(from + i)),
    full,
  });

  it('joins the pages read, a short one ending the list', () => {
    const data = new Map([
      ['p0', page(0, 20)],
      ['p1', page(20, 5)],
    ]);
    const list = joinPages(['p0', 'p1'], data, []);
    expect(list.rows).toHaveLength(25);
    expect(list).toMatchObject({
      read: 2,
      done: true,
      pending: null,
      repeated: false,
    });
  });

  it('keeps the rows above a page that failed or is still on its way, and none after it', () => {
    const data = new Map([
      ['p0', page(0, 20)],
      ['p2', page(40, 20)],
    ]);
    expect(joinPages(['p0', 'p1', 'p2'], data, ['p1'])).toMatchObject({
      read: 1,
      done: false,
      pending: 'failed',
    });
    expect(joinPages(['p0', 'p1', 'p2'], data, []).pending).toBe('loading');
    expect(joinPages(['p0', 'p1', 'p2'], data, []).rows).toHaveLength(20);
  });

  it('shows a row the node gave on two pages once', () => {
    const data = new Map([
      ['p0', page(0, 20)],
      ['p1', { rows: [row(19), row(20)], full: false }],
    ]);
    const list = joinPages(['p0', 'p1'], data, []);
    expect(list.rows.map((r) => r.signature)).toEqual([
      ...Array.from({ length: 21 }, (_, i) => `sig${i}`),
    ]);
    // Another may have been passed over: the list says it saw a repeat.
    expect(list.repeated).toBe(true);
  });

  it('says none only for an empty answer, and the only one for exactly one', () => {
    expect(chainCoverage(0, true, 'newest')).toBe('none');
    expect(chainCoverage(1, true, 'newest')).toBe('only');
    expect(chainCoverage(7, true, 'oldest')).toBe('all');
    expect(chainCoverage(40, false, 'newest')).toBe('newest');
    expect(chainCoverage(40, false, 'oldest')).toBe('oldest');
    // A full page whose rows couldn't be read isn't "none".
    expect(chainCoverage(0, false, 'newest')).toBe('newest');
    // A row seen on two pages: never "all", another may have been passed over.
    expect(chainCoverage(24, true, 'newest', true)).toBe('newest');
    expect(chainCoverage(24, true, 'oldest', true)).toBe('oldest');
  });
});
