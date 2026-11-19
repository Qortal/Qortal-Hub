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
import {
  HomeQortinoWorkspaceCard,
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
const QTUBE_LINK = 'qortal://APP/Q-Tube/video/BigPicture/qtube_vid_gold';
const VIDEO_KEY = 'VIDEO-BigPicture-qtube_vid_gold';
const PREPARING = 'Preparing the video on your node... 0%';
const FAILED = 'This video could not finish loading on your node.';

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
const qdnFetch = async (url: string) => {
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
  if (url.includes('/arbitrary/resource/properties/')) return notFound();
  if (url.includes('/arbitrary/metadata/')) return notFound();
  if (url.includes('/DOCUMENT/')) return notFound();
  return json([]);
};

const slots: HTMLElement[] = [];
const slot = () => {
  const node = document.body.appendChild(document.createElement('div'));
  slots.push(node);
  return node;
};

/** The first Workspace empty, its copy k1 showing the player. */
const stored = {
  hotkeys: Array.from({ length: 6 }, () => null),
  mode: 'empty',
  musicPlaying: false,
  musicQuery: '',
  onboardingCelebrationSeen: true,
  repeatMode: 'all',
  selectedTrackId: '',
  version: 1,
  windows: { k1: { hotkeys: [], mode: 'music' } },
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

/** Whether the card was asked to stop getting the video. */
const videoCancelled = () =>
  downloadResource.cancelResourceDownload.mock.calls.some(
    ([metadata]) =>
      metadata?.service === 'VIDEO' && metadata?.identifier === 'qtube_vid_gold'
  );

const renderHome = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 0);
  store.set(txListAtom, []);
  const qortinoNode = slot();
  const first = slot();
  const copy = slot();
  const tree = (
    places: { key: string; node: HTMLElement; title: string }[]
  ) => (
    <JotaiProvider store={store}>
      <ThemeProvider theme={theme}>
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary fallback={<div>boundary fallback</div>}>
            <HomeQortinoWorkspaceCard
              qortinoNode={qortinoNode}
              workspaces={places}
            />
          </ErrorBoundary>
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
  const both = [
    { key: '', node: first, title: 'Workspace' },
    { key: 'k1', node: copy, title: 'Workspace 2' },
  ];
  const view = render(tree(both));
  return {
    copy,
    first,
    /** Edit Home takes the copy k1 off Home; the first Workspace stays. */
    removeCopy: () => view.rerender(tree([both[0]])),
    /** Home shown again, with both Workspaces. */
    showHome: () => view.rerender(tree(both)),
    store,
    view,
  };
};

/** Home left for an app: the background player runs with these windows. */
const leaveHome = (
  home: ReturnType<typeof renderHome>,
  workspaceKeys: string[]
) =>
  home.view.rerender(
    <JotaiProvider store={home.store}>
      <QortinoMusicPlaybackController workspaceKeys={workspaceKeys} />
    </JotaiProvider>
  );

/** The node couldn't get the video. */
const videoFailed = (store: ReturnType<typeof createStore>) =>
  act(() => {
    store.set(resourceDownloadControllerAtom, {
      [VIDEO_KEY]: {
        downloadScope: 'music-player',
        status: { status: 'FAILED_TO_DOWNLOAD' },
      },
    });
  });

/** The Workspace state saved last, read back at the next load. */
let savedSettings: unknown;

/** Player picked in the first Workspace's module picker. */
const pickPlayerInFirst = async (first: HTMLElement) => {
  fireEvent.click(
    within(first).getByTestId('AddRoundedIcon').closest('button')!
  );
  const picker = await screen.findByRole('dialog');
  fireEvent.click(within(picker).getByText('Player'));
};

/** The node has the video ready. */
const videoReady = (store: ReturnType<typeof createStore>) =>
  act(() => {
    store.set(resourceDownloadControllerAtom, {
      [VIDEO_KEY]: { status: { status: 'READY' } },
    });
  });

describe('a Workspace copy holding the player taken off Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('getting_started_status_QADDR', 'completed');
    global.fetch = vi.fn(qdnFetch) as unknown as typeof fetch;
    savedSettings = stored;
    window.sendMessage = vi.fn(
      async (type: string, payload?: { keyValue?: { value?: unknown } }) => {
        if (type === 'getUserSettings') return savedSettings;
        if (type === 'addUserSettings')
          savedSettings = payload?.keyValue?.value;
        return null;
      }
    ) as typeof window.sendMessage;
  });

  afterEach(() => {
    cleanup();
    slots.splice(0).forEach((node) => node.remove());
  });

  it('doesn’t start a video by itself when Player is picked again in another Workspace', async () => {
    const home = renderHome();
    await playLink(QTUBE_LINK);
    expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();

    home.removeCopy();
    await waitFor(() => {
      expect(screen.queryByText(PREPARING)).not.toBeInTheDocument();
    });

    await pickPlayerInFirst(home.first);
    expect(await within(home.first).findByText(PREPARING)).toBeInTheDocument();
    videoReady(home.store);

    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    expect(document.querySelector('video')).not.toHaveAttribute('autoplay');
  });

  it('doesn’t start it by itself either when the copy’s player was closed first', async () => {
    const home = renderHome();
    await playLink(QTUBE_LINK);
    expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();

    // The X in the copy's header.
    fireEvent.click(
      within(home.copy).getAllByTestId('CloseRoundedIcon')[0].closest('button')!
    );
    await waitFor(() => {
      expect(screen.queryByText(PREPARING)).not.toBeInTheDocument();
    });

    await pickPlayerInFirst(home.first);
    expect(await within(home.first).findByText(PREPARING)).toBeInTheDocument();
    videoReady(home.store);

    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    expect(document.querySelector('video')).not.toHaveAttribute('autoplay');
  });

  it('stops getting a video still preparing when the last copy goes with the card', async () => {
    const home = renderHome();
    await playLink(QTUBE_LINK);
    expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();
    downloadResource.cancelResourceDownload.mockClear();

    // The Workspace and Qortino hidden, the last copy removed: the card goes
    // and the background player runs with the first Workspace's key only.
    home.view.rerender(
      <JotaiProvider store={home.store}>
        <QortinoMusicPlaybackController workspaceKeys={['']} />
      </JotaiProvider>
    );

    await waitFor(() => {
      expect(videoCancelled()).toBe(true);
    });
  });

  it('keeps getting a video still preparing when Home is left', async () => {
    const home = renderHome();
    await playLink(QTUBE_LINK);
    expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();
    downloadResource.cancelResourceDownload.mockClear();

    // Home left for an app: the card goes, the copy stays in the layout.
    leaveHome(home, ['', 'k1']);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(videoCancelled()).toBe(false);

    // Home shown again: the video is still there, and once the node has it
    // ready it doesn't start by itself.
    home.showHome();
    expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();
    videoReady(home.store);
    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    expect(document.querySelector('video')).not.toHaveAttribute('autoplay');
    expect(videoCancelled()).toBe(false);
  });

  it('stops getting a video still preparing when the account changes while Home is left', async () => {
    const home = renderHome();
    await playLink(QTUBE_LINK);
    expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();
    leaveHome(home, ['', 'k1']);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    downloadResource.cancelResourceDownload.mockClear();

    // Another account, whose player has no link in it.
    savedSettings = stored;
    act(() => {
      home.store.set(userInfoAtom, { address: 'QOTHER', name: 'c-test' });
    });

    await waitFor(() => {
      expect(videoCancelled()).toBe(true);
    });
  });

  it('keeps a video the node has ready when Home is left', async () => {
    const home = renderHome();
    videoReady(home.store);
    await playLink(QTUBE_LINK);
    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull();
    });
    downloadResource.cancelResourceDownload.mockClear();

    home.view.rerender(
      <JotaiProvider store={home.store}>
        <QortinoMusicPlaybackController workspaceKeys={['', 'k1']} />
      </JotaiProvider>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(videoCancelled()).toBe(false);
  });

  describe('a video the node couldn’t get', () => {
    it('isn’t stopped when the player leaves it, so it isn’t asked for again', async () => {
      const home = renderHome();
      await playLink(QTUBE_LINK);
      expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();
      videoFailed(home.store);
      expect(await within(home.copy).findByText(FAILED)).toBeInTheDocument();
      downloadResource.cancelResourceDownload.mockClear();

      fireEvent.click(
        within(home.copy).getByRole('button', { name: 'Back to EarBump' })
      );
      await waitFor(() => {
        expect(within(home.copy).queryByText(FAILED)).not.toBeInTheDocument();
      });

      expect(videoCancelled()).toBe(false);
    });

    it('isn’t stopped either when the last copy goes with the card', async () => {
      const home = renderHome();
      await playLink(QTUBE_LINK);
      expect(await within(home.copy).findByText(PREPARING)).toBeInTheDocument();
      videoFailed(home.store);
      expect(await within(home.copy).findByText(FAILED)).toBeInTheDocument();
      downloadResource.cancelResourceDownload.mockClear();

      // The Workspace and Qortino hidden, the last copy removed.
      leaveHome(home, ['']);
      // The background player has let go of the copy.
      await waitFor(() => {
        expect(
          (savedSettings as { windows?: Record<string, unknown> }).windows?.k1
        ).toBeUndefined();
      });

      expect(videoCancelled()).toBe(false);
    });
  });
});
