import { describe, expect, it } from 'vitest';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import {
  applyLauncherDrop,
  bookmarkItemKey,
  buildLauncherItems,
  createFolderWithItem,
  EMPTY_LAUNCHER_VIEW,
  folderItemKey,
  isAppStartBookmark,
  isFolderItemKey,
  type LauncherArrangement,
  type LauncherChangeContext,
  type LauncherDrop,
  type LauncherItem,
  type LauncherView,
  launcherViewStorageKey,
  loadLauncherView,
  moveItemToFolder,
  parseLauncherView,
  removeFolderItem,
  removeItem,
  removeItemFromFolder,
  renameFolder,
  sameBookmarkLayout,
  saveLauncherView,
  setFolderOpen,
} from './launcherItems';
import type { LauncherPin } from './launcherPins';

const pin = (name: string, isMine = false): LauncherPin => ({
  key: `APP-${name}`,
  app: { name, service: 'APP' },
  isMine,
});

const privatePin = (name: string): LauncherPin => ({
  key: `private-APP-${name}-id`,
  app: {
    isPrivate: true,
    privateAppProperties: { name, service: 'APP', identifier: 'id' },
  },
  isMine: false,
});

const bookmark = (
  id: string,
  appName: string,
  extra: Partial<AppBookmark> = {}
): AppBookmark => ({
  id,
  name: appName,
  service: 'APP',
  appName,
  path: '',
  link: `qortal://APP/${appName}`,
  folderId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const folder = (id: string, name = id): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
});

const store = (
  folders: AppBookmarkFolder[] = [],
  bookmarks: AppBookmark[] = []
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt: 1 });

const view = (order: string[] = [], openFolders: string[] = []) => ({
  order,
  openFolders,
});

/** The tiles as text: `key` in the row, `folder:id[child, child]` for a folder. */
const layoutOf = (items: LauncherItem[]) =>
  items.map((item) =>
    item.type === 'folder'
      ? `${item.key}[${item.children.map((child) => child.key).join(', ')}]`
      : item.key
  );

const contextFor = (
  data: AppBookmarksForAddress | null,
  currentView: LauncherView = EMPTY_LAUNCHER_VIEW
): LauncherChangeContext => {
  let made = 0;
  return {
    data,
    view: currentView,
    newFolder: { id: 'new', name: 'New folder' },
    makeBookmark: (made_for) =>
      bookmark(`made${++made}`, String(made_for.app.name)),
    now: 100,
  };
};

/** The tiles as they are built again from what a change left behind. */
const rebuilt = (pins: LauncherPin[], arrangement: LauncherArrangement) => {
  const byKey = new Map(pins.map((entry) => [entry.key, entry]));
  const reordered = arrangement.pinOrder.flatMap((key) => {
    const found = byKey.get(key);
    return found ? [found] : [];
  });
  return layoutOf(
    buildLauncherItems(reordered, arrangement.data, arrangement.view)
  );
};

const A = pin('A');
const B = pin('B');
const C = pin('C');
const keyA = A.key;
const keyB = B.key;
const keyC = C.key;
const insert = (key: string, side: 'before' | 'after'): LauncherDrop => ({
  kind: 'insert',
  key,
  side,
});
const merge = (key: string): LauncherDrop => ({ kind: 'merge', key });
const append = (folderId: string | null): LauncherDrop => ({
  kind: 'append',
  folderId,
});

describe('isAppStartBookmark', () => {
  it('is true for a bookmark with no path and no identifier', () => {
    expect(isAppStartBookmark(bookmark('1', 'A'))).toBe(true);
    expect(isAppStartBookmark(bookmark('1', 'A', { path: '/' }))).toBe(true);
    expect(isAppStartBookmark(bookmark('1', 'A', { path: '?x=1' }))).toBe(true);
  });

  it('is false for a page inside the app, or a publish with an identifier', () => {
    expect(isAppStartBookmark(bookmark('1', 'A', { path: 'video/3' }))).toBe(
      false
    );
    expect(isAppStartBookmark(bookmark('1', 'A', { identifier: 'x' }))).toBe(
      false
    );
  });
});

