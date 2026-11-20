import { useCallback, useEffect, useMemo, useState } from 'react';
import { atom, useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import {
  type PinnedApp,
  removeBrokenPinnedApps,
  serializePinnedAppForQdn,
  serializePinnedAppsForQdn,
} from '../../../utils/pinnedAppsSettings';
import {
  getPinnedAppsAccount,
  localPinnedAppsTimestamp,
  savePinnedAppsFor,
} from '../../../utils/pinnedAppsStorage';
import {
  APP_BOOKMARKS_CHANGED_EVENT,
  loadBookmarksForAddress,
  saveBookmarksForAddress,
} from '../AppBookmarks/bookmarkStorage';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import { type LauncherView, loadLauncherView } from './launcherItems';
import { loadLauncherSyncMark, saveLauncherSyncMark } from './launcherQdn';
import { applySavedLauncher, type LauncherSyncStores } from './launcherQdnSync';
import {
  changesFromOlderFields,
  deriveLauncher,
  dropExpiredItems,
  dropOldRemovals,
  emptySavedApps,
  launcherContent,
  type LauncherStores,
  mergeSavedApps,
  newestTime,
  type OlderFields,
  olderFieldsMatch,
  olderFieldsOf,
  pinsContent,
  readOlderFields,
  readSavedApps,
  recordStores,
  type SavedApps,
  type SavedAppsField,
  stableJson,
  toSavedAppsField,
  withPrivatePinsKept,
} from './savedApps';
import { pinKeyOf } from './savedAppsKeys';
import { useLauncherView, useSetLauncherViewOf } from './useLauncherView';

/**
 * Keeps the launcher's saved apps in step with QDN, per account:
 *
 * - this device's own saved apps (`ext_saved_apps:<address>`), with the time
 *   of each change made here, recorded as it happens;
 * - what QDN held when this device last read or saved it
 *   (`ext_saved_apps_qdn:<address>`), which Revert goes back to and changes
 *   are measured against.
 *
 * At sign-in and before a save, the copy on QDN is merged into this device's
 * record by record, and the launcher's stores (the pin list, the bookmarks
 * and the row's order) are filled from the result.
 */

/** This device's saved apps, and the latest change time it has seen. */
export type SavedAppsReplica = { seen: number; apps: SavedApps };

/** What QDN held when this device last read or saved it. */
export type SavedAppsBase = {
  /** QDN's time of the copy last read, or null for none. */
  updated: number | null;
  /** Whether QDN holds a copy (read here, or saved from here). */
  hasCopy: boolean;
  apps: SavedApps;
};

const REPLICA_KEY = 'ext_saved_apps';
const BASE_KEY = 'ext_saved_apps_qdn';

export const savedAppsReplicaKey = (address: string) =>
  `${REPLICA_KEY}:${address}`;
export const savedAppsBaseKey = (address: string) => `${BASE_KEY}:${address}`;

const readStored = (storage: Pick<Storage, 'getItem'>, key: string) => {
  try {
    const stored = JSON.parse(storage.getItem(key) || 'null');
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  }
};

const writeStored = (
  storage: Pick<Storage, 'setItem'>,
  key: string,
  value: unknown
) => {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // A full storage must never stop a sign-in or a save.
    console.error('Error keeping the saved apps:', error);
  }
};

export const loadSavedAppsReplica = (
  address: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): SavedAppsReplica | null => {
  const stored = readStored(storage, savedAppsReplicaKey(address));
  const apps = stored ? readSavedApps(stored) : null;
  if (!apps) return null;
  const seen = Number(stored.seen);
  return {
    seen: Math.max(Number.isFinite(seen) ? seen : 0, newestTime(apps)),
    apps,
  };
};

export const saveSavedAppsReplica = (
  address: string,
  replica: SavedAppsReplica,
  storage: Pick<Storage, 'setItem'> = localStorage
) =>
  writeStored(storage, savedAppsReplicaKey(address), {
    seen: replica.seen,
    savedApps: toSavedAppsField(replica.apps),
  });

