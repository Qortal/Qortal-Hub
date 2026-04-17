import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

// --- Mocks ---

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
        'home.featured_apps': 'Featured Apps',
        'home.open_app': 'Open',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Component ---

import {
  FEATURED_APP_NAMES,
  FEATURED_INTRO_TOTAL_DURATION_MS,
  HomeFeaturedApps,
} from '../HomeFeaturedApps';

const theme = createTheme();

const renderComponent = (props = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <HomeFeaturedApps {...props} />
      </I18nextProvider>
    </ThemeProvider>
  );

describe('HomeFeaturedApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the section title', () => {
    renderComponent();
    expect(screen.getByText('Featured Q-Apps')).toBeInTheDocument();
  });

  it('renders a tile for every featured app', () => {
    renderComponent();
    for (const appName of FEATURED_APP_NAMES) {
      expect(screen.getByText(appName)).toBeInTheDocument();
    }
  });

  it('renders a clickable tile for each featured app', () => {
    renderComponent();
    for (const appName of FEATURED_APP_NAMES) {
      expect(
        screen.getByRole('button', { name: appName })
      ).toBeInTheDocument();
    }
  });

  it('fires addTab and open-apps-mode events when an app is opened', () => {
    renderComponent();
    const firstAppName = FEATURED_APP_NAMES[0];
    fireEvent.click(screen.getByRole('button', { name: firstAppName }));

    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: { service: 'APP', name: firstAppName },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('opens the app library from the footer CTA', () => {
    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /Explore All Q-Apps/i }));

    expect(mockExecuteEvent).toHaveBeenCalledWith('openAppsLibrarySearch', {
      data: { query: '' },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('notifies when the intro preview fully finishes', () => {
    vi.useFakeTimers();
    const onIntroComplete = vi.fn();

    renderComponent({
      decorationsVisible: false,
      onIntroComplete,
    });

    act(() => {
      vi.advanceTimersByTime(FEATURED_INTRO_TOTAL_DURATION_MS - 1);
    });
    expect(onIntroComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onIntroComplete).toHaveBeenCalledTimes(1);
  });
});
