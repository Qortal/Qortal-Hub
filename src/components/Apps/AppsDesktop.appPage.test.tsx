import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen, waitFor } from '@testing-library/react';
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

// Only which page shows is under test: the pages themselves are left out.
vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://node.test' }));
vi.mock('./AppsLauncher', async () => ({
  ...(await vi.importActual<typeof import('./AppsLauncher/launcherRouting')>(
    './AppsLauncher/launcherRouting'
  )),
  AppsLauncher: () => null,
}));
vi.mock('./AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('./AppInfo', () => ({
  AppInfo: ({ app }: { app: { name: string } }) => (
    <div data-testid="app-page">{app?.name}</div>
  ),
}));
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

/** The tabs and the selected one, as the top bar last heard of them. */
let selected: any = null;
let tabs: any[] = [];
const recordNav = (event: CustomEvent) => {
  selected = event.detail?.data?.selectedTab ?? null;
  tabs = event.detail?.data?.tabs ?? [];
};

/** Room for a busy test machine: the top bar hears of tabs after 100 ms. */
const SLOW = { timeout: 3000 };

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
  selected = null;
  tabs = [];
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

describe('a qortal://use-app-page link', () => {
  it("shows the page even while an app's tab is on screen", async () => {
    act(() => {
      executeEvent('addTab', { data: { name: 'Q-Tube', service: 'APP' } });
    });
    await waitFor(() => expect(selected?.name).toBe('Q-Tube'), SLOW);

    await act(async () => {
      openAppPageLink('qortal://use-app-page/APP/Q-Blog');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await screen.findByTestId('app-page')).toHaveTextContent('Q-Blog');
    // The page shows in a launcher tab of its own, in front; the app's tab
    // stays open.
    await waitFor(() => expect(selected?.internal).toBe('launcher'), SLOW);
    expect(tabs.map((tab) => tab.name ?? tab.internal)).toEqual([
      'Q-Tube',
      'launcher',
    ]);
  });
});
