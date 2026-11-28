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
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The Assets tab and the Overview's Q-Assets, for everyone, in the window
// as App mounts it, reading a made-up node: Publisher holds four Q-Assets
// (Gems, Tokens and Widget priced by their last trades with QORT, Unsold
// never traded) and owns Tokens and Spare, which it holds none of. Second
// owns Widget and published its avatar; Third published one for Widget
// too, which is never shown.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const THIRD = `Q${'T'.repeat(33)}`;
const NOBODY = `Q${'N'.repeat(33)}`;

type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const params = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

const NAMES: Record<string, string> = {
  [PUBLISHER]: 'Publisher',
  [SECOND]: 'Second',
  [THIRD]: 'Third',
};

function account(address: string) {
  return {
    address,
    reference: 'ref',
    publicKey: 'p'.repeat(44),
    level: 3,
    blocksMinted: 1_000,
    blocksMintedAdjustment: 0,
    blocksMintedPenalty: 0,
  };
}

const ASSETS = [
  { assetId: 0, name: 'QORT', owner: NOBODY, quantity: 0, isDivisible: true },
  {
    assetId: 1,
    name: 'Legacy-QORA',
    owner: NOBODY,
    quantity: 0,
    isDivisible: true,
    isUnspendable: true,
  },
  {
    assetId: 6,
    name: 'Widget',
    owner: SECOND,
    description: 'Widgets for everyone',
    quantity: 100_000_000_000,
    isDivisible: true,
  },
  {
    assetId: 7,
    name: 'Tokens',
    owner: PUBLISHER,
    quantity: 1_000_000_000,
    isDivisible: false,
  },
  {
    assetId: 8,
    name: 'Gems',
    owner: SECOND,
    quantity: 1e18,
    isDivisible: true,
  },
  {
    assetId: 9,
    name: 'Unsold',
    owner: THIRD,
    quantity: 10_000_000_000,
    isDivisible: true,
  },
  {
    assetId: 10,
    name: 'Spare',
    owner: PUBLISHER,
    quantity: 500_000_000,
    isDivisible: true,
  },
];

const holding = (assetId: number, balance: string, address = PUBLISHER) => ({
  address,
  assetId,
  balance,
  assetName: ASSETS.find((asset) => asset.assetId === assetId)?.name,
});

const HOLDINGS = [
  holding(0, '50.00000000'),
  holding(6, '6.00000000'),
  holding(7, '2.00000000'),
  holding(8, '12345.67800000'),
  holding(9, '3.00000000'),
];

const bid = (creator: string, price: string, amount: string) => ({
  creator,
  price,
  amount,
  fulfilled: '0.00000000',
  haveAssetId: 0,
});

interface Node {
  holdings?: unknown[] | 'failing';
  /** Buy orders by asset, or failing for one. */
  bids?: Record<number, unknown[] | 'failing'>;
}

const DAY = Date.UTC(2025, 4, 18, 12);

function assetsNode(node: Node = {}): Route {
  return (path) => {
    for (const [address, name] of Object.entries(NAMES)) {
      if (path === `/addresses/${address}`) return { body: account(address) };
      if (path === `/names/primary/${address}`)
        return { body: { name, owner: address } };
      if (path.startsWith(`/names/address/${address}`))
        return { body: [{ name, owner: address }] };
      if (path === `/groups/member/${address}`) return { body: [] };
    }
    if (path.startsWith('/assets/balances?')) {
      const query = params(path);
      if (query.get('assetid') === '6')
        return {
          body: [
            { address: SECOND, assetId: 6, balance: '900.00000000' },
            { address: PUBLISHER, assetId: 6, balance: '6.00000000' },
            { address: THIRD, assetId: 6, balance: '4.00000000' },
          ],
        };
      if (query.get('assetid')) return { body: [] };
      if (query.get('address') === PUBLISHER) {
        if (node.holdings === 'failing')
          return {
            status: 500,
            body: { error: 5, message: 'repository issue' },
          };
        return { body: node.holdings ?? HOLDINGS };
      }
      return { body: [] };
    }
    if (path.startsWith('/assets?')) return { body: ASSETS };
    if (path.startsWith('/assets/trades/recent?')) {
      const query = params(path);
      if (query.get('otherassetid') === '0')
        return {
          body: [
            {
              assetId: 6,
              otherAssetId: 0,
              amount: '6.00000000',
              otherAmount: '120.00000000',
              timestamp: DAY,
            },
            {
              assetId: 8,
              otherAssetId: 0,
              amount: '1.00000000',
              otherAmount: '0.50000000',
              timestamp: DAY,
            },
          ],
        };
      return {
        body: [
          {
            assetId: 0,
            otherAssetId: 7,
            amount: '150.00000000',
            otherAmount: '2.00000000',
            timestamp: DAY,
          },
        ],
      };
    }
    if (path.startsWith('/assets/openorders/0/')) {
      const id = Number(path.split('?')[0].split('/').pop());
      const book = node.bids?.[id];
      if (book === 'failing')
        return { status: 500, body: { error: 5, message: 'repository issue' } };
      if (book) return { body: book };
      if (id === 6)
        return {
          body: [
            bid(PUBLISHER, '20.00000000', '6.00000000'),
            bid(SECOND, '18.00000000', '4.00000000'),
            bid(THIRD, '15.00000000', '10.00000000'),
          ],
        };
      if (id === 8)
        return { body: [bid(SECOND, '0.00010000', '5000.00000000')] };
      return { body: [] };
    }
    if (path.startsWith('/assets/orderbook/6/0?'))
      return { body: [{ price: '22.00000000', unfulfilled: '3.00000000' }] };
    if (path.startsWith('/assets/orderbook/')) return { body: [] };
    if (path.startsWith('/assets/trades/0/6?'))
      return {
        body: [
          {
            trade: {
              initiatingOrderId: 'order-buy',
              targetOrderId: 'order-sell',
              initiatorAmount: '120.00000000',
              targetAmount: '6.00000000',
              timestamp: DAY,
            },
            initiatingOrder: {
              creator: PUBLISHER,
              haveAssetId: 0,
              wantAssetId: 6,
            },
            targetOrder: { creator: SECOND, haveAssetId: 6, wantAssetId: 0 },
          },
        ],
      };
    if (path.startsWith('/assets/trades/')) return { body: [] };
    if (path.startsWith('/arbitrary/resources/search?'))
      return {
        body: [
          { name: 'Second', identifier: 'asset6_Widget_aavatar' },
          // Not Widget's owner: never shown.
          { name: 'Third', identifier: 'asset6_Widget_aavatar' },
          // Gems' only avatar, from someone who doesn't own it: never shown.
          { name: 'Third', identifier: 'asset8_Gems_aavatar' },
        ],
      };
    return undefined;
  };
}

