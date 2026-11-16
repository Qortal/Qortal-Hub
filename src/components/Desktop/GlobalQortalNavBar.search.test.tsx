import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import {
  sortablePinnedAppsAtom,
  userInfoAtom,
  navigationControllerAtom,
} from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { GlobalQortalNavBar } from './GlobalQortalNavBar';

// The bar's other widgets are not under test here.
vi.mock('../QMailStatus', () => ({ QMailStatus: () => null }));
vi.mock('../GeneralNotifications', () => ({
  GeneralNotifications: () => null,
}));
vi.mock('../TaskManager/TaskManager', () => ({ TaskManager: () => null }));
vi.mock('../GlobalActions/GlobalActions', () => ({
  GlobalActions: () => null,
}));
vi.mock('./SubscriptionsStatus', () => ({ SubscriptionsStatus: () => null }));
vi.mock('../Apps/AppBookmarks', () => ({ AppBookmarksButton: () => null }));
vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));
const { launcherBookmarks, openPrivateApp } = vi.hoisted(() => ({
  // The account's bookmarks, as the launcher's store hands them out.
  launcherBookmarks: vi.fn(),
  // A private app is downloaded and decrypted before it opens.
  openPrivateApp: vi.fn(async () => true),
}));
vi.mock('../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: openPrivateApp, status: '' }),
}));
vi.mock('../Apps/AppsLauncher/useLauncherBookmarks', () => ({
  useLauncherBookmarks: launcherBookmarks,
}));

const catalog = [
  { metadata: { title: 'Torq' }, name: 'Torq', service: 'APP' },
  { metadata: { title: 'Torque Garage' }, name: 'Torque', service: 'WEBSITE' },
  { metadata: { title: 'Q-Tube' }, name: 'Q-Tube', service: 'APP' },
];

type Heard = { data: any; event: string };
const EVENTS = [
  'addTab',
  'open-apps-mode',
  'openAppsLibrarySearch',
  'openUserLookupDrawer',
  'setSelectedTab',
];
let heard: Heard[] = [];
const listeners = EVENTS.map((event) => {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    heard.push({ data: detail?.data ?? detail, event });
  };
  return { event, listener };
});

/** Core's name search: answers in the order the test resolves them. */
type NameRequest = { resolve: (names: string[]) => void; url: string };
let nameRequests: NameRequest[] = [];
const fetchMock = vi.fn(
  (url: string) =>
    new Promise<Response>((resolve) => {
      nameRequests.push({
        resolve: (names) =>
          resolve({
            json: async () =>
              names.map((name) => ({ name, owner: `Q-${name}` })),
          } as Response),
        url: String(url),
      });
    })
);

const renderBar = ({
  apps = catalog,
  mode = 'home',
  navigation = {},
  pins = [],
}: {
  apps?: unknown[];
  mode?: string;
  /** Each tab's address bar link, by tab id. */
  navigation?: Record<string, { currentLink?: string }>;
  pins?: unknown[];
} = {}) => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QViewer', name: 'Viewer' });
  store.set(navigationControllerAtom, navigation as never);
  store.set(availableQappsAtom, apps as never);
  store.set(sortablePinnedAppsAtom, pins as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <GlobalQortalNavBar desktopViewMode={mode} />
      </ThemeProvider>
    </Provider>
  );
  return screen.getByRole('combobox');
};

let tabsToken = 0;
/** What the tab strip tells the bar: its tabs and the one selected. */
const showTabs = (tabs: object[], selectedTab: object | null = null) =>
  act(() => {
    tabsToken += 1;
    executeEvent('setTabsToNav', { data: { selectedTab, tabs, tabsToken } });
  });

const type = (input: HTMLElement, value: string) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
};

const suggestions = () =>
  screen.queryAllByRole('option').map((option) => option.textContent);

const groupNames = () =>
  screen
    .queryAllByRole('group')
    .map(
      (group) =>
        document.getElementById(group.getAttribute('aria-labelledby') ?? '')
          ?.textContent
    );

const rowsOf = (groupName: string) =>
  within(screen.getByRole('group', { name: groupName }))
    .getAllByRole('option')
    .map((option) => option.textContent);

