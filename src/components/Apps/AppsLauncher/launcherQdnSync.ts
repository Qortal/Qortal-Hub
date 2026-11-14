import { useCallback, useMemo } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import isEqual from 'lodash/isEqual';
import {
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import {
  type PinnedApp,
  serializePinnedAppsForQdn,
} from '../../../utils/pinnedAppsSettings';
import {
  loadBookmarksForAddress,
  saveBookmarksForAddress,
} from '../AppBookmarks/bookmarkStorage';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import { type LauncherView, loadLauncherView } from './launcherItems';
import {
  chooseSavedLauncherUse,
  currentSavedLauncher,
  fromSavedBookmarks,
  type LauncherSyncMark,
  loadLauncherSyncMark,
  mergeSavedLauncher,
  readSavedLauncher,
  sameSavedLauncher,
  type SavedLauncher,
  saveLauncherSyncMark,
} from './launcherQdn';
import { useLauncherView, useSetLauncherViewOf } from './useLauncherView';

/** What the account's settings on QDN hold for the launcher, as last seen. */
export type SavedLauncherState = {
  address: string | null;
  /**
   * `unknown` until the settings were read; `none` when there are none, or
   * they hold no launcher; `saved` with what they hold.
   */
  status: 'unknown' | 'none' | 'saved';
  launcher: SavedLauncher | null;
  /** The time of those settings on QDN, or 0. */
  savedAt: number;
};

export const savedLauncherAtom = atom<SavedLauncherState>({
  address: null,
  status: 'unknown',
  launcher: null,
  savedAt: 0,
});

/** How many changes were made on the launcher in this session. */
export const launcherEditsAtom = atom<{
  address: string | null;
  count: number;
}>({ address: null, count: 0 });

/** Counts a change made on the launcher, for the offer to save it. */
export const useCountLauncherEdit = (address: string | null | undefined) => {
  const setEdits = useSetAtom(launcherEditsAtom);
  return useCallback(() => {
    const account = address || null;
    setEdits((edits) => ({
      address: account,
      count: edits.address === account ? edits.count + 1 : 1,
    }));
  }, [address, setEdits]);
};

/** Where the launcher keeps what it takes in; tests hand in their own. */
export type LauncherSyncStores = {
  loadBookmarks: (address: string) => Promise<AppBookmarksForAddress>;
  saveBookmarks: (
    address: string,
    data: AppBookmarksForAddress
  ) => Promise<AppBookmarksForAddress>;
  loadView: (address: string) => LauncherView;
  setView: (address: string, view: LauncherView) => void;
  loadMark: (address: string) => LauncherSyncMark | null;
  saveMark: (address: string, mark: LauncherSyncMark) => void;
  now: () => number;
};

export type TakeInResult = {
  use: 'keep' | 'replace' | 'merge';
  launcher: SavedLauncher | null;
};

/**
 * Takes in the launcher part of the account's QDN settings: this device keeps
 * what it has, puts the saved launcher in its place, or merges the two, as
 * `chooseSavedLauncherUse` decides.
 */
export async function applySavedLauncher(
  address: string,
  settings: unknown,
  savedAt: number,
  stores: LauncherSyncStores
): Promise<TakeInResult> {
  const now = stores.now();
  const launcher = readSavedLauncher(settings, now);
  const local = await stores.loadBookmarks(address);
  const view = stores.loadView(address);
  const use = chooseSavedLauncherUse({
    local,
    order: view.order,
    mark: stores.loadMark(address),
    saved: launcher,
    savedAt,
  });
  if (use === 'keep' || !launcher) return { use: 'keep', launcher };

  const next =
    use === 'replace'
      ? {
          data: fromSavedBookmarks(launcher.bookmarks, now),
          order: launcher.order,
        }
      : mergeSavedLauncher({ data: local, order: view.order }, launcher, now);
  const stored = await stores.saveBookmarks(address, next.data);
  stores.setView(address, { ...view, order: next.order });
  stores.saveMark(address, {
    savedAt,
    localAt: stored.updatedAt,
    order: next.order,
    // What a merge kept beyond the saved launcher has never been saved: the
    // next update must keep it until it is.
    unsaved:
      use === 'merge' &&
      !sameSavedLauncher(currentSavedLauncher(next.data, next.order), launcher),
  });
  return { use, launcher };
}

/**
 * Puts the launcher back to what the account's settings on QDN hold: the
 * bookmarks, the folders and where the tiles stand. Settings that hold no
 * launcher leave this device's own alone — there is nothing to go back to,
 * since the Hub that saved them did not know about them.
 */
export async function revertToSavedLauncher(
  address: string,
  saved: SavedLauncherState,
  stores: LauncherSyncStores
): Promise<boolean> {
  if (
    saved.address !== address ||
    saved.status !== 'saved' ||
    !saved.launcher
  ) {
    return false;
  }
  const { launcher } = saved;
  const view = stores.loadView(address);
  const stored = await stores.saveBookmarks(
    address,
    fromSavedBookmarks(launcher.bookmarks, stores.now())
  );
  stores.setView(address, { ...view, order: launcher.order });
  stores.saveMark(address, {
    savedAt: saved.savedAt,
    localAt: stored.updatedAt,
    order: launcher.order,
    unsaved: false,
  });
  return true;
}

// One at a time: the login read, a save and Revert all write these stores.
let running: Promise<unknown> = Promise.resolve();

const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
  const run = running.then(work);
  running = run.catch(() => undefined);
  return run;
};