describe('buildLauncherItems', () => {
  it('lists the pinned apps in the order of the pin list', () => {
    expect(layoutOf(buildLauncherItems([A, B, C], null, null))).toEqual([
      keyA,
      keyB,
      keyC,
    ]);
  });

  it('puts new folders and bookmarks after the pinned apps, folders first', () => {
    const data = store(
      [folder('f1')],
      [
        bookmark('b1', 'X', { path: 'page' }),
        bookmark('b2', 'Y', { folderId: 'f1' }),
      ]
    );
    expect(layoutOf(buildLauncherItems([A, B], data, null))).toEqual([
      keyA,
      keyB,
      'folder:f1[bookmark:b2]',
      'bookmark:b1',
    ]);
  });

  it('shows a pinned app in the folder its start page is bookmarked in', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'B', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A, B, C], data, null);
    expect(layoutOf(items)).toEqual([keyA, keyC, 'folder:f1[bookmark:b1]']);
    const [, , folderItem] = items;
    expect(folderItem.type === 'folder' && folderItem.children[0].pin).toBe(B);
  });

  it('shows only the pinned app when its start page is bookmarked outside a folder', () => {
    const data = store([], [bookmark('b1', 'B')]);
    expect(layoutOf(buildLauncherItems([A, B], data, null))).toEqual([
      keyA,
      keyB,
    ]);
  });

  it('keeps a bookmark of a page inside a pinned app as a bookmark', () => {
    const data = store([], [bookmark('b1', 'B', { path: 'video/3' })]);
    const items = buildLauncherItems([A, B], data, null);
    expect(layoutOf(items)).toEqual([keyA, keyB, 'bookmark:b1']);
    expect(items[2].type === 'bookmark' && items[2].pin).toBe(null);
  });

  it('matches the app of a bookmark whatever the case of its name', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'q-tube', { folderId: 'f1' })]
    );
    expect(layoutOf(buildLauncherItems([pin('Q-Tube')], data, null))).toEqual([
      'folder:f1[bookmark:b1]',
    ]);
  });

  it('never takes a private app for a bookmarked one', () => {
    const secret = privatePin('B');
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'B', { folderId: 'f1' })]
    );
    expect(layoutOf(buildLauncherItems([secret], data, null))).toEqual([
      secret.key,
      'folder:f1[bookmark:b1]',
    ]);
  });

  it('shows a bookmark in the row when its folder is gone', () => {
    const data = store([], [bookmark('b1', 'X', { folderId: 'gone' })]);
    expect(layoutOf(buildLauncherItems([A], data, null))).toEqual([
      keyA,
      'bookmark:b1',
    ]);
  });

  it('keeps folders and bookmarks behind the pinned app they were placed after', () => {
    const data = store([folder('f1'), folder('f2')], [bookmark('b1', 'X')]);
    const placed = view([
      'folder:f2',
      keyA,
      'bookmark:b1',
      'folder:f1',
      keyB,
      keyC,
    ]);
    expect(layoutOf(buildLauncherItems([A, B, C], data, placed))).toEqual([
      'folder:f2[]',
      keyA,
      'bookmark:b1',
      'folder:f1[]',
      keyB,
      keyC,
    ]);
    // The pin list was reordered somewhere else: they follow their app.
    expect(layoutOf(buildLauncherItems([C, B, A], data, placed))).toEqual([
      'folder:f2[]',
      keyC,
      keyB,
      keyA,
      'bookmark:b1',
      'folder:f1[]',
    ]);
    // Their app is no longer pinned: they move up to the one before it.
    expect(layoutOf(buildLauncherItems([B, C], data, placed))).toEqual([
      'folder:f2[]',
      'bookmark:b1',
      'folder:f1[]',
      keyB,
      keyC,
    ]);
  });

  it('marks the folders the launcher keeps open', () => {
    const data = store([folder('f1'), folder('f2')]);
    const items = buildLauncherItems([], data, view([], ['f2', 'gone']));
    expect(items.map((item) => item.type === 'folder' && item.isOpen)).toEqual([
      false,
      true,
    ]);
  });
});

