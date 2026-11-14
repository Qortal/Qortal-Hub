import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../PublishedPrivateApps', () => ({
  PublishedPrivateApps: ({
    refreshKey,
    onUpdate,
  }: {
    refreshKey: number;
    onUpdate: (app: unknown) => void;
  }) => (
    <div data-testid="published-list">
      {`refresh-${refreshKey}`}
      <button
        onClick={() =>
          onUpdate({
            name: 'alice',
            identifier: 'q-notes',
            service: 'DOCUMENT',
            groupId: 42,
            timestamp: null,
          })
        }
      >
        update-q-notes
      </button>
    </div>
  ),
}));

vi.mock('../AppsPrivate', () => ({
  AppsPrivate: ({
    action,
    updateTarget,
    onClose,
    onPublished,
  }: {
    action: string | null;
    updateTarget: { identifier: string } | null;
    onClose: () => void;
    onPublished: () => void;
  }) =>
    action ? (
      <div data-testid="private-dialog">
        {action}
        {updateTarget ? `:${updateTarget.identifier}` : ''}
        <button onClick={onClose}>close-dialog</button>
        <button onClick={onPublished}>published</button>
      </div>
    ) : null,
}));

import { PrivateTab } from '../AppsLibrary/PrivateTab';

const renderTab = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <PrivateTab myName="alice" myAddress="Qaddress" />
    </ThemeProvider>
  );

describe('PrivateTab', () => {
  it('shows the published list with both actions and no dialog', () => {
    renderTab();

    expect(screen.getByTestId('published-list')).toBeInTheDocument();
    expect(screen.getByText('core:action.access_app')).toBeInTheDocument();
    expect(screen.getByText('core:action.publish_app')).toBeInTheDocument();
    expect(screen.queryByTestId('private-dialog')).not.toBeInTheDocument();
  });

  it('opens the dialog for the chosen action and closes it', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText('core:action.access_app'));
    expect(screen.getByTestId('private-dialog')).toHaveTextContent('access');

    await user.click(screen.getByText('close-dialog'));
    expect(screen.queryByTestId('private-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByText('core:action.publish_app'));
    expect(screen.getByTestId('private-dialog')).toHaveTextContent('publish');
  });

  it('opens the update dialog for an app in the list, and forgets it on close', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText('update-q-notes'));
    expect(screen.getByTestId('private-dialog')).toHaveTextContent(
      'update:q-notes'
    );

    await user.click(screen.getByText('close-dialog'));
    await user.click(screen.getByText('core:action.publish_app'));
    expect(screen.getByTestId('private-dialog')).toHaveTextContent(/^publish/);
    expect(screen.getByTestId('private-dialog')).not.toHaveTextContent(
      'q-notes'
    );
  });

  it('refreshes the published list after a publish', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText('core:action.publish_app'));
    await user.click(screen.getByText('published'));

    expect(screen.getByTestId('published-list')).toHaveTextContent('refresh-1');
  });
});
