import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
  HOME_WIDGETS_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import { homeDefaultGrid } from './homeGrid';
import {
  HOME_LAYOUT_DEFAULT,
  completeHomeStack,
  homeLayoutGrid,
  homeLayoutStorageKey,
  normalizeHomeLayout,
  readHomeLayout,
  sameHomeLayout,
  saveHomeLayout,
  useHomeLayout,
  withHomePanelShown,
} from './homeLayout';

const ALICE = 'QaliceAddress00000000000000000000';
const BOB = 'QbobAddress0000000000000000000000';

afterEach(() => {
  localStorage.clear();
});

describe('normalizeHomeLayout', () => {
  it('keeps known panels only, once each, in a fixed order', () => {
    expect(
      normalizeHomeLayout({
        hidden: ['feed', 'nope', 'qortino', 'feed', 7],
        stack: ['feed', 'widgets', 'groupActivity'],
      })
    ).toEqual({
      hidden: ['qortino', 'feed'],
      stack: ['feed', 'widgets', 'groupActivity'],
    });
  });

  it('falls back for anything that is not a layout', () => {
    expect(normalizeHomeLayout(null)).toEqual(HOME_LAYOUT_DEFAULT);
    expect(normalizeHomeLayout('x')).toEqual(HOME_LAYOUT_DEFAULT);
    const fallback = { hidden: ['wallet' as const], stack: [] };
    expect(normalizeHomeLayout({}, fallback).hidden).toEqual(['wallet']);
  });

  it('puts a panel the stored order lacks back after its usual neighbour', () => {
    expect(completeHomeStack(['feed', 'widgets'])).toEqual([
      'feed',
      'widgets',
      'groupActivity',
    ]);
    expect(completeHomeStack(['groupActivity'])).toEqual([
      'widgets',
      'groupActivity',
      'feed',
    ]);
    expect(completeHomeStack(['feed', 'feed', 'x'])).toEqual([
      'widgets',
      'groupActivity',
      'feed',
    ]);
  });
});

describe('readHomeLayout', () => {
  it('starts an account from the switches kept for the whole PC', () => {
    localStorage.setItem(HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY, 'false');
    localStorage.setItem(HOME_WIDGETS_VISIBLE_STORAGE_KEY, 'true');
    localStorage.setItem(
      HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ heights: {}, order: ['quitter', 'groupActivity'] })
    );

    expect(readHomeLayout(ALICE)).toEqual({
      hidden: ['groupActivity'],
      stack: ['widgets', 'feed', 'groupActivity'],
    });
  });

  it('keeps each account to its own layout', () => {
    localStorage.setItem(HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY, 'false');
    saveHomeLayout(ALICE, { hidden: ['qortino'], stack: ['feed', 'widgets'] });

    expect(readHomeLayout(ALICE)).toEqual({
      hidden: ['qortino'],
      stack: ['feed', 'widgets', 'groupActivity'],
    });
    // Bob hasn't changed anything: he still starts from the PC's switches.
    expect(readHomeLayout(BOB)).toEqual({
      hidden: ['feed'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
    // Saving doesn't touch the PC-wide switches.
    expect(localStorage.getItem(HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY)).toBe(
      'false'
    );
  });

  it('ignores a damaged entry', () => {
    localStorage.setItem(homeLayoutStorageKey(ALICE), '{not json');
    expect(readHomeLayout(ALICE)).toEqual(HOME_LAYOUT_DEFAULT);
  });
});

describe('layout changes', () => {
  it('switches a panel off and on', () => {
    const off = withHomePanelShown(HOME_LAYOUT_DEFAULT, 'wallet', false);
    expect(off.hidden).toEqual(['wallet']);
    expect(withHomePanelShown(off, 'status', false).hidden).toEqual([
      'status',
      'wallet',
    ]);
    expect(withHomePanelShown(off, 'wallet', true).hidden).toEqual([]);
  });
});

describe('the arrangement', () => {
  const arranged = [{ key: 'feed', x: 0, y: 0, w: 24, h: 40 }];

  it('is the default grid, in the stack order, until the account arranges Home', () => {
    expect(homeLayoutGrid(HOME_LAYOUT_DEFAULT)).toEqual(homeDefaultGrid());
    const feedFirst = normalizeHomeLayout({
      stack: ['widgets', 'feed', 'groupActivity'],
    });
    expect(homeLayoutGrid(feedFirst)).toEqual(
      homeDefaultGrid(['widgets', 'feed', 'groupActivity'])
    );
  });

  it('is kept with the layout once arranged, and compared', () => {
    saveHomeLayout(ALICE, {
      ...HOME_LAYOUT_DEFAULT,
      grid: normalizeHomeLayout({ grid: arranged }).grid,
    });
    const layout = readHomeLayout(ALICE);
    const feed = homeLayoutGrid(layout).find((item) => item.key === 'feed');
    expect(feed).toEqual({ key: 'feed', x: 0, y: 0, w: 24, h: 40 });
    expect(sameHomeLayout(layout, HOME_LAYOUT_DEFAULT)).toBe(false);
    expect(sameHomeLayout(layout, readHomeLayout(ALICE))).toBe(true);
  });

  it('drops an arrangement that is not one', () => {
    expect(normalizeHomeLayout({ grid: 'x' }).grid).toBeUndefined();
    expect(
      normalizeHomeLayout({ grid: [{ key: 'nope' }] }).grid
    ).toBeUndefined();
  });
});

describe('useHomeLayout', () => {
  it('saves for the account and keeps every user of it in step', () => {
    const first = renderHook(() => useHomeLayout(ALICE));
    const second = renderHook(() => useHomeLayout(ALICE));
    const bob = renderHook(() => useHomeLayout(BOB));

    act(() => {
      first.result.current[1]((layout) =>
        withHomePanelShown(layout, 'featured', false)
      );
    });

    expect(second.result.current[0].hidden).toEqual(['featured']);
    expect(bob.result.current[0].hidden).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem(homeLayoutStorageKey(ALICE)) ?? '{}')
    ).toEqual({
      hidden: ['featured'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
  });

  it('saves nothing without an account', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useHomeLayout(undefined));
    act(() => {
      result.current[1]((layout) =>
        withHomePanelShown(layout, 'featured', false)
      );
    });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
