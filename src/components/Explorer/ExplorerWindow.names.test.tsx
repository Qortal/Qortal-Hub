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
import { formatDay } from '../../lib/explorer/format';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';
import { listViewKey } from './ViewToggle';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The account's Names tab, a name's whole history (a step of its own), and
// the ways to them (the Overview, a name in a sentence), in the window as
// App mounts it, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const THIRD = `Q${'T'.repeat(33)}`;
const PUBLIC_KEY = 'k'.repeat(44);

/** A name written with a blank Braille character. */
const BLANK_NAME = 'Spare⠀Room';
/** A name that starts like its owner's address. */
const PREFIX_NAME = 'QPPPP Vault';

type Row = Record<string, unknown>;
type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

/** A read of an account's name transactions (the Names kind of its list). */
const isNameTxRead = (path: string, address: string) =>
  path.startsWith('/transactions/search?') &&
  params(path).get('address') === address &&
  params(path).getAll('txType').includes('BUY_NAME');

const nameTxReads = (address: string) =>
  calls.filter((call) => isNameTxRead(call.path, address));

const BLOCK_TIME = (height: number) => 1_700_000_000_000 + height * 60_000;

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
const sig = (n: number) => `N${base58(n).padStart(6, '1')}`.padEnd(88, 'x');

let signatureCount = 0;
/** A name transaction at `height`, made by `by`. */
function nameTx(
  type: string,
  height: number,
  by: string,
  fields: Row = {}
): Row {
  signatureCount += 1;
  return {
    type,
    timestamp: BLOCK_TIME(height),
    signature: sig(signatureCount),
    fee: '0.01000000',
    txGroupId: 0,
    blockHeight: height,
    approvalStatus: 'NOT_REQUIRED',
    creatorAddress: by,
    ...fields,
  };
}

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

/** What every account page reads, for `address`, with its names. */
function quietAccount(
  address: string,
  primary: string | null,
  names: string[] = primary ? [primary] : []
): Route {
  return (path) => {
    if (path === `/addresses/${address}`) return { body: account(address) };
    if (path === `/names/primary/${address}`)
      return {
        body: primary ? { name: primary, owner: address } : { owner: address },
      };
    if (path.startsWith(`/names/address/${address}?`)) {
      const offset = Number(params(path).get('offset') ?? 0);
      const limit = Number(params(path).get('limit') ?? 100);
      return {
        body: names
          .slice(offset, offset + limit)
          .map((name) => ({ name, owner: address })),
      };
    }
    if (path === `/groups/member/${address}`) return { body: [] };
    if (path === `/addresses/balance/${address}`) return { body: 12.5 };
    if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
    if (path.startsWith('/transactions/search?') && path.includes(address))
      return { body: [] };
    return undefined;
  };
}

/** A name's record, as the node keeps it. */
function record(
  name: string,
  owner: string,
  extra: Row = { registered: BLOCK_TIME(10) }
): Route {
  return (path) =>
    path === `/names/${encodeURIComponent(name)}`
      ? { body: { name, reducedName: name.toLowerCase(), owner, ...extra } }
      : undefined;
}

/** No one has `name`: the node's own answer. */
const unknownName =
  (name: string): Route =>
  (path) =>
    path === `/names/${encodeURIComponent(name)}`
      ? { status: 404, body: { error: 401, message: 'name unknown' } }
      : undefined;

/** An account's list of every transaction (the Transactions tab's All), 100 a page. */
function allTxsOf(address: string, rows: Row[]): Route {
  return (path) => {
    if (
      !path.startsWith('/transactions/search?') ||
      params(path).get('address') !== address ||
      params(path).get('limit') !== '100' ||
      params(path).getAll('txType').length
    )
      return undefined;
    const offset = Number(params(path).get('offset') ?? 0);
    return { body: rows.slice(offset, offset + 100) };
  };
}

