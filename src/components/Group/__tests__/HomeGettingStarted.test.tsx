import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';

// --- Mocks ---

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
  extStates: {},
}));

vi.mock('../../../background/background', () => ({
  groupApi: 'http://localhost:12391',
  groupApiSocket: 'ws://localhost:12391',
  cleanUrl: vi.fn((url: string) => url),
  getProtocol: vi.fn(() => 'http'),
  performPowTask: vi.fn(async () => ({ success: true, nonce: 0, hash: '00' })),
}));

const mockExecuteEvent = vi.fn();
vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: any[]) => mockExecuteEvent(...args),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

// --- i18n ---

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      tutorial: {
        'home.getting_started': 'Getting Started',
        'home.progress': '{{completed}} / {{total}} completed',
        'home.get_six_qorts': 'Get your 6 QORT',
        'home.register_name': 'Register your name',
        'home.load_avatar': 'Load your avatar',
        'home.explore_apps': 'Explore featured apps',
        'home.done': 'Done',
        'home.open': 'Open',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Atoms ---

import { userInfoAtom, balanceAtom } from '../../../atoms/global';
import { HomeGettingStarted } from '../HomeGettingStarted';

const theme = createTheme();

const renderComponent = (
  userInfo: { name: string | null; address: string } | null,
  balance: number | null,
  fetchResponse: any[] = []
) => {
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve(fetchResponse),
  }) as any;

  const store = createStore();
  store.set(userInfoAtom, userInfo);
  store.set(balanceAtom, balance);

  return render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <HomeGettingStarted />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
};

describe('HomeGettingStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 4 step labels', async () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    expect(screen.getByText('Get your 6 QORT')).toBeInTheDocument();
    expect(screen.getByText('Register your name')).toBeInTheDocument();
    expect(screen.getByText('Load your avatar')).toBeInTheDocument();
    expect(screen.getByText('Explore featured apps')).toBeInTheDocument();
  });

  it('shows progress as 0 / 4 when nothing is done', async () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    expect(screen.getByText('0 / 4 completed')).toBeInTheDocument();
  });

  it('marks step 1 done when balance >= 6', async () => {
    renderComponent({ name: null, address: 'QADDR' }, 6);
    // step 1 button should be disabled and show "Done"
    const buttons = screen.getAllByRole('button', { name: 'Done' });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('marks step 2 done when user has a name', async () => {
    renderComponent({ name: 'alice', address: 'QADDR' }, 0);
    const buttons = screen.getAllByRole('button', { name: 'Done' });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('marks step 3 done when avatar API returns a result', async () => {
    renderComponent(
      { name: 'alice', address: 'QADDR' },
      0,
      [{ name: 'alice', identifier: 'qortal_avatar' }]
    );
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: 'Done' });
      // name (step 2) + avatar (step 3) = 2 Done buttons
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows correct progress count when steps are done', async () => {
    renderComponent({ name: 'alice', address: 'QADDR' }, 6);
    // balance (1) + name (1) = 2 done; avatar check pending (fetch returns [])
    expect(screen.getByText('2 / 4 completed')).toBeInTheDocument();
  });

  it('fires openRegisterName event when step 2 button clicked', () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);
    expect(mockExecuteEvent).toHaveBeenCalledWith('openRegisterName', {});
  });

  it('fires openAvatarUpload event when step 3 button clicked', async () => {
    renderComponent({ name: 'alice', address: 'QADDR' }, 0, []);
    await waitFor(() => {
      // wait for avatar check to resolve
      expect(screen.getAllByRole('button', { name: 'Open' }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);
    expect(mockExecuteEvent).toHaveBeenCalledWith('openAvatarUpload', {});
  });

  it('fires open-apps-mode event when step 4 button clicked', () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    const openButtons = screen.getAllByRole('button', { name: 'Open' });
    fireEvent.click(openButtons[openButtons.length - 1]);
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('opens the Get QORT dialog when step 1 button clicked', () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTitle('Get your 6 QORT')).toBeInTheDocument();
  });
});
