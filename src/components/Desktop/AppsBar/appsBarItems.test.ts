import { describe, expect, it, vi } from 'vitest';

// The address parser lives in a chat component with a long import chain; the
// bar only needs bookmark keys, which do not go through it.
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../../Apps/AppBookmarks/bookmarkTypes';
import {
  bookmarkItemKey,
  folderItemKey,
  type LauncherView,
} from '../../Apps/AppsLauncher/launcherItems';
import {
  bookmarkItemId,
  buildAppsBarItems,
  folderItemId,
  pinItemId,
  type AppsBarFolderItem,
  type AppsBarItem,
} from './appsBarItems';

const PRIVATE_LABEL = 'Private app';

const folder = (id: string, name: string): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
});

const bookmark = (
  id: string,
  name: string,
  {
    appName = name,
    folderId = null,
    identifier,
    path = '',
    service = 'APP',
  }: {
    appName?: string;
    folderId?: string | null;
    identifier?: string;
    path?: string;
    service?: string;
  } = {}
): AppBookmark => ({
  id,
  name,
  service,
  appName,
  identifier,
  path,
  link: `qortal://${service}/${appName}${path ? `/${path}` : ''}`,
  folderId,
  createdAt: 1,
  updatedAt: 1,
});

const store = (
  folders: AppBookmarkFolder[],
  bookmarks: AppBookmark[]
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt: 1 });

const build = (
  pins: PinnedApp[],
  data: AppBookmarksForAddress | null,
  names: Record<string, string> = {},
  view: LauncherView | null = null
) => buildAppsBarItems(pins, data, view, names, PRIVATE_LABEL);

const labels = (items: AppsBarItem[]) => items.map((item) => item.label);

const folderOf = (items: AppsBarItem[], name: string) =>
  items.find(
    (item): item is AppsBarFolderItem =>
      item.type === 'folder' && item.ownName === name
  );

