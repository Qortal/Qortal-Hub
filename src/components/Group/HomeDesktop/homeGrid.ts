import type { GridRect } from '../../HomeWidgets/widgetGrid';
import type { HomePanelId, HomeStackPanelId } from './homeLayout';

/**
 * Home's windows on one grid, saved per account with the rest of the Home
 * layout (homeLayout.ts).
 *
 * - 24 columns as wide as Home is, so a window keeps its share of the width
 *   on any screen. Rows are a 10 px unit, and windows stay 20 px apart.
 * - A window is a block of cells (x, y, w, h). Blocks never overlap, and each
 *   rises as far as it can, so no empty band is ever left above a window.
 * - A window being moved changes places with a window it shares columns with
 *   once its leading edge passes that window's middle. A window being resized
 *   keeps its top left corner and pushes what it reaches further down.
 * - The account card and Widgets only take a width: their height follows
 *   their content (HOME_AUTO_HEIGHT_WINDOWS).
 * - Besides Home's own windows there are the widgets the account put in
 *   windows of their own (`widget:…` keys, homeWidgetWindowId), listed with
 *   the layout.
 * - When Home is narrower than HOME_GRID_MIN_WIDTH_PX, the windows flow in
 *   the same order into two columns, or one on a narrow window, instead.
 *
 * Everything here is pure.
 */
/** Home's own windows. */
export type HomeFixedWindowId = 'account' | HomePanelId;

/** A Q-App widget in a window of its own: `widget:<name>:<identifier>`. */
export type HomeWidgetWindowId = `widget:${string}`;

export type HomeWindowId = HomeFixedWindowId | HomeWidgetWindowId;

export type HomeGridItem = GridRect & { key: HomeWindowId };

export const HOME_GRID_COLUMNS = 24;
export const HOME_GRID_ROW_PX = 10;
export const HOME_GRID_GAP_PX = 20;
/** Narrower than this, Home flows its windows into columns (homeGridFlow). */
export const HOME_GRID_MIN_WIDTH_PX = 1100;
export const HOME_GRID_TWO_COLUMNS_MIN_WIDTH_PX = 700;
const HOME_GRID_MAX_H = 240;
/**
 * A window that follows its content takes all of its measured height; this
 * only guards against a measurement gone wrong.
 */
const HOME_GRID_MAX_MEASURED_H = 10_000;
const HOME_GRID_MAX_Y = 100_000;

/** Home's own windows, in the order the settings and the menus list them. */
export const HOME_WINDOW_IDS: readonly HomeFixedWindowId[] = [
  'account',
  'qortino',
  'tools',
  'featured',
  'status',
  'wallet',
  'widgets',
  'groupActivity',
  'feed',
];

/** Windows whose height follows their content. */
export const HOME_AUTO_HEIGHT_WINDOWS: ReadonlySet<HomeWindowId> = new Set([
  'account',
  'widgets',
]);

/** The tallest a window can be, in rows. */
const maxHeightOf = (key: HomeWindowId) =>
  HOME_AUTO_HEIGHT_WINDOWS.has(key)
    ? HOME_GRID_MAX_MEASURED_H
    : HOME_GRID_MAX_H;

/**
 * The smallest a window can be made, in columns and rows: what its content
 * still fits in once it has adapted to the size (the narrowest layouts and
 * scrolling lists). The height of a window that follows its content is only
 * a floor until it has been measured.
 */
export const HOME_WINDOW_MIN_SIZE: Record<
  HomeFixedWindowId,
  { w: number; h: number }
> = {
  account: { w: 8, h: 3 },
  qortino: { w: 5, h: 34 },
  tools: { w: 4, h: 14 },
  featured: { w: 7, h: 32 },
  status: { w: 5, h: 20 },
  wallet: { w: 5, h: 26 },
  widgets: { w: 6, h: 3 },
  groupActivity: { w: 7, h: 34 },
  feed: { w: 7, h: 34 },
};

/** A widget's window: a clock's size at the least. */
export const HOME_WIDGET_WINDOW_MIN_SIZE = { w: 3, h: 10 };
/** A new widget's window: about a phone's width, as in the Widgets window. */
export const HOME_WIDGET_WINDOW_DEFAULT_SIZE = { w: 6, h: 27 };

/** The key of a widget's own window. */
export const homeWidgetWindowId = (widget: {
  name: string;
  identifier: string | null;
}): HomeWidgetWindowId =>
  `widget:${encodeURIComponent(widget.name)}:${encodeURIComponent(
    widget.identifier ?? ''
  )}`;

export const isHomeWidgetWindowId = (
  value: unknown
): value is HomeWidgetWindowId =>
  typeof value === 'string' && value.startsWith('widget:');

