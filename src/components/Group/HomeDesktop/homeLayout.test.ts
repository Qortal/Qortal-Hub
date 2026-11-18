import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
  HOME_WIDGETS_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import {
  type HomeGridItem,
  type HomeWindowId,
  homeDefaultGrid,
  homeGridRowsFor,
  homeGridShown,
  homeWidgetWindowId,
  mergeHomeGrid,
  moveHomeWindow,
} from './homeGrid';
import {
  type HomeLayout,
  HOME_LAYOUT_DEFAULT,
  completeHomeStack,
  homeLayoutGrid,
  homeLayoutStorageKey,
  normalizeHomeLayout,
  readHomeLayout,
  sameHomeLayout,
  saveHomeLayout,
  useHomeLayout,
  withHomeGrid,
  withHomePanelShown,
  withHomeWidgetWindow,
  withHomeWidgetWindowHeight,
  withoutHomeWidgetWindow,
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

  it('keeps a hidden panel from moving the shown ones', () => {
    // Quick Tools rose into the room Qortino left, and the layout was saved.
    const grid = homeDefaultGrid().map((item) =>
      item.key === 'tools' ? { ...item, y: 0 } : item
    );
    const layout = normalizeHomeLayout({
      grid,
      hidden: ['qortino'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
    const at = (key: string) => layout.grid?.find((item) => item.key === key);
    expect(at('tools')).toMatchObject({ x: 0, y: 0 });
    // Qortino keeps its place, for when it's shown again.
    expect(at('qortino')).toMatchObject({ x: 0, y: 0, h: 43 });
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
      changedAt: expect.any(Number),
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

describe('the account card’s place', () => {
  const clock = { name: 'GO Clock', identifier: null };
  const clockId = homeWidgetWindowId(clock);
  /** Saved with the card at its measured 16 rows, Featured Q-Apps under it. */
  const shortCardGrid = (): HomeGridItem[] => [
    ...homeDefaultGrid().map((item) =>
      item.key === 'account'
        ? { ...item, h: 16 }
        : item.key === 'featured'
          ? { ...item, y: 16 }
          : item
    ),
    { key: clockId, x: 0, y: 147, w: 6, h: 27 },
  ];
  const storedGrid = (): HomeGridItem[] =>
    JSON.parse(localStorage.getItem(homeLayoutStorageKey(ALICE)) ?? '{}')
      .grid ?? [];
  const storedRect = (key: HomeWindowId) => {
    const item = storedGrid().find((entry) => entry.key === key);
    return item && [item.x, item.y, item.w, item.h];
  };

  it('is saved at least as tall as by default, from a copy taken in from QDN', () => {
    saveHomeLayout(
      ALICE,
      { ...HOME_LAYOUT_DEFAULT, grid: shortCardGrid(), widgetWindows: [clock] },
      { changedAt: 500 }
    );
    expect(storedRect('account')).toEqual([6, 0, 12, 20]);
    expect(storedRect('featured')).toEqual([6, 20, 12, 44]);
  });

  it('is saved at least as tall as by default when a widget asks for a height', () => {
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({
        ...HOME_LAYOUT_DEFAULT,
        grid: shortCardGrid(),
        widgetWindows: [clock],
      })
    );
    saveHomeLayout(
      ALICE,
      withHomeWidgetWindowHeight(readHomeLayout(ALICE), clockId, 300)
    );
    expect(storedRect(clockId)?.[3]).toBe(homeGridRowsFor(300));
    expect(storedRect('account')).toEqual([6, 0, 12, 20]);
    expect(storedRect('featured')).toEqual([6, 20, 12, 44]);
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
      changedAt: expect.any(Number),
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

describe('when the layout changed', () => {
  it('marks a change, and only a change, with its time', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    saveHomeLayout(ALICE, { hidden: ['qortino'], stack: [] });
    expect(readHomeLayout(ALICE).changedAt).toBe(1_000);

    now.mockReturnValue(2_000);
    saveHomeLayout(ALICE, readHomeLayout(ALICE));
    expect(readHomeLayout(ALICE).changedAt).toBe(1_000);

    saveHomeLayout(ALICE, { hidden: [], stack: [] });
    expect(readHomeLayout(ALICE).changedAt).toBe(2_000);

    saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }, { changedAt: 500 });
    expect(readHomeLayout(ALICE).changedAt).toBe(500);
    now.mockRestore();
  });

  it('counts a widget window added or removed, and the height its widget asks for', () => {
    const clock = { name: 'GO Clock', identifier: null };
    const clockId = homeWidgetWindowId(clock);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    saveHomeLayout(ALICE, withHomeWidgetWindow(readHomeLayout(ALICE), clock));
    expect(readHomeLayout(ALICE).changedAt).toBe(1_000);

    now.mockReturnValue(2_000);
    const askHeight = () =>
      saveHomeLayout(
        ALICE,
        withHomeWidgetWindowHeight(readHomeLayout(ALICE), clockId, 140)
      );
    askHeight();
    expect(readHomeLayout(ALICE).changedAt).toBe(2_000);

    // The same height again changes nothing.
    now.mockReturnValue(3_000);
    askHeight();
    expect(readHomeLayout(ALICE).changedAt).toBe(2_000);

    saveHomeLayout(
      ALICE,
      withoutHomeWidgetWindow(readHomeLayout(ALICE), clockId)
    );
    expect(readHomeLayout(ALICE).changedAt).toBe(3_000);
    now.mockRestore();
  });
});

describe('widget windows in the Home layout', () => {
  const clock = { name: 'GO Clock', identifier: null, title: 'Clock' };
  const clockId = homeWidgetWindowId(clock);
  const placeOf = (layout: Parameters<typeof homeLayoutGrid>[0]) =>
    homeLayoutGrid(layout).find((item) => item.key === clockId);

  it('adds a widget in a window of its own, under everything, once', () => {
    const added = withHomeWidgetWindow(HOME_LAYOUT_DEFAULT, clock);

    expect(added.widgetWindows).toEqual([
      { name: 'GO Clock', identifier: null, title: 'Clock' },
    ]);
    expect(placeOf(added)).toMatchObject({ x: 0, y: 147, w: 6, h: 27 });
    expect(withHomeWidgetWindow(added, clock)).toBe(added);
  });

  it('places widget windows under a layout never arranged', () => {
    const layout = { ...HOME_LAYOUT_DEFAULT, widgetWindows: [clock] };
    expect(placeOf(layout)).toMatchObject({ x: 0, y: 147 });
  });

  it('stops at the widget limit', () => {
    let layout = HOME_LAYOUT_DEFAULT;
    for (let index = 0; index < 9; index += 1) {
      layout = withHomeWidgetWindow(layout, {
        name: `Widget ${index}`,
        identifier: null,
      });
    }
    expect(layout.widgetWindows).toHaveLength(8);
  });

  it('reads stored widget windows, without bad or repeated ones', () => {
    const layout = normalizeHomeLayout({
      grid: [
        { key: clockId, x: 3, y: 0, w: 6, h: 20 },
        { key: 'widget:Unknown:', x: 0, y: 0, w: 6, h: 20 },
      ],
      hidden: [],
      widgetWindows: [
        { name: ' GO Clock ', identifier: 'default', sizedBy: 'user' },
        { name: 'GO Clock', identifier: '' },
        { name: '' },
        null,
        'Q-Mail',
        {
          name: 'Q-Weather',
          identifier: 'go-widget-now',
          sizedBy: 'nobody',
          title: ' Now ',
        },
      ],
    });

    expect(layout.widgetWindows).toEqual([
      { name: 'GO Clock', identifier: null, sizedBy: 'user' },
      { name: 'Q-Weather', identifier: 'go-widget-now', title: 'Now' },
    ]);
    const keys = layout.grid?.map((item) => item.key);
    expect(keys).not.toContain('widget:Unknown:');
    expect(keys).toContain('widget:Q-Weather:go-widget-now');
    expect(placeOf(layout)).toMatchObject({ x: 3, y: 0, w: 6, h: 20 });
    expect(sameHomeLayout(layout, normalizeHomeLayout(layout))).toBe(true);
    expect(sameHomeLayout(layout, { ...layout, widgetWindows: [clock] })).toBe(
      false
    );
  });

  it('removes a widget window', () => {
    const removed = withoutHomeWidgetWindow(
      withHomeWidgetWindow(HOME_LAYOUT_DEFAULT, clock),
      clockId
    );
    expect(removed.widgetWindows).toBeUndefined();
    expect(placeOf(removed)).toBeUndefined();
  });

  it('gives a widget window the height its widget asks for, until the user sizes it', () => {
    const added = withHomeWidgetWindow(HOME_LAYOUT_DEFAULT, clock);
    const asked = withHomeWidgetWindowHeight(added, clockId, 140);

    expect(placeOf(asked)?.h).toBe(homeGridRowsFor(140));
    expect(asked.widgetWindows?.[0].sizedBy).toBe('widget');
    expect(withHomeWidgetWindowHeight(asked, clockId, 140)).toBe(asked);

    // Moving it isn't sizing it.
    const moved = withHomeGrid(
      asked,
      homeLayoutGrid(asked).map((item) =>
        item.key === clockId ? { ...item, x: 2 } : item
      )
    );
    expect(moved.widgetWindows?.[0].sizedBy).toBe('widget');

    const sized = withHomeGrid(
      asked,
      homeLayoutGrid(asked).map((item) =>
        item.key === clockId ? { ...item, w: 8 } : item
      )
    );
    expect(sized.widgetWindows?.[0].sizedBy).toBe('user');
    expect(withHomeWidgetWindowHeight(sized, clockId, 400)).toBe(sized);
  });

  describe('with a panel hidden', () => {
    const shownIn = (layout: HomeLayout) => (key: HomeWindowId) =>
      !(layout.hidden as readonly HomeWindowId[]).includes(key);
    /** What Home shows. */
    const shownGrid = (layout: HomeLayout) =>
      homeGridShown(homeLayoutGrid(layout), shownIn(layout));
    const withoutClock = (items: readonly HomeGridItem[]) =>
      items.filter((item) => item.key !== clockId);
    const qortinoIn = (layout: HomeLayout) =>
      homeLayoutGrid(layout).find((item) => item.key === 'qortino');

    /**
     * Qortino hidden, then Featured Q-Apps moved to the top left, where
     * Quick Tools had risen into the room Qortino left: Edit Home's own
     * steps, then what gets saved.
     */
    const featuredOnTop = (start: HomeLayout) => {
      const layout = withHomePanelShown(start, 'qortino', false);
      const grid = homeLayoutGrid(layout);
      const moved = moveHomeWindow(
        homeGridShown(grid, shownIn(layout)),
        'featured',
        0,
        0
      );
      return normalizeHomeLayout(
        withHomeGrid(layout, mergeHomeGrid(grid, moved))
      );
    };

    it('adds a widget without moving what shows', () => {
      const layout = featuredOnTop(HOME_LAYOUT_DEFAULT);
      const before = shownGrid(layout);
      expect(before.find((item) => item.key === 'featured')).toMatchObject({
        x: 0,
        y: 0,
      });

      const added = normalizeHomeLayout(withHomeWidgetWindow(layout, clock));

      expect(withoutClock(shownGrid(added))).toEqual(before);
      // The widget goes under what shows...
      expect(placeOf(added)).toMatchObject({
        x: 0,
        y: Math.max(...before.map((item) => item.y + item.h)),
      });
      // ...and Qortino keeps its place, for when it's shown again.
      expect(qortinoIn(added)).toEqual(qortinoIn(layout));
    });

    it('gives a widget the height it asks for without moving what shows', () => {
      const layout = featuredOnTop(
        withHomeWidgetWindow(HOME_LAYOUT_DEFAULT, clock)
      );
      const before = shownGrid(layout);

      const asked = normalizeHomeLayout(
        withHomeWidgetWindowHeight(layout, clockId, 300)
      );

      expect(placeOf(asked)?.h).toBe(homeGridRowsFor(300));
      expect(withoutClock(shownGrid(asked))).toEqual(withoutClock(before));
      expect(qortinoIn(asked)).toEqual(qortinoIn(layout));
    });
  });
});
