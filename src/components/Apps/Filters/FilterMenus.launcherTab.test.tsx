import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { LauncherTabShownContext } from '../launcherTabs';
import { CategoryFilter } from './CategoryFilter';
import { SortDropdown } from './SortDropdown';
import { StatusFilter } from './StatusFilter';

const categories = [
  { id: 'GAMING', name: 'Gaming' },
  { id: 'PETS', name: 'Pets' },
];

const inTab = (ui: React.ReactNode, isShown: boolean) => (
  <ThemeProvider theme={createTheme()}>
    <LauncherTabShownContext.Provider value={isShown}>
      {ui}
    </LauncherTabShownContext.Provider>
  </ThemeProvider>
);

// A launcher tab stays mounted while another tab shows. A menu it opened is
// a portal, outside the hidden tab: it has to step aside by itself.
describe('the library filters in a hidden launcher tab', () => {
  it.each([
    [
      'Sort',
      <SortDropdown key="sort" onChange={vi.fn()} value="newest" />,
      'core:filter.sort_by',
      'menu',
    ],
    [
      'Status',
      <StatusFilter key="status" onChange={vi.fn()} value="all" />,
      'core:filter.status',
      'menu',
    ],
  ] as const)(
    'puts the %s menu away with the tab, and shows it again with it',
    async (_name, filter, label, role) => {
      const user = userEvent.setup();
      const { rerender } = render(inTab(filter, true));

      await user.click(screen.getByLabelText(label));
      expect(await screen.findByRole(role)).toBeVisible();

      rerender(inTab(filter, false));
      await waitFor(() => expect(screen.queryByRole(role)).toBeNull());

      rerender(inTab(filter, true));
      expect(await screen.findByRole(role)).toBeVisible();
    }
  );

  it('keeps what was typed in the category search while the tab is hidden', async () => {
    const user = userEvent.setup();
    const filter = (
      <CategoryFilter categories={categories} onChange={vi.fn()} value="all" />
    );
    const { rerender } = render(inTab(filter, true));

    await user.click(screen.getByLabelText('core:filter.category'));
    const search = await screen.findByRole('combobox', {
      name: 'core:launcher.library.search_categories',
    });
    await user.type(search, 'pe');

    rerender(inTab(filter, false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    rerender(inTab(filter, true));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(
      screen.getByRole('combobox', {
        name: 'core:launcher.library.search_categories',
      })
    ).toHaveValue('pe');
  });
});
