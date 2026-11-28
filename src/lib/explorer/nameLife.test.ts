import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  NAME_LIFE_HOPS,
  NAME_LIFE_ROWS,
  nameLifeKey,
  nameLifeRead,
  walkNameLife,
  type NamePageReader,
} from './nameLife';
import type { NameData, TxRow } from './reads';

// A name's whole history, walked back from its record: through a purchase
// to the seller, through a rename to the earlier name, down to the
// registration its record gives; an owner read a page at a time only as
// far as it takes; GETs only.

const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;

function tx(
  type: string,
  height: number,
  by: string,
  fields: Partial<TxRow> = {}
): TxRow {
  return {
    type,
    signature: `${type}-${height}`,
    timestamp: 1_677_000_000_000 + height,
    txGroupId: 0,
    blockHeight: height,
    creatorAddress: by,
    ...fields,
  } as TxRow;
}

const REGISTER = tx('REGISTER_NAME', 100, SECOND, { name: 'Mapl' });
const RENAME = tx('UPDATE_NAME', 200, SECOND, {
  name: 'Mapl',
  newName: 'Maple',
});
const SELL = tx('SELL_NAME', 300, SECOND, { name: 'Maple', amount: '5' });
const BUY = tx('BUY_NAME', 400, PUBLISHER, {
  name: 'Maple',
  seller: SECOND,
  amount: '5',
});
const UPDATE = tx('UPDATE_NAME', 500, PUBLISHER, {
  name: 'Maple',
  newData: 'new',
});

const RECORD: NameData = {
  name: 'Maple',
  owner: PUBLISHER,
  registered: REGISTER.timestamp,
};

/** Each account's name transactions, newest first, served 100 a page. */
function pages(rowsOf: Record<string, TxRow[]>) {
  const asked: Array<{ address: string; offset: number }> = [];
  const read: NamePageReader = async (address, offset) => {
    asked.push({ address, offset });
    return (rowsOf[address] ?? []).slice(offset, offset + 100);
  };
  return { read, asked };
}

const signatures = (rows: TxRow[]) => rows.map((row) => row.signature);

