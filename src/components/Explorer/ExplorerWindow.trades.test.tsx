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
import { NULL_ACCOUNT } from '../../lib/explorer/reads';
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The Trades tab, only for a viewer the level 5+ rule lets in, in the
// window as App mounts it, reading a made-up node. Publisher sold QORT 10
// times on the Trade Portal (8 for Litecoin, 1 Dogecoin, 1 Bitcoin; 740
// QORT) and bought it twice (Litecoin, DigiByte; 85 QORT). Of its 12 trade
// offers 10 sold, 1 ended without a trade and 1 is open (30 QORT). In
// Q-Assets: it sold 23 GBQ to Second for 529 QORT and bought 4 from Third
// for 100. Third has no public key: its purchase is found from the
// contract that paid it.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const THIRD = `Q${'T'.repeat(33)}`;
const PUBLISHER_KEY = 'p'.repeat(44);
const SECOND_KEY = 's'.repeat(44);

const NAMES: Record<string, string> = {
  [PUBLISHER]: 'Publisher',
  [SECOND]: 'Second',
  [THIRD]: 'Third',
};

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A contract's address of its own for each number. */
const at = (n: number) =>
  `A${'z'.repeat(31)}${B58[Math.floor(n / 58)]}${B58[n % 58]}`;

type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const when = (month: number, day = 10) => Date.UTC(2026, month - 1, day, 12);

interface Trade {
  chain: string;
  side: 'sold' | 'bought';
  qort: string;
  coin: string;
  at: string;
  other: string;
  timestamp: number;
}

const SALES: Trade[] = [
  {
    chain: 'LITECOIN',
    side: 'sold',
    qort: '100',
    coin: '0.3',
    at: at(1),
    other: SECOND,
    timestamp: when(1),
  },
  {
    chain: 'LITECOIN',
    side: 'sold',
    qort: '200',
    coin: '0.6',
    at: at(2),
    other: SECOND,
    timestamp: when(2),
  },
  {
    chain: 'LITECOIN',
    side: 'sold',
    qort: '50',
    coin: '0.15',
    at: at(3),
    other: THIRD,
    timestamp: when(3),
  },
  ...[4, 5, 6, 7, 8].map((n) => ({
    chain: 'LITECOIN',
    side: 'sold' as const,
    qort: '10',
    coin: '0.03',
    at: at(n),
    other: THIRD,
    timestamp: when(n - 1, 20),
  })),
  {
    chain: 'DOGECOIN',
    side: 'sold',
    qort: '40',
    coin: '100',
    at: at(9),
    other: SECOND,
    timestamp: when(5, 15),
  },
  {
    chain: 'BITCOIN',
    side: 'sold',
    qort: '300',
    coin: '0.002',
    at: at(10),
    other: THIRD,
    timestamp: when(6, 25),
  },
];
const BUYS: Trade[] = [
  {
    chain: 'LITECOIN',
    side: 'bought',
    qort: '25',
    coin: '0.08',
    at: at(20),
    other: SECOND,
    timestamp: when(7, 1),
  },
  {
    chain: 'DIGIBYTE',
    side: 'bought',
    qort: '60',
    coin: '300',
    at: at(21),
    other: THIRD,
    timestamp: when(8, 1),
  },
];

/** As /crosschain/trades answers a trade, from the seller's or the buyer's side. */
const summaryRow = (trade: Trade) => ({
  tradeTimestamp: trade.timestamp,
  qortAmount: trade.qort,
  btcAmount: trade.coin,
  foreignAmount: trade.coin,
  atAddress: trade.at,
  sellerAddress: trade.side === 'sold' ? PUBLISHER : trade.other,
  buyerReceivingAddress: trade.side === 'sold' ? trade.other : PUBLISHER,
});

const CODE: Record<string, string> = {
  LITECOIN: 'LTC',
  DOGECOIN: 'DOGE',
  BITCOIN: 'BTC',
  DIGIBYTE: 'DGB',
};

let sigs = 0;
const deploy = (
  contract: string,
  chain: string,
  amount: string,
  timestamp: number
) => ({
  type: 'DEPLOY_AT',
  timestamp,
  signature: `deploy${(sigs += 1)}`,
  blockHeight: 1_000 + sigs,
  creatorAddress: PUBLISHER,
  aTType: 'ACCT',
  tags: `ACCT QORT ${CODE[chain]}`,
  amount,
  aTAddress: contract,
});

const payout = (
  contract: string,
  amount: string,
  timestamp: number,
  recipient = PUBLISHER
) => ({
  type: 'AT',
  timestamp,
  signature: `payout${(sigs += 1)}`,
  blockHeight: 2_000 + sigs,
  creatorAddress: NULL_ACCOUNT,
  recipient,
  atAddress: contract,
  amount,
  assetId: 0,
});

// Its offers: the ten that sold, one cancelled (paid back), one still open.
const OFFERS = [
  ...SALES.map((sale) =>
    deploy(sale.at, sale.chain, sale.qort, sale.timestamp - 86_400_000)
  ),
  deploy(at(11), 'LITECOIN', '80.01', when(4, 1)),
  deploy(at(12), 'DOGECOIN', '30.01', when(8, 5)),
].sort((a, b) => b.timestamp - a.timestamp);
const PAYOUTS = [
  ...SALES.map((sale) => payout(sale.at, '0.00999', sale.timestamp + 1)),
  payout(at(11), '80.00', when(4, 15)),
  // Its purchases: the sellers' contracts paid it.
  payout(at(20), '25', when(7, 1)),
  payout(at(21), '60', when(8, 1)),
].sort((a, b) => b.timestamp - a.timestamp);

const order = (n: number, have: number, want: number, fulfilled: string) => ({
  orderId: `${'o'.repeat(86)}${B58[n]}${B58[n]}`,
  creator: PUBLISHER,
  haveAssetId: have,
  haveAssetName: have ? 'GBQ' : 'QORT',
  wantAssetId: want,
  wantAssetName: want ? 'GBQ' : 'QORT',
  fulfilled,
  timestamp: when(n + 1),
});
const SELL_ORDER = order(1, 28, 0, '23.00000000');
const BUY_ORDER = order(2, 0, 28, '4.00000000');
const OTHER_ORDER = (n: number) => `${'q'.repeat(86)}${B58[n]}${B58[n]}`;

interface Node {
  trades?: 'failing' | 'empty';
  /** Its DEPLOY_AT transactions (its trade offers) can't be read. */
  offers?: 'failing';
  /** Its Q-Asset orders can't be read. */
  assets?: 'failing';
  /** A side and chain held back until let go. */
  hold?: Promise<void>;
}

function account(address: string, extra: Record<string, unknown> = {}) {
  return {
    address,
    reference: 'ref',
    publicKey:
      address === PUBLISHER
        ? PUBLISHER_KEY
        : address === SECOND
          ? SECOND_KEY
          : null,
    level: 3,
    blocksMinted: 1_000,
    blocksMintedAdjustment: 0,
    blocksMintedPenalty: 0,
    ...extra,
  };
}

