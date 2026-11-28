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
import Base58Module from '../../encryption/Base58';
import { darkTheme } from '../../styles/theme-dark';
import { KNOWN_EXCHANGES } from '../../lib/explorer/exchanges';
import { NULL_ACCOUNT } from '../../lib/explorer/reads';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The level 5+ rule and the parts it lets in (the Connections tab, the
// Overview's Direct links, exchanges named), in the window as App mounts
// it, for each kind of Hub account, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const VIEWER_TWO = `Q${'V'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const THIRD = `Q${'T'.repeat(33)}`;
const SPONSOR = `Q${'N'.repeat(33)}`;
const FUNDER = `Q${'F'.repeat(33)}`;
const SIBLING = `Q${'G'.repeat(33)}`;
const AT_ADDR = `A${'X'.repeat(33)}`;
/** An exchange's deposit account, as the Explorer knows it. */
const EXCHANGE = Object.keys(KNOWN_EXCHANGES)[0];
const EXCHANGE_NAME = KNOWN_EXCHANGES[EXCHANGE];
const PUBLIC_KEY = 'k'.repeat(44);
const PUBLISHER_KEY = 'p'.repeat(44);

const Base58 = Base58Module as unknown as {
  decode(text: string): Uint8Array;
  encode(bytes: Uint8Array): string;
};

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

let signatures = 0;
function tx(type: string, height: number, extra: Row = {}): Row {
  signatures += 1;
  return {
    type,
    timestamp: BLOCK_TIME(height),
    signature: sig(signatures),
    fee: '0.01000000',
    txGroupId: 0,
    blockHeight: height,
    approvalStatus: 'NOT_REQUIRED',
    ...extra,
  };
}
const share = (from: string, to: string, height: number, percent = '0.00') =>
  tx('REWARD_SHARE', height, {
    creatorAddress: from,
    recipient: to,
    sharePercent: percent,
  });
const pay = (from: string, to: string, height: number, amount: string) =>
  tx('PAYMENT', height, { creatorAddress: from, recipient: to, amount });

const PAYMENT_KIND = ['MULTI_PAYMENT', 'PAYMENT', 'TRANSFER_ASSET'];
const MINTING_KIND = [
  'ACCOUNT_FLAGS',
  'ACCOUNT_LEVEL',
  'ENABLE_FORGING',
  'REWARD_SHARE',
  'TRANSFER_PRIVS',
];
const NAMES_KIND = [
  'BUY_NAME',
  'CANCEL_SELL_NAME',
  'REGISTER_NAME',
  'SELL_NAME',
  'UPDATE_NAME',
];

/** A list read of the Transactions tab's kinds (100 a page), by its types. */
const listTypes = (path: string, address: string): string | null => {
  if (!path.startsWith('/transactions/search?')) return null;
  const query = params(path);
  if (query.get('address') !== address || query.get('limit') !== '100')
    return null;
  return query.getAll('txType').sort().join(',');
};

/** `address`'s list of `types` (100 a page): `rows`, or what `answer` says for an offset. */
function list(
  address: string,
  types: readonly string[],
  rows: Row[] | ((offset: number) => Answer)
): Route {
  const want = [...types].sort().join(',');
  return (path) => {
    if (listTypes(path, address) !== want) return undefined;
    const offset = Number(params(path).get('offset') ?? 0);
    return typeof rows === 'function'
      ? rows(offset)
      : { body: rows.slice(offset, offset + 100) };
  };
}

function account(address: string, extra: Row = {}) {
  return {
    address,
    reference: 'ref',
    publicKey: PUBLIC_KEY,
    level: 3,
    blocksMinted: 250_000,
    blocksMintedAdjustment: 0,
    blocksMintedPenalty: 0,
    ...extra,
  };
}

/** What every account page reads, for `address`. */
function quietAccount(
  address: string,
  name: string | null,
  extra: Row = {}
): Route {
  return (path) => {
    if (path === `/addresses/${address}`)
      return { body: account(address, extra) };
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
  devAdmin?: boolean;
  /** Its groups (or its level) can't be read. */
  failing?: 'groups' | 'level';
  /** Holds its group read back until let go. */
  hold?: Promise<void>;
}

/** The Hub account looking: its level, its groups, and the Dev Admins. */
function viewer(persona: Persona, address = READER): Route {
  return (path) => {
    if (path === `/addresses/${address}`)
      return persona.failing === 'level'
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : { body: account(address, { level: persona.level }) };
    if (path === `/groups/member/${address}`)
      return persona.failing === 'groups'
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : {
            body: persona.minter
              ? [minterGroup(persona.minter === 'admin')]
              : [],
            delay: persona.hold,
          };
    if (path.startsWith('/groups/members/1?') && persona.devAdmin)
      return { body: { members: [{ member: address, isAdmin: true }] } };
    return undefined;
  };
}

const LEVEL_FIVE: Persona = { level: 5, minter: 'member' };
const LEVEL_FOUR: Persona = { level: 4, minter: 'member' };

/** A TRANSFER_PRIVS's raw bytes, in base58, moving the level to `recipient`. */
function privsBytes(recipient: string): string {
  const bytes = new Uint8Array(137 + 64);
  new DataView(bytes.buffer).setInt32(0, 40);
  const address = Base58.decode(recipient);
  expect(address).toHaveLength(25);
  bytes.set(address, 112);
  return Base58.encode(bytes);
}

// ---- Publisher's links -------------------------------------------------------------------

const SPONSOR_SHARE = share(SPONSOR, PUBLISHER, 1_371_641);
const SPONSOR_REMOVED = share(SPONSOR, PUBLISHER, 1_378_875, '-1.00');
const SHARE_TO_SECOND = share(PUBLISHER, SECOND, 1_400_000, '5.00');
const LEVEL_TO_THIRD = tx('TRANSFER_PRIVS', 1_390_000, {
  creatorAddress: PUBLISHER,
});
const NAME_BOUGHT = tx('BUY_NAME', 1_395_000, {
  creatorAddress: PUBLISHER,
  seller: SECOND,
  name: 'Spare Room',
  amount: '5.00000000',
});
const PAID = [
  pay(PUBLISHER, SECOND, 1_500_000, '10'),
  pay(PUBLISHER, SECOND, 1_500_100, '2.5'),
  pay(PUBLISHER, SECOND, 1_500_200, '0.5'),
  pay(SECOND, PUBLISHER, 1_500_300, '7'),
  pay(PUBLISHER, EXCHANGE, 1_500_400, '100'),
  pay(PUBLISHER, AT_ADDR, 1_500_500, '1'),
].reverse();
const OWN_FIRST = tx('PAYMENT', 1_000_100, {
  creatorAddress: PUBLISHER,
  recipient: SECOND,
  amount: '1',
  reference: sig(9_000),
});
/** Publisher's filled Q-Asset order, and Second's order that filled it. */
const MY_ORDER = tx('CREATE_ASSET_ORDER', 1_600_000, {
  creatorAddress: PUBLISHER,
  haveAssetId: 0,
  wantAssetId: 28,
  amount: '23.00000000',
  price: '23.00000000',
});
const THEIR_ORDER = tx('CREATE_ASSET_ORDER', 1_599_000, {
  creatorAddress: SECOND,
  haveAssetId: 28,
  wantAssetId: 0,
  amount: '23.00000000',
  price: '23.00000000',
});
const FUNDED = {
  ...tx('PAYMENT', 1_000_050, {
    creatorAddress: FUNDER,
    recipient: PUBLISHER,
    amount: '50',
  }),
  signature: sig(9_000),
};

/** Publisher's lists and what Connections reads about it. */
function publisherNode({
  payments = PAID as Row[] | ((offset: number) => Answer),
  minting = [
    SHARE_TO_SECOND,
    LEVEL_TO_THIRD,
    SPONSOR_REMOVED,
    SPONSOR_SHARE,
  ] as Row[] | ((offset: number) => Answer),
  names = [NAME_BOUGHT] as Row[] | ((offset: number) => Answer),
  orders = true,
  moreFilled = 0,
  online,
}: {
  payments?: Row[] | ((offset: number) => Answer);
  minting?: Row[] | ((offset: number) => Answer);
  names?: Row[] | ((offset: number) => Answer);
  /** It has a filled Q-Asset order (a trade with Second). */
  orders?: boolean;
  /** Older filled orders, each one trade with Second's order. */
  moreFilled?: number;
  /** The online list's answer (else Publisher mints with Second now). */
  online?: Answer;
} = {}): Route[] {
  const filled = [
    {
      orderId: MY_ORDER.signature,
      creator: PUBLISHER,
      fulfilled: '23.00000000',
      timestamp: MY_ORDER.timestamp,
    },
    ...Array.from({ length: moreFilled }, (_, i) => ({
      orderId: sig(20_000 + i),
      creator: PUBLISHER,
      fulfilled: '1.00000000',
      timestamp: (MY_ORDER.timestamp as number) - (i + 1) * 60_000,
    })),
  ];
  return [
    // Every transaction it took part in: the Transactions tab's All.
    list(PUBLISHER, [], [...PAID, NAME_BOUGHT, SHARE_TO_SECOND]),
    list(PUBLISHER, PAYMENT_KIND, payments),
    list(PUBLISHER, MINTING_KIND, minting),
    list(PUBLISHER, NAMES_KIND, names),
    list(PUBLISHER, ['TRANSFER_PRIVS'], [LEVEL_TO_THIRD]),
    // Its sponsor's own reward shares: to it and to one more account.
    list(SPONSOR, MINTING_KIND, [
      share(SPONSOR, SIBLING, 1_372_000),
      SPONSOR_SHARE,
    ]),
    (path) => {
      if (path.startsWith(`/assets/orders/${PUBLISHER}?`)) {
        const query = params(path);
        const offset = Number(query.get('offset') ?? 0);
        return {
          body:
            orders &&
            query.get('includeClosed') === 'true' &&
            query.get('includeFulfilled') === 'true'
              ? filled.slice(offset, offset + 100)
              : [],
        };
      }
      if (path.startsWith(`/assets/order/${MY_ORDER.signature}/trades?`))
        return {
          body: [
            {
              initiatingOrderId: MY_ORDER.signature,
              targetOrderId: THEIR_ORDER.signature,
              initiatorAmount: '529.00000000',
              initiatorAmountAssetId: 0,
              initiatorAmountAssetName: 'QORT',
              targetAmount: '23.00000000',
              targetAmountAssetId: 28,
              targetAmountAssetName: 'GBQ',
              timestamp: MY_ORDER.timestamp,
            },
          ],
        };
      // Each older filled order: one trade, with Second's order.
      const older = /^\/assets\/order\/([^/]+)\/trades\?/.exec(path);
      if (older && decodeURIComponent(older[1]) !== MY_ORDER.signature)
        return {
          body: [
            {
              initiatingOrderId: decodeURIComponent(older[1]),
              targetOrderId: THEIR_ORDER.signature,
              initiatorAmount: '1.00000000',
              initiatorAmountAssetId: 0,
              initiatorAmountAssetName: 'QORT',
              targetAmount: '1.00000000',
              targetAmountAssetId: 28,
              targetAmountAssetName: 'GBQ',
              timestamp: (MY_ORDER.timestamp as number) - 60_000,
            },
          ],
        };
      if (path === `/assets/order/${THEIR_ORDER.signature}`)
        return { body: { orderId: THEIR_ORDER.signature, creator: SECOND } };
      if (path === `/transactions/signature/${MY_ORDER.signature}`)
        return { body: MY_ORDER };
      if (path === `/transactions/signature/${THEIR_ORDER.signature}`)
        return { body: THEIR_ORDER };
      if (path === `/transactions/signature/${LEVEL_TO_THIRD.signature}/raw`)
        return { body: privsBytes(THIRD) };
      if (
        path.startsWith(`/transactions/creator/${PUBLISHER_KEY}?`) &&
        params(path).get('reverse') === 'false'
      )
        return { body: [OWN_FIRST] };
      if (path === `/transactions/signature/${sig(9_000)}`)
        return { body: FUNDED };
      if (path.startsWith('/transactions/payments/between?')) {
        const query = params(path);
        if (
          query.get('senderAddress') === PUBLISHER &&
          query.get('recipientAddress') === EXCHANGE
        )
          return { body: query.get('offset') === '0' ? [PAID[1]] : [] };
        return { body: [] };
      }
      if (path === '/addresses/online')
        return (
          online ?? {
            body: [{ minterAddress: PUBLISHER, recipientAddress: SECOND }],
          }
        );
      return undefined;
    },
    quietAccount(PUBLISHER, 'Publisher', { publicKey: PUBLISHER_KEY }),
    quietAccount(SECOND, 'Second'),
    quietAccount(THIRD, 'Third', { level: 0 }),
    quietAccount(SPONSOR, 'Sponsor'),
    quietAccount(FUNDER, 'Funder'),
    quietAccount(SIBLING, 'Sibling'),
    quietAccount(EXCHANGE, null),
  ];
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
    <>
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

function renderWindow(address: string | null = READER) {
  const store = createStore();
  if (address) store.set(userInfoAtom, { address, name: 'Reader' } as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
  return store;
}

const lookUp = (addressOrName?: string, extra: Row = {}) =>
  act(() => {
    executeEvent(
      'openUserLookupDrawer',
      addressOrName ? { addressOrName, ...extra } : {}
    );
  });

const dialog = () => screen.getByRole('dialog');
const T = { timeout: 3000 };

/** The tab names of the account on screen, once its header is in. */
async function tabNames() {
  const bar = await within(dialog()).findByRole('tablist', {
    name: /account sections/i,
  });
  return within(bar)
    .getAllByRole('tab')
    .map((tab) => tab.textContent);
}

async function openPublisher(persona: Persona | null, viewerAddress = READER) {
  routes.push(
    ...(persona ? [viewer(persona, viewerAddress)] : []),
    ...publisherNode()
  );
  const store = renderWindow(viewerAddress);
  await lookUp(PUBLISHER);
  await within(dialog()).findByRole('heading', { level: 2, name: 'Publisher' });
  return store;
}

/** Opens the Connections tab, once the rule lets it show. */
async function openConnections() {
  const tab = await within(dialog()).findByRole(
    'tab',
    { name: /^connections$/i },
    T
  );
  fireEvent.click(tab);
  const panel = await within(dialog()).findByRole('tabpanel', {
    name: /connections/i,
  });
  // It opens as a circle (ExplorerWindow.circle.test.tsx): these are the list's.
  fireEvent.click(within(panel).getByRole('button', { name: /^list$/i }));
  return panel;
}

/** Reads only the detailed parts make. */
const detailedReads = () =>
  calls.filter(({ path }) => {
    const types = listTypes(path, PUBLISHER) ?? listTypes(path, SPONSOR);
    return (
      path.startsWith('/transactions/payments/between') ||
      path.startsWith('/addresses/sponsorship') ||
      path.startsWith('/assets/') ||
      path.endsWith('/raw') ||
      (types !== null &&
        ['REWARD_SHARE', 'TRANSFER_PRIVS', 'BUY_NAME', 'TRANSFER_ASSET'].some(
          (type) => types.split(',').includes(type)
        )) ||
      (path.startsWith('/transactions/creator/') &&
        params(path).get('reverse') === 'false')
    );
  });

const accessReads = (address = READER) =>
  calls.filter(
    ({ path }) =>
      path === `/addresses/${address}` || path === `/groups/member/${address}`
  );

/** An answer held back until it is let go. */
function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
}

/** Hub's own toggle (the title bar's): closes the window, waits for it to go, opens it again. */
async function closeAndReopen(between?: () => void) {
  fireEvent.click(screen.getByText('hub toggle'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  between?.();
  fireEvent.click(screen.getByText('hub toggle'));
  await screen.findByRole('dialog');
}

/** Lets the reads on their way settle. */
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

describe('who sees the detailed parts', () => {
  it('a MINTER member at level 5: Connections and the Overview’s Direct links', async () => {
    await openPublisher(LEVEL_FIVE);
    await waitFor(
      async () =>
        expect(await tabNames()).toEqual([
          'Overview',
          'Connections',
          'Transactions',
          'Names',
        ]),
      T
    );
    expect(
      await within(dialog()).findByRole('region', { name: /direct links/i })
    ).toBeInTheDocument();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('a MINTER member at level 4: neither, nothing of them read, nothing said', async () => {
    await openPublisher(LEVEL_FOUR);
    // The rule is read, then the Dev Admins decide (it isn't one).
    await waitFor(() =>
      expect(
        calls.some(({ path }) => path.startsWith('/groups/members/1?'))
      ).toBe(true)
    );
    await settle();
    expect(await tabNames()).toEqual(['Overview', 'Transactions', 'Names']);
    expect(
      within(dialog()).queryByRole('region', { name: /direct links/i })
    ).toBeNull();
    expect(dialog()).not.toHaveTextContent(
      /connections|direct links|hidden|level 5/i
    );
    expect(detailedReads()).toEqual([]);
  });

  it('a Minter Admin at level 1 sees them', async () => {
    await openPublisher({ level: 1, minter: 'admin' });
    await waitFor(
      async () => expect(await tabNames()).toContain('Connections'),
      T
    );
  });

  it('a Dev Admin outside MINTER sees them; the Dev Admins are read once', async () => {
    await openPublisher({ level: 0, minter: null, devAdmin: true });
    await waitFor(
      async () => expect(await tabNames()).toContain('Connections'),
      T
    );
    expect(
      calls.filter(({ path }) => path.startsWith('/groups/members/1?'))
    ).toHaveLength(1);
  });

  it('a level 7 account outside MINTER, not a Dev Admin, doesn’t', async () => {
    await openPublisher({ level: 7, minter: null });
    await settle();
    expect(await tabNames()).not.toContain('Connections');
    expect(detailedReads()).toEqual([]);
  });

  it('no one signed in: neither, and the rule reads nothing', async () => {
    routes.push(...publisherNode());
    renderWindow(null);
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await settle();
    expect(await tabNames()).not.toContain('Connections');
    expect(detailedReads()).toEqual([]);
  });

  it('when its reads fail they stay out, silently; reopening reads again', async () => {
    const persona: Persona = { ...LEVEL_FIVE, failing: 'groups' };
    routes.push(viewer(persona), ...publisherNode());
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await settle();
    expect(await tabNames()).not.toContain('Connections');
    expect(dialog()).not.toHaveTextContent(/connections|couldn.t/i);
    expect(detailedReads()).toEqual([]);
    // Closed and opened again: a failure was never kept, so it is read again.
    persona.failing = undefined;
    await closeAndReopen();
    await lookUp(PUBLISHER);
    await waitFor(
      async () => expect(await tabNames()).toContain('Connections'),
      T
    );
  });

  it('while it is being read they stay out, then come in: nothing flashes', async () => {
    const held = hold();
    routes.push(
      viewer({ ...LEVEL_FIVE, hold: held.until }),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await settle();
    expect(await tabNames()).toEqual(['Overview', 'Transactions', 'Names']);
    expect(detailedReads()).toEqual([]);
    await act(async () => held.release());
    await waitFor(
      async () => expect(await tabNames()).toContain('Connections'),
      T
    );
  });

  it('an answer for the last Hub account, arriving after a switch, isn’t the new one’s', async () => {
    const held = hold();
    routes.push(
      viewer({ ...LEVEL_FIVE, hold: held.until }),
      viewer(LEVEL_FOUR, VIEWER_TWO),
      ...publisherNode()
    );
    const store = renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    // Hub switches accounts while the first one's groups are still on their way.
    act(() => {
      store.set(userInfoAtom, { address: VIEWER_TWO, name: 'Two' } as never);
    });
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    // The new account's answer first, then the last one's, late.
    await waitFor(() =>
      expect(accessReads(VIEWER_TWO).length).toBeGreaterThan(0)
    );
    await settle();
    await act(async () => held.release());
    await settle();
    expect(await tabNames()).not.toContain('Connections');
    expect(detailedReads()).toEqual([]);
  });

  it('is kept a minute: reopening within it reads nothing again; after it, it is read again', async () => {
    let now = Date.UTC(2026, 10, 21, 6);
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await openPublisher(LEVEL_FIVE);
    await waitFor(
      async () => expect(await tabNames()).toContain('Connections'),
      T
    );
    const first = accessReads().length;
    // Closed and opened again 30 seconds later: no new reads, the tab at once.
    await closeAndReopen(() => {
      now += 30_000;
    });
    await lookUp(PUBLISHER);
    expect(await tabNames()).toContain('Connections');
    await settle();
    // The account page reads the viewer's own rows only for its own account; not here.
    expect(accessReads()).toHaveLength(first);
    // Two minutes later: read again.
    await closeAndReopen(() => {
      now += 120_000;
    });
    await waitFor(() => expect(accessReads().length).toBeGreaterThan(first));
  });

  it('after the Hub account changes, a step that showed Connections is gone; the new account sees the Overview', async () => {
    const store = await openPublisher(LEVEL_FIVE);
    routes.unshift(viewer({ level: 2, minter: null }, VIEWER_TWO));
    const panel = await openConnections();
    expect(panel).toBeInTheDocument();
    // Another step: Second, from a row.
    await lookUp(SECOND);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    await settle();
    const before = detailedReads().length;
    act(() => {
      store.set(userInfoAtom, { address: VIEWER_TWO, name: 'Two' } as never);
    });
    // The window starts again: nothing to go back to.
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByRole('button', { name: /^back$/i })
    ).toBeDisabled();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await settle();
    expect(await tabNames()).not.toContain('Connections');
    expect(
      within(dialog()).getByRole('tabpanel', { name: /overview/i })
    ).toBeInTheDocument();
    expect(detailedReads()).toHaveLength(before);
  });

  it('a Q-App’s OPEN_USER_LOOKUP opens the Overview, whatever else it sends, and reads nothing of Connections for anyone else', async () => {
    routes.push(viewer(LEVEL_FOUR), ...publisherNode());
    renderWindow();
    // OPEN_USER_LOOKUP sends this event with the user it names (get.ts openUserLookup).
    await lookUp(PUBLISHER, { tab: 'connections', view: 'connections' });
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await settle();
    expect(
      within(dialog()).getByRole('tabpanel', { name: /overview/i })
    ).toBeInTheDocument();
    expect(detailedReads()).toEqual([]);
  });

  it('for a viewer who sees it, a step keeps its tab: the trail opens accounts on their Overview, Back returns to Connections', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    // Second, from its row: a step on the trail.
    const rows = await within(panel).findAllByRole(
      'button',
      { name: /^Second/ },
      T
    );
    fireEvent.click(rows[0]);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    expect(
      within(dialog()).getByRole('tabpanel', { name: /overview/i })
    ).toBeInTheDocument();
    // Its crumb opens Publisher on its Overview, as a step of its own.
    const trail = within(dialog()).getByRole('navigation', { name: /trail/i });
    fireEvent.click(within(trail).getByRole('button', { name: /publisher/i }));
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /overview/i })
    ).toBeInTheDocument();
    // Back twice: Publisher as it was left, on Connections.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('tabpanel', { name: /connections/i })
    ).toBeInTheDocument();
  });
});

describe('Connections', () => {
  it('lists what was recorded between them, each opening to the transactions behind it', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    const recorded = within(panel).getByRole('region', {
      name: /recorded between them/i,
    });
    expect(
      await within(recorded).findByText(/Moved its minting level to/, {}, T)
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(/Moved its minting level to Third/),
      T
    );
    expect(recorded).toHaveTextContent(
      /Sponsored by Sponsor at 0% for 7,234 blocks/
    );
    expect(recorded).toHaveTextContent(
      /Minting with Second now, in its reward share at 5%/
    );
    expect(recorded).toHaveTextContent(/Sponsored 1 account/);
    expect(recorded).toHaveTextContent(
      /Bought the name “Spare Room” from Second for 5 QORT/
    );
    // Payments by the other account: Second first (the most payments).
    const sentTo = await within(recorded).findByRole(
      'list',
      { name: /^sent to$/i },
      T
    );
    const first = within(sentTo).getAllByRole('listitem')[0];
    expect(first).toHaveTextContent(/Paid Second 13 QORT in 3 payments/);
    // Its payments open to the three, told from Publisher's side.
    fireEvent.click(
      within(first).getByRole('button', {
        name: /show the 3 payments with Second/i,
      })
    );
    const evidence = await within(first).findByRole('list', {
      name: /the 3 payments with Second/i,
    });
    expect(within(evidence).getAllByRole('listitem')).toHaveLength(3);
    expect(evidence).toHaveTextContent(/Sent 10 QORT to Second/);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('payments: each way, sorted as picked, AT addresses apart', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    const sentTo = await within(panel).findByRole(
      'list',
      { name: /^sent to$/i },
      T
    );
    expect(
      within(sentTo)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.match(/Paid (\S+)/)?.[1])
    ).toEqual(['Second', EXCHANGE_NAME]);
    // An AT comes after the accounts, as an AT.
    expect(
      within(panel).getByRole('list', { name: /AT addresses/i })
    ).toHaveTextContent(/AT AXXXXX/);
    // Most QORT first: the exchange (100) before Second (13).
    fireEvent.mouseDown(within(panel).getByRole('combobox', { name: /sort/i }));
    fireEvent.click(await screen.findByRole('option', { name: /most QORT/i }));
    await waitFor(() =>
      expect(
        within(
          within(panel).getByRole('list', { name: /^sent to$/i })
        ).getAllByRole('listitem')[0]
      ).toHaveTextContent(new RegExp(`Paid ${EXCHANGE_NAME} 100 QORT`))
    );
    // The other way.
    fireEvent.click(
      within(panel).getByRole('button', { name: /received from/i })
    );
    const receivedFrom = await within(panel).findByRole('list', {
      name: /^received from$/i,
    });
    expect(receivedFrom).toHaveTextContent(
      /Received 7 QORT from Second in 1 payment/
    );
  });

  it('where its first QORT came from, and the sponsor it shares', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    const common = await within(panel).findByRole(
      'region',
      { name: /in common/i },
      T
    );
    await waitFor(
      () =>
        expect(common).toHaveTextContent(
          /First QORT payment received: 50 QORT from Funder/
        ),
      T
    );
    await waitFor(
      () =>
        expect(common).toHaveTextContent(
          /Also sponsored by Sponsor \(1 other\)/
        ),
      T
    );
    // The account its first QORT came from is tagged as such where it shows.
    expect(common).toHaveTextContent(/its sponsor/);
  });

  it('says what it checked and found nothing, and what it read', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ names: [], minting: [], orders: false })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /Also checked, nothing found: level moves, a sponsor, accounts it sponsored, minting with another account now, name sales,? and Q-Asset trades\./
        ),
      T
    );
    expect(panel).toHaveTextContent(
      /Read: all 6 of its payments and asset transfers, its minting transactions \(none\), its name transactions \(none\),? and its filled Q-Asset orders \(none\)\./
    );
  });

  it('an account that never signed a transaction has no Q-Asset orders: found none, never “couldn’t be read”', async () => {
    // Core finds orders by the account's public key, and says it doesn't
    // know an account without one.
    routes.push(
      viewer(LEVEL_FIVE),
      (path) =>
        path.startsWith(`/assets/orders/${PUBLISHER}?`)
          ? {
              status: 404,
              body: { error: 124, message: 'account address unknown' },
            }
          : undefined,
      ...publisherNode({ names: [], minting: [] })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /Also checked, nothing found: [^.]*Q-Asset trades\./
        ),
      T
    );
    expect(panel).toHaveTextContent(/its filled Q-Asset orders \(none\)/);
    expect(panel).not.toHaveTextContent(/Couldn't read its Q-Asset trades/);
    expect(panel).not.toHaveTextContent(/couldn't be read/);
  });

  it('a list that stopped short says how far it read, claims nothing beyond it, and reads 100 older on request', async () => {
    const page = (offset: number): Answer => ({
      body: Array.from({ length: offset < 100 ? 100 : 20 }, (_, i) =>
        pay(SECOND, PUBLISHER, 1_900_000 - offset - i, '1')
      ),
    });
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: page, names: [] })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /Read: its newest 100 payments and asset transfers/
        ),
      T
    );
    // Name sales were read in full; payments only so far.
    expect(panel).toHaveTextContent(
      /Also checked, nothing found: name sales\./
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: /read older transactions/i })
    );
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /Read: all 120 of its payments and asset transfers/
        ),
      T
    );
    expect(
      within(panel).queryByRole('button', { name: /read older transactions/i })
    ).toBeNull();
  });

  it('a list that couldn’t be read is named with Retry, never “nothing found”; Retry fixes the Overview’s Direct links too', async () => {
    let fail = true;
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: (offset) =>
          fail
            ? { status: 500, body: { error: 5, message: 'repository issue' } }
            : { body: PAID.slice(offset, offset + 100) },
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    expect(
      await within(links).findByText(
        /Couldn't read its payments and asset transfers\./,
        {},
        T
      )
    ).toBeInTheDocument();
    expect(links).toHaveTextContent(/all connections \(\d+\+\)/i);
    const panel = await openConnections();
    expect(
      await within(panel).findByText(
        /Couldn't read its payments and asset transfers\./,
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/nothing found: [^.]*payments/);
    expect(panel).not.toHaveTextContent(/No payments sent/);
    fail = false;
    fireEvent.click(
      within(
        within(panel)
          .getByText(/Couldn't read its payments and asset transfers\./)
          .closest('[role="alert"]') as HTMLElement
      ).getByRole('button', { name: /retry/i })
    );
    expect(
      await within(panel).findByRole('list', { name: /^sent to$/i }, T)
    ).toHaveTextContent(/Paid Second 13 QORT/);
    // The Overview shares the list: back on it, nothing failed.
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    const again = await within(dialog()).findByRole('region', {
      name: /direct links/i,
    });
    expect(again).not.toHaveTextContent(/Couldn't read/);
  });

  it('shares its lists with the Transactions tab: nothing is read twice', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    await within(panel).findByRole('list', { name: /^sent to$/i }, T);
    const reads = () =>
      calls.filter(
        ({ path }) => listTypes(path, PUBLISHER) === PAYMENT_KIND.join(',')
      );
    expect(reads()).toHaveLength(1);
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /transactions/i })
    );
    const tx = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    fireEvent.click(within(tx).getByRole('button', { name: /^payments$/i }));
    await within(tx).findAllByRole(
      'button',
      { name: /Sent 10 QORT to Second/ },
      T
    );
    expect(reads()).toHaveLength(1);
  });

  it('the search narrows every list to the rows that show what was typed, and says how many', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    await within(panel).findByRole('list', { name: /^sent to$/i }, T);
    const field = within(panel).getByRole('textbox', {
      name: /search these connections/i,
    });
    fireEvent.change(field, { target: { value: 'spare room' } });
    expect(
      await within(panel).findByText(/1 row matches “.spare room.”\./, {}, T)
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent(/Bought the name “Spare Room”/);
    expect(panel).not.toHaveTextContent(/Sponsored by Sponsor/);
    // By a name: the rows with that account.
    fireEvent.change(field, { target: { value: 'funder' } });
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /First QORT payment received: 50 QORT from Funder/
        ),
      T
    );
    expect(panel).not.toHaveTextContent(/Bought the name/);
    // An amount, written without its separators.
    fireEvent.change(field, { target: { value: '7,234' } });
    await waitFor(() =>
      expect(panel).toHaveTextContent(/Sponsored by Sponsor/)
    );
    fireEvent.change(field, { target: { value: 'nothing like it' } });
    expect(
      await within(panel).findByText(
        /Nothing in this account's connections matches “.nothing like it.”\./
      )
    ).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole('button', { name: /clear the search/i })
    );
    await waitFor(() =>
      expect(panel).toHaveTextContent(/Sponsored by Sponsor/)
    );
  });

  it('its Q-Asset trades, by the other account, opening to the two orders behind each', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    const part = await within(panel).findByRole(
      'list',
      { name: /^Q-Asset trades$/i },
      T
    );
    const [row] = within(part).getAllByRole('listitem');
    await waitFor(() =>
      expect(row).toHaveTextContent(/Bought 23 GBQ from Second for 529 QORT/)
    );
    fireEvent.click(
      within(row).getByRole('button', {
        name: /show the 2 orders with Second/i,
      })
    );
    const orders = await within(row).findByRole(
      'list',
      { name: /the 2 orders with Second/i },
      T
    );
    await waitFor(() =>
      expect(within(orders).getAllByRole('listitem')).toHaveLength(2)
    );
    expect(panel).toHaveTextContent(/its only filled Q-Asset order/);
  });

  it('what it sent to an exchange, read exactly, opening to the payments', async () => {
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    const notice = await within(panel).findByRole(
      'region',
      { name: /sent QORT to an exchange/i },
      T
    );
    expect(notice).toHaveTextContent(
      new RegExp(`Sent 100 QORT to ${EXCHANGE_NAME}, an exchange, in 1 payment`)
    );
    fireEvent.click(
      within(notice).getByRole('button', { name: /show the 1 payment with/i })
    );
    expect(
      await within(notice).findByRole('list', { name: /the 1 payment with/i })
    ).toHaveTextContent(new RegExp(`Sent 100 QORT to ${EXCHANGE_NAME}`));
    // Each total says what it counted: the notice every payment, exactly…
    expect(notice).toHaveTextContent(
      /Added up from every QORT payment between the two accounts/
    );
    // …the exchange's own row under Payments only the payments read there.
    const sentTo = within(panel).getByRole('list', { name: /^sent to$/i });
    const exchangeRow = within(sentTo)
      .getAllByRole('listitem')
      .find((item) =>
        item.textContent?.includes(`Paid ${EXCHANGE_NAME}`)
      ) as HTMLElement;
    expect(exchangeRow).toHaveTextContent(
      /from the payments read here; every QORT payment with it is added up at the top/
    );
    // Another account's row has no such note.
    expect(within(sentTo).getAllByRole('listitem')[0]).not.toHaveTextContent(
      /added up at the top/
    );
  });
});

