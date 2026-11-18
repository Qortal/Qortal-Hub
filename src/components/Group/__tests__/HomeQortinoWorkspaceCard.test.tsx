import React, { createContext } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balanceAtom, txListAtom, userInfoAtom } from '../../../atoms/global';
import ErrorBoundary from '../../../common/ErrorBoundary';
import {
  HomeQortinoWorkspaceCard,
  QORTINO_WORKSPACE_SETTINGS_KEY,
  type QortinoWorkspacePlace,
} from '../HomeQortinoWorkspaceCard';

const downloadResource = Object.assign(vi.fn(), {
  cancelResourceDownload: vi.fn(),
});

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  QORTAL_APP_CONTEXT: createContext({
    show: vi.fn(),
    get downloadResource() {
      return downloadResource;
    },
  }),
  extStates: {},
}));

// EarBump's library: nothing to play.
vi.mock('../earbumpLibraryApi', () => ({
  fetchEarbumpRecentTracks: vi.fn().mockResolvedValue([]),
  fetchEarbumpTrackById: vi.fn().mockResolvedValue(null),
  searchEarbumpTracks: vi.fn().mockResolvedValue([]),
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
      group: {},
    },
  },
  interpolation: { escapeValue: false },
});

const theme = createTheme();
const LS_KEY = 'getting_started_status';
const EMPTY_PROMPT = 'Choose what this workspace shows.';

/** Home's windows the card fills: Qortino's and each Workspace's slot. */
const slots: HTMLElement[] = [];
const slot = () => {
  const node = document.body.appendChild(document.createElement('div'));
  slots.push(node);
  return node;
};

const workspaceState = (overrides: Record<string, unknown> = {}) => ({
  hotkeys: Array.from({ length: 6 }, () => null),
  mode: 'empty',
  musicPlaying: false,
  musicQuery: '',
  onboardingCelebrationSeen: true,
  repeatMode: 'all',
  selectedTrackId: '',
  version: 1,
  ...overrides,
});

const renderCard = ({
  address = 'QADDR',
  balance = 0,
  name = null,
  onGettingStartedShownChange,
  qortinoSettings = null,
  txList = [],
  workspaces,
}: {
  address?: string;
  balance?: number | null;
  name?: string | null;
  onGettingStartedShownChange?: (shown: boolean) => void;
  qortinoSettings?: unknown;
  txList?: unknown[];
  workspaces?: QortinoWorkspacePlace[];
} = {}) => {
  const store = createStore();
  store.set(userInfoAtom, address ? { address, name } : null);
  store.set(balanceAtom, balance);
  store.set(txListAtom, txList);

  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve([]),
    ok: true,
  }) as typeof fetch;

  window.sendMessage = vi.fn(async (type: string) => {
    if (type === 'getUserSettings') {
      return qortinoSettings;
    }

    return null;
  }) as typeof window.sendMessage;

  const qortinoNode = slot();
  const places = workspaces ?? [{ key: '', node: slot(), title: 'Workspace' }];
  const view = (nextPlaces: QortinoWorkspacePlace[] = places) => (
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary fallback={<div>boundary fallback</div>}>
            <HomeQortinoWorkspaceCard
              onGettingStartedShownChange={onGettingStartedShownChange}
              qortinoNode={qortinoNode}
              workspaces={nextPlaces}
            />
          </ErrorBoundary>
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
  const result = render(view());
  return {
    ...result,
    places,
    qortino: () => within(qortinoNode),
    rerenderPlaces: (next: QortinoWorkspacePlace[]) =>
      result.rerender(view(next)),
    store,
    workspace: (index = 0) => within(places[index].node as HTMLElement),
  };
};

/** The state the card saved last. */
const lastSaved = () => {
  const saved = vi
    .mocked(window.sendMessage)
    .mock.calls.filter(
      ([type, payload]) =>
        type === 'addUserSettings' &&
        (payload as { keyValue?: { key?: string } })?.keyValue?.key ===
          QORTINO_WORKSPACE_SETTINGS_KEY
    )
    .map(
      ([, payload]) =>
        (payload as { keyValue: { value: Record<string, unknown> } }).keyValue
          .value
    );
  return saved[saved.length - 1];
};

describe('HomeQortinoWorkspaceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    slots.splice(0).forEach((node) => node.remove());
  });

  it('shows Getting started in Qortino’s window, not in the Workspace', async () => {
    const card = renderCard();

    await waitFor(() => {
      expect(card.qortino().getByText('Getting started')).toBeInTheDocument();
    });
    expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
    // A Workspace it's given still shows its own (Home lets the Workspace
    // make way meanwhile, isHomePanelShownNow).
    expect(card.workspace().getByText(EMPTY_PROMPT)).toBeInTheDocument();
    expect(
      card.workspace().queryByText('Getting started')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('boundary fallback')).not.toBeInTheDocument();
  });

  it('shows Qortino alone once Getting started is done', async () => {
    localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
    const card = renderCard({
      balance: 10,
      name: 'b-test',
      qortinoSettings: workspaceState({
        hotkeys: Array.from({ length: 8 }, () => null),
        selectedTrackId: 'midnight-relay',
      }),
    });

    await waitFor(() => {
      expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
    });
    expect(
      card.qortino().queryByText('Getting started')
    ).not.toBeInTheDocument();
    expect(card.workspace().getByText(EMPTY_PROMPT)).toBeInTheDocument();
    expect(screen.queryByText('boundary fallback')).not.toBeInTheDocument();
  });

  it('shows only the windows it has a place for', async () => {
    const card = renderCard({
      workspaces: [{ key: '', node: null, title: 'Workspace' }],
    });
    await waitFor(() => {
      expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
    });
    expect(screen.queryByText(EMPTY_PROMPT)).not.toBeInTheDocument();
  });

  describe('Workspace windows', () => {
    const twoWindows = () => [
      { key: '', node: slot(), title: 'Workspace' },
      { key: 'k1', node: slot(), title: 'Workspace 2' },
    ];

    beforeEach(() => {
      localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
    });

    it('gives each Workspace what it holds', async () => {
      const card = renderCard({
        name: 'b-test',
        qortinoSettings: workspaceState({
          mode: 'hotkeys',
          windows: { k1: { hotkeys: [], mode: 'music' } },
        }),
        workspaces: twoWindows(),
      });

      await waitFor(() => {
        expect(card.workspace(0).getByText('Hotkeys')).toBeInTheDocument();
      });
      expect(card.workspace(1).getByText('Music player')).toBeInTheDocument();
      expect(card.workspace(1).queryByText('Hotkeys')).not.toBeInTheDocument();
    });

    it('keeps one music player: a second one stored is let go of', async () => {
      const card = renderCard({
        name: 'b-test',
        qortinoSettings: workspaceState({
          mode: 'music',
          windows: { k1: { hotkeys: [], mode: 'music' } },
        }),
        workspaces: twoWindows(),
      });

      await waitFor(() => {
        expect(card.workspace(0).getByText('Music player')).toBeInTheDocument();
      });
      expect(card.workspace(1).getByText(EMPTY_PROMPT)).toBeInTheDocument();
    });

    it('moves the music player to the Workspace it is picked in', async () => {
      const card = renderCard({
        name: 'b-test',
        qortinoSettings: workspaceState({
          windows: { k1: { hotkeys: [], mode: 'music' } },
        }),
        workspaces: twoWindows(),
      });
      await waitFor(() => {
        expect(card.workspace(1).getByText('Music player')).toBeInTheDocument();
      });

      // The first Workspace's "+".
      fireEvent.click(card.workspace(0).getAllByRole('button')[0]);
      const picker = await screen.findByRole('dialog');
      expect(
        within(picker).getByText(
          'In Workspace 2 now. Picked here, it moves here.'
        )
      ).toBeInTheDocument();
      fireEvent.click(within(picker).getByText('Music player'));

      await waitFor(() => {
        expect(card.workspace(0).getByText('Music player')).toBeInTheDocument();
      });
      expect(card.workspace(1).getByText(EMPTY_PROMPT)).toBeInTheDocument();
      await waitFor(() => {
        expect(lastSaved()).toMatchObject({
          mode: 'music',
          windows: { k1: { mode: 'empty' } },
        });
      });
    });

    it('lets go of what a copy taken off Home held, and its music', async () => {
      const card = renderCard({
        name: 'b-test',
        qortinoSettings: workspaceState({
          mode: 'hotkeys',
          musicPlaying: true,
          windows: { k1: { hotkeys: [], mode: 'music' } },
        }),
        workspaces: twoWindows(),
      });
      await waitFor(() => {
        expect(card.workspace(1).getByText('Music player')).toBeInTheDocument();
      });

      card.rerenderPlaces([card.places[0]]);

      await waitFor(() => {
        const saved = lastSaved();
        expect(saved).toMatchObject({ mode: 'hotkeys', musicPlaying: false });
        expect(saved).not.toHaveProperty('windows');
      });
    });

    it('keeps what a hidden Workspace holds', async () => {
      const card = renderCard({
        name: 'b-test',
        qortinoSettings: workspaceState({ mode: 'hotkeys' }),
        workspaces: [{ key: '', node: null, title: 'Workspace' }],
      });
      await waitFor(() => {
        expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(lastSaved()).toMatchObject({ mode: 'hotkeys' });
      });
    });
  });

  describe('Getting started follows the account', () => {
    it('goes back to the name when the name is sold midway', async () => {
      const card = renderCard({ balance: 10, name: 'alice' });
      await waitFor(() => {
        expect(
          card.qortino().getByText('Load your avatar')
        ).toBeInTheDocument();
      });

      // The primary name sold: the account has no name now.
      act(() => {
        card.store.set(userInfoAtom, { address: 'QADDR', name: null });
      });

      await waitFor(() => {
        expect(card.qortino().getByText('QORT acquired')).toBeInTheDocument();
      });
      expect(
        card.qortino().queryByText('Load your avatar')
      ).not.toBeInTheDocument();
    });

    it('stays done when the name is sold after Getting started', async () => {
      localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
      const card = renderCard({ balance: 10, name: 'alice' });
      await waitFor(() => {
        expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
      });

      act(() => {
        card.store.set(userInfoAtom, { address: 'QADDR', name: null });
      });

      await waitFor(() => {
        expect(card.workspace().getByText(EMPTY_PROMPT)).toBeInTheDocument();
      });
      expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
      expect(screen.queryByText('Register your name')).not.toBeInTheDocument();
    });

    it('waits on a name being registered', async () => {
      const card = renderCard({
        balance: 10,
        txList: [{ done: false, type: 'register-name' }],
      });
      await waitFor(() => {
        expect(card.qortino().getByText('Confirming')).toBeInTheDocument();
      });
    });

    it('goes back to the QORT when the balance drops under 2', async () => {
      const card = renderCard({ balance: 10 });
      await waitFor(() => {
        expect(card.qortino().getByText('QORT acquired')).toBeInTheDocument();
      });

      act(() => {
        card.store.set(balanceAtom, 0.5);
      });

      await waitFor(() => {
        expect(card.qortino().getByText('Get 2 QORT')).toBeInTheDocument();
      });
    });

    it('tells Home while Getting started shows, so the Workspace can make way', async () => {
      localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
      const onGettingStartedShownChange = vi.fn();
      const card = renderCard({
        balance: 10,
        name: 'alice',
        onGettingStartedShownChange,
      });
      await waitFor(() => {
        expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
      });
      expect(onGettingStartedShownChange).not.toHaveBeenCalledWith(true);

      // Another account, new on this PC: Getting started shows.
      act(() => {
        card.store.set(userInfoAtom, { address: 'QOTHER', name: null });
        card.store.set(balanceAtom, 0);
      });
      await waitFor(() => {
        expect(card.qortino().getByText('Getting started')).toBeInTheDocument();
      });
      expect(onGettingStartedShownChange).toHaveBeenLastCalledWith(true);

      // Back to the account that's done: the Workspace comes back.
      act(() => {
        card.store.set(userInfoAtom, { address: 'QADDR', name: 'alice' });
        card.store.set(balanceAtom, 10);
      });
      await waitFor(() => {
        expect(
          card.qortino().queryByText('Getting started')
        ).not.toBeInTheDocument();
      });
      expect(onGettingStartedShownChange).toHaveBeenLastCalledWith(false);
    });

    it('starts again for another account on this PC', async () => {
      localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
      const card = renderCard({ balance: 10, name: 'alice' });
      await waitFor(() => {
        expect(card.qortino().getByText('QORTINO')).toBeInTheDocument();
      });
      expect(screen.queryByText('Getting started')).not.toBeInTheDocument();

      act(() => {
        card.store.set(userInfoAtom, { address: 'QOTHER', name: null });
        card.store.set(balanceAtom, 0);
      });

      await waitFor(() => {
        expect(card.qortino().getByText('Getting started')).toBeInTheDocument();
      });
      expect(card.qortino().getByText('Get 2 QORT')).toBeInTheDocument();
    });
  });
});
