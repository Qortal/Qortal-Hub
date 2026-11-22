import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import {
  findAppBudget,
  refillAppBudget,
  resetAppBudgetsForTests,
  takeFromAppBudget,
  type BudgetApp,
} from '../../qortal/appBudgets';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { GlobalQortalNavBar } from '../Desktop/GlobalQortalNavBar';

// The search bar as App mounts it, with the real budget button and panel;
// the bar's other widgets are not under test here.
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
const QORT = BigInt(100000000);
const DAY = 24 * 60 * 60 * 1000;
const APP: BudgetApp = { service: 'APP', name: 'Opened-App' };
const SITE: BudgetApp = { service: 'WEBSITE', name: 'Opened-App' };
const APP_TAB = { tabId: 't1', name: 'Opened-App', service: 'APP' };

let store: ReturnType<typeof createStore>;

const renderBar = (mode = 'apps') => {
  store = createStore();
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
/** What the tab strip tells the bar: its tabs and the one selected. */
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

const budgetButton = () => screen.getByRole('button', { name: 'App budgets' });

const openPanel = () => {
  fireEvent.click(budgetButton());
  return screen.getByRole('dialog', { name: 'App budgets' });
};

const give = (amount: bigint, app = APP, address = ACCOUNT) =>
  act(() => {
    refillAppBudget(address, app, {
      amount,
      expiresAt: Date.now() + 30 * DAY,
      limits: 'standard',
    });
  });

beforeEach(() => {
  window.localStorage.clear();
  resetAppBudgetsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the budget button in the search bar', () => {
  it('sits between Pin and Go, and Go has a name', () => {
    renderBar('home');
    const go = screen.getByLabelText('Go');
    expect(
      budgetButton().compareDocumentPosition(go) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("leaves no room for Copy and Pin while there's nothing to copy or pin, so the buttons sit side by side", () => {
    renderBar('home');
    for (const name of [/^copy link$/i, /^pin/i]) {
      const button = screen.getByRole('button', { hidden: true, name });
      expect(getComputedStyle(button.parentElement).display).toBe('none');
    }
    expect(budgetButton()).toBeTruthy();
    expect(screen.getByLabelText('Go')).toBeTruthy();
  });

  it('is there on Home and lists every budget, without a section for one app', () => {
    renderBar('home');
    give(QORT);
    give(QORT, SITE);
    const panel = openPanel();
    expect(within(panel).queryByText('This app')).toBeNull();
    expect(within(panel).getByText('All budgets')).toBeTruthy();
    expect(within(panel).getByTestId('app-budget-APP-Opened-App')).toBeTruthy();
    expect(
      within(panel).getByTestId('app-budget-WEBSITE-Opened-App')
    ).toBeTruthy();
  });

  it('says there are none yet on Home', () => {
    renderBar('home');
    const panel = openPanel();
    expect(within(panel).getByText(/No budgets yet/)).toBeTruthy();
  });

  it('adds a budget for the app on screen, for this account only', () => {
    renderBar();
    showTab(APP_TAB);
    const panel = openPanel();
    expect(within(panel).getByText('This app')).toBeTruthy();
    expect(within(panel).getByText(/Opened-App has no budget/)).toBeTruthy();
    // 1 QORT, a month and the standard limits are picked to start with.
    expect(
      within(panel).getByText('About 100 actions at 0.01 QORT each')
    ).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add budget' }));

    const budget = findAppBudget(ACCOUNT, APP);
    expect(budget).toMatchObject({
      total: '100000000',
      used: '0',
      limits: 'standard',
    });
    expect(budget.expiresAt).toBeGreaterThan(Date.now() + 27 * DAY);
    expect(findAppBudget(OTHER_ACCOUNT, APP)).toBeNull();
    expect(within(panel).getByText('0 of 1 QORT used')).toBeTruthy();
  });

  it('adds a custom amount with no end date and no limit', () => {
    renderBar();
    showTab(APP_TAB);
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Custom' }));
    const add = within(panel).getByRole('button', { name: 'Add budget' });
    const field = within(panel).getByRole('textbox', {
      name: 'Amount in QORT',
    });
    fireEvent.change(field, { target: { value: '0.001' } });
    expect(within(panel).getByText('From 0.01 to 1,000 QORT')).toBeTruthy();
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: '2.5' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'No end date' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'No limit' }));
    fireEvent.click(add);
    expect(findAppBudget(ACCOUNT, APP)).toMatchObject({
      total: '250000000',
      expiresAt: null,
      limits: 'none',
    });
  });

  it('shows a dot while the app on screen has a running budget', () => {
    renderBar();
    showTab(APP_TAB);
    const dot = () =>
      within(budgetButton()).queryByTestId('app-budgets-running');
    expect(dot()).toBeNull();
    give(QORT);
    expect(dot()).toBeTruthy();
  });

  it("doesn't take a website's budget for a Q-App of the same name", () => {
    renderBar();
    showTab(APP_TAB);
    give(QORT, SITE);
    const panel = openPanel();
    expect(within(panel).getByText(/Opened-App has no budget/)).toBeTruthy();
    expect(within(panel).getByText('Other budgets')).toBeTruthy();
  });

  it.each([
    ['a launcher tab', { tabId: 't2', internal: 'launcher' }],
    ['a page of Hub', { tabId: 't3', name: 'Wallets', service: 'INTERNAL' }],
    [
      'a private app',
      {
        tabId: 't4',
        name: 'Opened-App',
        service: 'APP',
        isPrivate: true,
        privateAppProperties: { name: 'Opened-App', service: 'APP' },
      },
    ],
  ])('offers no budget for %s', (_label, tab) => {
    renderBar();
    showTab(tab);
    const panel = openPanel();
    expect(within(panel).queryByText('This app')).toBeNull();
  });

  it('shows the other account its own budgets', () => {
    renderBar();
    showTab(APP_TAB);
    give(QORT);
    act(() => {
      store.set(userInfoAtom, { address: OTHER_ACCOUNT, name: 'Other' });
    });
    const panel = openPanel();
    expect(within(panel).getByText(/Opened-App has no budget/)).toBeTruthy();
  });

  it('follows the budget as requests use it', () => {
    renderBar();
    showTab(APP_TAB);
    give(QORT);
    const panel = openPanel();
    expect(within(panel).getByText('0 of 1 QORT used')).toBeTruthy();
    act(() => {
      const decision = takeFromAppBudget({
        address: ACCOUNT,
        app: APP,
        kind: 'vote',
        count: 1,
        fee: BigInt(1000000),
      });
      if (decision.kind === 'take') decision.ticket.done();
    });
    expect(within(panel).getByText('0.01 of 1 QORT used')).toBeTruthy();
    expect(within(panel).getByText('1 action')).toBeTruthy();
  });
});

describe('what the panel does with a budget', () => {
  const openWithBudget = () => {
    renderBar();
    showTab(APP_TAB);
    give(QORT);
    return openPanel();
  };

  it('tops up what is left', () => {
    const panel = openWithBudget();
    fireEvent.click(within(panel).getByRole('button', { name: 'Top up' }));
    fireEvent.click(within(panel).getByRole('button', { name: '5 QORT' }));
    // The amount only: the end date and limits stay.
    expect(within(panel).queryByText('Ends')).toBeNull();
    fireEvent.click(
      within(panel).getAllByRole('button', { name: 'Top up' }).pop()
    );
    expect(findAppBudget(ACCOUNT, APP).total).toBe('600000000');
    expect(within(panel).getByText('0 of 6 QORT used')).toBeTruthy();
  });

  it('changes the end date and limits', () => {
    const panel = openWithBudget();
    fireEvent.click(within(panel).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'In 1 year' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Higher' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    const budget = findAppBudget(ACCOUNT, APP);
    expect(budget.limits).toBe('higher');
    expect(budget.expiresAt).toBeGreaterThan(Date.now() + 300 * DAY);
  });

  it('keeps the end date when only the limits change', () => {
    renderBar();
    showTab(APP_TAB);
    // Ends in 90 days: neither of the quick choices.
    act(() => {
      refillAppBudget(ACCOUNT, APP, {
        amount: QORT,
        expiresAt: Date.now() + 90 * DAY,
        limits: 'standard',
      });
    });
    const panel = openPanel();
    const before = findAppBudget(ACCOUNT, APP).expiresAt;
    fireEvent.click(within(panel).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'No limit' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    const budget = findAppBudget(ACCOUNT, APP);
    expect(budget.limits).toBe('none');
    // The same day: it ends at the end of it.
    expect(new Date(budget.expiresAt).toDateString()).toBe(
      new Date(before).toDateString()
    );
  });

  it('removes it after asking', () => {
    const panel = openWithBudget();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
    expect(
      within(panel).getByText(/Remove Opened-App's budget\?/)
    ).toBeTruthy();
    fireEvent.click(
      within(panel).getAllByRole('button', { name: 'Remove' }).pop()
    );
    expect(findAppBudget(ACCOUNT, APP)).toBeNull();
    expect(within(panel).getByText(/Opened-App has no budget/)).toBeTruthy();
  });

  it('lists an ended budget with Renew, which starts it again with the new amount', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    renderBar('home');
    act(() => {
      refillAppBudget(
        ACCOUNT,
        APP,
        { amount: QORT, expiresAt: Date.now() + DAY, limits: 'standard' },
        Date.now()
      );
    });
    vi.setSystemTime(Date.now() + 2 * DAY);
    const panel = openPanel();
    expect(within(panel).getByText('Ended')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { expanded: false }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Renew' }));
    fireEvent.click(within(panel).getByRole('button', { name: '10 QORT' }));
    fireEvent.click(
      within(panel).getAllByRole('button', { name: 'Renew' }).pop()
    );
    const budget = findAppBudget(ACCOUNT, APP);
    expect(BigInt(budget.total) - BigInt(budget.used)).toBe(QORT * BigInt(10));
    expect(budget.expiresAt).toBeGreaterThan(Date.now());
  });

  it('closes a Renew form when the budget runs again, renewed in the approval window', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    renderBar();
    showTab(APP_TAB);
    act(() => {
      refillAppBudget(
        ACCOUNT,
        APP,
        { amount: QORT, expiresAt: Date.now() + DAY, limits: 'standard' },
        Date.now()
      );
    });
    vi.setSystemTime(Date.now() + 2 * DAY);
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Renew' }));
    expect(within(panel).getByText('Ends')).toBeTruthy();
    // The window renews it meanwhile.
    act(() => {
      refillAppBudget(ACCOUNT, APP, {
        amount: QORT,
        expiresAt: Date.now() + 30 * DAY,
        limits: 'standard',
      });
    });
    expect(within(panel).queryByText('Ends')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Top up' })).toBeTruthy();
  });

  it('says so when the budget could not be saved', () => {
    const panel = openWithBudget();
    fireEvent.click(within(panel).getByRole('button', { name: 'Top up' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('full');
      });
    fireEvent.click(
      within(panel).getAllByRole('button', { name: 'Top up' }).pop()
    );
    setItem.mockRestore();
    expect(
      within(panel).getByText("The budget couldn't be saved on this PC.")
    ).toBeTruthy();
    expect(findAppBudget(ACCOUNT, APP).total).toBe('100000000');
  });
});
