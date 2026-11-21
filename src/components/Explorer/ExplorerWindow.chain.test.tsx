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

import i18n from '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import { lightTheme } from '../../styles/theme-light';
import { CHAIN_TYPES } from '../../lib/explorer/chainTx';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// Transactions on Qortal: the whole chain's confirmed transactions on the
// start page and as a step of the window, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const PUBLIC_KEY = 'k'.repeat(44);
/** The chain's newest block, unless a test moves it. */
const TIP = 2_000_500;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (n: number) => {
  let text = '';
  do {
    text = ALPHABET[n % 58] + text;
    n = Math.floor(n / 58);
  } while (n > 0);
  return text;
};
/** A signature of its own for each number from −10,000 (88 base58 characters). */
const sig = (n: number) =>
  `S${base58(n + 10_000).padStart(6, '1')}`.padEnd(88, 'x');

type Row = Record<string, unknown> & {
  type: string;
  timestamp: number;
  blockHeight?: number;
  signature: string;
};

/** Publisher's payment number `n` to Second, in block TIP − n: the higher `n`, the older. */
const payment = (n: number, extra: Partial<Row> = {}): Row => ({
  type: 'PAYMENT',
  timestamp: 1_800_000_000_000 - n * 60_000,
  signature: sig(n),
  fee: '0.01000000',
  txGroupId: 0,
  blockHeight: TIP - n,
  approvalStatus: 'NOT_REQUIRED',
  creatorAddress: PUBLISHER,
  recipient: SECOND,
  amount: '15.00000000',
  ...extra,
});

const register = (n: number, name: string, extra: Partial<Row> = {}): Row => ({
  type: 'REGISTER_NAME',
  timestamp: 1_800_000_000_000 - n * 60_000,
  signature: sig(n),
  fee: '0.01000000',
  txGroupId: 0,
  blockHeight: TIP - n,
  approvalStatus: 'NOT_REQUIRED',
  creatorAddress: SECOND,
  name,
  data: '',
  ...extra,
});

const range = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => from + index);

type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

/** The made-up node: its tip, its confirmed rows, what waits, and answers held back or failing. */
let node: {
  tip: number;
  rows: Row[];
  waiting: Row[];
  /** A path's answer, when a test sets one (a failure, a held answer). */
  special: Route;
};
let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

/** A search of the whole chain (no address). */
const isChainSearch = (path: string) =>
  path.startsWith('/transactions/search?') && !params(path).get('address');
const chainSearches = () =>
  calls.filter((call) => isChainSearch(call.path)).map((call) => call.path);
/** The newest whole-chain search's query. */
const lastSearch = () => {
  const searches = chainSearches();
  return params(searches[searches.length - 1] ?? '');
};
const tipReads = () =>
  calls.filter((call) => call.path === '/blocks/height').length;
const waitingReads = () =>
  calls
    .filter((call) => call.path.startsWith('/transactions/unconfirmed?'))
    .map((call) => call.path);

const chainRoute: Route = (path) => {
  if (path === '/blocks/height') return { body: node.tip };
  if (path.startsWith('/transactions/unconfirmed?')) {
    const types = params(path).getAll('txType');
    return {
      body: node.waiting
        .filter((row) => !types.length || types.includes(row.type))
        .slice(0, Number(params(path).get('limit') ?? 100)),
    };
  }
  if (!isChainSearch(path)) return undefined;
  const query = params(path);
  const types = query.getAll('txType');
  const start = Number(query.get('startBlock'));
  const limit = Number(query.get('blockLimit'));
  const newestFirst = query.get('reverse') === 'true';
  const rows = node.rows
    .filter(
      (row) =>
        (!types.length || types.includes(row.type)) &&
        typeof row.blockHeight === 'number' &&
        row.blockHeight >= start &&
        row.blockHeight < start + limit
    )
    .sort((a, b) =>
      newestFirst ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
    );
  const offset = Number(query.get('offset'));
  return { body: rows.slice(offset, offset + Number(query.get('limit'))) };
};

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
  if (path === '/admin/status') return { body: { height: TIP } };
  if (path === '/admin/info')
    return { body: { currentTimestamp: 2_000_000_000_000 } };
  if (path.startsWith('/blocks/byheight/'))
    return {
      body: { height: TIP - 1440, timestamp: 2_000_000_000_000 - 86_400_000 },
    };
  return undefined;
};

function stubNode() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).slice('http://node.test'.length);
      calls.push({ method: init?.method ?? 'GET', path });
      for (const route of [node.special, ...routes, chainRoute, commonRoutes]) {
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

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Hub's own toggle for the window, outside it. */}
      <button type="button" onClick={() => setOpen((was) => !was)}>
        hub toggle
      </button>
      <ExplorerWindow
        isOpenDrawerLookup={open}
        setIsOpenDrawerLookup={setOpen}
      />
    </>
  );
}

function renderWindow(theme = darkTheme) {
  const store = createStore();
  store.set(userInfoAtom, { address: READER, name: 'Reader' } as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
  return store;
}

const lookUp = (addressOrName?: string) =>
  act(() => {
    executeEvent(
      'openUserLookupDrawer',
      addressOrName ? { addressOrName } : {}
    );
  });

const dialog = () => screen.getByRole('dialog');

/** An answer held back until it is let go. */
function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
}

/** The start page's "The whole chain" section. */
const startSection = () =>
  within(dialog()).findByRole('region', { name: /the whole chain/i });

async function openStart() {
  const store = renderWindow();
  await lookUp();
  return Object.assign(await startSection(), { store });
}

/** The step, opened from the start page's button. */
async function openChainStep() {
  const section = await openStart();
  fireEvent.click(
    within(section).getByRole('button', { name: /^transactions on qortal$/i })
  );
  await within(dialog()).findByRole('heading', {
    level: 2,
    name: 'Transactions on Qortal',
  });
}

/** The step's list of confirmed transactions (its section). */
const results = () =>
  within(dialog()).findByRole('region', {
    name: /every kind except messages|payments|names|registration/i,
  });

/** The line under the list. */
const coverage = (scope: HTMLElement) =>
  [...scope.querySelectorAll('[role="status"]')]
    .map((node_) => node_.textContent)
    .join(' | ');

