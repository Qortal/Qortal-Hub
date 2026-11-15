import { describe, expect, it, vi } from 'vitest';

vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import type { LauncherView } from './launcherItems';
import {
  type LauncherSyncMark,
  type SavedLauncher,
  toSavedBookmarks,
  toSavedLauncherSettings,
} from './launcherQdn';
import {
  applySavedLauncher,
  hasUnsavedPins,
  type LauncherSyncStores,
  revertToSavedLauncher,
  type SavedLauncherState,
} from './launcherQdnSync';

const ADDRESS = 'Qaddress';

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
  bookmarks: AppBookmark[],
  updatedAt = 50
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt });

const settingsOf = (launcher: SavedLauncher) => ({
  sortablePinnedApps: [{ name: 'Q-Tube', service: 'APP' }],
  ...toSavedLauncherSettings(launcher),
});

const savedOf = (
  folders: AppBookmarkFolder[],
  bookmarks: AppBookmark[],
  order: string[] = []
): SavedLauncher => ({
  bookmarks: toSavedBookmarks(data(folders, bookmarks)),
  order,
});

/** What the settings on QDN were last seen to hold. */
const savedState = (
  launcher: SavedLauncher | null,
  savedAt = 100,
  address: string | null = ADDRESS
): SavedLauncherState => ({
  address,
  status: launcher ? 'saved' : 'none',
  launcher,
  savedAt,
});

/** The stores, with what they were asked to keep. */
const makeStores = ({
  local = data([], []),
  mark = null,
  view = { order: [], openFolders: [] },
}: {
  local?: AppBookmarksForAddress;
  mark?: LauncherSyncMark | null;
  view?: LauncherView;
} = {}) => {
  const saved = {
    bookmarks: null as AppBookmarksForAddress | null,
    view: null as LauncherView | null,
    mark: null as LauncherSyncMark | null,
  };
  const stores: LauncherSyncStores = {
    loadBookmarks: vi.fn(async () => local),
    saveBookmarks: vi.fn(async (_address, next) => {
      saved.bookmarks = { ...next, updatedAt: 999 };
      return saved.bookmarks;
    }),
    loadView: vi.fn(() => view),
    setView: vi.fn((_address, next) => {
      saved.view = next;
    }),
    loadMark: vi.fn(() => mark),
    saveMark: vi.fn((_address, next) => {
      saved.mark = next;
    }),
    now: () => 777,
  };
  return { saved, stores };
};