/** An account's name transactions, newest first, 100 a page. */
function nameTxsOf(
  address: string,
  rows: Row[] | ((offset: number) => Answer)
): Route {
  return (path) => {
    if (!isNameTxRead(path, address)) return undefined;
    const offset = Number(params(path).get('offset') ?? 0);
    return typeof rows === 'function'
      ? rows(offset)
      : { body: rows.slice(offset, offset + 100) };
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

/** An answer held back until it is let go. */
function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
}

async function openAccount(address: string, name: string) {
  renderWindow();
  await lookUp(address);
  await within(dialog()).findByRole('heading', { level: 2, name });
}

async function openNamesTab() {
  fireEvent.click(within(dialog()).getByRole('tab', { name: /^names$/i }));
  return within(dialog()).findByRole('tabpanel', { name: /^names$/i });
}

/** The names section of the tab. */
const namesRegion = (scope: HTMLElement, title: RegExp = /^names \(/i) =>
  within(scope).findByRole('region', { name: title });

/** A list's own items (not the items of the histories inside them). */
const items = (list: HTMLElement) => [
  ...list.querySelectorAll<HTMLElement>(':scope > li'),
];
/** Text or an accessible name, read without the marks that isolate a name in it. */
const plain = (text: string) => text.replace(/[\u2068\u2069]/g, '');
/** Matches an accessible name, read without the isolating marks. */
const named = (pattern: RegExp) => (accessibleName: string) =>
  pattern.test(plain(accessibleName));

/** The name heading of each item. */
const rowNames = (list: HTMLElement) =>
  items(list).map(
    (row) => row.querySelector('[data-name-head] bdi')?.textContent ?? ''
  );
const itemOf = (list: HTMLElement, name: string) =>
  items(list).find(
    (row) => row.querySelector('[data-name-head] bdi')?.textContent === name
  ) as HTMLElement;

// ---- Publisher: its names and what it did with them ----------------------------------------------

/** Registered by Second at block 100, listed at 200, bought by Publisher at 300. */
const MAPLE_REGISTER = () =>
  nameTx('REGISTER_NAME', 100, SECOND, { name: 'Maple' });
const MAPLE_SELL = () =>
  nameTx('SELL_NAME', 200, SECOND, { name: 'Maple', amount: '5.00000000' });
const MAPLE_BUY = () =>
  nameTx('BUY_NAME', 300, PUBLISHER, {
    name: 'Maple',
    seller: SECOND,
    amount: '5.00000000',
  });

function publisherWorld() {
  const register = MAPLE_REGISTER();
  const sell = MAPLE_SELL();
  const buy = MAPLE_BUY();
  const own = nameTx('REGISTER_NAME', 50, PUBLISHER, { name: 'Publisher' });
  const vault = nameTx('REGISTER_NAME', 60, PUBLISHER, { name: PREFIX_NAME });
  const blank = nameTx('REGISTER_NAME', 70, PUBLISHER, { name: BLANK_NAME });
  const oakRegister = nameTx('REGISTER_NAME', 80, PUBLISHER, { name: 'Oak' });
  const oakSell = nameTx('SELL_NAME', 400, PUBLISHER, {
    name: 'Oak',
    amount: '3.00000000',
  });
  const oakBuy = nameTx('BUY_NAME', 500, SECOND, {
    name: 'Oak',
    seller: PUBLISHER,
    amount: '3.00000000',
  });
  const publisherNames = [oakBuy, oakSell, buy, oakRegister, blank, vault, own];
  routes.push(
    nameTxsOf(PUBLISHER, publisherNames),
    allTxsOf(PUBLISHER, publisherNames),
    nameTxsOf(SECOND, [oakBuy, buy, sell, register]),
    record('Publisher', PUBLISHER, { registered: BLOCK_TIME(50) }),
    record('Maple', PUBLISHER, {
      registered: BLOCK_TIME(100),
      updated: BLOCK_TIME(300),
      isForSale: false,
      salePrice: '5.00000000',
    }),
    record(PREFIX_NAME, PUBLISHER, {
      registered: BLOCK_TIME(60),
      isForSale: true,
      salePrice: '25.50000000',
    }),
    record(BLANK_NAME, PUBLISHER, { registered: BLOCK_TIME(70) }),
    record('Oak', SECOND, {
      registered: BLOCK_TIME(80),
      updated: BLOCK_TIME(500),
    }),
    quietAccount(PUBLISHER, 'Publisher', [
      'Publisher',
      PREFIX_NAME,
      BLANK_NAME,
      'Maple',
    ]),
    quietAccount(SECOND, 'Second', ['Second', 'Oak']),
    record('Second', SECOND)
  );
  return { register, sell, buy, oakBuy, oakSell };
}

beforeEach(() => {
  routes = [];
  calls = [];
  signatureCount = 0;
  window.localStorage.clear();
  stubNode();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Names tab', () => {
  it('lists every name, the primary one first, each with its record and notes on how it is written', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const tabs = within(dialog()).getByRole('tablist', {
      name: /account sections/i,
    });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['Overview', 'Transactions', 'Names']);
    const panel = await openNamesTab();
    const names = await namesRegion(panel, /^names \(4\)$/i);
    const list = within(names).getByRole('list', { name: /^its names$/i });
    expect(rowNames(list)).toEqual([
      'Publisher',
      PREFIX_NAME,
      'Spare·Room',
      'Maple',
    ]);
    const primary = itemOf(list, 'Publisher');
    expect(within(primary).getByText('Primary')).toBeInTheDocument();
    expect(
      within(itemOf(list, 'Maple')).queryByText('Primary')
    ).not.toBeInTheDocument();

    // Each name's record: when it was registered and updated, and whether it is for sale.
    const maple = itemOf(list, 'Maple');
    expect(
      await within(maple).findByText(
        `Registered ${formatDay(BLOCK_TIME(100), 'en')} · Updated ${formatDay(BLOCK_TIME(300), 'en')}`
      )
    ).toBeInTheDocument();
    // Its last price stays in the record after a sale: not "for sale".
    expect(maple).not.toHaveTextContent(/for sale/i);
    const vault = itemOf(list, PREFIX_NAME);
    expect(
      await within(vault).findByText(/For sale at 25\.5 QORT$/)
    ).toBeInTheDocument();

    // Notes on how a name is written, under it.
    expect(vault).toHaveTextContent(
      "This name starts with the same characters as its owner's address (QPPPP…)."
    );
    expect(itemOf(list, 'Spare·Room')).toHaveTextContent(
      'This name contains an invisible or blank character.'
    );
    expect(primary).not.toHaveTextContent(/This name/);
  });
});

