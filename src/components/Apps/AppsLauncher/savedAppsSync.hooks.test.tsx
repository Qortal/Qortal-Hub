import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import {
  isUsingImportExportSettingsAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import { setPinnedAppsAccount } from '../../../utils/pinnedAppsStorage';
import {
  APP_BOOKMARKS_STORAGE_KEY,
  buildBookmarkLink,
} from '../AppBookmarks/bookmarkStorage';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import {
  emptySavedApps,
  olderFieldsOf,
  recordStores,
  toSavedAppsField,
} from './savedApps';
import {
  loadSavedAppsReplica,
  oneAtATime,
  RECORD_DELAY_MS,
  saveSavedAppsBase,
  saveSavedAppsReplica,
  useHasUnsavedSavedApps,
  useRecordSavedAppsChanges,
  useSavedAppsSync,
} from './savedAppsSync';

const ADDRESS = 'Qaccount';
const START = 1_800_000_000_000;

const pin = (name: string) => ({ name, service: 'APP' });

const savedWith = (names: string[], at: number) =>
  recordStores(
    emptySavedApps(),
    { pins: names.map(pin), data: null, order: null },
    () => at
  ).apps;

/** This device read QDN's copy holding these pins. */
const signedInWith = (names: string[]) => {
  const apps = savedWith(names, START - 1000);
  saveSavedAppsBase(ADDRESS, { updated: START - 500, hasCopy: true, apps });
  saveSavedAppsReplica(ADDRESS, { seen: START - 1000, apps });
};

const kept = new Map<string, unknown>();

const render = ({
  pins = ['Q-Mail'],
  importing = false,
}: { pins?: string[]; importing?: boolean } = {}) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins.map(pin) as never);
  store.set(isUsingImportExportSettingsAtom, importing as never);
  const { result } = renderHook(
    () => {
      useRecordSavedAppsChanges(ADDRESS);
      return {
        unsaved: useHasUnsavedSavedApps(ADDRESS, null),
        sync: useSavedAppsSync(),
      };
    },
    { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> }
  );
  return { store, result };
};

/** Lets the recording run, as it does once changes have settled. */
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(RECORD_DELAY_MS + 50);
    await oneAtATime(async () => undefined);
  });
};

