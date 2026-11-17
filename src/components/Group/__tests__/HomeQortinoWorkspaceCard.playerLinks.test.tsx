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
import {
  balanceAtom,
  resourceDownloadControllerAtom,
  txListAtom,
  userInfoAtom,
} from '../../../atoms/global';
import ErrorBoundary from '../../../common/ErrorBoundary';
import { fetchEarbumpRecentTracks } from '../earbumpLibraryApi';
import { getSharedEarbumpAudio } from '../earbumpSharedAudio';
import {
  HomeQortinoWorkspaceCard,
  QORTINO_WORKSPACE_SETTINGS_KEY,
  QortinoMusicPlaybackController,
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
  resources: { en: { group: {} } },
  interpolation: { escapeValue: false },
});

const theme = createTheme();
const LS_KEY = 'getting_started_status';

const QTUBE_LINK = 'qortal://APP/Q-Tube/video/BigPicture/qtube_vid_gold';
const QSHARE_LINK = 'qortal://APP/Q-Share/share/PixelMage/qshare_file_john';

/** One of EarBump's own tracks. */
const earbumpTrack = (id: string, title: string) => ({
  artist: 'An artist',
  coverColors: ['#6EA7FF', '#243B72', '#9CCBFF'] as [string, string, string],
  created: 1,
  id,
  length: '--:--',
  name: 'Publisher',
  status: null,
  streamUrl: '',
  title,
  updated: null,
  uploaded: '',
});

const slots: HTMLElement[] = [];
const slot = () => {
  const node = document.body.appendChild(document.createElement('div'));
  slots.push(node);
  return node;
};

/** A Workspace showing the player. */
const playerState = (overrides: Record<string, unknown> = {}) => ({
  hotkeys: Array.from({ length: 6 }, () => null),
  mode: 'music',
  musicPlaying: false,
  musicQuery: '',
  onboardingCelebrationSeen: true,
  repeatMode: 'all',
  selectedTrackId: '',
  version: 1,
  ...overrides,
});

const renderCard = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 0);
  store.set(txListAtom, []);

  window.sendMessage = vi.fn(async (type: string) =>
    type === 'getUserSettings' ? playerState() : null
  ) as typeof window.sendMessage;

  const qortinoNode = slot();
  const workspaceNode = slot();
  render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary fallback={<div>boundary fallback</div>}>
            <HomeQortinoWorkspaceCard
              qortinoNode={qortinoNode}
              workspaces={[
                { key: '', node: workspaceNode, title: 'Workspace' },
              ]}
            />
          </ErrorBoundary>
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
  return { store, workspace: () => within(workspaceNode) };
};

/** Every state the card saved, in order. */
const savedStates = () =>
  vi
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
const lastSaved = () => savedStates()[savedStates().length - 1];

/** QDN with a Q-Tube video's and a Q-Share song's details. */
const qdnFetch = async (url: string) => {
  const json = (value: unknown) => ({
    json: () => Promise.resolve(value),
    ok: true,
  });
  if (url.endsWith('/DOCUMENT/BigPicture/qtube_vid_gold_metadata')) {
    return json({
      title: 'Gold vs. treasuries',
      videoReference: {
        identifier: 'qtube_vid_gold',
        name: 'BigPicture',
        service: 'VIDEO',
      },
      videoType: 'video/mp4',
    });
  }
  if (url.endsWith('/DOCUMENT/PixelMage/qshare_file_john_metadata')) {
    return json({
      files: [
        {
          identifier: 'qshare_file_john_mp3',
          mimetype: 'audio/mpeg',
          name: 'PixelMage',
          service: 'FILE',
        },
      ],
      title: 'Through the Bible',
    });
  }
  if (url.includes('/DOCUMENT/')) return { json: () => null, ok: false };
  return json([]);
};

