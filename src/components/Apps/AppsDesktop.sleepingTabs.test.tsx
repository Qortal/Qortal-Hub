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
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
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
import { navigationControllerAtom, userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import { buildQortalResourceLink } from '../../utils/qortalLink';

/** Apps whose webview says sound is playing, by name. */
const audible = vi.hoisted(() => new Set<string>());
const { clearSessionPermissionsByTabId, openPrivateApp } = vi.hoisted(() => ({
  clearSessionPermissionsByTabId: vi.fn(),
  // A private app being downloaded and decrypted again, for as long as a
  // test needs.
  openPrivateApp: vi.fn(() => new Promise(() => {})),
}));

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
// A loaded app: its webview, which says whether sound is playing in it.
vi.mock('./AppViewerContainer', () => ({
  default: forwardRef<unknown, any>(({ app }, ref) => {
    useImperativeHandle(ref, () => ({
      isCurrentlyAudible: () => audible.has(app?.name),
    }));
    return (
      <div
        data-name={app?.name}
        data-path={app?.path ?? ''}
        data-tabid={app?.tabId}
        data-testid="app-viewer"
      />
    );
  }),
}));
vi.mock('../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: openPrivateApp }),
}));
vi.mock('../../hooks/useAppRatings', () => ({
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: () => {} }),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId,
}));
vi.mock('../Desktop/CustomTitleBar', () => ({ appChromeOffsetPx: '0px' }));
vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: () => null }));

import { AppsDesktop } from './AppsDesktop';
import {
  forgetTabActivity,
  isTabBusy,
  noteTabFileSave,
  trackTabRequest,
} from './tabActivity';

const Harness = () => {
  const [mode, setMode] = useState('home');
  const [devMode, setDevMode] = useState('home');
  const [desktopViewMode, setDesktopViewMode] = useState('apps');
  // Home and apps mode, switched as Group does.
  useEffect(() => {
    const toApps = () => setDesktopViewMode('apps');
    subscribeToEvent('open-apps-mode', toApps);
    return () => unsubscribeFromEvent('open-apps-mode', toApps);
  }, []);
  return (
    <AppsDesktop
      desktopViewMode={desktopViewMode}
      devMode={devMode}
      mode={mode}
      renderInternalTab={({ tab }) =>
        tab?.internal === QCHAT_INTERNAL_TAB_ID ? (
          <div data-testid="q-chat" />
        ) : null
      }
      setDesktopViewMode={setDesktopViewMode}
      setDevMode={setDevMode}
      setMode={setMode}
      show
    />
  );
};

let store: ReturnType<typeof createStore>;

const renderApps = (address?: string) => {
  store = createStore();
  if (address) store.set(userInfoAtom, { address } as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
};

const LIMIT_REACHED =
  'Maximum number of tabs reached. Close one to open another.';
const names = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `App ${from + i}`);

const openApp = (name: string, extra: Record<string, unknown> = {}) =>
  act(() => {
    executeEvent('addTab', { data: { name, service: 'APP', ...extra } });
  });
const openApps = (list: string[]) => list.forEach((name) => openApp(name));

const tabButton = (name: string) =>
  document.querySelector<HTMLElement>(`[data-tab-id][aria-label="${name}"]`)!;
const tabIdOf = (name: string) => tabButton(name).dataset.tabId!;
const select = (name: string) =>
  act(() => {
    fireEvent.click(tabButton(name));
  });
const isAsleep = (name: string) => tabButton(name).dataset.asleep === 'true';
const strip = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]')).map(
    (tab) => tab.getAttribute('aria-label')
  );
const loaded = () =>
  screen.queryAllByTestId('app-viewer').map((viewer) => viewer.dataset.name);
const asleep = () => strip().filter((name) => isAsleep(name!));
const viewerOf = (name: string) =>
  screen
    .queryAllByTestId('app-viewer')
    .find((viewer) => viewer.dataset.name === name);

/** The app in the tab says it shows `path` now, as Core reports it. */
const reportPage = (name: string, path: string) =>
  act(() => {
    store.set(navigationControllerAtom, (prev) => ({
      ...prev,
      [tabIdOf(name)]: {
        currentLink: buildQortalResourceLink({ service: 'APP', name, path }),
        hasBack: false,
        hasForward: false,
      },
    }));
  });

let notes: string[] = [];
const recordNote = (event: CustomEvent) => notes.push(event.detail?.message);
/** Tabs whose activity a test made up, forgotten after it. */
let busyTabIds: string[] = [];

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
  notes = [];
  busyTabIds = [];
  audible.clear();
  clearSessionPermissionsByTabId.mockClear();
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  subscribeToEvent('openGlobalSnackBar', recordNote);
});

afterEach(() => {
  busyTabIds.forEach(forgetTabActivity);
  unsubscribeFromEvent('openGlobalSnackBar', recordNote);
  vi.unstubAllGlobals();
});

