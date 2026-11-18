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
import { forwardRef, useEffect, useState } from 'react';
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
import { availableQappsAtom, hiddenAppsAtom } from '../../atoms/appsAtoms';
import { appsSubPageCanGoBackAtom, userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://node.test' }));

// A launcher with a search box of its own and a way to each of its pages,
// opening what it opens the way the real one does: in its launcher tab.
vi.mock('./AppsLauncher', async () => {
  const React = await import('react');
  const events = await import('../../utils/events');
  const { inLauncherTab, useLauncherTabId } = await import('./launcherTabs');
  const routing = await vi.importActual<
    typeof import('./AppsLauncher/launcherRouting')
  >('./AppsLauncher/launcherRouting');
  const AppsLauncher = ({ allQapps, isShow, request, setMode }: any) => {
    const launcherTabId = useLauncherTabId();
    const [query, setQuery] = React.useState('');
    const handledNonce = React.useRef<number | null>(null);
    // As the real one: a new request starts it over with its search.
    React.useEffect(() => {
      if (!isShow || handledNonce.current === request?.nonce) return;
      handledNonce.current = request?.nonce ?? 0;
      setQuery(request?.query ?? '');
    }, [isShow, request?.nonce]);
    return (
      <div
        data-pin-apps={(allQapps ?? []).map((app: any) => app.name).join()}
        data-testid="launcher"
        hidden={!isShow}
      >
        <input
          aria-label="search"
          onChange={(event) => setQuery(event.target.value)}
          value={query}
        />
        <button onClick={() => setMode('publish-app')}>publish an app</button>
        <button
          onClick={() =>
            events.executeEvent('selectedAppInfo', {
              data: { name: 'Q-Mail', service: 'APP' },
            })
          }
        >
          details of Q-Mail
        </button>
        <button
          onClick={() =>
            events.executeEvent('addTab', {
              data: inLauncherTab(
                { name: 'Q-Tube', service: 'APP' },
                launcherTabId
              ),
            })
          }
        >
          open Q-Tube
        </button>
      </div>
    );
  };
  return { ...routing, AppsLauncher };
});
// A publish form with one field, telling its tab when it holds input, and
// opening the app once published, as the real one does.
vi.mock('./AppPublish', async () => {
  const React = await import('react');
  const events = await import('../../utils/events');
  const { inLauncherTab, useLauncherTabId } = await import('./launcherTabs');
  return {
    AppPublish: ({ onUnsavedChange }: any) => {
      const launcherTabId = useLauncherTabId();
      const [title, setTitle] = React.useState('');
      React.useEffect(() => () => onUnsavedChange?.(false), []);
      return (
        <>
          <input
            aria-label="publish title"
            onChange={(event) => {
              setTitle(event.target.value);
              onUnsavedChange?.(true);
            }}
            value={title}
          />
          <button
            onClick={() => {
              onUnsavedChange?.(false);
              events.executeEvent('addTab', {
                data: inLauncherTab(
                  { name: 'My-App', service: 'APP' },
                  launcherTabId
                ),
              });
            }}
          >
            publish
          </button>
        </>
      );
    },
  };
});
vi.mock('./AppInfo', () => ({
  AppInfo: ({ app }: any) => <p>{`details: ${app?.name}`}</p>,
}));
vi.mock('./AppsCategoryDesktop', () => ({
  AppsCategoryDesktop: ({ category, isShow }: any) => (
    <p hidden={!isShow}>{`category: ${category?.name}`}</p>
  ),
}));
vi.mock('./AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('./AppViewerContainer', () => ({
  default: forwardRef<HTMLDivElement, any>(({ app, hide, isSelected }, ref) => (
    <div
      data-name={app?.name}
      data-shown={isSelected && !hide ? 'yes' : 'no'}
      data-tabid={app?.tabId}
      data-testid="app-viewer"
      ref={ref}
    />
  )),
}));
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
import { appKey } from './AppPage/appHidden';

