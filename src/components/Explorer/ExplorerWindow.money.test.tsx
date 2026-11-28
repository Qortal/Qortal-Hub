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
import { NULL_ACCOUNT } from '../../lib/explorer/reads';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The Overview's QORT figures over the whole history (QORT minted,
// purchased / sold, received / sent), in the window as App mounts it, for
// each kind of Hub account, reading a made-up node: one figure per viewer,
// read only for a viewer the level 5+ rule lets in, a partial history never
// taken for the whole, and every page read once.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const AT_ADDR = `A${'X'.repeat(33)}`;
const PUBLISHER_KEY = 'p'.repeat(44);

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (n: number) => {
  let text = '';
  do {
    text = ALPHABET[n % 58] + text;
    n = Math.floor(n / 58);
  } while (n > 0);
  return text;
};
/** A signature of its own for each number (88 base58 characters). */
const sig = (n: number) => `C${base58(n).padStart(6, '1')}`.padEnd(88, 'x');

type Row = Record<string, unknown>;
type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const BLOCK_TIME = (height: number) =>
  Date.UTC(2025, 0, 1, 12) + (height - 1_000_000) * 60_000;

/** Its transactions, newest first: one received (1 QORT) then one sent (0.5 QORT, its fee 0.01), and so on. */
function history(count: number, newest = 1_500_000): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const height = newest - i;
    const received = i % 2 === 0;
    return {
      type: 'PAYMENT',
      timestamp: BLOCK_TIME(height),
      signature: sig(10_000 + i),
      fee: '0.01000000',
      txGroupId: 0,
      blockHeight: height,
      approvalStatus: 'NOT_REQUIRED',
      creatorAddress: received ? SECOND : PUBLISHER,
      recipient: received ? PUBLISHER : SECOND,
      amount: received ? '1.00000000' : '0.50000000',
    };
  });
}

const UNIT = 100_000_000n;
/** What `history(count)` moved for Publisher, in atomic units. */
function moved(count: number): bigint {
  const received = BigInt(Math.ceil(count / 2)) * UNIT;
  const sent = BigInt(Math.floor(count / 2)) * (UNIT / 2n);
  const fees = BigInt(Math.floor(count / 2)) * (UNIT / 100n);
  return received - sent - fees;
}
const text = (atomic: bigint) =>
  `${atomic / UNIT}.${(atomic % UNIT).toString().padStart(8, '0')}`;

/** What minting brought it, on top of what its transactions moved. */
const MINTED = 12_345_678_901n; // 123.45678901 QORT

/** Is `path` a read of `address`'s All list (100 a page)? Its offset, or null. */
function allListOffset(path: string, address = PUBLISHER): number | null {
  if (!path.startsWith('/transactions/search?')) return null;
  const query = params(path);
  if (
    query.get('address') !== address ||
    query.get('limit') !== '100' ||
    query.getAll('txType').length
  )
    return null;
  return Number(query.get('offset') ?? 0);
}

const allListReads = (address = PUBLISHER) =>
  calls
    .map(({ path }) => allListOffset(path, address))
    .filter((offset): offset is number => offset !== null);

/** Is `path` a read of its newest transaction (one row, newest first)? */
const isNewestCheck = (path: string) => {
  if (!path.startsWith('/transactions/search?')) return false;
  const query = params(path);
  return (
    query.get('address') === PUBLISHER &&
    query.get('limit') === '1' &&
    query.get('reverse') === 'true' &&
    !query.getAll('txType').length
  );
};

/** A payment of 1 QORT to it, newer than everything in `history` (each `n` its own). */
const arrived = (n = 0): Row => ({
  ...history(1, 1_500_001 + n)[0],
  signature: sig(99 + n),
});

function account(address: string, extra: Row = {}) {
  return {
    address,
    reference: 'ref',
    publicKey: PUBLISHER_KEY,
    level: 3,
    blocksMinted: 250_000,
    blocksMintedAdjustment: 0,
    blocksMintedPenalty: 0,
    ...extra,
  };
}

interface Node {
  /** Its transactions, newest first. */
  rows: Row[];
  /** Its balance as Core writes it (by default: what its rows moved, and MINTED). */
  balance?: string | (() => string);
  /** A page that fails, by its offset (each failing once while true). */
  failing?: Set<number>;
  /** The account's own fields. */
  extra?: Row;
  /** Its first reward share (none by default for an account without blocks). */
  firstShare?: Row | null;
  trades?: { buyer: Row[]; seller: Row[] } | 'failing';
}

