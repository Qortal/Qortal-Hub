import { beforeEach, describe, expect, it, vi } from 'vitest';

// The link parser lives in a chat component with a long import chain.
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import { buildBookmarkLink } from '../AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import type { LauncherView } from './launcherItems';
import type { LauncherSyncMark } from './launcherQdn';
import { readSavedApps, toSavedAppsField } from './savedApps';
import {
  type FoundSettings,
  loadSavedAppsBase,
  loadSavedAppsReplica,
  markSavedAppsPublished,
  recordLocalChanges,
  revertSavedApps,
  saveSavedAppsReplica,
  savedAppsForSave,
  type SavedAppsStores,
  takeInSavedApps,
} from './savedAppsSync';

const ADDRESS = 'Qaccount';
const HOUR = 3_600_000;

const app = (name: string): PinnedApp => ({ name, service: 'APP' });

const privateApp = (identifier: string): PinnedApp => ({
  isPrivate: true,
  isPreview: true,
  privateAppProperties: {
    name: 'Publisher',
    service: 'DOCUMENT',
    identifier,
    groupId: 12,
    appName: 'Tool',
  },
});

const folder = (id: string, name: string, at = 10): AppBookmarkFolder => ({
  id,
  name,
  createdAt: at,
  updatedAt: at,
});

