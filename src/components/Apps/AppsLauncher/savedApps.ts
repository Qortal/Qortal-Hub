import {
  getPinnedAppKey,
  isBrokenPinnedApp,
  type PinnedApp,
  removeBrokenPinnedApps,
  serializePinnedAppForQdn,
  serializePinnedAppsForQdn,
} from '../../../utils/pinnedAppsSettings';
import {
  buildBookmarkLink,
  normalizeBookmarkPath,
} from '../AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
} from '../AppBookmarks/bookmarkTypes';
import { resourceIdentifierKey } from '../resourceIdentifier';
import {
  bookmarkItemKey,
  buildLauncherItems,
  folderItemKey,
} from './launcherItems';
import { buildLauncherPins } from './launcherPins';
import {
  fromSavedBookmarks,
  readSavedLauncher,
  sameSavedLauncher,
  type SavedLauncher,
  toSavedBookmarks,
} from './launcherQdn';
import { bookmarkKeyOf, pinKeyOf } from './savedAppsKeys';
import {
  isPosition,
  positionBetween,
  repositionList,
} from './savedAppsPositions';

/**
 * The launcher's pinned apps, folders and bookmarks as the account saves them
 * on QDN, next to the pin list in its settings (`DOCUMENT_PRIVATE`
 * `ext_saved_settings`): the `savedApps` field. The design note is
 * docs/saved-apps.md.
 *
 * Every pin, folder and bookmark is a record with the time it last changed
 * (`at`) and where it stands (`pos`). A removed one stays as a removal
 * (`removed: true`) for a while, so other devices learn of it. Two devices'
 * records are merged one by one: the later change wins.
 *
 * The pin list (`sortablePinnedApps`) and #374's `appBookmarks` and
 * `launcherOrder` are filled from it on every save, for Hubs and GO
 * versions that don't know this field.
 */
export const SAVED_APPS_VERSION = 1;

/** How long a removal is kept, so every device sees it. */
export const REMOVAL_KEPT_MS = 180 * 24 * 60 * 60 * 1000;

/** The most removals kept per account; the oldest go first. */
export const MAX_REMOVALS = 1000;

type Removal = { removed: true; at: number };

export type PinRecord = { k: string; app: PinnedApp; pos: string; at: number };
export type FolderRecord = {
  id: string;
  name: string;
  pos: string;
  at: number;
};
export type BookmarkRecord = {
  k: string;
  id: string;
  /** The bookmark's own name. */
  name: string;
  service: string;
  /** The name of the app it opens. */
  appName: string;
  /** Only when it isn't the name's default resource. */
  identifier?: string;
  path: string;
  /** The folder it is in, or null for the row. */
  folder: string | null;
  pos: string;
  at: number;
};

export type PinEntry = PinRecord | ({ k: string } & Removal);
export type FolderEntry = FolderRecord | ({ id: string } & Removal);
export type BookmarkEntry = BookmarkRecord | ({ k: string } & Removal);
type Entry = PinEntry | FolderEntry | BookmarkEntry;

/** Saved apps in memory: each list by its records' keys. */
export type SavedApps = {
  pins: Map<string, PinEntry>;
  folders: Map<string, FolderEntry>;
  bookmarks: Map<string, BookmarkEntry>;
};

/** The field as it is saved. */
export type SavedAppsField = {
  v: number;
  pins: PinEntry[];
  folders: FolderEntry[];
  bookmarks: BookmarkEntry[];
};

export const isRemoved = (entry: unknown): entry is Removal =>
  !!entry && (entry as Removal).removed === true;

const live = <T extends Entry>(entry: T | undefined) =>
  entry && !isRemoved(entry) ? (entry as Exclude<T, { removed: true }>) : null;

export const emptySavedApps = (): SavedApps => ({
  pins: new Map(),
  folders: new Map(),
  bookmarks: new Map(),
});

const copyOf = (apps: SavedApps): SavedApps => ({
  pins: new Map(apps.pins),
  folders: new Map(apps.folders),
  bookmarks: new Map(apps.bookmarks),
});

/** JSON with the keys of every object in order, so equal values match. */
export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .filter((key) => entry[key] !== undefined)
            .map((key) => [key, entry[key]])
        )
      : entry
  );

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Damaged positions sort last. */
const sortPosition = (pos: string) => (isPosition(pos) ? pos : '~');

