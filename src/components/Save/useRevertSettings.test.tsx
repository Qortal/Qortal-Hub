import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render as renderPage,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';

/** The account's settings on QDN, as the node answers with them. */
const qdn = vi.hoisted(() => ({ settings: null as unknown }));

vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));
vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
}));
vi.mock('../Group/Group', () => ({
  decryptResource: async () => ({ data: '' }),
}));
vi.mock('../../encryption/encryption', () => ({
  base64ToUint8Array: () => new Uint8Array(),
  uint8ArrayToObject: () => qdn.settings,
}));

import {
  canSaveSettingToQdnAtom,
  oldPinnedAppsAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { useQortalGetSaveSettings } from '../../hooks/useQortalGetSaveSettings';
import { useRetrieveDataLocalStorage } from '../../hooks/useRetrieveDataLocalStorage';
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
import { emptySavedApps, recordStores } from '../Apps/AppsLauncher/savedApps';
import {
  loadSavedAppsReplica,
  oneAtATime,
  saveSavedAppsBase,
  saveSavedAppsReplica,
} from '../Apps/AppsLauncher/savedAppsSync';
import { defaultPinnedApps } from '../Apps/config/officialApps';
import { useRevertSettings } from './useRevertSettings';

const ADDRESS = 'Qaddress';

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

/** What the account's settings on QDN hold: Q-Tube, in a folder. */
const savedOnQdn = () =>
  recordStores(
    emptySavedApps(),
    {
      pins: [pin('Q-Tube')],
      data: data([folder('f1', 'Media')], [bookmark('b1', 'Q-Tube', 'f1')]),
      order: ['folder:f1'],
    },
    () => 400
  ).apps;

/** The bookmarks of this device, as the store keeps them. */
const kept = new Map<string, unknown>();

/**
 * The hook, after this device read QDN's copy (`saved`), QDN had none
 * (`none`), or nothing was read yet (`unknown`).
 */
const render = (status: 'saved' | 'none' | 'unknown') => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, [pin('Q-Tube'), pin('Q-Blog')]);
  store.set(oldPinnedAppsAtom, [pin('Q-Tube')]);
  if (status !== 'unknown') {
    const saved = status === 'saved' ? savedOnQdn() : emptySavedApps();
    saveSavedAppsBase(ADDRESS, {
      updated: status === 'saved' ? 500 : null,
      hasCopy: status === 'saved',
      hasBookmarks: status === 'saved',
      apps: saved,
    });
    // Changed here since: this device's own record differs.
    saveSavedAppsReplica(ADDRESS, {
      seen: 600,
      apps: recordStores(
        saved,
        {
          pins: [pin('Q-Tube'), pin('Q-Blog')],
          data: data([folder('f2', 'Tools')], [bookmark('b2', 'Q-Mail', 'f2')]),
          order: ['folder:f2'],
        },
        () => 600
      ).apps,
    });
  }
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
  vi.unstubAllGlobals();
});

describe('putting the settings back to what is saved', () => {
  it('puts back the pins, the bookmarks and the arrangement', async () => {
    const { store, revert } = render('saved');

    await act(async () => {
      await revert();
    });

    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    // Kept here as saved.
    expect(
      JSON.parse(localStorage.getItem(pinnedAppsStorageKey(ADDRESS)) || 'null')
        ?.sortablePinnedApps
    ).toEqual([pin('Q-Tube')]);

    const bookmarks = await loadBookmarksForAddress(ADDRESS);
    expect(bookmarks.folders.map((entry) => entry.name)).toEqual(['Media']);
    expect(bookmarks.bookmarks.map((entry) => entry.id)).toEqual(['b1']);
    // Where the saved tiles stand; a folder that is gone isn't left open.
    expect(loadLauncherView(ADDRESS)).toEqual({
      order: ['folder:f1'],
      openFolders: [],
    });
    // This device's own record is what is saved again: nothing to save.
    const replica = loadSavedAppsReplica(ADDRESS)!;
    expect([...replica.apps.pins.keys()]).toEqual(['APP|q-tube|']);
    expect(replica.seen).toBe(600);
  });

  it('puts back the default pins and leaves the bookmarks when nothing is saved', async () => {
    const { store, revert } = render('none');

    await act(async () => {
      await revert();
    });

    // The default pins, as "Revert to default" says.
    expect(store.get(sortablePinnedAppsAtom)).toEqual(defaultPinnedApps);
    const bookmarks = await loadBookmarksForAddress(ADDRESS);
    expect(bookmarks.folders.map((entry) => entry.name)).toEqual(['Tools']);
    expect(loadLauncherView(ADDRESS).order).toEqual(['folder:f2']);
  });

  it('goes back to the pins last read before QDN was read here', async () => {
    const { store, revert } = render('unknown');

    await act(async () => {
      await revert();
    });

    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    const bookmarks = await loadBookmarksForAddress(ADDRESS);
    expect(bookmarks.folders.map((entry) => entry.name)).toEqual(['Tools']);
  });
});

describe('after signing in', () => {
  /** App reads the account's settings at sign-in. */
  const SignedIn = () => {
    useRetrieveDataLocalStorage(ADDRESS);
    useQortalGetSaveSettings('Publisher', true, ADDRESS);
    return null;
  };

  /** Save's Revert. */
  const RevertButton = () => {
    const revert = useRevertSettings(ADDRESS);
    return <button onClick={() => void revert()}>Revert</button>;
  };

  it("keeps this device's folders and bookmarks when QDN's copy holds only an older Hub's pins", async () => {
    // Hub 3.0.3 saved the account's settings: the pin list alone.
    qdn.settings = { sortablePinnedApps: [pin('Q-Tube')] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('identifier=ext_saved_settings')
          ? ({
              ok: true,
              json: async () => [{ updated: Date.now() - 60_000 }],
            } as Response)
          : ({ ok: true, text: async () => 'encrypted' } as Response)
      )
    );
    const store = createStore();
    renderPage(
      <Provider store={store}>
        <SignedIn />
        <RevertButton />
      </Provider>
    );
    await waitFor(() => expect(store.get(canSaveSettingToQdnAtom)).toBe(true));
    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    const order = loadLauncherView(ADDRESS).order;

    act(() => {
      store.set(sortablePinnedAppsAtom, [pin('Q-Tube'), pin('Q-Blog')]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
      // Revert takes its turn with the sign-in's read: this runs after it.
      await oneAtATime(async () => undefined);
    });

    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    const bookmarks = await loadBookmarksForAddress(ADDRESS);
    expect(bookmarks.folders.map((entry) => entry.name)).toEqual(['Tools']);
    expect(bookmarks.bookmarks.map((entry) => entry.id)).toEqual(['b2']);
    expect(loadLauncherView(ADDRESS).order).toEqual(order);
  });
});
