import { describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.query !== undefined ? `${key}|${options.query}` : key,
    i18n: { language: 'en' },
  }),
}));

import { CategoryFilter } from './CategoryFilter';

const categories = [
  { id: 'GAMING', name: 'Gaming' },
  { id: 'CRYPTOCURRENCY', name: 'Cryptocurrency and Blockchain' },
  { id: 'SELF_SUFFICIENCY', name: 'Self-Sufficiency and Homesteading' },
  { id: 'PETS', name: 'Pets' },
  { id: 'ART', name: 'Art and Design' },
];

const counts = {
  total: 20,
  byId: new Map([
    ['GAMING', 5],
    ['CRYPTOCURRENCY', 7],
    ['SELF_SUFFICIENCY', 1],
    ['ART', 2],
  ]),
};

const SEARCH = 'core:launcher.library.search_categories';

const renderFilter = (value = 'all', onChange = vi.fn()) => {
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
      <CategoryFilter
        categories={categories}
        counts={counts}
        onChange={onChange}
        value={value}
      />
    </ThemeProvider>
  );
  return onChange;
};

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByLabelText('core:filter.category'));
  const input = await screen.findByRole('combobox', { name: SEARCH });
  await waitFor(() => expect(input).toHaveFocus());
  return input;
};

const optionNames = () =>
  screen
    .getAllByRole('option')
    .map((option) => option.textContent?.replace(/\d+$/, ''));

describe('CategoryFilter', () => {
  it('opens a dialog with the search field focused', async () => {
    const user = userEvent.setup();
    renderFilter();
    const pill = screen.getByLabelText('core:filter.category');
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog');
    // Named by the label and the value, so the name holds the text on screen
    // also where a narrow bar hides the label.
    expect(pill).toHaveAccessibleName(
      'core:filter.category core:launcher.library.all_categories'
    );

    await open(user);
    expect(
      screen.getByRole('dialog', { name: 'core:filter.category' })
    ).toBeInTheDocument();
  });

  it('lists all categories first, then the ones with apps, A to Z, with counts', async () => {
    const user = userEvent.setup();
    renderFilter();
    await open(user);

    expect(optionNames()).toEqual([
      'core:launcher.library.all_categories',
      'Art and Design',
      'Cryptocurrency and Blockchain',
      'Gaming',
      'Self-Sufficiency and Homesteading',
    ]);
    expect(
      screen.getByRole('option', { name: /Cryptocurrency and Blockchain/ })
    ).toHaveTextContent('7');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('20');
  });

  it('narrows the list as one types, by name or by id', async () => {
    const user = userEvent.setup();
    renderFilter();
    const input = await open(user);

    await user.type(input, 'crypt');
    expect(optionNames()).toEqual(['Cryptocurrency and Blockchain']);

    await user.clear(input);
    await user.type(input, 'self suff');
    expect(optionNames()).toEqual(['Self-Sufficiency and Homesteading']);
  });

  it('picks the first match with Enter and closes', async () => {
    const user = userEvent.setup();
    const onChange = renderFilter();
    const input = await open(user);

    await user.type(input, 'crypt');
    // Closing gives focus back to the pill in an effect after the key.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onChange).toHaveBeenCalledWith('CRYPTOCURRENCY');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('closes when the category already chosen is picked again', async () => {
    const user = userEvent.setup();
    const onChange = renderFilter('GAMING');
    await open(user);

    await user.click(screen.getByRole('option', { name: /Gaming/ }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Enter right after opening, which picks the current one', async () => {
    const user = userEvent.setup();
    const onChange = renderFilter();
    const input = await open(user);

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can be given focus from outside', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <ThemeProvider theme={createTheme()}>
        <CategoryFilter
          buttonRef={ref}
          categories={categories}
          onChange={vi.fn()}
          value="all"
        />
      </ThemeProvider>
    );
    expect(ref.current).toBe(screen.getByLabelText('core:filter.category'));
  });

  it('closes with Escape and gives focus back to the pill', async () => {
    const user = userEvent.setup();
    const onChange = renderFilter();
    await open(user);

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(screen.getByLabelText('core:filter.category')).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    renderFilter();
    const input = await open(user);

    await user.type(input, 'zzz');

    expect(
      screen.getByText('core:launcher.library.no_category_matches|zzz')
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('keeps the chosen category listed, also when it has no apps', async () => {
    const user = userEvent.setup();
    renderFilter('PETS');
    expect(screen.getByLabelText('core:filter.category')).toHaveAccessibleName(
      'core:filter.category Pets'
    );
    await open(user);

    const pets = screen.getByRole('option', { name: /Pets/ });
    expect(pets).toHaveAttribute('aria-selected', 'true');
  });
});