/** Publisher on a made-up node. */
function publisherNode(node: Node): Route {
  return (path) => {
    if (path === `/addresses/${PUBLISHER}`)
      return { body: account(PUBLISHER, node.extra) };
    if (path === `/names/primary/${PUBLISHER}`)
      return { body: { name: 'Publisher', owner: PUBLISHER } };
    if (path.startsWith(`/names/address/${PUBLISHER}`))
      return { body: [{ name: 'Publisher', owner: PUBLISHER }] };
    if (path === `/groups/member/${PUBLISHER}`) return { body: [] };
    if (path === `/addresses/balance/${PUBLISHER}`)
      return {
        body:
          typeof node.balance === 'function'
            ? node.balance()
            : (node.balance ?? text(moved(node.rows.length) + MINTED)),
      };
    if (path.startsWith(`/blocks/signer/${PUBLISHER}`)) return { body: [] };
    const offset = allListOffset(path);
    if (offset !== null) {
      if (node.failing?.has(offset))
        return { status: 503, body: { error: 1, message: 'busy' } };
      return { body: node.rows.slice(offset, offset + 100) };
    }
    if (path.startsWith('/transactions/search?')) {
      const query = params(path);
      if (query.get('address') !== PUBLISHER) return undefined;
      if (query.get('txType') === 'REWARD_SHARE')
        return { body: node.firstShare ? [node.firstShare] : [] };
      if (query.get('txType') === 'PAYMENT' && query.get('limit') === '500')
        return {
          body: node.rows.filter((row) => row.type === 'PAYMENT').slice(0, 500),
        };
      if (query.get('limit') === '1' && query.get('reverse') === 'false')
        return { body: node.rows.slice(-1) };
      // Its newest transaction (QORT minted reads it around its balance).
      if (
        query.get('limit') === '1' &&
        query.get('reverse') === 'true' &&
        !query.getAll('txType').length
      )
        return { body: node.rows.slice(0, 1) };
      // The Transactions tab's other kinds, and anything else: none.
      return { body: [] };
    }
    if (path.startsWith('/crosschain/trades?')) {
      if (node.trades === 'failing')
        return { status: 500, body: { error: 5, message: 'repository' } };
      const query = params(path);
      return {
        body: query.get('buyerPublicKey')
          ? (node.trades?.buyer ?? [])
          : (node.trades?.seller ?? []),
      };
    }
    return undefined;
  };
}

const minterGroup = (isAdmin: boolean) => ({
  groupId: 694,
  groupName: 'MINTER',
  owner: NULL_ACCOUNT,
  isOpen: false,
  memberCount: 600,
  isAdmin,
});

interface Persona {
  level: number;
  minter: 'admin' | 'member' | null;
  failing?: boolean;
  hold?: Promise<void>;
}

/** The Hub account looking: its level and its groups. */
function viewer(persona: Persona): Route {
  return (path) => {
    if (path === `/addresses/${READER}`)
      return { body: account(READER, { level: persona.level }) };
    if (path === `/groups/member/${READER}`)
      return persona.failing
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : {
            body: persona.minter
              ? [minterGroup(persona.minter === 'admin')]
              : [],
            delay: persona.hold,
          };
    return undefined;
  };
}

const LEVEL_FIVE: Persona = { level: 5, minter: 'member' };
const LEVEL_FOUR: Persona = { level: 4, minter: 'member' };

const commonRoutes: Route = (path) => {
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/names/search?')) return { body: [] };
  if (path.startsWith('/transactions/creator/')) return { body: [] };
  if (path.startsWith('/transactions/unconfirmed?')) return { body: [] };
  if (path.startsWith('/transactions/payments/between?')) return { body: [] };
  if (path.startsWith('/assets/orders/')) return { body: [] };
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
  return store;
}

const lookUp = (addressOrName: string) =>
  act(() => {
    executeEvent('openUserLookupDrawer', { addressOrName });
  });

const dialog = () => screen.getByRole('dialog');
const T = { timeout: 4000 };

async function openPublisher(persona: Persona | null, node: Node) {
  routes.push(...(persona ? [viewer(persona)] : []), publisherNode(node));
  renderWindow();
  await lookUp(PUBLISHER);
  await within(dialog()).findByRole('heading', { level: 2, name: 'Publisher' });
}

const glance = () =>
  within(dialog()).getByRole('region', { name: /at a glance/i });

/** A fact's tile, by its label. */
function tile(label: RegExp): HTMLElement {
  const term = within(glance()).getByText(label, { selector: 'dt' });
  return term.parentElement as HTMLElement;
}

/** The (i) of a fact, by its label: what it says. */
const infoOf = (label: RegExp) =>
  within(tile(label)).getByRole('img').getAttribute('aria-label') ?? '';

/** Opens the Transactions tab. */
async function openTab() {
  fireEvent.click(
    within(dialog()).getByRole('tab', { name: /^transactions$/i })
  );
  return within(dialog()).findByRole('tabpanel', { name: /transactions/i });
}

/** How many of its confirmed transactions the tab shows. */
const rowsShown = (panel: HTMLElement) =>
  within(
    within(panel).getByRole('list', { name: /all transactions/i })
  ).getAllByRole('listitem').length;

/** Reads only the full view makes. */
const fullViewReads = () =>
  calls.filter(
    ({ path }) =>
      path.startsWith('/crosschain/') ||
      path.startsWith('/assets/order/') ||
      params(path).getAll('txType').join() === 'REWARD_SHARE' ||
      isNewestCheck(path) ||
      (allListOffset(path) ?? 0) > 0
  );

