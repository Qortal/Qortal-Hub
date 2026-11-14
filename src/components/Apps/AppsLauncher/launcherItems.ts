import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import type { LauncherPin } from './launcherPins';

/**
 * The tiles of the launcher: the pinned apps and the account's bookmarks, in
 * one row, with the bookmark folders as the folders.
 *
 * The launcher keeps no list of its own. The pinned apps stay in the pin list
 * and the folders and bookmarks stay in the bookmarks store, the one the
 * bookmarks menu uses. An app dragged into a folder gets a bookmark in that
 * folder and stays pinned, so the pin list saved on QDN keeps every app. It
 * then shows in the folder instead of the row. Only where the folders and
 * bookmarks stand among the pinned apps, and which folders are open, is
 * remembered apart, on this device: the view.
 */

/** What the launcher remembers about its own look, per account. */
export type LauncherView = {
  /** The keys of the tiles in the row, as they were last arranged. */
  order: string[];
  /** The folders kept open under the row. */
  openFolders: string[];
};

export const EMPTY_LAUNCHER_VIEW: LauncherView = { order: [], openFolders: [] };

/** How long a folder name can be typed on the launcher. */
export const FOLDER_NAME_MAX_LENGTH = 40;

export type LauncherAppItem = { type: 'app'; key: string; pin: LauncherPin };

export type LauncherBookmarkItem = {
  type: 'bookmark';
  key: string;
  bookmark: AppBookmark;
  /** The pinned app, when the bookmark is that app's start page. */
  pin: LauncherPin | null;
};

export type LauncherFolderItem = {
  type: 'folder';
  key: string;
  folder: AppBookmarkFolder;
  isOpen: boolean;
  children: LauncherBookmarkItem[];
};

/** A tile of the row: a pinned app, a bookmark, or a bookmark folder. */
export type LauncherItem =
  | LauncherAppItem
  | LauncherBookmarkItem
  | LauncherFolderItem;

const FOLDER_KEY_PREFIX = 'folder:';
const BOOKMARK_KEY_PREFIX = 'bookmark:';

export const folderItemKey = (folderId: string) =>
  `${FOLDER_KEY_PREFIX}${folderId}`;
export const bookmarkItemKey = (bookmarkId: string) =>
  `${BOOKMARK_KEY_PREFIX}${bookmarkId}`;
export const isFolderItemKey = (key: string) =>
  key.startsWith(FOLDER_KEY_PREFIX);

