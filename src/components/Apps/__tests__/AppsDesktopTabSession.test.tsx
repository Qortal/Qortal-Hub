import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { forwardRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://127.0.0.1:12391';
const { openPrivateApp } = vi.hoisted(() => ({ openPrivateApp: vi.fn() }));

vi.mock('../../../App', () => ({ getBaseApiReact: () => NODE }));
vi.mock('../../../atoms/global', async () => {
  const { atom } = await import('jotai');
  return {
    appsSubPageCanGoBackAtom: atom(false),
    isNewTabWindowAtom: atom(false),
    navigationControllerAtom: atom({}),
    userInfoAtom: atom(null),
    // A tab's menu reads the pinned apps for its Pin to bookmarks.
    settingsLocalLastUpdatedAtom: atom(0),
    sortablePinnedAppsAtom: atom([]),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (k: string) => k }),
}));
vi.mock('../AppsLauncher', () => ({
  AppsLauncher: () => null,
  isLauncherSubPage: () => false,
}));
vi.mock('../AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('../AppInfo', () => ({ AppInfo: () => null }));
vi.mock('../AppPublish', () => ({ AppPublish: () => null }));
vi.mock('../AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));
vi.mock('../TabComponent', () => ({
  default: ({ app, isSelected, onClose, onCloseAll, onSelect }: any) => (
    <div
      data-testid="tab"
      data-selected={isSelected ? 'yes' : 'no'}
      data-tabid={app?.tabId}
    >
      <button onClick={onSelect}>{`open ${app?.name}`}</button>
      <button onClick={onClose}>{`close ${app?.name}`}</button>
      <button onClick={onCloseAll}>{`close all from ${app?.name}`}</button>
    </div>
  ),
}));
vi.mock('../AppViewerContainer', () => ({
  default: forwardRef<HTMLDivElement, { app: Record<string, any> }>(
    ({ app }, ref) => (
      <div
        data-name={app?.name}
        data-path={app?.path ?? ''}
        data-tabid={app?.tabId}
        data-testid="app-viewer"
        data-url={app?.url ?? ''}
        ref={ref}
      />
    )
  ),
}));
vi.mock('../../../hooks/useAppRatings', () => ({
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: vi.fn() }),
}));
vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: openPrivateApp }),
}));
vi.mock('../../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId: vi.fn(),
}));
vi.mock('../../Chat/MessageDisplay', () => ({
  extractComponents: vi.fn(() => null),
}));
vi.mock('../../Desktop/CustomTitleBar', () => ({ appChromeOffsetPx: '0px' }));
vi.mock('../../Snackbar/Snackbar', () => ({ CustomizedSnackbars: () => null }));

