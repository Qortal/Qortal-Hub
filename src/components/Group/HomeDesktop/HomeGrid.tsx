import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DashboardCustomizeRoundedIcon from '@mui/icons-material/DashboardCustomizeRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import { HOME_EDIT_LAYOUT_EVENT } from './homeDesktopConstants';
import {
  HOME_AUTO_HEIGHT_WINDOWS,
  HOME_GRID_COLUMNS,
  HOME_GRID_MIN_WIDTH_PX,
  HOME_GRID_TWO_COLUMNS_MIN_WIDTH_PX,
  HOME_WINDOW_IDS,
  HOME_WINDOW_MIN_SIZE,
  type HomeGridItem,
  type HomeWindowId,
  homeGridCellAt,
  homeGridColumnPx,
  homeGridFlow,
  homeGridHeightPx,
  homeGridRectPx,
  homeGridRowsFor,
  homeGridShown,
  homeGridSizeFor,
  mergeHomeGrid,
  moveHomeWindow,
  resizeHomeWindow,
  sameHomeGrid,
} from './homeGrid';

const MOVE_SLOP_PX = 4;
const AUTO_SCROLL_EDGE_PX = 64;
const AUTO_SCROLL_MAX_PX = 16;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const WINDOW_RADIUS_PX = 14;
/** Shift + Up / Down changes a window's height by this many rows (50 px). */
const KEYBOARD_RESIZE_ROWS = 5;

type DragKind = 'move' | 'resize-e' | 'resize-s' | 'resize-se';

