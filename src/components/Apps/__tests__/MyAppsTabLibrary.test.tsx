import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => executeEvent(...args),
}));

vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({ rating: null, containerRef: { current: null } }),
}));

import { MyAppsTab } from '../AppsLibrary/MyAppsTab';
import {
  publishedOwnWidgetsAtom,
  withPublishedOwnWidget,
} from '../AppsLibrary/ownWidgets';
import { userInfoAtom } from '../../../atoms/global';
import type { HomeWidgetListing } from '../../HomeWidgets/homeWidgets';

const availableQapps = [
  { name: 'alice', service: 'APP', status: { status: 'READY' } },
  { name: 'alice', service: 'WEBSITE', metadata: { title: 'Alice site' } },
  { name: 'bob', service: 'APP' },
];

const isNamesRequest = (url: unknown) =>
  String(url).includes('/names/address/');

/** The node: the account's names, and no widgets unless given. */
const mockNames = (names: string[], widgets: unknown[] = []) => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      isNamesRequest(url) ? names.map((name) => ({ name })) : widgets,
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const namesRequests = (fetchMock: ReturnType<typeof mockNames>) =>
  fetchMock.mock.calls.filter(([url]) => isNamesRequest(url)).length;

const renderTab = (
  props: Partial<React.ComponentProps<typeof MyAppsTab>> = {}
) => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'Qme' } as never);
  const setMode = vi.fn();
  const ui = (extra: Partial<React.ComponentProps<typeof MyAppsTab>>) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <MyAppsTab
          availableQapps={availableQapps}
          myName="alice"
          setMode={setMode}
          {...props}
          {...extra}
        />
      </ThemeProvider>
    </Provider>
  );
  const result = render(ui({}));
  return {
    setMode,
    store,
    rerenderWith: (extra: Partial<React.ComponentProps<typeof MyAppsTab>>) =>
      result.rerender(ui(extra)),
  };
};

/** One of the node's APP resources under `name`. */
const appResource = (
  name: string,
  identifier: string | undefined,
  title: string,
  tags: string[],
  updated = 10
) => ({
  name,
  service: 'APP',
  ...(identifier ? { identifier } : {}),
  metadata: { title, description: `${title} text`, tags },
  updated,
});

const WIDGETS_SECTION = {
  name: 'core:developer.your_published_widgets',
} as const;
const widgetsRegion = () => screen.getByRole('region', WIDGETS_SECTION);
/** The section shows once the names have loaded. */
const findWidgetsRegion = () => screen.findByRole('region', WIDGETS_SECTION);

describe('MyAppsTab in the library', () => {
  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the account’s own app and website with Open, Pin and Update', async () => {
    mockNames(['alice']);
    renderTab();

    // The placeholder section has the same title until the names load.
    await screen.findByRole('article', { name: 'alice' });
    const apps = screen.getByRole('region', {
      name: 'core:developer.your_published_apps',
    });
    const app = within(apps).getByRole('article', { name: 'alice' });
    expect(
      within(app).getByRole('button', { name: 'core:action.open' })
    ).toBeInTheDocument();
    expect(
      within(app).getByRole('button', { name: 'core:action.pin' })
    ).toBeInTheDocument();
    expect(
      within(app).getByRole('button', { name: 'core:developer.update' })
    ).toBeInTheDocument();

    const sites = screen.getByRole('region', {
      name: 'core:developer.your_published_websites',
    });
    expect(
      within(sites).getByRole('article', { name: 'Alice site' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'bob' })).toBeNull();
  });

  it('counts each section', async () => {
    mockNames(['alice']);
    renderTab();

    // The placeholder section has the same title until the names load.
    await screen.findByRole('article', { name: 'alice' });
    const apps = screen.getByRole('region', {
      name: 'core:developer.your_published_apps',
    });
    expect(within(apps).getByRole('list')).toHaveAttribute(
      'aria-label',
      'core:developer.your_published_apps'
    );
    expect(within(apps).getAllByRole('listitem')).toHaveLength(1);
    expect(within(apps).getByText('1')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says so when a name has no apps or websites yet', async () => {
    mockNames(['carol']);
    renderTab();

    expect(
      await screen.findByText('core:developer.no_apps_yet')
    ).toBeInTheDocument();
    expect(screen.getByText('core:developer.no_sites_yet')).toBeInTheDocument();
  });

  it('opens the publish form for an Update', async () => {
    const user = userEvent.setup();
    mockNames(['alice']);
    const { setMode } = renderTab();

    // The placeholder section has the same title until the names load.
    await screen.findByRole('article', { name: 'alice' });
    const apps = screen.getByRole('region', {
      name: 'core:developer.your_published_apps',
    });
    await user.click(
      within(apps).getByRole('button', { name: 'core:developer.update' })
    );
    // The form opens locked to the app it updates.
    expect(setMode).toHaveBeenCalledWith('publish', {
      name: 'alice',
      service: 'APP',
    });
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('asks an account without a name to register one', async () => {
    const user = userEvent.setup();
    mockNames([]);
    renderTab();

    expect(
      await screen.findByText('core:message.generic.name_publish')
    ).toBeInTheDocument();
    expect(
      screen.getByText('core:launcher.library.no_name_text')
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'core:action.register_name' })
    );
    expect(executeEvent).toHaveBeenCalledWith('openRegisterName', {});
  });

  it('reloads the names when the library is refreshed, keeping the apps on screen', async () => {
    const fetchMock = mockNames(['alice']);
    const { rerenderWith } = renderTab({ libraryRefreshKey: 0 });
    await screen.findByRole('article', { name: 'alice' });
    await screen.findByText('core:developer.no_widgets_yet');
    expect(namesRequests(fetchMock)).toBe(1);

    rerenderWith({ libraryRefreshKey: 1 });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'alice' })).toBeInTheDocument();
    await waitFor(() => expect(namesRequests(fetchMock)).toBe(2));
  });
});

