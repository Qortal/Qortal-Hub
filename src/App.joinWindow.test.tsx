import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

// App as it is, with its fee confirmation and the top bar where it mounts
// them. Only what doesn't take part is left out: the signed-in shell, the
// title bar, the call providers and the hooks that talk to the node.
vi.mock('./components/App/LazyAuthenticatedShell', () => ({
  LazyAuthenticatedShell: () => null,
}));
vi.mock('./components/CoreSetup.tsx', () => ({ CoreSetup: () => null }));
// The top bar itself, with only the global actions in it (the join window).
vi.mock('./components/Desktop/GlobalQortalNavBar.tsx', async () => {
  const { GlobalActions } =
    await import('./components/GlobalActions/GlobalActions');
  return { GlobalQortalNavBar: () => <GlobalActions /> };
});
vi.mock('./components/Desktop/CustomTitleBar', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  CustomTitleBar: () => null,
}));
vi.mock('./components/Desktop/AppsBar/useAppsBar', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppsBarSettings: () => ({ settings: { enabled: false } }),
}));
vi.mock('./contexts/GroupCallContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GroupCallProvider: ({ children }) => children,
}));
vi.mock('./context/VoiceCallContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  VoiceCallProvider: ({ children }) => children,
}));
vi.mock('./contexts/CallSwitchGuardContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  CallSwitchGuardProvider: ({ children }) => children,
}));
vi.mock('./hooks/useAuth.tsx', () => ({
  useAuth: () => ({
    isNodeValid: vi.fn(),
    authenticate: vi.fn(),
    getBalanceFunc: vi.fn(),
    handleSaveNodeInfo: vi.fn(),
    validateApiKeyFromRegistration: vi.fn(),
  }),
}));
vi.mock('./hooks/usePresence', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePresence: () => ({ sendOfflineBeforeLogout: vi.fn() }),
}));
vi.mock('./hooks/useBlockUsers.tsx', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBlockedAddressesLoader: () => undefined,
}));
vi.mock('./hooks/useRetrieveDataLocalStorage.tsx', () => ({
  useRetrieveDataLocalStorage: () => undefined,
}));
vi.mock('./hooks/useQortalGetSaveSettings.tsx', () => ({
  useQortalGetSaveSettings: () => undefined,
}));
vi.mock('./hooks/useReticulumDmAccountRegistration', () => ({
  useReticulumDmAccountRegistration: () => undefined,
}));
vi.mock('./hooks/useAppMessageHandler', () => ({
  useAppMessageHandler: () => undefined,
}));
vi.mock('./background/background.ts', () => ({
  getFee: vi.fn(),
  getApiKeyFromStorage: vi.fn(async () => null),
  groupApi: 'http://node',
  getWallets: vi.fn(async () => []),
  storeWallets: vi.fn(async () => undefined),
}));

import App from './App';
import {
  extStateAtom,
  memberGroupsAtom,
  reticulumEnabledAtom,
} from './atoms/global';
import { getFee } from './background/background.ts';
import { lightTheme } from './styles/theme-light';
import { openQortalLink } from './utils/qortalLink/openQortalLink';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const joinsSent = () =>
  vi
    .mocked(window.sendMessage)
    .mock.calls.filter(([type]) => type === 'joinGroup');

const renderApp = () => {
  const store = createStore();
  store.set(extStateAtom, 'authenticated');
  store.set(memberGroupsAtom, [{ groupId: 5 }] as never);
  store.set(reticulumEnabledAtom, false);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
};

/** The join window opened by a Q-App's link, then Join pressed. */
const joinSevenFromAnApp = async () => {
  await act(async () => {
    await openQortalLink('qortal://use-group/action-join/groupid-7', {
      fromApp: true,
    });
  });
  expect(await screen.findByText(/Seven/)).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByText(/^action\.join$/i));
  });
};

describe("App's join window", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: string) => {
      const groupId = Number(String(url).split('/').pop());
      const names: Record<number, string> = { 7: 'Seven', 9: 'Nine' };
      return new Response(
        JSON.stringify({ groupId, groupName: names[groupId], isOpen: true })
      );
    }) as unknown as typeof fetch;
    vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
    window.sendMessage = vi.fn(async () => ({})) as never;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
      }))
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    delete window.sendMessage;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the fee before it sends a join, and sends it once accepted', async () => {
    renderApp();
    await joinSevenFromAnApp();

    expect(await screen.findByText('0.01 QORT')).toBeInTheDocument();
    expect(joinsSent()).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByText(/^action\.accept$/i));
    });
    expect(joinsSent()).toEqual([['joinGroup', { groupId: 7 }]]);

    // Once its fee dialog has closed, a Q-App's link opens the window again.
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    let opened: boolean | undefined;
    await act(async () => {
      opened = await openQortalLink(
        'qortal://use-group/action-join/groupid-9',
        { fromApp: true }
      );
    });
    expect(opened).toBe(true);
    expect(await screen.findByText(/Nine/)).toBeInTheDocument();
  });

  it('sends nothing when the fee is declined', async () => {
    renderApp();
    await joinSevenFromAnApp();
    expect(await screen.findByText('0.01 QORT')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(/^action\.decline$/i));
    });

    expect(joinsSent()).toEqual([]);
  });

  it("opens no Q-App's join window while the fee is asked, and opens one after", async () => {
    renderApp();
    await joinSevenFromAnApp();
    expect(await screen.findByText('0.01 QORT')).toBeInTheDocument();

    let opened: boolean | undefined;
    await act(async () => {
      opened = await openQortalLink(
        'qortal://use-group/action-join/groupid-9',
        { fromApp: true }
      );
    });
    expect(opened).toBe(false);
    expect(screen.queryByText(/Nine/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(/^action\.decline$/i));
    });
    await waitFor(() =>
      expect(screen.queryByText('0.01 QORT')).not.toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await act(async () => {
      opened = await openQortalLink(
        'qortal://use-group/action-join/groupid-9',
        { fromApp: true }
      );
    });
    expect(opened).toBe(true);
    expect(await screen.findByText(/Nine/)).toBeInTheDocument();
  });
});
