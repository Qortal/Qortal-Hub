import { describe, expect, it } from 'vitest';
import {
  APP_CARD_MIN_WIDTH,
  APP_ROW_MIN_WIDTH,
  APP_SKELETON,
  CATEGORY_SKELETON,
  LIST_MAX_COLUMNS,
  PRIVATE_SKELETON,
  appCollectionMetrics,
  fittedColumnsTemplate,
} from './libraryLayout';
import { virtualGridColumns } from './VirtualAppGrid';

describe('appCollectionMetrics', () => {
  it('lays the list out in up to two columns of wide rows', () => {
    const list = appCollectionMetrics('list');
    expect(list.columns).toBeUndefined();
    expect(list.maxColumns).toBe(2);
    expect(list.minColumnWidth).toBe(APP_ROW_MIN_WIDTH);
  });

  it('keeps the grid as wide as it is, with no limit on its columns', () => {
    const grid = appCollectionMetrics('grid');
    expect(grid.columns).toBeUndefined();
    expect(grid.maxColumns).toBeUndefined();
    expect(grid.minColumnWidth).toBe(APP_CARD_MIN_WIDTH);
  });

  it('puts two rows side by side only where both get their width', () => {
    const { minColumnWidth, gap, maxColumns } = appCollectionMetrics('list');
    const both = minColumnWidth * 2 + gap;
    expect(virtualGridColumns(both - 1, minColumnWidth, gap, maxColumns)).toBe(
      1
    );
    expect(virtualGridColumns(both, minColumnWidth, gap, maxColumns)).toBe(2);
    expect(virtualGridColumns(4000, minColumnWidth, gap, maxColumns)).toBe(2);
  });
});

describe('fittedColumnsTemplate', () => {
  it('fits as many columns as there is room for without a limit', () => {
    expect(fittedColumnsTemplate(300, 16)).toBe(
      'repeat(auto-fill, minmax(300px, 1fr))'
    );
  });

  it('gives each column at least its share of the limit, never more than the grid', () => {
    expect(fittedColumnsTemplate(520, 8, 2)).toBe(
      'repeat(auto-fill, minmax(min(100%, max(520px, calc((100% - 8px) / 2))), 1fr))'
    );
    expect(fittedColumnsTemplate(200, 10, 3)).toBe(
      'repeat(auto-fill, minmax(min(100%, max(200px, calc((100% - 20px) / 3))), 1fr))'
    );
  });

  it('has one full-width column with a limit of one', () => {
    expect(fittedColumnsTemplate(520, 8, 1)).toBe('minmax(0, 1fr)');
  });
});

describe('list skeletons', () => {
  it.each([
    ['apps', APP_SKELETON],
    ['categories', CATEGORY_SKELETON],
    ['private apps', PRIVATE_SKELETON],
  ])('follow the two columns of the %s list', (_, shape) => {
    expect(shape.list.maxColumns).toBe(LIST_MAX_COLUMNS);
    expect(shape.list.minWidth).toBeGreaterThan(0);
  });
});
