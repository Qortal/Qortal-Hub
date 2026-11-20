import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QortalRequestExtensionDialog } from './QortalRequestExtensionDialog';
import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';

type Message = Parameters<typeof QortalRequestExtensionDialog>[0]['message'];

const OPENED_APP = { name: 'Opened-App', service: 'APP' };
const ENDED_AT = new Date(2026, 10, 18, 12, 0, 0).getTime();

const usedUp = {
  text1: 'Do you give this application permission to publish to QDN?',
  fee: '0.01',
  requestingApp: OPENED_APP,
  budget: {
    state: 'used_up',
    used: '1',
    total: '1',
    endedAt: null,
    limits: 'higher',
    fee: '0.01',
    count: 1,
  },
} as Message;

const ended = {
  ...usedUp,
  budget: {
    ...(usedUp as { budget: object }).budget,
    state: 'ended',
    used: '0.4',
    endedAt: ENDED_AT,
  },
} as Message;

const atLimit = {
  ...usedUp,
  budget: {
    ...(usedUp as { budget: object }).budget,
    state: 'limit',
    used: '0.2',
    limit: { per: 'minute', max: 20 },
  },
} as Message;

const renderDialog = (message: Message) => {
  const onAccept = vi.fn();
  const onAcceptWithTopUp = vi.fn();
  const onCancel = vi.fn();
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
        onAcceptWithTopUp={onAcceptWithTopUp}
        onCancel={onCancel}
        onCountdownComplete={vi.fn()}
      />
    </ThemeProvider>
  );
  const view = render(ui(message));
  return {
    onAccept,
    onAcceptWithTopUp,
    onCancel,
    show: (next: Message) => view.rerender(ui(next)),
  };
};

const waitASecond = () =>
  act(() => {
    vi.advanceTimersByTime(1000);
  });

const topUpButton = () => screen.getByText('Top up and approve');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the approval window when an app budget is used up or ended', () => {
  it('offers to top up, or to approve just this one, or to decline', () => {
    const { onAccept, onAcceptWithTopUp, onCancel } = renderDialog(usedUp);
    expect(screen.getByText('Budget used up')).toBeTruthy();
    expect(
      screen.getByText(/Opened-App has used 1 of its 1 QORT/)
    ).toBeTruthy();
    expect(screen.getByText('Approve this one only')).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
    waitASecond();

    fireEvent.click(screen.getByText('5 QORT'));
    fireEvent.click(screen.getByText('No end date'));
    fireEvent.click(topUpButton());
    expect(onAcceptWithTopUp).toHaveBeenCalledWith({
      amount: '5',
      end: { kind: 'never' },
      // The budget's own limits to start with.
      limits: 'higher',
    });
    expect(onAccept).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('waits a second before Top up and approve takes a click, like Accept', () => {
    const { onAcceptWithTopUp } = renderDialog(usedUp);
    fireEvent.click(topUpButton());
    expect(onAcceptWithTopUp).not.toHaveBeenCalled();
    waitASecond();
    fireEvent.click(topUpButton());
    expect(onAcceptWithTopUp).toHaveBeenCalledTimes(1);
  });

  it('approves just this one without a top-up', () => {
    const { onAccept, onAcceptWithTopUp } = renderDialog(usedUp);
    waitASecond();
    fireEvent.click(screen.getByText('Approve this one only'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAcceptWithTopUp).not.toHaveBeenCalled();
  });

  it("won't top up with an amount that can't pay for this request", () => {
    const { onAcceptWithTopUp } = renderDialog({
      ...usedUp,
      budget: { ...(usedUp as { budget: object }).budget, count: 5 },
    } as Message);
    waitASecond();
    fireEvent.click(screen.getByText('Custom'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount in QORT' }), {
      target: { value: '0.02' },
    });
    expect(
      screen.getByText('Not enough for this request (0.05 QORT)')
    ).toBeTruthy();
    fireEvent.click(topUpButton());
    expect(onAcceptWithTopUp).not.toHaveBeenCalled();
  });

  it('says when the budget ended', () => {
    renderDialog(ended);
    expect(screen.getByText(/^Budget ended on /)).toBeTruthy();
    expect(screen.getByText(/0\.4 of 1 QORT used/)).toBeTruthy();
  });

  it('starts the choices afresh for the next request', () => {
    const { show } = renderDialog(usedUp);
    waitASecond();
    fireEvent.click(screen.getByText('10 QORT'));
    expect(
      screen.getByText('About 1000 actions at 0.01 QORT each')
    ).toBeTruthy();
    show({ ...usedUp } as Message);
    expect(
      screen.getByText('About 100 actions at 0.01 QORT each')
    ).toBeTruthy();
  });

  it('says why it asks when the app reached its limit, and asks as usual', () => {
    const { onAccept } = renderDialog(atLimit);
    expect(screen.getByTestId('budget-limit-note').textContent).toBe(
      'Opened-App reached its limit of 20 actions a minute, so this one asks.'
    );
    expect(screen.queryByTestId('budget-refill')).toBeNull();
    expect(screen.queryByText('Top up and approve')).toBeNull();
    waitASecond();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("says why the budget doesn't pay for a publish that replaces something, and asks as usual", () => {
    const { onAccept } = renderDialog({
      ...usedUp,
      budget: { state: 'replaces' },
    } as Message);
    expect(screen.getByTestId('budget-not-covered-note').textContent).toBe(
      "Opened-App's budget doesn't cover this: it replaces something already published."
    );
    expect(screen.queryByTestId('budget-refill')).toBeNull();
    expect(screen.queryByText('Top up and approve')).toBeNull();
    waitASecond();
    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('says when the app is already publishing the same thing', () => {
    renderDialog({ ...usedUp, budget: { state: 'publishing' } } as Message);
    expect(screen.getByTestId('budget-not-covered-note').textContent).toBe(
      "Opened-App is already publishing this, so its budget doesn't cover it again. Approving publishes it a second time."
    );
    expect(screen.queryByTestId('budget-limit-note')).toBeNull();
  });

  it('shows nothing about budgets for a request without one', () => {
    renderDialog({ ...usedUp, budget: undefined } as Message);
    expect(screen.queryByTestId('budget-refill')).toBeNull();
    expect(screen.queryByTestId('budget-limit-note')).toBeNull();
    expect(screen.queryByTestId('budget-not-covered-note')).toBeNull();
    expect(screen.getByText('Accept')).toBeTruthy();
  });
});
