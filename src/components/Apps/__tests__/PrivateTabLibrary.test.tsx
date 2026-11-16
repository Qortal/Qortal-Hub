import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../PublishedPrivateApps', () => ({
  PublishedPrivateApps: ({ refreshKey }: { refreshKey: number }) => (
    <div data-testid="published-list">{`refresh-${refreshKey}`}</div>
  ),
}));

vi.mock('../AppsPrivate', () => ({
  AppsPrivate: ({
    action,
    onPublished,
  }: {
    action: string | null;
    onPublished: () => void;
  }) => (action ? <button onClick={onPublished}>published</button> : null),
}));

import { PrivateTab } from '../AppsLibrary/PrivateTab';

describe('PrivateTab and the library refresh', () => {
  it('reloads the published list when the library is refreshed, and after a publish', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ThemeProvider theme={createTheme()}>
        <PrivateTab libraryRefreshKey={0} myAddress="Qaddress" myName="alice" />
      </ThemeProvider>
    );
    expect(screen.getByTestId('published-list')).toHaveTextContent('refresh-0');

    rerender(
      <ThemeProvider theme={createTheme()}>
        <PrivateTab libraryRefreshKey={2} myAddress="Qaddress" myName="alice" />
      </ThemeProvider>
    );
    expect(screen.getByTestId('published-list')).toHaveTextContent('refresh-2');

    await user.click(screen.getByText('core:action.publish_app'));
    await user.click(screen.getByText('published'));
    expect(screen.getByTestId('published-list')).toHaveTextContent('refresh-3');
  });

  it('puts the actions in a section with a hint', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <PrivateTab myAddress="Qaddress" myName="alice" />
      </ThemeProvider>
    );
    expect(
      screen.getByRole('region', { name: 'core:private_apps.actions_title' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('core:launcher.library.private_actions_hint')
    ).toBeInTheDocument();
  });
});