export const homeWindowMinSize = (key: HomeWindowId) =>
  isHomeWidgetWindowId(key)
    ? HOME_WIDGET_WINDOW_MIN_SIZE
    : HOME_WINDOW_MIN_SIZE[key];

/** The top of the default layout: today's three columns. */
const HOME_GRID_TOP: Record<
  Exclude<HomeFixedWindowId, HomeStackPanelId>,
  GridRect
> = {
  qortino: { x: 0, y: 0, w: 6, h: 46 },
  tools: { x: 0, y: 46, w: 6, h: 18 },
  account: { x: 6, y: 0, w: 12, h: 20 },
  featured: { x: 6, y: 20, w: 12, h: 44 },
  status: { x: 18, y: 0, w: 6, h: 33 },
  wallet: { x: 18, y: 33, w: 6, h: 31 },
};
const HOME_GRID_TOP_ROWS = 64;
/** Group Activity and the feed: 610 px, as before. */
const HOME_GRID_LIST_H = 63;
/** Widgets until its content has been measured. */
const HOME_GRID_WIDGETS_H = 20;

const int = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const isHomeFixedWindowId = (value: unknown): value is HomeFixedWindowId =>
  typeof value === 'string' &&
  (HOME_WINDOW_IDS as readonly string[]).includes(value);

const overlapsColumns = (a: GridRect, b: GridRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w;

const collides = (a: GridRect, b: GridRect) =>
  overlapsColumns(a, b) && a.y < b.y + b.h && b.y < a.y + a.h;

/** Inside the grid and within the window's sizes. */
export const clampHomeWindow = (
  item: Partial<GridRect> & { key: HomeWindowId }
): HomeGridItem => {
  const min = homeWindowMinSize(item.key);
  const w = clamp(int(item.w, min.w), min.w, HOME_GRID_COLUMNS);
  const h = clamp(int(item.h, min.h), min.h, maxHeightOf(item.key));
  return {
    key: item.key,
    x: clamp(int(item.x, 0), 0, HOME_GRID_COLUMNS - w),
    y: clamp(int(item.y, 0), 0, HOME_GRID_MAX_Y),
    w,
    h,
  };
};

/**
 * The windows placed in `rank` order, lowest first (ties keep the list's
 * order): each rises as far as it can and, if it lands on a window placed
 * before it, goes under that one. `fixed` stays exactly where it is.
 */
const settle = (
  items: readonly HomeGridItem[],
  rank: (item: HomeGridItem) => number,
  fixed?: HomeWindowId
): HomeGridItem[] => {
  const pinned = fixed ? items.find((item) => item.key === fixed) : undefined;
  const placed: HomeGridItem[] = pinned ? [pinned] : [];
  const queue = items
    .map((item, index) => ({ index, item, rank: rank(item) }))
    .filter(({ item }) => item !== pinned)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  for (const { item } of queue) {
    // Rise to the lowest bottom above it...
    let y = placed.reduce(
      (top, other) =>
        overlapsColumns(item, other) && other.y + other.h <= item.y
          ? Math.max(top, other.y + other.h)
          : top,
      0
    );
    // ...and go under anything it lands on.
    for (;;) {
      const probe = { ...item, y };
      const hit = placed.find((other) => collides(probe, other));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    placed.push({ ...item, y });
  }
  const byKey = new Map(placed.map((item) => [item.key, item]));
  return items.map((item) => byKey.get(item.key) ?? item);
};

/** Reading order: top first, then left first. */
const readingRank = (item: HomeGridItem) =>
  item.y * (HOME_GRID_COLUMNS + 1) + item.x;

/** Every window risen as far as it goes, in reading order. */
export const settleHomeGrid = (items: readonly HomeGridItem[]) =>
  settle(items, readingRank);

/**
 * The default layout: today's three columns at the top (Qortino over Quick
 * Tools, the account card over Featured Q-Apps, Node Status over Wallet
 * Activity), then the stack in its order. Group Activity and the feed share
 * a row when they're next to each other in it.
 */
export const homeDefaultGrid = (
  stack: readonly HomeStackPanelId[] = ['widgets', 'groupActivity', 'feed']
): HomeGridItem[] => {
  const items: HomeGridItem[] = (
    Object.keys(HOME_GRID_TOP) as (keyof typeof HOME_GRID_TOP)[]
  ).map((key) => ({ key, ...HOME_GRID_TOP[key] }));
  let y = HOME_GRID_TOP_ROWS;
  for (let index = 0; index < stack.length; index += 1) {
    const key = stack[index];
    const next = stack[index + 1];
    if (key === 'widgets') {
      items.push({ key, x: 0, y, w: 24, h: HOME_GRID_WIDGETS_H });
      y += HOME_GRID_WIDGETS_H;
    } else if (next && next !== 'widgets') {
      items.push({ key, x: 0, y, w: 12, h: HOME_GRID_LIST_H });
      items.push({ key: next, x: 12, y, w: 12, h: HOME_GRID_LIST_H });
      y += HOME_GRID_LIST_H;
      index += 1;
    } else {
      items.push({ key, x: 0, y, w: 24, h: HOME_GRID_LIST_H });
      y += HOME_GRID_LIST_H;
    }
  }
  return HOME_WINDOW_IDS.map((key) =>
    items.find((item) => item.key === key)
  ).filter(Boolean);
};

/**
 * A stored layout made whole: unknown and repeated windows dropped (a
 * widget's window too, unless `widgetWindows` lists it), every window inside
 * the grid and within its sizes, no overlaps, nothing left floating. A
 * window it lacks (one added later) goes under everything, at its default
 * size, Home's own windows first. Anything that isn't a list gives
 * undefined.
 *
 * The `hidden` windows keep their places, which the shown ones may have
 * taken: only the shown ones settle, so saving never changes what shows.
 */
export const normalizeHomeGrid = (
  value: unknown,
  stack?: readonly HomeStackPanelId[],
  widgetWindows: readonly HomeWidgetWindowId[] = [],
  hidden: readonly HomeWindowId[] = []
): HomeGridItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const known = (key: unknown): key is HomeWindowId =>
    isHomeFixedWindowId(key) ||
    (isHomeWidgetWindowId(key) && widgetWindows.includes(key));
  const items: HomeGridItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { key } = entry as { key?: unknown };
    if (!known(key) || items.some((item) => item.key === key)) {
      continue;
    }
    items.push(clampHomeWindow({ ...(entry as GridRect), key }));
  }
  if (items.length === 0) return undefined;
  const defaults = homeDefaultGrid(stack);
  let bottom = items.reduce((low, item) => Math.max(low, item.y + item.h), 0);
  for (const key of HOME_WINDOW_IDS) {
    if (items.some((item) => item.key === key)) continue;
    const start = defaults.find((item) => item.key === key);
    if (!start) continue;
    items.push({ ...start, y: bottom });
    bottom += start.h;
  }
  for (const key of widgetWindows) {
    if (items.some((item) => item.key === key)) continue;
    items.push({ key, x: 0, y: bottom, ...HOME_WIDGET_WINDOW_DEFAULT_SIZE });
    bottom += HOME_WIDGET_WINDOW_DEFAULT_SIZE.h;
  }
  const order: readonly HomeWindowId[] = [...HOME_WINDOW_IDS, ...widgetWindows];
  const ordered = order
    .map((key) => items.find((item) => item.key === key))
    .filter(Boolean);
  const settled = settleHomeGrid(
    ordered.filter((item) => !hidden.includes(item.key))
  );
  return ordered.map(
    (item) => settled.find((other) => other.key === item.key) ?? item
  );
};

