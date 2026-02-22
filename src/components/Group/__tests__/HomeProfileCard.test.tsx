import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';

// --- Mocks (must come before any imports that transitively load these) ---

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
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

// --- i18n setup ---

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      tutorial: {
        'home.copy_address': 'Click to copy address',
        'home.balance': 'Balance',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Atoms (imported after mocks) ---

import { userInfoAtom, balanceAtom } from '../../../atoms/global';
import { HomeProfileCard } from '../HomeProfileCard';

const theme = createTheme({
  palette: {
    other: {
      positive: '#00a000',
      danger: '#d00000',
      unread: '#1976d2',
    },
  },
});

const renderCard = (
  userInfo: { name: string | null; address: string } | null,
  balance: number | null
) => {
  const store = createStore();
  store.set(userInfoAtom, userInfo);
  store.set(balanceAtom, balance);

  return render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <HomeProfileCard />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
};

describe('HomeProfileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the user name when available', () => {
    renderCard({ name: 'alice', address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }, 42.5);
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('falls back to truncated address when name is absent', () => {
    renderCard({ name: null, address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }, 0);
    // The name slot shows the first 8 chars of the address + ellipsis
    expect(screen.getByText('QVosNNas…')).toBeInTheDocument();
  });

  it('displays the full address in the copy area', () => {
    renderCard({ name: 'alice', address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }, 42.5);
    expect(screen.getByText('QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H')).toBeInTheDocument();
  });

  it('calls clipboard.writeText with the address on click', () => {
    renderCard({ name: 'alice', address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }, 42.5);
    fireEvent.click(screen.getByText('QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H'
    );
  });

  it('displays balance formatted to 2 decimal places', () => {
    renderCard({ name: 'alice', address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }, 42.5);
    expect(screen.getByText('42.50 QORT')).toBeInTheDocument();
  });

  it('shows a dash when balance is null', () => {
    renderCard({ name: 'alice', address: 'QVosNNasvHkNBAQ6rCYVepY3ax8XQsyv1H' }, null);
    expect(screen.getByText('— QORT')).toBeInTheDocument();
  });

  it('renders without crashing when userInfo is null', () => {
    renderCard(null, null);
    // Should render the balance dash at minimum
    expect(screen.getByText('— QORT')).toBeInTheDocument();
  });
});
