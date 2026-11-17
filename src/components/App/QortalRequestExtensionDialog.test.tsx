import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QortalRequestExtensionDialog } from './QortalRequestExtensionDialog';
import { DECLINE_GUARD_MS } from '../../qortal/permissionPromptQueue';
import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';

type Message = Parameters<typeof QortalRequestExtensionDialog>[0]['message'];

// One request: the same object for as long as it is on screen, as App passes
// the request it shows.
const backendRequest = {
  text1: 'Example Q-App wants to connect to a remote backend.',
  confirmCheckbox: true,
  confirmCheckboxLabel:
    'I understand this Q-App will exchange data with a remote backend outside Qortal Hub.',
};

const renderDialog = (
  message: Message,
  onAccept = vi.fn(),
  onCancel = vi.fn()
) => {
  const ui = (current: Message) => (
    <ThemeProvider theme={darkTheme}>
      <QortalRequestExtensionDialog
        open
        message={current}
        sendPaymentError=""
        confirmRequestRead={false}
        onConfirmRequestReadChange={vi.fn()}
        onCheckbox1Change={vi.fn()}
        onAccept={onAccept}
        onCancel={onCancel}
        onCountdownComplete={vi.fn()}
      />
    </ThemeProvider>
  );
  const view = render(ui(message));
  return {
    onAccept,
    onCancel,
    show: (next: Message) => view.rerender(ui(next)),
  };
};

describe('QortalRequestExtensionDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const waitASecond = () =>
    act(() => {
      vi.advanceTimersByTime(1000);
    });

  it('requires the acknowledgement before accepting', () => {
    const onAccept = vi.fn();

    function Harness() {
      const [confirmed, setConfirmed] = useState(false);
      return (
        <QortalRequestExtensionDialog
          open
          message={backendRequest}
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
    waitASecond();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByText(
        'I understand this Q-App will exchange data with a remote backend outside Qortal Hub.'
      )
    );
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('keeps Accept off for the first second after a request appears', () => {
    const { onAccept } = renderDialog({ text1: 'Send 5 QORT to Alice?' });

    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).not.toHaveBeenCalled();

    waitASecond();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('gives a request that takes the place of another its own second and checkboxes', () => {
    const { onAccept, show } = renderDialog({
      text1: 'Sign in to Example?',
      checkbox1: { label: 'Always allow Example', value: false },
    });
    fireEvent.click(screen.getByLabelText('Always allow Example'));
    expect(screen.getByLabelText('Always allow Example')).toBeChecked();
    waitASecond();

    show({
      text1: 'Send 500 QORT to Mallory?',
      checkbox1: { label: 'Always allow Example', value: false },
    });

    expect(
      screen.getAllByText('Send 500 QORT to Mallory?').length
    ).toBeGreaterThan(0);
    // The tick given to the first request does not carry over.
    expect(screen.getByLabelText('Always allow Example')).not.toBeChecked();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).not.toHaveBeenCalled();

    waitASecond();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('does not take the click that brings Hub back to the front as Accept', () => {
    // The user works in another window over Hub. Hub is not minimized, so
    // its page stays visible.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    // An app in Hub asks meanwhile.
    const { onAccept } = renderDialog({
      text1: 'Send 500 QORT to Q-recipient-address?',
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // The user clicks on Hub's window to bring it to the front: the window
    // gets the focus, then the click goes to what is under the pointer.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).not.toHaveBeenCalled();

    waitASecond();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('ignores Decline for a moment after a request appears', () => {
    const { onCancel } = renderDialog({ text1: 'Send 5 QORT to Alice?' });

    fireEvent.click(screen.getByText('Decline'));
    expect(onCancel).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DECLINE_GUARD_MS);
    });
    fireEvent.click(screen.getByText('Decline'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('counts down only the time a request that waited has left', () => {
    renderDialog({
      text1: 'Sign in to Example?',
      // The app asked 30 s ago: it waits 31 s more, the dialog ends 1 s early.
      expiresAt: Date.now() + 31_000,
    });

    expect(screen.getByText('30')).toBeInTheDocument();
  });
});
