import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider } from 'jotai';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const show = vi.fn();
const getFee = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({
    show: (...args: unknown[]) => show(...args),
  }),
}));
vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));
vi.mock('../../../background/background', () => ({
  getFee: (...args: unknown[]) => getFee(...args),
  createEndpoint: vi.fn(async (path: string) => `http://node${path}`),
}));
vi.mock('../AppsNavBarDesktop', () => ({ saveToLocalStorage: vi.fn() }));
vi.mock('../AppViewerContainer', () => ({ default: () => null }));
vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({ refresh: vi.fn() }),
}));
vi.mock('../../Group/groupApi', () => ({
  getPrimaryNamesForAddresses: vi.fn(async (addresses: string[]) =>
    Object.fromEntries(
      addresses.map((address) => [address, `name-of-${address}`])
    )
  ),
}));
// Addresses from public keys: the key itself, so the test can tell them apart.
vi.mock('../../../utils/generateWallet/publicKeyToAddress', () => ({
  default: (bytes: Uint8Array) => `Q${Array.from(bytes).join('.')}`,
}));
vi.mock('../../../encryption/Base58', () => ({
  default: {
    decode: (key: string) => new Uint8Array([key.length, key.charCodeAt(0)]),
  },
}));
vi.mock('../../Snackbar/Snackbar', () => ({
  CustomizedSnackbars: ({ open, info }: any) =>
    open && info ? <div role="status">{info.message}</div> : null,
}));

import { AppInfo } from '../AppInfo';
import { LauncherTabContext } from '../launcherTabs';
import { userInfoAtom } from '../../../atoms/global';
import { shownAppPageAtom } from '../../../atoms/appsAtoms';
import { executeEvent } from '../../../utils/events';
import { clearAppPageCache } from './useAppPage';

const addressOf = (key: string) => `Q${key.length}.${key.charCodeAt(0)}`;
const CREATOR_KEY = 'CREATORKEY';

type Handler = (url: string, init?: RequestInit) => unknown;

/** A fetch that never answers, until the request is aborted. */
const never: Handler = (_url, init) =>
  new Promise((_resolve, reject) =>
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError'))
    )
  );

/** Core's answer for a poll it doesn't have. */
const noPoll: Handler = () =>
  new Response(
    JSON.stringify({ error: 501, message: '!!en:ApiError.POLL_NO_EXISTS!!' }),
    { status: 404 }
  );

const RATING_POLL = {
  pollName: 'app-library-APP-rating-Q-Blog',
  owner: 'QOwner',
  creatorPublicKey: CREATOR_KEY,
  pollOptions: ['1', '2', '3', '4', '5', 'initialValue-5'].map(
    (optionName) => ({ optionName })
  ),
};

const routes = (overrides: Record<string, unknown> = {}) => {
  const table: Record<string, unknown> = {
    'service=APP&name=Q-Blog': [
      {
        name: 'Q-Blog',
        service: 'APP',
        identifier: 'default',
        latestSignature: 'SIG',
        size: 4096,
        created: 1_600_000_000_000,
        updated: 1_700_000_000_000,
        status: { status: 'READY' },
        metadata: {
          title: 'Q-Blog',
          description: 'Your blog on Qortal',
          categoryName: 'Social',
          tags: ['blog'],
        },
      },
    ],
    'identifier=qhub_app_': [
      {
        name: 'Q-Blog',
        service: 'JSON',
        identifier: 'qhub_app_page_v1_APP',
        latestSignature: 'P1',
      },
      {
        name: 'Q-Blog',
        service: 'IMAGE',
        identifier: 'qhub_app_shots_v1_APP',
        latestSignature: 'S1',
      },
    ],
    '/arbitrary/resource/status/': { status: 'READY' },
    '/arbitrary/JSON/Q-Blog/qhub_app_page_v1_APP': {
      v: 1,
      about: 'A longer story about Q-Blog.',
      whatsNew: 'Comments are faster.',
      version: '2.1.0',
      links: { website: 'https://blog.example/' },
      updated: 1_700_000_000_000,
    },
    'filepath=shots.json': {
      v: 1,
      shots: [
        { file: '1.webp', caption: 'Home' },
        { file: '2.webp', caption: 'Editor' },
      ],
      updated: 5,
    },
    '/polls/votes/app-library-APP-rating-Q-Blog': {
      votes: [
        { optionIndex: 4, voterPublicKey: 'AAAA' },
        { optionIndex: 2, voterPublicKey: 'BB' },
      ],
      voteCounts: [
        { optionName: '1', voteCount: 0 },
        { optionName: '2', voteCount: 0 },
        { optionName: '3', voteCount: 1 },
        { optionName: '4', voteCount: 0 },
        { optionName: '5', voteCount: 1 },
        { optionName: 'initialValue-5', voteCount: 0 },
      ],
    },
    '/polls/app-library-APP-rating-Q-Blog': RATING_POLL,
    '/names/address/': [{ name: 'Me' }],
    ...overrides,
  };
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      // Core keeps one resource per name and service without mode=ALL.
      if (url.includes('/resources/search') && !url.includes('mode=ALL')) {
        return new Response('', { status: 404 });
      }
      const key = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((pattern) => url.includes(pattern));
      if (!key) return new Response('', { status: 404 });
      const value =
        typeof table[key] === 'function'
          ? await (table[key] as Handler)(url, init)
          : table[key];
      if (value instanceof Response) return value;
      return new Response(JSON.stringify(value));
    });
};

