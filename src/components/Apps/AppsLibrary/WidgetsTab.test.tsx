import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../HomeWidgets/fetchHomeWidgets', () => ({
  fetchHomeWidgets: vi.fn(),
}));

import { userInfoAtom } from '../../../atoms/global';
import {
  allRatingsLoadedAtom,
  getCacheKey,
  ratingsStoreAtom,
} from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { fetchHomeWidgets } from '../../HomeWidgets/fetchHomeWidgets';
import { pendingVoteKey, pendingVotesAtom } from '../AppPage/appPageStore';
import {
  type HomeWidgetListing,
  savedHomeWidgetsAtom,
} from '../../HomeWidgets/homeWidgets';
import type { SortOption } from '../Filters/SortDropdown';
import { WidgetsTab } from './WidgetsTab';
import { widgetRatingKey, widgetRatingName } from './widgetLibrary';

const NOW: HomeWidgetListing = {
  name: 'Q-Weather',
  identifier: 'go-widget-now',
  title: 'Weather Now',
  description: 'The weather right now.',
  updated: 300,
  created: 30,
  category: 'WEATHER',
  categoryName: 'Weather',
  tags: ['weather'],
};
const CLOCK: HomeWidgetListing = {
  name: 'GO Clock',
  identifier: null,
  title: 'GO Clock',
  description: '',
  updated: 100,
};

const renderTab = ({
  sortValue = 'alphabetical' as SortOption,
  libraryRefreshKey = 0,
  store = createStore(),
} = {}) => {
  store.set(userInfoAtom, { address: 'QMe' });
  const ui = (key: number) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <WidgetsTab libraryRefreshKey={key} sortValue={sortValue} />
      </ThemeProvider>
    </Provider>
  );
  const view = render(ui(libraryRefreshKey));
  return {
    store,
    ...view,
    refresh: (key: number) => view.rerender(ui(key)),
  };
};

describe('WidgetsTab', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchHomeWidgets).mockReset();
    // The cards' ratings: no poll yet.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'POLL_NO_EXISTS' }))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the widgets on QDN, each with its publisher', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW, CLOCK]);
    renderTab();
    expect(screen.getByRole('status')).toHaveTextContent(
      'core:loading.generic'
    );

    const list = await screen.findByRole('list', { name: 'core:tabs.widgets' });
    const items = within(list).getAllByRole('article');
    // Sorted by name, as asked.
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('GO Clock')).toBeInTheDocument();
    expect(within(items[1]).getByText('Weather Now')).toBeInTheDocument();
    expect(within(items[1]).getByText('Weather')).toBeInTheDocument();
    expect(
      within(items[1]).getAllByText('core:app_detail.by_developer')
    ).toHaveLength(1);
    expect(fetchHomeWidgets).toHaveBeenCalledWith(
      'http://node',
      expect.objectContaining({ fresh: false })
    );
  });

  it('opens a widget’s page from its card', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW]);
    const user = userEvent.setup();
    const opened = vi.fn();
    document.addEventListener('selectedAppInfo', opened);
    renderTab();

    await user.click(
      await screen.findByRole('button', { name: 'Weather Now' })
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0].detail.data).toMatchObject({
      kind: 'widget',
      name: 'Q-Weather',
      identifier: 'go-widget-now',
      service: 'APP',
    });
    document.removeEventListener('selectedAppInfo', opened);
  });

  it('adds a widget to Home from its card, and says so', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW]);
    const user = userEvent.setup();
    const snack = vi.fn();
    document.addEventListener('openGlobalSnackBar', snack);
    const { store } = renderTab();

    await user.click(
      await screen.findByRole('button', { name: 'core:widgets.add_to_home' })
    );
    expect(store.get(savedHomeWidgetsAtom)).toEqual([
      expect.objectContaining({
        name: 'Q-Weather',
        identifier: 'go-widget-now',
        title: 'Weather Now',
      }),
    ]);
    expect(snack.mock.calls[0][0].detail).toMatchObject({
      message: 'core:widgets.added_to_home',
      type: 'success',
    });
    // Once there, the card says so instead of offering it again.
    expect(screen.getByText('core:widgets.on_home')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'core:widgets.add_to_home' })
    ).toBeNull();
    document.removeEventListener('openGlobalSnackBar', snack);
  });

  it('asks the node again on Try again and on the library’s refresh', async () => {
    vi.mocked(fetchHomeWidgets).mockRejectedValueOnce(new Error('HTTP 500'));
    const user = userEvent.setup();
    const { refresh } = renderTab();

    expect(
      await screen.findByText('group:home_widgets.picker_error')
    ).toBeInTheDocument();
    vi.mocked(fetchHomeWidgets).mockResolvedValue([CLOCK]);
    await user.click(screen.getByRole('button', { name: 'core:retry' }));
    expect(await screen.findByText('GO Clock')).toBeInTheDocument();
    expect(vi.mocked(fetchHomeWidgets).mock.calls[1][1]).toMatchObject({
      fresh: true,
    });

    // A failed refresh keeps the list.
    vi.mocked(fetchHomeWidgets).mockRejectedValueOnce(new Error('offline'));
    refresh(1);
    await waitFor(() => expect(fetchHomeWidgets).toHaveBeenCalledTimes(3));
    expect(screen.getByText('GO Clock')).toBeInTheDocument();
    expect(screen.queryByText('group:home_widgets.picker_error')).toBeNull();
  });

  it('says when nobody has published a widget yet', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([]);
    renderTab();
    expect(
      await screen.findByText('group:home_widgets.picker_empty')
    ).toBeInTheDocument();
    // How to publish one stays in view.
    expect(
      screen.getByText('group:home_widgets.picker_developers')
    ).toBeInTheDocument();
  });
});