const paymentsReads = () =>
  calls.filter(
    ({ path }) =>
      path.startsWith('/transactions/search?') &&
      params(path).get('limit') === '500'
  );

/** An answer held back until it is let go. */
function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
}

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 60)));

beforeEach(() => {
  routes = [];
  calls = [];
  window.localStorage.clear();
  stubNode();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('one QORT received / sent figure for each viewer', () => {
  it('a full viewer: its whole history in place of its newest payments, with minted and purchased / sold', async () => {
    await openPublisher(LEVEL_FIVE, {
      rows: history(60),
      trades: {
        buyer: [
          { atAddress: `A${'1'.repeat(33)}`, qortAmount: '10.00000000' },
          // The same trade twice: counted once.
          { atAddress: `A${'1'.repeat(33)}`, qortAmount: '10.00000000' },
        ],
        seller: [{ atAddress: `A${'2'.repeat(33)}`, qortAmount: '2.50000000' }],
      },
    });
    const flows = await waitFor(() => {
      const shown = tile(/QORT received \/ sent/i);
      expect(shown).toHaveTextContent('30.00 / 15.00 QORT');
      return shown;
    }, T);
    expect(flows).toHaveTextContent(/in all 60 of its transactions/i);
    // One received / sent figure on screen, never the newest payments' too.
    expect(
      within(glance()).getAllByText(/QORT received \/ sent/i)
    ).toHaveLength(1);
    expect(dialog()).not.toHaveTextContent(
      /newest 500 payments|in all \d+ of its payments/i
    );
    expect(infoOf(/QORT received \/ sent/i)).toMatch(
      /received 30 QORT, sent 15 QORT/
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    expect(infoOf(/QORT minted/i)).toMatch(
      /^123\.45678901 QORT\. Its balance now, 138\.15678901 QORT, less what its transactions moved: received 30, sent 15,? and fees 0\.3\./
    );
    await waitFor(
      () =>
        expect(tile(/QORT purchased \/ sold/i)).toHaveTextContent(
          '10.00 / 2.50 QORT'
        ),
      T
    );
    // Its newest 500 payments aren't read for a viewer who doesn't see them.
    expect(paymentsReads()).toEqual([]);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('a basic viewer: its newest payments, as before, and nothing of the full view read', async () => {
    // A history longer than a page: nothing reads on past the newest page.
    await openPublisher(LEVEL_FOUR, { rows: history(250) });
    expect(
      await within(glance()).findByText(/in all 250 of its payments/i, {}, T)
    ).toBeInTheDocument();
    await settle();
    expect(within(glance()).queryByText(/QORT minted|purchased/i)).toBeNull();
    expect(glance()).not.toHaveTextContent(/whole history/i);
    expect(
      within(dialog()).queryByRole('region', { name: /^activity$/i })
    ).toBeNull();
    expect(fullViewReads()).toEqual([]);
  });

  it('while the rule is read: neither figure, and neither is read; then the full one', async () => {
    const held = hold();
    await openPublisher(
      { ...LEVEL_FIVE, hold: held.until },
      { rows: history(60) }
    );
    await settle();
    const flows = tile(/QORT received \/ sent/i);
    expect(flows).not.toHaveTextContent(/QORT$/);
    expect(glance()).not.toHaveTextContent(/payments|whole history/i);
    expect(paymentsReads()).toEqual([]);
    expect(fullViewReads()).toEqual([]);
    await act(async () => held.release());
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 60 of its transactions/i
        ),
      T
    );
    expect(paymentsReads()).toEqual([]);
  });

  it('when the rule couldn’t be read: the basic figure, silently', async () => {
    await openPublisher(
      { ...LEVEL_FIVE, failing: true },
      { rows: history(60) }
    );
    expect(
      await within(glance()).findByText(/in all 60 of its payments/i, {}, T)
    ).toBeInTheDocument();
    await settle();
    expect(fullViewReads()).toEqual([]);
    expect(within(glance()).queryByText(/QORT minted/i)).toBeNull();
  });
});

describe('a partial history never gives a figure', () => {
  it('reads 1,000 by itself, says how far it read, and Read the rest reads on, 100 a read', async () => {
    await openPublisher(LEVEL_FIVE, { rows: history(1250) });
    const notice = await within(glance()).findByRole(
      'note',
      {},
      { timeout: 15_000 }
    );
    expect(notice).toHaveTextContent(
      /its newest 1,000 transactions have been read so far/i
    );
    expect(allListReads()).toEqual(
      Array.from({ length: 10 }, (_, i) => i * 100)
    );
    for (const label of [/QORT minted/i, /QORT received \/ sent/i])
      expect(tile(label)).toHaveTextContent(/needs its whole history/i);
    fireEvent.click(
      within(notice).getByRole('button', { name: /read the rest/i })
    );
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 1,250 of its transactions/i
        ),
      { timeout: 15_000 }
    );
    // 100 a read, each page once, past the tabs' 1,000.
    expect(allListReads()).toEqual(
      Array.from({ length: 13 }, (_, i) => i * 100)
    );
    expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
      '625.00 / 312.50 QORT'
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
  }, 30_000);

  it('the Transactions tab takes what the Overview read: no page read again', async () => {
    await openPublisher(LEVEL_FIVE, { rows: history(1250) });
    const notice = await within(glance()).findByRole('note', {}, T);
    fireEvent.click(
      within(notice).getByRole('button', { name: /read the rest/i })
    );
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 1,250/i
        ),
      T
    );
    const before = allListReads().length;
    const panel = await openTab();
    expect(
      await within(panel).findByText(
        /Its newest 100 transactions\. It lists the newest 1,000 here: the Overview read 1,250 of its transactions/
      )
    ).toBeInTheDocument();
    expect(rowsShown(panel)).toBe(100);
    expect(allListReads()).toHaveLength(before);
  });

  it('the tab shows 100 of the 1,000 read, Show more shows the next held ones without a read, and the step keeps how many', async () => {
    await openPublisher(LEVEL_FIVE, { rows: history(1250) });
    // The Overview reads its newest 1,000 by itself.
    await within(glance()).findByRole('note', {}, { timeout: 15_000 });
    const read = allListReads().length;
    expect(read).toBe(10);
    let panel = await openTab();
    await waitFor(() => expect(rowsShown(panel)).toBe(100));
    expect(panel).toHaveTextContent(/Its newest 100 transactions\./);
    // The Explorer's 1,000 isn't reached on screen yet: no note about it.
    expect(panel).not.toHaveTextContent(/reads up to 1,000/);
    fireEvent.click(within(panel).getByRole('button', { name: /show more/i }));
    await waitFor(() => expect(rowsShown(panel)).toBe(200));
    expect(panel).toHaveTextContent(/Its newest 200 transactions\./);
    expect(allListReads()).toHaveLength(read);

    // Another tab and back: as left.
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    await within(dialog()).findByRole('region', { name: /at a glance/i });
    panel = await openTab();
    await waitFor(() => expect(rowsShown(panel)).toBe(200));
    // Another step and Back: as left.
    await lookUp(SECOND);
    await waitFor(() =>
      expect(
        within(dialog()).queryByRole('heading', { level: 2, name: 'Publisher' })
      ).toBeNull()
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    panel = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    await waitFor(() => expect(rowsShown(panel)).toBe(200));
    expect(allListReads()).toHaveLength(read);
  }, 30_000);

  it('the tab reads from the node only once every row read is shown', async () => {
    window.localStorage.setItem(
      `explorer-activity-first-read:${READER}`,
      '200'
    );
    await openPublisher(LEVEL_FIVE, { rows: history(450) });
    await within(glance()).findByRole('note', {}, T);
    expect(allListReads()).toEqual([0, 100]);
    const panel = await openTab();
    await waitFor(() => expect(rowsShown(panel)).toBe(100));
    const more = () =>
      within(panel).getByRole('button', { name: /show more/i });
    fireEvent.click(more());
    await waitFor(() => expect(rowsShown(panel)).toBe(200));
    expect(allListReads()).toEqual([0, 100]);
    // Every row read is on screen: now the next 100 are read.
    fireEvent.click(more());
    await waitFor(() => expect(rowsShown(panel)).toBe(300));
    expect(allListReads()).toEqual([0, 100, 200]);
  }, 30_000);

  it('a failed page says so in the figures’ place, with Retry, which reads on from there', async () => {
    const failing = new Set([200]);
    await openPublisher(LEVEL_FIVE, { rows: history(450), failing });
    await waitFor(
      () =>
        expect(
          within(tile(/QORT minted/i)).getByRole('alert')
        ).toHaveTextContent(/couldn't read its transactions to add these up/i),
      T
    );
    expect(
      within(tile(/QORT received \/ sent/i)).getByRole('alert')
    ).toBeInTheDocument();
    expect(allListReads()).toEqual([0, 100, 200]);
    failing.clear();
    fireEvent.click(
      within(tile(/QORT received \/ sent/i)).getByRole('button', {
        name: /retry/i,
      })
    );
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 450 of its transactions/i
        ),
      T
    );
    // Retry read on from the page that failed, and the other place shows it too.
    expect(allListReads()).toEqual([0, 100, 200, 200, 300, 400]);
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
  });

  it('a failed first page: both figures say so, and Retry in one fixes both', async () => {
    const failing = new Set([0]);
    await openPublisher(LEVEL_FIVE, { rows: history(40), failing });
    await waitFor(
      () =>
        expect(
          within(tile(/QORT minted/i)).getByRole('alert')
        ).toBeInTheDocument(),
      T
    );
    failing.clear();
    fireEvent.click(
      within(tile(/QORT minted/i)).getByRole('button', { name: /retry/i })
    );
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          '20.00 / 10.00 QORT'
        ),
      T
    );
    expect(within(glance()).queryByRole('alert')).toBeNull();
  });
});

