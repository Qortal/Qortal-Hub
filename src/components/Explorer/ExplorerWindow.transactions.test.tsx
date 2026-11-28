import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import { NULL_ACCOUNT } from '../../lib/explorer/reads';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The account's Transactions tab, the Overview's Latest transactions, one
// transaction's own page and an AT's page, in the window as App mounts it,
// reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const AT_ADDR = `A${'T'.repeat(33)}`;
const PUBLIC_KEY = 'k'.repeat(44);

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (n: number) => {
  let text = '';
  do {
    text = ALPHABET[n % 58] + text;
    n = Math.floor(n / 58);
  } while (n > 0);
  return text;
};
/** A signature of its own for each number (88 base58 characters, the number in fixed width). */
const sig = (n: number) => `S${base58(n).padStart(6, '1')}`.padEnd(88, 'x');

type Row = Record<string, unknown>;

/** Publisher's payment number `n` to Second, newest first by `n`. */
const payment = (n: number, extra: Row = {}): Row => ({
  type: 'PAYMENT',
  timestamp: 1_800_000_000_000 - n * 60_000,
  signature: sig(n),
  fee: '0.01000000',
  txGroupId: 0,
  blockHeight: 2_000_000 - n,
  approvalStatus: 'NOT_REQUIRED',
  creatorAddress: PUBLISHER,
  recipient: SECOND,
  amount: '15.00000000',
  ...extra,
});

type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

/** A list read of the Transactions tab (100 a page), not PR 1's other searches. */
const isListRead = (path: string, address: string) =>
  path.startsWith('/transactions/search?') &&
  params(path).get('address') === address &&
  params(path).get('limit') === '100';

function account(address: string) {
  return {
    address,
    reference: 'ref',
    publicKey: PUBLIC_KEY,
    level: 3,
    blocksMinted: 250_000,
    blocksMintedAdjustment: 0,
    blocksMintedPenalty: 0,
  };
}

/** What every account page reads, for `address`. */
function quietAccount(address: string, name: string | null): Route {
  return (path) => {
    if (path === `/addresses/${address}`) return { body: account(address) };
    if (path === `/names/primary/${address}`)
      return { body: name ? { name, owner: address } : { owner: address } };
    if (path.startsWith(`/names/address/${address}`))
      return { body: name ? [{ name, owner: address }] : [] };
    if (path === `/groups/member/${address}`) return { body: [] };
    if (path === `/addresses/balance/${address}`) return { body: 12.5 };
    if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
    if (path.startsWith('/transactions/search?') && path.includes(address))
      return { body: [] };
    return undefined;
  };
}

const commonRoutes: Route = (path) => {
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/names/search?')) return { body: [] };
  if (path.startsWith('/transactions/creator/')) return { body: [] };
  if (path.startsWith('/transactions/unconfirmed?')) return { body: [] };
  if (path === '/admin/status') return { body: { height: 2_000_500 } };
  if (path === '/admin/info')
    return { body: { currentTimestamp: 2_000_000_000_000 } };
  if (path.startsWith('/blocks/byheight/'))
    return {
      body: { height: 1_999_060, timestamp: 2_000_000_000_000 - 86_400_000 },
    };
  return undefined;
};

function stubNode() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).slice('http://node.test'.length);
      calls.push({ method: init?.method ?? 'GET', path });
      for (const route of [...routes, commonRoutes]) {
        const answer = route(path);
        if (!answer) continue;
        if (answer.delay) await answer.delay;
        const status = answer.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () =>
            typeof answer.body === 'string'
              ? answer.body
              : JSON.stringify(answer.body),
          json: async () => answer.body,
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 999, message: 'no route' }),
        json: async () => ({}),
      } as Response;
    })
  );
}

/** Publisher's list: `pages[i]` answers offset i×100 (rows built by `make`). */
function listOf(
  address: string,
  answer: (offset: number, types: string[]) => Answer | undefined
): Route {
  return (path) => {
    if (!isListRead(path, address)) return undefined;
    const query = params(path);
    return answer(Number(query.get('offset')), query.getAll('txType'));
  };
}

const range = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => from + index);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <ExplorerWindow isOpenDrawerLookup={open} setIsOpenDrawerLookup={setOpen} />
  );
}

function renderWindow() {
  const store = createStore();
  store.set(userInfoAtom, { address: READER, name: 'Reader' } as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
}

const lookUp = (addressOrName?: string) =>
  act(() => {
    executeEvent(
      'openUserLookupDrawer',
      addressOrName ? { addressOrName } : {}
    );
  });

const dialog = () => screen.getByRole('dialog');
const listReads = (address = PUBLISHER) =>
  calls.filter((call) => isListRead(call.path, address));
const lastListRead = () => {
  const reads = listReads();
  return reads.length ? reads[reads.length - 1].path : '';
};

async function openPublisher() {
  routes.push(
    quietAccount(PUBLISHER, 'Publisher'),
    quietAccount(SECOND, 'Second')
  );
  renderWindow();
  await lookUp(PUBLISHER);
  await within(dialog()).findByRole('heading', {
    level: 2,
    name: 'Publisher',
  });
}

async function openTransactionsTab() {
  fireEvent.click(within(dialog()).getByRole('tab', { name: /transactions/i }));
  return within(dialog()).findByRole('tabpanel', { name: /transactions/i });
}

/** "Show more", found by its words (a role query over a long list is slow). */
const showMore = (scope: HTMLElement) =>
  within(scope)
    .getByText(/^show more$/i)
    .closest('button') as HTMLElement;
const queryShowMore = (scope: HTMLElement) =>
  within(scope).queryByText(/^show more$/i);

/** A row's button, by its words. */
const rowButton = (scope: HTMLElement, words: RegExp) =>
  within(scope).findByRole('button', { name: words });

/** The lines that say what is on screen: how much of the list, what is being read. */
const coverage = (scope: HTMLElement) =>
  [...scope.querySelectorAll('[role="status"]')]
    .map((node) => node.textContent)
    .join(' | ');

/** Retry, found by its words (a role query over a long list is slow). */
const findRetry = async (scope: HTMLElement) =>
  (await within(scope).findByText(/^retry$/i)).closest('button') as HTMLElement;

/** An answer held back until it is let go. */
function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
}

/**
 * Publisher's list as the node has it after `node.newest` new transactions
 * (numbers 0, -1, …, newest first); `node.held` holds back the answer at an
 * offset.
 */
const growingList = (node: {
  newest: number;
  held: Map<number, Promise<void>>;
}) =>
  listOf(PUBLISHER, (offset) => ({
    body: range(offset + 1 - node.newest, 100).map((n) => payment(n)),
    delay: node.held.get(offset),
  }));