function tradesNode(node: Node = {}): Route {
  return (path) => {
    for (const [address, name] of Object.entries(NAMES)) {
      if (path === `/addresses/${address}`) return { body: account(address) };
      if (path === `/names/primary/${address}`)
        return { body: { name, owner: address } };
      if (path.startsWith(`/names/address/${address}`))
        return { body: [{ name, owner: address }] };
      if (path === `/groups/member/${address}`) return { body: [] };
    }
    // A contract's own account (its AT page).
    if (/^\/addresses\/A[1-9A-HJ-NP-Za-km-z]{33}$/.test(path))
      return {
        body: account(path.slice('/addresses/'.length), { publicKey: null }),
      };
    if (path.startsWith('/crosschain/trades?')) {
      if (node.trades === 'failing')
        return { status: 500, body: { error: 5, message: 'repository issue' } };
      const query = params(path);
      const chain = query.get('foreignBlockchain');
      if (
        query.get('sellerPublicKey') === PUBLISHER_KEY &&
        node.trades !== 'empty'
      )
        return {
          // Without a chain: every chain at once, as Core answers.
          body: SALES.filter((trade) => !chain || trade.chain === chain).map(
            summaryRow
          ),
          delay: node.hold,
        };
      if (
        query.get('buyerPublicKey') === PUBLISHER_KEY &&
        node.trades !== 'empty'
      )
        return {
          body: BUYS.filter((trade) => !chain || trade.chain === chain).map(
            summaryRow
          ),
        };
      return { body: [] };
    }
    if (path.startsWith('/crosschain/trade/')) {
      const contract = decodeURIComponent(
        path.slice('/crosschain/trade/'.length)
      );
      if (contract === at(30))
        return {
          body: {
            qortalAtAddress: at(30),
            qortalCreator: SECOND,
            qortAmount: '10.00000000',
            expectedForeignAmount: '0.03900000',
            mode: 'REDEEMED',
            qortalPartnerReceivingAddress: THIRD,
            foreignBlockchain: 'LITECOIN',
          },
        };
      // A lottery: not a trade contract.
      return {
        status: 400,
        body: { error: 125, message: 'invalid search criteria' },
      };
    }
    if (path.startsWith('/transactions/search?')) {
      const query = params(path);
      const address = query.get('address');
      const type = query.get('txType');
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 100);
      if (node.offers === 'failing' && type === 'DEPLOY_AT')
        return { status: 500, body: { error: 5, message: 'repository issue' } };
      if (address === PUBLISHER && type === 'DEPLOY_AT')
        return { body: OFFERS.slice(offset, offset + limit) };
      if (address === PUBLISHER && type === 'AT')
        return { body: PAYOUTS.slice(offset, offset + limit) };
      if (address === THIRD && type === 'AT')
        return {
          body: [
            payout(at(30), '10.00000000', when(9, 1), THIRD),
            payout(at(31), '1.00000000', when(8, 1), THIRD),
          ].slice(offset, offset + limit),
        };
      return { body: [] };
    }
    if (node.assets === 'failing' && path.startsWith('/assets/orders/'))
      return { status: 500, body: { error: 5, message: 'repository issue' } };
    if (path.startsWith(`/assets/orders/${PUBLISHER}?`)) {
      const query = params(path);
      if (
        query.get('includeClosed') === 'true' &&
        query.get('includeFulfilled') === 'true' &&
        query.get('limit') !== '1'
      )
        return { body: [BUY_ORDER, SELL_ORDER] };
      return { body: [] };
    }
    if (path.startsWith('/assets/orders/')) return { body: [] };
    // Its sell order came in against Second's waiting buy order; Third's sell
    // order came in against its waiting buy order. Core labels both the
    // wrong way round (the initiating order sells an asset for QORT).
    if (path.startsWith(`/assets/order/${SELL_ORDER.orderId}/trades?`))
      return {
        body: [
          {
            initiatingOrderId: SELL_ORDER.orderId,
            targetOrderId: OTHER_ORDER(1),
            initiatorAmount: '23.00000000',
            initiatorAmountAssetId: 0,
            initiatorAmountAssetName: 'QORT',
            targetAmount: '529.00000000',
            targetAmountAssetId: 28,
            targetAmountAssetName: 'GBQ',
            timestamp: when(9, 5),
          },
        ],
      };
    if (path.startsWith(`/assets/order/${BUY_ORDER.orderId}/trades?`))
      return {
        body: [
          {
            initiatingOrderId: OTHER_ORDER(2),
            targetOrderId: BUY_ORDER.orderId,
            initiatorAmount: '4.00000000',
            initiatorAmountAssetId: 0,
            initiatorAmountAssetName: 'QORT',
            targetAmount: '100.00000000',
            targetAmountAssetId: 28,
            targetAmountAssetName: 'GBQ',
            timestamp: when(9, 3),
          },
        ],
      };
    if (path === `/assets/order/${OTHER_ORDER(1)}`)
      return { body: { creator: SECOND } };
    if (path === `/assets/order/${OTHER_ORDER(2)}`)
      return { body: { creator: THIRD } };
    if (path.startsWith('/assets/')) return { body: [] };
    if (path.startsWith('/arbitrary/resources/search?')) return { body: [] };
    return undefined;
  };
}

const minterGroup = {
  groupId: 694,
  groupName: 'MINTER',
  owner: NULL_ACCOUNT,
  isOpen: false,
  memberCount: 600,
  isAdmin: false,
};

/** The Hub account looking, at level 5 or 4, a MINTER member. */
function viewer(level: number): Route {
  return (path) => {
    if (path === `/addresses/${READER}`)
      return { body: account(READER, { level }) };
    if (path === `/groups/member/${READER}`) return { body: [minterGroup] };
    return undefined;
  };
}

const commonRoutes: Route = (path) => {
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/transactions/')) return { body: [] };
  if (path.startsWith('/addresses/balance/')) return { body: '50.00000000' };
  if (path.startsWith('/blocks/')) return { body: [] };
  if (path === '/admin/status') return { body: { height: 2_000_500 } };
  if (path === '/admin/info')
    return { body: { currentTimestamp: 2_000_000_000_000 } };
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

const dialog = () => screen.getAllByRole('dialog')[0];
const T = { timeout: 4000 };

async function openAccount(
  level: number,
  address = PUBLISHER,
  node: Node = {}
) {
  routes.push(viewer(level), tradesNode(node));
  renderWindow();
  await lookUp(address);
  await within(dialog()).findByRole('heading', {
    level: 2,
    name: NAMES[address],
  });
}

async function openTradesTab() {
  fireEvent.click(
    await within(dialog()).findByRole('tab', { name: /^trades$/i }, T)
  );
  return within(dialog()).findByRole('tabpanel', { name: /trades/i });
}

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 60)));

/** A summary figure, by its label. */
const stat = (panel: HTMLElement, label: RegExp) =>
  within(panel).getByText(label, { selector: 'dt' })
    .parentElement as HTMLElement;

/** Reads only the Trades tab makes. */
const tradesReads = () =>
  calls.filter(
    ({ path }) =>
      path.startsWith('/crosschain/') ||
      (path.startsWith('/transactions/search?') &&
        ['DEPLOY_AT', 'AT'].includes(params(path).get('txType') ?? ''))
  );

