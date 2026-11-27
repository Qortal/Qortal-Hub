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

// Each test runs a hide or show through two launcher tabs' pages: up to about
// 2.5 s on a fast machine, past Vitest's 5 s default on a busy CI runner. A
// test stopped by the limit leaves its last act() open, and the tests after it
// then render nothing.
vi.setConfig({ testTimeout: 20_000 });

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
import { clearAppPageCache, rememberHiddenState } from './useAppPage';
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

/** The same, with the record of an app its publisher hid earlier. */
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

/** The app's version as the node lists it to a page opened now. */
let listedVersion = 'SIG';

/** The node's answer for a rating poll that doesn't exist yet. */
const noPoll: Handler = () =>
  new Response(
    JSON.stringify({ error: 501, message: '!!en:ApiError.POLL_NO_EXISTS!!' }),
    { status: 404 }
  );

const routes = (overrides: Record<string, unknown> = {}) => {
  const table: Record<string, unknown> = {
    'service=APP&name=Q-Blog': () => [
      {
        name: 'Q-Blog',
        service: 'APP',
        identifier: 'default',
        latestSignature: listedVersion,
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
      replaced: false,
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

type TabId = 't1' | 't2';

/**
 * The publisher's page of the same app in launcher tabs, as launcher tab
 * state keeps them: each mounted from when it was opened, one on screen.
 */
const renderTabs = (opened: TabId[] = ['t1', 't2'], shown: TabId = 't1') => {
  const store = createStore();
  store.set(userInfoAtom, { name: 'q-blog', address: 'QPub' });
  const app = { name: 'Q-Blog', service: 'APP' };
  let present = opened;
  let front = shown;
  const tabs = () =>
    providers(
      store,
      <>
        {(['t1', 't2'] as const)
          .filter((id) => present.includes(id))
          .map((id) => (
            <div data-testid={id} key={id}>
              <LauncherTabContext.Provider value={id}>
                <LauncherTabShownContext.Provider value={front === id}>
                  <AppInfo app={app} myName="q-blog" />
                </LauncherTabShownContext.Provider>
              </LauncherTabContext.Provider>
            </div>
          ))}
      </>
    );
  const view = render(tabs());
  // Lets the windows' fades finish, so only the front tab's is on screen.
  const fade = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
  return {
    tab: (id: TabId) => within(screen.getByTestId(id)),
    /** Brings that launcher tab to the front. */
    showTab: async (id: TabId) => {
      front = id;
      view.rerender(tabs());
      await fade();
    },
    /** Opens the same page in another launcher tab, in front. */
    openTab: async (id: TabId) => {
      present = [...present, id];
      front = id;
      view.rerender(tabs());
      await fade();
    },
  };
};

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

/** Lets any publish or effect that a step started go through. */
const settle = (ms = 50) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** The hide window open in each of the two tabs, the first one in front. */
const openInBothTabs = async () => {
  const tabs = renderTabs();
  await hideButton(tabs.tab('t2'));
  fireEvent.click(await hideButton(tabs.tab('t1')));
  await screen.findByRole('dialog');
  await tabs.showTab('t2');
  // The first tab's window steps aside, as it does for any hidden tab.
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(await hideButton(tabs.tab('t2')));
  await screen.findByRole('dialog');
  await tabs.showTab('t1');
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
  return tabs;
};

/** A publish that answers only when the test says. */
const heldPublish = () => {
  let answer: (value: unknown) => void = () => undefined;
  window.sendMessage = vi.fn().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  vi.mocked(window.sendMessage).mockResolvedValue({ signature: 'TX' });
  return (value: unknown) =>
    act(async () => {
      answer(value);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
};

/** A fee lookup that answers only when the test says. */
const heldFee = () => {
  let answer: (value: unknown) => void = () => undefined;
  const promise = new Promise((resolve) => {
    answer = resolve;
  });
  return {
    promise,
    answer: (value: unknown) =>
      act(async () => {
        answer(value);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }),
  };
};

/**
 * The second tab's page was opened before the app's latest version, the
 * first tab's after it. The hide window is open in both, the first in front.
 */
const openWithAnOlderTab = async () => {
  listedVersion = 'V1';
  const tabs = renderTabs(['t2'], 't2');
  fireEvent.click(await hideButton(tabs.tab('t2')));
  await screen.findByRole('dialog');
  // The publisher updates the app, then opens its page in another tab.
  listedVersion = 'V2';
  await tabs.openTab('t1');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(await hideButton(tabs.tab('t1')));
  await screen.findByRole('dialog');
  return tabs;
};

/** A hide and replace in the front tab whose screenshots don't go through. */
const stopHalfway = async () => {
  window.sendMessage = vi
    .fn()
    .mockResolvedValueOnce({ signature: 'REPLACEMENT' })
    .mockResolvedValueOnce({ signature: 'TX' })
    .mockResolvedValueOnce({ error: 'The node is busy.' })
    .mockResolvedValue({ signature: 'TX' });
  const first = await screen.findByRole('dialog');
  fireEvent.click(within(first).getByRole('checkbox'));
  await press(first, 'app_page.hide.action_replace');
  expect(await within(first).findByText('The node is busy.')).toBeVisible();
  expect(publishes().map((call) => call.service)).toEqual([
    'APP',
    'JSON',
    'IMAGE',
  ]);
  return first;
};

beforeEach(() => {
  listedVersion = 'SIG';
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

describe('the hide window open in two launcher tabs', () => {
  it('closes in the other tab once the app is hidden in one, and the record is published once', async () => {
    routes();
    const tabs = await openInBothTabs();

    await press(await screen.findByRole('dialog'), 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The other tab, whose window was left open.
    await tabs.showTab('t2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      tabs.tab('t2').getByText('app_page.hide.note_publisher_hidden')
    ).toBeInTheDocument();
    expect(
      tabs.tab('t2').queryByRole('button', {
        name: 'app_page.hide.button_hide',
      })
    ).toBeNull();
    expect(publishes()).toHaveLength(1);
  });

  it('waits while the other tab is still publishing the hide, then closes', async () => {
    routes();
    const finish = heldPublish();
    const tabs = await openInBothTabs();
    await press(await screen.findByRole('dialog'), 'app_page.hide.action');
    await waitFor(() => expect(publishes()).toHaveLength(1));

    // The other tab while the first one's record is still being published:
    // its window is there, waiting.
    await tabs.showTab('t2');
    const dialog = await waitFor(() => {
      const shown = screen.getByRole('dialog');
      within(shown).getByText('app_page.hide.busy_elsewhere');
      return shown;
    });
    const action = within(dialog).getByRole('button', {
      name: 'app_page.hide.action',
    });
    expect(action).toBeDisabled();
    fireEvent.click(action);

    await finish({ signature: 'TX' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(publishes()).toHaveLength(1);
    expect(
      tabs.tab('t2').getByText('app_page.hide.note_publisher_hidden')
    ).toBeInTheDocument();
  });

  it('goes on from a hide and replace that stopped halfway in the other tab', async () => {
    routes();
    window.sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ signature: 'APP' })
      .mockResolvedValueOnce({ signature: 'TX' })
      .mockResolvedValueOnce({ error: 'The node is busy.' })
      .mockResolvedValue({ signature: 'TX' });
    const tabs = await openInBothTabs();

    // The first tab replaces it too; its screenshots don't go through.
    const first = await screen.findByRole('dialog');
    fireEvent.click(within(first).getByRole('checkbox'));
    await press(first, 'app_page.hide.action_replace');
    expect(await within(first).findByText('The node is busy.')).toBeVisible();
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'IMAGE',
    ]);

    // The window left open in the other tab, where nothing was ticked: the
    // app is replaced already, so it goes on from there.
    await tabs.showTab('t2');
    const second = screen.getByRole('dialog');
    // Its own window: the failure was the other tab's.
    expect(within(second).queryByText('The node is busy.')).toBeNull();
    expect(within(second).getByRole('checkbox')).toBeChecked();
    expect(within(second).getByRole('checkbox')).toBeDisabled();
    // Only what is left: the screenshots and the record.
    expect(within(second).getByText('fee: 0.02 QORT')).toBeInTheDocument();
    await press(second, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(5));
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'IMAGE',
      'IMAGE',
      'JSON',
    ]);
    expect(JSON.parse(atob(publishes()[4].data))).toMatchObject({
      hidden: true,
      replaced: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The first tab's window, still showing its failure, closes too.
    await tabs.showTab('t1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(publishes()).toHaveLength(5);
  });
}, 20000);

describe('a hide and replace stopped halfway, with an older version listed in another tab', () => {
  it('is kept for the tab that stopped it while the other tab has its window open', async () => {
    routes();
    await openWithAnOlderTab();
    const first = await stopHalfway();

    // Closed, and opened again in the same tab: it goes on from there.
    fireEvent.click(
      within(first).getByRole('button', { name: 'action.cancel' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(await hideButton(within(screen.getByTestId('t1'))));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByRole('checkbox')).toBeChecked();
    expect(within(again).getByRole('checkbox')).toBeDisabled();
    // Only the screenshots and the record are left.
    expect(within(again).getByText('fee: 0.02 QORT')).toBeInTheDocument();
  });

  it('is kept for the tab that stopped it after the other tab opens its window', async () => {
    routes();
    listedVersion = 'V1';
    const tabs = renderTabs(['t2'], 't2');
    await hideButton(tabs.tab('t2'));
    listedVersion = 'V2';
    await tabs.openTab('t1');
    fireEvent.click(await hideButton(tabs.tab('t1')));
    const first = await stopHalfway();
    fireEvent.click(
      within(first).getByRole('button', { name: 'action.cancel' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The tab listing the older version opens its window, and closes it.
    await tabs.showTab('t2');
    fireEvent.click(await hideButton(tabs.tab('t2')));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'action.cancel',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Back in the tab that stopped it: it still goes on from there.
    await tabs.showTab('t1');
    fireEvent.click(await hideButton(tabs.tab('t1')));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByRole('checkbox')).toBeChecked();
    expect(within(again).getByText('fee: 0.02 QORT')).toBeInTheDocument();
  });

  it('is taken up in the other tab, whose record then says the app was replaced', async () => {
    routes();
    const tabs = await openWithAnOlderTab();
    await stopHalfway();

    await tabs.showTab('t2');
    const second = screen.getByRole('dialog');
    expect(within(second).queryByText('The node is busy.')).toBeNull();
    expect(within(second).getByRole('checkbox')).toBeChecked();
    expect(within(second).getByRole('checkbox')).toBeDisabled();
    expect(within(second).getByText('fee: 0.02 QORT')).toBeInTheDocument();
    await press(second, 'app_page.hide.action_replace');
    await waitFor(() => expect(publishes()).toHaveLength(5));
    expect(publishes().map((call) => call.service)).toEqual([
      'APP',
      'JSON',
      'IMAGE',
      'IMAGE',
      'JSON',
    ]);
    expect(JSON.parse(atob(publishes()[4].data))).toMatchObject({
      hidden: true,
      replaced: true,
    });
  });
});

describe('a hide window that stays open after the app was hidden', () => {
  const dialog = (props: {
    hidden?: boolean;
    onClose: () => void;
    onHidden?: (state: { replaced: boolean }) => void;
  }) => (
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <HideAppDialog
          app={{ name: 'Q-Blog', service: 'APP' }}
          hasPage
          hasShots
          hidden={props.hidden}
          onClose={props.onClose}
          onHidden={props.onHidden || (() => undefined)}
          open
        />
      </I18nextProvider>
    </ThemeProvider>
  );

  it("doesn't publish when it was hidden from another window since it opened", async () => {
    const app = { name: 'Q-Blog', service: 'APP' };
    const onClose = vi.fn();
    render(
      <>
        {dialog({
          onClose: () => undefined,
          // As the page does once a hide went through.
          onHidden: ({ replaced }) =>
            rememberHiddenState(app, { hidden: true, replaced, at: 1 }),
        })}
        {dialog({ onClose })}
      </>
    );
    // Both open at once: the one opened last keeps the other out of the
    // accessibility tree.
    const [first, second] = await screen.findAllByRole('dialog', {
      hidden: true,
    });
    const action = (dialog: HTMLElement) =>
      within(dialog).getByRole('button', {
        hidden: true,
        name: 'app_page.hide.action',
      });
    await waitFor(() => expect(action(first)).toBeEnabled());
    fireEvent.click(action(first));
    await waitFor(() => expect(publishes()).toHaveLength(1));
    await settle();

    // The second one is still on screen (its page didn't close it).
    expect(action(second)).toBeEnabled();
    fireEvent.click(action(second));
    await settle();
    expect(publishes()).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("doesn't publish once the page says it is hidden", async () => {
    const onClose = vi.fn();
    const view = render(dialog({ onClose }));
    const shown = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(shown).getByRole('button', { name: 'app_page.hide.action' })
      ).toBeEnabled()
    );

    // The node now lists it as hidden, from another device.
    view.rerender(dialog({ hidden: true, onClose }));
    fireEvent.click(
      within(shown).getByRole('button', { name: 'app_page.hide.action' })
    );
    await settle();
    expect(publishes()).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('showing it in the library from two launcher tabs', () => {
  it('waits in the other tab while it is being shown, and publishes once', async () => {
    routes({ 'identifier=qhub_app_': HIDDEN_PARTS });
    const finish = heldPublish();
    const tabs = renderTabs();
    const showButton = (id: TabId) =>
      tabs.tab(id).findByRole('button', { name: 'app_page.hide.button_show' });
    await waitFor(async () => expect(await showButton('t2')).toBeEnabled());
    const first = await showButton('t1');
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.click(first);
    await waitFor(() => expect(publishes()).toHaveLength(1));

    // The other tab while the first one's record is still being published.
    await tabs.showTab('t2');
    const second = await showButton('t2');
    expect(second).toBeDisabled();
    fireEvent.click(second);
    await settle();
    expect(show).toHaveBeenCalledTimes(1);

    await finish({ signature: 'TX' });
    await hideButton(tabs.tab('t2'));
    expect(publishes()).toHaveLength(1);
    expect(publishes()[0].title).toBe('shown');
  });

  it("doesn't ask or publish in a tab whose click came before it was shown from another", async () => {
    routes({ 'identifier=qhub_app_': HIDDEN_PARTS });
    const tabs = renderTabs();
    const showButton = async (id: TabId) => {
      const button = await tabs
        .tab(id)
        .findByRole('button', { name: 'app_page.hide.button_show' });
      await waitFor(() => expect(button).toBeEnabled());
      return button;
    };
    // Show in the library in the second tab, whose fee is slow to come.
    await tabs.showTab('t2');
    const slowFee = heldFee();
    getFee.mockImplementationOnce(() => slowFee.promise);
    fireEvent.click(await showButton('t2'));

    // Meanwhile it is shown from the first tab.
    await tabs.showTab('t1');
    fireEvent.click(await showButton('t1'));
    await waitFor(() => expect(publishes()).toHaveLength(1));
    await hideButton(tabs.tab('t1'));

    await slowFee.answer({ fee: '0.01' });
    await settle();
    expect(show).toHaveBeenCalledTimes(1);
    expect(publishes()).toHaveLength(1);
  });

  it("doesn't publish in a tab whose confirmation was answered after it was shown from another", async () => {
    routes({ 'identifier=qhub_app_': HIDDEN_PARTS });
    const tabs = renderTabs();
    const showButton = async (id: TabId) => {
      const button = await tabs
        .tab(id)
        .findByRole('button', { name: 'app_page.hide.button_show' });
      await waitFor(() => expect(button).toBeEnabled());
      return button;
    };
    const finish = heldPublish();
    // The second tab's fee is slow to come, and its confirmation is answered
    // only when the test says.
    await tabs.showTab('t2');
    const slowFee = heldFee();
    getFee.mockImplementationOnce(() => slowFee.promise);
    fireEvent.click(await showButton('t2'));

    // Shown from the first tab meanwhile: its record is still publishing
    // when the second tab's fee comes and its confirmation is asked.
    await tabs.showTab('t1');
    fireEvent.click(await showButton('t1'));
    await waitFor(() => expect(publishes()).toHaveLength(1));
    let accept: (value?: unknown) => void = () => undefined;
    show.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    await slowFee.answer({ fee: '0.01' });
    expect(show).toHaveBeenCalledTimes(2);

    // The first tab's record goes through, then the confirmation is accepted.
    await finish({ signature: 'TX' });
    await hideButton(tabs.tab('t1'));
    await act(async () => {
      accept();
    });
    await settle();
    expect(publishes()).toHaveLength(1);
  });

  it('can be shown again after another confirmation took the place of its own', async () => {
    routes({
      'identifier=qhub_app_': HIDDEN_PARTS,
      '/polls/app-library-APP-rating-Q-Blog': noPoll,
      '/polls/votes/app-library-APP-rating-Q-Blog': noPoll,
    });
    // Hub's fee confirmation: one at a time, a newer one takes its place
    // and the older one is never answered.
    let pending: { reject: (reason?: unknown) => void } | null = null;
    show.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          pending = { reject };
        })
    );
    const showFee = heldFee();
    const rateFee = heldFee();
    getFee.mockImplementation((type: string) =>
      type === 'ARBITRARY' ? showFee.promise : rateFee.promise
    );
    const tabs = renderTabs(['t1'], 't1');
    const showButton = () =>
      tabs
        .tab('t1')
        .findByRole('button', { name: 'app_page.hide.button_show' });
    await waitFor(async () => expect(await showButton()).toBeEnabled());
    const stars = await tabs.tab('t1').findAllByRole('radio');
    await waitFor(() => expect(stars[3]).toBeEnabled());

    // Show in the library, and a star pressed while its fee is looked up.
    fireEvent.click(await showButton());
    await act(async () => {
      fireEvent.click(stars[3]);
    });
    // Its confirmation comes first, then the rating's takes its place.
    await showFee.answer({ fee: '0.01' });
    await rateFee.answer({ fee: '0.01' });
    expect(show).toHaveBeenCalledTimes(2);
    // The rating is declined.
    await act(async () => {
      pending?.reject({ isCanceled: true });
    });
    await settle(300);

    // Nothing was published, and showing it can be asked for again.
    expect(publishes()).toHaveLength(0);
    expect(await showButton()).toBeEnabled();
  });
});