const byPosition =
  <T>(pos: (item: T) => string, tie: (item: T) => string) =>
  (a: T, b: T) =>
    compareText(sortPosition(pos(a)), sortPosition(pos(b))) ||
    compareText(tie(a), tie(b));

// --- Reading and writing the field -------------------------------------------

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isText = (value: unknown): value is string => typeof value === 'string';

const positionOf = (value: unknown) => (isPosition(value) ? value : '');

const readPin = (value: unknown): PinEntry | null => {
  const entry = value as Record<string, unknown> | null;
  if (!entry || typeof entry !== 'object' || !isTime(entry.at)) return null;
  if (entry.removed === true) {
    return isText(entry.k) && entry.k
      ? { k: entry.k, removed: true, at: entry.at }
      : null;
  }
  const app = entry.app as PinnedApp | null;
  if (!app || typeof app !== 'object' || isBrokenPinnedApp(app)) return null;
  const stored = serializePinnedAppForQdn(app);
  return {
    k: pinKeyOf(stored),
    app: stored,
    pos: positionOf(entry.pos),
    at: entry.at,
  };
};

const readFolder = (value: unknown): FolderEntry | null => {
  const entry = value as Record<string, unknown> | null;
  if (!entry || typeof entry !== 'object' || !isTime(entry.at)) return null;
  if (!isText(entry.id) || !entry.id) return null;
  if (entry.removed === true)
    return { id: entry.id, removed: true, at: entry.at };
  if (!isText(entry.name)) return null;
  return {
    id: entry.id,
    name: entry.name,
    pos: positionOf(entry.pos),
    at: entry.at,
  };
};

/** A bookmark's fields as they are kept, from what a store or QDN holds. */
const bookmarkFields = (entry: {
  service?: unknown;
  appName?: unknown;
  identifier?: unknown;
  path?: unknown;
}) => {
  const identifier = resourceIdentifierKey(entry.identifier);
  return {
    service: String(entry.service),
    appName: String(entry.appName),
    ...(identifier ? { identifier } : {}),
    path: normalizeBookmarkPath(isText(entry.path) ? entry.path : ''),
  };
};

const isBookmarkPlace = (entry: Record<string, unknown>) =>
  isText(entry.service) &&
  !!entry.service.trim() &&
  isText(entry.appName) &&
  !!entry.appName.trim();

const readBookmark = (value: unknown): BookmarkEntry | null => {
  const entry = value as Record<string, unknown> | null;
  if (!entry || typeof entry !== 'object' || !isTime(entry.at)) return null;
  if (entry.removed === true) {
    return isText(entry.k) && entry.k
      ? { k: entry.k, removed: true, at: entry.at }
      : null;
  }
  if (!isBookmarkPlace(entry) || !isText(entry.id) || !entry.id) return null;
  if (!isText(entry.name)) return null;
  const fields = bookmarkFields(entry);
  return {
    k: bookmarkKeyOf(fields),
    id: entry.id,
    name: entry.name,
    ...fields,
    folder: isText(entry.folder) && entry.folder ? entry.folder : null,
    pos: positionOf(entry.pos),
    at: entry.at,
  };
};

const identityOf = (entry: Entry) =>
  'id' in entry && !('k' in entry) ? entry.id : (entry as { k: string }).k;

/**
 * Of two records of one item, the one that stays: the later change; at the
 * same time a removal, then the one whose JSON sorts higher, so every device
 * chooses the same.
 */
export const laterEntry = <T extends Entry>(a: T, b: T): T => {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (isRemoved(a) !== isRemoved(b)) return isRemoved(a) ? a : b;
  return stableJson(a) >= stableJson(b) ? a : b;
};

const addEntry = <T extends Entry>(map: Map<string, T>, entry: T | null) => {
  if (!entry) return;
  const key = identityOf(entry);
  const mine = map.get(key);
  map.set(key, mine ? laterEntry(mine, entry) : entry);
};

/**
 * The saved apps in an account's settings, or null when there are none or
 * they are in a format this Hub doesn't know. A record without the right
 * shape is left out, which never counts as removing it.
 */
