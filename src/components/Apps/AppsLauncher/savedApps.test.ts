import { describe, expect, it, vi } from 'vitest';

// The link parser lives in a chat component with a long import chain.
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import type {
  AppBookmark,
  AppBookmarkFolder,
} from '../AppBookmarks/bookmarkTypes';
import { buildBookmarkLink } from '../AppBookmarks/bookmarkStorage';
import { buildLauncherItems, removeFolderItem } from './launcherItems';
import { buildLauncherPins } from './launcherPins';
import {
  changesFromOlderFields,
  deriveLauncher,
  dropExpiredItems,
  dropOldRemovals,
  emptySavedApps,
  type KnownStores,
  launcherContent,
  laterEntry,
  type LauncherStores,
  MAX_REMOVALS,
  mergeSavedApps,
  newestTime,
  olderFieldsMatch,
  type PinEntry,
  type PinRecord,
  olderFieldsOf,
  readOlderFields,
  readSavedApps,
  recordStores,
  REMOVAL_KEPT_MS,
  type SavedApps,
  stableJson,
  toSavedAppsField,
} from './savedApps';

const app = (name: string, service = 'APP'): PinnedApp => ({ name, service });

const privateApp = (identifier: string): PinnedApp => ({
  isPrivate: true,
  isPreview: true,
  privateAppProperties: {
    name: 'Publisher',
    service: 'DOCUMENT',
    identifier,
    groupId: 12,
    appName: `Tool ${identifier}`,
  },
});

const folder = (id: string, name: string): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 10,
  updatedAt: 10,
});

const bookmark = (
  id: string,
  appName: string,
  path: string,
  folderId: string | null = null,
  name = `${appName} ${path}`.trim()
): AppBookmark => ({
  id,
  name,
  service: 'APP',
  appName,
  path,
  link: buildBookmarkLink({ service: 'APP', appName, path }),
  folderId,
  createdAt: 10,
  updatedAt: 10,
});

/** A bookmark of an app's start page, from a link that names an identifier. */
const startPage = (
  id: string,
  appName: string,
  identifier: string,
  folderId: string | null = null
): AppBookmark => ({
  id,
  name: appName,
  service: 'APP',
  appName,
  identifier,
  path: '',
  link: buildBookmarkLink({ service: 'APP', appName, identifier, path: '' }),
  folderId,
  createdAt: 10,
  updatedAt: 10,
});

const stores = (
  pins: PinnedApp[],
  folders: AppBookmarkFolder[] = [],
  bookmarks: AppBookmark[] = [],
  order: string[] = []
): LauncherStores => ({ pins, data: { folders, bookmarks }, order });

/** Saved apps made from a launcher, every record at `at`. */
const savedFrom = (launcher: KnownStores, at = 100) =>
  recordStores(emptySavedApps(), launcher, () => at).apps;

const shows = (apps: SavedApps) => launcherContent(deriveLauncher(apps));

const pinNames = (apps: SavedApps) =>
  deriveLauncher(apps).pins.map(
    (pin) => pin.name ?? pin.privateAppProperties?.identifier
  );

/** A launcher with a folder holding a page and a pinned app's start page. */
const launcherWithFolder = () =>
  stores(
    [app('Q-Mail'), app('Q-Tube'), app('Q-Share')],
    [folder('f1', 'Games')],
    [
      bookmark('b1', 'Q-Blog', 'blog/post-1', 'f1'),
      // Q-Tube was dragged into the folder: its start page is there.
      bookmark('b2', 'Q-Tube', '', 'f1', 'Q-Tube'),
      bookmark('b3', 'Q-Wiki', 'page'),
    ],
    ['APP-Q-Mail', 'folder:f1', 'APP-Q-Tube', 'APP-Q-Share', 'bookmark:b3']
  );