describe('Connections: what it can’t tell yet', () => {
  it('a level move whose recipient is still being read waits; it never reads as “another account”', async () => {
    const held = hold();
    routes.push(
      viewer(LEVEL_FIVE),
      (path) =>
        path === `/transactions/signature/${LEVEL_TO_THIRD.signature}/raw`
          ? { body: privsBytes(THIRD), delay: held.until }
          : undefined,
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await within(panel).findByText(/Sponsored by/, {}, T);
    await settle();
    expect(panel).not.toHaveTextContent(/minting level to another account/);
    // Nor is it said to have none meanwhile.
    expect(panel).not.toHaveTextContent(/nothing found: level moves/);
    await act(async () => held.release());
    await waitFor(
      () => expect(panel).toHaveTextContent(/Moved its minting level to Third/),
      T
    );
  });

  it('its level moves are read on their own when its minting list stops short, so none is left out', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        minting: (offset) => ({
          body: offset
            ? []
            : Array.from({ length: 100 }, (_, i) =>
                share(PUBLISHER, SECOND, 1_800_000 - i, '5.00')
              ),
        }),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () => expect(panel).toHaveTextContent(/Moved its minting level to Third/),
      T
    );
    expect(panel).toHaveTextContent(/its newest 100 minting transactions/);
    expect(panel).toHaveTextContent(/Every level move was read\./);
    // A sponsor may be in what wasn't read: not claimed as none.
    expect(panel).toHaveTextContent(
      /In what was read so far, nothing found: a sponsor\./
    );
    expect(panel).not.toHaveTextContent(
      /Also checked, nothing found: [^.]*a sponsor/
    );
  });

  it('Read older that failed for one list: Retry reads only that one again', async () => {
    let failOlder = true;
    const updates = (from: number) =>
      Array.from({ length: 100 }, (_, i) =>
        tx('UPDATE_NAME', 1_700_000 - from - i, {
          creatorAddress: PUBLISHER,
          name: 'Publisher',
          newName: '',
        })
      );
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: (offset) =>
          offset && failOlder
            ? { status: 500, body: { error: 5, message: 'repository issue' } }
            : {
                body: Array.from({ length: offset ? 20 : 100 }, (_, i) =>
                  pay(SECOND, PUBLISHER, 1_900_000 - offset - i, '1')
                ),
              },
        names: (offset) => ({ body: offset < 300 ? updates(offset) : [] }),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /read older transactions/i },
        T
      )
    );
    const failed = await within(panel).findByText(
      /Couldn't read its older transactions\./,
      {},
      T
    );
    const namesAt = (offset: number) =>
      calls.filter(
        ({ path }) =>
          listTypes(path, PUBLISHER) === NAMES_KIND.join(',') &&
          params(path).get('offset') === String(offset)
      ).length;
    expect(namesAt(100)).toBe(1);
    failOlder = false;
    fireEvent.click(
      within(failed.closest('[role="alert"]') as HTMLElement).getByRole(
        'button',
        { name: /retry/i }
      )
    );
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /all 120 of its payments and asset transfers/
        ),
      T
    );
    // The names read fine the first time: Retry didn't read on past them.
    expect(namesAt(200)).toBe(0);
  });

  it('a list read only in part claims nothing beyond it', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        names: (offset) => ({
          body: offset
            ? []
            : Array.from({ length: 100 }, (_, i) =>
                tx('UPDATE_NAME', 1_700_000 - i, {
                  creatorAddress: PUBLISHER,
                  name: 'Publisher',
                  newName: '',
                })
              ),
        }),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /In what was read so far, nothing found: name sales\./
        ),
      T
    );
    expect(panel).not.toHaveTextContent(
      /Also checked, nothing found: [^.]*name sales/
    );
  });

  it('where its first QORT came from, or its trades, couldn’t be read: said with Retry, never “nothing found”', async () => {
    let fail = true;
    routes.push(
      viewer(LEVEL_FIVE),
      (path) =>
        fail &&
        (path === `/transactions/signature/${sig(9_000)}` ||
          path.startsWith(`/assets/orders/${PUBLISHER}?`))
          ? { status: 500, body: { error: 5, message: 'repository issue' } }
          : undefined,
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    expect(
      await within(panel).findByText(
        /Couldn't find where its first QORT came from\./,
        {},
        T
      )
    ).toBeInTheDocument();
    expect(
      await within(panel).findByText(
        /Couldn't read its Q-Asset trades\./,
        {},
        T
      )
    ).toBeInTheDocument();
    await settle();
    expect(panel).not.toHaveTextContent(/nothing found: [^.]*first QORT/);
    expect(panel).not.toHaveTextContent(/nothing found: [^.]*Q-Asset trades/);
    // A search can't look where it couldn't read: both stay in sight, and it says so.
    fireEvent.change(
      within(panel).getByRole('textbox', { name: /search these connections/i }),
      { target: { value: 'nothing like it' } }
    );
    await settle();
    expect(panel).toHaveTextContent(
      /Couldn't find where its first QORT came from\./
    );
    expect(panel).toHaveTextContent(/Couldn't read its Q-Asset trades\./);
    expect(panel).toHaveTextContent(/in what could be searched/);
    fireEvent.change(
      within(panel).getByRole('textbox', { name: /search these connections/i }),
      { target: { value: '' } }
    );
    fail = false;
    const funding = within(panel)
      .getByText(/Couldn't find where its first QORT came from\./)
      .closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(funding).getByRole('button', { name: /retry/i }));
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /First QORT payment received: 50 QORT from Funder/
        ),
      T
    );
  });

  it('a node that can’t read payments between two accounts: the exchanges from the lists, saying so', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      (path) =>
        path.startsWith('/transactions/payments/between?') &&
        params(path).get('senderAddress')
          ? { status: 404, body: '<html>Not Found</html>' }
          : undefined,
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    const notice = await within(panel).findByRole(
      'region',
      { name: /sent QORT to an exchange/i },
      T
    );
    expect(notice).toHaveTextContent(
      new RegExp(`Sent 100 QORT to ${EXCHANGE_NAME}, an exchange, in 1 payment`)
    );
    expect(notice).toHaveTextContent(/these come from the payments read below/);
  });

  it('from lists that stopped short, the exchanges may have older payments: it never says there are', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      (path) =>
        path.startsWith('/transactions/payments/between?') &&
        params(path).get('senderAddress')
          ? { status: 404, body: '<html>Not Found</html>' }
          : undefined,
      ...publisherNode({
        // A full first page: the payments list stopped short.
        payments: (offset) => ({
          body: offset
            ? []
            : [
                pay(PUBLISHER, EXCHANGE, 1_900_000, '100'),
                ...Array.from({ length: 99 }, (_, i) =>
                  pay(SECOND, PUBLISHER, 1_899_999 - i, '1')
                ),
              ],
        }),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    const notice = await within(panel).findByRole(
      'region',
      { name: /sent QORT to an exchange/i },
      T
    );
    expect(notice).toHaveTextContent(
      new RegExp(
        `Sent 100 QORT to ${EXCHANGE_NAME}, an exchange, in 1 payment \\(.+\\); there may be older ones\\.`
      )
    );
    expect(notice).not.toHaveTextContent(/there are older ones/);
  });
});

