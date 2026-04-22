import React, { createContext } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { balanceAtom, txListAtom, userInfoAtom } from '../../../atoms/global';
import ErrorBoundary from '../../../common/ErrorBoundary';
import { HomeQortinoWorkspaceCard } from '../HomeQortinoWorkspaceCard';
import { QORTINO_LOOK_DEBUG_STORAGE_KEY } from '../qortinoLookDebug';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
  extStates: {},
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      tutorial: {},
    },
  },
  interpolation: { escapeValue: false },
});

const theme = createTheme();
const LS_KEY = 'getting_started_status';

const renderCard = ({
  address = 'QADDR',
  balance = 0,
  name = null,
  qortinoSettings = null,
}: {
  address?: string;
  balance?: number | null;
  name?: string | null;
  qortinoSettings?: unknown;
} = {}) => {
  const store = createStore();
  store.set(userInfoAtom, address ? { address, name } : null);
  store.set(balanceAtom, balance);
  store.set(txListAtom, []);

  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve([]),
  }) as typeof fetch;

  window.sendMessage = vi.fn(async (type: string) => {
    if (type === 'getUserSettings') {
      return qortinoSettings;
    }

    return null;
  }) as typeof window.sendMessage;

  return render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary fallback={<div>boundary fallback</div>}>
            <HomeQortinoWorkspaceCard />
          </ErrorBoundary>
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
};

describe('HomeQortinoWorkspaceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the onboarding workspace without tripping the boundary', async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText('Getting started')).toBeInTheDocument();
    });

    expect(screen.getByText('QORTINO')).toBeInTheDocument();
    expect(screen.queryByText('boundary fallback')).not.toBeInTheDocument();
  });

  it('renders the unlocked companion view without tripping the boundary', async () => {
    localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');

    renderCard({
      balance: 10,
      name: 'b-test',
      qortinoSettings: {
        hotkeys: Array.from({ length: 8 }, () => null),
        mode: 'empty',
        musicPlaying: false,
        musicQuery: '',
        onboardingCelebrationSeen: true,
        repeatMode: 'all',
        selectedTrackId: 'midnight-relay',
        version: 1,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('QORTINO')).toBeInTheDocument();
    });

    expect(screen.getByText('Choose what lives above QORTINO.')).toBeInTheDocument();
    expect(screen.queryByText('boundary fallback')).not.toBeInTheDocument();
  });

  it('renders with qortino look debug overrides applied from local storage', async () => {
    localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
    localStorage.setItem(
      QORTINO_LOOK_DEBUG_STORAGE_KEY,
      JSON.stringify({
        antennaScale: 1.2,
        bodyScale: 1.15,
        faceScale: 0.9,
      })
    );

    renderCard({
      balance: 10,
      name: 'b-test',
      qortinoSettings: {
        hotkeys: Array.from({ length: 8 }, () => null),
        mode: 'empty',
        musicPlaying: false,
        musicQuery: '',
        onboardingCelebrationSeen: true,
        repeatMode: 'all',
        selectedTrackId: 'midnight-relay',
        version: 1,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('QORTINO')).toBeInTheDocument();
    });

    expect(screen.getByText('Choose what lives above QORTINO.')).toBeInTheDocument();
    expect(screen.queryByText('boundary fallback')).not.toBeInTheDocument();
  });
});