describe('applyLauncherDrop', () => {
  it('moves an app along the row and leaves the bookmarks alone', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'X', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A, B, C], data, null);
    const result = applyLauncherDrop(
      items,
      keyC,
      insert(keyA, 'before'),
      contextFor(data)
    );
    expect(result?.pinOrder).toEqual([keyC, keyA, keyB]);
    expect(result?.view.order).toEqual([keyC, keyA, keyB, 'folder:f1']);
    expect(sameBookmarkLayout(result?.data, data)).toBe(true);
    expect(rebuilt([A, B, C], result!)).toEqual([
      keyC,
      keyA,
      keyB,
      'folder:f1[bookmark:b1]',
    ]);
  });

  it('returns null when the drop leaves everything where it is', () => {
    const items = buildLauncherItems([A, B, C], null, null);
    const context = contextFor(null);
    expect(applyLauncherDrop(items, keyB, insert(keyB, 'after'), context)).toBe(
      null
    );
    expect(applyLauncherDrop(items, keyB, insert(keyA, 'after'), context)).toBe(
      null
    );
    expect(
      applyLauncherDrop(items, keyB, insert(keyC, 'before'), context)
    ).toBe(null);
    expect(applyLauncherDrop(items, keyC, append(null), context)).toBe(null);
    expect(applyLauncherDrop(items, 'gone', append(null), context)).toBe(null);
  });

  it('makes a bookmark folder when one app is dropped onto another', () => {
    const items = buildLauncherItems([A, B, C], null, null);
    const result = applyLauncherDrop(
      items,
      keyC,
      merge(keyA),
      contextFor(null)
    );

    // The folder stands where the app it was dropped on stood.
    expect(rebuilt([A, B, C], result!)).toEqual([
      'folder:new[bookmark:made1, bookmark:made2]',
      keyB,
    ]);
    // Both apps stay pinned, next to each other, where the folder is.
    expect(result?.pinOrder).toEqual([keyA, keyC, keyB]);
    expect(result?.data.folders).toEqual([
      { id: 'new', name: 'New folder', createdAt: 100, updatedAt: 100 },
    ]);
    expect(
      result?.data.bookmarks.map((entry) => [entry.appName, entry.folderId])
    ).toEqual([
      ['A', 'new'],
      ['C', 'new'],
    ]);
    // A new folder shows open, ready for its name.
    expect(result?.view.openFolders).toEqual(['new']);
  });

  it('adds an app to the folder it is dropped onto', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'X', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A, B], data, null);
    const result = applyLauncherDrop(
      items,
      keyA,
      merge('folder:f1'),
      contextFor(data)
    );
    expect(rebuilt([A, B], result!)).toEqual([
      keyB,
      'folder:f1[bookmark:b1, bookmark:made1]',
    ]);
    expect(result?.pinOrder).toEqual([keyB, keyA]);
    expect(result?.data.bookmarks[1]).toMatchObject({
      id: 'made1',
      appName: 'A',
      folderId: 'f1',
      updatedAt: 100,
    });
  });

  it('uses the bookmark an app already has outside a folder', () => {
    const data = store([folder('f1')], [bookmark('own', 'A')]);
    const items = buildLauncherItems([A, B], data, null);
    const result = applyLauncherDrop(
      items,
      keyA,
      merge('folder:f1'),
      contextFor(data)
    );
    expect(result?.data.bookmarks).toEqual([
      { ...bookmark('own', 'A'), folderId: 'f1', updatedAt: 100 },
    ]);
    expect(rebuilt([A, B], result!)).toEqual([keyB, 'folder:f1[bookmark:own]']);
  });

  it('moves a bookmark into a folder, and makes a folder of an app and a bookmark', () => {
    const data = store([folder('f1')], [bookmark('b1', 'X', { path: 'page' })]);
    const items = buildLauncherItems([A], data, null);

    const moved = applyLauncherDrop(
      items,
      'bookmark:b1',
      merge('folder:f1'),
      contextFor(data)
    );
    expect(rebuilt([A], moved!)).toEqual([keyA, 'folder:f1[bookmark:b1]']);

    const ontoApp = applyLauncherDrop(
      items,
      'bookmark:b1',
      merge(keyA),
      contextFor(data)
    );
    expect(rebuilt([A], ontoApp!)).toEqual([
      'folder:new[bookmark:made1, bookmark:b1]',
      'folder:f1[]',
    ]);

    const ontoBookmark = applyLauncherDrop(
      items,
      keyA,
      merge('bookmark:b1'),
      contextFor(data)
    );
    expect(rebuilt([A], ontoBookmark!)).toEqual([
      'folder:f1[]',
      'folder:new[bookmark:b1, bookmark:made1]',
    ]);
  });

  it('takes a pinned app out of a folder as the app, without its bookmark', () => {
    const data = store(
      [folder('f1')],
      [
        bookmark('b1', 'B', { folderId: 'f1' }),
        bookmark('b2', 'X', { folderId: 'f1' }),
      ]
    );
    const items = buildLauncherItems([A, B], data, view([keyA, 'folder:f1']));
    const result = applyLauncherDrop(
      items,
      'bookmark:b1',
      insert(keyA, 'before'),
      contextFor(data)
    );
    expect(rebuilt([A, B], result!)).toEqual([
      keyB,
      keyA,
      'folder:f1[bookmark:b2]',
    ]);
    expect(result?.data.bookmarks.map((entry) => entry.id)).toEqual(['b2']);
    expect(result?.pinOrder).toEqual([keyB, keyA]);
  });

  it('takes any other bookmark out of a folder as a bookmark', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'X', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A], data, null);
    const result = applyLauncherDrop(
      items,
      'bookmark:b1',
      insert(keyA, 'before'),
      contextFor(data)
    );
    expect(rebuilt([A], result!)).toEqual(['bookmark:b1', keyA, 'folder:f1[]']);
    expect(result?.data.bookmarks).toEqual([
      { ...bookmark('b1', 'X'), folderId: null, updatedAt: 100 },
    ]);
    // The folder stays, empty: it is the account's bookmark folder.
    expect(result?.data.folders).toEqual([folder('f1')]);
  });

  it('reorders inside an open folder and between folders', () => {
    const data = store(
      [folder('f1'), folder('f2')],
      [
        bookmark('b1', 'X', { folderId: 'f1' }),
        bookmark('b2', 'B', { folderId: 'f1' }),
        bookmark('b3', 'Y', { folderId: 'f2' }),
      ]
    );
    const items = buildLauncherItems([A, B], data, null);

    const inside = applyLauncherDrop(
      items,
      'bookmark:b2',
      insert('bookmark:b1', 'before'),
      contextFor(data)
    );
    expect(rebuilt([A, B], inside!)).toEqual([
      keyA,
      'folder:f1[bookmark:b2, bookmark:b1]',
      'folder:f2[bookmark:b3]',
    ]);
    // The bookmarks menu lists them in the same order.
    expect(inside?.data.bookmarks.map((entry) => entry.id)).toEqual([
      'b2',
      'b1',
      'b3',
    ]);

    const across = applyLauncherDrop(
      items,
      'bookmark:b2',
      insert('bookmark:b3', 'after'),
      contextFor(data)
    );
    expect(rebuilt([A, B], across!)).toEqual([
      keyA,
      'folder:f1[bookmark:b1]',
      'folder:f2[bookmark:b3, bookmark:b2]',
    ]);
    expect(across?.pinOrder).toEqual([keyA, keyB]);

    const fromRow = applyLauncherDrop(
      items,
      keyA,
      insert('bookmark:b3', 'before'),
      contextFor(data)
    );
    expect(rebuilt([A, B], fromRow!)).toEqual([
      'folder:f1[bookmark:b1, bookmark:b2]',
      'folder:f2[bookmark:made1, bookmark:b3]',
    ]);
    expect(fromRow?.pinOrder).toEqual([keyB, keyA]);
  });

  it('drops into the free space of the row or of a folder', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'B', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A, B, C], data, null);

    const toFolder = applyLauncherDrop(
      items,
      keyA,
      append('f1'),
      contextFor(data)
    );
    expect(rebuilt([A, B, C], toFolder!)).toEqual([
      keyC,
      'folder:f1[bookmark:b1, bookmark:made1]',
    ]);

    const toRow = applyLauncherDrop(
      items,
      'bookmark:b1',
      append(null),
      contextFor(data)
    );
    expect(rebuilt([A, B, C], toRow!)).toEqual([
      keyA,
      keyC,
      'folder:f1[]',
      keyB,
    ]);
    expect(toRow?.data.bookmarks).toEqual([]);
  });

  it('moves a folder along the row, with its apps in the pin list', () => {
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'C', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A, B, C], data, null);
    const result = applyLauncherDrop(
      items,
      'folder:f1',
      insert(keyA, 'before'),
      contextFor(data)
    );
    expect(rebuilt([A, B, C], result!)).toEqual([
      'folder:f1[bookmark:b1]',
      keyA,
      keyB,
    ]);
    expect(result?.pinOrder).toEqual([keyC, keyA, keyB]);

    const toEnd = applyLauncherDrop(
      buildLauncherItems([A, B, C], data, result!.view),
      'folder:f1',
      append(null),
      contextFor(data, result!.view)
    );
    expect(toEnd?.view.order).toEqual([keyA, keyB, 'folder:f1']);
  });

  it('never puts a folder into a folder', () => {
    const data = store(
      [folder('f1'), folder('f2')],
      [bookmark('b1', 'X', { folderId: 'f2' })]
    );
    const items = buildLauncherItems([A], data, null);
    const context = contextFor(data);
    expect(
      applyLauncherDrop(items, 'folder:f1', merge('folder:f2'), context)
    ).toBe(null);
    expect(applyLauncherDrop(items, 'folder:f1', merge(keyA), context)).toBe(
      null
    );
    expect(applyLauncherDrop(items, 'folder:f1', append('f2'), context)).toBe(
      null
    );
    expect(
      applyLauncherDrop(
        items,
        'folder:f1',
        insert('bookmark:b1', 'after'),
        context
      )
    ).toBe(null);
  });

  it('keeps a private app in the row: it cannot be bookmarked', () => {
    const secret = privatePin('S');
    const data = store(
      [folder('f1')],
      [bookmark('b1', 'X', { folderId: 'f1' })]
    );
    const items = buildLauncherItems([A, secret], data, null);
    const context = contextFor(data);
    expect(
      applyLauncherDrop(items, secret.key, merge('folder:f1'), context)
    ).toBe(null);
    expect(applyLauncherDrop(items, secret.key, merge(keyA), context)).toBe(
      null
    );
    expect(applyLauncherDrop(items, keyA, merge(secret.key), context)).toBe(
      null
    );
    expect(applyLauncherDrop(items, secret.key, append('f1'), context)).toBe(
      null
    );
    expect(
      applyLauncherDrop(
        items,
        secret.key,
        insert('bookmark:b1', 'before'),
        context
      )
    ).toBe(null);
    // It still moves along the row.
    expect(
      applyLauncherDrop(items, secret.key, insert(keyA, 'before'), context)
        ?.pinOrder
    ).toEqual([secret.key, keyA]);
  });

  it('leaves alone the bookmarks the tiles do not show', () => {
    // A is pinned and bookmarked outside a folder: the tile is the pinned app.
    const data = store([], [bookmark('own', 'A'), bookmark('b1', 'X')]);
    const items = buildLauncherItems([A, B], data, null);
    const result = applyLauncherDrop(
      items,
      'bookmark:b1',
      insert(keyA, 'before'),
      contextFor(data)
    );
    expect(result?.data.bookmarks).toEqual([
      bookmark('b1', 'X'),
      bookmark('own', 'A'),
    ]);
  });
});

