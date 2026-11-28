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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import i18n from '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import {
  refillAppBudget,
  resetAppBudgetsForTests,
  takeFromAppBudget,
  type AppBudgetActionDetails,
  type AppBudgetActionKind,
} from '../../qortal/appBudgets';
import {
  clearAllSessionPermissions,
  clearSessionPermissionsByTabId,
  getNotificationPermissionKey,
  hasSessionPermission,
  setPermission,
  setSessionPermissions,
  VALID_SESSION_PERMISSIONS,
} from '../../qortal/qortal-requests';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { GlobalQortalNavBar } from '../Desktop/GlobalQortalNavBar';
import { SESSION_PERMISSIONS_NOT_READ } from '../../qortal/alwaysAllowChoices';
import { sessionPermissionText } from './AllowedWithoutAsking';

// The budget panel as App mounts it, in the search bar, with the real stores
// of "always allow" boxes and session permissions.
vi.mock('../QMailStatus', () => ({ QMailStatus: () => null }));
vi.mock('../GeneralNotifications', () => ({
  GeneralNotifications: () => null,
}));
vi.mock('../TaskManager/TaskManager', () => ({ TaskManager: () => null }));
vi.mock('../GlobalActions/GlobalActions', () => ({
  GlobalActions: () => null,
}));
vi.mock('../Desktop/SubscriptionsStatus', () => ({
  SubscriptionsStatus: () => null,
}));
vi.mock('../Apps/AppBookmarks', () => ({ AppBookmarksButton: () => null }));
vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));
vi.mock('../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: vi.fn(), status: '' }),
}));
vi.mock('../Apps/AppsLauncher/useLauncherBookmarks', () => ({
  useLauncherBookmarks: () => ({ bookmarks: [], folders: [] }),
}));

const ACCOUNT = 'QViewer';
const OTHER_ACCOUNT = 'QOtherViewer';
const DAY = 24 * 60 * 60 * 1000;
const APP_TAB = { tabId: 't1', name: 'Opened-App', service: 'APP' };

type HubWindow = {
  __qortalCurrentAddress?: string | null;
  appStorage?: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
};
const w = window as unknown as HubWindow;
let hubStore: Record<string, unknown>;
const stored = () =>
  (hubStore.qortalRequestPermissions ?? {}) as Record<string, unknown>;

const renderBar = (mode = 'apps') => {
  const store = createStore();
  store.set(userInfoAtom, { address: ACCOUNT, name: 'Viewer' });
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <GlobalQortalNavBar desktopViewMode={mode} />
      </ThemeProvider>
    </Provider>
  );
};

let tabsToken = 0;
const showTab = (selectedTab: object | null) =>
  act(() => {
    tabsToken += 1;
    executeEvent('setTabsToNav', {
      data: {
        selectedTab,
        tabs: selectedTab ? [selectedTab] : [],
        tabsToken,
      },
    });
  });

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: 'App budgets' }));
  return screen.getByRole('dialog', { name: 'App budgets' });
};

// The tab's list, folded under "Until this tab closes (n)" until opened.
const TAB_LIST = /^Until this tab closes \(\d+\)$/;
const openTabList = async (allowed: HTMLElement) => {
  const toggle = await within(allowed).findByRole('button', { name: TAB_LIST });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
};

/** Ticks a box as the approval window does, for the account signed in. */
const tick = (key: string, address = ACCOUNT) =>
  act(async () => {
    w.__qortalCurrentAddress = address;
    await setPermission(key, true);
    w.__qortalCurrentAddress = ACCOUNT;
  });

beforeEach(() => {
  window.localStorage.clear();
  resetAppBudgetsForTests();
  hubStore = {};
  w.appStorage = {
    get: async (key) => structuredClone(hubStore[key]),
    set: async (key, value) => {
      hubStore[key] = structuredClone(value);
    },
  };
  w.__qortalCurrentAddress = ACCOUNT;
});

afterEach(() => {
  clearAllSessionPermissions();
  delete w.appStorage;
  delete w.__qortalCurrentAddress;
  vi.restoreAllMocks();
});

