import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The tabs show what the library hands them.
vi.mock('../AppsLibrary', () => {
  const tabs = [
    'official',
    'community',
    'categories',
    'widgets',
    'my-apps',
    'private',
  ];
  return {
    AppsTabs: ({
      currentTab,
      idPrefix,
      onTabChange,
    }: {
      currentTab: string;
      idPrefix?: string;
      onTabChange: (tab: string) => void;
    }) => (
      <div role="tablist">
        {tabs.map((tab) => (
          <button
            aria-selected={tab === currentTab}
            id={`${idPrefix}-tab-${tab}`}
            key={tab}
            onClick={() => onTabChange(tab)}
            role="tab"
          >
            {tab}
          </button>
        ))}
      </div>
    ),
    OfficialAppsTab: ({ libraryStatus }: { libraryStatus: string }) => (
      <div>{`official ${libraryStatus}`}</div>
    ),
    CommunityAppsTab: ({
      categoryValue,
      statusValue,
      sortValue,
    }: Record<string, string>) => (
      <div data-testid="community">{`${categoryValue}|${statusValue}|${sortValue}`}</div>
    ),
    CategoriesTab: () => <div>categories</div>,
    WidgetsTab: ({
      libraryRefreshKey,
      sortValue,
    }: {
      libraryRefreshKey: number;
      sortValue: string;
    }) => (
      <div data-testid="widgets">{`${sortValue}|${libraryRefreshKey}`}</div>
    ),
    MyAppsTab: ({ libraryRefreshKey }: { libraryRefreshKey: number }) => (
      <div>{`my-apps ${libraryRefreshKey}`}</div>
    ),
    PrivateTab: ({ libraryRefreshKey }: { libraryRefreshKey: number }) => (
      <div>{`private ${libraryRefreshKey}`}</div>
    ),
  };
});

import { LauncherLibrary } from './LauncherLibrary';
import { LIBRARY_VIEW_STORAGE_KEY } from '../AppsLibrary/libraryLayout';

const REFRESH = 'core:action.refetch_apps_websites_list';
const LIST = 'core:launcher.library.view_list';

const Library = ({
  apps = [{ name: 'Chess', service: 'APP' }],
  getQapps,
  initialTab = 'official',
}: {
  apps?: any[];
  getQapps?: () => Promise<void>;
  initialTab?: string;
}) => {
  const [tab, setTab] = useState(initialTab);
  return (
    <LauncherLibrary
      availableQapps={apps}
      categories={[{ id: 'GAMING', name: 'Gaming' }]}
      currentTab={tab as never}
      getQapps={getQapps}
      isActive
      myAddress="Qme"
      myName="me"
      onTabChange={setTab}
      scrollElement={null}
      setMode={vi.fn()}
      stickyTop={82}
    />
  );
};

const renderLibrary = (props: Parameters<typeof Library>[0] = {}) =>
  render(
    <Provider store={createStore()}>
      <ThemeProvider theme={createTheme()}>
        <Library {...props} />
      </ThemeProvider>
    </Provider>
  );

describe('LauncherLibrary', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the grid/list toggle on every tab, and remembers the list', async () => {
    const user = userEvent.setup();
    renderLibrary();

    for (const tab of [
      'official',
      'community',
      'categories',
      'widgets',
      'my-apps',
      'private',
    ]) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('button', { name: LIST })).toBeVisible();
    }

    await user.click(screen.getByRole('button', { name: LIST }));
    expect(localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY)).toBe('list');
  });

  it('turns the refresh button until the node answers, once per press', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const getQapps = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    // The node has sent nothing yet: still loading, until a refresh ends.
    renderLibrary({ apps: [], getQapps });
    expect(screen.getByText('official loading')).toBeInTheDocument();

    const refresh = screen.getByRole('button', { name: REFRESH });
    await user.click(refresh);
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    await user.click(refresh);
    expect(getQapps).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() =>
      expect(screen.getByText('official empty')).toBeInTheDocument()
    );
  });

  it('asks My apps and Private to reload with the library', async () => {
    const user = userEvent.setup();
    renderLibrary({ getQapps: vi.fn(async () => {}) });

    await user.click(screen.getByRole('tab', { name: 'my-apps' }));
    expect(screen.getByText('my-apps 0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: REFRESH }));
    expect(await screen.findByText('my-apps 1')).toBeInTheDocument();
  });

  it('clears the category and status filters, keeping the sort', async () => {
    const user = userEvent.setup();
    renderLibrary({ initialTab: 'community' });
    const community = () => screen.getByTestId('community');
    expect(community()).toHaveTextContent('all|all|highest_rated');
    expect(
      screen.queryByRole('button', {
        name: 'core:launcher.library.clear_filters',
      })
    ).toBeNull();

    await user.click(screen.getByLabelText('core:filter.sort_by'));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', {
        name: 'core:sort.newest',
      })
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await user.click(screen.getByLabelText('core:filter.status'));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', {
        name: 'core:filter.installed',
      })
    );
    expect(community()).toHaveTextContent('all|installed|newest');

    await user.click(
      screen.getByRole('button', {
        name: 'core:launcher.library.clear_filters',
      })
    );
    expect(community()).toHaveTextContent('all|all|newest');
    // The button is gone now; focus stays in the bar instead of falling back
    // to the top of the page.
    expect(
      screen.queryByRole('button', {
        name: 'core:launcher.library.clear_filters',
      })
    ).toBeNull();
    expect(screen.getByLabelText('core:filter.category')).toHaveFocus();
  });

  it('clears the filters from the keyboard, keeping focus in the bar', async () => {
    const user = userEvent.setup();
    renderLibrary({ initialTab: 'community' });

    await user.click(screen.getByLabelText('core:filter.status'));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', {
        name: 'core:filter.installed',
      })
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const clear = screen.getByRole('button', {
      name: 'core:launcher.library.clear_filters',
    });
    clear.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('community')).toHaveTextContent('all|all|');
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByLabelText('core:filter.category')).toHaveFocus();
  });

  it('sorts the widgets like the community apps, without their filters, and reloads them', async () => {
    const user = userEvent.setup();
    renderLibrary({ getQapps: vi.fn(async () => {}) });

    await user.click(screen.getByRole('tab', { name: 'widgets' }));
    const widgets = () => screen.getByTestId('widgets');
    expect(widgets()).toHaveTextContent('highest_rated|0');
    // A sort, but none of Community's filters.
    expect(screen.getByLabelText('core:filter.sort_by')).toBeVisible();
    expect(screen.queryByLabelText('core:filter.category')).toBeNull();
    expect(screen.queryByLabelText('core:filter.status')).toBeNull();

    await user.click(screen.getByLabelText('core:filter.sort_by'));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', {
        name: 'core:sort.newest',
      })
    );
    expect(widgets()).toHaveTextContent('newest|0');

    await user.click(screen.getByRole('button', { name: REFRESH }));
    expect(widgets()).toHaveTextContent('newest|1');

    // The sort is one preference: Community has it too.
    await user.click(screen.getByRole('tab', { name: 'community' }));
    expect(screen.getByTestId('community')).toHaveTextContent('all|all|newest');
  });

  it('links each panel to its tab', () => {
    renderLibrary();
    const panel = screen.getByRole('tabpanel');
    const tab = screen.getByRole('tab', { name: 'official' });
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(panel.id).toBe(tab.id.replace('-tab-', '-panel-'));
  });
});
