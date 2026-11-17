import { afterEach, describe, expect, it } from 'vitest';
import {
  type HomeGridItem,
  type HomeWindowId,
  homeDefaultGrid,
  homeGridCellAt,
  homeGridColumnPx,
  homeGridFlow,
  homeGridForGettingStarted,
  homeGridHeightPx,
  homeGridRectPx,
  homeGridRowsFor,
  homeGridShown,
  homeGridSizeFor,
  homeGridWithWindowUnder,
  homeWidgetWindowId,
  homeWindowMinSize,
  homeWorkspaceCopyId,
  isHomeWidgetWindowId,
  isHomeWorkspaceCopyId,
  mergeHomeGrid,
  moveHomeWindow,
  normalizeHomeGrid,
  resizeHomeWindow,
} from './homeGrid';
import {
  type HomeLayout,
  type HomePanelId,
  HOME_LAYOUT_DEFAULT,
  homeLayoutGrid,
  isHomePanelShown,
  readHomeLayout,
  saveHomeLayout,
  withHomeGrid,
  withHomePanelShown,
  withHomeWorkspaceCopy,
  withoutHomeWorkspaceCopy,
} from './homeLayout';

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
    // The Workspace over Qortino, in the room Qortino's window had.
    expect(rect(grid, 'workspace')).toEqual([0, 0, 6, 23]);
    expect(rect(grid, 'qortino')).toEqual([0, 23, 6, 23]);
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
      'workspace',
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
    expect(at(shown, 'workspace')?.y).toBe(40);
    expect(at(shown, 'qortino')?.y).toBe(63);
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

/** Home's default grid while the Workspace was part of Qortino's window. */
const BEFORE_THE_WORKSPACE: HomeGridItem[] = [
  { key: 'account', x: 6, y: 0, w: 12, h: 20 },
  { key: 'qortino', x: 0, y: 0, w: 6, h: 46 },
  { key: 'tools', x: 0, y: 46, w: 6, h: 18 },
  { key: 'featured', x: 6, y: 20, w: 12, h: 44 },
  { key: 'status', x: 18, y: 0, w: 6, h: 33 },
  { key: 'wallet', x: 18, y: 33, w: 6, h: 31 },
  { key: 'widgets', x: 0, y: 64, w: 24, h: 20 },
  { key: 'groupActivity', x: 0, y: 84, w: 12, h: 63 },
  { key: 'feed', x: 12, y: 84, w: 12, h: 63 },
];

describe('a grid from before the Workspace was a window of its own', () => {
  it('gets the Workspace from the top of Qortino’s window, and nothing else moves', () => {
    const grid = normalizeHomeGrid(BEFORE_THE_WORKSPACE);
    expect(rect(grid, 'workspace')).toEqual([0, 0, 6, 23]);
    expect(rect(grid, 'qortino')).toEqual([0, 23, 6, 23]);
    for (const item of BEFORE_THE_WORKSPACE) {
      if (item.key === 'qortino') continue;
      expect(at(grid, item.key)).toEqual(item);
    }
    // As the default layout is now.
    expect(grid).toEqual(homeDefaultGrid());
  });

  it('keeps the room of a small, a tall or a moved Qortino window', () => {
    const small = normalizeHomeGrid([
      { key: 'status', x: 18, y: 0, w: 6, h: 40 },
      { key: 'qortino', x: 18, y: 40, w: 6, h: 34 },
      { key: 'feed', x: 0, y: 0, w: 18, h: 74 },
    ]);
    expect(rect(small, 'workspace')).toEqual([18, 40, 6, 16]);
    expect(rect(small, 'qortino')).toEqual([18, 56, 6, 18]);
    expect(rect(small, 'feed')).toEqual([0, 0, 18, 74]);

    const tall = normalizeHomeGrid([
      { key: 'qortino', x: 0, y: 0, w: 24, h: 80 },
    ]);
    // Qortino's height follows its content: the Workspace gets the room.
    expect(rect(tall, 'workspace')).toEqual([0, 0, 24, 57]);
    expect(rect(tall, 'qortino')).toEqual([0, 57, 24, 23]);
  });

  it('keeps a hidden Qortino window’s place for both', () => {
    // Qortino hidden, and Quick Tools risen into its room.
    const stored = BEFORE_THE_WORKSPACE.map((item) =>
      item.key === 'tools' ? { ...item, y: 0 } : item
    );
    const grid = normalizeHomeGrid(
      stored,
      undefined,
      [],
      ['workspace', 'qortino']
    );
    expect(rect(grid, 'tools')).toEqual([0, 0, 6, 18]);
    expect(rect(grid, 'workspace')).toEqual([0, 0, 6, 23]);
    expect(rect(grid, 'qortino')).toEqual([0, 23, 6, 23]);
  });

  it('leaves a grid that has the Workspace alone', () => {
    const grid = homeDefaultGrid().map((item) =>
      item.key === 'workspace' ? { ...item, x: 18, y: 64 } : item
    );
    const normal = normalizeHomeGrid(grid);
    expect(rect(normal, 'qortino')).toEqual([0, 0, 6, 23]);
    expect(at(normal, 'workspace')).toMatchObject({ x: 18, w: 6, h: 23 });
  });
});

