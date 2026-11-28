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
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

// The circle's layout as it is, watched: what the drawing was laid out with.
vi.mock('../../lib/explorer/circle', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../lib/explorer/circle')>();
  return { ...real, fitCircle: vi.fn(real.fitCircle) };
});

import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import Base58Module from '../../encryption/Base58';
import { darkTheme } from '../../styles/theme-dark';
import { KNOWN_EXCHANGES } from '../../lib/explorer/exchanges';
import {
  fitCircle,
  type CircleFit,
  type PlacedNode,
} from '../../lib/explorer/circle';
import { NULL_ACCOUNT } from '../../lib/explorer/reads';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// Connections as a circle (PR 4b), the way Connections opens: the accounts
// linked to it drawn around it, each opening what links them and counting
// its transactions as that says, the order and the choice kept with the
// history step, a search worded as what matches, what it is drawn without
// said in its own words, a list that couldn't be read never drawn as
// nothing, and a narrow window drawing fewer avatars without names; in the
// window as App mounts it, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
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
  return within(dialog()).findByRole('tabpanel', { name: /connections/i });
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

/** Connections, as it opens: a circle (the toggle beside the search says so). */
async function openCircle() {
  const panel = await openConnections();
  const views = within(panel).getByRole('group', {
    name: /show what was recorded between them as/i,
  });
  expect(
    within(views).getByRole('button', { name: /^circle$/i })
  ).toHaveAttribute('aria-pressed', 'true');
  const figure = await within(panel).findByRole(
    'figure',
    { name: /^\u2068?Publisher\u2069? and the \d+ accounts? linked to it$/ },
    T
  );
  return { panel, figure };
}

/**
 * The node of Second, paid both ways and traded with, at the bottom: its
 * payments each way, and the trade by its two orders, as its dialog lists
 * them (4 transactions and 2 orders).
 */
const SECOND_NODE =
  /^\u2068?Second\u2069?, 6 transactions: 1 received \(7 QORT\); 3 sent \(13 QORT\); traded in 2 orders \(got 23 GBQ for 529 QORT\): show what links them$/;

/** Payments with accounts that paid it (`received`), it paid (`sent`), and both ways. */
function manyPayments(received: number, sent: number, both: number): Row[] {
  const at = (letter: string, i: number) =>
    `Q${letter.repeat(31)}${ALPHABET[Math.floor(i / 58)]}${ALPHABET[i % 58]}`;
  return [
    ...Array.from({ length: received }, (_, i) =>
      pay(at('J', i), PUBLISHER, 1_500_000 + i, '1')
    ),
    ...Array.from({ length: sent }, (_, i) =>
      pay(PUBLISHER, at('K', i), 1_500_100 + i, '2')
    ),
    ...Array.from({ length: both }, (_, i) => [
      pay(at('L', i), PUBLISHER, 1_500_200 + i, '3'),
      pay(PUBLISHER, at('L', i), 1_500_300 + i, '4'),
    ]).flat(),
  ].reverse();
}

/**
 * The Explorer's scroll area as the browser lays it out, in CSS px: its
 * content area `content` wide while nothing scrolls, the circle's 1,080 px
 * column centred in it, `view` tall. Hub's 8 px scrollbar (theme-common.ts,
 * ::-webkit-scrollbar) shows while the page (the circle's drawing and
 * `rest`, the page's other parts) is taller than the area, its room taken
 * from the content area while it shows, or always where the area keeps it
 * (scrollbar-gutter: stable). The area's observers are told of each change
 * of its size.
 */
