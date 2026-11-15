import { beforeEach, describe, expect, it, vi } from 'vitest';

// The link parser lives in a chat component with a long import chain.
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import {
  chooseSavedLauncherUse,
  currentSavedLauncher,
  fromSavedBookmarks,
  loadLauncherSyncMark,
  launcherSyncMarkKey,
  mergeSavedLauncher,
  readSavedLauncher,
  sameSavedLauncher,
  SAVED_BOOKMARKS_VERSION,
  type SavedLauncher,
  saveLauncherSyncMark,
  toSavedBookmarks,
  toSavedLauncherSettings,
} from './launcherQdn';

const folder = (id: string, name: string): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 10,
  updatedAt: 20,
});

const bookmark = (
  id: string,
  appName: string,
  folderId: string | null = null,
  path = ''
): AppBookmark => ({
  id,
  name: appName,
  service: 'APP',
  appName,
  path,
  link: `qortal://APP/${appName}${path ? `/${path}` : ''}`,
  folderId,
  createdAt: 30,
  updatedAt: 40,
});

const data = (
  folders: AppBookmarkFolder[],
  bookmarks: AppBookmark[],
  updatedAt = 50
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt });

const savedOf = (
  folders: AppBookmarkFolder[],
  bookmarks: AppBookmark[],
  order: string[] = []
): SavedLauncher => ({
  bookmarks: toSavedBookmarks(data(folders, bookmarks)),
  order,
});

describe('what the settings hold', () => {
  it('leaves the link out and makes it again when read', () => {
    const saved = toSavedBookmarks(
      data([folder('f1', 'Media')], [bookmark('b1', 'Q-Tube', 'f1', 'watch')])
    );

    expect(saved.version).toBe(SAVED_BOOKMARKS_VERSION);
    expect(saved.bookmarks[0]).not.toHaveProperty('link');

    const read = fromSavedBookmarks(saved, 99);

    expect(read.updatedAt).toBe(99);
    expect(read.bookmarks[0]).toMatchObject({
      appName: 'Q-Tube',
      folderId: 'f1',
      link: 'qortal://APP/Q-Tube/watch',
      path: 'watch',
    });
  });

  it('is the settings fields the launcher adds', () => {
    const launcher = savedOf([folder('f1', 'Media')], [], ['folder:f1']);

    expect(toSavedLauncherSettings(launcher)).toEqual({
      appBookmarks: launcher.bookmarks,
      launcherOrder: ['folder:f1'],
    });
  });

  it('has nothing to save when there is nothing', () => {
    expect(currentSavedLauncher(data([], []), [])).toBeNull();
    expect(currentSavedLauncher(null, ['APP-Q-Tube'])).toBeNull();
    expect(currentSavedLauncher(data([], []), ['APP-Q-Tube'])).not.toBeNull();
  });
});

