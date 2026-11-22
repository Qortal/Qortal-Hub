import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  ACCOUNT_HISTORY_MAX,
  ACCOUNT_TX_MAX,
  ACCOUNT_TX_PAGE,
  accountTxKey,
  atCeiling,
  canReadMore,
  canReadOn,
  fromFirstPage,
  historyAtCeiling,
  listedPart,
  maxOf,
  mergeChecked,
  mergeNewest,
  mergeOlderAt,
  moreShown,
  needsCheck,
  readTxPage,
  shownCount,
  SHOWN_STEP,
  withCeiling,
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

describe('a whole history, asked for', () => {
  const held: AccountTxList = {
    rows: rows(1, ACCOUNT_TX_MAX),
    nextOffset: ACCOUNT_TX_MAX,
    done: false,
    epoch: 0,
  };

  it('raises the list’s own ceiling, never past 20,000 and never lower', () => {
    expect(maxOf(held)).toBe(ACCOUNT_TX_MAX);
    const raised = withCeiling(held, 5000);
    expect(maxOf(raised)).toBe(5000);
    expect(maxOf(withCeiling(held, 1_000_000))).toBe(ACCOUNT_HISTORY_MAX);
    expect(withCeiling(raised, 2000)).toBe(raised);
    expect(withCeiling(held, 500)).toBe(held);
  });

  it('reads on up to its own ceiling while the tabs stop at 1,000', () => {
    const raised = withCeiling(held, 5000);
    expect(canReadMore(raised)).toBe(false);
    expect(canReadOn(raised)).toBe(true);
    expect(canReadOn(held)).toBe(false);
    const more = mergeOlderAt(raised, rows(1001, 100), 1000, 0);
    expect(more.rows).toHaveLength(1100);
    expect(maxOf(more)).toBe(5000);
  });

  it('keeps its ceiling through Refresh, and when it starts over', () => {
    const raised = mergeOlderAt(
      withCeiling(held, 5000),
      rows(1001, 100),
      1000,
      0
    );
    const refreshed = mergeNewest(raised, rows(0, 100));
    expect(refreshed.rows).toHaveLength(1101);
    expect(maxOf(refreshed)).toBe(5000);
    expect(maxOf(mergeNewest(raised, rows(-900, 100)))).toBe(5000);
    expect(maxOf(mergeNewest(raised, rows(1, 40)))).toBe(5000);
  });

  it('reads on by the rows it holds, not by offsets a transaction arriving meanwhile moved on', () => {
    // A page read twice after one arrived at the top: 999 held, though the
    // next offset is 1,000.
    const shifted: AccountTxList = {
      rows: rows(1, ACCOUNT_TX_MAX - 1),
      nextOffset: ACCOUNT_TX_MAX,
      done: false,
      epoch: 0,
      max: ACCOUNT_TX_MAX,
    };
    expect(canReadOn(shifted)).toBe(true);
    const read = mergeOlderAt(shifted, rows(1000, 100), ACCOUNT_TX_MAX, 0);
    expect(read.rows).toHaveLength(ACCOUNT_TX_MAX);
    expect(canReadOn(read)).toBe(false);
    // What was cut is more than it holds: it is known to be longer.
    expect(read.longer).toBe(true);
  });

  it('stops at the Explorer’s most only when a read showed more, and says so', () => {
    const top: AccountTxList = {
      rows: rows(1, ACCOUNT_HISTORY_MAX),
      nextOffset: ACCOUNT_HISTORY_MAX,
      done: false,
      epoch: 0,
      max: ACCOUNT_HISTORY_MAX,
    };
    // Whether there are more isn't known: one row says.
    expect(needsCheck(top)).toBe(true);
    expect(canReadOn(top)).toBe(true);
    expect(historyAtCeiling(top)).toBe(false);
    // A row it doesn't hold: longer than the Explorer reads.
    const longer = mergeChecked(top, [row(30_000)], ACCOUNT_HISTORY_MAX, 0);
    expect(longer.longer).toBe(true);
    expect(canReadOn(longer)).toBe(false);
    expect(historyAtCeiling(longer)).toBe(true);
    expect(historyAtCeiling({ ...longer, done: true })).toBe(false);
    // None: exactly that many, its whole history.
    const exactly = mergeChecked(top, [], ACCOUNT_HISTORY_MAX, 0);
    expect(exactly.done).toBe(true);
    expect(historyAtCeiling(exactly)).toBe(false);
    expect(canReadOn(exactly)).toBe(false);
    // One it holds (one arrived at the top since): the next check reads one further.
    const moved = mergeChecked(
      top,
      [row(ACCOUNT_HISTORY_MAX)],
      top.nextOffset,
      0
    );
    expect(moved.nextOffset).toBe(ACCOUNT_HISTORY_MAX + 1);
    expect(needsCheck(moved)).toBe(true);
    // A check read for another list, or from elsewhere, is left out.
    expect(mergeChecked(top, [], ACCOUNT_HISTORY_MAX, 1)).toBe(top);
    expect(mergeChecked(top, [], ACCOUNT_HISTORY_MAX - 1, 0)).toBe(top);
    // A Refresh past the most cuts the oldest: known to be longer.
    const refreshed = mergeNewest(top, rows(-50, 100));
    expect(refreshed.rows).toHaveLength(ACCOUNT_HISTORY_MAX);
    expect(historyAtCeiling(refreshed)).toBe(true);
  });

  it('a history of exactly the Explorer’s most is never said to be longer without a read that shows more', () => {
    // 20,000 transactions, read in full pages of 100 after Read the rest:
    // its 201st page would be empty.
    const page = (offset: number) => rows(offset, ACCOUNT_TX_PAGE);
    let list = withCeiling(fromFirstPage(page(0)), ACCOUNT_HISTORY_MAX);
    for (
      let offset = ACCOUNT_TX_PAGE;
      offset < ACCOUNT_HISTORY_MAX;
      offset += ACCOUNT_TX_PAGE
    )
      list = mergeOlderAt(list, page(offset), offset, list.epoch);
    expect(list.rows).toHaveLength(ACCOUNT_HISTORY_MAX);
    // It reads one more row to know, and doesn't claim the node has more.
    expect(historyAtCeiling(list)).toBe(false);
    expect(canReadOn(list)).toBe(true);
    expect(mergeChecked(list, [], list.nextOffset, list.epoch).done).toBe(true);
  });

  it('reads one row to check, a page otherwise', async () => {
    answer = () => ({ body: [] });
    await readTxPage(ADDRESS, [], ACCOUNT_HISTORY_MAX, 1);
    await readTxPage(ADDRESS, [], 0);
    expect(
      paths.map((path) => new URLSearchParams(path.split('?')[1]).get('limit'))
    ).toEqual(['1', '100']);
  });

  it('lets a tab list its newest 1,000, and never call them all when more were read', () => {
    const raised = mergeOlderAt(
      withCeiling(held, 5000),
      rows(1001, 40),
      1000,
      0
    );
    expect(raised.done).toBe(true);
    const part = listedPart(raised);
    expect(part.rows).toHaveLength(ACCOUNT_TX_MAX);
    expect(part.beyond).toBe(40);
    expect(part.all).toBe(false);
    const small = fromFirstPage(rows(1, 7));
    expect(listedPart(small)).toEqual({
      rows: small.rows,
      all: true,
      beyond: 0,
    });
  });
});

