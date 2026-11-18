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
// The fee shows as text only with its string there.
i18n.addResource('en', 'core', 'message.generic.fee_qort', 'fee: {{fee}} QORT');

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
  getPrimaryNamesForAddresses: vi.fn(async () => ({})),
}));
vi.mock('../../Snackbar/Snackbar', () => ({
  CustomizedSnackbars: ({ open, info }: any) =>
    open && info ? <div role="status">{info.message}</div> : null,
}));

import { AppInfo } from '../AppInfo';
import { LauncherTabContext, LauncherTabShownContext } from '../launcherTabs';
import { userInfoAtom } from '../../../atoms/global';
import { clearAppPageCache } from './useAppPage';
import { clearReviewRecordCache } from './useAppReviews';
import { HideAppDialog } from './HideAppDialog';

type Handler = (url: string, init?: RequestInit) => unknown;

/** What the node lists for the page: its text and its screenshots. */
const PAGE_PARTS = [
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
];

/** The same, with the record of an app hidden and replaced earlier. */
const HIDDEN_PARTS = [
  ...PAGE_PARTS,
  {
    name: 'Q-Blog',
    service: 'JSON',
    identifier: 'qhub_app_hidden_v1_APP',
    latestSignature: 'H1',
    updated: 1_700_000_100_000,
    metadata: { title: 'hidden' },
  },
];