const optionStartingWith = (text: string) => {
  const option = screen
    .getAllByRole('option')
    .find((item) => item.textContent?.startsWith(text));
  if (!option) throw new Error(`No suggestion starts with ${text}`);
  return option;
};

const heardOf = (event: string) =>
  heard.filter((item) => item.event === event).map(({ data }) => data);

const opened = () => heardOf('addTab') as Record<string, unknown>[];

const librarySearches = () =>
  heardOf('openAppsLibrarySearch').map((data) => data.query);

/** Runs the timers that are due, and what their answers start. */
const waitFor = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('GlobalQortalNavBar search suggestions', () => {
  beforeEach(() => {
    localStorage.clear();
    heard = [];
    nameRequests = [];
    fetchMock.mockClear();
    openPrivateApp.mockClear();
    launcherBookmarks.mockReset();
    launcherBookmarks.mockReturnValue({ data: null, isReady: true });
    vi.stubGlobal('fetch', fetchMock);
    listeners.forEach(({ event, listener }) =>
      document.addEventListener(event, listener)
    );
  });

  afterEach(() => {
    listeners.forEach(({ event, listener }) =>
      document.removeEventListener(event, listener)
    );
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('suggests Q-Apps and websites as the user types', () => {
    const input = renderBar();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    type(input, 'tor');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(suggestions()).toEqual([
      'TorqQ-App',
      'Torque GarageTorque · Website',
      'Search Q-Apps for “tor”',
    ]);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens a suggestion picked with the keyboard', () => {
    const input = renderBar();
    type(input, 'tor');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(opened()).toEqual([
      { name: 'Torque', navigateIfAlreadyOpen: true, service: 'WEBSITE' },
    ]);
    expect(heard.map(({ event }) => event)).toContain('open-apps-mode');
    expect(input).toHaveValue('qortal://WEBSITE/Torque');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens a suggestion that is clicked', () => {
    const input = renderBar();
    type(input, 'tube');

    fireEvent.click(optionStartingWith('Q-Tube'));

    expect(opened()).toEqual([
      { name: 'Q-Tube', navigateIfAlreadyOpen: true, service: 'APP' },
    ]);
  });

  it('opens an exact name on Enter, and searches the library for other text', () => {
    const input = renderBar();

    type(input, 'TORQ');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(opened()).toEqual([
      { name: 'Torq', navigateIfAlreadyOpen: true, service: 'APP' },
    ]);

    type(input, 'garage');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(librarySearches()).toEqual(['garage']);
    expect(opened()).toHaveLength(1);
  });

  it('searches the library from its row', () => {
    const input = renderBar();
    type(input, 'tor');

    fireEvent.click(
      screen.getByRole('option', { name: 'Search Q-Apps for “tor”' })
    );

    expect(librarySearches()).toEqual(['tor']);
    expect(opened()).toEqual([]);
  });

  it('offers a qortal:// link as its only row, and opens it', () => {
    const input = renderBar();
    type(input, 'qortal://APP/Q-Tube');

    expect(suggestions()).toEqual(['qortal://APP/Q-TubeOpen link']);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(opened()).toEqual([
      expect.objectContaining({ name: 'Q-Tube', service: 'APP' }),
    ]);
  });

  it('ranks the apps this account opens most first', () => {
    const input = renderBar();
    act(() => {
      executeEvent('addTab', { data: { name: 'Torque', service: 'WEBSITE' } });
    });

    type(input, 'tor');

    expect(suggestions()[0]).toBe('Torque GarageTorque · Website');
    expect(
      JSON.parse(localStorage.getItem('app_open_counts:QViewer') || '{}')
    ).toEqual({ 'WEBSITE:torque': 1 });
  });

  it('closes the suggestions on Escape', () => {
    const input = renderBar();
    type(input, 'tor');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(opened()).toEqual([]);
  });

  it('lists open tabs, saved apps, Q-Apps and names, in named groups', async () => {
    vi.useFakeTimers();
    const input = renderBar({
      apps: [
        ...catalog,
        {
          metadata: { title: 'Tortoise Run' },
          name: 'Tortoise',
          service: 'APP',
        },
      ],
      pins: [{ name: 'Torque', service: 'WEBSITE' }],
    });
    showTabs([
      {
        metadata: { title: 'Torq' },
        name: 'Torq',
        service: 'APP',
        tabId: 't1',
      },
    ]);

    type(input, 'tor');
    await waitFor(250);
    await act(async () => nameRequests[0].resolve(['Toril', 'Torq']));

    expect(groupNames()).toEqual([
      'Open tabs',
      'Pinned apps and bookmarks',
      'Q-Apps and websites',
      'Names',
    ]);
    expect(rowsOf('Open tabs')).toEqual(['TorqQ-AppSwitch to tabNew tab']);
    expect(rowsOf('Pinned apps and bookmarks')).toEqual([
      'Torque GarageTorque · Website',
    ]);
    // Torq and Torque are listed above already, and so is the name Torq.
    expect(rowsOf('Q-Apps and websites')).toEqual([
      'Tortoise RunTortoise · Q-App',
    ]);
    expect(rowsOf('Names')).toEqual(['TorilName']);
    expect(suggestions()).toEqual([
      'TorqQ-AppSwitch to tabNew tab',
      'Torque GarageTorque · Website',
      'Tortoise RunTortoise · Q-App',
      'TorilName',
      'Search Q-Apps for “tor”',
    ]);
  });

  it('switches to an open tab instead of opening the app again', () => {
    const input = renderBar();
    const tab = {
      metadata: { title: 'Q-Tube' },
      name: 'Q-Tube',
      service: 'APP',
      tabId: 't1',
    };
    showTabs([tab]);

    type(input, 'tube');
    expect(suggestions()).toEqual([
      'Q-TubeQ-AppSwitch to tabNew tab',
      'Search Q-Apps for “tube”',
    ]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(heardOf('setSelectedTab')).toEqual([tab]);
    expect(heardOf('open-apps-mode')).toHaveLength(1);
    expect(opened()).toEqual([]);
  });

  it('offers the open tab, or a new one, on the row of an app that is open', () => {
    const input = renderBar();
    const tab = { name: 'Q-Tube', service: 'APP', tabId: 't1' };
    showTabs([tab]);
    const button = (name: string) =>
      within(optionStartingWith('Q-Tube')).getByRole('button', {
        hidden: true,
        name,
      });

    type(input, 'tube');
    fireEvent.click(button('New tab'));
    expect(opened()).toEqual([{ name: 'Q-Tube', service: 'APP' }]);
    expect(heardOf('setSelectedTab')).toEqual([]);

    type(input, 'tube');
    fireEvent.click(button('Switch to tab'));
    expect(heardOf('setSelectedTab')).toEqual([tab]);
    expect(opened()).toHaveLength(1);
  });

  it('tells two tabs of one app apart by their pages', () => {
    const input = renderBar({
      navigation: {
        t1: { currentLink: 'qortal://APP/Torq/post/abc' },
        t2: { currentLink: 'qortal://APP/Torq' },
      },
    });
    showTabs([
      { name: 'Torq', service: 'APP', tabId: 't1' },
      { name: 'Torq', service: 'APP', tabId: 't2' },
    ]);

    type(input, 'torq');

    expect(rowsOf('Open tabs')).toEqual([
      'Torqpost/abcSwitch to tabNew tab',
      'TorqQ-AppSwitch to tabNew tab',
    ]);
  });

  it("keeps a tab of another resource off the app's own row", () => {
    const input = renderBar();
    // Q-Tube's beta resource is open; the Q-App itself is not.
    showTabs([
      { identifier: 'beta', name: 'Q-Tube', service: 'APP', tabId: 't1' },
    ]);

    type(input, 'tube');
    expect(rowsOf('Open tabs')).toEqual(['Q-TubeQ-AppSwitch to tabNew tab']);
    expect(rowsOf('Q-Apps and websites')).toEqual(['Q-TubeQ-App']);

    // The app's row opens the Q-App, which reuses only a tab that shows it.
    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Q-Apps and websites' })
      ).getByRole('option')
    );
    expect(heardOf('setSelectedTab')).toEqual([]);
    expect(opened()).toEqual([
      { name: 'Q-Tube', navigateIfAlreadyOpen: true, service: 'APP' },
    ]);
  });

  it('opens a link to the default resource without an identifier', () => {
    const input = renderBar();

    type(input, 'qortal://APP/Q-Tube/search?q=cats&identifier=default');
    fireEvent.keyDown(input, { key: 'Enter' });
    type(input, 'qortal://APP/Q-Tube?identifier=beta');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(opened()).toEqual([
      {
        name: 'Q-Tube',
        navigateIfAlreadyOpen: true,
        path: 'search?q=cats',
        service: 'APP',
      },
      {
        identifier: 'beta',
        name: 'Q-Tube',
        navigateIfAlreadyOpen: true,
        service: 'APP',
      },
    ]);
  });

  it('fits the list to its rows, no wider than the field', () => {
    const fieldWidth = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(900);
    try {
      const input = renderBar();

      type(input, 'tor');

      const list = screen.getByRole('listbox').closest('.MuiPopper-root');
      const style = getComputedStyle(list as HTMLElement);
      expect(style.width).toBe('max-content');
      expect(style.maxWidth).toBe('900px');
      expect(style.minWidth).toBe('380px');
    } finally {
      fieldWidth.mockRestore();
    }
  });

  it('has no buttons on a row whose app is not open', () => {
    const input = renderBar();

    type(input, 'tor');

    expect(suggestions()).toContain('TorqQ-App');
    expect(
      screen.queryAllByRole('button', { hidden: true, name: 'New tab' })
    ).toEqual([]);
  });

  it('opens a Q-App in the tab that shows it already', () => {
    const input = renderBar({ mode: 'apps' });
    const tab = { name: 'Q-Tube', service: 'APP', tabId: 't1' };
    // The tab on screen is not offered: there is nothing to switch to.
    showTabs([tab], tab);

    type(input, 'tube');
    expect(screen.queryByRole('group', { name: 'Open tabs' })).toBeNull();
    fireEvent.click(optionStartingWith('Q-Tube'));

    expect(opened()).toEqual([
      { name: 'Q-Tube', navigateIfAlreadyOpen: true, service: 'APP' },
    ]);
    expect(heardOf('setSelectedTab')).toEqual([]);
  });

  it('opens a new tab with Alt+Enter, even for an app that is open', () => {
    const input = renderBar();
    showTabs([{ name: 'Q-Tube', service: 'APP', tabId: 't1' }]);

    // The open tab's row: Alt+Enter opens the app again instead.
    type(input, 'tube');
    expect(suggestions()[0]).toBe('Q-TubeQ-AppSwitch to tabNew tab');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { altKey: true, key: 'Enter' });
    expect(opened()).toEqual([{ name: 'Q-Tube', service: 'APP' }]);
    expect(heardOf('setSelectedTab')).toEqual([]);

    // An exact name: Enter goes to the open tab, Alt+Enter to a new one.
    type(input, 'torq');
    fireEvent.keyDown(input, { key: 'Enter' });
    type(input, 'torq');
    fireEvent.keyDown(input, { altKey: true, key: 'Enter' });
    expect(opened().slice(1)).toEqual([
      { name: 'Torq', navigateIfAlreadyOpen: true, service: 'APP' },
      { name: 'Torq', service: 'APP' },
    ]);
  });

  it('offers a link typed in capitals, and opens it', () => {
    const input = renderBar();

    type(input, 'QORTAL://APP/Q-Tube');
    expect(suggestions()).toEqual(['qortal://APP/Q-TubeOpen link']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(opened()).toEqual([
      { name: 'Q-Tube', navigateIfAlreadyOpen: true, service: 'APP' },
    ]);
    expect(librarySearches()).toEqual([]);
  });

  it('looks names up only once typing stops, and drops older answers', async () => {
    vi.useFakeTimers();
    const input = renderBar();

    type(input, 'a');
    await waitFor(1000);
    expect(fetchMock).not.toHaveBeenCalled();

    type(input, 'al');
    await waitFor(249);
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(1);
    expect(nameRequests.map(({ url }) => url)).toEqual([
      'http://node.test/names/search?query=al&prefix=true&limit=10',
    ]);

    type(input, 'ali');
    await waitFor(250);
    expect(nameRequests).toHaveLength(2);
    await act(async () => nameRequests[1].resolve(['alice']));
    // The answer for "al" comes last, and is not shown.
    await act(async () => nameRequests[0].resolve(['alina', 'alice']));

    expect(rowsOf('Names')).toEqual(['aliceName']);
  });

  it("opens a name's profile", async () => {
    vi.useFakeTimers();
    const input = renderBar();

    type(input, 'alice');
    await waitFor(250);
    await act(async () => nameRequests[0].resolve(['alice']));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Names' })).getByRole('option')
    );

    expect(heardOf('openUserLookupDrawer')).toEqual([
      { addressOrName: 'alice' },
    ]);
    expect(opened()).toEqual([]);
  });

  it("shows the Qortal logo for an app without a picture, and a name's letter", async () => {
    // No picture loads: what Core answers for a name that has none.
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        referrerPolicy = '';
        srcset = '';
        sizes = '';
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
    );
    vi.useFakeTimers();
    const input = renderBar();

    type(input, 'tor');
    await act(async () => {});
    const torq = optionStartingWith('Torq');
    expect(torq.querySelector('img')?.getAttribute('src')).toMatch(
      /LogoSelected/
    );
    expect(torq.textContent).toBe('TorqQ-App');

    type(input, 'alice');
    await waitFor(250);
    await act(async () => nameRequests[0].resolve(['alice']));
    await act(async () => {});
    const name = within(screen.getByRole('group', { name: 'Names' })).getByRole(
      'option'
    );
    expect(name.querySelector('img')).toBeNull();
    expect(name.textContent).toBe('Aalice' + 'Name');
  });

  it('opens a bookmark at its page, in the tab of its app when one is open', () => {
    const bookmarks = [
      {
        appName: 'Q-Tube',
        createdAt: 1,
        folderId: null,
        id: 'b1',
        link: 'qortal://APP/Q-Tube/channel/cats',
        name: 'Cat videos',
        path: 'channel/cats',
        service: 'APP',
        updatedAt: 1,
      },
    ];
    // The store is read for this account once the field has focus.
    launcherBookmarks.mockImplementation((address, isShown) => ({
      data:
        address === 'QViewer' && isShown
          ? { bookmarks, folders: [], updatedAt: 1 }
          : null,
      isReady: true,
    }));
    const input = renderBar();

    type(input, 'cat');
    fireEvent.click(optionStartingWith('Cat videos'));

    expect(opened()).toEqual([
      {
        name: 'Q-Tube',
        navigateIfAlreadyOpen: true,
        path: 'channel/cats',
        service: 'APP',
      },
    ]);
  });

  it('switches to a pinned private app that is open, else decrypts it', () => {
    const privateAppProperties = {
      appName: 'Secret Notes',
      identifier: 'notes-1',
      name: 'Alice',
      service: 'DOCUMENT',
    };
    const pin = { isPrivate: true, isPreview: true, privateAppProperties };
    const input = renderBar({ pins: [pin] });

    type(input, 'secret');
    fireEvent.click(optionStartingWith('Secret Notes'));
    expect(openPrivateApp).toHaveBeenCalledWith(
      privateAppProperties,
      false,
      undefined
    );

    const tab = {
      identifier: 'notes-1',
      isPrivate: true,
      name: 'Alice',
      privateAppProperties,
      service: 'DOCUMENT',
      tabId: 't1',
    };
    showTabs([tab], tab);
    type(input, 'secret');
    // Not on screen in Home, so the tab is offered, and the pin left out.
    expect(suggestions()).toEqual([
      'AliceSecret Notes · Switch to tab',
      'Search Q-Apps for “secret”',
    ]);
    fireEvent.click(optionStartingWith('Alice'));
    expect(heardOf('setSelectedTab')).toEqual([tab]);
    expect(openPrivateApp).toHaveBeenCalledTimes(1);
  });
});
