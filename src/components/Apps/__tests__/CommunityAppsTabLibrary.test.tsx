import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const renderTab = (
  availableQapps: any[],
  {
    libraryStatus = 'ready',
    statusValue = 'all',
  }: { libraryStatus?: LibraryStatus; statusValue?: any } = {}
) =>
  render(
    <Provider store={createStore()}>
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <CommunityAppsTab
          availableQapps={availableQapps}
          categoryValue="all"
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