const routes = (overrides: Record<string, unknown> = {}) => {
  const table: Record<string, unknown> = {
    'service=APP&name=Q-Blog': [
      {
        name: 'Q-Blog',
        service: 'APP',
        identifier: 'default',
        latestSignature: 'SIG',
        status: { status: 'READY' },
        metadata: { title: 'Q-Blog', description: 'Your blog on Qortal' },
      },
    ],
    'identifier=qhub_app_': PAGE_PARTS,
    '/arbitrary/resource/status/': { status: 'READY' },
    '/arbitrary/JSON/Q-Blog/qhub_app_page_v1_APP': {
      v: 1,
      about: 'A longer story about Q-Blog.',
      whatsNew: '',
      version: '2.1.0',
      links: {},
      updated: 1_700_000_000_000,
    },
    '/arbitrary/JSON/Q-Blog/qhub_app_hidden_v1_APP': {
      v: 1,
      app: { service: 'APP', name: 'Q-Blog' },
      hidden: true,
      replaced: true,
      updated: 1_700_000_100_000,
    },
    'filepath=shots.json': {
      v: 1,
      shots: [{ file: '1.webp', caption: 'Home' }],
      updated: 5,
    },
    '/names/address/': [{ name: 'q-blog' }],
    ...overrides,
  };
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
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

const wrap = (children: React.ReactNode) => {
  const store = createStore();
  store.set(userInfoAtom, { name: 'q-blog', address: 'QPub' });
  return render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <LauncherTabContext.Provider value={null}>
            {children}
          </LauncherTabContext.Provider>
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
};

/** The page, opened by the app's publisher. */
const renderPage = () =>
  wrap(<AppInfo app={{ name: 'Q-Blog', service: 'APP' }} myName="q-blog" />);

const publishes = () =>
  (vi.mocked(window.sendMessage).mock.calls as any[])
    .filter((call) => call[0] === 'publishOnQDN')
    .map((call) => call[1]);

/** Presses the hide window's action once its fee is known. */
const press = async (dialog: HTMLElement, name: string) => {
  const action = within(dialog).getByRole('button', { name });
  await waitFor(() => expect(action).toBeEnabled());
  fireEvent.click(action);
};

const hideButton = async () => {
  const button = await screen.findByRole('button', {
    name: 'app_page.hide.button_hide',
  });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

/** Lets any publish that a click started go through. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

beforeEach(() => {
  clearAppPageCache();
  clearReviewRecordCache();
  getFee.mockReset().mockResolvedValue({ fee: '0.01' });
  show.mockReset().mockResolvedValue(undefined);
  window.sendMessage = vi.fn().mockResolvedValue({ signature: 'TX' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('hiding before the node has said what the page has', () => {
  it('keeps the hide button off while that loads, then replaces every part', async () => {
    let answer: (value: unknown) => void = () => undefined;
    routes({
      'identifier=qhub_app_': () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    // Not known yet: its page text and screenshots, or whether it is hidden.
    expect(button).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();

    answer(PAGE_PARTS);
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(4));
    // The app, its page text, its screenshots, then the record.
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'IMAGE',
      'JSON',
    ]);
  });

  it("offers Retry when the node couldn't say, and no Hide for an app hidden already", async () => {
    let down = true;
    routes({
      'identifier=qhub_app_': () =>
        down ? new Response('', { status: 500 }) : HIDDEN_PARTS,
    });
    renderPage();
    const failed = await screen.findByText('app_page.hide.load_failed');
    // A failed lookup isn't "not hidden": nothing to publish from here.
    expect(
      screen.getByRole('button', { name: 'app_page.hide.button_hide' })
    ).toBeDisabled();

    down = false;
    fireEvent.click(
      within(failed.closest('[role="alert"]') as HTMLElement).getByRole(
        'button',
        { name: 'retry' }
      )
    );
    // It was hidden and replaced all along.
    expect(
      await screen.findByRole('button', { name: 'app_page.hide.button_show' })
    ).toBeEnabled();
    expect(
      await screen.findByText('app_page.hide.note_publisher_replaced')
    ).toBeInTheDocument();
    expect(screen.queryByText('app_page.hide.load_failed')).toBeNull();
    expect(publishes()).toHaveLength(0);
  });

  it("doesn't publish from a window left open once that is no longer known", async () => {
    wrap(
      <HideAppDialog
        app={{ name: 'Q-Blog', service: 'APP' }}
        hasPage={false}
        hasShots={false}
        onClose={() => undefined}
        onHidden={() => undefined}
        open
        ready={false}
      />
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'app_page.hide.action' })
    ).toBeDisabled();
  });
});

describe('after hiding', () => {
  it('still says so when the page is opened again before the node lists the record', async () => {
    routes();
    const view = renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    await press(dialog, 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(1));
    await screen.findByText('app_page.hide.note_publisher_hidden');

    // Back to the library and into the page again: the record isn't in a
    // block yet, so the node still lists none.
    view.unmount();
    renderPage();
    expect(
      await screen.findByText('app_page.hide.note_publisher_hidden')
    ).toBeInTheDocument();
    const again = await screen.findByRole('button', {
      name: 'app_page.hide.button_show',
    });
    await waitFor(() => expect(again).toBeEnabled());
    // Not offered a second time, for a second fee.
    expect(
      screen.queryByRole('button', { name: 'app_page.hide.button_hide' })
    ).toBeNull();
  });

  it("doesn't offer to show it a second time on a page opened again right after showing it", async () => {
    routes({ 'identifier=qhub_app_': HIDDEN_PARTS });
    const view = renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.hide.button_show' })
    );
    await waitFor(() => expect(publishes()).toHaveLength(1));
    expect(publishes()[0].title).toBe('shown');
    await screen.findByRole('button', { name: 'app_page.hide.button_hide' });

    // The node still lists the old record, titled hidden.
    view.unmount();
    renderPage();
    const again = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(again).toBeEnabled());
    expect(
      screen.queryByRole('button', { name: 'app_page.hide.button_show' })
    ).toBeNull();
    expect(
      screen.queryByText('app_page.hide.note_publisher_replaced')
    ).toBeNull();
  });

  it('goes by the node again once it lists a newer record', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let listed: unknown[] = PAGE_PARTS;
    let record: unknown = new Response('', { status: 404 });
    routes({
      'identifier=qhub_app_': () => listed,
      '/arbitrary/JSON/Q-Blog/qhub_app_hidden_v1_APP': () => record,
    });
    const view = renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await press(await screen.findByRole('dialog'), 'app_page.hide.action');
    await screen.findByText('app_page.hide.note_publisher_hidden');
    view.unmount();

    // Five minutes on, it was shown again from another device.
    vi.setSystemTime(Date.now() + 5 * 60_000);
    const updated = Date.now();
    listed = [
      ...PAGE_PARTS,
      {
        name: 'Q-Blog',
        service: 'JSON',
        identifier: 'qhub_app_hidden_v1_APP',
        latestSignature: 'H2',
        updated,
        metadata: { title: 'shown' },
      },
    ];
    record = {
      v: 1,
      app: { service: 'APP', name: 'Q-Blog' },
      hidden: false,
      replaced: false,
      updated,
    };
    renderPage();
    const again = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(again).toBeEnabled());
    expect(
      screen.queryByText('app_page.hide.note_publisher_hidden')
    ).toBeNull();
  });
});

describe('the hide window in a launcher tab', () => {
  it('steps aside while its tab is hidden, keeping what was ticked', async () => {
    const onClose = vi.fn();
    const dialogIn = (isTabShown: boolean) => (
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <LauncherTabShownContext.Provider value={isTabShown}>
            <HideAppDialog
              app={{ name: 'Q-Blog', service: 'APP' }}
              hasPage
              hasShots
              onClose={onClose}
              onHidden={() => undefined}
              open
            />
          </LauncherTabShownContext.Provider>
        </I18nextProvider>
      </ThemeProvider>
    );
    const view = render(dialogIn(true));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('checkbox')
    );

    // Another tab comes to the front.
    view.rerender(dialogIn(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    view.rerender(dialogIn(true));
    expect(
      within(await screen.findByRole('dialog')).getByRole('checkbox')
    ).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a hide and replace that failed halfway', () => {
  it('goes on from where it stopped after its window was closed and opened again', async () => {
    routes();
    window.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ signature: 'APP' })
      .mockResolvedValueOnce({ error: 'The node is busy.' })
      .mockResolvedValue({ signature: 'TX' });
    renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    expect(await within(dialog).findByText('The node is busy.')).toBeVisible();

    // Closed, to try again later.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'action.cancel' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(button);
    const again = await screen.findByRole('dialog');
    // The app is replaced already: that can't be left out of the record now.
    expect(within(again).getByRole('checkbox')).toBeChecked();
    expect(within(again).getByRole('checkbox')).toBeDisabled();
    await press(again, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(5));
    // The app went once; the page text again, then the rest.
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'JSON',
      'IMAGE',
      'JSON',
    ]);
    expect(JSON.parse(atob(publishes()[4].data))).toMatchObject({
      hidden: true,
      replaced: true,
    });
  });

  it('goes on from where it stopped on a page opened again', async () => {
    routes();
    window.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ signature: 'APP' })
      .mockResolvedValueOnce({ error: 'The node is busy.' })
      .mockResolvedValue({ signature: 'TX' });
    const view = renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    expect(await within(dialog).findByText('The node is busy.')).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'action.cancel' })
    );

    // Back to the library, and into the page again later.
    view.unmount();
    renderPage();
    const reopened = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(reopened).toBeEnabled());
    fireEvent.click(reopened);
    const again = await screen.findByRole('dialog');
    // The app is replaced already, whichever page asks.
    expect(within(again).getByRole('checkbox')).toBeChecked();
    expect(within(again).getByRole('checkbox')).toBeDisabled();
    await press(again, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(5));
    // The app isn't paid for a second time.
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'JSON',
      'IMAGE',
      'JSON',
    ]);
    expect(JSON.parse(atob(publishes()[4].data))).toMatchObject({
      hidden: true,
      replaced: true,
    });
  });

  /** Hide and replace, the page text fails after the app, the page closed. */
  const stopAfterTheApp = async () => {
    routes();
    window.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ signature: 'APP' })
      .mockResolvedValueOnce({ error: 'The node is busy.' })
      .mockResolvedValue({ signature: 'TX' });
    const view = renderPage();
    fireEvent.click(await hideButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    expect(await within(dialog).findByText('The node is busy.')).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'action.cancel' })
    );
    view.unmount();
  };

  /** The node lists the app at the version given. */
  const listedAt = (signature: string) => ({
    'service=APP&name=Q-Blog': [
      {
        name: 'Q-Blog',
        service: 'APP',
        identifier: 'default',
        latestSignature: signature,
        status: { status: 'READY' },
        metadata: { title: 'Q-Blog', description: 'Your blog on Qortal' },
      },
    ],
  });

  it('starts afresh once the app has been published again since', async () => {
    await stopAfterTheApp();
    // The publisher put the real app back: the node lists a version that is
    // neither the one before nor the replacement.
    routes(listedAt('SIG-REPUBLISHED'));
    renderPage();
    fireEvent.click(await hideButton());
    const again = await screen.findByRole('dialog');
    expect(within(again).getByRole('checkbox')).not.toBeChecked();
    expect(within(again).getByRole('checkbox')).toBeEnabled();
    await press(again, 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(3));
    // Only the record, saying the app isn't replaced.
    expect(publishes()[2]).toMatchObject({ service: 'JSON', title: 'hidden' });
    expect(JSON.parse(atob(publishes()[2].data))).toMatchObject({
      hidden: true,
      replaced: false,
    });
  });

  it('goes on from where it stopped once the node lists the replacement', async () => {
    await stopAfterTheApp();
    routes(listedAt('APP'));
    renderPage();
    fireEvent.click(await hideButton());
    const again = await screen.findByRole('dialog');
    expect(within(again).getByRole('checkbox')).toBeChecked();
    expect(within(again).getByRole('checkbox')).toBeDisabled();
  });

  it('starts afresh after a hide that went through', async () => {
    routes();
    renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_hide',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await press(await screen.findByRole('dialog'), 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(1));
    // Shown again, then hidden once more: the record is published anew.
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.hide.button_show' })
    );
    await waitFor(() => expect(publishes()).toHaveLength(2));
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.hide.button_hide' })
    );
    const again = await screen.findByRole('dialog');
    expect(within(again).getByRole('checkbox')).not.toBeChecked();
    await press(again, 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(3));
    expect(publishes().map((call) => call.title)).toEqual([
      'hidden',
      'shown',
      'hidden',
    ]);
  });
});