describe('QORT minted', () => {
  it('an account that never minted says so, with nothing to work out', async () => {
    await openPublisher(LEVEL_FIVE, {
      rows: history(20),
      extra: { blocksMinted: 0, level: 0 },
      firstShare: null,
    });
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent(/never minted/i),
      T
    );
    expect(infoOf(/QORT minted/i)).toMatch(/no reward share ever involved it/i);
    expect(calls.some(({ path }) => path.startsWith('/assets/order/'))).toBe(
      false
    );
  });

  it('one that moved its minting level away has no blocks now, and is worked out all the same', async () => {
    await openPublisher(LEVEL_FIVE, {
      rows: history(20),
      extra: { blocksMinted: 0, level: 0 },
      firstShare: {
        type: 'REWARD_SHARE',
        signature: sig(1),
        timestamp: BLOCK_TIME(1_200_000),
        blockHeight: 1_200_000,
      },
    });
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    expect(tile(/QORT minted/i)).not.toHaveTextContent(/never/i);
  });

  it('can’t be worked out when its transactions don’t add up to its balance, and says why', async () => {
    await openPublisher(LEVEL_FIVE, { rows: history(20), balance: '0E-8' });
    await waitFor(
      () =>
        expect(tile(/QORT minted/i)).toHaveTextContent(/can't be worked out/i),
      T
    );
    expect(infoOf(/QORT minted/i)).toMatch(/don't add up to its balance/i);
  });

  it('settles its asset orders with QORT on one side', async () => {
    const order = {
      type: 'CREATE_ASSET_ORDER',
      timestamp: BLOCK_TIME(1_400_000),
      signature: sig(5),
      fee: '0.01000000',
      blockHeight: 1_400_000,
      approvalStatus: 'NOT_REQUIRED',
      creatorAddress: PUBLISHER,
      haveAssetId: 0,
      wantAssetId: 91,
      amount: '10.00000000',
      price: '2.00000000',
      amountAssetId: 91,
    };
    const rows = [...history(20), order];
    // Sold 20 QORT's worth, not filled, still open: 20 QORT taken.
    const balance = text(moved(20) - 1_000_000n + MINTED - 20n * UNIT);
    routes.push((path) => {
      if (path === `/assets/order/${sig(5)}`)
        return {
          body: {
            haveAssetId: 0,
            wantAssetId: 91,
            amount: '10.00000000',
            price: '2.00000000',
            fulfilled: '0.00000000',
            isClosed: false,
            isFulfilled: false,
            amountAssetId: 91,
          },
        };
      if (path.startsWith(`/assets/order/${sig(5)}/trades?`))
        return { body: [] };
      return undefined;
    });
    await openPublisher(LEVEL_FIVE, { rows, balance });
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    expect(infoOf(/QORT minted/i)).toMatch(/asset orders −20/);
  });

  it('shows its amounts exactly, in the viewer’s language', async () => {
    await i18n.changeLanguage('de');
    try {
      await openPublisher(LEVEL_FIVE, { rows: history(60) });
      // German writes 123,45678901 and 138,15678901.
      const info = await within(dialog()).findByRole(
        'img',
        { name: /^123,45678901 QORT\..*138,15678901 QORT/ },
        T
      );
      expect(info).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('keeps what was worked out while Refresh reads again', async () => {
    const node: Node = { rows: history(20) };
    await openPublisher(LEVEL_FIVE, node);
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    // A new payment arrives; its balance grows by the same. Refresh: the
    // newest page and the balance are read again, and nothing in between
    // shows a figure that doesn't add up.
    const slow = hold();
    routes.unshift((path) =>
      path === `/addresses/balance/${PUBLISHER}`
        ? { body: text(moved(20) + MINTED + UNIT), delay: slow.until }
        : undefined
    );
    node.rows = [arrived(), ...node.rows];
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    await waitFor(() =>
      expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
        /in all 21 of its transactions/i
      )
    );
    expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT');
    await act(async () => slow.release());
    await settle();
    expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT');
  });
});

describe('QORT minted, worked out within limits', () => {
  it('says “in its only transaction” for a history of one', async () => {
    await openPublisher(LEVEL_FIVE, { rows: history(1) });
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in its only transaction/i
        ),
      T
    );
  });

  it('can’t be worked out with more asset orders than it reads, and reads none of them', async () => {
    const orders = Array.from({ length: 501 }, (_, i) => ({
      type: 'CREATE_ASSET_ORDER',
      timestamp: BLOCK_TIME(1_300_000 - i),
      signature: sig(50_000 + i),
      fee: '0.01000000',
      blockHeight: 1_300_000 - i,
      approvalStatus: 'NOT_REQUIRED',
      creatorAddress: PUBLISHER,
      haveAssetId: 0,
      wantAssetId: 91,
      amount: '1.00000000',
      price: '1.00000000',
    }));
    await openPublisher(LEVEL_FIVE, { rows: [...history(20), ...orders] });
    await waitFor(
      () =>
        expect(tile(/QORT minted/i)).toHaveTextContent(/can't be worked out/i),
      { timeout: 10_000 }
    );
    expect(infoOf(/QORT minted/i)).toMatch(
      /It placed 501 asset orders with QORT on one side, more than the 500/
    );
    expect(calls.some(({ path }) => path.startsWith('/assets/order/'))).toBe(
      false
    );
  });
});

describe('QORT purchased / sold', () => {
  it('a buyer without a public key: what trade contracts paid it, from its whole history; it never sold', async () => {
    // Its QORT came from two trade contracts (a first purchase): the trade
    // bot answers them from a key of its own, so the account itself has
    // made no transaction and has no public key.
    const paid = (n: number, height: number, amount: string): Row => ({
      type: 'AT',
      timestamp: BLOCK_TIME(height),
      signature: sig(n),
      fee: '0.00000000',
      txGroupId: 0,
      blockHeight: height,
      approvalStatus: 'NOT_REQUIRED',
      creatorAddress: SECOND,
      atAddress: `A${String(n).repeat(33)}`.slice(0, 34),
      recipient: PUBLISHER,
      amount,
      assetId: 0,
    });
    await openPublisher(LEVEL_FIVE, {
      rows: [
        paid(7, 1_500_000, '199.00000000'),
        paid(8, 1_490_000, '100.00000000'),
      ],
      balance: '299.00000000',
      extra: { publicKey: null, level: 0, blocksMinted: 0 },
      firstShare: null,
    });
    await waitFor(
      () =>
        expect(tile(/QORT purchased \/ sold/i)).toHaveTextContent(
          '299.00 / 0.00 QORT'
        ),
      T
    );
    expect(infoOf(/QORT purchased \/ sold/i)).toMatch(
      /hasn't sold on the Trade Portal .*What it bought, 299 QORT, is what other accounts' trade contracts paid it/
    );
    // Its trades can't be looked up by a key it doesn't have: none are read.
    expect(calls.some(({ path }) => path.startsWith('/crosschain/'))).toBe(
      false
    );
  });

  it('reads each side once, without a limit; a failure says so with Retry', async () => {
    const node: Node = { rows: history(10), trades: 'failing' };
    await openPublisher(LEVEL_FIVE, node);
    const failed = await waitFor(() => {
      const shown = tile(/QORT purchased \/ sold/i);
      expect(within(shown).getByRole('alert')).toHaveTextContent(
        /couldn't load its trades/i
      );
      return shown;
    }, T);
    node.trades = { buyer: [], seller: [] };
    fireEvent.click(within(failed).getByRole('button', { name: /retry/i }));
    await waitFor(
      () =>
        expect(tile(/QORT purchased \/ sold/i)).toHaveTextContent(
          '0.00 / 0.00 QORT'
        ),
      T
    );
    const reads = calls.filter(({ path }) =>
      path.startsWith('/crosschain/trades?')
    );
    for (const { path } of reads) {
      expect(params(path).has('limit')).toBe(false);
      expect(params(path).has('offset')).toBe(false);
    }
  });
});

describe('reading its whole history', () => {
  it('reads on to its first read when a transaction arrives while it reads, never left reading', async () => {
    const node: Node = { rows: history(1250) };
    let landed = false;
    routes.push((path) => {
      // A payment arrives at the top of its list while the Overview reads its sixth page.
      if (!landed && allListOffset(path) === 500) {
        landed = true;
        node.rows = [arrived(), ...node.rows];
      }
      return undefined;
    });
    await openPublisher(LEVEL_FIVE, node);
    // It reads on by itself to its first read (1,000), then says how far it
    // read and offers Read the rest, as it does when nothing arrived.
    const notice = await within(glance()).findByRole(
      'note',
      {},
      { timeout: 15_000 }
    );
    expect(notice).toHaveTextContent(
      /its newest 1,000 transactions have been read so far/i
    );
    expect(
      within(notice).getByRole('button', { name: /read the rest/i })
    ).toBeInTheDocument();
    // The row read twice was left out: one more page made up the 1,000.
    expect(allListReads()).toEqual([
      ...Array.from({ length: 10 }, (_, i) => i * 100),
      1000,
    ]);
  }, 30_000);

  it('exactly 1,000 transactions: its whole history once its oldest read is its first, with no read past it', async () => {
    await openPublisher(LEVEL_FIVE, { rows: history(1000) });
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 1,000 of its transactions/i
        ),
      { timeout: 15_000 }
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    expect(allListReads()).toEqual(
      Array.from({ length: 10 }, (_, i) => i * 100)
    );
    expect(within(glance()).queryByRole('note')).toBeNull();
    const region = within(dialog()).getByRole('region', {
      name: /^activity$/i,
    });
    expect(region).toHaveTextContent(
      /All 1,000 of its transactions, back to its first on/
    );
    expect(region).not.toHaveTextContent(/hatched/i);
  }, 30_000);

  it('keeps Read the rest with the step: switching tabs while it reads, and back, reads on', async () => {
    const node: Node = { rows: history(1250) };
    await openPublisher(LEVEL_FIVE, node);
    const notice = await within(glance()).findByRole(
      'note',
      {},
      { timeout: 15_000 }
    );
    // Its next page is held back: Read the rest still reads when the tab is switched.
    const held = hold();
    let holding = true;
    routes.unshift((path) => {
      if (!holding || allListOffset(path) !== 1000) return undefined;
      holding = false;
      return { body: node.rows.slice(1000, 1100), delay: held.until };
    });
    fireEvent.click(
      within(notice).getByRole('button', { name: /read the rest/i })
    );
    await waitFor(() => expect(allListReads()).toContain(1000));
    await openTab();
    await act(async () => held.release());
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 1,250 of its transactions/i
        ),
      { timeout: 15_000 }
    );
  }, 30_000);

  it('Refresh reads on again from an older page that failed', async () => {
    const failing = new Set([200]);
    await openPublisher(LEVEL_FIVE, { rows: history(450), failing });
    await waitFor(
      () =>
        expect(
          within(tile(/QORT received \/ sent/i)).getByRole('alert')
        ).toBeInTheDocument(),
      T
    );
    failing.clear();
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 450 of its transactions/i
        ),
      T
    );
    expect(within(glance()).queryByRole('alert')).toBeNull();
  });
});