type Drag = {
  kind: DragKind;
  key: HomeWindowId;
  pointerId: number;
  /** The layout when the drag began: every step is worked out from it. */
  start: HomeGridItem[];
  /** The snapped layout now. */
  layout: HomeGridItem[];
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

export type HomeGridWindow = {
  id: HomeWindowId;
  /** The window's name, for the edit controls. */
  title: string;
  node: ReactNode;
};

type HomeGridProps = {
  /** Home is the view showing: editing stops when it isn't. */
  active: boolean;
  /** Where every window is, hidden ones included. */
  grid: readonly HomeGridItem[];
  /** Shown in the header row's left and right ends while not editing. */
  headerEnd?: ReactNode;
  headerStart?: ReactNode;
  /** The windows switched off, which editing can show again. */
  hiddenWindows: readonly { id: HomeWindowId; title: string }[];
  onChangeGrid: (grid: HomeGridItem[]) => void;
  onHideWindow: (id: HomeWindowId) => void;
  onResetGrid: () => void;
  onShowWindow: (id: HomeWindowId) => void;
  /** The windows shown, in any order. */
  windows: readonly HomeGridWindow[];
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const sharesColumns = (a: HomeGridItem, b: HomeGridItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w;

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

/**
 * Home's windows on one grid (homeGrid.ts), with Edit Home: drag a window to
 * move it, its right or bottom edge or its corner to resize it, or use the
 * keyboard. Each window is a size container ("home-window"), so its content
 * can adapt to the size it's given with container queries.
 */
export const HomeGrid = ({
  active,
  grid,
  headerEnd,
  headerStart,
  hiddenWindows,
  onChangeGrid,
  onHideWindow,
  onResetGrid,
  onShowWindow,
  windows,
}: HomeGridProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['group']);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // The grid's width decides between the grid and the flowing columns.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    // A hidden Home measures 0: it keeps the width it had.
    const measure = () => {
      if (node.clientWidth > 0) setWidth(node.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const flowing = width > 0 && width < HOME_GRID_MIN_WIDTH_PX;
  const flowColumns: 1 | 2 =
    width >= HOME_GRID_TWO_COLUMNS_MIN_WIDTH_PX ? 2 : 1;
  const columns = flowing ? flowColumns : HOME_GRID_COLUMNS;
  const columnPx = homeGridColumnPx(width || 1, columns);
  const columnPxRef = useRef(columnPx);
  columnPxRef.current = columnPx;
  const widthRef = useRef(width);
  widthRef.current = width;

  // The windows whose height follows their content are measured.
  const [measuredRows, setMeasuredRows] = useState<
    Partial<Record<HomeWindowId, number>>
  >({});
  const sizerIds = useRef(new WeakMap<Element, HomeWindowId>());
  const sizerObserverRef = useRef<ResizeObserver | null>(null);
  const measureSizer = useCallback((element: Element) => {
    const id = sizerIds.current.get(element);
    const height = (element as HTMLElement).offsetHeight;
    if (!id || height <= 0) return;
    const rows = homeGridRowsFor(height);
    setMeasuredRows((current) =>
      current[id] === rows ? current : { ...current, [id]: rows }
    );
  }, []);
  useEffect(() => () => sizerObserverRef.current?.disconnect(), []);
  const sizerRefCallbacks = useRef(
    new Map<HomeWindowId, (node: HTMLDivElement | null) => void>()
  );
  const sizerNodes = useRef(new Map<HomeWindowId, HTMLDivElement>());
  const sizerRef = (id: HomeWindowId) => {
    let callback = sizerRefCallbacks.current.get(id);
    if (!callback) {
      callback = (node: HTMLDivElement | null) => {
        const known = sizerNodes.current.get(id);
        if (known && known !== node) {
          sizerObserverRef.current?.unobserve(known);
          sizerNodes.current.delete(id);
        }
        if (!node) return;
        sizerNodes.current.set(id, node);
        sizerIds.current.set(node, id);
        if (
          !sizerObserverRef.current &&
          typeof ResizeObserver !== 'undefined'
        ) {
          sizerObserverRef.current = new ResizeObserver((entries) => {
            entries.forEach((entry) => measureSizer(entry.target));
          });
        }
        sizerObserverRef.current?.observe(node);
        measureSizer(node);
      };
      sizerRefCallbacks.current.set(id, callback);
    }
    return callback;
  };

  const windowsById = useMemo(
    () => new Map(windows.map((window) => [window.id, window])),
    [windows]
  );
  const shownLayout = useMemo(
    () => homeGridShown(grid, (id) => windowsById.has(id), measuredRows),
    [grid, measuredRows, windowsById]
  );

  // Editing.
  const [editing, setEditing] = useState(false);
  const canEdit = !flowing;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !canEdit) setEditing(false);
  }, [active, canEdit]);
  useEffect(() => {
    const start = () => {
      if (canEditRef.current) setEditing(true);
    };
    subscribeToEvent(HOME_EDIT_LAYOUT_EVENT, start);
    return () => unsubscribeFromEvent(HOME_EDIT_LAYOUT_EVENT, start);
  }, []);
  useEffect(() => {
    if (!editing || menuAnchor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, menuAnchor]);

  // Moving and resizing with the pointer.
  const [dragLayout, setDragLayout] = useState<HomeGridItem[] | null>(null);
  const [dragStart, setDragStart] = useState<HomeGridItem[] | null>(null);
  const [dragKey, setDragKey] = useState<HomeWindowId | null>(null);
  const [dragKind, setDragKind] = useState<DragKind | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const frameRefs = useRef(new Map<HomeWindowId, HTMLDivElement>());
  const frameRefCallbacks = useRef(
    new Map<HomeWindowId, (node: HTMLDivElement | null) => void>()
  );
  const frameRef = (id: HomeWindowId) => {
    let callback = frameRefCallbacks.current.get(id);
    if (!callback) {
      callback = (node: HTMLDivElement | null) => {
        if (node) frameRefs.current.set(id, node);
        else frameRefs.current.delete(id);
      };
      frameRefCallbacks.current.set(id, callback);
    }
    return callback;
  };

  // What's shown: the drag's layout while one is going on (with the
  // content-sized windows at their measured height), else the saved one.
  const layout =
    useMemo(
      () =>
        dragLayout ? homeGridShown(dragLayout, () => true, measuredRows) : null,
      [dragLayout, measuredRows]
    ) ?? shownLayout;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const gridPropRef = useRef(grid);
  gridPropRef.current = grid;
  const placed = flowing ? homeGridFlow(layout, flowColumns) : layout;
  const placedByKey = new Map(placed.map((item) => [item.key, item]));
  const dragStartByKey = new Map(
    (dragStart ?? []).map((item) => [item.key, item])
  );

  const stopAutoScroll = () => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  };
  useEffect(() => () => stopAutoScroll(), []);
  // Editing stopped in the middle of a drag (Escape, Home hidden): it's
  // dropped where it started.
  useEffect(() => {
    if (editing) return;
    const drag = dragRef.current;
    dragRef.current = null;
    stopAutoScroll();
    const frame = drag ? frameRefs.current.get(drag.key) : undefined;
    if (frame) {
      frame.style.left = '';
      frame.style.top = '';
    }
    setDragLayout(null);
    setDragStart(null);
    setDragKey(null);
    setDragKind(null);
  }, [editing]);

  /** Works the drag out from where the pointer is now. */
  const follow = () => {
    const drag = dragRef.current;
    const node = gridRef.current;
    if (!drag || !node) return;
    const box = node.getBoundingClientRect();
    // The grid moves with the page when it scrolls under a held window.
    const dx = drag.lastX - drag.startX - (box.left - drag.gridLeft);
    const dy = drag.lastY - drag.startY - (box.top - drag.gridTop);
    const item = drag.start.find((entry) => entry.key === drag.key);
    if (!item) return;
    const columnWidth = columnPxRef.current;
    let next: HomeGridItem[];
    if (drag.kind === 'move') {
      const left = drag.rect.left + dx;
      const top = drag.rect.top + dy;
      const frame = frameRefs.current.get(drag.key);
      if (frame) {
        frame.style.left = `${left}px`;
        frame.style.top = `${top}px`;
      }
      const cell = homeGridCellAt(left, top, columnWidth, item.w);
      next = moveHomeWindow(drag.start, drag.key, cell.x, cell.y);
    } else {
      const min = homeGridRectPx(
        { x: 0, y: 0, ...HOME_WINDOW_MIN_SIZE[drag.key] },
        columnWidth
      );
      const widthPx =
        drag.kind === 'resize-s'
          ? drag.rect.width
          : clamp(
              drag.rect.width + dx,
              min.width,
              Math.max(min.width, widthRef.current - drag.rect.left)
            );
      const heightPx =
        drag.kind === 'resize-e'
          ? drag.rect.height
          : Math.max(min.height, drag.rect.height + dy);
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.width = `${widthPx}px`;
        ghost.style.height = `${heightPx}px`;
      }
      const size = homeGridSizeFor(widthPx, heightPx, columnWidth);
      next = resizeHomeWindow(
        drag.start,
        drag.key,
        size.w,
        drag.kind === 'resize-e' ? item.h : size.h
      );
    }
    if (!sameHomeGrid(next, drag.layout)) {
      drag.layout = next;
      setDragLayout(next);
    }
  };

  /** Near the top or bottom edge, the page scrolls under a held window. */
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
    key: HomeWindowId,
    kind: DragKind
  ) => {
    if (event.button !== 0) return;
    const node = gridRef.current;
    const start = layoutRef.current;
    const item = start.find((entry) => entry.key === key);
    if (!node || !item) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      // The pointer stays this element's even when it leaves it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* not a live pointer: moves still come while it is over the element */
    }
    const box = node.getBoundingClientRect();
    dragRef.current = {
      kind,
      key,
      pointerId: event.pointerId,
      start,
      layout: start,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      gridLeft: box.left,
      gridTop: box.top,
      rect: homeGridRectPx(item, columnPxRef.current),
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
      setDragStart(drag.start);
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
    if (!cancelled && !sameHomeGrid(drag.layout, drag.start)) {
      onChangeGrid(mergeHomeGrid(gridPropRef.current, drag.layout));
    }
    const frame = frameRefs.current.get(drag.key);
    if (frame) {
      // React sets its place again from the layout on this render.
      frame.style.left = '';
      frame.style.top = '';
    }
    setDragLayout(null);
    setDragStart(null);
    setDragKey(null);
    setDragKind(null);
  };

  /**
   * The keyboard: arrows move a window (up and down past its neighbour in
   * the same columns), Shift + arrows resize it, Delete hides it.
   */
  const onWindowKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    key: HomeWindowId
  ) => {
    if (event.target !== event.currentTarget) return;
    const items = layoutRef.current;
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (key === 'account') return;
      event.preventDefault();
      onHideWindow(key);
      return;
    }
    const others = items.filter(
      (other) => other.key !== key && sharesColumns(other, item)
    );
    let next: HomeGridItem[] | null = null;
    if (event.shiftKey) {
      const rows = HOME_AUTO_HEIGHT_WINDOWS.has(key) ? 0 : KEYBOARD_RESIZE_ROWS;
      const change: Record<string, [number, number]> = {
        ArrowDown: [0, rows],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -rows],
      };
      const delta = change[event.key];
      if (delta) {
        next = resizeHomeWindow(
          items,
          key,
          item.w + delta[0],
          item.h + delta[1]
        );
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      next = moveHomeWindow(
        items,
        key,
        item.x + (event.key === 'ArrowLeft' ? -1 : 1),
        item.y
      );
    } else if (event.key === 'ArrowDown') {
      const below = others
        .filter((other) => other.y > item.y)
        .sort((a, b) => a.y - b.y)[0];
      if (below) {
        next = moveHomeWindow(
          items,
          key,
          item.x,
          Math.max(item.y + 1, below.y + below.h - item.h)
        );
      }
    } else if (event.key === 'ArrowUp') {
      const above = others
        .filter((other) => other.y < item.y)
        .sort((a, b) => b.y - a.y)[0];
      if (above) next = moveHomeWindow(items, key, item.x, above.y);
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    if (next && !sameHomeGrid(next, items)) {
      onChangeGrid(mergeHomeGrid(gridPropRef.current, next));
    }
  };

  const gridHeight = homeGridHeightPx(placed);
  const draggedItem = dragKey ? placedByKey.get(dragKey) : undefined;
  const transition =
    editing && !reduceMotion ? `left 200ms ${EASE}, top 200ms ${EASE}` : 'none';
  const accent = theme.palette.primary.main;
  const controlSurface = alpha(theme.palette.background.paper, 0.94);
  const controlBorder = alpha(
    theme.palette.border?.main ?? theme.palette.divider,
    isDark ? 0.4 : 0.3
  );
  const hint = t('group:dashboard.edit_home_hint');

  const header = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'space-between',
        minHeight: '32px',
        mb: '10px',
        width: '100%',
        ...(editing
          ? {
              backdropFilter: 'blur(8px)',
              backgroundColor: alpha(theme.palette.background.default, 0.9),
              borderRadius: '12px',
              position: 'sticky',
              px: 1,
              py: 0.75,
              top: 8,
              zIndex: 6,
            }
          : {}),
      }}
    >
      {editing ? (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.8rem',
            minWidth: 0,
          }}
        >
          {hint}
        </Typography>
      ) : (
        <Box sx={{ minWidth: 0 }}>{headerStart}</Box>
      )}
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
        {editing ? (
          <>
            <Button
              aria-haspopup="menu"
              disabled={hiddenWindows.length === 0}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={{ borderRadius: 999, textTransform: 'none' }}
              variant="outlined"
            >
              {t('group:dashboard.show_window')}
            </Button>
            <Menu
              anchorEl={menuAnchor}
              onClose={() => setMenuAnchor(null)}
              open={!!menuAnchor}
            >
              {hiddenWindows.map((window) => (
                <MenuItem
                  key={window.id}
                  onClick={() => {
                    setMenuAnchor(null);
                    onShowWindow(window.id);
                  }}
                >
                  {window.title}
                </MenuItem>
              ))}
            </Menu>
            <Button
              onClick={onResetGrid}
              size="small"
              startIcon={<RestartAltRoundedIcon />}
              sx={{ borderRadius: 999, textTransform: 'none' }}
            >
              {t('group:dashboard.reset_layout')}
            </Button>
            <Button
              onClick={() => setEditing(false)}
              size="small"
              startIcon={<CheckRoundedIcon />}
              sx={{ borderRadius: 999, textTransform: 'none' }}
              variant="contained"
            >
              {t('group:home_widgets.done', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </>
        ) : (
          <>
            {headerEnd}
            <Tooltip
              title={
                canEdit
                  ? t('group:dashboard.edit_home')
                  : t('group:dashboard.edit_home_wider')
              }
            >
              <span>
                <IconButton
                  aria-label={t('group:dashboard.edit_home')}
                  disabled={!canEdit}
                  onClick={() => setEditing(true)}
                  size="small"
                  sx={{ color: theme.palette.text.secondary }}
                >
                  <DashboardCustomizeRoundedIcon sx={{ fontSize: '1.1rem' }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Box>
    </Box>
  );

  const handle = (
    key: HomeWindowId,
    kind: Exclude<DragKind, 'move'>,
    label: string
  ) => {
    const place =
      kind === 'resize-e'
        ? { bottom: 0, right: -9, top: 0, width: 18 }
        : kind === 'resize-s'
          ? { bottom: -9, height: 18, left: 0, right: 0 }
          : { bottom: -9, height: 22, right: -9, width: 22 };
    const cursor =
      kind === 'resize-e'
        ? 'ew-resize'
        : kind === 'resize-s'
          ? 'ns-resize'
          : 'nwse-resize';
    return (
      <Tooltip key={kind} title={label}>
        <Box
          aria-hidden
          // Its own pointer: kept from the window under it.
          onLostPointerCapture={(event) => {
            event.stopPropagation();
            endDrag(event, true);
          }}
          onPointerCancel={(event) => {
            event.stopPropagation();
            endDrag(event, true);
          }}
          onPointerDown={(event) => beginDrag(event, key, kind)}
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
            cursor,
            display: 'flex',
            justifyContent: 'center',
            position: 'absolute',
            touchAction: 'none',
            zIndex: 4,
            ...place,
          }}
        >
          <Box
            sx={{
              backgroundColor: controlSurface,
              border: `1px solid ${alpha(accent, 0.7)}`,
              borderRadius: kind === 'resize-se' ? '6px' : 999,
              boxShadow: `0 2px 8px ${alpha('#000', isDark ? 0.4 : 0.16)}`,
              height: kind === 'resize-e' ? 40 : kind === 'resize-s' ? 8 : 14,
              width: kind === 'resize-s' ? 40 : kind === 'resize-e' ? 8 : 14,
            }}
          />
        </Box>
      </Tooltip>
    );
  };

  const editControls = (window: HomeGridWindow, held: boolean) => {
    const { id, title } = window;
    const hideable = id !== 'account';
    const auto = HOME_AUTO_HEIGHT_WINDOWS.has(id);
    return (
      <Box
        aria-label={t(
          hideable
            ? 'group:dashboard.edit_window'
            : 'group:dashboard.edit_window_no_hide',
          { window: title }
        )}
        onKeyDown={(event) => onWindowKeyDown(event, id)}
        onLostPointerCapture={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, true)}
        onPointerDown={(event) => beginDrag(event, id, 'move')}
        onPointerMove={moveDrag}
        onPointerUp={(event) => endDrag(event)}
        role="group"
        sx={{
          backgroundColor: alpha(
            theme.palette.background.default,
            isDark ? 0.3 : 0.24
          ),
          border: `2px dashed ${alpha(accent, held ? 0.9 : 0.55)}`,
          borderRadius: `${WINDOW_RADIUS_PX}px`,
          cursor: held && dragKind === 'move' ? 'grabbing' : 'grab',
          display: 'flex',
          inset: 0,
          justifyContent: 'center',
          outline: 'none',
          p: '8px',
          position: 'absolute',
          touchAction: 'none',
          userSelect: 'none',
          zIndex: 3,
          '&:focus-visible': {
            boxShadow: `0 0 0 3px ${alpha(accent, 0.5)}`,
          },
        }}
        tabIndex={0}
      >
        <Box
          sx={{
            alignItems: 'center',
            alignSelf: 'flex-start',
            backgroundColor: controlSurface,
            border: `1px solid ${controlBorder}`,
            borderRadius: 999,
            boxShadow: `0 4px 14px ${alpha('#000', isDark ? 0.35 : 0.12)}`,
            color: theme.palette.text.primary,
            display: 'inline-flex',
            gap: 0.5,
            maxWidth: '100%',
            minWidth: 0,
            pl: 0.75,
            pr: hideable ? 0.25 : 1.25,
            py: hideable ? 0.25 : 0.5,
          }}
        >
          <DragIndicatorRoundedIcon
            sx={{ color: theme.palette.text.secondary, fontSize: 18 }}
          />
          <Typography
            noWrap
            sx={{ fontSize: '0.78rem', fontWeight: 600, minWidth: 0 }}
          >
            {title}
          </Typography>
          {hideable ? (
            <Tooltip
              title={t('group:dashboard.hide_window', { window: title })}
            >
              <IconButton
                aria-label={t('group:dashboard.hide_window', {
                  window: title,
                })}
                onClick={() => onHideWindow(id)}
                onPointerDown={(event) => event.stopPropagation()}
                size="small"
                sx={{ color: theme.palette.text.secondary, p: '4px' }}
              >
                <VisibilityOffRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
        {auto
          ? handle(
              id,
              'resize-e',
              t('group:dashboard.resize_window_width', { window: title })
            )
          : [
              handle(
                id,
                'resize-e',
                t('group:dashboard.resize_window', { window: title })
              ),
              handle(
                id,
                'resize-s',
                t('group:dashboard.resize_window', { window: title })
              ),
              handle(
                id,
                'resize-se',
                t('group:dashboard.resize_window', { window: title })
              ),
            ]}
      </Box>
    );
  };

  return (
    <Box sx={{ width: '100%' }}>
      {header}
      <Box
        ref={gridRef}
        data-home-layout={flowing ? 'flow' : 'grid'}
        sx={{
          height: `${gridHeight}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Where the held window lands. */}
        {draggedItem && dragKind === 'move' ? (
          <Box
            aria-hidden
            sx={{
              border: `2px dashed ${alpha(accent, 0.6)}`,
              borderRadius: `${WINDOW_RADIUS_PX}px`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
              position: 'absolute',
              transition,
              ...homeGridRectPx(draggedItem, columnPx),
            }}
          />
        ) : null}
        {HOME_WINDOW_IDS.map((id) => {
          const window = windowsById.get(id);
          const item = placedByKey.get(id);
          if (!window || !item) return null;
          const held = dragKey === id;
          // A window being moved keeps its place until it's dropped (it
          // follows the pointer); the others show where they'd go.
          const start = dragStartByKey.get(id);
          const px = homeGridRectPx(
            held && dragKind === 'move' && start ? start : item,
            columnPx
          );
          const auto = HOME_AUTO_HEIGHT_WINDOWS.has(id);
          return (
            <Box
              data-home-window={id}
              key={id}
              ref={frameRef(id)}
              sx={{
                containerName: 'home-window',
                containerType: auto ? 'inline-size' : 'size',
                position: 'absolute',
                transition: held && dragKind === 'move' ? 'none' : transition,
                zIndex: held ? 5 : 1,
                '&:hover, &:focus-within': { zIndex: held ? 5 : 2 },
                ...px,
              }}
            >
              {auto ? (
                <Box ref={sizerRef(id)} sx={{ width: '100%' }}>
                  {window.node}
                </Box>
              ) : (
                <Box
                  sx={{
                    height: '100%',
                    width: '100%',
                    '& > *': { height: '100%' },
                  }}
                >
                  {window.node}
                </Box>
              )}
              {editing ? editControls(window, held) : null}
            </Box>
          );
        })}
        {/* The size a window is being resized to, before it snaps. */}
        {dragKey && dragKind && dragKind !== 'move' ? (
          <Box
            aria-hidden
            ref={ghostRef}
            sx={{
              border: `2px solid ${accent}`,
              borderRadius: `${WINDOW_RADIUS_PX}px`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
              position: 'absolute',
              zIndex: 6,
              ...(() => {
                const start = dragStartByKey.get(dragKey);
                return start ? homeGridRectPx(start, columnPx) : {};
              })(),
            }}
          />
        ) : null}
      </Box>
    </Box>
  );
};
