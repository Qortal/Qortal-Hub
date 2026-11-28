import { useState } from 'react';
import { alpha, ThemeProvider } from '@mui/material/styles';
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
import {
  firstReadKey,
  hiddenMarksKey,
} from '../../lib/explorer/activitySettings';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The Overview's Activity, for a viewer the level 5+ rule lets in: the
// chart, its legend, a period's transactions, its milestones (from Core's
// own facts only), full screen, and the Activity row of the settings, in
// the window as App mounts it, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const READER_TWO = `Q${'V'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const ADMIN = `Q${'A'.repeat(33)}`;
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
const sig = (n: number) => `C${base58(n).padStart(6, '1')}`.padEnd(88, 'x');

type Row = Record<string, unknown>;
type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const BLOCK_TIME = (height: number) =>
  Date.UTC(2025, 0, 1, 12) + (height - 1_000_000) * 60_000;
/** 30 days of blocks, a minute each. */
const MONTH = 43_200;
const NEWEST = 1_500_000;
const APPROVED_AT = NEWEST - 2 * MONTH + 600;

let n = 0;
function tx(type: string, height: number, extra: Row = {}): Row {
  n += 1;
  return {
    type,
    timestamp: BLOCK_TIME(height),
    signature: sig(n),
    fee: '0.01000000',
    txGroupId: 0,
    blockHeight: height,
    approvalStatus: 'NOT_REQUIRED',
    creatorAddress: PUBLISHER,
    ...extra,
  };
}

/** Publisher's story, newest first, a month apart: one transaction in each period. */
function story(): Row[] {
  const h = (i: number) => NEWEST - i * MONTH;
  return [
    tx('PAYMENT', h(0), {
      creatorAddress: SECOND,
      recipient: PUBLISHER,
      amount: '1.00000000',
    }),
    tx('ARBITRARY', h(1), { payments: [] }),
    tx('GROUP_INVITE', h(2), {
      creatorAddress: ADMIN,
      invitee: PUBLISHER,
      groupId: 694,
      txGroupId: 694,
      approvalStatus: 'APPROVED',
      approvalHeight: APPROVED_AT,
      timeToLive: 864000,
    }),
    tx('JOIN_GROUP', h(3), { groupId: 694 }),
    tx('TRANSFER_PRIVS', h(4), { creatorAddress: SECOND }),
    tx('BUY_NAME', h(5), {
      creatorAddress: SECOND,
      seller: PUBLISHER,
      name: 'Sold',
      amount: '5.00000000',
    }),
    tx('REGISTER_NAME', h(6), { name: 'Example' }),
    tx('PAYMENT', h(7), { recipient: SECOND, amount: '0.50000000' }),
    tx('PAYMENT', h(8), {
      creatorAddress: SECOND,
      recipient: PUBLISHER,
      amount: '1.00000000',
    }),
    tx('REWARD_SHARE', h(9), { recipient: SECOND, sharePercent: '0.00' }),
    tx('PAYMENT', h(10), {
      creatorAddress: SECOND,
      recipient: PUBLISHER,
      amount: '1.00000000',
    }),
  ];
}

/** Its All list (100 a page): the offset read, or null. */
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
const allListReads = () =>
  calls
    .map(({ path }) => allListOffset(path))
    .filter((offset): offset is number => offset !== null);

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
  rows: Row[];
  /** The approval block's read fails while true. */
  blockFails?: { on: boolean };
}