const Harness = () => {
  const [mode, setMode] = useState('home');
  const [devMode, setDevMode] = useState('home');
  const [desktopViewMode, setDesktopViewMode] = useState('apps');
  // Home and apps mode, switched as Group does.
  useEffect(() => {
    const toApps = () => setDesktopViewMode('apps');
    const toHome = () => setDesktopViewMode('home');
    subscribeToEvent('open-apps-mode', toApps);
    subscribeToEvent('open-home-mode', toHome);
    return () => {
      unsubscribeFromEvent('open-apps-mode', toApps);
      unsubscribeFromEvent('open-home-mode', toHome);
    };
  }, []);
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

const NEW_TAB = 'New tab';
/** Room for a busy test machine. */
const SLOW = { timeout: 3000 };

/** The strip's tabs, in order, by their names. */
const stripNames = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]')).map(
    (tab) => tab.getAttribute('aria-label')
  );
const stripIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]')).map(
    (tab) => tab.dataset.tabId
  );
const plusButton = () =>
  screen
    .getAllByRole('button', { name: NEW_TAB })
    .find((button) => !button.dataset.tabId)!;
const tabButton = (tabId: string) =>
  document.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)!;
const launcherView = (tabId: string) =>
  document.querySelector<HTMLElement>(`[data-launcher-tab-id="${tabId}"]`);
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
const inLauncher = (tabId: string) => within(launcherView(tabId)!);

const openApp = (name: string, extra: Record<string, unknown> = {}) =>
  act(() => {
    executeEvent('addTab', { data: { name, service: 'APP', ...extra } });
  });
const selectTab = (tabId: string) =>
  act(() => {
    fireEvent.click(tabButton(tabId));
  });
const closeTab = (tabId: string) =>
  act(() => {
    fireEvent.click(
      within(tabButton(tabId)).getByRole('button', { name: 'Close tab' })
    );
  });
const pressPlus = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(plusButton());
const newestTabId = () => stripIds()[stripIds().length - 1]!;

let notes: string[] = [];
const recordNote = (event: CustomEvent) => notes.push(event.detail?.message);

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
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  subscribeToEvent('openGlobalSnackBar', recordNote);
});

afterEach(() => {
  unsubscribeFromEvent('openGlobalSnackBar', recordNote);
  vi.unstubAllGlobals();
});

describe('AppsDesktop launcher tabs: opening', () => {
  it('opens a new launcher tab with the + each time, the newest on screen', async () => {
    const user = userEvent.setup();
    renderApps();
    expect(plusButton()).toBeInTheDocument();

    await pressPlus(user);
    const first = newestTabId();
    await pressPlus(user);
    const second = newestTabId();

    expect(stripNames()).toEqual([NEW_TAB, NEW_TAB]);
    expect(first).not.toBe(second);
    expect(shownLauncherId()).toBe(second);
    // The first one is kept, out of sight.
    expect(launcherView(first)).toBeInTheDocument();
  });

  it('gives its pins every app, hidden from the library or not', async () => {
    const user = userEvent.setup();
    renderApps();
    act(() => {
      store.set(availableQappsAtom, [{ name: 'Q-Blog', service: 'APP' }]);
      store.set(hiddenAppsAtom, {
        hidden: new Set([appKey('APP', 'Q-Blog')]),
        ownNames: [],
      });
    });

    await pressPlus(user);

    expect(
      inLauncher(newestTabId()).getByTestId('launcher').dataset.pinApps
    ).toBe('Q-Blog');
  });

  it('opens one for the newTabWindow event too, after the open tabs', () => {
    renderApps();
    openApp('Q-Mail');
    act(() => {
      executeEvent('newTabWindow', {});
    });
    expect(stripNames()).toEqual(['Q-Mail', NEW_TAB]);
    expect(shownLauncherId()).toBe(newestTabId());
    expect(shownAppName()).toBeNull();
  });

  it('counts launcher tabs against the tab limit, with its note', async () => {
    const user = userEvent.setup();
    renderApps();
    for (let i = 1; i <= 9; i++) openApp(`App ${i}`);
    await pressPlus(user);
    expect(stripIds()).toHaveLength(10);

    await pressPlus(user);
    openApp('App 11');

    expect(stripIds()).toHaveLength(10);
    await waitFor(
      () =>
        expect(notes).toEqual([
          'Maximum number of tabs reached. Close one to open another.',
          'Maximum number of tabs reached. Close one to open another.',
        ]),
      SLOW
    );
  });

  it('has no Pin or Duplicate in a launcher tab’s menu', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);

    fireEvent.contextMenu(tabButton(newestTabId()));

    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Close all tabs']);
  });
});