const bookmark = (
  id: string,
  appName: string,
  path: string,
  folderId: string | null = null,
  at = 10
): AppBookmark => ({
  id,
  name: `${appName} ${path}`,
  service: 'APP',
  appName,
  path,
  link: buildBookmarkLink({ service: 'APP', appName, path }),
  folderId,
  createdAt: at,
  updatedAt: at,
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

/** The clock every device reads, plus its own offset. */
let clock = 0;

/** QDN's copy of the account's settings. */
let qdn: FoundSettings | null = null;

const storageOf = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

/** A device with its own stores and clock, signed in to the account. */
const device = ({
  pins = [] as PinnedApp[],
  pinsTime = -1,
  bookmarks = {
    folders: [],
    bookmarks: [],
    updatedAt: 0,
  } as AppBookmarksForAddress | null,
  order = [] as string[],
  clockOffset = 0,
  keepsBookmarks = true,
} = {}) => {
  const now = () => clock + clockOffset;
  const storage = storageOf();
  const marks = new Map<string, LauncherSyncMark>();
  const state = {
    pins,
    pinsTime,
    bookmarks,
    view: { order, openFolders: [] } as LauncherView,
    current: true,
    /** Called while the bookmarks are read: for an account switch. */
    whileReading: () => {},
  };
  const stores: SavedAppsStores = {
    readPins: () =>
      state.current ? { pins: state.pins, time: state.pinsTime } : null,
    writePins: (_address, next) => {
      state.pins = next;
      state.pinsTime = now();
    },
    keepsBookmarks,
    readBookmarks: async () => {
      state.whileReading();
      return state.bookmarks;
    },
    writeBookmarks: async (_address, data) => {
      state.bookmarks = data;
    },
    readView: () => state.view,
    writeView: (_address, view) => {
      state.view = view;
    },
    readReplica: (address) => loadSavedAppsReplica(address, storage),
    writeReplica: (address, replica) =>
      saveSavedAppsReplica(address, replica, storage),
    readBase: (address) => loadSavedAppsBase(address, storage),
    writeBase: (address, base) => {
      storage.setItem(
        `ext_saved_apps_qdn:${address}`,
        JSON.stringify({
          updated: base.updated,
          hasCopy: base.hasCopy,
          savedApps: toSavedAppsField(base.apps),
        })
      );
    },
    legacy: {
      loadBookmarks: async () =>
        state.bookmarks ?? { folders: [], bookmarks: [], updatedAt: 0 },
      saveBookmarks: async (_address, data) => {
        state.bookmarks = { ...data, updatedAt: now() };
        return state.bookmarks;
      },
      loadView: () => state.view,
      setView: (_address, view) => {
        state.view = view;
      },
      loadMark: (address) => marks.get(address) ?? null,
      saveMark: (address, mark) => {
        marks.set(address, mark);
      },
      now,
    },
    isCurrent: () => state.current,
    now,
  };

  return {
    state,
    stores,
    storage,
    /** Signs in, or reads QDN again before a save. */
    read: () => takeInSavedApps(ADDRESS, qdn, stores),
    /** A change made here, recorded as the app does. */
    change: async (edit: (s: typeof state) => void) => {
      edit(state);
      await recordLocalChanges(ADDRESS, stores);
    },
    /** Reads QDN's copy if it changed, then publishes, as Save does. */
    save: async () => {
      const known = loadSavedAppsBase(ADDRESS, storage)?.updated ?? null;
      if (qdn && (known === null || qdn.updated > known)) {
        await takeInSavedApps(ADDRESS, qdn, stores);
      }
      const prepared = await savedAppsForSave(ADDRESS, stores);
      qdn = { settings: { ...prepared!.fields }, updated: now() };
      markSavedAppsPublished(ADDRESS, prepared!.apps, stores);
    },
    pinNames: () =>
      state.pins.map((pin) => pin.name ?? pin.privateAppProperties?.identifier),
    folderNames: () => state.bookmarks!.folders.map((entry) => entry.name),
    pages: () => state.bookmarks!.bookmarks.map((entry) => entry.path).sort(),
  };
};

const withFolder = () => ({
  pins: [app('Q-Mail'), app('Q-Tube'), app('Q-Share')],
  bookmarks: {
    folders: [folder('f1', 'Games')],
    bookmarks: [
      bookmark('b1', 'Q-Blog', 'blog/post-1', 'f1'),
      bookmark('b2', 'Q-Wiki', 'page'),
    ],
    updatedAt: 10,
  },
  order: [
    'APP-Q-Mail',
    'folder:f1',
    'APP-Q-Tube',
    'APP-Q-Share',
    'bookmark:b2',
  ],
});

beforeEach(() => {
  clock = 1_000 * HOUR;
  qdn = null;
});

describe('two devices', () => {
  it('end up with both sets of changes, whoever saves first', async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    clock += 1000;
    await a.save();
    clock += 1000;
    const b = device();
    await b.read();
    expect(b.pinNames()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Share']);

    // A pins Q-Search; B removes the wiki page and moves the folder first.
    clock += 1000;
    await a.change((s) => {
      s.pins = [...s.pins, app('Q-Search')];
    });
    await b.change((s) => {
      s.bookmarks = {
        ...s.bookmarks!,
        bookmarks: s.bookmarks!.bookmarks.filter((entry) => entry.id !== 'b2'),
      };
      s.view = {
        ...s.view,
        order: [
          'folder:f1',
          ...s.view.order.filter(
            (key) => key !== 'folder:f1' && key !== 'bookmark:b2'
          ),
        ],
      };
    });

    clock += 1000;
    await a.save();
    clock += 1000;
    await b.save();
    clock += 1000;
    await a.read();

    for (const each of [a, b]) {
      expect(each.pinNames()).toEqual([
        'Q-Mail',
        'Q-Tube',
        'Q-Share',
        'Q-Search',
      ]);
      expect(each.pages()).toEqual(['blog/post-1']);
      expect(each.state.view.order[0]).toBe('folder:f1');
    }
  });

  it('keeps an unsaved change here when a newer copy comes in', async () => {
    const a = device({ pins: [app('Q-Mail')], pinsTime: clock });
    await a.read();
    await a.save();
    const b = device();
    await b.read();

    clock += 1000;
    await b.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    clock += 1000;
    await a.change((s) => {
      s.pins = [...s.pins, app('Q-Share')];
    });
    await a.save();
    // B hasn't saved: its pin stays, and A's comes in. Both were added in
    // the same place, so they are in key order, the same on every device.
    await b.read();
    expect(b.pinNames()).toEqual(['Q-Mail', 'Q-Share', 'Q-Tube']);
    await b.save();
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Share', 'Q-Tube']);
  });

  it("keeps a pin made while QDN's copy is being taken in", async () => {
    const a = device({ pins: [app('Q-Mail')], pinsTime: clock });
    await a.read();
    await a.save();
    const b = device();
    await b.read();
    clock += 1000;
    await b.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    await b.save();

    // A pins Q-Share just as it starts to read B's copy.
    let pinned = false;
    a.state.whileReading = () => {
      if (pinned) return;
      pinned = true;
      a.state.pins = [...a.state.pins, app('Q-Share')];
    };
    clock += 1000;
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Share', 'Q-Tube']);
  });

  it('lets a change made after reading win on a PC whose clock is behind', async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    await a.save();
    // B's clock is an hour behind.
    const b = device({ clockOffset: -HOUR });
    await b.read();

    clock += 1000;
    await a.change((s) => {
      s.bookmarks = { ...s.bookmarks!, folders: [folder('f1', 'Play')] };
    });
    await a.save();
    clock += 1000;
    await b.read();
    expect(b.folderNames()).toEqual(['Play']);
    // B renames it again, after seeing A's name: by its own clock, before A
    // did.
    await b.change((s) => {
      s.bookmarks = { ...s.bookmarks!, folders: [folder('f1', 'Arcade')] };
    });
    // B saves later, when its publish is the newest copy on QDN (QDN takes
    // the latest by its time).
    clock += 2 * HOUR;
    await b.save();
    await a.read();
    expect(a.folderNames()).toEqual(['Arcade']);
  });

  it('goes back to the newest copy after Cancel, and saves it whole', async () => {
    const a = device({ pins: [app('Q-Mail')], pinsTime: clock });
    await a.read();
    await a.save();
    const b = device();
    await b.read();
    clock += 1000;
    await b.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    await b.save();

    // A pins Q-Share; its save reads B's copy, then is called off.
    clock += 1000;
    await a.change((s) => {
      s.pins = [...s.pins, app('Q-Share')];
    });
    await takeInSavedApps(ADDRESS, qdn, a.stores);
    expect(await revertSavedApps(ADDRESS, a.stores)).toBe('reverted');
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube']);

    await a.save();
    expect(
      (qdn!.settings as { sortablePinnedApps: PinnedApp[] }).sortablePinnedApps
    ).toEqual([app('Q-Mail'), app('Q-Tube')]);
  });

  it("doesn't read its own save again while QDN still shows the copy before it", async () => {
    const a = device({ pins: [app('Q-Mail')], pinsTime: clock });
    const before = {
      settings: { sortablePinnedApps: [app('Q-Mail')] },
      updated: clock - 10,
    };
    qdn = before;
    await a.read();
    clock += 1000;
    await a.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    await a.save();
    // QDN still answers with the copy from before.
    qdn = before;
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube']);
    expect(loadSavedAppsBase(ADDRESS, a.storage)?.apps.pins.size).toBe(2);
  });
});

describe('copies saved by Hubs and GO that do not know saved apps', () => {
  it("take a 3.0.3 save's pins, keep private apps and folders, and save it all again", async () => {
    const a = device({
      ...withFolder(),
      pins: [app('Q-Mail'), privateApp('tool-1'), app('Q-Tube')],
      pinsTime: clock,
    });
    await a.read();
    await a.save();

    // Hub 3.0.3: Q-Tube unpinned, Q-Search pinned, the private app as `{}`.
    clock += HOUR;
    qdn = {
      settings: { sortablePinnedApps: [app('Q-Mail'), {}, app('Q-Search')] },
      updated: clock,
    };
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'tool-1', 'Q-Search']);
    expect(a.folderNames()).toEqual(['Games']);
    expect(a.pages()).toEqual(['blog/post-1', 'page']);

    clock += 1000;
    await a.save();
    const saved = qdn!.settings as Record<string, unknown>;
    expect(readSavedApps(saved)).not.toBeNull();
    expect(saved.sortablePinnedApps).toEqual([
      app('Q-Mail'),
      privateApp('tool-1'),
      app('Q-Search'),
    ]);
  });

  it("take a GO save's folder rename and bookmark removal", async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    await a.save();
    const fields = qdn!.settings as {
      sortablePinnedApps: PinnedApp[];
      appBookmarks: { folders: AppBookmarkFolder[]; bookmarks: AppBookmark[] };
      launcherOrder: string[];
    };

    // GO writes the pins, appBookmarks and launcherOrder only.
    clock += HOUR;
    qdn = {
      settings: {
        sortablePinnedApps: fields.sortablePinnedApps,
        appBookmarks: {
          ...fields.appBookmarks,
          folders: [folder('f1', 'Play', clock)],
          bookmarks: fields.appBookmarks.bookmarks.filter(
            (entry) => entry.appName !== 'Q-Wiki'
          ),
        },
        launcherOrder: fields.launcherOrder.filter(
          (key) => key !== 'bookmark:b2'
        ),
      },
      updated: clock,
    };
    await a.read();
    expect(a.folderNames()).toEqual(['Play']);
    expect(a.pages()).toEqual(['blog/post-1']);
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Share']);
  });
});