describe('the saved apps field', () => {
  it('comes back as it was saved', () => {
    const apps = savedFrom(launcherWithFolder());
    const written = JSON.parse(JSON.stringify(toSavedAppsField(apps)));
    const read = readSavedApps({ savedApps: written })!;
    expect(stableJson(toSavedAppsField(read))).toBe(
      stableJson(toSavedAppsField(apps))
    );
    expect(shows(read)).toBe(shows(apps));
  });

  it('is left alone in a format this Hub does not know', () => {
    const field = toSavedAppsField(savedFrom(stores([app('Q-Mail')])));
    expect(readSavedApps({ savedApps: { ...field, v: 2 } })).toBeNull();
    expect(readSavedApps({ sortablePinnedApps: [] })).toBeNull();
    expect(readSavedApps(null)).toBeNull();
  });

  it('skips damaged records without counting them as removed', () => {
    const read = readSavedApps({
      savedApps: {
        v: 1,
        pins: [
          { k: 'APP|q-mail|', app: app('Q-Mail'), pos: 'V', at: 5 },
          { app: {}, pos: 'W', at: 5 },
          { app: app('Q-Tube'), pos: 'X' },
          'damaged',
        ],
        folders: [{ id: '', name: 'x', pos: 'V', at: 5 }],
        bookmarks: [{ k: 'APP|q-blog||x', service: 'APP', at: 5 }],
      },
    })!;
    expect([...read.pins.keys()]).toEqual(['APP|q-mail|']);
    expect(read.folders.size).toBe(0);
    expect(read.bookmarks.size).toBe(0);
  });

  it('reads a default resource written any way as one record', () => {
    const read = readSavedApps({
      savedApps: {
        v: 1,
        pins: [],
        folders: [],
        bookmarks: ['default', 'null', ''].map((identifier, index) => ({
          k: 'ignored',
          id: `b${index}`,
          name: 'Post',
          service: 'APP',
          appName: 'Q-Blog',
          identifier,
          path: '/blog/',
          folder: null,
          pos: 'V',
          at: 5 + index,
        })),
      },
    })!;
    expect([...read.bookmarks.keys()]).toEqual(['APP|q-blog||blog']);
    // The latest change of the three stays.
    expect(read.bookmarks.get('APP|q-blog||blog')).toMatchObject({
      id: 'b2',
      at: 7,
    });
  });
});

describe('merging two devices', () => {
  it('keeps the later change, a removal at the same time, and is the same both ways', () => {
    const a: PinEntry = { k: 'x', app: app('Q-Mail'), pos: 'V', at: 5 };
    const b: PinEntry = { k: 'x', removed: true, at: 6 };
    expect(laterEntry<PinEntry>(a, b)).toBe(b);
    expect(laterEntry<PinEntry>(b, a)).toBe(b);
    const sameTime: PinEntry = { k: 'x', removed: true, at: 5 };
    expect(laterEntry<PinEntry>(a, sameTime)).toBe(sameTime);
    const other: PinEntry = { k: 'x', app: app('Q-Mail'), pos: 'W', at: 5 };
    expect(laterEntry<PinEntry>(a, other)).toBe(laterEntry<PinEntry>(other, a));
  });

  it('ends up with every change from both, whichever merges first', () => {
    const start = savedFrom(launcherWithFolder(), 100);
    const startStores = deriveLauncher(start);

    // Device A pins Q-Search and removes the folder's blog post.
    const a = recordStores(
      start,
      {
        ...startStores,
        pins: [...startStores.pins, app('Q-Search')],
        data: {
          ...startStores.data,
          bookmarks: startStores.data.bookmarks.filter(
            (entry) => entry.appName !== 'Q-Blog'
          ),
        },
      },
      () => 200
    ).apps;
    // Device B renames the folder and moves Q-Share to the front.
    const bStores = deriveLauncher(start);
    const b = recordStores(
      start,
      {
        pins: [
          app('Q-Share'),
          ...bStores.pins.filter((pin) => pin.name !== 'Q-Share'),
        ],
        data: {
          ...bStores.data,
          folders: bStores.data.folders.map((entry) => ({
            ...entry,
            name: 'Play',
          })),
        },
        order: [
          'APP-Q-Share',
          ...bStores.order.filter((key) => key !== 'APP-Q-Share'),
        ],
      },
      () => 210
    ).apps;

    const ab = mergeSavedApps(a, b);
    const ba = mergeSavedApps(b, a);
    expect(stableJson(toSavedAppsField(ab))).toBe(
      stableJson(toSavedAppsField(ba))
    );
    // Merging again changes nothing.
    expect(stableJson(toSavedAppsField(mergeSavedApps(ab, a)))).toBe(
      stableJson(toSavedAppsField(ab))
    );

    const merged = deriveLauncher(ab);
    expect(merged.pins.map((pin) => pin.name)).toEqual([
      'Q-Share',
      'Q-Mail',
      'Q-Tube',
      'Q-Search',
    ]);
    expect(merged.data.folders.map((entry) => entry.name)).toEqual(['Play']);
    expect(merged.data.bookmarks.map((entry) => entry.appName).sort()).toEqual([
      'Q-Tube',
      'Q-Wiki',
    ]);
  });

  it('lets a pin made after its removal come back', () => {
    const start = savedFrom(stores([app('Q-Mail'), app('Q-Tube')]), 100);
    const removed = recordStores(
      start,
      stores([app('Q-Mail')]),
      () => 200
    ).apps;
    const pinnedAgain = recordStores(
      removed,
      stores([app('Q-Mail'), app('Q-Tube')]),
      () => 300
    ).apps;
    expect(pinNames(mergeSavedApps(removed, pinnedAgain))).toEqual([
      'Q-Mail',
      'Q-Tube',
    ]);
    // An older change elsewhere doesn't bring back a later removal.
    const olderElsewhere = recordStores(
      start,
      stores([app('Q-Tube'), app('Q-Mail')]),
      () => 150
    ).apps;
    expect(pinNames(mergeSavedApps(removed, olderElsewhere))).toEqual([
      'Q-Mail',
    ]);
  });
});