describe('AppsDesktop launcher tabs: each keeps its own page', () => {
  it('keeps its search, its page and its form input while another tab shows', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const searching = newestTabId();
    await user.type(inLauncher(searching).getByLabelText('search'), 'tube');

    await pressPlus(user);
    const publishing = newestTabId();
    await user.click(inLauncher(publishing).getByText('publish an app'));
    await user.type(
      inLauncher(publishing).getByLabelText('publish title'),
      'My app'
    );

    selectTab(searching);
    expect(shownLauncherId()).toBe(searching);
    expect(inLauncher(searching).getByLabelText('search')).toHaveValue('tube');
    // The other tab's form is kept, out of sight.
    expect(
      inLauncher(publishing).getByLabelText('publish title')
    ).not.toBeVisible();

    openApp('Q-Mail');
    expect(shownAppName()).toBe('Q-Mail');
    expect(shownLauncherId()).toBeNull();

    selectTab(publishing);
    expect(shownLauncherId()).toBe(publishing);
    expect(inLauncher(publishing).getByLabelText('publish title')).toHaveValue(
      'My app'
    );
    expect(inLauncher(searching).getByLabelText('search')).toHaveValue('tube');
  });

  it("opens an app's details in the launcher tab on screen, and Back returns", async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const other = newestTabId();
    await pressPlus(user);
    const current = newestTabId();
    expect(store.get(appsSubPageCanGoBackAtom)).toBe(false);

    await user.click(inLauncher(current).getByText('details of Q-Mail'));

    expect(inLauncher(current).getByText('details: Q-Mail')).toBeVisible();
    expect(inLauncher(current).getByTestId('launcher')).not.toBeVisible();
    expect(inLauncher(other).queryByText('details: Q-Mail')).toBeNull();
    expect(store.get(appsSubPageCanGoBackAtom)).toBe(true);

    // The top bar's Back.
    act(() => {
      executeEvent('navigateBack', {});
    });

    expect(inLauncher(current).queryByText('details: Q-Mail')).toBeNull();
    expect(inLauncher(current).getByTestId('launcher')).toBeVisible();
    expect(store.get(appsSubPageCanGoBackAtom)).toBe(false);
  });
});

describe('AppsDesktop launcher tabs: what opens from them', () => {
  it('opens an app from a launcher tab in that tab, where it was', async () => {
    const user = userEvent.setup();
    renderApps();
    openApp('Q-Mail');
    await pressPlus(user);
    const launcher = newestTabId();
    openApp('Q-Blog');
    selectTab(launcher);

    await user.click(inLauncher(launcher).getByText('open Q-Tube'));

    expect(stripNames()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Blog']);
    expect(stripIds()[1]).toBe(launcher);
    expect(shownAppName()).toBe('Q-Tube');
    expect(launcherView(launcher)).toBeNull();

    // It is the tab viewed last before Q-Blog, as the launcher tab was.
    selectTab(stripIds()[2]!);
    closeTab(stripIds()[2]!);
    expect(shownAppName()).toBe('Q-Tube');
  });

  it('opens the app it published in its place', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('publish an app'));
    await user.type(
      inLauncher(launcher).getByLabelText('publish title'),
      'My app'
    );

    await user.click(inLauncher(launcher).getByText('publish'));

    expect(stripNames()).toEqual(['My-App']);
    expect(stripIds()).toEqual([launcher]);
    expect(shownAppName()).toBe('My-App');
  });

  it('leaves a form holding input alone: an app arriving later gets its own tab', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('publish an app'));
    await user.type(inLauncher(launcher).getByLabelText('publish title'), 'x');

    // A private app chosen in this tab before, decrypted only now.
    openApp('Q-Notes', { fromLauncherTabId: launcher });

    expect(stripNames()).toEqual([NEW_TAB, 'Q-Notes']);
    expect(shownAppName()).toBe('Q-Notes');
    selectTab(launcher);
    expect(inLauncher(launcher).getByLabelText('publish title')).toHaveValue(
      'x'
    );
  });

  it('opens an app from anywhere else in a tab of its own', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();

    // The top bar, a notification, Duplicate: no launcher tab is named.
    openApp('Q-Tube');

    expect(stripNames()).toEqual([NEW_TAB, 'Q-Tube']);
    expect(stripIds()[0]).toBe(launcher);
    expect(shownAppName()).toBe('Q-Tube');
  });
});

