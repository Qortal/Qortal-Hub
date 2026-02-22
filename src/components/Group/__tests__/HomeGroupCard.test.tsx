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
        'home.view_group': 'View',
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Atoms + Component ---

import { groupsOwnerNamesAtom } from '../../../atoms/global';
import { HomeGroupCard } from '../HomeGroupCard';
import type { FeaturedGroup } from '../../../data/featuredGroups';

const theme = createTheme();

const testGroup: FeaturedGroup = {
  id: 42,
  name: 'Qortal-General-Chat',
  description: 'General chat for the Qortal community',
};

const renderCard = (
  onClick = vi.fn(),
  ownerNames: Record<string, string> = {}
) => {
  const store = createStore();
  store.set(groupsOwnerNamesAtom, ownerNames);

  return {
    onClick,
    ...render(
      <JotaiProvider store={store}>
        <ThemeProvider theme={theme}>
          <I18nextProvider i18n={i18n}>
            <HomeGroupCard group={testGroup} onClick={onClick} />
          </I18nextProvider>
        </ThemeProvider>
      </JotaiProvider>
    ),
  };
};

describe('HomeGroupCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the group name', () => {
    renderCard();
    expect(screen.getByText('Qortal-General-Chat')).toBeInTheDocument();
  });

  it('renders the group description', () => {
    renderCard();
    expect(
      screen.getByText('General chat for the Qortal community')
    ).toBeInTheDocument();
  });

  it('renders a View button', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClick when the View button is clicked', () => {
    const onClick = vi.fn();
    renderCard(onClick);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders two-letter fallback avatar when owner name is unknown', () => {
    renderCard();
    // 'Qortal-General-Chat' → first letters of first two words: 'QG'
    expect(screen.getByText('QG')).toBeInTheDocument();
  });

  it('renders single-letter fallback for single-word group names', () => {
    const store = createStore();
    store.set(groupsOwnerNamesAtom, {});
    render(
      <JotaiProvider store={store}>
        <ThemeProvider theme={theme}>
          <I18nextProvider i18n={i18n}>
            <HomeGroupCard
              group={{ id: 1, name: 'Qortal', description: 'Official' }}
              onClick={vi.fn()}
            />
          </I18nextProvider>
        </ThemeProvider>
      </JotaiProvider>
    );
    expect(screen.getByText('Q')).toBeInTheDocument();
  });

  it('uses the owner name from the atom to build the avatar src', () => {
    renderCard(vi.fn(), { '42': 'groupOwner' });
    const avatar = document.querySelector('img');
    expect(avatar?.src).toContain('groupOwner');
    expect(avatar?.src).toContain('qortal_group_avatar_42');
  });

  it('does not call onClick when not clicked', () => {
    const onClick = vi.fn();
    renderCard(onClick);
    expect(onClick).not.toHaveBeenCalled();
  });
});