/** A bookmark of an app's start page: no path inside the app, no identifier. */
export const isAppStartBookmark = (bookmark: AppBookmark) =>
  !bookmark.identifier &&
  (bookmark.path || '').split(/[?#]/)[0].replace(/^\/+|\/+$/g, '') === '';

const appKeyOfBookmark = (bookmark: AppBookmark) =>
  `${bookmark.service}-${bookmark.appName}`.toLowerCase();

const validFolderId = (bookmark: AppBookmark, folderIds: Set<string>) =>
  bookmark.folderId && folderIds.has(bookmark.folderId)
    ? bookmark.folderId
    : null;

/**
 * The tiles in order.
 *
 * - A pinned app whose start page is bookmarked in a folder shows there, not
 *   in the row. Bookmarked outside a folder, only the pinned app shows.
 * - The pinned apps keep the order of the pin list. Folders and bookmarks
 *   stay after the pinned app they were last placed behind; new ones come
 *   last.
 */
export function buildLauncherItems(
  pins: LauncherPin[],
  data: AppBookmarksForAddress | null | undefined,
  view: LauncherView | null | undefined
): LauncherItem[] {
  const folders = data?.folders ?? [];
  const bookmarks = data?.bookmarks ?? [];
  const order = view?.order ?? [];
  const openFolders = new Set(view?.openFolders ?? []);
  const folderIds = new Set(folders.map((folder) => folder.id));

  const publicPins = new Map<string, LauncherPin>();
  for (const pin of pins) {
    if (!pin.app.isPrivate) publicPins.set(pin.key.toLowerCase(), pin);
  }

  const childrenOf = new Map<string, LauncherBookmarkItem[]>();
  const rowBookmarks: LauncherBookmarkItem[] = [];
  const pinsInFolders = new Set<string>();
  for (const bookmark of bookmarks) {
    const pin = isAppStartBookmark(bookmark)
      ? (publicPins.get(appKeyOfBookmark(bookmark)) ?? null)
      : null;
    const item: LauncherBookmarkItem = {
      type: 'bookmark',
      key: bookmarkItemKey(bookmark.id),
      bookmark,
      pin,
    };
    const folderId = validFolderId(bookmark, folderIds);
    if (folderId) {
      if (pin && pinsInFolders.has(pin.key)) continue;
      if (pin) pinsInFolders.add(pin.key);
      childrenOf.set(folderId, [...(childrenOf.get(folderId) ?? []), item]);
    } else if (!pin) {
      rowBookmarks.push(item);
    }
  }

  const appItems: LauncherAppItem[] = pins
    .filter((pin) => !pinsInFolders.has(pin.key))
    .map((pin) => ({ type: 'app', key: pin.key, pin }));
  const otherItems: LauncherItem[] = [
    ...folders.map(
      (folder): LauncherFolderItem => ({
        type: 'folder',
        key: folderItemKey(folder.id),
        folder,
        isOpen: openFolders.has(folder.id),
        children: childrenOf.get(folder.id) ?? [],
      })
    ),
    ...rowBookmarks,
  ];

  // Each folder or bookmark goes after the pinned app it was last behind.
  const appKeys = new Set(appItems.map((item) => item.key));
  const START = '';
  const placedAfter = new Map<string, LauncherItem[]>();
  const unplaced: LauncherItem[] = [];
  const position = new Map(order.map((key, index) => [key, index]));
  const placed = otherItems
    .filter((item) => position.has(item.key))
    .sort((a, b) => position.get(a.key)! - position.get(b.key)!);
  for (const item of otherItems) {
    if (!position.has(item.key)) unplaced.push(item);
  }
  for (const item of placed) {
    let anchor = START;
    for (let index = position.get(item.key)! - 1; index >= 0; index--) {
      if (appKeys.has(order[index])) {
        anchor = order[index];
        break;
      }
    }
    placedAfter.set(anchor, [...(placedAfter.get(anchor) ?? []), item]);
  }

  return [
    ...(placedAfter.get(START) ?? []),
    ...appItems.flatMap((item) => [item, ...(placedAfter.get(item.key) ?? [])]),
    ...unplaced,
  ];
}

/** Where a dragged tile is dropped. */
export type LauncherDrop =
  /** Next to a tile, in the row or inside an open folder. */
  | { kind: 'insert'; key: string; side: 'before' | 'after' }
  /** Onto a tile of the row: the two become a folder, or it joins the folder. */
  | { kind: 'merge'; key: string }
  /** Into the free space of the row, or of an open folder. */
  | { kind: 'append'; folderId: string | null };

/** What a change needs from outside: the stores as they are, and new things. */
export type LauncherChangeContext = {
  data: AppBookmarksForAddress | null | undefined;
  view: LauncherView | null | undefined;
  /** The folder to make when one tile is dropped onto another. */
  newFolder: { id: string; name: string };
  /** A bookmark of a pinned app's start page, for an app that enters a folder. */
  makeBookmark: (pin: LauncherPin) => AppBookmark;
  now: number;
};

/** What a change leaves behind, for the pin list and the bookmarks store. */
export type LauncherArrangement = {
  /** The key of every pinned app, a folder's apps where the folder stands. */
  pinOrder: string[];
  data: AppBookmarksForAddress;
  view: LauncherView;
};

type Tree = LauncherItem[];
type Leaf = LauncherAppItem | LauncherBookmarkItem;

const copyTree = (items: LauncherItem[]): Tree =>
  items.map((item) =>
    item.type === 'folder' ? { ...item, children: [...item.children] } : item
  );

const shownBookmarkIds = (tree: Tree) => {
  const ids = new Set<string>();
  for (const item of tree) {
    if (item.type === 'bookmark') ids.add(item.bookmark.id);
    if (item.type === 'folder') {
      for (const child of item.children) ids.add(child.bookmark.id);
    }
  }
  return ids;
};

const toArrangement = (
  tree: Tree,
  before: LauncherItem[],
  context: LauncherChangeContext,
  openFolderId?: string
): LauncherArrangement => {
  const pinOrder: string[] = [];
  const folders: AppBookmarkFolder[] = [];
  const bookmarks: AppBookmark[] = [];
  const placed = (bookmark: AppBookmark, folderId: string | null) =>
    (bookmark.folderId || null) === folderId
      ? bookmark
      : { ...bookmark, folderId, updatedAt: context.now };
  for (const item of tree) {
    if (item.type === 'app') {
      pinOrder.push(item.key);
    } else if (item.type === 'bookmark') {
      bookmarks.push(placed(item.bookmark, null));
    } else {
      folders.push(item.folder);
      for (const child of item.children) {
        bookmarks.push(placed(child.bookmark, item.folder.id));
        if (child.pin) pinOrder.push(child.pin.key);
      }
    }
  }

  // Bookmarks the tiles do not show stay as they are: outside a folder, the
  // start page of a pinned app is the pinned app.
  const shownBefore = shownBookmarkIds(before);
  const shownNow = new Set(bookmarks.map((bookmark) => bookmark.id));
  for (const bookmark of context.data?.bookmarks ?? []) {
    if (!shownBefore.has(bookmark.id) && !shownNow.has(bookmark.id)) {
      bookmarks.push(bookmark);
    }
  }

  const folderIds = new Set(folders.map((folder) => folder.id));
  const openFolders = (context.view?.openFolders ?? []).filter((id) =>
    folderIds.has(id)
  );
  if (openFolderId && !openFolders.includes(openFolderId)) {
    openFolders.push(openFolderId);
  }

  return {
    pinOrder,
    data: { folders, bookmarks, updatedAt: context.now },
    view: { order: tree.map((item) => item.key), openFolders },
  };
};

const signature = (arrangement: LauncherArrangement) =>
  JSON.stringify([
    arrangement.pinOrder,
    arrangement.data.folders.map((folder) => [folder.id, folder.name]),
    arrangement.data.bookmarks.map((bookmark) => [
      bookmark.id,
      bookmark.folderId || null,
    ]),
    arrangement.view,
  ]);

/** Takes an app or a bookmark out of the row or out of its folder. */
const detach = (tree: Tree, key: string): Leaf | null => {
  const index = tree.findIndex(
    (item) => item.type !== 'folder' && item.key === key
  );
  if (index !== -1) return tree.splice(index, 1)[0] as Leaf;
  for (const item of tree) {
    if (item.type !== 'folder') continue;
    const childIndex = item.children.findIndex((child) => child.key === key);
    if (childIndex !== -1) return item.children.splice(childIndex, 1)[0];
  }
  return null;
};

const rowIndexOf = (tree: Tree, key: string) =>
  tree.findIndex((item) => item.key === key);

const folderWith = (tree: Tree, key: string) =>
  tree.find(
    (item): item is LauncherFolderItem =>
      item.type === 'folder' && item.children.some((child) => child.key === key)
  );

const folderById = (tree: Tree, folderId: string) =>
  tree.find(
    (item): item is LauncherFolderItem =>
      item.type === 'folder' && item.folder.id === folderId
  );

/**
 * A tile as it goes into a folder. A pinned app goes in as a bookmark of its
 * start page; a private app cannot be bookmarked, so it stays in the row.
 */
const forFolder = (
  item: Leaf,
  context: LauncherChangeContext
): LauncherBookmarkItem | null => {
  if (item.type === 'bookmark') return item;
  if (item.pin.app.isPrivate) return null;
  const folderIds = new Set(
    (context.data?.folders ?? []).map((folder) => folder.id)
  );
  // The app's start page may be bookmarked already, outside a folder.
  const existing = (context.data?.bookmarks ?? []).find(
    (bookmark) =>
      isAppStartBookmark(bookmark) &&
      appKeyOfBookmark(bookmark) === item.pin.key.toLowerCase() &&
      !validFolderId(bookmark, folderIds)
  );
  const bookmark = existing ?? context.makeBookmark(item.pin);
  return {
    type: 'bookmark',
    key: bookmarkItemKey(bookmark.id),
    bookmark,
    pin: item.pin,
  };
};

/** A tile as it goes into the row: a pinned app is itself again there. */
const forRow = (item: Leaf): Leaf =>
  item.type === 'bookmark' && item.pin
    ? { type: 'app', key: item.pin.key, pin: item.pin }
    : item;

const makeFolderItem = (
  context: LauncherChangeContext,
  children: LauncherBookmarkItem[]
): LauncherFolderItem => ({
  type: 'folder',
  key: folderItemKey(context.newFolder.id),
  folder: {
    id: context.newFolder.id,
    name: context.newFolder.name,
    createdAt: context.now,
    updatedAt: context.now,
  },
  isOpen: true,
  children,
});

const finish = (
  tree: Tree,
  items: LauncherItem[],
  context: LauncherChangeContext,
  openFolderId?: string
): LauncherArrangement | null => {
  const before = toArrangement(copyTree(items), items, context);
  const after = toArrangement(tree, items, context, openFolderId);
  return signature(before) === signature(after) ? null : after;
};

/**
 * Moves the dragged tile to where it was dropped. Returns null when the drop
 * changes nothing or is not possible: a folder cannot go into a folder, and a
 * private app cannot go into one.
 */
export function applyLauncherDrop(
  items: LauncherItem[],
  activeKey: string,
  drop: LauncherDrop,
  context: LauncherChangeContext
): LauncherArrangement | null {
  if (drop.kind !== 'append' && drop.key === activeKey) return null;
  const tree = copyTree(items);

  if (isFolderItemKey(activeKey)) {
    // A folder only moves along the row.
    if (drop.kind === 'merge') return null;
    const from = rowIndexOf(tree, activeKey);
    if (from === -1) return null;
    const [folder] = tree.splice(from, 1);
    if (drop.kind === 'append') {
      if (drop.folderId !== null) return null;
      tree.push(folder);
    } else {
      const target = rowIndexOf(tree, drop.key);
      if (target === -1) return null;
      tree.splice(drop.side === 'after' ? target + 1 : target, 0, folder);
    }
    return finish(tree, items, context);
  }

  if (drop.kind === 'merge') {
    const targetIndex = rowIndexOf(tree, drop.key);
    const target = tree[targetIndex];
    if (!target) return null;
    if (target.type === 'folder') {
      if (target.children.some((child) => child.key === activeKey)) return null;
      const active = detach(tree, activeKey);
      const child = active && forFolder(active, context);
      if (!child) return null;
      target.children.push(child);
      return finish(tree, items, context);
    }
    // Onto an app or a bookmark of the row: the two become a folder there.
    const first = forFolder(target, context);
    const active = detach(tree, activeKey);
    const second = active && forFolder(active, context);
    if (!first || !second) return null;
    tree[rowIndexOf(tree, drop.key)] = makeFolderItem(context, [first, second]);
    return finish(tree, items, context, context.newFolder.id);
  }

  if (drop.kind === 'append') {
    const active = detach(tree, activeKey);
    if (!active) return null;
    if (drop.folderId === null) {
      tree.push(forRow(active));
    } else {
      const folder = folderById(tree, drop.folderId);
      const child = forFolder(active, context);
      if (!folder || !child) return null;
      folder.children.push(child);
    }
    return finish(tree, items, context);
  }

  const side = drop.side === 'after' ? 1 : 0;
  const targetFolder = folderWith(tree, drop.key);
  if (targetFolder) {
    // Next to a tile inside an open folder.
    const folderId = targetFolder.folder.id;
    const active = detach(tree, activeKey);
    const child = active && forFolder(active, context);
    const folder = folderById(tree, folderId);
    if (!child || !folder) return null;
    const index = folder.children.findIndex((item) => item.key === drop.key);
    folder.children.splice(index + side, 0, child);
    return finish(tree, items, context);
  }
  if (rowIndexOf(tree, drop.key) === -1) return null;
  const active = detach(tree, activeKey);
  if (!active) return null;
  tree.splice(rowIndexOf(tree, drop.key) + side, 0, forRow(active));
  return finish(tree, items, context);
}

/** Puts a tile into a folder from its menu. */
export function moveItemToFolder(
  items: LauncherItem[],
  key: string,
  folderId: string,
  context: LauncherChangeContext
): LauncherArrangement | null {
  return applyLauncherDrop(
    items,
    key,
    { kind: 'merge', key: folderItemKey(folderId) },
    context
  );
}

/** Starts a folder with one tile, where the tile stands. */
export function createFolderWithItem(
  items: LauncherItem[],
  key: string,
  context: LauncherChangeContext
): LauncherArrangement | null {
  const tree = copyTree(items);
  const holder = folderWith(tree, key);
  const rowIndex = rowIndexOf(tree, key);
  const active = detach(tree, key);
  const child = active && forFolder(active, context);
  if (!child) return null;
  // Out of a folder, the new one goes right after it.
  const index = holder ? rowIndexOf(tree, holder.key) + 1 : rowIndex;
  tree.splice(index, 0, makeFolderItem(context, [child]));
  return finish(tree, items, context, context.newFolder.id);
}

/** Takes a tile out of its folder, into the row right after it. */
export function removeItemFromFolder(
  items: LauncherItem[],
  key: string,
  context: LauncherChangeContext
): LauncherArrangement | null {
  const tree = copyTree(items);
  const holder = folderWith(tree, key);
  const active = detach(tree, key);
  if (!holder || !active) return null;
  tree.splice(rowIndexOf(tree, holder.key) + 1, 0, forRow(active));
  return finish(tree, items, context);
}

/** Removes a folder. What was in it stays, in the row where it stood. */
export function removeFolderItem(
  items: LauncherItem[],
  folderId: string,
  context: LauncherChangeContext
): LauncherArrangement | null {
  const tree = copyTree(items);
  const index = rowIndexOf(tree, folderItemKey(folderId));
  const folder = tree[index];
  if (!folder || folder.type !== 'folder') return null;
  tree.splice(index, 1, ...folder.children.map(forRow));
  return finish(tree, items, context);
}

/**
 * Removes a tile for good: an app is unpinned, a bookmark is deleted, and an
 * app shown in a folder loses both its pin and its place there.
 */
export function removeItem(
  items: LauncherItem[],
  key: string,
  context: LauncherChangeContext
): LauncherArrangement | null {
  const tree = copyTree(items);
  if (!detach(tree, key)) return null;
  return finish(tree, items, context);
}

/** True when two states of the store list the same things in the same places. */
export function sameBookmarkLayout(
  a: AppBookmarksForAddress | null | undefined,
  b: AppBookmarksForAddress | null | undefined
): boolean {
  const layout = (data: AppBookmarksForAddress | null | undefined) =>
    JSON.stringify([
      (data?.folders ?? []).map((folder) => [folder.id, folder.name]),
      (data?.bookmarks ?? []).map((bookmark) => [
        bookmark.id,
        bookmark.folderId || null,
      ]),
    ]);
  return layout(a) === layout(b);
}

/** Renames a folder. An empty name, or the same name, changes nothing. */
export function renameFolder(
  data: AppBookmarksForAddress,
  folderId: string,
  name: string,
  now: number
): AppBookmarksForAddress {
  const trimmed = name.trim();
  const folder = data.folders.find((entry) => entry.id === folderId);
  if (!trimmed || !folder || folder.name === trimmed) return data;
  return {
    ...data,
    folders: data.folders.map((entry) =>
      entry.id === folderId
        ? { ...entry, name: trimmed, updatedAt: now }
        : entry
    ),
    updatedAt: now,
  };
}

export function setFolderOpen(
  view: LauncherView | null | undefined,
  folderId: string,
  isOpen: boolean
): LauncherView {
  const others = (view?.openFolders ?? []).filter((id) => id !== folderId);
  return {
    order: view?.order ?? [],
    openFolders: isOpen ? [...others, folderId] : others,
  };
}

// --- The launcher's own state, on this device ---------------------------------

const STORAGE_KEY = 'ext_launcher_view';
const STORAGE_VERSION = 1;

export const launcherViewStorageKey = (address: string | null | undefined) =>
  `${STORAGE_KEY}:${address || 'default'}`;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/** Reads what was stored, keeping only what has the right shape. */
export function parseLauncherView(value: unknown): LauncherView {
  const stored = value as Partial<LauncherView> | null;
  return {
    order: stringsOf(stored?.order),
    openFolders: stringsOf(stored?.openFolders),
  };
}

export function loadLauncherView(
  address: string | null | undefined,
  storage: Pick<Storage, 'getItem'> = localStorage
): LauncherView {
  try {
    const stored = storage.getItem(launcherViewStorageKey(address));
    return stored ? parseLauncherView(JSON.parse(stored)) : EMPTY_LAUNCHER_VIEW;
  } catch {
    return EMPTY_LAUNCHER_VIEW;
  }
}

export function saveLauncherView(
  address: string | null | undefined,
  view: LauncherView,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(
      launcherViewStorageKey(address),
      JSON.stringify({ version: STORAGE_VERSION, ...view })
    );
  } catch (error) {
    console.error('Error saving the launcher layout:', error);
  }
}
