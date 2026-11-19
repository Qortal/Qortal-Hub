import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
}));

// Only whether the grid is told to measure matters here.
vi.mock('../AppsLibrary/AppCollection', () => ({
  AppCollection: ({ active }: { active?: boolean }) => (
    <div data-active={String(active)} data-testid="collection" />
  ),
}));

import { AppsCategoryDesktop } from '../AppsCategoryDesktop';
import { LauncherTabShownContext } from '../launcherTabs';

const games = [
  { name: 'Alpha', service: 'APP', metadata: { category: 'GAMING' } },
  { name: 'Bravo', service: 'APP', metadata: { category: 'GAMING' } },
];

const renderInTab = () => {
  const store = createStore();
  const ui = (isTabShown: boolean) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <LauncherTabShownContext.Provider value={isTabShown}>
          <AppsCategoryDesktop
            availableQapps={games}
            category={{ id: 'GAMING', name: 'Gaming' }}
            isShow
            myName="me"
          />
        </LauncherTabShownContext.Provider>
      </ThemeProvider>
    </Provider>
  );
  const result = render(ui(true));
  return { showTab: (isTabShown: boolean) => result.rerender(ui(isTabShown)) };
};

const isGridActive = () =>
  screen.getByTestId('collection').getAttribute('data-active');

// A launcher tab stays mounted while another tab shows, with display: none.
// A grid that kept measuring there would lay itself out at width 0.
describe('the category page in a hidden launcher tab', () => {
  it('stops its grid while the tab is hidden, and starts it again with it', () => {
    const { showTab } = renderInTab();
    expect(isGridActive()).toBe('true');

    showTab(false);
    expect(isGridActive()).toBe('false');

    showTab(true);
    expect(isGridActive()).toBe('true');
  });

  it('keeps its search while the tab is hidden', async () => {
    const user = userEvent.setup();
    const { showTab } = renderInTab();
    const field = () =>
      screen.getByRole('textbox', {
        name: 'core:launcher.library.search_in_category',
      });
    await user.type(field(), 'brav');

    showTab(false);
    showTab(true);
    expect(field()).toHaveValue('brav');
  });
});
