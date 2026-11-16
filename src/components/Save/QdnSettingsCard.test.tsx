import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { QdnCardDock, QdnSettingsCard } from './QdnSettingsCard';

const renderCard = (props: Partial<Parameters<typeof QdnSettingsCard>[0]>) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <QdnCardDock page>
        <QdnSettingsCard
          icon={CloudUploadOutlinedIcon}
          open
          title="Save this layout to QDN?"
          {...props}
        />
      </QdnCardDock>
    </ThemeProvider>
  );

describe('QdnSettingsCard', () => {
  it('asks, as a dialog that leaves the page usable', () => {
    const onSave = vi.fn();
    const onLater = vi.fn();
    renderCard({
      primary: { label: 'Save to QDN', onClick: onSave },
      secondary: { label: 'Not now', onClick: onLater },
      text: 'Your side panel, on every device.',
    });

    const dialog = screen.getByRole('dialog', {
      name: 'Save this layout to QDN?',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(dialog).toHaveAccessibleDescription(
      'Your side panel, on every device.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save to QDN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('only says what happened when it has nothing to ask', () => {
    renderCard({ title: 'Restored from QDN.', tone: 'success' });
    expect(screen.getByRole('status')).toHaveTextContent('Restored from QDN.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is not there while closed', () => {
    renderCard({ open: false });
    expect(screen.queryByText('Save this layout to QDN?')).toBeNull();
  });
});