const recordedPins = () =>
  [...(loadSavedAppsReplica(ADDRESS)?.apps.pins.values() ?? [])].filter(
    (entry) => !('removed' in entry)
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  localStorage.clear();
  kept.clear();
  setPinnedAppsAccount(ADDRESS);
  (window as unknown as { appStorage: unknown }).appStorage = {
    get: async (key: string) => kept.get(key),
    set: async (key: string, value: unknown) => {
      kept.set(key, value);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  setPinnedAppsAccount(null);
  delete (window as unknown as { appStorage?: unknown }).appStorage;
});

describe('recording changes as they are made', () => {
  it('records a pin made here, with the time it was made', async () => {
    signedInWith(['Q-Mail']);
    const { store } = render();
    await settle();

    vi.setSystemTime(START + 60_000);
    act(() => {
      store.set(sortablePinnedAppsAtom, [
        pin('Q-Mail'),
        pin('Q-Tube'),
      ] as never);
    });
    await settle();

    const tube = recordedPins().find((entry) => entry.k === 'APP|q-tube|');
    expect(tube?.at).toBeGreaterThanOrEqual(START + 60_000);
    expect(tube?.at).toBeLessThan(START + 61_000);
  });

  it('records nothing while settings are imported from a file', async () => {
    signedInWith(['Q-Mail']);
    const { store } = render({ importing: true });
    act(() => {
      store.set(sortablePinnedAppsAtom, [pin('Q-Tube')] as never);
    });
    await settle();

    expect(recordedPins().map((entry) => entry.k)).toEqual(['APP|q-mail|']);
  });

  it("records nothing of another account's pins", async () => {
    signedInWith(['Q-Mail']);
    // Another account's pins are the ones in use.
    setPinnedAppsAccount('Qother');
    render({ pins: ['Q-Tube'] });
    await settle();

    expect(recordedPins().map((entry) => entry.k)).toEqual(['APP|q-mail|']);
  });
});

describe('whether there is something to save', () => {
  it("is false right after a save, with a pinned app's start page bookmarked from a tab whose identifier is 'null'", async () => {
    // This device read QDN's copy, holding the two pins.
    const apps = recordStores(
      emptySavedApps(),
      { pins: [pin('Q-Mail'), pin('Q-Blog')], data: null, order: null },
      () => START - 1000
    ).apps;
    saveSavedAppsBase(ADDRESS, { updated: START - 500, hasCopy: true, apps });
    saveSavedAppsReplica(ADDRESS, { seen: START - 1000, apps });

    // Q-Blog's start page, bookmarked from the bookmarks menu.
    const bookmarks: AppBookmarksForAddress = {
      folders: [],
      bookmarks: [
        {
          id: 'b1',
          name: 'Q-Blog',
          service: 'APP',
          appName: 'Q-Blog',
          identifier: 'null',
          path: '',
          link: buildBookmarkLink({
            service: 'APP',
            appName: 'Q-Blog',
            identifier: 'null',
            path: '',
          }),
          folderId: null,
          createdAt: START,
          updatedAt: START,
        },
      ],
      updatedAt: START,
    };
    kept.set(APP_BOOKMARKS_STORAGE_KEY, { [ADDRESS]: bookmarks });

    const store = createStore();
    store.set(sortablePinnedAppsAtom, [pin('Q-Mail'), pin('Q-Blog')] as never);
    store.set(isUsingImportExportSettingsAtom, false as never);
    const { result } = renderHook(
      () => ({
        unsaved: useHasUnsavedSavedApps(ADDRESS, bookmarks),
        sync: useSavedAppsSync(),
      }),
      {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      }
    );

    // Saved, as Save does: what this device has, then published.
    await act(async () => {
      const prepared = await result.current.sync.forSave(ADDRESS);
      await result.current.sync.markPublished(ADDRESS, prepared!.apps);
    });

    expect(result.current.unsaved).toBe(false);
  });

  it("doesn't count folders on a device that keeps no bookmarks", async () => {
    // A copy with a folder, read on a device without a bookmarks store.
    const apps = recordStores(
      emptySavedApps(),
      {
        pins: [pin('Q-Mail')],
        data: {
          folders: [
            { id: 'f1', name: 'Games', createdAt: START, updatedAt: START },
          ],
          bookmarks: [],
        },
        order: null,
      },
      () => START - 1000
    ).apps;
    saveSavedAppsBase(ADDRESS, { updated: START - 500, hasCopy: true, apps });
    saveSavedAppsReplica(ADDRESS, { seen: START - 1000, apps });
    delete (window as unknown as { appStorage?: unknown }).appStorage;
    const store = createStore();
    store.set(sortablePinnedAppsAtom, [pin('Q-Mail')] as never);
    store.set(isUsingImportExportSettingsAtom, false as never);
    // Such a device reads its bookmarks as an empty store.
    const empty = { folders: [], bookmarks: [], updatedAt: START };
    const { result } = renderHook(
      () => ({
        unsaved: useHasUnsavedSavedApps(ADDRESS, empty),
        sync: useSavedAppsSync(),
      }),
      {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      }
    );
    await act(async () => {
      await result.current.sync.takeIn(ADDRESS, null);
    });
    expect(result.current.unsaved).toBe(false);
  });

  it("is false after taking in another device's changes, true after one here", async () => {
    signedInWith(['Q-Mail']);
    const { store, result } = render();
    const theirs = recordStores(
      savedWith(['Q-Mail'], START - 1000),
      { pins: [pin('Q-Mail'), pin('Q-Share')], data: null, order: null },
      () => START - 100
    ).apps;

    await act(async () => {
      await result.current.sync.takeIn(ADDRESS, {
        settings: {
          ...olderFieldsOf(theirs),
          savedApps: toSavedAppsField(theirs),
        },
        updated: START - 50,
      });
    });
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      pin('Q-Mail'),
      pin('Q-Share'),
    ]);
    expect(result.current.unsaved).toBe(false);

    act(() => {
      store.set(sortablePinnedAppsAtom, [pin('Q-Share')] as never);
    });
    expect(result.current.unsaved).toBe(true);
  });

  it("doesn't count the default pins when nothing is saved yet", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.sync.takeIn(ADDRESS, null);
    });
    expect(result.current.unsaved).toBe(false);
  });

  it('counts pins changed here when nothing is saved yet', async () => {
    saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', [
      pin('Q-Mail'),
    ]);
    const { result } = render();
    await act(async () => {
      await result.current.sync.takeIn(ADDRESS, null);
    });
    expect(result.current.unsaved).toBe(true);
  });
});