describe('copies of the Workspace', () => {
  const copy = homeWorkspaceCopyId('k1');

  it('keeps a copy only while the layout lists it', () => {
    const stored = [
      ...homeDefaultGrid(),
      { key: copy, x: 0, y: 147, w: 6, h: 26 },
    ];
    expect(at(normalizeHomeGrid(stored), copy)).toBeUndefined();
    expect(rect(normalizeHomeGrid(stored, undefined, [copy]), copy)).toEqual([
      0, 147, 6, 26,
    ]);
    // One the grid lacks goes under everything, as big as the Workspace.
    expect(
      rect(normalizeHomeGrid(homeDefaultGrid(), undefined, [copy]), copy)
    ).toEqual([0, 147, 6, 23]);
  });

  it('can be made as small as the Workspace', () => {
    const grid = normalizeHomeGrid(
      [{ key: copy, x: 0, y: 0, w: 1, h: 1 }],
      undefined,
      [copy]
    );
    expect(rect(grid, copy)).toEqual([0, 0, 5, 16]);
  });
});

describe('while Getting started shows', () => {
  const stack = ['widgets', 'groupActivity', 'feed'] as const;
  const bottomOf = (items: readonly HomeGridItem[], key: HomeWindowId) => {
    const item = at(items, key);
    return item ? item.y + item.h : -1;
  };

  it("gives Qortino's window the Workspace's rows as well as its own", () => {
    const grid = homeDefaultGrid([...stack]);
    const during = homeGridForGettingStarted(grid);
    const workspace = at(grid, 'workspace')!;
    const qortino = at(grid, 'qortino')!;
    expect(at(during, 'qortino')).toEqual({
      ...qortino,
      y: workspace.y,
      h: workspace.h + qortino.h,
    });
    // It ends where it did, so Quick Tools and the rest stay put.
    expect(bottomOf(during, 'qortino')).toBe(bottomOf(grid, 'qortino'));
    expect(during.filter((item) => item.key !== 'qortino')).toEqual(
      grid.filter((item) => item.key !== 'qortino')
    );
    // Shown without the Workspace, nothing rises or moves down.
    const shown = homeGridShown(during, (key) => key !== 'workspace');
    for (const item of shown) {
      expect(item).toEqual(at(during, item.key));
    }
  });

  it('changes nothing when the Workspace is somewhere else', () => {
    const grid = moveHomeWindow(
      homeDefaultGrid([...stack]),
      'workspace',
      18,
      0
    );
    expect(homeGridForGettingStarted(grid)).toEqual(grid);
  });
});

describe('homeGridWithWindowUnder', () => {
  const copy = homeWorkspaceCopyId('k1');

  it('adds a window right under another, as big as it: what is in its way goes down', () => {
    const grid = homeGridWithWindowUnder(homeDefaultGrid(), 'workspace', copy);
    expect(rect(grid, 'workspace')).toEqual([0, 0, 6, 23]);
    expect(rect(grid, copy)).toEqual([0, 23, 6, 23]);
    expect(rect(grid, 'qortino')).toEqual([0, 46, 6, 23]);
    expect(rect(grid, 'tools')).toEqual([0, 69, 6, 18]);
    // The other columns stay as they were.
    for (const key of ['account', 'featured', 'status', 'wallet'] as const) {
      expect(at(grid, key)).toEqual(at(homeDefaultGrid(), key));
    }
    expect(rect(grid, 'widgets')).toEqual([0, 87, 24, 20]);
  });

  it('leaves the hidden windows where they were', () => {
    const grid = homeGridWithWindowUnder(homeDefaultGrid(), 'workspace', copy, [
      'qortino',
    ]);
    expect(rect(grid, copy)).toEqual([0, 23, 6, 23]);
    // Shown, Quick Tools goes under the new window...
    expect(rect(grid, 'tools')).toEqual([0, 46, 6, 18]);
    // ...and hidden, Qortino keeps its place.
    expect(rect(grid, 'qortino')).toEqual([0, 23, 6, 23]);
  });

  it('adds it under everything when the other window is not there to go under', () => {
    const grid = homeGridWithWindowUnder(homeDefaultGrid(), 'workspace', copy, [
      'workspace',
    ]);
    expect(rect(grid, copy)).toEqual([0, 147, 6, 23]);
  });
});

