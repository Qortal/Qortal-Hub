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
// The shared i18n instance: the launcher shows the language chosen here.
import i18n from '../../i18n/i18n';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import { sortablePinnedAppsAtom, userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';

vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://node.test' }));
vi.mock('../Save/useSaveSettingsToQdn', () => ({
  useSaveSettingsToQdn: () => vi.fn(),
}));

// The real launcher, with its Pinned section and the tiles' menu; the
// library's tabs are stand-ins.
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
  default: forwardRef<HTMLDivElement, any>(({ app }, ref) => (
    <div data-name={app?.name} data-testid="app-viewer" ref={ref} />
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

// The account's name has a Q-App and a website; only Q-Mail is pinned.
const library = [
  { name: 'Q-Tube', service: 'APP', metadata: { title: 'Q-Tube' } },
  { name: 'Q-Mail', service: 'APP', metadata: { title: 'Q-Mail' } },
  {
    name: 'Publisher',
    service: 'WEBSITE',
    metadata: { title: 'Publisher Website' },
  },
  { name: 'Publisher', service: 'APP', metadata: { title: 'Publisher App' } },
];
const OWN_FIRST = ['Publisher App', 'Publisher Website', 'Q-Mail'];

let store: ReturnType<typeof createStore>;

const renderApps = async () => {
  store = createStore();
  store.set(userInfoAtom, { address: 'Qaddress', name: 'Publisher' } as never);
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
const launcherView = (tabId: string) =>
  document.querySelector<HTMLElement>(`[data-launcher-tab-id="${tabId}"]`)!;

/** Opens a launcher tab, as the + does, and gives its id. */
const openLauncher = () => {
  act(() => {
    executeEvent('newTabWindow', {});
  });
  return stripIds()[stripIds().length - 1]!;
};

/** The tiles of the launcher's Pinned section, in order, by their names. */
const pinnedTiles = (launcher: string) =>
  Array.from(
    launcherView(launcher).querySelectorAll<HTMLElement>(
      '[aria-roledescription="sortable"]'
    )
  ).map((tile) => tile.textContent);

/** A menu item's name in Hub's language now. */
const menuLabel = (key: string) =>
  i18n.t(key, { postProcess: 'capitalizeFirstChar' });

/** Whether a tile's right-click menu offers to unpin it. */
const offersUnpin = async (launcher: string, tileName: string) => {
  fireEvent.contextMenu(
    within(launcherView(launcher)).getByRole('button', { name: tileName })
  );
  const menu = await screen.findByRole('menu');
  expect(
    within(menu).getByRole('menuitem', {
      name: menuLabel('core:action.open'),
    })
  ).toBeVisible();
  const unpin = within(menu).queryByRole('menuitem', {
    name: menuLabel('core:action.unpin_app'),
  });
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return unpin !== null;
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

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

// A service is APP or WEBSITE whatever Hub's language is; the launcher finds
// the account's own app and website by it.
describe('the account’s own app and website in the launcher’s Pinned section', () => {
  it.each(['es', 'de'])(
    'come first, and cannot be unpinned, with Hub in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      await renderApps();
      const launcher = openLauncher();

      await waitFor(
        () => expect(pinnedTiles(launcher)).toEqual(OWN_FIRST),
        SLOW
      );
      expect(await offersUnpin(launcher, 'Publisher App')).toBe(false);
      expect(await offersUnpin(launcher, 'Publisher Website')).toBe(false);
      // A pin of its own: the menu item is there, under the name looked for.
      expect(await offersUnpin(launcher, 'Q-Mail')).toBe(true);
    }
  );

  it('stay first when the language changes and the library is read again', async () => {
    await i18n.changeLanguage('en');
    await renderApps();
    const launcher = openLauncher();
    await waitFor(() => expect(pinnedTiles(launcher)).toEqual(OWN_FIRST), SLOW);

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    // The library is read again, with Q-Mail's new title.
    act(() => {
      store.set(
        availableQappsAtom,
        library.map((app) =>
          app.name === 'Q-Mail'
            ? { ...app, metadata: { title: 'Q-Mail 2' } }
            : app
        )
      );
    });

    await waitFor(
      () => expect(pinnedTiles(launcher)).toContain('Q-Mail 2'),
      SLOW
    );
    expect(pinnedTiles(launcher)).toEqual([
      'Publisher App',
      'Publisher Website',
      'Q-Mail 2',
    ]);
  });
});