describe('sleeping tabs: which tab sleeps', () => {
  it('keeps ten apps loaded, all awake', () => {
    renderApps();
    openApps(names(1, 10));

    expect(loaded()).toHaveLength(10);
    expect(asleep()).toEqual([]);
  });

  it('puts the app viewed least recently to sleep when an eleventh loads', () => {
    renderApps();
    openApps(names(1, 10));
    // App 1 is viewed again: App 2 is now the one viewed longest ago.
    select('App 1');

    openApp('App 11');

    expect(loaded()).toHaveLength(10);
    expect(loaded()).toContain('App 1');
    expect(loaded()).not.toContain('App 2');
    expect(asleep()).toEqual(['App 2']);
    // It stays in the strip where it was.
    expect(strip()).toEqual(names(1, 11));
  });

  it('keeps what the tab was allowed until it closes', () => {
    renderApps();
    openApps(names(1, 11));

    expect(asleep()).toEqual(['App 1']);
    expect(clearSessionPermissionsByTabId).not.toHaveBeenCalled();
  });

  it('opens 50 tabs with ten apps loaded, and no 51st', async () => {
    renderApps();
    openApps(names(1, 50));

    expect(strip()).toHaveLength(50);
    expect(loaded()).toEqual(names(41, 50));
    expect(asleep()).toEqual(names(1, 40));

    openApp('App 51');

    expect(strip()).toHaveLength(50);
    expect(strip()).not.toContain('App 51');
    await waitFor(() => expect(notes).toEqual([LIMIT_REACHED]));
    // Fifty tabs take a few seconds to open on a busy test machine.
  }, 20_000);
});

describe('sleeping tabs: waking', () => {
  it('loads a sleeping tab again at the page its app showed last', () => {
    renderApps();
    openApps(names(1, 10));
    reportPage('App 1', '/video/abc?t=5');

    openApp('App 11');
    expect(asleep()).toEqual(['App 1']);

    select('App 1');

    expect(viewerOf('App 1')?.dataset.path).toBe('video/abc?t=5');
    expect(isAsleep('App 1')).toBe(false);
    // Loading it put the next one viewed least recently to sleep.
    expect(asleep()).toEqual(['App 2']);
    expect(loaded()).toHaveLength(10);
  });

  it('loads an app that never said where it is at the page it was opened at', () => {
    renderApps();
    openApp('App 1', { path: 'start/page' });
    openApps(names(2, 11));
    expect(asleep()).toEqual(['App 1']);

    select('App 1');

    expect(viewerOf('App 1')?.dataset.path).toBe('start/page');
  });

  it('keeps that page for the next start while the woken app loads', () => {
    renderApps('QAlice');
    openApps(names(1, 10));
    reportPage('App 1', '/inbox/7');
    openApp('App 11');
    select('App 1');
    // Loaded again, the app shows its start link until it says where it is.
    reportPage('App 1', '');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    const saved = JSON.parse(localStorage.getItem('ext_open_tabs:QAlice')!);
    expect(saved.tabs.find((tab) => tab.tabId === tabIdOf('App 1'))?.path).toBe(
      'inbox/7'
    );
  });

  it('shows a restored tab asleep until it is selected', () => {
    localStorage.setItem(
      'ext_open_tabs:QAlice',
      JSON.stringify({
        version: 1,
        selectedTabId: null,
        tabs: [
          { tabId: 'r1', service: 'APP', name: 'App 1' },
          { tabId: 'r2', service: 'APP', name: 'App 2' },
        ],
      })
    );
    renderApps('QAlice');
    expect(asleep()).toEqual(['App 1', 'App 2']);

    select('App 2');

    expect(asleep()).toEqual(['App 1']);
    expect(loaded()).toEqual(['App 2']);
  });

  it("doesn't show the tab on screen asleep while its private app is decrypted again", async () => {
    localStorage.setItem(
      'ext_open_tabs:QAlice',
      JSON.stringify({
        version: 1,
        selectedTabId: null,
        tabs: [
          {
            tabId: 'p1',
            service: 'DOCUMENT',
            name: 'Publisher',
            identifier: 'app-id',
            isPrivate: true,
            privateAppProperties: {
              service: 'DOCUMENT',
              name: 'Publisher',
              identifier: 'app-id',
            },
          },
        ],
      })
    );
    renderApps('QAlice');
    expect(asleep()).toEqual(['Publisher']);

    select('Publisher');

    await waitFor(() => expect(openPrivateApp).toHaveBeenCalled());
    expect(loaded()).toEqual([]);
    expect(asleep()).toEqual([]);
  });
});

