import { describe, expect, it } from 'vitest';
import {
  type HomeGridItem,
  type HomeWindowId,
  homeDefaultGrid,
  homeGridCellAt,
  homeGridColumnPx,
  homeGridFlow,
  homeGridHeightPx,
  homeGridRectPx,
  homeGridRowsFor,
  homeGridShown,
  homeGridSizeFor,
  homeWidgetWindowId,
  homeWindowMinSize,
  isHomeWidgetWindowId,
  mergeHomeGrid,
  moveHomeWindow,
  normalizeHomeGrid,
  resizeHomeWindow,
} from './homeGrid';

const at = (items: readonly HomeGridItem[], key: HomeWindowId) =>
  items.find((item) => item.key === key);

const rect = (items: readonly HomeGridItem[], key: HomeWindowId) => {
  const item = at(items, key);
  return item ? [item.x, item.y, item.w, item.h] : null;
};

/** Two windows in the same columns, one over the other, and one beside. */
const column = (): HomeGridItem[] => [
  { key: 'status', x: 0, y: 0, w: 6, h: 30 },
  { key: 'wallet', x: 0, y: 30, w: 6, h: 30 },
  { key: 'feed', x: 6, y: 0, w: 18, h: 40 },
];

describe('homeDefaultGrid', () => {
  it('lays Home out as before: three columns, then the stack', () => {
    const grid = homeDefaultGrid();
    expect(rect(grid, 'qortino')).toEqual([0, 0, 6, 46]);
    expect(rect(grid, 'tools')).toEqual([0, 46, 6, 18]);
    expect(rect(grid, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(grid, 'featured')).toEqual([6, 20, 12, 44]);
    expect(rect(grid, 'status')).toEqual([18, 0, 6, 33]);
    expect(rect(grid, 'wallet')).toEqual([18, 33, 6, 31]);
    expect(rect(grid, 'widgets')).toEqual([0, 64, 24, 20]);
    // Group Activity and the feed side by side, 610 px tall.
    expect(rect(grid, 'groupActivity')).toEqual([0, 84, 12, 63]);
    expect(rect(grid, 'feed')).toEqual([12, 84, 12, 63]);
    expect(homeGridRectPx(at(grid, 'feed'), 50).height).toBe(610);
  });

  it('follows the stack order, pairing Group Activity and the feed only when next to each other', () => {
    const feedFirst = homeDefaultGrid(['widgets', 'feed', 'groupActivity']);
    expect(rect(feedFirst, 'feed')).toEqual([0, 84, 12, 63]);
    expect(rect(feedFirst, 'groupActivity')).toEqual([12, 84, 12, 63]);

    const apart = homeDefaultGrid(['groupActivity', 'widgets', 'feed']);
    expect(rect(apart, 'groupActivity')).toEqual([0, 64, 24, 63]);
    expect(rect(apart, 'widgets')).toEqual([0, 127, 24, 20]);
    expect(rect(apart, 'feed')).toEqual([0, 147, 24, 63]);
  });
});

describe('normalizeHomeGrid', () => {
  it('gives nothing for anything that is not a list of windows', () => {
    expect(normalizeHomeGrid(null)).toBeUndefined();
    expect(normalizeHomeGrid({ feed: {} })).toBeUndefined();
    expect(normalizeHomeGrid([{ key: 'nope', x: 0 }])).toBeUndefined();
  });

  it('keeps known windows once each, inside the grid and within their sizes', () => {
    const grid = normalizeHomeGrid([
      { key: 'feed', x: 30, y: 0, w: 2, h: 4 },
      { key: 'feed', x: 0, y: 0, w: 24, h: 60 },
      { key: 'status', x: 'x', y: -5, w: 99, h: 25 },
      'junk',
    ]);
    // A bad x counts as 0 and the width as the whole grid...
    expect(rect(grid, 'status')).toEqual([0, 0, 24, 25]);
    // ...and the first feed counts, made big enough and inside the grid,
    // then under Status, which comes first in reading order.
    expect(rect(grid, 'feed')).toEqual([17, 25, 7, 34]);
  });

  it('puts a window it lacks under everything, at its default size', () => {
    const grid = normalizeHomeGrid([{ key: 'feed', x: 0, y: 0, w: 24, h: 40 }]);
    expect(grid?.map((item) => item.key)).toEqual([
      'account',
      'qortino',
      'tools',
      'featured',
      'status',
      'wallet',
      'widgets',
      'groupActivity',
      'feed',
    ]);
    expect(rect(grid, 'feed')).toEqual([0, 0, 24, 40]);
    // Nothing overlaps, and nothing is left floating.
    const shown = grid ?? [];
    for (const a of shown) {
      for (const b of shown) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    expect(at(shown, 'qortino')?.y).toBe(40);
  });

  it('lets windows rise into empty room above them', () => {
    const grid = normalizeHomeGrid([
      { key: 'status', x: 0, y: 50, w: 6, h: 20 },
      { key: 'wallet', x: 0, y: 200, w: 6, h: 30 },
    ]);
    expect(rect(grid, 'status')).toEqual([0, 0, 6, 20]);
    expect(rect(grid, 'wallet')).toEqual([0, 20, 6, 30]);
  });
});

describe('homeGridShown', () => {
  it('closes the room a hidden window leaves', () => {
    const grid = homeDefaultGrid();
    const shown = homeGridShown(grid, (key) => key !== 'qortino');
    expect(at(shown, 'qortino')).toBeUndefined();
    // Quick Tools rises beside the account card.
    expect(rect(shown, 'tools')).toEqual([0, 0, 6, 18]);
    expect(rect(shown, 'feed')).toEqual([12, 84, 12, 63]);
  });

  it('gives the account card and Widgets their measured height only', () => {
    const shown = homeGridShown(homeDefaultGrid(), () => true, {
      account: 25,
      feed: 5,
      widgets: 40,
    });
    expect(rect(shown, 'account')).toEqual([6, 0, 12, 25]);
    // Featured Q-Apps goes down with it.
    expect(rect(shown, 'featured')).toEqual([6, 25, 12, 44]);
    expect(rect(shown, 'widgets')).toEqual([0, 69, 24, 40]);
    // The feed's height is its own.
    expect(rect(shown, 'feed')).toEqual([12, 109, 12, 63]);
  });

  it('gives a window that follows its content all of its measured height', () => {
    // Four tall widgets, one over another: about 2,900 px.
    const shown = homeGridShown(homeDefaultGrid(), () => true, {
      widgets: 292,
    });
    expect(rect(shown, 'widgets')).toEqual([0, 64, 24, 292]);
    // What's under it starts below it, so nothing overlaps.
    expect(at(shown, 'groupActivity')?.y).toBe(64 + 292);
  });
});

describe('saving with hidden windows', () => {
  it('keeps what shows as it was while moving', () => {
    // Qortino hidden, then the account card moved under Quick Tools.
    const hidden: HomeWindowId[] = ['qortino'];
    const isShown = (key: HomeWindowId) => !hidden.includes(key);
    const grid = homeDefaultGrid();
    const start = homeGridShown(grid, isShown);
    const tools = at(start, 'tools');
    const moved = moveHomeWindow(start, 'account', 0, tools.y + tools.h);
    const preview = homeGridShown(moved, () => true);
    // While moving, Featured Q-Apps goes under the account card.
    expect(at(preview, 'featured').y).toBeGreaterThan(at(preview, 'account').y);

    const saved = normalizeHomeGrid(
      mergeHomeGrid(grid, moved),
      undefined,
      [],
      hidden
    );

    expect(homeGridShown(saved, isShown)).toEqual(preview);
    // Qortino keeps its place, for when it's shown again.
    expect(rect(saved, 'qortino')).toEqual([0, 0, 6, 46]);
  });
});

describe('mergeHomeGrid', () => {
  it('keeps where the hidden windows were', () => {
    const stored = homeDefaultGrid();
    const shown = homeGridShown(stored, (key) => key !== 'qortino');
    const merged = mergeHomeGrid(stored, shown);
    expect(rect(merged, 'qortino')).toEqual([0, 0, 6, 46]);
    expect(rect(merged, 'tools')).toEqual([0, 0, 6, 18]);
    // Shown again, Qortino takes its place back over Quick Tools.
    const again = homeGridShown(merged, () => true);
    expect(rect(again, 'qortino')).toEqual([0, 0, 6, 46]);
    expect(rect(again, 'tools')).toEqual([0, 46, 6, 18]);
  });
});

describe('moveHomeWindow', () => {
  it('passes a window below once its bottom edge passes that window’s middle', () => {
    // Status (30 rows) going down over Wallet (rows 30–60, middle 45).
    const before = moveHomeWindow(column(), 'status', 0, 14);
    expect(rect(before, 'status')).toEqual([0, 0, 6, 30]);
    expect(rect(before, 'wallet')).toEqual([0, 30, 6, 30]);

    const after = moveHomeWindow(column(), 'status', 0, 16);
    expect(rect(after, 'wallet')).toEqual([0, 0, 6, 30]);
    expect(rect(after, 'status')).toEqual([0, 30, 6, 30]);
  });

  it('passes a window above once its top edge passes that window’s middle', () => {
    // Wallet going up over Status (rows 0–30, middle 15).
    const before = moveHomeWindow(column(), 'wallet', 0, 16);
    expect(rect(before, 'wallet')).toEqual([0, 30, 6, 30]);

    const after = moveHomeWindow(column(), 'wallet', 0, 14);
    expect(rect(after, 'wallet')).toEqual([0, 0, 6, 30]);
    expect(rect(after, 'status')).toEqual([0, 30, 6, 30]);
  });

  it('moves into other columns, where the windows make room', () => {
    const moved = moveHomeWindow(column(), 'wallet', 18, 0);
    // The feed's middle is at row 20: Wallet's top edge (row 0) is above it.
    expect(rect(moved, 'wallet')).toEqual([18, 0, 6, 30]);
    expect(rect(moved, 'feed')).toEqual([6, 30, 18, 40]);
    // Status stays, alone in its columns.
    expect(rect(moved, 'status')).toEqual([0, 0, 6, 30]);
  });

  it('stays inside the grid and leaves the others alone for an unknown window', () => {
    const moved = moveHomeWindow(column(), 'status', 40, -3);
    expect(rect(moved, 'status')).toEqual([18, 0, 6, 30]);
    expect(moveHomeWindow(column(), 'qortino', 0, 0)).toEqual(column());
  });
});

describe('resizeHomeWindow', () => {
  it('pushes what it reaches down and keeps its corner', () => {
    const wider = resizeHomeWindow(column(), 'status', 10, 30);
    expect(rect(wider, 'status')).toEqual([0, 0, 10, 30]);
    // The feed starts in column 6: now it goes under Status.
    expect(rect(wider, 'feed')).toEqual([6, 30, 18, 40]);
    expect(rect(wider, 'wallet')).toEqual([0, 30, 6, 30]);

    const taller = resizeHomeWindow(column(), 'status', 6, 45);
    expect(rect(taller, 'wallet')).toEqual([0, 45, 6, 30]);
    expect(rect(taller, 'feed')).toEqual([6, 0, 18, 40]);
  });

  it('lets the windows under it rise when it gets shorter', () => {
    const shorter = resizeHomeWindow(column(), 'status', 6, 22);
    expect(rect(shorter, 'wallet')).toEqual([0, 22, 6, 30]);
  });

  it('keeps each window within its sizes and the grid', () => {
    const tiny = resizeHomeWindow(column(), 'wallet', 1, 1);
    expect(rect(tiny, 'wallet')).toEqual([0, 30, 5, 26]);
    const wide = resizeHomeWindow(column(), 'feed', 30, 40);
    // Wider than what's left of the grid: it moves left to fit.
    expect(rect(wide, 'feed')).toEqual([0, 0, 24, 40]);
  });
});

describe('homeGridFlow', () => {
  it('flows windows into two columns, wide ones across both', () => {
    const flowed = homeGridFlow(homeDefaultGrid(), 2);
    // Reading order: Qortino, account, Status, Featured, Wallet, Tools...
    expect(rect(flowed, 'qortino')).toEqual([0, 0, 1, 46]);
    expect(rect(flowed, 'account')).toEqual([1, 0, 1, 20]);
    expect(rect(flowed, 'status')).toEqual([1, 20, 1, 33]);
    expect(rect(flowed, 'featured')).toEqual([0, 46, 1, 44]);
    expect(rect(flowed, 'wallet')).toEqual([1, 53, 1, 31]);
    expect(rect(flowed, 'tools')).toEqual([1, 84, 1, 18]);
    // Widgets spans both, under the lower column.
    expect(rect(flowed, 'widgets')).toEqual([0, 102, 2, 20]);
  });

  it('puts every window in one column on a narrow window', () => {
    const flowed = homeGridFlow(column(), 1);
    expect(rect(flowed, 'status')).toEqual([0, 0, 1, 30]);
    expect(rect(flowed, 'feed')).toEqual([0, 30, 1, 40]);
    expect(rect(flowed, 'wallet')).toEqual([0, 70, 1, 30]);
  });
});

describe('px helpers', () => {
  it('turns cells into pixels and back', () => {
    // 1480 px: 24 columns of 42.5 px with 20 px gaps.
    const columnPx = homeGridColumnPx(1480);
    expect(columnPx).toBeCloseTo(42.5);
    expect(homeGridRectPx({ x: 18, y: 33, w: 6, h: 31 }, columnPx)).toEqual({
      left: 1125,
      top: 330,
      width: 355,
      height: 290,
    });
    expect(homeGridCellAt(1130, 336, columnPx, 6)).toEqual({ x: 18, y: 34 });
    expect(homeGridCellAt(5000, -20, columnPx, 6)).toEqual({ x: 18, y: 0 });
    expect(homeGridSizeFor(355, 290, columnPx)).toEqual({ w: 6, h: 31 });
    expect(homeGridHeightPx(homeDefaultGrid())).toBe(1450);
    expect(homeGridHeightPx([])).toBe(0);
  });

  it('gives enough rows for some content', () => {
    expect(homeGridRowsFor(172)).toBe(20);
    expect(homeGridRowsFor(180)).toBe(20);
    expect(homeGridRowsFor(181)).toBe(21);
  });
});

describe('widget windows', () => {
  const clock = homeWidgetWindowId({ name: 'GO Clock', identifier: null });
  const weather = homeWidgetWindowId({
    name: 'Q-Weather',
    identifier: 'go-widget-now',
  });

  it('keys a widget window by its name and identifier', () => {
    expect(clock).toBe('widget:GO%20Clock:');
    expect(weather).toBe('widget:Q-Weather:go-widget-now');
    expect(isHomeWidgetWindowId(weather)).toBe(true);
    expect(isHomeWidgetWindowId('wallet')).toBe(false);
  });

  it('keeps the widget windows the layout lists, and adds the missing ones under everything', () => {
    const stored = [
      ...homeDefaultGrid(),
      { key: clock, x: 0, y: 500, w: 8, h: 30 },
      { key: 'widget:Gone:', x: 6, y: 500, w: 6, h: 20 },
    ];
    const grid = normalizeHomeGrid(stored, undefined, [clock, weather]);

    expect(at(grid, 'widget:Gone:')).toBeUndefined();
    // Risen to the bottom of Group Activity, the lowest in its columns.
    expect(rect(grid, clock)).toEqual([0, 147, 8, 30]);
    expect(rect(grid, weather)).toEqual([0, 177, 6, 27]);
    expect(grid.map((item) => item.key).slice(-2)).toEqual([clock, weather]);
  });

  it('keeps a widget window within its own sizes', () => {
    expect(homeWindowMinSize(clock)).toEqual({ w: 3, h: 10 });
    const grid = normalizeHomeGrid(
      [{ key: clock, x: 0, y: 0, w: 1, h: 2 }],
      undefined,
      [clock]
    );
    expect(rect(grid, clock)).toEqual([0, 0, 3, 10]);
    expect(rect(resizeHomeWindow(grid, clock, 1, 1), clock)).toEqual([
      0, 0, 3, 10,
    ]);
  });

  it('keeps widget windows when a changed layout is merged', () => {
    const stored = normalizeHomeGrid(
      [...homeDefaultGrid(), { key: clock, x: 0, y: 200, w: 6, h: 20 }],
      undefined,
      [clock]
    );
    const moved = { ...at(stored, clock), x: 6 };
    const merged = mergeHomeGrid(stored, [moved]);

    expect(merged).toHaveLength(stored.length);
    expect(at(merged, clock)?.x).toBe(6);
    expect(mergeHomeGrid(stored.slice(0, -1), [moved])).toHaveLength(
      stored.length
    );
  });
});