describe('removals', () => {
  it(`are kept ${REMOVAL_KEPT_MS / 86400000} days, at most ${MAX_REMOVALS}`, () => {
    const apps = emptySavedApps();
    const now = REMOVAL_KEPT_MS * 3;
    apps.pins.set('old', {
      k: 'old',
      removed: true,
      at: now - REMOVAL_KEPT_MS - 1,
    });
    apps.pins.set('new', { k: 'new', removed: true, at: now - 1 });
    apps.pins.set('live', { k: 'live', app: app('Q-Mail'), pos: 'V', at: 1 });
    const kept = dropOldRemovals(apps, now);
    expect([...kept.pins.keys()].sort()).toEqual(['live', 'new']);

    const many = emptySavedApps();
    for (let index = 0; index < MAX_REMOVALS + 5; index += 1) {
      many.folders.set(`f${index}`, {
        id: `f${index}`,
        removed: true,
        at: now - index,
      });
    }
    const capped = dropOldRemovals(many, now);
    expect(capped.folders.size).toBe(MAX_REMOVALS);
    // The newest stay.
    expect(capped.folders.has('f0')).toBe(true);
    expect(capped.folders.has(`f${MAX_REMOVALS + 4}`)).toBe(false);
  });

  it('drops an item whose removal expired, but nothing changed or recent', () => {
    const now = REMOVAL_KEPT_MS * 3;
    const longAgo = now - REMOVAL_KEPT_MS - 10;
    const seen = savedFrom(stores([app('Q-Mail'), app('Q-Tube')]), longAgo);
    // The copy no longer has Q-Mail, and no record of its removal.
    const copy = emptySavedApps();
    copy.pins.set('APP|q-tube|', seen.pins.get('APP|q-tube|')!);
    const mine = mergeSavedApps(seen, emptySavedApps());
    expect(pinNames(dropExpiredItems(mine, copy, seen, now))).toEqual([
      'Q-Tube',
    ]);

    // Changed here since it was seen (moved last): it stays.
    const three = savedFrom(
      stores([app('Q-Mail'), app('Q-Tube'), app('Q-Share')]),
      longAgo
    );
    const changedHere = recordStores(
      three,
      stores([app('Q-Tube'), app('Q-Share'), app('Q-Mail')]),
      () => now
    ).apps;
    expect(changedHere.pins.get('APP|q-mail|')?.at).toBe(now);
    const threeCopy = emptySavedApps();
    threeCopy.pins.set('APP|q-tube|', three.pins.get('APP|q-tube|')!);
    threeCopy.pins.set('APP|q-share|', three.pins.get('APP|q-share|')!);
    expect(
      pinNames(dropExpiredItems(changedHere, threeCopy, three, now))
    ).toEqual(['Q-Tube', 'Q-Share', 'Q-Mail']);

    // Seen recently: a missing record is no removal.
    const recent = savedFrom(stores([app('Q-Mail'), app('Q-Tube')]), now - 5);
    const recentCopy = emptySavedApps();
    expect(
      pinNames(dropExpiredItems(recent, recentCopy, recent, now))
    ).toHaveLength(2);
  });
});