describe('reading what was saved', () => {
  it('reads the bookmarks, the folders and the order', () => {
    const launcher = readSavedLauncher({
      sortablePinnedApps: [{ name: 'Q-Tube', service: 'APP' }],
      appBookmarks: toSavedBookmarks(
        data([folder('f1', 'Media')], [bookmark('b1', 'Q-Tube', 'f1')])
      ),
      launcherOrder: ['folder:f1', 'APP-Q-Mail'],
    });

    expect(launcher?.bookmarks.folders).toHaveLength(1);
    expect(launcher?.bookmarks.bookmarks[0].folderId).toBe('f1');
    expect(launcher?.order).toEqual(['folder:f1', 'APP-Q-Mail']);
  });

  it('has nothing for settings that were saved without a launcher', () => {
    expect(
      readSavedLauncher({ sortablePinnedApps: [{ name: 'Q-Tube' }] })
    ).toBeNull();
    expect(readSavedLauncher(null)).toBeNull();
    expect(readSavedLauncher({ appBookmarks: { folders: 'no' } })).toBeNull();
  });

  it('leaves out entries that are not whole, keeping the rest', () => {
    const launcher = readSavedLauncher(
      {
        appBookmarks: {
          version: 1,
          folders: [
            folder('f1', 'Media'),
            { id: 'f2' },
            { name: 'no id' },
            folder('f1', 'Twice'),
          ],
          bookmarks: [
            bookmark('b1', 'Q-Tube', 'f1'),
            { id: 'b2', name: 'no app', service: 'APP' },
            { ...bookmark('b3', 'Q-Mail'), service: '' },
            bookmark('b4', 'Q-Blog', 'gone'),
          ],
        },
        launcherOrder: ['folder:f1', 7, null, 'APP-Q-Tube'],
      },
      123
    );

    expect(launcher?.bookmarks.folders.map((entry) => entry.id)).toEqual([
      'f1',
    ]);
    expect(launcher?.bookmarks.bookmarks.map((entry) => entry.id)).toEqual([
      'b1',
      'b4',
    ]);
    // A folder that is gone leaves its bookmark at the top level.
    expect(launcher?.bookmarks.bookmarks[1].folderId).toBeNull();
    expect(launcher?.order).toEqual(['folder:f1', 'APP-Q-Tube']);
  });

  it('keeps one bookmark per place, as the bookmarks menu does', () => {
    const launcher = readSavedLauncher({
      appBookmarks: {
        version: 1,
        folders: [],
        bookmarks: [
          bookmark('b1', 'Q-Tube'),
          bookmark('b2', 'Q-Tube'),
          bookmark('b3', 'Q-Tube', null, 'watch'),
        ],
      },
    });

    expect(launcher?.bookmarks.bookmarks.map((entry) => entry.id)).toEqual([
      'b1',
      'b3',
    ]);
  });

  it('gives a time to entries saved without one', () => {
    const launcher = readSavedLauncher(
      {
        appBookmarks: {
          version: 1,
          folders: [{ id: 'f1', name: 'Media' }],
          bookmarks: [
            { id: 'b1', name: 'Q-Tube', service: 'APP', appName: 'Q-Tube' },
          ],
        },
      },
      555
    );

    expect(launcher?.bookmarks.folders[0].createdAt).toBe(555);
    expect(launcher?.bookmarks.bookmarks[0].updatedAt).toBe(555);
    expect(launcher?.bookmarks.bookmarks[0].path).toBe('');
  });
});

describe('telling two arrangements apart', () => {
  it('is the same when only the times differ', () => {
    const one = savedOf(
      [folder('f1', 'Media')],
      [bookmark('b1', 'Q-Tube', 'f1')],
      ['folder:f1']
    );
    const other = savedOf(
      [{ ...folder('f1', 'Media'), updatedAt: 9999 }],
      [{ ...bookmark('b1', 'Q-Tube', 'f1'), createdAt: 7777 }],
      ['folder:f1']
    );

    expect(sameSavedLauncher(one, other)).toBe(true);
  });

  it('differs when a name, a folder or the order changed', () => {
    const one = savedOf(
      [folder('f1', 'Media')],
      [bookmark('b1', 'Q-Tube', 'f1')]
    );

    expect(
      sameSavedLauncher(
        one,
        savedOf([folder('f1', 'Video')], [bookmark('b1', 'Q-Tube', 'f1')])
      )
    ).toBe(false);
    expect(
      sameSavedLauncher(
        one,
        savedOf([folder('f1', 'Media')], [bookmark('b1', 'Q-Tube')])
      )
    ).toBe(false);
    expect(sameSavedLauncher(one, { ...one, order: ['APP-Q-Tube'] })).toBe(
      false
    );
  });

  it('counts nothing saved and an empty arrangement as the same', () => {
    expect(sameSavedLauncher(null, savedOf([], []))).toBe(true);
    expect(sameSavedLauncher(null, null)).toBe(true);
    expect(
      sameSavedLauncher(null, savedOf([], [bookmark('b1', 'Q-Tube')]))
    ).toBe(false);
  });
});