describe('what the apps bar shows', () => {
  it('has nothing to show without pins or bookmarks', () => {
    expect(build([], null)).toEqual([]);
    expect(build([], store([], []))).toEqual([]);
  });

  it('puts the pinned apps first, then the bookmarks', () => {
    const items = build(
      [{ service: 'APP', name: 'Q-Tube' }],
      store([], [bookmark('b1', 'Playlists', { appName: 'Q-Tube', path: 'p' })])
    );

    expect(labels(items)).toEqual(['Q-Tube', 'Playlists']);
    expect(items[0].type).toBe('pin');
    expect(items[1].type).toBe('bookmark');
  });

  it('keeps the pin list’s own order', () => {
    const items = build(
      [
        { service: 'APP', name: 'Q-Mail' },
        { service: 'APP', name: 'Q-Tube' },
      ],
      null
    );

    expect(labels(items)).toEqual(['Q-Mail', 'Q-Tube']);
  });

  it('shows a pinned app once, not again as its own bookmark', () => {
    const items = build(
      [{ service: 'APP', name: 'Q-Tube' }],
      store([], [bookmark('b1', 'Q-Tube', { appName: 'Q-Tube' })])
    );

    expect(labels(items)).toEqual(['Q-Tube']);
  });

  it('still shows a bookmark of a page inside a pinned app', () => {
    const items = build(
      [{ service: 'APP', name: 'Q-Tube' }],
      store(
        [],
        [bookmark('b1', 'Playlists', { appName: 'Q-Tube', path: 'playlists' })]
      )
    );

    expect(labels(items)).toEqual(['Q-Tube', 'Playlists']);
  });

  it('shows a bookmark of an app that is not pinned', () => {
    const items = build(
      [],
      store([], [bookmark('b1', 'Q-Tube', { appName: 'Q-Tube' })])
    );

    expect(labels(items)).toEqual(['Q-Tube']);
  });

  it('shows the folders, then the bookmarks outside them', () => {
    const items = build(
      [],
      store(
        [folder('f1', 'Social'), folder('f2', 'Travel')],
        [
          bookmark('b1', 'In Travel', { appName: 'Q-Trip', folderId: 'f2' }),
          bookmark('b2', 'In Social', { appName: 'Q-Chat', folderId: 'f1' }),
          bookmark('b3', 'Loose', { appName: 'Q-Mail' }),
        ]
      )
    );

    expect(labels(items)).toEqual(['Social', 'Travel', 'Loose']);
    expect(items.map((item) => item.type)).toEqual([
      'folder',
      'folder',
      'bookmark',
    ]);
  });

  it('keeps a folder’s bookmarks inside it, in the order it has them', () => {
    const items = build(
      [],
      store(
        [folder('f1', 'Social')],
        [
          bookmark('b1', 'Torq', { appName: 'Q-Torq', folderId: 'f1' }),
          bookmark('b2', 'Quitter', { appName: 'Q-Quitter', folderId: 'f1' }),
          bookmark('b3', 'Loose', { appName: 'Q-Mail' }),
        ]
      )
    );

    expect(labels(folderOf(items, 'Social')?.items ?? [])).toEqual([
      'Torq',
      'Quitter',
    ]);
  });

  it('shows a folder with nothing in it', () => {
    const items = build([], store([folder('f1', 'Empty')], []));

    expect(labels(items)).toEqual(['Empty']);
    expect(folderOf(items, 'Empty')?.items).toEqual([]);
  });

  it('says which folder a bookmark is in', () => {
    const items = build(
      [],
      store(
        [folder('f1', 'Social')],
        [
          bookmark('b1', 'In Social', { appName: 'Q-Chat', folderId: 'f1' }),
          bookmark('b2', 'Loose', { appName: 'Q-Mail' }),
        ]
      )
    );

    expect(folderOf(items, 'Social')?.items[0].folderName).toBe('Social');
    expect(
      items.map((item) => item.type === 'bookmark' && item.folderName)
    ).toEqual([false, null]);
  });

  it('shows a pinned app put into a folder in that folder only', () => {
    const items = build(
      [{ service: 'APP', name: 'Q-Tube' }],
      store(
        [folder('f1', 'Media')],
        [bookmark('b1', 'Q-Tube', { appName: 'Q-Tube', folderId: 'f1' })]
      )
    );

    // It moved into the folder on the launcher, so it is there here too,
    // and not a second time beside it.
    expect(labels(items)).toEqual(['Media']);
    expect(labels(folderOf(items, 'Media')?.items ?? [])).toEqual(['Q-Tube']);
  });

  it('keeps a pinned app that is in no folder', () => {
    const items = build(
      [
        { service: 'APP', name: 'Q-Tube' },
        { service: 'APP', name: 'Q-Mail' },
      ],
      store(
        [folder('f1', 'Media')],
        [bookmark('b1', 'Q-Tube', { appName: 'Q-Tube', folderId: 'f1' })]
      )
    );

    expect(labels(items)).toEqual(['Q-Mail', 'Media']);
  });

  it('shows a page bookmarked both in a folder and outside it once', () => {
    const items = build(
      [],
      store(
        [folder('f1', 'Social')],
        [
          bookmark('b1', 'Torq', { appName: 'Q-Torq', folderId: 'f1' }),
          bookmark('b2', 'Torq again', { appName: 'Q-Torq' }),
        ]
      )
    );

    expect(labels(items)).toEqual(['Social']);
    expect(labels(folderOf(items, 'Social')?.items ?? [])).toEqual(['Torq']);
  });

  it('shows a bookmark of a folder that is gone', () => {
    const items = build(
      [],
      store([], [bookmark('b1', 'Orphan', { folderId: 'gone' })])
    );

    expect(labels(items)).toEqual(['Orphan']);
  });

  it('leaves out a pin that carries nothing to open', () => {
    const items = build(
      [{}, { isPrivate: true }, { service: 'APP', name: 'Q-Tube' }],
      null
    );

    expect(labels(items)).toEqual(['Q-Tube']);
  });

  it('calls a private app by its own name', () => {
    const items = build(
      [
        {
          isPrivate: true,
          privateAppProperties: {
            name: 'Alice',
            service: 'DOCUMENT_PRIVATE',
            identifier: 'notes',
            appName: 'My notes',
          },
        },
      ],
      null
    );

    expect(labels(items)).toEqual(['My notes']);
  });

  it('falls back to what a private app is, with no name of its own', () => {
    const items = build(
      [
        {
          isPrivate: true,
          privateAppProperties: {
            name: 'Alice',
            service: 'DOCUMENT_PRIVATE',
            identifier: 'notes',
          },
        },
      ],
      null
    );

    expect(labels(items)).toEqual([PRIVATE_LABEL]);
  });

  it('shows the same app pinned twice only once', () => {
    const items = build(
      [
        { service: 'APP', name: 'Q-Tube' },
        { service: 'APP', name: 'Q-Tube' },
      ],
      null
    );

    expect(items).toHaveLength(1);
  });
});

