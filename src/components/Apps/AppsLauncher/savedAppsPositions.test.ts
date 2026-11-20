import { describe, expect, it } from 'vitest';
import {
  isPosition,
  longestIncreasingRun,
  positionBetween,
  positionsBetween,
  repositionList,
} from './savedAppsPositions';

const sorted = (values: string[]) => [...values].sort();

describe('positions', () => {
  it('places one between two others', () => {
    for (const [before, after] of [
      [null, null],
      [null, 'V'],
      ['V', null],
      ['V', 'W'],
      ['V', 'V1'],
      ['1', '2'],
      ['0V', '1'],
      ['z', null],
      ['zz', null],
      [null, '01'],
    ] as [string | null, string | null][]) {
      const middle = positionBetween(before, after);
      expect(isPosition(middle)).toBe(true);
      if (before) expect(middle > before).toBe(true);
      if (after) expect(middle < after).toBe(true);
    }
  });

  it('goes after the first when the two are out of order', () => {
    const position = positionBetween('W', 'V');
    expect(position > 'W').toBe(true);
  });

  it('keeps many positions short and in order', () => {
    const positions = positionsBetween(null, null, 500);
    expect(positions).toHaveLength(500);
    expect(new Set(positions).size).toBe(500);
    expect(sorted(positions)).toEqual(positions);
    expect(Math.max(...positions.map((position) => position.length))).toBe(2);
  });

  it('keeps room in front after many moves to the start', () => {
    let first = 'V';
    for (let move = 0; move < 300; move += 1) {
      const next = positionBetween(null, first);
      expect(next < first).toBe(true);
      expect(isPosition(next)).toBe(true);
      first = next;
    }
  });

  it('turns down what is not a position', () => {
    for (const value of ['', 'V0', 'a-b', 'é', 12, null, 'V'.repeat(1025)]) {
      expect(isPosition(value)).toBe(false);
    }
  });
});

describe('the longest increasing run', () => {
  it('finds the items that can stay', () => {
    expect([...longestIncreasingRun([0, 1, 2, 3])].sort()).toEqual([
      0, 1, 2, 3,
    ]);
    // One item moved to the front: the rest stay.
    expect([...longestIncreasingRun([3, 0, 1, 2])].sort()).toEqual([1, 2, 3]);
    expect(longestIncreasingRun([]).size).toBe(0);
  });
});

describe('a list put in a new order', () => {
  const positions = { a: '1', b: '2', c: '3', d: '4' } as Record<
    string,
    string
  >;
  const of = (key: string) => positions[key] ?? null;

  it('moves only the item that moved', () => {
    const moved = repositionList(['a', 'c', 'b', 'd'], of);
    expect(moved.size).toBe(1);
    const [[key, position]] = [...moved];
    // Either b or c moved; the order holds.
    const order = ['a', 'c', 'b', 'd'].map((item) =>
      item === key ? position : positions[item]
    );
    expect(sorted(order)).toEqual(order);
  });

  it('places new items between their neighbours', () => {
    const moved = repositionList(['a', 'new1', 'new2', 'b'], of);
    expect([...moved.keys()]).toEqual(['new1', 'new2']);
    const [first, second] = [moved.get('new1')!, moved.get('new2')!];
    expect('1' < first && first < second && second < '2').toBe(true);
  });

  it('changes nothing when the order is the same', () => {
    expect(repositionList(['a', 'b', 'c', 'd'], of).size).toBe(0);
  });

  it('keeps two items with one position in key order, and fits one between', () => {
    const tied = { a: 'V', b: 'X', c: 'X' } as Record<string, string>;
    const of = (key: string) => tied[key] ?? null;
    // In key order already: nothing moves.
    expect(repositionList(['a', 'b', 'c'], of).size).toBe(0);
    // Something new between the two: the second moves too.
    const moved = repositionList(['a', 'b', 'new', 'c'], of);
    const place = (key: string) => moved.get(key) ?? tied[key];
    const order = ['a', 'b', 'new', 'c'];
    expect(
      [...order].sort((x, y) =>
        place(x) === place(y) ? (x < y ? -1 : 1) : place(x) < place(y) ? -1 : 1
      )
    ).toEqual(order);
  });

  it('keeps equal positions in key order and places a damaged one', () => {
    const tied = { x: 'V', y: 'V', z: 'bad0' } as Record<string, string>;
    const moved = repositionList(['x', 'y', 'z'], (key) => tied[key]);
    // x and y sort by key at the same position: they stay.
    expect([...moved.keys()]).toEqual(['z']);
    expect(moved.get('z')! > 'V').toBe(true);
    // The other way round, one of them has to move.
    const swapped = repositionList(['y', 'x', 'z'], (key) => tied[key]);
    const place = (key: string) => swapped.get(key) ?? tied[key];
    const order = ['y', 'x', 'z'];
    expect(
      [...order].sort((a, b) =>
        place(a) === place(b) ? (a < b ? -1 : 1) : place(a) < place(b) ? -1 : 1
      )
    ).toEqual(order);
  });
});
