import { describe, expect, it } from 'vitest';
import {
  CHAIN_NOW,
  historyByName,
  isNameSort,
  NAME_TX_TYPES,
  namesWithNotes,
  ownerSpan,
  pastNameNow,
  pastNames,
  positionOf,
  sortNames,
  unchangedSince,
} from './names';
import type { TxRow } from './reads';

const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;

function tx(type: string, height: number, fields: Partial<TxRow> = {}): TxRow {
  return {
    type,
    signature: `${type}-${height}`,
    timestamp: 1_700_000_000_000 + height * 60_000,
    txGroupId: 0,
    blockHeight: height,
    creatorAddress: PUBLISHER,
    ...fields,
  } as TxRow;
}

const signatures = (rows: TxRow[]) => rows.map((row) => row.signature);

describe('the name transactions', () => {
  it('are the Transactions tab’s Names kind: Core’s five', () => {
    expect([...NAME_TX_TYPES]).toEqual([
      'REGISTER_NAME',
      'UPDATE_NAME',
      'SELL_NAME',
      'CANCEL_SELL_NAME',
      'BUY_NAME',
    ]);
  });
});

describe('each name’s history', () => {
  it('belongs a rename to both its old and its new name, newest first', () => {
    const rename = tx('UPDATE_NAME', 30, { name: 'Mapl', newName: 'Maple' });
    const register = tx('REGISTER_NAME', 10, { name: 'Mapl' });
    const update = tx('UPDATE_NAME', 40, { name: 'Maple', newData: 'x' });
    const byName = historyByName([update, rename, register]);
    expect(signatures(byName.get('Maple') ?? [])).toEqual([
      'UPDATE_NAME-40',
      'UPDATE_NAME-30',
    ]);
    expect(signatures(byName.get('Mapl') ?? [])).toEqual([
      'UPDATE_NAME-30',
      'REGISTER_NAME-10',
    ]);
    // An update that keeps the name belongs to it once.
    const same = tx('UPDATE_NAME', 50, { name: 'Oak', newName: 'Oak' });
    expect(historyByName([same]).get('Oak')).toHaveLength(1);
  });

  it('lists the names it had, the most recently touched first', () => {
    const byName = historyByName([
      tx('BUY_NAME', 60, {
        name: 'Sold',
        seller: PUBLISHER,
        creatorAddress: SECOND,
      }),
      tx('UPDATE_NAME', 50, { name: 'Old', newName: 'Kept' }),
      tx('REGISTER_NAME', 20, { name: 'Old' }),
      tx('REGISTER_NAME', 10, { name: 'Sold' }),
    ]);
    expect(pastNames(byName, ['Kept'])).toEqual(['Sold', 'Old']);
  });

  it('knows a name unchanged since its registration only from a list read in full', () => {
    const register = tx('REGISTER_NAME', 1, { name: 'Oak' });
    expect(unchangedSince([register], false)).toBe(true);
    expect(
      unchangedSince([tx('UPDATE_NAME', 2, { name: 'Oak' }), register], false)
    ).toBe(false);
    expect(unchangedSince([tx('BUY_NAME', 2, { name: 'Oak' })], false)).toBe(
      false
    );
    // Not known: a read that stopped short, one still loading, or none found.
    expect(unchangedSince([register], true)).toBe(false);
    expect(unchangedSince(undefined, false)).toBe(false);
    expect(unchangedSince([], false)).toBe(false);
  });
});

