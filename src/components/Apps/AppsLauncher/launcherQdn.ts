import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import {
  buildBookmarkLink,
  getBookmarkKey,
  normalizeBookmarkPath,
} from '../AppBookmarks/bookmarkStorage';
import { folderItemKey } from './launcherItems';

/**
 * The launcher's part of the settings an account saves on QDN.
 *
 * The settings (`DOCUMENT_PRIVATE` `ext_saved_settings`, encrypted to the
 * account) hold the pin list as `sortablePinnedApps`. Next to it go:
 *
 * - `appBookmarks`: the bookmarks and bookmark folders, as the bookmarks menu
 *   keeps them, without the link, which is made again from the rest;
 * - `launcherOrder`: the keys of the launcher's tiles, in the order they were
 *   arranged.
 *
 * Both are optional. A Hub that does not know them reads the pin list only,
 * and a Hub that finds no `appBookmarks` keeps the bookmarks it has.
 */
export const SAVED_BOOKMARKS_VERSION = 1;

export type SavedBookmark = Omit<AppBookmark, 'link'>;

export type SavedBookmarks = {
  version: number;
  folders: AppBookmarkFolder[];
  bookmarks: SavedBookmark[];
};

/** The bookmarks, the folders and the order of the tiles, as saved. */
export type SavedLauncher = {
  bookmarks: SavedBookmarks;
  order: string[];
};

/** The fields the launcher adds to the settings it saves. */
export type SavedLauncherSettings = {
  appBookmarks: SavedBookmarks;
  launcherOrder: string[];
};

const isText = (value: unknown): value is string => typeof value === 'string';

const timeOf = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const textsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(isText) : [];