describe('QORT minted only sets its balance against the transactions read up to it', () => {
  it('after a Refresh whose newest page failed: works nothing out, says so, and Retry gives it again', async () => {
    const node: Node = { rows: history(20), failing: new Set() };
    await openPublisher(LEVEL_FIVE, node);
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    // A payment of 1 QORT arrives (its balance grows by the same), and the
    // node is busy when Refresh reads its newest transactions again; its
    // balance reads fine.
    node.rows = [arrived(), ...node.rows];
    node.failing?.add(0);
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    await within(dialog()).findByText(
      /couldn't check for newer transactions/i,
      {},
      T
    );
    await waitFor(
      () => expect(tile(/^balance$/i)).toHaveTextContent('129.36 QORT'),
      T
    );
    await waitFor(
      () =>
        expect(
          within(tile(/QORT minted/i)).getByRole('alert')
        ).toHaveTextContent(/couldn't read its newest transactions/i),
      T
    );
    // Its transactions read are still the 20 of before: the payment it got isn't minted.
    expect(tile(/QORT minted/i)).not.toHaveTextContent('124.46 QORT');
    node.failing?.clear();
    fireEvent.click(
      within(tile(/QORT minted/i)).getByRole('button', { name: /retry/i })
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
      /in all 21 of its transactions/i
    );
  });

  it('when its history took over a minute to read, and a payment came meanwhile', async () => {
    // This PC's clock, which the window's cache keeps its answers by.
    let skew = 0;
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    const node: Node = { rows: history(450) };
    let balanceReads = 0;
    node.balance = () => {
      balanceReads += 1;
      return text(moved(node.rows.length) + MINTED);
    };
    routes.push((path) => {
      // Its last page comes in over a minute after the newest, and a payment
      // of 1 QORT to it lands on the node right after.
      if (allListOffset(path) === 400 && skew === 0) {
        skew = 61_000;
        setTimeout(() => {
          node.rows = [arrived(), ...node.rows];
        }, 0);
      }
      return undefined;
    });
    await openPublisher(LEVEL_FIVE, node);
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 4(50|51) of its transactions/i
        ),
      { timeout: 10_000 }
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent(/\d QORT/),
      T
    );
    await settle();
    // Its balance was read again for QORT minted, after the payment came:
    // the payment isn't minted.
    expect(balanceReads).toBeGreaterThan(1);
    expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT');
  }, 30_000);

  it('reads its balance again when a transaction lands while it is read', async () => {
    const node: Node = { rows: history(20) };
    let landed = false;
    routes.push((path) => {
      if (landed || !isNewestCheck(path)) return undefined;
      // Its newest as it is, then a payment of 1 QORT lands: the balance read next has it.
      landed = true;
      const answer = { body: node.rows.slice(0, 1) };
      node.rows = [arrived(), ...node.rows];
      return answer;
    });
    await openPublisher(LEVEL_FIVE, node);
    await waitFor(
      () =>
        expect(tile(/QORT received \/ sent/i)).toHaveTextContent(
          /in all 21 of its transactions/i
        ),
      T
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    await settle();
    expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT');
    // The Balance fact shows the balance it was worked out with.
    expect(tile(/^balance$/i)).toHaveTextContent('129.36 QORT');
  });

  it('says when new transactions keep coming in while it is worked out, and Retry works it out once they stop', async () => {
    const node: Node = { rows: history(20) };
    // Each arrival is a payment of 1 QORT to it.
    node.balance = () =>
      text(moved(20) + BigInt(node.rows.length - 20) * UNIT + MINTED);
    let arriving = true;
    let count = 0;
    routes.push((path) => {
      if (!arriving || !isNewestCheck(path)) return undefined;
      const answer = { body: node.rows.slice(0, 1) };
      count += 1;
      node.rows = [arrived(count), ...node.rows];
      return answer;
    });
    await openPublisher(LEVEL_FIVE, node);
    await waitFor(
      () =>
        expect(
          within(tile(/QORT minted/i)).getByRole('alert')
        ).toHaveTextContent(/new transactions kept coming in/i),
      T
    );
    expect(tile(/QORT minted/i)).not.toHaveTextContent(/\d QORT/);
    arriving = false;
    fireEvent.click(
      within(tile(/QORT minted/i)).getByRole('button', { name: /retry/i })
    );
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
  });
});

