import { afterEach, describe, expect, it } from 'vitest';
import {
  type HomeGridItem,
  type HomeWidgetWindowId,
  type HomeWindowId,
  homeDefaultGrid,
  homeGridCellAt,
  homeGridColumnPx,
  homeGridEdited,
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
    expect(rect(grid, 'workspace')).toEqual([0, 0, 6, 20]);
    expect(rect(grid, 'qortino')).toEqual([0, 20, 6, 23]);
    // Tall enough for the names on its buttons.
    expect(rect(grid, 'tools')).toEqual([0, 43, 6, 21]);
    expect(rect(grid, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(grid, 'featured')).toEqual([6, 20, 12, 44]);
    expect(rect(grid, 'status')).toEqual([18, 0, 6, 33]);
    expect(rect(grid, 'wallet')).toEqual([18, 33, 6, 31]);
    expect(rect(grid, 'widgets')).toEqual([0, 64, 24, 20]);
    // Group Activity and the feed side by side, 610 px tall.
    expect(rect(grid, 'groupActivity')).toEqual([0, 84, 12, 63]);
    expect(rect(grid, 'feed')).toEqual([12, 84, 12, 63]);
    expect(homeGridRectPx(at(grid, 'feed'), 50).height).toBe(610);
    // The Video publisher under everything, full width.
    expect(rect(grid, 'video')).toEqual([0, 147, 24, 76]);
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
      'video',
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
    expect(at(shown, 'qortino')?.y).toBe(60);
  });

  it('lets windows rise into empty room above them', () => {
    const grid = normalizeHomeGrid([
      { key: 'status', x: 0, y: 50, w: 6, h: 20 },
      { key: 'wallet', x: 0, y: 200, w: 6, h: 30 },
    ]);
    expect(rect(grid, 'status')).toEqual([0, 0, 6, 20]);
    expect(rect(grid, 'wallet')).toEqual([0, 20, 6, 30]);
  });

  it('keeps the account card’s place as tall as by default', () => {
    // Saved with the card at its measured 16 rows, Featured Q-Apps under it.
    const stored = homeDefaultGrid().map((item) =>
      item.key === 'account'
        ? { ...item, h: 16 }
        : item.key === 'featured'
          ? { ...item, y: 16 }
          : item
    );
    const grid = normalizeHomeGrid(stored);
    expect(rect(grid, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(grid, 'featured')).toEqual([6, 20, 12, 44]);
    // Shown, the card follows its content and Featured Q-Apps ends level.
    const shown = homeGridShown(grid, () => true, { account: 16 });
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 48]);
    // A taller card still pushes it down.
    const taller = homeGridShown(grid, () => true, { account: 25 });
    expect(rect(taller, 'featured')).toEqual([6, 25, 12, 44]);
    // A card saved taller gets its place back too, with Featured Q-Apps
    // right under it: its content decides how tall it shows.
    const tall = normalizeHomeGrid(
      homeDefaultGrid().map((item) =>
        item.key === 'account'
          ? { ...item, h: 32 }
          : item.key === 'featured'
            ? { ...item, y: 32 }
            : item
      )
    );
    expect(rect(tall, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(tall, 'featured')).toEqual([6, 20, 12, 44]);
    const tallShown = homeGridShown(tall, () => true, { account: 16 });
    expect(rect(tallShown, 'featured')).toEqual([6, 16, 12, 48]);
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
    // With Quick Tools tall enough for its names (3 rows taller, Qortino's
    // window 3 shorter), as the default layout is now.
    const namesShown = BEFORE_THE_WORKSPACE.map((item) =>
      item.key === 'qortino'
        ? { ...item, h: 43 }
        : item.key === 'tools'
          ? { ...item, y: 43, h: 21 }
          : item
    );
    expect(normalizeHomeGrid(namesShown)).toEqual(homeDefaultGrid());
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
    expect(at(normal, 'workspace')).toMatchObject({ x: 18, w: 6, h: 20 });
  });
});

