import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { Activity } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import {
  fetchQuitterFeedPage,
  fetchQuitterFollowedNames,
} from './quitter/quitterFeedApi';
import type { QuitterFeedItem } from './quitter/quitterFeedTypes';
import { fetchTorqHiddenUsers } from './quitter/torqFeed';
import { QuitterFeedWidget } from './QuitterFeedWidget';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 100,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 100,
      })),
    measureElement: () => {},
  }),
}));

vi.mock('./quitter/quitterFeedApi', () => ({
  fetchQuitterFeedPage: vi.fn(),
  fetchQuitterFollowedNames: vi.fn(),
}));

vi.mock('./quitter/torqFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitter/torqFeed')>()),
  fetchTorqHiddenUsers: vi.fn(),
}));

vi.mock('../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/events')>()),
  executeEvent: vi.fn(),
}));

// tiptap needs a real browser; a textarea stands in for the Torq editor.
vi.mock('./quitter/TorqTextEditor', async () => {
  const { plainTextToTorqDoc } = await import('./quitter/torqRichText');
  return {
    TorqTextEditor: ({
      onChange,
    }: {
      onChange: (doc: ReturnType<typeof plainTextToTorqDoc>) => void;
    }) => (
      <textarea
        aria-label="Post text"
        onChange={(event) => onChange(plainTextToTorqDoc(event.target.value))}
      />
    ),
  };
});

const post = (
  author: string,
  identifier: string,
  text: string
): QuitterFeedItem => ({
  author,
  avatarUrl: '',
  hasVideo: false,
  id: `${author}:${identifier}`,
  identifier,
  images: [],
  latestSignature: 'sig',
  publishedAt: 1_700_000_000_000,
  searchCreatedAt: 1_700_000_000_000,
  service: 'DOCUMENT',
  text,
});

const makeStore = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QViewer', name: 'Viewer' });
  return store;
};

const renderWidget = (
  store: ReturnType<typeof createStore>,
  refreshToken = 0
) => {
  const ui = (token: number) => (
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <QuitterFeedWidget refreshToken={token} />
      </ThemeProvider>
    </Provider>
  );
  const view = render(ui(refreshToken));
  return { ...view, refresh: (token: number) => view.rerender(ui(token)) };
};

/**
 * The feed as Home has it: inside <Activity>, which hides Home (and does not
 * unmount it) while an app tab is on screen.
 */
const renderOnHome = (store: ReturnType<typeof createStore>) => {
  const ui = (homeShown: boolean) => (
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Activity mode={homeShown ? 'visible' : 'hidden'}>
          <QuitterFeedWidget />
        </Activity>
      </ThemeProvider>
    </Provider>
  );
  const view = render(ui(true));
  return {
    leaveHome: () => act(() => view.rerender(ui(false))),
    backToHome: () => act(() => view.rerender(ui(true))),
  };
};

const feedPage = (items: QuitterFeedItem[]) => ({
  hasMore: false,
  items,
  nextOffset: 0,
});

const openedApps = () =>
  vi
    .mocked(executeEvent)
    .mock.calls.filter(([event]) => event === 'addTab')
    .map(([, payload]) => (payload as { data: { name: string } }).data);

