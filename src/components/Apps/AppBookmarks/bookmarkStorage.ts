import { QORTAL_PROTOCOL } from '../../../constants/constants';
import { extractComponents } from '../../Chat/MessageDisplay';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksByAddress,
  AppBookmarksForAddress,
  BookmarkableAppTab,
} from './bookmarkTypes';

export const APP_BOOKMARKS_STORAGE_KEY = 'qortal_app_bookmarks_by_address';

const INTERNAL_TAB_SERVICE = 'INTERNAL';

const emptyBookmarks = (): AppBookmarksForAddress => ({
  folders: [],
  bookmarks: [],
  updatedAt: Date.now(),
});

function asBookmarksByAddress(value: unknown): AppBookmarksByAddress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as AppBookmarksByAddress;
}

function appStorage() {
  if (typeof window === 'undefined') return undefined;
  return window.appStorage;
}

export function normalizeBookmarkPath(path?: string): string {
  const raw = (path || '').trim();
  if (!raw) return '';

  const queryIndex = raw.indexOf('?');
  const hashIndex = raw.indexOf('#');
  const endIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const stripped = endIndex === undefined ? raw : raw.slice(0, endIndex);

  return stripped.replace(/^\/+/, '').replace(/\/+$/, '');
}

function encodeAppName(name: string): string {
  return name.trim().replace(/ /g, '%20');
}

export function buildBookmarkLink(bookmark: {
  service: string;
  appName: string;
  identifier?: string;
  path?: string;
}): string {
  const path = normalizeBookmarkPath(bookmark.path);
  const identifier = (bookmark.identifier || '').trim();
  const pathPart = path ? `/${path}` : '';
  const identifierPart = identifier
    ? `?identifier=${encodeURIComponent(identifier)}`
    : '';

  return `${QORTAL_PROTOCOL}${bookmark.service}/${encodeAppName(bookmark.appName)}${pathPart}${identifierPart}`;
}

export function parseBookmarkLink(link: string) {
  const parsed = extractComponents(link.trim());
  if (!parsed?.service || !parsed?.name) return null;

  return {
    service: parsed.service,
    appName: parsed.name,
    identifier: parsed.identifier,
    path: normalizeBookmarkPath(parsed.path),
  };
}

export function getBookmarkKey(bookmark: {
  service?: string;
  appName?: string;
  name?: string;
  identifier?: string;
  path?: string;
}): string {
  return [
    (bookmark.service || '').toUpperCase(),
    (bookmark.appName || bookmark.name || '').toLowerCase(),
    bookmark.identifier || '',
    normalizeBookmarkPath(bookmark.path),
  ].join(':');
}

export function getBookmarkCandidateFromTab(
  tab: BookmarkableAppTab | null | undefined
) {
  if (!tab?.service || !tab?.name) return null;
  if (tab.internal || tab.service === INTERNAL_TAB_SERVICE) return null;

  const path = normalizeBookmarkPath(tab.path);
  const candidate = {
    service: tab.service.toUpperCase(),
    appName: tab.name,
    identifier: tab.identifier,
    path,
  };

  return {
    ...candidate,
    name: tab.name,
    link: buildBookmarkLink(candidate),
  };
}

export function findBookmarkForCandidate(
  bookmarks: AppBookmark[],
  candidate: ReturnType<typeof getBookmarkCandidateFromTab>
) {
  if (!candidate) return null;
  const key = getBookmarkKey(candidate);
  return bookmarks.find((bookmark) => getBookmarkKey(bookmark) === key) || null;
}

export async function loadBookmarksForAddress(
  address: string
): Promise<AppBookmarksForAddress> {
  const storage = appStorage();
  if (!storage || !address) return emptyBookmarks();

  const raw = await storage.get(APP_BOOKMARKS_STORAGE_KEY);
  const byAddress = asBookmarksByAddress(raw);
  const data = byAddress[address];

  return {
    folders: Array.isArray(data?.folders) ? data.folders : [],
    bookmarks: Array.isArray(data?.bookmarks) ? data.bookmarks : [],
    updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : Date.now(),
  };
}

export async function saveBookmarksForAddress(
  address: string,
  data: AppBookmarksForAddress
): Promise<AppBookmarksForAddress> {
  const storage = appStorage();
  const nextData = {
    folders: data.folders,
    bookmarks: data.bookmarks,
    updatedAt: Date.now(),
  };

  if (!storage || !address) return nextData;

  const raw = await storage.get(APP_BOOKMARKS_STORAGE_KEY);
  const byAddress = asBookmarksByAddress(raw);
  await storage.set(APP_BOOKMARKS_STORAGE_KEY, {
    ...byAddress,
    [address]: nextData,
  });

  return nextData;
}

export function upsertBookmark(
  data: AppBookmarksForAddress,
  bookmark: AppBookmark
): AppBookmarksForAddress {
  const key = getBookmarkKey(bookmark);
  const index = data.bookmarks.findIndex(
    (existing) => getBookmarkKey(existing) === key || existing.id === bookmark.id
  );
  const bookmarks = [...data.bookmarks];

  if (index >= 0) {
    bookmarks[index] = bookmark;
  } else {
    bookmarks.push(bookmark);
  }

  return {
    ...data,
    bookmarks,
    updatedAt: Date.now(),
  };
}

export function removeBookmark(
  data: AppBookmarksForAddress,
  bookmarkId: string
): AppBookmarksForAddress {
  return {
    ...data,
    bookmarks: data.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
    updatedAt: Date.now(),
  };
}

export function upsertFolder(
  data: AppBookmarksForAddress,
  folder: AppBookmarkFolder
): AppBookmarksForAddress {
  const index = data.folders.findIndex((existing) => existing.id === folder.id);
  const folders = [...data.folders];

  if (index >= 0) {
    folders[index] = folder;
  } else {
    folders.push(folder);
  }

  return {
    ...data,
    folders,
    updatedAt: Date.now(),
  };
}

export function removeFolder(
  data: AppBookmarksForAddress,
  folderId: string
): AppBookmarksForAddress {
  return {
    ...data,
    folders: data.folders.filter((folder) => folder.id !== folderId),
    bookmarks: data.bookmarks.map((bookmark) =>
      bookmark.folderId === folderId ? { ...bookmark, folderId: null } : bookmark
    ),
    updatedAt: Date.now(),
  };
}