describe('copies of the Workspace', () => {
  const copy = homeWorkspaceCopyId('k1');

  it('keeps a copy only while the layout lists it', () => {
    const stored = [
      ...homeDefaultGrid(),
      { key: copy, x: 0, y: 223, w: 6, h: 26 },
    ];
    expect(at(normalizeHomeGrid(stored), copy)).toBeUndefined();
    expect(rect(normalizeHomeGrid(stored, undefined, [copy]), copy)).toEqual([
      0, 223, 6, 26,
    ]);
    // One the grid lacks goes under everything (the Video publisher, last
    // by default, ends at 223), as big as the Workspace.
    expect(
      rect(normalizeHomeGrid(homeDefaultGrid(), undefined, [copy]), copy)
    ).toEqual([0, 223, 6, 20]);
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
    expect(rect(grid, 'workspace')).toEqual([0, 0, 6, 20]);
    expect(rect(grid, copy)).toEqual([0, 20, 6, 20]);
    expect(rect(grid, 'qortino')).toEqual([0, 40, 6, 23]);
    expect(rect(grid, 'tools')).toEqual([0, 63, 6, 21]);
    // The other columns stay as they were.
    for (const key of ['account', 'featured', 'status', 'wallet'] as const) {
      expect(at(grid, key)).toEqual(at(homeDefaultGrid(), key));
    }
    expect(rect(grid, 'widgets')).toEqual([0, 84, 24, 20]);
  });

  it('leaves the hidden windows where they were', () => {
    const grid = homeGridWithWindowUnder(homeDefaultGrid(), 'workspace', copy, [
      'qortino',
    ]);
    expect(rect(grid, copy)).toEqual([0, 20, 6, 20]);
    // Shown, Quick Tools goes under the new window...
    expect(rect(grid, 'tools')).toEqual([0, 40, 6, 21]);
    // ...and hidden, Qortino keeps its place.
    expect(rect(grid, 'qortino')).toEqual([0, 20, 6, 23]);
  });

  it('adds it under everything when the other window is not there to go under', () => {
    const grid = homeGridWithWindowUnder(homeDefaultGrid(), 'workspace', copy, [
      'workspace',
    ]);
    expect(rect(grid, copy)).toEqual([0, 223, 6, 20]);
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
    expect(rect(shown, 'tools')).toEqual([0, 0, 6, 21]);
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

  it('keeps Featured Q-Apps level with the other columns under a short account card', () => {
    const grid = homeDefaultGrid();
    const shown = homeGridShown(grid, () => true, { account: 16 });
    expect(rect(shown, 'account')).toEqual([6, 0, 12, 16]);
    // It takes the 4 rows the card leaves, and ends where it did.
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 48]);
    const bottom = (key: HomeWindowId) => {
      const item = at(shown, key)!;
      return item.y + item.h;
    };
    expect(bottom('featured')).toBe(bottom('wallet'));
    expect(bottom('featured')).toBe(bottom('tools'));
  });

  it('leaves Featured Q-Apps at its own height under a short account card when the windows flow', () => {
    const shown = homeGridShown(
      homeDefaultGrid(),
      () => true,
      { account: 16 },
      true
    );
    expect(rect(shown, 'account')).toEqual([6, 0, 12, 16]);
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 44]);
  });

  it('never makes the window under the account card taller than a window can be', () => {
    // Saved while the card was 60 rows tall, over a 230-row Featured Q-Apps.
    const grid = homeDefaultGrid().map((item) =>
      item.key === 'account'
        ? { ...item, h: 60 }
        : item.key === 'featured'
          ? { ...item, y: 60, h: 230 }
          : item
    );
    const shown = homeGridShown(grid, () => true, { account: 16 });
    // 240 rows is the tallest a window can be made.
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 240]);
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
    expect(rect(saved, 'workspace')).toEqual([0, 0, 6, 20]);
    expect(rect(saved, 'qortino')).toEqual([0, 20, 6, 23]);
  });
});