describe('AppsDesktop launcher tabs: closing', () => {
  const dialog = () => screen.queryByRole('dialog');

  const fillPublishForm = async (
    user: ReturnType<typeof userEvent.setup>,
    tabId: string
  ) => {
    await user.click(inLauncher(tabId).getByText('publish an app'));
    await user.type(inLauncher(tabId).getByLabelText('publish title'), 'x');
  };

  it('closes a launcher tab without unsaved input at once', async () => {
    const user = userEvent.setup();
    renderApps();
    openApp('Q-Mail');
    await pressPlus(user);
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('publish an app'));

    closeTab(launcher);

    expect(dialog()).toBeNull();
    expect(stripNames()).toEqual(['Q-Mail']);
    expect(shownAppName()).toBe('Q-Mail');
  });

  it('asks before closing a launcher tab whose publish form holds input', async () => {
    const user = userEvent.setup();
    renderApps();
    openApp('Q-Mail');
    await pressPlus(user);
    const launcher = newestTabId();
    await fillPublishForm(user, launcher);

    closeTab(launcher);

    expect(dialog()).toHaveTextContent('Close Tab Confirmation');
    expect(dialog()).toHaveTextContent(
      'The details in its publish form are not published yet, and closing the tab discards them.'
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog()).toBeNull(), SLOW);
    expect(stripNames()).toEqual(['Q-Mail', NEW_TAB]);
    expect(inLauncher(launcher).getByLabelText('publish title')).toHaveValue(
      'x'
    );

    closeTab(launcher);
    await user.click(screen.getByRole('button', { name: 'Close Tab' }));

    expect(stripNames()).toEqual(['Q-Mail']);
  });

  it('closes it at once again once Back left the publish form', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await fillPublishForm(user, launcher);

    act(() => {
      executeEvent('navigateBack', {});
    });
    closeTab(launcher);

    expect(dialog()).toBeNull();
    expect(stripNames()).toEqual([]);
  });

  it('keeps a launcher tab with unsaved input open on Close All', async () => {
    const user = userEvent.setup();
    renderApps();
    openApp('Q-Mail');
    await pressPlus(user);
    const keeping = newestTabId();
    await fillPublishForm(user, keeping);
    await pressPlus(user);

    fireEvent.contextMenu(tabButton(newestTabId()));
    await user.click(screen.getByRole('menuitem', { name: 'Close all tabs' }));

    expect(stripIds()).toEqual([keeping]);
    expect(shownLauncherId()).toBe(keeping);
    expect(notes).toContain(
      'Locked tabs stay open. Close each one on its own to confirm.'
    );
  });
});

describe('AppsDesktop launcher tabs: the Apps buttons and library searches', () => {
  it('shows the launcher tab there is from an Apps button, or opens one', async () => {
    const user = userEvent.setup();
    renderApps();
    act(() => {
      executeEvent('showLauncherTab', {});
    });
    expect(stripNames()).toEqual([NEW_TAB]);
    const launcher = newestTabId();
    await user.type(inLauncher(launcher).getByLabelText('search'), 'mail');
    openApp('Q-Mail');

    act(() => {
      executeEvent('showLauncherTab', {});
    });

    expect(stripNames()).toEqual([NEW_TAB, 'Q-Mail']);
    expect(shownLauncherId()).toBe(launcher);
    expect(inLauncher(launcher).getByLabelText('search')).toHaveValue('mail');
  });

  it('starts the launcher tab over with a library search', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('details of Q-Mail'));
    openApp('Q-Mail');

    act(() => {
      executeEvent('openAppsLibrarySearch', { data: { query: 'tube' } });
    });

    expect(stripIds()).toHaveLength(2);
    expect(shownLauncherId()).toBe(launcher);
    expect(inLauncher(launcher).getByTestId('launcher')).toBeVisible();
    expect(inLauncher(launcher).getByLabelText('search')).toHaveValue('tube');
  });

  it('gives a library search a new launcher tab rather than lose a form’s input', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const publishing = newestTabId();
    await user.click(inLauncher(publishing).getByText('publish an app'));
    await user.type(
      inLauncher(publishing).getByLabelText('publish title'),
      'My app'
    );

    act(() => {
      executeEvent('openAppsLibrarySearch', { data: { query: 'tube' } });
    });

    expect(stripNames()).toEqual([NEW_TAB, NEW_TAB]);
    const searching = newestTabId();
    expect(shownLauncherId()).toBe(searching);
    expect(inLauncher(searching).getByLabelText('search')).toHaveValue('tube');
    expect(inLauncher(publishing).getByLabelText('publish title')).toHaveValue(
      'My app'
    );
  });
});