describe('what the launcher shows', () => {
  it('lists a folder’s apps where the folder stands, every pin once', () => {
    const derived = deriveLauncher(savedFrom(launcherWithFolder()));
    expect(derived.pins.map((pin) => pin.name)).toEqual([
      'Q-Mail',
      'Q-Tube',
      'Q-Share',
    ]);
    expect(derived.order).toEqual([
      'APP-Q-Mail',
      'folder:f1',
      'APP-Q-Share',
      'bookmark:b3',
    ]);
  });

  it('shows the same launcher after a round trip through the stores', () => {
    const launcher = launcherWithFolder();
    const apps = savedFrom(launcher);
    expect(shows(apps)).toBe(launcherContent(launcher));
    // Recording the stores it made changes nothing.
    expect(recordStores(apps, deriveLauncher(apps), () => 999).isChanged).toBe(
      false
    );
  });

  it('puts a bookmark whose folder is gone back in the row', () => {
    const apps = savedFrom(launcherWithFolder());
    apps.folders.set('f1', { id: 'f1', removed: true, at: 500 });
    const derived = deriveLauncher(apps);
    expect(derived.data.folders).toEqual([]);
    // The blog post is in the row. Q-Tube's start page is Q-Tube itself
    // again, which shows as the pinned app.
    expect(derived.order).toContain('bookmark:b1');
    expect(derived.order).toContain('APP-Q-Tube');
    expect(derived.order).not.toContain('bookmark:b2');
    expect(
      derived.data.bookmarks.every((entry) => entry.folderId === null)
    ).toBe(true);
    // Shown that way, it stays that way: nothing is recorded.
    expect(recordStores(apps, derived, () => 999).isChanged).toBe(false);
  });

  it('gives two pages that ended up with one id each an id of its own', () => {
    const apps = savedFrom(stores([], [], [bookmark('b1', 'Q-Blog', 'a')]));
    apps.bookmarks.set('APP|q-blog||b', {
      ...(apps.bookmarks.get('APP|q-blog||a') as object),
      k: 'APP|q-blog||b',
      path: 'b',
      pos: 'z',
      at: 200,
    } as never);
    const ids = deriveLauncher(apps).data.bookmarks.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
    // The later change keeps the id.
    expect(
      deriveLauncher(apps).data.bookmarks.find((entry) => entry.path === 'b')
        ?.id
    ).toBe('b1');
  });
});

describe('recording a change', () => {
  it('moves only the pin that moved, at the time it gets', () => {
    const start = savedFrom(
      stores([app('Q-Mail'), app('Q-Tube'), app('Q-Share')])
    );
    const result = recordStores(
      start,
      stores([app('Q-Tube'), app('Q-Mail'), app('Q-Share')]),
      () => 200
    );
    expect(result.isChanged).toBe(true);
    expect(result.changed.pins.size).toBe(1);
    expect(pinNames(result.apps)).toEqual(['Q-Tube', 'Q-Mail', 'Q-Share']);
    expect(newestTime(result.apps)).toBe(200);
  });

  it('records a renamed folder and a removed bookmark, nothing else', () => {
    const launcher = launcherWithFolder();
    const start = savedFrom(launcher);
    const result = recordStores(
      start,
      {
        ...launcher,
        data: {
          folders: [folder('f1', 'Play')],
          bookmarks: launcher.data.bookmarks.filter(
            (entry) => entry.id !== 'b3'
          ),
        },
      },
      () => 200
    );
    expect([...result.changed.folders.values()]).toEqual([
      expect.objectContaining({ id: 'f1', name: 'Play', at: 200 }),
    ]);
    expect([...result.changed.bookmarks.values()]).toEqual([
      { k: 'APP|q-wiki||page', removed: true, at: 200 },
    ]);
    expect(result.changed.pins.size).toBe(0);
  });

  it('records nothing for stores it does not know', () => {
    const start = savedFrom(launcherWithFolder());
    expect(
      recordStores(start, { pins: null, data: null, order: null }, () => 200)
        .isChanged
    ).toBe(false);
    // Unreadable bookmarks are no removal.
    const result = recordStores(
      start,
      { pins: deriveLauncher(start).pins, data: null, order: null },
      () => 200
    );
    expect(result.isChanged).toBe(false);
  });
});

