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
import {
  HomeQortinoWorkspaceCard,
  QORTINO_WORKSPACE_SETTINGS_KEY,
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
const OTHER_QTUBE_LINK = 'qortal://APP/Q-Tube/video/BigPicture/qtube_vid_iron';

/** A picture as Q-Tube and Q-Share keep them: a data URL, here a big one. */
const BIG_PICTURE = `data:image/jpeg;base64,${'A'.repeat(30_000)}`;

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
const playerState = () => ({
  hotkeys: Array.from({ length: 6 }, () => null),
  mode: 'music',
  musicPlaying: false,
  musicQuery: '',
  onboardingCelebrationSeen: true,
  repeatMode: 'all',
  selectedTrackId: '',
  version: 1,
});

/** The card on Home, with the account's Workspace kept on this PC. */
const renderCard = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 0);
  store.set(txListAtom, []);
  localStorage.setItem(
    `${QORTINO_WORKSPACE_SETTINGS_KEY}_QADDR`,
    JSON.stringify(playerState())
  );
  // The account's settings answer nothing: the card reads its own copy.
  window.sendMessage = vi.fn(async () => null) as typeof window.sendMessage;

  const qortinoNode = slot();
  const workspaceNode = slot();
  const view = () => (
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
  render(view());
  return {
    store,
    workspace: () => within(workspaceNode),
  };
};

/** QDN with two Q-Tube videos' and a Q-Share song's details. */
const qdnFetch = async (url: string) => {
  const json = (value: unknown) => ({
    json: () => Promise.resolve(value),
    ok: true,
  });
  if (url.endsWith('/DOCUMENT/BigPicture/qtube_vid_gold_metadata')) {
    return json({
      title: 'Gold vs. treasuries',
      videoImage: BIG_PICTURE,
      videoReference: {
        identifier: 'qtube_vid_gold',
        name: 'BigPicture',
        service: 'VIDEO',
      },
      videoType: 'video/mp4',
    });
  }
  if (url.endsWith('/DOCUMENT/BigPicture/qtube_vid_iron_metadata')) {
    return json({
      title: 'Iron and steel',
      videoReference: {
        identifier: 'qtube_vid_iron',
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
      thumbnail: BIG_PICTURE,
      title: 'Through the Bible',
    });
  }
  if (url.includes('/DOCUMENT/')) return { json: () => null, ok: false };
  return json([]);
};

const playLink = async (link: string) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Play a link' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: 'Play a link' }),
    { target: { value: link } }
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Play' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
};

/** The video the card was asked to stop getting, if any. */
const videoCancelled = (identifier: string) =>
  downloadResource.cancelResourceDownload.mock.calls.some(
    ([metadata]) =>
      metadata?.service === 'VIDEO' && metadata?.identifier === identifier
  );

describe('videos a link plays in the Workspace player', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEarbumpRecentTracks).mockResolvedValue([]);
    localStorage.clear();
    localStorage.setItem(`${LS_KEY}_QADDR`, 'completed');
    global.fetch = vi.fn(qdnFetch) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    slots.splice(0).forEach((node) => node.remove());
  });

  it('says so when the video it got can’t be played', async () => {
    const card = renderCard();

    await playLink(OTHER_QTUBE_LINK);
    expect(
      await card
        .workspace()
        .findByText('Preparing the video on your node... 0%')
    ).toBeInTheDocument();
    act(() => {
      card.store.set(resourceDownloadControllerAtom, {
        'VIDEO-BigPicture-qtube_vid_iron': { status: { status: 'READY' } },
      });
    });
    const video = await waitFor(() => {
      const element = document.querySelector('video');
      expect(element).not.toBeNull();
      return element as HTMLVideoElement;
    });

    // The browser can't play it (a format it doesn't know, or not a video).
    act(() => {
      Object.defineProperty(video, 'error', {
        configurable: true,
        value: { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' },
      });
      video.dispatchEvent(new Event('error'));
    });

    expect(
      await card
        .workspace()
        .findByText(/can.t|cannot|could not|couldn.t|failed|no music or video/i)
    ).toBeInTheDocument();
  });

  describe('leaving a video the node is still getting', () => {
    it('stops getting it when the player is closed', async () => {
      const card = renderCard();

      await playLink(OTHER_QTUBE_LINK);
      expect(
        await card
          .workspace()
          .findByText('Preparing the video on your node... 0%')
      ).toBeInTheDocument();

      // The player's own close button, beside Back to EarBump.
      fireEvent.click(
        card
          .workspace()
          .getAllByTestId('CloseRoundedIcon')
          .map((icon) => icon.closest('button') as HTMLElement)
          .slice(-1)[0]
      );
      await waitFor(() => {
        expect(
          card.workspace().queryByText('Iron and steel')
        ).not.toBeInTheDocument();
      });

      expect(videoCancelled('qtube_vid_iron')).toBe(true);
    });

    it('stops getting it when another link is played', async () => {
      const card = renderCard();

      await playLink(OTHER_QTUBE_LINK);
      expect(
        await card
          .workspace()
          .findByText('Preparing the video on your node... 0%')
      ).toBeInTheDocument();

      await playLink(QSHARE_LINK);
      await waitFor(() => {
        expect(
          card.workspace().getByText('Through the Bible')
        ).toBeInTheDocument();
      });

      expect(videoCancelled('qtube_vid_iron')).toBe(true);
    });

    it('stops getting it when one of EarBump’s tracks is picked', async () => {
      vi.mocked(fetchEarbumpRecentTracks).mockResolvedValue([
        earbumpTrack('earbump_song_one', 'First of EarBump'),
        earbumpTrack('earbump_song_two', 'Second of EarBump'),
      ]);
      const card = renderCard();

      await playLink(OTHER_QTUBE_LINK);
      expect(
        await card
          .workspace()
          .findByText('Preparing the video on your node... 0%')
      ).toBeInTheDocument();

      fireEvent.click(
        card
          .workspace()
          .getByTestId('SearchRoundedIcon')
          .closest('button') as HTMLElement
      );
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(await within(dialog).findByText('Second of EarBump'));
      await waitFor(() => {
        expect(
          card.workspace().getByText('Second of EarBump')
        ).toBeInTheDocument();
      });

      expect(videoCancelled('qtube_vid_iron')).toBe(true);
    });
  });
});
