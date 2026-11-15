import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();
const openPrivateApp = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

// The address parser lives in a chat component with a long import chain. The
// bar does not read addresses; this keeps the chain out of the test.
vi.mock('../../Chat/MessageDisplay', () => ({
  extractComponents: vi.fn(),
}));

vi.mock('../../../utils/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/events')>();
  return {
    ...actual,
    executeEvent: (name: string, data: unknown) => {
      executeEvent(name, data);
      actual.executeEvent(name, data);
    },
  };
});

vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: openPrivateApp }),
}));

import { sortablePinnedAppsAtom } from '../../../atoms/global';
import { darkTheme } from '../../../styles/theme-dark';
import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import { APP_BOOKMARKS_STORAGE_KEY } from '../../Apps/AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
} from '../../Apps/AppBookmarks/bookmarkTypes';
import { AppsBar } from './AppsBar';
import { bookmarkItemId, pinItemId } from './appsBarItems';
import {
  EMPTY_APPS_BAR_SETTINGS,
  type AppsBarSettings,
} from './appsBarSettings';
import { appsBarByAddressAtom } from './useAppsBar';

const ADDRESS = 'Qaddress';

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
  }: { appName?: string; folderId?: string | null; path?: string } = {}
): AppBookmark => ({
  id,
  name,
  service: 'APP',
  appName,
  path,
  link: `qortal://APP/${appName}${path ? `/${path}` : ''}`,
  folderId,
  createdAt: 1,
  updatedAt: 1,
});

/** The bookmarks store the bar reads, standing in for the real one. */
const giveStore = (folders: AppBookmarkFolder[], bookmarks: AppBookmark[]) => {
  const kept = new Map<string, unknown>([
    [
      APP_BOOKMARKS_STORAGE_KEY,
      { [ADDRESS]: { folders, bookmarks, updatedAt: 1 } },
    ],
  ]);
  (window as never as { appStorage: unknown }).appStorage = {
    get: async (key: string) => kept.get(key),
    set: async (key: string, value: unknown) => {
      kept.set(key, value);
    },
  };
  return kept;
};

const show = async ({
  bookmarks = [],
  folders = [],
  pins = [],
  settings = {},
  onTitleBarDoubleClick,
}: {
  bookmarks?: AppBookmark[];
  folders?: AppBookmarkFolder[];
  pins?: PinnedApp[];
  settings?: Partial<AppsBarSettings>;
  /** What the title bar does when it is double-clicked: maximize. */
  onTitleBarDoubleClick?: () => void;
} = {}) => {
  giveStore(folders, bookmarks);
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins as never);
  store.set(appsBarByAddressAtom, {
    [ADDRESS]: { ...EMPTY_APPS_BAR_SETTINGS, enabled: true, ...settings },
  });

  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        {/* The title bar the bar sits in, which maximizes on a double-click. */}
        <div data-testid="title-bar" onDoubleClick={onTitleBarDoubleClick}>
          <AppsBar address={ADDRESS} />
        </div>
      </ThemeProvider>
    </Provider>
  );
  await screen.findByRole('toolbar');
  return { store, user };
};

/** Every item of the bar, by the name it is announced with. */
const itemNames = () =>
  within(screen.getByRole('toolbar'))
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

const itemOf = (name: string) =>
  within(screen.getByRole('toolbar')).getByRole('button', { name });

/** Giving an item of the bar a name through its menu. */
const rename = async (
  user: ReturnType<typeof userEvent.setup>,
  target: HTMLElement,
  typed: string
) => {
  await user.pointer({ keys: '[MouseRight]', target });
  await user.click(
    screen.getByRole('menuitem', { name: 'core:bookmarks.rename' })
  );
  const field = await screen.findByRole('textbox');
  await user.clear(field);
  if (typed) await user.type(field, typed);
  await user.click(screen.getByRole('button', { name: 'core:action.save' }));
  // The window hides the rest of the page while it is open.
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

/**
 * jsdom lays nothing out, so the row is told what it has room for: every
 * item the same width, side by side, in a row of the width given.
 */
const layOutRow = (rowWidth: number, itemWidth: number) => {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[data-apps-bar-item]')
  );
  items.forEach((item, index) => {
    Object.defineProperty(item, 'offsetWidth', {
      configurable: true,
      value: itemWidth,
    });
    Object.defineProperty(item, 'offsetLeft', {
      configurable: true,
      value: index * itemWidth,
    });
  });
  const row = items[0]?.parentElement;
  if (row) {
    Object.defineProperty(row, 'clientWidth', {
      configurable: true,
      value: rowWidth,
    });
  }
  // What the window would tell the bar once it had been laid out.
  act(() => resized.forEach((onResize) => onResize()));
};