describe('what a name it had is now', () => {
  const had = [
    tx('UPDATE_NAME', 200, { name: 'Old', newName: 'New' }),
    tx('REGISTER_NAME', 100, { name: 'Old' }),
  ];

  it('is no one’s when the node has no record of it', () => {
    expect(pastNameNow('Old', null, had)).toEqual({ kind: 'nobody' });
  });

  it('is another registration when the record was registered after it last had it', () => {
    expect(
      pastNameNow(
        'Old',
        {
          name: '0ld',
          owner: SECOND,
          registered: had[0].timestamp + 1,
        },
        had
      )
    ).toEqual({ kind: 'registeredAgain', name: '0ld', owner: SECOND });
  });

  it('is the same name spelled anew when the node matched another spelling of its registration', () => {
    const rename = [
      tx('UPDATE_NAME', 200, { name: 'maple', newName: 'Maple' }),
      tx('REGISTER_NAME', 100, { name: 'maple' }),
    ];
    expect(
      pastNameNow(
        'maple',
        {
          name: 'Maple',
          owner: PUBLISHER,
          registered: rename[1].timestamp,
        },
        rename
      )
    ).toEqual({ kind: 'respelled', name: 'Maple', owner: PUBLISHER });
  });

  it('is its owner’s now when the node has the same name', () => {
    const sold = [
      tx('BUY_NAME', 300, {
        name: 'Oak',
        seller: PUBLISHER,
        creatorAddress: SECOND,
      }),
    ];
    expect(
      pastNameNow(
        'Oak',
        { name: 'Oak', owner: SECOND, registered: sold[0].timestamp - 1 },
        sold
      )
    ).toEqual({ kind: 'owned', owner: SECOND });
    // A record that doesn't say when it was registered is taken as the same registration.
    expect(pastNameNow('Oak', { name: 'Oak', owner: SECOND }, sold)).toEqual({
      kind: 'owned',
      owner: SECOND,
    });
  });
});

describe('the orders of the Names tab', () => {
  const names = ['beta', 'Alpha', 'gamma', 'item 10', 'item 9'];

  it('puts the primary name first, then Core’s order', () => {
    expect(sortNames(names, 'primary', 'gamma', null)).toEqual([
      'gamma',
      'beta',
      'Alpha',
      'item 10',
      'item 9',
    ]);
    expect(sortNames(names, 'primary', null, null)).toEqual(names);
    expect(sortNames(names, 'primary', 'not one of them', null)).toEqual(names);
  });

  it('keeps or reverses Core’s order for oldest and newest registered', () => {
    expect(sortNames(names, 'oldest', 'gamma', null)).toEqual(names);
    expect(sortNames(names, 'newest', 'gamma', null)).toEqual(
      [...names].reverse()
    );
  });

  it('sorts A to Z and back, ignoring case, numbers as numbers', () => {
    expect(sortNames(names, 'az', null, null, 'en')).toEqual([
      'Alpha',
      'beta',
      'gamma',
      'item 9',
      'item 10',
    ]);
    expect(sortNames(names, 'za', null, null, 'en')).toEqual([
      'item 10',
      'item 9',
      'gamma',
      'beta',
      'Alpha',
    ]);
  });

  it('puts the most recently active name first; names with none read keep Core’s order', () => {
    const byName = new Map([
      [
        'gamma',
        [tx('UPDATE_NAME', 30, { name: 'gamma' }), tx('REGISTER_NAME', 5)],
      ],
      ['beta', [tx('UPDATE_NAME', 50, { name: 'beta' })]],
    ]);
    expect(sortNames(names, 'activity', null, byName)).toEqual([
      'beta',
      'gamma',
      'Alpha',
      'item 10',
      'item 9',
    ]);
    expect(sortNames(names, 'activity', null, null)).toEqual(names);
  });

  it('knows its own orders', () => {
    expect(isNameSort('az')).toBe(true);
    expect(isNameSort('size')).toBe(false);
    expect(isNameSort(undefined)).toBe(false);
  });

  it('never changes the list it is given', () => {
    const list = [...names];
    sortNames(list, 'newest', null, null);
    sortNames(list, 'az', null, null);
    expect(list).toEqual(names);
  });
});

describe('notes on its other names', () => {
  const LIKE_ADDRESS = `Q${'a'.repeat(30)}`;

  it('counts its names besides the primary one that have notes', () => {
    expect(
      namesWithNotes(
        { names: ['Plain', LIKE_ADDRESS, 'Other'], truncated: false },
        'Plain',
        PUBLISHER
      )
    ).toEqual({
      withNotes: 1,
      total: 2,
      besidePrimary: true,
      listed: false,
    });
  });

  it('leaves the primary name’s own notes to their own line', () => {
    expect(
      namesWithNotes(
        { names: [LIKE_ADDRESS, 'Plain'], truncated: false },
        LIKE_ADDRESS,
        PUBLISHER
      )
    ).toBeNull();
  });

  it('counts every name when it has no primary one, and says when the list was cut', () => {
    expect(
      namesWithNotes(
        { names: [LIKE_ADDRESS, 'Plain'], truncated: true },
        null,
        PUBLISHER
      )
    ).toEqual({
      withNotes: 1,
      total: 2,
      besidePrimary: false,
      listed: true,
    });
  });

  it('says nothing while whether it has a primary name isn’t known', () => {
    expect(
      namesWithNotes(
        { names: [LIKE_ADDRESS, 'Plain'], truncated: false },
        undefined,
        PUBLISHER
      )
    ).toBeNull();
  });
});