const rowButtons = (scope: HTMLElement) => [
  ...scope.querySelectorAll<HTMLElement>('[data-tx-row]'),
];

/** "Show older" (or newer), found by its words. */
const showMoreButton = (scope: HTMLElement, words = /^show older$/i) =>
  within(scope).getByText(words).closest('button') as HTMLElement;

/** Retry, found by its words. */
const findRetry = async (scope: HTMLElement) =>
  (await within(scope).findByText(/^retry$/i)).closest('button') as HTMLElement;

/** Let effects and answers already on their way settle. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** A transaction's own page reads it by its signature. */
const txRoute =
  (n: number, row: Row): Route =>
  (path) =>
    path === `/transactions/signature/${sig(n)}` ? { body: row } : undefined;

const blockLink = () =>
  within(dialog()).getByRole('button', {
    name: /^transactions in this block$/i,
  });
const fromField = () =>
  within(dialog()).getByRole('textbox', { name: 'From block' });
const showButton = () => within(dialog()).getByRole('button', { name: 'Show' });
const stepTitle = () =>
  within(dialog()).getByRole('heading', {
    level: 2,
    name: 'Transactions on Qortal',
  });

/** One transaction's page, then its block's list. */
async function openBlockOf(n: number, row: Row) {
  routes.push(txRoute(n, row));
  renderWindow();
  await lookUp(sig(n));
  await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
  fireEvent.click(blockLink());
  await within(dialog()).findByRole('heading', {
    level: 2,
    name: 'Transactions on Qortal',
  });
}

async function pick(combobox: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(
    within(dialog()).getByRole('combobox', { name: combobox })
  );
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

beforeEach(() => {
  routes = [
    quietAccount(PUBLISHER, 'Publisher'),
    quietAccount(SECOND, 'Second'),
  ];
  calls = [];
  node = {
    tip: TIP,
    rows: range(0, 30).map((n) => payment(n)),
    waiting: [],
    special: () => undefined,
  };
  window.localStorage.clear();
  stubNode();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the start page', () => {
  it('shows the whole chain’s newest transactions, read once, every kind but messages in the latest 1,000 blocks', async () => {
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    expect(rowButtons(section)[0]).toHaveAccessibleName(
      /Publisher sent 15 QORT to Second.*block 2,000,500/
    );
    expect(tipReads()).toBe(1);
    expect(chainSearches()).toHaveLength(1);
    const query = params(chainSearches()[0]);
    expect(query.getAll('txType')).toEqual([...CHAIN_TYPES]);
    expect(query.getAll('txType')).not.toContain('MESSAGE');
    expect(query.getAll('txType')).not.toContain('CHAT');
    expect(query.get('startBlock')).toBe(String(TIP - 999));
    expect(query.get('blockLimit')).toBe('1000');
    expect(query.get('confirmationStatus')).toBe('CONFIRMED');
    expect(query.get('limit')).toBe('20');
    expect(query.get('reverse')).toBe('true');
    expect(query.get('address')).toBeNull();
  });

  it('opens the whole list on the same tip, its first page the one already read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    // Minutes on the start page, the chain moving on: the list keeps the blocks it showed.
    node.tip = TIP + 3;
    vi.setSystemTime(Date.now() + 2 * 60_000);
    fireEvent.click(
      within(section).getByRole('button', { name: /^transactions on qortal$/i })
    );
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    expect(coverage(list)).toContain(
      'The newest 20 in blocks 1,999,501–2,000,500.'
    );
    expect(tipReads()).toBe(1);
    expect(chainSearches()).toHaveLength(1);
    expect(
      within(dialog()).getByText(
        /^Up to block 2,000,500, the chain's newest when this list was last brought up to date\./
      )
    ).toBeInTheDocument();
  });

  it('says a failed read with Retry, never “no transactions”, and Retry reads again', async () => {
    let failTip = true;
    let failPage = true;
    node.special = (path) => {
      if (path === '/blocks/height' && failTip)
        return { status: 503, body: { error: 1, message: 'busy' } };
      if (isChainSearch(path) && failPage)
        return { status: 400, body: 'Bad parameter "txType"' };
      return undefined;
    };
    const section = await openStart();
    expect(
      await within(section).findByText(
        "Couldn't read the chain's latest transactions."
      )
    ).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/no transactions/i);
    failTip = false;
    fireEvent.click(await findRetry(section));
    // The tip now reads; the search fails, and it says so again.
    await waitFor(() => expect(chainSearches()).toHaveLength(1));
    expect(
      await within(section).findByText(
        "Couldn't read the chain's latest transactions."
      )
    ).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/no transactions/i);
    failPage = false;
    fireEvent.click(await findRetry(section));
    // Retry goes once pressed: the keyboard is on the button that stays.
    expect(
      within(section).getByRole('button', {
        name: /^transactions on qortal$/i,
      })
    ).toHaveFocus();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
  });

  it('says there are none only for an empty answer of the search', async () => {
    node.rows = [];
    const section = await openStart();
    expect(
      await within(section).findByText(
        'No transactions other than messages in the latest 1,000 blocks.'
      )
    ).toBeInTheDocument();
  });

  it('reads when it shows, once: Back soon reads nothing again, Back later reads the newest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    node.rows = range(-5, 30).map((n) => payment(n));
    const openSecond = async (section: HTMLElement) => {
      fireEvent.click(
        within(rowButtons(section)[0].parentElement as HTMLElement).getByRole(
          'button',
          { name: 'Second', hidden: true }
        )
      );
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Second',
      });
    };
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    await openSecond(section);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const soon = await startSection();
    await waitFor(() => expect(rowButtons(soon)).toHaveLength(5));
    expect(rowButtons(soon)[0]).toHaveAccessibleName(/block 2,000,500/);
    expect(tipReads()).toBe(1);
    expect(chainSearches()).toHaveLength(1);

    // Minutes later the chain is further on: showing again reads the newest, once.
    await openSecond(soon);
    node.tip = TIP + 5;
    vi.setSystemTime(Date.now() + 5 * 60_000);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const later = await startSection();
    await waitFor(() =>
      expect(rowButtons(later)[0]).toHaveAccessibleName(/block 2,000,505/)
    );
    expect(tipReads()).toBe(2);
    expect(chainSearches()).toHaveLength(2);
    // Nothing polls while it shows.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(tipReads()).toBe(2);
    expect(chainSearches()).toHaveLength(2);
  });

  it('reads the newest when the window opens again, keeping nothing of the last time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    fireEvent.click(screen.getByText('hub toggle'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    // A minute later, the chain is further on.
    vi.setSystemTime(Date.now() + 60_000);
    node.tip = TIP + 2;
    node.rows = range(-2, 30).map((n) => payment(n));
    await lookUp();
    const again = await startSection();
    await waitFor(() =>
      expect(rowButtons(again)[0]).toHaveAccessibleName(/block 2,000,502/)
    );
  });
});