export const loadSavedAppsBase = (
  address: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): SavedAppsBase | null => {
  const stored = readStored(storage, savedAppsBaseKey(address));
  const apps = stored ? readSavedApps(stored) : null;
  if (!apps) return null;
  const updated = Number(stored.updated);
  return {
    updated:
      stored.updated === null || !Number.isFinite(updated) ? null : updated,
    hasCopy: stored.hasCopy === true,
    apps,
  };
};

export const saveSavedAppsBase = (
  address: string,
  base: SavedAppsBase,
  storage: Pick<Storage, 'setItem'> = localStorage
) =>
  writeStored(storage, savedAppsBaseKey(address), {
    updated: base.updated,
    hasCopy: base.hasCopy,
    savedApps: toSavedAppsField(base.apps),
  });

/** Where the saved apps are read from and written to; tests hand in their own. */
export type SavedAppsStores = {
  /** The pin list in use and when it changed here, or null for another account's. */
  readPins: (address: string) => { pins: PinnedApp[]; time: number } | null;
  writePins: (address: string, pins: PinnedApp[]) => void;
  /** Whether this device keeps bookmarks at all (the desktop app does). */
  keepsBookmarks: boolean;
  /** The bookmarks, or null when they can't be read. */
  readBookmarks: (address: string) => Promise<AppBookmarksForAddress | null>;
  writeBookmarks: (
    address: string,
    data: AppBookmarksForAddress
  ) => Promise<unknown>;
  readView: (address: string) => LauncherView;
  writeView: (address: string, view: LauncherView) => void;
  readReplica: (address: string) => SavedAppsReplica | null;
  writeReplica: (address: string, replica: SavedAppsReplica) => void;
  readBase: (address: string) => SavedAppsBase | null;
  writeBase: (address: string, base: SavedAppsBase) => void;
  /** The stores #374's take-in uses, for a device's first one. */
  legacy: LauncherSyncStores;
  /** Whether the account is still the one signed in. */
  isCurrent: (address: string) => boolean;
  now: () => number;
};

/** A copy of the account's settings found on QDN. */
export type FoundSettings = { settings: unknown; updated: number };

// One at a time: the sign-in read, recording a change, a save and Revert all
// read and write the same stores.
let running: Promise<unknown> = Promise.resolve();

export const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
  const run = running.then(work);
  running = run.catch(() => undefined);
  return run;
};

const sameJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** The derived pins, keeping what this device knows of each (a logo). */
const withLocalDetails = (pins: PinnedApp[], local: PinnedApp[]) => {
  const byKey = new Map(
    removeBrokenPinnedApps(local).map((app) => [pinKeyOf(app), app])
  );
  return pins.map((app) => {
    const mine = byKey.get(pinKeyOf(app));
    return mine &&
      sameJson(serializePinnedAppForQdn(mine), serializePinnedAppForQdn(app))
      ? mine
      : app;
  });
};

const storedBookmarks = (data: {
  folders: AppBookmarksForAddress['folders'];
  bookmarks: AppBookmarksForAddress['bookmarks'];
}) =>
  stableJson([
    data.folders.map((folder) => [folder.id, folder.name]),
    data.bookmarks.map((bookmark) => [
      bookmark.id,
      bookmark.name,
      bookmark.service,
      bookmark.appName,
      bookmark.identifier || '',
      bookmark.path,
      bookmark.folderId ?? null,
    ]),
  ]);

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/**
 * Fills the launcher's stores from saved apps, where they differ. Whether
 * all of them were filled: not when the account changed meanwhile or the
 * bookmarks couldn't be read, which are then left as they are.
 */