describe('merging what was saved with what is here', () => {
  it('keeps both, with the saved ones first', () => {
    const merged = mergeSavedLauncher(
      {
        data: data([folder('f2', 'Tools')], [bookmark('b2', 'Q-Mail', 'f2')]),
        order: ['folder:f2', 'APP-Q-Trade'],
      },
      savedOf(
        [folder('f1', 'Media')],
        [bookmark('b1', 'Q-Tube', 'f1')],
        ['folder:f1']
      ),
      777
    );

    expect(merged.data.folders.map((entry) => entry.name)).toEqual([
      'Media',
      'Tools',
    ]);
    expect(merged.data.bookmarks.map((entry) => entry.id)).toEqual([
      'b1',
      'b2',
    ]);
    expect(merged.data.bookmarks[1].folderId).toBe('f2');
    // The arrangement is this device's own, with the saved tile after it.
    expect(merged.order).toEqual(['folder:f2', 'APP-Q-Trade', 'folder:f1']);
    expect(merged.data.updatedAt).toBe(777);
  });

  it('keeps the arrangement made here when the saved one differs', () => {
    // Two bookmarks saved as A then B, moved to B then A on this device,
    // and the settings that arrive still say A then B.
    const both = [bookmark('b1', 'Q-Tube'), bookmark('b2', 'Q-Mail')];

    const merged = mergeSavedLauncher(
      { data: data([], both), order: ['APP-Q-Mail', 'APP-Q-Tube'] },
      savedOf([], both, ['APP-Q-Tube', 'APP-Q-Mail']),
      777
    );

    expect(merged.order).toEqual(['APP-Q-Mail', 'APP-Q-Tube']);
  });

  it('makes two folders of the same name one, and moves its bookmarks', () => {
    const merged = mergeSavedLauncher(
      {
        data: data(
          [folder('local', ' media ')],
          [bookmark('b2', 'Q-Mail', 'local')]
        ),
        order: ['folder:local'],
      },
      savedOf(
        [folder('f1', 'Media')],
        [bookmark('b1', 'Q-Tube', 'f1')],
        ['folder:f1']
      ),
      777
    );

    expect(merged.data.folders).toHaveLength(1);
    expect(merged.data.bookmarks.map((entry) => entry.folderId)).toEqual([
      'f1',
      'f1',
    ]);
    expect(merged.order).toEqual(['folder:f1']);
  });

  it('leaves out a bookmark of a place that was saved', () => {
    const merged = mergeSavedLauncher(
      { data: data([], [bookmark('mine', 'Q-Tube')]), order: [] },
      savedOf([], [bookmark('saved', 'Q-Tube')]),
      777
    );

    expect(merged.data.bookmarks.map((entry) => entry.id)).toEqual(['saved']);
  });
});

