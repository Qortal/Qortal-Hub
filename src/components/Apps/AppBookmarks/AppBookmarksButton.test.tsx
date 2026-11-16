import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = options?.count ?? options?.query;
      return value === undefined ? key : `${key}|${value}`;
    },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

vi.mock('../../Chat/MessageDisplay', () => ({
  extractComponents: (url: string) => {
    const [base, query = ''] = url.replace('qortal://', '').split('?');
    const [service, name, ...path] = base.split('/');
    return {
      service: service.toUpperCase(),
      name,
      identifier: new URLSearchParams(query).get('identifier') ?? undefined,
      path: path.join('/'),
    };
  },
}));

vi.mock('../../../utils/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/events')>();
  return {
    ...actual,
    executeEvent: (...args: unknown[]) => executeEvent(...args),
  };
});

import { darkTheme } from '../../../styles/theme-dark';
import { AppBookmarksButton } from './AppBookmarksButton';
import { APP_BOOKMARKS_STORAGE_KEY } from './bookmarkStorage';
import type { AppBookmark, AppBookmarkFolder } from './bookmarkTypes';

const ADDRESS = 'Qaddress';
const OPEN_MENU = 'core:bookmarks.title';
const SEARCH = 'core:bookmarks.search';
const MORE = 'core:bookmarks.more';
const CLEAR_SEARCH = 'core:launcher.clear_search';
const DELETE = 'core:bookmarks.delete';

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

/** The bookmarks store the menu reads, standing in for the real one. */
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

const show = async (folders: AppBookmarkFolder[], bookmarks: AppBookmark[]) => {
  const kept = giveStore(folders, bookmarks);
  const user = userEvent.setup();
  render(
    <Provider store={createStore()}>
      <ThemeProvider theme={darkTheme}>
        <AppBookmarksButton address={ADDRESS} selectedTab={null} />
      </ThemeProvider>
    </Provider>
  );
  await user.click(screen.getByRole('button', { name: OPEN_MENU }));
  await screen.findByText('core:bookmarks.title');
  return { kept, user };
};

/** The row of a name, whatever it holds. */
const rowOf = (name: string) =>
  screen.getByText(name).closest('button') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  executeEvent.mockReset();
});

