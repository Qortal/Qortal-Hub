import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import {
  sortablePinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
} from '../../atoms/global';
import { useState } from 'react';
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
import type { TabShortcutAction } from '../../../electron/src/tab-shortcuts';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

const { clearSessionPermissionsByTabId } = vi.hoisted(() => ({
  clearSessionPermissionsByTabId: vi.fn(),
}));

// Only the tab strip is under test: the pages behind the tabs are left out.
vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://node.test' }));
vi.mock('./AppsLauncher', async () => ({
  ...(await vi.importActual<typeof import('./AppsLauncher/launcherRouting')>(
    './AppsLauncher/launcherRouting'
  )),
  AppsLauncher: () => null,
}));
vi.mock('./AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('./AppInfo', () => ({ AppInfo: () => null }));
vi.mock('./AppPublish', () => ({ AppPublish: () => null }));
vi.mock('./AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));
vi.mock('./AppViewerContainer', () => ({ default: () => null }));
vi.mock('../../hooks/useAppRatings', () => ({
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: () => {} }),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId,
}));
vi.mock('../Desktop/CustomTitleBar', () => ({
  appChromeOffsetPx: '0px',
  appHeighOffsetPx: '0px',
}));

import { AppsDesktop } from './AppsDesktop';
import {
  isPinnedApp,
  isSamePinnedApp,
  pinnedAppOfTab,
} from '../../hooks/usePinnedApps';

describe('pinnedAppOfTab', () => {
  it('pins a Q-App or website by its name and service', () => {
    expect(pinnedAppOfTab({ name: 'Q-Tube', service: 'app' })).toEqual({
      name: 'Q-Tube',
      service: 'APP',
    });
  });

  it('pins a private app by its full properties', () => {
    expect(
      pinnedAppOfTab({
        isPrivate: true,
        privateAppProperties: {
          name: 'Publisher',
          service: 'DOCUMENT',
          identifier: 'tool',
        },
      })
    ).toEqual({
      isPrivate: true,
      isPreview: true,
      privateAppProperties: {
        name: 'Publisher',
        service: 'DOCUMENT',
        identifier: 'tool',
      },
    });
  });

  it('pins nothing for Hub’s own tabs, or a private app it can’t name', () => {
    expect(pinnedAppOfTab({ internal: 'launcher', tabId: 't1' })).toBeNull();
    expect(pinnedAppOfTab({ name: 'x', service: 'INTERNAL' })).toBeNull();
    expect(
      pinnedAppOfTab({
        isPrivate: true,
        privateAppProperties: { name: 'Publisher', service: 'DOCUMENT' },
      })
    ).toBeNull();
    expect(pinnedAppOfTab(null)).toBeNull();
  });

  it('finds an app among the pinned ones whatever the case of its name', () => {
    const app = pinnedAppOfTab({ name: 'q-tube', service: 'APP' });
    expect(isSamePinnedApp({ name: 'Q-Tube', service: 'app' }, app)).toBe(true);
    expect(isPinnedApp([{ name: 'Q-Mail', service: 'APP' }], app)).toBe(false);
  });
});

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

let store: ReturnType<typeof createStore>;
const renderStrip = () => {
  store = createStore();
  store.set(sortablePinnedAppsAtom, []);
  return render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
};

const openTab = (name: string) =>
  act(() => {
    executeEvent('addTab', { data: { name, service: 'APP' } });
  });
const tabNamed = (name: string) => screen.getByRole('button', { name });
const menuItemNames = () =>
  screen.getAllByRole('menuitem').map((item) => item.textContent);
const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  tabName: string,
  item: string
) => {
  fireEvent.contextMenu(tabNamed(tabName));
  await user.click(screen.getByRole('menuitem', { name: item }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
};
const pinnedGroup = () =>
  document.querySelector<HTMLElement>('[data-tab-group="pinned"]');

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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  vi.stubGlobal('electronAPI', { onTabShortcut: () => () => {} });
});

afterEach(async () => {
  // Any late update to the top bar fires while the page is still there.
  await new Promise((resolve) => setTimeout(resolve, 500));
  vi.unstubAllGlobals();
});

describe('a tab’s menu: Pin to bookmarks', () => {
  it('pins the tab’s app to the bookmarks, and unpins it again', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');

    fireEvent.contextMenu(tabNamed('Q-Tube'));
    expect(menuItemNames()).toEqual([
      'Pin tab',
      'Pin to bookmarks',
      'Duplicate tab',
      'Close other tabs',
      'Close tabs to the right',
      'Close all tabs',
    ]);
    await user.click(
      screen.getByRole('menuitem', { name: 'Pin to bookmarks' })
    );

    expect(store.get(sortablePinnedAppsAtom)).toEqual([
      { name: 'Q-Tube', service: 'APP' },
    ]);
    // Kept for the next save to QDN, as the top bar's Pin app keeps it.
    expect(store.get(settingsLocalLastUpdatedAtom)).toBeGreaterThan(0);
    // A pin in the bookmarks isn't a pinned tab.
    expect(pinnedGroup()).toBeNull();

    await choose(user, 'Q-Tube', 'Unpin from bookmarks');
    expect(store.get(sortablePinnedAppsAtom)).toEqual([]);
  });

  it('says Unpin from bookmarks for an app already pinned there', () => {
    renderStrip();
    act(() => {
      store.set(sortablePinnedAppsAtom, [{ name: 'q-tube', service: 'APP' }]);
    });
    openTab('Q-Tube');

    fireEvent.contextMenu(tabNamed('Q-Tube'));

    expect(
      screen.getByRole('menuitem', { name: 'Unpin from bookmarks' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Pin to bookmarks' })
    ).toBeNull();
  });

  it('leaves the bookmarks alone when the tab itself is pinned', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');

    await choose(user, 'Q-Tube', 'Pin tab');

    expect(pinnedGroup()).not.toBeNull();
    expect(store.get(sortablePinnedAppsAtom)).toEqual([]);
  });

  it('isn’t offered for a launcher tab', () => {
    renderStrip();
    act(() => {
      executeEvent('newTabWindow', {});
    });
    // The launcher tab (the strip's + is called New tab too).
    const launcher = document.querySelector<HTMLElement>('[data-tab-id]')!;
    expect(launcher).toHaveAccessibleName('New tab');

    fireEvent.contextMenu(launcher);

    expect(
      screen.queryByRole('menuitem', { name: 'Pin to bookmarks' })
    ).toBeNull();
  });
});