describe('another Hub account', () => {
  it('starts the start page again: the newest is read for it, nothing kept from the last one', async () => {
    node.rows = range(-4, 30).map((n) => payment(n));
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    expect(rowButtons(section)[0]).toHaveAccessibleName(/block 2,000,500/);
    node.tip = TIP + 4;
    act(() => {
      section.store.set(userInfoAtom, {
        address: SECOND,
        name: 'Second',
      } as never);
    });
    const again = await startSection();
    await waitFor(() =>
      expect(rowButtons(again)[0]).toHaveAccessibleName(/block 2,000,504/)
    );
    expect(tipReads()).toBe(2);
  });
});

describe('Transactions on Qortal', () => {
  it('reads 20 a page, and Show older reads on in the same blocks, putting the keyboard on the first row it added', async () => {
    node.rows = range(0, 45).map((n) => payment(n));
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    node.tip = TIP + 4;
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(40));
    await waitFor(() => expect(rowButtons(list)[20]).toHaveFocus());
    expect(coverage(list)).toContain(
      'The newest 40 in blocks 1,999,501–2,000,500.'
    );
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(45));
    expect(coverage(list)).toContain('All 45 in blocks 1,999,501–2,000,500.');
    expect(within(list).queryByText(/^show older$/i)).not.toBeInTheDocument();
    const searches = chainSearches().map(params);
    expect(searches.map((query) => query.get('offset'))).toEqual([
      '0',
      '20',
      '40',
    ]);
    for (const query of searches) {
      expect(query.get('startBlock')).toBe(String(TIP - 999));
      expect(query.get('blockLimit')).toBe('1000');
    }
    expect(tipReads()).toBe(1);
  });

  it('says “all” only once a read proved it: a full page, then an empty one', async () => {
    node.rows = range(0, 20).map((n) => payment(n));
    await openChainStep();
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain(
        'The newest 20 in blocks 1,999,501–2,000,500.'
      )
    );
    fireEvent.click(showMoreButton(list));
    await waitFor(() =>
      expect(coverage(list)).toContain('All 20 in blocks 1,999,501–2,000,500.')
    );
    expect(rowButtons(list)).toHaveLength(20);
    // Nothing new came: the keyboard goes to the line that says so.
    await waitFor(() =>
      expect(within(list).getByText(/^All 20 in blocks/)).toHaveFocus()
    );
  });

  it('reads one press’s page once, however quickly it is pressed', async () => {
    node.rows = range(0, 60).map((n) => payment(n));
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    const button = showMoreButton(list);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(rowButtons(list)).toHaveLength(40));
    expect(chainSearches().map((path) => params(path).get('offset'))).toEqual([
      '0',
      '20',
    ]);
  });

  it('reads one kind, and one type of it, and never offers messages', async () => {
    node.rows = [payment(0), register(1, 'Example'), payment(2)];
    await openChainStep();
    const kinds = within(dialog()).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    expect(
      within(kinds).queryByRole('button', { name: /messages/i })
    ).not.toBeInTheDocument();
    fireEvent.click(within(kinds).getByRole('button', { name: /^names$/i }));
    await waitFor(() =>
      expect(lastSearch().getAll('txType')).toEqual([
        'REGISTER_NAME',
        'UPDATE_NAME',
        'SELL_NAME',
        'CANCEL_SELL_NAME',
        'BUY_NAME',
      ])
    );
    const list = await results();
    await waitFor(() =>
      expect(rowButtons(list)[0]).toHaveAccessibleName(
        /Second registered the name “Example”/
      )
    );
    expect(coverage(list)).toContain(
      'The only one in blocks 1,999,501–2,000,500.'
    );

    await pick(/^type/i, /^Name purchase$/);
    await waitFor(() =>
      expect(lastSearch().getAll('txType')).toEqual(['BUY_NAME'])
    );
    expect(
      await within(dialog()).findByText(
        'No transactions of this kind in blocks 1,999,501–2,000,500.'
      )
    ).toBeInTheDocument();
    for (const path of chainSearches()) {
      expect(params(path).getAll('txType')).not.toContain('MESSAGE');
      expect(params(path).getAll('txType')).not.toContain('CHAT');
    }
  });

  it('offers the latest 10,000 blocks when the latest 1,000 hold none of a kind', async () => {
    node.rows = [payment(0), register(4_000, 'Example')];
    await openChainStep();
    fireEvent.click(within(dialog()).getByRole('button', { name: /^names$/i }));
    const list = await results();
    expect(
      await within(list).findByText(
        'No transactions of this kind in blocks 1,999,501–2,000,500.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      within(list).getByRole('button', {
        name: 'Look in the latest 10,000 blocks',
      })
    );
    await waitFor(() => expect(lastSearch().get('blockLimit')).toBe('10000'));
    expect(lastSearch().get('startBlock')).toBe(String(TIP - 9_999));
    expect(
      within(dialog()).getByRole('combobox', { name: /^blocks/i })
    ).toHaveTextContent('The latest 10,000 blocks');
    const wider = await results();
    await waitFor(() =>
      expect(rowButtons(wider)[0]).toHaveAccessibleName(
        /Second registered the name “Example”/
      )
    );
    // The button went: the keyboard is on the first row it brought.
    await waitFor(() => expect(rowButtons(wider)[0]).toHaveFocus());
    // Nothing more to offer there.
    expect(
      within(dialog()).queryByRole('button', { name: /^look in the latest/i })
    ).not.toBeInTheDocument();
  });

  it('says a failed search with Retry, never that there are none', async () => {
    let fail = false;
    node.special = (path) =>
      isChainSearch(path) && fail
        ? { status: 400, body: 'Bad parameter "txType"' }
        : undefined;
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    // Another kind's first page fails.
    fail = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^payments$/i })
    );
    const failed = await results();
    expect(
      await within(failed).findByText("Couldn't search the chain.")
    ).toBeInTheDocument();
    expect(failed.textContent).not.toMatch(/no transactions/i);
    fail = false;
    fireEvent.click(await findRetry(failed));
    await waitFor(() => expect(rowButtons(failed)).toHaveLength(20));
    // Retry went once pressed: the keyboard is on the first row it brought.
    await waitFor(() => expect(rowButtons(failed)[0]).toHaveFocus());
  });

  it('keeps the rows above a page that failed, with Retry', async () => {
    node.rows = range(0, 30).map((n) => payment(n));
    let fail = true;
    node.special = (path) =>
      isChainSearch(path) && params(path).get('offset') === '20' && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    expect(
      await within(list).findByText("Couldn't load older transactions.")
    ).toBeInTheDocument();
    expect(rowButtons(list)).toHaveLength(20);
    expect(coverage(list)).toContain(
      'The newest 20 in blocks 1,999,501–2,000,500.'
    );
    // Show older went with the failure: the keyboard is on its Retry.
    const retry = await findRetry(list);
    await waitFor(() => expect(retry).toHaveFocus());
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(rowButtons(list)).toHaveLength(30));
    await waitFor(() => expect(rowButtons(list)[20]).toHaveFocus());
    expect(coverage(list)).toContain('All 30 in blocks 1,999,501–2,000,500.');
  });

  it('a page that fails when Back reads it again: its Retry puts the keyboard on the first row it brings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    node.rows = range(0, 30).map((n) => payment(n));
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(30));
    fireEvent.click(
      within(rowButtons(list)[0].parentElement as HTMLElement).getByRole(
        'button',
        { name: 'Second', hidden: true }
      )
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    // Long enough for the window's cache to let the pages go; the second fails when read again.
    vi.setSystemTime(Date.now() + 31 * 60_000);
    let fail = true;
    node.special = (path) =>
      isChainSearch(path) && params(path).get('offset') === '20' && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await results();
    expect(
      await within(again).findByText("Couldn't load older transactions.")
    ).toBeInTheDocument();
    expect(rowButtons(again)).toHaveLength(20);
    fail = false;
    fireEvent.click(await findRetry(again));
    await waitFor(() => expect(rowButtons(again)).toHaveLength(30));
    await waitFor(() => expect(rowButtons(again)[20]).toHaveFocus());
  });

  it('shows a row the node gives on two pages once', async () => {
    node.rows = range(0, 40).map((n) => payment(n));
    // Two rows made at the same moment, ordered differently by the second read.
    node.special = (path) => {
      if (!isChainSearch(path) || params(path).get('offset') !== '20')
        return undefined;
      return { body: [payment(19), ...range(20, 19).map((n) => payment(n))] };
    };
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    await waitFor(() =>
      expect(coverage(list)).toContain(
        'The newest 39 in blocks 1,999,501–2,000,500.'
      )
    );
    expect(rowButtons(list)).toHaveLength(39);
  });

  it('never says “all” once a row came on two pages', async () => {
    node.rows = range(0, 24).map((n) => payment(n));
    // The second read gives the first page's last row again: another may have been passed over.
    node.special = (path) =>
      isChainSearch(path) && params(path).get('offset') === '20'
        ? { body: [payment(19), ...range(20, 4).map((n) => payment(n))] }
        : undefined;
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(24));
    expect(coverage(list)).toContain(
      'The newest 24 in blocks 1,999,501–2,000,500.'
    );
    expect(coverage(list)).not.toContain('All 24');
    expect(within(list).queryByText(/^show older$/i)).not.toBeInTheDocument();
  });

  it('reads the latest 10,000 blocks, or the blocks from one typed in, never past the tip', async () => {
    node.rows = [payment(0), payment(3), payment(20), payment(5_000)];
    await openChainStep();
    await pick(/^blocks/i, 'The latest 10,000 blocks');
    await waitFor(() => expect(lastSearch().get('blockLimit')).toBe('10000'));
    expect(lastSearch().get('startBlock')).toBe(String(TIP - 9_999));
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('All 4 in blocks 1,990,501–2,000,500.')
    );

    await pick(/^blocks/i, 'From a block…');
    const field = within(dialog()).getByRole('textbox', { name: 'From block' });
    expect(field).toHaveAttribute('inputmode', 'numeric');
    const before = chainSearches().length;
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Show' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'Enter a block number, like 2700000 or 2,700,000.'
    );
    fireEvent.change(field, { target: { value: '2,000,501' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Show' }));
    // The last message goes while the chain's newest block is read again.
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    // Refused only once the chain's newest block has been read again.
    await waitFor(() =>
      expect(within(dialog()).getByRole('alert')).toHaveTextContent(
        'The chain is at block 2,000,500.'
      )
    );
    expect(chainSearches()).toHaveLength(before);

    // 100 blocks from one near the tip: the range stops at the tip.
    fireEvent.change(field, { target: { value: '2,000,480' } });
    await pick(/^how many blocks/i, '100 blocks');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(lastSearch().get('startBlock')).toBe('2000480'));
    expect(lastSearch().get('blockLimit')).toBe('21');
    const from = await results();
    await waitFor(() =>
      expect(coverage(from)).toContain('All 3 in blocks 2,000,480–2,000,500.')
    );
    for (const path of chainSearches()) {
      const query = params(path);
      expect(
        Number(query.get('startBlock')) + Number(query.get('blockLimit')) - 1
      ).toBeLessThanOrEqual(TIP);
    }
  });

  it('reads oldest first, and one block alone, saying so for exactly one', async () => {
    node.rows = range(0, 30).map((n) => payment(n));
    await openChainStep();
    await pick(/^order/i, 'Oldest first');
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain(
        'The oldest 20 in blocks 1,999,501–2,000,500.'
      )
    );
    expect(lastSearch().get('reverse')).toBe('false');
    expect(rowButtons(list)[0]).toHaveAccessibleName(/block 2,000,471/);
    expect(showMoreButton(list, /^show newer$/i)).toBeInTheDocument();

    await pick(/^blocks/i, 'From a block…');
    fireEvent.change(
      within(dialog()).getByRole('textbox', { name: 'From block' }),
      { target: { value: '2000490' } }
    );
    await pick(/^how many blocks/i, 'Just this block');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Show' }));
    const one = await results();
    await waitFor(() =>
      expect(coverage(one)).toContain('The only one in block 2,000,490.')
    );
    const query = lastSearch();
    expect(query.get('startBlock')).toBe('2000490');
    expect(query.get('blockLimit')).toBe('1');
  });

  it('keeps a block typed but not shown yet with the step', async () => {
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    await pick(/^blocks/i, 'From a block…');
    fireEvent.change(fromField(), { target: { value: '2,000,400' } });
    await pick(/^how many blocks/i, '100 blocks');
    const searched = chainSearches().length;
    // Away to an account named in a row, and Back.
    fireEvent.click(
      within(rowButtons(list)[0].parentElement as HTMLElement).getByRole(
        'button',
        { name: 'Second', hidden: true }
      )
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('textbox', { name: 'From block' })
    ).toHaveValue('2,000,400');
    expect(
      within(dialog()).getByRole('combobox', { name: /^how many blocks/i })
    ).toHaveTextContent('100 blocks');
    expect(chainSearches()).toHaveLength(searched);
  });

  it('shows what waits for a block apart, with the latest blocks only', async () => {
    node.waiting = [
      payment(-1, { blockHeight: undefined }),
      register(-2, 'Waiting', { blockHeight: undefined }),
    ];
    await openChainStep();
    const waiting = await within(dialog()).findByRole('region', {
      name: 'Waiting to be confirmed (2)',
    });
    expect(rowButtons(waiting)).toHaveLength(2);
    expect(rowButtons(waiting)[0]).toHaveAccessibleName(
      /Publisher sent 15 QORT to Second.*waiting/i
    );
    const query = params(waitingReads()[0]);
    expect(query.getAll('txType')).toEqual([...CHAIN_TYPES]);
    expect(query.get('limit')).toBe('20');
    expect(query.get('reverse')).toBe('true');
    expect(query.get('startBlock')).toBeNull();
    expect(query.get('confirmationStatus')).toBeNull();
    // The confirmed ones are apart.
    expect(rowButtons(await results())).toHaveLength(20);

    // Older blocks: nothing waits in them.
    const reads = waitingReads().length;
    await pick(/^blocks/i, 'From a block…');
    fireEvent.change(
      within(dialog()).getByRole('textbox', { name: 'From block' }),
      { target: { value: '1990000' } }
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(lastSearch().get('startBlock')).toBe('1990000'));
    expect(
      within(dialog()).queryByRole('region', {
        name: /waiting to be confirmed/i,
      })
    ).not.toBeInTheDocument();
    expect(waitingReads()).toHaveLength(reads);
  });

  it('says the newest 20 of what waits when the node gives as many as it gives at most', async () => {
    node.waiting = range(1, 25).map((n) =>
      payment(-n, { blockHeight: undefined })
    );
    await openChainStep();
    expect(
      await within(dialog()).findByRole('region', {
        name: 'Waiting to be confirmed (the newest 20)',
      })
    ).toBeInTheDocument();
  });

  it("says when it couldn't check what waits, with Retry, never that none waits", async () => {
    let fail = true;
    node.waiting = [payment(-1, { blockHeight: undefined })];
    node.special = (path) =>
      path.startsWith('/transactions/unconfirmed?') && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    await openChainStep();
    const message = await within(dialog()).findByText(
      "Couldn't check what waits for a block."
    );
    fail = false;
    fireEvent.click(
      await findRetry(message.closest('[role="alert"]') as HTMLElement)
    );
    // Retry goes once pressed (and so may the section): the keyboard is on the step's heading.
    expect(stepTitle()).toHaveFocus();
    expect(
      await within(dialog()).findByRole('region', {
        name: 'Waiting to be confirmed (1)',
      })
    ).toBeInTheDocument();
  });

  it('opens accounts and transactions from its rows, and Back shows the list as it was left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    node.rows = range(0, 50).map((n) => payment(n));
    routes.push((path) =>
      path === `/transactions/signature/${sig(25)}`
        ? { body: payment(25) }
        : undefined
    );
    await openChainStep();
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^payments$/i })
    );
    await pick(/^order/i, 'Oldest first');
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list, /^show newer$/i));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(40));
    const searched = chainSearches().length;

    // An account named in a row: a step of its own, a trail of its own.
    fireEvent.click(
      within(rowButtons(list)[0].parentElement as HTMLElement).getByRole(
        'button',
        { name: 'Second', hidden: true }
      )
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    // Minutes later the chain is further on, and the window's cache has let the tip go.
    node.tip = TIP + 9;
    vi.setSystemTime(Date.now() + 5 * 60_000);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await results();
    await waitFor(() => expect(rowButtons(again)).toHaveLength(40));
    expect(
      within(dialog()).getByRole('button', { name: /^payments$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(dialog()).getByRole('combobox', { name: /^order/i })
    ).toHaveTextContent('Oldest first');
    expect(coverage(again)).toContain(
      'The oldest 40 in blocks 1,999,501–2,000,500.'
    );
    expect(chainSearches()).toHaveLength(searched);
    expect(tipReads()).toBe(1);

    // A row opens to its details and its own page; Back comes back here.
    fireEvent.click(rowButtons(again)[24]);
    fireEvent.click(
      within(again).getByRole('button', { name: /open transaction/i })
    );
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Payment',
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await waitFor(async () =>
      expect(rowButtons(await results())).toHaveLength(40)
    );
  });

  it('Refresh pins the newer tip on purpose and starts the list again, reading what waits again', async () => {
    node.rows = range(-5, 60).map((n) => payment(n));
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(40));
    expect(rowButtons(list)[0]).toHaveAccessibleName(/block 2,000,500/);
    const waited = waitingReads().length;
    node.tip = TIP + 5;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(() =>
      expect(lastSearch().get('startBlock')).toBe(String(TIP + 5 - 999))
    );
    const fresh = await results();
    await waitFor(() =>
      expect(rowButtons(fresh)[0]).toHaveAccessibleName(/block 2,000,505/)
    );
    expect(rowButtons(fresh)).toHaveLength(20);
    expect(coverage(fresh)).toContain(
      'The newest 20 in blocks 1,999,506–2,000,505.'
    );
    // The line says what is true after a Refresh too.
    expect(
      within(dialog()).getByText(
        "Up to block 2,000,505, the chain's newest when this list was last brought up to date. Refresh reads newer blocks."
      )
    ).toBeInTheDocument();
    expect(tipReads()).toBe(2);
    await waitFor(() => expect(waitingReads().length).toBe(waited + 1));
  });

  it("keeps the list when Refresh couldn't read the newest block, and says so, with Retry", async () => {
    let fail = false;
    node.special = (path) =>
      path === '/blocks/height' && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fail = true;
    node.tip = TIP + 7;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(dialog()).findByText(
        "Couldn't read the chain's newest block: the list stays up to block 2,000,500."
      )
    ).toBeInTheDocument();
    expect(rowButtons(await results())).toHaveLength(20);
    fail = false;
    fireEvent.click(await findRetry(dialog()));
    expect(stepTitle()).toHaveFocus();
    await waitFor(() =>
      expect(lastSearch().get('startBlock')).toBe(String(TIP + 7 - 999))
    );
  });

  it('drops a newer tip that comes back after the list was left', async () => {
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    const slow = hold();
    node.special = (path) =>
      path === '/blocks/height'
        ? { body: TIP + 6, delay: slow.until }
        : undefined;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(() => expect(tipReads()).toBe(2));
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await startSection();
    await act(async () => {
      slow.release();
      await slow.until;
    });
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^forward$/i })
    );
    const again = await results();
    await waitFor(() => expect(rowButtons(again)).toHaveLength(20));
    // The list is still on the tip it had (the start page, shown meanwhile, read the newer one).
    expect(coverage(again)).toContain(
      'The newest 20 in blocks 1,999,501–2,000,500.'
    );
    expect(rowButtons(again)[0]).toHaveAccessibleName(/block 2,000,500/);
  });

  it('drops a page that comes back after another kind was picked', async () => {
    node.rows = [payment(0), register(1, 'Example')];
    const slow = hold();
    node.special = (path) =>
      isChainSearch(path) && params(path).getAll('txType').length > 30
        ? { body: [payment(0), register(1, 'Example')], delay: slow.until }
        : undefined;
    const section = await openStart();
    await waitFor(() => expect(chainSearches()).toHaveLength(1));
    fireEvent.click(
      within(section).getByRole('button', { name: /^transactions on qortal$/i })
    );
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Transactions on Qortal',
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^names$/i }));
    const names = await results();
    await waitFor(() =>
      expect(rowButtons(names)[0]).toHaveAccessibleName(
        /Second registered the name “Example”/
      )
    );
    await act(async () => {
      slow.release();
      await slow.until;
    });
    expect(rowButtons(await results())).toHaveLength(1);
    expect(
      within(dialog()).getByRole('region', { name: /^names$/i })
    ).toBeInTheDocument();
  });

  it('opens from a transaction’s block: that block alone, every kind but messages, oldest first', async () => {
    node.rows = [
      payment(3),
      register(4, 'Example', { blockHeight: TIP - 3 }),
      payment(5),
    ];
    routes.push((path) =>
      path === `/transactions/signature/${sig(3)}`
        ? { body: payment(3) }
        : undefined
    );
    renderWindow();
    await lookUp(sig(3));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    fireEvent.click(
      within(dialog()).getByRole('button', {
        name: /^transactions in this block$/i,
      })
    );
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('All 2 in block 2,000,497.')
    );
    const query = lastSearch();
    expect(query.get('startBlock')).toBe(String(TIP - 3));
    expect(query.get('blockLimit')).toBe('1');
    expect(query.get('reverse')).toBe('false');
    expect(query.getAll('txType')).toEqual([...CHAIN_TYPES]);
    // In the order they were made.
    expect(rowButtons(list)[0]).toHaveAccessibleName(/registered the name/);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('button', {
        name: /^transactions in this block$/i,
      })
    ).toBeInTheDocument();
  });

  it('opens a block made after the tip was kept: reads the newest again and lists it, never “the chain is at” a lower block', async () => {
    // The start page reads the chain's newest block: 2,000,500 (kept 30 seconds).
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    // Seconds later a block is made, with a payment in it.
    const newer = payment(-1, { blockHeight: TIP + 1 });
    node.tip = TIP + 1;
    node.rows = [newer, ...node.rows];
    routes.push(txRoute(-1, newer));
    // The payment's own page says block 2,000,501.
    await lookUp(sig(-1));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    expect(dialog().textContent).toContain('2,000,501');
    fireEvent.click(blockLink());
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Transactions on Qortal',
    });
    // Wait until it has decided what to show (the refusal or the block's list).
    await waitFor(() =>
      expect(
        within(dialog()).queryByText(/^The chain is at block/) ??
          within(dialog()).queryByRole('region', {
            name: /every kind except messages/i,
          })
      ).not.toBeNull()
    );
    expect(within(dialog()).queryByText(/^The chain is at block/)).toBeNull();
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('The only one in block 2,000,501.')
    );
  });

  it("says when it couldn't read the chain's newest block, with Retry", async () => {
    let fail = true;
    node.special = (path) =>
      path === '/blocks/height' && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    await openBlockOf(3, payment(3));
    expect(
      await within(dialog()).findByText(
        "Couldn't read the chain's newest block."
      )
    ).toBeInTheDocument();
    expect(within(dialog()).queryByText(/no transactions/i)).toBeNull();
    fail = false;
    fireEvent.click(await findRetry(dialog()));
    // Retry goes once pressed: the keyboard is on the step's heading.
    expect(stepTitle()).toHaveFocus();
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('The only one in block 2,000,497.')
    );
  });

  it("says when it couldn't check a block past the tip, with Retry, reading nothing more by itself", async () => {
    // The start page keeps the tip 2,000,500; then block 2,000,501 is made.
    const section = await openStart();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    const newer = payment(-1, { blockHeight: TIP + 1 });
    node.tip = TIP + 1;
    node.rows = [newer, ...node.rows];
    routes.push(txRoute(-1, newer));
    await lookUp(sig(-1));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    let fail = true;
    node.special = (path) =>
      path === '/blocks/height' && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    fireEvent.click(blockLink());
    expect(
      await within(dialog()).findByText(
        "Couldn't read the chain's newest block."
      )
    ).toBeInTheDocument();
    expect(within(dialog()).queryByText(/^The chain is at block/)).toBeNull();
    const reads = tipReads();
    await settle();
    expect(tipReads()).toBe(reads);
    fail = false;
    fireEvent.click(await findRetry(dialog()));
    expect(stepTitle()).toHaveFocus();
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('The only one in block 2,000,501.')
    );
  });

  it('refuses a block the node no longer has in its chain only after reading its newest block', async () => {
    // The transaction's page said block 2,000,501; the node has since gone back to 2,000,500.
    await openBlockOf(-1, payment(-1, { blockHeight: TIP + 1 }));
    expect(
      await within(dialog()).findByText('The chain is at block 2,000,500.')
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText('Pick an earlier block to start from.')
    ).toBeInTheDocument();
    expect(tipReads()).toBe(2);
    expect(chainSearches()).toEqual([]);
  });

  it('shows a block typed past the tip pinned once the chain has it, never “the chain is at” a block it has passed', async () => {
    await openBlockOf(3, payment(3));
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('The only one in block 2,000,497.')
    );
    // A block's list: nothing on screen says which tip it hangs off.
    expect(within(dialog()).queryByText(/^Up to block/)).toBeNull();
    // Meanwhile the chain goes on to block 2,000,510; the block typed is 2,000,505.
    node.tip = TIP + 10;
    node.rows = [payment(-5), ...node.rows];
    fireEvent.change(fromField(), { target: { value: '2,000,505' } });
    fireEvent.click(showButton());
    fireEvent.click(showButton());
    await settle();
    expect(
      within(dialog()).queryByText('The chain is at block 2,000,500.')
    ).toBeNull();
    // Pressed twice while the chain's newest block was read: read once.
    expect(tipReads()).toBe(2);
    const shown = await results();
    await waitFor(() =>
      expect(coverage(shown)).toContain('The only one in block 2,000,505.')
    );
    expect(lastSearch().get('startBlock')).toBe('2000505');
  });

  it('refuses a block typed past the chain with the height read just then, keeping the list', async () => {
    await openBlockOf(3, payment(3));
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('The only one in block 2,000,497.')
    );
    // The chain moved on meanwhile, not as far as the block typed.
    node.tip = TIP + 3;
    fireEvent.change(fromField(), { target: { value: '2,000,600' } });
    fireEvent.click(showButton());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'The chain is at block 2,000,503.'
    );
    expect(coverage(await results())).toContain(
      'The only one in block 2,000,497.'
    );
    expect(
      chainSearches().some(
        (path) => params(path).get('startBlock') === '2000600'
      )
    ).toBe(false);
    expect(fromField()).toHaveValue('2,000,600');
  });

  it('checks a block typed while the tip is still being read against that tip, once read', async () => {
    routes.push(txRoute(3, payment(3)));
    renderWindow();
    await lookUp(sig(3));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    const slow = hold();
    node.special = (path) =>
      path === '/blocks/height' ? { body: TIP, delay: slow.until } : undefined;
    fireEvent.click(blockLink());
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Transactions on Qortal',
    });
    expect(fromField()).toHaveValue(String(TIP - 3));
    fireEvent.change(fromField(), { target: { value: '2,000,600' } });
    fireEvent.click(showButton());
    await act(async () => {
      slow.release();
      await slow.until;
    });
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'The chain is at block 2,000,500.'
    );
    expect(within(dialog()).queryByText(/no transactions/i)).toBeNull();
    expect(
      chainSearches().some(
        (path) => params(path).get('startBlock') === '2000600'
      )
    ).toBe(false);
  });

  it('drops a check of a block typed that comes back after the list was left', async () => {
    await openBlockOf(3, payment(3));
    const list = await results();
    await waitFor(() =>
      expect(coverage(list)).toContain('The only one in block 2,000,497.')
    );
    const slow = hold();
    node.tip = TIP + 10;
    node.special = (path) =>
      path === '/blocks/height'
        ? { body: TIP + 10, delay: slow.until }
        : undefined;
    fireEvent.change(fromField(), { target: { value: '2,000,505' } });
    fireEvent.click(showButton());
    await waitFor(() => expect(tipReads()).toBe(2));
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    await act(async () => {
      slow.release();
      await slow.until;
    });
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^forward$/i })
    );
    const again = await results();
    await waitFor(() =>
      expect(coverage(again)).toContain('The only one in block 2,000,497.')
    );
    expect(
      chainSearches().some(
        (path) => params(path).get('startBlock') === '2000505'
      )
    ).toBe(false);
  });

  it('offers no block for a transaction still waiting for one', async () => {
    routes.push((path) =>
      path === `/transactions/signature/${sig(99)}`
        ? { body: payment(99, { blockHeight: undefined }) }
        : undefined
    );
    renderWindow();
    await lookUp(sig(99));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Payment' });
    expect(
      within(dialog()).getAllByText(/waiting to be confirmed/i).length
    ).toBeGreaterThan(0);
    expect(
      within(dialog()).queryByRole('button', {
        name: /^transactions in this block$/i,
      })
    ).not.toBeInTheDocument();
  });

  it('stops at 1,000 rows and says so', { timeout: 60_000 }, async () => {
    node.rows = range(0, 1_100).map((n) =>
      payment(n, { blockHeight: TIP - (n % 900) })
    );
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    for (let page = 2; page <= 50; page += 1) {
      fireEvent.click(showMoreButton(list));
      await waitFor(() => expect(rowButtons(list)).toHaveLength(page * 20), {
        timeout: 4_000,
      });
    }
    expect(coverage(list)).toContain(
      'The newest 1,000 in blocks 1,999,501–2,000,500. The Explorer lists up to 1,000 transactions of one search: pick other blocks to see more.'
    );
    expect(within(list).queryByText(/^show older$/i)).not.toBeInTheDocument();
    expect(chainSearches()).toHaveLength(50);
  });

  it('only reads: every search confirmed, in a block range, 20 rows and named types; no message, nothing sent, no /chat/', async () => {
    node.waiting = [payment(-1, { blockHeight: undefined })];
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(rowButtons(list)).toHaveLength(30));
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(() => expect(tipReads()).toBe(2));
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.some((call) => call.path.startsWith('/chat'))).toBe(false);
    for (const path of chainSearches()) {
      const query = params(path);
      expect(query.get('confirmationStatus')).toBe('CONFIRMED');
      expect(Number(query.get('startBlock'))).toBeGreaterThanOrEqual(1);
      expect(Number(query.get('blockLimit'))).toBeGreaterThanOrEqual(1);
      expect(Number(query.get('blockLimit'))).toBeLessThanOrEqual(10_000);
      expect(query.get('limit')).toBe('20');
      expect(query.getAll('txType').length).toBeGreaterThan(0);
      expect(query.getAll('txType')).not.toContain('MESSAGE');
      expect(query.getAll('txType')).not.toContain('CHAT');
    }
    for (const path of waitingReads())
      expect(params(path).getAll('txType')).not.toContain('CHAT');
  });

  it('shows in the light theme too', async () => {
    renderWindow(lightTheme);
    await lookUp();
    const section = await startSection();
    await waitFor(() => expect(rowButtons(section)).toHaveLength(5));
    fireEvent.click(
      within(section).getByRole('button', { name: /^transactions on qortal$/i })
    );
    await waitFor(async () =>
      expect(rowButtons(await results())).toHaveLength(20)
    );
  });
});

