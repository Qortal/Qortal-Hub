/**
 * The Home widgets grid.
 *
 * Widgets are small Q-Apps made for phone-sized frames (the same widgets run
 * in Qortal GO). So the grid keeps the cell size close to a phone's and lets
 * the panel width decide how many columns there are: rows are 40 px with 12 px
 * gaps, columns are at least WIDGET_GRID_MIN_COLUMN_PX wide. A widget is a
 * block of cells (x, y, w, h), placed where the user puts it, like on a
 * phone's home screen:
 *
 * - blocks never overlap; a block dropped onto others pushes them down (or
 *   swaps with one that fits in its old place);
 * - growing a block pushes what is below further down;
 * - holes beside blocks stay (the user made them), but rows with nothing in
 *   them close up, so no empty band is left between widgets.
 *
 * Saved layouts keep their cells; a narrower panel squeezes them into its
 * columns when it shows them (fitLayout), without changing what is saved
 * until the user arranges the widgets there.
 *
 * Everything here is pure: the panel and the saved list both use it.
 */
export const WIDGET_GRID_ROW_PX = 40;
export const WIDGET_GRID_GAP_PX = 12;
export const WIDGET_GRID_MIN_COLUMN_PX = 84;
export const WIDGET_GRID_MIN_COLUMNS = 4;
export const WIDGET_GRID_MAX_COLUMNS = 24;
export const WIDGET_MIN_W = 1;
export const WIDGET_MIN_H = 2;
export const WIDGET_MAX_H = 14;
/** A phone's full width in GO: what a widget asking for 'full' gets. */
export const WIDGET_PHONE_COLUMNS = 4;
export const WIDGET_DEFAULT_W = WIDGET_PHONE_COLUMNS;
export const WIDGET_DEFAULT_H = 5;

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridItem extends GridRect {
  key: string;
}

const int = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampColumns = (columns: number) =>
  clamp(int(columns, WIDGET_GRID_MIN_COLUMNS), 1, WIDGET_GRID_MAX_COLUMNS);

/** How many columns a panel this many CSS px wide holds. */
export const gridColumnsFor = (widthPx: number): number =>
  clamp(
    Math.floor(
      (Math.max(0, widthPx) + WIDGET_GRID_GAP_PX) /
        (WIDGET_GRID_MIN_COLUMN_PX + WIDGET_GRID_GAP_PX)
    ),
    WIDGET_GRID_MIN_COLUMNS,
    WIDGET_GRID_MAX_COLUMNS
  );

/** Column width for a panel this many CSS px wide with `columns` columns. */
export const gridColumnPx = (widthPx: number, columns: number): number =>
  Math.max(
    1,
    (widthPx - (clampColumns(columns) - 1) * WIDGET_GRID_GAP_PX) /
      clampColumns(columns)
  );

/** Inside the grid: whole cells, sizes within bounds, never past the edge. */
export const clampRect = (
  rect: Partial<GridRect>,
  columns: number = WIDGET_GRID_MAX_COLUMNS
): GridRect => {
  const cols = clampColumns(columns);
  const w = clamp(int(rect.w, WIDGET_DEFAULT_W), WIDGET_MIN_W, cols);
  const h = clamp(int(rect.h, WIDGET_DEFAULT_H), WIDGET_MIN_H, WIDGET_MAX_H);
  const x = clamp(int(rect.x, 0), 0, cols - w);
  const y = Math.max(0, int(rect.y, 0));
  return { x, y, w, h };
};

const collides = (a: GridRect, b: GridRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const layoutRows = (items: readonly GridRect[]): number =>
  items.reduce((rows, item) => Math.max(rows, item.y + item.h), 0);

/** Rows with nothing in them close up: everything below moves up. */
export const collapseEmptyRows = <T extends GridItem>(
  items: readonly T[]
): T[] => {
  const rows = layoutRows(items);
  const used = new Array<boolean>(rows).fill(false);
  for (const item of items) {
    for (let row = item.y; row < item.y + item.h; row += 1) used[row] = true;
  }
  const emptyAbove: number[] = [];
  let empty = 0;
  for (let row = 0; row < rows; row += 1) {
    emptyAbove[row] = empty;
    if (!used[row]) empty += 1;
  }
  if (empty === 0) return [...items];
  return items.map((item) => {
    const shift = emptyAbove[item.y] ?? 0;
    return shift ? { ...item, y: item.y - shift } : item;
  });
};

/**
 * `fixed` stays where it is; anything it overlaps moves down to just below
 * it, and anything that move makes overlap moves down in turn.
 */
const pushApart = <T extends GridItem>(
  items: readonly T[],
  fixed: string
): T[] => {
  const result = items.map((item) => ({ ...item }));
  const start = result.find((item) => item.key === fixed);
  if (!start) return result;
  const queue: T[] = [start];
  while (queue.length > 0) {
    const mover = queue.shift() as T;
    const others = result
      .filter((item) => item.key !== mover.key && item.key !== fixed)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const other of others) {
      if (!collides(other, mover)) continue;
      other.y = mover.y + mover.h;
      queue.push(other);
    }
  }
  return result;
};

const settleAround = <T extends GridItem>(items: readonly T[], key: string) =>
  collapseEmptyRows(pushApart(items, key));

/**
 * The layout as `columns` columns show it: every block inside the grid, no
 * overlaps (earlier blocks in reading order keep their place) and no empty
 * rows. Used for saved layouts, which may come from a wider panel or
 * anywhere else.
 */