describe('the Names tab: orders and views', () => {
  it('sorts the names, and the step keeps the order picked', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    const list = within(names).getByRole('list', { name: /^its names$/i });
    fireEvent.mouseDown(within(names).getByRole('combobox', { name: /sort/i }));
    fireEvent.click(await screen.findByRole('option', { name: /^a to z$/i }));
    expect(rowNames(list)).toEqual([
      'Maple',
      'Publisher',
      PREFIX_NAME,
      'Spare·Room',
    ]);
    fireEvent.mouseDown(within(names).getByRole('combobox', { name: /sort/i }));
    fireEvent.click(
      await screen.findByRole('option', { name: /^newest registered$/i })
    );
    expect(rowNames(list)).toEqual([
      'Maple',
      'Spare·Room',
      PREFIX_NAME,
      'Publisher',
    ]);

    // Away and Back: the tab and the order picked are as they were left.
    fireEvent.click(
      await within(itemOf(list, 'Maple')).findByRole('button', {
        name: 'Second',
      })
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await namesRegion(
      await within(dialog()).findByRole('tabpanel', { name: /^names$/i })
    );
    expect(
      within(again).getByRole('combobox', { name: /sort/i })
    ).toHaveTextContent(/^Newest registered$/);
    expect(
      rowNames(within(again).getByRole('list', { name: /^its names$/i }))
    ).toEqual(['Maple', 'Spare·Room', PREFIX_NAME, 'Publisher']);
  });

  it('puts the name with the latest activity first, from its name transactions', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    const list = within(names).getByRole('list', { name: /^its names$/i });
    await within(itemOf(list, 'Maple')).findByText(/Bought the name/);
    fireEvent.mouseDown(within(names).getByRole('combobox', { name: /sort/i }));
    fireEvent.click(
      await screen.findByRole('option', { name: /^latest activity$/i })
    );
    expect(rowNames(list)).toEqual([
      'Maple',
      'Spare·Room',
      PREFIX_NAME,
      'Publisher',
    ]);
  });

  it('shows the names as a grid (the default) or a list, kept on this device', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    const layout = within(names).getByRole('group', {
      name: /show the names as/i,
    });
    expect(
      within(layout).getByRole('button', { name: /^grid$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(layout).getByRole('button', { name: /^list$/i }));
    expect(
      within(layout).getByRole('button', { name: /^list$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(listViewKey('names'))).toBe('list');
  });

  it('opens on the list when this device chose it', async () => {
    window.localStorage.setItem(listViewKey('names'), 'list');
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    expect(
      within(names).getByRole('button', { name: /^list$/i })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the Names tab: what the node has or hasn’t', () => {
  it('shows 20 at a time, puts the keyboard on the first one added, and says when the node’s list stopped at 500', async () => {
    // One more than the node's list is read for: the 501st says it stopped.
    const bulk = Array.from(
      { length: 501 },
      (_, i) => `Bulk ${String(i).padStart(3, '0')}`
    );
    routes.push(
      nameTxsOf(PUBLISHER, [
        nameTx('BUY_NAME', 900, SECOND, {
          name: 'Sold One',
          seller: PUBLISHER,
          amount: '1.00000000',
        }),
      ]),
      (path) =>
        path.startsWith('/names/Bulk')
          ? {
              body: {
                name: decodeURIComponent(path.slice('/names/'.length)),
                owner: PUBLISHER,
                registered: BLOCK_TIME(1),
              },
            }
          : undefined,
      quietAccount(PUBLISHER, 'Bulk 000', bulk)
    );
    await openAccount(PUBLISHER, 'Bulk 000');
    const panel = await openNamesTab();
    const names = await namesRegion(panel, /^names \(500\+\)$/i);
    const list = within(names).getByRole('list', { name: /^its names$/i });
    expect(items(list)).toHaveLength(20);
    expect(
      within(names).getByText('500+ names; the first 500 are listed.')
    ).toBeInTheDocument();
    fireEvent.click(
      within(names).getByRole('button', { name: /^show 20 more$/i })
    );
    expect(items(list)).toHaveLength(40);
    await waitFor(() => expect(items(list)[20]).toHaveFocus());
    // Only the names shown read their records.
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path.startsWith('/names/Bulk')).length
      ).toBe(40)
    );
    // Names it had are left out: with the list cut, it can't tell which it still owns.
    expect(
      (
        await within(names).findAllByText(
          'None found in its name transactions.'
        )
      ).length
    ).toBeGreaterThan(0);
    expect(
      within(panel).queryByRole('region', { name: /names it had/i })
    ).not.toBeInTheDocument();
  });

  it('says when it has names but no primary name, and why it can’t pick one', async () => {
    routes.push(
      nameTxsOf(PUBLISHER, []),
      record('Maple', PUBLISHER),
      record('Oak', PUBLISHER),
      quietAccount(PUBLISHER, null, ['Maple', 'Oak'])
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', { level: 2 });
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    expect(
      await within(names).findByText(/^No primary name\. The node gives/)
    ).toBeInTheDocument();
    expect(within(names).queryByText('Primary')).not.toBeInTheDocument();
  });

  it('says a primary name that couldn’t be read with Retry, never that it has none', async () => {
    let fail = true;
    routes.push(
      (path) =>
        path === `/names/primary/${PUBLISHER}` && fail
          ? { status: 503, body: { error: 1, message: 'busy' } }
          : undefined,
      nameTxsOf(PUBLISHER, []),
      record('Publisher', PUBLISHER),
      record('Maple', PUBLISHER),
      quietAccount(PUBLISHER, 'Publisher', ['Maple', 'Publisher'])
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    expect(
      await within(names).findByText(/^Couldn't read its primary name\./)
    ).toBeInTheDocument();
    expect(
      within(names).queryByText(/^No primary name/)
    ).not.toBeInTheDocument();
    // The names still show, in the node's order.
    expect(
      rowNames(within(names).getByRole('list', { name: /^its names$/i }))
    ).toEqual(['Maple', 'Publisher']);
    fail = false;
    fireEvent.click(within(names).getByRole('button', { name: /^retry$/i }));
    await waitFor(() =>
      expect(
        rowNames(within(names).getByRole('list', { name: /^its names$/i }))
      ).toEqual(['Publisher', 'Maple'])
    );
    expect(within(names).getByText('Primary')).toBeInTheDocument();
  });

  it('says when an account has no names', async () => {
    routes.push(nameTxsOf(PUBLISHER, []), quietAccount(PUBLISHER, null, []));
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openNamesTab();
    expect(
      await within(panel).findByText('No registered name.')
    ).toBeInTheDocument();
  });

  it('with no name now, still lists the names it had, and says when its name history couldn’t be read', async () => {
    let fail = true;
    const sold = nameTx('BUY_NAME', 500, SECOND, {
      name: 'Oak',
      seller: PUBLISHER,
      amount: '3.00000000',
    });
    routes.push(
      (path) =>
        fail && isNameTxRead(path, PUBLISHER)
          ? { status: 500, body: { error: 1, message: 'busy' } }
          : undefined,
      nameTxsOf(PUBLISHER, [
        sold,
        nameTx('REGISTER_NAME', 80, PUBLISHER, { name: 'Oak' }),
      ]),
      record('Oak', SECOND),
      quietAccount(PUBLISHER, null, []),
      quietAccount(SECOND, 'Second')
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openNamesTab();
    expect(
      await within(panel).findByText('No registered name.')
    ).toBeInTheDocument();
    expect(
      await within(panel).findByText(/^Couldn't load its name history\./)
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(panel).getByRole('button', { name: /^retry$/i }));
    const had = await within(panel).findByRole('region', {
      name: /^names it had \(1\)$/i,
    });
    expect(await within(had).findByText(/^Now owned by/)).toHaveTextContent(
      'Now owned by Second'
    );
  });

  it('says its names couldn’t be loaded with Retry, never that it has none', async () => {
    let fail = true;
    routes.push(
      (path) =>
        path.startsWith(`/names/address/${PUBLISHER}?`) && fail
          ? { status: 500, body: { error: 1, message: 'busy' } }
          : undefined,
      nameTxsOf(PUBLISHER, []),
      record('Publisher', PUBLISHER),
      quietAccount(PUBLISHER, 'Publisher')
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    expect(
      await within(panel).findByText(/^Couldn't load its names\./)
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText('No registered name.')
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(panel).getByRole('button', { name: /^retry$/i }));
    expect(await namesRegion(panel, /^names \(1\)$/i)).toBeInTheDocument();
  });

  it('says a name’s record couldn’t be read with Retry, never that the node has none', async () => {
    let fail = true;
    routes.push(
      (path) =>
        path === '/names/Maple' && fail
          ? { status: 500, body: { error: 1, message: 'busy' } }
          : undefined,
      nameTxsOf(PUBLISHER, []),
      record('Maple', PUBLISHER, { registered: BLOCK_TIME(100) }),
      quietAccount(PUBLISHER, 'Maple')
    );
    await openAccount(PUBLISHER, 'Maple');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    expect(
      await within(names).findByText(/^Couldn't load this name's record\./)
    ).toBeInTheDocument();
    expect(within(names).queryByText(/no record/i)).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(names).getByRole('button', { name: /^retry$/i }));
    expect(
      await within(names).findByText(
        `Registered ${formatDay(BLOCK_TIME(100), 'en')}`
      )
    ).toBeInTheDocument();
  });
});

describe('the Names tab: each name’s history beside it', () => {
  it('tells what this account did with each name, from its side, with when and in which block', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    const list = within(names).getByRole('list', { name: /^its names$/i });
    const maple = itemOf(list, 'Maple');
    const history = await within(maple).findByRole('list', {
      name: named(/the history of “Maple”/i),
    });
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(
      /^Bought the name “Maple” from Second for 5 QORT/
    );
    expect(rows[0]).toHaveTextContent('block 300');
    expect(within(maple).getByText('History · 1')).toBeInTheDocument();
    // Its whole history goes further back than this account's part.
    expect(
      within(maple).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    ).toBeInTheDocument();
    // A name unchanged since this account registered it: nothing more to see.
    expect(
      within(itemOf(list, 'Publisher')).queryByRole('button', {
        name: /whole history/i,
      })
    ).not.toBeInTheDocument();
  });

  it('lists the names it had, each with who has it now and its history', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const had = await within(panel).findByRole('region', {
      name: /^names it had \(1\)$/i,
    });
    const list = within(had).getByRole('list', { name: /^names it had$/i });
    const oak = itemOf(list, 'Oak');
    expect(await within(oak).findByText(/^Now owned by/)).toHaveTextContent(
      'Now owned by Second'
    );
    const history = within(oak).getByRole('list', {
      name: named(/the history of “Oak”/i),
    });
    const rows = within(history)
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
    expect(rows[0]).toMatch(/^Sold the name “Oak” to Second for 3 QORT/);
    expect(rows[1]).toMatch(/^Listed the name “Oak” for sale at 3 QORT/);
    expect(rows[2]).toMatch(/^Registered the name “Oak”/);
    // Who has it now opens in the Explorer.
    fireEvent.click(within(oak).getAllByRole('button', { name: 'Second' })[0]);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
  });

  it('shows the newest four of a name’s history, and the rest on request, kept by the step', async () => {
    const updates = Array.from({ length: 6 }, (_, i) =>
      nameTx('UPDATE_NAME', 200 - i, PUBLISHER, {
        name: 'Maple',
        newData: `data ${i}`,
      })
    );
    routes.push(
      nameTxsOf(PUBLISHER, [
        ...updates,
        nameTx('REGISTER_NAME', 10, PUBLISHER, { name: 'Maple' }),
      ]),
      record('Maple', PUBLISHER),
      quietAccount(PUBLISHER, 'Maple')
    );
    await openAccount(PUBLISHER, 'Maple');
    const panel = await openNamesTab();
    const history = await within(panel).findByRole('list', {
      name: named(/the history of “Maple”/i),
    });
    expect(within(history).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(
      within(panel).getByRole('button', {
        name: named(/show all 7 of the history of “Maple”/i),
      })
    );
    expect(within(history).getAllByRole('listitem')).toHaveLength(7);
  });

  it('reads its name transactions once for both the Names tab and the Transactions tab’s Names kind', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    await within(panel).findByRole('list', {
      name: named(/the history of “Maple”/i),
    });
    expect(nameTxReads(PUBLISHER)).toHaveLength(1);
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const txPanel = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const kinds = within(txPanel).getByRole('group', {
      name: /show one kind of transaction/i,
    });
    fireEvent.click(within(kinds).getByRole('button', { name: /^names$/i }));
    expect(
      await within(txPanel).findByRole('button', {
        name: named(/Bought the name “Maple” from Second/),
      })
    ).toBeInTheDocument();
    expect(nameTxReads(PUBLISHER)).toHaveLength(1);
  });

  it('says once, over the names, when their history comes from only the newest 100, and reads older ones on request', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) =>
      nameTx('REGISTER_NAME', 10_000 - i, PUBLISHER, { name: `Spare ${i}` })
    );
    const older = [
      nameTx('REGISTER_NAME', 50, PUBLISHER, { name: 'Maple' }),
      nameTx('REGISTER_NAME', 40, PUBLISHER, { name: 'Oak' }),
    ];
    routes.push(
      nameTxsOf(PUBLISHER, (offset) => ({
        body: offset === 0 ? hundred : older,
      })),
      record('Maple', PUBLISHER),
      record('Oak', PUBLISHER),
      record('Publisher', PUBLISHER),
      quietAccount(PUBLISHER, 'Publisher', ['Publisher', 'Maple', 'Oak'])
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    expect(
      await within(names).findByText(
        "Each name's history comes from its newest 100 name transactions. 3 of its names have none in them. Older ones aren't read yet."
      )
    ).toBeInTheDocument();
    // No "none found" on each name: the line over them says it once.
    expect(
      within(names).queryByText('None found in its name transactions.')
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(names).getByRole('button', {
        name: /^read older name transactions$/i,
      })
    );
    expect(
      await within(names).findByRole('list', {
        name: named(/the history of “Maple”/i),
      })
    ).toBeInTheDocument();
    expect(
      within(names).queryByText(/^Each name's history comes from/)
    ).not.toBeInTheDocument();
    expect(
      nameTxReads(PUBLISHER).map((call) => params(call.path).get('offset'))
    ).toEqual(['0', '100']);
  });

  it('says its name history couldn’t be read with Retry, and the names still show', async () => {
    let fail = true;
    publisherWorld();
    routes.unshift((path) =>
      fail && isNameTxRead(path, PUBLISHER)
        ? { status: 500, body: { error: 1, message: 'busy' } }
        : undefined
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const names = await namesRegion(panel);
    expect(
      await within(names).findByText(/^Couldn't load its name history\./)
    ).toBeInTheDocument();
    expect(
      rowNames(within(names).getByRole('list', { name: /^its names$/i }))
    ).toHaveLength(4);
    expect(
      within(names).queryByText('None found in its name transactions.')
    ).not.toBeInTheDocument();
    expect(
      within(names).queryByRole('list', { name: /the history of/i })
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(
      within(names)
        .getAllByRole('button', { name: /^retry$/i })
        .find((button) =>
          button
            .closest('[role="alert"]')
            ?.textContent?.includes('name history')
        ) as HTMLElement
    );
    expect(
      await within(names).findByRole('list', {
        name: named(/the history of “Maple”/i),
      })
    ).toBeInTheDocument();
    expect(
      await within(panel).findByRole('region', { name: /^names it had/i })
    ).toBeInTheDocument();
  });
});

/** The name page's heading, once it is on screen. */
const namePage = (name: string) =>
  within(dialog()).findByRole('heading', { level: 2, name });

/** The rows of a name's whole history, by their words. */
async function lifeRows() {
  const list = await within(dialog()).findByRole('list', {
    name: named(/^every change to “/i),
  });
  return [...list.querySelectorAll('[data-tx-row]')].map((button) =>
    plain(button.parentElement?.textContent ?? '')
  );
}

describe('a name’s whole history', () => {
  it('opens from a name as a step of its own, back through every account that had it', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    const before = nameTxReads(SECOND).length;
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    expect(within(dialog()).getByText('Registered name')).toBeInTheDocument();
    const owner = within(dialog()).getByRole('region', { name: /^owner$/i });
    expect(within(owner).getByText('Publisher')).toBeInTheDocument();
    const history = within(dialog()).getByRole('region', {
      name: /^whole history$/i,
    });
    expect(
      await within(history).findByText(
        `Registered ${formatDay(BLOCK_TIME(100), 'en')} · 2 changes since · 2 owners`
      )
    ).toBeInTheDocument();
    const rows = await lifeRows();
    expect(rows[0]).toMatch(
      /^Publisher bought the name “Maple” from Second for 5 QORT/
    );
    expect(rows[1]).toMatch(
      /^Second listed the name “Maple” for sale at 5 QORT/
    );
    expect(rows[2]).toMatch(/^Second registered the name “Maple”/);
    expect(rows[0]).toMatch(/block 300/);
    // Back through the seller: one read of Second's name transactions.
    expect(nameTxReads(SECOND).length).toBe(before + 1);

    // A row opens to the accounts involved.
    const first = within(history)
      .getAllByRole('button')
      .find((button) => button.hasAttribute('data-tx-row')) as HTMLElement;
    fireEvent.click(first);
    const people = within(history).getByRole('list', {
      name: /accounts involved/i,
    });
    expect(
      within(people).getByRole('button', { name: /Second/ })
    ).toBeInTheDocument();

    // Back: the Names tab as it was left.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /^names$/i })
    ).toBeInTheDocument();
  });

  it('opens from a name in a transaction’s sentence', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const txPanel = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const row = await within(txPanel).findByRole('button', {
      name: /Bought the name “Maple” from Second/,
    });
    // Over the row's button, out of the Tab order (the opened row has it for the keyboard).
    const link = within(row.parentElement as HTMLElement).getByRole('button', {
      name: 'Maple',
      hidden: true,
    });
    expect(link).toHaveAttribute('tabindex', '-1');
    fireEvent.click(link);
    await namePage('Maple');
    // An account opened from the name's page goes on from the trail.
    const owner = within(dialog()).getByRole('region', { name: /^owner$/i });
    fireEvent.click(within(owner).getByRole('button', { name: /Publisher/ }));
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await namePage('Maple');
  });

  it('opens a name from a row’s details too, and adds no step for the name on screen', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const txPanel = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const row = await within(txPanel).findByRole('button', {
      name: /Bought the name “Maple” from Second/,
    });
    fireEvent.click(row);
    const details = within(txPanel).getByRole('list', {
      name: /accounts involved/i,
    }).parentElement?.parentElement as HTMLElement;
    const fieldLink = within(details)
      .getAllByRole('button', { name: 'Maple' })
      .find(
        (button) => button.getAttribute('tabindex') !== '-1'
      ) as HTMLElement;
    fireEvent.click(fieldLink);
    await namePage('Maple');
    // The same name again: no step more.
    const history = await within(dialog()).findByRole('region', {
      name: /^whole history$/i,
    });
    await lifeRows();
    fireEvent.click(
      within(history).getAllByRole('button', { name: 'Maple', hidden: true })[0]
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /^transactions$/i })
    ).toBeInTheDocument();
  });

  it('follows a rename back to the earlier name, under the same account', async () => {
    const register = nameTx('REGISTER_NAME', 100, PUBLISHER, { name: 'Mapl' });
    const rename = nameTx('UPDATE_NAME', 200, PUBLISHER, {
      name: 'Mapl',
      newName: 'Maple',
      newData: 'data',
    });
    routes.push(
      nameTxsOf(PUBLISHER, [rename, register]),
      record('Maple', PUBLISHER, { registered: BLOCK_TIME(100) }),
      record('Publisher', PUBLISHER),
      unknownName('Mapl'),
      quietAccount(PUBLISHER, 'Publisher', ['Publisher', 'Maple'])
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    // The name it renamed is among the names it had: no one has it now, so nothing to walk back from.
    const had = await within(panel).findByRole('region', {
      name: /^names it had \(1\)$/i,
    });
    const old = itemOf(
      within(had).getByRole('list', { name: /^names it had$/i }),
      'Mapl'
    );
    expect(
      await within(old).findByText('No one has this name now.')
    ).toBeInTheDocument();
    expect(
      within(old).queryByRole('button', { name: /whole history/i })
    ).not.toBeInTheDocument();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    await within(itemOf(list, 'Maple')).findByRole('list', {
      name: named(/the history of “Maple”/i),
    });
    const before = nameTxReads(PUBLISHER).length;
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    expect(
      await within(dialog()).findByText(
        `Registered ${formatDay(BLOCK_TIME(100), 'en')} · 1 change since`
      )
    ).toBeInTheDocument();
    const rows = await lifeRows();
    expect(rows[0]).toMatch(/^Publisher renamed “Mapl” to “Maple”/);
    expect(rows[1]).toMatch(/^Publisher registered the name “Mapl”/);
    // The earlier name is the same account's: read once for both.
    expect(nameTxReads(PUBLISHER).length).toBe(before + 1);
  });

  it('goes on with the trail: an account opened from a name’s page is one more step from the account it came from', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    await lifeRows();
    const history = within(dialog()).getByRole('region', {
      name: /^whole history$/i,
    });
    const firstRow = history.querySelector('[data-tx-row]') as HTMLElement;
    fireEvent.click(firstRow);
    const people = within(history).getByRole('list', {
      name: /accounts involved/i,
    });
    fireEvent.click(within(people).getByRole('button', { name: /Second/ }));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    const trail = within(dialog()).getByRole('navigation', { name: /trail/i });
    expect(
      within(trail).getByRole('button', { name: /Publisher/ })
    ).toBeInTheDocument();
  });

  it('opens a name written another way to the name the node matched, with its whole history', async () => {
    const publish = nameTx('ARBITRARY', 400, PUBLISHER, {
      service: 'WEBSITE',
      name: 'maple',
      identifier: 'default',
      size: 120,
    });
    const register = nameTx('REGISTER_NAME', 100, PUBLISHER, {
      name: 'Maple',
    });
    routes.push(
      allTxsOf(PUBLISHER, [publish]),
      nameTxsOf(PUBLISHER, [register]),
      record('Maple', PUBLISHER, { registered: BLOCK_TIME(100) }),
      (path) =>
        path === '/names/maple'
          ? {
              body: {
                name: 'Maple',
                owner: PUBLISHER,
                registered: BLOCK_TIME(100),
              },
            }
          : undefined,
      record('Publisher', PUBLISHER),
      quietAccount(PUBLISHER, 'Publisher', ['Publisher', 'Maple'])
    );
    await openAccount(PUBLISHER, 'Publisher');
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const txPanel = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const row = await within(txPanel).findByRole('button', {
      name: /Published .* as “maple”/,
    });
    fireEvent.click(
      within(row.parentElement as HTMLElement).getByRole('button', {
        name: 'maple',
        hidden: true,
      })
    );
    await namePage('Maple');
    const note = within(dialog())
      .getAllByRole('note')
      .find((node) => plain(node.textContent ?? '').startsWith('Opened as'));
    expect(plain(note?.textContent ?? '')).toBe(
      'Opened as “maple”; the node matched the name “Maple”, ignoring case and look-alike letters.'
    );
    // Walked back under the name as registered.
    expect(
      await within(dialog()).findByText(
        `Registered ${formatDay(BLOCK_TIME(100), 'en')} · no changes since`
      )
    ).toBeInTheDocument();
  });

  it('says who has a name now when the node’s record gives another owner than its list', async () => {
    routes.push(
      nameTxsOf(PUBLISHER, []),
      record('Maple', SECOND, { registered: BLOCK_TIME(100) }),
      record('Publisher', PUBLISHER),
      quietAccount(PUBLISHER, 'Publisher', ['Publisher', 'Maple']),
      quietAccount(SECOND, 'Second')
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    const maple = itemOf(list, 'Maple');
    expect(await within(maple).findByText(/^Now owned by/)).toHaveTextContent(
      'Now owned by Second'
    );
    expect(
      within(itemOf(list, 'Publisher')).queryByText(/^Now owned by/)
    ).not.toBeInTheDocument();
  });

  it('says when it doesn’t reach the registration its record gives', async () => {
    publisherWorld();
    routes.unshift(record('Maple', PUBLISHER, { registered: BLOCK_TIME(90) }));
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', { level: 2 });
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    expect(
      await within(dialog()).findByText(
        `Its record gives another registration, ${formatDay(BLOCK_TIME(90), 'en')}: part of its history is missing here.`
      )
    ).toBeInTheDocument();
  });

  it('says where it stops when an owner’s transactions don’t say how it got the name', async () => {
    routes.push(
      nameTxsOf(PUBLISHER, [
        nameTx('UPDATE_NAME', 300, PUBLISHER, { name: 'Maple', newData: 'x' }),
      ]),
      record('Maple', PUBLISHER),
      quietAccount(PUBLISHER, 'Maple')
    );
    await openAccount(PUBLISHER, 'Maple');
    const panel = await openNamesTab();
    fireEvent.click(
      await within(panel).findByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    const note = await within(dialog()).findByRole('note');
    expect(plain(note.textContent ?? '')).toBe(
      "How Maple got it isn't among its name transactions, so what came before isn't shown."
    );
    expect(within(dialog()).getByText('1 change found')).toBeInTheDocument();
  });

  it('has a page of its own for a name no one has now, and Retry for a failed read', async () => {
    let fail = true;
    const renamed = nameTx('UPDATE_NAME', 300, PUBLISHER, {
      name: 'Gone',
      newName: 'Maple',
    });
    routes.push(
      (path) =>
        path === '/names/Gone' && fail
          ? { status: 503, body: { error: 1, message: 'busy' } }
          : undefined,
      unknownName('Gone'),
      nameTxsOf(PUBLISHER, [renamed]),
      allTxsOf(PUBLISHER, [renamed]),
      record('Maple', PUBLISHER),
      quietAccount(PUBLISHER, 'Maple')
    );
    await openAccount(PUBLISHER, 'Maple');
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const txPanel = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const row = await within(txPanel).findByRole('button', {
      name: /Renamed “Gone” to “Maple”/,
    });
    fireEvent.click(
      within(row.parentElement as HTMLElement).getByRole('button', {
        name: 'Gone',
        hidden: true,
      })
    );
    expect(
      await within(dialog()).findByText(/^Couldn't look up this name\./)
    ).toBeInTheDocument();
    expect(within(dialog()).queryByText(/no one has/i)).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^retry$/i }));
    const status = await within(dialog()).findByRole('status');
    expect(plain(status.textContent ?? '')).toBe(
      'No one has the name “Gone” now.'
    );
    // Nothing is walked for a name no one has.
    expect(
      calls.some(
        (call) =>
          isNameTxRead(call.path, PUBLISHER) &&
          params(call.path).get('offset') !== '0'
      )
    ).toBe(false);
  });

  it('says its whole history couldn’t be read with Retry, and reads it again', async () => {
    let fail = true;
    publisherWorld();
    routes.unshift((path) =>
      fail && isNameTxRead(path, SECOND)
        ? { status: 500, body: { error: 1, message: 'busy' } }
        : undefined
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    expect(
      await within(dialog()).findByText(/^Couldn't read its whole history\./)
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^retry$/i }));
    expect(await lifeRows()).toHaveLength(3);
  });

  it('reads the record and the whole history again on Refresh, keeping the page meanwhile', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    await lifeRows();
    const records = () =>
      calls.filter((call) => call.path === '/names/Maple').length;
    const seconds = nameTxReads(SECOND).length;
    const recordReads = records();
    // A sale since: Third bought it from Publisher.
    const sale = nameTx('BUY_NAME', 600, THIRD, {
      name: 'Maple',
      seller: PUBLISHER,
      amount: '9.00000000',
    });
    const later = hold();
    routes.unshift(
      (path) =>
        path === '/names/Maple'
          ? {
              body: {
                name: 'Maple',
                owner: THIRD,
                registered: BLOCK_TIME(100),
              },
              delay: later.until,
            }
          : undefined,
      nameTxsOf(THIRD, [sale]),
      quietAccount(THIRD, 'Third')
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: /refresh/i }));
    // The page stays as it was while it reads again.
    expect(
      within(dialog()).getByRole('heading', { level: 2, name: 'Maple' })
    ).toBeInTheDocument();
    expect(await lifeRows()).toHaveLength(3);
    await act(async () => {
      later.release();
      await later.until;
    });
    await waitFor(async () =>
      expect((await lifeRows())[0]).toMatch(
        /^Third bought the name “Maple” from Publisher for 9 QORT/
      )
    );
    expect(records()).toBe(recordReads + 1);
    expect(nameTxReads(SECOND).length).toBe(seconds + 1);
  });

  it('drops a whole history that comes back after another step was opened', async () => {
    publisherWorld();
    const slow = hold();
    routes.unshift((path) =>
      isNameTxRead(path, SECOND)
        ? {
            body: [MAPLE_BUY(), MAPLE_SELL(), MAPLE_REGISTER()],
            delay: slow.until,
          }
        : undefined
    );
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    expect(
      await within(dialog()).findByText(
        /^Reading back through the accounts that had it/
      )
    ).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByRole('tabpanel', { name: /^names$/i });
    await act(async () => {
      slow.release();
      await slow.until;
    });
    expect(
      within(dialog()).queryByRole('list', { name: named(/^every change to/i) })
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).getByRole('tabpanel', { name: /^names$/i })
    ).toBeInTheDocument();
  });

  it('builds every path from encoded parts, and never asks about "." or ".." as a name', async () => {
    const odd = 'a/b?c#d';
    const rows = [
      nameTx('REGISTER_NAME', 300, PUBLISHER, { name: odd }),
      nameTx('REGISTER_NAME', 200, PUBLISHER, { name: '..' }),
    ];
    routes.push(
      nameTxsOf(PUBLISHER, rows),
      allTxsOf(PUBLISHER, rows),
      record(odd, PUBLISHER),
      quietAccount(PUBLISHER, 'Publisher', [])
    );
    await openAccount(PUBLISHER, 'Publisher');
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const txPanel = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const row = await within(txPanel).findByRole('button', {
      name: /Registered the name “a\/b\?c#d”/,
    });
    fireEvent.click(
      within(row.parentElement as HTMLElement).getByRole('button', {
        name: odd,
        hidden: true,
      })
    );
    await namePage(odd);
    expect(calls.some((call) => call.path === '/names/a%2Fb%3Fc%23d')).toBe(
      true
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await within(dialog()).findByRole('tabpanel', {
      name: /^transactions$/i,
    });
    const dots = await within(again).findByRole('button', {
      name: /Registered the name “\.\.”/,
    });
    fireEvent.click(
      within(dots.parentElement as HTMLElement).getByRole('button', {
        name: '..',
        hidden: true,
      })
    );
    expect(
      await within(dialog()).findByText(/^No one has the name/)
    ).toBeInTheDocument();
    expect(
      calls.some(
        (call) => call.path === '/names/..' || call.path.startsWith('/names/.%')
      )
    ).toBe(false);
  });
});

