import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();
const openPrivateApp = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

// The address parser lives in a chat component with a long import chain, and
// nothing here reads an address.
vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => executeEvent(...args),
}));

vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: openPrivateApp }),
}));

import { sortablePinnedAppsAtom } from '../../../atoms/global';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import { launcherViewStorageKey } from './launcherItems';
import { LauncherSaved } from './LauncherSaved';

const ADDRESS = 'Qaddress';
const NEW_FOLDER = 'core:bookmarks.new_folder';
const MOVE_OUT = 'core:launcher.folder_remove_from';
const DELETE_FOLDER = 'core:launcher.folder_delete';

const library = [
  { name: 'Q-Mail', service: 'APP', metadata: { title: 'Q-Mail' } },
  { name: 'Simon', service: 'WEBSITE', metadata: { title: 'Simon’s site' } },
];

const privatePin = {
  isPrivate: true,
  isPreview: true,
  privateAppProperties: {
    name: 'Q-Minter',
    service: 'DOCUMENT',
    identifier: 'helper',
    groupId: 5,
    appName: 'Minter Helper',
  },
};

const threePins = [
  { name: 'Q-Mail', service: 'APP' },
  { name: 'Q-Tube', service: 'APP' },
  { name: 'Q-Trade', service: 'APP' },
];

const folder = (id: string, name: string): AppBookmarkFolder => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
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

const bookmarkStore = (
  folders: AppBookmarkFolder[] = [],
  bookmarks: AppBookmark[] = []
): AppBookmarksForAddress => ({ folders, bookmarks, updatedAt: 1 });

/** A page inside Q-Tube, bookmarked outside a folder. */
const channel = () =>
  bookmark('b1', 'Q-Tube', { name: 'My channel', path: 'channel/me' });

const onBookmarksChange = vi.fn();
/** What the launcher last asked to save. */
const savedBookmarks = (): AppBookmarksForAddress =>
  onBookmarksChange.mock.lastCall?.[0];

type Options = {
  address?: string;
  bookmarks?: AppBookmarksForAddress | null;
  myWebsite?: unknown;
};

/** Keeps the bookmarks the way the launcher page does: shown as soon as saved. */
const Harness = ({ address, bookmarks: initial, myWebsite }: Options) => {
  const [bookmarks, setBookmarks] = useState(initial ?? null);
  return (
    <LauncherSaved
      availableQapps={library}
      bookmarks={bookmarks}
      myAddress={address}
      myWebsite={myWebsite as never}
      onBookmarksChange={(next) => {
        onBookmarksChange(next);
        setBookmarks(next);
      }}
    />
  );
};

const renderSaved = (pins: unknown[], options: Options = {}) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins as never);
  const view = render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <Harness
          address={options.address ?? ADDRESS}
          bookmarks={
            options.bookmarks === undefined
              ? bookmarkStore()
              : options.bookmarks
          }
          myWebsite={options.myWebsite}
        />
      </ThemeProvider>
    </Provider>
  );
  return { store, ...view };
};

/** The labels of the tiles in the row, without those inside an open folder. */
const rowTiles = () =>
  screen
    .getAllByRole('button')
    .filter((button) => !button.closest('[role="group"], [role="dialog"]'))
    .map((button) => button.textContent);

/** The labels of the tiles inside an open folder. */
const folderTiles = (name: string) =>
  within(screen.getByRole('group', { name }))
    .getAllByRole('button')
    .map((button) => button.textContent)
    .filter(Boolean);

const tile = (name: string) => screen.getByRole('button', { name });

const chooseFromMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  tileName: string,
  item: string
) => {
  fireEvent.contextMenu(tile(tileName));
  await user.click(screen.getByRole('menuitem', { name: item }));
};

/** Makes a folder with one app from the app's menu, and names it. */
const startFolder = async (
  user: ReturnType<typeof userEvent.setup>,
  appName: string,
  folderName: string
) => {
  await chooseFromMenu(user, appName, NEW_FOLDER);
  await user.keyboard(`${folderName}{Enter}`);
};

