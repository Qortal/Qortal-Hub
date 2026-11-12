import { describe, expect, it } from 'vitest';
import {
  WIDGET_GRID_GAP_PX,
  WIDGET_GRID_MAX_COLUMNS,
  WIDGET_GRID_MIN_COLUMNS,
  WIDGET_GRID_ROW_PX,
  clampRect,
  collapseEmptyRows,
  fitLayout,
  gridCellAt,
  gridColumnPx,
  gridColumnsFor,
  gridColumnsForWidth,
  gridHeightPx,
  gridRectPx,
  gridRowsForPx,
  gridSizeFor,
  moveGridItem,
  placeGridItem,
  removeGridItem,
  resizeGridItem,
  type GridItem,
} from './widgetGrid';

const item = (key: string, x: number, y: number, w: number, h: number) => ({
  key,
  x,
  y,
  w,
  h,
});
const at = (items: GridItem[]) =>
  Object.fromEntries(items.map((i) => [i.key, [i.x, i.y, i.w, i.h]]));

describe('widgetGrid', () => {
  it('fits as many columns as the panel holds, within bounds', () => {
    expect(gridColumnsFor(0)).toBe(WIDGET_GRID_MIN_COLUMNS);
    expect(gridColumnsFor(300)).toBe(WIDGET_GRID_MIN_COLUMNS);
    // 1480 px: 15 columns of 87.5 px, close to a phone's.
    expect(gridColumnsFor(1480)).toBe(15);
    expect(gridColumnPx(1480, 15)).toBeCloseTo(
      (1480 - 14 * WIDGET_GRID_GAP_PX) / 15
    );
    expect(gridColumnsFor(100_000)).toBe(WIDGET_GRID_MAX_COLUMNS);
  });

  it('keeps blocks inside the grid', () => {
    expect(clampRect({ x: 3, y: -2, w: 4, h: 99 }, 4)).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 14,
    });
    expect(clampRect({ x: 'a' as never, w: 0, h: 1 }, 4)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 2,
    });
    expect(clampRect({ x: 20, y: 0, w: 30, h: 2 }, 12)).toEqual({
      x: 0,
      y: 0,
      w: 12,
      h: 2,
    });
  });

  it('closes empty rows but keeps holes beside blocks', () => {
    const layout = collapseEmptyRows([
      item('a', 0, 2, 2, 4),
      item('b', 2, 9, 2, 3),
    ]);
    expect(at(layout)).toEqual({ a: [0, 0, 2, 4], b: [2, 4, 2, 3] });
  });

  it('cleans a saved layout: no overlaps, no empty rows', () => {
    const layout = fitLayout(
      [item('a', 0, 0, 4, 3), item('b', 1, 1, 2, 2), item('c', 0, 20, 9, 1)],
      4
    );
    expect(at(layout)).toEqual({
      a: [0, 0, 4, 3],
      b: [1, 3, 2, 2],
      c: [0, 5, 4, 2],
    });
  });

  it('squeezes a wide layout into fewer columns without overlaps', () => {
    const wide = [item('a', 0, 0, 4, 5), item('b', 10, 0, 4, 5)];
    // 15 columns: side by side, as saved.
    expect(at(fitLayout(wide, 15))).toEqual({
      a: [0, 0, 4, 5],
      b: [10, 0, 4, 5],
    });
    // 6 columns: b moves in from the right edge, then down under a.
    expect(at(fitLayout(wide, 6))).toEqual({
      a: [0, 0, 4, 5],
      b: [2, 5, 4, 5],
    });
  });

  it('swaps two blocks the same size, or pushes the other down', () => {
    const start = [item('a', 0, 0, 4, 5), item('b', 0, 5, 4, 5)];
    expect(at(moveGridItem(start, 'a', 0, 5, 4))).toEqual({
      a: [0, 5, 4, 5],
      b: [0, 0, 4, 5],
    });
    expect(at(moveGridItem(start, 'b', 0, 0, 4))).toEqual({
      a: [0, 5, 4, 5],
      b: [0, 0, 4, 5],
    });
    // Half onto B: B can't fit back in A's place, so it moves down; the
    // rows A left empty close up.
    expect(at(moveGridItem(start, 'a', 0, 3, 4))).toEqual({
      a: [0, 0, 4, 5],
      b: [0, 5, 4, 5],
    });
  });

  it('moves a block beside another on a wide grid', () => {
    const start = [item('a', 0, 0, 4, 5), item('b', 0, 5, 4, 5)];
    expect(at(moveGridItem(start, 'b', 6, 0, 15))).toEqual({
      a: [0, 0, 4, 5],
      b: [6, 0, 4, 5],
    });
  });

  it('stays where it is dropped, with free room around it', () => {
    const start = [item('a', 0, 0, 2, 4), item('b', 2, 0, 2, 4)];
    expect(at(moveGridItem(start, 'a', 0, 4, 4))).toEqual({
      a: [0, 4, 2, 4],
      b: [2, 0, 2, 4],
    });
  });

  it('pushes the rest down when a block lands where nothing fits back', () => {
    const start = [
      item('a', 0, 0, 2, 4),
      item('b', 2, 0, 2, 2),
      item('c', 0, 4, 4, 3),
    ];
    expect(at(moveGridItem(start, 'a', 0, 4, 4))).toEqual({
      a: [0, 2, 2, 4],
      b: [2, 0, 2, 2],
      c: [0, 6, 4, 3],
    });
  });

  it('never moves a block past the right edge', () => {
    const start = [item('a', 0, 0, 3, 2)];
    expect(at(moveGridItem(start, 'a', 3, 0, 4)).a[0]).toBe(1);
    expect(at(moveGridItem(start, 'a', 30, 0, 12)).a[0]).toBe(9);
  });

  it('resizes, pushing what is below further down', () => {
    const start = [item('a', 0, 0, 2, 3), item('b', 2, 0, 2, 3)];
    expect(at(resizeGridItem(start, 'a', 4, 3, 4))).toEqual({
      a: [0, 0, 4, 3],
      b: [2, 3, 2, 3],
    });
    // Wider than fits from its column: it moves left.
    expect(at(resizeGridItem([item('a', 3, 0, 1, 2)], 'a', 3, 2, 4)).a).toEqual(
      [1, 0, 3, 2]
    );
    // Never wider than the grid.
    expect(
      at(resizeGridItem([item('a', 0, 0, 4, 2)], 'a', 40, 2, 10)).a
    ).toEqual([0, 0, 10, 2]);
  });

  it('closes the rows a removed block alone used', () => {
    const start = [item('a', 0, 0, 4, 3), item('b', 0, 3, 4, 2)];
    expect(at(removeGridItem(start, 'a'))).toEqual({ b: [0, 0, 4, 2] });
  });

  it('puts a new block in the first free spot, else under everything', () => {
    const wide = placeGridItem(
      [item('a', 0, 0, 4, 5)],
      item('b', 0, 0, 4, 5),
      15
    );
    expect(at(wide).b).toEqual([4, 0, 4, 5]);
    const narrow = placeGridItem(
      [item('a', 0, 0, 4, 5)],
      item('b', 0, 0, 4, 5),
      4
    );
    expect(at(narrow).b).toEqual([0, 5, 4, 5]);
    // A hole left beside a tall block is filled first.
    const holes = placeGridItem(
      [item('a', 0, 0, 2, 6), item('b', 2, 3, 2, 3)],
      item('c', 0, 0, 2, 3),
      4
    );
    expect(at(holes).c).toEqual([2, 0, 2, 3]);
  });

  it('turns cells into pixels and back', () => {
    const columnPx = gridColumnPx(351, 4);
    expect(columnPx).toBeCloseTo((351 - 3 * WIDGET_GRID_GAP_PX) / 4);
    const px = gridRectPx({ x: 1, y: 2, w: 2, h: 3 }, columnPx);
    expect(px.left).toBeCloseTo(columnPx + WIDGET_GRID_GAP_PX);
    expect(px.top).toBe(2 * (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX));
    expect(px.height).toBe(3 * WIDGET_GRID_ROW_PX + 2 * WIDGET_GRID_GAP_PX);
    expect(gridCellAt(px.left + 10, px.top - 10, columnPx, 2, 4)).toEqual({
      x: 1,
      y: 2,
    });
    expect(gridSizeFor(px.width + 5, px.height - 5, columnPx, 1, 4)).toEqual({
      w: 2,
      h: 3,
    });
    expect(gridHeightPx([{ x: 0, y: 0, w: 4, h: 2 }])).toBe(
      2 * WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX
    );
    expect(gridHeightPx([])).toBe(0);
  });

  it('gives a widget enough rows for the height it asks for', () => {
    expect(gridRowsForPx(WIDGET_GRID_ROW_PX * 3 + WIDGET_GRID_GAP_PX * 2)).toBe(
      3
    );
    expect(
      gridRowsForPx(WIDGET_GRID_ROW_PX * 3 + WIDGET_GRID_GAP_PX * 2 + 1)
    ).toBe(4);
    expect(gridRowsForPx(10)).toBe(2);
    expect(gridRowsForPx(5000)).toBe(14);
  });

  it('reads the asked widths as on a phone', () => {
    expect(gridColumnsForWidth('full')).toBe(4);
    expect(gridColumnsForWidth('half')).toBe(2);
    expect(gridColumnsForWidth('small')).toBe(1);
    expect(gridColumnsForWidth('huge')).toBeNull();
  });
});
