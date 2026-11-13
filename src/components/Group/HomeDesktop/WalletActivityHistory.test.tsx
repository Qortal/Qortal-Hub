import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material';
import '../../../i18n/i18n';
import {
  WalletActivityHistory,
  WalletActivityHistoryToggle,
} from './WalletActivityHistory';
import {
  WALLET_HISTORY_PAGE_SIZE,
  formatWalletHistoryDate,
  shortWalletAddress,
  walletEntryFromTransaction,
  walletHistoryUrl,
} from './walletHistory';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

const ME = 'QmeAddress000000000000000000000000';
const ALICE = 'QaliceAddress00000000000000000000';
const BOB = 'QbobAddress0000000000000000000000';

const payment = (
  n: number,
  from: string,
  to: string,
  amount = '1.50000000'
) => ({
  type: 'PAYMENT',
  timestamp: 1_700_000_000_000 - n * 60_000,
  signature: `sig${n}`,
  creatorAddress: from,
  recipient: to,
  amount,
});

describe('wallet history helpers', () => {
  it('reads a payment from the account side', () => {
    expect(walletEntryFromTransaction(payment(1, ALICE, ME), ME)).toEqual({
      amount: 1.5,
      counterpartyAddress: ALICE,
      direction: 'incoming',
      signature: 'sig1',
      timestamp: 1_700_000_000_000 - 60_000,
    });
    expect(
      walletEntryFromTransaction(payment(2, ME, BOB, '3'), ME)?.direction
    ).toBe('outgoing');
    expect(walletEntryFromTransaction(payment(3, ALICE, BOB), ME)).toBeNull();
    expect(
      walletEntryFromTransaction({ ...payment(4, ALICE, ME), amount: 'x' }, ME)
    ).toBeNull();
  });

  it('asks the node for one page, newest first', () => {
    const url = walletHistoryUrl('http://node', ME, 40);
    expect(url).toContain('txType=PAYMENT');
    expect(url).toContain(`address=${ME}`);
    expect(url).toContain(`limit=${WALLET_HISTORY_PAGE_SIZE}`);
    expect(url).toContain('offset=40');
    expect(url).toContain('reverse=true');
  });

  it('shows the year only for other years, and short addresses', () => {
    const now = new Date(2026, 9, 7).getTime();
    expect(
      formatWalletHistoryDate(new Date(2026, 9, 6, 14, 32).getTime(), 'en', now)
    ).not.toContain('2026');
    expect(
      formatWalletHistoryDate(new Date(2025, 0, 2, 9, 5).getTime(), 'en', now)
    ).toContain('2025');
    expect(shortWalletAddress(ALICE)).toBe('Qalice…0000');
    expect(shortWalletAddress('Qshort')).toBe('Qshort');
  });
});

describe('WalletActivityHistory', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (page: unknown[]) =>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => page });

  const Harness = ({ open }: { open: boolean }) => (
    <ThemeProvider theme={createTheme()}>
      <WalletActivityHistory
        id="history"
        onOpenCounterparty={() => undefined}
        open={open}
        refreshKey="1"
        resolveLabel={async (address) =>
          address === ALICE ? 'alice' : address
        }
        userAddress={ME}
      />
    </ThemeProvider>
  );

  it('loads nothing until it is opened, and only once', async () => {
    const { rerender } = render(<Harness open={false} />);
    expect(document.getElementById('history')).not.toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();

    respond([payment(1, ALICE, ME)]);
    rerender(<Harness open />);
    expect(await screen.findByText('alice')).toBeVisible();

    rerender(<Harness open={false} />);
    rerender(<Harness open />);
    expect(screen.getByText('alice')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lists every payment, a page at a time', async () => {
    const first = Array.from({ length: WALLET_HISTORY_PAGE_SIZE }, (_, n) =>
      n % 2 ? payment(n, ME, BOB) : payment(n, ALICE, ME)
    );
    respond(first);
    render(<Harness open />);
    expect(await screen.findAllByText('alice')).toHaveLength(
      WALLET_HISTORY_PAGE_SIZE / 2
    );
    expect(screen.getAllByText('QbobAd…0000')).toHaveLength(
      WALLET_HISTORY_PAGE_SIZE / 2
    );
    expect(screen.getAllByText('+1.50 QORT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-1.50 QORT').length).toBeGreaterThan(0);

    respond([payment(50, ALICE, ME)]);
    await act(async () => {
      fireEvent.click(screen.getByText('Show more'));
    });
    expect(fetchMock.mock.calls[1][0]).toContain(
      `offset=${WALLET_HISTORY_PAGE_SIZE}`
    );
    expect(await screen.findAllByText('alice')).toHaveLength(
      WALLET_HISTORY_PAGE_SIZE / 2 + 1
    );
    // A short page is the last one.
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('offers a retry when the node fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Harness open />);
    expect(
      await screen.findByText("Couldn't load the history.")
    ).toBeInTheDocument();
    respond([]);
    await act(async () => {
      fireEvent.click(screen.getByText('Try again'));
    });
    expect(await screen.findByText('No payments yet.')).toBeInTheDocument();
  });
});

describe('WalletActivityHistoryToggle', () => {
  it('is a small "History" button that names the list it shows', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ThemeProvider theme={createTheme()}>
        <WalletActivityHistoryToggle
          controls="history"
          onToggle={onToggle}
          open={false}
        />
      </ThemeProvider>
    );
    const button = screen.getByRole('button', { name: 'Transaction history' });
    expect(button).toHaveTextContent('History');
    expect(button).toHaveAttribute('aria-controls', 'history');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider theme={createTheme()}>
        <WalletActivityHistoryToggle
          controls="history"
          onToggle={onToggle}
          open
        />
      </ThemeProvider>
    );
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