describe('the tile menu', () => {
  const data = store(
    [folder('f1'), folder('f2')],
    [
      bookmark('b1', 'B', { folderId: 'f1' }),
      bookmark('b2', 'X', { folderId: 'f1' }),
    ]
  );
  const pins = [A, B, C];
  const placed = view([keyA, 'folder:f1', keyC, 'folder:f2'], ['f1']);
  const items = buildLauncherItems(pins, data, placed);

  it('moves a tile to a folder', () => {
    const result = moveItemToFolder(
      items,
      keyC,
      'f2',
      contextFor(data, placed)
    );
    expect(rebuilt(pins, result!)).toEqual([
      keyA,
      'folder:f1[bookmark:b1, bookmark:b2]',
      'folder:f2[bookmark:made1]',
    ]);
    expect(
      moveItemToFolder(items, 'bookmark:b1', 'f1', contextFor(data, placed))
    ).toBe(null);
  });

  it('starts a folder with a tile, where the tile stands', () => {
    const fromRow = createFolderWithItem(items, keyA, contextFor(data, placed));
    expect(rebuilt(pins, fromRow!)).toEqual([
      'folder:new[bookmark:made1]',
      'folder:f1[bookmark:b1, bookmark:b2]',
      keyC,
      'folder:f2[]',
    ]);
    expect(fromRow?.view.openFolders).toEqual(['f1', 'new']);

    // Out of a folder, the new one comes right after it.
    const fromFolder = createFolderWithItem(
      items,
      'bookmark:b2',
      contextFor(data, placed)
    );
    expect(rebuilt(pins, fromFolder!)).toEqual([
      keyA,
      'folder:f1[bookmark:b1]',
      'folder:new[bookmark:b2]',
      keyC,
      'folder:f2[]',
    ]);
  });

  it('takes a tile out of its folder, into the row right after it', () => {
    const app = removeItemFromFolder(
      items,
      'bookmark:b1',
      contextFor(data, placed)
    );
    expect(rebuilt(pins, app!)).toEqual([
      keyA,
      'folder:f1[bookmark:b2]',
      keyB,
      keyC,
      'folder:f2[]',
    ]);
    const other = removeItemFromFolder(
      items,
      'bookmark:b2',
      contextFor(data, placed)
    );
    expect(rebuilt(pins, other!)).toEqual([
      keyA,
      'folder:f1[bookmark:b1]',
      'bookmark:b2',
      keyC,
      'folder:f2[]',
    ]);
    expect(removeItemFromFolder(items, keyA, contextFor(data, placed))).toBe(
      null
    );
  });

  it('removes a folder and leaves what was in it where the folder stood', () => {
    const result = removeFolderItem(items, 'f1', contextFor(data, placed));
    expect(rebuilt(pins, result!)).toEqual([
      keyA,
      keyB,
      'bookmark:b2',
      keyC,
      'folder:f2[]',
    ]);
    expect(result?.data.folders).toEqual([folder('f2')]);
    // The pinned app is itself again; the other bookmark is kept.
    expect(result?.data.bookmarks).toEqual([
      { ...bookmark('b2', 'X'), folderId: null, updatedAt: 100 },
    ]);
    expect(result?.view.openFolders).toEqual([]);
    expect(removeFolderItem(items, 'gone', contextFor(data, placed))).toBe(
      null
    );
  });

  it('unpins an app, in the row or in a folder', () => {
    const inRow = removeItem(items, keyA, contextFor(data, placed));
    expect(inRow?.pinOrder).toEqual([keyB, keyC]);
    expect(sameBookmarkLayout(inRow?.data, data)).toBe(true);

    // In a folder the app's bookmark goes with it.
    const inFolder = removeItem(items, 'bookmark:b1', contextFor(data, placed));
    expect(inFolder?.pinOrder).toEqual([keyA, keyC]);
    expect(inFolder?.data.bookmarks.map((entry) => entry.id)).toEqual(['b2']);
  });

  it('removes a bookmark', () => {
    const result = removeItem(items, 'bookmark:b2', contextFor(data, placed));
    expect(result?.data.bookmarks.map((entry) => entry.id)).toEqual(['b1']);
    expect(result?.pinOrder).toEqual([keyA, keyB, keyC]);
    expect(removeItem(items, 'gone', contextFor(data, placed))).toBe(null);
  });
});