function publisherNode(node: Node): Route {
  return (path) => {
    if (path === `/addresses/${PUBLISHER}`) return { body: account(PUBLISHER) };
    if (path === `/names/primary/${PUBLISHER}`)
      return { body: { name: 'Publisher', owner: PUBLISHER } };
    if (path.startsWith(`/names/address/${PUBLISHER}`))
      return { body: [{ name: 'Publisher', owner: PUBLISHER }] };
    if (path === `/groups/member/${PUBLISHER}`) return { body: [] };
    if (path === `/addresses/balance/${PUBLISHER}`)
      return { body: '100.00000000' };
    if (path.startsWith(`/blocks/signer/${PUBLISHER}`)) return { body: [] };
    if (path === `/blocks/byheight/${APPROVED_AT}`)
      return node.blockFails?.on
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : { body: { height: APPROVED_AT, timestamp: BLOCK_TIME(APPROVED_AT) } };
    const offset = allListOffset(path);
    if (offset !== null) return { body: node.rows.slice(offset, offset + 100) };
    if (path.startsWith('/transactions/search?')) {
      const query = params(path);
      if (query.get('address') !== PUBLISHER) return undefined;
      if (query.get('txType') === 'REWARD_SHARE')
        return {
          body: node.rows
            .filter((row) => row.type === 'REWARD_SHARE')
            .slice(-1),
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
      return { body: [] };
    }
    if (path.startsWith('/transactions/signature/')) {
      const wanted = decodeURIComponent(path.split('/')[3]);
      const row = node.rows.find((each) => each.signature === wanted);
      return row ? { body: row } : undefined;
    }
    if (path.startsWith('/crosschain/trades?')) return { body: [] };
    return undefined;
  };
}

function quietAccount(address: string, name: string): Route {
  return (path) => {
    if (path === `/addresses/${address}`) return { body: account(address) };
    if (path === `/names/primary/${address}`)
      return { body: { name, owner: address } };
    if (path.startsWith(`/names/address/${address}`))
      return { body: [{ name, owner: address }] };
    if (path === `/groups/member/${address}`) return { body: [] };
    if (path === `/addresses/balance/${address}`) return { body: '1' };
    if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
    if (path.startsWith('/transactions/search?') && path.includes(address))
      return { body: [] };
    if (path.startsWith('/crosschain/trades?')) return { body: [] };
    return undefined;
  };
}

/** The Hub account looking: a MINTER member at `level`. */
function viewer(level: number, address = READER): Route {
  return (path) => {
    if (path === `/addresses/${address}`)
      return { body: account(address, { level }) };
    if (path === `/groups/member/${address}`)
      return {
        body: [
          {
            groupId: 694,
            groupName: 'MINTER',
            owner: NULL_ACCOUNT,
            isOpen: false,
            memberCount: 600,
            isAdmin: false,
          },
        ],
      };
    return undefined;
  };
}

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

function renderWindow(address = READER) {
  const store = createStore();
  store.set(userInfoAtom, { address, name: 'Reader' } as never);
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

const dialog = () => screen.getAllByRole('dialog')[0];
const T = { timeout: 4000 };
/** Text as read, without the marks that keep a name apart from the words around it. */
const plain = (text: string | null | undefined) =>
  String(text ?? '').replace(/[⁨⁩]/g, '');

async function openPublisher(
  level = 5,
  node: Node = { rows: story() },
  address = READER
) {
  routes.push(
    viewer(level, address),
    publisherNode(node),
    quietAccount(SECOND, 'Second'),
    quietAccount(ADMIN, 'Admin')
  );
  const store = renderWindow(address);
  await lookUp(PUBLISHER);
  await within(dialog()).findByRole('heading', { level: 2, name: 'Publisher' });
  return store;
}

const activity = () =>
  within(dialog()).findByRole('region', { name: /^activity$/i }, T);

async function milestones(region: HTMLElement): Promise<string[]> {
  const list = await within(region).findByRole(
    'list',
    { name: /milestones/i },
    T
  );
  return within(list)
    .getAllByRole('listitem')
    .map((item) =>
      plain(item.textContent).replace(
        /(\d{1,2} [A-Z][a-z]{2} \d{4}|[A-Z][a-z]{2} \d{1,2}, \d{4})$/,
        ''
      )
    );
}

const chart = (region: HTMLElement) =>
  within(region).getByRole('group', {
    name: /activity of publisher over time/i,
  });

/** How the chart marks the period picked (its bar's ground). */
const PICKED = alpha(darkTheme.palette.primary.main, 0.18);
const markedPeriods = (region: HTMLElement) =>
  chart(region).querySelectorAll(`svg rect[fill="${PICKED}"]`).length;

/** What the keys moved to, as read out. */
const readOut = (region: HTMLElement) =>
  within(chart(region).parentElement as HTMLElement).getByRole('status')
    .textContent ?? '';

/** "Now": the clock the chart ends by. */
let now = 0;

beforeEach(() => {
  routes = [];
  calls = [];
  n = 0;
  window.localStorage.clear();
  stubNode();
  // "Now" is a minute after its newest transaction: the chart ends there.
  now = BLOCK_TIME(NEWEST) + 60_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Activity chart', () => {
  it('draws its transactions by family over time, with its milestones from Core’s own facts', async () => {
    await openPublisher();
    const region = await activity();
    expect(await milestones(region)).toEqual([
      'First reward share (sponsorship era)',
      'Registered the name “Example”',
      'Sold the name “Sold”',
      'Got a minting level',
      'Asked to join MINTER',
      'Added to MINTER: its request to join was approved',
    ]);
    const svg = chart(region).querySelector('svg') as SVGElement;
    for (const family of ['payments', 'qdn', 'groups', 'minting', 'names'])
      expect(svg.querySelector(`rect[data-family="${family}"]`)).not.toBeNull();
    // Its whole history is read: nothing hatched, and it says so.
    expect(svg.querySelector('[data-unread]')).toBeNull();
    expect(
      within(region).getByText(
        /All 11 of its transactions, back to its first on/
      )
    ).toBeInTheDocument();
    // The approved invite took effect at its approval's block: its time was read.
    expect(
      calls.some(({ path }) => path === `/blocks/byheight/${APPROVED_AT}`)
    ).toBe(true);
    // Its first reward share, read on its own: one row, oldest first.
    const share = calls.filter(({ path }) => {
      const query = params(path);
      return (
        query.getAll('txType').join() === 'REWARD_SHARE' &&
        query.get('address') === PUBLISHER
      );
    });
    expect(share).toHaveLength(1);
    expect(params(share[0].path).get('limit')).toBe('1');
    expect(params(share[0].path).get('reverse')).toBe('false');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('says its periods in a table a screen reader gets', async () => {
    await openPublisher();
    const region = await activity();
    const table = await within(region).findByRole('table', {
      name: /its transactions in each period/i,
    });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.lastElementChild?.textContent);
    expect(cells).toHaveLength(11);
    expect(cells).toContain('1 transaction: payments 1');
  });

  it('hides that table in a 1 px box, so it never widens a narrow window, and a screen reader still reads all of it', async () => {
    await openPublisher();
    const region = await activity();
    const table = await within(region).findByRole('table', {
      name: /its transactions in each period/i,
    });
    // A table can't be squeezed to 1 px: hidden itself, it would still be
    // laid out at its full width. The box around it is hidden instead.
    const box = table.parentElement as HTMLElement;
    const boxStyle = getComputedStyle(box);
    expect({
      position: boxStyle.position,
      width: boxStyle.width,
      height: boxStyle.height,
      overflow: boxStyle.overflow,
    }).toEqual({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    });
    expect(box).not.toHaveAttribute('role');
    expect(box.children).toHaveLength(1);
    expect(getComputedStyle(table).position).not.toBe('absolute');
    expect(getComputedStyle(table).width).not.toBe('1px');
    // All of it is still there: its caption, its headers and every period.
    expect(table.querySelector('caption')).toHaveTextContent(
      'Its transactions in each period'
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Period', 'Transactions']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(12);
    expect(
      rows.slice(1).map((row) => row.lastElementChild?.textContent)
    ).toContain('1 transaction: payments 1');
  });

  it('hides a family from the legend, and the step keeps it through Back and Forward', async () => {
    await openPublisher();
    const region = await activity();
    const legend = within(region).getByRole('list', {
      name: /kinds of transactions/i,
    });
    const payments = within(legend).getByRole('button', {
      name: /payments\s*4/i,
    });
    fireEvent.click(payments);
    expect(payments).toHaveAttribute('aria-pressed', 'false');
    const svg = () => chart(region).querySelector('svg') as SVGElement;
    expect(svg().querySelector('rect[data-family="payments"]')).toBeNull();
    expect(svg().querySelector('rect[data-family="names"]')).not.toBeNull();

    // Another account, then Back: the family is still hidden.
    await lookUp(SECOND);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await activity();
    expect(
      within(
        within(again).getByRole('list', { name: /kinds of transactions/i })
      ).getByRole('button', { name: /payments\s*4/i })
    ).toHaveAttribute('aria-pressed', 'false');
    // Forward to Second and Back again: as left.
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^forward$/i })
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const third = await activity();
    expect(
      chart(third)
        .querySelector('svg')
        ?.querySelector('rect[data-family="payments"]')
    ).toBeNull();
  });

  it('picks a period with the keys, lists its transactions (one opening as in the Transactions tab), and the step keeps it', async () => {
    await openPublisher();
    const region = await activity();
    const group = chart(region);
    group.focus();
    fireEvent.keyDown(group, { key: 'End' });
    // The period the keys moved to is read out.
    expect(
      within(region)
        .getAllByRole('status')
        .some((status) =>
          /: 1 transaction: payments 1$/.test(status.textContent ?? '')
        )
    ).toBe(true);
    fireEvent.keyDown(group, { key: 'Enter' });
    // Exactly one: "1 transaction", not "1 transactions".
    const title = await within(region).findByRole('heading', {
      level: 4,
      name: /^1 transaction · /,
    });
    expect(title).toBeInTheDocument();
    const list = within(region).getByRole('list', { name: /^transactions, /i });
    const row = await within(list).findByRole('button', {
      name: /Received 1 QORT from Second/,
    });
    fireEvent.click(row);
    expect(
      await within(list).findByRole('button', { name: /open transaction/i })
    ).toBeInTheDocument();

    await lookUp(SECOND);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await activity();
    expect(
      await within(again).findByRole('heading', {
        level: 4,
        name: /^1 transaction · /,
      })
    ).toBeInTheDocument();
    fireEvent.click(
      within(again).getByRole('button', { name: /close the list/i })
    );
    expect(
      within(again).queryByRole('heading', { level: 4, name: /transaction · / })
    ).toBeNull();
  });

  it('opens the transaction a milestone marks', async () => {
    const rows = story();
    await openPublisher(5, { rows });
    const region = await activity();
    const list = await within(region).findByRole(
      'list',
      { name: /milestones/i },
      T
    );
    const registered = within(list)
      .getAllByRole('button')
      .find((button) =>
        plain(button.textContent).startsWith('Registered the name')
      );
    fireEvent.click(registered as HTMLElement);
    const row = rows.find((each) => each.type === 'REGISTER_NAME') as Row;
    await waitFor(() =>
      expect(
        calls.some(
          ({ path }) => path === `/transactions/signature/${row.signature}`
        )
      ).toBe(true)
    );
  });

  it('says when a milestone’s time couldn’t be read, with Retry', async () => {
    const node: Node = { rows: story(), blockFails: { on: true } };
    await openPublisher(5, node);
    const region = await activity();
    expect(
      await within(region).findByText(
        /couldn't read when some of its milestones happened/i,
        {},
        T
      )
    ).toBeInTheDocument();
    expect(await milestones(region)).not.toContain(
      'Added to MINTER: its request to join was approved'
    );
    node.blockFails = { on: false };
    fireEvent.click(within(region).getByRole('button', { name: /retry/i }));
    await waitFor(async () =>
      expect(await milestones(region)).toContain(
        'Added to MINTER: its request to join was approved'
      )
    );
  });

  it('says what isn’t read yet and hatches it, and Read older reads on', async () => {
    const rows = [
      ...Array.from({ length: 1240 }, (_, i) =>
        tx('PAYMENT', NEWEST - i, {
          creatorAddress: SECOND,
          recipient: PUBLISHER,
          amount: '1.00000000',
        })
      ),
      ...story().slice(-10),
    ];
    await openPublisher(5, { rows });
    const region = await activity();
    expect(
      await within(region).findByText(
        /Its newest 1,000 transactions, back to .*; its history goes back to .*\. Older ones aren't read yet \(the hatched part\)\./,
        {},
        { timeout: 15_000 }
      )
    ).toBeInTheDocument();
    const svg = chart(region).querySelector('svg') as SVGElement;
    expect(svg.querySelector('[data-unread]')).not.toBeNull();
    const table = within(region).getByRole('table', { hidden: true });
    expect(table).toHaveTextContent(/not read yet/i);
    fireEvent.click(
      within(region).getByRole('button', { name: /read 1,000 older/i })
    );
    expect(
      await within(region).findByText(
        /All 1,250 of its transactions, back to its first on/,
        {},
        { timeout: 15_000 }
      )
    ).toBeInTheDocument();
    expect(allListReads()).toEqual(
      Array.from({ length: 13 }, (_, i) => i * 100)
    );
    expect(
      chart(region).querySelector('svg')?.querySelector('[data-unread]')
    ).toBeNull();
  }, 30_000);

  it('shows full screen in a dialog, as tall as the screen allows', async () => {
    await openPublisher();
    const region = await activity();
    fireEvent.click(
      within(region).getByRole('button', { name: /full screen/i })
    );
    const full = await screen.findByRole('dialog', {
      name: /activity: publisher/i,
    });
    const svg = within(full)
      .getByRole('group', { name: /activity of publisher over time/i })
      .querySelector('svg') as SVGElement;
    // Its bars are drawn taller than the 160 px inline.
    const [, , , tall] = (svg.getAttribute('viewBox') ?? '').split(' ');
    expect(Number(tall)).toBeGreaterThan(160);
    fireEvent.click(within(full).getByRole('button', { name: /^close$/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /activity: publisher/i })
      ).toBeNull()
    );
    const inline = chart(region).querySelector('svg') as SVGElement;
    expect(inline.getAttribute('viewBox')).toMatch(/ 160$/);
  });
});

describe('a period picked on the Activity chart', () => {
  it('stays marked when the step comes back a few minutes later, and the keys go on from it', async () => {
    await openPublisher();
    const region = await activity();
    const group = chart(region);
    group.focus();
    fireEvent.keyDown(group, { key: 'End' });
    // Back from the newest to the period of its QDN publish, a month before.
    for (
      let i = 0;
      i < 48 && !/: 1 transaction: QDN data 1$/.test(readOut(region));
      i++
    )
      fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(readOut(region)).toMatch(/: 1 transaction: QDN data 1$/);
    fireEvent.keyDown(group, { key: 'Enter' });
    await within(region).findByRole('heading', {
      level: 4,
      name: /^1 transaction · /,
    });
    expect(markedPeriods(region)).toBe(1);

    // Another account, a few minutes on, then Back: the step keeps the period.
    await lookUp(SECOND);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    now += 5 * 60_000;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const again = await activity();
    expect(
      await within(again).findByRole('heading', {
        level: 4,
        name: /^1 transaction · /,
      })
    ).toBeInTheDocument();
    // The chart still marks which period the list under it is.
    expect(markedPeriods(again)).toBe(1);
    // The keys start from it: one back and one on is the period picked.
    const keys = chart(again);
    keys.focus();
    fireEvent.keyDown(keys, { key: 'ArrowLeft' });
    fireEvent.keyDown(keys, { key: 'ArrowRight' });
    expect(readOut(again)).toMatch(/: 1 transaction: QDN data 1$/);
  });

  it('picked a minute or more after the chart was drawn, is marked as the one listed', async () => {
    await openPublisher();
    const region = await activity();
    // Everything is read; the viewer looks at the chart for two minutes,
    // then picks its newest period with the keys.
    now += 2 * 60_000;
    const group = chart(region);
    group.focus();
    fireEvent.keyDown(group, { key: 'End' });
    fireEvent.keyDown(group, { key: 'Enter' });
    await within(region).findByRole('heading', {
      level: 4,
      name: /^1 transaction · /,
    });
    expect(markedPeriods(region)).toBe(1);
  });
});

describe('a period only partly read', () => {
  // 150 payments: the newest 100 a minute apart (all the Overview reads,
  // with "transactions read at first" at 100), then 50 older ones half a
  // minute apart. The chart's 48 periods (jsdom draws it 0 px wide) are
  // 2 min 36.25 s each from its first one on, so the period holding the
  // oldest payment read (the tenth) also holds three older ones not read yet.
  const partlyRead = async () => {
    const top = BLOCK_TIME(NEWEST);
    const pay = (at: number, height: number) =>
      tx('PAYMENT', height, {
        timestamp: at,
        creatorAddress: SECOND,
        recipient: PUBLISHER,
        amount: '1.00000000',
      });
    const rows = [
      ...Array.from({ length: 100 }, (_, i) =>
        pay(top - i * 60_000, NEWEST - i)
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        pay(top - 99 * 60_000 - (i + 1) * 30_000, NEWEST - 100 - i)
      ),
    ];
    now = top + 30_000;
    window.localStorage.setItem(firstReadKey(READER), '100');
    await openPublisher(5, { rows });
    const region = await activity();
    await within(region).findByText(/Its newest 100 transactions/, {}, T);
    return region;
  };

  it('isn’t counted as if all of it were read: the table, the bar and the period listed say so', async () => {
    const region = await partlyRead();
    const table = within(region).getByRole('table', { hidden: true });
    const counted = within(table)
      .getAllByRole('row', { hidden: true })
      .slice(1)
      .map((row) => row.lastElementChild?.textContent ?? '')
      .filter((cell) => !/not read yet/i.test(cell));
    // The node has 5 payments in that period (2 read, 3 not read yet).
    expect(counted[0]).toBe('2 transactions: payments 2 (partly read)');
    expect(counted.slice(1).every((cell) => !/partly/.test(cell))).toBe(true);
    // Its bar is drawn, hatched behind.
    const svg = chart(region).querySelector('svg') as SVGElement;
    const bar = svg.querySelectorAll('g')[9];
    expect(bar).toHaveAttribute('data-partial');
    expect(bar.querySelector('rect[data-family="payments"]')).not.toBeNull();
    expect(bar.querySelector('rect[fill^="url(#"]')).not.toBeNull();
    expect(svg.querySelectorAll('g[data-partial]')).toHaveLength(1);
    // Read out from the keys, and listed when picked.
    const group = chart(region);
    group.focus();
    fireEvent.keyDown(group, { key: 'Home' });
    for (let i = 0; i < 9; i++) fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(readOut(region)).toMatch(
      /: 2 transactions: payments 2 \(partly read\)$/
    );
    fireEvent.keyDown(group, { key: 'Enter' });
    await within(region).findByRole('heading', {
      level: 4,
      name: /^2 transactions · /,
    });
    expect(
      within(region).getByText(
        /^Partly read: older transactions of this period aren't read yet\.$/
      )
    ).toBeInTheDocument();
  });

  it('says so in the card the pointer shows', async () => {
    const region = await partlyRead();
    const group = chart(region);
    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 480,
      bottom: 160,
      width: 480,
      height: 160,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    // The tenth of 48 periods, 480 px wide.
    act(() => {
      group.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 95 })
      );
    });
    const card = region.querySelector('[data-hover-card]') as HTMLElement;
    expect(card).toHaveTextContent(/2 transactions/);
    expect(card).toHaveTextContent(
      /Partly read: older transactions of this period aren't read yet\./
    );
    // A period wholly read says no such thing.
    act(() => {
      group.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 475 })
      );
    });
    expect(region.querySelector('[data-hover-card]')).not.toHaveTextContent(
      /partly read/i
    );
  });
});