describe('taking in the launcher saved on QDN', () => {
  it('puts it in place when this device has none', async () => {
    const { saved, stores } = makeStores();
    const launcher = savedOf(
      [folder('f1', 'Media')],
      [bookmark('b1', 'Q-Tube', 'f1')],
      ['folder:f1', 'APP-Q-Mail']
    );

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(launcher),
      100,
      stores
    );

    expect(result.use).toBe('replace');
    expect(saved.bookmarks?.folders.map((entry) => entry.name)).toEqual([
      'Media',
    ]);
    expect(saved.bookmarks?.bookmarks[0].link).toBe('qortal://APP/Q-Tube');
    expect(saved.view).toEqual({
      order: ['folder:f1', 'APP-Q-Mail'],
      openFolders: [],
    });
    // What was taken in, the bookmarks right after, and where they stood.
    expect(saved.mark).toEqual({
      savedAt: 100,
      localAt: 999,
      order: ['folder:f1', 'APP-Q-Mail'],
      unsaved: false,
    });
  });

  it('keeps the folders open that were open here', async () => {
    const { saved, stores } = makeStores({
      view: { order: ['APP-Q-Mail'], openFolders: ['f1'] },
    });

    await applySavedLauncher(
      ADDRESS,
      settingsOf(savedOf([folder('f1', 'Media')], [], ['folder:f1'])),
      100,
      stores
    );

    // The tile this device had arranged stays where it was put.
    expect(saved.view).toEqual({
      order: ['APP-Q-Mail', 'folder:f1'],
      openFolders: ['f1'],
    });
  });

  it('writes nothing when there is nothing newer on QDN', async () => {
    const { saved, stores } = makeStores({
      local: data([folder('f1', 'Media')], []),
      mark: { savedAt: 100, localAt: 50 },
    });

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(savedOf([folder('f1', 'Media')], [])),
      100,
      stores
    );

    expect(result.use).toBe('keep');
    expect(stores.saveBookmarks).not.toHaveBeenCalled();
    expect(stores.setView).not.toHaveBeenCalled();
    expect(saved.mark).toBeNull();
  });

  it('writes nothing when the settings hold no launcher', async () => {
    const { stores } = makeStores();

    const result = await applySavedLauncher(
      ADDRESS,
      { sortablePinnedApps: [{ name: 'Q-Tube', service: 'APP' }] },
      100,
      stores
    );

    expect(result.use).toBe('keep');
    expect(result.launcher).toBeNull();
    expect(stores.saveBookmarks).not.toHaveBeenCalled();
  });

  it('keeps both when this device changed things that were never saved', async () => {
    const { saved, stores } = makeStores({
      local: data(
        [folder('f2', 'Tools')],
        [bookmark('b2', 'Q-Mail', 'f2')],
        80
      ),
      mark: { savedAt: 90, localAt: 50 },
      view: { order: ['folder:f2'], openFolders: ['f2'] },
    });

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(
        savedOf(
          [folder('f1', 'Media')],
          [bookmark('b1', 'Q-Tube', 'f1')],
          ['folder:f1']
        )
      ),
      120,
      stores
    );

    expect(result.use).toBe('merge');
    expect(saved.bookmarks?.folders.map((entry) => entry.name)).toEqual([
      'Media',
      'Tools',
    ]);
    expect(saved.view?.order).toEqual(['folder:f2', 'folder:f1']);
    // The folder of this device has never been saved.
    expect(saved.mark).toEqual({
      savedAt: 120,
      localAt: 999,
      order: ['folder:f2', 'folder:f1'],
      unsaved: true,
    });
  });

  it('keeps what a merge kept, at the next update', async () => {
    // Nothing changed here since that merge, but it left a folder that was
    // never saved: the update must not put the saved launcher in its place.
    const { saved, stores } = makeStores({
      local: data([folder('f2', 'Tools')], [], 999),
      mark: {
        savedAt: 120,
        localAt: 999,
        order: ['folder:f1', 'folder:f2'],
        unsaved: true,
      },
      view: { order: ['folder:f1', 'folder:f2'], openFolders: [] },
    });

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(savedOf([folder('f1', 'Media')], [], ['folder:f1'])),
      130,
      stores
    );

    expect(result.use).toBe('merge');
    expect(saved.bookmarks?.folders.map((entry) => entry.name)).toEqual([
      'Media',
      'Tools',
    ]);
    expect(saved.mark?.unsaved).toBe(true);
  });

  it('merges when only the tiles were moved here', async () => {
    // The bookmarks are as they were taken in; the arrangement is not.
    const { saved, stores } = makeStores({
      local: data([folder('f1', 'Media')], [], 50),
      mark: { savedAt: 90, localAt: 50, order: ['folder:f1', 'APP-Q-Mail'] },
      view: { order: ['APP-Q-Mail', 'folder:f1'], openFolders: [] },
    });

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(savedOf([folder('f1', 'Media')], [], ['folder:f1'])),
      120,
      stores
    );

    expect(result.use).toBe('merge');
    expect(saved.view?.order).toEqual(['APP-Q-Mail', 'folder:f1']);
  });

  it('keeps the arrangement made here when the saved one differs', async () => {
    // Saved as Q-Tube then Q-Mail and taken in; moved the other way round
    // here; then settings arrive that still have the saved arrangement.
    const both = [bookmark('b1', 'Q-Tube'), bookmark('b2', 'Q-Mail')];
    const { saved, stores } = makeStores({
      local: data([], both, 50),
      mark: { savedAt: 90, localAt: 50, order: ['APP-Q-Tube', 'APP-Q-Mail'] },
      view: { order: ['APP-Q-Mail', 'APP-Q-Tube'], openFolders: [] },
    });

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(savedOf([], both, ['APP-Q-Tube', 'APP-Q-Mail'])),
      120,
      stores
    );

    expect(result.use).toBe('merge');
    expect(saved.view?.order).toEqual(['APP-Q-Mail', 'APP-Q-Tube']);
    // Still not saved, so the next update cannot undo it either.
    expect(saved.mark?.unsaved).toBe(true);
  });

  it('has nothing unsaved when the merge kept nothing new', async () => {
    const { saved, stores } = makeStores({
      local: data([folder('f1', 'Media')], [], 80),
      mark: null,
      view: { order: ['folder:f1'], openFolders: [] },
    });

    const result = await applySavedLauncher(
      ADDRESS,
      settingsOf(savedOf([folder('f1', 'Media')], [], ['folder:f1'])),
      120,
      stores
    );

    expect(result.use).toBe('merge');
    expect(saved.mark?.unsaved).toBe(false);
  });
});

