import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

import { HomeFeaturedApps } from '../HomeFeaturedApps';
import { officialAppsConfig } from '../../Apps/config/officialApps';

const theme = createTheme();

const renderComponent = () =>
  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <HomeFeaturedApps />
      </I18nextProvider>
    </ThemeProvider>
  );

describe('HomeFeaturedApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section title', () => {
    renderComponent();
    expect(screen.getByText('Featured Apps')).toBeInTheDocument();
  });

  it('renders a tile for every featured app', () => {
    renderComponent();
    for (const appName of officialAppsConfig.featured) {
      expect(screen.getByText(appName)).toBeInTheDocument();
    }
  });

  it('renders an Open button for each featured app', () => {
    renderComponent();
    const buttons = screen.getAllByRole('button', { name: 'Open' });
    expect(buttons).toHaveLength(officialAppsConfig.featured.length);
  });

  it('fires addTab and open-apps-mode events when an app is opened', () => {
    renderComponent();
    const firstAppName = officialAppsConfig.featured[0];
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);

    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: { service: 'APP', name: firstAppName },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('opens the correct app for each button', () => {
    renderComponent();
    const buttons = screen.getAllByRole('button', { name: 'Open' });

    officialAppsConfig.featured.forEach((appName, index) => {
      vi.clearAllMocks();
      fireEvent.click(buttons[index]);
      expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
        data: { service: 'APP', name: appName },
      });
    });
  });
});