describe('the Overview’s ways to the Names tab', () => {
  it('opens the Names tab from “owns N names”, in place, with the keyboard on it', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const owns = await within(dialog()).findByRole('button', {
      name: /^owns 4 names$/i,
    });
    fireEvent.click(owns);
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /^names$/i })
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByRole('tab', { name: /^names$/i })
    ).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(
        within(dialog()).getByRole('tab', { name: /^names$/i })
      ).toHaveFocus()
    );
    // In place: Back leaves the account.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
  });

  it('counts the notes on its other names, and opens the Names tab that shows them', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const notes = await within(dialog()).findByRole('region', {
      name: /^notes$/i,
    });
    const link = within(notes).getByRole('button', {
      name: '2 of its 3 other names have notes.',
    });
    fireEvent.click(link);
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /^names$/i })
    ).toBeInTheDocument();
  });

  it('says so of its only other name', async () => {
    routes.push(
      nameTxsOf(PUBLISHER, []),
      quietAccount(PUBLISHER, 'Publisher', ['Publisher', PREFIX_NAME])
    );
    await openAccount(PUBLISHER, 'Publisher');
    const notes = await within(dialog()).findByRole('region', {
      name: /^notes$/i,
    });
    expect(
      within(notes).getByRole('button', { name: 'Its other name has notes.' })
    ).toBeInTheDocument();
  });

  it('has no notes section for names written plainly', async () => {
    routes.push(
      nameTxsOf(PUBLISHER, []),
      quietAccount(PUBLISHER, 'Publisher', ['Publisher', 'Maple'])
    );
    await openAccount(PUBLISHER, 'Publisher');
    await within(dialog()).findByRole('button', { name: /^owns 2 names$/i });
    expect(
      within(dialog()).queryByRole('region', { name: /^notes$/i })
    ).not.toBeInTheDocument();
  });
});