import { navigationControllerAtom, userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import { buildQortalResourceLink } from '../../../utils/qortalLink';
import { AppsDesktop } from '../AppsDesktop';

const Harness = () => {
  const [mode, setMode] = useState('home');
  const [devMode, setDevMode] = useState('home');
  const [desktopViewMode, setDesktopViewMode] = useState('home');
  return (
    <AppsDesktop
      desktopViewMode={desktopViewMode}
      devMode={devMode}
      mode={mode}
      setDesktopViewMode={setDesktopViewMode}
      setDevMode={setDevMode}
      setMode={setMode}
      show={desktopViewMode === 'apps' || desktopViewMode === 'dev'}
    />
  );
};

let store: ReturnType<typeof createStore>;

const renderApps = (address: string | null = null) => {
  store = createStore();
  if (address) store.set(userInfoAtom, { address });
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
};

const signIn = (address: string) => {
  act(() => {
    store.set(userInfoAtom, { address });
  });
};

const addTab = (data: Record<string, unknown>) => {
  act(() => {
    document.dispatchEvent(new CustomEvent('addTab', { detail: { data } }));
  });
};

const click = (label: string) => {
  act(() => {
    fireEvent.click(screen.getByText(label));
  });
};

const strip = () =>
  screen.queryAllByTestId('tab').map((tab) => ({
    tabId: tab.getAttribute('data-tabid'),
    selected: tab.getAttribute('data-selected') === 'yes',
  }));

const viewers = () =>
  screen.queryAllByTestId('app-viewer').map((viewer) => ({
    tabId: viewer.getAttribute('data-tabid'),
    name: viewer.getAttribute('data-name'),
    path: viewer.getAttribute('data-path'),
  }));

const save = (address: string, session: Record<string, unknown>) =>
  localStorage.setItem(
    `ext_open_tabs:${address}`,
    JSON.stringify({ version: 1, selectedTabId: null, ...session })
  );

const saved = (address: string) =>
  JSON.parse(localStorage.getItem(`ext_open_tabs:${address}`) ?? 'null');

const minter = {
  service: 'DOCUMENT',
  name: 'Minter',
  identifier: 'app-id',
  groupId: 42,
};

/** The tab useHandlePrivateApps opens once Minter is decrypted again. */
const reopenedMinter = () => ({
  ...minter,
  url: `${NODE}/render/hash/abc?secret=xyz`,
  isPreview: true,
  isPrivate: true,
  privateAppProperties: { ...minter, appName: 'Minter Helper' },
  refreshFunc: () => undefined,
});

describe('AppsDesktop open tabs after a restart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    openPrivateApp.mockReset();
    openPrivateApp.mockResolvedValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => [] }))
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('restores the tabs once the account is known, none selected or loaded', () => {
    save('QAlice', {
      tabs: [
        { tabId: 't1', service: 'APP', name: 'Q-Tube', path: 'video/abc' },
        { tabId: 't2', service: 'APP', name: 'Q-Mail' },
      ],
      selectedTabId: 't2',
    });
    const stored = localStorage.getItem('ext_open_tabs:QAlice');
    renderApps();
    expect(strip()).toEqual([]);

    signIn('QAlice');
    expect(strip()).toEqual([
      { tabId: 't1', selected: false },
      { tabId: 't2', selected: false },
    ]);
    expect(viewers()).toEqual([]);
    // Nothing changed, so nothing is written back.
    expect(localStorage.getItem('ext_open_tabs:QAlice')).toBe(stored);

    click('open Q-Tube');
    expect(viewers()).toEqual([
      { tabId: 't1', name: 'Q-Tube', path: 'video/abc' },
    ]);

    click('open Q-Mail');
    // The first one stays loaded.
    expect(viewers().map((viewer) => viewer.tabId)).toEqual(['t1', 't2']);
  });

  it('restores only once, and a closed list stays closed', () => {
    save('QAlice', {
      tabs: [{ tabId: 't1', service: 'APP', name: 'Q-Tube' }],
    });
    renderApps('QAlice');
    expect(strip()).toHaveLength(1);

    click('close all from Q-Tube');
    expect(strip()).toEqual([]);
    expect(saved('QAlice')).toEqual({
      version: 1,
      tabs: [],
      selectedTabId: null,
    });

    signIn('QAlice');
    act(() => {
      store.set(userInfoAtom, { address: 'QAlice', name: 'alice' });
    });
    expect(strip()).toEqual([]);
  });

  it('does not restore over a tab opened before the account was known', () => {
    save('QAlice', {
      tabs: [{ tabId: 't1', service: 'APP', name: 'Q-Tube' }],
    });
    renderApps();
    addTab({ service: 'APP', name: 'Q-Wallets' });
    signIn('QAlice');

    expect(viewers().map((viewer) => viewer.name)).toEqual(['Q-Wallets']);
    expect(strip()).toHaveLength(1);
    expect(saved('QAlice').tabs.map((tab) => tab.name)).toEqual(['Q-Wallets']);
  });

  it("keeps each account's tabs apart", () => {
    save('QAlice', {
      tabs: [{ tabId: 'a1', service: 'APP', name: 'Q-Tube' }],
    });
    save('QBob', { tabs: [{ tabId: 'b1', service: 'APP', name: 'Q-Mail' }] });
    const alice = localStorage.getItem('ext_open_tabs:QAlice');

    renderApps('QBob');
    expect(strip().map((tab) => tab.tabId)).toEqual(['b1']);

    addTab({ service: 'APP', name: 'Q-Shop' });
    expect(saved('QBob').tabs.map((tab) => tab.name)).toEqual([
      'Q-Mail',
      'Q-Shop',
    ]);
    expect(localStorage.getItem('ext_open_tabs:QAlice')).toBe(alice);
  });

  it('saves the tabs, the selected one and where each app is', () => {
    renderApps('QAlice');
    // An account without saved tabs gets no entry until it opens one.
    expect(localStorage.getItem('ext_open_tabs:QAlice')).toBeNull();
    addTab({ service: 'APP', name: 'Q-Tube', path: 'video/abc' });
    const [{ tabId }] = viewers();
    expect(saved('QAlice')).toEqual({
      version: 1,
      tabs: [{ tabId, service: 'APP', name: 'Q-Tube', path: 'video/abc' }],
      selectedTabId: tabId,
    });

    // The app reports another page: saved after a pause, as a path in the
    // app without Hub's render parameters.
    act(() => {
      store.set(navigationControllerAtom, {
        [tabId]: {
          currentLink: buildQortalResourceLink({
            service: 'APP',
            name: 'Q-Tube',
            path: '/channel/x?theme=dark&lang=en',
          }),
        },
      });
    });
    expect(saved('QAlice').tabs[0].path).toBe('video/abc');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saved('QAlice').tabs[0].path).toBe('channel/x');

    click('close Q-Tube');
    expect(saved('QAlice')).toEqual({
      version: 1,
      tabs: [],
      selectedTabId: null,
    });
  });

  it('keeps no launcher tab, and remembers the last app tab while one shows', () => {
    renderApps('QAlice');
    addTab({ service: 'APP', name: 'Q-Tube' });
    addTab({ service: 'APP', name: 'Q-Mail' });
    click('open Q-Tube');
    const [tube, mail] = strip();
    act(() => {
      document.dispatchEvent(new CustomEvent('newTabWindow', {}));
    });
    const [, , launcher] = strip();
    expect(launcher).toEqual({ tabId: expect.any(String), selected: true });
    expect(saved('QAlice')).toEqual({
      version: 1,
      tabs: [
        { tabId: tube.tabId, service: 'APP', name: 'Q-Tube' },
        { tabId: mail.tabId, service: 'APP', name: 'Q-Mail' },
      ],
      selectedTabId: tube.tabId,
    });
  });

  it('shows the tab that was selected when the Apps button finds the strip full', () => {
    const tabs = Array.from({ length: 10 }, (_, index) => ({
      tabId: `t${index + 1}`,
      service: 'APP',
      name: `App ${index + 1}`,
    }));
    save('QAlice', { tabs, selectedTabId: 't3' });
    renderApps('QAlice');

    // No launcher tab fits: the note says so, over the tab viewed last.
    act(() => {
      document.dispatchEvent(new CustomEvent('showLauncherTab', {}));
    });

    expect(strip()).toHaveLength(10);
    expect(strip().find((tab) => tab.selected)?.tabId).toBe('t3');
    expect(viewers().map((viewer) => viewer.tabId)).toEqual(['t3']);
  });

  it('falls back to the tab that was selected before the restart', () => {
    save('QAlice', {
      tabs: [
        { tabId: 't1', service: 'APP', name: 'Q-Tube' },
        { tabId: 't2', service: 'APP', name: 'Q-Mail' },
        { tabId: 't3', service: 'APP', name: 'Q-Shop' },
      ],
      selectedTabId: 't1',
    });
    renderApps('QAlice');
    click('open Q-Shop');
    addTab({ service: 'APP', name: 'Q-Wallets' });
    click('close Q-Wallets');
    expect(strip().find((tab) => tab.selected)?.tabId).toBe('t3');

    // Q-Tube was the one selected before the restart, so it comes next,
    // not the neighbour.
    click('close Q-Shop');
    expect(strip()).toEqual([
      { tabId: 't1', selected: true },
      { tabId: 't2', selected: false },
    ]);
    expect(viewers().map((viewer) => viewer.tabId)).toEqual(['t1']);
  });

  it('brings pinned tabs back first, as the strip keeps them', () => {
    save('QAlice', {
      tabs: [
        { tabId: 't1', service: 'APP', name: 'Q-Mail' },
        {
          tabId: 't2',
          service: 'APP',
          name: 'Q-Tube',
          flags: { pinned: true },
        },
      ],
    });
    renderApps('QAlice');
    click('open Q-Mail');
    // The list Hub keeps, and saves, is in the strip's order.
    expect(saved('QAlice').tabs.map((tab) => tab.tabId)).toEqual(['t2', 't1']);
  });

  it('keeps the address a restored tab was opened at until its app reports one', () => {
    save('QAlice', {
      tabs: [
        { tabId: 't1', service: 'APP', name: 'Q-Tube', path: 'video/abc' },
      ],
    });
    renderApps('QAlice');
    click('open Q-Tube');
    const reportPath = (path?: string) => {
      act(() => {
        store.set(navigationControllerAtom, {
          t1: {
            currentLink: buildQortalResourceLink({
              service: 'APP',
              name: 'Q-Tube',
              path,
            }),
          },
        });
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    };

    // The address bar's link before the app reports a page.
    reportPath();
    expect(saved('QAlice').tabs[0].path).toBe('video/abc');

    // The app's start page.
    reportPath('/');
    expect(saved('QAlice').tabs[0]).toEqual({
      tabId: 't1',
      service: 'APP',
      name: 'Q-Tube',
    });
  });

  it('reopens a restored private app in its own place when it is selected', async () => {
    save('QAlice', {
      tabs: [
        {
          tabId: 'p1',
          service: 'DOCUMENT',
          name: 'Minter',
          identifier: 'app-id',
          isPrivate: true,
          privateAppProperties: minter,
          flags: { pinned: true },
        },
        { tabId: 't2', service: 'APP', name: 'Q-Mail' },
      ],
    });
    // Like the real one, openApp settles after it has opened the app.
    let settle: (opened: boolean) => void = () => {};
    openPrivateApp.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    renderApps('QAlice');

    click('open Minter');
    await act(async () => {});
    expect(openPrivateApp).toHaveBeenCalledTimes(1);
    expect(openPrivateApp).toHaveBeenCalledWith(minter, false, undefined, {
      isWanted: expect.any(Function),
      openTab: expect.any(Function),
    });
    // Nothing is shown for it until it has been decrypted again.
    expect(viewers()).toEqual([]);

    const [, , , request] = openPrivateApp.mock.calls[0];
    expect(request.isWanted()).toBe(true);
    act(() => {
      request.openTab(reopenedMinter());
    });
    await act(async () => settle(true));

    expect(strip()).toEqual([
      { tabId: 'p1', selected: true },
      { tabId: 't2', selected: false },
    ]);
    expect(viewers()).toEqual([{ tabId: 'p1', name: 'Minter', path: '' }]);
    const kept = saved('QAlice');
    expect(kept.tabs[0]).toMatchObject({
      tabId: 'p1',
      isPrivate: true,
      flags: { pinned: true },
    });
    expect(JSON.stringify(kept)).not.toContain('secret');
  });

  it('lets a private app opened from its list take its restored tab', () => {
    save('QAlice', {
      tabs: [
        { tabId: 't2', service: 'APP', name: 'Q-Mail' },
        {
          tabId: 'p1',
          service: 'DOCUMENT',
          name: 'Minter',
          identifier: 'app-id',
          isPrivate: true,
          privateAppProperties: minter,
        },
      ],
    });
    renderApps('QAlice');
    click('open Q-Mail');

    // Opened on purpose, from its list or a pinned app: it is shown.
    addTab(reopenedMinter());
    expect(strip()).toEqual([
      { tabId: 't2', selected: false },
      { tabId: 'p1', selected: true },
    ]);
    expect(openPrivateApp).not.toHaveBeenCalled();
  });

  it('keeps the tab strip working when the tabs cannot be saved', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    renderApps('QAlice');
    addTab({ service: 'APP', name: 'Q-Tube' });
    addTab({ service: 'APP', name: 'Q-Mail' });
    expect(viewers().map((viewer) => viewer.name)).toEqual([
      'Q-Tube',
      'Q-Mail',
    ]);
  });
});