describe('putting the launcher back to what was saved', () => {
  it('puts back the bookmarks, the folders and the arrangement', async () => {
    const { saved, stores } = makeStores({
      local: data([folder('f2', 'Tools')], [bookmark('b2', 'Q-Mail', 'f2')]),
      view: { order: ['folder:f2'], openFolders: ['f2'] },
    });
    const launcher = savedOf(
      [folder('f1', 'Media')],
      [bookmark('b1', 'Q-Tube', 'f1')],
      ['folder:f1']
    );

    expect(await revertToSavedLauncher(ADDRESS, savedState(launcher), stores)) //
      .toBe(true);

    expect(saved.bookmarks?.folders.map((entry) => entry.name)).toEqual([
      'Media',
    ]);
    expect(saved.bookmarks?.bookmarks.map((entry) => entry.id)).toEqual(['b1']);
    expect(saved.view).toEqual({ order: ['folder:f1'], openFolders: ['f2'] });
    // Back to what is saved: nothing of this device's own is left.
    expect(saved.mark).toEqual({
      savedAt: 100,
      localAt: 999,
      order: ['folder:f1'],
      unsaved: false,
    });
  });

  it('leaves what is here when the settings hold no launcher', async () => {
    const { stores } = makeStores({
      local: data([folder('f2', 'Tools')], []),
    });

    expect(await revertToSavedLauncher(ADDRESS, savedState(null), stores)) //
      .toBe(false);
    expect(stores.saveBookmarks).not.toHaveBeenCalled();
    expect(stores.setView).not.toHaveBeenCalled();
  });

  it("leaves what is here when the saved one is another account's", async () => {
    const { stores } = makeStores();
    const launcher = savedOf([folder('f1', 'Media')], []);

    expect(
      await revertToSavedLauncher(
        ADDRESS,
        savedState(launcher, 100, 'Qother'),
        stores
      )
    ).toBe(false);
    expect(stores.saveBookmarks).not.toHaveBeenCalled();
  });
});

describe('whether the pins are saved', () => {
  const pins = [{ name: 'Q-Tube', service: 'APP' }];

  it('is true for a pin list changed since it was saved', () => {
    expect(
      hasUnsavedPins({
        oldPinnedApps: [],
        pinnedApps: pins,
        settingsLocalLastUpdated: 200,
        settingsQdnLastUpdated: 100,
      })
    ).toBe(true);
  });

  it('is false for the same list, or an older local change', () => {
    expect(
      hasUnsavedPins({
        oldPinnedApps: pins,
        pinnedApps: pins,
        settingsLocalLastUpdated: 200,
        settingsQdnLastUpdated: 100,
      })
    ).toBe(false);
    expect(
      hasUnsavedPins({
        oldPinnedApps: [],
        pinnedApps: pins,
        settingsLocalLastUpdated: 100,
        settingsQdnLastUpdated: 200,
      })
    ).toBe(false);
  });

  it('is false while the saved settings could not be read', () => {
    expect(
      hasUnsavedPins({
        oldPinnedApps: [],
        pinnedApps: pins,
        settingsLocalLastUpdated: 200,
        settingsQdnLastUpdated: -100,
      })
    ).toBe(false);
  });
});