beforeEach(() => {
  routes = [];
  calls = [];
  sigs = 0;
  window.localStorage.clear();
  stubNode();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('who sees the Trades tab', () => {
  it('a MINTER member at level 4: no tab, nothing of it read, nothing said', async () => {
    await openAccount(4);
    await waitFor(() =>
      expect(
        calls.some(({ path }) => path.startsWith('/groups/members/1?'))
      ).toBe(true)
    );
    await settle();
    const tabs = within(dialog()).getByRole('tablist', {
      name: /account sections/i,
    });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['Overview', 'Transactions', 'Assets', 'Names']);
    expect(dialog()).not.toHaveTextContent(/trade portal|trades/i);
    expect(tradesReads()).toEqual([]);
  });

  it('a MINTER member at level 5 sees it, between Transactions and Assets', async () => {
    await openAccount(5);
    await openTradesTab();
    const tabs = within(dialog()).getByRole('tablist', {
      name: /account sections/i,
    });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual([
      'Overview',
      'Connections',
      'Transactions',
      'Trades',
      'Assets',
      'Names',
    ]);
  });
});

describe('the Trades tab', () => {
  it('sums up its trades: QORT sold and bought, its offers, its Q-Asset trades', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort sold on the trade portal$/i)
        ).toHaveTextContent('740.00 QORT10 trades'),
      T
    );
    expect(stat(panel, /^qort bought on the trade portal$/i)).toHaveTextContent(
      '85.00 QORT2 trades'
    );
    await waitFor(
      () =>
        expect(stat(panel, /^trade offers made$/i)).toHaveTextContent(
          '1210 completed · 1 ended without a trade · 1 open'
        ),
      T
    );
    await waitFor(
      () =>
        expect(stat(panel, /^q-asset trades$/i)).toHaveTextContent(
          '2paid 100.00 QORT · got 529.00 QORT'
        ),
      T
    );
    expect(panel).toHaveTextContent(
      /On the Trade Portal from .+ to .+\. With 2 accounts\./
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('the Overview reads its trades twice, every chain at once; only the Trades tab reads which coin each was for', async () => {
    await openAccount(5);
    const glance = await within(dialog()).findByRole(
      'region',
      { name: /at a glance/i },
      T
    );
    await waitFor(
      () =>
        expect(
          within(glance).getByText(/^qort purchased \/ sold$/i, {
            selector: 'dt',
          }).parentElement
        ).toHaveTextContent('85.00 / 740.00 QORT'),
      T
    );
    await settle();
    const portalReads = () =>
      calls
        .filter(({ path }) => path.startsWith('/crosschain/trades?'))
        .map(({ path }) => path);
    // One a side, on every chain: the totals need no chain.
    expect(portalReads()).toHaveLength(2);
    expect(
      portalReads().filter((path) => params(path).has('foreignBlockchain'))
    ).toEqual([]);
    const panel = await openTradesTab();
    await waitFor(() => expect(portalReads().length).toBeGreaterThan(2), T);
    // The two are shared; the coins take one more a side and chain.
    await within(panel).findByRole(
      'list',
      { name: /its trade portal trades, newest first/i },
      T
    );
    await waitFor(() => expect(portalReads()).toHaveLength(14), T);
  });

  it('reads each chain on each side once for the coins, without a limit, and its offers and payouts by type', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(stat(panel, /^trade offers made$/i)).toHaveTextContent(
          /completed/
        ),
      T
    );
    await waitFor(
      () =>
        expect(
          calls.filter(({ path }) => params(path).has('foreignBlockchain'))
        ).toHaveLength(12),
      T
    );
    const reads = calls
      .filter(({ path }) => path.startsWith('/crosschain/trades?'))
      .map(({ path }) => path);
    // Two on every chain at once (the totals, the trades), twelve for the coins.
    expect(reads).toHaveLength(14);
    for (const chain of [
      'LITECOIN',
      'BITCOIN',
      'DIGIBYTE',
      'DOGECOIN',
      'RAVENCOIN',
      'PIRATECHAIN',
    ])
      for (const side of ['sellerPublicKey', 'buyerPublicKey'])
        expect(
          reads.filter(
            (path) =>
              params(path).get('foreignBlockchain') === chain &&
              params(path).has(side)
          )
        ).toHaveLength(1);
    expect(
      reads.filter(
        (path) => params(path).has('limit') || params(path).has('offset')
      )
    ).toEqual([]);
    const typed = calls.filter(
      ({ path }) =>
        path.startsWith('/transactions/search?') &&
        params(path).get('address') === PUBLISHER
    );
    expect(
      typed.filter(({ path }) => params(path).get('txType') === 'DEPLOY_AT')
    ).toHaveLength(1);
    expect(
      typed.filter(({ path }) => params(path).get('txType') === 'AT')
    ).toHaveLength(1);
  });

  it('a trade no chain it knows claims is another coin, never left out, and its note says so', async () => {
    // A sale on a chain this list doesn't have: Core lists it on every
    // chain at once, and no chain's own read claims it.
    const other = {
      chain: 'MONERO',
      side: 'sold' as const,
      qort: '5',
      coin: '0.4',
      at: at(40),
      other: SECOND,
      timestamp: when(9, 20),
    };
    routes.push((path) =>
      path.startsWith('/crosschain/trades?') &&
      params(path).get('sellerPublicKey') === PUBLISHER_KEY &&
      !params(path).has('foreignBlockchain')
        ? { body: [...SALES, other].map(summaryRow) }
        : undefined
    );
    await openAccount(5);
    const panel = await openTradesTab();
    const list = await within(panel).findByRole(
      'list',
      { name: /its trade portal trades, newest first/i },
      T
    );
    await waitFor(
      () =>
        expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
          /^outgoingSold 5 QORT for 0\.4 of another coin to Second/i
        ),
      T
    );
    // Its QORT is in the totals.
    expect(stat(panel, /^qort sold on the trade portal$/i)).toHaveTextContent(
      '745.00 QORT11 trades'
    );
    const byCoin = within(panel).getByRole('region', { name: /^by coin$/i });
    expect(
      within(byCoin).getByRole('heading', { name: 'Another coin' })
    ).toBeInTheDocument();
    expect(byCoin).toHaveTextContent(
      'A trade that no chain the Explorer knows claims is counted as another coin.'
    );
  });

  it('which coin each was for can fail on its own: the trades still show, with the failure and Retry', async () => {
    const state = { failing: true };
    routes.push((path) =>
      state.failing &&
      path.startsWith('/crosschain/trades?') &&
      params(path).get('foreignBlockchain') === 'DOGECOIN'
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    await openAccount(5);
    const panel = await openTradesTab();
    const failed = await within(panel).findByText(
      "Which coin each trade was for couldn't be read.",
      {},
      T
    );
    // The trades and their totals don't depend on it.
    expect(stat(panel, /^qort sold on the trade portal$/i)).toHaveTextContent(
      '740.00 QORT10 trades'
    );
    const list = within(panel).getByRole('list', {
      name: /its trade portal trades, newest first/i,
    });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      /^incomingBought 60 QORT for 300 from Third/i
    );
    // No coin is guessed.
    expect(panel).not.toHaveTextContent(/another coin/i);
    state.failing = false;
    fireEvent.click(
      within(failed.parentElement as HTMLElement).getByRole('button', {
        name: /retry/i,
      })
    );
    await waitFor(
      () =>
        expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
          /^incomingBought 60 QORT for 300 DGB from Third/i
        ),
      T
    );
  });

  it('lists its Trade Portal trades newest first, 10 at a time, by side and by coin', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    const list = await within(panel).findByRole(
      'list',
      { name: /its trade portal trades, newest first/i },
      T
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    // Its newest: it bought 60 QORT for 300 DGB from Third.
    await waitFor(
      () =>
        expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
          /^incomingBought 60 QORT for 300 DGB from Third/i
        ),
      T
    );
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      '5 DGB per QORT'
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: /^show 2 more$/i })
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    fireEvent.click(
      within(panel).getByRole('button', { name: /^bought \(2\)$/i })
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(
      within(panel).getByRole('button', { name: /^sold \(10\)$/i })
    );
    fireEvent.mouseDown(
      within(panel).getByRole('combobox', { name: /^coin$/i })
    );
    fireEvent.click(await screen.findByRole('option', { name: /dogecoin/i }));
    const doge = within(list).getAllByRole('listitem');
    expect(doge).toHaveLength(1);
    expect(doge[0]).toHaveTextContent(
      /^outgoingSold 40 QORT for 100 DOGE to Second/i
    );
    // Its AT opens in the Explorer.
    fireEvent.click(within(doge[0]).getByRole('button', { name: /its at/i }));
    expect(
      await within(dialog()).findByRole('heading', { name: /^at address$/i }, T)
    ).toBeInTheDocument();
  });

  it('breaks the QORT it sold down by coin, with each coin’s part', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    const key = await within(panel).findByRole(
      'list',
      { name: /the qort it sold, by the coin it got/i },
      T
    );
    const parts = within(key)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.split(' · ')[0]);
    // 400 of 740 for Litecoin, 300 for Bitcoin, 40 for Dogecoin.
    expect(parts).toEqual(['Litecoin 54%', 'Bitcoin 41%', 'Dogecoin 5.4%']);
    expect(within(key).getAllByRole('listitem')[0]).toHaveTextContent(
      '400.00 QORT for 1.2 LTC'
    );
    const byCoin = within(panel).getByRole('region', { name: /^by coin$/i });
    expect(
      within(byCoin).getByRole('heading', { name: 'DigiByte (DGB)' })
    ).toBeInTheDocument();
  });

  it('while which coin each was for is read, the trades show and the by-coin part says so', async () => {
    let letGo = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    // Its reads per chain wait; its reads of every chain at once don't.
    const node = tradesNode();
    routes.push((path) => {
      if (
        !path.startsWith('/crosschain/trades?') ||
        !params(path).get('foreignBlockchain')
      )
        return undefined;
      const answer = node(path);
      return answer && { ...answer, delay: held };
    });
    await openAccount(5);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort sold on the trade portal$/i)
        ).toHaveTextContent('740.00 QORT10 trades'),
      T
    );
    const byCoin = within(panel).getByRole('region', { name: /^by coin$/i });
    expect(
      within(byCoin).getByText('Reading which coin each trade was for')
    ).toBeInTheDocument();
    // No coin is guessed meanwhile: the chart's bars are each a coin not known yet.
    expect(panel).not.toHaveTextContent(/another coin/i);
    const chart = within(panel).getByRole('group', {
      name: /qort sold and bought on the trade portal, by month/i,
    });
    expect(
      chart.querySelectorAll('svg rect[data-coin="unknown"]').length
    ).toBeGreaterThan(0);
    expect(
      chart.querySelectorAll('svg rect[data-coin="LITECOIN"]')
    ).toHaveLength(0);
    letGo();
    expect(
      await within(panel).findByRole(
        'list',
        { name: /the qort it sold, by the coin it got/i },
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(
      'Reading which coin each trade was for'
    );
  });

  it('counts its offers by coin and how each ended', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    const offers = await within(panel).findByRole(
      'region',
      { name: /trade offers it made/i },
      T
    );
    const rows = within(
      within(offers).getByRole('list', { name: /trade offers by coin/i })
    ).getAllByRole('listitem');
    expect(rows.map((li) => li.textContent)).toEqual([
      'Litecoin9 offers: 8 completed · 1 ended without a trade',
      'Bitcoin1 offer: 1 completed',
      'Dogecoin2 offers: 1 completed · 1 open',
    ]);
    expect(offers).toHaveTextContent(
      'In all, 12 offers. Of those no longer open, 91% sold. Its open offer holds 30.01 QORT.'
    );
  });

  it('shows its trades over time, as an SVG chart with keys, and as a table', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    const chart = await within(panel).findByRole(
      'group',
      { name: /qort sold and bought on the trade portal, by month/i },
      T
    );
    // From its first trade's month to its latest's, every month.
    expect(chart.querySelectorAll('svg g[data-period]')).toHaveLength(8);
    expect(
      chart.querySelectorAll('svg rect[data-coin="LITECOIN"]').length
    ).toBeGreaterThan(0);
    const now = () => within(panel).getByText(/: sold .*; bought .*\.$/);
    expect(now()).toHaveTextContent(
      /^Aug 2026: sold none; bought 60.00 QORT in 1 trade for DGB\.$/
    );
    chart.focus();
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(now()).toHaveTextContent(
      /^Jan 2026: sold 100.00 QORT in 1 trade for LTC; bought none\.$/
    );
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(now()).toHaveTextContent(/^Feb 2026:/);
    fireEvent.click(
      within(panel).getByRole('button', { name: /show as a table/i })
    );
    const table = within(panel).getByRole('table', { name: /by month/i });
    expect(within(table).getAllByRole('row').length).toBe(9);
  });

  it('the table gives each side’s coins; the period picked stays with the step', async () => {
    await openAccount(5);
    let panel = await openTradesTab();
    let chart = await within(panel).findByRole(
      'group',
      { name: /qort sold and bought on the trade portal, by month/i },
      T
    );
    await waitFor(
      () =>
        expect(
          chart.querySelectorAll('svg rect[data-coin="LITECOIN"]').length
        ).toBeGreaterThan(0),
      T
    );
    const now = () => within(panel).getByText(/: sold .*; bought .*\.$/);
    chart.focus();
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(now()).toHaveTextContent(/^Jan 2026:/);
    // Another tab and back: the step keeps the period picked.
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    panel = await openTradesTab();
    chart = await within(panel).findByRole(
      'group',
      { name: /qort sold and bought on the trade portal, by month/i },
      T
    );
    expect(now()).toHaveTextContent(/^Jan 2026:/);
    fireEvent.click(
      within(panel).getByRole('button', { name: /show as a table/i })
    );
    const table = within(panel).getByRole('table', { name: /by month/i });
    // May 2026: 40 QORT sold for Dogecoin and 10 for Litecoin.
    const may = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.startsWith('May 2026')) as HTMLElement;
    expect(may).toHaveTextContent('LTC 10.00 QORT and DOGE 40.00 QORT');
  });

  it('a trade Core gave no time: “time not known” in the list, in no bar, and said under the chart', async () => {
    const untimed = {
      chain: 'LITECOIN',
      side: 'sold' as const,
      qort: '5',
      coin: '0.015',
      at: at(41),
      other: SECOND,
      timestamp: 0,
    };
    routes.push((path) =>
      path.startsWith('/crosschain/trades?') &&
      params(path).get('sellerPublicKey') === PUBLISHER_KEY
        ? {
            body: [...SALES, untimed]
              .filter(
                (trade) =>
                  !params(path).has('foreignBlockchain') ||
                  trade.chain === params(path).get('foreignBlockchain')
              )
              .map(summaryRow),
          }
        : undefined
    );
    await openAccount(5);
    const panel = await openTradesTab();
    expect(
      await within(panel).findByText(
        "1 trade Core gave no time isn't in the chart.",
        {},
        T
      )
    ).toBeInTheDocument();
    // Never 1970: its first trade is still January 2026's.
    expect(panel).not.toHaveTextContent(/1970/);
    expect(panel).toHaveTextContent(/On the Trade Portal from Jan/);
    const list = within(panel).getByRole('list', {
      name: /its trade portal trades, newest first/i,
    });
    fireEvent.click(
      within(panel).getAllByRole('button', { name: /^show \d+ more$/i })[0]
    );
    await waitFor(
      () =>
        expect(
          within(list).getAllByRole('listitem').slice(-1)[0]
        ).toHaveTextContent(
          /Sold 5 QORT for 0\.015 LTC to Second.*time not known/
        ),
      T
    );
  });

  it('a trade between two of its own orders is left out, and said so; one asset for another has a neutral mark', async () => {
    const SWAP = {
      ...order(3, 28, 30, '5.00000000'),
      wantAssetName: 'LTQ',
    };
    const SELF = order(4, 28, 0, '2.00000000');
    routes.push((path) => {
      if (path.startsWith(`/assets/orders/${PUBLISHER}?`)) {
        const query = params(path);
        if (
          query.get('includeClosed') === 'true' &&
          query.get('includeFulfilled') === 'true' &&
          query.get('limit') !== '1'
        )
          return { body: [BUY_ORDER, SELL_ORDER, SWAP, SELF] };
        return { body: [] };
      }
      if (path.startsWith(`/assets/order/${SWAP.orderId}/trades?`))
        return {
          body: [
            {
              initiatingOrderId: SWAP.orderId,
              targetOrderId: OTHER_ORDER(3),
              initiatorAmount: '5.00000000',
              initiatorAmountAssetId: 28,
              initiatorAmountAssetName: 'GBQ',
              targetAmount: '1.00000000',
              targetAmountAssetId: 30,
              targetAmountAssetName: 'LTQ',
              timestamp: when(9, 8),
            },
          ],
        };
      if (path.startsWith(`/assets/order/${SELF.orderId}/trades?`))
        return {
          body: [
            {
              initiatingOrderId: SELF.orderId,
              targetOrderId: OTHER_ORDER(4),
              initiatorAmount: '2.00000000',
              initiatorAmountAssetId: 0,
              initiatorAmountAssetName: 'QORT',
              targetAmount: '40.00000000',
              targetAmountAssetId: 28,
              targetAmountAssetName: 'GBQ',
              timestamp: when(9, 9),
            },
          ],
        };
      if (path === `/assets/order/${OTHER_ORDER(3)}`)
        return { body: { creator: SECOND } };
      // Its own other order: a trade with itself.
      if (path === `/assets/order/${OTHER_ORDER(4)}`)
        return { body: { creator: PUBLISHER } };
      return undefined;
    });
    await openAccount(5);
    const panel = await openTradesTab();
    const list = await within(panel).findByRole(
      'list',
      { name: /its q-asset trades, newest first/i },
      T
    );
    const items = within(list).getAllByRole('listitem');
    // The trade with itself (the newest) isn't one of them.
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      /^traded for another assetTraded 5 GBQ for 1 LTQ with Second/i
    );
    expect(items[1]).toHaveTextContent(/^incomingSold 23 GBQ to Second/i);
    expect(panel).toHaveTextContent(
      "1 trade between two of its own orders isn't counted."
    );
    expect(stat(panel, /^q-asset trades$/i)).toHaveTextContent(
      /^q-asset trades3/i
    );
  });

  it('adds up its Q-Asset trades by asset, each side from its own order, and lists them', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    const byAsset = await within(panel).findByRole(
      'region',
      { name: /^by q-asset$/i },
      T
    );
    const gbq = within(byAsset)
      .getByRole('heading', { name: 'GBQ' })
      .closest('li') as HTMLElement;
    expect(gbq).toHaveTextContent('Bought4 for 100.00 QORT · 25 QORT each');
    expect(gbq).toHaveTextContent('Sold23 for 529.00 QORT · 23 QORT each');
    const list = within(panel).getByRole('list', {
      name: /its q-asset trades, newest first/i,
    });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    await waitFor(
      () =>
        expect(items[0]).toHaveTextContent(
          /Sold 23 GBQ to Second for 529 QORT/
        ),
      T
    );
    expect(items[1]).toHaveTextContent(/Bought 4 GBQ from Third for 100 QORT/);
    expect(panel).toHaveTextContent(
      'Read: all 2 of its filled Q-Asset orders.'
    );
  });

  it('names its biggest trades and averages, and the accounts it traded with most', async () => {
    await openAccount(5);
    const panel = await openTradesTab();
    const highlights = await within(panel).findByRole(
      'region',
      { name: /^highlights$/i },
      T
    );
    const tile = (label: RegExp) =>
      within(highlights).getByText(label, { selector: 'dt' })
        .parentElement as HTMLElement;
    await waitFor(
      () =>
        expect(tile(/^biggest sale$/i)).toHaveTextContent(
          /^Biggest sale300.00 QORTfor 0.002 BTCto Third/
        ),
      T
    );
    expect(tile(/^average sale$/i)).toHaveTextContent(
      'Average sale74.00 QORTover 10 sales'
    );
    expect(tile(/^biggest purchase$/i)).toHaveTextContent(
      /^Biggest purchase60.00 QORTfor 300 DGBfrom Third/
    );
    expect(tile(/^average purchase$/i)).toHaveTextContent(
      'Average purchase42.50 QORTover 2 purchases'
    );
    expect(highlights).toHaveTextContent('Every account it traded with: 2.');
    const ranked = within(
      within(highlights).getByRole('list', {
        name: /the accounts it traded with most/i,
      })
    ).getAllByRole('listitem');
    expect(ranked).toHaveLength(2);
    await waitFor(
      () =>
        expect(ranked[0]).toHaveTextContent(
          /^1\..*Third8 trades · 460.00 QORTSold to them 7, bought from them 1$/
        ),
      T
    );
  });

  it('says “No trades yet” only when every read reached its end with none', async () => {
    await openAccount(5, SECOND);
    const panel = await openTradesTab();
    expect(
      await within(panel).findByText('No trades yet.', {}, T)
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      "It hasn't completed a trade on the Trade Portal, offered QORT there or traded a Q-Asset."
    );
    // No offers: its payouts aren't read.
    expect(
      calls.some(
        ({ path }) =>
          params(path).get('address') === SECOND &&
          params(path).get('txType') === 'AT'
      )
    ).toBe(false);
  });

  it('never “No trades yet” while one of its reads failed, the first time or on a Refresh', async () => {
    const node: Node = { offers: 'failing' };
    await openAccount(5, SECOND, node);
    const panel = await openTradesTab();
    expect(
      await within(panel).findByText(
        "The trade offers it made couldn't be read.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/no trades yet/i);
    const refresh = () =>
      fireEvent.click(
        within(dialog()).getByRole('button', { name: /^refresh$/i })
      );
    node.offers = undefined;
    refresh();
    expect(
      await within(panel).findByText('No trades yet.', {}, T)
    ).toBeInTheDocument();
    // Read again and failed: what was read before was none, and the failure says so.
    node.assets = 'failing';
    refresh();
    expect(
      await within(panel).findByText(
        "Its Q-Asset trades couldn't be read again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/no trades yet/i);
    node.assets = undefined;
    node.trades = 'failing';
    refresh();
    expect(
      await within(panel).findByText(
        "Its trades on the Trade Portal couldn't be read again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/no trades yet/i);
    node.trades = undefined;
    node.offers = 'failing';
    refresh();
    expect(
      await within(panel).findByText(
        "The trade offers it made couldn't be read again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/no trades yet/i);
  });

  it('an account without a public key: its purchases from the contracts that paid it, never “No trades yet”', async () => {
    await openAccount(5, THIRD);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort bought on the trade portal$/i)
        ).toHaveTextContent('10.00 QORT1 trade'),
      T
    );
    expect(panel).not.toHaveTextContent(/no trades yet/i);
    expect(panel).toHaveTextContent(
      "It has never made a transaction of its own, so the node can't list its trades by its key"
    );
    const list = within(panel).getByRole('list', {
      name: /its trade portal trades, newest first/i,
    });
    await waitFor(
      () =>
        expect(within(list).getByRole('listitem')).toHaveTextContent(
          /^incomingBought 10 QORT for 0.039 LTC from Second/i
        ),
      T
    );
    // Its trades can't be asked by a key it doesn't have; each paying contract is read by its record.
    expect(
      calls.some(({ path }) => path.startsWith('/crosschain/trades?'))
    ).toBe(false);
    expect(
      calls.filter(({ path }) => path.startsWith('/crosschain/trade/'))
    ).toHaveLength(2);
    expect(stat(panel, /^trade offers made$/i)).toHaveTextContent(
      /^trade offers made0none yet$/i
    );
  });

  it('a failed read of its trades says so with Retry, never none; Retry reads it again', async () => {
    const node: Node = { trades: 'failing' };
    await openAccount(5, PUBLISHER, node);
    const panel = await openTradesTab();
    const failed = await within(panel).findByText(
      "Its trades on the Trade Portal couldn't be read.",
      {},
      T
    );
    expect(stat(panel, /^qort sold on the trade portal$/i)).toHaveTextContent(
      /^qort sold on the trade portal–$/i
    );
    expect(panel).not.toHaveTextContent(/no trades yet|no completed trades/i);
    node.trades = undefined;
    fireEvent.click(
      within(failed.parentElement as HTMLElement).getByRole('button', {
        name: /retry/i,
      })
    );
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort sold on the trade portal$/i)
        ).toHaveTextContent('740.00 QORT'),
      T
    );
  });

  it('a Refresh that fails keeps its trades read before on screen, with its error and Retry', async () => {
    const node: Node = {};
    await openAccount(5, PUBLISHER, node);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort sold on the trade portal$/i)
        ).toHaveTextContent('740.00 QORT'),
      T
    );
    node.trades = 'failing';
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(panel).findByText(
        "Its trades on the Trade Portal couldn't be read again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(stat(panel, /^qort sold on the trade portal$/i)).toHaveTextContent(
      '740.00 QORT'
    );
    expect(
      within(panel).getByRole('list', { name: /its trade portal trades/i })
    ).toBeInTheDocument();
    // How its offers ended rests on those trades: not shown as known from before.
    expect(
      within(panel).getByText("How its trade offers ended couldn't be read.")
    ).toBeInTheDocument();
    expect(stat(panel, /^trade offers made$/i)).not.toHaveTextContent(
      /completed/
    );
  });
});