function scrollArea(content: number, rest: number, height: number) {
  const COLUMN = 1080;
  const SCROLLBAR = 8;
  let view = height;
  let scrollbar = false;
  const isScroller = (element: Element) =>
    element.hasAttribute('data-explorer-scroll');
  const padding = (element: Element) =>
    parseFloat(window.getComputedStyle(element).paddingLeft) || 0;
  const scroller = () =>
    document.querySelector('[data-explorer-scroll]') as HTMLElement;
  const drawing = () =>
    document.querySelector<HTMLElement>('[data-layout]') as HTMLElement;
  const drawnHeight = () =>
    parseFloat(window.getComputedStyle(drawing()).height) || 0;
  const kept = () =>
    window.getComputedStyle(scroller()).scrollbarGutter === 'stable';
  const width = () =>
    content + 2 * padding(scroller()) - (scrollbar || kept() ? SCROLLBAR : 0);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return isScroller(this) ? width() : COLUMN;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return isScroller(this) ? view : 0;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const area = this.closest('[data-explorer-scroll]');
      const left =
        isScroller(this) || !area
          ? 0
          : padding(area) + (width() - 2 * padding(area) - COLUMN) / 2;
      return {
        left,
        right: left + COLUMN,
        top: 0,
        bottom: 0,
        width: COLUMN,
        height: 0,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
  );
  const watching: Array<{ notify: () => void; targets: Element[] }> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private entry: { notify: () => void; targets: Element[] };
      constructor(callback: () => void) {
        this.entry = { notify: () => callback(), targets: [] };
        watching.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      unobserve() {}
      disconnect() {
        this.entry.targets = [];
      }
    }
  );
  const notify = () =>
    act(async () => {
      for (const entry of watching)
        if (entry.targets.some(isScroller)) entry.notify();
    });
  const now = () =>
    `${drawing().getAttribute('data-layout')} drawing ${Math.round(drawnHeight())} px tall, scrollbar ${scrollbar ? 'shown' : 'not shown'}`;
  /** One layout: the scrollbar follows the page's height. Whether it changed. */
  const layOut = async () => {
    const was = scrollbar;
    scrollbar = rest + drawnHeight() > view;
    if (scrollbar !== was) await notify();
    return scrollbar !== was;
  };
  return {
    drawnHeight,
    /** The scrollbar shown or not, as a page taller than the area or not would. */
    async showScrollbar(shown: boolean) {
      if (shown === scrollbar) return;
      scrollbar = shown;
      await notify();
    },
    async setHeight(next: number) {
      view = next;
      await notify();
    },
    /** Laid out until nothing changes, at most 8 times: whether it still changed, and what it went through. */
    async settle() {
      const seen = [now()];
      let changed = true;
      for (let round = 0; round < 8 && changed; round++) {
        changed = await layOut();
        seen.push(now());
      }
      return { changed, seen };
    },
  };
}