export async function applySavedApps(
  address: string,
  apps: SavedApps,
  stores: SavedAppsStores
): Promise<boolean> {
  if (!stores.isCurrent(address)) return false;
  const derived = deriveLauncher(apps);
  const pins = stores.readPins(address);
  if (pins && pinsContent(pins.pins) !== pinsContent(derived.pins)) {
    stores.writePins(address, withLocalDetails(derived.pins, pins.pins));
  }
  if (stores.keepsBookmarks) {
    const data = await stores.readBookmarks(address);
    // Bookmarks that can't be read are not written over.
    if (!data || !stores.isCurrent(address)) return false;
    if (storedBookmarks(data) !== storedBookmarks(derived.data)) {
      const created = new Map(
        [...data.folders, ...data.bookmarks].map((entry) => [
          entry.id,
          entry.createdAt,
        ])
      );
      const keepCreated = <T extends { id: string; createdAt: number }>(
        entry: T
      ) => ({ ...entry, createdAt: created.get(entry.id) ?? entry.createdAt });
      await stores.writeBookmarks(address, {
        folders: derived.data.folders.map(keepCreated),
        bookmarks: derived.data.bookmarks.map(keepCreated),
        updatedAt: stores.now(),
      });
    }
  }
  if (!stores.isCurrent(address)) return false;
  const view = stores.readView(address);
  const folderIds = new Set(derived.data.folders.map((folder) => folder.id));
  const openFolders = view.openFolders.filter((id) => folderIds.has(id));
  if (
    !sameList(view.order, derived.order) ||
    openFolders.length !== view.openFolders.length
  ) {
    stores.writeView(address, { order: derived.order, openFolders });
  }
  return true;
}

/** The bookmarks as far as they can be known: null when they can't. */
const knownBookmarks = async (address: string, stores: SavedAppsStores) =>
  stores.keepsBookmarks ? await stores.readBookmarks(address) : null;

/**
 * The row's order, when the bookmarks are known. Without them the launcher
 * shows pins only, so its order says nothing about folders and bookmarks:
 * they stay where they are.
 */
const orderWith = (
  address: string,
  data: AppBookmarksForAddress | null,
  stores: SavedAppsStores
) => (data ? stores.readView(address).order : null);

/**
 * Records this device's changes since they were last recorded, timed now
 * (never before a change it has seen). Null before the account has saved apps
 * on this device.
 */
export async function recordLocalChanges(
  address: string,
  stores: SavedAppsStores
): Promise<SavedAppsReplica | null> {
  const replica = stores.readReplica(address);
  if (!replica) return null;
  const data = await knownBookmarks(address, stores);
  if (!stores.isCurrent(address)) return replica;
  // Read after the wait, so a pin made meanwhile is recorded, not lost to
  // what is written next.
  const pins = stores.readPins(address);
  // Another account's pins are shown: nothing of this one's changed.
  if (!pins) return replica;
  const at = Math.max(stores.now(), replica.seen + 1);
  const result = recordStores(
    replica.apps,
    { pins: pins.pins, data, order: orderWith(address, data, stores) },
    () => at
  );
  if (!result.isChanged) return replica;
  const next = { seen: Math.max(replica.seen, at), apps: result.apps };
  stores.writeReplica(address, next);
  return next;
}

/** A copy's saved apps as records: what QDN holds, whoever saved it. */
const copyFrom = (found: FoundSettings, base: SavedApps) => {
  const incoming = readSavedApps(found.settings);
  const older = readOlderFields(found.settings);
  if (incoming) {
    const apps = olderFieldsMatch(incoming, older)
      ? incoming
      : changesFromOlderFields(incoming, older, found.updated).apps;
    return { incoming, apps, changes: apps };
  }
  // Saved by a Hub or GO that doesn't know saved apps.
  const result = changesFromOlderFields(base, older, found.updated);
  return { incoming: null, apps: result.apps, changes: result.changed };
};

/**
 * A device's first take-in: today's rules run once, then this device's saved
 * apps are made from what it has. An item as QDN has it keeps QDN's time; one
 * that differs gets the time it last changed here. Null when it has to wait
 * (another account's pins are shown, or the bookmarks can't be read).
 */