describe('a name’s whole history', () => {
  it('walks back through a purchase and a rename to the registration', async () => {
    const node = pages({
      [PUBLISHER]: [UPDATE, BUY],
      [SECOND]: [BUY, SELL, RENAME, REGISTER],
    });
    const life = await walkNameLife(RECORD, node.read);
    expect(signatures(life.steps)).toEqual([
      UPDATE.signature,
      BUY.signature,
      SELL.signature,
      RENAME.signature,
      REGISTER.signature,
    ]);
    expect(life.owners).toEqual([PUBLISHER, SECOND]);
    expect(life.end).toEqual({
      kind: 'registered',
      tx: REGISTER,
      matches: true,
    });
    expect(life.name).toBe('Maple');
    expect(life.owner).toBe(PUBLISHER);
    // One read per owner: the rename stays with the same account.
    expect(node.asked).toEqual([
      { address: PUBLISHER, offset: 0 },
      { address: SECOND, offset: 0 },
    ]);
    expect(life.reads).toBe(2);
  });

  it('says when the registration found isn’t the one its record gives', async () => {
    const node = pages({
      [PUBLISHER]: [UPDATE, BUY],
      [SECOND]: [BUY, SELL, RENAME, REGISTER],
    });
    const life = await walkNameLife(
      { ...RECORD, registered: REGISTER.timestamp + 1 },
      node.read
    );
    expect(life.end).toMatchObject({ kind: 'registered', matches: false });
  });

  it('reads an owner’s older name transactions only while the newer ones don’t say how it got the name', async () => {
    const busy = Array.from({ length: 150 }, (_, i) =>
      tx('REGISTER_NAME', 10_000 - i, PUBLISHER, {
        name: `Spare ${i}`,
        signature: `spare-${i}`,
      })
    );
    const node = pages({
      [PUBLISHER]: [...busy, UPDATE, BUY],
      [SECOND]: [BUY, SELL, RENAME, REGISTER],
    });
    const life = await walkNameLife(RECORD, node.read);
    expect(life.end).toMatchObject({ kind: 'registered' });
    expect(node.asked).toEqual([
      { address: PUBLISHER, offset: 0 },
      { address: PUBLISHER, offset: 100 },
      { address: SECOND, offset: 0 },
    ]);
  });

  it('stops at its most of one account’s name transactions, and says it was cut there', async () => {
    const endless = Array.from({ length: 1_500 }, (_, i) =>
      tx('REGISTER_NAME', 100_000 - i, PUBLISHER, {
        name: `Spare ${i}`,
        signature: `spare-${i}`,
      })
    );
    const node = pages({ [PUBLISHER]: endless });
    const life = await walkNameLife(RECORD, node.read);
    expect(life.end).toEqual({ kind: 'cut', at: PUBLISHER, why: 'capped' });
    expect(node.asked).toHaveLength(NAME_LIFE_ROWS / 100);
    expect(node.asked[node.asked.length - 1]).toEqual({
      address: PUBLISHER,
      offset: 900,
    });
  });

  it('stops where an owner’s transactions end without saying how it got the name', async () => {
    const node = pages({ [PUBLISHER]: [UPDATE] });
    const life = await walkNameLife(RECORD, node.read);
    expect(life.end).toEqual({ kind: 'cut', at: PUBLISHER, why: 'notFound' });
    expect(signatures(life.steps)).toEqual([UPDATE.signature]);
  });

  it('reads no further when an owner’s rows don’t fit together', async () => {
    // A sale of the name by Publisher, with nothing newer saying it got it back.
    const sold = tx('BUY_NAME', 450, SECOND, {
      name: 'Maple',
      seller: PUBLISHER,
    });
    const full = Array.from({ length: 99 }, (_, i) =>
      tx('REGISTER_NAME', 10_000 - i, PUBLISHER, {
        name: `Spare ${i}`,
        signature: `spare-${i}`,
      })
    );
    const node = pages({ [PUBLISHER]: [...full, sold, UPDATE, BUY] });
    const life = await walkNameLife(RECORD, node.read);
    expect(life.end).toEqual({ kind: 'cut', at: PUBLISHER, why: 'notFound' });
    expect(node.asked).toEqual([{ address: PUBLISHER, offset: 0 }]);
  });

  it('goes back through at most its most owners and names, reading each account once', async () => {
    // A name passed back and forth between two accounts, more often than it reads.
    const rowsOf: Record<string, TxRow[]> = { [PUBLISHER]: [], [SECOND]: [] };
    for (let n = NAME_LIFE_HOPS + 3; n > 0; n -= 1) {
      const buyer = n % 2 ? PUBLISHER : SECOND;
      const seller = n % 2 ? SECOND : PUBLISHER;
      const buy = tx('BUY_NAME', n * 10, buyer, {
        name: 'Maple',
        seller,
        signature: `buy-${n}`,
      });
      rowsOf[buyer].push(buy);
      rowsOf[seller].push(buy);
    }
    const node = pages(rowsOf);
    const life = await walkNameLife(RECORD, node.read);
    expect(life.end).toMatchObject({ kind: 'cut', why: 'hops' });
    expect(life.steps).toHaveLength(NAME_LIFE_HOPS);
    expect(new Set(life.owners).size).toBe(2);
    // Met again, an account goes on from what was read of it.
    expect(node.asked).toEqual([
      { address: PUBLISHER, offset: 0 },
      { address: SECOND, offset: 0 },
    ]);
  });

  it('takes a row repeated on the next page (the list grew while it was read) once', async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      tx('REGISTER_NAME', 10_000 - i, PUBLISHER, {
        name: `Spare ${i}`,
        signature: `spare-${i}`,
      })
    );
    const read: NamePageReader = async (address, offset) => {
      if (address === SECOND) return [BUY, SELL, RENAME, REGISTER];
      // One new transaction arrived: the second page starts one row earlier.
      return offset === 0 ? first : [first[99], UPDATE, UPDATE, BUY];
    };
    const life = await walkNameLife(RECORD, read);
    expect(signatures(life.steps)).toEqual([
      UPDATE.signature,
      BUY.signature,
      SELL.signature,
      RENAME.signature,
      REGISTER.signature,
    ]);
  });
});

describe('the read of a name’s whole history', () => {
  type Answer = { status?: number; body: unknown };
  let answer: (path: string) => Answer;
  let calls: Array<{ method: string; path: string }> = [];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).slice('http://node.test'.length);
        calls.push({ method: init?.method ?? 'GET', path });
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

  it('is null when no one has the name now, and reads nothing more', async () => {
    answer = () => ({ body: [] });
    const life = await nameLifeRead('Gone', async () => null).load();
    expect(life).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reads each owner’s name transactions from the node, 100 at a time, GETs only', async () => {
    answer = (path) => {
      const query = new URLSearchParams(path.split('?')[1]);
      return {
        body: query.get('address') === PUBLISHER ? [UPDATE, BUY] : [],
      };
    };
    const life = await nameLifeRead('Maple', async () => RECORD).load();
    expect(life?.end).toEqual({ kind: 'cut', at: SECOND, why: 'notFound' });
    expect(calls.map((call) => call.path)).toEqual([
      `/transactions/search?address=${PUBLISHER}&txType=REGISTER_NAME&txType=UPDATE_NAME&txType=SELL_NAME&txType=CANCEL_SELL_NAME&txType=BUY_NAME&confirmationStatus=CONFIRMED&limit=100&offset=0&reverse=true`,
      `/transactions/search?address=${SECOND}&txType=REGISTER_NAME&txType=UPDATE_NAME&txType=SELL_NAME&txType=CANCEL_SELL_NAME&txType=BUY_NAME&confirmationStatus=CONFIRMED&limit=100&offset=0&reverse=true`,
    ]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('is kept under the name as asked, so its Refresh forgets it', () => {
    expect(nameLifeKey('Maple')).toBe('namelife:Maple');
    expect(nameLifeRead('Maple', async () => null).key.endsWith(':Maple')).toBe(
      true
    );
  });
});