describe('the keyboard, from one list to another', () => {
  it('stays on another kind picked after Show older failed', async () => {
    node.rows = [
      ...range(0, 30).map((n) => payment(n)),
      register(31, 'Example'),
    ];
    node.special = (path) =>
      isChainSearch(path) && params(path).get('offset') === '20'
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined;
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    fireEvent.click(showMoreButton(list));
    expect(
      await within(list).findByText("Couldn't load older transactions.")
    ).toBeInTheDocument();
    // Another kind instead: Names, from the keyboard.
    const names = within(dialog()).getByRole('button', { name: /^names$/i });
    act(() => names.focus());
    fireEvent.click(names);
    const named = await results();
    await waitFor(() =>
      expect(rowButtons(named)[0]).toHaveAccessibleName(
        /Second registered the name “Example”/
      )
    );
    await settle();
    expect(names).toHaveFocus();
  });

  it('stays on Refresh pressed while Show older reads', async () => {
    node.rows = range(-5, 60).map((n) => payment(n));
    await openChainStep();
    const list = await results();
    await waitFor(() => expect(rowButtons(list)).toHaveLength(20));
    const slow = hold();
    node.special = (path) =>
      isChainSearch(path) && params(path).get('offset') === '20'
        ? { body: [], delay: slow.until }
        : undefined;
    fireEvent.click(showMoreButton(list));
    await waitFor(() => expect(chainSearches()).toHaveLength(2));
    // The chain moved on: Refresh, pressed from the keyboard while the page reads.
    node.tip = TIP + 5;
    const refresh = within(dialog()).getByRole('button', {
      name: /^refresh$/i,
    });
    act(() => refresh.focus());
    fireEvent.click(refresh);
    // The newer tip's list (a list of its own, in place of the last).
    await waitFor(() =>
      expect(lastSearch().get('startBlock')).toBe(String(TIP + 5 - 999))
    );
    const fresh = await results();
    await waitFor(() =>
      expect(rowButtons(fresh)[0]).toHaveAccessibleName(/block 2,000,505/)
    );
    await act(async () => {
      slow.release();
      await slow.until;
    });
    await settle();
    expect(refresh).toHaveFocus();
  });
});