describe('its asset orders', () => {
  it('are read two at a time, and Refresh reads only the open ones again', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => sig(300 + i));
    const orders = ids.map((id, i) => ({
      type: 'CREATE_ASSET_ORDER',
      timestamp: BLOCK_TIME(1_400_000 - i),
      signature: id,
      fee: '0.01000000',
      blockHeight: 1_400_000 - i,
      approvalStatus: 'NOT_REQUIRED',
      creatorAddress: PUBLISHER,
      haveAssetId: 91,
      wantAssetId: 0,
      amount: '1.00000000',
      price: '1.00000000',
    }));
    // Buying QORT, with no trades yet: they moved nothing but their fees.
    const balance = text(moved(20) - 6n * (UNIT / 100n) + MINTED);
    let inFlight = 0;
    let most = 0;
    routes.push((path) => {
      if (!path.startsWith('/assets/order/')) return undefined;
      if (path.includes('/trades?')) return { body: [] };
      const id = decodeURIComponent(path.split('/')[3]);
      inFlight += 1;
      most = Math.max(most, inFlight);
      return {
        body: {
          haveAssetId: 91,
          wantAssetId: 0,
          amount: '1.00000000',
          price: '1.00000000',
          fulfilled: '0.00000000',
          // The first four are closed (cancelled): they never change again.
          isClosed: ids.indexOf(id) < 4,
          isFulfilled: false,
        },
        delay: new Promise<void>((resolve) =>
          setTimeout(() => {
            inFlight -= 1;
            resolve();
          }, 10)
        ),
      };
    });
    await openPublisher(LEVEL_FIVE, {
      rows: [...history(20), ...orders],
      balance,
    });
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    expect(most).toBe(2);
    const orderReads = (from = 0) =>
      calls
        .slice(from)
        .filter(
          ({ path }) =>
            path.startsWith('/assets/order/') && !path.includes('/trades')
        )
        .map(({ path }) => decodeURIComponent(path.split('/')[3]));
    expect(orderReads().sort()).toEqual([...ids].sort());
    const before = calls.length;
    fireEvent.click(within(dialog()).getByLabelText(/^refresh$/i));
    await waitFor(() => expect(orderReads(before)).toHaveLength(2), T);
    await settle();
    expect(orderReads(before).sort()).toEqual(ids.slice(4).sort());
    expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT');
  });
});