describe('WidgetsTab, its Featured row', () => {
  const BARS: HomeWidgetListing = {
    ...NOW,
    identifier: 'go-widget-weather',
    title: 'Weather Bars',
    updated: 200,
  };
  const CHART: HomeWidgetListing = {
    ...NOW,
    identifier: 'go-widget-meteogram',
    title: 'Weather Chart',
    updated: 100,
  };
  const rating = (
    averageRating: number,
    totalVotes: number
  ): AppRatingData => ({
    averageRating,
    totalVotes,
    voteCounts: [],
    hasPublishedRating: true,
    pollInfo: null,
    lastFetched: 0,
  });
  const rated = (entries: Array<[string, AppRatingData]>) => {
    const store = createStore();
    store.set(ratingsStoreAtom, new Map(entries));
    store.set(allRatingsLoadedAtom, true);
    return store;
  };
  /** The row's widgets, in order; null without the row. */
  const featuredTitles = () => {
    const row = screen.queryByRole('region', {
      name: 'core:official_apps.featured',
    });
    if (!row) return null;
    return within(row)
      .getAllByRole('article')
      .map(
        (card) =>
          document.getElementById(card.getAttribute('aria-labelledby') ?? '')
            ?.textContent
      );
  };

  beforeEach(() => {
    // The cards' ratings would ask the node again and replace the test's.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {})
    );
  });

  it('shows the best rated widgets above the list, each by its own poll', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([CLOCK, CHART, BARS, NOW]);
    const store = rated([
      [widgetRatingKey(BARS), rating(4.9, 20)],
      [widgetRatingKey({ ...NOW }), rating(4.5, 12)],
      [widgetRatingKey(CHART), rating(4.2, 6)],
      // The app Q-Weather is rated too: that is not its widgets' rating.
      [getCacheKey('Q-Weather', 'APP'), rating(5, 90)],
      // Three stars or less is not "rated well".
      [widgetRatingKey(CLOCK), rating(3, 40)],
    ]);
    renderTab({ store });

    await screen.findByRole('list', { name: 'core:tabs.widgets' });
    expect(featuredTitles()).toEqual([
      'Weather Bars',
      'Weather Now',
      'Weather Chart',
    ]);
    const row = screen.getByRole('region', {
      name: 'core:official_apps.featured',
    });
    expect(
      within(row).getByText('core:launcher.library.top_rated_hint')
    ).toBeInTheDocument();
  });

  it('adds a widget to Home, or opens its page, from the row', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW, BARS, CHART]);
    const store = rated([
      [widgetRatingKey(BARS), rating(4.9, 20)],
      [widgetRatingKey(NOW), rating(4.5, 12)],
      [widgetRatingKey(CHART), rating(4.2, 6)],
    ]);
    const user = userEvent.setup();
    const opened = vi.fn();
    document.addEventListener('selectedAppInfo', opened);
    renderTab({ store });

    await screen.findByRole('list', { name: 'core:tabs.widgets' });
    const row = screen.getByRole('region', {
      name: 'core:official_apps.featured',
    });
    const card = within(row)
      .getAllByRole('article')
      .find((item) => within(item).queryByText('Weather Chart'))!;
    await user.click(
      within(card).getByRole('button', { name: 'core:widgets.add_to_home' })
    );
    expect(store.get(savedHomeWidgetsAtom)).toEqual([
      expect.objectContaining({ identifier: 'go-widget-meteogram' }),
    ]);
    // The row and the list say so alike.
    expect(within(card).getByText('core:widgets.on_home')).toBeInTheDocument();
    expect(screen.getAllByText('core:widgets.on_home')).toHaveLength(2);

    await user.click(
      within(card).getByRole('button', { name: 'Weather Chart' })
    );
    expect(opened.mock.calls[0][0].detail.data).toMatchObject({
      kind: 'widget',
      identifier: 'go-widget-meteogram',
    });
    document.removeEventListener('selectedAppInfo', opened);
  });

  it('shows the row from the first widget rated well: widgets are few', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW, BARS, CHART]);
    const store = rated([
      [widgetRatingKey(BARS), rating(5, 1)],
      [widgetRatingKey(NOW), rating(5, 1)],
    ]);
    renderTab({ store });
    await screen.findByRole('list', { name: 'core:tabs.widgets' });
    // Rated alike: they keep the order the node listed them in.
    expect(featuredTitles()).toEqual(['Weather Now', 'Weather Bars']);
  });

  it('has no row while no widget is rated above three stars', async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW, BARS, CHART]);
    const store = rated([[widgetRatingKey(BARS), rating(3, 8)]]);
    renderTab({ store });
    await screen.findByRole('list', { name: 'core:tabs.widgets' });
    expect(featuredTitles()).toBeNull();
  });

  it("counts the account's own rating at once, in the row and on its card", async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW, BARS, CHART]);
    // Nobody had rated a widget; the account just did, from Weather Now's
    // page. Its poll waits for a block.
    const store = rated([]);
    const subject = widgetRatingName(NOW);
    store.set(pendingVotesAtom, {
      [pendingVoteKey('QMe', 'APP', subject)]: {
        voter: 'QMe',
        rating: 5,
        createdPoll: true,
        sentAt: Date.now(),
        name: subject,
        service: 'APP',
      },
    });
    renderTab({ store });

    await screen.findByRole('list', { name: 'core:tabs.widgets' });
    expect(featuredTitles()).toEqual(['Weather Now']);
    const list = screen.getByRole('list', { name: 'core:tabs.widgets' });
    const card = within(list)
      .getAllByRole('article')
      .find((item) => within(item).queryByText('Weather Now'))!;
    expect(
      within(card).getByRole('img', {
        name: 'core:launcher.library.rating_summary',
      })
    ).toHaveTextContent('5.0(1)');
  });

  it("leaves out another account's rating on its way", async () => {
    vi.mocked(fetchHomeWidgets).mockResolvedValue([NOW, BARS, CHART]);
    const store = rated([]);
    const subject = widgetRatingName(NOW);
    store.set(pendingVotesAtom, {
      [pendingVoteKey('QOther', 'APP', subject)]: {
        voter: 'QOther',
        rating: 5,
        createdPoll: true,
        sentAt: Date.now(),
        name: subject,
        service: 'APP',
      },
    });
    renderTab({ store });
    await screen.findByRole('list', { name: 'core:tabs.widgets' });
    expect(featuredTitles()).toBeNull();
  });
});
