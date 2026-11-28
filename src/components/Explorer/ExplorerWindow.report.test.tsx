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

const saved = vi.hoisted(() => ({
  files: [] as Array<{ blob: Blob; name: string }>,
  fail: false,
}));
vi.mock('../../utils/generateWallet/generateWallet', () => ({
  saveFileToDiskGeneric: async (blob: Blob, name: string) => {
    if (saved.fail) throw new Error('no disk');
    saved.files.push({ blob, name });
  },
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

// The Account report (PR 4b): a Markdown file of what the Explorer read
// about an account and its connections, saved through Hub; its QORT totals
// only from its whole history, what couldn't be read and what was still
// being read named, late answers dropped, nothing polled. In the window as
// App mounts it, reading a made-up node.

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

/** An answer held back until it is let go. */
function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
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

/** Every transaction it took part in, as the All list has it (newest first). */
const ALL = [...PAID, NAME_BOUGHT, SHARE_TO_SECOND];

/** Its newest and oldest transaction (one row each), its balance and its trades on the Trade Portal. */
function historyRoutes({
  all = ALL,
  balance = 12.5,
}: { all?: Row[]; balance?: number } = {}): Route {
  return (path) => {
    if (path === `/addresses/balance/${PUBLISHER}`) return { body: balance };
    if (path.startsWith('/crosschain/trades?')) return { body: [] };
    if (!path.startsWith('/transactions/search?')) return undefined;
    const query = params(path);
    if (query.get('address') !== PUBLISHER || query.getAll('txType').length)
      return undefined;
    if (query.get('limit') === '1')
      return {
        body: query.get('reverse') === 'true' ? all.slice(0, 1) : all.slice(-1),
      };
    return undefined;
  };
}

/** The report's window, from the Connections tab. */
async function openReport() {
  const panel = await openConnections();
  const button = await within(panel).findByRole(
    'button',
    { name: /^account report$/i },
    T
  );
  fireEvent.click(button);
  return screen.findByRole(
    'dialog',
    { name: /^Account report: Publisher$/ },
    T
  );
}

/** Makes the report (once it has what it needs, unless `now`), and gives its text. */
async function makeReport(window: HTMLElement, now = false) {
  const button = await within(window).findByRole(
    'button',
    { name: now ? /^make the report now$/i : /^make the report$/i },
    T
  );
  fireEvent.click(button);
  const preview = await within(window).findByLabelText(
    /^account-report-Publisher-\d{4}-\d\d-\d\d\.md$/,
    {},
    T
  );
  return preview.textContent ?? '';
}

/** A Blob's text (jsdom's Blob has no text()). */
const blobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

const HEADINGS = [
  '# Account report: Publisher',
  '## Account',
  '## QORT totals',
  '## Activity by type',
  '## Connections',
  '## What was read',
  '## Transactions behind the connections',
];
const headings = (text: string) =>
  text.split('\n').filter((line) => /^#{1,2} /.test(line));

beforeEach(() => {
  saved.files = [];
  saved.fail = false;
});

describe('the Account report', () => {
  it('says what the page read, with its whole history’s QORT totals; saves and copies it; reads nothing more, polls nothing', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    routes.push(historyRoutes());
    await openPublisher(LEVEL_FIVE);
    const window = await openReport();
    expect(
      await within(window).findByText(
        'Its whole history is read: 8 transactions.',
        {},
        T
      )
    ).toBeInTheDocument();
    const text = await makeReport(window);
    expect(headings(text)).toEqual(HEADINGS);
    expect(text).toMatch(/\| Made \| \d{4}-\d\d-\d\d \d\d:\d\d UTC \|/);
    expect(text).toContain(
      '| Its transactions read | its whole history: 8 transactions |'
    );
    // PR 5's figures: its balance less what its whole history moved.
    expect(text).toContain('| QORT minted | 124.57 QORT |');
    expect(text).toContain('| QORT received / sent | 7 / 114 |');
    expect(text).toContain('| QORT purchased / sold | 0 / 0 |');
    expect(text).toContain('| Payment | Payments | 6 |');
    expect(text).toContain('| Name purchase | Names | 1 |');
    // Connections, in the tab's own sentences, with blocks and signatures.
    expect(text).toContain(
      `- Moved its minting level to Third (\`${THIRD}\`) (block 1,390,000, `
    );
    expect(text).toContain(`\`${LEVEL_TO_THIRD.signature}\``);
    expect(text).toContain(
      `- Bought 23 GBQ from Second (\`${SECOND}\`) for 529 QORT (`
    );
    expect(text).toContain(`| \`${SECOND}\` | Second | 3 | 13 |  |`);
    expect(text).toContain(
      `- First QORT payment received: 50 QORT from Funder (\`${FUNDER}\`) (block 1,000,050, `
    );
    expect(text).toContain(
      `Sent 100 QORT to ${EXCHANGE_NAME}, an exchange, in 1 payment (`
    );
    expect(text).toContain(
      '- Read: all 6 of its payments and asset transfers, all 4 of its minting transactions, its only name transaction, and its only filled Q-Asset order.'
    );
    expect(text).not.toMatch(/Couldn't be read|Still being read/);
    // Saved through Hub, as shown.
    const before = calls.length;
    fireEvent.click(
      within(window).getByRole('button', { name: /^save as a Markdown file$/i })
    );
    await waitFor(() => expect(saved.files).toHaveLength(1));
    expect(saved.files[0].name).toMatch(
      /^account-report-Publisher-\d{4}-\d\d-\d\d\.md$/
    );
    expect(await blobText(saved.files[0].blob)).toBe(text);
    expect(
      await within(window).findByText(
        `Sent to be saved as ${saved.files[0].name}.`,
        { selector: '[role="status"]' }
      )
    ).toBeInTheDocument();
    fireEvent.click(within(window).getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    // Nothing more was read for it, and nothing polls.
    await settle();
    await settle();
    expect(calls.length).toBe(before);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('never a whole-history figure from part of it: it says how much was read, and has them once the rest is read', async () => {
    window.localStorage.setItem(
      `explorer-activity-first-read:${READER}`,
      '100'
    );
    const many = Array.from({ length: 150 }, (_, i) =>
      pay(SECOND, PUBLISHER, 1_700_000 - i, '1')
    );
    routes.push(
      list(PUBLISHER, [], many),
      historyRoutes({ all: many, balance: 200 })
    );
    await openPublisher(LEVEL_FIVE);
    const report = await openReport();
    expect(
      await within(report).findByText(
        'Its QORT totals and activity by type need its whole history: its newest 100 transactions have been read so far.',
        {},
        T
      )
    ).toBeInTheDocument();
    const partial = await makeReport(report);
    expect(headings(partial)).toEqual(HEADINGS);
    expect(partial).not.toMatch(/\| QORT (minted|received)/);
    expect(partial).toContain(
      "These add up its whole history, which wasn't read for this report: its newest 100 transactions; any older ones weren't read."
    );
    expect(partial).toContain(
      "This counts its whole history, which wasn't read for this report: its newest 100 transactions; any older ones weren't read."
    );
    fireEvent.click(
      within(report).getByRole('button', { name: /^read the rest$/i })
    );
    expect(
      await within(report).findByText(
        'Its whole history is read: 150 transactions.',
        {},
        T
      )
    ).toBeInTheDocument();
    // Once QORT minted is worked out with it, nothing is still being read.
    await waitFor(
      () => expect(within(report).queryByText(/^Still being read:/)).toBeNull(),
      T
    );
    fireEvent.click(
      within(report).getByRole('button', { name: /^make it again$/i })
    );
    expect(
      within(report).getByLabelText(/^account-report-Publisher-/)
    ).toHaveTextContent('| QORT minted | 50 QORT |');
    const whole =
      within(report).getByLabelText(/^account-report-Publisher-/).textContent ??
      '';
    expect(whole).toContain('| QORT received / sent | 150 / 0 |');
    expect(whole).toContain('| Payment | Payments | 150 |');
  });

  it('names a list that couldn’t be read, and never counts it as checked', async () => {
    routes.push(
      historyRoutes(),
      viewer(LEVEL_FIVE),
      ...publisherNode({
        names: () => ({
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
    const report = await openReport();
    const text = await makeReport(report);
    expect(text).toContain("- Couldn't be read: its name transactions.");
    expect(text).toContain(
      "- Read: all 6 of its payments and asset transfers, all 4 of its minting transactions, its name transactions (couldn't be read), and its only filled Q-Asset order."
    );
    expect(text).not.toMatch(/nothing found:[^\n]*name sales/);
  });

  it('made while something is still being read: it says so, then has it', async () => {
    const held = hold();
    routes.push(historyRoutes(), (path) =>
      path.startsWith('/transactions/payments/between?') &&
      params(path).get('senderAddress')
        ? { body: [], delay: held.until }
        : undefined
    );
    await openPublisher(LEVEL_FIVE);
    const report = await openReport();
    expect(
      await within(report).findByText(
        /^Still being read: its payments to and from exchanges\. A report made now says it doesn't have them\.$/,
        {},
        T
      )
    ).toBeInTheDocument();
    const early = await makeReport(report, true);
    expect(early).toContain(
      '- Still being read when the report was made: its payments to and from exchanges.'
    );
    await act(async () => held.release());
    await waitFor(() =>
      expect(within(report).queryByText(/^Still being read:/)).toBeNull()
    );
    fireEvent.click(
      within(report).getByRole('button', { name: /^make it again$/i })
    );
    await waitFor(() =>
      expect(
        within(report).getByLabelText(/^account-report-Publisher-/)
      ).not.toHaveTextContent('Still being read when the report was made')
    );
  });

  it('an answer that arrives after its window closed is dropped: opened again, it reads on and counts each once', async () => {
    window.localStorage.setItem(
      `explorer-activity-first-read:${READER}`,
      '100'
    );
    const many = Array.from({ length: 150 }, (_, i) =>
      pay(SECOND, PUBLISHER, 1_700_000 - i, '1')
    );
    const held = hold();
    let older = 0;
    routes.push(
      list(PUBLISHER, [], (offset) => {
        if (offset === 0) return { body: many.slice(0, 100) };
        older += 1;
        return {
          body: many.slice(offset, offset + 100),
          ...(older === 1 ? { delay: held.until } : {}),
        };
      }),
      historyRoutes({ all: many, balance: 200 })
    );
    await openPublisher(LEVEL_FIVE);
    let report = await openReport();
    fireEvent.click(
      await within(report).findByRole('button', { name: /^read the rest$/i }, T)
    );
    await waitFor(() => expect(older).toBe(1));
    // Closed while its older page is on its way; the page arrives after.
    fireEvent.click(within(report).getByRole('button', { name: /^close$/i }));
    await waitFor(() => expect(report).not.toBeInTheDocument());
    await act(async () => held.release());
    await settle();
    report = await openReport();
    expect(
      await within(report).findByText(
        'Its whole history is read: 150 transactions.',
        {},
        T
      )
    ).toBeInTheDocument();
    // The late page wasn't taken: its window read it again, and counted each once.
    expect(older).toBe(2);
    const text = await makeReport(report);
    expect(text).toContain('its whole history: 150 transactions');
  });

  it('opened just after a Refresh: the newest pages its lists read again are still being read, never taken as read', async () => {
    const held = hold();
    let holding = false;
    routes.push(historyRoutes(), (path) =>
      holding &&
      listTypes(path, PUBLISHER) === PAYMENT_KIND.join(',') &&
      params(path).get('offset') === '0'
        ? { body: PAID, delay: held.until }
        : undefined
    );
    await openPublisher(LEVEL_FIVE);
    const panel = await openConnections();
    await within(panel).findByRole('button', { name: /^account report$/i }, T);
    await settle();
    holding = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    const report = await openReport();
    expect(
      await within(report).findByText(
        /^Still being read: .*newer transactions of its lists, after a Refresh.*\. A report made now says it doesn't have them\.$/,
        {},
        T
      )
    ).toBeInTheDocument();
    const early = await makeReport(report, true);
    expect(
      early
        .split('\n')
        .find((line) =>
          line.startsWith('- Still being read when the report was made:')
        )
    ).toContain('newer transactions of its lists, after a Refresh');
    await act(async () => held.release());
    await waitFor(() =>
      expect(
        within(report).queryByText(
          /^Still being read: .*newer transactions of its lists/
        )
      ).toBeNull()
    );
  });

  it('its newest transactions read again while it is open (a newer one on the node): never “its whole history” over them', async () => {
    const NEWER = pay(SECOND, PUBLISHER, 1_600_100, '1');
    const held = hold();
    let reads = 0;
    routes.push(
      // Its All list as first read; read again, the newer one with it, held back.
      list(PUBLISHER, [], (offset) => {
        if (offset > 0) return { body: [] };
        reads += 1;
        return reads === 1
          ? { body: ALL }
          : { body: [NEWER, ...ALL], delay: held.until };
      }),
      // The node has the newer one already.
      historyRoutes({ all: [NEWER, ...ALL], balance: 13.5 })
    );
    await openPublisher(LEVEL_FIVE);
    const report = await openReport();
    expect(
      await within(report).findByText(
        'Reading its newest transactions again: its QORT totals and activity by type wait for them.',
        {},
        T
      )
    ).toBeInTheDocument();
    expect(report).not.toHaveTextContent(/Its whole history is read/);
    const early = await makeReport(report, true);
    expect(early).not.toMatch(/its whole history: /);
    expect(early).toContain(
      '| Its transactions read | 8 transactions read; its newest were being read again |'
    );
    expect(early).not.toMatch(/\| QORT (minted|received)/);
    expect(
      early
        .split('\n')
        .find((line) =>
          line.startsWith('- Still being read when the report was made:')
        )
    ).toContain('its newest transactions');
    await act(async () => held.release());
    expect(
      await within(report).findByText(
        'Its whole history is read: 9 transactions.',
        {},
        T
      )
    ).toBeInTheDocument();
  });

  it('a save that fails says so', async () => {
    saved.fail = true;
    routes.push(historyRoutes());
    await openPublisher(LEVEL_FIVE);
    const report = await openReport();
    await makeReport(report);
    fireEvent.click(
      within(report).getByRole('button', { name: /^save as a Markdown file$/i })
    );
    expect(
      await within(report).findByText("Couldn't save it.", {
        selector: '[role="status"]',
      })
    ).toBeInTheDocument();
  });
});
