import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DashboardCustomizeRoundedIcon from '@mui/icons-material/DashboardCustomizeRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useAtom } from 'jotai';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../utils/events';
import { getBaseApiReact } from '../../utils/globalApi';
import { dashboardPanelSx } from '../Group/dashboardPanelEffects';
import { HomeWidgetPicker } from './HomeWidgetPicker';
import { HomeWidgetView } from './HomeWidgetView';
import {
  HOME_WIDGET_LIMIT,
  addSavedWidget,
  applyWidgetAskedSize,
  applyWidgetLayout,
  homeWidgetKey,
  layoutForColumns,
  removeSavedWidget,
  savedHomeWidgetsAtom,
  type HomeWidgetListing,
  type SavedHomeWidget,
} from './homeWidgets';
import {
  WIDGET_GRID_GAP_PX,
  WIDGET_GRID_MIN_COLUMNS,
  WIDGET_GRID_ROW_PX,
  WIDGET_MAX_H,
  WIDGET_MIN_H,
  gridCellAt,
  gridColumnPx,
  gridColumnsFor,
  gridHeightPx,
  gridRectPx,
  gridSizeFor,
  moveGridItem,
  resizeGridItem,
  type GridItem,
} from './widgetGrid';

/** Widgets start one after another, this far apart, when Home first opens. */
const LOAD_STAGGER_MS = 250;
const MOVE_SLOP_PX = 4;
const AUTO_SCROLL_EDGE_PX = 64;
const AUTO_SCROLL_MAX_PX = 16;
const CARD_RADIUS_PX = 16;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

type LayoutItem = GridItem & { sizedBy: SavedHomeWidget['sizedBy'] };

const toLayout = (widgets: readonly SavedHomeWidget[]): LayoutItem[] =>
  widgets.map((widget) => ({
    key: homeWidgetKey(widget),
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    sizedBy: widget.sizedBy,
  }));

