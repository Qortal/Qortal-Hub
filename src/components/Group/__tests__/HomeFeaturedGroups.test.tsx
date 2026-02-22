import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// --- i18n ---

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      tutorial: {
        'home.featured_groups': 'Featured Groups',
        'home.view_group': 'View',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Atoms + Components ---

import { groupsOwnerNamesAtom } from '../../../atoms/global';
import { featuredGroups } from '../../../data/featuredGroups';
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
    for (const group of featuredGroups) {
      expect(screen.getByText(group.name)).toBeInTheDocument();
    }
  });

  it('renders a clickable card for each group', () => {
    renderComponent();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(featuredGroups.length);
  });

  it('renders group descriptions', () => {
    renderComponent();
    for (const group of featuredGroups) {
      expect(screen.getByText(group.description)).toBeInTheDocument();
    }
  });

  it('renders fallback letter avatar when owner name is unknown', () => {
    renderComponent();
    // First group is 'Qortal' → fallback label 'Q'
    expect(screen.getByText('Q')).toBeInTheDocument();
  });

  it('calls navigation props when a card is clicked', () => {
    const props = makeProps();
    renderComponent(props);

    fireEvent.click(screen.getAllByRole('button')[0]);

    const firstGroup = featuredGroups[0];
    expect(props.setSelectedGroup).toHaveBeenCalledWith({
      groupId: String(firstGroup.id),
      groupName: firstGroup.name,
    });
    expect(props.setGroupSection).toHaveBeenCalledWith('default');
    expect(props.setDesktopViewMode).toHaveBeenCalledWith('chat');
    expect(props.setMobileViewMode).toHaveBeenCalledWith('group');
    expect(props.getTimestampEnterChat).toHaveBeenCalled();
  });

  it('navigates to the correct group when different cards are clicked', () => {
    const props = makeProps();
    renderComponent(props);
    const buttons = screen.getAllByRole('button');

    featuredGroups.forEach((group, index) => {
      vi.clearAllMocks();
      fireEvent.click(buttons[index]);
      expect(props.setSelectedGroup).toHaveBeenCalledWith({
        groupId: String(group.id),
        groupName: group.name,
      });
    });
  });
});
