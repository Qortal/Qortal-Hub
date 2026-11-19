import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { forwardRef, useState } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import { sortablePinnedAppsAtom, userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';

vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://node.test' }));
vi.mock('../Save/useSaveSettingsToQdn', () => ({
  useSaveSettingsToQdn: () => vi.fn(),
}));

// The real launcher, with its pins and their menu; the library's tabs are
// stand-ins, and the pages opened from it say which app they are about.
vi.mock('./AppsLibrary', () => {
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
vi.mock('./AppCard', () => ({
  AppCardEnhanced: ({ app }: { app: any }) => (
    <div data-testid="app-card">{app?.metadata?.title || app?.name}</div>
  ),
}));
vi.mock('./AppInfo', () => ({
  AppInfo: ({ app }: any) => <p>{`details: ${app?.name}`}</p>,
}));
vi.mock('./AppPublish', () => ({ AppPublish: () => null }));
vi.mock('./AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));
vi.mock('./AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('./AppViewerContainer', () => ({
  default: forwardRef<HTMLDivElement, any>(({ app, hide, isSelected }, ref) => (
    <div
      data-name={app?.name}
      data-shown={isSelected && !hide ? 'yes' : 'no'}
      data-testid="app-viewer"
      ref={ref}
    />
  )),
}));
vi.mock('../../hooks/useAppRatings', async () => ({
  ...(await vi.importActual<typeof import('../../hooks/useAppRatings')>(
    '../../hooks/useAppRatings'
  )),
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: () => {} }),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId: vi.fn(),
}));
vi.mock('../Desktop/CustomTitleBar', () => ({ appChromeOffsetPx: '0px' }));
vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: () => null }));

import { AppsDesktop } from './AppsDesktop';
import { openAppPageLink } from './AppPage/appPageLink';

const Harness = () => {
  const [mode, setMode] = useState('home');
  const [devMode, setDevMode] = useState('home');
  const [desktopViewMode, setDesktopViewMode] = useState('apps');
  return (
    <AppsDesktop
      desktopViewMode={desktopViewMode}
      devMode={devMode}
      mode={mode}
      setDesktopViewMode={setDesktopViewMode}
      setDevMode={setDevMode}
      setMode={setMode}
      show
    />
  );
};

const library = [
  { name: 'Q-Tube', service: 'APP', metadata: { title: 'Q-Tube' } },
  { name: 'Q-Mail', service: 'APP', metadata: { title: 'Q-Mail' } },
  { name: 'Q-Blog', service: 'APP', metadata: { title: 'Q-Blog' } },
];

const renderApps = async () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'Qaddress' } as never);
  store.set(availableQappsAtom, library);
  store.set(sortablePinnedAppsAtom, [
    { name: 'Q-Mail', service: 'APP' },
  ] as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
  await act(async () => {});
};

/** Room for a busy test machine. */
const SLOW = { timeout: 3000 };

const stripIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]')).map(
    (tab) => tab.dataset.tabId
  );
const newestTabId = () => stripIds()[stripIds().length - 1]!;
const launcherView = (tabId: string) =>
  document.querySelector<HTMLElement>(`[data-launcher-tab-id="${tabId}"]`)!;
/** The launcher tab on screen, if one is. */
const shownLauncherId = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-launcher-tab-id]')
  ).find((view) => getComputedStyle(view).display !== 'none')?.dataset
    .launcherTabId ?? null;
const shownAppName = () =>
  screen
    .queryAllByTestId('app-viewer')
    .find((viewer) => viewer.dataset.shown === 'yes')?.dataset.name ?? null;

/** A new launcher tab, on screen, with Q-Mail's right-click menu open. */
const openLauncherWithMenu = async () => {
  act(() => {
    executeEvent('newTabWindow', {});
  });
  const launcher = newestTabId();
  fireEvent.contextMenu(
    await within(launcherView(launcher)).findByRole('button', {
      name: 'Q-Mail',
    })
  );
  expect(await screen.findByRole('menu')).toBeVisible();
  return launcher;
};