const sameLayout = (a: readonly GridItem[], b: readonly GridItem[]) =>
  a.length === b.length &&
  a.every((item, i) => {
    const other = b[i];
    return (
      other &&
      item.key === other.key &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });

type Drag = {
  kind: 'move' | 'resize';
  key: string;
  pointerId: number;
  /** The layout when the drag began: every step is worked out from it. */
  start: LayoutItem[];
  /** The snapped layout now. */
  layout: LayoutItem[];
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Where the grid was on screen when the drag began. */
  gridLeft: number;
  gridTop: number;
  rect: { left: number; top: number; width: number; height: number };
  moved: boolean;
};

const scrollParentOf = (node: HTMLElement | null): HTMLElement | null => {
  let current = node?.parentElement ?? null;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

/** The Hub's window is visible (not minimized or behind another). */
export const usePageVisible = () => {
  const [visible, setVisible] = useState(
    () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
};

/**
 * Widgets run in the desktop app's isolated Q-App guests; where there are
 * none (the browser dev server, Android) the panel is not shown.
 */
export const canHostHomeWidgets = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.electronAPI?.qappGuestPrepare === 'function';

type HomeWidgetsPanelProps = {
  /** Home is the view showing. */
  active: boolean;
  /**
   * Widgets on Home in windows of their own: they count towards the limit,
   * and the picker shows them as added.
   */
  elsewhere?: readonly { name: string; identifier: string | null }[];
};

const NOWHERE_ELSE: readonly { name: string; identifier: string | null }[] = [];

/**
 * Home's widgets: small Q-Apps the user picked, on a grid they arrange
 * (Arrange: drag a widget to move it, its corner to resize it).
 */
export const HomeWidgetsPanel = ({
  active,
  elsewhere = NOWHERE_ELSE,
}: HomeWidgetsPanelProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core', 'group']);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [widgets, setWidgets] = useAtom(savedHomeWidgetsAtom);
  const [arranging, setArranging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const pageVisible = usePageVisible();
  const baseUrl = getBaseApiReact();

  // Columns follow the panel's width (see widgetGrid).
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const hasWidgets = widgets.length > 0;
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setGridWidth(grid.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [hasWidgets]);
  const columns =
    gridWidth > 0 ? gridColumnsFor(gridWidth) : WIDGET_GRID_MIN_COLUMNS;
  const columnPx = gridColumnPx(gridWidth || 1, columns);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const shownWidgets = useMemo(
    () => layoutForColumns(widgets, columns),
    [widgets, columns]
  );
  const savedLayout = useMemo(() => toLayout(shownWidgets), [shownWidgets]);
  const [dragLayout, setDragLayout] = useState<LayoutItem[] | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<Drag['kind'] | null>(null);
  const layout = dragLayout ?? savedLayout;
  const layoutByKey = useMemo(
    () => new Map(layout.map((item) => [item.key, item])),
    [layout]
  );
  const savedByKey = useMemo(
    () => new Map(savedLayout.map((item) => [item.key, item])),
    [savedLayout]
  );

  // Widgets in view (IntersectionObserver), so the others can pause.
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const cardKeys = useRef(new WeakMap<Element, string>());
  const [inView, setInView] = useState<ReadonlySet<string> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      setInView((current) => {
        const next = new Set(current ?? []);
        for (const entry of entries) {
          const key = cardKeys.current.get(entry.target);
          if (!key) continue;
          if (entry.isIntersecting) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    });
    observerRef.current = observer;
    cardRefs.current.forEach((card) => observer.observe(card));
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);
  // One ref callback per widget, so a render does not detach and attach
  // every card again.
  const cardRefCallbacks = useRef(
    new Map<string, (card: HTMLDivElement | null) => void>()
  );
  const cardRef = (key: string) => {
    let callback = cardRefCallbacks.current.get(key);
    if (!callback) {
      callback = (card: HTMLDivElement | null) => {
        const known = cardRefs.current.get(key);
        if (known && known !== card) {
          observerRef.current?.unobserve(known);
          cardRefs.current.delete(key);
        }
        if (card) {
          cardRefs.current.set(key, card);
          cardKeys.current.set(card, key);
          observerRef.current?.observe(card);
        } else {
          cardRefCallbacks.current.delete(key);
        }
      };
      cardRefCallbacks.current.set(key, callback);
    }
    return callback;
  };

  // What a widget may do right now (see widgetRequests): only while Home is
  // the view showing and the window is visible.
  const onScreenRef = useRef(false);
  onScreenRef.current = active && pageVisible;
  const isOnScreen = useCallback(() => onScreenRef.current, []);

  const onAskSize = useCallback(
    (key: string, size: { w: number | null; h: number }) => {
      setWidgets((list) =>
        applyWidgetAskedSize(list, key, size, columnsRef.current)
      );
    },
    [setWidgets]
  );

  // The widgets there when Home first opens load one after another.
  const loadDelaysRef = useRef<Map<string, number> | null>(null);
  if (loadDelaysRef.current === null) {
    loadDelaysRef.current = new Map(
      widgets.map((widget, index) => [
        homeWidgetKey(widget),
        index * LOAD_STAGGER_MS,
      ])
    );
  }

  // Arranging ends when Home goes away (its <Activity> takes the effects
  // down) and with Escape.
  useEffect(() => () => setArranging(false), []);
  useEffect(() => {
    if (!arranging || pickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArranging(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [arranging, pickerOpen]);
  useEffect(() => {
    if (widgets.length === 0) setArranging(false);
  }, [widgets.length]);

  const addWidget = (listing: HomeWidgetListing) => {
    setWidgets((list) =>
      addSavedWidget(
        list,
        {
          name: listing.name,
          identifier: listing.identifier,
          title: listing.title,
        },
        columnsRef.current
      )
    );
  };
  const removeWidget = (key: string) => {
    setWidgets((list) => removeSavedWidget(list, key));
  };
  const reloadWidget = (key: string) => {
    setReloadKeys((current) => ({
      ...current,
      [key]: (current[key] ?? 0) + 1,
    }));
  };
  const openWidgetApp = (widget: SavedHomeWidget) => {
    executeEvent('addTab', { data: { service: 'APP', name: widget.name } });
    executeEvent('open-apps-mode', {});
  };

  // Arranging with the pointer.
  const dragRef = useRef<Drag | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const stopAutoScroll = () => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  };
  useEffect(() => () => stopAutoScroll(), []);

  /** Works the drag out from where the pointer is now. */
  const follow = () => {
    const drag = dragRef.current;
    const grid = gridRef.current;
    if (!drag || !grid) return;
    const box = grid.getBoundingClientRect();
    // The grid moves with the page when it scrolls under a held widget.
    const dx = drag.lastX - drag.startX - (box.left - drag.gridLeft);
    const dy = drag.lastY - drag.startY - (box.top - drag.gridTop);
    const item = drag.start.find((entry) => entry.key === drag.key);
    if (!item) return;
    const cols = columnsRef.current;
    let next: LayoutItem[];
    if (drag.kind === 'move') {
      const left = drag.rect.left + dx;
      const top = drag.rect.top + dy;
      const card = cardRefs.current.get(drag.key);
      if (card) {
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
      }
      const cell = gridCellAt(left, top, columnPx, item.w, cols);
      next = moveGridItem(drag.start, drag.key, cell.x, cell.y, cols);
    } else {
      const width = Math.max(
        columnPx,
        Math.min(gridWidth - drag.rect.left, drag.rect.width + dx)
      );
      const height = Math.max(
        WIDGET_MIN_H * WIDGET_GRID_ROW_PX +
          (WIDGET_MIN_H - 1) * WIDGET_GRID_GAP_PX,
        Math.min(
          WIDGET_MAX_H * WIDGET_GRID_ROW_PX +
            (WIDGET_MAX_H - 1) * WIDGET_GRID_GAP_PX,
          drag.rect.height + dy
        )
      );
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.width = `${width}px`;
        ghost.style.height = `${height}px`;
      }
      const size = gridSizeFor(width, height, columnPx, item.x, cols);
      next = resizeGridItem(drag.start, drag.key, size.w, size.h, cols).map(
        (entry) =>
          entry.key === drag.key
            ? { ...entry, sizedBy: 'user' as const }
            : entry
      );
    }
    if (!sameLayout(next, drag.layout)) {
      drag.layout = next;
      setDragLayout(next);
    }
  };

  /** Near the top or bottom edge, the page scrolls under a held widget. */
  const autoScroll = () => {
    autoScrollRef.current = null;
    const drag = dragRef.current;
    const scroller = scrollParentOf(gridRef.current);
    if (!drag || !drag.moved || !scroller) return;
    const box = scroller.getBoundingClientRect();
    let speed = 0;
    if (drag.lastY < box.top + AUTO_SCROLL_EDGE_PX) {
      speed =
        -(box.top + AUTO_SCROLL_EDGE_PX - drag.lastY) / AUTO_SCROLL_EDGE_PX;
    } else if (drag.lastY > box.bottom - AUTO_SCROLL_EDGE_PX) {
      speed =
        (drag.lastY - (box.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX;
    }
    if (speed === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(-1, Math.min(1, speed)) * AUTO_SCROLL_MAX_PX;
    if (scroller.scrollTop !== before) follow();
    autoScrollRef.current = requestAnimationFrame(autoScroll);
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    key: string,
    kind: Drag['kind']
  ) => {
    if (event.button !== 0) return;
    const grid = gridRef.current;
    const item = savedLayout.find((entry) => entry.key === key);
    if (!grid || !item) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      // The pointer stays this element's even when it leaves it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* not a live pointer: moves still come while it is over the element */
    }
    const box = grid.getBoundingClientRect();
    dragRef.current = {
      kind,
      key,
      pointerId: event.pointerId,
      start: savedLayout,
      layout: savedLayout,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      gridLeft: box.left,
      gridTop: box.top,
      rect: gridRectPx(item, columnPx),
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved) {
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
        MOVE_SLOP_PX
      ) {
        return;
      }
      drag.moved = true;
      setDragKey(drag.key);
      setDragKind(drag.kind);
      setDragLayout(drag.start);
    }
    follow();
    if (autoScrollRef.current === null) {
      autoScrollRef.current = requestAnimationFrame(autoScroll);
    }
  };

  const endDrag = (
    event: ReactPointerEvent<HTMLElement>,
    cancelled = false
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    stopAutoScroll();
    if (!drag.moved) return;
    if (!cancelled) {
      const result = drag.layout;
      setWidgets((list) =>
        applyWidgetLayout(layoutForColumns(list, columnsRef.current), result)
      );
    }
    const card = cardRefs.current.get(drag.key);
    if (card) {
      // React sets its place again from the layout on this render.
      card.style.left = '';
      card.style.top = '';
    }
    setDragLayout(null);
    setDragKey(null);
    setDragKind(null);
  };

  /** Arranging with the keyboard: arrows move, Shift + arrows resize. */
  const onCardKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    key: string
  ) => {
    const item = savedByKey.get(key);
    if (!item) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeWidget(key);
      return;
    }
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    const cols = columnsRef.current;
    const next = event.shiftKey
      ? resizeGridItem(
          savedLayout,
          key,
          item.w + delta[0],
          item.h + delta[1],
          cols
        ).map((entry) =>
          entry.key === key ? { ...entry, sizedBy: 'user' as const } : entry
        )
      : moveGridItem(
          savedLayout,
          key,
          item.x + delta[0],
          item.y + delta[1],
          cols
        );
    setWidgets((list) => applyWidgetLayout(layoutForColumns(list, cols), next));
  };

  const full = widgets.length + elsewhere.length >= HOME_WIDGET_LIMIT;
  const gridHeight = gridHeightPx(layout);
  const draggedItem = dragKey ? layoutByKey.get(dragKey) : undefined;
  const transition = reduceMotion
    ? 'none'
    : `left 220ms ${EASE}, top 220ms ${EASE}, width 220ms ${EASE}, height 220ms ${EASE}`;
  const cardSurface = alpha(
    theme.palette.background.paper,
    isDark ? 0.55 : 0.92
  );
  const cardBorder = alpha(
    theme.palette.border?.main ?? theme.palette.divider,
    isDark ? 0.24 : 0.16
  );
  const title = t('group:home_widgets.title', { defaultValue: 'Widgets' });

  const header = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
        <WidgetsRoundedIcon
          sx={{ color: theme.palette.text.secondary, fontSize: '1.05rem' }}
        />
        <Typography
          component="h2"
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.88rem',
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </Typography>
        {arranging ? (
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}
          >
            {t('group:home_widgets.arrange_hint', {
              defaultValue:
                'Drag a widget to move it, its corner to resize it.',
            })}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.75 }}>
        <Tooltip
          title={
            full
              ? t('group:home_widgets.limit', {
                  defaultValue: 'You can have up to {{max}} widgets on Home.',
                  max: HOME_WIDGET_LIMIT,
                })
              : ''
          }
        >
          <span>
            <Button
              disabled={full}
              onClick={() => setPickerOpen(true)}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={{
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                textTransform: 'none',
              }}
              variant="outlined"
            >
              {t('group:home_widgets.add_widget', {
                defaultValue: 'add widget',
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </span>
        </Tooltip>
        <Button
          aria-pressed={arranging}
          onClick={() => setArranging((value) => !value)}
          size="small"
          startIcon={
            arranging ? <CheckRoundedIcon /> : <DashboardCustomizeRoundedIcon />
          }
          sx={{
            borderRadius: 999,
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'none',
          }}
          variant={arranging ? 'contained' : 'text'}
        >
          {arranging
            ? t('group:home_widgets.done', {
                defaultValue: 'done',
                postProcess: 'capitalizeFirstChar',
              })
            : t('group:home_widgets.arrange', {
                defaultValue: 'arrange',
                postProcess: 'capitalizeFirstChar',
              })}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Box
      component="section"
      aria-label={title}
      data-home-widgets=""
      sx={{
        ...dashboardPanelSx(theme, 'base'),
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        p: '10px 12px 12px',
        width: '100%',
      }}
    >
      {widgets.length === 0 ? (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            justifyContent: 'space-between',
            px: 0.5,
            py: 0.75,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1.5,
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(theme.palette.primary.main, 0.12),
                borderRadius: '12px',
                color: theme.palette.primary.main,
                display: 'flex',
                flexShrink: 0,
                height: 40,
                justifyContent: 'center',
                width: 40,
              }}
            >
              <WidgetsRoundedIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component="h2"
                sx={{ fontSize: '0.88rem', fontWeight: 600 }}
              >
                {title}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.76rem',
                  lineHeight: 1.45,
                }}
              >
                {t('group:home_widgets.empty', {
                  defaultValue:
                    'Put small Q-Apps on Home: a clock, the weather, the latest posts of your favourite apps.',
                })}
              </Typography>
            </Box>
          </Box>
          <Button
            onClick={() => setPickerOpen(true)}
            size="small"
            startIcon={<AddRoundedIcon />}
            sx={{ borderRadius: 999, fontWeight: 600, textTransform: 'none' }}
            variant="contained"
          >
            {t('group:home_widgets.add_widget', {
              defaultValue: 'add widget',
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </Box>
      ) : (
        <>
          {header}
          <Box
            ref={gridRef}
            sx={{
              height: `${gridHeight}px`,
              position: 'relative',
              transition: reduceMotion ? 'none' : `height 220ms ${EASE}`,
              width: '100%',
            }}
          >
            {/* Where the held widget lands. */}
            {draggedItem ? (
              <Box
                aria-hidden
                sx={{
                  border: `2px dashed ${alpha(theme.palette.primary.main, 0.55)}`,
                  borderRadius: `${CARD_RADIUS_PX}px`,
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  position: 'absolute',
                  transition,
                  ...gridRectPx(draggedItem, columnPx),
                }}
              />
            ) : null}
            {widgets.map((widget) => {
              const key = homeWidgetKey(widget);
              const item = layoutByKey.get(key) ?? savedByKey.get(key);
              const start = savedByKey.get(key) ?? item;
              if (!item || !start) return null;
              const held = dragKey === key;
              // A held widget keeps its own place and size until it is
              // dropped (it follows the pointer); the others show the result.
              const place = held ? start : item;
              const px = gridRectPx(place, columnPx);
              const shown = shownWidgets.find(
                (entry) => homeWidgetKey(entry) === key
              );
              const label = widget.title ?? widget.name;
              return (
                <Box
                  data-widget-identifier={widget.identifier ?? ''}
                  data-widget-name={widget.name}
                  key={`${baseUrl}\u0000${key}`}
                  ref={cardRef(key)}
                  sx={{
                    backgroundColor: cardSurface,
                    border: `1px solid ${cardBorder}`,
                    borderRadius: `${CARD_RADIUS_PX}px`,
                    boxShadow: held
                      ? `0 18px 40px ${alpha('#000', isDark ? 0.45 : 0.18)}`
                      : 'none',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    position: 'absolute',
                    transition:
                      held && dragKind === 'move' ? 'none' : transition,
                    zIndex: held ? 3 : 1,
                    ...px,
                  }}
                >
                  <HomeWidgetView
                    baseUrl={baseUrl}
                    columns={columns}
                    interactive={!arranging}
                    isOnScreen={isOnScreen}
                    loadDelayMs={loadDelaysRef.current?.get(key) ?? 0}
                    onAskSize={onAskSize}
                    reloadKey={reloadKeys[key] ?? 0}
                    widthPx={px.width}
                    heightPx={px.height}
                    visible={
                      active &&
                      pageVisible &&
                      (inView === null || inView.has(key))
                    }
                    widget={shown ?? widget}
                  />
                  {arranging ? (
                    <Box
                      aria-label={t('group:home_widgets.arrange_widget', {
                        defaultValue:
                          '{{title}}: arrow keys move it, Shift and arrow keys resize it, Delete removes it.',
                        title: label,
                      })}
                      onKeyDown={(event) => onCardKeyDown(event, key)}
                      onLostPointerCapture={(event) => endDrag(event, true)}
                      onPointerCancel={(event) => endDrag(event, true)}
                      onPointerDown={(event) => beginDrag(event, key, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={(event) => endDrag(event)}
                      role="group"
                      sx={{
                        backgroundColor: alpha(
                          theme.palette.background.default,
                          isDark ? 0.42 : 0.5
                        ),
                        backdropFilter: 'blur(2px)',
                        cursor: held ? 'grabbing' : 'grab',
                        display: 'flex',
                        flexDirection: 'column',
                        inset: 0,
                        justifyContent: 'space-between',
                        outline: 'none',
                        p: '4px',
                        position: 'absolute',
                        touchAction: 'none',
                        userSelect: 'none',
                        zIndex: 2,
                        '&:focus-visible': {
                          boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
                        },
                      }}
                      tabIndex={0}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '2px',
                          justifyContent: 'flex-end',
                        }}
                      >
                        {[
                          {
                            icon: (
                              <OpenInNewRoundedIcon sx={{ fontSize: 15 }} />
                            ),
                            label: t('group:home_widgets.open_app', {
                              defaultValue: 'open {{name}}',
                              name: widget.name,
                              postProcess: 'capitalizeFirstChar',
                            }),
                            onClick: () => openWidgetApp(widget),
                          },
                          {
                            icon: <RefreshRoundedIcon sx={{ fontSize: 15 }} />,
                            label: t('group:home_widgets.reload', {
                              defaultValue: 'reload widget',
                              postProcess: 'capitalizeFirstChar',
                            }),
                            onClick: () => reloadWidget(key),
                          },
                          {
                            icon: (
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                            ),
                            label: t('group:home_widgets.remove', {
                              defaultValue: 'remove widget',
                              postProcess: 'capitalizeFirstChar',
                            }),
                            onClick: () => removeWidget(key),
                          },
                        ].map((action) => (
                          <Tooltip key={action.label} title={action.label}>
                            <IconButton
                              aria-label={action.label}
                              onClick={action.onClick}
                              onPointerDown={(event) => event.stopPropagation()}
                              size="small"
                              sx={{
                                backgroundColor: alpha(
                                  theme.palette.background.paper,
                                  0.9
                                ),
                                border: `1px solid ${cardBorder}`,
                                color: theme.palette.text.primary,
                                height: 24,
                                width: 24,
                                '&:hover': {
                                  backgroundColor:
                                    theme.palette.background.paper,
                                },
                              }}
                            >
                              {action.icon}
                            </IconButton>
                          </Tooltip>
                        ))}
                      </Box>
                      <Box
                        aria-hidden
                        sx={{
                          alignItems: 'center',
                          color: theme.palette.text.primary,
                          display: 'flex',
                          gap: 0.5,
                          justifyContent: 'center',
                          minWidth: 0,
                          pointerEvents: 'none',
                        }}
                      >
                        <DragIndicatorRoundedIcon sx={{ fontSize: 18 }} />
                        {item.w > 1 ? (
                          <Typography
                            noWrap
                            sx={{ fontSize: '0.74rem', fontWeight: 600 }}
                          >
                            {label}
                          </Typography>
                        ) : null}
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Box
                          aria-hidden
                          // Its own pointer: kept from the card below it.
                          onLostPointerCapture={(event) => {
                            event.stopPropagation();
                            endDrag(event, true);
                          }}
                          onPointerCancel={(event) => {
                            event.stopPropagation();
                            endDrag(event, true);
                          }}
                          onPointerDown={(event) =>
                            beginDrag(event, key, 'resize')
                          }
                          onPointerMove={(event) => {
                            event.stopPropagation();
                            moveDrag(event);
                          }}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            endDrag(event);
                          }}
                          sx={{
                            alignItems: 'center',
                            backgroundColor: alpha(
                              theme.palette.background.paper,
                              0.9
                            ),
                            border: `1px solid ${cardBorder}`,
                            borderRadius: '7px',
                            cursor: 'nwse-resize',
                            display: 'flex',
                            height: 24,
                            justifyContent: 'center',
                            touchAction: 'none',
                            width: 24,
                          }}
                        >
                          <OpenInFullRoundedIcon
                            sx={{ fontSize: 14, transform: 'rotate(90deg)' }}
                          />
                        </Box>
                      </Box>
                    </Box>
                  ) : null}
                </Box>
              );
            })}
            {/* The size a widget is being resized to, before it snaps. */}
            {dragKey && dragKind === 'resize' ? (
              <Box
                aria-hidden
                ref={ghostRef}
                sx={{
                  border: `2px solid ${theme.palette.primary.main}`,
                  borderRadius: `${CARD_RADIUS_PX}px`,
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  position: 'absolute',
                  zIndex: 4,
                  ...(() => {
                    const start = savedByKey.get(dragKey);
                    return start ? gridRectPx(start, columnPx) : {};
                  })(),
                }}
              />
            ) : null}
          </Box>
        </>
      )}
      <HomeWidgetPicker
        added={[...widgets, ...elsewhere]}
        onAdd={addWidget}
        onClose={() => setPickerOpen(false)}
        open={pickerOpen}
      />
    </Box>
  );
};
