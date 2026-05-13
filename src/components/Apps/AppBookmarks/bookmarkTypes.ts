export type AppBookmarkFolder = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type AppBookmark = {
  id: string;
  name: string;
  service: string;
  appName: string;
  identifier?: string;
  path: string;
  link: string;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AppBookmarksForAddress = {
  folders: AppBookmarkFolder[];
  bookmarks: AppBookmark[];
  updatedAt: number;
};

export type AppBookmarksByAddress = Record<string, AppBookmarksForAddress>;

export type BookmarkableAppTab = {
  tabId?: string;
  name?: string;
  service?: string;
  identifier?: string;
  path?: string;
  internal?: string;
};