export const readSavedApps = (settings: unknown): SavedApps | null => {
  const field = (settings as { savedApps?: unknown } | null)?.savedApps as
    | Partial<SavedAppsField>
    | undefined;
  if (!field || typeof field !== 'object') return null;
  if (field.v !== SAVED_APPS_VERSION) return null;
  if (
    !Array.isArray(field.pins) ||
    !Array.isArray(field.folders) ||
    !Array.isArray(field.bookmarks)
  ) {
    return null;
  }
  const apps = emptySavedApps();
  for (const value of field.pins) addEntry(apps.pins, readPin(value));
  for (const value of field.folders) addEntry(apps.folders, readFolder(value));
  for (const value of field.bookmarks) {
    addEntry(apps.bookmarks, readBookmark(value));
  }
  return apps;
};

const sortedEntries = <T extends Entry>(map: Map<string, T>) =>
  [...map.values()].sort((a, b) => compareText(identityOf(a), identityOf(b)));

const writtenEntry = (entry: Entry) => {
  if (isRemoved(entry)) {
    const { at } = entry;
    return 'k' in entry
      ? { k: (entry as { k: string }).k, removed: true, at }
      : { id: (entry as { id: string }).id, removed: true, at };
  }
  return entry;
};

/** The field as it is saved. */
export const toSavedAppsField = (apps: SavedApps): SavedAppsField => ({
  v: SAVED_APPS_VERSION,
  pins: sortedEntries(apps.pins).map(writtenEntry) as PinEntry[],
  folders: sortedEntries(apps.folders).map(writtenEntry) as FolderEntry[],
  bookmarks: sortedEntries(apps.bookmarks).map(writtenEntry) as BookmarkEntry[],
});

/** The latest change time among the records, or 0. */
export const newestTime = (apps: SavedApps): number => {
  let newest = 0;
  for (const map of [apps.pins, apps.folders, apps.bookmarks]) {
    for (const entry of (map as Map<string, Entry>).values()) {
      newest = Math.max(newest, entry.at);
    }
  }
  return newest;
};

// --- Merging -----------------------------------------------------------------

const mergeMaps = <T extends Entry>(a: Map<string, T>, b: Map<string, T>) => {
  const merged = new Map(a);
  for (const entry of b.values()) addEntry(merged, entry);
  return merged;
};

/**
 * Two devices' saved apps, record by record. Whatever order devices see each
 * other's changes in, they end up with the same.
 */
export const mergeSavedApps = (a: SavedApps, b: SavedApps): SavedApps => ({
  pins: mergeMaps(a.pins, b.pins),
  folders: mergeMaps(a.folders, b.folders),
  bookmarks: mergeMaps(a.bookmarks, b.bookmarks),
});

/**
 * Removals older than `REMOVAL_KEPT_MS` go, and beyond `MAX_REMOVALS` the
 * oldest go too.
 */
export const dropOldRemovals = (apps: SavedApps, now: number): SavedApps => {
  const removals: { map: Map<string, Entry>; key: string; at: number }[] = [];
  for (const map of [apps.pins, apps.folders, apps.bookmarks]) {
    for (const [key, entry] of map as Map<string, Entry>) {
      if (isRemoved(entry)) {
        removals.push({ map: map as Map<string, Entry>, key, at: entry.at });
      }
    }
  }
  const kept = new Set(
    removals
      .filter((removal) => removal.at >= now - REMOVAL_KEPT_MS)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_REMOVALS)
  );
  if (kept.size === removals.length) return apps;
  const next = copyOf(apps);
  const nextMaps = new Map<Map<string, Entry>, Map<string, Entry>>([
    [apps.pins as Map<string, Entry>, next.pins as Map<string, Entry>],
    [apps.folders as Map<string, Entry>, next.folders as Map<string, Entry>],
    [
      apps.bookmarks as Map<string, Entry>,
      next.bookmarks as Map<string, Entry>,
    ],
  ]);
  for (const removal of removals) {
    if (!kept.has(removal)) nextMaps.get(removal.map)?.delete(removal.key);
  }
  return next;
};

/**
 * Items this device once saw on QDN that are now gone from a copy, with no
 * record left: their removal can only have expired if they hadn't changed
 * since long enough ago. Those go here too, unless changed here since; any
 * other missing item stays (a damaged record is no removal).
 */