describe('saving under a short account card', () => {
  /** A new account's card: 16 rows in a place of 20. */
  const SHORT_CARD = { account: 16 };

  /**
   * An edit as Home makes it: from what's shown, to what the drag shows, to
   * what's saved and shown after.
   */
  const edit = (
    grid: readonly HomeGridItem[],
    hidden: readonly HomeWindowId[],
    change: (start: HomeGridItem[]) => HomeGridItem[]
  ) => {
    const isShown = (key: HomeWindowId) => !hidden.includes(key);
    const start = homeGridShown(grid, isShown, SHORT_CARD);
    const edited = homeGridEdited(grid, start, change(start));
    const preview = homeGridShown(edited, () => true, SHORT_CARD);
    const saved = normalizeHomeGrid(
      mergeHomeGrid(grid, edited),
      undefined,
      [],
      [...hidden]
    );
    return { preview, saved, shown: homeGridShown(saved, isShown, SHORT_CARD) };
  };

  it('keeps the card’s place and Featured Q-Apps’ height when another window moves', () => {
    const { preview, saved, shown } = edit(homeDefaultGrid(), [], (start) =>
      moveHomeWindow(start, 'wallet', 18, 0)
    );
    expect(rect(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(saved, 'featured')).toEqual([6, 20, 12, 44]);
    expect(shown).toEqual(preview);
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 48]);
  });

  it('shows after the drop what the drag showed, with a window hidden', () => {
    // Qortino hidden, then the account card moved under Quick Tools.
    const { preview, saved, shown } = edit(
      homeDefaultGrid(),
      ['qortino'],
      (start) => moveHomeWindow(start, 'account', 0, 18)
    );
    expect(shown).toEqual(preview);
    // No longer under the card, Featured Q-Apps has its own height.
    expect(at(saved, 'featured')?.h).toBe(44);
    expect(rect(saved, 'qortino')).toEqual([0, 20, 6, 23]);
  });

  it('shows after the drop what the drag showed when a window goes between the two', () => {
    const { preview, saved, shown } = edit(homeDefaultGrid(), [], (start) =>
      moveHomeWindow(start, 'tools', 6, 10)
    );
    expect(at(saved, 'tools')?.y).toBeLessThan(at(saved, 'featured')?.y);
    expect(shown).toEqual(preview);
    expect(at(saved, 'featured')?.h).toBe(44);
  });

  it('shows after the drop what the drag showed when Featured Q-Apps is made wider', () => {
    const { preview, saved, shown } = edit(homeDefaultGrid(), [], (start) =>
      resizeHomeWindow(start, 'featured', 13, at(start, 'featured').h)
    );
    expect(shown).toEqual(preview);
    // The card keeps its place, and Featured Q-Apps its own height under it.
    expect(rect(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(saved, 'featured')).toEqual([6, 20, 13, 44]);
  });

  /** Where a window ends, in rows. */
  const bottom = (items: readonly HomeGridItem[], key: HomeWindowId) => {
    const item = at(items, key);
    return item.y + item.h;
  };

  it('keeps Featured Q-Apps level after it is made wider and back', () => {
    const wider = edit(homeDefaultGrid(), [], (start) =>
      resizeHomeWindow(start, 'featured', 13, at(start, 'featured').h)
    );
    expect(rect(wider.saved, 'account')).toEqual([6, 0, 12, 20]);

    const back = edit(wider.saved, [], (start) =>
      resizeHomeWindow(start, 'featured', 12, at(start, 'featured').h)
    );
    expect(back.shown).toEqual(back.preview);
    expect(rect(back.saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(back.shown, 'featured')).toEqual([6, 16, 12, 48]);
    expect(bottom(back.shown, 'featured')).toBe(bottom(back.shown, 'tools'));
    expect(bottom(back.shown, 'featured')).toBe(bottom(back.shown, 'wallet'));
  });

  it('keeps Featured Q-Apps level after the card is made wider and back', () => {
    const wider = edit(homeDefaultGrid(), [], (start) =>
      resizeHomeWindow(start, 'account', 13, at(start, 'account').h)
    );
    expect(wider.shown).toEqual(wider.preview);
    expect(rect(wider.saved, 'account')).toEqual([6, 0, 13, 20]);

    const back = edit(wider.saved, [], (start) =>
      resizeHomeWindow(start, 'account', 12, at(start, 'account').h)
    );
    expect(back.shown).toEqual(back.preview);
    expect(rect(back.saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(back.shown, 'featured')).toEqual([6, 16, 12, 48]);
    expect(bottom(back.shown, 'featured')).toBe(bottom(back.shown, 'tools'));
    expect(bottom(back.shown, 'featured')).toBe(bottom(back.shown, 'wallet'));
  });

  it('keeps Featured Q-Apps level after the card is made narrower, so taller, and back', () => {
    const all = () => true;
    // Narrower, the card puts its avatar above its details: 32 rows.
    const NARROW_CARD = { account: 32 };
    const grid = homeDefaultGrid();
    const narrowStart = homeGridShown(grid, all, SHORT_CARD);
    const narrow = normalizeHomeGrid(
      mergeHomeGrid(
        grid,
        homeGridEdited(
          grid,
          narrowStart,
          resizeHomeWindow(
            narrowStart,
            'account',
            8,
            at(narrowStart, 'account').h
          )
        )
      )
    );
    expect(rect(narrow, 'account')).toEqual([6, 0, 8, 20]);

    // Made as wide again: the drag starts from the 32 rows it measured.
    const start = homeGridShown(narrow, all, NARROW_CARD);
    const edited = homeGridEdited(
      narrow,
      start,
      resizeHomeWindow(start, 'account', 12, at(start, 'account').h)
    );
    const saved = normalizeHomeGrid(mergeHomeGrid(narrow, edited));
    expect(rect(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(saved, 'featured')).toEqual([6, 20, 12, 44]);
    // Back at 16 rows: as the drag showed it, level with the other columns.
    const shown = homeGridShown(saved, all, SHORT_CARD);
    expect(shown).toEqual(homeGridShown(edited, all, SHORT_CARD));
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 48]);
    expect(bottom(shown, 'featured')).toBe(bottom(shown, 'tools'));
    expect(bottom(shown, 'featured')).toBe(bottom(shown, 'wallet'));
  });

  it('saves the card at its place, and the height given to the window under it, when that window is resized', () => {
    // Featured Q-Apps, 48 rows on screen, made 53.
    const { preview, saved, shown } = edit(homeDefaultGrid(), [], (start) =>
      resizeHomeWindow(start, 'featured', 12, 53)
    );
    expect(rect(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(shown).toEqual(preview);
    expect(rect(shown, 'featured')).toEqual([6, 16, 12, 53]);
  });

  it('saves the layout as it is when the card fills its place', () => {
    const grid = homeDefaultGrid();
    const start = homeGridShown(grid, () => true, { account: 20 });
    const next = moveHomeWindow(start, 'wallet', 18, 0);
    expect(homeGridEdited(grid, start, next)).toEqual(next);
  });

  it('leaves Quick Tools as it is when the window under it got a new height during the edit', () => {
    // A widget's window right under Quick Tools, as wide.
    const clock = 'widget:Clock:' as HomeWidgetWindowId;
    const grid: HomeGridItem[] = [
      ...homeDefaultGrid().filter((item) => item.y < 64),
      { key: clock, x: 0, y: 64, w: 6, h: 40 },
    ];
    const start = homeGridShown(grid, () => true, SHORT_CARD);
    const next = moveHomeWindow(start, 'wallet', 18, 0);
    // While the move went on, its widget asked for 27 rows instead of 40.
    const stored = grid.map((item) =>
      item.key === clock ? { ...item, h: 27 } : item
    );
    const edited = homeGridEdited(stored, start, next);
    // Quick Tools left it no rows: both are saved as the move has them.
    expect(rect(edited, 'tools')).toEqual([0, 43, 6, 21]);
    expect(rect(edited, clock)).toEqual(rect(next, clock));
    // The card did leave Featured Q-Apps its 4 rows.
    expect(rect(edited, 'account')).toEqual([6, 0, 12, 20]);
    expect(rect(edited, 'featured')).toEqual([6, 20, 12, 44]);
  });
});

describe('under a Widgets window shorter than when it was saved', () => {
  // Widgets made half as wide, over Group Activity, and saved while it held
  // tall widgets (290 rows). Here it holds fewer: 80 rows.
  const grid = (): HomeGridItem[] => [
    ...homeDefaultGrid().filter((item) => item.y < 64),
    { key: 'widgets', x: 0, y: 64, w: 12, h: 290 },
    { key: 'feed', x: 12, y: 64, w: 12, h: 63 },
    { key: 'groupActivity', x: 0, y: 354, w: 12, h: 63 },
  ];
  const MEASURED = { account: 20, widgets: 80 };

  it('lets the window under it rise, at its own height', () => {
    const shown = homeGridShown(grid(), () => true, MEASURED);
    expect(rect(shown, 'widgets')).toEqual([0, 64, 12, 80]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 144, 12, 63]);
  });

  it('saves a window moved away from under it at its own height', () => {
    const stored = grid();
    const start = homeGridShown(stored, () => true, MEASURED);
    expect(rect(start, 'groupActivity')).toEqual([0, 144, 12, 63]);
    // Group Activity goes above Widgets.
    const next = moveHomeWindow(start, 'groupActivity', 0, 64);
    const saved = normalizeHomeGrid(
      mergeHomeGrid(stored, homeGridEdited(stored, start, next))
    );
    expect(rect(saved, 'groupActivity')).toEqual([0, 64, 12, 63]);
  });
});

describe('mergeHomeGrid', () => {
  it('keeps where the hidden windows were', () => {
    const stored = homeDefaultGrid();
    const shown = homeGridShown(stored, (key) => key !== 'qortino');
    const merged = mergeHomeGrid(stored, shown);
    expect(rect(merged, 'qortino')).toEqual([0, 20, 6, 23]);
    expect(rect(merged, 'tools')).toEqual([0, 20, 6, 21]);
    // Shown again, Qortino takes its place back over Quick Tools.
    const again = homeGridShown(merged, () => true);
    expect(rect(again, 'workspace')).toEqual([0, 0, 6, 20]);
    expect(rect(again, 'qortino')).toEqual([0, 20, 6, 23]);
    expect(rect(again, 'tools')).toEqual([0, 43, 6, 21]);
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
    // Reading order: the Workspace, account, Status, Qortino, Featured,
    // Wallet, Tools...
    expect(rect(flowed, 'workspace')).toEqual([0, 0, 1, 20]);
    expect(rect(flowed, 'account')).toEqual([1, 0, 1, 20]);
    expect(rect(flowed, 'status')).toEqual([0, 20, 1, 33]);
    expect(rect(flowed, 'qortino')).toEqual([1, 20, 1, 23]);
    expect(rect(flowed, 'featured')).toEqual([1, 43, 1, 44]);
    expect(rect(flowed, 'wallet')).toEqual([0, 53, 1, 31]);
    expect(rect(flowed, 'tools')).toEqual([0, 84, 1, 21]);
    // Widgets spans both, under the lower column.
    expect(rect(flowed, 'widgets')).toEqual([0, 105, 2, 20]);
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
    expect(homeGridHeightPx(homeDefaultGrid())).toBe(2210);
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
    // Risen to the bottom of the Video publisher, the lowest in its columns.
    expect(rect(grid, clock)).toEqual([0, 223, 8, 30]);
    expect(rect(grid, weather)).toEqual([0, 253, 6, 27]);
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

    // Three copies make the left column 60 rows longer than the others.
    let layout = HOME_LAYOUT_DEFAULT as HomeLayout;
    for (const key of keys) {
      layout = save(withHomeWorkspaceCopy(layout, 'workspace', key));
    }
    const shown = homeView(layout).shown;
    expect(rect(shown, 'tools')).toEqual([0, 103, 6, 21]);
    // What was under them is still one under the other.
    expect(rect(shown, 'widgets')).toEqual([0, 124, 24, 20]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 144, 12, 63]);
    expect(rect(shown, 'feed')).toEqual([12, 144, 12, 63]);

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

    expect(rect(shown, 'widgets')).toEqual([0, 124, 24, 21]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 145, 12, 63]);
    expect(rect(shown, 'feed')).toEqual([12, 145, 12, 63]);
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
    expect(rect(before, 'workspace')).toEqual([18, 64, 6, 20]);
    expect(rect(before, 'widgets')).toEqual([0, 84, 24, 20]);

    const added = save(withHomeWorkspaceCopy(layout, 'workspace', 'k1'));

    const shown = homeView(added).shown;
    expect(rect(shown, homeWorkspaceCopyId('k1'))).toEqual([18, 84, 6, 20]);
    // Widgets and what is under it make room, still one under the other.
    expect(rect(shown, 'widgets')).toEqual([0, 104, 24, 20]);
    expect(rect(shown, 'groupActivity')).toEqual([0, 124, 12, 63]);
    expect(rect(shown, 'feed')).toEqual([12, 124, 12, 63]);
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