describe('AppsDesktop launcher tabs: apps mode with no tab on screen', () => {
  // The top bar's Apps button on Home only switches to apps mode.
  const fromHomeToApps = () => {
    act(() => {
      executeEvent('open-home-mode', {});
    });
    act(() => {
      executeEvent('open-apps-mode', {});
    });
  };

  it('opens on the launcher, not an empty page', () => {
    renderApps();
    fromHomeToApps();

    expect(stripNames()).toEqual([NEW_TAB]);
    expect(shownLauncherId()).toBe(newestTabId());

    // With a tab on screen, that tab shows again, and nothing opens.
    openApp('Q-Mail');
    fromHomeToApps();
    expect(stripNames()).toEqual([NEW_TAB, 'Q-Mail']);
    expect(shownAppName()).toBe('Q-Mail');
  });

  it('opens on the launcher over the tabs restored after a restart', () => {
    localStorage.setItem(
      'ext_open_tabs:QAlice',
      JSON.stringify({
        version: 1,
        tabs: [{ tabId: 't1', service: 'APP', name: 'Q-Tube' }],
        selectedTabId: 't1',
      })
    );
    renderApps('QAlice');
    expect(stripNames()).toEqual(['Q-Tube']);

    fromHomeToApps();

    expect(stripNames()).toEqual(['Q-Tube', NEW_TAB]);
    expect(shownLauncherId()).toBe(newestTabId());
    // The restored tab still waits until it is chosen.
    expect(shownAppName()).toBeNull();
  });
});