describe('a first sign-in with saved apps', () => {
  it("takes QDN's pin list over an older one here", async () => {
    qdn = { settings: { sortablePinnedApps: [app('Q-Mail')] }, updated: clock };
    const a = device({ pins: [app('Q-Tube')], pinsTime: clock - HOUR });
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail']);
  });

  it('keeps a list emptied here after the copy was saved', async () => {
    qdn = {
      settings: { sortablePinnedApps: [app('Q-Mail')] },
      updated: clock - HOUR,
    };
    const a = device({ pins: [], pinsTime: clock });
    await a.read();
    expect(a.pinNames()).toEqual([]);
    await a.save();
    expect(
      (qdn.settings as { sortablePinnedApps: PinnedApp[] }).sortablePinnedApps
    ).toEqual([]);
  });

  it("takes in #374's folders when this device has none", async () => {
    const other = device({ ...withFolder(), pinsTime: clock });
    await other.read();
    await other.save();
    const fields = qdn!.settings as Record<string, unknown>;
    qdn = {
      settings: {
        sortablePinnedApps: fields.sortablePinnedApps,
        appBookmarks: fields.appBookmarks,
        launcherOrder: fields.launcherOrder,
      },
      updated: clock,
    };
    const a = device();
    await a.read();
    expect(a.folderNames()).toEqual(['Games']);
    expect(a.pages()).toEqual(['blog/post-1', 'page']);
  });

  it('applies a removal another device saved, over an older copy here', async () => {
    const other = device({
      pins: [app('Q-Mail'), app('Q-Tube')],
      pinsTime: clock - 2 * HOUR,
    });
    await other.read();
    clock += 1000;
    await other.change((s) => {
      s.pins = [app('Q-Mail')];
    });
    await other.save();

    // Still has Q-Tube from before, in a list older than the removal.
    const a = device({
      pins: [app('Q-Mail'), app('Q-Tube')],
      pinsTime: clock - 2 * HOUR,
    });
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail']);
  });

  it('applies a bookmark removal another device saved, though #374 kept it', async () => {
    const other = device({ ...withFolder(), pinsTime: clock });
    await other.read();
    await other.save();
    clock += 1000;
    await other.change((s) => {
      s.bookmarks = {
        ...s.bookmarks!,
        bookmarks: s.bookmarks!.bookmarks.filter((entry) => entry.id !== 'b2'),
      };
    });
    await other.save();

    // This device has the page from before, and #374's merge never removes.
    const a = device({ ...withFolder(), pinsTime: clock - HOUR });
    await a.read();
    expect(a.pages()).toEqual(['blog/post-1']);
  });

  it('waits while the bookmarks cannot be read, writing nothing', async () => {
    qdn = { settings: { sortablePinnedApps: [app('Q-Mail')] }, updated: clock };
    const a = device({
      pins: [app('Q-Tube')],
      bookmarks: null,
      pinsTime: clock + 1,
    });
    expect(await a.read()).toBeNull();
    expect(loadSavedAppsReplica(ADDRESS, a.storage)).toBeNull();
    expect(loadSavedAppsBase(ADDRESS, a.storage)).toBeNull();
  });

  it('works with pins alone on a device that keeps no bookmarks', async () => {
    const other = device({ ...withFolder(), pinsTime: clock });
    await other.read();
    await other.save();
    const a = device({ keepsBookmarks: false, bookmarks: null });
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Share']);
    // The folders it can't keep are left as they are on QDN.
    clock += 1000;
    await a.change((s) => {
      s.pins = [app('Q-Mail')];
    });
    await a.save();
    expect(readSavedApps(qdn!.settings)!.folders.get('f1')).toMatchObject({
      name: 'Games',
    });
  });
});