describe('reading only', () => {
  it('sends the node nothing on the Names tab and a name’s page', async () => {
    publisherWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    fireEvent.click(
      within(itemOf(list, 'Maple')).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    await lifeRows();
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});

describe('the Names tab after the names changed', () => {
  /**
   * Publisher bought Maple from Second at block 300. `now.sold`: Third
   * bought it from Publisher since (block 600). `now.listed`: Publisher
   * listed it for sale at 7 QORT since (block 600).
   */
  function changingWorld() {
    const now = { sold: false, listed: false };
    const register = nameTx('REGISTER_NAME', 100, SECOND, { name: 'Maple' });
    const sell = nameTx('SELL_NAME', 200, SECOND, {
      name: 'Maple',
      amount: '5.00000000',
    });
    const buy = nameTx('BUY_NAME', 300, PUBLISHER, {
      name: 'Maple',
      seller: SECOND,
      amount: '5.00000000',
    });
    const own = nameTx('REGISTER_NAME', 50, PUBLISHER, { name: 'Publisher' });
    const listing = nameTx('SELL_NAME', 600, PUBLISHER, {
      name: 'Maple',
      amount: '7.00000000',
    });
    const sale = nameTx('BUY_NAME', 600, THIRD, {
      name: 'Maple',
      seller: PUBLISHER,
      amount: '9.00000000',
    });
    routes.push(
      (path) =>
        isNameTxRead(path, PUBLISHER)
          ? {
              body: [
                ...(now.sold ? [sale] : []),
                ...(now.listed ? [listing] : []),
                buy,
                own,
              ],
            }
          : undefined,
      nameTxsOf(SECOND, [buy, sell, register]),
      (path) =>
        isNameTxRead(path, THIRD)
          ? { body: now.sold ? [sale] : [] }
          : undefined,
      record('Publisher', PUBLISHER, { registered: BLOCK_TIME(50) }),
      (path) =>
        path === '/names/Maple'
          ? {
              body: {
                name: 'Maple',
                owner: now.sold ? THIRD : PUBLISHER,
                registered: BLOCK_TIME(100),
                updated: BLOCK_TIME(now.sold ? 600 : 300),
                isForSale: now.listed,
                salePrice: now.listed ? '7.00000000' : '5.00000000',
              },
            }
          : undefined,
      (path) =>
        path.startsWith(`/names/address/${PUBLISHER}?`)
          ? {
              body: (now.sold ? ['Publisher'] : ['Publisher', 'Maple']).map(
                (name) => ({ name, owner: PUBLISHER })
              ),
            }
          : undefined,
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second'),
      quietAccount(THIRD, 'Third')
    );
    return now;
  }

  async function mapleCard() {
    const panel = await openNamesTab();
    const list = within(await namesRegion(panel)).getByRole('list', {
      name: /^its names$/i,
    });
    await within(itemOf(list, 'Maple')).findByText(/^Registered /);
    return { panel, list };
  }

  it('reads its names’ records again on Refresh: one listed for sale since says so', async () => {
    const now = changingWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const { list } = await mapleCard();
    expect(itemOf(list, 'Maple')).not.toHaveTextContent(/for sale/i);
    now.listed = true;
    fireEvent.click(within(dialog()).getByRole('button', { name: /refresh/i }));
    await waitFor(() =>
      expect(itemOf(list, 'Maple')).toHaveTextContent(
        /Listed the name “Maple” for sale at 7 QORT/
      )
    );
    await waitFor(() =>
      expect(itemOf(list, 'Maple')).toHaveTextContent(/For sale at 7 QORT/)
    );
  });

  it('says who has a name sold since Refresh, never that it is its own again, and walks back from them', async () => {
    const now = changingWorld();
    await openAccount(PUBLISHER, 'Publisher');
    const { panel } = await mapleCard();
    now.sold = true;
    fireEvent.click(within(dialog()).getByRole('button', { name: /refresh/i }));
    const had = await within(panel).findByRole('region', {
      name: /^names it had \(1\)$/i,
    });
    const maple = itemOf(
      within(had).getByRole('list', { name: /^names it had$/i }),
      'Maple'
    );
    await waitFor(() => expect(maple).toHaveTextContent(/Now owned by Third/));
    expect(maple).not.toHaveTextContent(/Its own again/);
    fireEvent.click(
      within(maple).getByRole('button', {
        name: named(/whole history of “Maple”/i),
      })
    );
    await namePage('Maple');
    const owner = within(dialog()).getByRole('region', { name: /^owner$/i });
    expect(within(owner).getByText('Third')).toBeInTheDocument();
    expect((await lifeRows())[0]).toMatch(
      /^Third bought the name “Maple” from Publisher for 9 QORT/
    );
  });

  it('shows its primary name first, never “no primary name”, when it is past the 500 listed', async () => {
    const bulk = Array.from(
      { length: 600 },
      (_, i) => `Bulk ${String(i).padStart(3, '0')}`
    );
    routes.push(
      nameTxsOf(PUBLISHER, []),
      (path) =>
        path.startsWith('/names/Bulk')
          ? {
              body: {
                name: decodeURIComponent(path.slice('/names/'.length)),
                owner: PUBLISHER,
                registered: BLOCK_TIME(1),
              },
            }
          : undefined,
      // Its primary name is its newest: registered after it sold the one before.
      quietAccount(PUBLISHER, 'Bulk 599', bulk)
    );
    await openAccount(PUBLISHER, 'Bulk 599');
    const panel = await openNamesTab();
    const names = await namesRegion(panel, /^names \(500\+\)$/i);
    expect(
      within(names).getByText('500+ names; the first 500 are listed.')
    ).toBeInTheDocument();
    expect(
      within(names).queryByText(/^No primary name/)
    ).not.toBeInTheDocument();
    const list = within(names).getByRole('list', { name: /^its names$/i });
    expect(rowNames(list)[0]).toBe('Bulk 599');
    expect(within(items(list)[0]).getByText('Primary')).toBeInTheDocument();
  });

  it('says a name it renamed only in its case goes on under its new spelling, its own', async () => {
    const register = nameTx('REGISTER_NAME', 100, PUBLISHER, { name: 'maple' });
    const rename = nameTx('UPDATE_NAME', 200, PUBLISHER, {
      name: 'maple',
      newName: 'Maple',
    });
    const mapleRecord = {
      name: 'Maple',
      owner: PUBLISHER,
      registered: BLOCK_TIME(100),
      updated: BLOCK_TIME(200),
    };
    routes.push(
      nameTxsOf(PUBLISHER, [rename, register]),
      // The node matches names ignoring case: "maple" is Maple's record.
      (path) =>
        path === '/names/Maple' || path === '/names/maple'
          ? { body: mapleRecord }
          : undefined,
      quietAccount(PUBLISHER, 'Maple')
    );
    await openAccount(PUBLISHER, 'Maple');
    const panel = await openNamesTab();
    const had = await within(panel).findByRole('region', {
      name: /^names it had \(1\)$/i,
    });
    const old = itemOf(
      within(had).getByRole('list', { name: /^names it had$/i }),
      'maple'
    );
    await waitFor(() =>
      expect(plain(old.textContent ?? '')).toContain(
        'Now spelled “Maple”, its own.'
      )
    );
    expect(old).not.toHaveTextContent(/Its own again/);
  });

  it('says a name it renamed away was registered again since, by whom, and offers no history that isn’t its own', async () => {
    const register = nameTx('REGISTER_NAME', 100, PUBLISHER, { name: 'Old' });
    const rename = nameTx('UPDATE_NAME', 200, PUBLISHER, {
      name: 'Old',
      newName: 'New',
    });
    routes.push(
      nameTxsOf(PUBLISHER, [rename, register]),
      record('New', PUBLISHER, { registered: BLOCK_TIME(100) }),
      // Taken again since, by Second, spelled with a zero: the node matches it.
      (path) =>
        path === '/names/Old'
          ? {
              body: { name: '0ld', owner: SECOND, registered: BLOCK_TIME(900) },
            }
          : undefined,
      quietAccount(PUBLISHER, 'New'),
      quietAccount(SECOND, 'Second')
    );
    await openAccount(PUBLISHER, 'New');
    const panel = await openNamesTab();
    const had = await within(panel).findByRole('region', {
      name: /^names it had \(1\)$/i,
    });
    const old = itemOf(
      within(had).getByRole('list', { name: /^names it had$/i }),
      'Old'
    );
    await waitFor(() =>
      expect(plain(old.textContent ?? '')).toContain(
        'Registered again since, as “0ld”, by Second.'
      )
    );
    expect(
      within(old).queryByRole('button', { name: /whole history/i })
    ).not.toBeInTheDocument();
  });
});