describe('the milestones', () => {
  it('list its first reward share when it lies before the stretch drawn', async () => {
    // Its newest 1,000 are payments of the last day; its first reward share
    // is months older, before the part drawn.
    const rows = [
      ...Array.from({ length: 1240 }, (_, i) =>
        tx('PAYMENT', NEWEST - i, {
          creatorAddress: SECOND,
          recipient: PUBLISHER,
          amount: '1.00000000',
        })
      ),
      ...story().slice(-10),
    ];
    await openPublisher(5, { rows });
    const region = await activity();
    await within(region).findByText(
      /Its newest 1,000 transactions/,
      {},
      { timeout: 15_000 }
    );
    expect(await milestones(region)).toEqual([
      'First reward share (sponsorship era)',
    ]);
    // On the chart, only what lies within it: no flag for it.
    expect(region.querySelectorAll('[data-mark]')).toHaveLength(0);
  }, 30_000);
});

describe('full screen', () => {
  it('follows the window as it is resized', async () => {
    const height = window.innerHeight;
    const resize = (to: number) =>
      act(() => {
        Object.defineProperty(window, 'innerHeight', {
          configurable: true,
          value: to,
        });
        window.dispatchEvent(new Event('resize'));
      });
    try {
      await openPublisher();
      const region = await activity();
      fireEvent.click(
        within(region).getByRole('button', { name: /full screen/i })
      );
      const full = await screen.findByRole('dialog', {
        name: /activity: publisher/i,
      });
      const drawn = () =>
        Number(
          (
            within(full)
              .getByRole('group', { name: /activity of publisher over time/i })
              .querySelector('svg')
              ?.getAttribute('viewBox') ?? ''
          ).split(' ')[3]
        );
      resize(1000);
      expect(drawn()).toBe(640);
      resize(700);
      expect(drawn()).toBe(340);
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: height,
      });
    }
  });
});