/** The bar watches the row's size; jsdom has no watcher of its own. */
const resized: (() => void)[] = [];

class FakeResizeObserver {
  constructor(onResize: () => void) {
    resized.push(onResize);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', FakeResizeObserver);

beforeEach(() => {
  resized.length = 0;
  localStorage.clear();
  executeEvent.mockReset();
  openPrivateApp.mockReset();
});

describe('the apps bar', () => {
  it('shows the pinned apps and the bookmarks, pins first', async () => {
    await show({
      pins: [{ service: 'APP', name: 'Q-Tube' }],
      bookmarks: [
        bookmark('b1', 'Playlists', { appName: 'Q-Tube', path: 'p' }),
      ],
    });

    await waitFor(() => expect(itemNames()).toEqual(['Q-Tube', 'Playlists']));
  });

  it('shows a picture for every item', async () => {
    await show({ pins: [{ service: 'APP', name: 'Q-Tube' }] });

    expect(
      within(itemOf('Q-Tube')).getByRole('presentation', { hidden: true })
    ).toBeTruthy();
  });

  it('opens a pinned app in a tab', async () => {
    const { user } = await show({ pins: [{ service: 'APP', name: 'Q-Tube' }] });

    await user.click(itemOf('Q-Tube'));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: { service: 'APP', name: 'Q-Tube' },
      })
    );
    expect(executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('opens a bookmark at its own page', async () => {
    const { user } = await show({
      bookmarks: [
        bookmark('b1', 'Playlists', { appName: 'Q-Tube', path: 'playlists' }),
      ],
    });
    await waitFor(() => expect(itemNames()).toEqual(['Playlists']));

    await user.click(itemOf('Playlists'));

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'APP',
        name: 'Q-Tube',
        identifier: undefined,
        path: 'playlists',
      },
    });
  });

  it('decrypts a private app before opening it', async () => {
    openPrivateApp.mockResolvedValue(true);
    const { user } = await show({
      pins: [
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
    });

    await user.click(itemOf('My notes'));

    await waitFor(() => expect(openPrivateApp).toHaveBeenCalled());
    expect(executeEvent).not.toHaveBeenCalledWith('addTab', expect.anything());
  });

  it('shows a folder as one item, not its bookmarks', async () => {
    await show({
      folders: [folder('f1', 'Social')],
      bookmarks: [
        bookmark('b1', 'Torq', { folderId: 'f1' }),
        bookmark('b2', 'Quitter', { folderId: 'f1' }),
      ],
    });

    await waitFor(() => expect(itemNames()).toEqual(['Social']));
  });

  it('says what to do while there is nothing to show', async () => {
    await show();

    expect(screen.getByText('core:apps_bar.empty')).toBeVisible();
  });

  it('shows the pictures alone when names are turned off', async () => {
    await show({
      pins: [{ service: 'APP', name: 'Q-Tube' }],
      settings: { showNames: false },
    });

    // The item is still there, and still says what it is.
    expect(itemOf('Q-Tube')).toBeTruthy();
    expect(within(itemOf('Q-Tube')).queryByText('Q-Tube')).toBeNull();
  });
});

