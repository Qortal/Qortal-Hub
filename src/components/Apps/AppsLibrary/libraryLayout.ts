/** Sizes and timings of the launcher library. */

/** Four columns fit beside the side bar at a 1900 px window. */
export const APP_CARD_MIN_WIDTH = 300;
/** Every app card has this height, so the grid can be virtual. */
export const APP_CARD_HEIGHT = 220;
export const GRID_GAP = 16;
export const APP_ROW_HEIGHT = 72;
/**
 * A list row is never narrower than this while the list has two columns: the
 * icon, a readable name and, on My apps, Update + pin + Download (German
 * "Aktualisieren" and "Herunterladen") still fit. Two rows sit side by side
 * from twice this.
 */
export const APP_ROW_MIN_WIDTH = 520;
export const LIST_GAP = 8;
/** A list has one column, or two side by side when they fit; never more. */
export const LIST_MAX_COLUMNS = 2;

export const CATEGORY_TILE_MIN_WIDTH = 168;
export const CATEGORY_TILE_HEIGHT = 120;
export const CATEGORY_ROW_HEIGHT = 56;
/** The icon, a name of about 20 characters, its count and the arrow. */
export const CATEGORY_ROW_MIN_WIDTH = 300;
export const CATEGORY_GAP = 12;
export const CATEGORY_LIST_GAP = 6;

export const PRIVATE_TILE_MIN_WIDTH = 280;
export const PRIVATE_TILE_HEIGHT = 148;
export const PRIVATE_ROW_HEIGHT = 64;
/** The lock, the identifier and its details, Update and Open. */
export const PRIVATE_ROW_MIN_WIDTH = 460;

export const FEATURED_CARD_WIDTH = 184;
/**
 * Fits its column without squeezing anything: a 60 px icon, a 20 px title,
 * two 35 px lines of description, the 18 px rating and the 32 px Open, four
 * 8 px gaps, 14 px of padding and a 1 px border on each side.
 */
export const FEATURED_CARD_HEIGHT = 228;
export const FEATURED_GAP = 12;
/**
 * Room round the Featured row's cards: the row clips what goes past it, so a
 * hovered card's lift and shadow fit inside this.
 */
export const FEATURED_TRACK_PADDING = { block: 8, inline: 8, bottom: 14 };

/** One grid-or-list choice per device, for every library tab. */
export const LIBRARY_VIEW_STORAGE_KEY = 'launcher-library-view-v1';

/** How long an empty library counts as still loading. */
export const LOADING_GRACE_MS = 12000;
/**
 * How long a card waits for its rating before it shows none. Most apps have
 * no rating poll, and some nodes never send an entry for them.
 */
export const RATING_GRACE_MS = 3000;
/** One turn of the refresh icon. */
export const REFRESH_TURN_MS = 800;
/** One pulse of the refresh icon, when the system asks for less motion. */
export const REFRESH_PULSE_MS = 900;
/** How long the check shows after a refresh. */
export const REFRESH_DONE_MS = 1200;

/**
 * A CSS grid template with as many columns of at least `minWidth` as fit, and
 * at most `maxColumns` of them (left out, no limit). With a limit, a column
 * also never gets wider than the grid, so a narrow grid has one column of its
 * own width instead of one that spills out.
 */
export const fittedColumnsTemplate = (
  minWidth: number,
  gap: number,
  maxColumns?: number
): string => {
  if (!maxColumns) return `repeat(auto-fill, minmax(${minWidth}px, 1fr))`;
  if (maxColumns <= 1) return 'minmax(0, 1fr)';
  // A column takes at least its share of `maxColumns`, so no more fit.
  const share = `calc((100% - ${gap * (maxColumns - 1)}px) / ${maxColumns})`;
  return `repeat(auto-fill, minmax(min(100%, max(${minWidth}px, ${share})), 1fr))`;
};

export type CollectionMetrics = {
  /** A fixed number of columns; left out, as many as fit. */
  columns: number | undefined;
  minColumnWidth: number;
  /** The most columns that fit are used, up to this; left out, no limit. */
  maxColumns: number | undefined;
  rowHeight: number;
  gap: number;
};

/** How a collection of apps is laid out in each view. */
export const appCollectionMetrics = (
  view: 'grid' | 'list'
): CollectionMetrics =>
  view === 'list'
    ? {
        columns: undefined,
        minColumnWidth: APP_ROW_MIN_WIDTH,
        maxColumns: LIST_MAX_COLUMNS,
        rowHeight: APP_ROW_HEIGHT,
        gap: LIST_GAP,
      }
    : {
        columns: undefined,
        minColumnWidth: APP_CARD_MIN_WIDTH,
        maxColumns: undefined,
        rowHeight: APP_CARD_HEIGHT,
        gap: GRID_GAP,
      };

export type SkeletonShape = {
  grid: { minWidth: number; height: number; gap: number };
  /** Rows in columns of at least `minWidth`, at most `maxColumns` of them. */
  list: { minWidth: number; maxColumns: number; height: number; gap: number };
};

/** Placeholders shaped like the items they stand in for. */
export const APP_SKELETON: SkeletonShape = {
  grid: {
    minWidth: APP_CARD_MIN_WIDTH,
    height: APP_CARD_HEIGHT,
    gap: GRID_GAP,
  },
  list: {
    minWidth: APP_ROW_MIN_WIDTH,
    maxColumns: LIST_MAX_COLUMNS,
    height: APP_ROW_HEIGHT,
    gap: LIST_GAP,
  },
};

export const CATEGORY_SKELETON: SkeletonShape = {
  grid: {
    minWidth: CATEGORY_TILE_MIN_WIDTH,
    height: CATEGORY_TILE_HEIGHT,
    gap: CATEGORY_GAP,
  },
  list: {
    minWidth: CATEGORY_ROW_MIN_WIDTH,
    maxColumns: LIST_MAX_COLUMNS,
    height: CATEGORY_ROW_HEIGHT,
    gap: CATEGORY_LIST_GAP,
  },
};

export const PRIVATE_SKELETON: SkeletonShape = {
  grid: {
    minWidth: PRIVATE_TILE_MIN_WIDTH,
    height: PRIVATE_TILE_HEIGHT,
    gap: GRID_GAP,
  },
  list: {
    minWidth: PRIVATE_ROW_MIN_WIDTH,
    maxColumns: LIST_MAX_COLUMNS,
    height: PRIVATE_ROW_HEIGHT,
    gap: LIST_GAP,
  },
};