describe('what the app on screen may do without asking', () => {
  it("lists its boxes and its tab's session permissions, and nothing of other apps or accounts", async () => {
    await tick('qAPPAutoAuth-Opened-App');
    await tick('qAPPAutoWalletBalance-Opened-App-BTC');
    await tick('qAPPAutoAuth-Another-App');
    await tick('qAPPSendChatMessage-Opened-App', OTHER_ACCOUNT);
    setSessionPermissions('t1', 'Opened-App', [
      'PUBLISH_QDN_RESOURCE',
      'GET_USER_ACCOUNT',
    ]);
    setSessionPermissions('t2', 'Opened-App', ['JOIN_GROUP']);
    renderBar();
    showTab(APP_TAB);

    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    expect(await within(allowed).findByText('Sign in')).toBeTruthy();
    // The coin, as the app named it, sits in an isolate of its own.
    expect(
      within(allowed).getByText('See your \u2068BTC\u2069 balance')
    ).toBeTruthy();
    expect(within(allowed).queryByText('Send chat messages')).toBeNull();
    await openTabList(allowed);
    expect(
      within(allowed)
        .getAllByTestId('session-permission')
        .map((button) => button.textContent)
    ).toEqual(['PUBLISH_QDN_RESOURCE']);
    expect(
      within(allowed).getByRole('button', { name: 'Until this tab closes (1)' })
    ).toBeTruthy();
  });

  it("doesn't say nothing is allowed while the boxes are still being read", async () => {
    await tick('qAPPAutoAuth-Opened-App');
    const read = w.appStorage.get;
    const waiting: (() => void)[] = [];
    w.appStorage.get = (key) =>
      new Promise((resolve) => waiting.push(() => resolve(read(key))));
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    expect(
      within(allowed).queryByText(
        'Nothing remembered for it, and nothing allowed until this tab closes.'
      )
    ).toBeNull();

    await act(async () => waiting.forEach((release) => release()));
    expect(await within(allowed).findByText('Sign in')).toBeTruthy();
  });

  it('turns a box off for this account only, keeps it listed, and turns it on again', async () => {
    await tick('qAPPAutoAuth-Opened-App');
    await tick('qAPPAutoAuth-Opened-App', OTHER_ACCOUNT);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');

    fireEvent.click(
      await within(allowed).findByRole('button', { name: 'Turn off: Sign in' })
    );
    const turnOn = await within(allowed).findByRole('button', {
      name: 'Turn on: Sign in',
    });
    expect(within(allowed).getByText('Sign in')).toBeTruthy();
    expect(within(allowed).getByText('Off')).toBeTruthy();
    expect(stored()[`account:${ACCOUNT}:qAPPAutoAuth-Opened-App`]).toBe(false);
    expect(stored()[`account:${OTHER_ACCOUNT}:qAPPAutoAuth-Opened-App`]).toBe(
      true
    );

    fireEvent.click(turnOn);
    expect(
      await within(allowed).findByRole('button', { name: 'Turn off: Sign in' })
    ).toBeTruthy();
    expect(within(allowed).queryByText('Off')).toBeNull();
    expect(stored()[`account:${ACCOUNT}:qAPPAutoAuth-Opened-App`]).toBe(true);
  });

  it('lists a box turned off earlier, to turn on again', async () => {
    await tick('qAPPAutoAuth-Opened-App');
    await act(async () => {
      await setPermission('qAPPAutoAuth-Opened-App', false);
    });
    // A sign-in approved in the window since: the box no longer stands for it.
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_ACCOUNT']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    expect(
      await within(allowed).findByRole('button', { name: 'Turn on: Sign in' })
    ).toBeTruthy();
    // Not offered for another account's box.
    expect(within(allowed).getAllByTestId('always-allow-choice')).toHaveLength(
      1
    );
    await openTabList(allowed);
    expect(
      within(allowed)
        .getAllByTestId('session-permission')
        .map((button) => button.textContent)
    ).toEqual(['GET_USER_ACCOUNT']);
  });

  it('leaves a box on when another account was signed in meanwhile', async () => {
    await tick('qAPPAutoAuth-Opened-App');
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    const turnOff = await within(allowed).findByRole('button', {
      name: 'Turn off: Sign in',
    });

    w.__qortalCurrentAddress = OTHER_ACCOUNT;
    await act(async () => {
      fireEvent.click(turnOff);
    });
    expect(stored()[`account:${ACCOUNT}:qAPPAutoAuth-Opened-App`]).toBe(true);
    expect(
      stored()[`account:${OTHER_ACCOUNT}:qAPPAutoAuth-Opened-App`]
    ).toBeUndefined();
    expect(within(allowed).getByText('Sign in')).toBeTruthy();
  });

  it("folds the tab's list under its count, and opens and closes it on a click", async () => {
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_WALLET', 'LOCK_TAB']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    const toggle = await within(allowed).findByRole('button', {
      name: 'Until this tab closes (2)',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(allowed).queryByTestId('session-permission')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(allowed)
        .getAllByTestId('session-permission')
        .map((button) => button.textContent)
    ).toEqual(['GET_USER_WALLET', 'LOCK_TAB']);
    // Taking one back leaves the list open, with the same count.
    fireEvent.click(
      within(allowed).getByRole('button', { name: 'Turn off: LOCK_TAB' })
    );
    expect(
      await within(allowed).findByRole('button', {
        name: 'Allow again: LOCK_TAB',
      })
    ).toBeTruthy();
    expect(toggle.textContent).toBe('Until this tab closes (2)');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(within(allowed).queryByTestId('session-permission')).toBeNull()
    );
  });

  it('turns a session permission off in this tab only', async () => {
    setSessionPermissions('t1', 'Opened-App', ['PUBLISH_QDN_RESOURCE']);
    setSessionPermissions('t2', 'Opened-App', ['PUBLISH_QDN_RESOURCE']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    await openTabList(allowed);

    fireEvent.click(
      await within(allowed).findByRole('button', {
        name: 'Turn off: PUBLISH_QDN_RESOURCE',
      })
    );
    // Still listed, greyed, to allow again.
    const again = await within(allowed).findByRole('button', {
      name: 'Allow again: PUBLISH_QDN_RESOURCE',
    });
    expect(again.getAttribute('data-state')).toBe('off');
    expect(
      hasSessionPermission('t1', 'Opened-App', 'PUBLISH_QDN_RESOURCE')
    ).toBe(false);
    expect(
      hasSessionPermission('t2', 'Opened-App', 'PUBLISH_QDN_RESOURCE')
    ).toBe(true);

    fireEvent.click(again);
    expect(
      (
        await within(allowed).findByRole('button', {
          name: 'Turn off: PUBLISH_QDN_RESOURCE',
        })
      ).getAttribute('data-state')
    ).toBe('on');
    expect(
      hasSessionPermission('t1', 'Opened-App', 'PUBLISH_QDN_RESOURCE')
    ).toBe(true);
  });

  it('says on hover that a taken-back permission asks first', async () => {
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_WALLET']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    await openTabList(allowed);
    fireEvent.click(
      await within(allowed).findByRole('button', {
        name: 'Turn off: GET_USER_WALLET',
      })
    );
    fireEvent.mouseOver(
      await within(allowed).findByRole('button', {
        name: 'Allow again: GET_USER_WALLET',
      })
    );
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'See your wallet addressesTaken back: the app asks you first. Select it to allow it again until this tab closes.'
    );
  });

  it("says on hover that the app can't start a coin's server once that is taken back", async () => {
    setSessionPermissions('t1', 'Opened-App', ['START_CROSSCHAIN_SERVER']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    await openTabList(allowed);
    fireEvent.click(
      await within(allowed).findByRole('button', {
        name: 'Turn off: START_CROSSCHAIN_SERVER',
      })
    );
    fireEvent.mouseOver(
      await within(allowed).findByRole('button', {
        name: 'Allow again: START_CROSSCHAIN_SERVER',
      })
    );
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      "Have your node connect to a server for another coinTaken back: the app can't do this in this tab. Select it to allow it again until this tab closes."
    );
  });

  it('leaves out the session permissions no request reads', async () => {
    // An app's own request for session permissions can give the tab these.
    setSessionPermissions('t1', 'Opened-App', [
      'GET_SERVER_CONNECTION_HISTORY',
      'INVITE_TO_GROUP',
      'LOCK_TAB',
    ]);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    fireEvent.click(
      await within(allowed).findByRole('button', {
        name: 'Until this tab closes (1)',
      })
    );
    expect(
      within(allowed)
        .getAllByTestId('session-permission')
        .map((button) => button.textContent)
    ).toEqual(['LOCK_TAB']);
  });

  it('says nothing is allowed when the tab holds only permissions no request reads', async () => {
    setSessionPermissions('t1', 'Opened-App', [
      'CREATE_GROUP',
      'KICK_FROM_GROUP',
    ]);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    expect(
      await within(allowed).findByText(
        'Nothing remembered for it, and nothing allowed until this tab closes.'
      )
    ).toBeTruthy();
    expect(
      within(allowed).queryByRole('button', { name: TAB_LIST })
    ).toBeNull();
  });

  it('forgets what was taken back once the tab closes', async () => {
    setSessionPermissions('t1', 'Opened-App', ['LOCK_TAB']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    await openTabList(allowed);
    fireEvent.click(
      await within(allowed).findByRole('button', { name: 'Turn off: LOCK_TAB' })
    );
    expect(
      await within(allowed).findByRole('button', {
        name: 'Allow again: LOCK_TAB',
      })
    ).toBeTruthy();
    act(() => clearSessionPermissionsByTabId('t1'));
    await waitFor(() =>
      expect(
        within(allowed).queryByRole('button', { name: TAB_LIST })
      ).toBeNull()
    );
  });

  it('turns the Sign in box off with the sign-in it gave this tab, and leaves the rest', async () => {
    await tick('qAPPAutoAuth-Opened-App');
    setSessionPermissions('t1', 'Opened-App', [
      'GET_USER_ACCOUNT',
      'GET_WALLET_BALANCE',
    ]);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    await openTabList(allowed);
    // The box stands for the tab's sign-in too.
    expect(
      (await within(allowed).findAllByTestId('session-permission')).map(
        (button) => button.textContent
      )
    ).toEqual(['GET_WALLET_BALANCE']);

    fireEvent.click(
      within(allowed).getByRole('button', { name: 'Turn off: Sign in' })
    );
    await waitFor(() =>
      expect(hasSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT')).toBe(
        false
      )
    );
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_WALLET_BALANCE')).toBe(
      true
    );
    expect(
      await within(allowed).findByRole('button', { name: 'Turn on: Sign in' })
    ).toBeTruthy();
    // The sign-in went with its box: it isn't listed apart to allow again.
    expect(
      within(allowed)
        .getAllByTestId('session-permission')
        .map((button) => button.textContent)
    ).toEqual(['GET_WALLET_BALANCE']);
  });

  it("lists the app's notifications, and turns them off as the notification settings do", async () => {
    await act(async () => {
      await setPermission(getNotificationPermissionKey('Opened-App'), true);
    });
    setSessionPermissions('t1', 'Opened-App', ['NOTIFICATION_PERMISSION']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    expect(
      await within(allowed).findByText('Show you notifications')
    ).toBeTruthy();
    expect(
      within(allowed).queryByRole('button', { name: TAB_LIST })
    ).toBeNull();

    fireEvent.click(
      within(allowed).getByRole('button', {
        name: 'Turn off: Show you notifications',
      })
    );
    const turnOn = await within(allowed).findByRole('button', {
      name: 'Turn on: Show you notifications',
    });
    expect(stored()[getNotificationPermissionKey('Opened-App', ACCOUNT)]).toBe(
      false
    );
    expect(
      hasSessionPermission('t1', 'Opened-App', 'NOTIFICATION_PERMISSION')
    ).toBe(false);
    expect(
      within(allowed).queryByRole('button', { name: TAB_LIST })
    ).toBeNull();

    fireEvent.click(turnOn);
    expect(
      await within(allowed).findByRole('button', {
        name: 'Turn off: Show you notifications',
      })
    ).toBeTruthy();
    expect(stored()[getNotificationPermissionKey('Opened-App', ACCOUNT)]).toBe(
      true
    );
  });

  it('shows a box ticked or a permission given while the panel is open', async () => {
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');
    expect(
      await within(allowed).findByText(
        'Nothing remembered for it, and nothing allowed until this tab closes.'
      )
    ).toBeTruthy();

    await tick('qAPPSendChatMessage-Opened-App');
    act(() => {
      setSessionPermissions('t1', 'Opened-App', ['GET_LIST_ITEMS']);
    });
    expect(await within(allowed).findByText('Send chat messages')).toBeTruthy();
    await openTabList(allowed);
    expect(
      within(allowed).getByRole('button', { name: 'Turn off: GET_LIST_ITEMS' })
    ).toBeTruthy();
  });
});