beforeEach(() => {
  routes = [];
  calls = [];
  window.localStorage.clear();
  stubNode();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the account tabs', () => {
  it('shows Overview first, switches to Transactions in place and keeps each step its tab', async () => {
    routes.push(
      listOf(PUBLISHER, (offset) => ({ body: offset ? [] : [payment(1)] }))
    );
    await openPublisher();
    const tabs = within(dialog()).getByRole('tablist', {
      name: /account sections/i,
    });
    const overview = within(tabs).getByRole('tab', { name: /overview/i });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    // The keyboard moves between the tabs with the arrow keys.
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(
      within(tabs).getByRole('tab', { name: /transactions/i })
    ).toHaveFocus();
    const panel = await openTransactionsTab();
    expect(
      within(tabs).getByRole('tab', { name: /transactions/i })
    ).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('id', 'explorer-panel-transactions');

    // An account opened from a row is a step of its own, on its Overview.
    const row = await rowButton(panel, /Sent 15 QORT to Second/);
    fireEvent.click(
      within(row.parentElement as HTMLElement).getByRole('button', {
        name: 'Second',
        hidden: true,
      })
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    expect(
      within(dialog()).getByRole('tab', { name: /overview/i })
    ).toHaveAttribute('aria-selected', 'true');

    // Back shows Publisher on the tab it was left on; switching tabs added no step.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    expect(
      within(dialog()).getByRole('tab', { name: /transactions/i })
    ).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: /forward/i }));
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    expect(
      within(dialog()).getByRole('tab', { name: /transactions/i })
    ).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the Transactions tab', () => {
  it('tells each transaction in a sentence, with when and in which block', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({
        body: [
          payment(1),
          payment(2, {
            creatorAddress: SECOND,
            recipient: PUBLISHER,
            amount: '2.5',
          }),
        ],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const sent = await rowButton(panel, /Sent 15 QORT to Second/);
    expect(sent).toHaveAccessibleName(/outgoing/i);
    expect(sent).toHaveAccessibleName(/block 1,999,999/);
    const received = await rowButton(panel, /Received 2\.5 QORT from Second/);
    expect(received).toHaveAccessibleName(/incoming/i);
    expect(
      within(panel).getByText(/All 2 of its transactions\./)
    ).toBeInTheDocument();
    expect(queryShowMore(panel)).not.toBeInTheDocument();
  });

  it('opens a row to its fields, the accounts involved and its raw answer, never a message’s content', async () => {
    const secret = 'meet me at the usual place';
    routes.push(
      listOf(PUBLISHER, () => ({
        body: [
          payment(1, {
            type: 'MESSAGE',
            amount: '0.00000000',
            data: secret,
            isText: true,
            isEncrypted: false,
          }),
        ],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const row = await rowButton(panel, /Sent a message to Second/);
    expect(
      within(panel).getByText(/^Its only transaction\.$/)
    ).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(panel).getByText('Encrypted', { selector: 'dt' })
    ).toBeInTheDocument();
    const people = within(panel).getByRole('list', {
      name: /accounts involved/i,
    });
    expect(
      await within(people).findByRole('button', { name: /Publisher.*creator/i })
    ).toBeInTheDocument();
    expect(
      within(people).getByRole('button', { name: /Second/ })
    ).toBeInTheDocument();
    const raw = within(panel).getByRole('button', { name: /raw API answer/i });
    fireEvent.click(raw);
    const box = within(panel).getByRole('region', { name: /raw API answer/i });
    expect(box).toHaveTextContent(`"signature": "${sig(1)}"`);
    expect(box).toHaveTextContent('"data": "(not shown)"');
    expect(document.body.textContent).not.toContain(secret);
  });

  it('opens an account named in a sentence in the Explorer, a step on the trail', async () => {
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(1)] })));
    await openPublisher();
    const panel = await openTransactionsTab();
    const row = await rowButton(panel, /Sent 15 QORT to Second/);
    // Over the row's button, out of the Tab order (the opened row has it for the keyboard).
    const link = within(row.parentElement as HTMLElement).getByRole('button', {
      name: 'Second',
      hidden: true,
    });
    expect(link).toHaveAttribute('tabindex', '-1');
    fireEvent.click(link);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    const trail = within(dialog()).getByRole('navigation', { name: /trail/i });
    expect(
      within(trail).getByRole('button', { name: /Publisher/ })
    ).toBeInTheDocument();
  });

  it('reads 100 at a time with Show more, and says when it has read them all', async () => {
    routes.push(
      listOf(PUBLISHER, (offset) => ({
        body:
          offset === 0
            ? range(1, 100).map((n) => payment(n))
            : range(101, 20).map((n) => payment(n)),
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    expect(
      await within(panel).findByText(/Its newest 100 transactions\./)
    ).toBeInTheDocument();
    fireEvent.click(showMore(panel));
    expect(
      await within(panel).findByText(/All 120 of its transactions\./)
    ).toBeInTheDocument();
    expect(listReads().map((call) => params(call.path).get('offset'))).toEqual([
      '0',
      '100',
    ]);
    expect(queryShowMore(panel)).not.toBeInTheDocument();
    expect(within(panel).getAllByRole('listitem')).toHaveLength(120);
  });

  it('stops at 1,000 of a kind and says so', { timeout: 30_000 }, async () => {
    routes.push(
      listOf(PUBLISHER, (offset) => ({
        body: range(offset + 1, 100).map((n) => payment(n)),
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    await within(panel).findByText(/Its newest 100 transactions\./);
    for (let read = 2; read <= 10; read++) {
      fireEvent.click(showMore(panel));
      await within(panel).findByText(
        new RegExp(
          `Its newest ${(read * 100).toLocaleString('en')} transactions\\.`
        )
      );
    }
    expect(
      within(panel).getByText(/reads up to 1,000 transactions of each kind/)
    ).toBeInTheDocument();
    expect(queryShowMore(panel)).not.toBeInTheDocument();
    expect(listReads()).toHaveLength(10);
  });

  it('says a failed read with Retry, never that it has no transactions', async () => {
    let fail = true;
    routes.push(
      listOf(PUBLISHER, () =>
        fail
          ? { status: 500, body: { error: 1, message: 'busy' } }
          : { body: [payment(1)] }
      )
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    expect(
      await within(panel).findByText(/couldn't load its transactions/i)
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText(/no confirmed transactions/i)
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(panel).getByRole('button', { name: /retry/i }));
    expect(
      await rowButton(panel, /Sent 15 QORT to Second/)
    ).toBeInTheDocument();
  });

  it('says when Show more failed, keeps what it read, and Retry reads on from there', async () => {
    let failMore = true;
    routes.push(
      listOf(PUBLISHER, (offset) =>
        offset === 0
          ? { body: range(1, 100).map((n) => payment(n)) }
          : failMore
            ? { status: 503, body: { error: 1, message: 'busy' } }
            : { body: [payment(101)] }
      )
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    await within(panel).findByText(/Its newest 100 transactions\./);
    fireEvent.click(showMore(panel));
    expect(
      await within(panel).findByText(/couldn't load more of its transactions/i)
    ).toBeInTheDocument();
    expect(within(panel).getAllByRole('listitem')).toHaveLength(100);
    failMore = false;
    fireEvent.click(within(panel).getByRole('button', { name: /retry/i }));
    expect(
      await within(panel).findByText(/All 101 of its transactions\./)
    ).toBeInTheDocument();
    expect(listReads().map((call) => params(call.path).get('offset'))).toEqual([
      '0',
      '100',
      '100',
    ]);
  });

  it('reads one kind, and one type of it, from the node; the step keeps what was picked', async () => {
    routes.push(
      listOf(PUBLISHER, (_offset, types) => ({
        body: types.length
          ? [payment(1)]
          : [
              payment(1),
              payment(2, { type: 'REGISTER_NAME', name: 'Example' }),
            ],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    await rowButton(panel, /Registered the name “Example”/);
    const kinds = within(panel).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    fireEvent.click(within(kinds).getByRole('button', { name: /payments/i }));
    expect(
      within(kinds).getByRole('button', { name: /payments/i })
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(params(lastListRead()).getAll('txType')).toEqual([
        'PAYMENT',
        'TRANSFER_ASSET',
        'MULTI_PAYMENT',
      ])
    );
    expect(
      await within(panel).findByText(/^The only one of this kind\.$/)
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: /Registered the name/ })
    ).not.toBeInTheDocument();

    // One exact type of the kind.
    fireEvent.mouseDown(within(panel).getByRole('combobox', { name: /type/i }));
    fireEvent.click(await screen.findByRole('option', { name: /^Payment$/ }));
    await waitFor(() =>
      expect(params(lastListRead()).getAll('txType')).toEqual(['PAYMENT'])
    );

    // Away and Back: the tab and what was picked are as they were left.
    const row = await rowButton(panel, /Sent 15 QORT to Second/);
    fireEvent.click(
      within(row.parentElement as HTMLElement).getByRole('button', {
        name: 'Second',
        hidden: true,
      })
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    expect(
      within(again).getByRole('button', { name: /payments/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(again).getByRole('combobox', { name: /type/i })
    ).toHaveTextContent(/^Payment$/);
  });

  it('drops a list that comes back after another kind was picked', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    routes.push(
      listOf(PUBLISHER, (_offset, types) =>
        types.length
          ? { body: [payment(1)] }
          : {
              body: [payment(2, { type: 'REGISTER_NAME', name: 'Example' })],
              delay: slow,
            }
      )
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const kinds = within(panel).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    fireEvent.click(within(kinds).getByRole('button', { name: /payments/i }));
    await rowButton(panel, /Sent 15 QORT to Second/);
    await act(async () => {
      release();
      await slow;
    });
    expect(
      within(panel).queryByRole('button', { name: /Registered the name/ })
    ).not.toBeInTheDocument();
    expect(
      await rowButton(panel, /Sent 15 QORT to Second/)
    ).toBeInTheDocument();
  });

  it('shows what it sent that waits for a block apart, of the kind picked', async () => {
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(5)] })));
    routes.push((path) =>
      path.startsWith('/transactions/unconfirmed?') &&
      params(path).get('creator') === PUBLIC_KEY
        ? {
            body: [payment(1, { blockHeight: undefined, signature: sig(900) })],
          }
        : undefined
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const waiting = await within(panel).findByRole('region', {
      name: /waiting to be confirmed \(1\)/i,
    });
    expect(
      await rowButton(
        waiting,
        /Sent 15 QORT to Second.*waiting to be confirmed/i
      )
    ).toBeInTheDocument();
    const kinds = within(panel).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    fireEvent.click(within(kinds).getByRole('button', { name: /names/i }));
    await waitFor(() =>
      expect(
        within(panel).queryByRole('region', {
          name: /waiting to be confirmed/i,
        })
      ).not.toBeInTheDocument()
    );
  });

  it('says it is checking what waits for a block while it reads', async () => {
    const waitingRead = hold();
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(5)] })));
    routes.push((path) =>
      path.startsWith('/transactions/unconfirmed?')
        ? {
            body: [payment(1, { blockHeight: undefined, signature: sig(900) })],
            delay: waitingRead.until,
          }
        : undefined
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    expect(
      await within(panel).findByText(
        /checking what it sent that waits for a block/i
      )
    ).toBeInTheDocument();
    await act(async () => {
      waitingRead.release();
      await waitingRead.until;
    });
    expect(
      await within(panel).findByRole('region', {
        name: /waiting to be confirmed \(1\)/i,
      })
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText(/checking what it sent that waits for a block/i)
    ).not.toBeInTheDocument();
  });

  it('counts “at least” when the node gives as many waiting as it gives at most', async () => {
    let waiting = 100;
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(5000)] })));
    routes.push((path) =>
      path.startsWith('/transactions/unconfirmed?') &&
      params(path).get('limit') === '100'
        ? {
            body: range(1, waiting).map((n) =>
              payment(n, { blockHeight: undefined })
            ),
          }
        : undefined
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    expect(
      await within(panel).findByRole('region', {
        name: /waiting to be confirmed \(at least 100\)/i,
      })
    ).toBeInTheDocument();
    // Fewer than the most: the count as it is.
    waiting = 99;
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    expect(
      await within(panel).findByRole('region', {
        name: /waiting to be confirmed \(99\)/i,
      })
    ).toBeInTheDocument();
  });

  it('leaves out of what waits one already among the confirmed', async () => {
    // Payment 1 got into a block between the two reads: both lists have it.
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(1)] })));
    routes.push((path) =>
      path.startsWith('/transactions/unconfirmed?')
        ? {
            body: [
              payment(0, {
                blockHeight: undefined,
                signature: sig(900),
                amount: '2.00000000',
              }),
              payment(1, { blockHeight: undefined }),
            ],
          }
        : undefined
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const waiting = await within(panel).findByRole('region', {
      name: /waiting to be confirmed \(1\)/i,
    });
    expect(
      await rowButton(waiting, /Sent 2 QORT to Second/)
    ).toBeInTheDocument();
    expect(within(waiting).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(waiting).queryByRole('button', { name: /Sent 15 QORT/ })
    ).not.toBeInTheDocument();
    // It shows once, among the confirmed, in its block.
    expect(
      await rowButton(panel, /Sent 15 QORT to Second.*block 1,999,999/)
    ).toBeInTheDocument();
  });

  it("says when it couldn't check what waits for a block, with Retry", async () => {
    let fail = true;
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(5)] })));
    routes.push((path) =>
      path.startsWith('/transactions/unconfirmed?') && fail
        ? { status: 500, body: { error: 1, message: 'busy' } }
        : undefined
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    expect(
      await within(panel).findByText(/couldn't check what it sent/i)
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(panel).getByRole('button', { name: /retry/i }));
    await waitFor(() =>
      expect(
        within(panel).queryByText(/couldn't check what it sent/i)
      ).not.toBeInTheDocument()
    );
  });

  it(
    'keeps the older rows read on Refresh, the new ones on top, with no gap after them',
    { timeout: 20_000 },
    async () => {
      let newest = 0;
      routes.push(
        // The node's list after `newest` new ones: number 0 is the newest.
        listOf(PUBLISHER, (offset) => ({
          body: range(offset + 1 - newest, 100).map((n) => payment(n)),
        }))
      );
      await openPublisher();
      const panel = await openTransactionsTab();
      await within(panel).findByText(/Its newest 100 transactions\./);
      fireEvent.click(showMore(panel));
      await within(panel).findByText(/Its newest 200 transactions\./);
      // One transaction arrives, newer than all (number 0).
      newest = 1;
      fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
      expect(
        await within(panel).findByText(/Its newest 201 transactions\./)
      ).toBeInTheDocument();
      fireEvent.click(showMore(panel));
      await within(panel).findByText(/Its newest 301 transactions\./);
      expect(params(lastListRead()).get('offset')).toBe('201');
    }
  );
});