describe('what to do with what was found', () => {
  const saved = savedOf(
    [folder('f1', 'Media')],
    [bookmark('b1', 'Q-Tube', 'f1')]
  );

  it('keeps what is here when nothing was saved', () => {
    expect(
      chooseSavedLauncherUse({
        local: data([], []),
        mark: null,
        saved: null,
        savedAt: 10,
      })
    ).toBe('keep');
  });

  it('keeps what is here when the saved one was already taken in', () => {
    expect(
      chooseSavedLauncherUse({
        local: data([folder('f1', 'Media')], []),
        mark: { savedAt: 100, localAt: 50 },
        saved,
        savedAt: 100,
      })
    ).toBe('keep');
  });

  it('takes the saved one when this device has none', () => {
    expect(
      chooseSavedLauncherUse({
        local: null,
        mark: null,
        saved,
        savedAt: 100,
      })
    ).toBe('replace');
    expect(
      chooseSavedLauncherUse({
        local: data([], []),
        mark: null,
        saved,
        savedAt: 100,
      })
    ).toBe('replace');
  });

  it('takes the saved one when nothing changed here since', () => {
    expect(
      chooseSavedLauncherUse({
        local: data([folder('f1', 'Media')], [], 50),
        mark: { savedAt: 90, localAt: 50 },
        saved,
        savedAt: 120,
      })
    ).toBe('replace');
  });

  it('merges when this device changed things that were never saved', () => {
    expect(
      chooseSavedLauncherUse({
        local: data([folder('f2', 'Tools')], [], 80),
        mark: { savedAt: 90, localAt: 50 },
        saved,
        savedAt: 120,
      })
    ).toBe('merge');
    // Never took a saved one in.
    expect(
      chooseSavedLauncherUse({
        local: data([folder('f2', 'Tools')], [], 80),
        mark: null,
        saved,
        savedAt: 120,
      })
    ).toBe('merge');
  });

  it('merges when only the tiles were moved here', () => {
    const local = data([folder('f1', 'Media')], [], 50);
    const mark = { savedAt: 90, localAt: 50, order: ['folder:f1'] };

    expect(
      chooseSavedLauncherUse({
        local,
        order: ['folder:f1', 'APP-Q-Mail'],
        mark,
        saved,
        savedAt: 120,
      })
    ).toBe('merge');
    // Where they stood when it was taken in: nothing to keep.
    expect(
      chooseSavedLauncherUse({
        local,
        order: ['folder:f1'],
        mark,
        saved,
        savedAt: 120,
      })
    ).toBe('replace');
  });

  it('merges while this device holds what a merge kept', () => {
    expect(
      chooseSavedLauncherUse({
        local: data([folder('f1', 'Media')], [], 50),
        order: ['folder:f1'],
        mark: {
          savedAt: 90,
          localAt: 50,
          order: ['folder:f1'],
          unsaved: true,
        },
        saved,
        savedAt: 120,
      })
    ).toBe('merge');
  });

  it('takes the saved one for a device with nothing of its own', () => {
    // An arrangement of its own counts, even with no bookmarks.
    expect(
      chooseSavedLauncherUse({
        local: data([], [], 50),
        order: [],
        mark: null,
        saved,
        savedAt: 120,
      })
    ).toBe('replace');
    expect(
      chooseSavedLauncherUse({
        local: data([], [], 50),
        order: ['APP-Q-Mail'],
        mark: null,
        saved,
        savedAt: 120,
      })
    ).toBe('merge');
  });
});

describe('the mark of what was taken in', () => {
  beforeEach(() => localStorage.clear());

  it('writes it and reads it back', () => {
    saveLauncherSyncMark('Qaddress', { savedAt: 10, localAt: 20 });

    expect(localStorage.getItem(launcherSyncMarkKey('Qaddress'))).toBeTruthy();
    expect(loadLauncherSyncMark('Qaddress')).toEqual({
      savedAt: 10,
      localAt: 20,
    });
  });

  it('keeps where the tiles stood and what is unsaved', () => {
    saveLauncherSyncMark('Qaddress', {
      savedAt: 10,
      localAt: 20,
      order: ['folder:f1', 'APP-Q-Mail'],
      unsaved: true,
    });

    expect(loadLauncherSyncMark('Qaddress')).toEqual({
      savedAt: 10,
      localAt: 20,
      order: ['folder:f1', 'APP-Q-Mail'],
      unsaved: true,
    });
  });

  it('leaves out an arrangement and a flag that are not what they should be', () => {
    localStorage.setItem(
      launcherSyncMarkKey('Qodd'),
      JSON.stringify({ savedAt: 1, localAt: 2, order: 'folder:f1' })
    );
    expect(loadLauncherSyncMark('Qodd')).toEqual({ savedAt: 1, localAt: 2 });

    localStorage.setItem(
      launcherSyncMarkKey('Qmixed'),
      JSON.stringify({ savedAt: 1, localAt: 2, order: ['a', 7, 'b'] })
    );
    expect(loadLauncherSyncMark('Qmixed')?.order).toEqual(['a', 'b']);
  });

  it('has none for another account, or for what is damaged', () => {
    saveLauncherSyncMark('Qaddress', { savedAt: 10, localAt: 20 });
    expect(loadLauncherSyncMark('Qother')).toBeNull();

    localStorage.setItem(launcherSyncMarkKey('Qbad'), '{oops');
    expect(loadLauncherSyncMark('Qbad')).toBeNull();

    localStorage.setItem(launcherSyncMarkKey('Qhalf'), '{"savedAt":1}');
    expect(loadLauncherSyncMark('Qhalf')).toBeNull();
  });
});