describe('how many a tab shows', () => {
  const held = rows(1, 1000);

  it('shows the first 100 of what is held until more is asked for', () => {
    expect(SHOWN_STEP).toBe(100);
    expect(shownCount(held, undefined)).toBe(100);
    expect(shownCount(rows(1, 40), undefined)).toBe(40);
  });

  it('shows the next 100 held without a read, and reads only once all held are shown', () => {
    const first = moreShown(held, undefined);
    expect(first).toEqual({ next: { count: 200, top: 'sig1' }, read: false });
    expect(shownCount(held, first.next)).toBe(200);
    const end = { count: 1000, top: 'sig1' };
    expect(shownCount(held, end)).toBe(1000);
    expect(moreShown(held, end)).toEqual({
      next: { count: 1100, top: 'sig1' },
      read: true,
    });
    // A read that failed, asked again: still 100 more than are held.
    expect(moreShown(held, { count: 1100, top: 'sig1' }).next.count).toBe(1100);
  });

  it('keeps on screen what was shown when a Refresh puts rows above it', () => {
    const kept = { count: 200, top: 'sig1' };
    const refreshed = [row(-1), row(0), ...held];
    expect(shownCount(refreshed, kept)).toBe(202);
    // The list started over: counted from its new top.
    expect(shownCount(rows(5000, 300), kept)).toBe(200);
  });
});