describe('the fee of hiding', () => {
  it('is said to have failed, with Retry, and nothing is published until it is known', async () => {
    getFee
      .mockReset()
      .mockRejectedValueOnce(new Error('Node unreachable'))
      .mockResolvedValue({ fee: '0.01' });
    routes();
    renderPage();
    fireEvent.click(await hideButton());
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Node unreachable')
    ).toBeInTheDocument();
    const action = within(dialog).getByRole('button', {
      name: 'app_page.hide.action',
    });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    await settle();
    expect(publishes()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'retry' }));
    expect(
      await within(dialog).findByText('fee: 0.01 QORT')
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Node unreachable')).toBeNull();
    await press(dialog, 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(1));
  });

  it('counts as not known when the node answers without one', async () => {
    // What getFee gives for an error answer from the node.
    getFee.mockReset().mockResolvedValue({ fee: 'NaN' });
    routes();
    renderPage();
    fireEvent.click(await hideButton());
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('message.error.generic')
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'app_page.hide.action' })
    );
    await settle();
    expect(publishes()).toHaveLength(0);
  });
});

describe('the page that takes the app’s place', () => {
  /** The app as the node lists it, with a title of its own and a category. */
  const LISTING = [
    {
      name: 'Q-Blog',
      service: 'APP',
      identifier: 'default',
      latestSignature: 'SIG',
      status: { status: 'READY' },
      metadata: {
        title: 'Q-Blog Writer',
        description: 'Your blog on Qortal',
        category: 'SOCIAL',
        categoryName: 'Social',
      },
    },
  ];

  const hideAndReplace = async () => {
    fireEvent.click(await hideButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(4));
  };

  it('keeps the app’s title and category when the page was opened before its listing loaded', async () => {
    let answerListing: (value: unknown) => void = () => undefined;
    routes({
      'service=APP&name=Q-Blog': () =>
        new Promise((resolve) => {
          answerListing = resolve;
        }),
    });
    renderPage();
    // The page text is in; the app's listing is not yet.
    await screen.findByText('A longer story about Q-Blog.');
    expect(
      screen.getByRole('button', { name: 'app_page.hide.button_hide' })
    ).toBeDisabled();

    await act(async () => {
      answerListing(LISTING);
    });
    await screen.findByRole('heading', { level: 1, name: 'Q-Blog Writer' });
    await hideAndReplace();
    expect(publishes()[0]).toMatchObject({
      service: 'APP',
      title: 'Q-Blog Writer',
      category: 'SOCIAL',
    });
  });

  it('keeps them when the app’s listing couldn’t be loaded at first', async () => {
    let listingDown = true;
    routes({
      'service=APP&name=Q-Blog': () =>
        listingDown ? new Response('', { status: 500 }) : LISTING,
    });
    renderPage();
    // The page knows only the name it was opened with: no hiding from here.
    const failed = await screen.findByText('app_page.hide.load_failed');
    expect(
      screen.getByRole('button', { name: 'app_page.hide.button_hide' })
    ).toBeDisabled();

    listingDown = false;
    fireEvent.click(
      within(failed.closest('[role="alert"]') as HTMLElement).getByRole(
        'button',
        { name: 'retry' }
      )
    );
    await screen.findByRole('heading', { level: 1, name: 'Q-Blog Writer' });
    expect(screen.queryByText('app_page.hide.load_failed')).toBeNull();
    await hideAndReplace();
    expect(publishes()[0]).toMatchObject({
      service: 'APP',
      title: 'Q-Blog Writer',
      category: 'SOCIAL',
    });
  });

  it('keeps them when the same page is shown again, as from a link to it', async () => {
    routes({ 'service=APP&name=Q-Blog': LISTING });
    const store = createStore();
    store.set(userInfoAtom, { name: 'q-blog', address: 'QPub' });
    const page = () => (
      <Provider store={store}>
        <ThemeProvider theme={createTheme()}>
          <I18nextProvider i18n={i18n}>
            <LauncherTabContext.Provider value={null}>
              <AppInfo
                app={{ name: 'Q-Blog', service: 'APP' }}
                myName="q-blog"
              />
            </LauncherTabContext.Provider>
          </I18nextProvider>
        </ThemeProvider>
      </Provider>
    );
    const view = render(page());
    await hideButton();
    await screen.findByRole('heading', { level: 1, name: 'Q-Blog Writer' });

    // The tab shows the same page again, from a link: only its name.
    view.rerender(page());
    await screen.findByRole('heading', { level: 1, name: 'Q-Blog Writer' });
    await hideAndReplace();
    expect(publishes()[0]).toMatchObject({
      service: 'APP',
      title: 'Q-Blog Writer',
      category: 'SOCIAL',
    });
  });
});