describe('Refresh and Show more of the Transactions tab', () => {
  it('keeps what Show more read through a visit to the Overview, reading nothing again', async () => {
    routes.push(growingList({ newest: 0, held: new Map() }));
    await openPublisher();
    const panel = await openTransactionsTab();
    await within(panel).findByText(/Its newest 100 transactions\./);
    fireEvent.click(showMore(panel));
    await within(panel).findByText(/Its newest 200 transactions\./);
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    const latest = await within(dialog()).findByRole('region', {
      name: /latest transactions/i,
    });
    await waitFor(() =>
      expect(within(latest).getAllByRole('listitem')).toHaveLength(5)
    );
    const again = await openTransactionsTab();
    expect(
      await within(again).findByText(/Its newest 200 transactions\./)
    ).toBeInTheDocument();
    expect(listReads()).toHaveLength(2);
  });

  it(
    'keeps the new transaction Refresh found, when Show more answers first',
    { timeout: 20_000 },
    async () => {
      const node = { newest: 0, held: new Map<number, Promise<void>>() };
      routes.push(growingList(node));
      await openPublisher();
      const panel = await openTransactionsTab();
      await within(panel).findByText(/Its newest 100 transactions\./);

      // A transaction arrives (number 0, newer than all held). Refresh; its
      // newest page is slow, and Show more is pressed meanwhile.
      node.newest = 1;
      const newestPage = hold();
      node.held.set(0, newestPage.until);
      fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
      await waitFor(() => expect(listReads()).toHaveLength(2));
      fireEvent.click(showMore(panel));
      await waitFor(() => expect(listReads()).toHaveLength(3));
      await within(panel).findByText(/Its newest 199 transactions\./);
      await act(async () => {
        newestPage.release();
        await newestPage.until;
      });

      // What Refresh found is on screen: the new one on top (block 2,000,000),
      // 200 rows with nothing missing and nothing twice.
      await waitFor(() =>
        expect(coverage(panel)).toMatch(/Its newest 200 transactions\./)
      );
      expect(within(panel).getAllByText(/block 2,000,000$/)).toHaveLength(1);
      // The next older page starts right after the last row held.
      fireEvent.click(showMore(panel));
      await within(panel).findByText(/Its newest 300 transactions\./);
      expect(params(lastListRead()).get('offset')).toBe('200');
    }
  );

  it(
    'keeps the new transaction Refresh found, when Refresh answers first',
    { timeout: 20_000 },
    async () => {
      const node = { newest: 0, held: new Map<number, Promise<void>>() };
      routes.push(growingList(node));
      await openPublisher();
      const panel = await openTransactionsTab();
      await within(panel).findByText(/Its newest 100 transactions\./);

      node.newest = 1;
      const newestPage = hold();
      const olderPage = hold();
      node.held.set(0, newestPage.until);
      node.held.set(100, olderPage.until);
      fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
      await waitFor(() => expect(listReads()).toHaveLength(2));
      fireEvent.click(showMore(panel));
      await waitFor(() => expect(listReads()).toHaveLength(3));

      // Refresh's answer: the new transaction shows on top…
      await act(async () => {
        newestPage.release();
        await newestPage.until;
      });
      await within(panel).findByText(/block 2,000,000$/);
      // …and stays there once Show more's page arrives.
      await act(async () => {
        olderPage.release();
        await olderPage.until;
      });
      await waitFor(() =>
        expect(coverage(panel)).toMatch(/Its newest 200 transactions\./)
      );
      expect(within(panel).getAllByText(/block 2,000,000$/)).toHaveLength(1);
    }
  );

  it(
    'Retry after a failed Refresh keeps what Show more had read',
    { timeout: 20_000 },
    async () => {
      const node = { newest: 0, held: new Map<number, Promise<void>>() };
      let busy = false;
      routes.push(
        (path) =>
          busy && isListRead(path, PUBLISHER)
            ? { status: 503, body: { error: 1, message: 'busy' } }
            : undefined,
        growingList(node)
      );
      await openPublisher();
      const panel = await openTransactionsTab();
      await within(panel).findByText(/Its newest 100 transactions\./);
      fireEvent.click(showMore(panel));
      await within(panel).findByText(/Its newest 200 transactions\./);

      // Refresh while the node is busy, then Retry once it answers again.
      busy = true;
      fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
      const retry = await findRetry(panel);
      // Meanwhile the rows read stay on screen, and it says what failed.
      expect(
        within(panel).getByText(/couldn't check for newer transactions/i)
      ).toBeInTheDocument();
      expect(within(panel).getByText(/block 1,999,800$/)).toBeInTheDocument();
      busy = false;
      fireEvent.click(retry);
      await waitFor(() =>
        expect(coverage(panel)).toMatch(/Its newest \d+ transactions\./)
      );
      // The 200 read before the failed Refresh are on screen again.
      expect(coverage(panel)).toMatch(/Its newest 200 transactions\./);

      // Once more, with a transaction arriving meanwhile: Retry's newest page
      // goes on top of the 200, not in their place.
      busy = true;
      fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
      const again = await findRetry(panel);
      busy = false;
      node.newest = 1;
      fireEvent.click(again);
      await waitFor(() =>
        expect(coverage(panel)).toMatch(/Its newest 201 transactions\./)
      );
      expect(
        within(panel).queryByText(/couldn't check for newer transactions/i)
      ).not.toBeInTheDocument();
    }
  );

  it(
    'never says it reads up to 1,000 while it shows more than 1,000',
    { timeout: 60_000 },
    async () => {
      const node = { newest: 0, held: new Map<number, Promise<void>>() };
      routes.push(growingList(node));
      await openPublisher();
      const panel = await openTransactionsTab();
      await within(panel).findByText(/Its newest 100 transactions\./);
      for (let read = 2; read <= 10; read++) {
        fireEvent.click(showMore(panel));
        await within(panel).findByText(
          new RegExp(
            `Its newest ${(read * 100).toLocaleString('en')} transactions\\.`
          )
        );
      }
      expect(coverage(panel)).toMatch(/reads up to 1,000 transactions/);

      // One more transaction, and Refresh.
      node.newest = 1;
      // (A label query over a thousand rows is slow: the button by its label.)
      fireEvent.click(
        dialog().querySelector('button[aria-label="Refresh"]') as HTMLElement
      );
      await waitFor(() => expect(listReads()).toHaveLength(11));
      // The new one on top (block 2,000,000) once Refresh's page is in.
      await waitFor(() =>
        expect(panel.textContent).toContain('block 2,000,000')
      );
      const line = coverage(panel);
      const shown = Number(
        (/Its newest ([\d,]+) transactions/.exec(line)?.[1] ?? '0').replace(
          /,/g,
          ''
        )
      );
      // What the line says must hold together: a count above the ceiling it states is not.
      if (/reads up to 1,000 transactions/.test(line))
        expect(shown, line).toBeLessThanOrEqual(1000);
      // It holds the newest 1,000: the oldest (block 1,999,000) went.
      expect(shown).toBe(1000);
      expect(line).toMatch(/reads up to 1,000 transactions/);
      expect(panel.textContent).not.toContain('block 1,999,000');
      expect(queryShowMore(panel)).not.toBeInTheDocument();
    }
  );
});

describe('Latest transactions on the Overview', () => {
  it('shows the newest few, and opens the Transactions tab without reading again', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({ body: range(1, 7).map((n) => payment(n)) }))
    );
    await openPublisher();
    const latest = await within(dialog()).findByRole('region', {
      name: /latest transactions/i,
    });
    await waitFor(() =>
      expect(within(latest).getAllByRole('listitem')).toHaveLength(5)
    );
    expect(listReads()).toHaveLength(1);
    fireEvent.click(
      within(latest).getByRole('button', { name: /all transactions/i })
    );
    const panel = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    expect(within(panel).getAllByRole('listitem')).toHaveLength(7);
    expect(listReads()).toHaveLength(1);
  });

  it('says a failed read with Retry, never “no transactions”', async () => {
    let fail = true;
    routes.push(
      listOf(PUBLISHER, () =>
        fail
          ? { status: 500, body: { error: 1, message: 'busy' } }
          : { body: [payment(1)] }
      )
    );
    await openPublisher();
    const latest = await within(dialog()).findByRole('region', {
      name: /latest transactions/i,
    });
    expect(
      await within(latest).findByText(/couldn't load its latest transactions/i)
    ).toBeInTheDocument();
    expect(within(latest).queryByText(/no confirmed/i)).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(latest).getByRole('button', { name: /retry/i }));
    expect(
      await rowButton(latest, /Sent 15 QORT to Second/)
    ).toBeInTheDocument();
  });
});

