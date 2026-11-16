import { describe, expect, it } from 'vitest';
import {
  PINNED_TAB_WIDTH_PX,
  TAB_IDEAL_WIDTH_PX,
  TAB_MIN_WIDTH_PX,
  layoutTabStrip,
  scrollLeftToShow,
  tabGroupWidth,
  tabShowsLabel,
  wheelScrollPx,
} from './tabStripLayout';

const ADD = 34;
const GAP = 2;

/** The strip's inner width that holds `count` tabs at `width`, exactly. */
const roomFor = (count: number, width: number, pinnedCount = 0) =>
  tabGroupWidth(pinnedCount, PINNED_TAB_WIDTH_PX, GAP) +
  (pinnedCount > 0 ? GAP : 0) +
  tabGroupWidth(count, width, GAP) +
  GAP +
  ADD;

const layout = (availablePx: number, unpinnedCount: number, pinnedCount = 0) =>
  layoutTabStrip({
    addButtonPx: ADD,
    availablePx,
    gapPx: GAP,
    pinnedCount,
    unpinnedCount,
  });

describe('layoutTabStrip', () => {
  it('keeps tabs at 180 px while they all fit', () => {
    expect(layout(1600, 3)).toEqual({
      pinnedGroupPx: 0,
      scrolls: false,
      tabWidthPx: TAB_IDEAL_WIDTH_PX,
      tabsAreaPx: 1600 - ADD - GAP,
    });
    expect(layout(roomFor(5, 180), 5).tabWidthPx).toBe(180);
  });

  it('shrinks all tabs evenly once they no longer fit at 180 px', () => {
    const fits = layout(roomFor(5, 180) - 1, 5);
    expect(fits.tabWidthPx).toBe(179);
    expect(fits.scrolls).toBe(false);

    const result = layout(roomFor(6, 120), 6);
    expect(result).toMatchObject({ scrolls: false, tabWidthPx: 120 });
    // What the tabs take never goes past the room they have.
    expect(tabGroupWidth(6, result.tabWidthPx, GAP)).toBeLessThanOrEqual(
      result.tabsAreaPx
    );
  });

  it('rounds a shared width down, so the tabs never overflow by a fraction', () => {
    const result = layout(roomFor(4, 100) + 3, 4);
    expect(result.tabWidthPx).toBe(100);
  });

  it('stops at 72 px and scrolls when even that is too wide', () => {
    expect(layout(roomFor(8, TAB_MIN_WIDTH_PX), 8)).toMatchObject({
      scrolls: false,
      tabWidthPx: TAB_MIN_WIDTH_PX,
    });
    expect(layout(roomFor(8, TAB_MIN_WIDTH_PX) - 1, 8)).toMatchObject({
      scrolls: true,
      tabWidthPx: TAB_MIN_WIDTH_PX,
    });
    expect(layout(300, 10)).toMatchObject({
      scrolls: true,
      tabWidthPx: TAB_MIN_WIDTH_PX,
    });
  });

  it('takes the pinned tabs out first, at their own width', () => {
    const result = layout(roomFor(3, 180, 2), 3, 2);
    expect(result).toMatchObject({
      pinnedGroupPx: 2 * PINNED_TAB_WIDTH_PX + GAP,
      scrolls: false,
      tabWidthPx: 180,
    });
    // The same strip without the room for the pinned tabs shrinks the rest.
    expect(layout(roomFor(3, 180), 3, 2).tabWidthPx).toBeLessThan(180);
    expect(layout(roomFor(4, 90, 3), 4, 3).tabWidthPx).toBe(90);
  });

  it('copes with only pinned tabs, no tabs, and no room', () => {
    expect(layout(400, 0, 3)).toMatchObject({
      pinnedGroupPx: 3 * PINNED_TAB_WIDTH_PX + 2 * GAP,
      scrolls: false,
      tabWidthPx: TAB_IDEAL_WIDTH_PX,
    });
    expect(layout(400, 0, 0).pinnedGroupPx).toBe(0);
    expect(layout(0, 2)).toMatchObject({
      scrolls: true,
      tabWidthPx: TAB_MIN_WIDTH_PX,
      tabsAreaPx: 0,
    });
  });
});

describe('tabShowsLabel', () => {
  it('hides the title on tabs narrower than 100 px', () => {
    expect(tabShowsLabel(180)).toBe(true);
    expect(tabShowsLabel(100)).toBe(true);
    expect(tabShowsLabel(99)).toBe(false);
    expect(tabShowsLabel(TAB_MIN_WIDTH_PX)).toBe(false);
  });
});

describe('wheelScrollPx', () => {
  it('turns a mouse wheel’s vertical turn into a sideways move', () => {
    expect(wheelScrollPx({ deltaMode: 0, deltaX: 0, deltaY: 100 }, 500)).toBe(
      100
    );
    expect(wheelScrollPx({ deltaMode: 0, deltaX: 0, deltaY: -53 }, 500)).toBe(
      -53
    );
  });

  it('follows a sideways swipe when it is the larger move', () => {
    expect(wheelScrollPx({ deltaMode: 0, deltaX: -40, deltaY: 5 }, 500)).toBe(
      -40
    );
  });

  it('turns lines and pages into pixels', () => {
    expect(wheelScrollPx({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 500)).toBe(48);
    expect(wheelScrollPx({ deltaMode: 2, deltaX: 0, deltaY: -1 }, 500)).toBe(
      -500
    );
  });
});

describe('scrollLeftToShow', () => {
  const view = { scrollLeft: 200, viewPx: 300 };

  it('leaves a tab that is already in view alone', () => {
    expect(scrollLeftToShow({ ...view, endPx: 400, startPx: 250 })).toBe(200);
  });

  it('scrolls back to a tab on the left', () => {
    expect(scrollLeftToShow({ ...view, endPx: 222, startPx: 150 })).toBe(150);
  });

  it('scrolls on to a tab on the right, just far enough', () => {
    expect(scrollLeftToShow({ ...view, endPx: 572, startPx: 500 })).toBe(272);
  });

  it('shows the start of a tab wider than the view', () => {
    expect(scrollLeftToShow({ ...view, endPx: 900, startPx: 520 })).toBe(520);
  });
});