const failure: Answer = {
  status: 500,
  body: { error: 5, message: 'repository issue' },
};

const searchField = (panel: HTMLElement) =>
  within(panel).getByRole('textbox', { name: /search these connections/i });

describe('Connections: the search, and what it couldn’t read', () => {
  it('a name that couldn’t be read: never “nothing matches”, and it says so with Retry', async () => {
    // The node can't answer Second's primary name.
    routes.push(
      (path) => (path === `/names/primary/${SECOND}` ? failure : undefined),
      viewer(LEVEL_FIVE),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    // Second is in several of its rows, shown by its address.
    const sentTo = await within(panel).findByRole(
      'list',
      { name: /^sent to$/i },
      T
    );
    expect(within(sentTo).getAllByRole('listitem')[0]).toHaveTextContent(
      /Paid QSSSSS…SSSSS 13 QORT in 3 payments/
    );
    fireEvent.change(searchField(panel), { target: { value: 'Second' } });
    await waitFor(() => expect(panel).not.toHaveTextContent(/Looking for/), T);
    await settle();
    // Its name was never read: the tab can't tell, so it mustn't say "nothing".
    expect(panel).not.toHaveTextContent(
      /Nothing in this account's connections matches/
    );
    expect(panel).toHaveTextContent(/in what could be searched/);
    expect(
      within(panel).getByText(/Couldn't read the names of some of the accounts/)
    ).toBeInTheDocument();
  });

  it('typed while its lists are still being read: it says it is still looking, never “nothing matches”', async () => {
    const held = hold();
    const node = publisherNode();
    const isList = (path: string) =>
      path.startsWith(`/assets/orders/${PUBLISHER}?`) ||
      [PAYMENT_KIND, MINTING_KIND, NAMES_KIND].some(
        (kind) => listTypes(path, PUBLISHER) === kind.join(',')
      );
    // Its payments, minting and name lists and its orders: their own answers, held back.
    const heldLists: Route = (path) => {
      if (!isList(path)) return undefined;
      const answer = node.map((route) => route(path)).find(Boolean);
      return answer ? { ...answer, delay: held.until } : undefined;
    };
    routes.push(heldLists, viewer(LEVEL_FIVE), ...node);
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    expect(panel).toHaveTextContent(/reading its reward shares/i);
    fireEvent.change(searchField(panel), { target: { value: 'Second' } });
    await settle();
    // Nothing of its lists is read yet: it can't know.
    const whileReading = panel.textContent;
    await act(async () => held.release());
    await waitFor(() => expect(panel).toHaveTextContent(/rows? match/), T);
    // Once read, Second is in several of its rows…
    expect(panel).toHaveTextContent(/\d+ rows match “.Second.”/);
    // …so before, the tab mustn't have said none of them matched.
    expect(whileReading).not.toMatch(
      /Nothing in this account's connections matches/
    );
    // It said it was still looking, and that its lists were still being read.
    expect(whileReading).toMatch(/Looking for “.Second.”/);
    expect(whileReading).toMatch(/Some of its lists are still being read\./);
  });

  it('a list that couldn’t be read stays in sight while searching, and nothing is claimed beyond it', async () => {
    // Its payments can't be read; the AT it paid is only in its payments.
    routes.push(
      (path) =>
        listTypes(path, PUBLISHER) === PAYMENT_KIND.join(',')
          ? failure
          : undefined,
      viewer(LEVEL_FIVE),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await within(panel).findByText(
      /Couldn't read its payments and asset transfers\./,
      {},
      T
    );
    fireEvent.change(searchField(panel), { target: { value: AT_ADDR } });
    await settle();
    // While searching, the payments' failure is still in sight, with Retry…
    expect(panel).toHaveTextContent(/Couldn't read its payments/);
    // …and the list it couldn't read isn't said to hold nothing that matches.
    expect(panel).not.toHaveTextContent(
      /Nothing in this account's connections matches/
    );
    expect(panel).toHaveTextContent(/in what could be searched/);
  });

  it('names are read for the first 300 accounts as listed, and it says so: never “nothing matches” beyond them', async () => {
    // 320 accounts each paid Publisher once (a donation address, say).
    const COUNT = 320;
    const code = (i: number) =>
      String.fromCharCode(
        97 + (Math.floor(i / 676) % 26),
        97 + (Math.floor(i / 26) % 26),
        97 + (i % 26)
      );
    const payer = (i: number) =>
      `Q${base58(i).padStart(4, '1')}${'W'.repeat(29)}`;
    const nameOf = new Map(
      Array.from({ length: COUNT }, (_, i) => [payer(i), `Payer${code(i)}`])
    );
    const rows = Array.from({ length: COUNT }, (_, i) =>
      pay(payer(i), PUBLISHER, 1_900_000 - i, '1')
    );
    routes.push(
      (path) => {
        const match = /^\/names\/primary\/(Q\w+)$/.exec(path);
        const name = match ? nameOf.get(match[1]) : undefined;
        return name ? { body: { name, owner: match?.[1] } } : undefined;
      },
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: rows, minting: [], names: [] })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    // Read older until every payment is read.
    for (let read = 100; read < COUNT; read += 100) {
      fireEvent.click(
        await within(panel).findByRole(
          'button',
          { name: /^read older transactions$/i },
          T
        )
      );
      await waitFor(
        () =>
          expect(
            within(panel).queryByRole('button', {
              name: /reading older transactions/i,
            })
          ).toBeNull(),
        T
      );
    }
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /Read: all 320 of its payments and asset transfers/
        ),
      T
    );
    // The oldest payer is listed last; its row hasn't been on screen.
    const oldest = COUNT - 1;
    fireEvent.change(searchField(panel), {
      target: { value: `Payer${code(oldest)}` },
    });
    await waitFor(() => expect(panel).not.toHaveTextContent(/Looking for/), {
      timeout: 30_000,
    });
    await settle();
    // Its name was never asked for: past the first 300 accounts…
    expect(
      calls.some(({ path }) => path === `/names/primary/${payer(oldest)}`)
    ).toBe(false);
    // …so the tab doesn't say nothing matches, and says which accounts were covered.
    expect(panel).not.toHaveTextContent(
      /Nothing in this account's connections matches/
    );
    expect(panel).toHaveTextContent(
      /Names were read for the first 300 of its \d+ accounts/
    );
  }, 60_000);

  it('a Refresh that couldn’t read its payments again keeps its rows and says so, with Retry', async () => {
    let fail = false;
    routes.push(
      (path) =>
        fail && listTypes(path, PUBLISHER) === PAYMENT_KIND.join(',')
          ? failure
          : undefined,
      viewer(LEVEL_FIVE),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await within(panel).findByRole('list', { name: /^sent to$/i }, T);
    await settle();
    expect(within(panel).queryAllByRole('alert')).toHaveLength(0);
    fail = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(
      () =>
        expect(
          calls.filter(
            ({ path }) => listTypes(path, PUBLISHER) === PAYMENT_KIND.join(',')
          ).length
        ).toBeGreaterThan(1),
      T
    );
    await settle();
    // The payments read before stay on screen…
    expect(panel).toHaveTextContent(/Paid Second 13 QORT in 3 payments/);
    // …and, as the Transactions tab does, it says it couldn't check for newer ones.
    expect(within(panel).queryAllByRole('alert').length).toBeGreaterThan(0);
    expect(panel).toHaveTextContent(/Couldn't check for newer transactions\./);
    fail = false;
    fireEvent.click(
      within(
        within(panel)
          .getByText(/Couldn't check for newer transactions\./)
          .closest('[role="alert"]') as HTMLElement
      ).getByRole('button', { name: /retry/i })
    );
    await waitFor(
      () =>
        expect(panel).not.toHaveTextContent(
          /Couldn't check for newer transactions/
        ),
      T
    );
  });

  it('one list that couldn’t be read keeps how far the others were read, and their Read older', async () => {
    // Its newest 100 payments, and more behind them; its name transactions fail.
    const payments = (offset: number): Answer => ({
      body: Array.from({ length: offset < 100 ? 100 : 20 }, (_, i) =>
        pay(SECOND, PUBLISHER, 1_900_000 - offset - i, '1')
      ),
    });
    routes.push(
      (path) =>
        listTypes(path, PUBLISHER) === NAMES_KIND.join(',')
          ? failure
          : undefined,
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await within(panel).findByText(
      /Couldn't read its name transactions\./,
      {},
      T
    );
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(
          /Received 100 QORT from Second in 100 payments/
        ),
      T
    );
    await settle();
    // "Received 100 QORT … in 100 payments" counts only its newest 100: it says so.
    expect(panel).toHaveTextContent(
      /its newest 100 payments and asset transfers/
    );
    expect(panel).toHaveTextContent(
      /its name transactions \(couldn't be read\)/
    );
    expect(
      within(panel).getByRole('button', { name: /^read older transactions$/i })
    ).toBeInTheDocument();
  });

  it('the online list that couldn’t be read is named, with Retry', async () => {
    let fail = true;
    routes.push(
      (path) => (fail && path === '/addresses/online' ? failure : undefined),
      viewer(LEVEL_FIVE),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () => expect(panel).toHaveTextContent(/Sponsored by Sponsor/),
      T
    );
    await waitFor(
      () => expect(panel).toHaveTextContent(/Read: all 6 of its payments/),
      T
    );
    await settle();
    // Publisher mints with Second now, but the list that says so couldn't be read.
    expect(panel).not.toHaveTextContent(/Minting with Second now/);
    expect(within(panel).queryAllByRole('alert').length).toBeGreaterThan(0);
    const alert = within(panel)
      .getByText(/Couldn't read who is minting now\./)
      .closest('[role="alert"]') as HTMLElement;
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    await waitFor(
      () => expect(panel).toHaveTextContent(/Minting with Second now/),
      T
    );
  });

  it('trades it can’t list (with itself, or an order the node doesn’t know) are said, never “nothing found”', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      (path) =>
        path === `/assets/order/${THEIR_ORDER.signature}`
          ? {
              status: 404,
              body: { error: 603, message: 'unknown asset order ID' },
            }
          : undefined,
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const panel = await openConnections();
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(/1 of its Q-Asset trades isn't listed/),
      T
    );
    expect(panel).not.toHaveTextContent(/nothing found: [^.]*Q-Asset trades/);
  });
});

describe('the Overview’s Direct links', () => {
  it('the first three links, and All connections opens the tab with the focus', async () => {
    await openPublisher(LEVEL_FIVE);
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    const list = await within(links).findByRole(
      'list',
      { name: /direct links/i },
      T
    );
    await waitFor(
      () => expect(within(list).getAllByRole('listitem')).toHaveLength(3),
      T
    );
    await waitFor(
      () =>
        expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
          /Moved its minting level to Third/
        ),
      T
    );
    const all = within(links).getByRole('button', { name: /all connections/i });
    // Its Q-Asset trades aren't read from the Overview: the count says "+".
    await waitFor(
      () => expect(all).toHaveTextContent(/all connections \(\d+\+\)/i),
      T
    );
    expect(calls.some(({ path }) => path.startsWith('/assets/'))).toBe(false);
    fireEvent.click(all);
    await waitFor(() =>
      expect(
        within(dialog()).getByRole('tab', { name: /^connections$/i })
      ).toHaveAttribute('aria-selected', 'true')
    );
    await waitFor(() =>
      expect(
        within(dialog()).getByRole('tab', { name: /^connections$/i })
      ).toHaveFocus()
    );
  });

  it('Q-Asset trades read only in part (the newest 100 filled orders): the count says “+” too', async () => {
    // Publisher has 101 filled orders: the Explorer reads the newest 100.
    routes.push(viewer(LEVEL_FIVE), ...publisherNode({ moreFilled: 100 }));
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const panel = await openConnections();
    await waitFor(
      () =>
        expect(panel).toHaveTextContent(/its newest 100 filled Q-Asset orders/),
      T
    );
    expect(panel).toHaveTextContent(
      /The Explorer reads up to 100 filled orders\./
    );
    // Back on the Overview: every other list was read in full, nothing failed.
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    const all = await within(links).findByRole(
      'button',
      { name: /all connections/i },
      T
    );
    await settle();
    // Trades with other accounts may be in the filled orders it didn't read.
    expect(all).toHaveTextContent(/all connections \(\d+\+\)/i);
  });

  it('every part read in full, the trades too: the count without “+”', async () => {
    routes.push(viewer(LEVEL_FIVE), ...publisherNode());
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const panel = await openConnections();
    await waitFor(
      () => expect(panel).toHaveTextContent(/its only filled Q-Asset order/),
      T
    );
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    await waitFor(
      () =>
        expect(
          within(links).getByRole('button', { name: /all connections/i })
        ).toHaveTextContent(/all connections \(\d+\)$/i),
      T
    );
  });

  it('while the online list is still being read, the count says “+”, then grows', async () => {
    const online = hold();
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        online: {
          body: [{ minterAddress: PUBLISHER, recipientAddress: SECOND }],
          delay: online.until,
        },
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    // The tab reads its trades first: then only the online list is missing.
    const panel = await openConnections();
    await waitFor(
      () => expect(panel).toHaveTextContent(/its only filled Q-Asset order/),
      T
    );
    fireEvent.click(within(dialog()).getByRole('tab', { name: /overview/i }));
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    const all = await within(links).findByRole(
      'button',
      { name: /all connections/i },
      T
    );
    // Every list and the level move's recipient are in: only the online
    // list (who mints with whom now) is still on its way.
    await waitFor(
      () =>
        expect(within(links).getAllByRole('listitem')[0]).toHaveTextContent(
          /Moved its minting level to Third/
        ),
      T
    );
    await settle();
    const whileReading = all.textContent;
    await act(async () => online.release());
    await settle();
    const after = all.textContent;
    // The count went up once the online list came in ("Minting with Second now")…
    expect(after).not.toEqual(whileReading);
    // …so while it was still being read, it wasn't the whole count.
    expect(whileReading).toMatch(/all connections \(\d+\+\)/i);
    expect(after).toMatch(/all connections \(\d+\)$/i);
  });

  it('a Refresh that couldn’t read a list again says so, with Retry', async () => {
    let fail = false;
    routes.push(
      (path) =>
        fail && listTypes(path, PUBLISHER) === MINTING_KIND.join(',')
          ? failure
          : undefined,
      viewer(LEVEL_FIVE),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    await within(links).findByText(/Moved its minting level to/, {}, T);
    fail = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(links).findByText(
        /Couldn't check for newer transactions\./,
        {},
        T
      )
    ).toBeInTheDocument();
    // What was read stays.
    expect(links).toHaveTextContent(/Moved its minting level to Third/);
  });

  it('“+” while a list stopped short, and a line saying so', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: (offset) => ({
          body: Array.from({ length: offset ? 0 : 100 }, (_, i) =>
            pay(SECOND, PUBLISHER, 1_900_000 - i, '1')
          ),
        }),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    await waitFor(
      () => expect(links).toHaveTextContent(/all connections \(\d+\+\)/i),
      T
    );
    expect(links).toHaveTextContent(/there may be older ones/);
  });

  it('none found in what was read: one line, never a failure taken for none', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: [], minting: [], names: [], orders: false })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const links = await within(dialog()).findByRole(
      'region',
      { name: /direct links/i },
      T
    );
    expect(
      await within(links).findByText(
        /No direct links found in what was read\./,
        {},
        T
      )
    ).toBeInTheDocument();
  });
});

describe('exchanges named as such', () => {
  it('for a viewer who sees the detailed parts: in sentences, in its header with a chip, and on the trail', async () => {
    await openPublisher(LEVEL_FIVE);
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /transactions/i })
    );
    const tx = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    await waitFor(
      () => expect(tx).toHaveTextContent(`Sent 100 QORT to ${EXCHANGE_NAME}`),
      T
    );
    await lookUp(EXCHANGE);
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: EXCHANGE_NAME,
      })
    ).toBeInTheDocument();
    expect(within(dialog()).getByText(/^exchange$/)).toBeInTheDocument();
  });

  it('a plain address for anyone else, and no chip', async () => {
    await openPublisher(LEVEL_FOUR);
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /transactions/i })
    );
    const tx = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    await waitFor(() => expect(tx).toHaveTextContent(/Sent 100 QORT to Qc/), T);
    await settle();
    expect(dialog()).not.toHaveTextContent(EXCHANGE_NAME);
    await lookUp(EXCHANGE);
    expect(
      await within(dialog()).findByRole('heading', { level: 2, name: /^Qc/ })
    ).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent(EXCHANGE_NAME);
    expect(within(dialog()).queryByText(/^exchange$/)).toBeNull();
  });
});
