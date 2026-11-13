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
      group: {
        dashboard: {
          explore_all_q_apps: 'Explore All Q-Apps',
          featured_q_apps: 'Featured Q-Apps',
          featured_q_apps_subtitle:
            'Launch trusted community apps directly from your dashboard.',
          featured_q_chat_eyebrow: 'NATIVE',
          featured_q_chat_keyword_connect: 'connect.',
          featured_q_chat_keyword_freely: 'freely.',
          featured_q_chat_keyword_talk: 'talk.',
          featured_q_chat_subtitle:
            'Your conversations, your groups, your network.\nPowered by Reticulum\nValidated on Qortal Blockchain',
          featured_q_tube_eyebrow: 'Always on',
          featured_q_tube_keyword_cat_videos: 'cat. videos.',
          featured_q_tube_keyword_decentralized: 'decentralized.',
          featured_q_tube_keyword_platform: 'platform.',
          featured_q_tube_subtitle:
            'Network-hosted video drops, weird clips, and creator rabbit holes.',
          open_q_app: 'Open Q-App',
          open_q_chat: 'Open Q-Chat',
          reduce_motion: 'Reduce motion',
        },
      },
    },
  },
  interpolation: { escapeValue: false },
});

// --- Component ---

import {
  FEATURED_PREVIEW_EXPAND_DELAY_MS,
  HomeFeaturedApps,
} from '../HomeFeaturedApps';
import {
  HUB_ONBOARDING_QCHAT_CARD_LOCK_ATTRIBUTE,
  HUB_ONBOARDING_QCHAT_CARD_LOCK_EVENT,
} from '../../Onboarding/hubOnboarding';

const FEATURED_APP_NAMES = [
  'Q-Tube',
  'Torq',
  'Q-Mail',
  'SubWire',
  'Q-Trade',
  'Q-Chat',
];

const theme = createTheme({
  palette: {
    background: {
      surface: '#f8fafc',
    },
    border: {
      subtle: 'rgba(15, 23, 42, 0.12)',
    },
  } as any,
});

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
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.removeAttribute(HUB_ONBOARDING_QCHAT_CARD_LOCK_ATTRIBUTE);
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
      expect(screen.getAllByText(appName).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Q-Blog')).not.toBeInTheDocument();
  });

  it('renders a clickable tile for each featured app', () => {
    renderComponent();
    for (const appName of FEATURED_APP_NAMES) {
      expect(screen.getByRole('button', { name: appName })).toBeInTheDocument();
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

  it('opens Q-Chat as a Hub-owned internal tab', () => {
    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: 'Q-Chat' }));

    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: {
        internal: 'q-chat',
        name: 'Q-Chat',
        service: 'INTERNAL',
      },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('keeps Q-Chat collapsed and restores hover expansion after the tour unlocks it', () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem('dashboard-featured-qchat-preview-seen', '1');
    document.body.setAttribute(HUB_ONBOARDING_QCHAT_CARD_LOCK_ATTRIBUTE, '');
    renderComponent();

    const qChatCard = screen.getByRole('button', { name: 'Q-Chat' });
    fireEvent.mouseEnter(qChatCard);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.queryByRole('button', { name: 'Open Q-Chat' })
    ).not.toBeInTheDocument();

    document.body.removeAttribute(HUB_ONBOARDING_QCHAT_CARD_LOCK_ATTRIBUTE);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(HUB_ONBOARDING_QCHAT_CARD_LOCK_EVENT)
      );
    });

    fireEvent.mouseEnter(qChatCard);
    act(() => {
      vi.advanceTimersByTime(FEATURED_PREVIEW_EXPAND_DELAY_MS + 1);
    });
    expect(
      screen.getByRole('button', { name: 'Open Q-Chat' })
    ).toBeInTheDocument();
  });

  it('expands both animated cards during normal hover', () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem('dashboard-featured-qchat-preview-seen', '1');
    renderComponent();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Q-Chat' }));
    act(() => {
      vi.advanceTimersByTime(FEATURED_PREVIEW_EXPAND_DELAY_MS + 1);
    });
    expect(
      screen.getByRole('button', { name: 'Open Q-Chat' })
    ).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole('button', { name: 'Open Q-Chat' }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Q-Tube' }));
    act(() => {
      vi.advanceTimersByTime(FEATURED_PREVIEW_EXPAND_DELAY_MS + 1);
    });
    expect(
      screen.getByRole('button', { name: 'Open Q-App' })
    ).toBeInTheDocument();
  });

  it('opens the app library from the footer CTA', () => {
    renderComponent();
    fireEvent.click(
      screen.getByRole('button', { name: /Explore All Q-Apps/i })
    );

    expect(mockExecuteEvent).toHaveBeenCalledWith('openAppsLibrarySearch', {
      data: { query: '' },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('runs the intro preview timer without throwing', () => {
    vi.useFakeTimers();

    renderComponent();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByText('Featured Q-Apps')).toBeInTheDocument();
  });
});