describe('one step back in a name’s life', () => {
  it('goes back to the registration, with what was done in between', () => {
    const rows = [
      tx('UPDATE_NAME', 30, { name: 'Maple', newData: 'new' }),
      tx('SELL_NAME', 20, { name: 'Maple', amount: '5' }),
      tx('CANCEL_SELL_NAME', 25, { name: 'Maple' }),
      tx('REGISTER_NAME', 10, { name: 'Maple' }),
      tx('REGISTER_NAME', 5, { name: 'Other' }),
    ];
    const span = ownerSpan(rows, PUBLISHER, 'Maple', CHAIN_NOW);
    expect(signatures(span.steps)).toEqual([
      'UPDATE_NAME-30',
      'CANCEL_SELL_NAME-25',
      'SELL_NAME-20',
      'REGISTER_NAME-10',
    ]);
    expect(span.got).toMatchObject({ kind: 'registered' });
  });

  it('stops at a purchase, naming the seller, and leaves out what came at or after the point given', () => {
    const buy = tx('BUY_NAME', 40, {
      name: 'Maple',
      seller: SECOND,
      amount: '5',
    });
    const rows = [tx('UPDATE_NAME', 50, { name: 'Maple', newData: 'x' }), buy];
    expect(ownerSpan(rows, PUBLISHER, 'Maple', CHAIN_NOW).got).toEqual({
      kind: 'bought',
      tx: buy,
      seller: SECOND,
    });
    const span = ownerSpan(rows, PUBLISHER, 'Maple', positionOf(rows[0]));
    expect(signatures(span.steps)).toEqual(['BUY_NAME-40']);
  });

  it('follows a rename back to the earlier name', () => {
    const rename = tx('UPDATE_NAME', 40, { name: 'Mapl', newName: 'Maple' });
    expect(ownerSpan([rename], PUBLISHER, 'Maple', CHAIN_NOW).got).toEqual({
      kind: 'renamed',
      tx: rename,
      from: 'Mapl',
    });
  });

  it('tells rows that don’t fit together from rows that end before saying how it got the name', () => {
    // Second bought it from Publisher, and nothing shows Publisher got it again since.
    const sold = tx('BUY_NAME', 40, {
      name: 'Maple',
      seller: PUBLISHER,
      creatorAddress: SECOND,
    });
    expect(ownerSpan([sold], PUBLISHER, 'Maple', CHAIN_NOW).got).toEqual({
      kind: 'mismatch',
    });
    // Renamed away before it was got.
    const away = tx('UPDATE_NAME', 40, { name: 'Maple', newName: 'Birch' });
    expect(ownerSpan([away], PUBLISHER, 'Maple', CHAIN_NOW)).toEqual({
      steps: [],
      got: { kind: 'mismatch' },
    });
    // Nothing about it: older rows may say.
    expect(ownerSpan([], PUBLISHER, 'Maple', CHAIN_NOW).got).toEqual({
      kind: 'notFound',
    });
    expect(
      ownerSpan(
        [tx('UPDATE_NAME', 40, { name: 'Maple', newData: 'x' })],
        PUBLISHER,
        'Maple',
        CHAIN_NOW
      ).got
    ).toEqual({ kind: 'notFound' });
  });

  it('orders by block, then by time within a block', () => {
    const early = tx('UPDATE_NAME', 40, {
      name: 'Maple',
      timestamp: 1,
      signature: 'early',
    });
    const late = tx('UPDATE_NAME', 40, {
      name: 'Maple',
      timestamp: 2,
      signature: 'late',
    });
    const register = tx('REGISTER_NAME', 39, { name: 'Maple' });
    expect(
      signatures(
        ownerSpan([early, register, late], PUBLISHER, 'Maple', CHAIN_NOW).steps
      )
    ).toEqual(['late', 'early', 'REGISTER_NAME-39']);
  });
});