export const dropExpiredItems = (
  apps: SavedApps,
  copy: SavedApps,
  seenBefore: SavedApps,
  now: number
): SavedApps => {
  let next: SavedApps | null = null;
  const check = (kind: keyof SavedApps) => {
    const mine = apps[kind] as Map<string, Entry>;
    const theirs = copy[kind] as Map<string, Entry>;
    const seen = seenBefore[kind] as Map<string, Entry>;
    for (const [key, entry] of mine) {
      if (isRemoved(entry) || theirs.has(key)) continue;
      const before = seen.get(key);
      if (!before || isRemoved(before)) continue;
      if (before.at >= now - REMOVAL_KEPT_MS) continue;
      if (entry.at > before.at) continue;
      next = next ?? copyOf(apps);
      (next[kind] as Map<string, Entry>).delete(key);
    }
  };
  check('pins');
  check('folders');
  check('bookmarks');
  return next ?? apps;
};

// --- What the launcher shows -------------------------------------------------

/** The launcher's stores: the pin list, the bookmarks, the row's order. */
export type LauncherStores = {
  pins: PinnedApp[];
  data: { folders: AppBookmarkFolder[]; bookmarks: AppBookmark[] };
  order: string[];
};

const shortHash = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

/**
 * A bookmark id for every live bookmark. Two pages that came out with the
 * same id (one device edited a link while another renamed it) keep it for
 * the later one; the other gets one made from its page.
 */
const bookmarkIds = (records: BookmarkRecord[]) => {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const ordered = [...records].sort(
    (a, b) => b.at - a.at || compareText(a.k, b.k)
  );
  for (const record of ordered) {
    let id = record.id;
    if (used.has(id)) id = `${record.id}~${shortHash(record.k)}`;
    while (used.has(id)) id = `${id}~`;
    used.add(id);
    ids.set(record.k, id);
  }
  return ids;
};

const livePins = (apps: SavedApps) =>
  [...apps.pins.values()]
    .map((entry) => live(entry))
    .filter((entry): entry is PinRecord => !!entry);

const liveFolders = (apps: SavedApps) =>
  [...apps.folders.values()]
    .map((entry) => live(entry))
    .filter((entry): entry is FolderRecord => !!entry);

const liveBookmarks = (apps: SavedApps) =>
  [...apps.bookmarks.values()]
    .map((entry) => live(entry))
    .filter((entry): entry is BookmarkRecord => !!entry);

/**
 * The launcher's stores as the saved apps make them: the pin list in launcher
 * order (a folder's apps where the folder stands), the bookmarks and folders,
 * and the row's order. A bookmark whose folder is gone shows in the row,
 * where its position puts it.
 */
