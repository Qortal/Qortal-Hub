import type { FolderPicture } from '../AppsLauncher/LauncherTile';
import type { AppBookmark, AppBookmarkFolder } from './bookmarkTypes';

/**
 * What the bookmarks menu shows: the rows of a folder, what each row says
 * under its name, and the search over every bookmark an account has.
 */

/** Above how many items the menu offers to search. */
export const BOOKMARK_SEARCH_FROM = 7;

/** The small pictures on a folder's row: the apps of what is inside. */
export const folderPictures = (
  folder: AppBookmarkFolder,
  bookmarks: AppBookmark[]
): FolderPicture[] =>
  bookmarks
    .filter((bookmark) => bookmark.folderId === folder.id)
    .map((bookmark) => ({ key: bookmark.id, appName: bookmark.appName }));

export const bookmarksInFolder = (
  bookmarks: AppBookmark[],
  folderId: string | null
) => bookmarks.filter((bookmark) => (bookmark.folderId || null) === folderId);

/**
 * The line under a bookmark's name: where it goes, rather than its whole
 * address. The app's name, and the page inside it when the bookmark is not
 * the app's start page. A bookmark named after its app says what it is
 * instead of saying the name twice.
 */
export function bookmarkSubtitle(
  bookmark: Pick<AppBookmark, 'appName' | 'name' | 'path' | 'service'>,
  labelOfService: (service: string) => string
): string {
  const path = (bookmark.path || '').trim();
  const appName = (bookmark.appName || '').trim();
  if (path) return appName ? `${appName} · ${path}` : path;
  const isNamedAfterApp =
    appName.toLocaleLowerCase() ===
    (bookmark.name || '').trim().toLocaleLowerCase();
  return isNamedAfterApp || !appName
    ? labelOfService(bookmark.service)
    : appName;
}

const fold = (text: string) => text.trim().toLocaleLowerCase();

/** A bookmark found by its name, its app's name or its page. */
export const bookmarkMatches = (bookmark: AppBookmark, query: string) => {
  const text = fold(query);
  if (!text) return true;
  return [bookmark.name, bookmark.appName, bookmark.path, bookmark.link].some(
    (value) => fold(String(value || '')).includes(text)
  );
};

export type BookmarkSearchResult = {
  bookmark: AppBookmark;
  /** The folder it is in, to show where it was found. */
  folder: AppBookmarkFolder | null;
};

/**
 * Every bookmark that matches, wherever it is kept. Those in the folder
 * being looked at come first, then the rest, each with its folder.
 */
export function searchBookmarks(
  bookmarks: AppBookmark[],
  folders: AppBookmarkFolder[],
  query: string,
  currentFolderId: string | null = null
): BookmarkSearchResult[] {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const results = bookmarks
    .filter((bookmark) => bookmarkMatches(bookmark, query))
    .map((bookmark) => ({
      bookmark,
      folder: bookmark.folderId
        ? (foldersById.get(bookmark.folderId) ?? null)
        : null,
    }));
  if (!currentFolderId) return results;
  return [
    ...results.filter((result) => result.folder?.id === currentFolderId),
    ...results.filter((result) => result.folder?.id !== currentFolderId),
  ];
}

/** A folder found by its name. */
export const searchFolders = (
  folders: AppBookmarkFolder[],
  query: string
): AppBookmarkFolder[] => {
  const text = fold(query);
  if (!text) return folders;
  return folders.filter((folder) => fold(folder.name).includes(text));
};