/** The same QDN, keeping a link's details back until `answer()`. */
const slowQdn = () => {
  let answer = () => undefined as void;
  const gate = new Promise<void>((resolve) => {
    answer = resolve;
  });
  global.fetch = vi.fn(async (url: string) => {
    if (url.includes('/DOCUMENT/')) await gate;
    return qdnFetch(url);
  }) as unknown as typeof fetch;
  return async () => {
    await act(async () => {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  };
};

const playLink = async (link: string) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Play a link' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: 'Play a link' }),
    { target: { value: link } }
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Play' }));
  return dialog;
};

describe('the Workspace player, off the usual path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEarbumpRecentTracks).mockResolvedValue([]);
    localStorage.clear();
    localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
    localStorage.setItem(`${LS_KEY}_QOTHER`, 'completed');
    global.fetch = vi.fn(qdnFetch) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    slots.splice(0).forEach((node) => node.remove());
  });

  it('leaves the player alone when the dialog is closed with its X while the link is read', async () => {
    const card = renderCard();
    const answer = slowQdn();

    const dialog = await playLink(QSHARE_LINK);
    fireEvent.click(
      within(dialog)
        .getByTestId('CloseRoundedIcon')
        .closest('button') as HTMLButtonElement
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // The node answers after the dialog has gone.
    await answer();
    expect(
      card.workspace().queryByText('Through the Bible')
    ).not.toBeInTheDocument();
    expect(savedStates().some((state) => 'mediaLink' in state)).toBe(false);

    // Opened again, it takes another link.
    fireEvent.click(await screen.findByRole('button', { name: 'Play a link' }));
    const again = await screen.findByRole('dialog');
    fireEvent.change(
      within(again).getByRole('textbox', { name: 'Play a link' }),
      { target: { value: QTUBE_LINK } }
    );
    expect(within(again).getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('drops a link still being read when another account takes over', async () => {
    const card = renderCard();
    const answer = slowQdn();

    await playLink(QSHARE_LINK);
    act(() => {
      card.store.set(userInfoAtom, { address: 'QOTHER', name: 'other' });
    });
    await answer();

    expect(
      card.workspace().queryByText('Through the Bible')
    ).not.toBeInTheDocument();
    expect(savedStates().some((state) => 'mediaLink' in state)).toBe(false);
    expect(
      localStorage.getItem(`${QORTINO_WORKSPACE_SETTINGS_KEY}_QOTHER`) ?? ''
    ).not.toContain('mediaLink');
  });

  describe('Previous and Next from a link’s one song', () => {
    const cycleButton = (
      card: ReturnType<typeof renderCard>,
      icon: 'SkipNextRoundedIcon' | 'SkipPreviousRoundedIcon'
    ) =>
      card.workspace().getAllByTestId(icon)[0].closest('button') as HTMLElement;

    it('goes to one of EarBump’s tracks, and leaves the link', async () => {
      vi.mocked(fetchEarbumpRecentTracks).mockResolvedValue([
        earbumpTrack('earbump_song_one', 'First of EarBump'),
        earbumpTrack('earbump_song_two', 'Second of EarBump'),
      ]);
      const card = renderCard();
      await waitFor(() => {
        expect(
          card.workspace().getByText('First of EarBump')
        ).toBeInTheDocument();
      });

      await playLink(QSHARE_LINK);
      await waitFor(() => {
        expect(
          card.workspace().getByText('Through the Bible')
        ).toBeInTheDocument();
      });

      fireEvent.click(cycleButton(card, 'SkipPreviousRoundedIcon'));

      await waitFor(() => {
        expect(lastSaved()).not.toHaveProperty('mediaLink');
      });
      expect(lastSaved()).toMatchObject({
        musicPlaying: true,
        selectedTrackId: 'earbump_song_two',
      });
      expect(
        card.workspace().getByText('Second of EarBump')
      ).toBeInTheDocument();
      expect(
        card.workspace().queryByText('Through the Bible')
      ).not.toBeInTheDocument();
    });

    it('stays on the link when EarBump has nothing to go to', async () => {
      const card = renderCard();

      await playLink(QSHARE_LINK);
      await waitFor(() => {
        expect(
          card.workspace().getByText('Through the Bible')
        ).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(lastSaved()).toMatchObject({ mediaLink: { kind: 'audio' } });
      });

      fireEvent.click(cycleButton(card, 'SkipNextRoundedIcon'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(lastSaved()).toMatchObject({
        mediaLink: { identifier: 'qshare_file_john_mp3', kind: 'audio' },
      });
      expect(lastSaved().selectedTrackId).not.toBe('qshare_file_john_mp3');
    });
  });

  it('asks the node again for a video it could not get, when its link is played again', async () => {
    const card = renderCard();

    await playLink(QTUBE_LINK);
    expect(
      await card
        .workspace()
        .findByText('Preparing the video on your node... 0%')
    ).toBeInTheDocument();

    // The node couldn't get it.
    act(() => {
      card.store.set(resourceDownloadControllerAtom, {
        'VIDEO-BigPicture-qtube_vid_gold': {
          downloadScope: 'music-player',
          status: { status: 'FAILED_TO_DOWNLOAD' },
        },
      });
    });
    expect(
      await card
        .workspace()
        .findByText('This video could not finish loading on your node.')
    ).toBeInTheDocument();
    downloadResource.mockClear();

    await playLink(QTUBE_LINK);
    await waitFor(() => {
      expect(downloadResource).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'qtube_vid_gold',
          name: 'BigPicture',
          service: 'VIDEO',
        })
      );
    });
  });

  it('leaves a link’s playback error behind when going back to EarBump', async () => {
    vi.mocked(fetchEarbumpRecentTracks).mockResolvedValue([
      earbumpTrack('earbump_song_one', 'First of EarBump'),
    ]);
    const card = renderCard();
    await waitFor(() => {
      expect(
        card.workspace().getByText('First of EarBump')
      ).toBeInTheDocument();
    });

    await playLink(QSHARE_LINK);
    await waitFor(() => {
      expect(
        card.workspace().getByText('Through the Bible')
      ).toBeInTheDocument();
    });

    // The song's stream breaks.
    act(() => {
      getSharedEarbumpAudio()?.dispatchEvent(new Event('error'));
    });
    expect(
      await card
        .workspace()
        .findByText('Playback stalled. Press play to retry.')
    ).toBeInTheDocument();

    fireEvent.click(
      await card.workspace().findByRole('button', { name: 'Back to EarBump' })
    );
    await waitFor(() => {
      expect(
        card.workspace().getByText('First of EarBump')
      ).toBeInTheDocument();
    });
    expect(
      card.workspace().queryByText('Playback stalled. Press play to retry.')
    ).not.toBeInTheDocument();
  });

  it('goes on to EarBump when a link’s one song ends while Home isn’t showing', async () => {
    vi.mocked(fetchEarbumpRecentTracks).mockResolvedValue([
      earbumpTrack('earbump_song_one', 'First of EarBump'),
    ]);
    // The player was left playing a Q-Share song.
    window.sendMessage = vi.fn(async (type: string) =>
      type === 'getUserSettings'
        ? playerState({
            mediaLink: {
              identifier: 'qshare_file_john_mp3',
              kind: 'audio',
              link: QSHARE_LINK,
              name: 'PixelMage',
              publisher: 'PixelMage',
              service: 'FILE',
              title: 'Through the Bible',
            },
            musicPlaying: true,
            selectedTrackId: 'earbump_song_one',
          })
        : null
    ) as typeof window.sendMessage;
    const store = createStore();
    store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
    render(
      <JotaiProvider store={store}>
        <QortinoMusicPlaybackController />
      </JotaiProvider>
    );
    await waitFor(() => {
      expect(lastSaved()).toMatchObject({ mediaLink: { kind: 'audio' } });
    });
    await waitFor(() => {
      expect(fetchEarbumpRecentTracks).toHaveBeenCalled();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // The song plays to its end.
    act(() => {
      getSharedEarbumpAudio()?.dispatchEvent(new Event('ended'));
    });

    await waitFor(() => {
      expect(lastSaved()).not.toHaveProperty('mediaLink');
    });
    expect(lastSaved()).toMatchObject({
      musicPlaying: true,
      selectedTrackId: 'earbump_song_one',
    });
  });
});
