import { describe, expect, it } from 'vitest';
import {
  type DropArea,
  type DropTile,
  getLauncherDrop,
  sameLauncherDrop,
} from './launcherDrop';
import { folderItemKey } from './launcherItems';

// A row of three tiles, 100 wide with 10 between them, then a folder tile.
// Below it, the open folder with two apps.
const tile = (
  key: string,
  left: number,
  top = 0,
  folderId: string | null = null
): DropTile => ({
  key,
  rect: { left, top, width: 100, height: 100 },
  folderId,
});

const FOLDER = folderItemKey('f1');
const tiles: DropTile[] = [
  tile('mail', 0),
  tile('tube', 110),
  tile('blog', 220),
  tile(FOLDER, 330),
  tile('trade', 20, 150, 'f1'),
  tile('wallets', 130, 150, 'f1'),
];
const areas: DropArea[] = [
  { folderId: null, rect: { left: 0, top: 0, width: 800, height: 110 } },
  { folderId: 'f1', rect: { left: 0, top: 130, width: 800, height: 140 } },
];

const at = (x: number, y: number, activeKey = 'blog') =>
  getLauncherDrop({ x, y }, activeKey, tiles, areas);

describe('getLauncherDrop', () => {
  it('drops onto the middle of an app in the row', () => {
    expect(at(50, 50)).toEqual({ kind: 'merge', key: 'mail' });
    expect(at(30, 50)).toEqual({ kind: 'merge', key: 'mail' });
  });

  it('drops next to an app on its edges', () => {
    expect(at(10, 50)).toEqual({ kind: 'insert', key: 'mail', side: 'before' });
    expect(at(90, 50)).toEqual({ kind: 'insert', key: 'mail', side: 'after' });
  });

  it('drops into a folder on the middle of its tile, next to it on its edges', () => {
    expect(at(380, 50)).toEqual({ kind: 'merge', key: FOLDER });
    expect(at(335, 50)).toEqual({
      kind: 'insert',
      key: FOLDER,
      side: 'before',
    });
  });

  it('only drops next to an app inside an open folder', () => {
    expect(at(70, 200)).toEqual({
      kind: 'insert',
      key: 'trade',
      side: 'after',
    });
    expect(at(60, 200)).toEqual({
      kind: 'insert',
      key: 'trade',
      side: 'before',
    });
  });

  it('takes the nearest tile between two tiles', () => {
    expect(at(104, 50)).toEqual({ kind: 'insert', key: 'mail', side: 'after' });
    expect(at(107, 50)).toEqual({
      kind: 'insert',
      key: 'tube',
      side: 'before',
    });
  });

  it('goes after the last tile in the free space of the row', () => {
    expect(at(700, 50, 'mail')).toEqual({
      kind: 'insert',
      key: FOLDER,
      side: 'after',
    });
  });

  it('goes to the end of an open folder in its free space', () => {
    expect(at(600, 200)).toEqual({
      kind: 'insert',
      key: 'wallets',
      side: 'after',
    });
  });

  it('adds to an open folder that shows no other tile', () => {
    const onlyOne = tiles.filter(
      (t) => t.folderId === null || t.key === 'trade'
    );
    expect(
      getLauncherDrop({ x: 600, y: 200 }, 'trade', onlyOne, areas)
    ).toEqual({ kind: 'append', folderId: 'f1' });
  });

  it('never targets the dragged tile itself', () => {
    expect(at(270, 50, 'blog')).toEqual({
      kind: 'insert',
      key: 'tube',
      side: 'after',
    });
  });

  it('lets a folder only move along the row', () => {
    expect(at(50, 50, FOLDER)).toEqual({
      kind: 'insert',
      key: 'mail',
      side: 'after',
    });
    expect(at(40, 50, FOLDER)).toEqual({
      kind: 'insert',
      key: 'mail',
      side: 'before',
    });
    expect(at(70, 200, FOLDER)).toBeNull();
    expect(at(600, 200, FOLDER)).toBeNull();
  });

  it('lets a private app only move along the row, and takes nothing onto it', () => {
    const withPrivate = tiles.map((entry) =>
      entry.key === 'tube' ? { ...entry, staysInRow: true } : entry
    );
    const drop = (x: number, y: number, activeKey: string) =>
      getLauncherDrop({ x, y }, activeKey, withPrivate, areas);

    // The private app is dragged: no folder takes it.
    expect(drop(50, 50, 'tube')).toEqual({
      kind: 'insert',
      key: 'mail',
      side: 'after',
    });
    expect(drop(380, 50, 'tube')).toEqual({
      kind: 'insert',
      key: FOLDER,
      side: 'after',
    });
    expect(drop(70, 200, 'tube')).toBeNull();
    expect(drop(600, 200, 'tube')).toBeNull();

    // Another tile is dragged over it: it only goes next to it.
    expect(drop(160, 50, 'mail')).toEqual({
      kind: 'insert',
      key: 'tube',
      side: 'after',
    });
    expect(drop(150, 50, 'mail')).toEqual({
      kind: 'insert',
      key: 'tube',
      side: 'before',
    });
  });

  it('has no target outside the areas', () => {
    expect(at(50, 400)).toBeNull();
    expect(at(-50, 50)).toBeNull();
  });
});

describe('sameLauncherDrop', () => {
  it('compares two targets', () => {
    expect(sameLauncherDrop(null, null)).toBe(true);
    expect(sameLauncherDrop(null, { kind: 'merge', key: 'a' })).toBe(false);
    expect(
      sameLauncherDrop({ kind: 'merge', key: 'a' }, { kind: 'merge', key: 'a' })
    ).toBe(true);
    expect(
      sameLauncherDrop(
        { kind: 'insert', key: 'a', side: 'before' },
        { kind: 'insert', key: 'a', side: 'after' }
      )
    ).toBe(false);
    expect(
      sameLauncherDrop(
        { kind: 'append', folderId: null },
        { kind: 'append', folderId: 'f1' }
      )
    ).toBe(false);
    expect(
      sameLauncherDrop(
        { kind: 'merge', key: 'a' },
        { kind: 'insert', key: 'a', side: 'before' }
      )
    ).toBe(false);
  });
});