describe('the Activity settings', () => {
  it('are a row of the settings for a viewer who sees the detailed parts only', async () => {
    await openPublisher(4);
    await waitFor(() =>
      expect(
        calls.some(({ path }) => path.startsWith('/groups/members/1?'))
      ).toBe(true)
    );
    expect(
      within(dialog()).queryByRole('region', { name: /^activity$/i })
    ).toBeNull();
    expect(
      calls.some(
        ({ path }) =>
          params(path).getAll('txType').join() === 'REWARD_SHARE' ||
          path === `/blocks/byheight/${APPROVED_AT}`
      )
    ).toBe(false);
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /explorer settings/i })
    );
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /activity settings/i })
    ).toBeNull();
  });

  it('hide kinds of milestones, kept for this Hub account on this device', async () => {
    await openPublisher();
    const region = await activity();
    await milestones(region);
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /explorer settings/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /activity settings/i })
    );
    const settings = await screen.findByRole('dialog', {
      name: /activity settings/i,
    });
    fireEvent.click(
      within(settings).getByRole('checkbox', {
        name: /names registered, bought, sold or renamed/i,
      })
    );
    fireEvent.click(within(settings).getByRole('button', { name: /^done$/i }));
    await waitFor(async () =>
      expect(await milestones(region)).toEqual([
        'First reward share (sponsorship era)',
        'Got a minting level',
        'Asked to join MINTER',
        'Added to MINTER: its request to join was approved',
      ])
    );
    expect(
      JSON.parse(window.localStorage.getItem(hiddenMarksKey(READER)) ?? '[]')
    ).toEqual(['name']);
    expect(window.localStorage.getItem(hiddenMarksKey(READER_TWO))).toBeNull();
  });

  it('read as many at first as picked, and Read older reads as many more', async () => {
    window.localStorage.setItem(firstReadKey(READER), '200');
    const rows = Array.from({ length: 450 }, (_, i) =>
      tx('PAYMENT', NEWEST - i, {
        creatorAddress: SECOND,
        recipient: PUBLISHER,
        amount: '1.00000000',
      })
    );
    await openPublisher(5, { rows });
    const region = await activity();
    expect(
      await within(region).findByText(/Its newest 200 transactions/, {}, T)
    ).toBeInTheDocument();
    expect(allListReads()).toEqual([0, 100]);
    fireEvent.click(
      within(region).getByRole('button', { name: /read 200 older/i })
    );
    expect(
      await within(region).findByText(/Its newest 400 transactions/, {}, T)
    ).toBeInTheDocument();
    expect(allListReads()).toEqual([0, 100, 200, 300]);
  });

  it('work for this window where storage can’t be used', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await openPublisher();
    const region = await activity();
    await milestones(region);
    fireEvent.click(
      within(region).getByRole('button', { name: /^activity settings$/i })
    );
    const settings = await screen.findByRole('dialog', {
      name: /activity settings/i,
    });
    fireEvent.click(
      within(settings).getByRole('checkbox', {
        name: /minting: its first reward share/i,
      })
    );
    fireEvent.click(within(settings).getByRole('button', { name: /^done$/i }));
    await waitFor(async () =>
      expect(await milestones(region)).not.toContain('Got a minting level')
    );
  });
});
