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
const tab = (name: string) => nav.tabs.find((item) => item.name === name);

/** Room for a busy test machine: the top bar hears of tabs after 100 ms. */
const SLOW = { timeout: 3000 };

const openTabs = async (...names: string[]) => {
  for (const name of names) {
    act(() => {
      executeEvent('addTab', { data: { name, service: 'APP' } });
    });
    await waitFor(() => expect(selectedName()).toBe(name), SLOW);
  }
};

const select = async (name: string) => {
  act(() => {
    executeEvent('setSelectedTab', { data: tab(name) });
  });
  await waitFor(() => expect(selectedName()).toBe(name), SLOW);
};

const close = (name: string) =>
  act(() => {
    executeEvent('removeTab', { data: tab(name) });
  });

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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  subscribeToEvent('setTabsToNav', recordNav);
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
  vi.unstubAllGlobals();
});

describe('closing a tab after selecting another', () => {
  it('keeps the tab on screen when a tab behind it is closed', async () => {
    await openTabs('Q-Mail', 'Torq', 'Q-Share');
    await select('Q-Mail');

    close('Torq');

    await waitFor(
      () => expect(tabNames()).toEqual(['Q-Mail', 'Q-Share']),
      SLOW
    );
    expect(selectedName()).toBe('Q-Mail');
  });

  it('shows the most recently viewed tab when the tab on screen is closed', async () => {
    await openTabs('Q-Mail', 'Torq', 'Q-Share');
    await select('Torq');
    await select('Q-Mail');

    close('Q-Mail');

    await waitFor(() => expect(tabNames()).toEqual(['Torq', 'Q-Share']), SLOW);
    expect(selectedName()).toBe('Torq');
  });
});
