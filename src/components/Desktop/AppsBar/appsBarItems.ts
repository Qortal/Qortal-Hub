import {
  getPinnedAppKey,
  type PinnedApp,
} from '../../../utils/pinnedAppsSettings';
import { getBookmarkKey } from '../../Apps/AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  buildLauncherItems,
  type LauncherView,
} from '../../Apps/AppsLauncher/launcherItems';
import {
  buildLauncherPins,
  launcherPinLabel,
} from '../../Apps/AppsLauncher/launcherPins';

/**
 * What the apps bar shows: the launcher's own row, in the title bar.
 *
 * The bar keeps no list of its own. It asks the launcher what its tiles are
 * and shows them in the same order, so the pinned apps, the bookmark folders
 * and the bookmarks stand where the user last arranged them, and a change
 * made on the launcher or in the bookmarks menu shows here too. The bar adds
 * only the names the user gave its items.
 */

export type AppsBarPinItem = {
  type: 'pin';
  id: string;
  /** The name the user gave, or null when the item has its own. */
  customName: string | null;
  /** The name the item has of itself. */
  ownName: string;
  /** What the bar shows: the given name, which may be empty on purpose. */
  label: string;
  pin: PinnedApp;
};

export type AppsBarBookmarkItem = {
  type: 'bookmark';
  id: string;
  customName: string | null;
  ownName: string;
  label: string;
  bookmark: AppBookmark;
  /** The folder it is in, for the tooltip. */
  folderName: string | null;
};

export type AppsBarFolderItem = {
  type: 'folder';
  id: string;
  customName: string | null;
  ownName: string;
  label: string;
  folder: AppBookmarkFolder;
  /** What is inside, as the folder keeps it. */
  items: AppsBarBookmarkItem[];
};

/** One item of the bar: a pinned app, a bookmark folder or a bookmark. */
export type AppsBarItem =
  | AppsBarPinItem
  | AppsBarBookmarkItem
  | AppsBarFolderItem;

export const pinItemId = (app: PinnedApp) => `pin:${getPinnedAppKey(app)}`;

export const folderItemId = (folder: { id: string }) => `folder:${folder.id}`;

export const bookmarkItemId = (bookmark: {
  service?: string;
  appName?: string;
  identifier?: string;
  path?: string;
}) => `bookmark:${getBookmarkKey(bookmark)}`;

/** The name shown, and whether it was given: an empty given name shows none. */
const nameOf = (
  names: Record<string, string> | null | undefined,
  id: string,
  ownName: string
) => {
  const customName = names && id in names ? names[id] : null;
  return { customName, ownName, label: customName ?? ownName };
};

/**
 * The items of the bar: the launcher's tiles, in the order they were last
 * arranged there, each with the name it goes by here.
 *
 * The launcher works the order out itself (`buildLauncherItems`), so the two
 * agree: a folder moved to the front of the row comes first here too, a
 * bookmark stays behind the app it was put behind, an app put into a folder
 * shows in that folder and not again beside it, and a bookmark of a pinned
 * app's start page is the pinned app.
 */
export function buildAppsBarItems(
  pins: PinnedApp[] | null | undefined,
  data: AppBookmarksForAddress | null | undefined,
  view: LauncherView | null | undefined,
  names: Record<string, string> | null | undefined,
  privateAppLabel: string
): AppsBarItem[] {
  /** One bookmark of the bar, in the row or inside a folder. */
  const bookmarkItem = (
    bookmark: AppBookmark,
    folderName: string | null
  ): AppsBarBookmarkItem => {
    const id = bookmarkItemId(bookmark);
    return {
      type: 'bookmark',
      id,
      ...nameOf(names, id, bookmark.name || bookmark.appName || ''),
      bookmark,
      folderName,
    };
  };

  /**
   * One item per thing. Items go by what they open, so the name the user
   * gave a page sticks to it; the same page bookmarked twice shows once.
   */
  const seen = new Set<string>();
  const isNew = (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  const items: AppsBarItem[] = [];
  for (const tile of buildLauncherItems(
    buildLauncherPins(pins, null),
    data,
    view
  )) {
    if (tile.type === 'bookmark') {
      const item = bookmarkItem(tile.bookmark, null);
      if (isNew(item.id)) items.push(item);
      continue;
    }

    if (tile.type === 'folder') {
      const id = folderItemId(tile.folder);
      if (!isNew(id)) continue;
      const inside: AppsBarBookmarkItem[] = [];
      for (const child of tile.children) {
        const item = bookmarkItem(child.bookmark, tile.folder.name);
        if (isNew(item.id)) inside.push(item);
      }
      items.push({
        type: 'folder',
        id,
        ...nameOf(names, id, tile.folder.name || ''),
        folder: tile.folder,
        items: inside,
      });
      continue;
    }

    const id = pinItemId(tile.pin.app);
    if (!isNew(id)) continue;
    items.push({
      type: 'pin',
      id,
      ...nameOf(names, id, launcherPinLabel(tile.pin.app, privateAppLabel)),
      pin: tile.pin.app,
    });
  }

  return items;
}

/** What opens a bookmark in a tab. */
export const bookmarkTabData = (bookmark: AppBookmark) => ({
  service: bookmark.service,
  name: bookmark.appName,
  identifier: bookmark.identifier,
  path: bookmark.path,
});
