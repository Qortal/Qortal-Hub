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
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import {
  findAppBudget,
  refillAppBudget,
  resetAppBudgetsForTests,
  takeFromAppBudget,
  type BudgetApp,
} from '../../qortal/appBudgets';
import { lightTheme } from '../../styles/theme-light';
import { QdnCardDock } from '../Save/QdnSettingsCard';
import { AppBudgetNotices } from './AppBudgetNotices';

vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));

const ACCOUNT = 'QViewer';
const OTHER_ACCOUNT = 'QOtherViewer';
const APP: BudgetApp = { service: 'APP', name: 'Opened-App' };
const SITE: BudgetApp = { service: 'WEBSITE', name: 'Another-Site' };
const NOTICE = (name: string) =>
  `${name} used its budget for 50 actions in the last day`;

let store: ReturnType<typeof createStore>;

// As Group mounts it, in the card dock at the bottom of the page.
const renderNotices = () => {
  store = createStore();
  store.set(userInfoAtom, { address: ACCOUNT, name: 'Viewer' });
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <QdnCardDock page>
          <AppBudgetNotices />
        </QdnCardDock>
      </ThemeProvider>
    </Provider>
  );
};

/** The app's budget lets `count` votes through, a second apart. */
const busyDay = (app = APP, address = ACCOUNT, count = 50) =>
  act(() => {
    const start = Date.now();
    refillAppBudget(address, app, {
      amount: BigInt(100000000),
      expiresAt: null,
      limits: 'none',
    });
    for (let i = 0; i < count; i += 1) {
      const decision = takeFromAppBudget({
        address,
        app,
        kind: 'vote',
        count: 1,
        fee: BigInt(1000000),
        now: start + i,
      });
      if (decision.kind !== 'take') throw new Error(decision.kind);
      decision.ticket.done({ poll: `poll-${i}` });
      decision.ticket.release();
    }
  });

beforeEach(() => {
  window.localStorage.clear();
  resetAppBudgetsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the notice when an app does many things without asking', () => {
  it("comes with the budget's 50th action of a day, not before", () => {
    renderNotices();
    busyDay(APP, ACCOUNT, 49);
    expect(screen.queryByText(NOTICE('Opened-App'))).toBeNull();
    busyDay(APP, ACCOUNT, 1);
    expect(
      screen.getByRole('dialog', { name: NOTICE('Opened-App') })
    ).toBeTruthy();
  });

  it('goes for good with OK', async () => {
    renderNotices();
    busyDay();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(screen.queryByText(NOTICE('Opened-App'))).toBeNull()
    );
    expect(findAppBudget(ACCOUNT, APP).notice.seen).toBe(true);
  });

  it('opens the budget with its list of actions with See them', () => {
    renderNotices();
    busyDay();
    fireEvent.click(screen.getByRole('button', { name: 'See them' }));

    const window_ = screen.getByRole('dialog', { name: 'App budgets' });
    const card = within(window_).getByTestId('app-budget-APP-Opened-App');
    expect(within(card).getAllByTestId('budget-activity-item')).toHaveLength(
      50
    );
    expect(findAppBudget(ACCOUNT, APP).notice.seen).toBe(true);

    fireEvent.click(within(window_).getByRole('button', { name: 'Close' }));
    return waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'App budgets' })).toBeNull()
    );
  });

  it('waits while Hub is locked', () => {
    renderNotices();
    act(() => store.set(appLockedAtom, true));
    busyDay();
    expect(screen.queryByText(NOTICE('Opened-App'))).toBeNull();
    act(() => store.set(appLockedAtom, false));
    expect(screen.getByText(NOTICE('Opened-App'))).toBeTruthy();
  });

  it("closes the budget's window when Hub locks, and when the account changes", async () => {
    renderNotices();
    busyDay();
    fireEvent.click(screen.getByRole('button', { name: 'See them' }));
    act(() => store.set(appLockedAtom, true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'App budgets' })).toBeNull()
    );
    act(() => store.set(appLockedAtom, false));
    expect(screen.queryByRole('dialog', { name: 'App budgets' })).toBeNull();

    busyDay(SITE);
    fireEvent.click(screen.getByRole('button', { name: 'See them' }));
    expect(screen.getByRole('dialog', { name: 'App budgets' })).toBeTruthy();
    act(() =>
      store.set(userInfoAtom, { address: OTHER_ACCOUNT, name: 'Other' })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'App budgets' })).toBeNull()
    );
    // Back on the first account, it stays closed.
    act(() => store.set(userInfoAtom, { address: ACCOUNT, name: 'Viewer' }));
    expect(screen.queryByRole('dialog', { name: 'App budgets' })).toBeNull();
  });

  it("never shows another account's notice", () => {
    renderNotices();
    busyDay(APP, OTHER_ACCOUNT);
    expect(screen.queryByText(NOTICE('Opened-App'))).toBeNull();
  });

  it('shows the oldest first, then the next', async () => {
    renderNotices();
    busyDay(SITE);
    busyDay(APP);
    expect(screen.getByText(NOTICE('Another-Site'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(screen.getByText(NOTICE('Opened-App'))).toBeTruthy()
    );
  });
});