describe('homeGridShown', () => {
  it('closes the room a hidden window leaves', () => {
    const grid = homeDefaultGrid();
    const shown = homeGridShown(
      grid,
      (key) => key !== 'workspace' && key !== 'qortino'
    );
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
    // The Workspace and Qortino hidden, then the account card moved under
    // Quick Tools.
    const hidden: HomeWindowId[] = ['workspace', 'qortino'];
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
    // They keep their places, for when they're shown again.
    expect(rect(saved, 'workspace')).toEqual([0, 0, 6, 23]);
    expect(rect(saved, 'qortino')).toEqual([0, 23, 6, 23]);
  });
});

describe('mergeHomeGrid', () => {
  it('keeps where the hidden windows were', () => {
    const stored = homeDefaultGrid();
    const shown = homeGridShown(stored, (key) => key !== 'qortino');
    const merged = mergeHomeGrid(stored, shown);
    expect(rect(merged, 'qortino')).toEqual([0, 23, 6, 23]);
    expect(rect(merged, 'tools')).toEqual([0, 23, 6, 18]);
    // Shown again, Qortino takes its place back over Quick Tools.
    const again = homeGridShown(merged, () => true);
    expect(rect(again, 'workspace')).toEqual([0, 0, 6, 23]);
    expect(rect(again, 'qortino')).toEqual([0, 23, 6, 23]);
    expect(rect(again, 'tools')).toEqual([0, 46, 6, 18]);
  });

  it('keeps a copy of the Workspace that the stored grid lacks', () => {
    const copy = homeWorkspaceCopyId('k1');
    const merged = mergeHomeGrid(homeDefaultGrid(), [
      { key: copy, x: 0, y: 147, w: 6, h: 26 },
    ]);
    expect(rect(merged, copy)).toEqual([0, 147, 6, 26]);
    expect(merged).toHaveLength(homeDefaultGrid().length + 1);
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
    // Reading order: the Workspace, account, Status, Featured, Qortino,
    // Wallet, Tools...
    expect(rect(flowed, 'workspace')).toEqual([0, 0, 1, 23]);
    expect(rect(flowed, 'account')).toEqual([1, 0, 1, 20]);
    expect(rect(flowed, 'status')).toEqual([1, 20, 1, 33]);
    expect(rect(flowed, 'featured')).toEqual([0, 23, 1, 44]);
    expect(rect(flowed, 'qortino')).toEqual([1, 53, 1, 23]);
    expect(rect(flowed, 'wallet')).toEqual([0, 67, 1, 31]);
    expect(rect(flowed, 'tools')).toEqual([1, 76, 1, 18]);
    // Widgets spans both, under the lower column.
    expect(rect(flowed, 'widgets')).toEqual([0, 98, 2, 20]);
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

const ALICE = 'QaliceAddress00000000000000000000';

/**
 * Home as HomeDesktop lays it out for a layout (Getting started done), with
 * the content measured in the windows that follow it.
 */
const homeView = (
  layout: HomeLayout,
  measured: Partial<Record<HomeWindowId, number>> = {}
) => {
  const stored = homeLayoutGrid(layout);
  const isShown = (key: HomeWindowId) =>
    key === 'account' ||
    isHomeWidgetWindowId(key) ||
    isHomeWorkspaceCopyId(key) ||
    isHomePanelShown(layout, key as HomePanelId);
  return { shown: homeGridShown(stored, isShown, measured), stored };
};

/**
 * A change made in Edit Home (a window moved or resized, from what shows),
 * saved and read back as Home does.
 */
const editHome = (
  layout: HomeLayout,
  change: (shown: HomeGridItem[]) => HomeGridItem[]
) => {
  const view = homeView(layout);
  saveHomeLayout(
    ALICE,
    withHomeGrid(layout, mergeHomeGrid(view.stored, change(view.shown)))
  );
  return { saved: readHomeLayout(ALICE) };
};

describe('Duplicate and remove, as kept', () => {
  afterEach(() => {
    localStorage.clear();
  });
  const save = (layout: HomeLayout) => {
    saveHomeLayout(ALICE, layout);
    return readHomeLayout(ALICE);
  };
  const keys = ['k1', 'k2', 'k3'];

  it('adds copies without moving the feed over Widgets, and removing them leaves Home as it was', () => {
    const before = homeView(HOME_LAYOUT_DEFAULT).shown;

    // Three copies make the left column 69 rows longer than the others.
    let layout = HOME_LAYOUT_DEFAULT as HomeLayout;
    for (const key of keys) {
      layout = save(withHomeWorkspaceCopy(layout, 'workspace', key));
    }
    const shown = homeView(layout).shown;
    expect(rect(shown, 'tools')).toEqual([0, 115, 6, 18]);
    // What was under them is still one under the other.
    expect(rect(shown, 'widgets')).toEqual([0, 133, 24, 20]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 153, 12, 63]);
    expect(rect(shown, 'feed')).toEqual([12, 153, 12, 63]);

    for (const key of keys) {
      layout = save(withoutHomeWorkspaceCopy(layout, homeWorkspaceCopyId(key)));
    }
    expect(homeView(layout).shown).toEqual(before);
  });

  it('keeps the feed beside Group Activity when Widgets measures taller than it is kept', () => {
    // Widgets' content one row taller than the 20 it has until measured.
    const measured = { widgets: 21 };
    let layout = HOME_LAYOUT_DEFAULT as HomeLayout;
    for (const key of keys) {
      // As Home duplicates: among the windows as they show.
      const view = homeView(layout, measured);
      layout = save(
        withHomeWorkspaceCopy(
          withHomeGrid(layout, mergeHomeGrid(view.stored, view.shown)),
          'workspace',
          key
        )
      );
    }

    const shown = homeView(layout, measured).shown;

    expect(rect(shown, 'widgets')).toEqual([0, 133, 24, 21]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 154, 12, 63]);
    expect(rect(shown, 'feed')).toEqual([12, 154, 12, 63]);
  });

  it('adds the copy right under a Workspace that sits over a wider window', () => {
    // The Workspace at the bottom of the right column, right over Widgets,
    // which starts further left.
    const layout = save(
      withHomeGrid(
        HOME_LAYOUT_DEFAULT,
        moveHomeWindow(homeDefaultGrid(), 'workspace', 18, 40)
      )
    );
    const before = homeView(layout).shown;
    expect(rect(before, 'workspace')).toEqual([18, 64, 6, 23]);
    expect(rect(before, 'widgets')).toEqual([0, 87, 24, 20]);

    const added = save(withHomeWorkspaceCopy(layout, 'workspace', 'k1'));

    const shown = homeView(added).shown;
    expect(rect(shown, homeWorkspaceCopyId('k1'))).toEqual([18, 87, 6, 23]);
    // Widgets and what is under it make room, still one under the other.
    expect(rect(shown, 'widgets')).toEqual([0, 110, 24, 20]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 130, 12, 63]);
    expect(rect(shown, 'feed')).toEqual([12, 130, 12, 63]);
    expect(
      homeView(save(withoutHomeWorkspaceCopy(added, homeWorkspaceCopyId('k1'))))
        .shown
    ).toEqual(before);
  });

  it('moves only what is under the new copy, with the Workspace hidden', () => {
    // A copy, the Workspace hidden, then Featured Q-Apps at the top left.
    let layout = save(
      withHomeWorkspaceCopy(HOME_LAYOUT_DEFAULT, 'workspace', 'k1')
    );
    layout = save(withHomePanelShown(layout, 'workspace', false));
    layout = editHome(layout, (shown) =>
      moveHomeWindow(shown, 'featured', 0, 0)
    ).saved;
    const before = homeView(layout);
    const copy = at(before.shown, homeWorkspaceCopyId('k1'))!;

    const added = save(
      withHomeWorkspaceCopy(layout, homeWorkspaceCopyId('k1'), 'k2')
    );

    const shown = homeView(added).shown;
    expect(rect(shown, homeWorkspaceCopyId('k2'))).toEqual([
      copy.x,
      copy.y + copy.h,
      copy.w,
      copy.h,
    ]);
    // Each other window is where it was, or lower by the copy's height.
    for (const item of before.shown) {
      const now = at(shown, item.key)!;
      expect([item.key, now.y - item.y]).toEqual([
        item.key,
        now.y === item.y ? 0 : copy.h,
      ]);
    }
    expect(at(homeLayoutGrid(added), 'workspace')).toEqual(
      at(before.stored, 'workspace')
    );
    expect(
      homeView(save(withoutHomeWorkspaceCopy(added, homeWorkspaceCopyId('k2'))))
        .shown
    ).toEqual(before.shown);
  });
});