describe('renameFolder', () => {
  const data = store([folder('f1', 'Old'), folder('f2', 'Other')]);

  it('renames the folder and says when', () => {
    expect(renameFolder(data, 'f1', '  New  ', 50).folders).toEqual([
      { ...folder('f1', 'New'), updatedAt: 50 },
      folder('f2', 'Other'),
    ]);
  });

  it('changes nothing for an empty name, the same name or a missing folder', () => {
    expect(renameFolder(data, 'f1', '   ', 50)).toBe(data);
    expect(renameFolder(data, 'f1', 'Old', 50)).toBe(data);
    expect(renameFolder(data, 'gone', 'New', 50)).toBe(data);
  });
});

describe('setFolderOpen', () => {
  it('opens and closes a folder, keeping the order of the tiles', () => {
    const start = view([keyA], ['f1']);
    expect(setFolderOpen(start, 'f2', true)).toEqual(
      view([keyA], ['f1', 'f2'])
    );
    expect(setFolderOpen(start, 'f1', true)).toEqual(view([keyA], ['f1']));
    expect(setFolderOpen(start, 'f1', false)).toEqual(view([keyA], []));
    expect(setFolderOpen(null, 'f1', true)).toEqual(view([], ['f1']));
  });
});

describe('sameBookmarkLayout', () => {
  it('compares the folders, the bookmarks and where they are', () => {
    const data = store([folder('f1')], [bookmark('b1', 'X')]);
    expect(sameBookmarkLayout(data, { ...data, updatedAt: 9 })).toBe(true);
    expect(sameBookmarkLayout(null, store())).toBe(true);
    expect(
      sameBookmarkLayout(
        data,
        store([folder('f1')], [bookmark('b1', 'X', { folderId: 'f1' })])
      )
    ).toBe(false);
    expect(sameBookmarkLayout(data, store([folder('f1', 'Renamed')]))).toBe(
      false
    );
  });
});