describe('an asset order’s row in the Transactions tab', () => {
  /** An order as its CREATE_ASSET_ORDER transaction (its signature is its id). */
  const orderTx = (
    order: {
      orderId: string;
      haveAssetId: number;
      haveAssetName: string;
      wantAssetId: number;
      wantAssetName: string;
      timestamp: number;
    },
    extra: Record<string, unknown> = {}
  ) => ({
    type: 'CREATE_ASSET_ORDER',
    timestamp: order.timestamp,
    signature: order.orderId,
    creatorAddress: PUBLISHER,
    blockHeight: 1_990_000,
    haveAssetId: order.haveAssetId,
    haveAssetName: order.haveAssetName,
    wantAssetId: order.wantAssetId,
    wantAssetName: order.wantAssetName,
    amount: '10.00000000',
    price: '20.00000000',
    fee: '0.01000000',
    ...extra,
  });
  // An order no one filled, for an asset of its own name.
  const UNFILLED = {
    ...order(3, 30, 0, '0.00000000'),
    haveAssetName: 'LTQ',
  };
  const WAITING = { ...order(4, 31, 0, '0.00000000'), haveAssetName: 'FJGC' };

  /** Its orders as transactions, the orders themselves, and one waiting for a block. */
  function ordersNode(node: { orders?: 'failing' } = {}): Route {
    return (path) => {
      if (path.startsWith('/transactions/search?')) {
        const query = params(path);
        if (
          query.get('address') === PUBLISHER &&
          query.get('limit') === '100' &&
          !['DEPLOY_AT', 'AT'].includes(query.get('txType') ?? '')
        )
          return {
            body:
              Number(query.get('offset') ?? 0) === 0
                ? [orderTx(UNFILLED), orderTx(BUY_ORDER), orderTx(SELL_ORDER)]
                : [],
          };
        return undefined;
      }
      if (path.startsWith('/transactions/unconfirmed?'))
        return {
          body: [{ ...orderTx(WAITING), blockHeight: undefined }],
        };
      // The orders themselves: its buy order is still open (partly filled so far).
      for (const each of [SELL_ORDER, BUY_ORDER, UNFILLED, WAITING])
        if (path === `/assets/order/${each.orderId}`)
          return {
            body: {
              ...each,
              isClosed: each !== BUY_ORDER,
              isFulfilled: each === SELL_ORDER,
            },
          };
      // Its trades can be made to fail; anything else of them is the node's.
      if (
        node.orders === 'failing' &&
        [SELL_ORDER, BUY_ORDER, UNFILLED].some((each) =>
          path.startsWith(`/assets/order/${each.orderId}/trades?`)
        )
      )
        return { status: 500, body: { error: 5, message: 'repository issue' } };
      return undefined;
    };
  }

  async function openOrders(level: number, node: { orders?: 'failing' } = {}) {
    routes.push(ordersNode(node));
    await openAccount(level);
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    return within(dialog()).findByRole('tabpanel', { name: /transactions/i });
  }

  const orderReads = () =>
    calls.filter(({ path }) =>
      [SELL_ORDER, BUY_ORDER, UNFILLED, WAITING].some((each) =>
        path.startsWith(`/assets/order/${each.orderId}`)
      )
    );

  const sold = /Sold 23 GBQ to Second for 529 QORT/;

  it('once opened, reads how it was filled and says so in its details and under its sentence', async () => {
    const panel = await openOrders(4);
    const row = await within(panel).findByRole(
      'button',
      { name: /^placed an order to trade GBQ for QORT/i },
      T
    );
    await settle();
    // Nothing read before it is opened.
    expect(orderReads()).toEqual([]);
    fireEvent.click(row);
    expect(
      await within(panel).findByText('Filled by 1 trade', {}, T)
    ).toBeInTheDocument();
    const fills = within(panel).getByRole('list', {
      name: /the trades that filled it/i,
    });
    await waitFor(
      () => expect(within(fills).getByRole('listitem')).toHaveTextContent(sold),
      T
    );
    // The order (its two assets, whether it is open), its trades, then who placed the other order.
    expect(orderReads().map(({ path }) => path.split('?')[0])).toEqual([
      `/assets/order/${SELL_ORDER.orderId}`,
      `/assets/order/${SELL_ORDER.orderId}/trades`,
    ]);
    expect(
      calls.some(({ path }) => path === `/assets/order/${OTHER_ORDER(1)}`)
    ).toBe(true);
    // Closed again, its row still says how it was filled.
    fireEvent.click(row);
    await waitFor(
      () => expect(row).toHaveAccessibleName(/Filled: Sold 23 GBQ to Second/),
      T
    );
  });

  it('says how each was filled from its Q-Asset trades already read, with no read of its own', async () => {
    // Nothing nears the screen: the Overview's QORT figures, which read
    // each order on their own, stay unread.
    class FarObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FarObserver);
    const panel0 = await (async () => {
      routes.push(ordersNode());
      await openAccount(5);
      return openTradesTab();
    })();
    await within(panel0).findByRole(
      'list',
      { name: /its q-asset trades, newest first/i },
      T
    );
    const before = orderReads().length;
    fireEvent.click(
      within(dialog()).getByRole('tab', { name: /^transactions$/i })
    );
    const panel = await within(dialog()).findByRole('tabpanel', {
      name: /transactions/i,
    });
    const row = await within(panel).findByRole(
      'button',
      { name: /^placed an order to trade GBQ for QORT/i },
      T
    );
    await waitFor(
      () =>
        expect(row).toHaveAccessibleName(
          /Filled: Sold 23 GBQ to Second for 529 QORT/
        ),
      T
    );
    expect(
      within(panel).getByRole('button', {
        name: /^placed an order to trade QORT for GBQ.*Filled: Bought 4 GBQ from Third for 100 QORT/i,
      })
    ).toBeInTheDocument();
    fireEvent.click(row);
    expect(
      await within(panel).findByText('Filled by 1 trade', {}, T)
    ).toBeInTheDocument();
    await settle();
    // Nothing of the order is read again: its trades were read with the others.
    expect(orderReads().slice(before)).toEqual([]);
  });

  it('a failed read says so with Retry, never “Not filled”; Retry reads it again', async () => {
    const node: { orders?: 'failing' } = { orders: 'failing' };
    const panel = await openOrders(4, node);
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^placed an order to trade GBQ for QORT/i },
        T
      )
    );
    const failed = await within(panel).findByText(
      "Couldn't read how it was filled.",
      {},
      T
    );
    expect(panel).not.toHaveTextContent(/not filled/i);
    node.orders = undefined;
    fireEvent.click(
      within(failed.parentElement as HTMLElement).getByRole('button', {
        name: /retry/i,
      })
    );
    expect(
      await within(panel).findByText('Filled by 1 trade', {}, T)
    ).toBeInTheDocument();
  });

  it('“Not filled.” only from a read of its trades that reached its end', async () => {
    const panel = await openOrders(4);
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^placed an order to trade LTQ for QORT/i },
        T
      )
    );
    expect(
      await within(panel).findByText('Not filled.', {}, T)
    ).toBeInTheDocument();
    expect(
      calls.some(({ path }) =>
        path.startsWith(`/assets/order/${UNFILLED.orderId}/trades?`)
      )
    ).toBe(true);
  });

  it('an order still open, partly filled: filled so far, not “filled”', async () => {
    const panel = await openOrders(4);
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^placed an order to trade QORT for GBQ/i },
        T
      )
    );
    expect(
      await within(panel).findByText('Partly filled so far by 1 trade', {}, T)
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/filled by 1 trade/i);
  });

  it('an order still open with no trades yet: “Not filled yet.”, never “Not filled.”', async () => {
    // The node says this one is still open.
    routes.push((path) =>
      path === `/assets/order/${UNFILLED.orderId}`
        ? { body: { ...UNFILLED, isClosed: false, isFulfilled: false } }
        : undefined
    );
    const panel = await openOrders(4);
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^placed an order to trade LTQ for QORT/i },
        T
      )
    );
    expect(
      await within(panel).findByText('Not filled yet.', {}, T)
    ).toBeInTheDocument();
    expect(within(panel).queryByText('Not filled.')).not.toBeInTheDocument();
  });

  it('an order still waiting for a block reads nothing of how it was filled', async () => {
    const panel = await openOrders(4);
    const row = await within(panel).findByRole(
      'button',
      { name: /^placed an order to trade FJGC for QORT/i },
      T
    );
    fireEvent.click(row);
    await settle();
    expect(
      calls.some(({ path }) =>
        path.startsWith(`/assets/order/${WAITING.orderId}`)
      )
    ).toBe(false);
    expect(panel).not.toHaveTextContent(/how it was filled|not filled/i);
  });
});