/** The stores the launcher really uses; tests hand in their own. */
const liveStores = (
  setView: (address: string, view: LauncherView) => void
): LauncherSyncStores => ({
  loadBookmarks: loadBookmarksForAddress,
  saveBookmarks: saveBookmarksForAddress,
  loadView: (account) => loadLauncherView(account),
  setView,
  loadMark: (account) => loadLauncherSyncMark(account),
  saveMark: (account, mark) => saveLauncherSyncMark(account, mark),
  now: Date.now,
});

/**
 * Takes in what the account's QDN settings hold for the launcher, and keeps
 * it as what is saved. `found` is null when the account has no settings.
 */
export const useTakeInSavedLauncher = () => {
  const setSavedLauncher = useSetAtom(savedLauncherAtom);
  const setViewOf = useSetLauncherViewOf();
  const stores = useMemo(() => liveStores(setViewOf), [setViewOf]);

  return useCallback(
    async (
      address: string,
      found: { settings: unknown; savedAt: number } | null
    ) => {
      let launcher: SavedLauncher | null = null;
      const savedAt = found?.savedAt ?? 0;
      if (found) {
        ({ launcher } = await oneAtATime(() =>
          applySavedLauncher(address, found.settings, savedAt, stores)
        ));
      }
      setSavedLauncher((state) =>
        // Saved here since: QDN may not show it yet.
        state.address === address && state.savedAt > savedAt
          ? state
          : {
              address,
              status: launcher ? 'saved' : 'none',
              launcher,
              savedAt,
            }
      );
    },
    [setSavedLauncher, stores]
  );
};

/**
 * Puts the launcher back to what is saved on QDN, for Revert. It answers
 * whether there was a saved launcher to go back to.
 */
export const useRevertSavedLauncher = () => {
  const saved = useAtomValue(savedLauncherAtom);
  const setViewOf = useSetLauncherViewOf();
  const stores = useMemo(() => liveStores(setViewOf), [setViewOf]);

  return useCallback(
    async (address: string | null | undefined) =>
      address
        ? oneAtATime(() => revertToSavedLauncher(address, saved, stores))
        : false,
    [saved, stores]
  );
};

/** The rule the Save button has always used for the pin list. */
export const hasUnsavedPins = ({
  oldPinnedApps,
  pinnedApps,
  settingsLocalLastUpdated,
  settingsQdnLastUpdated,
}: {
  oldPinnedApps: PinnedApp[];
  pinnedApps: PinnedApp[];
  settingsLocalLastUpdated: number;
  settingsQdnLastUpdated: number;
}) =>
  settingsQdnLastUpdated !== -100 &&
  settingsQdnLastUpdated < settingsLocalLastUpdated &&
  !isEqual(
    serializePinnedAppsForQdn(pinnedApps),
    serializePinnedAppsForQdn(oldPinnedApps)
  );

/**
 * Whether the pinned apps, the bookmarks and folders, or the order of the
 * launcher's tiles differ from what is saved on QDN. The bookmarks are those
 * the caller has read; while they are not read, only the pins count.
 */
export const useHasUnsavedLauncher = (
  address: string | null | undefined,
  bookmarks: AppBookmarksForAddress | null
) => {
  const pinnedApps = useAtomValue(sortablePinnedAppsAtom);
  const oldPinnedApps = useAtomValue(oldPinnedAppsAtom);
  const settingsLocalLastUpdated = useAtomValue(settingsLocalLastUpdatedAtom);
  const settingsQdnLastUpdated = useAtomValue(settingsQDNLastUpdatedAtom);
  const saved = useAtomValue(savedLauncherAtom);
  const [view] = useLauncherView(address);

  return useMemo(() => {
    const pinsChanged = hasUnsavedPins({
      oldPinnedApps,
      pinnedApps,
      settingsLocalLastUpdated,
      settingsQdnLastUpdated,
    });
    const isKnown =
      !!address && saved.address === address && saved.status !== 'unknown';
    const launcherChanged =
      isKnown &&
      !!bookmarks &&
      !sameSavedLauncher(
        currentSavedLauncher(bookmarks, view.order),
        saved.launcher
      );
    return pinsChanged || launcherChanged;
  }, [
    address,
    bookmarks,
    oldPinnedApps,
    pinnedApps,
    saved,
    settingsLocalLastUpdated,
    settingsQdnLastUpdated,
    view.order,
  ]);
};