describe('what "until this tab closes" means', () => {
  it('explains the list with an (i), and each permission in words on hover', async () => {
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_WALLET', 'LOCK_TAB']);
    renderBar();
    showTab(APP_TAB);
    const allowed = within(openPanel()).getByTestId('allowed-for-app');

    fireEvent.mouseOver(
      await within(allowed).findByRole('button', { name: 'What this means' })
    );
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      "What this app may do in this tab without asking you, until you close the tab. It came with something you approved, such as its sign-in. Select one to take it back: the app then asks you first, or can't do it. You can allow it again here until the tab closes."
    );

    await openTabList(allowed);
    const wallet = within(allowed).getByRole('button', {
      name: 'Turn off: GET_USER_WALLET',
    });
    fireEvent.mouseOver(wallet);
    await waitFor(() =>
      expect(wallet.getAttribute('aria-describedby')).toBeTruthy()
    );
    expect(
      document.getElementById(wallet.getAttribute('aria-describedby'))
        .textContent
    ).toBe('See your wallet addresses');
    fireEvent.mouseOver(
      within(allowed).getByRole('button', { name: 'Turn off: LOCK_TAB' })
    );
    expect(
      await screen.findByText('Ask you to confirm before this tab closes')
    ).toBeTruthy();
  });

  it('has words of its own for every action Hub grants for a session and reads', () => {
    const t = i18n.t.bind(i18n);
    const listed = VALID_SESSION_PERMISSIONS.filter(
      (permission) => !SESSION_PERMISSIONS_NOT_READ.has(permission)
    );
    const texts = listed.map((permission) =>
      sessionPermissionText(t, permission)
    );
    for (const [index, text] of texts.entries()) {
      // Not the action's own name, and not a key without a string.
      expect(text).not.toContain(listed[index]);
      expect(text).not.toContain('app_budgets');
    }
    expect(new Set(texts).size).toBe(texts.length);
    expect(sessionPermissionText(t, 'NEWER_ACTION')).toBe(
      'Use NEWER_ACTION without asking you'
    );
    // One no request reads is never listed, and has no words of its own.
    expect(sessionPermissionText(t, 'INVITE_TO_GROUP')).toBe(
      'Use INVITE_TO_GROUP without asking you'
    );
  });
});

