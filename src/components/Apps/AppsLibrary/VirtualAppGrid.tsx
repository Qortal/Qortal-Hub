import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';

/** A shorter list renders as a plain grid: virtual rows gain nothing there. */
export const VIRTUAL_GRID_MIN_ITEMS = 48;

/** How many columns of at least `minColumnWidth` fit into `width`. */
export const virtualGridColumns = (
  width: number,
  minColumnWidth: number,
  gap: number
): number =>
  width > 0
    ? Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)))
    : 1;

interface VirtualAppGridProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** The element that scrolls. The grid may start anywhere inside it. */
  scrollElement: HTMLElement | null;
  minColumnWidth: number;
  /** Every item has this height. */
  rowHeight: number;
  gap: number;
  /** False while the grid is hidden, so it stops measuring and rendering. */
  active?: boolean;
  overscan?: number;
}

/**
 * A grid of equal-height cards that only renders the rows near the viewport.
 * It measures where it starts inside the scroller, so other content (a header,
 * another section) can sit above it in the same scroll area.
 */
export function VirtualAppGrid<T>({
  items,
  getKey,
  renderItem,
  scrollElement,
  minColumnWidth,
  rowHeight,
  gap,
  active = true,
  overscan = 4,
}: VirtualAppGridProps<T>) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ width: 0, offset: 0 });
  const isVirtual = items.length >= VIRTUAL_GRID_MIN_ITEMS;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !scrollElement || !active || !isVirtual) return;

    const measure = () => {
      const gridRect = grid.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      const width = gridRect.width;
      const offset = Math.max(
        0,
        Math.round(gridRect.top - scrollRect.top + scrollElement.scrollTop)
      );
      setLayout((previous) =>
        previous.width === width && previous.offset === offset
          ? previous
          : { width, offset }
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    observer.observe(scrollElement);
    // The grid moves when anything above it in the scroller changes height.
    const content = scrollElement.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [active, isVirtual, scrollElement]);

  const columnCount = virtualGridColumns(layout.width, minColumnWidth, gap);
  const rowCount = Math.ceil(items.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    enabled: isVirtual && active,
    estimateSize: useCallback(() => rowHeight + gap, [gap, rowHeight]),
    getItemKey: useCallback(
      (index: number) => {
        const first = items[index * columnCount];
        return `${columnCount}-${first ? getKey(first) : index}`;
      },
      [columnCount, getKey, items]
    ),
    getScrollElement: () => scrollElement,
    // The scroller belongs to the page: when the grid starts or comes back,
    // it follows the scroll position instead of resetting it.
    initialOffset: () => scrollElement?.scrollTop ?? 0,
    overscan,
    scrollMargin: layout.offset,
  });

  if (!isVirtual) {
    return (
      <Box
        sx={{
          display: 'grid',
          gap: `${gap}px`,
          gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
          width: '100%',
        }}
      >
        {items.map((item) => (
          <Box key={getKey(item)} sx={{ minWidth: 0 }}>
            {renderItem(item)}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box
      ref={gridRef}
      sx={{
        // The last row has no gap below it.
        height: Math.max(0, rowVirtualizer.getTotalSize() - gap),
        position: 'relative',
        width: '100%',
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const rowStart = virtualRow.index * columnCount;
        return (
          <Box
            key={virtualRow.key}
            data-index={virtualRow.index}
            sx={{
              display: 'grid',
              gap: `${gap}px`,
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              left: 0,
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start - layout.offset}px)`,
              width: '100%',
            }}
          >
            {items.slice(rowStart, rowStart + columnCount).map((item) => (
              <Box key={getKey(item)} sx={{ minWidth: 0 }}>
                {renderItem(item)}
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