export const sameHomeGrid = (
  a: readonly HomeGridItem[] | undefined,
  b: readonly HomeGridItem[] | undefined
) =>
  a === b ||
  (!!a &&
    !!b &&
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return (
        !!other &&
        item.key === other.key &&
        item.x === other.x &&
        item.y === other.y &&
        item.w === other.w &&
        item.h === other.h
      );
    }));

/**
 * `key` moved so its top left corner is at cell (x, y), from `items` as they
 * were when the move began (each step is worked out from there, so the
 * others go back when the pointer does). It changes places with a window it
 * shares columns with once its leading edge passes that window's middle: its
 * bottom edge going down, its top edge going up.
 */
export const moveHomeWindow = (
  items: readonly HomeGridItem[],
  key: HomeWindowId,
  x: number,
  y: number
): HomeGridItem[] => {
  const moving = items.find((item) => item.key === key);
  if (!moving) return [...items];
  const target = clampHomeWindow({ ...moving, x, y });
  const down = target.y > moving.y;
  const lead = down ? target.y + target.h : target.y;
  return settle(
    items.map((item) => (item.key === key ? target : item)),
    (item) =>
      item.key === key
        ? // Going down it follows a window whose middle is level with its
          // bottom edge; going up it goes before one level with its top.
          lead + (down ? 0.25 : -0.25)
        : item.y + item.h / 2
  );
};

/**
 * `key` made w × h cells, keeping its top left corner (moved left only when
 * the grid's right edge needs it). What it reaches goes under it.
 */
