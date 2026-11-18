import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(virtualGridColumns(0, 520, 8, 2)).toBe(1);
  });

  it('never fits more than the most columns asked for', () => {
    expect(virtualGridColumns(1047, 520, 8, 2)).toBe(1);
    expect(virtualGridColumns(1048, 520, 8, 2)).toBe(2);
    // Three would fit at their minimum width, but the list stops at two.
    expect(virtualGridColumns(1576, 520, 8, 2)).toBe(2);
    expect(virtualGridColumns(4000, 520, 8, 2)).toBe(2);
    expect(virtualGridColumns(1576, 520, 8)).toBe(3);
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

describe('VirtualAppGrid options', () => {
  const makeItems = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `app-${index}` }));

  /** A scroller 800 px tall, so the virtual rows near the top render. */
  const makeScroller = () => {
    const scroller = document.createElement('div');
    scroller.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 1000,
        height: 800,
        bottom: 800,
        right: 1000,
      }) as DOMRect;
    Object.defineProperty(scroller, 'offsetHeight', { value: 800 });
    Object.defineProperty(scroller, 'offsetWidth', { value: 1000 });
    document.body.appendChild(scroller);
    return scroller;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lays a short list out in the given number of columns', () => {
    const { container } = render(
      <VirtualAppGrid
        columns={1}
        gap={8}
        getKey={(item) => item.id}
        items={makeItems(5)}
        minColumnWidth={0}
        renderItem={(item) => <span>{item.id}</span>}
        rowHeight={72}
        scrollElement={document.body}
      />
    );
    expect(container.firstElementChild).toHaveStyle({
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
    });
  });

  it('caps a short list at the most columns asked for', () => {
    const { container } = render(
      <VirtualAppGrid
        gap={8}
        getKey={(item) => item.id}
        items={makeItems(5)}
        maxColumns={2}
        minColumnWidth={520}
        renderItem={(item) => <span>{item.id}</span>}
        rowHeight={72}
        scrollElement={document.body}
      />
    );
    expect(container.firstElementChild).toHaveStyle({
      gridTemplateColumns:
        'repeat(auto-fill, minmax(min(100%, max(520px, calc((100% - 8px) / 2))), 1fr))',
    });
  });

  it('lays the virtual rows out in at most the columns asked for', () => {
    const scroller = makeScroller();
    // The grid measures itself 1000 px wide: nine columns of 100 px fit.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      width: 1000,
      height: 800,
      bottom: 800,
      right: 1000,
    } as DOMRect);
    render(
      <VirtualAppGrid
        gap={8}
        getKey={(item) => item.id}
        items={makeItems(VIRTUAL_GRID_MIN_ITEMS * 10)}
        maxColumns={2}
        minColumnWidth={100}
        renderItem={(item, index) => <span>{`${item.id}@${index}`}</span>}
        rowHeight={72}
        scrollElement={scroller}
      />,
      { container: scroller }
    );
    const first = screen.getByText('app-0@0');
    expect(first.parentElement?.parentElement).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
    expect(screen.getByText('app-1@1').parentElement?.parentElement).toBe(
      first.parentElement?.parentElement
    );
    expect(screen.getByText('app-2@2').parentElement?.parentElement).not.toBe(
      first.parentElement?.parentElement
    );
  });

  it('lays the virtual rows out in the given number of columns', () => {
    const scroller = makeScroller();
    render(
      <VirtualAppGrid
        columns={3}
        gap={16}
        getKey={(item) => item.id}
        items={makeItems(VIRTUAL_GRID_MIN_ITEMS * 10)}
        minColumnWidth={300}
        renderItem={(item, index) => <span>{`${item.id}@${index}`}</span>}
        rowHeight={220}
        scrollElement={scroller}
      />,
      { container: scroller }
    );
    const first = screen.getByText('app-0@0');
    expect(first.parentElement?.parentElement).toHaveStyle({
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    });
    // The index is the place in the whole list, also in later rows.
    expect(screen.getByText('app-4@4')).toBeInTheDocument();
  });

  it('renders every item when it is not virtual', () => {
    render(
      <VirtualAppGrid
        gap={16}
        getKey={(item) => item.id}
        items={makeItems(VIRTUAL_GRID_MIN_ITEMS * 10)}
        minColumnWidth={320}
        renderItem={(item, index) => <span>{`${item.id}@${index}`}</span>}
        rowHeight={220}
        scrollElement={document.body}
        virtualize={false}
      />
    );
    expect(screen.getAllByText(/^app-\d+@\d+$/)).toHaveLength(
      VIRTUAL_GRID_MIN_ITEMS * 10
    );
    expect(screen.getByText('app-479@479')).toBeInTheDocument();
  });
});
