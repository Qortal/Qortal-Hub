import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
  HOME_WIDGETS_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import { homeDefaultGrid, homeWorkspaceCopyId } from './homeGrid';
import {
  HOME_LAYOUT_DEFAULT,
  HOME_LAYOUT_VERSION,
  HOME_STACK_PANEL_IDS,
  HOME_TOP_PANEL_IDS,
  type HomeLayout,
  HOME_WORKSPACE_COPY_LIMIT,
  completeHomeStack,
  homeLayoutGrid,
  homeLayoutStorageKey,
  isHomePanelShownNow,
  normalizeHomeLayout,
  normalizeHomeWorkspaces,
  readHomeLayout,
  sameHomeLayout,
  saveHomeLayout,
  useHomeLayout,
  withHomePanelShown,
  withHomeWorkspaceCopy,
  withoutHomeWorkspaceCopy,
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
        version: HOME_LAYOUT_VERSION,
      })
    ).toEqual({
      hidden: ['qortino', 'feed'],
      stack: ['feed', 'widgets', 'groupActivity'],
      version: HOME_LAYOUT_VERSION,
    });
  });

  it('falls back for anything that is not a layout', () => {
    expect(normalizeHomeLayout(null)).toEqual(HOME_LAYOUT_DEFAULT);
    expect(normalizeHomeLayout('x')).toEqual(HOME_LAYOUT_DEFAULT);
    const fallback = { hidden: ['wallet' as const], stack: [] };
    expect(normalizeHomeLayout({}, fallback).hidden).toEqual(['wallet']);
  });

  it('keeps a hidden panel from moving the shown ones', () => {
    // Quick Tools rose into the room the Workspace and Qortino left, and the
    // layout was saved.
    const grid = homeDefaultGrid().map((item) =>
      item.key === 'tools' ? { ...item, y: 0 } : item
    );
    const layout = normalizeHomeLayout({
      grid,
      hidden: ['workspace', 'qortino'],
      stack: ['widgets', 'groupActivity', 'feed'],
      version: HOME_LAYOUT_VERSION,
    });
    const at = (key: string) => layout.grid?.find((item) => item.key === key);
    expect(at('tools')).toMatchObject({ x: 0, y: 0 });
    // They keep their places, for when they're shown again.
    expect(at('workspace')).toMatchObject({ x: 0, y: 0, h: 23 });
    expect(at('qortino')).toMatchObject({ x: 0, y: 23, h: 23 });
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

describe('a layout from before the Workspace was a window of its own', () => {
  const STACK = ['widgets', 'groupActivity', 'feed'];
  // Qortino's window, the Workspace at its top, over Quick Tools.
  const BEFORE = [
    { key: 'qortino', x: 0, y: 0, w: 6, h: 46 },
    { key: 'tools', x: 0, y: 46, w: 6, h: 18 },
  ];
  const rectOf = (layout: { grid?: { key: string }[] }, key: string) =>
    layout.grid?.find((item) => item.key === key);

  it('hides the Workspace with Qortino, as Qortino’s switch did', () => {
    const older = normalizeHomeLayout({ hidden: ['qortino'], stack: STACK });
    expect(older.hidden).toEqual(['workspace', 'qortino']);
    expect(older.version).toBe(HOME_LAYOUT_VERSION);
    // A layout saved since: Qortino alone.
    const current = normalizeHomeLayout({
      hidden: ['qortino'],
      stack: STACK,
      version: HOME_LAYOUT_VERSION,
    });
    expect(current.hidden).toEqual(['qortino']);
  });

  it('gives the Workspace the top of Qortino’s window, where it was', () => {
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({ grid: BEFORE, hidden: ['qortino'], stack: STACK })
    );
    const layout = readHomeLayout(ALICE);
    expect(layout.hidden).toEqual(['workspace', 'qortino']);
    expect(rectOf(layout, 'workspace')).toMatchObject({ x: 0, y: 0, h: 23 });
    expect(rectOf(layout, 'qortino')).toMatchObject({ x: 0, y: 23, h: 23 });
    // Quick Tools shows at the top, as it did with Qortino hidden.
    expect(rectOf(layout, 'tools')).toMatchObject({ x: 0, y: 0, h: 18 });
  });

  it('saves what Home changes as it is: hiding Qortino keeps the Workspace', () => {
    saveHomeLayout(ALICE, { hidden: [], stack: [...STACK] as never });
    saveHomeLayout(
      ALICE,
      withHomePanelShown(readHomeLayout(ALICE), 'qortino', false)
    );
    expect(readHomeLayout(ALICE).hidden).toEqual(['qortino']);
    expect(
      JSON.parse(localStorage.getItem(homeLayoutStorageKey(ALICE)) ?? '{}')
        .version
    ).toBe(HOME_LAYOUT_VERSION);
  });
});

describe('copies of the Workspace', () => {
  const copyId = homeWorkspaceCopyId('k1');

  it('adds a copy right under the window duplicated, as big as it', () => {
    const layout = withHomeWorkspaceCopy(
      HOME_LAYOUT_DEFAULT,
      'workspace',
      'k1'
    );
    expect(layout.workspaces).toEqual(['k1']);
    const grid = homeLayoutGrid(layout);
    expect(grid.find((item) => item.key === copyId)).toEqual({
      key: copyId,
      x: 0,
      y: 23,
      w: 6,
      h: 23,
    });
    expect(grid.find((item) => item.key === 'qortino')).toMatchObject({
      y: 46,
    });
    // Saved and read back, it stays.
    saveHomeLayout(ALICE, layout);
    expect(sameHomeLayout(readHomeLayout(ALICE), layout)).toBe(true);
  });

  it('adds one only under the limit, with a key of its own', () => {
    let layout = HOME_LAYOUT_DEFAULT;
    for (let index = 0; index < HOME_WORKSPACE_COPY_LIMIT; index += 1) {
      layout = withHomeWorkspaceCopy(layout, 'workspace', `k${index}`);
    }
    expect(layout.workspaces).toHaveLength(HOME_WORKSPACE_COPY_LIMIT);
    expect(withHomeWorkspaceCopy(layout, 'workspace', 'more')).toBe(layout);
    const one = withHomeWorkspaceCopy(HOME_LAYOUT_DEFAULT, 'workspace', 'k1');
    expect(withHomeWorkspaceCopy(one, 'workspace', 'k1')).toBe(one);
    expect(
      withHomeWorkspaceCopy(HOME_LAYOUT_DEFAULT, 'workspace', 'not ok')
    ).toBe(HOME_LAYOUT_DEFAULT);
    // Without a key given, each gets a new one.
    const two = withHomeWorkspaceCopy(
      withHomeWorkspaceCopy(HOME_LAYOUT_DEFAULT, 'workspace'),
      'workspace'
    );
    expect(new Set(two.workspaces).size).toBe(2);
  });

  it('takes a copy off Home: the windows under it rise', () => {
    const layout = withHomeWorkspaceCopy(
      HOME_LAYOUT_DEFAULT,
      'workspace',
      'k1'
    );
    const removed = withoutHomeWorkspaceCopy(layout, copyId);
    expect(removed.workspaces).toBeUndefined();
    const grid = homeLayoutGrid(removed);
    expect(grid.find((item) => item.key === copyId)).toBeUndefined();
    expect(grid.find((item) => item.key === 'qortino')).toMatchObject({
      y: 23,
    });
  });

  it('drops what a layout lists badly, and a copy it does not list', () => {
    expect(
      normalizeHomeWorkspaces(['a', 'a', 'b c', 7, '', 'x'.repeat(40), 'b'])
    ).toEqual(['a', 'b']);
    expect(normalizeHomeWorkspaces('a')).toEqual([]);
    const layout = normalizeHomeLayout({
      grid: [...homeDefaultGrid(), { key: copyId, x: 0, y: 0, w: 6, h: 26 }],
      hidden: [],
      version: HOME_LAYOUT_VERSION,
    });
    expect(layout.workspaces).toBeUndefined();
    expect(layout.grid?.some((item) => item.key === copyId)).toBe(false);
  });

  it('puts a listed copy the arrangement lacks under everything', () => {
    const layout = normalizeHomeLayout({
      hidden: [],
      version: HOME_LAYOUT_VERSION,
      workspaces: ['k1'],
    });
    expect(homeLayoutGrid(layout).find((item) => item.key === copyId)).toEqual({
      key: copyId,
      x: 0,
      y: 147,
      w: 6,
      h: 23,
    });
    expect(sameHomeLayout(layout, HOME_LAYOUT_DEFAULT)).toBe(false);
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
      version: HOME_LAYOUT_VERSION,
    });
  });

  it('keeps each account to its own layout', () => {
    localStorage.setItem(HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY, 'false');
    saveHomeLayout(ALICE, { hidden: ['qortino'], stack: ['feed', 'widgets'] });

    expect(readHomeLayout(ALICE)).toEqual({
      hidden: ['qortino'],
      stack: ['feed', 'widgets', 'groupActivity'],
      version: HOME_LAYOUT_VERSION,
    });
    // Bob hasn't changed anything: he still starts from the PC's switches.
    expect(readHomeLayout(BOB)).toEqual({
      hidden: ['feed'],
      stack: ['widgets', 'groupActivity', 'feed'],
      version: HOME_LAYOUT_VERSION,
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

describe('while Getting started shows', () => {
  const HOME_PANEL_IDS = [...HOME_TOP_PANEL_IDS, ...HOME_STACK_PANEL_IDS];
  const shownNow = (layout: HomeLayout, gettingStarted: boolean) =>
    HOME_PANEL_IDS.filter((id) =>
      isHomePanelShownNow(layout, id, { gettingStarted })
    );

  it('lets the Workspace make way, and nothing else', () => {
    const layout = HOME_LAYOUT_DEFAULT;
    expect(shownNow(layout, false)).toEqual(HOME_PANEL_IDS);
    expect(shownNow(layout, true)).toEqual(
      HOME_PANEL_IDS.filter((id) => id !== 'workspace')
    );
    // Not in the layout: the Workspace comes back once it's done.
    expect(layout.hidden).toEqual([]);
  });

  it('keeps the Workspace when Qortino, and Getting started with him, is hidden', () => {
    const layout = withHomePanelShown(HOME_LAYOUT_DEFAULT, 'qortino', false);
    expect(
      isHomePanelShownNow(layout, 'workspace', { gettingStarted: true })
    ).toBe(true);
  });

  it('keeps a Workspace hidden in the layout hidden', () => {
    const layout = withHomePanelShown(HOME_LAYOUT_DEFAULT, 'workspace', false);
    for (const gettingStarted of [false, true]) {
      expect(isHomePanelShownNow(layout, 'workspace', { gettingStarted })).toBe(
        false
      );
    }
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
      version: HOME_LAYOUT_VERSION,
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
