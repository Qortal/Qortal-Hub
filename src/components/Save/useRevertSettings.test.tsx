import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import { oldPinnedAppsAtom, sortablePinnedAppsAtom } from '../../atoms/global';
import {
  pinnedAppsStorageKey,
  setPinnedAppsAccount,
} from '../../utils/pinnedAppsStorage';
import {
  APP_BOOKMARKS_STORAGE_KEY,
  loadBookmarksForAddress,
} from '../Apps/AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../Apps/AppBookmarks/bookmarkTypes';
import {
  loadLauncherView,
  saveLauncherView,
} from '../Apps/AppsLauncher/launcherItems';
import {
  loadLauncherSyncMark,
  type SavedLauncher,
  toSavedBookmarks,
} from '../Apps/AppsLauncher/launcherQdn';
import { savedLauncherAtom } from '../Apps/AppsLauncher/launcherQdnSync';
import { useRevertSettings } from './useRevertSettings';

const ADDRESS = 'Qaddress';
const SAVED_AT = 500;

const pin = (name: string) => ({ name, service: 'APP' });

const folder = (id: string, name: string): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 10,
  updatedAt: 20,
});

const bookmark = (
  id: string,
  appName: string,
  folderId: string | null = null
): AppBookmark => ({
  id,
  name: appName,
  service: 'APP',
  appName,
  path: '',
  link: `qortal://APP/${appName}`,
  folderId,
  createdAt: 30,
  updatedAt: 40,
});

const data = (
  folders: AppBookmarkFolder[],
  bookmarks: AppBookmark[]
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt: 50 });

/** What the account's settings on QDN hold for the launcher. */
const savedLauncher = (): SavedLauncher => ({
  bookmarks: toSavedBookmarks(
    data([folder('f1', 'Media')], [bookmark('b1', 'Q-Tube', 'f1')])
  ),
  order: ['folder:f1'],
});

/** The bookmarks of this device, as the store keeps them. */
const kept = new Map<string, unknown>();

const render = (status: 'saved' | 'none') => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, [pin('Q-Tube'), pin('Q-Blog')]);
  store.set(oldPinnedAppsAtom, [pin('Q-Tube')]);
  store.set(savedLauncherAtom, {
    address: ADDRESS,
    status,
    launcher: status === 'saved' ? savedLauncher() : null,
    savedAt: SAVED_AT,
  });
  const { result } = renderHook(() => useRevertSettings(ADDRESS), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  return { store, revert: result.current };
};

beforeEach(async () => {
  localStorage.clear();
  kept.clear();
  setPinnedAppsAccount(ADDRESS);
  (window as unknown as { appStorage: unknown }).appStorage = {
    get: async (key: string) => kept.get(key),
    set: async (key: string, value: unknown) => {
      kept.set(key, value);
    },
  };
  kept.set(APP_BOOKMARKS_STORAGE_KEY, {
    [ADDRESS]: data([folder('f2', 'Tools')], [bookmark('b2', 'Q-Mail', 'f2')]),
  });
  saveLauncherView(ADDRESS, { order: ['folder:f2'], openFolders: ['f2'] });
});

afterEach(() => {
  setPinnedAppsAccount(null);
  delete (window as unknown as { appStorage?: unknown }).appStorage;
});

describe('putting the settings back to what is saved', () => {
  it('puts back the pins, the bookmarks and the arrangement', async () => {
    const { store, revert } = render('saved');

    await act(async () => {
      await revert();
    });

    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    // Cleared here, so the saved list is read again at the next sign-in.
    expect(
      JSON.parse(localStorage.getItem(pinnedAppsStorageKey(ADDRESS)) || 'null')
        ?.sortablePinnedApps
    ).toBeNull();

    const bookmarks = await loadBookmarksForAddress(ADDRESS);
    expect(bookmarks.folders.map((entry) => entry.name)).toEqual(['Media']);
    expect(bookmarks.bookmarks.map((entry) => entry.id)).toEqual(['b1']);
    // Where the saved tiles stand; the folders left open here stay open.
    expect(loadLauncherView(ADDRESS)).toEqual({
      order: ['folder:f1'],
      openFolders: ['f2'],
    });
    // In step with what is saved, and with nothing of its own left.
    expect(loadLauncherSyncMark(ADDRESS)).toEqual({
      savedAt: SAVED_AT,
      localAt: bookmarks.updatedAt,
      order: ['folder:f1'],
    });
  });

  it('leaves the bookmarks alone when the settings hold no launcher', async () => {
    const { store, revert } = render('none');

    await act(async () => {
      await revert();
    });

    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    const bookmarks = await loadBookmarksForAddress(ADDRESS);
    expect(bookmarks.folders.map((entry) => entry.name)).toEqual(['Tools']);
    expect(loadLauncherView(ADDRESS).order).toEqual(['folder:f2']);
    expect(loadLauncherSyncMark(ADDRESS)).toBeNull();
  });
});
