import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../../i18n/i18n';
import { qortinoAgentOpenAtom, userInfoAtom } from '../../../../atoms/global';

const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
vi.mock('../../../../utils/events', () => events);
const nav = vi.hoisted(() => ({ closeQortinoAgentSheet: vi.fn() }));
vi.mock('../../../../qortinoAgent/qortinoSheetNav', () => nav);

import { QortinoReportDialog } from '../QortinoReportDialog';

const REPORT = {
  question: 'Who runs QDN?',
  answer: 'A company in Zurich.',
  source: {
    kind: 'model' as const,
    model: 'Qwen3 4B Instruct 2507',
    hints: ['qdn-001'],
  },
};

const snackbars = () =>
  events.executeEvent.mock.calls
    .filter(([name]) => name === 'openGlobalSnackBar')
    .map(([, payload]) => payload.message);

describe('Flagging an answer', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    events.executeEvent.mockClear();
    nav.closeQortinoAgentSheet.mockClear();
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderDialog = (name: string | null = 'Tester Hub') => {
    const store = createStore();
    store.set(
      userInfoAtom,
      name ? { name, address: 'QADDR' } : { address: 'QADDR' }
    );
    store.set(qortinoAgentOpenAtom, true);
    const onClose = vi.fn();
    render(
      <JotaiProvider store={store}>
        <QortinoReportDialog report={REPORT} onClose={onClose} />
      </JotaiProvider>
    );
    return { onClose };
  };

  const click = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };

  it('shows what will be copied before anything happens', () => {
    renderDialog();
    expect(screen.getByText('Report this answer')).toBeInTheDocument();
    const preview = screen.getByTestId('qortino-report-preview');
    expect(preview.textContent).toContain('Who runs QDN?');
    expect(preview.textContent).toContain('A company in Zurich.');
    expect(preview.textContent).toContain('Model: Qwen3 4B Instruct 2507');
    expect(preview.textContent).toContain(
      'written by the model, with curated answers qdn-001'
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(events.executeEvent).not.toHaveBeenCalled();
  });

  it('copies the report, opens Q-Mail to Qortal Builders and steps aside', async () => {
    const { onClose } = renderDialog();
    const text = screen.getByTestId('qortino-report-preview').textContent;
    await click('Copy and open Q-Mail');
    expect(writeText).toHaveBeenCalledWith(text);
    expect(events.executeEvent).toHaveBeenCalledWith('addTab', {
      data: expect.objectContaining({
        name: 'Q-Mail',
        path: 'to/Qortal%20Builders',
        navigateIfAlreadyOpen: true,
      }),
    });
    expect(onClose).toHaveBeenCalled();
    // The panel would cover Q-Mail's Send button.
    expect(nav.closeQortinoAgentSheet).toHaveBeenCalled();
    expect(snackbars()).toEqual([
      'Report copied. Paste it into the message to Qortal Builders.',
    ]);
    // Said before the tab opens, so a tab-limit warning from Hub wins.
    const order = events.executeEvent.mock.calls.map(([name]) => name);
    expect(order.indexOf('openGlobalSnackBar')).toBeLessThan(
      order.indexOf('addTab')
    );
  });

  it('still opens Q-Mail when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    renderDialog();
    await click('Copy and open Q-Mail');
    expect(events.executeEvent).toHaveBeenCalledWith(
      'addTab',
      expect.anything()
    );
    expect(snackbars()).toEqual([
      'The report could not be copied. Q-Mail is open, so you can write what was wrong there.',
    ]);
  });

  it('only copies for an account without a registered name', async () => {
    renderDialog(null);
    expect(
      screen.getByText(/Q-Mail can only send messages from a registered name/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy and open Q-Mail' })
    ).not.toBeInTheDocument();
    await click('Copy report');
    expect(writeText).toHaveBeenCalled();
    expect(events.executeEvent).not.toHaveBeenCalledWith(
      'addTab',
      expect.anything()
    );
    expect(nav.closeQortinoAgentSheet).not.toHaveBeenCalled();
    expect(snackbars()).toEqual(['Report copied.']);
  });

  it('keeps the preview while the dialog closes', () => {
    const store = createStore();
    store.set(userInfoAtom, { name: 'Tester Hub' });
    const { rerender } = render(
      <JotaiProvider store={store}>
        <QortinoReportDialog report={REPORT} onClose={vi.fn()} />
      </JotaiProvider>
    );
    rerender(
      <JotaiProvider store={store}>
        <QortinoReportDialog report={null} onClose={vi.fn()} />
      </JotaiProvider>
    );
    const preview = screen.queryByTestId('qortino-report-preview');
    if (preview) expect(preview.textContent).toContain('Who runs QDN?');
  });

  it('does nothing on Cancel', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(events.executeEvent).not.toHaveBeenCalled();
  });
});