export const fitLayout = <T extends GridItem>(
  items: readonly T[],
  columns: number = WIDGET_GRID_MAX_COLUMNS
): T[] => {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: T[] = [];
  for (const item of ordered) {
    const probe = { ...item, ...clampRect(item, columns) };
    while (placed.some((other) => collides(probe, other))) probe.y += 1;
    placed.push(probe);
  }
  const byKey = new Map(
    collapseEmptyRows(placed).map((item) => [item.key, item])
  );
  return items.map((item) => byKey.get(item.key) ?? item);
};

/**
 * `key` moved to cell (x, y), from `items` as they were when the drag began
 * (each step is worked out from there, so the others go back as the pointer
 * goes back). A block it lands on takes its old place when that is free (two
 * the same size swap); anything else moves down out of its way.
 */
export const moveGridItem = <T extends GridItem>(
  items: readonly T[],
  key: string,
  x: number,
  y: number,
  columns: number
): T[] => {
  const moving = items.find((item) => item.key === key);
  if (!moving) return [...items];
  const cols = clampColumns(columns);
  const target = { ...moving, ...clampRect({ ...moving, x, y }, cols) };
  const next = items.map((item) => {
    if (item.key === key) return target;
    if (!collides(item, target)) return item;
    const swapped = {
      ...item,
      x: clamp(moving.x, 0, cols - item.w),
      y: moving.y,
    };
    const fits =
      !collides(swapped, target) &&
      !items.some(
        (other) =>
          other.key !== key &&
          other.key !== item.key &&
          collides(swapped, other)
      );
    return fits ? swapped : item;
  });
  return settleAround(next, key);
};

/** `key` made w × h cells (keeping its top left corner where it fits). */
export const resizeGridItem = <T extends GridItem>(
  items: readonly T[],
  key: string,
  w: number,
  h: number,
  columns: number
): T[] => {
  const cols = clampColumns(columns);
  const next = items.map((item) => {
    if (item.key !== key) return item;
    const width = clamp(int(w, item.w), WIDGET_MIN_W, cols);
    const rect = clampRect(
      { x: Math.min(item.x, cols - width), y: item.y, w: width, h },
      cols
    );
    return { ...item, ...rect };
  });
  return settleAround(next, key);
};

/** A block taken away: the rows it alone used close up. */
export const removeGridItem = <T extends GridItem>(
  items: readonly T[],
  key: string
): T[] => collapseEmptyRows(items.filter((item) => item.key !== key));

/**
 * Where a new block goes: the first free spot reading from the top left
 * (a wide panel fills its rows before it grows), else under everything.
 */
export const placeGridItem = <T extends GridItem>(
  items: readonly T[],
  item: T,
  columns: number
): T[] => {
  const cols = clampColumns(columns);
  const size = clampRect({ ...item, x: 0, y: 0 }, cols);
  const rows = layoutRows(items);
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x + size.w <= cols; x += 1) {
      const probe = { ...size, x, y };
      if (!items.some((other) => collides(probe, other))) {
        return [...items, { ...item, ...probe }];
      }
    }
  }
  return [...items, { ...item, ...size, x: 0, y: rows }];
};

export const gridRectPx = (rect: GridRect, columnPx: number) => ({
  left: rect.x * (columnPx + WIDGET_GRID_GAP_PX),
  top: rect.y * (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX),
  width: rect.w * columnPx + (rect.w - 1) * WIDGET_GRID_GAP_PX,
  height: rect.h * WIDGET_GRID_ROW_PX + (rect.h - 1) * WIDGET_GRID_GAP_PX,
});

export const gridHeightPx = (items: readonly GridRect[]): number => {
  const rows = layoutRows(items);
  return rows > 0
    ? rows * (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX) - WIDGET_GRID_GAP_PX
    : 0;
};

/** The cell a block's top left corner at (left, top) px snaps to. */
export const gridCellAt = (
  left: number,
  top: number,
  columnPx: number,
  w: number,
  columns: number
) => ({
  x: clamp(
    Math.round(left / (columnPx + WIDGET_GRID_GAP_PX)),
    0,
    Math.max(0, clampColumns(columns) - w)
  ),
  y: Math.max(0, Math.round(top / (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX))),
});

/** The size in cells a block width × height px snaps to. */
export const gridSizeFor = (
  widthPx: number,
  heightPx: number,
  columnPx: number,
  x: number,
  columns: number
) => ({
  w: clamp(
    Math.round(
      (widthPx + WIDGET_GRID_GAP_PX) / (columnPx + WIDGET_GRID_GAP_PX)
    ),
    WIDGET_MIN_W,
    Math.max(WIDGET_MIN_W, clampColumns(columns) - x)
  ),
  h: clamp(
    Math.round(
      (heightPx + WIDGET_GRID_GAP_PX) /
        (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX)
    ),
    WIDGET_MIN_H,
    WIDGET_MAX_H
  ),
});

/** Rows for a height in px a widget asks for (enough to hold it). */
export const gridRowsForPx = (heightPx: number): number =>
  clamp(
    Math.ceil(
      (heightPx + WIDGET_GRID_GAP_PX) /
        (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX)
    ),
    WIDGET_MIN_H,
    WIDGET_MAX_H
  );

/**
 * Columns for a widget's asked width. The names come from phones (GO), so
 * 'full' is a phone's full width here too (WIDGET_PHONE_COLUMNS); the user
 * can still make it wider.
 */
export const gridColumnsForWidth = (width: unknown): number | null =>
  width === 'full'
    ? WIDGET_PHONE_COLUMNS
    : width === 'half'
      ? WIDGET_PHONE_COLUMNS / 2
      : width === 'small'
        ? 1
        : null;