describe('the bookmarks menu', () => {
  it('shows each bookmark with its app’s picture', async () => {
    await show([], [bookmark('b1', 'Watch later', { appName: 'Q-Tube' })]);

    const picture = within(rowOf('Watch later')).getByRole('presentation', {
      hidden: true,
    });
    expect(picture).toBeTruthy();
    expect(within(rowOf('Watch later')).getByText('Q-Tube')).toBeVisible();
  });

  it('says where a bookmarked page is, not its whole address', async () => {
    await show(
      [],
      [bookmark('b1', 'Playlists', { appName: 'Q-Tube', path: 'playlists' })]
    );

    expect(screen.getByText('Q-Tube · playlists')).toBeVisible();
    expect(screen.queryByText('qortal://APP/Q-Tube/playlists')).toBeNull();
  });

  it('shows a folder with how much it holds, and opens it', async () => {
    const { user } = await show(
      [folder('f1', 'Media')],
      [bookmark('b1', 'Q-Tube', { folderId: 'f1' }), bookmark('b2', 'Q-Mail')]
    );

    expect(screen.getByText('core:bookmarks.bookmark_count|1')).toBeVisible();

    await user.click(rowOf('Media'));

    expect(screen.getByText('Q-Tube')).toBeVisible();
    expect(screen.queryByText('Q-Mail')).toBeNull();
  });

  it('opens a bookmark in a tab', async () => {
    const { user } = await show(
      [],
      [bookmark('b1', 'Watch later', { appName: 'Q-Tube', path: 'playlists' })]
    );

    await user.click(rowOf('Watch later'));

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'APP',
        name: 'Q-Tube',
        identifier: undefined,
        path: 'playlists',
      },
    });
  });

  it('offers no search for a short list', async () => {
    await show([], [bookmark('b1', 'Q-Tube'), bookmark('b2', 'Q-Mail')]);

    expect(screen.queryByPlaceholderText(SEARCH)).toBeNull();
  });

  it('searches every folder once there are many', async () => {
    const { user } = await show(
      [folder('f1', 'Media'), folder('f2', 'Tools')],
      [
        bookmark('b1', 'Watch later', { appName: 'Q-Tube', folderId: 'f1' }),
        bookmark('b2', 'Q-Mail'),
        bookmark('b3', 'Q-Blog'),
        bookmark('b4', 'Q-Trade', { folderId: 'f2' }),
        bookmark('b5', 'Q-Fund'),
      ]
    );

    await user.type(screen.getByPlaceholderText(SEARCH), 'watch');

    expect(screen.getByText('Watch later')).toBeVisible();
    expect(screen.queryByText('Q-Mail')).toBeNull();
    // Found in a folder, so the row says which one.
    expect(screen.getByText('Media · Q-Tube')).toBeVisible();
  });

  it('keeps the search after deleting the bookmark it found', async () => {
    // Seven, so there is a search box; deleting the one it found takes the
    // count below seven, and the box must not leave with its filter still on.
    const { user } = await show(
      [],
      [
        bookmark('b1', 'Watch later', { appName: 'Q-Tube' }),
        bookmark('b2', 'Q-Mail'),
        bookmark('b3', 'Q-Blog'),
        bookmark('b4', 'Q-Trade'),
        bookmark('b5', 'Q-Fund'),
        bookmark('b6', 'Q-Sandbox'),
        bookmark('b7', 'Q-Shop'),
      ]
    );

    await user.type(screen.getByPlaceholderText(SEARCH), 'watch');
    await user.click(
      within(rowOf('Watch later')).getByRole('button', { name: MORE })
    );
    await user.click(screen.getByText(DELETE));

    await waitFor(() => expect(screen.queryByText('Watch later')).toBeNull());
    // Still there, still holding what was typed, so it can be cleared.
    expect(screen.getByPlaceholderText(SEARCH)).toHaveValue('watch');
    expect(screen.getByText('core:launcher.no_matches|watch')).toBeVisible();

    await user.click(screen.getByRole('button', { name: CLEAR_SEARCH }));

    expect(screen.getByText('Q-Mail')).toBeVisible();
    expect(screen.getByText('Q-Shop')).toBeVisible();
  });

  it('says when nothing matches what was typed', async () => {
    const { user } = await show(
      [folder('f1', 'Media')],
      [
        bookmark('b1', 'Q-Tube', { folderId: 'f1' }),
        bookmark('b2', 'Q-Mail'),
        bookmark('b3', 'Q-Blog'),
        bookmark('b4', 'Q-Trade'),
        bookmark('b5', 'Q-Fund'),
        bookmark('b6', 'Q-Sandbox'),
      ]
    );

    await user.type(screen.getByPlaceholderText(SEARCH), 'nothing here');

    expect(
      screen.getByText('core:launcher.no_matches|nothing here')
    ).toBeVisible();
  });

  it('says how to make the first bookmark when there are none', async () => {
    await show([], []);

    expect(screen.getByText('core:bookmarks.no_bookmarks')).toBeVisible();
    expect(screen.getByText('core:bookmarks.no_bookmarks_hint')).toBeVisible();
  });
});

describe('the apps bar, from the bookmarks menu', () => {
  const barSwitch = () =>
    screen.getByRole('checkbox', { name: 'core:apps_bar.show' });

  it('offers to show the pinned apps and bookmarks in the title bar', async () => {
    await show([], [bookmark('b1', 'Q-Tube')]);

    expect(barSwitch()).not.toBeChecked();
    expect(screen.getByText('core:apps_bar.show_hint')).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: 'core:apps_bar.show_names' })
    ).toBeNull();
  });

  it('turns the bar on for this account', async () => {
    const { user } = await show([], [bookmark('b1', 'Q-Tube')]);

    await user.click(barSwitch());

    expect(barSwitch()).toBeChecked();
    expect(
      JSON.parse(localStorage.getItem('qortal_apps_bar_by_address') || '{}')
    ).toEqual({ [ADDRESS]: { enabled: true, showNames: true, names: {} } });
  });

  it('offers to take the names away once the bar is on', async () => {
    const { user } = await show([], [bookmark('b1', 'Q-Tube')]);
    await user.click(barSwitch());

    const names = screen.getByRole('checkbox', {
      name: 'core:apps_bar.show_names',
    });
    expect(names).toBeChecked();
    expect(screen.getByText('core:apps_bar.rename_tip')).toBeVisible();

    await user.click(names);

    expect(names).not.toBeChecked();
    expect(
      JSON.parse(localStorage.getItem('qortal_apps_bar_by_address') || '{}')[
        ADDRESS
      ].showNames
    ).toBe(false);
  });
});
