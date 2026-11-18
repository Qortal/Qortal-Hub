/** A tab's width while every tab fits. */
export const TAB_IDEAL_WIDTH_PX = 180;
/** Tabs shrink evenly down to this width; below it the strip scrolls. */
export const TAB_MIN_WIDTH_PX = 72;
/** A tab narrower than this shows its icon instead of its title. */
export const TAB_LABEL_MIN_WIDTH_PX = 100;
/** A pinned tab shows only its icon, always this wide. */
export const PINNED_TAB_WIDTH_PX = 44;
/** The gap between tabs, and between the strip's parts. */
export const TAB_STRIP_GAP_PX = 2;
/** One wheel "line" in pixels, for wheels that report lines. */
const WHEEL_LINE_PX = 16;

export type TabStripLayoutInput = {
  /** The strip's inner width, without its padding. */
  availablePx: number;
  /** The width of the + button at the end of the strip. */
  addButtonPx: number;
  gapPx?: number;
  pinnedCount: number;
  unpinnedCount: number;
};

export type TabStripLayout = {
  /** The width of each tab that isn't pinned. */
  tabWidthPx: number;
  /** The width of the pinned tabs together, 0 without any. */
  pinnedGroupPx: number;
  /** The room left for the other tabs, between the pinned ones and the +. */
  tabsAreaPx: number;
  /** True when the other tabs don't fit even at the minimum width. */
  scrolls: boolean;
};

/** The width of `count` tabs side by side. */
export function tabGroupWidth(
  count: number,
  tabWidthPx: number,
  gapPx = TAB_STRIP_GAP_PX
): number {
  return count > 0 ? count * tabWidthPx + (count - 1) * gapPx : 0;
}

/**
 * The tab widths for a strip: pinned tabs first, at their own fixed width,
 * then the + button; the other tabs share what is left. They stay at the
 * ideal width while they fit, then shrink evenly, but never below the
 * minimum: from there on the strip scrolls instead.
 */
export function layoutTabStrip({
  availablePx,
  addButtonPx,
  gapPx = TAB_STRIP_GAP_PX,
  pinnedCount,
  unpinnedCount,
}: TabStripLayoutInput): TabStripLayout {
  const pinnedGroupPx = tabGroupWidth(pinnedCount, PINNED_TAB_WIDTH_PX, gapPx);
  // The strip's parts: the pinned tabs, the other tabs and the + button.
  const parts = (pinnedCount > 0 ? 1 : 0) + (unpinnedCount > 0 ? 1 : 0) + 1;
  const tabsAreaPx = Math.max(
    0,
    availablePx - addButtonPx - pinnedGroupPx - (parts - 1) * gapPx
  );

  if (
    unpinnedCount <= 0 ||
    tabGroupWidth(unpinnedCount, TAB_IDEAL_WIDTH_PX, gapPx) <= tabsAreaPx
  ) {
    return {
      pinnedGroupPx,
      scrolls: false,
      tabWidthPx: TAB_IDEAL_WIDTH_PX,
      tabsAreaPx,
    };
  }

  const evenPx = Math.floor(
    (tabsAreaPx - (unpinnedCount - 1) * gapPx) / unpinnedCount
  );
  if (evenPx >= TAB_MIN_WIDTH_PX) {
    return { pinnedGroupPx, scrolls: false, tabWidthPx: evenPx, tabsAreaPx };
  }
  return {
    pinnedGroupPx,
    scrolls: true,
    tabWidthPx: TAB_MIN_WIDTH_PX,
    tabsAreaPx,
  };
}

/** Whether a tab this wide has room for its title. */
export function tabShowsLabel(tabWidthPx: number): boolean {
  return tabWidthPx >= TAB_LABEL_MIN_WIDTH_PX;
}

/**
 * How far one wheel event moves the strip sideways, in pixels. A mouse wheel
 * turns up and down, so its vertical turn moves the strip; a touchpad that
 * swipes sideways moves it by its own sideways amount.
 */
export function wheelScrollPx(
  event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>,
  pagePx: number
): number {
  const delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
  if (event.deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (event.deltaMode === 2) return delta * pagePx;
  return delta;
}

/**
 * The scroll position that brings the span from `startPx` to `endPx` into a
 * view `viewPx` wide, moving as little as possible.
 */
export function scrollLeftToShow({
  endPx,
  scrollLeft,
  startPx,
  viewPx,
}: {
  endPx: number;
  scrollLeft: number;
  startPx: number;
  viewPx: number;
}): number {
  if (startPx < scrollLeft) return startPx;
  if (endPx > scrollLeft + viewPx) return Math.min(startPx, endPx - viewPx);
  return scrollLeft;
}
