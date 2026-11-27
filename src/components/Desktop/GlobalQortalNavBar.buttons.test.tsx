import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import {
  navigationControllerAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { GlobalQortalNavBar } from './GlobalQortalNavBar';
import type { HubZoomState } from './hubZoom';

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
vi.mock('../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp: vi.fn(), status: '' }),
}));
vi.mock('../Apps/AppsLauncher/useLauncherBookmarks', () => ({
  useLauncherBookmarks: () => ({ data: null, isReady: true }),
}));

const TORQ_TAB = { name: 'Torq', service: 'APP', tabId: 't1' };

const renderBar = (mode: string) => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QViewer', name: 'Viewer' });
  store.set(navigationControllerAtom, {
    t1: { currentLink: 'qortal://APP/Torq' },
  } as never);
  store.set(availableQappsAtom, [
    { metadata: { title: 'Torq' }, name: 'Torq', service: 'APP' },
  ] as never);
  store.set(sortablePinnedAppsAtom, [] as never);
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
const showTab = (tab: object | null) =>
  act(() => {
    tabsToken += 1;
    executeEvent('setTabsToNav', {
      data: { selectedTab: tab, tabs: tab ? [tab] : [], tabsToken },
    });
  });

/** The buttons at the end of the search field, hidden ones too. */
const goButton = () =>
  document
    .querySelector('[data-testid="ArrowOutwardIcon"]')
    ?.closest('button') as HTMLElement;
const copyButton = () =>
  screen.getByRole('button', { hidden: true, name: /^copy link$/i });
const pinButton = () =>
  screen.getByRole('button', { hidden: true, name: /^(Pin|Unpin)$/ });
/** Takes no room: not shown at all, rather than shown invisible. */
const takesNoRoom = (button: HTMLElement) => {
  const wrapper = button.closest('span') ?? button;
  return getComputedStyle(wrapper).display === 'none';
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => [] }) as unknown as Response)
  );
});
afterEach(() => {
  delete (window as any).hubZoom;
  vi.unstubAllGlobals();
});

describe('GlobalQortalNavBar search field buttons', () => {
  it('shows Go only with something written in the field', () => {
    const input = renderBar('home');

    expect(goButton()).not.toBeVisible();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'torq' } });
    expect(goButton()).toBeVisible();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(goButton()).not.toBeVisible();
  });

  it('keeps no room for the buttons it hides', () => {
    renderBar('home');

    // Home: no link to copy, no app to pin, nothing written.
    expect(takesNoRoom(copyButton())).toBe(true);
    expect(takesNoRoom(pinButton())).toBe(true);
    expect(takesNoRoom(goButton())).toBe(true);
  });

  it('shows Copy, Pin and Go for an app on screen', () => {
    renderBar('apps');
    showTab(TORQ_TAB);

    expect(copyButton()).toBeVisible();
    expect(pinButton()).toBeVisible();
    // The app's link is in the field.
    expect(goButton()).toBeVisible();
  });

  it('puts the magnifier in the row with the other buttons, first', async () => {
    const state: HubZoomState = {
      hub: { level: 0, canIn: true, canOut: true },
      app: { level: 0.5, canIn: true, canOut: true },
    };
    (window as any).hubZoom = {
      onScreen: vi.fn(),
      panelPointer: vi.fn(),
      get: vi.fn(async () => state),
      change: vi.fn(async () => state),
      onChanged: vi.fn(() => () => undefined),
    };
    renderBar('apps');
    showTab(TORQ_TAB);
    await act(async () => {});

    const magnifier = screen.getByRole('button', { name: 'Zoom: 110%' });
    const row = goButton().parentElement;
    expect(magnifier.parentElement).toBe(row);
    expect(row.firstElementChild).toBe(magnifier);
  });
});
