import React, { createContext } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';

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

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      tutorial: {
        'home.getting_started': 'Getting Started',
        'home.confirming_transaction': 'Confirming transaction',
        'home.confirming': 'Confirming',
        'home.get_six_qorts': 'Get your 6 QORT',
        'home.register_name': 'Register your name',
        'home.load_avatar': 'Load your avatar',
        'home.done': 'Done',
        'home.open': 'Open',
      },
    },
  },
  interpolation: { escapeValue: false },
});

import { balanceAtom, txListAtom, userInfoAtom } from '../../../atoms/global';
import {
  HomeGettingStarted,
  type HomeGettingStartedProps,
} from '../HomeGettingStarted';
import { EMPTY_GETTING_STARTED_DEBUG_OVERRIDES } from '../homeGettingStartedDebug';

const LS_KEY = 'getting_started_status';
const theme = createTheme();

const renderComponent = (
  userInfo: { name: string | null; address: string } | null,
  balance: number | null,
  fetchResponse: any[] = [],
  props: HomeGettingStartedProps = {}
) => {
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve(fetchResponse),
  }) as any;

  const store = createStore();
  store.set(userInfoAtom, userInfo);
  store.set(balanceAtom, balance);
  store.set(txListAtom, []);

  const renderView = render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <HomeGettingStarted {...props} />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );

  return {
    ...renderView,
    rerenderWithProps: (nextProps: HomeGettingStartedProps) =>
      renderView.rerender(
        <JotaiProvider store={store}>
          <ThemeProvider theme={theme}>
            <I18nextProvider i18n={i18n}>
              <HomeGettingStarted {...nextProps} />
            </I18nextProvider>
          </ThemeProvider>
        </JotaiProvider>
      ),
  };
};

describe('HomeGettingStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders all 3 step labels', () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    expect(screen.getByText('Get your 6 QORT')).toBeInTheDocument();
    expect(screen.getByText('Register your name')).toBeInTheDocument();
    expect(screen.getByText('Load your avatar')).toBeInTheDocument();
  });

  it('marks step 1 done when balance >= 6', () => {
    renderComponent({ name: null, address: 'QADDR' }, 6);
    const doneButtons = screen.getAllByRole('button', { name: 'Done' });
    expect(doneButtons).toHaveLength(1);
  });

  it('marks step 3 done when avatar API returns a result', async () => {
    renderComponent(
      { name: 'alice', address: 'QADDR' },
      0,
      [{ name: 'alice', identifier: 'qortal_avatar' }]
    );

    await waitFor(() => {
      const doneButtons = screen.getAllByRole('button', { name: 'Done' });
      expect(doneButtons).toHaveLength(2);
    });
  });

  it('fires openRegisterName event when step 2 button clicked', () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);
    expect(mockExecuteEvent).toHaveBeenCalledWith('openRegisterName', {});
  });

  it('opens the Get QORT dialog when step 1 button clicked', () => {
    renderComponent({ name: null, address: 'QADDR' }, 0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Get your 6 QORT')).toBeInTheDocument();
  });

  it('marks a step done when its debug override is enabled', () => {
    renderComponent(
      { name: null, address: 'QADDR' },
      0,
      [],
      {
        debugUseOverridesOnly: true,
        debugCompletionOverrides: {
          ...EMPTY_GETTING_STARTED_DEBUG_OVERRIDES,
          get_six_qorts: true,
        },
      }
    );

    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
  });

  it('uses the normal completion path to hand off to Tools when all debug overrides are enabled', async () => {
    const onGettingStartedComplete = vi.fn();

    renderComponent(
      { name: null, address: 'QADDR' },
      0,
      [],
      {
        debugUseOverridesOnly: true,
        debugCompletionOverrides: {
          get_six_qorts: true,
          register_name: true,
          load_avatar: true,
        },
        onGettingStartedComplete,
      }
    );

    await waitFor(() => {
      expect(screen.getByText('Tools')).toBeInTheDocument();
    });

    expect(onGettingStartedComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`${LS_KEY}_QADDR`)).toBe('completed');
    expect(screen.queryByText('Getting Started')).not.toBeInTheDocument();
  });

  it('returns to Getting Started after debug reset clears the completion replay state', async () => {
    const { rerenderWithProps } = renderComponent(
      { name: null, address: 'QADDR' },
      0,
      [],
      {
        debugUseOverridesOnly: true,
        debugCompletionOverrides: {
          get_six_qorts: true,
          register_name: true,
          load_avatar: true,
        },
      }
    );

    await waitFor(() => {
      expect(screen.getByText('Tools')).toBeInTheDocument();
    });

    localStorage.removeItem(`${LS_KEY}_QADDR`);

    await act(async () => {
      rerenderWithProps({
        debugUseOverridesOnly: true,
        debugCompletionOverrides: EMPTY_GETTING_STARTED_DEBUG_OVERRIDES,
        debugReplayToken: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Getting Started')).toBeInTheDocument();
    });

    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(3);
  });
});
