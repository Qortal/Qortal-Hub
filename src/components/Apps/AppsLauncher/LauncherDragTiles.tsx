import type { ReactNode } from 'react';
import {
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  useDroppable,
} from '@dnd-kit/core';
import { type SortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, type SxProps, type Theme } from '@mui/material';
import { type DropArea, type DropTile, getLauncherDrop } from './launcherDrop';
import type { LauncherDrop } from './launcherItems';
import { LAUNCHER_TILE_WIDTH_PX } from './LauncherTile';

/**
 * What dragging the launcher's tiles is built from: a tile that can be picked
 * up and dropped on, the areas that take drops, and the rule that turns the
 * pointer's position into a drop.
 */

// Space picks a tile up and puts it down, so Enter stays free to open it.
export const LAUNCHER_REORDER_KEYS = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter'],
};

/** Tiles stay where they are while one is dragged: a mark shows the drop. */
export const keepTilesInPlace: SortingStrategy = () => null;

const ROOT_AREA_ID = 'launcher-area';
const areaIdOf = (folderId: string | null) =>
  folderId === null ? ROOT_AREA_ID : `${ROOT_AREA_ID}:${folderId}`;

type TileData = { folderId: string | null; staysInRow: boolean };
type AreaData = { launcherArea: true; folderId: string | null };

const isArea = (data: unknown): data is AreaData =>
  !!(data as AreaData | undefined)?.launcherArea;

export const launcherTileGridSx = {
  display: 'grid',
  gap: '4px 8px',
  gridTemplateColumns: `repeat(auto-fill, ${LAUNCHER_TILE_WIDTH_PX}px)`,
  justifyContent: 'start',
  width: '100%',
} as const;

/**
 * What follows the pointer while a tile is dragged: its picture only, lifted,
 * so the name of the tile underneath stays readable.
 */
export const DraggedTile = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      cursor: 'grabbing',
      display: 'flex',
      justifyContent: 'center',
      paddingTop: '10px',
      width: LAUNCHER_TILE_WIDTH_PX,
    }}
  >
    <Box
      sx={(theme) => ({
        borderRadius: '16px',
        boxShadow: theme.shadows[8],
        opacity: 0.92,
      })}
    >
      {children}
    </Box>
  </Box>
);

/** The mark of where a dragged tile would land, on the tile it is about. */
export type DropMark = 'before' | 'after' | 'onto' | null;

export const dropMarkFor = (
  drop: LauncherDrop | null,
  key: string
): DropMark => {
  if (!drop || drop.kind === 'append' || drop.key !== key) return null;
  return drop.kind === 'merge' ? 'onto' : drop.side;
};

/** What a draggable tile hands to the button inside it. */
type TileButtonProps = {
  buttonRef: (node: HTMLElement | null) => void;
  sx: SxProps<Theme>;
};

interface SortableTileProps {
  id: string;
  folderId: string | null;
  /** A private app: it has no bookmark, so it cannot go into a folder. */
  staysInRow?: boolean;
  mark: DropMark;
  children: (buttonProps: TileButtonProps) => ReactNode;
}

/** A tile that can be dragged, and that others can be dropped on or next to. */
export const SortableTile = ({
  id,
  folderId,
  staysInRow = false,
  mark,
  children,
}: SortableTileProps) => {
  const data: TileData = { folderId, staysInRow };
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, data });

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ opacity: isDragging ? 0.35 : 1, position: 'relative' }}
    >
      {children({
        ...attributes,
        ...listeners,
        buttonRef: setActivatorNodeRef,
        sx: (theme) =>
          mark === 'onto'
            ? {
                backgroundColor: theme.palette.action.selected,
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: '-2px',
              }
            : {},
      })}
      {mark === 'before' || mark === 'after' ? (
        <Box
          aria-hidden
          sx={(theme) => ({
            backgroundColor: theme.palette.primary.main,
            borderRadius: '2px',
            bottom: 14,
            pointerEvents: 'none',
            position: 'absolute',
            top: 10,
            width: 4,
            ...(mark === 'before' ? { left: -6 } : { right: -6 }),
          })}
        />
      ) : null}
    </Box>
  );
};

/** The row of tiles, or an open folder: both take drops in their free space. */
export const TileDropArea = ({
  folderId,
  children,
}: {
  folderId: string | null;
  children: (ref: (node: HTMLElement | null) => void) => ReactNode;
}) => {
  const data: AreaData = { launcherArea: true, folderId };
  const { setNodeRef } = useDroppable({ id: areaIdOf(folderId), data });
  return <>{children(setNodeRef)}</>;
};

/**
 * Finds what the dragged tile is over. With a pointer, the place under it
 * decides: onto a tile, next to one, or into free space. The drop it stands
 * for travels with the collision, for `pointerDropOf` to read.
 */
export const launcherCollisionDetection: CollisionDetection = (args) => {
  // With the keyboard there is no pointer: the nearest tile is the target.
  if (!args.pointerCoordinates) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => !isArea(container.data.current)
      ),
    });
  }

  const tiles: DropTile[] = [];
  const areas: DropArea[] = [];
  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (!rect) continue;
    const data = container.data.current;
    if (isArea(data)) {
      areas.push({ folderId: data.folderId, rect });
    } else {
      const tile = data as TileData | undefined;
      tiles.push({
        key: String(container.id),
        rect,
        folderId: tile?.folderId ?? null,
        staysInRow: !!tile?.staysInRow,
      });
    }
  }

  const target = getLauncherDrop(
    args.pointerCoordinates,
    String(args.active.id),
    tiles,
    areas
  );
  if (!target) return [];
  const id = target.kind === 'append' ? areaIdOf(target.folderId) : target.key;
  const droppableContainer = args.droppableContainers.find(
    (container) => container.id === id
  );
  return droppableContainer
    ? [{ id, data: { droppableContainer, value: 1, drop: target } }]
    : [];
};

/** The drop the pointer stands for, or undefined when a key moved the tile. */
export const pointerDropOf = (
  event: DragMoveEvent | DragEndEvent
): LauncherDrop | undefined =>
  event.collisions?.[0]?.data?.drop as LauncherDrop | undefined;