const publisher = () => {
  routes({ '/names/address/': [{ name: 'Other' }, { name: 'q-blog' }] });
  renderPage({ name: 'Other', address: 'QPub' });
};

const publishedJson = () =>
  (vi.mocked(window.sendMessage).mock.calls as any[])
    .filter((call) => call[0] === 'publishOnQDN' && call[1].service === 'JSON')
    .map((call) => JSON.parse(atob(call[1].data)));

const renderPage = (
  me = { name: 'Me', address: 'QMe' },
  launcherTabId: string | null = null
) => {
  const store = createStore();
  store.set(userInfoAtom, me);
  return render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <LauncherTabContext.Provider value={launcherTabId}>
            <AppInfo
              app={{ name: 'Q-Blog', service: 'APP' }}
              myName={me.name}
            />
          </LauncherTabContext.Provider>
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
};

beforeEach(() => {
  clearAppPageCache();
  vi.mocked(executeEvent).mockClear();
  getFee.mockReset().mockResolvedValue({ fee: '0.01' });
  show.mockReset().mockResolvedValue(undefined);
  window.sendMessage = vi.fn().mockResolvedValue({ signature: 'TX' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the app page', () => {
  it('tells the top bar its link while it is on screen', () => {
    const store = createStore();
    store.set(userInfoAtom, { name: 'Me', address: 'QMe' });
    const view = render(
      <Provider store={store}>
        <ThemeProvider theme={createTheme()}>
          <I18nextProvider i18n={i18n}>
            <AppInfo app={{ name: 'Q-Blog', service: 'APP' }} myName="Me" />
          </I18nextProvider>
        </ThemeProvider>
      </Provider>
    );
    expect(store.get(shownAppPageAtom)).toEqual({
      service: 'APP',
      name: 'Q-Blog',
    });
    view.unmount();
    expect(store.get(shownAppPageAtom)).toBeNull();
  });

  it('shows the listing, the page, screenshots and ratings', async () => {
    routes();
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Q-Blog' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Your blog on Qortal')).toBeInTheDocument();
    expect(
      await screen.findByText('A longer story about Q-Blog.')
    ).toBeInTheDocument();
    expect(screen.getByText('Comments are faster.')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Home' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor' })).toBeInTheDocument();
    // 3 + 5 + the creator's initial 5: 13 / 3.
    expect(await screen.findByText('4.3')).toBeInTheDocument();
    // Only the publisher gets the edit button.
    expect(
      screen.queryByRole('button', { name: 'app_page.edit.open' })
    ).toBeNull();
  });

  it('lists who voted, with their names and stars', async () => {
    routes();
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.voters.open' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(`name-of-${addressOf('AAAA')}`)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(`name-of-${addressOf('BB')}`)
    ).toBeInTheDocument();
    // The first rating is the creator's, read from the creator's key.
    expect(
      within(dialog).getByText(`name-of-${addressOf(CREATOR_KEY)}`)
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('name-of-QOwner')).toBeNull();
    expect(
      within(dialog).getByText('app_page.voters.first_rating')
    ).toBeInTheDocument();
  });

  it('counts a vote at once', async () => {
    routes();
    renderPage();
    await screen.findByText('4.3');
    const stars = screen.getAllByRole('radio');
    await act(async () => {
      fireEvent.click(stars[0]);
    });
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith(
        'voteOnPoll',
        { pollName: 'app-library-APP-rating-Q-Blog', optionIndex: 0 },
        expect.any(Number)
      )
    );
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ publishFee: '0.01 QORT' })
    );
    // (13 + 1) / 4, before the node has the vote.
    expect(await screen.findByText('3.5')).toBeInTheDocument();
    expect(screen.getByText('app_page.rating.pending')).toBeInTheDocument();
  });

  it("doesn't vote when the fee is declined", async () => {
    routes();
    show.mockRejectedValue({ isCanceled: true });
    renderPage();
    await screen.findByText('4.3');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio')[0]);
    });
    expect(window.sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('app_page.rating.pending')).toBeNull();
  });

  it('lets the publisher edit the page', async () => {
    routes({ '/names/address/': [{ name: 'Other' }, { name: 'q-blog' }] });
    renderPage({ name: 'Other', address: 'QPub' });
    expect(
      await screen.findByRole('button', { name: 'app_page.edit.open' })
    ).toBeInTheDocument();
  });

  it('works without a page, screenshots or poll yet', async () => {
    routes({
      'identifier=qhub_app_': [],
      '/polls/app-library-APP-rating-Q-Blog': noPoll,
      '/polls/votes/app-library-APP-rating-Q-Blog': noPoll,
    });
    renderPage();
    expect(await screen.findByText('Your blog on Qortal')).toBeInTheDocument();
    // Loaded: the About's placeholder lines are gone.
    await waitFor(() =>
      expect(document.querySelector('.MuiSkeleton-root')).toBeNull()
    );
    expect(
      screen.queryByRole('heading', { name: 'app_page.screenshots.title' })
    ).toBeNull();
    expect(screen.getByText('app_page.rating.rate_prompt')).toBeInTheDocument();
  });

  it('opens the app in the place of the launcher tab it shows in', async () => {
    routes();
    renderPage(undefined, 'launcher-tab-2');
    const open = await screen.findByRole('button', { name: 'action.open' });
    fireEvent.click(open);
    const [, payload] = vi
      .mocked(executeEvent)
      .mock.calls.find(([name]) => name === 'addTab') as any;
    expect(payload.data).toMatchObject({
      name: 'Q-Blog',
      service: 'APP',
      fromLauncherTabId: 'launcher-tab-2',
    });
  });
});