describe('what is never written over', () => {
  it('records no removal for bookmarks that cannot be read', async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    await a.change((s) => {
      s.bookmarks = null;
    });
    const replica = loadSavedAppsReplica(ADDRESS, a.storage)!;
    expect(replica.apps.bookmarks.size).toBe(2);
    expect(
      [...replica.apps.bookmarks.values()].every(
        (entry) => !('removed' in entry)
      )
    ).toBe(true);
  });

  it('writes nothing when another account signs in during a read', async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    await a.save();
    const replicaBefore = a.storage.items.get(`ext_saved_apps:${ADDRESS}`);
    clock += 1000;
    qdn = {
      settings: { sortablePinnedApps: [app('Q-Mail')] },
      updated: clock,
    };
    a.state.whileReading = () => {
      a.state.current = false;
    };
    expect(await a.read()).toBeNull();
    expect(a.storage.items.get(`ext_saved_apps:${ADDRESS}`)).toBe(
      replicaBefore
    );
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Share']);
  });

  it("doesn't stop when the storage is full", () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() =>
      saveSavedAppsReplica(
        ADDRESS,
        {
          seen: 1,
          apps: readSavedApps({
            savedApps: { v: 1, pins: [], folders: [], bookmarks: [] },
          })!,
        },
        full
      )
    ).not.toThrow();
  });
});

