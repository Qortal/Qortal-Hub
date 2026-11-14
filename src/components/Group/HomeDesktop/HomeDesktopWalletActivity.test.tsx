import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { balanceAtom, userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import { HomeDesktopWalletActivity } from './HomeDesktopWalletActivity';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

const ME = 'QmeAddress000000000000000000000000';
const OTHER = 'QotherAddress00000000000000000000';
const ALICE = 'QaliceAddress00000000000000000000';
const BOB = 'QbobAddress0000000000000000000000';

const payment = (n: number, from: string, to: string, amount: string) => ({
  amount,
  creatorAddress: from,
  recipient: to,
  signature: `sig${n}`,
  timestamp: Date.now() - (n + 1) * 60_000,
  type: 'PAYMENT',
});

type Reply = { json: () => Promise<unknown>; ok: boolean; status: number };
const reply = (body: unknown, status = 200): Reply => ({
  json: async () => body,
  ok: status < 300,
  status,
});

/** Every observed element reports this height, as a resized card would. */
const stubCardHeight = (height: number) => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        const entry = {
          borderBoxSize: [{ blockSize: height, inlineSize: 360 }],
          contentRect: { height, width: 360 },
          target,
        } as unknown as ResizeObserverEntry;
        this.callback([entry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
  );
};

describe('HomeDesktopWalletActivity history', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  // The latest payment, which the card shows on its own above the history.
  let recent: Promise<Reply> | null;
  let history: unknown[];

  beforeEach(() => {
    const latest = payment(0, ALICE, ME, '7');
    history = [latest, payment(1, BOB, ME, '2'), payment(2, ME, ALICE, '3')];
    recent = null;
    fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/names/primary/')) {
        return url.endsWith(ALICE)
          ? reply({ name: 'alice' })
          : reply({ error: 'not found' }, 404);
      }
      if (url.includes('/transactions/search') && url.includes('offset=')) {
        return reply(history);
      }
      if (url.includes('/transactions/search')) {
        return recent ?? reply([latest, ...history.slice(1)]);
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderCard = () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME, name: 'me' });
    store.set(balanceAtom, 10);
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <HomeDesktopWalletActivity />
        </ThemeProvider>
      </Provider>
    );
    return store;
  };

  const historyButton = () =>
    screen.getByRole('button', { name: 'Transaction history' });

  const historyRequests = () =>
    fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('offset='));

  it('shows the history in place of the latest payment, and back', async () => {
    renderCard();
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Recent Transaction')).toBeInTheDocument();
    expect(screen.getAllByText('+7.00 QORT')).toHaveLength(1);
    expect(historyRequests()).toEqual([]);

    fireEvent.click(historyButton());

    expect(await screen.findByText('+2.00 QORT')).toBeInTheDocument();
    expect(screen.getByText('-3.00 QORT')).toBeInTheDocument();
    // The latest payment is now the history's first row, not a second copy.
    expect(screen.getAllByText('+7.00 QORT')).toHaveLength(1);
    expect(
      screen.queryByText('Latest transaction within the past 7 days')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Transaction')).not.toBeInTheDocument();
    expect(historyButton()).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(
      historyButton().getAttribute('aria-controls') ?? ''
    );
    expect(list).toContainElement(screen.getByText('+7.00 QORT'));
    expect(list).toContainElement(screen.getByText('-3.00 QORT'));
    expect(historyRequests()).toEqual([
      expect.stringContaining(`address=${ME}`),
    ]);

    fireEvent.click(historyButton());

    expect(historyButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Recent Transaction')).toBeInTheDocument();
    expect(
      screen.getByText('Latest transaction within the past 7 days')
    ).toBeInTheDocument();
    expect(screen.getAllByText('+7.00 QORT')).toHaveLength(1);
    expect(screen.queryByText('-3.00 QORT')).not.toBeInTheDocument();
  });

  it('shows the history by itself in a tall card, until it is closed', async () => {
    stubCardHeight(520);
    renderCard();

    expect(await screen.findByText('-3.00 QORT')).toBeInTheDocument();
    expect(historyButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Recent Transaction')).not.toBeInTheDocument();

    fireEvent.click(historyButton());

    expect(historyButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Recent Transaction')).toBeInTheDocument();
    expect(screen.queryByText('-3.00 QORT')).not.toBeInTheDocument();
  });

  it('keeps a shorter card on the latest payment', async () => {
    stubCardHeight(300);
    renderCard();

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(historyButton()).toHaveAttribute('aria-expanded', 'false');
    expect(historyRequests()).toEqual([]);
  });

  it('closes the history when the account changes, and loads the new one', async () => {
    const store = renderCard();
    await screen.findByText('alice');
    fireEvent.click(historyButton());
    await screen.findByText('+2.00 QORT');

    await act(async () => {
      store.set(userInfoAtom, { address: OTHER, name: 'other' });
    });

    expect(historyButton()).toHaveAttribute('aria-expanded', 'false');

    history = [];
    await act(async () => {
      fireEvent.click(historyButton());
    });
    expect(await screen.findByText('No payments yet.')).toBeInTheDocument();
    const requests = historyRequests();
    expect(requests[requests.length - 1]).toContain(`address=${OTHER}`);
  });

  it('keeps the latest payment on screen while it refreshes', async () => {
    const store = renderCard();
    await screen.findByText('alice');
    const searches = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/transactions/search')
      ).length;
    const before = searches();

    // The refresh a new balance starts doesn't answer yet.
    recent = new Promise<Reply>(() => undefined);
    await act(async () => {
      store.set(balanceAtom, 11);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(searches()).toBe(before + 1);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(
      screen.queryByText('Loading recent wallet activity...')
    ).not.toBeInTheDocument();
  });
});
