import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  VIRTUAL_GRID_MIN_ITEMS,
  VirtualAppGrid,
  virtualGridColumns,
} from './VirtualAppGrid';

describe('virtualGridColumns', () => {
  it('fits as many columns of the minimum width as the grid holds', () => {
    expect(virtualGridColumns(320, 320, 16)).toBe(1);
    expect(virtualGridColumns(655, 320, 16)).toBe(1);
    expect(virtualGridColumns(656, 320, 16)).toBe(2);
    expect(virtualGridColumns(1400, 320, 16)).toBe(4);
  });

  it('always has one column, also before the grid is measured', () => {
    expect(virtualGridColumns(0, 320, 16)).toBe(1);
    expect(virtualGridColumns(100, 320, 16)).toBe(1);
  });
});

describe('VirtualAppGrid', () => {
  const makeItems = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `app-${index}` }));
  const renderGrid = (count: number) =>
    render(
      <VirtualAppGrid
        gap={16}
        getKey={(item) => item.id}
        items={makeItems(count)}
        minColumnWidth={320}
        renderItem={(item) => <span>{item.id}</span>}
        rowHeight={220}
        scrollElement={document.body}
      />
    );

  it('renders a short list in full', () => {
    renderGrid(5);

    expect(screen.getAllByText(/^app-\d+$/)).toHaveLength(5);
  });

  it('renders only the rows near the viewport of a long list', () => {
    renderGrid(VIRTUAL_GRID_MIN_ITEMS * 10);

    // jsdom has no layout, so no row is in view: what matters is that the
    // whole list is not rendered.
    expect(screen.queryAllByText(/^app-\d+$/).length).toBeLessThan(
      VIRTUAL_GRID_MIN_ITEMS
    );
  });
});
