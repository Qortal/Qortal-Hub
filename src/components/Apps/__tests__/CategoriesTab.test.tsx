import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.query !== undefined ? `${key}|${options.query}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => executeEvent(...args),
}));

import { CategoriesTab } from '../AppsLibrary/CategoriesTab';
import { libraryViewAtom } from '../AppsLibrary/libraryView';

const categories = [
  { id: 'TOOLS', name: 'Tools' },
  { id: 'FOOD', name: 'Café and Food' },
  { id: 'PETS', name: 'Pets' },
  { id: 'ART', name: 'Art and Design' },
];

const app = (category?: string) => ({
  name: `app-${Math.random()}`,
  service: 'APP',
  metadata: category ? { category } : {},
});

const apps = [app('TOOLS'), app('TOOLS'), app('ART'), app('FOOD'), app()];

const ALL = 'core:launcher.library.all_categories';

const renderTab = (view: 'grid' | 'list' = 'grid') => {
  const store = createStore();
  store.set(libraryViewAtom, view);
  render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <CategoriesTab availableQapps={apps} categories={categories} />
      </ThemeProvider>
    </Provider>
  );
};

const tileNames = () =>
  within(screen.getByRole('list', { name: 'core:tabs.categories' }))
    .getAllByRole('button')
    .map((button) => button.textContent);

describe('CategoriesTab', () => {
  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
  });

  it('lists all categories first, then the ones with apps, A to Z, with counts', () => {
    renderTab();
    expect(tileNames()).toEqual([
      `${ALL}5`,
      'Art and Design1',
      'Café and Food1',
      'Tools2',
    ]);
    expect(screen.queryByText('Pets')).not.toBeInTheDocument();
  });

  it('narrows the categories as one types, ignoring accents', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.type(
      screen.getByRole('textbox', {
        name: 'core:launcher.library.filter_categories',
      }),
      'cafe'
    );
    expect(tileNames()).toEqual(['Café and Food1']);
  });

  it('says when no category matches', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.type(
      screen.getByRole('textbox', {
        name: 'core:launcher.library.filter_categories',
      }),
      'zzz'
    );
    expect(
      screen.getByText('core:launcher.library.no_category_matches|zzz')
    ).toBeInTheDocument();
  });

  it('opens a category, and all of them from the first tile', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /^Tools/ }));
    expect(executeEvent).toHaveBeenLastCalledWith('selectedCategory', {
      data: { id: 'TOOLS', name: 'Tools' },
    });

    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${ALL}`) })
    );
    expect(executeEvent).toHaveBeenLastCalledWith('selectedCategory', {
      data: { id: 'all', name: 'All' },
    });
  });

  it('uses the page font on its tiles, not the browser’s button font', () => {
    renderTab();
    expect(
      getComputedStyle(screen.getByRole('button', { name: /^Tools/ }))
        .fontFamily
    ).toBe('inherit');
  });

  it('shows rows in the list view', () => {
    renderTab('list');
    const tools = screen.getByRole('button', { name: /^Tools/ });
    expect(
      tools.querySelector('[data-testid="ChevronRightRoundedIcon"]')
    ).not.toBeNull();
  });

  it('waits for the apps before showing any category', () => {
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={createTheme()}>
          <CategoriesTab availableQapps={[]} categories={[]} />
        </ThemeProvider>
      </Provider>
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'core:loading.generic'
    );
  });

  it('still leads to every app when the node sent no categories', async () => {
    const user = userEvent.setup();
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={createTheme()}>
          <CategoriesTab
            availableQapps={apps}
            categories={[]}
            libraryStatus="ready"
          />
        </ThemeProvider>
      </Provider>
    );

    expect(screen.queryByText('core:loading.generic')).toBeNull();
    expect(tileNames()).toEqual([`${ALL}5`]);
    // Nothing to filter with only the one tile.
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${ALL}`) })
    );
    expect(executeEvent).toHaveBeenLastCalledWith('selectedCategory', {
      data: { id: 'all', name: 'All' },
    });
  });

  it('tells screen readers what the filter left, once the typing stops', async () => {
    const user = userEvent.setup();
    renderTab();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');

    const field = screen.getByRole('textbox', {
      name: 'core:launcher.library.filter_categories',
    });
    await user.type(field, 'cafe');
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'core:launcher.library.status_categories_shown'
      )
    );

    await user.clear(field);
    await user.type(field, 'zzz');
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'core:launcher.library.no_category_matches|zzz'
      )
    );
  });

  it('keeps focus in the filter after clearing it', async () => {
    const user = userEvent.setup();
    renderTab();
    const field = screen.getByRole('textbox', {
      name: 'core:launcher.library.filter_categories',
    });
    await user.type(field, 'tools');

    await user.click(
      screen.getByRole('button', { name: 'core:launcher.clear_search' })
    );
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });
});