/** A dialog fades out before the page under it can be used again. */
const dialogGone = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

const storedPins = () =>
  JSON.parse(localStorage.getItem('ext_saved_settings') ?? 'null')
    ?.sortablePinnedApps;

const storedView = () =>
  JSON.parse(localStorage.getItem(launcherViewStorageKey(ADDRESS)) ?? 'null');

beforeEach(() => {
  executeEvent.mockClear();
  onBookmarksChange.mockClear();
  openPrivateApp.mockReset();
  openPrivateApp.mockResolvedValue(true);
  localStorage.clear();
});

describe('LauncherSaved', () => {
  it('shows a tile for every pin, named by its title', () => {
    renderSaved([
      { name: 'Q-Mail', service: 'APP' },
      { name: 'Q-New', service: 'APP' },
    ]);

    expect(rowTiles()).toEqual(['Q-Mail', 'Q-New']);
  });

  it('says so when nothing is pinned or bookmarked', () => {
    renderSaved([]);

    expect(screen.getByText('core:launcher.pinned_empty')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens an app with a click, with Enter and from its menu', async () => {
    const user = userEvent.setup();
    renderSaved([{ name: 'Q-Mail', service: 'APP' }]);

    await user.click(tile('Q-Mail'));
    tile('Q-Mail').focus();
    await user.keyboard('{Enter}');
    await chooseFromMenu(user, 'Q-Mail', 'core:action.open');

    expect(executeEvent).toHaveBeenCalledTimes(3);
    expect(executeEvent).toHaveBeenLastCalledWith('addTab', {
      data: expect.objectContaining({ name: 'Q-Mail', service: 'APP' }),
    });
  });

  it('decrypts a private app instead of opening a tab', async () => {
    const user = userEvent.setup();
    renderSaved([privatePin]);

    await user.click(tile('Minter Helper'));

    expect(openPrivateApp).toHaveBeenCalledWith(
      privatePin.privateAppProperties,
      false,
      undefined
    );
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('unpins an app from its menu and saves the list', async () => {
    const user = userEvent.setup();
    const { store } = renderSaved(threePins);

    await chooseFromMenu(user, 'Q-Tube', 'core:action.unpin_app');

    expect(rowTiles()).toEqual(['Q-Mail', 'Q-Trade']);
    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Mail', service: 'APP' },
      { name: 'Q-Trade', service: 'APP' },
    ]);
    expect(storedPins()).toEqual(store.get(sortablePinnedAppsAtom));
    // The bookmarks are not touched.
    expect(onBookmarksChange).not.toHaveBeenCalled();
  });

  it('adds the account’s own website first, and never offers to unpin it', () => {
    renderSaved([{ name: 'Q-Mail', service: 'APP' }], {
      myWebsite: library[1],
    });

    expect(rowTiles()).toEqual(['Simon’s site', 'Q-Mail']);

    fireEvent.contextMenu(tile('Simon’s site'));
    expect(
      screen.queryByRole('menuitem', { name: 'core:action.unpin_app' })
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'core:action.open' })
    ).toBeVisible();
  });

  describe('bookmarks', () => {
    it('shows the bookmarks and the bookmark folders with the pinned apps', () => {
      renderSaved(threePins, {
        bookmarks: bookmarkStore(
          [folder('f1', 'Travel')],
          [channel(), bookmark('b2', 'Q-Weather', { folderId: 'f1' })]
        ),
      });

      expect(rowTiles()).toEqual([
        'Q-Mail',
        'Q-Tube',
        'Q-Trade',
        'Travel · 1',
        'My channel',
      ]);
    });

    it('opens a bookmark at its page', async () => {
      const user = userEvent.setup();
      renderSaved([], {
        bookmarks: bookmarkStore(
          [],
          [
            bookmark('b1', 'Q-Tube', {
              name: 'My channel',
              identifier: 'chan',
              path: 'channel/me',
            }),
          ]
        ),
      });

      await user.click(tile('My channel'));

      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: {
          service: 'APP',
          name: 'Q-Tube',
          identifier: 'chan',
          path: 'channel/me',
        },
      });
      expect(executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
    });

    it('removes a bookmark from its menu and leaves the pins alone', async () => {
      const user = userEvent.setup();
      const { store } = renderSaved(threePins, {
        bookmarks: bookmarkStore([], [channel()]),
      });

      fireEvent.contextMenu(tile('My channel'));
      expect(
        screen.queryByRole('menuitem', { name: 'core:action.unpin_app' })
      ).toBeNull();
      await user.click(
        screen.getByRole('menuitem', { name: 'core:launcher.bookmark_remove' })
      );

      expect(rowTiles()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Trade']);
      expect(savedBookmarks().bookmarks).toEqual([]);
      expect(store.get(sortablePinnedAppsAtom)).toEqual(threePins);
    });

    it('shows a pinned app in the folder its bookmark is in', async () => {
      const user = userEvent.setup();
      renderSaved(threePins, {
        bookmarks: bookmarkStore(
          [folder('f1', 'Media')],
          [bookmark('b1', 'Q-Tube', { folderId: 'f1' })]
        ),
      });

      // One tile for the app: in the folder, not in the row as well.
      expect(rowTiles()).toEqual(['Q-Mail', 'Q-Trade', 'Media · 1']);
      await user.click(tile('Media · 1'));
      expect(folderTiles('Media')).toEqual(['Q-Tube']);
    });

    it('leaves the bookmarks alone when they could not be read', async () => {
      const user = userEvent.setup();
      const { store } = renderSaved(threePins, { bookmarks: null });

      await chooseFromMenu(user, 'Q-Tube', NEW_FOLDER);

      expect(rowTiles()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Trade']);
      expect(onBookmarksChange).not.toHaveBeenCalled();

      // The pinned apps still work.
      await chooseFromMenu(user, 'Q-Tube', 'core:action.unpin_app');
      expect(store.get(sortablePinnedAppsAtom)).toHaveLength(2);
    });
  });

  describe('folders', () => {
    it('starts a bookmark folder from an app’s menu and asks for its name', async () => {
      const user = userEvent.setup();
      const { store } = renderSaved(threePins);

      await chooseFromMenu(user, 'Q-Tube', NEW_FOLDER);

      // The folder stands where the app stood, open, with its name selected.
      expect(rowTiles()).toEqual(['Q-Mail', `${NEW_FOLDER} · 1`, 'Q-Trade']);
      const nameBox = screen.getByRole('textbox', {
        name: 'core:bookmarks.folder_name',
      });
      expect(nameBox).toHaveFocus();
      expect(nameBox).toHaveValue(NEW_FOLDER);

      await user.keyboard('Media{Enter}');

      expect(rowTiles()).toEqual(['Q-Mail', 'Media · 1', 'Q-Trade']);
      expect(folderTiles('Media')).toEqual(['Q-Tube']);

      // It is a folder of the bookmarks menu, with a bookmark of the app.
      const saved = savedBookmarks();
      expect(saved.folders).toEqual([
        expect.objectContaining({ name: 'Media' }),
      ]);
      expect(saved.bookmarks).toEqual([
        expect.objectContaining({
          name: 'Q-Tube',
          service: 'APP',
          appName: 'Q-Tube',
          path: '',
          link: 'qortal://APP/Q-Tube',
          folderId: saved.folders[0].id,
        }),
      ]);
      // The app stays pinned.
      expect(store.get(sortablePinnedAppsAtom)).toEqual(threePins);
      expect(storedView().openFolders).toEqual([saved.folders[0].id]);
    });

    it('keeps the old name when renaming is given up or left empty', async () => {
      const user = userEvent.setup();
      renderSaved(threePins);
      await startFolder(user, 'Q-Tube', 'Media');

      await chooseFromMenu(user, 'Media · 1', 'core:bookmarks.rename');
      await user.keyboard('Other{Escape}');
      expect(tile('Media · 1')).toBeVisible();

      await chooseFromMenu(user, 'Media · 1', 'core:bookmarks.rename');
      await user.clear(
        screen.getByRole('textbox', { name: 'core:bookmarks.folder_name' })
      );
      await user.keyboard('{Enter}');
      expect(tile('Media · 1')).toBeVisible();
      expect(savedBookmarks().folders[0].name).toBe('Media');
    });

    it('moves apps into a folder and keeps them together in the pin list', async () => {
      const user = userEvent.setup();
      const { store } = renderSaved(threePins);
      await startFolder(user, 'Q-Trade', 'Finance');

      await chooseFromMenu(user, 'Q-Mail', 'Finance');

      expect(rowTiles()).toEqual(['Q-Tube', 'Finance · 2']);
      expect(folderTiles('Finance')).toEqual(['Q-Trade', 'Q-Mail']);
      // Every app is still pinned: the list saved on QDN has all three.
      expect(store.get(sortablePinnedAppsAtom)).toEqual([
        { name: 'Q-Tube', service: 'APP' },
        { name: 'Q-Trade', service: 'APP' },
        { name: 'Q-Mail', service: 'APP' },
      ]);
      expect(storedPins()).toEqual(store.get(sortablePinnedAppsAtom));
      expect(savedBookmarks().bookmarks.map((entry) => entry.appName)).toEqual([
        'Q-Trade',
        'Q-Mail',
      ]);
    });

    it('moves a bookmark into a folder', async () => {
      const user = userEvent.setup();
      renderSaved(threePins, {
        bookmarks: bookmarkStore([folder('f1', 'Media')], [channel()]),
      });

      await chooseFromMenu(user, 'My channel', 'Media');

      expect(rowTiles()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Trade', 'Media · 1']);
      expect(savedBookmarks().bookmarks).toEqual([
        expect.objectContaining({ id: 'b1', folderId: 'f1' }),
      ]);
    });

    it('closes and opens a folder from its tile, and remembers it', async () => {
      const user = userEvent.setup();
      const { unmount } = renderSaved(threePins);
      await startFolder(user, 'Q-Tube', 'Media');
      expect(tile('Media · 1')).toHaveAttribute('aria-expanded', 'true');

      await user.click(tile('Media · 1'));

      expect(tile('Media · 1')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('group', { name: 'Media' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Q-Tube' })).toBeNull();

      // Another visit finds the folder as it was left.
      unmount();
      renderSaved(threePins, { bookmarks: savedBookmarks() });
      expect(rowTiles()).toEqual(['Q-Mail', 'Media · 1', 'Q-Trade']);
      expect(tile('Media · 1')).toHaveAttribute('aria-expanded', 'false');

      await user.click(tile('Media · 1'));
      expect(screen.getByRole('group', { name: 'Media' })).toBeVisible();
    });

    it('takes an app out of a folder: it is in the row again, without the bookmark', async () => {
      const user = userEvent.setup();
      renderSaved(threePins);
      await startFolder(user, 'Q-Tube', 'Media');
      await chooseFromMenu(user, 'Q-Mail', 'Media');

      await chooseFromMenu(user, 'Q-Tube', MOVE_OUT);
      expect(rowTiles()).toEqual(['Media · 1', 'Q-Tube', 'Q-Trade']);
      expect(savedBookmarks().bookmarks.map((entry) => entry.appName)).toEqual([
        'Q-Mail',
      ]);

      // The folder stays when it is empty: it is a folder of the bookmarks.
      await chooseFromMenu(user, 'Q-Mail', MOVE_OUT);
      expect(rowTiles()).toEqual(['Media · 0', 'Q-Mail', 'Q-Tube', 'Q-Trade']);
      expect(
        screen.getByText('core:bookmarks.no_bookmarks_folder')
      ).toBeVisible();
      expect(savedBookmarks().folders).toHaveLength(1);
      expect(savedBookmarks().bookmarks).toEqual([]);
    });

    it('takes a bookmark out of a folder as a bookmark', async () => {
      const user = userEvent.setup();
      renderSaved(threePins, {
        bookmarks: bookmarkStore(
          [folder('f1', 'Media')],
          [{ ...channel(), folderId: 'f1' }]
        ),
      });
      await user.click(tile('Media · 1'));

      await chooseFromMenu(user, 'My channel', MOVE_OUT);

      expect(rowTiles()).toEqual([
        'Q-Mail',
        'Q-Tube',
        'Q-Trade',
        'Media · 0',
        'My channel',
      ]);
      expect(savedBookmarks().bookmarks).toEqual([
        expect.objectContaining({ id: 'b1', folderId: null }),
      ]);
    });

    it('unpins an app inside a folder together with its bookmark', async () => {
      const user = userEvent.setup();
      const { store } = renderSaved(threePins);
      await startFolder(user, 'Q-Tube', 'Media');

      await chooseFromMenu(user, 'Q-Tube', 'core:action.unpin_app');

      expect(rowTiles()).toEqual(['Q-Mail', 'Media · 0', 'Q-Trade']);
      expect(store.get(sortablePinnedAppsAtom)).toEqual([
        { name: 'Q-Mail', service: 'APP' },
        { name: 'Q-Trade', service: 'APP' },
      ]);
      expect(savedBookmarks().bookmarks).toEqual([]);
    });

    it('asks before deleting a folder that holds something, and keeps what was in it', async () => {
      const user = userEvent.setup();
      const { store } = renderSaved(threePins);
      await startFolder(user, 'Q-Tube', 'Media');
      await chooseFromMenu(user, 'Q-Trade', 'Media');
      const deleteButton = () =>
        within(screen.getByRole('group', { name: 'Media' })).getByRole(
          'button',
          { name: DELETE_FOLDER }
        );

      await user.click(deleteButton());
      expect(
        screen.getByText('core:bookmarks.delete_folder_title')
      ).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: 'core:action.cancel' })
      );
      await dialogGone();
      expect(tile('Media · 2')).toBeVisible();

      await user.click(deleteButton());
      await user.click(
        screen.getByRole('button', { name: 'core:bookmarks.delete' })
      );
      await dialogGone();

      expect(rowTiles()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Trade']);
      expect(store.get(sortablePinnedAppsAtom)).toHaveLength(3);
      expect(savedBookmarks()).toMatchObject({ folders: [], bookmarks: [] });
    });

    it('deletes an empty folder at once', async () => {
      const user = userEvent.setup();
      renderSaved(threePins, {
        bookmarks: bookmarkStore([folder('f1', 'Empty')]),
      });

      await chooseFromMenu(user, 'Empty · 0', DELETE_FOLDER);

      expect(rowTiles()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Trade']);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(savedBookmarks().folders).toEqual([]);
    });

    it('does not offer the folder a tile is already in', async () => {
      const user = userEvent.setup();
      renderSaved(threePins);
      await startFolder(user, 'Q-Tube', 'Media');

      fireEvent.contextMenu(tile('Q-Tube'));
      expect(screen.queryByRole('menuitem', { name: 'Media' })).toBeNull();
      expect(screen.getByRole('menuitem', { name: MOVE_OUT })).toBeVisible();
    });

    it('offers a private app no folder: it has no bookmark', () => {
      renderSaved([privatePin], {
        bookmarks: bookmarkStore([folder('f1', 'Media')]),
      });

      fireEvent.contextMenu(tile('Minter Helper'));

      expect(screen.queryByRole('menuitem', { name: 'Media' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: NEW_FOLDER })).toBeNull();
      expect(
        screen.getByRole('menuitem', { name: 'core:action.unpin_app' })
      ).toBeVisible();
    });

    it('keeps each account’s open folders apart', async () => {
      const user = userEvent.setup();
      const bookmarks = bookmarkStore(
        [folder('f1', 'Media')],
        [{ ...channel(), folderId: 'f1' }]
      );
      const { unmount } = renderSaved(threePins, { bookmarks });
      await user.click(tile('Media · 1'));
      expect(tile('Media · 1')).toHaveAttribute('aria-expanded', 'true');
      unmount();

      renderSaved(threePins, { address: 'Qother', bookmarks });

      expect(tile('Media · 1')).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
