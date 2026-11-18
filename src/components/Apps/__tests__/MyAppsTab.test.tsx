import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Provider, createStore } from 'jotai';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../AppCard', () => ({
  PublishedAppCard: ({
    app,
    onUpdate,
  }: {
    app: { name: string; service: string };
    onUpdate: () => void;
  }) => (
    <button onClick={onUpdate}>{`update ${app.service} ${app.name}`}</button>
  ),
}));

import { MyAppsTab } from '../AppsLibrary/MyAppsTab';
import { userInfoAtom } from '../../../atoms/global';

const availableQapps = [
  { name: 'alice', service: 'APP' },
  { name: 'alice', service: 'WEBSITE' },
  { name: 'bob', service: 'APP' },
];

describe('MyAppsTab', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ name: 'alice' }],
    })) as unknown as typeof fetch;
  });

  const renderTab = () => {
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme' });
    const setMode = vi.fn();
    render(
      <Provider store={store}>
        <ThemeProvider theme={createTheme()}>
          <MyAppsTab
            availableQapps={availableQapps}
            myName="alice"
            setMode={setMode}
          />
        </ThemeProvider>
      </Provider>
    );
    return { setMode };
  };

  it("offers Update only on the account's own apps and websites", async () => {
    const user = userEvent.setup();
    const { setMode } = renderTab();

    expect(await screen.findByText('update APP alice')).toBeInTheDocument();
    expect(screen.getByText('update WEBSITE alice')).toBeInTheDocument();
    expect(screen.queryByText('update APP bob')).not.toBeInTheDocument();

    // What to update goes with the page, to the launcher tab it opens in.
    await user.click(screen.getByText('update WEBSITE alice'));
    expect(setMode).toHaveBeenCalledWith('publish', {
      name: 'alice',
      service: 'WEBSITE',
    });
  });

  it('opens "publish new" with nothing locked', async () => {
    const user = userEvent.setup();
    const { setMode } = renderTab();
    await user.click(await screen.findByText('update APP alice'));

    await user.click(screen.getByText('core:developer.publish_app'));
    expect(setMode).toHaveBeenLastCalledWith('publish-app');
  });
});