describe('editing the page', () => {
  it('keeps Edit off until the page has loaded', async () => {
    routes({
      '/names/address/': [{ name: 'Other' }, { name: 'q-blog' }],
      '/arbitrary/resource/status/JSON/': never,
    });
    renderPage({ name: 'Other', address: 'QPub' });
    const edit = await screen.findByRole('button', {
      name: 'app_page.edit.open',
    });
    expect(edit).toBeDisabled();
  });

  it('keeps Add screenshots off too until the page text has loaded, then publishes the page whole', async () => {
    // The page text answers late; the screenshots load at once.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    routes({
      '/names/address/': [{ name: 'Other' }, { name: 'q-blog' }],
      '/arbitrary/resource/status/JSON/': async () => {
        await gate;
        return { status: 'READY' };
      },
    });
    renderPage({ name: 'Other', address: 'QPub' });
    const add = await screen.findByRole('button', {
      name: 'app_page.screenshots.add',
    });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.click(
      await screen.findByRole('tab', { name: 'app_page.edit.tab_page' })
    );
    const about = await screen.findByLabelText('app_page.edit.about');
    expect(about).toHaveValue('A longer story about Q-Blog.');
    fireEvent.change(about, { target: { value: 'A new story' } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    await waitFor(() => expect(publishedJson()).toHaveLength(1));
    // Only About changed: the version, What's new and links stay as they were.
    expect(publishedJson()[0]).toMatchObject({
      about: 'A new story',
      version: '2.1.0',
      whatsNew: 'Comments are faster.',
      links: { website: 'https://blog.example/' },
    });
  });

  it("won't edit a page text the node lists but can't read", async () => {
    routes({
      '/names/address/': [{ name: 'Other' }, { name: 'q-blog' }],
      '/arbitrary/JSON/Q-Blog/qhub_app_page_v1_APP': new Response('', {
        status: 404,
      }),
    });
    renderPage({ name: 'Other', address: 'QPub' });
    const edit = await screen.findByRole('button', {
      name: 'app_page.edit.open',
    });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    expect(
      await screen.findByText('app_page.edit.page_unreadable')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('app_page.edit.about')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'app_page.edit.publish' })
    ).toBeDisabled();
  });

  it('starts a second edit from the first one, not from the old copy', async () => {
    publisher();
    const edit = await screen.findByRole('button', {
      name: 'app_page.edit.open',
    });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    fireEvent.change(await screen.findByLabelText('app_page.edit.about'), {
      target: { value: 'A brand new story' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('A brand new story')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'app_page.edit.open' }));
    expect(await screen.findByLabelText('app_page.edit.about')).toHaveValue(
      'A brand new story'
    );
    fireEvent.change(screen.getByLabelText('app_page.links.source'), {
      target: { value: 'https://code.example/q-blog' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    await waitFor(() => expect(publishedJson()).toHaveLength(2));
    expect(publishedJson()[1]).toMatchObject({
      about: 'A brand new story',
      links: {
        website: 'https://blog.example/',
        source: 'https://code.example/q-blog',
      },
    });
    // The first save's text still shows after the second save.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('A brand new story')).toBeInTheDocument();
  });

  it("opens the app without the search cache's 'default' identifier", async () => {
    routes();
    renderPage();
    const open = await screen.findByRole('button', { name: 'action.open' });
    fireEvent.click(open);
    const [, payload] = vi
      .mocked(executeEvent)
      .mock.calls.find(([name]) => name === 'addTab') as any;
    expect(payload.data).toMatchObject({ name: 'Q-Blog', service: 'APP' });
    expect(payload.data.identifier).toBeUndefined();
  });
});

describe('ratings on the page', () => {
  it('opens the voters list at the star clicked, every time', async () => {
    routes();
    renderPage();
    await screen.findByText('4.3');
    const fiveStars = () =>
      screen.getAllByRole('button', { name: 'app_page.voters.show_star' })[0];
    await waitFor(() => expect(fiveStars()).toBeEnabled());
    fireEvent.click(fiveStars());
    let dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(`name-of-${addressOf('AAAA')}`);
    expect(within(dialog).queryByText(`name-of-${addressOf('BB')}`)).toBeNull();

    fireEvent.click(within(dialog).getByText('app_page.voters.all'));
    expect(
      within(dialog).getByText(`name-of-${addressOf('BB')}`)
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'action.close' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(fiveStars());
    dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(`name-of-${addressOf('AAAA')}`);
    expect(within(dialog).queryByText(`name-of-${addressOf('BB')}`)).toBeNull();
  });

  it("doesn't create the poll twice while the first rating is on its way", async () => {
    routes({
      '/polls/app-library-APP-rating-Q-Blog': noPoll,
      '/polls/votes/app-library-APP-rating-Q-Blog': noPoll,
    });
    renderPage();
    const stars = await screen.findAllByRole('radio');
    await waitFor(() => expect(stars[3]).toBeEnabled());
    await act(async () => {
      fireEvent.click(stars[3]);
    });
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith(
        'createPoll',
        expect.objectContaining({
          pollOptions: ['1, 2, 3, 4, 5, initialValue-4'],
        }),
        expect.any(Number)
      )
    );
    expect(
      await screen.findByText('app_page.rating.pending_first')
    ).toBeInTheDocument();
    expect(screen.getAllByRole('radio')[4]).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio')[4]);
    });
    const createPolls = vi
      .mocked(window.sendMessage)
      .mock.calls.filter(([action]) => action === 'createPoll');
    expect(createPolls).toHaveLength(1);
  });

  it("keeps the stars off until it knows whether there's a poll", async () => {
    routes({ '/polls/app-library-APP-rating-Q-Blog': never });
    renderPage();
    const stars = await screen.findAllByRole('radio');
    stars.forEach((star) => expect(star).toBeDisabled());
    await act(async () => {
      fireEvent.click(stars[3]);
    });
    expect(window.sendMessage).not.toHaveBeenCalled();
  });

  it("says when the poll couldn't be read, and votes in it after Retry", async () => {
    let poll: Handler = () => new Response('', { status: 500 });
    routes({
      '/polls/app-library-APP-rating-Q-Blog': (
        url: string,
        init?: RequestInit
      ) => poll(url, init),
    });
    renderPage();
    const alert = await screen.findByText('app_page.rating.load_failed');
    expect(alert).toHaveAttribute('role', 'alert');
    screen.getAllByRole('radio').forEach((star) => expect(star).toBeDisabled());
    // Not read isn't missing: nothing offers to create the poll.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio')[3]);
    });
    expect(window.sendMessage).not.toHaveBeenCalled();

    poll = () => RATING_POLL;
    fireEvent.click(within(alert).getByRole('button', { name: 'retry' }));
    await screen.findByText('4.3');
    await waitFor(() => expect(screen.getAllByRole('radio')[0]).toBeEnabled());
    expect(screen.queryByText('app_page.rating.load_failed')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio')[0]);
    });
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith(
        'voteOnPoll',
        { pollName: 'app-library-APP-rating-Q-Blog', optionIndex: 0 },
        expect.any(Number)
      )
    );
    expect(
      vi
        .mocked(window.sendMessage)
        .mock.calls.filter(([action]) => action === 'createPoll')
    ).toHaveLength(0);
  });

  it('counts a creator who rated again as the library does', async () => {
    routes({
      '/polls/votes/app-library-APP-rating-Q-Blog': {
        votes: [
          { optionIndex: 0, voterPublicKey: CREATOR_KEY },
          { optionIndex: 2, voterPublicKey: 'BB' },
        ],
        voteCounts: [
          { optionName: '1', voteCount: 1 },
          { optionName: '2', voteCount: 0 },
          { optionName: '3', voteCount: 1 },
          { optionName: '4', voteCount: 0 },
          { optionName: '5', voteCount: 0 },
          { optionName: 'initialValue-5', voteCount: 0 },
        ],
      },
    });
    renderPage();
    // The creator's first 5, their later 1, and a 3: 3.0 from 3, as the
    // library's card counts the same poll.
    expect(await screen.findByText('3.0')).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.voters.open' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findAllByText(`name-of-${addressOf(CREATOR_KEY)}`)
    ).toHaveLength(2);
    expect(
      within(dialog).getByText('app_page.voters.first_rating')
    ).toBeInTheDocument();
  });

  it("says so when a vote's fee cannot be looked up", async () => {
    routes();
    renderPage();
    await screen.findByText('4.3');
    getFee.mockRejectedValue(new Error('Node unreachable'));
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio')[0]);
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Node unreachable'
    );
    expect(show).not.toHaveBeenCalled();
  });
});

