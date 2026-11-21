import { useCallback } from 'react';
import { atom, useSetAtom } from 'jotai';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import type { LauncherView } from './launcherItems';
import {
  chooseSavedLauncherUse,
  currentSavedLauncher,
  fromSavedBookmarks,
  type LauncherSyncMark,
  mergeSavedLauncher,
  readSavedLauncher,
  sameSavedLauncher,
  type SavedLauncher,
} from './launcherQdn';

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
 * Takes in the launcher part of the account's QDN settings (#374's fields):
 * this device keeps what it has, puts the saved launcher in its place, or
 * merges the two, as `chooseSavedLauncherUse` decides. Since saved apps
 * (savedAppsSync.ts) this runs once per account and device, at its first
 * take-in.
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