describe('the order the launcher was left in', () => {
  const twoPins: PinnedApp[] = [
    { service: 'APP', name: 'Q-Mail' },
    { service: 'APP', name: 'Q-Tube' },
  ];
  const view = (order: string[]): LauncherView => ({ order, openFolders: [] });

  it('puts the folders first when that is where they stand', () => {
    const items = build(
      twoPins,
      store(
        [folder('f1', 'Social')],
        [bookmark('b1', 'Torq', { appName: 'Q-Torq', folderId: 'f1' })]
      ),
      {},
      view([folderItemKey('f1'), 'APP-Q-Mail', 'APP-Q-Tube'])
    );

    expect(labels(items)).toEqual(['Social', 'Q-Mail', 'Q-Tube']);
  });

  it('keeps a bookmark behind the app it was put behind', () => {
    const items = build(
      twoPins,
      store([], [bookmark('b1', 'Torq', { appName: 'Q-Torq' })]),
      {},
      view(['APP-Q-Mail', bookmarkItemKey('b1'), 'APP-Q-Tube'])
    );

    expect(labels(items)).toEqual(['Q-Mail', 'Torq', 'Q-Tube']);
  });

  it('puts a folder the arrangement does not know at the end', () => {
    const items = build(
      twoPins,
      store([folder('f1', 'Social')], []),
      {},
      view(['APP-Q-Mail', 'APP-Q-Tube'])
    );

    expect(labels(items)).toEqual(['Q-Mail', 'Q-Tube', 'Social']);
  });
});

describe('the names the user gives', () => {
  it('shows a given name in place of the item’s own', () => {
    const pin = { service: 'APP', name: 'Q-Tube' };
    const items = build([pin], null, { [pinItemId(pin)]: 'TV' });

    expect(items[0].label).toBe('TV');
    expect(items[0].ownName).toBe('Q-Tube');
    expect(items[0].customName).toBe('TV');
  });

  it('shows no name at all when the given one is empty', () => {
    const pin = { service: 'APP', name: 'Q-Tube' };
    const items = build([pin], null, { [pinItemId(pin)]: '' });

    expect(items[0].label).toBe('');
    expect(items[0].customName).toBe('');
  });

  it('leaves an item with no given name its own', () => {
    const items = build([{ service: 'APP', name: 'Q-Tube' }], null, {
      'pin:APP-Q-Mail': 'Mail',
    });

    expect(items[0].label).toBe('Q-Tube');
    expect(items[0].customName).toBeNull();
  });

  it('names a bookmark by where it goes, not by the bookmark it is', () => {
    const page = bookmark('b1', 'Playlists', {
      appName: 'Q-Tube',
      path: 'playlists',
    });
    const items = build([], store([], [page]), {
      [bookmarkItemId(page)]: 'Lists',
    });

    expect(items[0].label).toBe('Lists');
  });

  it('names a folder as the user asked', () => {
    const social = folder('f1', 'Social');
    const items = build([], store([social], []), {
      [folderItemId(social)]: 'Chat',
    });

    expect(items[0].label).toBe('Chat');
    expect(items[0].ownName).toBe('Social');
  });

  it('names a bookmark inside a folder as well', () => {
    const page = bookmark('b1', 'Torq', { appName: 'Q-Torq', folderId: 'f1' });
    const items = build([], store([folder('f1', 'Social')], [page]), {
      [bookmarkItemId(page)]: 'Feed',
    });

    expect(labels(folderOf(items, 'Social')?.items ?? [])).toEqual(['Feed']);
  });

  it('keeps a name through a bookmark being made again', () => {
    const page = bookmark('b1', 'Playlists', {
      appName: 'Q-Tube',
      path: 'playlists',
    });
    const madeAgain = { ...page, id: 'b2', createdAt: 9 };

    expect(bookmarkItemId(madeAgain)).toBe(bookmarkItemId(page));
  });
});
