import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  props: Partial<React.ComponentProps<typeof AppsCategoryDesktop>> = {}
) => {
  const store = createStore();
  store.set(
    ratingsStoreAtom,
    new Map([
      [getCacheKey('Alpha', 'APP'), rating(2, 10)],
      [getCacheKey('Charlie', 'APP'), rating(5, 10)],
      [getCacheKey('Bravo', 'APP'), rating(4, 10)],
    ])
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
