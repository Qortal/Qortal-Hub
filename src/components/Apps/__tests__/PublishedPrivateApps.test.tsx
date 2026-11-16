import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const { openApp } = vi.hoisted(() => ({ openApp: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp }),
}));

import { PublishedPrivateApps } from '../PublishedPrivateApps';

const marker = (groupId: number) => ({
  description: `qortal-hub-private-app;groupId=${groupId}`,
});

describe('PublishedPrivateApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/names/address/')
          ? [{ name: 'Alice' }]
          : [
              {
                name: 'Alice',
                identifier: 'q-notes',
                service: 'DOCUMENT',
                metadata: marker(42),
              },
              // Not one of the account's names.
              {
                name: 'bob',
                identifier: 'bob-app',
                service: 'DOCUMENT',
                metadata: marker(7),
              },
            ],
    })) as unknown as typeof fetch;
  });

  const renderList = (onUpdate?: () => void) =>
    render(
      <ThemeProvider theme={createTheme()}>
        <PublishedPrivateApps myAddress="Qme" onUpdate={onUpdate} />
      </ThemeProvider>
    );

  it("offers Update only on the account's own apps", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderList(onUpdate);

    expect(await screen.findByText('q-notes')).toBeInTheDocument();
    expect(screen.getByText('bob-app')).toBeInTheDocument();
    const updates = screen.getAllByRole('button', {
      name: 'core:developer.update',
    });
    expect(updates).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'core:action.open' })
    ).toHaveLength(2);

    await user.click(updates[0]);
    expect(onUpdate).toHaveBeenCalledWith({
      name: 'Alice',
      identifier: 'q-notes',
      service: 'DOCUMENT',
      groupId: 42,
      timestamp: null,
    });
  });

  it('shows no Update where nothing can open it', async () => {
    renderList();
    expect(await screen.findByText('q-notes')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'core:developer.update' })
    ).not.toBeInTheDocument();
  });
});
