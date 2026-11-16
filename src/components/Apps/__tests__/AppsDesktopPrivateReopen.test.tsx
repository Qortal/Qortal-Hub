/**
 * A restored private app is downloaded and decrypted again when its tab is
 * selected (useHandlePrivateApps, not mocked here: only the node is). Each of
 * these reopenings belongs to its tab and to the account that started it.
 */
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { forwardRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance the hook's messages come from.
import '../../../i18n/i18n';

const NODE = 'http://127.0.0.1:12391';

vi.mock('../../../App', () => ({ getBaseApiReact: () => NODE }));
// As in src/test/setup.ts, plus the address the hook builds previews at.
vi.mock('../../../background/background', () => ({
  createEndpoint: async (path: string) => `http://127.0.0.1:12391${path}`,
  performPowTask: vi.fn(async () => ({ success: true, nonce: 0, hash: '00' })),
}));
vi.mock('../AppsLauncher', () => ({
  AppsLauncher: () => null,
  isLauncherShown: () => false,
  isLauncherSubPage: () => false,
}));
vi.mock('../AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('../AppInfo', () => ({ AppInfo: () => null }));
vi.mock('../AppPublish', () => ({ AppPublish: () => null }));
vi.mock('../AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));
vi.mock('../TabComponent', () => ({
  default: ({ app, isSelected, onClose, onSelect }: any) => (
    <div
      data-testid="tab"
      data-selected={isSelected ? 'yes' : 'no'}
      data-tabid={app?.tabId}
    >
      <button onClick={onSelect}>{`open ${app?.name}`}</button>
      <button onClick={onClose}>{`close ${app?.name}`}</button>
    </div>
  ),
}));
vi.mock('../AppViewerContainer', () => ({
  default: forwardRef<HTMLDivElement, { app: Record<string, any> }>(
    ({ app }, ref) => (
      <div
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
vi.mock('../../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId: vi.fn(),
}));
vi.mock('../../Chat/MessageDisplay', () => ({
  extractComponents: vi.fn(() => null),
}));
vi.mock('../../Desktop/CustomTitleBar', () => ({
  appChromeOffsetPx: '0px',
  appHeighOffsetPx: '0px',
}));
vi.mock('../../Snackbar/Snackbar', () => ({ CustomizedSnackbars: () => null }));

import { userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import { AppsDesktop } from '../AppsDesktop';

const minter = {
  service: 'DOCUMENT',
  name: 'Minter',
  identifier: 'app-id',
  groupId: 42,
};
const APP_DATA = `${NODE}/arbitrary/DOCUMENT/Minter/app-id?encoding=base64`;
const PREVIEW_BUILD = `${NODE}/arbitrary/APP/Minter/zip?preview=true`;
const PREVIEW_URL = `${NODE}/render/hash/abc?secret=xyz`;

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
/** Lets the node answer the download of Minter's data. */
let finishDownload: () => void;
let sendMessage: ReturnType<typeof vi.fn>;
let closedMessages: string[];
const recordClose = (event: CustomEvent) => {
  closedMessages.push(event.detail?.sourceId);
};

/** Signs in an account and shows Hub's Apps view for it. */
const signIn = (address: string) => {
  act(() => {
    store.set(userInfoAtom, { address });
  });
  return render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
};

/** Signing out removes the signed-in part of Hub, the Apps view with it. */
const signOut = (view: ReturnType<typeof render>) => {
  act(() => {
    view.unmount();
    store.set(userInfoAtom, null);
  });
};

const click = (label: string) => {
  act(() => {
    fireEvent.click(screen.getByText(label));
  });
};

/** Lets every step waiting on a promise go on. */
const settle = async () => {
  for (let round = 0; round < 20; round += 1) {
    await act(async () => {});
  }
};

const strip = () =>
  screen.queryAllByTestId('tab').map((tab) => ({
    tabId: tab.getAttribute('data-tabid'),
    selected: tab.getAttribute('data-selected') === 'yes',
  }));

const viewers = () =>
  screen.queryAllByTestId('app-viewer').map((viewer) => ({
    tabId: viewer.getAttribute('data-tabid'),
    url: viewer.getAttribute('data-url'),
  }));

const save = (address: string, tabs: Record<string, unknown>[]) =>
  localStorage.setItem(
    `ext_open_tabs:${address}`,
    JSON.stringify({ version: 1, selectedTabId: null, tabs })
  );

const restoredMinter = {
  tabId: 'p1',
  service: 'DOCUMENT',
  name: 'Minter',
  identifier: 'app-id',
  isPrivate: true,
  privateAppProperties: minter,
};

describe('AppsDesktop reopening a restored private app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    store = createStore();
    save('QAlice', [
      restoredMinter,
      { tabId: 't2', service: 'APP', name: 'Q-Mail' },
    ]);

    let download: () => void = () => {};
    const downloaded = new Promise<void>((resolve) => {
      download = resolve;
    });
    finishDownload = () => download();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === APP_DATA) {
          await downloaded;
          return { ok: true, status: 200, text: async () => 'ZW5jcnlwdGVk' };
        }
        if (url === PREVIEW_BUILD && init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            text: async () => '/render/hash/abc?secret=xyz',
          };
        }
        return { ok: false, status: 404, json: async () => [] };
      })
    );
    sendMessage = vi.fn(async (type: string) =>
      type === 'DECRYPT_QORTAL_GROUP_DATA'
        ? btoa(JSON.stringify({ app: 'UEsDBA==', name: 'Minter Helper' }))
        : undefined
    );
    (window as any).sendMessage = sendMessage;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    closedMessages = [];
    document.addEventListener('closeGlobalSnackBar', recordClose);
  });

  afterEach(() => {
    document.removeEventListener('closeGlobalSnackBar', recordClose);
    delete (window as any).sendMessage;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opens the app in its own tab once it is decrypted again', async () => {
    signIn('QAlice');
    click('open Minter');
    await settle();
    expect(fetch).toHaveBeenCalledWith(APP_DATA, expect.anything());
    expect(viewers()).toEqual([]);

    finishDownload();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith('DECRYPT_QORTAL_GROUP_DATA', {
      base64: 'ZW5jcnlwdGVk',
      groupId: 42,
    });
    expect(strip()).toEqual([
      { tabId: 'p1', selected: true },
      { tabId: 't2', selected: false },
    ]);
    expect(viewers()).toEqual([{ tabId: 'p1', url: PREVIEW_URL }]);
  });

  it('does not open it again once its tab was closed while it loaded', async () => {
    signIn('QAlice');
    click('open Minter');
    await settle();
    click('close Minter');
    expect(strip().map((tab) => tab.tabId)).toEqual(['t2']);

    finishDownload();
    await settle();
    expect(strip().map((tab) => tab.tabId)).toEqual(['t2']);
    expect(viewers().map((viewer) => viewer.tabId)).not.toContain('p1');
    // It stopped before decrypting, and took its message away.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(closedMessages).toHaveLength(1);
  });

  it('does not open it in the account signed in after a sign-out', async () => {
    save('QBob', [{ tabId: 'b1', service: 'APP', name: 'Q-Shop' }]);
    const alice = signIn('QAlice');
    click('open Minter');
    await settle();

    signOut(alice);
    signIn('QBob');
    expect(strip()).toEqual([{ tabId: 'b1', selected: false }]);

    finishDownload();
    await settle();
    expect(strip()).toEqual([{ tabId: 'b1', selected: false }]);
    expect(screen.queryByText('open Minter')).toBeNull();
    // Nothing was decrypted while the other account was signed in.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not open it in a new sign-in of the same account either', async () => {
    const first = signIn('QAlice');
    click('open Minter');
    await settle();

    signOut(first);
    signIn('QAlice');
    finishDownload();
    await settle();
    // The tabs are back as after a restart: nothing selected or loaded.
    expect(strip()).toEqual([
      { tabId: 'p1', selected: false },
      { tabId: 't2', selected: false },
    ]);
    expect(viewers()).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('leaves the selection alone when another tab is chosen while it loads', async () => {
    signIn('QAlice');
    click('open Minter');
    await settle();
    click('open Q-Mail');

    finishDownload();
    await settle();
    expect(strip()).toEqual([
      { tabId: 'p1', selected: false },
      { tabId: 't2', selected: true },
    ]);
    // The app waits in its own tab for when it is chosen.
    expect(viewers()).toContainEqual({ tabId: 'p1', url: PREVIEW_URL });
    click('open Minter');
    await settle();
    expect(strip()).toEqual([
      { tabId: 'p1', selected: true },
      { tabId: 't2', selected: false },
    ]);
    // Choosing it shows the app it already has: nothing is downloaded again.
    const downloads = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === APP_DATA);
    expect(downloads).toHaveLength(1);
  });
});
