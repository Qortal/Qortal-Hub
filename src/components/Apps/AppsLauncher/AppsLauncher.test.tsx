import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();
const openPrivateApp = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = options?.title ?? options?.query;
      return value === undefined ? key : `${key}|${value}`;
    },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

// The address parser lives in a chat component with a long import chain. This
// stand-in reads the two addresses used here; launcherSearch.test.ts runs the
// real one.
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

// Events are recorded and still sent, so a saved bookmark reaches the launcher.
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

vi.mock('../AppCard', () => ({
  AppCardEnhanced: ({ app }: { app: any }) => (
    <div data-testid="app-card">{app?.metadata?.title || app?.name}</div>
  ),
}));

// Each library tab is a counter, to see that a tab keeps its state.
vi.mock('../AppsLibrary', () => {
  const tabs = ['official', 'community', 'categories', 'my-apps', 'private'];
  const makeTab = (name: string) =>
    function TabStub() {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          {`${name} content ${count}`}
        </button>
      );
    };
  return {
    AppsTabs: ({
      currentTab,
      onTabChange,
    }: {
      currentTab: string;
      onTabChange: (tab: string) => void;
    }) => (
      <div role="tablist">
        {tabs.map((tab) => (
          <button
            aria-selected={tab === currentTab}
            key={tab}
            onClick={() => onTabChange(tab)}
            role="tab"
          >
            {tab}
          </button>
        ))}
      </div>
    ),
    OfficialAppsTab: makeTab('official'),
    CommunityAppsTab: makeTab('community'),
    CategoriesTab: makeTab('categories'),
    MyAppsTab: makeTab('my-apps'),
    PrivateTab: makeTab('private'),
  };
});

import { sortablePinnedAppsAtom } from '../../../atoms/global';
import { AppsLauncher, type AppsLauncherRequest } from './AppsLauncher';

const library = [
  { name: 'Q-Tube', service: 'APP', metadata: { title: 'Q-Tube' } },
  { name: 'Q-Mail', service: 'APP', metadata: { title: 'Q-Mail' } },
  {
    name: 'TubeFan',
    service: 'WEBSITE',
    metadata: { title: 'Fans of the tube' },
  },
  { name: 'Chess', service: 'APP', metadata: { description: 'Board games' } },
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

const SEARCH_LABEL = 'core:action.search_apps_or_link';
const ADDRESS = 'Qaddress';

const savedBookmarks = () => ({
  folders: [
    { id: 'f1', name: 'Travel', createdAt: 1, updatedAt: 1 },
    { id: 'f2', name: 'Empty', createdAt: 2, updatedAt: 2 },
  ],
  bookmarks: [
    {
      id: 'b1',
      name: 'Weather in Lisbon',
      service: 'APP',
      appName: 'Q-Weather',
      path: 'city/lisbon',
      link: 'qortal://APP/Q-Weather/city/lisbon',
      folderId: 'f1',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'b2',
      name: 'My channel',
      service: 'APP',
      appName: 'Q-Tube',
      identifier: 'chan',
      path: 'channel/me',
      link: 'qortal://APP/Q-Tube/channel/me?identifier=chan',
      folderId: null,
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  updatedAt: 2,
});

/** Stands in for the Hub's storage, where the bookmarks menu keeps its list. */
const installBookmarkStorage = (forAddress: unknown) => {
  const values: Record<string, unknown> = {
    qortal_app_bookmarks_by_address: { [ADDRESS]: forAddress },
  };
  window.appStorage = {
    get: vi.fn(async (key: string) => values[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      values[key] = value;
    }),
  } as never;
  return values;
};

const renderLauncher = async (
  props: Partial<React.ComponentProps<typeof AppsLauncher>> = {},
  pins: unknown[] = [{ name: 'Q-Mail', service: 'APP' }]
) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins as never);
  const ui = (extra: Partial<React.ComponentProps<typeof AppsLauncher>>) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <AppsLauncher
          availableQapps={library}
          categories={[]}
          isShow
          myAddress={ADDRESS}
          myName="Simon"
          setMode={vi.fn()}
          {...props}
          {...extra}
        />
      </ThemeProvider>
    </Provider>
  );
  const view = render(ui({}));
  // Let the bookmarks finish loading.
  await act(async () => {});
  return {
    ...view,
    rerenderWith: async (
      extra: Partial<React.ComponentProps<typeof AppsLauncher>>
    ) => {
      view.rerender(ui(extra));
      await act(async () => {});
    },
  };
};

const searchBox = () => screen.getByRole('textbox', { name: SEARCH_LABEL });

