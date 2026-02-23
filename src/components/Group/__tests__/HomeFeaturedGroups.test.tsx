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

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

// --- Static featured groups (from data/featuredGroups) ---

const featuredGroupNames = ['Qortal', 'Qortal-General-Chat', 'Q-Apps'];
const featuredDescriptions = [
  'Official Qortal community group',
  'General chat for the Qortal community',
  'Discussion and support for Qortal Q-Apps',
];

// --- i18n ---

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      tutorial: {
        'home.featured_groups': 'Featured Groups',
        'home.most_active_groups': 'Most active groups',
        'home.view_group': 'View',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Atoms + Components ---

import { groupsOwnerNamesAtom } from '../../../atoms/global';
import { HomeFeaturedGroups } from '../HomeFeaturedGroups';

const theme = createTheme();

const makeProps = (overrides = {}) => ({
  setSelectedGroup: vi.fn(),
  setGroupSection: vi.fn(),
  setDesktopViewMode: vi.fn(),
  setMobileViewMode: vi.fn(),
  getTimestampEnterChat: vi.fn(),
  ...overrides,
});

const renderComponent = (props = makeProps(), ownerNames: Record<string, string> = {}) => {
  const store = createStore();
  store.set(groupsOwnerNamesAtom, ownerNames);

  return {
    ...render(
      <JotaiProvider store={store}>
        <ThemeProvider theme={theme}>
          <I18nextProvider i18n={i18n}>
            <HomeFeaturedGroups {...props} />
          </I18nextProvider>
        </ThemeProvider>
      </JotaiProvider>
    ),
    props,
  };
};

describe('HomeFeaturedGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section title', () => {
    renderComponent();
    expect(screen.getByText('Featured Groups')).toBeInTheDocument();
  });

  it('renders a card for each featured group', () => {
    renderComponent();
    for (const name of featuredGroupNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('renders a clickable card for each group', () => {
    renderComponent();
    for (const name of featuredGroupNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Cards + prev/next arrows
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(featuredGroupNames.length);
  });

  it('renders group descriptions', () => {
    renderComponent();
    for (const desc of featuredDescriptions) {
      expect(screen.getByText(desc)).toBeInTheDocument();
    }
  });

  it('renders fallback letter avatar when owner name is unknown', () => {
    renderComponent();
    expect(screen.getByText('Qortal')).toBeInTheDocument();
    // Qortal → fallback first letter 'Q'
    expect(screen.getByText('Q')).toBeInTheDocument();
  });

  it('opens the join popover when a card is clicked', async () => {
    renderComponent();

    const cards = featuredGroupNames.map((name) => screen.getByText(name));
    fireEvent.click(cards[0].closest('button') ?? cards[0]);

    await waitFor(() => {
      const popover = document.querySelector('.MuiPopover-paper');
      expect(popover).toBeInTheDocument();
      expect(popover?.querySelector('h6')?.textContent).toBe('Qortal');
      expect(popover?.textContent).toMatch(/Official Qortal community group/);
      expect(popover?.textContent).toMatch(/action\.close|Close/);
      expect(popover?.textContent).toMatch(/action\.join|Join/);
    });
  });

  it('shows the correct group in the popover when different cards are clicked', async () => {
    renderComponent();

    const cards = featuredGroupNames.map((name) => screen.getByText(name));

    fireEvent.click(cards[0].closest('button') ?? cards[0]);
    await waitFor(() => {
      expect(screen.getByText('Qortal', { selector: 'h6' })).toBeInTheDocument();
    });

    fireEvent.click(cards[1].closest('button') ?? cards[1]);
    await waitFor(() => {
      expect(screen.getByText('Qortal-General-Chat', { selector: 'h6' })).toBeInTheDocument();
    });

    fireEvent.click(cards[2].closest('button') ?? cards[2]);
    await waitFor(() => {
      expect(screen.getByText('Q-Apps', { selector: 'h6' })).toBeInTheDocument();
    });
  });
});