describe('sleeping tabs: tabs that stay awake', () => {
  // App 1 is the one viewed least recently, so without this it would sleep.
  it.each([
    [
      'its app asked to confirm closing it',
      (tabId: string) =>
        executeEvent('addLock', { data: { tabId, lockMessage: '' } }),
    ],
    [
      'its app waits for an answer from Hub',
      (tabId: string) => trackTabRequest(tabId, new Promise(() => {})),
    ],
    [
      'its app is saving a file',
      (tabId: string) => noteTabFileSave(tabId, 'save-1', 'open'),
    ],
    ['sound plays in it', () => audible.add('App 1')],
  ])('keeps a tab awake while %s', (_case, makeBusy) => {
    renderApps();
    openApps(names(1, 10));
    busyTabIds.push(tabIdOf('App 1'));
    act(() => {
      makeBusy(tabIdOf('App 1'));
    });

    openApp('App 11');

    expect(loaded()).toContain('App 1');
    expect(asleep()).toEqual(['App 2']);
  });

  it('never puts a private app to sleep', () => {
    renderApps();
    openApp('Private', {
      isPreview: true,
      isPrivate: true,
      privateAppProperties: {
        service: 'DOCUMENT',
        name: 'Publisher',
        identifier: 'app-id',
        appName: 'Private',
      },
      url: 'http://node.test/render/hash/abc',
    });
    openApps(names(2, 11));

    expect(loaded()).toContain('Private');
    expect(asleep()).toEqual(['App 2']);
  });

  it("doesn't count launcher tabs or Q-Chat's tab", () => {
    renderApps();
    openApps(names(1, 9));
    act(() => {
      executeEvent('newTabWindow', {});
    });
    act(() => {
      executeEvent('addTab', {
        data: {
          internal: QCHAT_INTERNAL_TAB_ID,
          name: 'Q-Chat',
          service: 'INTERNAL',
        },
      });
    });
    openApp('App 10');

    expect(asleep()).toEqual([]);
    expect(loaded()).toHaveLength(10);
    expect(screen.getByTestId('q-chat')).toBeInTheDocument();

    openApp('App 11');
    expect(asleep()).toEqual(['App 1']);
  });

  it('keeps ten apps loaded when an app opens in a launcher tab', () => {
    renderApps();
    openApps(names(1, 10));
    act(() => {
      executeEvent('newTabWindow', {});
    });
    const launcherTabId = document.querySelector<HTMLElement>(
      '[data-tab-id][aria-label="New tab"]'
    )!.dataset.tabId;

    // The app chosen in it takes its place, with its tab id.
    openApp('App 11', { fromLauncherTabId: launcherTabId });

    expect(tabIdOf('App 11')).toBe(launcherTabId);
    expect(loaded()).toHaveLength(10);
    expect(asleep()).toEqual(['App 1']);
  });

  it("doesn't count a private app that couldn't be reopened as loaded", async () => {
    openPrivateApp.mockImplementationOnce(() =>
      Promise.reject(new Error('could not reopen'))
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(
      'ext_open_tabs:QAlice',
      JSON.stringify({
        version: 1,
        selectedTabId: null,
        tabs: [
          {
            tabId: 'p1',
            service: 'DOCUMENT',
            name: 'Publisher',
            identifier: 'app-id',
            isPrivate: true,
            privateAppProperties: {
              service: 'DOCUMENT',
              name: 'Publisher',
              identifier: 'app-id',
            },
          },
        ],
      })
    );
    renderApps('QAlice');
    select('Publisher');
    await waitFor(() => expect(errors).toHaveBeenCalled());

    openApps(names(1, 10));

    expect(loaded()).toEqual(names(1, 10));
    expect(asleep()).toEqual(['Publisher']);
    errors.mockRestore();
  });

  it('lets more load when none can sleep, and puts one to sleep at the next tab change once it can', async () => {
    renderApps();
    openApps(names(1, 10));
    const answers = names(1, 10).map((name) => {
      const tabId = tabIdOf(name);
      busyTabIds.push(tabId);
      let answer: () => void = () => undefined;
      const request = new Promise<void>((resolve) => {
        answer = resolve;
      });
      trackTabRequest(tabId, request);
      return { answer, request };
    });

    openApp('App 11');
    expect(loaded()).toHaveLength(11);
    expect(asleep()).toEqual([]);

    answers[0].answer();
    await act(async () => {
      await answers[0].request;
    });
    select('App 5');

    expect(asleep()).toEqual(['App 1']);
    expect(loaded()).toHaveLength(10);
  });
});

describe('sleeping tabs: closing', () => {
  it('closes a sleeping tab without loading it', () => {
    renderApps();
    openApps(names(1, 11));
    expect(asleep()).toEqual(['App 1']);

    act(() => {
      fireEvent.click(
        within(tabButton('App 1')).getByRole('button', { name: 'Close tab' })
      );
    });

    expect(strip()).toEqual(names(2, 11));
    expect(loaded()).not.toContain('App 1');
  });

  it('forgets what a closed tab was doing', () => {
    renderApps();
    openApps(names(1, 3));
    const tabId = tabIdOf('App 2');
    busyTabIds.push(tabId);
    trackTabRequest(tabId, new Promise(() => {}));
    expect(isTabBusy(tabId)).toBe(true);

    act(() => {
      fireEvent.click(
        within(tabButton('App 2')).getByRole('button', { name: 'Close tab' })
      );
    });

    expect(isTabBusy(tabId)).toBe(false);
  });
});
