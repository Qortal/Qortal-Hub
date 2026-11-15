import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const executeEvent = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => executeEvent(...args),
}));

vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({ rating: null, containerRef: { current: null } }),
}));

import { MyAppsTab } from '../AppsLibrary/MyAppsTab';
import { userInfoAtom } from '../../../atoms/global';

const availableQapps = [
  { name: 'alice', service: 'APP', status: { status: 'READY' } },
  { name: 'alice', service: 'WEBSITE', metadata: { title: 'Alice site' } },
  { name: 'bob', service: 'APP' },
];

const mockNames = (names: string[]) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => names.map((name) => ({ name })),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const renderTab = (
  props: Partial<React.ComponentProps<typeof MyAppsTab>> = {}
) => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'Qme' } as never);
  const setMode = vi.fn();
  const ui = (extra: Partial<React.ComponentProps<typeof MyAppsTab>>) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <MyAppsTab
          availableQapps={availableQapps}
          myName="alice"
          setMode={setMode}
          {...props}
          {...extra}
        />
      </ThemeProvider>
    </Provider>
  );
  const result = render(ui({}));
  return {
    setMode,
    rerenderWith: (extra: Partial<React.ComponentProps<typeof MyAppsTab>>) =>
      result.rerender(ui(extra)),
  };
};

describe('MyAppsTab in the library', () => {
  beforeEach(() => {
    executeEvent.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the account’s own app and website with Open, Pin and Update', async () => {
    mockNames(['alice']);
    renderTab();

    // The placeholder section has the same title until the names load.
    await screen.findByRole('article', { name: 'alice' });
    const apps = screen.getByRole('region', {
      name: 'core:developer.your_published_apps',
    });
    const app = within(apps).getByRole('article', { name: 'alice' });
    expect(
      within(app).getByRole('button', { name: 'core:action.open' })
    ).toBeInTheDocument();
    expect(
      within(app).getByRole('button', { name: 'core:action.pin' })
    ).toBeInTheDocument();
    expect(
      within(app).getByRole('button', { name: 'core:developer.update' })
    ).toBeInTheDocument();

    const sites = screen.getByRole('region', {
      name: 'core:developer.your_published_websites',
    });
    expect(
      within(sites).getByRole('article', { name: 'Alice site' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'bob' })).toBeNull();
  });

  it('counts each section', async () => {
    mockNames(['alice']);
    renderTab();

    // The placeholder section has the same title until the names load.
    await screen.findByRole('article', { name: 'alice' });
    const apps = screen.getByRole('region', {
      name: 'core:developer.your_published_apps',
    });
    expect(within(apps).getByRole('list')).toHaveAttribute(
      'aria-label',
      'core:developer.your_published_apps'
    );
    expect(within(apps).getAllByRole('listitem')).toHaveLength(1);
    expect(within(apps).getByText('1')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says so when a name has no apps or websites yet', async () => {
    mockNames(['carol']);
    renderTab();

    expect(
      await screen.findByText('core:developer.no_apps_yet')
    ).toBeInTheDocument();
    expect(screen.getByText('core:developer.no_sites_yet')).toBeInTheDocument();
  });

  it('opens the publish form for an Update', async () => {
    const user = userEvent.setup();
    mockNames(['alice']);
    const { setMode } = renderTab();

    // The placeholder section has the same title until the names load.
    await screen.findByRole('article', { name: 'alice' });
    const apps = screen.getByRole('region', {
      name: 'core:developer.your_published_apps',
    });
    await user.click(
      within(apps).getByRole('button', { name: 'core:developer.update' })
    );
    expect(setMode).toHaveBeenCalledWith('publish');
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('asks an account without a name to register one', async () => {
    const user = userEvent.setup();
    mockNames([]);
    renderTab();

    expect(
      await screen.findByText('core:message.generic.name_publish')
    ).toBeInTheDocument();
    expect(
      screen.getByText('core:launcher.library.no_name_text')
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'core:action.register_name' })
    );
    expect(executeEvent).toHaveBeenCalledWith('openRegisterName', {});
  });

  it('reloads the names when the library is refreshed, keeping the apps on screen', async () => {
    const fetchMock = mockNames(['alice']);
    const { rerenderWith } = renderTab({ libraryRefreshKey: 0 });
    await screen.findByRole('article', { name: 'alice' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerenderWith({ libraryRefreshKey: 1 });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'alice' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