export async function startSavedApps(
  address: string,
  found: FoundSettings | null,
  stores: SavedAppsStores
): Promise<SavedAppsBase | null> {
  const before = stores.readPins(address);
  if (!before) return null;
  const pinsTime = before.time;
  if (found) {
    const list = (found.settings as { sortablePinnedApps?: unknown } | null)
      ?.sortablePinnedApps;
    // QDN's pin list replaces this device's if it's newer. A list from Hub
    // 3.0.3 says nothing about private apps: those stay.
    if (Array.isArray(list) && found.updated > pinsTime) {
      const older = readOlderFields(found.settings);
      const theirs = older.placeholders
        ? withPrivatePinsKept(older.pins ?? [], before.pins)
        : removeBrokenPinnedApps(list as PinnedApp[]);
      if (pinsContent(theirs) !== pinsContent(before.pins)) {
        stores.writePins(address, theirs);
      }
    }
    if (stores.keepsBookmarks) {
      try {
        await applySavedLauncher(
          address,
          found.settings,
          found.updated,
          stores.legacy
        );
      } catch (error) {
        console.error(error);
      }
    }
  }
  if (!stores.isCurrent(address)) return null;
  const data = await knownBookmarks(address, stores);
  if (stores.keepsBookmarks && !data) return null;
  const pins = stores.readPins(address);
  if (!pins || !stores.isCurrent(address)) return null;

  const copy = found
    ? copyFrom(found, emptySavedApps())
    : { incoming: null, apps: emptySavedApps() };
  const ownPinsTime = pinsTime > 0 ? pinsTime : 1;
  const storeTime = data && data.updatedAt > 0 ? data.updatedAt : 1;
  let apps = recordStores(
    copy.apps,
    { pins: pins.pins, data, order: orderWith(address, data, stores) },
    ({ kind, removed, itemTime }) =>
      kind === 'pin'
        ? ownPinsTime
        : !removed && itemTime > 0
          ? itemTime
          : storeTime
  ).apps;
  // Changes saved on other devices since win over older ones made here.
  if (copy.incoming) apps = mergeSavedApps(apps, copy.apps);
  const now = stores.now();
  apps = dropOldRemovals(apps, now);
  const replica = {
    seen: Math.max(newestTime(apps), newestTime(copy.apps)),
    apps,
  };
  const base: SavedAppsBase = {
    updated: found ? found.updated : null,
    hasCopy: !!found,
    apps: dropOldRemovals(copy.apps, now),
  };
  // Kept only once the launcher shows it: stores left as they were would
  // otherwise be recorded as changes made here.
  if (!(await applySavedApps(address, replica.apps, stores))) return null;
  stores.writeReplica(address, replica);
  stores.writeBase(address, base);
  return base;
}

/**
 * Takes in the account's settings found on QDN (null when it has none):
 * this device's own changes are recorded first, then QDN's copy is merged in
 * record by record and the launcher shows the result. Null when it has to
 * wait.
 */
export async function takeInSavedApps(
  address: string,
  found: FoundSettings | null,
  stores: SavedAppsStores
): Promise<SavedAppsBase | null> {
  const base = stores.readBase(address);
  if (!stores.readReplica(address) || !base) {
    return startSavedApps(address, found, stores);
  }
  const replica = await recordLocalChanges(address, stores);
  if (!replica || !stores.isCurrent(address)) return null;
  // Nothing newer on QDN. A node that is behind may answer with a copy
  // older than the one read here.
  if (!found || (base.updated !== null && found.updated <= base.updated)) {
    return base;
  }

  const now = stores.now();
  const copy = copyFrom(found, base.apps);
  let apps = mergeSavedApps(replica.apps, copy.changes);
  if (copy.incoming) apps = dropExpiredItems(apps, copy.apps, base.apps, now);
  apps = dropOldRemovals(apps, now);
  const next = {
    seen: Math.max(replica.seen, newestTime(copy.apps)),
    apps,
  };
  const nextBase: SavedAppsBase = {
    updated: found.updated,
    hasCopy: true,
    apps: dropOldRemovals(copy.apps, now),
  };
  // Kept only once the launcher shows it: stores left as they were would
  // otherwise be recorded as changes made here, reversing the copy's.
  if (!(await applySavedApps(address, next.apps, stores))) return null;
  stores.writeReplica(address, next);
  stores.writeBase(address, nextBase);
  return nextBase;
}

/** The fields a save publishes: `savedApps` and the ones older clients read. */
export type SavedAppsFields = OlderFields & { savedApps: SavedAppsField };

/**
 * What a save publishes, from this device's saved apps with its latest
 * changes. A device that never took in QDN's copy (it couldn't be read, and
 * the save writes over it) starts from what it has. Null when it can't.
 */
export async function savedAppsForSave(
  address: string,
  stores: SavedAppsStores
): Promise<{ apps: SavedApps; fields: SavedAppsFields } | null> {
  if (!stores.readReplica(address) || !stores.readBase(address)) {
    if (!(await startSavedApps(address, null, stores))) return null;
  }
  const replica = await recordLocalChanges(address, stores);
  if (!replica) return null;
  const apps = dropOldRemovals(replica.apps, stores.now());
  return {
    apps,
    fields: { ...olderFieldsOf(apps), savedApps: toSavedAppsField(apps) },
  };
}