describe('Connections as a circle', () => {
  it('draws what came in on the left, what went out on the right, both ways at the bottom, and the other links under it', async () => {
    await openPublisher(LEVEL_FIVE);
    const { panel, figure } = await openCircle();
    // Under its own heading, as Q-Mintership+'s.
    expect(
      within(panel).getByRole('region', { name: /^connections circle$/i })
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole('region', { name: /recorded between them/i })
    ).toBeNull();
    // Paid both ways, and traded with: one avatar at the bottom.
    const both = within(figure).getByRole('list', {
      name: 'Sent and received: the most transactions first',
    });
    const second = await within(both).findByRole(
      'button',
      { name: SECOND_NODE },
      T
    );
    // Its ring green and red in proportion: 7 of 549 QORT came in (the trade's 529 went out).
    expect(second.querySelector('[data-ring]')).toHaveAttribute(
      'data-received',
      '0.01'
    );
    expect(figure).toHaveTextContent('7 QORT in, 542 out');
    expect(figure).toHaveTextContent('23 GBQ in');
    expect(second.querySelector('[data-count]')).toHaveAttribute(
      'data-count',
      '6'
    );
    // What went out only: the exchange's account, by its name.
    const sent = within(figure).getByRole('list', {
      name: 'Sent to: the most transactions first',
    });
    expect(
      within(sent).getByRole('button', {
        name: `\u2068${EXCHANGE_NAME}\u2069, 1 transaction sent: 100 QORT: show what links them`,
      })
    ).toBeInTheDocument();
    // Nothing came in only.
    expect(
      within(figure).queryByRole('list', {
        name: 'Received from: the most transactions first',
      })
    ).toBeNull();
    // An AT address isn't drawn: the list has it.
    expect(figure).not.toHaveTextContent(/AT /);
    // The links that aren't transfers, in a row under it.
    const others = within(panel).getByRole('list', {
      name: /^other links: reward shares, minting level, names$/i,
    });
    expect(
      within(others).getByRole('button', {
        name: /^\u2068?Sponsor\u2069?, 2 transactions: show what links them$/,
      })
    ).toBeInTheDocument();
    expect(
      await within(others).findByRole(
        'button',
        { name: /^\u2068?Third\u2069?, 1 transaction: show what links them$/ },
        T
      )
    ).toBeInTheDocument();
    // The accounts it sponsored are no one account: listed under it, as in the list.
    const apart = within(panel).getByRole('list', {
      name: /^not drawn: links that aren't with one account$/i,
    });
    expect(apart).toHaveTextContent(/Sponsored 1 account/);
    // With the list's own link to them.
    expect(
      within(apart).getByRole('button', {
        name: /^the accounts it sponsored$/i,
      })
    ).toBeInTheDocument();
    // The text alternative is the list, one press away.
    expect(
      within(panel).getByRole('button', { name: /^see the list$/i })
    ).toBeInTheDocument();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('an avatar opens what links them, the list’s own evidence; Explore opens that account, and Back returns to the circle', async () => {
    await openPublisher(LEVEL_FIVE);
    const { figure } = await openCircle();
    fireEvent.click(
      await within(figure).findByRole('button', { name: SECOND_NODE }, T)
    );
    const opened = await screen.findByRole(
      'dialog',
      { name: /^Sent to and received from \u2068?Second\u2069?$/ },
      T
    );
    const recorded = within(opened).getByRole('list', {
      name: /^what was recorded between them$/i,
    });
    expect(recorded).toHaveTextContent(
      /Bought 23 GBQ from Second for 529 QORT/
    );
    expect(recorded).toHaveTextContent(
      /Received 7 QORT from Second in 1 payment/
    );
    expect(recorded).toHaveTextContent(/Paid Second 13 QORT in 3 payments/);
    // The payments behind it, and the trade's two orders, read now.
    const payments = await within(opened).findByRole(
      'list',
      { name: /^the 4 transactions with \u2068?Second\u2069?$/i },
      T
    );
    expect(within(payments).getAllByRole('listitem')).toHaveLength(4);
    const orders = await within(opened).findByRole(
      'list',
      { name: /^the 2 orders with \u2068?Second\u2069?$/i },
      T
    );
    await waitFor(() =>
      expect(within(orders).getAllByRole('listitem')).toHaveLength(2)
    );
    fireEvent.click(
      within(opened).getByRole('button', {
        name: /^explore \u2068?Second\u2069?$/i,
      })
    );
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Sent to and received from/ })
      ).toBeNull()
    );
    // Back: Publisher as it was left, as a circle, the dialog closed.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const panel = await within(dialog()).findByRole(
      'tabpanel',
      { name: /connections/i },
      T
    );
    expect(
      within(panel).getByRole('button', { name: /^circle$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      await within(panel).findByRole('button', { name: SECOND_NODE }, T)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /Sent to and received from/ })
    ).toBeNull();
  });

  it('every avatar is reached and opened by keyboard', async () => {
    const user = userEvent.setup();
    await openPublisher(LEVEL_FIVE);
    const { panel, figure } = await openCircle();
    await within(figure).findByRole('button', { name: SECOND_NODE }, T);
    const nodes = [
      ...within(figure).getAllByRole('button'),
      ...within(
        within(panel).getByRole('list', { name: /^other links/i })
      ).getAllByRole('button'),
    ];
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    for (const node of nodes) {
      expect(node.tagName).toBe('BUTTON');
      expect(node).not.toHaveAttribute('tabindex', '-1');
      expect(node).toHaveAccessibleName(/: show what links them$/);
    }
    const second = within(figure).getByRole('button', { name: SECOND_NODE });
    second.focus();
    await user.keyboard('{Enter}');
    const opened = await screen.findByRole(
      'dialog',
      { name: /^Sent to and received from \u2068?Second\u2069?$/ },
      T
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opened).not.toBeInTheDocument());
    await waitFor(() => expect(second).toHaveFocus());
  });

  it('by the most QORT on request, kept with the step; the list then sorts its payments the same way', async () => {
    await openPublisher(LEVEL_FIVE);
    const { panel, figure } = await openCircle();
    const order = within(panel).getByRole('group', {
      name: /order the accounts by/i,
    });
    expect(
      within(order).getByRole('button', { name: /most transactions/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(panel).toHaveTextContent(
      'The bigger the avatar and its line, the more transactions went that way.'
    );
    fireEvent.click(within(order).getByRole('button', { name: /most QORT/i }));
    const both = await within(figure).findByRole('list', {
      name: 'Sent and received: the most QORT first',
    });
    const second = within(both).getByRole('button', { name: SECOND_NODE });
    // 7 QORT in and 542 out.
    expect(second.querySelector('[data-count]')).toHaveAttribute(
      'data-count',
      '549'
    );
    expect(panel).toHaveTextContent(
      'the more QORT went that way; the number on it is that QORT.'
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: /^see the list$/i })
    );
    const recorded = await within(panel).findByRole('region', {
      name: /recorded between them/i,
    });
    expect(
      within(panel).getByRole('button', { name: /^list$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(recorded).getByRole('combobox', { name: /sort/i })
    ).toHaveTextContent(/most QORT/i);
    // Back to the circle: still by QORT.
    fireEvent.click(within(panel).getByRole('button', { name: /^circle$/i }));
    expect(
      await within(panel).findByRole('list', {
        name: 'Sent and received: the most QORT first',
      })
    ).toBeInTheDocument();
  });

  it('typing a search shows the list, as Q-Mintership+ does; clearing it brings the circle back', async () => {
    await openPublisher(LEVEL_FIVE);
    const { panel } = await openCircle();
    const field = within(panel).getByRole('textbox', {
      name: /search these connections/i,
    });
    fireEvent.change(field, { target: { value: 'second' } });
    expect(
      within(panel).getByRole('button', { name: /^list$/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).queryByRole('figure')).toBeNull();
    fireEvent.change(field, { target: { value: '' } });
    expect(await within(panel).findByRole('figure', {}, T)).toBeInTheDocument();
    // The circle pressed again while searching: it draws what the search
    // found, says so, and clearing the search keeps it.
    fireEvent.change(field, { target: { value: 'tradeogre' } });
    expect(within(panel).queryByRole('figure')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^circle$/i }));
    expect(
      await within(panel).findByRole(
        'figure',
        {
          name: /^\u2068?Publisher\u2069? and the 1 linked account that matches “\u2068?tradeogre\u2069?”$/,
        },
        T
      )
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      /1 account matches “\u2068?tradeogre\u2069?”\./
    );
    // Its sides say what matches, never all its links.
    expect(panel).toHaveTextContent(/Received fromnone match/i);
    expect(panel).toHaveTextContent(/Sent to1 account match/);
    expect(panel).not.toHaveTextContent(/no other account is linked to it/);
    fireEvent.change(field, { target: { value: '' } });
    expect(
      await within(panel).findByRole(
        'figure',
        { name: /^\u2068?Publisher\u2069? and the 4 accounts linked to it$/ },
        T
      )
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: /^circle$/i })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('a list that couldn’t be read stays above it with Retry, and is never drawn as nothing', async () => {
    let fail = true;
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: (offset) =>
          fail
            ? { status: 500, body: { error: 5, message: 'repository issue' } }
            : { body: PAID.slice(offset, offset + 100) },
        minting: [],
        names: [],
        orders: false,
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const panel = await openConnections();
    const failure = await within(panel).findByText(
      /Couldn't read its payments and asset transfers\./,
      {},
      T
    );
    expect(
      await within(panel).findByText(
        'Nothing to draw in what could be read so far.',
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/no other account is linked to it/);
    fail = false;
    fireEvent.click(
      within(failure.closest('[role="alert"]') as HTMLElement).getByRole(
        'button',
        { name: /retry/i }
      )
    );
    expect(
      await within(panel).findByRole(
        'button',
        {
          name: /^\u2068?Second\u2069?, 4 transactions: 1 received \(7 QORT\); 3 sent \(13 QORT\)/,
        },
        T
      )
    ).toBeInTheDocument();
  });

  it('a list read only in part: what is drawn says so', async () => {
    // Its payments: a full page, so there may be older ones.
    const many = Array.from({ length: 100 }, (_, i) =>
      pay(PUBLISHER, SECOND, 1_600_000 - i, '1')
    );
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: (offset) =>
          offset === 0
            ? { body: many }
            : { body: [], delay: new Promise(() => undefined) },
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const panel = await openConnections();
    expect(
      await within(panel).findByText(
        'Drawn from what could be read so far: older transactions may link more accounts.',
        {},
        T
      )
    ).toBeInTheDocument();
  });

  it('in a narrow window: fewer, smaller avatars, no names beside them, every one still a named button', async () => {
    let width = 300;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      () => width
    );
    await openPublisher(LEVEL_FIVE);
    const { figure } = await openCircle();
    await within(figure).findByRole('button', { name: SECOND_NODE }, T);
    const box = figure.querySelector('[data-layout]') as HTMLElement;
    expect(box).toHaveAttribute('data-layout', 'phone');
    // The names are in the buttons' own names, not beside them.
    expect(within(figure).queryByText('Second')).toBeNull();
    expect(within(figure).queryByText(EXCHANGE_NAME)).toBeNull();
    // As tall as it must be for nothing to overlap, whatever the width.
    const narrowHeight = parseFloat(
      box.style.height || getComputedStyle(box).height
    );
    expect(narrowHeight).toBeGreaterThan(0);
    width = 700;
    // Drawn again at the new width (Refresh-free: a new render).
    fireEvent.click(within(dialog()).getByRole('button', { name: /^list$/i }));
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^circle$/i })
    );
    const wide = await within(dialog()).findByRole('figure', {}, T);
    expect(wide.querySelector('[data-layout]')).toHaveAttribute(
      'data-layout',
      'wide'
    );
    expect(await within(wide).findByText('Second', {}, T)).toBeInTheDocument();
  });

  it('a bigger window (full screen) draws every account it may and leaves fewer for the list; any change of its size (a zoom too) lays it out again', async () => {
    // 20 accounts paid it, 20 it paid, 7 both ways: more than an ordinary window draws.
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: manyPayments(20, 20, 7), orders: false })
    );
    // The room the window gives, in CSS px: its content area (the part that
    // scrolls) and the circle's 1,080 px column, centred in it.
    const COLUMN = 1080;
    let scrollWidth = 1100;
    let scrollHeight = 800;
    const isScroller = (element: Element) =>
      element.hasAttribute('data-explorer-scroll');
    const padding = (element: Element) =>
      parseFloat(window.getComputedStyle(element).paddingLeft) || 0;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return isScroller(this) ? scrollWidth : COLUMN;
      }
    );
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return isScroller(this) ? scrollHeight : 0;
      }
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const scroller = this.closest('[data-explorer-scroll]');
        const left =
          isScroller(this) || !scroller
            ? 0
            : padding(scroller) +
              (scrollWidth - 2 * padding(scroller) - COLUMN) / 2;
        return {
          left,
          right: left + COLUMN,
          top: 0,
          bottom: 0,
          width: COLUMN,
          height: 0,
          x: left,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
    );
    // As the browser tells the circle of a change of size: its observers.
    const watching: Array<{ notify: () => void; targets: Element[] }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private entry: { notify: () => void; targets: Element[] };
        constructor(callback: () => void) {
          this.entry = { notify: () => callback(), targets: [] };
          watching.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.push(target);
        }
        unobserve() {}
        disconnect() {
          this.entry.targets = [];
        }
      }
    );
    const resize = (width: number, height: number) =>
      act(() => {
        scrollWidth = width;
        scrollHeight = height;
        for (const entry of watching)
          if (entry.targets.some(isScroller)) entry.notify();
      });
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const { panel } = await openCircle();
    /** How it is drawn now: its size, how many avatars, and how many it leaves for the list. */
    const drawn = () => {
      const figure = within(panel).getByRole('figure');
      const box = figure.parentElement as HTMLElement;
      const drawing = figure.querySelector<HTMLElement>('[data-layout]');
      const more = within(panel).getByRole('button', {
        name: /see the list$/i,
      });
      const size = Number(box.getAttribute('data-circle-size'));
      // Drawn at the width it was laid out for (inside its 24 px padding),
      // never its column's: its places and its names' room stay in step.
      expect(drawing && window.getComputedStyle(drawing).width).toBe(
        `${size - 48}px`
      );
      return {
        layout: drawing?.getAttribute('data-layout'),
        size,
        avatars: within(figure).getAllByRole('button').length,
        more: Number(/^(\d+) more/.exec(more.textContent ?? '')?.[1] ?? 0),
      };
    };
    // An ordinary window: as always, 10 a side and 4 at the bottom, 880 px.
    await within(panel).findByRole(
      'button',
      { name: /^23 more accounts with fewer transactions: see the list$/ },
      T
    );
    const ordinary = drawn();
    expect(ordinary).toEqual({
      layout: 'wide',
      size: 880,
      avatars: 24,
      more: 23,
    });
    expect(panel).toHaveTextContent('10 more in the list');
    // Full screen: bigger, every account it may draw (16 a side, the 7
    // paid both ways), the rest for the list.
    await resize(2000, 1250);
    const full = drawn();
    expect(full.layout).toBe('big');
    expect(full.size).toBeGreaterThan(880);
    expect(full.size).toBeLessThanOrEqual(2000);
    expect(full.avatars).toBe(16 + 16 + 7);
    expect(full.more).toBe(8);
    expect(panel).toHaveTextContent('4 more in the list');
    // A zoom to 150 %: a third fewer CSS px each way, still more than an
    // ordinary window. Laid out again: as many, no wider than it is.
    await resize(2000 / 1.5, 1250 / 1.5);
    const zoomed = drawn();
    expect(zoomed.layout).toBe('big');
    expect(zoomed.avatars).toBe(full.avatars);
    expect(zoomed.more).toBe(full.more);
    expect(zoomed.size).toBeLessThanOrEqual(2000 / 1.5);
    // A zoom to 200 %: an ordinary window's room. As an ordinary window has.
    await resize(2000 / 2, 1250 / 2);
    expect(drawn()).toEqual(ordinary);
    // Back to 100 %: as it was in full screen.
    await resize(2000, 1250);
    expect(drawn()).toEqual(full);
    // A tall window: as wide as it has room for, never wider than the window.
    await resize(1600, 2400);
    const tall = drawn();
    expect(tall.layout).toBe('big');
    expect(tall.size).toBeGreaterThan(880);
    expect(tall.size).toBeLessThanOrEqual(1600);
    expect(tall.avatars).toBe(full.avatars);
    // Back to an ordinary window: as it was.
    await resize(1100, 800);
    expect(drawn()).toEqual(ordinary);
  });

  it('comes to rest on one drawing while the scroll area’s scrollbar comes and goes with the page’s height', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: manyPayments(20, 20, 7), orders: false })
    );
    // Full screen in a window 1,200 CSS px wide: a content area of 1,144 px
    // (4 more than an ordinary window's 1,140) while nothing scrolls, 1,136
    // px while the scrollbar shows. Tall: the page with the ordinary drawing
    // fits in it, with the bigger one it doesn't.
    const area = scrollArea(1144, 600, 1400);
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await openCircle();
    // It should come to rest, never switch between two drawings for good.
    const { changed, seen } = await area.settle();
    expect(changed, seen.join('\n')).toBe(false);
  });

  it('in a bigger window too: its size never follows the scrollbar, wherever the page’s height falls', async () => {
    // 12 each way and 6 both: all of them fit the height a big window shows,
    // the drawing as wide as the window lets it be (its height following).
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: manyPayments(12, 12, 6), orders: false })
    );
    const area = scrollArea(1400, 600, 1800);
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await openCircle();
    expect(document.querySelector('[data-layout]')).toHaveAttribute(
      'data-layout',
      'big'
    );
    // As tall with the scrollbar showing as without it.
    await area.showScrollbar(false);
    const without = area.drawnHeight();
    await area.showScrollbar(true);
    expect(area.drawnHeight()).toBe(without);
    // A page just as tall as the area: it comes to rest.
    await area.showScrollbar(false);
    await area.setHeight(600 + without + 0.5);
    const { changed, seen } = await area.settle();
    expect(changed, seen.join('\n')).toBe(false);
  });

  it('is first drawn at the size it has, never at the 720 px it takes before its room is read', async () => {
    // Its column 1,080 px wide: drawn 880 px wide, as Q-Mintership+'s.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1080);
    // Every size it is drawn at, from the first.
    const sizes = new Set<string>();
    const collect = (records: MutationRecord[]) => {
      for (const record of records) {
        if (record.oldValue) sizes.add(record.oldValue);
        const nodes = [
          record.target,
          ...record.addedNodes,
          ...record.removedNodes,
        ];
        for (const node of nodes)
          if (node instanceof Element)
            for (const element of [
              node,
              ...node.querySelectorAll('[data-circle-size]'),
            ]) {
              const size = element.getAttribute('data-circle-size');
              if (size) sizes.add(size);
            }
      }
    };
    const watcher = new MutationObserver(collect);
    watcher.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-circle-size'],
      attributeOldValue: true,
    });
    await openPublisher(LEVEL_FIVE);
    await openCircle();
    collect(watcher.takeRecords());
    watcher.disconnect();
    expect([...sizes]).toEqual(['880']);
  });

  it('a name beside an avatar keeps its room: an amount too long beside it gets a line of its own', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      () => 1100
    );
    // Third got a Q-Asset with a long name: beside Third's name, its amount
    // would leave the name no room. Six more were paid 2 QORT each.
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: [
          tx('TRANSFER_ASSET', 1_500_100, {
            creatorAddress: PUBLISHER,
            recipient: THIRD,
            amount: '5',
            assetId: 77,
            assetName: 'Community Garden Allotment Shares',
          }),
          ...manyPayments(0, 6, 0),
        ],
        orders: false,
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const { figure } = await openCircle();
    const sent = within(figure).getByRole('list', {
      name: 'Sent to: the most transactions first',
    });
    const labelOf = async (name: RegExp) => {
      const button = await within(sent).findByRole('button', { name }, T);
      // Beside its button: the name and the amount, as drawn.
      const label = button.parentElement?.querySelector(
        ':scope > [aria-hidden="true"]'
      );
      expect(label).toBeInstanceOf(HTMLElement);
      return label as HTMLElement;
    };
    const third = await labelOf(/^\u2068?Third\u2069?, /);
    await waitFor(() => expect(third).toHaveTextContent(/^Third/), T);
    expect(third).toHaveTextContent('(5 Community Garden Allotment Shares)');
    // A line is made for its amount, which goes under the name when both
    // don't fit on one.
    expect(window.getComputedStyle(third).flexWrap).toBe('wrap');
    // The top account's short amount, with room beside its name: one line.
    const top = within(sent).getAllByRole('button')[0];
    const topLabel = top.parentElement?.querySelector(
      ':scope > [aria-hidden="true"]'
    );
    expect(topLabel).toHaveTextContent('(2 QORT)');
    expect(window.getComputedStyle(topLabel as HTMLElement).flexWrap).toBe(
      'nowrap'
    );
    // The drawing was laid out with that second line, not only drawn with it.
    const { calls, results } = vi.mocked(fitCircle).mock;
    const sideLines = calls[calls.length - 1][4];
    const fit = results[results.length - 1].value as CircleFit;
    const placed = (address: string) =>
      fit.layout.placed.find((node) => node.address === address) as PlacedNode;
    expect(sideLines?.(placed(THIRD), fit.width)).toBe(2);
    expect(sideLines?.(placed(`Q${'K'.repeat(31)}11`), fit.width)).toBe(1);
  });

  it('a bottom avatar’s amounts that wrap get the room under it', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      () => 700
    );
    // Second, paid both ways: "88 QORT in, 13,277 out", wider than the 124 px
    // an ordinary window gives a name under a bottom avatar.
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: [
          pay(PUBLISHER, SECOND, 1_500_100, '13277'),
          pay(SECOND, PUBLISHER, 1_500_000, '88'),
        ],
        orders: false,
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const { figure } = await openCircle();
    expect(figure).toHaveTextContent('88 QORT in, 13,277 out');
    // Its name's row and the amount's two rows (20 + 15 × 2), and 16 more.
    expect(window.getComputedStyle(figure).paddingBottom).toBe('66px');
  });

  it('counts a transaction behind two of its links once, as its dialog lists it', async () => {
    // Sponsored, the share not removed, and minting with that share now:
    // the list's two rows (its sponsor, minting with it now) have the same
    // transaction behind them.
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        minting: [SHARE_TO_SECOND, LEVEL_TO_THIRD, SPONSOR_SHARE],
        online: {
          body: [{ minterAddress: SPONSOR, recipientAddress: PUBLISHER }],
        },
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const { panel } = await openCircle();
    const others = within(panel).getByRole('list', {
      name: /^other links: reward shares, minting level, names$/i,
    });
    const chip = await within(others).findByRole(
      'button',
      {
        name: /^\u2068?Sponsor\u2069?, \d+ transactions?: show what links them$/,
      },
      T
    );
    fireEvent.click(chip);
    const opened = await screen.findByRole(
      'dialog',
      { name: /^\u2068?Sponsor\u2069?: other links$/ },
      T
    );
    // Both links behind it, and the one transaction behind both.
    const recorded = within(opened).getByRole('list', {
      name: /^what was recorded between them$/i,
    });
    expect(within(recorded).getAllByRole('listitem')).toHaveLength(2);
    const behind = await within(opened).findByRole(
      'list',
      { name: /^the \d+ transactions? with \u2068?Sponsor\u2069?$/i },
      T
    );
    expect(within(behind).getAllByRole('listitem')).toHaveLength(1);
    // The avatar says as many as the dialog lists.
    expect(chip).toHaveAccessibleName(
      /^\u2068?Sponsor\u2069?, 1 transaction: show what links them$/
    );
  });

  it('counts a trade by its orders, as its dialog lists them, never once each way', async () => {
    // Two trades with Second: two of Publisher's orders, one of Second's.
    routes.push(viewer(LEVEL_FIVE), ...publisherNode({ moreFilled: 1 }));
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const { figure } = await openCircle();
    const second = await within(figure).findByRole(
      'button',
      {
        name: /^\u2068?Second\u2069?, 7 transactions: 1 received \(7 QORT\); 3 sent \(13 QORT\); traded in 3 orders \(got 24 GBQ for 530 QORT\): show what links them$/,
      },
      T
    );
    expect(second.querySelector('[data-count]')).toHaveAttribute(
      'data-count',
      '7'
    );
    fireEvent.click(second);
    const opened = await screen.findByRole(
      'dialog',
      { name: /^Sent to and received from \u2068?Second\u2069?$/ },
      T
    );
    // 7: its 4 payments and the trades' 3 orders.
    const payments = await within(opened).findByRole(
      'list',
      { name: /^the 4 transactions with \u2068?Second\u2069?$/i },
      T
    );
    expect(within(payments).getAllByRole('listitem')).toHaveLength(4);
    expect(
      await within(opened).findByRole(
        'list',
        { name: /^the 3 orders with \u2068?Second\u2069?$/i },
        T
      )
    ).toBeInTheDocument();
  });

  it('pressed again while a search finds nothing, it says nothing matches: never that no account is linked to it', async () => {
    await openPublisher(LEVEL_FIVE);
    const { panel } = await openCircle();
    const field = within(panel).getByRole('textbox', {
      name: /search these connections/i,
    });
    fireEvent.change(field, { target: { value: 'nothing-like-this' } });
    // Every list is in: the search says nothing matched what was typed.
    expect(
      await within(panel).findByText(
        /^Nothing in this account's connections matches/,
        {},
        T
      )
    ).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: /^circle$/i }));
    await waitFor(() =>
      expect(
        within(panel).getByRole('button', { name: /^circle$/i })
      ).toHaveAttribute('aria-pressed', 'true')
    );
    await settle();
    // Four accounts are linked to it; none of them matches the search.
    expect(panel).toHaveTextContent(
      /Nothing to draw: none of its links matches “\u2068?nothing-like-this\u2069?”\./
    );
    expect(panel).not.toHaveTextContent(/no other account is linked to it/);
  });

  it('drawn without a list that couldn’t be read, says so in those words', async () => {
    // Its payments couldn't be read: drawn from the rest, and it says so.
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        payments: () => ({
          status: 500,
          body: { error: 5, message: 'repository issue' },
        }),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const panel = await openConnections();
    await within(panel).findByText(
      /Couldn't read its payments and asset transfers\./,
      {},
      T
    );
    expect(
      await within(panel).findByText(
        "Drawn without the lists that couldn't be read, named above.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/older transactions may link/);
  });

  it('after a Refresh that couldn’t read a list again, says it is drawn from what was read before', async () => {
    let fail = false;
    routes.push(
      (path) =>
        fail && listTypes(path, PUBLISHER) === PAYMENT_KIND.join(',')
          ? { status: 500, body: { error: 5, message: 'repository issue' } }
          : undefined,
      viewer(LEVEL_FIVE),
      ...publisherNode()
    );
    renderWindow();
    await lookUp(PUBLISHER);
    const { panel } = await openCircle();
    await settle();
    expect(within(panel).queryByRole('note')).toBeNull();
    fail = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(panel).findByText(
        "A Refresh couldn't read some of its lists again: drawn from what was read before it.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/older transactions may link/);
    expect(panel).not.toHaveTextContent(/lists that couldn't be read/);
  });

  it('shows the first 20 other links, then “Show all”, reading only the names of those shown', async () => {
    const SELLERS = Array.from(
      { length: 25 },
      (_, i) =>
        `Q${'W'.repeat(31)}${ALPHABET[Math.floor(i / 58)]}${ALPHABET[i % 58]}`
    );
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({
        minting: [],
        online: { body: [] },
        names: SELLERS.map((seller, i) =>
          tx('BUY_NAME', 1_395_000 + i, {
            creatorAddress: PUBLISHER,
            seller,
            name: `Spare ${i}`,
            amount: '5.00000000',
          })
        ),
      })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const { panel } = await openCircle();
    const others = within(panel).getByRole('list', {
      name: /^other links: reward shares, minting level, names$/i,
    });
    expect(within(others).getAllByRole('button')).toHaveLength(20);
    await settle();
    const nameReads = () =>
      new Set(
        calls
          .map(({ path }) => /^\/names\/primary\/(.+)$/.exec(path)?.[1])
          .filter((address) => address && SELLERS.includes(address))
      ).size;
    expect(nameReads()).toBe(20);
    fireEvent.click(
      within(panel).getByRole('button', { name: /^show all 25$/i })
    );
    await waitFor(() =>
      expect(within(others).getAllByRole('button')).toHaveLength(25)
    );
    await waitFor(() => expect(nameReads()).toBe(25));
  });

  it('with only other links drawn, says nothing of avatars and lines that aren’t there', async () => {
    routes.push(
      viewer(LEVEL_FIVE),
      ...publisherNode({ payments: [], orders: false })
    );
    renderWindow();
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const panel = await openConnections();
    const others = await within(panel).findByRole(
      'list',
      { name: /^other links: reward shares, minting level, names$/i },
      T
    );
    expect(within(others).getAllByRole('button').length).toBeGreaterThan(0);
    expect(within(panel).queryByRole('figure')).toBeNull();
    expect(panel).toHaveTextContent('Press one for what links them.');
    expect(panel).not.toHaveTextContent(/the bigger the avatar/i);
    expect(panel).not.toHaveTextContent(
      /at the bottom, accounts paid both ways/i
    );
  });

  it('for a viewer the rule doesn’t let in: no circle, no report, nothing said', async () => {
    await openPublisher(LEVEL_FOUR);
    await settle();
    expect(dialog()).not.toHaveTextContent(/circle|account report/i);
    expect(
      screen.queryByRole('button', { name: /account report/i })
    ).toBeNull();
  });
});