describe('in Russian', () => {
  it('puts a plural adjective before a number its “one” form also covers (21, 31…)', () => {
    const at21 = (key: string, extra: Record<string, unknown> = {}) =>
      String(
        i18n.t(key, {
          lng: 'ru',
          count: 21,
          shown: '21',
          blocks: '21',
          payments: '21',
          from: '1',
          to: '2',
          block: '1',
          amount: '5 QORT',
          exchange: 'X',
          when: 'май',
          ...extra,
        })
      );
    expect(at21('explorer:chain.cover.newest')).toMatch(
      /^Последние 21 транзакция /
    );
    expect(at21('explorer:chain.cover.newest_block')).toMatch(
      /^Последние 21 транзакция /
    );
    expect(at21('explorer:chain.cover.oldest')).toMatch(
      /^Самые ранние 21 транзакция /
    );
    expect(at21('explorer:chain.cover.oldest_block')).toMatch(
      /^Самые ранние 21 транзакция /
    );
    expect(at21('explorer:chain.blocks.latest')).toBe('последние 21 блок');
    expect(at21('explorer:chain.start.none')).toMatch(/^В последних 21 блоке /);
    expect(at21('explorer:chain.wider')).toBe('искать в последних 21 блоке');
    // The same in the account's own lists.
    expect(at21('explorer:transactions.newest')).toBe(
      'Его последние 21 транзакция.'
    );
    expect(at21('explorer:transactions.newest_kind')).toMatch(
      /^Последние 21 транзакция /
    );
    expect(at21('explorer:names.coverage')).toContain(
      'из его последних 21 транзакции'
    );
    expect(at21('explorer:connections.say.exchange.received_more')).toContain(
      'в последних 21 платеже'
    );
    expect(at21('explorer:connections.say.exchange.sent_more')).toContain(
      'в последних 21 платеже'
    );
    expect(at21('explorer:facts.payments_newest')).toBe(
      'в его последних 21 платеже'
    );
  });
});