/**
 * After a save: what was published is what QDN holds. Its time stays the one
 * of the copy read before, so that copy, while QDN still shows it, isn't read
 * again; the saved one is read once when QDN shows it.
 */
export function markSavedAppsPublished(
  address: string,
  apps: SavedApps,
  stores: SavedAppsStores
): SavedAppsBase {
  const base: SavedAppsBase = {
    updated: stores.readBase(address)?.updated ?? null,
    hasCopy: true,
    apps,
  };
  stores.writeBase(address, base);
  return base;
}

/**
 * Revert: this device's saved apps go back to QDN's copy as last read here,
 * and the launcher shows it. `no-copy` when QDN holds none; `unknown` before
 * this device has read it.
 */
export async function revertSavedApps(
  address: string,
  stores: SavedAppsStores
): Promise<'reverted' | 'no-copy' | 'unknown'> {
  const base = stores.readBase(address);
  const replica = stores.readReplica(address);
  if (!base || !replica) return 'unknown';
  if (!base.hasCopy) return 'no-copy';
  // What couldn't be put back (bookmarks that can't be read) stays this
  // device's own, unsaved.
  if (await applySavedApps(address, base.apps, stores)) {
    stores.writeReplica(address, { seen: replica.seen, apps: base.apps });
  }
  return 'reverted';
}

// --- In the app ---------------------------------------------------------------

/** What QDN holds for the launcher, as last read here, for the UI. */
export type SavedAppsState = {
  address: string | null;
  /** `unknown` until the account's settings were read (or found missing). */
  status: 'unknown' | 'read';
  /** QDN's copy as the launcher's stores. */
  saved: LauncherStores | null;
  hasCopy: boolean;
};

export const savedAppsStateAtom = atom<SavedAppsState>({
  address: null,
  status: 'unknown',
  saved: null,
  hasCopy: false,
});

type JotaiStore = ReturnType<typeof useStore>;

/** The stores the app really uses. */
export const liveSavedAppsStores = (
  store: JotaiStore,
  setViewOf: (address: string, view: LauncherView) => void
): SavedAppsStores => {
  const keepsBookmarks = typeof window !== 'undefined' && !!window.appStorage;
  return {
    readPins: (address) =>
      getPinnedAppsAccount() === address
        ? {
            pins: (store.get(sortablePinnedAppsAtom) ?? []) as PinnedApp[],
            time: localPinnedAppsTimestamp(),
          }
        : null,
    writePins: (address, pins) => {
      if (getPinnedAppsAccount() !== address) return;
      store.set(sortablePinnedAppsAtom, pins as never);
      savePinnedAppsFor(address, pins);
    },
    keepsBookmarks,
    readBookmarks: async (address) => {
      try {
        return await loadBookmarksForAddress(address);
      } catch (error) {
        console.error(error);
        return null;
      }
    },
    writeBookmarks: (address, data) => saveBookmarksForAddress(address, data),
    readView: (address) => loadLauncherView(address),
    writeView: setViewOf,
    readReplica: (address) => loadSavedAppsReplica(address),
    writeReplica: (address, replica) => saveSavedAppsReplica(address, replica),
    readBase: (address) => loadSavedAppsBase(address),
    writeBase: (address, base) => saveSavedAppsBase(address, base),
    legacy: {
      loadBookmarks: loadBookmarksForAddress,
      saveBookmarks: saveBookmarksForAddress,
      loadView: (address) => loadLauncherView(address),
      setView: setViewOf,
      loadMark: (address) => loadLauncherSyncMark(address),
      saveMark: (address, mark) => saveLauncherSyncMark(address, mark),
      now: Date.now,
    },
    isCurrent: (address) => getPinnedAppsAccount() === address,
    now: Date.now,
  };
};

export const useSavedAppsStores = () => {
  const store = useStore();
  const setViewOf = useSetLauncherViewOf();
  return useMemo(
    () => liveSavedAppsStores(store, setViewOf),
    [store, setViewOf]
  );
};

