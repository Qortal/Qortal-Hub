import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('../AppCard', () => ({
  AppCardEnhanced: ({ app, view }: { app: any; view: string }) => (
    <div data-testid="card" data-view={view}>
      <button className="libraryDetails">{app.name}</button>
    </div>
  ),
}));

import { AppCollection } from './AppCollection';
import { VIRTUAL_GRID_MIN_ITEMS } from './VirtualAppGrid';
import { libraryViewAtom, type LibraryView } from './libraryView';

const makeApps = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `app-${index}`,
    service: 'APP',
  }));

const renderCollection = (
  props: Partial<React.ComponentProps<typeof AppCollection>> = {},
  view: LibraryView = 'grid'
) => {
  const store = createStore();
  store.set(libraryViewAtom, view);
  render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <AppCollection
          apps={makeApps(5)}
          label="Apps"
          myName="me"
          scrollElement={document.body}
          {...props}
        />
      </ThemeProvider>
    </Provider>
  );
  return store;
};

describe('AppCollection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('draws cards in the grid view and rows in the list view', () => {
    renderCollection();
    expect(screen.getAllByTestId('card')[0]).toHaveAttribute(
      'data-view',
      'grid'
    );
  });

  it('draws rows in the list view', () => {
    renderCollection({}, 'list');
    screen.getAllByTestId('card').forEach((card) => {
      expect(card).toHaveAttribute('data-view', 'list');
    });
  });

  it('is a list that says how long it is', () => {
    renderCollection();
    const list = screen.getByRole('list', { name: 'Apps' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute('aria-posinset', '1');
    expect(items[4]).toHaveAttribute('aria-setsize', '5');
  });

  it.each(['grid', 'list'] as const)(
    'stays virtual for a long library in the %s view',
    (view) => {
      renderCollection({ apps: makeApps(VIRTUAL_GRID_MIN_ITEMS * 10) }, view);
      expect(screen.queryAllByTestId('card').length).toBeLessThan(
        VIRTUAL_GRID_MIN_ITEMS
      );
    }
  );

  it('moves between rows with the arrow keys', () => {
    renderCollection({}, 'list');
    const first = screen.getByRole('button', { name: 'app-0' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'app-1' })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(first).toHaveFocus();

    // Nothing above the first row.
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(first).toHaveFocus();
  });

  it('draws apps its own way when asked to', () => {
    renderCollection({
      renderItem: (app, view, index) => (
        <span>{`${app.name}:${view}:${index}`}</span>
      ),
    });
    expect(screen.getByText('app-2:grid:2')).toBeInTheDocument();
    expect(screen.queryByTestId('card')).not.toBeInTheDocument();
  });
});