beforeEach(() => {
  executeEvent.mockClear();
  openPrivateApp.mockReset();
  openPrivateApp.mockResolvedValue(true);
  delete window.appStorage;
});

describe('AppsLauncher', () => {
  it('shows the search box, the pinned apps and the library on one page', async () => {
    await renderLauncher();

    expect(searchBox()).toBeVisible();
    expect(
      screen.getByText('core:launcher.pinned_and_bookmarks')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Q-Mail' })).toBeVisible();
    expect(screen.getByText('official content 0')).toBeVisible();
  });

  it('opens a pinned app with a click', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.click(screen.getByRole('button', { name: 'Q-Mail' }));

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: expect.objectContaining({ name: 'Q-Mail', service: 'APP' }),
    });
  });

  it('builds nothing before it is first shown', async () => {
    const { container } = await renderLauncher({ isShow: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden, not removed, once another page shows', async () => {
    const { container, rerenderWith } = await renderLauncher();

    await rerenderWith({ isShow: false });

    expect(container.firstChild).not.toBeVisible();
    expect(screen.getByText('official content 0')).toBeInTheDocument();
  });

  it('lists the matches, best first, in place of the page', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.type(searchBox(), 'tube');

    expect(
      screen.getAllByTestId('app-card').map((card) => card.textContent)
    ).toEqual(['Q-Tube', 'Fans of the tube']);
    expect(screen.getByText('core:launcher.enter_opens|Q-Tube')).toBeVisible();
    expect(
      screen.getByText('core:launcher.pinned_and_bookmarks')
    ).not.toBeVisible();
    expect(screen.getByText('official content 0')).not.toBeVisible();
  });

  it('opens the best match on Enter and empties the box', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.type(searchBox(), 'tube{Enter}');

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: expect.objectContaining({ name: 'Q-Tube', service: 'APP' }),
    });
    expect(executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
    expect(searchBox()).toHaveValue('');
    expect(
      screen.getByText('core:launcher.pinned_and_bookmarks')
    ).toBeVisible();
  });

  it('opens a qortal:// address with its path and identifier', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.type(
      searchBox(),
      'qortal://APP/Q-Tube/video/abc?identifier=clip1'
    );

    expect(
      screen.getByRole('button', { name: /core:action.open_as_qortal_link/ })
    ).toBeVisible();
    expect(screen.queryByTestId('app-card')).not.toBeInTheDocument();

    await user.keyboard('{Enter}');

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'APP',
        name: 'Q-Tube',
        identifier: 'clip1',
        path: 'video/abc',
      },
    });
    expect(searchBox()).toHaveValue('');
  });

  it('opens the address when its row is clicked', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.type(searchBox(), 'website/Simon');
    await user.click(
      screen.getByRole('button', { name: /core:action.open_as_qortal_link/ })
    );

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'WEBSITE',
        name: 'Simon',
        identifier: undefined,
        path: '',
      },
    });
  });

  it('says so when nothing matches, and Enter opens nothing', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.type(searchBox(), 'zzzz{Enter}');

    expect(screen.getByText('core:launcher.no_matches|zzzz')).toBeVisible();
    expect(executeEvent).not.toHaveBeenCalled();
    expect(searchBox()).toHaveValue('zzzz');
  });

  it('clears the search with Escape or the clear button', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.type(searchBox(), 'mail');
    await user.keyboard('{Escape}');
    expect(searchBox()).toHaveValue('');

    await user.type(searchBox(), 'mail');
    await user.click(
      screen.getByRole('button', { name: 'core:launcher.clear_search' })
    );
    expect(searchBox()).toHaveValue('');
    expect(
      screen.getByText('core:launcher.pinned_and_bookmarks')
    ).toBeVisible();
  });

  it('finds a pinned private app and opens it', async () => {
    const user = userEvent.setup();
    await renderLauncher({}, [privatePin]);

    await user.type(searchBox(), 'minter');

    const results = screen.getByText('core:launcher.results_saved')
      .parentElement as HTMLElement;
    expect(
      within(results).getByRole('button', { name: 'Minter Helper' })
    ).toBeVisible();

    await user.keyboard('{Enter}');

    expect(openPrivateApp).toHaveBeenCalledWith(
      privatePin.privateAppProperties,
      false,
      undefined
    );
    expect(searchBox()).toHaveValue('');
  });

  it('keeps the search when a private app could not open', async () => {
    const user = userEvent.setup();
    openPrivateApp.mockResolvedValue(false);
    await renderLauncher({}, [privatePin]);

    await user.type(searchBox(), 'minter{Enter}');

    expect(openPrivateApp).toHaveBeenCalledTimes(1);
    expect(searchBox()).toHaveValue('minter');
  });

  it('starts over on a request: its search, and the box focused', async () => {
    const user = userEvent.setup();
    const first: AppsLauncherRequest = { nonce: 1, query: '' };
    const { rerenderWith } = await renderLauncher({ request: first });

    await user.type(searchBox(), 'chess');
    await user.tab();
    expect(searchBox()).not.toHaveFocus();

    await rerenderWith({ request: { nonce: 2, query: 'mail' } });

    expect(searchBox()).toHaveValue('mail');
    expect(searchBox()).toHaveFocus();
    expect(
      screen.getAllByTestId('app-card').map((card) => card.textContent)
    ).toEqual(['Q-Mail']);

    await rerenderWith({ request: { nonce: 3, query: '' } });
    expect(searchBox()).toHaveValue('');
  });

  it('applies the request it is first shown with', async () => {
    const request: AppsLauncherRequest = { nonce: 7, query: 'mail' };
    const { rerenderWith } = await renderLauncher({ request, isShow: false });

    await rerenderWith({ request, isShow: true });

    expect(searchBox()).toHaveValue('mail');
    expect(searchBox()).toHaveFocus();
  });

  it('keeps its search when it is shown again without a request', async () => {
    const user = userEvent.setup();
    const request: AppsLauncherRequest = { nonce: 1, query: '' };
    const { rerenderWith } = await renderLauncher({ request });

    await user.type(searchBox(), 'chess');
    await rerenderWith({ request, isShow: false });
    await rerenderWith({ request, isShow: true });

    expect(searchBox()).toHaveValue('chess');
  });

  it('keeps a library tab as it was left', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    await user.click(screen.getByText('official content 0'));
    expect(screen.getByText('official content 1')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'community' }));
    expect(screen.getByText('community content 0')).toBeVisible();
    expect(screen.getByText('official content 1')).not.toBeVisible();
    expect(screen.queryByText(/categories content/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'official' }));
    expect(screen.getByText('official content 1')).toBeVisible();
    expect(screen.getByText('community content 0')).not.toBeVisible();
  });

  it('offers the sort and filters on the community tab only', async () => {
    const user = userEvent.setup();
    await renderLauncher();

    expect(screen.queryByLabelText('core:filter.sort_by')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'community' }));
    expect(screen.getByLabelText('core:filter.sort_by')).toBeInTheDocument();
  });

  it('reloads the list of apps from its refresh button', async () => {
    const user = userEvent.setup();
    const getQapps = vi.fn();
    await renderLauncher({ getQapps });

    await user.click(
      screen.getByRole('button', {
        name: 'core:action.refetch_apps_websites_list',
      })
    );

    expect(getQapps).toHaveBeenCalledTimes(1);
  });

  describe('bookmarks', () => {
    /** What the storage holds for the account, as the bookmarks menu reads it. */
    const storedFor = (stored: Record<string, unknown>) =>
      (
        stored.qortal_app_bookmarks_by_address as Record<
          string,
          {
            folders: { id: string; name: string }[];
            bookmarks: {
              id: string;
              appName: string;
              folderId: string | null;
            }[];
          }
        >
      )[ADDRESS];

    it('shows the pinned apps alone while there are no bookmarks', async () => {
      installBookmarkStorage({ folders: [], bookmarks: [], updatedAt: 1 });
      await renderLauncher();

      expect(screen.getByRole('button', { name: 'Q-Mail' })).toBeVisible();
      expect(screen.queryByText('core:bookmarks.title')).toBeNull();
    });

    it('shows the bookmark folders and the bookmarks next to the pinned apps', async () => {
      installBookmarkStorage(savedBookmarks());
      await renderLauncher();

      const tiles = screen.getByRole('button', { name: 'Q-Mail' }).parentElement
        ?.parentElement as HTMLElement;
      expect(
        within(tiles)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual(['Q-Mail', 'Travel · 1', 'Empty · 0', 'My channel']);
      expect(
        screen.queryByRole('button', { name: 'Weather in Lisbon' })
      ).toBeNull();
    });

    it('opens a bookmark at its page', async () => {
      const user = userEvent.setup();
      installBookmarkStorage(savedBookmarks());
      await renderLauncher();

      await user.click(
        await screen.findByRole('button', { name: 'My channel' })
      );

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

    it('opens a folder in place and closes it again', async () => {
      const user = userEvent.setup();
      installBookmarkStorage(savedBookmarks());
      await renderLauncher();

      const folder = await screen.findByRole('button', { name: 'Travel · 1' });
      expect(folder).toHaveAttribute('aria-expanded', 'false');
      await user.click(folder);

      expect(folder).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('button', { name: 'Weather in Lisbon' })
      ).toBeVisible();

      await user.click(
        screen.getByRole('button', { name: 'core:action.close' })
      );
      expect(
        screen.queryByRole('button', { name: 'Weather in Lisbon' })
      ).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Empty · 0' }));
      expect(
        screen.getByText('core:bookmarks.no_bookmarks_folder')
      ).toBeVisible();
    });

    it('removes a bookmark from its right-click menu, for the menu too', async () => {
      const user = userEvent.setup();
      const stored = installBookmarkStorage(savedBookmarks());
      await renderLauncher();

      fireEvent.contextMenu(
        await screen.findByRole('button', { name: 'My channel' })
      );
      await user.click(
        screen.getByRole('menuitem', { name: 'core:launcher.bookmark_remove' })
      );

      expect(screen.queryByRole('button', { name: 'My channel' })).toBeNull();
      await vi.waitFor(() =>
        expect(
          storedFor(stored).bookmarks.map((bookmark) => bookmark.id)
        ).toEqual(['b1'])
      );
    });

    it('puts a pinned app into a bookmark folder, for the menu too', async () => {
      const user = userEvent.setup();
      const stored = installBookmarkStorage(savedBookmarks());
      await renderLauncher();

      fireEvent.contextMenu(
        await screen.findByRole('button', { name: 'Q-Mail' })
      );
      await user.click(screen.getByRole('menuitem', { name: 'Travel' }));

      // The app shows in the folder now, and the folder says so.
      expect(screen.getByRole('button', { name: 'Travel · 2' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Q-Mail' })).toBeNull();
      await vi.waitFor(() =>
        expect(
          storedFor(stored).bookmarks.map((bookmark) => [
            bookmark.appName,
            bookmark.folderId,
          ])
        ).toEqual([
          ['Q-Weather', 'f1'],
          ['Q-Mail', 'f1'],
          ['Q-Tube', null],
        ])
      );
      // It is still there after what was written is read back.
      await act(async () => {});
      expect(screen.getByRole('button', { name: 'Travel · 2' })).toBeVisible();
    });

    it('finds a bookmark by its name or its app, and Enter opens it', async () => {
      const user = userEvent.setup();
      installBookmarkStorage(savedBookmarks());
      await renderLauncher();
      await screen.findByRole('button', { name: 'My channel' });

      await user.type(searchBox(), 'weather');
      expect(
        screen.getByRole('button', { name: 'Weather in Lisbon' })
      ).toBeVisible();
      expect(
        screen.getByText('core:launcher.enter_opens|Weather in Lisbon')
      ).toBeVisible();

      await user.keyboard('{Enter}');
      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: {
          service: 'APP',
          name: 'Q-Weather',
          identifier: undefined,
          path: 'city/lisbon',
        },
      });
      expect(searchBox()).toHaveValue('');
    });

    it('lists an app once when a folder holds its bookmark', async () => {
      const user = userEvent.setup();
      const withApp = savedBookmarks();
      withApp.bookmarks.push({
        id: 'b3',
        name: 'Q-Mail',
        service: 'APP',
        appName: 'Q-Mail',
        path: '',
        link: 'qortal://APP/Q-Mail',
        folderId: 'f1',
        createdAt: 3,
        updatedAt: 3,
      });
      installBookmarkStorage(withApp);
      await renderLauncher();
      await screen.findByRole('button', { name: 'My channel' });

      await user.type(searchBox(), 'mail');

      expect(
        screen.getAllByTestId('app-card').map((card) => card.textContent)
      ).toEqual(['Q-Mail']);
      expect(screen.queryByText('core:launcher.results_saved')).toBeNull();
    });

    it('follows a change made in the bookmarks menu', async () => {
      const stored = installBookmarkStorage(savedBookmarks());
      await renderLauncher();
      await screen.findByRole('button', { name: 'My channel' });

      const next = savedBookmarks();
      next.bookmarks[1].name = 'Renamed channel';
      stored.qortal_app_bookmarks_by_address = { [ADDRESS]: next };
      document.dispatchEvent(
        new CustomEvent('appBookmarksChanged', { detail: { address: ADDRESS } })
      );

      expect(
        await screen.findByRole('button', { name: 'Renamed channel' })
      ).toBeVisible();
    });
  });
});