describe('Latest transactions on the Overview, after the tab', () => {
  it('opens the Transactions tab on all of them, whatever kind was picked there before', async () => {
    routes.push(
      listOf(PUBLISHER, (_offset, types) =>
        // Publisher has one payment and no names.
        ({ body: types.includes('REGISTER_NAME') ? [] : [payment(1)] })
      )
    );
    await openPublisher();

    // On the Transactions tab, the Names kind is picked…
    const panel = await openTransactionsTab();
    const kinds = within(panel).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    fireEvent.click(within(kinds).getByRole('button', { name: /^names$/i }));
    await within(panel).findByText(
      /none of its confirmed transactions are of this kind/i
    );

    // …then, back on the Overview, "All transactions" under its latest ones.
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    const latest = await within(dialog()).findByRole('region', {
      name: /latest transactions/i,
    });
    await within(latest).findByRole('button', {
      name: /Sent 15 QORT to Second/,
    });
    fireEvent.click(
      within(latest).getByRole('button', { name: /all transactions/i })
    );
    const again = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    expect(
      within(again).getByRole('button', { name: /^all$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      await within(again).findByRole('button', {
        name: /Sent 15 QORT to Second/,
      })
    ).toBeInTheDocument();
    // Names is no longer the kind picked.
    expect(
      within(again).getByRole('button', { name: /^names$/i })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('says a failed Refresh also when it had none, never only “no transactions”', async () => {
    let busy = false;
    routes.push(
      listOf(PUBLISHER, () =>
        busy
          ? { status: 503, body: { error: 1, message: 'busy' } }
          : { body: [] }
      )
    );
    await openPublisher();
    const latest = await within(dialog()).findByRole('region', {
      name: /latest transactions/i,
    });
    await within(latest).findByText(/no confirmed transactions/i);
    busy = true;
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    expect(
      await within(latest).findByText(/couldn't check for newer transactions/i)
    ).toBeInTheDocument();
    busy = false;
    fireEvent.click(await findRetry(latest));
    await waitFor(() =>
      expect(
        within(latest).queryByText(/couldn't check for newer transactions/i)
      ).not.toBeInTheDocument()
    );
    expect(
      within(latest).getByText(/no confirmed transactions/i)
    ).toBeInTheDocument();
  });

  it('keeps its rows when a Refresh fails, says so, and Retry reads the newest again', async () => {
    let busy = false;
    let newest = 0;
    routes.push(
      listOf(PUBLISHER, () =>
        busy
          ? { status: 503, body: { error: 1, message: 'busy' } }
          : { body: range(1 - newest, 7).map((n) => payment(n)) }
      )
    );
    await openPublisher();
    const latest = await within(dialog()).findByRole('region', {
      name: /latest transactions/i,
    });
    await waitFor(() =>
      expect(within(latest).getAllByRole('listitem')).toHaveLength(5)
    );
    busy = true;
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    expect(
      await within(latest).findByText(/couldn't check for newer transactions/i)
    ).toBeInTheDocument();
    expect(within(latest).getAllByRole('listitem')).toHaveLength(5);
    expect(
      within(latest).queryByText(/couldn't load its latest transactions/i)
    ).not.toBeInTheDocument();
    busy = false;
    newest = 1;
    fireEvent.click(await findRetry(latest));
    expect(
      await within(latest).findByText(/block 2,000,000$/)
    ).toBeInTheDocument();
    expect(
      within(latest).queryByText(/couldn't check for newer transactions/i)
    ).not.toBeInTheDocument();
  });
});

describe('one transaction', () => {
  const routeTx = (answer: () => Answer) => (path: string) =>
    path === `/transactions/signature/${sig(1)}` ? answer() : undefined;

  it('opens from the search field and the event by its signature', async () => {
    routes.push(
      routeTx(() => ({ body: payment(1) })),
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp();
    const field = within(dialog()).getByRole('combobox', {
      name: /find an account/i,
    });
    fireEvent.change(field, { target: { value: sig(1) } });
    // A signature is looked up as it is: no names are searched for it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(calls.some((call) => call.path.startsWith('/names/search'))).toBe(
      false
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Payment',
      })
    ).toBeInTheDocument();
    expect(
      await within(dialog()).findByText(
        (_, node) =>
          node?.tagName === 'P' &&
          /^Publisher sent 15 QORT to Second$/.test(node.textContent ?? '')
      )
    ).toBeInTheDocument();
    expect(within(dialog()).getByText('1,999,999')).toBeInTheDocument();
    expect(within(dialog()).getByText('0.01 QORT')).toBeInTheDocument();
    expect(within(dialog()).getByText(sig(1))).toBeInTheDocument();

    // The event opens it too, as one more step.
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await lookUp(sig(1));
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Payment',
      })
    ).toBeInTheDocument();
  });

  it('names each option of a poll on its transaction’s page', async () => {
    routes.push(
      routeTx(() => ({
        body: {
          type: 'CREATE_POLL',
          timestamp: 1_800_000_000_000,
          signature: sig(1),
          fee: '0.01000000',
          txGroupId: 0,
          blockHeight: 2_000_000,
          approvalStatus: 'NOT_REQUIRED',
          creatorAddress: PUBLISHER,
          owner: PUBLISHER,
          pollName: 'board-poll',
          description: 'A poll',
          pollOptions: [{ optionName: 'Yes' }, { optionName: 'No' }],
        },
      })),
      quietAccount(PUBLISHER, 'Publisher')
    );
    renderWindow();
    await lookUp(sig(1));
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: /poll created/i,
    });
    const label = within(dialog()).getByText(/^options$/i, { selector: 'dt' });
    const value = label.nextElementSibling as HTMLElement;
    // The options as a list in the reader's language: "Yes and No".
    expect(value.textContent).toBe('Yes and No');
    // Nothing of the markers the list is built with.
    expect(value.textContent).not.toMatch(/[\uE000\uE001]|t0|t1/);
  });

  it('shows each amount of a payment in two assets', async () => {
    const THIRD = `Q${'T'.repeat(33)}`;
    routes.push(
      routeTx(() => ({
        body: {
          type: 'MULTI_PAYMENT',
          timestamp: 1_800_000_000_000,
          signature: sig(1),
          fee: '0.01000000',
          txGroupId: 0,
          blockHeight: 2_000_000,
          approvalStatus: 'NOT_REQUIRED',
          creatorAddress: PUBLISHER,
          payments: [
            { recipient: SECOND, assetId: 0, amount: '1.00000000' },
            { recipient: THIRD, assetId: 7, amount: '5.00000000' },
          ],
        },
      })),
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, null),
      quietAccount(THIRD, null)
    );
    renderWindow();
    await lookUp(sig(1));
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: /multi-payment/i,
    });
    const sentence = await within(dialog()).findByText(
      (_, node) =>
        node?.tagName === 'P' &&
        /^Publisher paid 2 accounts/.test(node.textContent ?? '')
    );
    expect(sentence.textContent).toBe(
      'Publisher paid 2 accounts 1 QORT and 5 asset #7 in one payment'
    );
    expect(sentence.textContent).not.toMatch(/[\uE000\uE001]|a0|a1/);
  });

  it('names what a transaction still waiting for a block creates, and an asset’s quantity in full', async () => {
    // Core numbers a new asset or group only once a block takes it.
    const waiting = (n: number, extra: Row) => ({
      ...payment(n),
      blockHeight: undefined,
      recipient: undefined,
      amount: undefined,
      ...extra,
    });
    routes.push(
      (path) =>
        path === `/transactions/signature/${sig(1)}`
          ? {
              body: waiting(1, {
                type: 'ISSUE_ASSET',
                assetName: 'Example Coin',
                description: 'An example',
                quantity: '9007199254740993.12345678',
                isDivisible: true,
              }),
            }
          : path === `/transactions/signature/${sig(2)}`
            ? {
                body: waiting(2, {
                  type: 'CREATE_GROUP',
                  groupName: 'Example Group',
                  description: 'An example',
                  isOpen: true,
                }),
              }
            : undefined,
      quietAccount(PUBLISHER, 'Publisher')
    );
    renderWindow();
    await lookUp(sig(1));
    const sentence = (words: RegExp) =>
      within(dialog()).findByText(
        (_, node) => node?.tagName === 'P' && words.test(node.textContent ?? '')
      );
    expect(
      await sentence(/^Publisher issued the asset “Example Coin”$/)
    ).toBeInTheDocument();
    const quantity = within(dialog()).getByText(/^quantity$/i, {
      selector: 'dt',
    });
    expect(quantity.nextElementSibling?.textContent).toBe(
      '9,007,199,254,740,993.12345678'
    );
    await lookUp(sig(2));
    expect(
      await sentence(/^Publisher created the group Example Group$/)
    ).toBeInTheDocument();
  });

  it('has a page of its own for a signature the node doesn’t know', async () => {
    routes.push(
      routeTx(() => ({
        status: 404,
        body: { error: 311, message: 'transaction unknown' },
      }))
    );
    renderWindow();
    await lookUp(sig(1));
    expect(
      await within(dialog()).findByText(/no transaction has this signature/i)
    ).toBeInTheDocument();
  });

  it('says a failed read with Retry, never that the node doesn’t know it', async () => {
    let fail = true;
    routes.push(
      routeTx(() =>
        fail
          ? { status: 500, body: { error: 1, message: 'busy' } }
          : { body: payment(1) }
      ),
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(sig(1));
    expect(
      await within(dialog()).findByText(/couldn't load this transaction/i)
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(/no transaction has this signature/i)
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /retry/i }));
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Payment',
      })
    ).toBeInTheDocument();
  });

  it('opens from a row, and Back returns to the list', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({ body: [payment(1)] })),
      routeTx(() => ({ body: payment(1) }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    fireEvent.click(await rowButton(panel, /Sent 15 QORT to Second/));
    fireEvent.click(
      within(panel).getByRole('button', { name: /open transaction/i })
    );
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Payment',
      })
    ).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /transactions/i })
    ).toBeInTheDocument();
  });

  it('names who got a minting level from its raw bytes', async () => {
    // TRANSFER_PRIVS's raw bytes: type 40, then the recipient's address at byte 112.
    const bytes = new Uint8Array(137 + 64);
    new DataView(bytes.buffer).setInt32(0, 40);
    const { default: Base58 } = await import('../../encryption/Base58');
    const coder = Base58 as unknown as {
      decode(text: string): Uint8Array;
      encode(bytes: Uint8Array): string;
    };
    const recipient = SECOND;
    const address = coder.decode(recipient);
    expect(address).toHaveLength(25);
    bytes.set(address, 112);
    routes.push(
      routeTx(() => ({
        body: { ...payment(1), type: 'TRANSFER_PRIVS', recipient: undefined },
      })),
      (path) =>
        path === `/transactions/signature/${sig(1)}/raw`
          ? { body: coder.encode(bytes) }
          : undefined,
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(sig(1));
    expect(
      await within(dialog()).findByText(
        (_, node) =>
          node?.tagName === 'P' &&
          /^Publisher moved its minting level to Second$/.test(
            node.textContent ?? ''
          )
      )
    ).toBeInTheDocument();
  });
});

