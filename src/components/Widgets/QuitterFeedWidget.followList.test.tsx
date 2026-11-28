import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { fetchTorqHiddenUsers } from './quitter/torqFeed';
import { QuitterFeedWidget } from './QuitterFeedWidget';

// The real feed API runs, with its 5-minute cache of follow lists; only the
// node is faked, through fetch.
vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
}));

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

vi.mock('./quitter/torqFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./quitter/torqFeed')>()),
  fetchTorqHiddenUsers: vi.fn(),
}));

// tiptap needs a real browser; a textarea stands in for the Torq editor.
vi.mock('./quitter/TorqTextEditor', () => ({
  TorqTextEditor: () => <textarea aria-label="Post text" />,
}));

const FOLLOW_PREFIX = 'gY.TWOeB25Co.7';
const POST_PREFIX = 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-';
const NO_FOLLOWS = 'Browse Torq and follow accounts to build your feed.';
const FEED_FAILED =
  'The personalized Torq feed is temporarily unavailable. Please try again.';

/**
 * A node where `reader` follows Alice, who has one post. While `down` is set,
 * the read of the follow data (POST /arbitrary/resources/onchain/data) gets
 * Core's answer for a repository problem: HTTP 500 with a JSON error body.
 */
const mockNode = (reader: string) => {
  const node = { down: true };
  const fetchMock = vi.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        if (node.down) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 5, message: 'repository issue' }),
          };
        }
        const asked = JSON.parse(init.body as string) as {
          identifier: string;
        }[];
        return {
          ok: true,
          status: 200,
          json: async () =>
            asked.map(({ identifier }) => ({
              identifier,
              data: btoa(JSON.stringify({ followedName: 'Alice' })),
            })),
        };
      }
      if (url.includes('/arbitrary/DOCUMENT/')) {
        const body = JSON.stringify({
          name: 'Alice',
          text: 'hello from Alice',
          timestamp: 1_700_000_000_000,
        });
        return { ok: true, status: 200, text: async () => body };
      }
      const identifier = new URL(url).searchParams.get('identifier');
      const results =
        identifier === FOLLOW_PREFIX
          ? [
              {
                created: 1_700_000_000_000,
                identifier: `${FOLLOW_PREFIX}alice`,
                latestSignature: 'follow-sig',
                name: reader,
                service: 'DOCUMENT',
                size: 96,
              },
            ]
          : identifier === POST_PREFIX
            ? [
                {
                  created: 1_700_000_000_000,
                  identifier: `${POST_PREFIX}post1`,
                  latestSignature: 'post-sig',
                  name: 'Alice',
                  service: 'DOCUMENT',
                  size: 500,
                },
              ]
            : [];
      return { ok: true, status: 200, json: async () => results };
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  const followDataReads = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length;
  return { node, followDataReads };
};

const renderWidget = (reader: string) => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QReader', name: reader });
  const ui = (token: number) => (
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <QuitterFeedWidget refreshToken={token} />
      </ThemeProvider>
    </Provider>
  );
  const view = render(ui(0));
  // Home's refresh button for the Torq Feed window raises refreshToken.
  return { refresh: (token: number) => view.rerender(ui(token)) };
};

describe('Torq Following feed when the node refuses the follow list', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchTorqHiddenUsers).mockReset();
    vi.mocked(fetchTorqHiddenUsers).mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says the feed failed, with Try Again, not that the reader follows nobody', async () => {
    mockNode('Reader One');
    renderWidget('Reader One');

    expect(await screen.findByText(FEED_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(NO_FOLLOWS)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Try Again' })
    ).toBeInTheDocument();
  });

  it('shows the followed posts at Try Again once the node answers again', async () => {
    const { node, followDataReads } = mockNode('Reader Two');
    renderWidget('Reader Two');
    await screen.findByText(FEED_FAILED);

    node.down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(await screen.findByText('hello from Alice')).toBeInTheDocument();
    expect(followDataReads()).toBe(2);
  });

  it('shows them at a refresh of the window too', async () => {
    const { node, followDataReads } = mockNode('Reader Three');
    const view = renderWidget('Reader Three');
    await screen.findByText(FEED_FAILED);

    node.down = false;
    view.refresh(1);

    expect(await screen.findByText('hello from Alice')).toBeInTheDocument();
    expect(followDataReads()).toBe(2);
  });
});
