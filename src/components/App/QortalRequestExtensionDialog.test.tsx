import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QortalRequestExtensionDialog } from './QortalRequestExtensionDialog';
import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';

describe('QortalRequestExtensionDialog confirmation', () => {
  it('requires the acknowledgement before accepting', async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();

    function Harness() {
      const [confirmed, setConfirmed] = useState(false);
      return (
        <QortalRequestExtensionDialog
          open
          message={{
            text1: 'Example Q-App wants to connect to a remote backend.',
            confirmCheckbox: true,
            confirmCheckboxLabel:
              'I understand this Q-App will exchange data with a remote backend outside Qortal Hub.',
          }}
          sendPaymentError=""
          confirmRequestRead={confirmed}
          onConfirmRequestReadChange={setConfirmed}
          onCheckbox1Change={vi.fn()}
          onAccept={onAccept}
          onCancel={vi.fn()}
          onCountdownComplete={vi.fn()}
        />
      );
    }

    render(
      <ThemeProvider theme={darkTheme}>
        <Harness />
      </ThemeProvider>
    );
    await user.click(screen.getByText('Accept'));
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(
      screen.getByText(
        'I understand this Q-App will exchange data with a remote backend outside Qortal Hub.'
      )
    );
    await user.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledOnce();
  });
});
