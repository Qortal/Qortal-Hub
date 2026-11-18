import { describe, expect, it } from 'vitest';
import {
  type HomeGridItem,
  type HomeWidgetWindowId,
  type HomeWindowId,
  homeDefaultGrid,
  homeGridCellAt,
  homeGridColumnPx,
  homeGridEdited,
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
    expect(rect(grid, 'qortino')).toEqual([0, 0, 6, 43]);
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

describe('homeGridShown', () => {
  it('closes the room a hidden window leaves', () => {
    const grid = homeDefaultGrid();
    const shown = homeGridShown(grid, (key) => key !== 'qortino');
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
    expect(rect(saved, 'qortino')).toEqual([0, 0, 6, 43]);
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
    expect(rect(saved, 'qortino')).toEqual([0, 0, 6, 46]);
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
    expect(rect(edited, 'tools')).toEqual([0, 46, 6, 18]);
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
    expect(rect(merged, 'qortino')).toEqual([0, 0, 6, 43]);
    expect(rect(merged, 'tools')).toEqual([0, 0, 6, 21]);
    // Shown again, Qortino takes its place back over Quick Tools.
    const again = homeGridShown(merged, () => true);
    expect(rect(again, 'qortino')).toEqual([0, 0, 6, 43]);
    expect(rect(again, 'tools')).toEqual([0, 43, 6, 21]);
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
    expect(rect(flowed, 'qortino')).toEqual([0, 0, 1, 43]);
    expect(rect(flowed, 'account')).toEqual([1, 0, 1, 20]);
    expect(rect(flowed, 'status')).toEqual([1, 20, 1, 33]);
    expect(rect(flowed, 'featured')).toEqual([0, 43, 1, 44]);
    expect(rect(flowed, 'wallet')).toEqual([1, 53, 1, 31]);
    expect(rect(flowed, 'tools')).toEqual([1, 84, 1, 21]);
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
