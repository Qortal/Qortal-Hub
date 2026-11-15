import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

vi.mock('../AppCard', () => ({
  AppCardEnhanced: ({ app }: { app: any }) => (
    <div data-testid="app-card">{app.name}</div>
  ),
}));

import { CommunityAppsTab } from '../AppsLibrary/CommunityAppsTab';
import type { LibraryStatus } from '../AppsLibrary/useLibraryStatus';
import { getCacheKey, ratingsStoreAtom } from '../../../hooks/useAppRatings';

const rating = (averageRating: number, totalVotes: number) => ({
  averageRating,
  totalVotes,
  voteCounts: [],
  hasPublishedRating: true,
  pollInfo: null,
  lastFetched: 0,
});

const renderTab = (
  availableQapps: any[],
  {
    libraryStatus = 'ready',
    statusValue = 'all',
    categoryValue = 'all',
    ratings = {},
  }: {
    libraryStatus?: LibraryStatus;
    statusValue?: any;
    categoryValue?: string;
    /** By `SERVICE name`. */
    ratings?: Record<string, ReturnType<typeof rating>>;
  } = {}
) => {
  const store = createStore();
  store.set(
    ratingsStoreAtom,
    new Map(
      Object.entries(ratings).map(([key, value]) => {
        const [service, ...name] = key.split(' ');
        return [getCacheKey(name.join(' '), service), value];
      })
    )
  );
  return render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <CommunityAppsTab
          availableQapps={availableQapps}
          categoryValue={categoryValue}
          libraryStatus={libraryStatus}
          myName="me"
          onClearFilters={vi.fn()}
          searchValue=""
          sortValue="alphabetical"
          statusValue={statusValue}
        />
      </ThemeProvider>
    </Provider>
  );
};

/** The Featured row's apps, in order; null without the row. */
const featuredNames = () => {
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

describe('CommunityAppsTab', () => {
  it('waits while the node has sent nothing yet', () => {
    renderTab([], { libraryStatus: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'core:loading.generic'
    );
  });

  it('says so when the node sent only official apps, instead of loading for ever', () => {
    renderTab([{ name: 'Q-Mail', service: 'APP' }]);
    expect(screen.queryByText('core:loading.generic')).toBeNull();
    expect(
      screen.getByText('core:message.generic.no_results')
    ).toBeInTheDocument();
  });

  it('tells screen readers what a filter left', () => {
    renderTab(
      [
        { name: 'Chess', service: 'APP', status: { status: 'READY' } },
        { name: 'Notes', service: 'APP' },
      ],
      { statusValue: 'installed' }
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'core:launcher.library.status_apps_shown'
    );
    expect(screen.getAllByTestId('app-card')).toHaveLength(1);
  });

  it('says nothing while no filter is set', () => {
    renderTab([{ name: 'Chess', service: 'APP' }]);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});

describe('CommunityAppsTab, its Featured row', () => {
  // The cards' ratings would ask the node again and replace the test's.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const apps = [
    { name: 'Q-Tube', service: 'APP', metadata: { category: 'VIDEO' } },
    { name: 'Chess', service: 'APP', metadata: { category: 'GAMING' } },
    { name: 'Go', service: 'APP', metadata: { category: 'GAMING' } },
    { name: 'Poker', service: 'APP', metadata: { category: 'GAMING' } },
    { name: 'Blog', service: 'WEBSITE', metadata: { category: 'NEWS' } },
  ];
  const ratings = {
    'APP Q-Tube': rating(5, 50),
    'APP Chess': rating(4.5, 10),
    'APP Go': rating(4, 10),
    'APP Poker': rating(3.5, 10),
    'WEBSITE Blog': rating(4.8, 10),
  };

  it("shows the community's best rated, without the official apps, and says who rated them", () => {
    renderTab(apps, { ratings });
    expect(featuredNames()).toEqual(['Blog', 'Chess', 'Go', 'Poker']);
    const row = screen.getByRole('region', {
      name: 'core:official_apps.featured',
    });
    expect(
      within(row).getByText('core:launcher.library.top_rated_hint')
    ).toBeInTheDocument();
  });

  it('follows the category and status filters', () => {
    const { unmount } = renderTab(apps, { categoryValue: 'GAMING', ratings });
    expect(featuredNames()).toEqual(['Chess', 'Go', 'Poker']);
    unmount();

    renderTab(apps, { ratings, statusValue: 'installed' });
    expect(featuredNames()).toBeNull();
  });

  it('leaves the row out while fewer than three apps are rated well', () => {
    renderTab(apps, {
      ratings: {
        'APP Chess': rating(4.5, 10),
        'APP Go': rating(3, 10),
        'WEBSITE Blog': rating(4.8, 10),
      },
    });
    expect(featuredNames()).toBeNull();
    expect(screen.getAllByTestId('app-card')).toHaveLength(4);
  });
});