describe('a Refresh whose payouts read fails', () => {
  it('says so with Retry: how its offers ended isn’t shown as known from before', async () => {
    const state = { payoutsFail: false };
    // Its payouts (AT transactions to it) fail once `payoutsFail` is set.
    routes.push((path) =>
      state.payoutsFail &&
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === PUBLISHER &&
      params(path).get('txType') === 'AT'
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    await openAccount(5);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(stat(panel, /^trade offers made$/i)).toHaveTextContent(
          '1210 completed · 1 ended without a trade · 1 open'
        ),
      T
    );
    const payoutReads = () =>
      calls.filter(
        ({ path }) =>
          params(path).get('address') === PUBLISHER &&
          params(path).get('txType') === 'AT'
      ).length;
    const before = payoutReads();
    state.payoutsFail = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    // The payouts were read again, and that failed.
    await waitFor(() => expect(payoutReads()).toBeGreaterThan(before), T);
    await settle();
    await settle();
    // The open offer may have ended since: what is shown is from before,
    // and the failure must say so, with Retry (as every other read here does).
    expect(panel).toHaveTextContent(/couldn['’]t (be )?read/i);
    expect(
      within(panel).getAllByRole('button', { name: /retry/i }).length
    ).toBeGreaterThan(0);
  });
});

/** A trade contract of its own number that paid THIRD (no public key) 10 QORT, newest first. */
const contracts = (count: number, from = 100) =>
  Array.from({ length: count }, (_, i) => from + i);

function keylessBuyer(numbers: number[], pays = 1): Route {
  const rows = numbers.flatMap((n) =>
    Array.from({ length: pays }, (_, k) =>
      payout(at(n), '10.00000000', when(9, 1) - n * 60_000 - k, THIRD)
    )
  );
  return (path) => {
    if (
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === THIRD &&
      params(path).get('txType') === 'AT'
    ) {
      const offset = Number(params(path).get('offset') ?? 0);
      const limit = Number(params(path).get('limit') ?? 100);
      return { body: rows.slice(offset, offset + limit) };
    }
    if (path.startsWith('/crosschain/trade/')) {
      const contract = decodeURIComponent(
        path.slice('/crosschain/trade/'.length)
      );
      if (numbers.some((n) => at(n) === contract))
        return {
          body: {
            qortalAtAddress: contract,
            qortalCreator: SECOND,
            qortAmount: '10.00000000',
            expectedForeignAmount: '0.03000000',
            mode: 'REDEEMED',
            qortalPartnerReceivingAddress: THIRD,
            foreignBlockchain: 'LITECOIN',
          },
        };
    }
    return undefined;
  };
}

describe('an account without a public key, paid by more contracts than are read', () => {
  it('101 contracts paid it: the QORT bought says it may go on (“at least”), not as if complete', async () => {
    routes.push(keylessBuyer(contracts(101)));
    await openAccount(5, THIRD);
    const panel = await openTradesTab();
    // Only the newest 100 contracts' records are read.
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort bought on the trade portal$/i)
        ).toHaveTextContent(/100 trades/),
      { timeout: 10_000 }
    );
    // A figure from part of what it bought says so ("at least", "+", "newest").
    expect(stat(panel, /^qort bought on the trade portal$/i)).toHaveTextContent(
      /at least|\+|newest/i
    );
    // And the note names the limit that cut it: contracts' records, not payouts.
    expect(panel).toHaveTextContent(
      'More contracts paid it than the Explorer reads: these are from the newest 100.'
    );
    expect(panel).not.toHaveTextContent(/it had more payouts/i);
  });

  it('the Overview’s QORT purchased says “at least” too, from the same contracts', async () => {
    const numbers = contracts(101);
    routes.push(keylessBuyer(numbers));
    // Its whole history: the 101 payouts, newest first.
    const rows = numbers.map((n) =>
      payout(at(n), '10.00000000', when(9, 1) - n * 60_000, THIRD)
    );
    routes.push((path) => {
      if (!path.startsWith('/transactions/search?')) return undefined;
      const q = params(path);
      if (q.get('address') !== THIRD || q.getAll('txType').length)
        return undefined;
      const offset = Number(q.get('offset') ?? 0);
      const limit = Number(q.get('limit') ?? 100);
      const list = q.get('reverse') === 'false' ? [...rows].reverse() : rows;
      return { body: list.slice(offset, offset + limit) };
    });
    await openAccount(5, THIRD);
    const glance = await within(dialog()).findByRole(
      'region',
      { name: /at a glance/i },
      T
    );
    const purchasedTile = () =>
      within(glance).getByText(/^qort purchased \/ sold$/i, { selector: 'dt' })
        .parentElement as HTMLElement;
    // The newest 100 contracts' 10 QORT each, and it may go on.
    await waitFor(
      () =>
        expect(purchasedTile()).toHaveTextContent(
          /at least 1,000\.00 \/ 0\.00 QORT/i
        ),
      { timeout: 10_000 }
    );
  });

  it('every payout read: the note never says it had more payouts than are read', async () => {
    routes.push(keylessBuyer(contracts(101)));
    await openAccount(5, THIRD);
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort bought on the trade portal$/i)
        ).toHaveTextContent(/100 trades/),
      { timeout: 10_000 }
    );
    // Its 101 payouts were all read (two reads, the second short): only the
    // contracts' records stopped at 100.
    expect(
      calls.filter(
        ({ path }) =>
          params(path).get('address') === THIRD &&
          params(path).get('txType') === 'AT'
      )
    ).toHaveLength(2);
    expect(panel).not.toHaveTextContent(
      /it had more payouts than the explorer reads/i
    );
  });

  it('more payouts than are read, none of them a trade: never “no completed trades”', async () => {
    // 2,001 payouts from one contract that isn't a trade (Core: invalid
    // search criteria): the newest 2,000 are read, and there are older ones.
    routes.push(keylessBuyer([], 0));
    const rows = Array.from({ length: 2_001 }, (_, i) =>
      payout(at(31), '0.10000000', when(9, 1) - i * 60_000, THIRD)
    );
    routes.unshift((path) => {
      if (
        path.startsWith('/transactions/search?') &&
        params(path).get('address') === THIRD &&
        params(path).get('txType') === 'AT'
      ) {
        const offset = Number(params(path).get('offset') ?? 0);
        const limit = Number(params(path).get('limit') ?? 100);
        return { body: rows.slice(offset, offset + limit) };
      }
      return undefined;
    });
    await openAccount(5, THIRD);
    const panel = await openTradesTab();
    await within(panel).findByText(
      /it had more payouts than the explorer reads/i,
      {},
      { timeout: 10_000 }
    );
    await settle();
    // Older payouts weren't read: a trade among them can't be ruled out.
    expect(panel).not.toHaveTextContent(/no completed trades/i);
    // The note names the limit that cut it: its payouts, not contracts.
    expect(panel).toHaveTextContent(/these are from its newest 2,000/i);
    expect(panel).not.toHaveTextContent(/more contracts paid it/i);
  });
});