describe('two devices, in the harder cases', () => {
  it('keep a pin removed on one device after both pinned an app at the end', async () => {
    const a = device({ pins: [app('Q-Mail')], pinsTime: clock });
    await a.read();
    await a.save();
    const b = device();
    await b.read();

    // Both pin an app at the end of the row.
    clock += 1000;
    await a.change((s) => {
      s.pins = [...s.pins, app('Q-Blog')];
    });
    await b.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    await a.save();
    const withBlog = qdn;

    // A unpins Q-Blog again and saves.
    clock += 1000;
    await a.change((s) => {
      s.pins = s.pins.filter((pin) => pin.name !== 'Q-Blog');
    });
    await a.save();
    const withoutBlog = qdn;

    // B signs in while QDN still shows the copy before A's last save, and
    // the change the take-in made to its pins is recorded.
    clock += 1000;
    qdn = withBlog;
    await b.read();
    await b.change(() => {});

    // Then QDN shows A's last copy. B never touched Q-Blog.
    clock += 1000;
    qdn = withoutBlog;
    await b.read();
    expect(b.pinNames()).toEqual(['Q-Mail', 'Q-Tube']);
  });

  it('keep a bookmark removed on one device, made on another from a link naming the default identifier', async () => {
    const a = device({
      pins: [app('Q-Mail'), app('Q-Blog')],
      pinsTime: clock,
    });
    await a.read();
    await a.save();
    // A reads its copy back, as at its next sign-in.
    await a.read();

    // A bookmarks Q-Blog's start page from a link with ?identifier=default.
    clock += 1000;
    await a.change((s) => {
      s.bookmarks = {
        ...s.bookmarks!,
        bookmarks: [startPage('b1', 'Q-Blog', 'default')],
      };
    });
    await a.save();

    // B takes it in, removes the bookmark and saves.
    const b = device();
    await b.read();
    expect(b.state.bookmarks!.bookmarks).toHaveLength(1);
    clock += 1000;
    await b.change((s) => {
      s.bookmarks = { ...s.bookmarks!, bookmarks: [] };
    });
    await b.save();

    // A pins another app before it reads B's copy. It never touched the
    // bookmark again.
    clock += 1000;
    await a.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    await a.read();
    expect(a.state.bookmarks!.bookmarks).toEqual([]);
  });

  it('keep a folder renamed on one device when another account signs in while the other takes it in', async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    await a.save();
    const b = device();
    await b.read();

    clock += 1000;
    await a.change((s) => {
      s.bookmarks = { ...s.bookmarks!, folders: [folder('f1', 'Play')] };
    });
    await a.save();

    // B takes the rename in. Another account signs in while B's bookmarks
    // are read to be written.
    let reads = 0;
    b.state.whileReading = () => {
      reads += 1;
      if (reads === 2) b.state.current = false;
    };
    clock += 1000;
    await b.read();
    b.state.whileReading = () => {};

    // B's account signs in again later, and saves.
    b.state.current = true;
    clock += 1000;
    await b.read();
    await b.save();
    await a.read();
    expect(a.folderNames()).toEqual(['Play']);
  });

  it('keep a folder renamed on one device when the other could not read its bookmarks while taking it in', async () => {
    const a = device({ ...withFolder(), pinsTime: clock });
    await a.read();
    await a.save();
    const b = device();
    await b.read();

    clock += 1000;
    await a.change((s) => {
      s.bookmarks = { ...s.bookmarks!, folders: [folder('f1', 'Play')] };
    });
    await a.save();

    // B's bookmarks can't be read while it takes the rename in.
    const readBookmarks = b.stores.readBookmarks;
    let readable = false;
    b.stores.readBookmarks = async (address) =>
      readable ? readBookmarks(address) : null;
    clock += 1000;
    await b.read();

    // They can be read again; B's next change is recorded, and B saves.
    readable = true;
    clock += 1000;
    await b.change(() => {});
    await b.save();
    await a.read();
    expect(a.folderNames()).toEqual(['Play']);
  });

  it('keep a folder where it stands when a device that keeps no bookmarks moves a pin', async () => {
    const other = device({ ...withFolder(), pinsTime: clock });
    await other.read();
    await other.save();
    expect(other.state.view.order.slice(0, 2)).toEqual([
      'APP-Q-Mail',
      'folder:f1',
    ]);

    // A device without a bookmarks store shows the pins only, so moving
    // Q-Share before Q-Tube leaves the pins' keys as the row's order.
    const phone = device({ keepsBookmarks: false, bookmarks: null });
    await phone.read();
    clock += 1000;
    await phone.change((s) => {
      s.pins = [app('Q-Mail'), app('Q-Share'), app('Q-Tube')];
      s.view = {
        order: ['APP-Q-Mail', 'APP-Q-Share', 'APP-Q-Tube'],
        openFolders: [],
      };
    });
    await phone.save();

    await other.read();
    expect(other.pinNames()).toEqual(['Q-Mail', 'Q-Share', 'Q-Tube']);
    expect(other.state.view.order.slice(0, 2)).toEqual([
      'APP-Q-Mail',
      'folder:f1',
    ]);
  });

  it('keep a folder where it stands when a device that keeps no bookmarks signs in for the first time and saves', async () => {
    const other = device({ ...withFolder(), pinsTime: clock });
    await other.read();
    await other.save();

    // Nothing is changed on the phone: it signs in and saves.
    const phone = device({ keepsBookmarks: false, bookmarks: null });
    await phone.read();
    clock += 1000;
    await phone.save();

    await other.read();
    expect(other.state.view.order.slice(0, 2)).toEqual([
      'APP-Q-Mail',
      'folder:f1',
    ]);
  });

  it('keep a private app pinned on a device whose first copy was saved by Hub 3.0.3', async () => {
    // Hub 3.0.3 saved its list after this device's last change, with the
    // private app as `{}`.
    qdn = {
      settings: { sortablePinnedApps: [app('Q-Mail'), {}, app('Q-Tube')] },
      updated: clock,
    };
    const a = device({
      pins: [
        app('Q-Mail'),
        {
          isPrivate: true,
          isPreview: true,
          privateAppProperties: {
            name: 'Publisher',
            service: 'DOCUMENT',
            identifier: 'tool-1',
            groupId: 12,
            appName: 'Tool',
          },
        },
      ],
      pinsTime: clock - HOUR,
    });
    await a.read();
    expect(a.pinNames()).toContain('tool-1');
  });

  it('take no older copy a node answers with after a newer one was read', async () => {
    // The copy on QDN was saved by Hub 3.0.3.
    const older: FoundSettings = {
      settings: { sortablePinnedApps: [app('Q-Mail')] },
      updated: clock - HOUR,
    };
    qdn = older;
    const a = device({ pins: [app('Q-Mail')], pinsTime: clock - 2 * HOUR });
    await a.read();
    const b = device();
    await b.read();

    clock += 1000;
    await b.change((s) => {
      s.pins = [...s.pins, app('Q-Tube')];
    });
    await b.save();
    clock += 1000;
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube']);

    // A node that is behind answers A's next read with the copy before.
    clock += 1000;
    qdn = older;
    await a.read();
    expect(a.pinNames()).toEqual(['Q-Mail', 'Q-Tube']);
  });
});