describe('MyAppsTab: the names\u2019 widgets', () => {
  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists them under their own heading, with Update and Add to Home, a retired one marked', async () => {
    mockNames(
      ['alice'],
      [
        appResource('alice', 'go-widget-now', 'Now', ['go-widget', 'weather']),
        appResource('alice', 'go-widget-old', 'Old', ['weather'], 5),
        // Not widgets: another APP of the name, and someone else's widget.
        appResource('alice', 'beta', 'Beta', []),
        appResource('bob', 'go-widget-x', 'Bob widget', ['go-widget']),
      ]
    );
    renderTab();

    const now = await within(await findWidgetsRegion()).findByRole('article', {
      name: 'Now',
    });
    const old = within(widgetsRegion()).getByRole('article', { name: 'Old' });
    expect(within(widgetsRegion()).getAllByRole('article')).toHaveLength(2);
    for (const widget of [now, old]) {
      expect(
        within(widget).getByRole('button', { name: 'core:developer.update' })
      ).toBeInTheDocument();
      expect(
        within(widget).getByRole('button', { name: 'core:widgets.add_to_home' })
      ).toBeInTheDocument();
    }
    expect(
      within(old).getByText('core:publish_widget.not_listed')
    ).toBeInTheDocument();
    expect(
      within(now).queryByText('core:publish_widget.not_listed')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Beta' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Bob widget' })).toBeNull();
  });

  it("opens the publish form on the widget for an Update, or on the name's app when that is the widget", async () => {
    const user = userEvent.setup();
    mockNames(
      ['alice'],
      [
        appResource('alice', 'go-widget-now', 'Now', ['go-widget']),
        appResource('alice', undefined, 'Alice clock', ['go-widget'], 5),
      ]
    );
    const { setMode } = renderTab();

    const now = await within(await findWidgetsRegion()).findByRole('article', {
      name: 'Now',
    });
    await user.click(
      within(now).getByRole('button', { name: 'core:developer.update' })
    );
    expect(setMode).toHaveBeenLastCalledWith('publish', {
      name: 'alice',
      service: 'APP',
      identifier: 'go-widget-now',
    });

    const appWidget = within(widgetsRegion()).getByRole('article', {
      name: 'Alice clock',
    });
    await user.click(
      within(appWidget).getByRole('button', { name: 'core:developer.update' })
    );
    expect(setMode).toHaveBeenLastCalledWith('publish', {
      name: 'alice',
      service: 'APP',
    });
    // Update is the only thing these clicks did: no widget page opened.
    expect(executeEvent).not.toHaveBeenCalledWith(
      'selectedAppInfo',
      expect.anything()
    );
  });

  it("opens a widget's page from its title", async () => {
    const user = userEvent.setup();
    mockNames(
      ['alice'],
      [appResource('alice', 'go-widget-now', 'Now', ['go-widget'])]
    );
    renderTab();

    await user.click(
      await within(await findWidgetsRegion()).findByRole('button', {
        name: 'Now',
      })
    );
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: expect.objectContaining({
        kind: 'widget',
        name: 'alice',
        identifier: 'go-widget-now',
      }),
    });
  });

  it('says so when the names have no widgets yet, and offers Publish widget', async () => {
    const user = userEvent.setup();
    mockNames(['alice']);
    const { setMode } = renderTab();

    expect(
      await within(await findWidgetsRegion()).findByText(
        'core:developer.no_widgets_yet'
      )
    ).toBeInTheDocument();
    await user.click(screen.getByText('core:developer.publish_widget'));
    expect(setMode).toHaveBeenLastCalledWith('publish-widget');
  });

  it('shows a failed search as an error with Retry, never as no widgets', async () => {
    const user = userEvent.setup();
    let failing = true;
    const fetchMock = vi.fn(async (url: string) => ({
      ok: isNamesRequest(url) || !failing,
      json: async () =>
        isNamesRequest(url)
          ? [{ name: 'alice' }]
          : [appResource('alice', 'go-widget-now', 'Now', ['go-widget'])],
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    renderTab();

    expect(
      await within(await findWidgetsRegion()).findByText(
        'group:home_widgets.picker_error'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('core:developer.no_widgets_yet')
    ).not.toBeInTheDocument();

    failing = false;
    await user.click(
      within(widgetsRegion()).getByRole('button', { name: 'core:retry' })
    );
    expect(
      await within(await findWidgetsRegion()).findByRole('article', {
        name: 'Now',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('group:home_widgets.picker_error')
    ).not.toBeInTheDocument();
  });

  it('keeps the widgets on screen when a refresh fails', async () => {
    let failing = false;
    const fetchMock = vi.fn(async (url: string) => ({
      ok: isNamesRequest(url) || !failing,
      json: async () =>
        isNamesRequest(url)
          ? [{ name: 'alice' }]
          : [appResource('alice', 'go-widget-now', 'Now', ['go-widget'])],
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { rerenderWith } = renderTab({ libraryRefreshKey: 0 });
    await within(await findWidgetsRegion()).findByRole('article', {
      name: 'Now',
    });
    const searches = () =>
      fetchMock.mock.calls.filter(([url]) => !isNamesRequest(url)).length;
    expect(searches()).toBe(1);

    failing = true;
    rerenderWith({ libraryRefreshKey: 1 });
    await waitFor(() => expect(searches()).toBe(2));
    await waitFor(() => expect(namesRequests(fetchMock)).toBe(2));
    expect(
      within(widgetsRegion()).getByRole('article', { name: 'Now' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('group:home_widgets.picker_error')
    ).not.toBeInTheDocument();
  });

  it('shows a widget just published from this Hub before the node lists it, for its own names only', async () => {
    mockNames(['alice']);
    const { store } = renderTab();
    await within(await findWidgetsRegion()).findByText(
      'core:developer.no_widgets_yet'
    );

    act(() => {
      store.set(publishedOwnWidgetsAtom, [
        {
          name: 'alice',
          identifier: 'go-widget-new',
          title: 'Brand new',
          description: '',
          updated: 0,
          publishedAt: Date.now(),
          replaces: 0,
        },
        {
          name: 'bob',
          identifier: 'go-widget-other',
          title: 'Not hers',
          description: '',
          updated: 0,
          publishedAt: Date.now(),
          replaces: 0,
        },
      ]);
    });

    expect(
      await within(await findWidgetsRegion()).findByRole('article', {
        name: 'Brand new',
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Not hers' })).toBeNull();
    expect(
      screen.queryByText('core:developer.no_widgets_yet')
    ).not.toBeInTheDocument();
  });

  it("drops a late answer for the previous account's names", async () => {
    const answers: Record<string, (value: unknown[]) => void> = {};
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/names/address/Qme')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ name: 'alice' }],
        });
      }
      if (url.includes('/names/address/Qother')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ name: 'carol' }],
        });
      }
      const name = new URL(url).searchParams.get('name') ?? '';
      return new Promise((resolve) => {
        answers[name] = (value) =>
          resolve({ ok: true, json: async () => value });
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { store } = renderTab();
    await waitFor(() => expect(answers.alice).toBeDefined());

    // Another account signs in while alice's widgets are still on their way.
    act(() => {
      store.set(userInfoAtom, { address: 'Qother' } as never);
    });
    await waitFor(() => expect(answers.carol).toBeDefined());
    await act(async () => {
      answers.carol([]);
    });
    expect(
      await within(await findWidgetsRegion()).findByText(
        'core:developer.no_widgets_yet'
      )
    ).toBeInTheDocument();

    await act(async () => {
      answers.alice([
        appResource('alice', 'go-widget-now', 'Now', ['go-widget']),
      ]);
    });
    expect(screen.queryByRole('article', { name: 'Now' })).toBeNull();
    expect(
      within(widgetsRegion()).getByText('core:developer.no_widgets_yet')
    ).toBeInTheDocument();
  });
});

describe('MyAppsTab: widgets published from this Hub, over time', () => {
  const MINUTE = 60_000;

  /** The node: the name alice, and her APP resources as `listed()` has them. */
  const mockNode = (listed: () => unknown[]) => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (isNamesRequest(url) ? [{ name: 'alice' }] : listed()),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  /** What the publish form records when a widget's publish went through. */
  const publishFromForm = (
    store: ReturnType<typeof createStore>,
    widget: Partial<HomeWidgetListing> & { identifier: string; title: string },
    replaces = 0
  ) =>
    act(() => {
      store.set(
        publishedOwnWidgetsAtom,
        withPublishedOwnWidget(
          store.get(publishedOwnWidgetsAtom),
          { name: 'alice', description: '', updated: 0, ...widget },
          { replaces }
        )
      );
    });

  /** Time passes with the launcher tab left open on My apps. */
  const timePasses = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  const card = (name: string) =>
    within(widgetsRegion()).queryByRole('article', { name });

  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('still lists a widget published from here once its wait is over and the node has it', async () => {
    let listed: unknown[] = [];
    mockNode(() => listed);
    const { store } = renderTab();
    await within(await findWidgetsRegion()).findByText(
      'core:developer.no_widgets_yet'
    );
    vi.useFakeTimers();

    // Publish widget: a new one, shown at once.
    const publishedAt = Date.now();
    publishFromForm(store, { identifier: 'go-widget-clock', title: 'Clock' });
    expect(card('Clock')).toBeInTheDocument();

    // The node lists it a minute later.
    listed = [
      appResource(
        'alice',
        'go-widget-clock',
        'Clock',
        ['go-widget'],
        publishedAt + MINUTE
      ),
    ];
    await timePasses(20 * MINUTE);

    // Then the next widget is published from here.
    publishFromForm(store, { identifier: 'go-widget-news', title: 'News' });
    await timePasses(MINUTE);
    expect(card('News')).toBeInTheDocument();

    // Clock is on the node and was published from here: still listed.
    expect(card('Clock')).toBeInTheDocument();
  });

  it("doesn't go back to the version an update replaced once the update's wait is over", async () => {
    const replaced = Date.now() - 60 * MINUTE;
    let listed: unknown[] = [
      appResource('alice', 'go-widget-now', 'Now', ['go-widget'], replaced),
    ];
    mockNode(() => listed);
    const { store } = renderTab();
    await within(await findWidgetsRegion()).findByRole('article', {
      name: 'Now',
    });
    vi.useFakeTimers();

    // Update: the title becomes "Now 2", shown at once.
    const publishedAt = Date.now();
    publishFromForm(
      store,
      { identifier: 'go-widget-now', title: 'Now 2' },
      replaced
    );
    expect(card('Now 2')).toBeInTheDocument();

    // The node lists the update two minutes later.
    listed = [
      appResource(
        'alice',
        'go-widget-now',
        'Now 2',
        ['go-widget'],
        publishedAt + 2 * MINUTE
      ),
    ];
    await timePasses(20 * MINUTE);

    // Then another widget is published from here.
    publishFromForm(store, { identifier: 'go-widget-news', title: 'News' });
    await timePasses(MINUTE);
    expect(card('News')).toBeInTheDocument();

    expect(card('Now')).not.toBeInTheDocument();
    expect(card('Now 2')).toBeInTheDocument();
  });

  it('stops listing a publish the node never lists once its wait is over', async () => {
    mockNode(() => []);
    const { store } = renderTab();
    await within(await findWidgetsRegion()).findByText(
      'core:developer.no_widgets_yet'
    );
    vi.useFakeTimers();
    publishFromForm(store, { identifier: 'go-widget-lost', title: 'Lost' });
    expect(card('Lost')).toBeInTheDocument();

    // Its transaction never confirms.
    await timePasses(17 * MINUTE);

    expect(card('Lost')).not.toBeInTheDocument();
    expect(
      within(widgetsRegion()).getByText('core:developer.no_widgets_yet')
    ).toBeInTheDocument();
  });
});