describe('an AT', () => {
  it('opens a page with its transactions only, and reads nothing that waits', async () => {
    routes.push(
      (path) =>
        path === `/addresses/${AT_ADDR}`
          ? { body: { ...account(AT_ADDR), publicKey: undefined } }
          : undefined,
      listOf(AT_ADDR, () => ({
        body: [
          payment(1, {
            type: 'AT',
            creatorAddress: NULL_ACCOUNT,
            atAddress: AT_ADDR,
            recipient: SECOND,
            amount: '50.09999889',
          }),
        ],
      })),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(AT_ADDR);
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: /AT address/i,
      })
    ).toBeInTheDocument();
    expect(within(dialog()).getByText(AT_ADDR)).toBeInTheDocument();
    expect(
      await rowButton(dialog(), /Sent 50\.09999889 QORT to Second/)
    ).toBeInTheDocument();
    expect(within(dialog()).queryByRole('tablist')).not.toBeInTheDocument();
    expect(
      calls.some((call) => call.path.startsWith('/transactions/unconfirmed'))
    ).toBe(false);
  });
});

describe('an AT’s message', () => {
  it('never shows it, in its row or its raw answer', async () => {
    const message = 'tradebotmessage';
    routes.push(
      (path) =>
        path === `/addresses/${AT_ADDR}`
          ? { body: { ...account(AT_ADDR), publicKey: undefined } }
          : undefined,
      listOf(AT_ADDR, () => ({
        body: [
          payment(1, {
            type: 'AT',
            creatorAddress: NULL_ACCOUNT,
            atAddress: AT_ADDR,
            recipient: SECOND,
            amount: '0',
            message,
          }),
        ],
      })),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(AT_ADDR);
    const row = await rowButton(dialog(), /Sent a message to Second/);
    fireEvent.click(row);
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /raw API answer/i })
    );
    const box = within(dialog()).getByRole('region', {
      name: /raw API answer/i,
    });
    expect(box).toHaveTextContent('"message": "(not shown)"');
    expect(box).toHaveTextContent(`"atAddress": "${AT_ADDR}"`);
    expect(document.body.textContent).not.toContain(message);
  });
});