export const deriveLauncher = (apps: SavedApps): LauncherStores => {
  const pins = livePins(apps).sort(
    byPosition<PinRecord>(
      (pin) => pin.pos,
      (pin) => pin.k
    )
  );
  const folders = liveFolders(apps).sort(
    byPosition<FolderRecord>(
      (folder) => folder.pos,
      (folder) => folder.id
    )
  );
  const folderIds = new Set(folders.map((folder) => folder.id));
  const bookmarks = liveBookmarks(apps);
  const ids = bookmarkIds(bookmarks);
  const byPlace = byPosition<BookmarkRecord>(
    (bookmark) => bookmark.pos,
    (bookmark) => bookmark.k
  );
  const inRow = bookmarks
    .filter((bookmark) => !bookmark.folder || !folderIds.has(bookmark.folder))
    .sort(byPlace);
  const inFolders = folders.flatMap((folder) =>
    bookmarks.filter((bookmark) => bookmark.folder === folder.id).sort(byPlace)
  );

  const toBookmark = (record: BookmarkRecord): AppBookmark => ({
    id: ids.get(record.k)!,
    name: record.name,
    service: record.service,
    appName: record.appName,
    ...(record.identifier ? { identifier: record.identifier } : {}),
    path: record.path,
    link: buildBookmarkLink(record),
    folderId:
      record.folder && folderIds.has(record.folder) ? record.folder : null,
    createdAt: record.at,
    updatedAt: record.at,
  });
  const data = {
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      createdAt: folder.at,
      updatedAt: folder.at,
    })),
    bookmarks: [...inRow, ...inFolders].map(toBookmark),
  };

  type Placed = { pos: string; tie: string; key: string };
  const row: Placed[] = [
    ...pins.map((pin) => ({
      pos: pin.pos,
      tie: `p:${pin.k}`,
      key: getPinnedAppKey(pin.app),
    })),
    ...folders.map((folder) => ({
      pos: folder.pos,
      tie: `f:${folder.id}`,
      key: folderItemKey(folder.id),
    })),
    ...inRow.map((bookmark) => ({
      pos: bookmark.pos,
      tie: `b:${bookmark.k}`,
      key: bookmarkItemKey(ids.get(bookmark.k)!),
    })),
  ].sort(
    byPosition<Placed>(
      (item) => item.pos,
      (item) => item.tie
    )
  );
  const order = row.map((item) => item.key);

  const pinApps = pins.map((pin) => pin.app);
  const items = buildLauncherItems(
    buildLauncherPins(pinApps, []),
    { ...data, updatedAt: 0 },
    { order, openFolders: [] }
  );
  const byLauncherKey = new Map(
    pinApps.map((app) => [getPinnedAppKey(app), app])
  );
  const flat: PinnedApp[] = [];
  const listed = new Set<string>();
  const list = (key: string) => {
    const app = byLauncherKey.get(key);
    if (!app || listed.has(key)) return;
    listed.add(key);
    flat.push(app);
  };
  for (const item of items) {
    if (item.type === 'app') list(item.key);
    if (item.type === 'folder') {
      for (const child of item.children) if (child.pin) list(child.pin.key);
    }
  }
  for (const app of pinApps) list(getPinnedAppKey(app));

  return { pins: flat, data, order: items.map((item) => item.key) };
};

// --- The fields older Hubs and GO read ----------------------------------------

/** The fields Hubs and GO versions before `savedApps` read. */
export type OlderFields = {
  sortablePinnedApps: PinnedApp[];
  appBookmarks: ReturnType<typeof toSavedBookmarks>;
  launcherOrder: string[];
};

export const olderFieldsOf = (apps: SavedApps): OlderFields => {
  const derived = deriveLauncher(apps);
  return {
    sortablePinnedApps: serializePinnedAppsForQdn(derived.pins),
    appBookmarks: toSavedBookmarks({ ...derived.data, updatedAt: 0 }),
    launcherOrder: derived.order,
  };
};

/** What those fields hold in a copy found on QDN. */
export type FoundOlderFields = {
  /** The pin list, or null when there is none. */
  pins: PinnedApp[] | null;
  /**
   * Whether the list has entries that say nothing, as Hub 3.0.3 writes for a
   * private app (`{}`): it can't say which private apps it kept.
   */
  placeholders: boolean;
  /** The bookmarks, folders and order (#374's fields), or null. */
  launcher: SavedLauncher | null;
};

export const readOlderFields = (settings: unknown): FoundOlderFields => {
  const list = (settings as { sortablePinnedApps?: unknown } | null)
    ?.sortablePinnedApps;
  const pins = Array.isArray(list) ? (list as PinnedApp[]) : null;
  return {
    pins: pins
      ? removeBrokenPinnedApps(pins).map(serializePinnedAppForQdn)
      : null,
    placeholders: !!pins?.some(
      (entry) =>
        !!entry &&
        typeof entry === 'object' &&
        !entry.isPrivate &&
        isBrokenPinnedApp(entry)
    ),
    launcher: readSavedLauncher(settings),
  };
};

/** Whether a copy's older fields are what its saved apps make. */
export const olderFieldsMatch = (apps: SavedApps, found: FoundOlderFields) => {
  const ours = olderFieldsOf(apps);
  return (
    !!found.pins &&
    !found.placeholders &&
    stableJson(found.pins) === stableJson(ours.sortablePinnedApps) &&
    sameSavedLauncher(found.launcher, readSavedLauncher(ours))
  );
};

// --- Recording what changed --------------------------------------------------

/** The launcher's stores, as far as they are known: null for unknown. */
export type KnownStores = {
  pins: PinnedApp[] | null;
  data: { folders: AppBookmarkFolder[]; bookmarks: AppBookmark[] } | null;
  order: string[] | null;
};