export const resizeHomeWindow = (
  items: readonly HomeGridItem[],
  key: HomeWindowId,
  w: number,
  h: number
): HomeGridItem[] => {
  const item = items.find((entry) => entry.key === key);
  if (!item) return [...items];
  const min = homeWindowMinSize(key);
  const width = clamp(int(w, item.w), min.w, HOME_GRID_COLUMNS);
  const resized = {
    ...item,
    x: Math.min(item.x, HOME_GRID_COLUMNS - width),
    w: width,
    h: clamp(int(h, item.h), min.h, maxHeightOf(key)),
  };
  return settleHomeGrid(
    settle(
      items.map((entry) => (entry.key === key ? resized : entry)),
      readingRank,
      key
    )
  );
};

/**
 * The windows Home shows, as it lays them out: the hidden ones left out, the
 * ones whose height follows their content at their measured height, and
 * everything risen into the room that leaves.
 */
export const homeGridShown = (
  grid: readonly HomeGridItem[],
  shown: (key: HomeWindowId) => boolean,
  measuredRows: Partial<Record<HomeWindowId, number>> = {}
): HomeGridItem[] =>
  settleHomeGrid(
    grid
      .filter((item) => shown(item.key))
      .map((item) => {
        const rows = measuredRows[item.key];
        return rows && HOME_AUTO_HEIGHT_WINDOWS.has(item.key)
          ? { ...item, h: clamp(rows, 1, HOME_GRID_MAX_MEASURED_H) }
          : item;
      })
  );

/** A changed layout of the shown windows, with the hidden ones kept. */
export const mergeHomeGrid = (
  stored: readonly HomeGridItem[],
  shown: readonly HomeGridItem[]
): HomeGridItem[] => [
  ...stored.map(
    (item) => shown.find((entry) => entry.key === item.key) ?? item
  ),
  ...shown.filter((item) => !stored.some((entry) => entry.key === item.key)),
];

/**
 * Home's flowing layout, narrower than HOME_GRID_MIN_WIDTH_PX: the shown
 * windows in reading order, in `columns` columns (1 or 2). A window at
 * least two thirds of the grid wide takes both columns; any other goes to
 * the column that ends higher. Rects are in those columns.
 */
export const homeGridFlow = (
  items: readonly HomeGridItem[],
  columns: 1 | 2
): HomeGridItem[] => {
  const ordered = [...items].sort((a, b) => readingRank(a) - readingRank(b));
  const bottoms = new Array<number>(columns).fill(0);
  const flowed = ordered.map((item) => {
    if (columns === 1 || item.w >= (HOME_GRID_COLUMNS * 2) / 3) {
      const y = Math.max(...bottoms);
      bottoms.fill(y + item.h);
      return { ...item, x: 0, y, w: columns };
    }
    const column = bottoms[1] < bottoms[0] ? 1 : 0;
    const y = bottoms[column];
    bottoms[column] = y + item.h;
    return { ...item, x: column, y, w: 1 };
  });
  return items.map((item) => flowed.find((entry) => entry.key === item.key));
};

/** Column width for a grid this many px wide with `columns` columns. */
export const homeGridColumnPx = (
  widthPx: number,
  columns: number = HOME_GRID_COLUMNS
) => Math.max(1, (widthPx - (columns - 1) * HOME_GRID_GAP_PX) / columns);

export const homeGridRectPx = (rect: GridRect, columnPx: number) => ({
  left: rect.x * (columnPx + HOME_GRID_GAP_PX),
  top: rect.y * HOME_GRID_ROW_PX,
  width: rect.w * columnPx + (rect.w - 1) * HOME_GRID_GAP_PX,
  height: rect.h * HOME_GRID_ROW_PX - HOME_GRID_GAP_PX,
});

export const homeGridHeightPx = (items: readonly GridRect[]) => {
  const rows = items.reduce((low, item) => Math.max(low, item.y + item.h), 0);
  return rows > 0 ? rows * HOME_GRID_ROW_PX - HOME_GRID_GAP_PX : 0;
};

/** The cell a window's top left corner at (left, top) px snaps to. */
export const homeGridCellAt = (
  left: number,
  top: number,
  columnPx: number,
  w: number
) => ({
  x: clamp(
    Math.round(left / (columnPx + HOME_GRID_GAP_PX)),
    0,
    HOME_GRID_COLUMNS - w
  ),
  y: Math.max(0, Math.round(top / HOME_GRID_ROW_PX)),
});

/** The size in cells a window width × height px snaps to. */
export const homeGridSizeFor = (
  widthPx: number,
  heightPx: number,
  columnPx: number
) => ({
  w: Math.round((widthPx + HOME_GRID_GAP_PX) / (columnPx + HOME_GRID_GAP_PX)),
  h: Math.round((heightPx + HOME_GRID_GAP_PX) / HOME_GRID_ROW_PX),
});

/** Rows that hold `heightPx` of content. */
export const homeGridRowsFor = (heightPx: number) =>
  Math.max(1, Math.ceil((heightPx + HOME_GRID_GAP_PX) / HOME_GRID_ROW_PX));