describe("AppsDesktop launcher tabs: an app's page from a link", () => {
  // What a qortal://use-app-page link sends (appPageLink.ts), from chat, say,
  // while any tab may be on screen.
  const openPageLink = (name: string) =>
    act(() => {
      executeEvent('selectedAppInfo', { data: { name, service: 'APP' } });
    });

  it("shows it in a new launcher tab while an app's tab is on screen", () => {
    renderApps();
    openApp('Q-Tube');

    openPageLink('Q-Blog');

    expect(stripNames()).toEqual(['Q-Tube', NEW_TAB]);
    const launcher = newestTabId();
    expect(shownLauncherId()).toBe(launcher);
    expect(shownAppName()).toBeNull();
    expect(inLauncher(launcher).getByText('details: Q-Blog')).toBeVisible();
    expect(store.get(appsSubPageCanGoBackAtom)).toBe(true);
  });

  it('shows it in the launcher tab viewed last, and Back returns to its launcher', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await user.type(inLauncher(launcher).getByLabelText('search'), 'blog');
    openApp('Q-Tube');

    openPageLink('Q-Blog');

    expect(stripNames()).toEqual([NEW_TAB, 'Q-Tube']);
    expect(shownLauncherId()).toBe(launcher);
    expect(inLauncher(launcher).getByText('details: Q-Blog')).toBeVisible();

    act(() => {
      executeEvent('navigateBack', {});
    });
    expect(inLauncher(launcher).getByTestId('launcher')).toBeVisible();
    expect(inLauncher(launcher).getByLabelText('search')).toHaveValue('blog');
  });

  it("leaves another app's page as it was: the link gets a new launcher tab", async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('details of Q-Mail'));
    openApp('Q-Tube');

    openPageLink('Q-Blog');

    expect(stripNames()).toEqual([NEW_TAB, 'Q-Tube', NEW_TAB]);
    const page = newestTabId();
    expect(shownLauncherId()).toBe(page);
    expect(inLauncher(page).getByText('details: Q-Blog')).toBeVisible();
    // The page the other launcher tab was on is still there, Back and all.
    selectTab(launcher);
    expect(inLauncher(launcher).getByText('details: Q-Mail')).toBeVisible();
    expect(inLauncher(launcher).queryByText('details: Q-Blog')).toBeNull();
    expect(store.get(appsSubPageCanGoBackAtom)).toBe(true);
  });

  it('leaves a category as it was, even in the launcher tab selected', () => {
    renderApps();
    act(() => {
      executeEvent('showLauncherTab', {});
    });
    const launcher = newestTabId();
    act(() => {
      executeEvent('selectedCategory', { data: { id: 3, name: 'Games' } });
    });
    expect(inLauncher(launcher).getByText('category: Games')).toBeVisible();

    // From chat, say, while this launcher tab is still the selected one.
    openPageLink('Q-Blog');

    expect(stripNames()).toEqual([NEW_TAB, NEW_TAB]);
    const page = newestTabId();
    expect(inLauncher(page).getByText('details: Q-Blog')).toBeVisible();
    selectTab(launcher);
    expect(inLauncher(launcher).getByText('category: Games')).toBeVisible();
    expect(inLauncher(launcher).queryByText('details: Q-Blog')).toBeNull();
  });

  it('takes the place of the page whose text the link is in', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('details of Q-Mail'));

    act(() => {
      executeEvent('selectedAppInfo', {
        data: { name: 'Q-Blog', service: 'APP', fromLauncherTabId: launcher },
      });
    });

    expect(stripIds()).toEqual([launcher]);
    expect(inLauncher(launcher).getByText('details: Q-Blog')).toBeVisible();
    expect(inLauncher(launcher).queryByText('details: Q-Mail')).toBeNull();
  });

  it('never shows it over a publish form holding input', async () => {
    const user = userEvent.setup();
    renderApps();
    await pressPlus(user);
    const publishing = newestTabId();
    await user.click(inLauncher(publishing).getByText('publish an app'));
    await user.type(
      inLauncher(publishing).getByLabelText('publish title'),
      'My app'
    );

    openPageLink('Q-Blog');

    expect(stripNames()).toEqual([NEW_TAB, NEW_TAB]);
    const page = newestTabId();
    expect(shownLauncherId()).toBe(page);
    expect(inLauncher(page).getByText('details: Q-Blog')).toBeVisible();
    expect(inLauncher(publishing).getByLabelText('publish title')).toHaveValue(
      'My app'
    );
  });
});

describe('AppsDesktop launcher tabs: shortcuts', () => {
  let shortcut: ((action: TabShortcutAction) => void) | null = null;
  const press = (action: TabShortcutAction) =>
    act(() => {
      shortcut?.(action);
    });

  beforeEach(() => {
    shortcut = null;
    vi.stubGlobal('electronAPI', {
      onTabShortcut: (callback: (action: TabShortcutAction) => void) => {
        shortcut = callback;
        return () => {
          if (shortcut === callback) shortcut = null;
        };
      },
    });
  });

  it('opens a launcher tab with Ctrl+T and closes it with Ctrl+W', () => {
    renderApps();
    openApp('Q-Mail');

    press({ type: 'newTab' });
    expect(stripNames()).toEqual(['Q-Mail', NEW_TAB]);
    expect(shownLauncherId()).toBe(newestTabId());

    press({ type: 'closeTab' });
    expect(stripNames()).toEqual(['Q-Mail']);

    // Ctrl+Shift+T brings it back as a new launcher tab.
    press({ type: 'reopenClosedTab' });
    expect(stripNames()).toEqual(['Q-Mail', NEW_TAB]);
    expect(shownLauncherId()).toBe(newestTabId());
  });

  it('asks before Ctrl+W closes a launcher tab with unsaved input', async () => {
    const user = userEvent.setup();
    renderApps();
    press({ type: 'newTab' });
    const launcher = newestTabId();
    await user.click(inLauncher(launcher).getByText('publish an app'));
    await user.type(inLauncher(launcher).getByLabelText('publish title'), 'x');

    press({ type: 'closeTab' });

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The details in its publish form are not published yet'
    );
    expect(stripIds()).toEqual([launcher]);
  });
});