describe('boxes for every app and for other apps', () => {
  it('shows the lists box with the app on screen, and not again below', async () => {
    await tick('qAPPAutoLists');
    await tick('qAPPAutoAuth-Another-App');
    renderBar();
    showTab(APP_TAB);
    const panel = openPanel();

    const allowed = within(panel).getByTestId('allowed-for-app');
    expect(
      await within(allowed).findByText('Read your lists, in every app')
    ).toBeTruthy();
    const others = await within(panel).findByTestId('allowed-for-other-apps');
    expect(within(others).getByText('Another-App')).toBeTruthy();
    expect(within(others).getByText('Sign in')).toBeTruthy();
    expect(
      within(others).queryByText('Read your lists, in every app')
    ).toBeNull();
  });

  it('lists every app with a box on Home, the lists box under Every app', async () => {
    await tick('qAPPAutoLists');
    await tick('qAPPAutoAuth-Opened-App');
    renderBar('home');
    const panel = openPanel();

    const others = await within(panel).findByTestId('allowed-for-other-apps');
    expect(
      within(others).getByText('Always allowed in other apps')
    ).toBeTruthy();
    expect(within(others).getByText('Every app')).toBeTruthy();
    expect(within(others).getByText('Opened-App')).toBeTruthy();
    expect(within(panel).queryByTestId('allowed-for-app')).toBeNull();
  });

  it('shows each app as a small tile with its picture, and the lists box as Every app', async () => {
    await tick('qAPPAutoLists');
    await tick('qAPPAutoAuth-Opened-App');
    await tick('qAPPSendChatMessage-Opened-App');
    await tick('qAPPAutoAuth-Another-App');
    renderBar('home');
    const others = await within(openPanel()).findByTestId(
      'allowed-for-other-apps'
    );

    const tiles = within(others).getAllByTestId('allowed-other-app');
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'Every app',
      'Another-App',
      'Opened-App',
    ]);
    // An app's picture comes from its name; Every app has none.
    expect(tiles[1].querySelector('img')?.getAttribute('src')).toContain(
      '/arbitrary/THUMBNAIL/Another-App/qortal_avatar'
    );
    expect(tiles[0].querySelector('img')).toBeNull();
    // Each tile holds its own app's boxes.
    const opened = within(others).getByRole('group', { name: 'Opened-App' });
    expect(within(opened).getAllByTestId('always-allow-choice')).toHaveLength(
      2
    );
    expect(
      within(opened).getByRole('button', { name: 'Turn off: Sign in' })
    ).toBeTruthy();
  });

  it('keeps a box turned off in another app listed while the panel is open, to turn on again', async () => {
    await tick('qAPPAutoAuth-Another-App');
    renderBar('home');
    const others = await within(openPanel()).findByTestId(
      'allowed-for-other-apps'
    );
    fireEvent.click(
      within(others).getByRole('button', { name: 'Turn off: Sign in' })
    );
    const turnOn = await within(others).findByRole('button', {
      name: 'Turn on: Sign in',
    });
    expect(stored()[`account:${ACCOUNT}:qAPPAutoAuth-Another-App`]).toBe(false);

    fireEvent.click(turnOn);
    expect(
      await within(others).findByRole('button', { name: 'Turn off: Sign in' })
    ).toBeTruthy();
    expect(stored()[`account:${ACCOUNT}:qAPPAutoAuth-Another-App`]).toBe(true);
  });

  it("doesn't list another app's box that is off when the panel opens", async () => {
    await tick('qAPPAutoAuth-Another-App');
    await act(async () => {
      await setPermission('qAPPAutoAuth-Another-App', false);
    });
    await tick('qAPPAutoAuth-Third-App');
    renderBar('home');
    const others = await within(openPanel()).findByTestId(
      'allowed-for-other-apps'
    );
    expect(within(others).getByText('Third-App')).toBeTruthy();
    expect(within(others).queryByText('Another-App')).toBeNull();
  });
});

