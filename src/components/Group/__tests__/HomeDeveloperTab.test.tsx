import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

// --- Mocks ---

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
        'home.developer_resources': 'Developer Resources',
        'home.qtube_tutorial': 'Q-Tube Tutorial',
        'home.qtube_tutorial_desc': 'Learn how to publish and browse videos on Q-Tube',
        'home.core_support': 'Qortal official CORE support',
        'home.core_support_desc': 'Get help from the official Qortal CORE support group',
        'home.devnet_testing': 'Q-App DevNet-Testing',
        'home.devnet_testing_desc': 'Test your Q-Apps in the DevNet-Testing environment',
        'home.open': 'Open',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Component ---

import { HomeDeveloperTab } from '../HomeDeveloperTab';

const theme = createTheme();

const makeProps = (overrides = {}) => ({
  setSelectedGroup: vi.fn(),
  setGroupSection: vi.fn(),
  setDesktopViewMode: vi.fn(),
  setMobileViewMode: vi.fn(),
  getTimestampEnterChat: vi.fn(),
  ...overrides,
});

const renderComponent = (props = makeProps()) =>
  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <HomeDeveloperTab {...props} />
      </I18nextProvider>
    </ThemeProvider>
  );

describe('HomeDeveloperTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section title', () => {
    renderComponent();
    expect(screen.getByText('Developer Resources')).toBeInTheDocument();
  });

  it('renders all three card titles', () => {
    renderComponent();
    expect(screen.getByText('Q-Tube Tutorial')).toBeInTheDocument();
    expect(screen.getByText('Qortal official CORE support')).toBeInTheDocument();
    expect(screen.getByText('Q-App DevNet-Testing')).toBeInTheDocument();
  });

  it('renders all three card descriptions', () => {
    renderComponent();
    expect(screen.getByText('Learn how to publish and browse videos on Q-Tube')).toBeInTheDocument();
    expect(screen.getByText('Get help from the official Qortal CORE support group')).toBeInTheDocument();
    expect(screen.getByText('Test your Q-Apps in the DevNet-Testing environment')).toBeInTheDocument();
  });

  it('renders three clickable cards', () => {
    renderComponent();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('opens Q-Tube app when first card is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: { service: 'APP', name: 'q-tube' },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('navigates to CORE support group when second card is clicked', () => {
    const props = makeProps();
    renderComponent(props);
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(props.setSelectedGroup).toHaveBeenCalledWith(
      expect.objectContaining({ groupName: 'Qortal-CORE-Support' })
    );
    expect(props.setDesktopViewMode).toHaveBeenCalledWith('chat');
    expect(props.setGroupSection).toHaveBeenCalledWith('default');
    expect(props.setMobileViewMode).toHaveBeenCalledWith('group');
    expect(props.getTimestampEnterChat).toHaveBeenCalled();
  });

  it('navigates to DevNet-Testing group when third card is clicked', () => {
    const props = makeProps();
    renderComponent(props);
    fireEvent.click(screen.getAllByRole('button')[2]);
    expect(props.setSelectedGroup).toHaveBeenCalledWith(
      expect.objectContaining({ groupName: 'Q-App-DevNet-Testing' })
    );
    expect(props.setDesktopViewMode).toHaveBeenCalledWith('chat');
  });

  it('does not call group navigation when Q-Tube card is clicked', () => {
    const props = makeProps();
    renderComponent(props);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(props.setSelectedGroup).not.toHaveBeenCalled();
    expect(props.setDesktopViewMode).not.toHaveBeenCalled();
  });
});
