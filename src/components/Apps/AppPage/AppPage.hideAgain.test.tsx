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

type Handler = (url: string, init?: RequestInit) => unknown;

const PAGE_TEXT = {
  name: 'Q-Blog',
  service: 'JSON',
  identifier: 'qhub_app_page_v1_APP',
  latestSignature: 'P1',
};
const SHOTS = {
  name: 'Q-Blog',
  service: 'IMAGE',
  identifier: 'qhub_app_shots_v1_APP',
  latestSignature: 'S1',
};

/** What the node lists for the page: its text and its screenshots. */
const PAGE_PARTS = [PAGE_TEXT, SHOTS];

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

const routes = (overrides: Record<string, unknown> = {}) => {
  const table: Record<string, unknown> = {
    'service=APP&name=Q-Blog': LISTING,
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

const providers = (
  store: ReturnType<typeof createStore>,
  children: React.ReactNode
) => (
  <Provider store={store}>
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </ThemeProvider>
  </Provider>
);

const newStore = () => {
  const store = createStore();
  store.set(userInfoAtom, { name: 'q-blog', address: 'QPub' });
  return store;
};

/** The page, opened by the app's publisher (as from a page link). */
const renderPage = () =>
  render(
    providers(
      newStore(),
      <LauncherTabContext.Provider value={null}>
        <AppInfo app={{ name: 'Q-Blog', service: 'APP' }} myName="q-blog" />
      </LauncherTabContext.Provider>
    )
  );

const publishes = () =>
  (vi.mocked(window.sendMessage).mock.calls as any[])
    .filter((call) => call[0] === 'publishOnQDN')
    .map((call) => call[1]);

const hideButton = async (scope: ReturnType<typeof within> = screen) => {
  const button = await scope.findByRole('button', {
    name: 'app_page.hide.button_hide',
  });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

/** Presses the hide window's action once its fee is known. */
const press = async (dialog: HTMLElement, name: string) => {
  const action = within(dialog).getByRole('button', { name });
  await waitFor(() => expect(action).toBeEnabled());
  fireEvent.click(action);
};

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

describe('hiding again after showing', () => {
  it('pays only for the parts the app has', async () => {
    // An app without page text or screenshots.
    routes({ 'identifier=qhub_app_': [] });
    renderPage();
    fireEvent.click(await hideButton());
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await within(dialog).findByText('fee: 0.02 QORT');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'app_page.hide.action_replace',
      })
    );
    await waitFor(() => expect(publishes()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Shown in the library again, then hidden and replaced once more.
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.hide.button_show' })
    );
    await waitFor(() => expect(publishes()).toHaveLength(3));
    fireEvent.click(await hideButton());
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await within(dialog).findByText(/^fee: /);
    expect(within(dialog).getByText(/^fee: /)).toHaveTextContent(
      'fee: 0.02 QORT'
    );
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'app_page.hide.action_replace',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Still no page text or screenshots to empty: nothing new is created.
    expect(
      publishes()
        .slice(3)
        .map((call) => `${call.service}/${call.identifier ?? ''}`)
    ).toEqual(['APP/', 'JSON/qhub_app_hidden_v1_APP']);
  });

  it("doesn't publish screenshots for an app that never had any", async () => {
    // Page text, but no screenshots.
    routes({ 'identifier=qhub_app_': [PAGE_TEXT] });
    renderPage();
    fireEvent.click(await hideButton());
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(3));
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'JSON',
    ]);

    // Shown again, then hidden and replaced once more.
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.hide.button_show' })
    );
    await waitFor(() => expect(publishes()).toHaveLength(4));
    fireEvent.click(await hideButton());
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await press(dialog, 'app_page.hide.action_replace');
    await waitFor(() =>
      expect(publishes()[publishes().length - 1]?.title).toBe('hidden')
    );
    // The page text is emptied again, as the node still lists it; still no
    // screenshots resource: none ever existed.
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'JSON',
      'JSON',
      'APP',
      'JSON',
      'JSON',
    ]);
  });
});

describe('the same page in two launcher tabs', () => {
  it('doesn’t offer to hide it again in the other tab once it is hidden', async () => {
    routes();
    const store = newStore();
    // Each tab keeps the app it shows, as launcher tab state does.
    const app = { name: 'Q-Blog', service: 'APP' };
    const tabs = (shown: 't1' | 't2') =>
      providers(
        store,
        <>
          {(['t1', 't2'] as const).map((id) => (
            <div data-testid={id} key={id}>
              <LauncherTabContext.Provider value={id}>
                <LauncherTabShownContext.Provider value={shown === id}>
                  <AppInfo app={app} myName="q-blog" />
                </LauncherTabShownContext.Provider>
              </LauncherTabContext.Provider>
            </div>
          ))}
        </>
      );
    const view = render(tabs('t1'));
    const first = within(screen.getByTestId('t1'));
    const second = within(screen.getByTestId('t2'));
    await hideButton(second);

    fireEvent.click(await hideButton(first));
    await press(await screen.findByRole('dialog'), 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(1));
    await first.findByText('app_page.hide.note_publisher_hidden');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The other launcher tab comes to the front.
    view.rerender(tabs('t2'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Not offered a second time, for a second fee.
    expect(
      second.queryByRole('button', { name: 'app_page.hide.button_hide' })
    ).toBeNull();
    expect(
      second.getByText('app_page.hide.note_publisher_hidden')
    ).toBeInTheDocument();
  });
});

/** The record of an app its publisher hid earlier. */
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
const HIDDEN_RECORD = {
  v: 1,
  app: { service: 'APP', name: 'Q-Blog' },
  hidden: true,
  replaced: false,
  updated: 1_700_000_100_000,
};

describe('showing it in the library again', () => {
  it('isn’t offered again on a page opened while it was being published', async () => {
    routes({
      'identifier=qhub_app_': HIDDEN_PARTS,
      '/arbitrary/JSON/Q-Blog/qhub_app_hidden_v1_APP': HIDDEN_RECORD,
    });
    let finish: (value: unknown) => void = () => undefined;
    window.sendMessage = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = renderPage();
    const button = await screen.findByRole('button', {
      name: 'app_page.hide.button_show',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(publishes()).toHaveLength(1));

    // Back to the library while it publishes, and into the page again.
    view.unmount();
    renderPage();
    await screen.findByText('A longer story about Q-Blog.');
    await act(async () => {
      finish({ signature: 'TX' });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Shown already: the page says so, rather than offer it for a second fee.
    expect(
      screen.queryByRole('button', { name: 'app_page.hide.button_show' })
    ).toBeNull();
  });
});