describe('what an account without a public key bought, in two places', () => {
  it('the Overview’s QORT purchased and the Trades tab’s QORT bought agree', async () => {
    // Its whole history: the two payouts the made-up node gives Third, from
    // a trade contract (10 QORT) and from a lottery, not a trade contract
    // (1 QORT: the node answers "invalid search criteria" for its record).
    const rows = [
      payout(at(30), '10.00000000', when(9, 1), THIRD),
      payout(at(31), '1.00000000', when(8, 1), THIRD),
    ];
    routes.push((path) => {
      if (!path.startsWith('/transactions/search?')) return undefined;
      const q = params(path);
      if (q.get('address') !== THIRD || q.getAll('txType').length)
        return undefined;
      const offset = Number(q.get('offset') ?? 0);
      const limit = Number(q.get('limit') ?? 100);
      const list = q.get('reverse') === 'false' ? [...rows].reverse() : rows;
      return { body: list.slice(offset, offset + limit) };
    });
    await openAccount(5, THIRD);
    const glance = await within(dialog()).findByRole(
      'region',
      { name: /at a glance/i },
      T
    );
    const purchasedTile = () =>
      within(glance).getByText(/^qort purchased \/ sold$/i, { selector: 'dt' })
        .parentElement as HTMLElement;
    await waitFor(
      () => expect(purchasedTile()).toHaveTextContent(/\/ 0\.00 QORT/),
      { timeout: 10_000 }
    );
    const overview = purchasedTile().textContent?.match(
      /([\d,.]+) \/ 0\.00 QORT/
    )?.[1];
    const panel = await openTradesTab();
    await waitFor(
      () =>
        expect(
          stat(panel, /^qort bought on the trade portal$/i)
        ).toHaveTextContent(/portal[\d,.]+ QORT\d+ trade/i),
      T
    );
    const tab = stat(
      panel,
      /^qort bought on the trade portal$/i
    ).textContent?.match(/portal([\d,.]+) QORT/i)?.[1];
    // One account, one figure for what it bought on the Trade Portal.
    expect({ overview, tab }).toEqual({ overview: tab, tab });
  });

  it('its Account report says the same: what trade contracts paid it, not the lottery', async () => {
    const rows = [
      payout(at(30), '10.00000000', when(9, 1), THIRD),
      payout(at(31), '1.00000000', when(8, 1), THIRD),
    ];
    // The contracts' records wait until let go.
    let letGo = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const node = tradesNode();
    routes.push((path) => {
      if (!path.startsWith('/crosschain/trade/')) return undefined;
      const answer = node(path);
      return answer && { ...answer, delay: held };
    });
    routes.push((path) => {
      if (!path.startsWith('/transactions/search?')) return undefined;
      const q = params(path);
      if (q.get('address') !== THIRD || q.getAll('txType').length)
        return undefined;
      const offset = Number(q.get('offset') ?? 0);
      const limit = Number(q.get('limit') ?? 100);
      const list = q.get('reverse') === 'false' ? [...rows].reverse() : rows;
      return { body: list.slice(offset, offset + limit) };
    });
    await openAccount(5, THIRD);
    fireEvent.click(
      await within(dialog()).findByRole('tab', { name: /^connections$/i }, T)
    );
    const panel = await within(dialog()).findByRole('tabpanel', {
      name: /connections/i,
    });
    fireEvent.click(
      await within(panel).findByRole('button', { name: /^account report$/i }, T)
    );
    const window_ = await screen.findByRole(
      'dialog',
      { name: /^Account report: Third$/ },
      T
    );
    await within(window_).findByText(
      'Its whole history is read: 2 transactions.',
      {},
      { timeout: 10_000 }
    );
    // What it bought waits for those records: the report says so meanwhile.
    expect(
      await within(window_).findByText(
        /^Still being read: its trades on the Trade Portal\./,
        {},
        T
      )
    ).toBeInTheDocument();
    expect(
      within(window_).queryByRole('button', { name: /^make the report$/i })
    ).toBeNull();
    letGo();
    fireEvent.click(
      await within(window_).findByRole(
        'button',
        { name: /^make the report$/i },
        { timeout: 10_000 }
      )
    );
    const preview = await within(window_).findByLabelText(
      /^account-report-Third-\d{4}-\d\d-\d\d\.md$/,
      {},
      T
    );
    // The trade contract's 10; the lottery's 1 is no purchase, as the Overview says.
    expect(preview.textContent).toContain('| QORT purchased / sold | 10 / 0 |');
  });
});