describe('a bookmark folder in the bar', () => {
  const social = () => ({
    folders: [folder('f1', 'Social')],
    bookmarks: [
      bookmark('b1', 'Torq', {
        appName: 'Q-Torq',
        path: 'home',
        folderId: 'f1',
      }),
      bookmark('b2', 'Quitter', { appName: 'Q-Quitter', folderId: 'f1' }),
    ],
  });

  const openSocial = async (user: ReturnType<typeof userEvent.setup>) => {
    await waitFor(() => expect(itemNames()).toEqual(['Social']));
    await user.click(itemOf('Social'));
    return screen.findByRole('menu', { name: 'Social' });
  };

  it('opens a list of what is inside', async () => {
    const { user } = await show(social());

    const list = await openSocial(user);

    const rows = within(list).getAllByRole('menuitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Torq');
    expect(rows[1]).toHaveTextContent('Quitter');
  });

  it('says where each one goes', async () => {
    const { user } = await show(social());

    const list = await openSocial(user);

    const rows = within(list).getAllByRole('menuitem');
    // The app it is in, and the page inside it when it is not the first one.
    expect(rows[0]).toHaveTextContent('Q-Torq · home');
    expect(rows[1]).toHaveTextContent('Q-Quitter');
  });

  it('opens the one that is picked', async () => {
    const { user } = await show(social());
    const list = await openSocial(user);

    await user.click(within(list).getByRole('menuitem', { name: /Torq/ }));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: {
          service: 'APP',
          name: 'Q-Torq',
          identifier: undefined,
          path: 'home',
        },
      })
    );
  });

  it('says when there is nothing in it', async () => {
    const { user } = await show({ folders: [folder('f1', 'Empty')] });
    await waitFor(() => expect(itemNames()).toEqual(['Empty']));

    await user.click(itemOf('Empty'));

    expect(
      await screen.findByText('core:bookmarks.no_bookmarks_folder')
    ).toBeVisible();
  });

  it('is renamed like any other item, and has nothing to open', async () => {
    const { store, user } = await show(social());
    await waitFor(() => expect(itemNames()).toEqual(['Social']));

    await user.pointer({ keys: '[MouseRight]', target: itemOf('Social') });

    expect(
      screen.queryByRole('menuitem', { name: 'core:action.open' })
    ).toBeNull();
    await user.click(
      screen.getByRole('menuitem', { name: 'core:bookmarks.rename' })
    );
    const field = await screen.findByRole('textbox');
    await user.clear(field);
    await user.type(field, 'Chat');
    await user.click(screen.getByRole('button', { name: 'core:action.save' }));

    await waitFor(() => expect(itemOf('Chat')).toBeTruthy());
    expect(store.get(appsBarByAddressAtom)[ADDRESS].names).toEqual({
      'folder:f1': 'Chat',
    });
  });

  it('renames a bookmark from inside the folder, and stays open', async () => {
    const page = bookmark('b1', 'Torq', { appName: 'Q-Torq', folderId: 'f1' });
    const { store, user } = await show({
      folders: [folder('f1', 'Social')],
      bookmarks: [page],
    });
    const list = await openSocial(user);

    await rename(
      user,
      within(list).getByRole('menuitem', { name: /Torq/ }),
      'Feed'
    );

    expect(store.get(appsBarByAddressAtom)[ADDRESS].names).toEqual({
      [bookmarkItemId(page)]: 'Feed',
    });
    // The folder was not put away while its bookmark was renamed.
    expect(
      within(screen.getByRole('menu', { name: 'Social' })).getByRole(
        'menuitem',
        { name: /Feed/ }
      )
    ).toBeVisible();
  });
});

describe('what does not fit in the row', () => {
  const fourPins: PinnedApp[] = [
    { service: 'APP', name: 'Q-Tube' },
    { service: 'APP', name: 'Q-Mail' },
    { service: 'APP', name: 'Q-Trade' },
    { service: 'APP', name: 'Q-Chat' },
  ];

  const MORE = 'core:apps_bar.more';

  it('keeps what fits and holds the rest at the end', async () => {
    await show({ pins: fourPins });

    layOutRow(200, 60);

    expect(itemNames()).toEqual(['Q-Tube', 'Q-Mail', MORE]);
  });

  it('holds nothing back while the row is wide enough', async () => {
    await show({ pins: fourPins });

    layOutRow(600, 60);

    expect(itemNames()).toEqual(['Q-Tube', 'Q-Mail', 'Q-Trade', 'Q-Chat']);
  });

  it('brings an item back when the row grows again', async () => {
    await show({ pins: fourPins });
    layOutRow(200, 60);
    expect(itemNames()).toContain(MORE);

    layOutRow(600, 60);

    expect(itemNames()).toEqual(['Q-Tube', 'Q-Mail', 'Q-Trade', 'Q-Chat']);
  });

  it('shows the rest in a list of its own', async () => {
    const { user } = await show({ pins: fourPins });
    layOutRow(200, 60);

    await user.click(itemOf(MORE));

    const list = await screen.findByRole('menu', { name: MORE });
    expect(
      within(list)
        .getAllByRole('menuitem')
        .map((row) => row.textContent)
    ).toEqual(['Q-Trade', 'Q-Chat']);
  });

  it('opens one from that list', async () => {
    const { user } = await show({ pins: fourPins });
    layOutRow(200, 60);
    await user.click(itemOf(MORE));

    await user.click(await screen.findByRole('menuitem', { name: 'Q-Chat' }));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: { service: 'APP', name: 'Q-Chat' },
      })
    );
  });

  it('opens a folder from that list', async () => {
    const { user } = await show({
      pins: fourPins,
      folders: [folder('f1', 'Social')],
      bookmarks: [
        bookmark('b1', 'Torq', { appName: 'Q-Torq', folderId: 'f1' }),
      ],
    });
    await waitFor(() => expect(itemNames()).toHaveLength(5));
    layOutRow(200, 60);
    await user.click(itemOf(MORE));

    await user.click(await screen.findByRole('menuitem', { name: /Social/ }));

    const list = await screen.findByRole('menu', { name: 'Social' });
    expect(within(list).getByRole('menuitem', { name: /Torq/ })).toBeVisible();
  });
});