describe("a budget's recent activity", () => {
  const actOnce = (
    at: number,
    kind: AppBudgetActionKind,
    details: AppBudgetActionDetails
  ) => {
    vi.setSystemTime(at);
    const decision = takeFromAppBudget({
      address: ACCOUNT,
      app: { service: 'APP', name: 'Opened-App' },
      kind,
      count: 1,
      fee: kind === 'chat' ? BigInt(0) : BigInt(1000000),
      resources:
        kind === 'publish'
          ? [JSON.stringify(['BLOG_POST', 'publisher', 'post-1'])]
          : undefined,
      now: at,
    });
    if (decision.kind !== 'take') throw new Error(decision.kind);
    decision.ticket.done(details);
    decision.ticket.release();
  };

  it('lists its last actions, newest first, the parts an app named kept apart', async () => {
    const start = new Date(2026, 10, 19, 12, 0, 0).getTime();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(start);
    refillAppBudget(
      ACCOUNT,
      { service: 'APP', name: 'Opened-App' },
      {
        amount: BigInt(100000000),
        expiresAt: start + 30 * DAY,
        limits: 'none',
      },
      start
    );
    actOnce(start + 1000, 'vote', { poll: 'Lunch' });
    actOnce(start + 2000, 'publish', {
      service: 'BLOG_POST',
      name: 'Publisher',
      identifier: 'post-1',
    });
    actOnce(start + 3000, 'chat', { recipient: 'Qrecipient\u202Eevil' });
    actOnce(start + 4000, 'chat', { groupId: 7 });
    vi.useRealTimers();

    renderBar();
    showTab(APP_TAB);
    const card = within(openPanel()).getByTestId('app-budget-APP-Opened-App');
    fireEvent.click(
      within(card).getByRole('button', { name: /Recent activity \(4\)/ })
    );

    const items = within(card).getAllByTestId('budget-activity-item');
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'Chat message in group 7',
      'Direct message to \u2068Qrecipientevil\u2069',
      'Published \u2068post-1\u2069 (\u2068BLOG_POST\u2069)',
      'Voted in the poll \u2068Lunch\u2069',
    ]);
    expect(items[0].textContent).toContain('no fee');
    expect(items[2].textContent).toContain('0.01 QORT');
  });

  it('says when there is nothing yet', () => {
    refillAppBudget(
      ACCOUNT,
      { service: 'APP', name: 'Opened-App' },
      {
        amount: BigInt(100000000),
        expiresAt: Date.now() + 30 * DAY,
        limits: 'standard',
      }
    );
    renderBar();
    showTab(APP_TAB);
    const card = within(openPanel()).getByTestId('app-budget-APP-Opened-App');
    fireEvent.click(
      within(card).getByRole('button', { name: /Recent activity \(0\)/ })
    );
    expect(within(card).getByText('Nothing yet')).toBeTruthy();
  });
});