describe('QuitterFeedWidget as the Torq feed', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(executeEvent).mockClear();
    vi.mocked(fetchQuitterFeedPage).mockReset();
    vi.mocked(fetchQuitterFollowedNames).mockResolvedValue([
      'Alice',
      'Spammer',
    ]);
    vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
      hasMore: false,
      items: [
        post('Alice', 'p1', 'hello from alice qortal://use-embed/GIF/abc'),
        post('Spammer', 'p2', 'buy now'),
      ],
      nextOffset: 0,
    });
    vi.mocked(fetchTorqHiddenUsers).mockReset();
    vi.mocked(fetchTorqHiddenUsers).mockResolvedValue(['spammer']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the feed as Torq does, and opens posts in Torq', async () => {
    const store = makeStore();
    renderWidget(store);

    expect(await screen.findByText('hello from alice')).toBeInTheDocument();
    // No choice of app: Quitter is left out.
    expect(screen.queryByRole('button', { name: 'Quitter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Torq' })).toBeNull();
    await waitFor(() =>
      expect(screen.queryByText('buy now')).not.toBeInTheDocument()
    );
    expect(fetchTorqHiddenUsers).toHaveBeenCalledWith(
      'Viewer',
      expect.objectContaining({ force: false })
    );

    fireEvent.click(screen.getByText('hello from alice'));
    expect(openedApps()).toEqual([
      expect.objectContaining({ name: 'Torq', path: 'post/Alice/p1' }),
    ]);
  });

  it('says which feed it is', async () => {
    const store = makeStore();
    renderWidget(store);
    await screen.findByText('hello from alice');

    expect(screen.getByText('Personalized feed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    expect(screen.getByText('Public feed')).toBeInTheDocument();
  });

  it('names Torq in its messages', async () => {
    vi.mocked(fetchQuitterFollowedNames).mockResolvedValue([]);
    vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
      hasMore: false,
      items: [],
      nextOffset: 0,
    });
    const store = makeStore();
    renderWidget(store);

    expect(
      await screen.findByText(
        'Browse Torq and follow accounts to build your feed.'
      )
    ).toBeInTheDocument();
  });

  it('names Torq when the feed fails to load', async () => {
    vi.mocked(fetchQuitterFeedPage).mockRejectedValue(new Error('node down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore();
    renderWidget(store);

    expect(
      await screen.findByText(
        'The personalized Torq feed is temporarily unavailable. Please try again.'
      )
    ).toBeInTheDocument();
  });

  it('shows a post from the composer at the top of the feed', async () => {
    const sendMessage = vi.fn(async () => [{ signature: 'sig' }]);
    window.sendMessage = sendMessage;
    const store = makeStore();
    renderWidget(store);
    await screen.findByText('hello from alice');
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    await screen.findByText('hello from alice');
    vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
      hasMore: false,
      items: [
        post('Viewer', 'mine', 'my new post'),
        post('Alice', 'p1', 'hello from alice'),
      ],
      nextOffset: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Post to Torq' }));
    // The open composer has the window to itself, above the posts.
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Post text' }), {
      target: { value: 'my new post' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('my new post')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Published to Torq')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    // Shown right away, not behind "1 new post".
    expect(screen.queryByText('1 new post')).toBeNull();
    const texts = screen
      .getAllByText(/my new post|hello from alice/)
      .map((node) => node.textContent);
    expect(texts).toEqual(['my new post', 'hello from alice']);
  });

  const followingAuthors = () =>
    vi
      .mocked(fetchQuitterFeedPage)
      .mock.calls.map(([options]) => options?.allowedAuthors);

  it('shows Your own posts in Following, also one just made in the composer', async () => {
    const sendMessage = vi.fn(async () => [{ signature: 'sig' }]);
    window.sendMessage = sendMessage;
    const store = makeStore();
    renderWidget(store);
    await screen.findByText('hello from alice');
    // Following is the default tab. Your name comes first, before a long
    // follow list can push it out of the search.
    expect(followingAuthors()[0]).toEqual(['Viewer', 'Alice', 'Spammer']);

    vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
      hasMore: false,
      items: [
        post('Viewer', 'mine', 'my new post'),
        post('Alice', 'p1', 'hello from alice'),
      ],
      nextOffset: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post to Torq' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Post text' }), {
      target: { value: 'my new post' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('my new post')).toBeInTheDocument();
    expect(screen.getByText('Personalized feed')).toBeInTheDocument();
    expect(followingAuthors().slice(-1)[0]).toEqual([
      'Viewer',
      'Alice',
      'Spammer',
    ]);
  });

  it('asks for Your posts once when You follow Yourself', async () => {
    vi.mocked(fetchQuitterFollowedNames).mockResolvedValue(['Alice', 'viewer']);
    const store = makeStore();
    renderWidget(store);
    await screen.findByText('hello from alice');

    expect(followingAuthors()[0]).toEqual(['Viewer', 'Alice']);
  });

  it('shows Your posts in Following before You follow anyone', async () => {
    vi.mocked(fetchQuitterFollowedNames).mockResolvedValue([]);
    vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
      hasMore: false,
      items: [post('Viewer', 'mine', 'my first post')],
      nextOffset: 0,
    });
    const store = makeStore();
    renderWidget(store);

    expect(await screen.findByText('my first post')).toBeInTheDocument();
    expect(followingAuthors()[0]).toEqual(['Viewer']);
  });

  it('says posting needs a name when the account has none', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: 'QViewer', name: '' });
    renderWidget(store);

    expect(
      await screen.findByText('Register a Qortal name to publish on Torq.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post to Torq' })).toBeNull();
  });

  it('reads Torq’s hidden users again on a manual refresh', async () => {
    const store = makeStore();
    const view = renderWidget(store);
    await screen.findByText('hello from alice');

    view.refresh(1);

    await waitFor(() =>
      expect(fetchTorqHiddenUsers).toHaveBeenLastCalledWith(
        'Viewer',
        expect.objectContaining({ force: true })
      )
    );
  });

  describe('refreshing an empty feed', () => {
    it('finds a first post made elsewhere at a manual refresh', async () => {
      vi.mocked(fetchQuitterFollowedNames).mockResolvedValue([]);
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
        hasMore: false,
        items: [],
        nextOffset: 0,
      });
      const view = renderWidget(makeStore());
      await screen.findByText(
        'Browse Torq and follow accounts to build your feed.'
      );

      // The account posts in Torq itself, then refreshes Home's feed.
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue({
        hasMore: false,
        items: [post('Viewer', 'elsewhere', 'posted from Torq')],
        nextOffset: 0,
      });
      view.refresh(1);

      expect(await screen.findByText('posted from Torq')).toBeInTheDocument();
      expect(followingAuthors().slice(-1)[0]).toEqual(['Viewer']);
    });
  });

  describe('checking for new posts', () => {
    // FEED_POLL_INTERVAL_MS in QuitterFeedWidget.tsx.
    const POLL_MS = 90_000;
    const waitPoll = () =>
      act(() => vi.advanceTimersByTimeAsync(POLL_MS + 1_000));

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(fetchQuitterFollowedNames).mockResolvedValue(['Alice']);
      // The accounts the reader follows haven't posted yet.
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(feedPage([]));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('checks an empty feed too, and shows the first post that comes in', async () => {
      renderWidget(makeStore());
      expect(
        await screen.findByText('No followed posts available')
      ).toBeInTheDocument();
      expect(fetchQuitterFeedPage).toHaveBeenCalledTimes(1);

      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([post('Alice', 'p1', 'first post from Alice')])
      );
      await waitPoll();

      expect(screen.getByText('first post from Alice')).toBeInTheDocument();
      // There is no list to show "1 new post" above: it is there at once.
      expect(screen.queryByText('1 new post')).toBeNull();
    });

    it('shows a first post made while Home was hidden at its next check', async () => {
      const home = renderOnHome(makeStore());
      expect(
        await screen.findByText('No followed posts available')
      ).toBeInTheDocument();

      home.leaveHome();
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([post('Alice', 'p1', 'first post from Alice')])
      );
      // Ten minutes in an app tab.
      await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
      home.backToHome();
      await waitPoll();

      expect(screen.getByText('first post from Alice')).toBeInTheDocument();
    });

    it('shows a new post when all it had are from users hidden in Torq', async () => {
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([post('Spammer', 'p2', 'buy now')])
      );
      renderWidget(makeStore());
      expect(
        await screen.findByText('No followed posts available')
      ).toBeInTheDocument();

      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([
          post('Alice', 'p1', 'first post from Alice'),
          post('Spammer', 'p2', 'buy now'),
        ])
      );
      await waitPoll();

      expect(screen.getByText('first post from Alice')).toBeInTheDocument();
      expect(screen.queryByText('buy now')).toBeNull();
    });

    it('keeps "N new posts" above a feed that shows posts', async () => {
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([post('Alice', 'p1', 'older post')])
      );
      renderWidget(makeStore());
      expect(await screen.findByText('older post')).toBeInTheDocument();

      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([
          post('Alice', 'p2', 'newer post'),
          post('Alice', 'p1', 'older post'),
        ])
      );
      await waitPoll();

      expect(screen.getByText('1 new post')).toBeInTheDocument();
      expect(screen.queryByText('newer post')).toBeNull();
    });
  });

  describe('a post that went through while Home was hidden', () => {
    it('shows at the top when Home is back', async () => {
      let answer: (value: unknown) => void = () => undefined;
      const sendMessage = vi.fn(
        () => new Promise((resolve) => (answer = resolve))
      );
      window.sendMessage = sendMessage;
      const home = renderOnHome(makeStore());
      await screen.findByText('hello from alice');
      fireEvent.click(screen.getByRole('button', { name: 'Post to Torq' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Post text' }), {
        target: { value: 'my new post' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      vi.mocked(fetchQuitterFeedPage).mockResolvedValue(
        feedPage([
          post('Viewer', 'mine', 'my new post'),
          post('Alice', 'p1', 'hello from alice'),
        ])
      );

      home.leaveHome();
      await act(async () => answer([{ signature: 'sig' }]));
      home.backToHome();

      expect(await screen.findByText('my new post')).toBeInTheDocument();
      expect(screen.getByText('Published to Torq')).toBeInTheDocument();
      expect(screen.queryByText('1 new post')).toBeNull();
    });
  });
});