const commonRoutes: Route = (path) => {
  if (path === `/addresses/${READER}`) return { body: account(READER) };
  if (path === `/groups/member/${READER}`) return { body: [] };
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

const lookUp = (addressOrName: string) =>
  act(() => {
    executeEvent('openUserLookupDrawer', { addressOrName });
  });

/** The Explorer window (the first dialog: an asset's window opens over it). */
const explorer = () => screen.getAllByRole('dialog')[0];
const T = { timeout: 4000 };

async function openAccount(
  address = PUBLISHER,
  node: Node = {},
  theme = darkTheme
) {
  routes.push(assetsNode(node));
  renderWindow(theme);
  await lookUp(address);
  await within(explorer()).findByRole('heading', {
    level: 2,
    name: NAMES[address],
  });
}

async function openAssetsTab() {
  fireEvent.click(within(explorer()).getByRole('tab', { name: /^assets$/i }));
  return within(explorer()).findByRole('tabpanel', { name: /assets/i });
}

/** The names on the cards, in their order. */
const cardNames = (panel: HTMLElement) =>
  within(within(panel).getByRole('list', { name: /^its q-assets$/i }))
    .getAllByRole('button', { name: /: details$/ })
    .map((button) =>
      button.getAttribute('aria-label')?.replace(/: details$/, '')
    );

/** A summary figure, by its label. */
const stat = (panel: HTMLElement, label: RegExp) =>
  within(panel).getByText(label, { selector: 'dt' })
    .parentElement as HTMLElement;

const card = (panel: HTMLElement, name: string) =>
  within(panel)
    .getByRole('button', { name: `${name}: details` })
    .closest('li') as HTMLElement;

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

describe('the Assets tab, for everyone', () => {
  it('sums up its four Q-Assets, then the cards, worth most first, the unpriced last', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    expect(
      await within(panel).findByRole('heading', { name: 'Q-Assets (4)' }, T)
    ).toBeInTheDocument();
    // 12,345.678 Gems at 0.5, 2 Tokens at 75 and 6 Widget at 20.
    await waitFor(
      () =>
        expect(stat(panel, /^worth at their last trades$/i)).toHaveTextContent(
          '≈ 6,442.84 QORT'
        ),
      T
    );
    expect(stat(panel, /^worth at their last trades$/i)).toHaveTextContent(
      "3 of 4 have traded for QORT; the rest aren't counted."
    );
    expect(stat(panel, /^holds$/i)).toHaveTextContent('4 Q-Assets');
    // Tokens it holds and Spare it doesn't: both its own.
    await waitFor(
      () => expect(stat(panel, /^owns$/i)).toHaveTextContent('2 assets'),
      T
    );
    // What buyers would pay now: 4 at 18 and 2 at 15 for Widget (its own order at 20 aside), 5,000 Gems at 0.0001.
    await waitFor(
      () =>
        expect(stat(panel, /^buyers would pay now$/i)).toHaveTextContent(
          '≈ 102.50 QORT'
        ),
      T
    );
    expect(stat(panel, /^buyers would pay now$/i)).toHaveTextContent(
      '1 with buyers for all of it, 1 for part of it, and 2 with no buyers now.'
    );
    await waitFor(
      () =>
        expect(cardNames(panel)).toEqual([
          'Gems',
          'Tokens',
          'Widget',
          'Unsold',
        ]),
      T
    );
    const split = within(panel).getByRole('list', {
      name: /how their worth splits/i,
    });
    expect(split).toHaveTextContent('Gems 96%');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('each card: how much, its share of all, its last trade, and what buyers would pay now', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(
      () =>
        expect(card(panel, 'Widget')).toHaveTextContent(
          '≈ 102.00 QORTfor all of it'
        ),
      T
    );
    const widget = card(panel, 'Widget');
    expect(widget).toHaveTextContent('Holds6');
    expect(widget).toHaveTextContent('0.6% of 1,000');
    expect(widget).toHaveTextContent('At its last trade≈ 120.00 QORT');
    expect(widget).toHaveTextContent('20 QORT each');
    expect(widget).toHaveTextContent('#6 · by \u2068Second\u2069');
    const tokens = card(panel, 'Tokens');
    expect(tokens).toHaveTextContent('Buyers would pay nowNo buyers now');
    // Its own, and whole units only: only an asset that can't be split says so.
    expect(within(tokens).getByText(/^its own$/i)).toBeInTheDocument();
    expect(within(tokens).getByText(/^indivisible$/i)).toBeInTheDocument();
    expect(within(widget).queryByText(/divisible/i)).toBeNull();
    expect(card(panel, 'Unsold')).toHaveTextContent('Never traded for QORT');
    // 5,000 of 12,345.678 Gems would sell; quantity in whole units.
    expect(card(panel, 'Gems')).toHaveTextContent('for 5,000 of 12,345.678');
    expect(card(panel, 'Gems')).toHaveTextContent('of 10,000,000,000');
  });

  it('avatars: the owner’s own image, never anyone else’s; a coin otherwise', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(
      () =>
        expect(
          panel.querySelector(
            'img[src="http://node.test/arbitrary/IMAGE/Second/asset6_Widget_aavatar?async=true"]'
          )
        ).not.toBeNull(),
      T
    );
    expect(panel.querySelector('img[src*="/IMAGE/Third/"]')).toBeNull();
    // The owner's names were read for Gems' avatar: Third isn't one of them.
    await waitFor(
      () =>
        expect(
          calls.some(({ path }) => path.startsWith(`/names/address/${SECOND}`))
        ).toBe(true),
      T
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(panel.querySelector('img[src*="asset8_Gems_aavatar"]')).toBeNull();
    expect(card(panel, 'Unsold')).toHaveTextContent('U');
    // One search for every asset avatar.
    expect(
      calls.filter(({ path }) => path.startsWith('/arbitrary/resources/search'))
        .length
    ).toBe(1);
  });

  it('searches by name or number, sorts, and lists them as rows', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    const search = within(panel).getByRole('searchbox', {
      name: /search its q-assets/i,
    });
    fireEvent.change(search, { target: { value: 'wid' } });
    expect(within(panel).getByRole('status')).toHaveTextContent(
      '1 of 4 matches “⁨wid⁩”.'
    );
    expect(cardNames(panel)).toEqual(['Widget']);
    fireEvent.change(search, { target: { value: '#7' } });
    expect(cardNames(panel)).toEqual(['Tokens']);
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(within(panel).getByRole('status')).toHaveTextContent(
      'None of its assets matches'
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: /clear the search/i })
    );
    expect(cardNames(panel)).toHaveLength(4);
    fireEvent.mouseDown(
      within(panel).getByRole('combobox', { name: /^sort$/i })
    );
    fireEvent.click(
      await screen.findByRole('option', { name: /name, a to z/i })
    );
    expect(cardNames(panel)).toEqual(['Gems', 'Tokens', 'Unsold', 'Widget']);
    fireEvent.click(within(panel).getByRole('button', { name: /list/i }));
    expect(window.localStorage.getItem('explorer-assets-view')).toBe('list');
    expect(cardNames(panel)).toHaveLength(4);
  });

  it('opens an asset’s window: its holders, where it stands, the open orders and who bought from whom', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Widget: details' })
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    expect(window_).toHaveTextContent('Widgets for everyone');
    expect(window_).toHaveTextContent('Asset #6');
    // Its last trade's size, the holding at it, and what buyers would pay now.
    expect(window_).toHaveTextContent(
      '20 QORT each (6 \u2068Widget\u2069 for 120 QORT'
    );
    await waitFor(
      () => expect(window_).toHaveTextContent('≈ 102.00 QORT for all of it'),
      T
    );
    // The open orders: its own buy order at 20 isn't among the buyers.
    const buyers = await within(window_).findByRole(
      'list',
      { name: /^buyers offer$/i },
      T
    );
    expect(
      within(buyers)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['18 QORT each4', '15 QORT each10']);
    expect(
      within(window_).getByRole('list', { name: /^sellers ask$/i })
    ).toHaveTextContent('22 QORT each3');
    expect(
      await within(window_).findByText('This account: #2 of 3 holders.', {}, T)
    ).toBeInTheDocument();
    const holders = within(window_).getByRole('list', {
      name: /^biggest holders$/i,
    });
    expect(within(holders).getAllByRole('listitem')).toHaveLength(3);
    const deals = await within(window_).findByRole(
      'list',
      { name: /latest trades with qort/i },
      T
    );
    await waitFor(
      () =>
        expect(deals).toHaveTextContent(
          'Publisher bought 6 Widget from Second for 120 QORT'
        ),
      T
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('an account in an asset’s window opens as a step, and Back shows the window as it was left', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Widget: details' })
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    const holders = await within(window_).findByRole(
      'list',
      { name: /^biggest holders$/i },
      T
    );
    fireEvent.click(
      await within(holders).findByRole('button', { name: /third/i }, T)
    );
    await within(explorer()).findByRole(
      'heading',
      { level: 2, name: 'Third' },
      T
    );
    expect(screen.queryByRole('dialog', { name: 'Widget' })).toBeNull();
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^back$/i })
    );
    expect(
      await screen.findByRole('dialog', { name: 'Widget' }, T)
    ).toBeInTheDocument();
  });

  it('How it adds up: what buyers would pay, asset by asset, each opening its own window', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    fireEvent.click(
      await within(panel).findByRole('button', { name: /how it adds up/i }, T)
    );
    const how = await screen.findByRole('dialog', {
      name: /what buyers would pay now/i,
    });
    expect(how).toHaveTextContent('≈ 102.50 QORT');
    expect(how).toHaveTextContent(
      'The best 100 orders of each asset are read, and nothing is sold.'
    );
    const rows = within(
      within(how).getByRole('list', { name: /what buyers would pay for each/i })
    ).getAllByRole('button');
    expect(
      rows.map(
        (row) => row.textContent?.match(/Gems|Tokens|Widget|Unsold/)?.[0]
      )
    ).toEqual(['Widget', 'Gems', 'Tokens', 'Unsold']);
    expect(rows[0]).toHaveTextContent('best offer 18 QORT each');
    fireEvent.click(rows[1]);
    expect(
      await screen.findByRole('dialog', { name: 'Gems' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /what buyers would pay now/i })
    ).toBeNull();
  });

  it('the assets it owns and holds none of, each opening its window', async () => {
    await openAccount();
    const panel = await openAssetsTab();
    const owned = await within(panel).findByRole(
      'list',
      { name: /assets it owns, holding none/i },
      T
    );
    expect(
      within(panel).getByRole('heading', {
        name: /assets it owns, holding none \(1\)/i,
      })
    ).toBeInTheDocument();
    expect(owned).toHaveTextContent('#10 · 5 in all');
    fireEvent.click(
      within(owned).getByRole('button', { name: 'Spare: details' })
    );
    const window_ = await screen.findByRole('dialog', { name: 'Spare' });
    expect(window_).toHaveTextContent('This account holdsNone');
  });

  it('an account that holds none says so, only from a read that reached its end', async () => {
    await openAccount(SECOND);
    const panel = await openAssetsTab();
    expect(
      await within(panel).findByText('Holds no Q-Assets.', {}, T)
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole('heading', { name: 'Q-Assets (0)' })
    ).toBeInTheDocument();
  });

  it('holding none before, a Refresh that fails says so beside it', async () => {
    const node: Node = { holdings: [] };
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    expect(
      await within(panel).findByText('Holds no Q-Assets.', {}, T)
    ).toBeInTheDocument();
    node.holdings = 'failing';
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(panel).findByText(
        "Couldn't load its Q-Assets again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent('Holds no Q-Assets.');
  });

  it('a holdings read that fails says so with Retry, never “holds none”; Retry reads it again', async () => {
    const node: Node = { holdings: 'failing' };
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    expect(
      await within(panel).findByText("Couldn't load its Q-Assets.", {}, T)
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/holds no q-assets/i);
    node.holdings = HOLDINGS;
    fireEvent.click(within(panel).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
  });

  it('a Refresh that fails keeps the Q-Assets read before on screen, with its error and Retry', async () => {
    const node: Node = {};
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    node.holdings = 'failing';
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(panel).findByText(
        "Couldn't load its Q-Assets again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(cardNames(panel)).toHaveLength(4);
    node.holdings = HOLDINGS.slice(0, 2);
    fireEvent.click(
      within(panel).getAllByRole('button', { name: /retry/i })[0]
    );
    await waitFor(() => expect(cardNames(panel)).toEqual(['Widget']), T);
  });

  it('an asset whose buy orders fail says “–” and why, with Retry, never “no buyers”', async () => {
    const node: Node = { bids: { 6: 'failing' } };
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    const failed = await within(panel).findByText(
      "Couldn't read the buy orders of 1 of its assets.",
      {},
      T
    );
    expect(card(panel, 'Widget')).toHaveTextContent('Buyers would pay now–');
    expect(card(panel, 'Widget')).not.toHaveTextContent(/no buyers/i);
    // No total while one of its parts failed.
    expect(stat(panel, /^buyers would pay now$/i)).toHaveTextContent(
      /^buyers would pay now–$/i
    );
    node.bids = {};
    fireEvent.click(
      within(failed.parentElement as HTMLElement).getByRole('button', {
        name: /retry/i,
      })
    );
    await waitFor(
      () =>
        expect(stat(panel, /^buyers would pay now$/i)).toHaveTextContent(
          '≈ 102.50 QORT'
        ),
      T
    );
  });

  it('exactly the 100 buy orders read, with none past them, is every buyer; one more makes it “at least”', async () => {
    const book = (n: number) =>
      Array.from({ length: n }, () => bid(SECOND, '0.10000000', '1.00000000'));
    const node: Node = { bids: { 8: book(100) } };
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    await waitFor(
      () => expect(card(panel, 'Gems')).toHaveTextContent('≈ 10.00 QORT'),
      T
    );
    expect(card(panel, 'Gems')).not.toHaveTextContent(/at least/i);
    expect(
      calls.some(
        ({ path }) =>
          path.startsWith('/assets/openorders/0/8?') &&
          params(path).get('limit') === '101'
      )
    ).toBe(true);
    node.bids = { 8: book(101) };
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(
      () =>
        expect(card(panel, 'Gems')).toHaveTextContent('at least ≈ 10.00 QORT'),
      T
    );
  });

  it('reads well in the light theme too', async () => {
    await openAccount(PUBLISHER, {}, lightTheme);
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    expect(card(panel, 'Widget')).toHaveTextContent('≈ 120.00 QORT');
  });
});

describe('the Overview’s Q-Assets', () => {
  it('right under At a glance: the ones it holds, worth most first, each opening its window there', async () => {
    await openAccount();
    const section = await within(explorer()).findByRole(
      'region',
      { name: /^q-assets$/i },
      T
    );
    const glance = within(explorer()).getByRole('region', {
      name: /at a glance/i,
    });
    expect(
      glance.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const tiles = await within(section).findByRole(
      'list',
      { name: /worth most first/i },
      T
    );
    await waitFor(
      () =>
        expect(
          within(tiles)
            .getAllByRole('button')
            .map((tile) => tile.textContent?.replace(/^\S+?(?=[A-Z][a-z])/, ''))
        ).toEqual([
          'Gems12,345.678 · last trade ≈ 6,172.84 QORT',
          'Tokens2 · last trade ≈ 150.00 QORT',
          'Widget6 · last trade ≈ 120.00 QORT',
          'Unsold3',
        ]),
      T
    );
    // The Overview reads no order books.
    expect(
      calls.some(({ path }) => path.startsWith('/assets/openorders/'))
    ).toBe(false);
    fireEvent.click(within(tiles).getAllByRole('button')[2]);
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    expect(
      await within(window_).findByText('This account: #2 of 3 holders.', {}, T)
    ).toBeInTheDocument();
    fireEvent.click(within(window_).getByRole('button', { name: /^close$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Widget' })).toBeNull()
    );
    fireEvent.click(
      within(section).getByRole('button', { name: /open assets/i })
    );
    expect(
      await within(explorer()).findByRole('tabpanel', { name: /assets/i })
    ).toBeInTheDocument();
  });

  it('reads nothing of them before the section nears the screen', async () => {
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
    await openAccount();
    const section = await within(explorer()).findByRole(
      'region',
      { name: /^q-assets$/i },
      T
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    const holdingsReads = () =>
      calls.filter(
        ({ path }) =>
          path.startsWith('/assets/balances?') &&
          params(path).get('address') === PUBLISHER
      );
    expect(holdingsReads()).toEqual([]);
    const node = section.parentElement as Element;
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
    await waitFor(() => expect(holdingsReads()).toHaveLength(1), T);
  });

  it('their last trades failed: it says so with Retry, and lists them by name, as it says', async () => {
    const state = { failing: true };
    routes.push((path) => (state.failing ? pricesFailing(path) : undefined));
    await openAccount();
    const section = await within(explorer()).findByRole(
      'region',
      { name: /^q-assets$/i },
      T
    );
    const failed = await within(section).findByText(
      "Couldn't read their last trades.",
      {},
      T
    );
    // Not worth most first: no worth is known.
    const tiles = within(section).getByRole('list', {
      name: /its q-assets, by name/i,
    });
    expect(
      within(tiles)
        .getAllByRole('button')
        .map((tile) => tile.textContent?.match(/[A-Z][a-z]+/)?.[0])
    ).toEqual(['Gems', 'Tokens', 'Unsold', 'Widget']);
    state.failing = false;
    fireEvent.click(
      within(failed.parentElement as HTMLElement).getByRole('button', {
        name: /retry/i,
      })
    );
    expect(
      await within(section).findByRole('list', { name: /worth most first/i }, T)
    ).toBeInTheDocument();
  });

  it('none: one line, from a read that reached its end', async () => {
    await openAccount(SECOND);
    const section = await within(explorer()).findByRole(
      'region',
      { name: /^q-assets$/i },
      T
    );
    expect(
      await within(section).findByText('Holds no Q-Assets.', {}, T)
    ).toBeInTheDocument();
  });

  it('none before, then a Refresh that fails: the line stays, with the failure and Retry beside it', async () => {
    const node: Node = { holdings: [] };
    await openAccount(PUBLISHER, node);
    const section = await within(explorer()).findByRole(
      'region',
      { name: /^q-assets$/i },
      T
    );
    expect(
      await within(section).findByText('Holds no Q-Assets.', {}, T)
    ).toBeInTheDocument();
    node.holdings = 'failing';
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(section).findByText(
        "Couldn't load its Q-Assets again: these are the ones read before.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(section).toHaveTextContent('Holds no Q-Assets.');
    node.holdings = HOLDINGS;
    fireEvent.click(within(section).getByRole('button', { name: /retry/i }));
    await waitFor(
      () => expect(section).not.toHaveTextContent(/holds no q-assets/i),
      T
    );
  });
});

/** The last trades with QORT (the prices) fail. */
const pricesFailing: Route = (path) =>
  path.startsWith('/assets/trades/recent?')
    ? { status: 500, body: { error: 5, message: 'repository issue' } }
    : undefined;

describe('a last trade not read, or whose read failed, is never “never traded”', () => {
  it('while their last trades are still read, no card says it never traded for QORT', async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Held back: the summary says it is reading them.
    routes.push((path) =>
      path.startsWith('/assets/trades/recent?')
        ? { body: [], delay: hold }
        : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    expect(panel).toHaveTextContent('Reading their last trades');
    // Not read yet is not "never traded".
    expect(card(panel, 'Widget')).not.toHaveTextContent(/never traded/i);
    expect(card(panel, 'Gems')).not.toHaveTextContent(/never traded/i);
    release();
  });

  it('when their last trades fail, no card says it never traded for QORT', async () => {
    routes.push(pricesFailing);
    await openAccount();
    const panel = await openAssetsTab();
    expect(
      await within(panel).findByText("Couldn't read their last trades.", {}, T)
    ).toBeInTheDocument();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    // Widget and Gems did trade for QORT: a failed read is not "never".
    expect(card(panel, 'Widget')).not.toHaveTextContent(/never traded/i);
    expect(card(panel, 'Gems')).not.toHaveTextContent(/never traded/i);
  });

  it('an asset’s window, its last trade unread (the read failed), never says it never traded', async () => {
    routes.push(pricesFailing);
    await openAccount();
    const panel = await openAssetsTab();
    await within(panel).findByText("Couldn't read their last trades.", {}, T);
    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Widget: details' }, T)
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    // Its own trades with QORT are listed in the same window...
    const deals = await within(window_).findByRole(
      'list',
      { name: /latest trades with qort/i },
      T
    );
    await waitFor(
      () =>
        expect(deals).toHaveTextContent(
          'Publisher bought 6 Widget from Second for 120 QORT'
        ),
      T
    );
    // ...so "Last trade: never traded for QORT" beside them is false.
    expect(window_).not.toHaveTextContent(/never traded for qort/i);
  });

  it('How it adds up, their last trades failed: “couldn’t be read”, never “never traded”', async () => {
    routes.push(pricesFailing);
    await openAccount();
    const panel = await openAssetsTab();
    await within(panel).findByText("Couldn't read their last trades.", {}, T);
    fireEvent.click(
      await within(panel).findByRole('button', { name: /how it adds up/i }, T)
    );
    const how = await screen.findByRole('dialog', {
      name: /what buyers would pay now/i,
    });
    const rows = within(
      within(how).getByRole('list', { name: /what buyers would pay for each/i })
    ).getAllByRole('button');
    for (const row of rows) {
      expect(row).not.toHaveTextContent(/never traded/i);
      expect(row).toHaveTextContent("Its last trade couldn't be read");
    }
  });

  it('the window of an asset it owns and holds none of: its last trade isn’t “never” beside its trades', async () => {
    // Spare traded for QORT: Second sold 2 to Third for 30.
    routes.push((path) =>
      path.startsWith('/assets/trades/10/0?')
        ? {
            body: [
              {
                trade: {
                  initiatingOrderId: 'order-spare-sell',
                  targetOrderId: 'order-spare-buy',
                  initiatorAmount: '2.00000000',
                  targetAmount: '30.00000000',
                  timestamp: DAY,
                },
                initiatingOrder: {
                  creator: SECOND,
                  haveAssetId: 10,
                  wantAssetId: 0,
                },
                targetOrder: {
                  creator: THIRD,
                  haveAssetId: 0,
                  wantAssetId: 10,
                },
              },
            ],
          }
        : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    const owned = await within(panel).findByRole(
      'list',
      { name: /assets it owns, holding none/i },
      T
    );
    fireEvent.click(
      within(owned).getByRole('button', { name: 'Spare: details' })
    );
    const window_ = await screen.findByRole('dialog', { name: 'Spare' });
    const deals = await within(window_).findByRole(
      'list',
      { name: /latest trades with qort/i },
      T
    );
    await waitFor(
      () =>
        expect(deals).toHaveTextContent(
          'Third bought 2 Spare from Second for 30 QORT'
        ),
      T
    );
    // Its price was never read (only held assets' are): not "never traded",
    // but the newest of the window's own read of its trades: 30 QORT for 2.
    expect(window_).not.toHaveTextContent(/never traded for qort/i);
    expect(window_).toHaveTextContent(/last trade15 QORT each/i);
  });

  it('an asset’s window whose own read of its trades fails too: “–”, never “never traded”', async () => {
    routes.push(pricesFailing, (path) =>
      path.startsWith('/assets/trades/6/0?') ||
      path.startsWith('/assets/trades/0/6?')
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    await within(panel).findByText("Couldn't read their last trades.", {}, T);
    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Widget: details' }, T)
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    await within(window_).findByText("Couldn't read its trades.", {}, T);
    expect(window_).not.toHaveTextContent(/never traded for qort/i);
    expect(window_).toHaveTextContent(/last trade–/i);
  });
});

describe('holdings that aren’t known are never “holds none”', () => {
  it('an asset’s window shown again by Back while its holdings are read again: it says so, never “none”', async () => {
    const node: Node = {};
    const held: { until?: Promise<void> } = {};
    const own = assetsNode(node);
    routes.push((path) => {
      // Its holdings only, not an asset's holders.
      if (
        !held.until ||
        !path.startsWith('/assets/balances?') ||
        params(path).get('address') !== PUBLISHER
      )
        return undefined;
      const answer = own(path);
      return answer && { ...answer, delay: held.until };
    });
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    // A Refresh whose read of its holdings waits: the Q-Assets read before stay.
    let letGo = () => undefined as void;
    held.until = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Widget: details' }, T)
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    const holders = await within(window_).findByRole(
      'list',
      { name: /^biggest holders$/i },
      T
    );
    fireEvent.click(
      await within(holders).findByRole('button', { name: /third/i }, T)
    );
    await within(explorer()).findByRole(
      'heading',
      { level: 2, name: 'Third' },
      T
    );
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^back$/i })
    );
    // Shown again while its holdings are still being read.
    const shownAgain = await screen.findByRole('dialog', { name: 'Widget' }, T);
    await waitFor(
      () =>
        expect(shownAgain).toHaveTextContent(
          /this account holdsloading its q-assets/i
        ),
      T
    );
    expect(shownAgain).not.toHaveTextContent(/this account holdsnone/i);
    letGo();
    await waitFor(
      () => expect(shownAgain).toHaveTextContent('This account holds6'),
      T
    );
  });

  it('an asset’s window shown again by Back, its holdings unread (the read failed), never says it holds none', async () => {
    const node: Node = {};
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    // A Refresh that fails: the Q-Assets read before stay on screen.
    node.holdings = 'failing';
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await within(panel).findByText(
      "Couldn't load its Q-Assets again: these are the ones read before.",
      {},
      T
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Widget: details' })
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    expect(window_).toHaveTextContent('This account holds6');
    // A holder opens as a step; Back shows the window again.
    const holders = await within(window_).findByRole(
      'list',
      { name: /^biggest holders$/i },
      T
    );
    fireEvent.click(
      await within(holders).findByRole('button', { name: /third/i }, T)
    );
    await within(explorer()).findByRole(
      'heading',
      { level: 2, name: 'Third' },
      T
    );
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^back$/i })
    );
    // Back on its page (behind the window shown again, so hidden from the tree).
    await screen.findByRole(
      'heading',
      { level: 2, name: 'Publisher', hidden: true },
      T
    );
    // Its holdings are read again, and fail.
    await waitFor(
      () =>
        expect(
          calls.filter(
            ({ path }) =>
              path.startsWith('/assets/balances?') &&
              params(path).get('address') === PUBLISHER
          ).length
        ).toBeGreaterThanOrEqual(3),
      T
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    // It holds 6 Widget (its biggest holders say so in this very window):
    // a window shown while its holdings aren't known never says "none".
    const shownAgain =
      screen.queryByRole('dialog', { name: 'Widget' })?.textContent ?? '';
    expect(shownAgain).not.toMatch(/this account holdsnone/i);
  });
});

describe('an asset with more holders than are read', () => {
  it('its window never offers to “show all” of the 100 holders read', async () => {
    // 101 holders answer (the read asks for one more than it shows): there
    // are more than the 100 read. Made-up addresses, the biggest first.
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const holderAt = (n: number) =>
      `Q${'h'.repeat(31)}${B58[Math.floor(n / 58)]}${B58[n % 58]}`;
    routes.push((path) =>
      path.startsWith('/assets/balances?') &&
      params(path).get('assetid') === '6'
        ? {
            body: Array.from({ length: 101 }, (_, n) => ({
              address: holderAt(n),
              assetId: 6,
              balance: `${1_000 - n}.00000000`,
            })),
          }
        : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Widget: details' }, T)
    );
    const window_ = await screen.findByRole('dialog', { name: 'Widget' });
    expect(
      await within(window_).findByText(
        'This account: not among its 100 biggest holders.',
        {},
        T
      )
    ).toBeInTheDocument();
    // Only the biggest 100 were read, and there are more: "all 100" is false.
    expect(
      within(window_).queryByRole('button', { name: /^show all 100$/i })
    ).toBeNull();
  });
});

describe('a Refresh whose buy orders fail', () => {
  it('while a Refresh reads them again, the total waits for every one: never part before, part after', async () => {
    const node: Node = {};
    const held: { until?: Promise<void> } = {};
    const own = assetsNode(node);
    routes.push((path) => {
      if (!held.until || path.split('?')[0] !== '/assets/openorders/0/6')
        return undefined;
      const answer = own(path);
      return answer && { ...answer, delay: held.until };
    });
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    const sale = () => stat(panel, /^buyers would pay now$/i);
    await waitFor(() => expect(sale()).toHaveTextContent('≈ 102.50 QORT'), T);
    let letGo = () => undefined as void;
    held.until = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(
      () => expect(sale()).toHaveTextContent('Reading their buy orders'),
      T
    );
    letGo();
    await waitFor(() => expect(sale()).toHaveTextContent('≈ 102.50 QORT'), T);
  });

  it('keeps what buyers would pay, read before, beside the failure (as the holdings and prices do)', async () => {
    const node: Node = {};
    await openAccount(PUBLISHER, node);
    const panel = await openAssetsTab();
    await waitFor(
      () =>
        expect(card(panel, 'Widget')).toHaveTextContent(
          'Buyers would pay now≈ 102.00 QORT'
        ),
      T
    );
    node.bids = { 6: 'failing' };
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    expect(
      await within(panel).findByText(
        "Couldn't read the buy orders of 1 of its assets.",
        {},
        T
      )
    ).toBeInTheDocument();
    // What was read before stays on screen, with the failure and Retry beside it.
    expect(card(panel, 'Widget')).toHaveTextContent(
      'Buyers would pay now≈ 102.00 QORT'
    );
  });
});

describe('a genesis asset, whose quantity Core writes as 0', () => {
  it('its window never says “all there is: 0” while the account holds some', async () => {
    // Legacy-QORA (#1): Core lists its quantity as 0, as for QORT itself.
    await openAccount(PUBLISHER, {
      holdings: [...HOLDINGS, holding(1, '637.50000000')],
    });
    const panel = await openAssetsTab();
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: 'Legacy-QORA: details' },
        T
      )
    );
    const window_ = await screen.findByRole('dialog', { name: 'Legacy-QORA' });
    expect(window_).toHaveTextContent('This account holds637.5');
    // Holding 637.5 of it, "all there is: 0" is false: its quantity isn't known.
    const allThereIs = within(window_).getByText(/^all there is$/i, {
      selector: 'dt',
    }).parentElement as HTMLElement;
    expect(allThereIs).not.toHaveTextContent(/^all there is0$/i);
  });
});

describe('what it owns, while the node’s list of assets is read or failed', () => {
  it('while it is read, says so', async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    routes.push((path) =>
      path.startsWith('/assets?') ? { body: ASSETS, delay: hold } : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    await waitFor(() => expect(cardNames(panel)).toHaveLength(4), T);
    expect(stat(panel, /^owns$/i)).toHaveTextContent(
      "Reading the node's list of assets"
    );
    release();
    await waitFor(
      () => expect(stat(panel, /^owns$/i)).toHaveTextContent('2 assets'),
      T
    );
  });

  it('a failed read is “–”, with why, never a count', async () => {
    routes.push((path) =>
      path.startsWith('/assets?')
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    expect(
      await within(panel).findByText(
        "Couldn't read the node's list of assets: owners and shares are missing.",
        {},
        T
      )
    ).toBeInTheDocument();
    expect(stat(panel, /^owns$/i)).toHaveTextContent(/^owns–$/i);
  });

  it('an asset it owns whose quantity Core writes as 0 says no “0 in all”', async () => {
    routes.push((path) =>
      path.startsWith('/assets?')
        ? {
            body: ASSETS.map((asset) =>
              asset.assetId === 10 ? { ...asset, quantity: 0 } : asset
            ),
          }
        : undefined
    );
    await openAccount();
    const panel = await openAssetsTab();
    const owned = await within(panel).findByRole(
      'list',
      { name: /assets it owns, holding none/i },
      T
    );
    expect(owned).toHaveTextContent('#10');
    expect(owned).not.toHaveTextContent(/in all/i);
  });
});