describe('across page widths', () => {
  // jsdom lays nothing out: the page's width and its observer are faked.
  let width = 1200;
  const observers: (() => void)[] = [];
  const realResizeObserver = globalThis.ResizeObserver;
  beforeEach(() => {
    width = 1200;
    observers.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => width,
    });
    globalThis.ResizeObserver = class {
      constructor(private callback: () => void) {}
      observe() {
        observers.push(this.callback);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    delete (HTMLElement.prototype as any).clientWidth;
    globalThis.ResizeObserver = realResizeObserver;
  });
  const resize = (next: number) =>
    act(() => {
      width = next;
      observers.forEach((callback) => callback());
    });
  const aboutCard = () =>
    document.querySelector('[aria-labelledby="app-page-about"]')!;
  /** Two columns put the ratings in a column of their own, beside the about. */
  const ratingsBesideAbout = () =>
    document.getElementById('app-page-ratings-card')!.parentElement !==
    aboutCard().parentElement;

  it('keeps the about card as it was when the page gets narrower or wider', async () => {
    routes();
    renderPage();
    await screen.findByText('A longer story about Q-Blog.');
    const about = aboutCard();
    expect(ratingsBesideAbout()).toBe(true);

    // One column, then two again.
    resize(800);
    expect(ratingsBesideAbout()).toBe(false);
    expect(aboutCard()).toBe(about);
    resize(1200);
    expect(ratingsBesideAbout()).toBe(true);
    expect(aboutCard()).toBe(about);
  });

  it('keeps its layout while it measures 0 wide (hidden or collapsed)', async () => {
    routes();
    renderPage();
    await screen.findByText('A longer story about Q-Blog.');
    expect(ratingsBesideAbout()).toBe(true);

    resize(0);
    expect(ratingsBesideAbout()).toBe(true);
    resize(1200);
    expect(ratingsBesideAbout()).toBe(true);
  });
});
