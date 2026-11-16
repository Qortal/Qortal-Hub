import { ThemeProvider } from '@mui/material/styles';
import { act, render, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
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
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

// Only the tabs are under test: the pages behind them are left out.
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

/** The tabs and the selected one, as the top bar last heard of them. */
let nav: { tabs: any[]; selectedTab: any } = { tabs: [], selectedTab: null };
const recordNav = (event: CustomEvent) => {
  nav = {
    tabs: event.detail?.data?.tabs ?? [],
    selectedTab: event.detail?.data?.selectedTab ?? null,
  };
};
const tabNames = () => nav.tabs.map((tab) => tab.name);
const selectedName = () => nav.selectedTab?.name ?? null;

/** What the snackbar was asked to say. */
let snacks: string[] = [];
const recordSnack = (event: CustomEvent) => {
  snacks.push(String(event.detail?.message ?? ''));
};

/** Room for a busy test machine: the top bar hears of tabs after 100 ms. */
const SLOW = { timeout: 3000 };
const LIMIT_REACHED =
  'Maximum number of tabs reached. Close one to open another.';
const TEN_APPS = Array.from({ length: 10 }, (_, index) => `App ${index}`);

const openTabs = async (...names: string[]) => {
  for (const name of names) {
    act(() => {
      executeEvent('addTab', { data: { name, service: 'APP' } });
    });
    await waitFor(() => expect(selectedName()).toBe(name), SLOW);
  }
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
  nav = { tabs: [], selectedTab: null };
  snacks = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  subscribeToEvent('setTabsToNav', recordNav);
  subscribeToEvent('openGlobalSnackBar', recordSnack);
  render(
    <Provider store={createStore()}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
});

afterEach(() => {
  unsubscribeFromEvent('setTabsToNav', recordNav);
  unsubscribeFromEvent('openGlobalSnackBar', recordSnack);
  vi.unstubAllGlobals();
});

describe('opening an app that is open already', () => {
  it('switches to its tab, even when every tab is in use', async () => {
    await openTabs(...TEN_APPS);

    act(() => {
      executeEvent('addTab', {
        data: { name: 'app 4', navigateIfAlreadyOpen: true, service: 'APP' },
      });
    });

    await waitFor(() => expect(selectedName()).toBe('App 4'), SLOW);
    expect(tabNames()).toEqual(TEN_APPS);
    expect(snacks).toEqual([]);
  });

  it('still opens no new tab past the limit', async () => {
    await openTabs(...TEN_APPS);

    act(() => {
      executeEvent('addTab', {
        data: { name: 'Q-Mail', navigateIfAlreadyOpen: true, service: 'APP' },
      });
    });

    await waitFor(() => expect(snacks).toEqual([LIMIT_REACHED]), SLOW);
    expect(tabNames()).toEqual(TEN_APPS);
    expect(selectedName()).toBe('App 9');
  });
});

describe('opening a resource of an app', () => {
  const selectedTab = () => nav.selectedTab ?? null;
  const tabOf = (identifier?: string) =>
    nav.tabs.find(
      (tab) => tab.name === 'Example' && tab.identifier === identifier
    );

  /** Example's beta resource in a tab, then Q-Mail on screen. */
  const openBetaThenMail = async () => {
    act(() => {
      executeEvent('addTab', {
        data: { identifier: 'beta', name: 'Example', service: 'APP' },
      });
    });
    await waitFor(() => expect(tabOf('beta')).toBeTruthy(), SLOW);
    await openTabs('Q-Mail');
    return tabOf('beta');
  };

  it('opens the default resource in a new tab, not in the tab of another', async () => {
    const beta = await openBetaThenMail();

    act(() => {
      executeEvent('addTab', {
        data: { name: 'Example', navigateIfAlreadyOpen: true, service: 'APP' },
      });
    });

    await waitFor(() => expect(nav.tabs).toHaveLength(3), SLOW);
    expect(selectedTab()?.name).toBe('Example');
    expect(selectedTab()?.identifier).toBeUndefined();
    expect(selectedTab()?.tabId).not.toBe(beta.tabId);
    expect(tabOf('beta')?.tabId).toBe(beta.tabId);
  });

  it('switches to the tab that shows the same resource', async () => {
    const beta = await openBetaThenMail();

    act(() => {
      executeEvent('addTab', {
        data: {
          identifier: 'beta',
          name: 'example',
          navigateIfAlreadyOpen: true,
          service: 'APP',
        },
      });
    });

    await waitFor(() => expect(selectedTab()?.tabId).toBe(beta.tabId), SLOW);
    expect(nav.tabs).toHaveLength(2);
  });

  it.each([undefined, '', 'null', 'default'])(
    'counts a tab with identifier %j as the default resource',
    async (identifier) => {
      act(() => {
        executeEvent('addTab', {
          data: { identifier, name: 'Example', service: 'APP' },
        });
      });
      await waitFor(() => expect(selectedName()).toBe('Example'), SLOW);
      const example = selectedTab();
      await openTabs('Q-Mail');

      act(() => {
        executeEvent('addTab', {
          data: {
            name: 'Example',
            navigateIfAlreadyOpen: true,
            service: 'APP',
          },
        });
      });

      await waitFor(
        () => expect(selectedTab()?.tabId).toBe(example.tabId),
        SLOW
      );
      expect(nav.tabs).toHaveLength(2);
    }
  );
});
