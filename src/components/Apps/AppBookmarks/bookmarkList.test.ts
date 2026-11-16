import { describe, expect, it, vi } from 'vitest';

vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type { AppBookmark, AppBookmarkFolder } from './bookmarkTypes';
import {
  bookmarkMatches,
  bookmarkSubtitle,
  bookmarksInFolder,
  folderPictures,
  searchBookmarks,
  searchFolders,
} from './bookmarkList';

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
    path = '',
    service = 'APP',
  }: {
    appName?: string;
    folderId?: string | null;
    path?: string;
    service?: string;
  } = {}
): AppBookmark => ({
  id,
  name,
  service,
  appName,
  path,
  link: `qortal://${service}/${appName}${path ? `/${path}` : ''}`,
  folderId,
  createdAt: 1,
  updatedAt: 1,
});

const labelOfService = (service: string) =>
  service === 'WEBSITE' ? 'Website' : 'Q-App';

describe('what a row says under the name', () => {
  it('says what it is when the name is the app’s own', () => {
    expect(bookmarkSubtitle(bookmark('b', 'Q-Tube'), labelOfService)).toBe(
      'Q-App'
    );
    expect(
      bookmarkSubtitle(
        bookmark('b', 'Simon', { service: 'WEBSITE' }),
        labelOfService
      )
    ).toBe('Website');
  });

  it('names the app when the bookmark was given another name', () => {
    expect(
      bookmarkSubtitle(
        bookmark('b', 'Watch later', { appName: 'Q-Tube' }),
        labelOfService
      )
    ).toBe('Q-Tube');
  });

  it('shows the page inside the app', () => {
    expect(
      bookmarkSubtitle(
        bookmark('b', 'Watch later', { appName: 'Q-Tube', path: 'playlists' }),
        labelOfService
      )
    ).toBe('Q-Tube · playlists');
  });

  it('does not mind the case of a name that matches its app', () => {
    expect(
      bookmarkSubtitle(
        bookmark('b', 'q-tube', { appName: 'Q-Tube' }),
        labelOfService
      )
    ).toBe('Q-App');
  });
});

describe('the pictures on a folder’s row', () => {
  it('are the apps of what is inside, in order', () => {
    const bookmarks = [
      bookmark('b1', 'Q-Tube', { folderId: 'f1' }),
      bookmark('b2', 'Q-Mail'),
      bookmark('b3', 'Q-Blog', { folderId: 'f1' }),
    ];

    expect(folderPictures(folder('f1', 'Media'), bookmarks)).toEqual([
      { key: 'b1', appName: 'Q-Tube' },
      { key: 'b3', appName: 'Q-Blog' },
    ]);
    expect(folderPictures(folder('f2', 'Empty'), bookmarks)).toEqual([]);
  });
});

describe('the bookmarks of a folder', () => {
  const bookmarks = [
    bookmark('b1', 'Q-Tube', { folderId: 'f1' }),
    bookmark('b2', 'Q-Mail'),
  ];

  it('are those with that folder, or those with none at the top', () => {
    expect(bookmarksInFolder(bookmarks, 'f1').map((b) => b.id)).toEqual(['b1']);
    expect(bookmarksInFolder(bookmarks, null).map((b) => b.id)).toEqual(['b2']);
  });
});

describe('searching', () => {
  const folders = [folder('f1', 'Media'), folder('f2', 'Tools')];
  const bookmarks = [
    bookmark('b1', 'Watch later', { appName: 'Q-Tube', folderId: 'f1' }),
    bookmark('b2', 'Q-Mail'),
    bookmark('b3', 'Trade', { appName: 'Q-Trade', folderId: 'f2' }),
  ];

  it('finds a bookmark by its name, its app or its page', () => {
    expect(bookmarkMatches(bookmarks[0], 'watch')).toBe(true);
    expect(bookmarkMatches(bookmarks[0], 'q-tube')).toBe(true);
    // A pasted address finds it, whatever case it was pasted in.
    expect(bookmarkMatches(bookmarks[0], 'qortal://APP/Q-Tube')).toBe(true);
    expect(bookmarkMatches(bookmarks[0], 'QORTAL://app/q-tube')).toBe(true);
    expect(bookmarkMatches(bookmarks[0], 'mail')).toBe(false);
  });

  it('matches everything while nothing is typed', () => {
    expect(bookmarkMatches(bookmarks[1], '   ')).toBe(true);
    expect(searchBookmarks(bookmarks, folders, '')).toHaveLength(3);
  });

  it('reaches into every folder, saying where each was found', () => {
    const found = searchBookmarks(bookmarks, folders, 'q-t');

    expect(found.map((result) => result.bookmark.id)).toEqual(['b1', 'b3']);
    expect(found[0].folder?.name).toBe('Media');
  });

  it('puts what is in the folder being looked at first', () => {
    const found = searchBookmarks(bookmarks, folders, 'q-t', 'f2');

    expect(found.map((result) => result.bookmark.id)).toEqual(['b3', 'b1']);
  });

  it('has no folder for a bookmark at the top level', () => {
    const [found] = searchBookmarks(bookmarks, folders, 'mail');

    expect(found.folder).toBeNull();
  });

  it('finds folders by name too', () => {
    expect(searchFolders(folders, 'too').map((entry) => entry.id)).toEqual([
      'f2',
    ]);
    expect(searchFolders(folders, '')).toHaveLength(2);
  });
});