/** Sign-in, save and Revert, with what the UI shows kept in step. */
export const useSavedAppsSync = () => {
  const stores = useSavedAppsStores();
  const setState = useSetAtom(savedAppsStateAtom);
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);

  const show = useCallback(
    (address: string, base: SavedAppsBase | null) => {
      if (!base || !stores.isCurrent(address)) return;
      const saved = deriveLauncher(base.apps);
      setState({ address, status: 'read', saved, hasCopy: base.hasCopy });
      // What the pins go back to, and what other parts compare with.
      setOldPinnedApps(serializePinnedAppsForQdn(saved.pins) as never);
    },
    [setOldPinnedApps, setState, stores]
  );

  const takeIn = useCallback(
    async (address: string, found: FoundSettings | null) => {
      const base = await oneAtATime(() =>
        takeInSavedApps(address, found, stores)
      );
      show(address, base);
      return base;
    },
    [show, stores]
  );

  const forSave = useCallback(
    (address: string) => oneAtATime(() => savedAppsForSave(address, stores)),
    [stores]
  );

  const markPublished = useCallback(
    (address: string, apps: SavedApps) =>
      oneAtATime(async () => {
        show(address, markSavedAppsPublished(address, apps, stores));
      }),
    [show, stores]
  );

  const revert = useCallback(
    (address: string) => oneAtATime(() => revertSavedApps(address, stores)),
    [stores]
  );

  return { forSave, markPublished, revert, takeIn };
};

/** How long changes settle before they are recorded. */
export const RECORD_DELAY_MS = 400;

/**
 * Records the launcher's changes as they are made, so each gets the time it
 * was made: the pins, the bookmarks and folders, and the row's order.
 */
export const useRecordSavedAppsChanges = (
  address: string | null | undefined
) => {
  const pins = useAtomValue(sortablePinnedAppsAtom);
  const isUsingImportExport = useAtomValue(isUsingImportExportSettingsAtom);
  const [view] = useLauncherView(address);
  const stores = useSavedAppsStores();
  const [bookmarksChanged, setBookmarksChanged] = useState(0);

  useEffect(() => {
    const onChanged = (event: CustomEvent<{ address?: string }>) => {
      if (address && event.detail?.address === address) {
        setBookmarksChanged((count) => count + 1);
      }
    };
    subscribeToEvent(APP_BOOKMARKS_CHANGED_EVENT, onChanged);
    return () => unsubscribeFromEvent(APP_BOOKMARKS_CHANGED_EVENT, onChanged);
  }, [address]);

  useEffect(() => {
    // Settings imported from a file aren't the account's own.
    if (!address || isUsingImportExport !== false) return;
    const timer = window.setTimeout(() => {
      oneAtATime(() => recordLocalChanges(address, stores)).catch((error) =>
        console.error(error)
      );
    }, RECORD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [address, bookmarksChanged, isUsingImportExport, pins, stores, view]);
};

/**
 * Whether the launcher differs from QDN's copy as last read here: the pins,
 * the folders, the bookmarks and where each stands. While the bookmarks
 * aren't read, or on a device that keeps none, only the pins count. With
 * nothing saved on QDN yet, only what this device made counts, not the
 * default pins.
 */
export const useHasUnsavedSavedApps = (
  address: string | null | undefined,
  bookmarks: AppBookmarksForAddress | null
) => {
  const pins = useAtomValue(sortablePinnedAppsAtom) as PinnedApp[];
  const state = useAtomValue(savedAppsStateAtom);
  const [view] = useLauncherView(address);

  return useMemo(() => {
    if (!address || state.address !== address || state.status !== 'read') {
      return false;
    }
    if (!state.saved) return false;
    if (!state.hasCopy) {
      return (
        localPinnedAppsTimestamp() > 0 ||
        !!bookmarks?.folders.length ||
        !!bookmarks?.bookmarks.length
      );
    }
    const keepsBookmarks = typeof window !== 'undefined' && !!window.appStorage;
    if (!bookmarks || !keepsBookmarks) {
      return pinsContent(pins) !== pinsContent(state.saved.pins);
    }
    return (
      launcherContent({ pins, data: bookmarks, order: view.order }) !==
      launcherContent(state.saved)
    );
  }, [address, bookmarks, pins, state, view.order]);
};