type BookmarkContent = Omit<BookmarkRecord, 'k' | 'pos' | 'at'> & {
  time: number;
};

/** What the launcher shows, keyed the way saved apps are. */
type Shape = {
  pins: Map<string, { app: PinnedApp; json: string }>;
  folders: Map<string, { name: string; time: number }>;
  bookmarks: Map<string, BookmarkContent>;
  /** The tiles of the row: `p:` pins, `f:` folders, `b:` bookmarks. */
  rows: string[];
  /** Each folder's bookmarks, in order. */
  children: Map<string, string[]>;
};

const shapeOf = (stores: LauncherStores): Shape => {
  const pins = new Map<string, { app: PinnedApp; json: string }>();
  const pinKeyByLauncherKey = new Map<string, string>();
  const pinList: PinnedApp[] = [];
  for (const app of removeBrokenPinnedApps(stores.pins)) {
    const stored = serializePinnedAppForQdn(app);
    const key = pinKeyOf(stored);
    if (pins.has(key)) continue;
    pins.set(key, { app: stored, json: stableJson(stored) });
    pinKeyByLauncherKey.set(getPinnedAppKey(app), key);
    pinList.push(app);
  }

  const folders = new Map<string, { name: string; time: number }>();
  const folderList: AppBookmarkFolder[] = [];
  for (const folder of stores.data.folders) {
    if (!folder || !isText(folder.id) || !folder.id) continue;
    if (!isText(folder.name) || folders.has(folder.id)) continue;
    folders.set(folder.id, {
      name: folder.name,
      time: isTime(folder.updatedAt) ? folder.updatedAt : 0,
    });
    folderList.push(folder);
  }

  const bookmarks = new Map<string, BookmarkContent>();
  const keyById = new Map<string, string>();
  const bookmarkList: AppBookmark[] = [];
  for (const bookmark of stores.data.bookmarks) {
    const entry = bookmark as unknown as Record<string, unknown>;
    if (!bookmark || !isBookmarkPlace(entry) || !isText(bookmark.id)) continue;
    const fields = bookmarkFields(bookmark);
    const key = bookmarkKeyOf(fields);
    if (bookmarks.has(key) || keyById.has(bookmark.id)) continue;
    const folder =
      bookmark.folderId && folders.has(bookmark.folderId)
        ? bookmark.folderId
        : null;
    const name = isText(bookmark.name) ? bookmark.name : '';
    bookmarks.set(key, {
      id: bookmark.id,
      name,
      ...fields,
      folder,
      time: isTime(bookmark.updatedAt) ? bookmark.updatedAt : 0,
    });
    keyById.set(bookmark.id, key);
    // As saved apps keep it, so a start page named by 'default' or 'null' is
    // one here too.
    bookmarkList.push({
      id: bookmark.id,
      name,
      ...fields,
      link: buildBookmarkLink(fields),
      folderId: folder,
      createdAt: 0,
      updatedAt: 0,
    });
  }

  const items = buildLauncherItems(
    buildLauncherPins(pinList, []),
    { folders: folderList, bookmarks: bookmarkList, updatedAt: 0 },
    { order: stores.order, openFolders: [] }
  );
  const identityOfItem = (item: (typeof items)[number]) => {
    if (item.type === 'app') return `p:${pinKeyByLauncherKey.get(item.key)}`;
    if (item.type === 'folder') return `f:${item.folder.id}`;
    return `b:${keyById.get(item.bookmark.id)}`;
  };
  const children = new Map<string, string[]>();
  for (const item of items) {
    if (item.type !== 'folder') continue;
    children.set(
      item.folder.id,
      item.children.map((child) => `b:${keyById.get(child.bookmark.id)}`)
    );
  }
  return {
    pins,
    folders,
    bookmarks,
    rows: items.map(identityOfItem),
    children,
  };
};

/** What a change is, for the time it gets. */
export type Change = {
  kind: 'pin' | 'folder' | 'bookmark';
  previous: Entry | undefined;
  removed: boolean;
  /** When the store says the item last changed, if it says. */
  itemTime: number;
};

