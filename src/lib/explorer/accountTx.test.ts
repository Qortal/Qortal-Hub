import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  ACCOUNT_TX_MAX,
  ACCOUNT_TX_PAGE,
  accountTxKey,
  atCeiling,
  canReadMore,
  fromFirstPage,
  mergeNewest,
  mergeOlderAt,
  readTxPage,
  type AccountTxList,
} from './accountTx';
import { CoreHttpError } from './core';
import type { TxRow } from './reads';

const ADDRESS = `Q${'P'.repeat(33)}`;

const row = (n: number): TxRow => ({
  type: 'PAYMENT',
  timestamp: 1_800_000_000_000 - n,
  signature: `sig${n}`,
});
const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => row(from + index));

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
        text: async () => JSON.stringify(body),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('the list key', () => {
  it('ends with the address (Refresh forgets it) and holds the types in one order', () => {
    expect(accountTxKey(ADDRESS, [])).toBe(`txlist:all:${ADDRESS}`);
    expect(accountTxKey(ADDRESS, ['TRANSFER_ASSET', 'PAYMENT'])).toBe(
      accountTxKey(ADDRESS, ['PAYMENT', 'TRANSFER_ASSET'])
    );
    expect(accountTxKey(ADDRESS, ['PAYMENT']).endsWith(`:${ADDRESS}`)).toBe(
      true
    );
  });
});

describe('reading the list', () => {
  it('asks for confirmed transactions by address, 100 a page, newest first, each type named', async () => {
    answer = () => ({ body: rows(1, 3) });
    const list = fromFirstPage(
      await readTxPage(ADDRESS, ['PAYMENT', 'MULTI_PAYMENT'], 0)
    );
    expect(list).toEqual({
      rows: rows(1, 3),
      nextOffset: 3,
      done: true,
      epoch: 0,
    });
    const query = new URLSearchParams(paths[0].split('?')[1]);
    expect(paths[0].startsWith('/transactions/search?')).toBe(true);
    expect(query.get('address')).toBe(ADDRESS);
    expect(query.getAll('txType')).toEqual(['PAYMENT', 'MULTI_PAYMENT']);
    expect(query.get('confirmationStatus')).toBe('CONFIRMED');
    expect(query.get('limit')).toBe(String(ACCOUNT_TX_PAGE));
    expect(query.get('offset')).toBe('0');
    expect(query.get('reverse')).toBe('true');
  });

  it('asks for no type at all for every transaction', async () => {
    answer = () => ({ body: [] });
    await readTxPage(ADDRESS, [], 0);
    expect(paths[0]).not.toContain('txType');
  });

  it('fails on a failed read, never an empty list', async () => {
    answer = () => ({ status: 500, body: { error: 1, message: 'busy' } });
    await expect(readTxPage(ADDRESS, [], 0)).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });

  it('reads on from where the list stopped, and not past its most', async () => {
    answer = (path) => ({
      body: rows(
        Number(new URLSearchParams(path.split('?')[1]).get('offset')) + 1,
        100
      ),
    });
    const first = fromFirstPage(await readTxPage(ADDRESS, [], 0));
    expect(canReadMore(first)).toBe(true);
    const second = mergeOlderAt(
      first,
      await readTxPage(ADDRESS, [], first.nextOffset),
      first.nextOffset,
      first.epoch
    );
    expect(second.rows).toHaveLength(200);
    expect(second.nextOffset).toBe(200);
    expect(
      paths.map((path) => new URLSearchParams(path.split('?')[1]).get('offset'))
    ).toEqual(['0', '100']);
    const atMost: AccountTxList = {
      rows: rows(1, 3),
      nextOffset: ACCOUNT_TX_MAX,
      done: false,
      epoch: 0,
    };
    expect(canReadMore(atMost)).toBe(false);
    expect(atCeiling(atMost)).toBe(true);
    // Read all: nothing more, and no ceiling to speak of.
    const all: AccountTxList = { ...atMost, nextOffset: 3, done: true };
    expect(canReadMore(all)).toBe(false);
    expect(atCeiling(all)).toBe(false);
  });
});