describe('copies saved by Hubs and GO that do not know saved apps', () => {
  it('writes the older fields the way #374 reads them', () => {
    const apps = savedFrom(launcherWithFolder());
    const fields = olderFieldsOf(apps);
    expect(fields.sortablePinnedApps).toEqual([
      app('Q-Mail'),
      app('Q-Tube'),
      app('Q-Share'),
    ]);
    expect(fields.appBookmarks.folders).toEqual([
      expect.objectContaining({ id: 'f1', name: 'Games' }),
    ]);
    expect(olderFieldsMatch(apps, readOlderFields(fields))).toBe(true);
  });

  it("takes a 3.0.3 copy's unpin and new pin, keeping private apps and folders", () => {
    const launcher = launcherWithFolder();
    const base = savedFrom({
      ...launcher,
      pins: [...launcher.pins, privateApp('tool-1')],
    });
    // Hub 3.0.3 saves its list: Q-Share unpinned, Q-Search pinned, the
    // private app written as `{}`.
    const found = readOlderFields({
      sortablePinnedApps: [app('Q-Mail'), app('Q-Tube'), {}, app('Q-Search')],
    });
    expect(found.placeholders).toBe(true);
    const result = changesFromOlderFields(base, found, 500);
    expect(pinNames(result.apps)).toEqual([
      'Q-Mail',
      'Q-Tube',
      'tool-1',
      'Q-Search',
    ]);
    expect(deriveLauncher(result.apps).data).toEqual(deriveLauncher(base).data);
    expect(result.changed.folders.size).toBe(0);
    expect(result.changed.bookmarks.size).toBe(0);
    expect(result.changed.pins.get('APP|q-share|')).toEqual({
      k: 'APP|q-share|',
      removed: true,
      at: 500,
    });
  });

  it('times a change after the version that client saw', () => {
    const base = savedFrom(stores([app('Q-Mail'), app('Q-Tube')]), 900);
    const result = changesFromOlderFields(
      base,
      readOlderFields({ sortablePinnedApps: [app('Q-Mail')] }),
      500
    );
    // The copy's own time is earlier than the pin's, which it removed.
    expect(result.changed.pins.get('APP|q-tube|')?.at).toBe(901);
  });

  it("takes a GO copy's folder rename and bookmark removal", () => {
    const launcher = launcherWithFolder();
    const base = savedFrom(launcher);
    const go = olderFieldsOf(base);
    go.appBookmarks.folders = go.appBookmarks.folders.map((entry) => ({
      ...entry,
      name: 'Play',
    }));
    go.appBookmarks.bookmarks = go.appBookmarks.bookmarks.filter(
      (entry) => entry.appName !== 'Q-Wiki'
    );
    go.launcherOrder = go.launcherOrder.filter((key) => key !== 'bookmark:b3');
    const result = changesFromOlderFields(base, readOlderFields(go), 500);
    const derived = deriveLauncher(result.apps);
    expect(derived.data.folders.map((entry) => entry.name)).toEqual(['Play']);
    expect(derived.data.bookmarks.map((entry) => entry.appName)).not.toContain(
      'Q-Wiki'
    );
    expect(result.changed.pins.size).toBe(0);
  });

  it('notices older fields that no longer match the saved apps', () => {
    const apps = savedFrom(stores([app('Q-Mail'), app('Q-Tube')]));
    const fields = olderFieldsOf(apps);
    expect(
      olderFieldsMatch(
        apps,
        readOlderFields({ ...fields, sortablePinnedApps: [app('Q-Mail')] })
      )
    ).toBe(false);
    expect(
      olderFieldsMatch(
        apps,
        readOlderFields({ sortablePinnedApps: fields.sortablePinnedApps })
      )
    ).toBe(false);
  });
});