/** Whether a bookmark shows the same: its id as shown, not as recorded. */
const sameBookmarkContent = (
  shown: BookmarkContent,
  content: BookmarkContent
) =>
  shown.id === content.id &&
  shown.name === content.name &&
  shown.service === content.service &&
  shown.appName === content.appName &&
  (shown.identifier ?? '') === (content.identifier ?? '') &&
  shown.path === content.path &&
  shown.folder === content.folder;

/**
 * Brings the saved apps in line with the launcher's stores: what was added,
 * changed, moved or removed there becomes a record with the time `timeFor`
 * gives it. Stores that aren't known (null) are taken as they are now. Items
 * that kept their order keep their position.
 */
export const recordStores = (
  current: SavedApps,
  stores: KnownStores,
  timeFor: (change: Change) => number
): { apps: SavedApps; changed: SavedApps; isChanged: boolean } => {
  const derived = deriveLauncher(current);
  const was = shapeOf(derived);
  const want = shapeOf({
    pins: stores.pins ?? derived.pins,
    data: stores.data ?? derived.data,
    order: stores.order ?? derived.order,
  });
  const next = copyOf(current);
  const changed = emptySavedApps();
  const put = <T extends Entry>(
    kind: keyof SavedApps,
    key: string,
    entry: T
  ) => {
    (next[kind] as Map<string, Entry>).set(key, entry);
    (changed[kind] as Map<string, Entry>).set(key, entry);
  };

  // Where things stand: in the row, and in each folder.
  const wasInRow = new Set(was.rows);
  const pos = (identity: string): string | null => {
    const key = identity.slice(2);
    const entry =
      identity[0] === 'p'
        ? current.pins.get(key)
        : identity[0] === 'f'
          ? current.folders.get(key)
          : current.bookmarks.get(key);
    const found = live(entry as Entry | undefined) as { pos: string } | null;
    return found ? found.pos : null;
  };
  const moved = repositionList(want.rows, (identity) =>
    wasInRow.has(identity) ? pos(identity) : null
  );
  for (const [folderId, list] of want.children) {
    const before = new Set(was.children.get(folderId) ?? []);
    for (const [identity, position] of repositionList(list, (item) =>
      before.has(item) ? pos(item) : null
    )) {
      moved.set(identity, position);
    }
  }

  // New items the tiles don't show go last in their list.
  const lastOf = new Map<string, string | null>();
  const listOf = (folder: string | null) => folder ?? '';
  const lastPosition = (folder: string | null) => {
    const list = listOf(folder);
    if (!lastOf.has(list)) {
      const identities = folder ? (want.children.get(folder) ?? []) : want.rows;
      let last: string | null = null;
      for (const identity of identities) {
        const position = moved.get(identity) ?? pos(identity);
        if (isPosition(position) && (!last || position > last)) last = position;
      }
      lastOf.set(list, last);
    }
    const position = positionBetween(lastOf.get(list) ?? null, null);
    lastOf.set(list, position);
    return position;
  };

  for (const [key, pin] of want.pins) {
    const previous = current.pins.get(key);
    const record = live(previous) as PinRecord | null;
    const position = moved.get(`p:${key}`);
    if (record && !position && stableJson(record.app) === pin.json) continue;
    put('pins', key, {
      k: key,
      app: pin.app,
      pos: position ?? record?.pos ?? lastPosition(null),
      at: timeFor({ kind: 'pin', previous, removed: false, itemTime: 0 }),
    });
  }
  for (const key of was.pins.keys()) {
    if (want.pins.has(key)) continue;
    const previous = current.pins.get(key);
    put('pins', key, {
      k: key,
      removed: true,
      at: timeFor({ kind: 'pin', previous, removed: true, itemTime: 0 }),
    });
  }

  for (const [id, folder] of want.folders) {
    const previous = current.folders.get(id);
    const record = live(previous) as FolderRecord | null;
    const position = moved.get(`f:${id}`);
    if (record && !position && record.name === folder.name) continue;
    put('folders', id, {
      id,
      name: folder.name,
      pos: position ?? record?.pos ?? lastPosition(null),
      at: timeFor({
        kind: 'folder',
        previous,
        removed: false,
        itemTime: folder.time,
      }),
    });
  }
  for (const id of was.folders.keys()) {
    if (want.folders.has(id)) continue;
    const previous = current.folders.get(id);
    put('folders', id, {
      id,
      removed: true,
      at: timeFor({ kind: 'folder', previous, removed: true, itemTime: 0 }),
    });
  }

  for (const [key, content] of want.bookmarks) {
    const previous = current.bookmarks.get(key);
    const record = live(previous) as BookmarkRecord | null;
    const shown = was.bookmarks.get(key);
    const position = moved.get(`b:${key}`);
    const sameFolder = !!shown && shown.folder === content.folder;
    if (record && shown && !position && sameBookmarkContent(shown, content)) {
      continue;
    }
    const { time, ...fields } = content;
    put('bookmarks', key, {
      k: key,
      ...fields,
      pos:
        position ??
        (record && sameFolder ? record.pos : lastPosition(content.folder)),
      at: timeFor({
        kind: 'bookmark',
        previous,
        removed: false,
        itemTime: time,
      }),
    });
  }
  for (const key of was.bookmarks.keys()) {
    if (want.bookmarks.has(key)) continue;
    const previous = current.bookmarks.get(key);
    put('bookmarks', key, {
      k: key,
      removed: true,
      at: timeFor({ kind: 'bookmark', previous, removed: true, itemTime: 0 }),
    });
  }

  const isChanged =
    changed.pins.size > 0 ||
    changed.folders.size > 0 ||
    changed.bookmarks.size > 0;
  return { apps: isChanged ? next : current, changed, isChanged };
};

