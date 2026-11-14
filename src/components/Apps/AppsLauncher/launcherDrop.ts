import { isFolderItemKey, type LauncherDrop } from './launcherItems';

export type DropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** A tile on screen that something can be dropped on or next to. */
export type DropTile = {
  key: string;
  rect: DropRect;
  /** The open folder the tile is shown in, or null for the row of tiles. */
  folderId: string | null;
  /** A tile that cannot be in a folder: a private app has no bookmark. */
  staysInRow?: boolean;
};

/** An area that takes drops in its free space: the row, or an open folder. */
export type DropArea = { folderId: string | null; rect: DropRect };

type Point = { x: number; y: number };

/**
 * The share of a tile's width, on each side, where a drop means "next to it".
 * The middle means "onto it".
 */
const EDGE_SHARE = 0.26;

const contains = (rect: DropRect, point: Point) =>
  point.x >= rect.left &&
  point.x <= rect.left + rect.width &&
  point.y >= rect.top &&
  point.y <= rect.top + rect.height;

/** How far a point is from a rectangle; rows count more than columns. */
const distance = (rect: DropRect, point: Point) => {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.left - rect.width);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.top - rect.height);
  return dx + dy * 4;
};

const sideOf = (rect: DropRect, point: Point): 'before' | 'after' =>
  point.x < rect.left + rect.width / 2 ? 'before' : 'after';

/**
 * Where a dragged tile would land for a pointer position.
 *
 * - On the middle of an app or a bookmark in the row: onto it (the two become
 *   a folder).
 * - On the middle of a folder tile: into the folder.
 * - On a tile's edge, or between tiles: next to the nearest tile.
 * - In the free space of the row or of an open folder: at its end.
 *
 * A folder and a private app only move along the row: neither can go into a
 * folder. Inside an open folder there is nothing to drop onto, so there a tile
 * only has two halves.
 */
export function getLauncherDrop(
  point: Point,
  activeKey: string,
  tiles: DropTile[],
  areas: DropArea[]
): LauncherDrop | null {
  const dragged = tiles.find((tile) => tile.key === activeKey);
  const rowOnly = isFolderItemKey(activeKey) || !!dragged?.staysInRow;
  const others = tiles.filter((tile) => tile.key !== activeKey);

  const hovered = others.find((tile) => contains(tile.rect, point));
  if (hovered) {
    if (rowOnly && hovered.folderId !== null) return null;
    const canDropOnto =
      !rowOnly && hovered.folderId === null && !hovered.staysInRow;
    if (canDropOnto) {
      const edge = hovered.rect.width * EDGE_SHARE;
      const offset = point.x - hovered.rect.left;
      if (offset >= edge && offset <= hovered.rect.width - edge) {
        return { kind: 'merge', key: hovered.key };
      }
    }
    return {
      kind: 'insert',
      key: hovered.key,
      side: sideOf(hovered.rect, point),
    };
  }

  // Between tiles or in free space: the innermost area under the pointer.
  const area =
    areas.find(
      (candidate) =>
        candidate.folderId !== null && contains(candidate.rect, point)
    ) ?? areas.find((candidate) => contains(candidate.rect, point));
  if (!area) return null;
  if (rowOnly && area.folderId !== null) return null;

  const inArea = others.filter((tile) => tile.folderId === area.folderId);
  if (inArea.length === 0) return { kind: 'append', folderId: area.folderId };

  let nearest = inArea[0];
  for (const tile of inArea) {
    if (distance(tile.rect, point) < distance(nearest.rect, point)) {
      nearest = tile;
    }
  }
  return {
    kind: 'insert',
    key: nearest.key,
    side: sideOf(nearest.rect, point),
  };
}

export const sameLauncherDrop = (
  a: LauncherDrop | null,
  b: LauncherDrop | null
): boolean => {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'append' && b.kind === 'append') {
    return a.folderId === b.folderId;
  }
  if (a.kind === 'merge' && b.kind === 'merge') return a.key === b.key;
  if (a.kind === 'insert' && b.kind === 'insert') {
    return a.key === b.key && a.side === b.side;
  }
  return false;
};
