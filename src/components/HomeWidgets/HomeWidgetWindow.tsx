import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBaseApiReact } from '../../utils/globalApi';
import { HomeWidgetView } from './HomeWidgetView';
import { usePageVisible } from './HomeWidgetsPanel';
import type { SavedHomeWidget } from './homeWidgets';
import {
  WIDGET_GRID_GAP_PX,
  WIDGET_GRID_MIN_COLUMN_PX,
  WIDGET_GRID_ROW_PX,
  WIDGET_MIN_H,
} from './widgetGrid';

type HomeWidgetWindowProps = {
  widget: {
    name: string;
    identifier: string | null;
    title?: string;
    sizedBy?: SavedHomeWidget['sizedBy'];
  };
  /** Home is the view showing. */
  active: boolean;
  /** Off while Home is being edited: the Hub takes the pointer. */
  interactive: boolean;
  /** Bumped to load the widget again. */
  reloadKey: number;
  /** Waits this long before loading, so many widgets do not start at once. */
  loadDelayMs: number;
  /** The widget asked for a height (GO_WIDGET_SET_SIZE), in CSS px. */
  onAskHeight: (heightPx: number) => void;
};

/**
 * The cells of the widgets' own grid (40 px rows, columns of at least 84 px)
 * a frame this size spans: what GO_WIDGET_INFO reports, so a widget reads
 * the same numbers in a window of its own as in the Widgets window.
 */
export const widgetCellsFor = (widthPx: number, heightPx: number) => ({
  w: Math.max(
    1,
    Math.floor(
      (Math.max(0, widthPx) + WIDGET_GRID_GAP_PX) /
        (WIDGET_GRID_MIN_COLUMN_PX + WIDGET_GRID_GAP_PX)
    )
  ),
  h: Math.max(
    WIDGET_MIN_H,
    Math.floor(
      (Math.max(0, heightPx) + WIDGET_GRID_GAP_PX) /
        (WIDGET_GRID_ROW_PX + WIDGET_GRID_GAP_PX)
    )
  ),
});

/** The height in CSS px of `rows` rows of the widgets' grid. */
export const widgetRowsPx = (rows: number) =>
  rows * WIDGET_GRID_ROW_PX + (rows - 1) * WIDGET_GRID_GAP_PX;

/**
 * A Q-App widget in a Home window of its own: the card it draws itself on,
 * filling the window. It runs like a widget in the Widgets window (its own
 * isolated guest, the same requests), and asks Home for the height it wants.
 */
export const HomeWidgetWindow = ({
  widget,
  active,
  interactive,
  reloadKey,
  loadDelayMs,
  onAskHeight,
}: HomeWidgetWindowProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const baseUrl = getBaseApiReact();
  const pageVisible = usePageVisible();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () =>
      setSize((current) =>
        current.width === card.clientWidth &&
        current.height === card.clientHeight
          ? current
          : { height: card.clientHeight, width: card.clientWidth }
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // Off screen, it can pause (GO_WIDGET_VISIBILITY).
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setInView(entry.isIntersecting);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // What it may do right now (see widgetRequests): only while Home is the
  // view showing and the window is visible.
  const onScreenRef = useRef(false);
  onScreenRef.current = active && pageVisible;
  const isOnScreen = useCallback(() => onScreenRef.current, []);

  const onAskHeightRef = useRef(onAskHeight);
  onAskHeightRef.current = onAskHeight;
  const onAskSize = useCallback(
    (_key: string, asked: { w: number | null; h: number }) =>
      onAskHeightRef.current(widgetRowsPx(asked.h)),
    []
  );

  const cells = widgetCellsFor(size.width, size.height);
  const shown = useMemo<SavedHomeWidget>(
    () => ({
      name: widget.name,
      identifier: widget.identifier,
      ...(widget.title ? { title: widget.title } : {}),
      x: 0,
      y: 0,
      w: cells.w,
      h: cells.h,
      sizedBy: widget.sizedBy ?? 'default',
    }),
    [
      cells.h,
      cells.w,
      widget.identifier,
      widget.name,
      widget.sizedBy,
      widget.title,
    ]
  );

  return (
    <Box
      data-widget-identifier={widget.identifier ?? ''}
      data-widget-name={widget.name}
      ref={cardRef}
      sx={{
        backgroundColor: alpha(
          theme.palette.background.paper,
          isDark ? 0.55 : 0.92
        ),
        border: `1px solid ${alpha(
          theme.palette.border?.main ?? theme.palette.divider,
          isDark ? 0.24 : 0.16
        )}`,
        borderRadius: '14px',
        boxSizing: 'border-box',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <HomeWidgetView
        baseUrl={baseUrl}
        columns={cells.w}
        heightPx={size.height}
        interactive={interactive}
        isOnScreen={isOnScreen}
        key={`${baseUrl}\u0000${widget.name}\u0000${widget.identifier ?? ''}`}
        loadDelayMs={loadDelayMs}
        onAskSize={onAskSize}
        reloadKey={reloadKey}
        visible={active && pageVisible && inView}
        widget={shown}
        widthPx={size.width}
      />
    </Box>
  );
};