describe('when it reads', () => {
  it('nothing of the full view before At a glance nears the screen', async () => {
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
    await openPublisher(LEVEL_FIVE, { rows: history(60) });
    await waitFor(() =>
      expect(within(glance()).getByText(/QORT minted/i)).toBeInTheDocument()
    );
    await settle();
    expect(fullViewReads()).toEqual([]);
    expect(allListReads()).toEqual([]);
    const near = (node: Element) =>
      act(() => {
        for (const observer of observers)
          if (observer.targets.includes(node))
            observer.callback(
              [
                {
                  isIntersecting: true,
                  target: node,
                } as IntersectionObserverEntry,
              ],
              observer as unknown as IntersectionObserver
            );
      });
    near(glance().closest('section')?.parentElement as Element);
    await waitFor(
      () => expect(tile(/QORT minted/i)).toHaveTextContent('123.46 QORT'),
      T
    );
    // Activity's own reads (its first reward share) wait for Activity to near the screen.
    const shareReads = () =>
      calls.filter(
        ({ path }) => params(path).getAll('txType').join() === 'REWARD_SHARE'
      );
    expect(shareReads()).toEqual([]);
    const region = within(dialog()).getByRole('region', {
      name: /^activity$/i,
    });
    near(region.parentElement as Element);
    await waitFor(() => expect(shareReads()).toHaveLength(1));
  });
});

describe('an AT’s page', () => {
  it('has no QORT figures and no Activity: an AT never mints, and nothing of them is read', async () => {
    routes.push(viewer(LEVEL_FIVE), (path) => {
      if (path === `/addresses/${AT_ADDR}`)
        return { body: account(AT_ADDR, { publicKey: null, blocksMinted: 0 }) };
      if (allListOffset(path, AT_ADDR) !== null)
        return {
          body: history(5).map((row) => ({ ...row, recipient: AT_ADDR })),
        };
      return undefined;
    });
    renderWindow();
    await lookUp(AT_ADDR);
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: /AT address/i,
      })
    ).toBeInTheDocument();
    await settle();
    expect(dialog()).not.toHaveTextContent(/QORT minted|purchased|activity/i);
    expect(
      calls.filter(
        ({ path }) =>
          path.startsWith('/crosschain/') ||
          path.startsWith('/assets/order/') ||
          path.startsWith('/addresses/balance/') ||
          params(path).getAll('txType').join() === 'REWARD_SHARE'
      )
    ).toEqual([]);
    expect(allListReads(AT_ADDR)).toEqual([0]);
  });
});