const savedFolderOf = (folder: AppBookmarkFolder): AppBookmarkFolder => ({
  id: folder.id,
  name: folder.name,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

const savedBookmarkOf = (bookmark: SavedBookmark): SavedBookmark => ({
  id: bookmark.id,
  name: bookmark.name,
  service: bookmark.service,
  appName: bookmark.appName,
  ...(bookmark.identifier ? { identifier: bookmark.identifier } : {}),
  path: normalizeBookmarkPath(bookmark.path),
  folderId: bookmark.folderId ?? null,
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt,
});

/** The bookmarks as they go into the settings. */
export const toSavedBookmarks = (
  data: AppBookmarksForAddress
): SavedBookmarks => ({
  version: SAVED_BOOKMARKS_VERSION,
  folders: data.folders.map(savedFolderOf),
  bookmarks: data.bookmarks.map(savedBookmarkOf),
});

/** Saved bookmarks as the bookmarks menu keeps them. */
export const fromSavedBookmarks = (
  saved: SavedBookmarks,
  updatedAt: number
): AppBookmarksForAddress => ({
  folders: saved.folders.map(savedFolderOf),
  bookmarks: saved.bookmarks.map((bookmark) => ({
    ...savedBookmarkOf(bookmark),
    link: buildBookmarkLink(bookmark),
  })),
  updatedAt,
});

/** The fields for the settings, from what this device has. */
export const toSavedLauncherSettings = (
  launcher: SavedLauncher
): SavedLauncherSettings => ({
  appBookmarks: launcher.bookmarks,
  launcherOrder: launcher.order,
});

/**
 * The launcher's part of saved settings, or null when they have none. What
 * does not have the right shape is left out, so a damaged entry costs only
 * itself.
 */
export function readSavedLauncher(
  settings: unknown,
  now = Date.now()
): SavedLauncher | null {
  const fields = settings as Partial<
    Record<keyof SavedLauncherSettings, unknown>
  > | null;
  const saved = fields?.appBookmarks as Partial<SavedBookmarks> | undefined;
  if (
    !saved ||
    typeof saved !== 'object' ||
    !Array.isArray(saved.folders) ||
    !Array.isArray(saved.bookmarks)
  ) {
    return null;
  }

  const folders: AppBookmarkFolder[] = [];
  const folderIds = new Set<string>();
  for (const value of saved.folders) {
    const folder = value as Partial<AppBookmarkFolder> | null;
    if (!folder || !isText(folder.id) || !folder.id) continue;
    if (!isText(folder.name) || folderIds.has(folder.id)) continue;
    folderIds.add(folder.id);
    folders.push({
      id: folder.id,
      name: folder.name,
      createdAt: timeOf(folder.createdAt, now),
      updatedAt: timeOf(folder.updatedAt, now),
    });
  }

  const bookmarks: SavedBookmark[] = [];
  const bookmarkIds = new Set<string>();
  // One bookmark per place, as the bookmarks menu keeps it.
  const places = new Set<string>();
  for (const value of saved.bookmarks) {
    const bookmark = value as Partial<AppBookmark> | null;
    if (!bookmark || !isText(bookmark.id) || !bookmark.id) continue;
    if (!isText(bookmark.name) || !isText(bookmark.service)) continue;
    if (!isText(bookmark.appName) || !bookmark.service) continue;
    if (!bookmark.appName.trim() || bookmarkIds.has(bookmark.id)) continue;
    const entry = savedBookmarkOf({
      id: bookmark.id,
      name: bookmark.name,
      service: bookmark.service,
      appName: bookmark.appName,
      identifier: isText(bookmark.identifier) ? bookmark.identifier : '',
      path: isText(bookmark.path) ? bookmark.path : '',
      folderId:
        isText(bookmark.folderId) && folderIds.has(bookmark.folderId)
          ? bookmark.folderId
          : null,
      createdAt: timeOf(bookmark.createdAt, now),
      updatedAt: timeOf(bookmark.updatedAt, now),
    });
    const place = getBookmarkKey(entry);
    if (places.has(place)) continue;
    places.add(place);
    bookmarkIds.add(entry.id);
    bookmarks.push(entry);
  }

  return {
    bookmarks: {
      version: timeOf(saved.version, SAVED_BOOKMARKS_VERSION),
      folders,
      bookmarks,
    },
    order: textsOf(fields?.launcherOrder),
  };
}

/** What this device has, in the shape it is saved in. */
export const currentSavedLauncher = (
  data: AppBookmarksForAddress | null,
  order: string[]
): SavedLauncher | null => {
  if (!data) return null;
  // Nothing to save: the same as nothing saved.
  if (!data.folders.length && !data.bookmarks.length && !order.length) {
    return null;
  }
  return { bookmarks: toSavedBookmarks(data), order };
};

/** What the launcher shows, without the times things were made or changed. */
const contentOf = (launcher: SavedLauncher) =>
  JSON.stringify([
    launcher.bookmarks.folders.map((folder) => [folder.id, folder.name]),
    launcher.bookmarks.bookmarks.map((bookmark) => [
      bookmark.id,
      bookmark.name,
      bookmark.service,
      bookmark.appName,
      bookmark.identifier || '',
      normalizeBookmarkPath(bookmark.path),
      bookmark.folderId ?? null,
    ]),
    launcher.order,
  ]);

/** Whether two launchers show the same bookmarks, folders and order. */
export const sameSavedLauncher = (
  a: SavedLauncher | null,
  b: SavedLauncher | null
) => {
  const isEmpty = (launcher: SavedLauncher | null) =>
    !launcher ||
    (!launcher.bookmarks.folders.length &&
      !launcher.bookmarks.bookmarks.length &&
      !launcher.order.length);
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  return contentOf(a!) === contentOf(b!);
};

const folderNameKey = (name: string) => name.trim().toLocaleLowerCase();

/**
 * This device's bookmarks added to the saved ones, so that none is lost.
 *
 * - What was saved comes first and wins where both have the same thing.
 * - A folder here with the name of a saved folder becomes that folder.
 * - A bookmark of a place that has a saved bookmark is left out: the
 *   bookmarks menu keeps one bookmark per place.
 * - The arrangement is this device's own, then the tiles only the saved one
 *   has: what was arranged here was never saved, and is what the user last
 *   did on this device.
 */
export function mergeSavedLauncher(
  local: { data: AppBookmarksForAddress; order: string[] },
  saved: SavedLauncher,
  now: number
): { data: AppBookmarksForAddress; order: string[] } {
  const savedData = fromSavedBookmarks(saved.bookmarks, now);

  const folders = [...savedData.folders];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const folderByName = new Map(
    folders.map((folder) => [folderNameKey(folder.name), folder.id])
  );
  /** A folder of this device that became a saved one: its id there. */
  const renamedFolders = new Map<string, string>();
  for (const folder of local.data.folders) {
    if (folderIds.has(folder.id)) continue;
    const sameName = folderByName.get(folderNameKey(folder.name));
    if (sameName) {
      renamedFolders.set(folder.id, sameName);
      continue;
    }
    folders.push(folder);
    folderIds.add(folder.id);
    folderByName.set(folderNameKey(folder.name), folder.id);
  }

  const bookmarks = [...savedData.bookmarks];
  const bookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  const places = new Set(bookmarks.map((bookmark) => getBookmarkKey(bookmark)));
  for (const bookmark of local.data.bookmarks) {
    if (bookmarkIds.has(bookmark.id)) continue;
    const place = getBookmarkKey(bookmark);
    if (places.has(place)) continue;
    const folderId = bookmark.folderId
      ? (renamedFolders.get(bookmark.folderId) ?? bookmark.folderId)
      : null;
    bookmarks.push({
      ...bookmark,
      folderId: folderId && folderIds.has(folderId) ? folderId : null,
    });
    bookmarkIds.add(bookmark.id);
    places.add(place);
  }

  const renamedKeys = new Map(
    [...renamedFolders].map(([from, to]) => [
      folderItemKey(from),
      folderItemKey(to),
    ])
  );
  const order: string[] = [];
  const inOrder = new Set<string>();
  const place = (key: string) => {
    if (inOrder.has(key)) return;
    order.push(key);
    inOrder.add(key);
  };
  // This device's arrangement first, so a tile moved here stays where it was
  // put; a tile only the saved arrangement has goes after it.
  for (const key of local.order) place(renamedKeys.get(key) ?? key);
  for (const key of saved.order) place(key);

  return { data: { folders, bookmarks, updatedAt: now }, order };
}

/** When this device last took the saved launcher in, or saved its own. */
export type LauncherSyncMark = {
  /** The time of the QDN settings it took in or saved. */
  savedAt: number;
  /** The time of its bookmarks right after that. */
  localAt: number;
  /**
   * Where its tiles stood right after that. The arrangement keeps no time of
   * its own, so this is what says whether it was changed since.
   */
  order?: string[];
  /**
   * Whether this device holds bookmarks, folders or an arrangement that were
   * never saved, as a merge leaves it. What was never saved must not be put
   * aside for the saved launcher at the next update.
   */
  unsaved?: boolean;
};

/** Whether the tiles stand where they stood when the mark was written. */
const sameOrderAsMark = (mark: LauncherSyncMark, order: string[]) =>
  mark.order
    ? mark.order.length === order.length &&
      mark.order.every((key, index) => key === order[index])
    : // A mark from before the arrangement was kept: only one here is a change.
      order.length === 0;

/**
 * What to do with the launcher found on QDN.
 *
 * - `keep`: nothing new on QDN for this device, or nothing there.
 * - `replace`: this device has nothing, or neither its bookmarks nor its
 *   arrangement changed since it last took the saved launcher in; the saved
 *   one takes its place, so what was removed on another device goes here too.
 * - `merge`: this device changed things that were never saved, holds what an
 *   earlier merge kept, or never took a saved launcher in; both are kept.
 */
export function chooseSavedLauncherUse({
  local,
  order = [],
  mark,
  saved,
  savedAt,
}: {
  local: AppBookmarksForAddress | null;
  /** Where this device's tiles stand now. */
  order?: string[];
  mark: LauncherSyncMark | null;
  saved: SavedLauncher | null;
  savedAt: number;
}): 'keep' | 'replace' | 'merge' {
  if (!saved) return 'keep';
  if (mark && savedAt <= mark.savedAt) return 'keep';
  const hasOwn =
    (!!local && (!!local.folders.length || !!local.bookmarks.length)) ||
    order.length > 0;
  if (!hasOwn) return 'replace';
  // What a merge kept here was never saved: it would be lost by a replace.
  if (mark?.unsaved) return 'merge';
  if (
    mark &&
    local &&
    local.updatedAt <= mark.localAt &&
    sameOrderAsMark(mark, order)
  ) {
    return 'replace';
  }
  return 'merge';
}

const SYNC_MARK_KEY = 'ext_launcher_qdn';

export const launcherSyncMarkKey = (address: string) =>
  `${SYNC_MARK_KEY}:${address}`;

export function loadLauncherSyncMark(
  address: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): LauncherSyncMark | null {
  try {
    const stored = JSON.parse(
      storage.getItem(launcherSyncMarkKey(address)) || 'null'
    );
    if (
      typeof stored?.savedAt !== 'number' ||
      typeof stored?.localAt !== 'number'
    ) {
      return null;
    }
    return {
      savedAt: stored.savedAt,
      localAt: stored.localAt,
      ...(Array.isArray(stored.order) ? { order: textsOf(stored.order) } : {}),
      ...(stored.unsaved ? { unsaved: true } : {}),
    };
  } catch {
    return null;
  }
}

export function saveLauncherSyncMark(
  address: string,
  mark: LauncherSyncMark,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(launcherSyncMarkKey(address), JSON.stringify(mark));
  } catch (error) {
    console.error('Error saving the launcher sync mark:', error);
  }
}