describe('renaming an item of the bar', () => {
  it('shows the name the user gives', async () => {
    const pin = { service: 'APP', name: 'Q-Tube' };
    const { store, user } = await show({ pins: [pin] });

    await rename(user, itemOf('Q-Tube'), 'TV');

    await waitFor(() => expect(itemOf('TV')).toBeTruthy());
    expect(store.get(appsBarByAddressAtom)[ADDRESS].names).toEqual({
      [pinItemId(pin)]: 'TV',
    });
  });

  it('shows the picture alone when the name is cleared', async () => {
    const page = bookmark('b1', 'Playlists', {
      appName: 'Q-Tube',
      path: 'playlists',
    });
    const { store, user } = await show({ bookmarks: [page] });
    await waitFor(() => expect(itemNames()).toEqual(['Playlists']));

    await rename(user, itemOf('Playlists'), '');

    await waitFor(() =>
      expect(store.get(appsBarByAddressAtom)[ADDRESS].names).toEqual({
        [bookmarkItemId(page)]: '',
      })
    );
    expect(
      within(screen.getByRole('toolbar')).queryByText('Playlists')
    ).toBeNull();
    // It is still there to click, under the name it has of itself.
    expect(itemOf('Playlists')).toBeTruthy();
  });

  it('gives an item its own name back', async () => {
    const pin = { service: 'APP', name: 'Q-Tube' };
    const { store, user } = await show({
      pins: [pin],
      settings: { names: { [pinItemId(pin)]: 'TV' } },
    });

    await user.pointer({ keys: '[MouseRight]', target: itemOf('TV') });
    await user.click(
      screen.getByRole('menuitem', { name: 'core:apps_bar.reset_name' })
    );

    await waitFor(() => expect(itemOf('Q-Tube')).toBeTruthy());
    expect(store.get(appsBarByAddressAtom)[ADDRESS].names).toEqual({});
  });

  it('offers no name to give back to an item that has none', async () => {
    const { user } = await show({ pins: [{ service: 'APP', name: 'Q-Tube' }] });

    await user.pointer({ keys: '[MouseRight]', target: itemOf('Q-Tube') });

    expect(
      screen.queryByRole('menuitem', { name: 'core:apps_bar.reset_name' })
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'core:bookmarks.rename' })
    ).toBeVisible();
  });

  it('keeps a double-click in the bar off the title bar', async () => {
    // The title bar maximizes the window when it is double-clicked, and the
    // bar sits in it: opening a bookmark twice must not resize the window.
    const maximize = vi.fn();
    const { user } = await show({
      folders: [folder('f1', 'Media')],
      bookmarks: [bookmark('b1', 'Q-Tube', { folderId: 'f1' })],
      pins: [{ service: 'APP', name: 'Q-Mail' }],
      onTitleBarDoubleClick: maximize,
    });

    fireEvent.dblClick(itemOf('Q-Mail'));
    expect(maximize).not.toHaveBeenCalled();

    // What a folder opens is in a portal, which events still climb out of.
    await user.click(itemOf('Media'));
    fireEvent.dblClick(screen.getByRole('menuitem', { name: /Q-Tube/ }));
    expect(maximize).not.toHaveBeenCalled();

    // The title bar itself still does.
    fireEvent.dblClick(screen.getByTestId('title-bar'));
    expect(maximize).toHaveBeenCalledTimes(1);
  });

  it('opens an item from its menu as well', async () => {
    const { user } = await show({ pins: [{ service: 'APP', name: 'Q-Tube' }] });

    await user.pointer({ keys: '[MouseRight]', target: itemOf('Q-Tube') });
    await user.click(
      screen.getByRole('menuitem', { name: 'core:action.open' })
    );

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: { service: 'APP', name: 'Q-Tube' },
      })
    );
  });
});