describe('item keys', () => {
  it('tells folders from the other tiles', () => {
    expect(isFolderItemKey(folderItemKey('f1'))).toBe(true);
    expect(isFolderItemKey(bookmarkItemKey('b1'))).toBe(false);
    expect(isFolderItemKey('APP-folder:x')).toBe(false);
  });
});

describe('the stored view', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      values,
    };
  };

  it('is kept per account', () => {
    const storage = memory();
    saveLauncherView('Qaddress1', view([keyA], ['f1']), storage);
    expect(loadLauncherView('Qaddress1', storage)).toEqual(
      view([keyA], ['f1'])
    );
    expect(loadLauncherView('Qaddress2', storage)).toEqual(EMPTY_LAUNCHER_VIEW);
    expect(launcherViewStorageKey('Qaddress1')).not.toBe(
      launcherViewStorageKey(null)
    );
  });

  it('reads only what has the right shape', () => {
    expect(parseLauncherView(null)).toEqual(EMPTY_LAUNCHER_VIEW);
    expect(parseLauncherView('text')).toEqual(EMPTY_LAUNCHER_VIEW);
    expect(
      parseLauncherView({ order: [keyA, 3, null], openFolders: 'f1' })
    ).toEqual(view([keyA], []));
  });

  it('starts empty when what is stored cannot be read', () => {
    const storage = memory();
    storage.values.set(launcherViewStorageKey('Qaddress1'), '{not json');
    expect(loadLauncherView('Qaddress1', storage)).toEqual(EMPTY_LAUNCHER_VIEW);
  });
});
