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
const SONG_LINK = 'qortal://APP/Q-Share/share/PixelMage/qshare_file_hymn';
const VIDEO_KEY = 'VIDEO-BigPicture-qtube_vid_gold';

/** A video's picture as Q-Tube keeps it: a data URL, often a big one. */
const BIG_PICTURE = `data:image/jpeg;base64,${'A'.repeat(40_000)}`;

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

const renderCard = (stored: unknown = playerState()) => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 0);
  store.set(txListAtom, []);

  window.sendMessage = vi.fn(async (type: string) =>
    type === 'getUserSettings' ? stored : null
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

const json = (value: unknown) => ({
  json: () => Promise.resolve(value),
  ok: true,
  status: 200,
});
const notFound = () => ({
  json: () => Promise.resolve({ error: 1101, message: 'File not found' }),
  ok: false,
  status: 404,
});

/** QDN with a Q-Tube video's and a Q-Share song's details. */
const qdnFetch = async (url: string) => {
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
  if (url.endsWith('/DOCUMENT/PixelMage/qshare_file_hymn_metadata')) {
    return json({
      files: [
        {
          identifier: 'qshare_file_hymn_mp3',
          mimetype: 'audio/mpeg',
          name: 'PixelMage',
          service: 'FILE',
        },
      ],
      thumbnail: BIG_PICTURE,
      title: 'Morning hymn',
    });
  }
  // The node hasn't got a file yet: it can't say what it is.
  if (url.includes('/arbitrary/resource/properties/')) return notFound();
  if (url.includes('/arbitrary/metadata/')) return notFound();
  if (url.includes('/DOCUMENT/')) return notFound();
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
  return dialog;
};

/** Whether the video's place shows this picture. */
const showsPicture = (picture: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('div')).some((node) =>
    node.style.backgroundImage.includes(picture.slice(0, 40))
  ) ||
  Array.from(document.querySelectorAll('video')).some(
    (video) => video.getAttribute('poster') === picture
  );

/** Whether the song's vinyl shows this picture. */
const vinylShows = (picture: string) =>
  Array.from(document.querySelectorAll('img')).some(
    (image) => image.getAttribute('src') === picture
  );

/** The X in the player's header. */
const closePlayerButton = (card: ReturnType<typeof renderCard>) =>
  card
    .workspace()
    .getAllByTestId('CloseRoundedIcon')[0]
    .closest('button') as HTMLButtonElement;

describe('the Workspace player with linked videos and files', () => {
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

  it('has the node get a file it can’t describe yet, tried as a video', async () => {
    const card = renderCard();

    // A file the node doesn't have yet: neither its properties nor its
    // metadata say what it is.
    await playLink('qortal://FILE/PixelMage/talk_mp4');

    expect(
      await card
        .workspace()
        .findByText('Preparing the video on your node... 0%')
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:12391/arbitrary/metadata/FILE/PixelMage/talk_mp4',
      expect.anything()
    );
    await waitFor(() => {
      expect(downloadResource).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'talk_mp4',
          name: 'PixelMage',
          service: 'FILE',
        })
      );
    });
    await waitFor(() => {
      expect(lastSaved()).toMatchObject({
        mediaLink: { identifier: 'talk_mp4', kind: 'video' },
      });
    });
  });

  it('says so when the video the node has can’t be played', async () => {
    const card = renderCard();
    act(() => {
      card.store.set(resourceDownloadControllerAtom, {
        [VIDEO_KEY]: { status: { status: 'READY' } },
      });
    });

    await playLink(QTUBE_LINK);
    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });

    // The browser can't decode it (a codec it lacks, or not a video).
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);

    expect(
      await card.workspace().findByText(/could not|can.t be played|couldn.t/i)
    ).toBeInTheDocument();
  });

  it('plays a video again when its link is played again after it failed', async () => {
    const card = renderCard();
    act(() => {
      card.store.set(resourceDownloadControllerAtom, {
        [VIDEO_KEY]: { status: { status: 'READY' } },
      });
    });
    const failure = /could not|can.t be played|couldn.t/i;
    // The player's Play.
    const playButton = () => screen.getByRole('button', { name: 'Play' });
    // The link window closes once the link is read.
    const linkWindowClosed = () =>
      waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await playLink(QTUBE_LINK);
    await linkWindowClosed();
    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    // A passing trouble: this time the browser couldn't play it.
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);
    expect(await card.workspace().findByText(failure)).toBeInTheDocument();
    expect(playButton()).toBeDisabled();

    // The same link, played again: it's tried afresh.
    await playLink(QTUBE_LINK);
    await linkWindowClosed();

    await waitFor(() => {
      expect(card.workspace().queryByText(failure)).toBeNull();
    });
    expect(document.querySelector('video')).not.toBeNull();
    expect(playButton()).toBeEnabled();
  });

  it('still shows a video’s big picture after Home was left', async () => {
    const card = renderCard();
    await playLink(QTUBE_LINK);
    expect(
      await card
        .workspace()
        .findByText('Preparing the video on your node... 0%')
    ).toBeInTheDocument();
    expect(showsPicture(BIG_PICTURE)).toBe(true);
    await waitFor(() => {
      expect(lastSaved()).toMatchObject({ mediaLink: { kind: 'video' } });
    });

    // Home is left for an app, then shown again: the card comes back.
    const saved = lastSaved();
    cleanup();
    slots.splice(0).forEach((node) => node.remove());
    const again = renderCard(saved);

    expect(
      await again
        .workspace()
        .findByText('Preparing the video on your node... 0%')
    ).toBeInTheDocument();
    expect(showsPicture(BIG_PICTURE)).toBe(true);
  });

  it('shows a song’s big picture on the vinyl, also after Home was left', async () => {
    const card = renderCard();
    await playLink(SONG_LINK);
    await waitFor(() => {
      expect(card.workspace().getByText('Morning hymn')).toBeInTheDocument();
    });
    expect(vinylShows(BIG_PICTURE)).toBe(true);
    await waitFor(() => {
      expect(lastSaved()).toMatchObject({ mediaLink: { kind: 'audio' } });
    });

    // The saved state keeps no picture this big.
    const saved = lastSaved();
    expect(saved.mediaLink).not.toHaveProperty('thumbnail');

    // Home is left for an app, then shown again: the card comes back.
    cleanup();
    slots.splice(0).forEach((node) => node.remove());
    const again = renderCard(saved);

    await waitFor(() => {
      expect(again.workspace().getByText('Morning hymn')).toBeInTheDocument();
    });
    expect(vinylShows(BIG_PICTURE)).toBe(true);
  });

  it('stops getting a video it is still preparing when another link is played', async () => {
    const card = renderCard();
    await playLink(QTUBE_LINK);
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

    expect(downloadResource.cancelResourceDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'qtube_vid_gold',
        name: 'BigPicture',
        service: 'VIDEO',
      })
    );
  });

  it('stops getting a video it is still preparing when the player is closed', async () => {
    const card = renderCard();
    await playLink(QTUBE_LINK);
    expect(
      await card
        .workspace()
        .findByText('Preparing the video on your node... 0%')
    ).toBeInTheDocument();

    fireEvent.click(closePlayerButton(card));
    await waitFor(() => {
      expect(lastSaved()).toMatchObject({ mode: 'empty' });
    });

    expect(downloadResource.cancelResourceDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'qtube_vid_gold',
        service: 'VIDEO',
      })
    );
  });

  it('doesn’t start a video by itself when the player is opened again', async () => {
    const card = renderCard();
    act(() => {
      card.store.set(resourceDownloadControllerAtom, {
        [VIDEO_KEY]: { status: { status: 'READY' } },
      });
    });

    // Right after its link is played, the video starts by itself.
    await playLink(QTUBE_LINK);
    await waitFor(() => {
      expect(document.querySelector('video')).toHaveAttribute('autoplay');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // The player is closed, and picked again later.
    fireEvent.click(closePlayerButton(card));
    await waitFor(() => {
      expect(document.querySelector('video')).toBeNull();
    });
    fireEvent.click(
      card.workspace().getByTestId('AddRoundedIcon').closest('button')!
    );
    const picker = await screen.findByRole('dialog');
    fireEvent.click(within(picker).getByText('Player'));

    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    expect(document.querySelector('video')).not.toHaveAttribute('autoplay');
  });
});