describe('merging pages', () => {
  it('a list from its first page: done when the node had less than a page', () => {
    expect(fromFirstPage(rows(1, 5))).toEqual({
      rows: rows(1, 5),
      nextOffset: 5,
      done: true,
      epoch: 0,
    });
    expect(fromFirstPage(rows(1, 100)).done).toBe(false);
    expect(fromFirstPage(rows(1, 5), 3).epoch).toBe(3);
  });

  it('an older page appended, rows already held left out', () => {
    const list = mergeOlderAt(
      fromFirstPage(rows(1, 100)),
      [row(100), ...rows(101, 10)],
      100,
      0
    );
    expect(list.rows).toHaveLength(110);
    expect(new Set(list.rows.map((r) => r.signature)).size).toBe(110);
    expect(list.nextOffset).toBe(111);
    expect(list.done).toBe(true);
  });

  it('the newest page again on top of what is shown: the next older page starts after its last row', () => {
    const shown: AccountTxList = {
      rows: rows(1, 200),
      nextOffset: 200,
      done: false,
      epoch: 0,
    };
    const list = mergeNewest(shown, rows(0, 100));
    expect(list.rows).toHaveLength(201);
    expect(list.rows[0].signature).toBe('sig0');
    expect(list.nextOffset).toBe(201);
    expect(list.epoch).toBe(0);
  });

  it('the newest page again: new rows on top, the next older page after the last row held', () => {
    const held = mergeOlderAt(
      fromFirstPage(rows(1, 100)),
      rows(101, 100),
      100,
      0
    );
    const list = mergeNewest(held, rows(-2, 100));
    expect(list.rows.slice(0, 3).map((r) => r.signature)).toEqual([
      'sig-2',
      'sig-1',
      'sig0',
    ]);
    expect(list.rows).toHaveLength(203);
    expect(list.nextOffset).toBe(203);
  });

  it('starts over when more than a page arrived since, as a list of its own', () => {
    const held = fromFirstPage(rows(1, 100));
    expect(mergeNewest(held, rows(-500, 100))).toEqual(
      fromFirstPage(rows(-500, 100), 1)
    );
  });

  it('takes a short newest page for the whole list', () => {
    const held = mergeOlderAt(
      fromFirstPage(rows(1, 100)),
      rows(101, 100),
      100,
      0
    );
    expect(mergeNewest(held, rows(1, 40))).toEqual(
      fromFirstPage(rows(1, 40), 1)
    );
  });

  it('leaves out an older page read for the list before it started over', () => {
    // Show more read at 100 of the first list; meanwhile Refresh started over.
    const now = mergeNewest(fromFirstPage(rows(1, 100)), rows(-500, 100));
    expect(mergeOlderAt(now, rows(101, 100), 100, 0)).toBe(now);
  });

  it('leaves out an older page that no longer follows on, and keeps one that overlaps', () => {
    const held = fromFirstPage(rows(1, 100));
    // Read further down than the list reaches: a gap.
    expect(mergeOlderAt(held, rows(301, 100), 300, 0)).toBe(held);
    // Refresh put one new row on top (the next older one is at 101), while a
    // Show more read at 100 found the list's last row again first.
    const refreshed = mergeNewest(held, rows(0, 100));
    expect(refreshed.nextOffset).toBe(101);
    const list = mergeOlderAt(refreshed, rows(100, 100), 100, 0);
    expect(list.rows).toHaveLength(200);
    expect(list.rows[0].signature).toBe('sig0');
    expect(list.rows[199].signature).toBe('sig199');
    expect(list.nextOffset).toBe(200);
  });

  it('holds at most its newest 1,000, and then stops reading on', () => {
    const full: AccountTxList = {
      rows: rows(1, ACCOUNT_TX_MAX),
      nextOffset: ACCOUNT_TX_MAX,
      done: false,
      epoch: 0,
    };
    // Refresh at 1,000: the newest on top, the oldest goes.
    const refreshed = mergeNewest(full, rows(0, 100));
    expect(refreshed.rows).toHaveLength(ACCOUNT_TX_MAX);
    expect(refreshed.rows[0].signature).toBe('sig0');
    expect(refreshed.rows[ACCOUNT_TX_MAX - 1].signature).toBe('sig999');
    expect(refreshed.nextOffset).toBe(ACCOUNT_TX_MAX);
    expect(atCeiling(refreshed)).toBe(true);
    expect(canReadMore(refreshed)).toBe(false);
    // Show more past 1,000: cut at 1,000, with more on the node.
    const nearly: AccountTxList = {
      rows: rows(1, 950),
      nextOffset: 950,
      done: false,
      epoch: 0,
    };
    const more = mergeOlderAt(nearly, rows(951, 100), 950, 0);
    expect(more.rows).toHaveLength(ACCOUNT_TX_MAX);
    expect(more.nextOffset).toBe(ACCOUNT_TX_MAX);
    expect(more.done).toBe(false);
    expect(atCeiling(more)).toBe(true);
  });
});