describe('reading only', () => {
  it('sends the node nothing, also while showing more and opening a transaction', async () => {
    routes.push(
      listOf(PUBLISHER, (offset) => ({
        body: offset === 0 ? range(1, 100).map((n) => payment(n)) : [],
      })),
      (path) =>
        path === `/transactions/signature/${sig(1)}`
          ? { body: payment(1) }
          : undefined
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    await within(panel).findByText(/Its newest 100 transactions\./);
    fireEvent.click(showMore(panel));
    await within(panel).findByText(/All 100 of its transactions\./);
    await lookUp(sig(1));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});

describe('what each safeguard keeps', () => {
  it('keeps a Show more still on its way when Refresh is pressed: its failure says so, and Retry reads on from the list Refresh left', async () => {
    const node = { newest: 0, held: new Map<number, Promise<void>>() };
    const older = hold();
    let failMore = true;
    routes.push(
      (path) =>
        failMore &&
        isListRead(path, PUBLISHER) &&
        params(path).get('offset') === '100'
          ? {
              status: 503,
              body: { error: 1, message: 'busy' },
              delay: older.until,
            }
          : undefined,
      growingList(node)
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    await within(panel).findByText(/Its newest 100 transactions\./);
    fireEvent.click(showMore(panel));
    await waitFor(() => expect(listReads()).toHaveLength(2));
    // Refresh while Show more reads: one new transaction on top.
    node.newest = 1;
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    await within(panel).findByText(/Its newest 101 transactions\./);
    await act(async () => {
      older.release();
      await older.until;
    });
    expect(
      await within(panel).findByText(/couldn't load more of its transactions/i)
    ).toBeInTheDocument();
    failMore = false;
    fireEvent.click(await findRetry(panel));
    await within(panel).findByText(/Its newest 201 transactions\./);
    expect(params(lastListRead()).get('offset')).toBe('101');
  });

  it('drops a Show more still on its way when another kind is picked', async () => {
    const failing = hold();
    const finding = hold();
    const olderAnswers: Answer[] = [
      {
        status: 503,
        body: { error: 1, message: 'busy' },
        delay: failing.until,
      },
      {
        body: range(101, 100).map((n) => payment(n)),
        delay: finding.until,
      },
    ];
    routes.push(
      listOf(PUBLISHER, (offset, types) =>
        types.length
          ? { body: [payment(1)] }
          : offset === 0
            ? { body: range(1, 100).map((n) => payment(n)) }
            : (olderAnswers.shift() ?? { body: [] })
      )
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const kinds = within(panel).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    await within(panel).findByText(/Its newest 100 transactions\./);
    for (const answer of [failing, finding]) {
      // Show more, then Payments and back to every kind while it reads.
      fireEvent.click(showMore(panel));
      fireEvent.click(within(kinds).getByRole('button', { name: /payments/i }));
      await within(panel).findByText(/^The only one of this kind\.$/);
      fireEvent.click(within(kinds).getByRole('button', { name: /^all$/i }));
      await within(panel).findByText(/Its newest 100 transactions\./);
      await act(async () => {
        answer.release();
        await answer.until;
      });
      // Neither its failure nor its page lands on the list shown again.
      expect(
        within(panel).queryByText(/couldn't load more of its transactions/i)
      ).not.toBeInTheDocument();
      expect(coverage(panel)).toMatch(/Its newest 100 transactions\./);
      expect(showMore(panel)).toBeEnabled();
    }
  });

  it('opens only a signature from a sentence, never looks anything else up as a name', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({
        body: [
          payment(1, {
            type: 'CANCEL_ASSET_ORDER',
            orderId: 'not-a-signature',
          }),
        ],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    fireEvent.click(await rowButton(panel, /Cancelled an asset order/));
    fireEvent.click(within(panel).getByRole('button', { name: /not-a-si/ }));
    expect(
      within(dialog()).getByRole('heading', { level: 2, name: 'Publisher' })
    ).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes('not-a-signature'))).toBe(
      false
    );
  });

  it('adds no step when the transaction on screen is sent again', async () => {
    routes.push((path) =>
      path === `/transactions/signature/${sig(1)}`
        ? { body: payment(1) }
        : undefined
    );
    routes.push(
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(sig(1));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    await lookUp(sig(1));
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
  });

  it('reads a transaction waiting for a block again on Refresh', async () => {
    let confirmed = false;
    routes.push(
      (path) =>
        path === `/transactions/signature/${sig(1)}`
          ? {
              body: confirmed
                ? payment(1)
                : payment(1, { blockHeight: undefined }),
            }
          : undefined,
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(sig(1));
    expect(
      await within(dialog()).findByText(/^waiting to be confirmed$/i)
    ).toBeInTheDocument();
    confirmed = true;
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    expect(await within(dialog()).findByText('1,999,999')).toBeInTheDocument();
  });

  it('reads an AT’s list again on Refresh', async () => {
    routes.push(
      (path) =>
        path === `/addresses/${AT_ADDR}`
          ? { body: { ...account(AT_ADDR), publicKey: undefined } }
          : undefined,
      listOf(AT_ADDR, () => ({
        body: [
          payment(1, {
            type: 'AT',
            creatorAddress: NULL_ACCOUNT,
            atAddress: AT_ADDR,
            recipient: SECOND,
            amount: '0.00000000',
          }),
        ],
      })),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(AT_ADDR);
    await rowButton(dialog(), /Sent a message to Second/);
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    await waitFor(() => expect(listReads(AT_ADDR)).toHaveLength(2));
  });

  it('never reads a name for an AT named in a sentence', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({
        body: [
          payment(1, {
            type: 'AT',
            creatorAddress: NULL_ACCOUNT,
            atAddress: AT_ADDR,
            recipient: PUBLISHER,
            amount: '1.00000000',
          }),
        ],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    const row = await rowButton(panel, /Received 1 QORT from ATTTTT…TTTTT/);
    fireEvent.click(row);
    await within(panel).findByRole('list', { name: /accounts involved/i });
    expect(
      calls.some((call) => call.path.startsWith(`/names/primary/${AT_ADDR}`))
    ).toBe(false);
  });

  it('has the page of an address the node rejects for an AT address that isn’t one', async () => {
    routes.push((path) =>
      path === `/addresses/${AT_ADDR}`
        ? { status: 400, body: { error: 102, message: 'invalid address' } }
        : undefined
    );
    renderWindow();
    await lookUp(AT_ADDR);
    expect(
      await within(dialog()).findByText(/isn't a valid Qortal address/i)
    ).toBeInTheDocument();
    expect(listReads(AT_ADDR)).toHaveLength(0);
  });

  it('reads the names in a row only once the row nears the screen', async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      targets: Element[];
    }> = [];
    class FakeObserver {
      callback: IntersectionObserverCallback;
      targets: Element[] = [];
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    routes.push(listOf(PUBLISHER, () => ({ body: [payment(1)] })));
    await openPublisher();
    const panel = await openTransactionsTab();
    const row = await rowButton(panel, /Sent 15 QORT to QSSSSS…SSSSS/);
    expect(calls.some((call) => call.path === `/names/primary/${SECOND}`)).toBe(
      false
    );
    act(() => {
      for (const observer of observers)
        observer.callback(
          observer.targets.map(
            (target) =>
              ({ isIntersecting: true, target }) as IntersectionObserverEntry
          ),
          observer as unknown as IntersectionObserver
        );
    });
    expect(
      await rowButton(panel, /Sent 15 QORT to Second/)
    ).toBeInTheDocument();
    expect(row).toBeInTheDocument();
  });

  it('in its own list, a minting level moved to it needs no raw read', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({
        body: [
          payment(1, {
            type: 'TRANSFER_PRIVS',
            creatorAddress: SECOND,
            recipient: undefined,
          }),
        ],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    expect(
      await rowButton(panel, /Got its minting level from Second/)
    ).toBeInTheDocument();
    expect(calls.some((call) => call.path.endsWith('/raw'))).toBe(false);
  });

  it("says when it couldn't read who got a minting level, with Retry", async () => {
    let fail = true;
    const bytes = new Uint8Array(137 + 64);
    new DataView(bytes.buffer).setInt32(0, 40);
    const { default: Base58 } = await import('../../encryption/Base58');
    const coder = Base58 as unknown as {
      decode(text: string): Uint8Array;
      encode(bytes: Uint8Array): string;
    };
    bytes.set(coder.decode(SECOND), 112);
    routes.push(
      (path) =>
        path === `/transactions/signature/${sig(1)}`
          ? {
              body: {
                ...payment(1),
                type: 'TRANSFER_PRIVS',
                recipient: undefined,
              },
            }
          : path === `/transactions/signature/${sig(1)}/raw`
            ? fail
              ? { status: 500, body: 'busy' }
              : { body: coder.encode(bytes) }
            : undefined,
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(sig(1));
    expect(
      await within(dialog()).findByText(
        /couldn't read which account received the minting level/i
      )
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /retry/i }));
    expect(
      await within(dialog()).findByText(
        (_, node) =>
          node?.tagName === 'P' &&
          /^Publisher moved its minting level to Second$/.test(
            node.textContent ?? ''
          )
      )
    ).toBeInTheDocument();
  });

  it('keeps a name in a sentence isolated from the words around it', async () => {
    routes.push(
      listOf(PUBLISHER, () => ({
        body: [payment(1, { type: 'REGISTER_NAME', name: 'Example' })],
      }))
    );
    await openPublisher();
    const panel = await openTransactionsTab();
    await rowButton(panel, /Registered the name “Example”/);
    expect(within(panel).getByText('Example').tagName).toBe('BDI');
  });
});