describe('a round trip through the launcher records nothing', () => {
  it('after two devices each pinned an app at the end of the row', () => {
    const start = savedFrom(stores([app('Q-Mail')]), 100);
    const a = recordStores(
      start,
      stores([app('Q-Mail'), app('Q-Blog')]),
      () => 200
    ).apps;
    const b = recordStores(
      start,
      stores([app('Q-Mail'), app('Q-Tube')]),
      () => 210
    ).apps;
    const merged = mergeSavedApps(a, b);
    // Both went to the same place.
    expect((merged.pins.get('APP|q-blog|') as PinRecord).pos).toBe(
      (merged.pins.get('APP|q-tube|') as PinRecord).pos
    );

    expect(
      recordStores(merged, deriveLauncher(merged), () => 999).isChanged
    ).toBe(false);
  });

  it('after a folder was removed on one device while a bookmark went into it on another', () => {
    const start = savedFrom(launcherWithFolder(), 100);
    const shown = deriveLauncher(start);

    // Device A removes the folder, as the launcher does: what was in it
    // goes to the row where the folder stood.
    const pins = buildLauncherPins(shown.pins, []);
    const items = buildLauncherItems(
      pins,
      { ...shown.data, updatedAt: 0 },
      { order: shown.order, openFolders: [] }
    );
    const removed = removeFolderItem(items, 'f1', {
      data: { ...shown.data, updatedAt: 0 },
      view: { order: shown.order, openFolders: [] },
      newFolder: { id: 'unused', name: 'unused' },
      makeBookmark: () => {
        throw new Error('not used');
      },
      now: 200,
    })!;
    const byKey = new Map(pins.map((pin) => [pin.key, pin.app]));
    const a = recordStores(
      start,
      {
        pins: removed.pinOrder.map((key) => byKey.get(key)!),
        data: removed.data,
        order: removed.view.order,
      },
      () => 200
    ).apps;

    // Device B adds a page to the folder, first in it.
    const b = recordStores(
      start,
      {
        ...shown,
        data: {
          ...shown.data,
          bookmarks: [
            bookmark('b4', 'Q-Docs', 'guide', 'f1'),
            ...shown.data.bookmarks,
          ],
        },
      },
      () => 210
    ).apps;

    const merged = mergeSavedApps(a, b);
    expect(deriveLauncher(merged).data.folders).toEqual([]);

    expect(
      recordStores(merged, deriveLauncher(merged), () => 999).isChanged
    ).toBe(false);
  });

  it("after one device edited a bookmark's link while another renamed it", () => {
    const start = savedFrom(
      stores([app('Q-Mail')], [], [bookmark('b1', 'Q-Blog', 'a')])
    );
    const shown = deriveLauncher(start);
    const [only] = shown.data.bookmarks;

    // Device A points the bookmark at another page; its id goes along.
    const a = recordStores(
      start,
      {
        ...shown,
        data: {
          ...shown.data,
          bookmarks: [
            {
              ...only,
              path: 'b',
              link: buildBookmarkLink({
                service: 'APP',
                appName: 'Q-Blog',
                path: 'b',
              }),
            },
          ],
        },
      },
      () => 200
    ).apps;
    // Device B renames it.
    const b = recordStores(
      start,
      {
        ...shown,
        data: { ...shown.data, bookmarks: [{ ...only, name: 'Renamed' }] },
      },
      () => 210
    ).apps;

    const merged = mergeSavedApps(a, b);
    expect(deriveLauncher(merged).data.bookmarks).toHaveLength(2);

    expect(
      recordStores(merged, deriveLauncher(merged), () => 999).isChanged
    ).toBe(false);
  });

  it("after a pinned app's start page was bookmarked from a link naming the default identifier", () => {
    for (const identifier of ['default', 'null']) {
      const launcher = stores(
        [app('Q-Mail'), app('Q-Blog')],
        [],
        [startPage('b1', 'Q-Blog', identifier)]
      );
      const recorded = recordStores(emptySavedApps(), launcher, () => 100);
      expect(recorded.isChanged).toBe(true);

      // The same launcher, recorded again: nothing changed.
      expect(recordStores(recorded.apps, launcher, () => 200).isChanged).toBe(
        false
      );
    }
  });
});
