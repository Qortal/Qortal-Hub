import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => executeEvent(...args),
}));

vi.mock('../AppCard', () => ({
  AppCardEnhanced: ({
    app,
    isFromCategory,
  }: {
    app: any;
    isFromCategory?: boolean;
  }) => (
    <div data-category={String(isFromCategory)} data-testid="app-card">
      {app.name}
    </div>
  ),
}));

import { AppsCategoryDesktop } from '../AppsCategoryDesktop';
import { getCacheKey, ratingsStoreAtom } from '../../../hooks/useAppRatings';

const games = [
  { name: 'Alpha', service: 'APP', metadata: { category: 'GAMING' } },
  {
    name: 'Bravo',
    service: 'APP',
    metadata: { category: 'GAMING' },
    status: { status: 'READY' },
  },
  { name: 'Charlie', service: 'APP', metadata: { category: 'GAMING' } },
  { name: 'Tool', service: 'APP', metadata: { category: 'TOOLS' } },
];

const rating = (averageRating: number, totalVotes: number) => ({
  averageRating,
  totalVotes,
  voteCounts: [],
  hasPublishedRating: true,
  pollInfo: null,
  lastFetched: 0,
});

const renderPage = (
  props: Partial<React.ComponentProps<typeof AppsCategoryDesktop>> = {},
  ratings: Record<string, ReturnType<typeof rating>> = {
    Alpha: rating(2, 10),
    Charlie: rating(5, 10),
    Bravo: rating(4, 10),
  }
) => {
  const store = createStore();
  store.set(
    ratingsStoreAtom,
    new Map(
      Object.entries(ratings).map(([name, value]) => [
        getCacheKey(name, 'APP'),
        value,
      ])
    )
  );
  const ui = (
    extra: Partial<React.ComponentProps<typeof AppsCategoryDesktop>>
  ) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <AppsCategoryDesktop
          availableQapps={games}
          category={{ id: 'GAMING', name: 'Gaming' }}
          isShow
          myName="me"
          {...props}
          {...extra}
        />
      </ThemeProvider>
    </Provider>
  );
  const result = render(ui({}));
  return {
    rerenderWith: (
      extra: Partial<React.ComponentProps<typeof AppsCategoryDesktop>>
    ) => result.rerender(ui(extra)),
  };
};

const cardNames = () =>
  screen.queryAllByTestId('app-card').map((card) => card.textContent);

const featuredRow = () =>
  screen.queryByRole('region', { name: 'core:official_apps.featured' });

/** The Featured row's apps, in order; null without the row. */
const featuredNames = () => {
  const row = featuredRow();
  if (!row) return null;
  return within(row)
    .getAllByRole('article')
    .map(
      (card) =>
        document.getElementById(card.getAttribute('aria-labelledby') ?? '')
          ?.textContent
    );
};

describe('AppsCategoryDesktop', () => {
  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
  });

  it('sorts by rating when it says highest rated', () => {
    renderPage();
    expect(cardNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(screen.getAllByTestId('app-card')[0]).toHaveAttribute(
      'data-category',
      'true'
    );
  });

  it('names the category in a heading, translated for all of them', () => {
    const { rerenderWith } = renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Gaming'
    );

    rerenderWith({ category: { id: 'all', name: 'All' } });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'core:launcher.library.all_categories'
    );
    expect(cardNames()).toHaveLength(4);
  });

  it('goes back the way the top bar does', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'core:action.back' }));
    expect(executeEvent).toHaveBeenCalledWith('navigateBack', {});
  });

  it('searches within the category', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByRole('textbox', {
        name: 'core:launcher.library.search_in_category',
      }),
      'brav'
    );
    await waitFor(() => expect(cardNames()).toEqual(['Bravo']));
  });

  it('tells screen readers what the search left, after its pause', async () => {
    const user = userEvent.setup();
    renderPage();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    const field = screen.getByRole('textbox', {
      name: 'core:launcher.library.search_in_category',
    });

    await user.type(field, 'brav');
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'core:launcher.library.status_apps_shown'
      )
    );

    await user.clear(field);
    await user.type(field, 'zzz');
    await waitFor(() =>
      expect(status).toHaveTextContent('core:message.generic.no_results')
    );
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('core:filter.status'));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', {
        name: 'core:filter.installed',
      })
    );
    expect(cardNames()).toEqual(['Bravo']);
  });

  it('renders only part of a long category', () => {
    const many = Array.from({ length: 480 }, (_, index) => ({
      name: `game-${index}`,
      service: 'APP',
      metadata: { category: 'GAMING' },
    }));
    renderPage({ availableQapps: many });
    expect(cardNames().length).toBeLessThan(48);
  });

  it('forgets the search when it is hidden', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderPage();
    const field = () =>
      screen.getByRole('textbox', {
        name: 'core:launcher.library.search_in_category',
      });
    await user.type(field(), 'brav');

    rerenderWith({ isShow: false });
    rerenderWith({ isShow: true });
    expect(field()).toHaveValue('');
  });
});

describe('AppsCategoryDesktop, its Featured row', () => {
  // The cards' ratings would ask the node again and replace the test's.
  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const videos = [
    { name: 'Q-Tube', service: 'APP', metadata: { category: 'VIDEO' } },
    { name: 'Clips', service: 'APP', metadata: { category: 'VIDEO' } },
    { name: 'Reels', service: 'APP', metadata: { category: 'VIDEO' } },
    { name: 'Dull', service: 'APP', metadata: { category: 'VIDEO' } },
    { name: 'Tool', service: 'APP', metadata: { category: 'TOOLS' } },
  ];
  const ratings = {
    'Q-Tube': rating(4.6, 20),
    Clips: rating(4, 10),
    Reels: rating(4.2, 5),
    Dull: rating(2.5, 30),
    Tool: rating(5, 30),
  };
  const videoPage = {
    availableQapps: videos,
    category: { id: 'VIDEO', name: 'Video' },
  };

  it("features the category's best rated, official apps too", () => {
    renderPage(videoPage, ratings);
    expect(featuredNames()).toEqual(['Q-Tube', 'Clips', 'Reels']);
    expect(
      within(featuredRow()!).getByText('core:launcher.library.top_rated_hint')
    ).toBeInTheDocument();
  });

  it('features the best of every category on All categories', () => {
    renderPage({ ...videoPage, category: { id: 'all', name: 'All' } }, ratings);
    expect(featuredNames()).toEqual(['Tool', 'Q-Tube', 'Clips', 'Reels']);
  });

  it("opens an app from the row as one of the category's, so Back comes here", async () => {
    const user = userEvent.setup();
    renderPage(videoPage, ratings);
    await user.click(
      within(featuredRow()!).getByRole('button', { name: 'Clips' })
    );
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfoCategory', {
      data: videos[1],
    });
  });

  it('steps aside while a search narrows the list', async () => {
    const user = userEvent.setup();
    renderPage(videoPage, ratings);
    const field = screen.getByRole('textbox', {
      name: 'core:launcher.library.search_in_category',
    });

    await user.type(field, 'cli');
    await waitFor(() => expect(featuredRow()).toBeNull());
    expect(cardNames()).toEqual(['Clips']);

    await user.clear(field);
    await waitFor(() =>
      expect(featuredNames()).toEqual(['Q-Tube', 'Clips', 'Reels'])
    );
  });

  it('has no row where fewer than three apps are rated well', () => {
    renderPage();
    expect(featuredRow()).toBeNull();
    expect(cardNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });
});
