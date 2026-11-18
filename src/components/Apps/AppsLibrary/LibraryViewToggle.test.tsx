import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { LIBRARY_VIEW_STORAGE_KEY } from './libraryLayout';
import { libraryViewAtom } from './libraryView';
import { LibraryViewToggle } from './LibraryViewToggle';

const GRID = 'core:launcher.library.view_grid';
const LIST = 'core:launcher.library.view_list';

const renderToggles = (count = 1) => {
  const store = createStore();
  render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        {Array.from({ length: count }, (_, index) => (
          <LibraryViewToggle key={index} />
        ))}
      </ThemeProvider>
    </Provider>
  );
  return store;
};

describe('LibraryViewToggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers grid and list, with grid chosen at first', () => {
    renderToggles();

    expect(
      screen.getByRole('group', { name: 'core:launcher.library.view_label' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GRID })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: LIST })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('switches to the list and remembers it on this device', async () => {
    const user = userEvent.setup();
    const store = renderToggles();

    await user.click(screen.getByRole('button', { name: LIST }));

    expect(store.get(libraryViewAtom)).toBe('list');
    expect(localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY)).toBe('list');
    expect(screen.getByRole('button', { name: LIST })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps every toggle in step', async () => {
    const user = userEvent.setup();
    renderToggles(2);

    await user.click(screen.getAllByRole('button', { name: LIST })[0]);

    screen.getAllByRole('button', { name: LIST }).forEach((button) => {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });
    // Choosing the chosen view again does not unset it.
    await user.click(screen.getAllByRole('button', { name: LIST })[1]);
    expect(screen.getAllByRole('button', { name: LIST })[1]).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
