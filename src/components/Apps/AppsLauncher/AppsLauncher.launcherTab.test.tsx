import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = options?.title ?? options?.query;
      return value === undefined ? key : `${key}|${value}`;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

vi.mock('../../Save/useSaveSettingsToQdn', () => ({
  useSaveSettingsToQdn: () => vi.fn(),
}));

vi.mock('../../Chat/MessageDisplay', () => ({
  extractComponents: () => null,
}));

vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: vi.fn() }),
}));

vi.mock('../AppCard', () => ({
  AppCardEnhanced: ({ app }: { app: any }) => (
    <div data-testid="app-card">{app?.metadata?.title || app?.name}</div>
  ),
}));

// The library's tabs are stand-ins; its filter bar is the real one.
vi.mock('../AppsLibrary', () => {
  const tabs = ['official', 'community'];
  const makeTab = (name: string) =>
    function TabStub() {
      return <div>{`${name} content`}</div>;
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
import { LauncherTabContext, LauncherTabShownContext } from '../launcherTabs';
import { AppsLauncher, type AppsLauncherRequest } from './AppsLauncher';

const library = [
  { name: 'Q-Tube', service: 'APP', metadata: { title: 'Q-Tube' } },
  { name: 'Q-Mail', service: 'APP', metadata: { title: 'Q-Mail' } },
];

type Shown = {
  /** The launcher tab is the one on screen. */
  tab: boolean;
  /** The tab is on its launcher page, not on an app's page. */
  launcherPage: boolean;
  request?: AppsLauncherRequest;
};

const renderLauncher = async (
  pins: { name: string; service: string }[] = [
    { name: 'Q-Mail', service: 'APP' },
  ]
) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins as never);
  const ui = ({ tab, launcherPage, request }: Shown) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <LauncherTabContext.Provider value="launcher-1">
          <LauncherTabShownContext.Provider value={tab}>
            <AppsLauncher
              availableQapps={library}
              categories={[]}
              isShow={tab && launcherPage}
              myAddress="Qaddress"
              myName="Viewer"
              request={request}
              setMode={vi.fn()}
            />
          </LauncherTabShownContext.Provider>
        </LauncherTabContext.Provider>
      </ThemeProvider>
    </Provider>
  );
  const view = render(ui({ tab: true, launcherPage: true }));
  await act(async () => {});
  return {
    store,
    show: async (shown: Shown) => {
      view.rerender(ui(shown));
      await act(async () => {});
    },
  };
};

// Found even while a menu has hidden the rest of the page from the tree.
const searchBox = () =>
  screen.getByRole('textbox', {
    hidden: true,
    name: 'core:action.search_apps_or_link',
  });

