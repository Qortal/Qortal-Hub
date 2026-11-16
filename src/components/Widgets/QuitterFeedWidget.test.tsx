import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
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
});