/** A qortal://use-app-page link, opened from chat or the top bar. */
const openPageLink = async (name: string) => {
  await act(async () => {
    openAppPageLink(`qortal://use-app-page/APP/${name}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const realResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = realResizeObserver;
});

beforeEach(() => {
  localStorage.clear();
  delete window.appStorage;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A page link takes the launcher tab that is on its launcher page. A menu
// left open there belongs to the launcher, not to the page shown in its place.
describe('a page link that takes a launcher tab with a menu left open', () => {
  it('keeps the menu away while the page shows, and Back brings the launcher back as it was', async () => {
    await renderApps();
    const launcher = await openLauncherWithMenu();

    // Another tab shows; the menu steps aside with its launcher tab.
    act(() => {
      executeEvent('addTab', { data: { name: 'Q-Tube', service: 'APP' } });
    });
    await waitFor(() => expect(shownAppName()).toBe('Q-Tube'), SLOW);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await openPageLink('Q-Blog');

    // The page shows in the launcher tab the menu was left in.
    await waitFor(() => expect(shownLauncherId()).toBe(launcher), SLOW);
    expect(
      within(launcherView(launcher)).getByText('details: Q-Blog')
    ).toBeVisible();
    expect(screen.queryByRole('menu')).toBeNull();

    // The top bar's Back: the launcher is there as it was left, menu and all.
    act(() => {
      executeEvent('navigateBack', {});
    });
    expect(
      within(launcherView(launcher)).queryByText('details: Q-Blog')
    ).toBeNull();
    const menu = await screen.findByRole('menu');
    expect(menu).toBeVisible();
    expect(
      within(menu).getByRole('menuitem', { name: /unpin app/i })
    ).toBeVisible();

    // It still closes.
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  // A Q-App in a background tab can open a page link while the launcher tab
  // with the menu is the one on screen.
  it('keeps the menu away when the page takes the launcher tab on screen', async () => {
    await renderApps();
    const launcher = await openLauncherWithMenu();

    await openPageLink('Q-Blog');

    expect(shownLauncherId()).toBe(launcher);
    expect(
      within(launcherView(launcher)).getByText('details: Q-Blog')
    ).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // Another tab and back: still the page, still no menu.
    act(() => {
      executeEvent('addTab', { data: { name: 'Q-Tube', service: 'APP' } });
    });
    await waitFor(() => expect(shownAppName()).toBe('Q-Tube'), SLOW);
    act(() => {
      fireEvent.click(
        document.querySelector<HTMLElement>(`[data-tab-id="${launcher}"]`)!
      );
    });
    expect(shownLauncherId()).toBe(launcher);
    expect(
      within(launcherView(launcher)).getByText('details: Q-Blog')
    ).toBeVisible();
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => {
      executeEvent('navigateBack', {});
    });
    expect(await screen.findByRole('menu')).toBeVisible();
  });
});

describe('the delete-folder question in a launcher tab', () => {
  it('steps aside when a Q-App opens a tab over it, and comes back with its tab', async () => {
    // The account's bookmarks: a folder that holds one.
    const stored: Record<string, unknown> = {
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
      get: vi.fn(async (key: string) => stored[key]),
      set: vi.fn(async (key: string, value: unknown) => {
        stored[key] = value;
      }),
    } as never;
    await renderApps();
    act(() => {
      executeEvent('newTabWindow', {});
    });
    const launcher = newestTabId();
    fireEvent.contextMenu(
      await within(launcherView(launcher)).findByRole('button', {
        name: 'Travel · 1',
      })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /delete folder/i })
    );
    expect(await screen.findByRole('dialog')).toBeVisible();

    // A Q-App in a background tab opens a new tab (OPEN_NEW_TAB).
    act(() => {
      executeEvent('addTab', { data: { name: 'Q-Tube', service: 'APP' } });
    });
    await waitFor(() => expect(shownAppName()).toBe('Q-Tube'), SLOW);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => {
      fireEvent.click(
        document.querySelector<HTMLElement>(`[data-tab-id="${launcher}"]`)!
      );
    });
    expect(shownLauncherId()).toBe(launcher);
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
});