/** Stands in for the Hub's storage, with a folder that holds a bookmark. */
const installFolder = () => {
  const values: Record<string, unknown> = {
    qortal_app_bookmarks_by_address: {
      Qaddress: {
        folders: [{ id: 'f1', name: 'Travel', createdAt: 1, updatedAt: 1 }],
        bookmarks: [
          {
            id: 'b1',
            name: 'Weather',
            service: 'APP',
            appName: 'Q-Weather',
            path: 'city/lisbon',
            link: 'qortal://APP/Q-Weather/city/lisbon',
            folderId: 'f1',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        updatedAt: 1,
      },
    },
  };
  window.appStorage = {
    get: vi.fn(async (key: string) => values[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      values[key] = value;
    }),
  } as never;
};

/** Right-clicks the folder and asks to delete it: the question shows. */
const askToDeleteFolder = async (user: ReturnType<typeof userEvent.setup>) => {
  fireEvent.contextMenu(
    await screen.findByRole('button', { name: 'Travel · 1' })
  );
  await user.click(
    await screen.findByRole('menuitem', { name: 'core:launcher.folder_delete' })
  );
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(
    await screen.findByRole('dialog', {
      name: 'core:bookmarks.delete_folder_title',
    })
  ).toBeVisible();
};

beforeEach(() => {
  delete window.appStorage;
});

// A menu left open in a launcher tab steps aside while the tab is hidden.
// When the tab shows again on another page, the menu's own page is not on
// screen: the menu must not come back over the page that is.
describe('a launcher menu whose page is not the one on screen', () => {
  it('keeps a tile menu away while the tab shows an app page', async () => {
    const { show } = await renderLauncher();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Q-Mail' }));
    expect(await screen.findByRole('menu')).toBeVisible();

    // Another tab shows; a page link then opens an app's page in this tab.
    await show({ tab: false, launcherPage: true });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await show({ tab: true, launcherPage: false });

    expect(screen.queryByRole('menu')).toBeNull();

    // Back on the launcher page, the menu is there as it was left.
    await show({ tab: true, launcherPage: true });
    expect(await screen.findByRole('menu')).toBeVisible();
  });

  it('keeps the Sort menu away while the tab shows search results', async () => {
    const user = userEvent.setup();
    const { show } = await renderLauncher();
    await user.click(screen.getByRole('tab', { name: 'community' }));
    await user.click(screen.getByLabelText('core:filter.sort_by'));
    expect(await screen.findByRole('menu')).toBeVisible();

    // Another tab shows; a library search from the top bar then starts this
    // launcher over with its results, in place of the library.
    await show({ tab: false, launcherPage: true });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await show({
      tab: true,
      launcherPage: true,
      request: { nonce: 2, query: 'tube' },
    });
    expect(screen.getByText('community content')).not.toBeVisible();

    expect(screen.queryByRole('menu')).toBeNull();
    // It did not show for a moment either: the search box has the focus, as
    // after any search that starts the launcher over.
    expect(searchBox()).toHaveFocus();

    // The search cleared, the library is back without the menu: the launcher
    // started over and closed it. Sort still opens.
    await user.clear(searchBox());
    expect(screen.getByText('community content')).toBeVisible();
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByLabelText('core:filter.sort_by'));
    expect(await screen.findByRole('menu')).toBeVisible();
  });

  // The user erases the search to type another one: the keys must go on into
  // the search box.
  it('does not take the keys typed into the search box once it is erased', async () => {
    const user = userEvent.setup();
    const { show } = await renderLauncher();
    await user.click(screen.getByRole('tab', { name: 'community' }));
    await user.click(screen.getByLabelText('core:filter.sort_by'));
    expect(await screen.findByRole('menu')).toBeVisible();

    await show({ tab: false, launcherPage: true });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await show({
      tab: true,
      launcherPage: true,
      request: { nonce: 2, query: 'tube' },
    });
    expect(searchBox()).toHaveFocus();

    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(searchBox()).toHaveValue('');
    await user.keyboard('mail');

    expect(searchBox()).toHaveValue('mail');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the launcher menus after the launcher started over', () => {
  it('still opens the Sort menu when it started over without a search', async () => {
    const user = userEvent.setup();
    const { show } = await renderLauncher();
    await user.click(screen.getByRole('tab', { name: 'community' }));

    // An empty search starts the launcher over on its library, here while
    // it is on screen: nothing is hidden, so nothing steps aside.
    await show({
      tab: true,
      launcherPage: true,
      request: { nonce: 2, query: '' },
    });
    expect(screen.getByText('community content')).toBeVisible();

    await user.click(screen.getByLabelText('core:filter.sort_by'));
    expect(await screen.findByRole('menu')).toBeVisible();
  });
});

describe('a tile menu left open in a hidden launcher tab', () => {
  // Another launcher tab unpins the app meanwhile (the pins are the
  // account's, shared by every launcher tab).
  it('does not come back for a tile that is gone', async () => {
    const { show, store } = await renderLauncher([
      { name: 'Q-Mail', service: 'APP' },
      { name: 'Q-Tube', service: 'APP' },
    ]);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Q-Mail' }));
    expect(await screen.findByRole('menu')).toBeVisible();

    await show({ tab: false, launcherPage: true });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    act(() => {
      store.set(sortablePinnedAppsAtom, [
        { name: 'Q-Tube', service: 'APP' },
      ] as never);
    });
    await show({ tab: true, launcherPage: true });

    expect(screen.queryByRole('button', { name: 'Q-Mail' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // An empty library search starts the launcher over at the top, so the
  // menu's place on screen is gone with it.
  it('does not come back when the launcher starts over without a search', async () => {
    const { show } = await renderLauncher();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Q-Mail' }));
    expect(await screen.findByRole('menu')).toBeVisible();

    await show({ tab: false, launcherPage: true });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await show({
      tab: true,
      launcherPage: true,
      request: { nonce: 2, query: '' },
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Q-Mail' })).toBeVisible();
  });
});

// The question before a folder that holds something is deleted is a dialog
// too, outside the hidden tab: it steps aside as the menus do.
describe('the delete-folder question in a launcher tab', () => {
  it('steps aside while another tab or an app page shows, and comes back with the launcher', async () => {
    installFolder();
    const user = userEvent.setup();
    const { show } = await renderLauncher();
    await askToDeleteFolder(user);

    // A Q-App in a background tab opens a new tab, say.
    await show({ tab: false, launcherPage: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // A page link then opens an app's page in this tab.
    await show({ tab: true, launcherPage: false });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Back on the launcher page, the question is there as it was left.
    await show({ tab: true, launcherPage: true });
    expect(
      await screen.findByRole('dialog', {
        name: 'core:bookmarks.delete_folder_title',
      })
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'core:action.cancel' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Travel · 1' })).toBeVisible();
  });

  it('is closed when the launcher starts over, and the folder is kept', async () => {
    installFolder();
    const user = userEvent.setup();
    const { show } = await renderLauncher();
    await askToDeleteFolder(user);

    await show({ tab: false, launcherPage: true });
    await show({
      tab: true,
      launcherPage: true,
      request: { nonce: 2, query: '' },
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Travel · 1' })).toBeVisible();
    // It is not waiting out of sight either: a tab switch doesn't bring it
    // back.
    await show({ tab: false, launcherPage: true });
    await show({ tab: true, launcherPage: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