// --- Copies saved by Hubs and GO versions that don't know this field ---------

/**
 * The private pins of `before`, each after the pin it followed there: kept
 * when a list says nothing about private apps.
 */
export const withPrivatePinsKept = (pins: PinnedApp[], before: PinnedApp[]) => {
  const result = [...pins];
  const at = (app: PinnedApp) =>
    result.findIndex((entry) => pinKeyOf(entry) === pinKeyOf(app));
  before.forEach((app, index) => {
    if (!app.isPrivate || at(app) !== -1) return;
    let after = -1;
    for (let back = index - 1; back >= 0 && after === -1; back -= 1) {
      after = at(before[back]);
    }
    result.splice(after + 1, 0, app);
  });
  return result;
};

/**
 * What a copy's older fields hold, as the launcher's stores: what's missing
 * is taken as `base` has it.
 */
export const storesFromOlderFields = (
  found: FoundOlderFields,
  base: SavedApps
): KnownStores => {
  const pins =
    found.pins && found.placeholders
      ? withPrivatePinsKept(found.pins, deriveLauncher(base).pins)
      : found.pins;
  return {
    pins,
    data: found.launcher
      ? fromSavedBookmarks(found.launcher.bookmarks, 0)
      : null,
    order: found.launcher ? found.launcher.order : null,
  };
};

/**
 * The changes in a copy saved by a Hub or GO that doesn't know `savedApps`:
 * the differences between its older fields and what `base` makes of them.
 * They are timed at the copy's time, and after the version of each item that
 * client saw, so they win over what they changed.
 */
export const changesFromOlderFields = (
  base: SavedApps,
  found: FoundOlderFields,
  updated: number
) =>
  recordStores(base, storesFromOlderFields(found, base), ({ previous }) =>
    Math.max(updated, (previous?.at ?? 0) + 1)
  );

// --- Comparing with what is saved --------------------------------------------

/**
 * What the launcher shows, to compare two states: the pins, folders,
 * bookmarks and where each stands. Times and positions don't count.
 */
export const launcherContent = (stores: LauncherStores): string => {
  const shape = shapeOf(stores);
  const sorted = <T>(entries: [string, T][]) =>
    entries.sort(([a], [b]) => compareText(a, b));
  return stableJson({
    pins: sorted([...shape.pins].map(([key, pin]) => [key, pin.json])),
    folders: sorted(
      [...shape.folders].map(([id, folder]) => [id, folder.name])
    ),
    bookmarks: sorted(
      [...shape.bookmarks].map(([key, { time: _time, ...rest }]) => [
        key,
        stableJson(rest),
      ])
    ),
    rows: shape.rows,
    children: sorted([...shape.children]),
  });
};

/** The pin list alone, to compare two states. */
export const pinsContent = (pins: PinnedApp[] | null | undefined) =>
  stableJson(serializePinnedAppsForQdn(pins));
