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

// Each test reads a whole comparison through the window: more than Vitest's 5 s default under load.
vi.setConfig({ testTimeout: 20_000 });

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

// The level 5+ rule, answered by each test through `access` (null: the
// rule as it is); the window reads it as it does for real.
const access = vi.hoisted(() => ({ override: null as null | string }));
vi.mock('./useExplorerAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useExplorerAccess')>();
  return {
    ...actual,
    useAccessRule: (...args: Parameters<typeof actual.useAccessRule>) => {
      const real = actual.useAccessRule(...args);
      return (access.override ?? real) as typeof real;
    },
  };
});

import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { picksKey } from '../../lib/explorer/comparePicks';
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';
import {
  addr,
  hold,
  LEVEL_FIVE,
  LEVEL_FOUR,
  params,
  TestChain,
  viewerRoute,
  type Route,
  type Row,
} from './explorerTestChain';

// Compare, as App mounts the window, reading a made-up chain: the
// accounts picked from their headers and the start page, what was
// recorded between them, the timeline, In common and Side by side, and
// that nothing of it is there, or read, for anyone the rule leaves out.

const READER = addr('R');
const VIEWER_TWO = addr('V');
const PUBLISHER = addr('P');
const SECOND = addr('S');
const THIRD = addr('T');
const FOURTH = addr('M');
const FIFTH = addr('W');
const SPONSOR = addr('N');
const FUNDER = addr('F');
const SHOP = addr('K');
const SIBLING = addr('G');
const UNUSED = addr('Z');

const BOOK_CLUB: Row = {
  groupId: 42,
  groupName: 'Book Club',
  owner: SPONSOR,
  isOpen: true,
  memberCount: 12,
  isAdmin: false,
};

let chain: TestChain;

/** Publisher and Second: payments both ways, the same sponsor and first payer, a shared account and group. */
function world() {
  chain.account({
    address: PUBLISHER,
    name: 'Publisher',
    publicKey: 'p'.repeat(44),
    groups: [BOOK_CLUB],
    registered: Date.UTC(2025, 2, 1),
  });
  chain.account({ address: SECOND, name: 'Second', groups: [BOOK_CLUB] });
  chain.account({ address: THIRD, name: 'Third' });
  chain.account({ address: FOURTH, name: 'Fourth' });
  chain.account({ address: FIFTH, name: 'Fifth' });
  chain.account({ address: SPONSOR, name: 'Sponsor' });
  chain.account({ address: FUNDER, name: 'Funder' });
  chain.account({ address: SHOP, name: 'Shop' });
  chain.account({ address: SIBLING, name: 'Sibling' });
  chain.pay(FUNDER, PUBLISHER, 1_000_050, '50');
  chain.pay(FUNDER, SECOND, 1_000_060, '20');
  chain.share(SPONSOR, PUBLISHER, 1_371_641);
  chain.share(SPONSOR, SECOND, 1_371_700);
  chain.share(SPONSOR, SIBLING, 1_372_000);
  chain.share(PUBLISHER, PUBLISHER, 1_380_000);
  chain.share(SECOND, SECOND, 1_380_010);
  chain.pay(PUBLISHER, SECOND, 1_500_000, '10');
  chain.pay(PUBLISHER, SECOND, 1_500_100, '2.5');
  chain.pay(PUBLISHER, SECOND, 1_500_200, '0.5');
  chain.pay(SECOND, PUBLISHER, 1_500_300, '7');
  chain.pay(PUBLISHER, SHOP, 1_500_400, '1');
  chain.pay(SECOND, SHOP, 1_500_500, '2');
  chain.pay(FUNDER, THIRD, 1_000_070, '5');
  chain.pay(FUNDER, FOURTH, 1_000_080, '5');
  chain.pay(FUNDER, FIFTH, 1_000_090, '5');
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

const lookUp = (addressOrName?: string) =>
  act(() => {
    executeEvent(
      'openUserLookupDrawer',
      addressOrName ? { addressOrName } : {}
    );
  });

const dialog = () => screen.getAllByRole('dialog')[0];
/** A name as a person reads it: without the marks that isolate a name in a sentence. */
const named = (pattern: RegExp) => (name: string) =>
  pattern.test(name.replace(/[\u2068\u2069]/g, ''));
const T = { timeout: 4000 };

/** Opens an account and waits for its header. */
async function openAccount(address: string, name: string) {
  await lookUp(address);
  return within(dialog()).findByRole('heading', { level: 2, name }, T);
}

/** Picks the account on screen to compare, from its header. */
async function pick(name: string) {
  fireEvent.click(
    await within(dialog()).findByRole(
      'button',
      { name: new RegExp(`^add to compare: ${name}$`, 'i') },
      T
    )
  );
}

/** Picks Publisher and Second, then Compare now. */
async function comparePublisherAndSecond() {
  await openAccount(PUBLISHER, 'Publisher');
  await pick('Publisher');
  await openAccount(SECOND, 'Second');
  await pick('Second');
  fireEvent.click(
    within(dialog()).getByRole('button', { name: /^compare now$/i })
  );
  return within(dialog()).findByRole(
    'heading',
    { level: 2, name: /compare accounts/i },
    T
  );
}

const section = (name: RegExp) =>
  within(dialog()).findByRole('region', { name }, T);

/** Compare the accounts kept as picks, from the start page (no account page opened before). */
async function compareFromPicks(accounts: string[]) {
  window.sessionStorage.setItem(picksKey(READER), JSON.stringify(accounts));
  renderWindow();
  await lookUp();
  const picks = await section(/picked to compare/i);
  fireEvent.click(
    await within(picks).findByRole(
      'button',
      { name: new RegExp(`^compare \\(${accounts.length}\\)$`, 'i') },
      T
    )
  );
  await within(dialog()).findByRole(
    'heading',
    { level: 2, name: /compare accounts/i },
    T
  );
}

/**
 * Completed trade portal sales answered as Core 6.1.9 answers
 * `/crosschain/trades`: limit and offset are applied to each coin's
 * trades on its own, then the coins' answers are merged, sorted by time
 * and cut to the limit (CrossChainResource.getCompletedTrades).
 */
function coreTrades(sales: Array<Row & { coin: string }>): Route {
  return (path) => {
    if (!path.startsWith('/crosschain/trades?')) return undefined;
    const query = params(path);
    const key = query.get('sellerPublicKey');
    if (!key) return undefined;
    const seller = [...chain.accounts.values()].find(
      (account) => account.publicKey === key
    );
    const limit =
      query.get('limit') === null ? null : Number(query.get('limit'));
    const offset = Number(query.get('offset') ?? 0);
    const reverse = query.get('reverse') === 'true';
    const order = (a: Row, b: Row) =>
      reverse
        ? (b.tradeTimestamp as number) - (a.tradeTimestamp as number)
        : (a.tradeTimestamp as number) - (b.tradeTimestamp as number);
    let merged: Row[] = [];
    for (const coin of [...new Set(sales.map((sale) => sale.coin))]) {
      const rows = sales
        .filter(
          (sale) =>
            sale.coin === coin &&
            seller !== undefined &&
            sale.sellerAddress === seller.address
        )
        .sort(order);
      merged.push(
        ...(limit === null
          ? rows.slice(offset)
          : rows.slice(offset, offset + limit))
      );
    }
    merged.sort(order);
    if (limit !== null && limit > 0) merged = merged.slice(0, limit);
    return { body: merged.map(({ coin: _coin, ...row }) => row) };
  };
}

let atCount = 0;
/** One of Publisher's completed sales on the trade portal, on `coin`. */
const coinSale = (
  coin: string,
  buyer: string,
  timestamp: number,
  qort: string
): Row & { coin: string } => {
  atCount += 1;
  return {
    coin,
    tradeTimestamp: timestamp,
    qortAmount: qort,
    btcAmount: '0.01000000',
    foreignAmount: '0.01000000',
    atAddress: `A${String(atCount).padStart(33, 'X')}`.replace(/0/g, 'Y'),
    sellerAddress: PUBLISHER,
    buyerReceivingAddress: buyer,
  };
};

/** Reads only Compare and the sets make. */
const compareReads = () =>
  chain.calls.filter(({ path }) => {
    const query = params(path);
    return (
      (path.startsWith('/transactions/payments/between?') &&
        query.get('senderAddress') !== null &&
        (query.get('recipientAddress') !== null ||
          query.get('offset') === '99')) ||
      (path.startsWith('/transactions/search?') &&
        query.getAll('txType').includes('REWARD_SHARE'))
    );
  });

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 60)));

beforeEach(() => {
  chain = new TestChain();
  access.override = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  chain.install();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Compare: picking accounts', () => {
  it('Add to compare in the header, then Compare now: the two side by side', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await openAccount(PUBLISHER, 'Publisher');
    await pick('Publisher');
    expect(dialog()).toHaveTextContent('Added to compare (1 of 4).');
    expect(
      within(dialog()).queryByRole('button', { name: /^compare now$/i })
    ).toBeNull();
    await openAccount(SECOND, 'Second');
    await pick('Second');
    expect(dialog()).toHaveTextContent('Added to compare (2 of 4).');
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^compare now$/i })
    );
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: /compare accounts/i },
      T
    );
    const cards = within(dialog()).getByRole('list', {
      name: /accounts compared/i,
    });
    const items = within(cards).getAllByRole('listitem', { hidden: false });
    expect(items[0]).toHaveTextContent(/Publisher.*account A/i);
    expect(cards).toHaveTextContent(/Second.*account B/i);
    expect(chain.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('at most 4: a 5th is refused in words, and a picked account comes out again', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    for (const [address, name] of [
      [PUBLISHER, 'Publisher'],
      [SECOND, 'Second'],
      [THIRD, 'Third'],
      [FOURTH, 'Fourth'],
    ]) {
      await openAccount(address, name);
      await pick(name);
    }
    expect(dialog()).toHaveTextContent('Added to compare (4 of 4).');
    await openAccount(FIFTH, 'Fifth');
    await pick('Fifth');
    expect(dialog()).toHaveTextContent(
      'Compare holds 4 accounts. Remove one first.'
    );
    expect(
      within(dialog()).getByRole('button', {
        name: /^add to compare: fifth$/i,
      })
    ).toHaveAttribute('aria-pressed', 'false');
    // Fourth's own page: taken out again.
    await openAccount(FOURTH, 'Fourth');
    fireEvent.click(
      within(dialog()).getByRole('button', {
        name: /^picked to compare: fourth$/i,
      })
    );
    expect(dialog()).toHaveTextContent('Taken out of compare.');
    expect(
      JSON.parse(window.sessionStorage.getItem(picksKey(READER)) ?? '[]')
    ).toEqual([PUBLISHER, SECOND, THIRD]);
  });

  it('the start page lists the picks, each once, with Compare once two are picked', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    // A duplicate, an AT address and text kept by an older build: only the accounts, once each.
    window.sessionStorage.setItem(
      picksKey(READER),
      JSON.stringify([
        PUBLISHER,
        PUBLISHER,
        `A${'X'.repeat(33)}`,
        '<b>',
        SECOND,
      ])
    );
    renderWindow();
    await lookUp();
    const picks = await section(/picked to compare/i);
    await waitFor(() =>
      expect(within(picks).getAllByRole('listitem')).toHaveLength(2)
    );
    expect(picks).toHaveTextContent(/Publisher.*Second/);
    fireEvent.click(
      within(picks).getByRole('button', { name: /^compare \(2\)$/i })
    );
    expect(
      await within(dialog()).findByRole(
        'heading',
        { level: 2, name: /compare accounts/i },
        T
      )
    ).toBeInTheDocument();
  });

  it('four compared: no field to add a fifth, and the page says why', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    window.sessionStorage.setItem(
      picksKey(READER),
      JSON.stringify([PUBLISHER, SECOND, THIRD, FOURTH])
    );
    renderWindow();
    await lookUp();
    const picks = await section(/picked to compare/i);
    fireEvent.click(
      await within(picks).findByRole('button', { name: /^compare \(4\)$/i }, T)
    );
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: /compare accounts/i },
      T
    );
    expect(
      within(dialog()).queryByRole('combobox', {
        name: /add an account to compare/i,
      })
    ).toBeNull();
    expect(dialog()).toHaveTextContent(
      'Compare holds 4 accounts. Remove one first.'
    );
  });

  it('kept for this Hub account only: another Hub account finds none, and the last one’s are cleared', async () => {
    chain.routes.push(
      viewerRoute(LEVEL_FIVE, READER),
      viewerRoute(LEVEL_FIVE, VIEWER_TWO)
    );
    world();
    const store = renderWindow();
    await openAccount(PUBLISHER, 'Publisher');
    await pick('Publisher');
    expect(window.sessionStorage.getItem(picksKey(READER))).toContain(
      PUBLISHER
    );
    act(() => {
      store.set(userInfoAtom, { address: VIEWER_TWO, name: 'Two' } as never);
    });
    await lookUp();
    await within(dialog()).findByRole('combobox', { name: /find an account/i });
    await settle();
    expect(
      within(dialog()).queryByRole('region', { name: /picked to compare/i })
    ).toBeNull();
    expect(window.sessionStorage.getItem(picksKey(READER))).toBeNull();
    expect(window.sessionStorage.getItem(picksKey(VIEWER_TWO))).toBeNull();
    await openAccount(PUBLISHER, 'Publisher');
    expect(
      await within(dialog()).findByRole(
        'button',
        { name: /^add to compare: publisher$/i },
        T
      )
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('storage that can’t be used: the picks still work in the window', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    expect(await comparePublisherAndSecond()).toBeInTheDocument();
  });
});

describe('Compare: what it shows', () => {
  it('recorded between them: payments each way, read exactly, each told by the one that paid, opening to the payments', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const recorded = await section(/recorded between them/i);
    const pair = await within(recorded).findByRole(
      'list',
      { name: /publisher and second/i },
      T
    );
    await waitFor(
      () => expect(pair).toHaveTextContent(/Paid Second 13 QORT in 3 payments/),
      T
    );
    expect(pair).toHaveTextContent(/Paid Publisher 7 QORT in 1 payment \(/);
    // Who did it, first: Publisher paid Second.
    const rows = within(pair).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/^.*Publisher.*Paid Second 13 QORT/);
    fireEvent.click(
      within(rows[0]).getByRole('button', {
        name: /show the 3 payments between publisher and second/i,
      })
    );
    const evidence = await within(rows[0]).findByRole('list', {
      name: /the 3 payments between publisher and second/i,
    });
    expect(within(evidence).getAllByRole('listitem')).toHaveLength(3);
    // Every list read to its end: what was checked and found nothing, said once.
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          'Checked, nothing found: reward shares between them, level moves, name sales, Q-Asset trades, and trade portal sales.'
        ),
      T
    );
    // The pair's payments were read by sender and recipient, exactly.
    expect(
      chain.calls.some(
        ({ path }) =>
          path.startsWith('/transactions/payments/between?') &&
          params(path).get('senderAddress') === SECOND &&
          params(path).get('recipientAddress') === PUBLISHER
      )
    ).toBe(true);
  });

  it('a level move and a reward share between them: told by the account that moved it or is sponsored', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    chain.share(SECOND, PUBLISHER, 1_400_000, '5.00');
    chain.levelMove(PUBLISHER, SECOND, 1_450_000);
    renderWindow();
    await comparePublisherAndSecond();
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(/Moved its minting level to Second/),
      T
    );
    // Told once, by the sender: never also "got its minting level from".
    expect(recorded).not.toHaveTextContent(/Got its minting level from/);
    expect(recorded).toHaveTextContent(
      /Sponsored by Second at 5%, not removed/
    );
  });

  it('trade portal sales between them: found by where the buyer received the QORT, so a buyer with no public key too', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    // Second has never sent a transaction (no public key): only its receiving address is known.
    chain.portalSale(PUBLISHER, SECOND, Date.UTC(2025, 5, 1), '25.00000000');
    chain.portalSale(PUBLISHER, SECOND, Date.UTC(2025, 6, 1), '5.50000000');
    chain.portalSale(PUBLISHER, SHOP, Date.UTC(2025, 6, 2), '1.00000000');
    renderWindow();
    await openAccount(PUBLISHER, 'Publisher');
    await pick('Publisher');
    await openAccount(SECOND, 'Second');
    await pick('Second');
    // Publisher's Overview read its trades by its key, for its QORT figures,
    // before Compare opens: Compare shares that read.
    const atCompare = chain.calls.length;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^compare now$/i })
    );
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: /compare accounts/i },
      T
    );
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Sold 30.5 QORT to Second on the trade portal in 2 sales/
        ),
      T
    );
    const row = within(recorded)
      .getByText(/on the trade portal/)
      .closest('li') as HTMLElement;
    expect(row).toHaveTextContent(/^.*Publisher/);
    fireEvent.click(
      within(row).getByRole('button', {
        name: /show the 2 sales between publisher and second/i,
      })
    );
    const sales = within(row).getByRole('list', {
      name: /the 2 sales between publisher and second/i,
    });
    expect(within(sales).getAllByRole('listitem')).toHaveLength(2);
    expect(sales).toHaveTextContent(/25 QORT · .*AT /);
    // The Overview's own read (each side once, without a limit, as Core's
    // pages skip trades): Publisher's page read it, so Compare reads nothing more.
    const reads = chain.calls.filter(({ path }) =>
      path.startsWith('/crosschain/trades?')
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(
        ({ path }) =>
          params(path).get('limit') === null &&
          params(path).get('offset') === null
      )
    ).toBe(true);
    expect(
      chain.calls
        .slice(atCompare)
        .some(({ path }) => path.startsWith('/crosschain/trades?'))
    ).toBe(false);
  });

  it('a trade portal sale Core gave no time: its amount and “time not known”, never a date in 1970', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    // A pruned node can answer a trade without its time.
    const untimed = chain.portalSale(
      PUBLISHER,
      SECOND,
      Date.UTC(2025, 5, 1, 12),
      '25.00000000'
    );
    delete untimed.tradeTimestamp;
    chain.portalSale(PUBLISHER, SECOND, Date.UTC(2025, 6, 1, 12), '5.50000000');
    await compareFromPicks([PUBLISHER, SECOND]);
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Sold 30.5 QORT to Second on the trade portal in 2 sales/
        ),
      T
    );
    const row = within(recorded)
      .getByText(/on the trade portal/)
      .closest('li') as HTMLElement;
    // When: the day of the one sale with a time, and that the other has none.
    expect(row).toHaveTextContent(
      /· (1 Jul 2025|Jul 1, 2025) \(1 sale: time not known\)/
    );
    fireEvent.click(
      within(row).getByRole('button', {
        name: /show the 2 sales between publisher and second/i,
      })
    );
    const sales = within(row).getByRole('list', {
      name: /the 2 sales between publisher and second/i,
    });
    const [timed, noTime] = within(sales).getAllByRole('listitem');
    expect(timed).toHaveTextContent(
      /^5\.5 QORT · (1 Jul 2025|Jul 1, 2025) · AT /
    );
    expect(noTime).toHaveTextContent(/^25 QORT · time not known · AT /);
    expect(dialog()).not.toHaveTextContent(/19(69|70)/);
  });

  it('trade portal sales none of which Core gave a time: “time not known” for them all', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    delete chain.portalSale(
      PUBLISHER,
      SECOND,
      Date.UTC(2025, 5, 1, 12),
      '25.00000000'
    ).tradeTimestamp;
    await compareFromPicks([PUBLISHER, SECOND]);
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Sold 25 QORT to Second on the trade portal in 1 sale\s*· time not known/
        ),
      T
    );
    const row = within(recorded)
      .getByText(/on the trade portal/)
      .closest('li') as HTMLElement;
    fireEvent.click(
      within(row).getByRole('button', {
        name: /show the 1 sale between publisher and second/i,
      })
    );
    const sales = within(row).getByRole('list', {
      name: /the 1 sale between publisher and second/i,
    });
    expect(within(sales).getByRole('listitem')).toHaveTextContent(
      /^25 QORT · time not known · AT /
    );
    expect(dialog()).not.toHaveTextContent(/19(69|70)/);
  });

  it('trade portal sales over more than one coin: an older sale to the other account is found, never “nothing found”', async () => {
    const sales: Array<Row & { coin: string }> = [];
    // 60 newer sales for one coin, 60 older ones for another; the oldest of those went to Second.
    for (let i = 0; i < 60; i++)
      sales.push(coinSale('one', SHOP, Date.UTC(2025, 6, 1) + i * 60_000, '1'));
    sales.push(coinSale('two', SECOND, Date.UTC(2024, 11, 1), '2'));
    for (let i = 0; i < 59; i++)
      sales.push(coinSale('two', SHOP, Date.UTC(2025, 0, 1) + i * 60_000, '1'));
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), coreTrades(sales));
    world();
    await compareFromPicks([PUBLISHER, SECOND]);
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Sold 2 QORT to Second on the trade portal in 1 sale/
        ),
      T
    );
    expect(recorded).toHaveTextContent(/Checked, nothing found:/);
    expect(recorded).not.toHaveTextContent(
      /nothing found:[^.]*trade portal sales/
    );
  });

  it('side by side: blocks minted as the Overview counts them (with the adjustment), a penalty with a minus sign', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) => {
      if (path !== `/addresses/${PUBLISHER}`) return undefined;
      const body = chain.answer(path)?.body as Row;
      return {
        body: {
          ...body,
          blocksMintedAdjustment: 200,
          blocksMintedPenalty: -500,
        },
      };
    });
    world();
    renderWindow();
    // The account's own page: 250,000 minted and an adjustment of 200, counted as 250,200.
    await openAccount(PUBLISHER, 'Publisher');
    await waitFor(() => expect(dialog()).toHaveTextContent(/250,200/), T);
    fireEvent.click(
      await within(dialog()).findByRole(
        'button',
        { name: /^compare with…$/i },
        T
      )
    );
    const box = await screen.findByRole('dialog', { name: /compare with/i });
    const field = within(box).getByRole('combobox', {
      name: /a name or an address/i,
    });
    fireEvent.change(field, { target: { value: SECOND } });
    fireEvent.keyDown(field, { key: 'Enter' });
    const side = await section(/side by side/i);
    const table = within(side).getByRole('table', {
      name: /the accounts side by side/i,
    });
    const cellsOf = (label: RegExp) =>
      within(
        within(table)
          .getByRole('rowheader', { name: label })
          .closest('tr') as HTMLElement
      ).getAllByRole('cell');
    expect(cellsOf(/^blocks minted$/i)[0]).toHaveTextContent('250,200');
    expect(cellsOf(/^minting penalty$/i)[0]).toHaveTextContent(
      '\u2212500 blocks'
    );
  });

  it('in common: the same first sponsor and first payer, linking to their accounts, a shared account and a group', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const common = await section(/^in common$/i);
    await waitFor(
      () =>
        expect(common).toHaveTextContent(
          /Both were first sponsored by Sponsor/
        ),
      T
    );
    await waitFor(
      () => expect(common).toHaveTextContent('It sponsored 3 accounts in all.'),
      T
    );
    expect(common).toHaveTextContent(
      /Both got their first QORT payment from Funder/
    );
    expect(common).toHaveTextContent(/blocks 1,000,050 and 1,000,060/);
    await waitFor(() => expect(common).toHaveTextContent(/Both paid Shop/), T);
    expect(common).toHaveTextContent(/A sent 1 payment · B sent 1 payment/);
    expect(common).toHaveTextContent(/Book Club · 12 members · A and B/);
    expect(
      within(common).getByRole('button', {
        name: named(/^the accounts sponsor sponsored$/i),
      })
    ).toBeInTheDocument();
    fireEvent.click(
      within(common).getByRole('button', {
        name: named(/^who got their first qort payment from funder$/i),
      })
    );
    expect(
      await within(dialog()).findByRole(
        'heading',
        { level: 2, name: named(/first qort payments from funder/i) },
        T
      )
    ).toBeInTheDocument();
  });

  it('timeline together: each one’s firsts in order, with how far apart', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const timeline = await section(/timeline together/i);
    const list = await within(timeline).findByRole(
      'list',
      { name: /timeline together, oldest first/i },
      T
    );
    await waitFor(
      () =>
        expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(4),
      T
    );
    const lines = within(list)
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '');
    expect(lines[0]).toMatch(
      /A: First QORT payment received: 50 QORT from Funder/
    );
    expect(lines[1]).toMatch(
      /^10 blocks later.*B: First QORT payment received: 20 QORT/
    );
    expect(lines.join('\n')).toMatch(/A: Registered the name “?Publisher/);
    expect(lines.join('\n')).toMatch(/A: Started minting \(a self-share\)/);
    expect(lines.join('\n')).toMatch(/10 blocks later.*B: Started minting/);
  });

  it('side by side: the accounts as columns, a fact the same for all said once', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const side = await section(/side by side/i);
    const table = within(side).getByRole('table', {
      name: /the accounts side by side/i,
    });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers.slice(1)).toEqual(['APublisher', 'BSecond']);
    const row = (name: RegExp) =>
      within(table)
        .getByRole('rowheader', { name })
        .closest('tr') as HTMLElement;
    await waitFor(
      () =>
        expect(row(/^first qort from$/i)).toHaveTextContent(
          /same for all:\s*Funder/i
        ),
      T
    );
    expect(row(/^level$/i)).toHaveTextContent(/same for all:\s*Level 3/i);
    await waitFor(
      () =>
        expect(row(/^first sponsor$/i)).toHaveTextContent(
          /same for all:\s*Sponsor/i
        ),
      T
    );
    // A cell per account where they differ.
    expect(within(row(/^names$/i)).getAllByRole('cell')).toHaveLength(2);
  });
});

describe('Compare: how far it read, and reads that fail', () => {
  it('lists that stopped short: “in what was read so far”, never “nothing found”', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    // Third's payments fill more than a page: its list stops at the newest 100.
    for (let i = 0; i < 120; i++) chain.pay(THIRD, SHOP, 1_600_000 + i, '1');
    renderWindow();
    await openAccount(PUBLISHER, 'Publisher');
    await pick('Publisher');
    await openAccount(THIRD, 'Third');
    await pick('Third');
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^compare now$/i })
    );
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /In what was read so far, nothing found: payments both ways/
        ),
      T
    );
    expect(recorded).not.toHaveTextContent(
      /Checked, nothing found: payments both ways/
    );
  });

  it('a read that failed is named with Retry, never “nothing found”; Retry reads it again', async () => {
    let broken = true;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      broken &&
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === SECOND &&
      params(path).getAll('txType').includes('REWARD_SHARE')
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Couldn't read its reward shares and level moves \(B\)/
        ),
      T
    );
    expect(recorded).not.toHaveTextContent(/nothing found:[^.]*reward shares/);
    broken = false;
    fireEvent.click(within(recorded).getByRole('button', { name: /^retry$/i }));
    await waitFor(
      () => expect(recorded).not.toHaveTextContent(/Couldn't read its reward/),
      T
    );
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Checked, nothing found: reward shares between them/
        ),
      T
    );
  });

  it('payments between them that couldn’t be read are named with Retry, never “nothing found”', async () => {
    let broken = true;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      broken &&
      path.startsWith('/transactions/payments/between?') &&
      params(path).get('senderAddress') === PUBLISHER &&
      params(path).get('recipientAddress') === SECOND
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Couldn't read the QORT payments between A and B/
        ),
      T
    );
    expect(recorded).not.toHaveTextContent(/nothing found:[^.]*payments/);
    broken = false;
    fireEvent.click(within(recorded).getByRole('button', { name: /^retry$/i }));
    await waitFor(
      () =>
        expect(recorded).not.toHaveTextContent(
          /Couldn't read the QORT payments/
        ),
      T
    );
  });

  it('two accounts at a time: the third one’s lists wait until the first one’s are read', async () => {
    const held = hold();
    const mintingOf = (path: string, who: string) =>
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === who &&
      params(path).getAll('txType').includes('REWARD_SHARE');
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      mintingOf(path, PUBLISHER) ? { body: [], delay: held.until } : undefined
    );
    world();
    window.sessionStorage.setItem(
      picksKey(READER),
      JSON.stringify([PUBLISHER, SECOND, THIRD])
    );
    renderWindow();
    await lookUp();
    const picks = await section(/picked to compare/i);
    fireEvent.click(
      await within(picks).findByRole('button', { name: /^compare \(3\)$/i }, T)
    );
    await waitFor(
      () =>
        expect(chain.calls.some(({ path }) => mintingOf(path, SECOND))).toBe(
          true
        ),
      T
    );
    await settle();
    expect(chain.calls.some(({ path }) => mintingOf(path, THIRD))).toBe(false);
    await act(async () => held.release());
    await waitFor(
      () =>
        expect(chain.calls.some(({ path }) => mintingOf(path, THIRD))).toBe(
          true
        ),
      T
    );
  });

  it('the third account’s lists also wait while the first one is still being looked up', async () => {
    const held = hold();
    const mintingOf = (path: string, who: string) =>
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === who &&
      params(path).getAll('txType').includes('REWARD_SHARE');
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      path === `/addresses/${PUBLISHER}`
        ? { ...(chain.answer(path) as { body: unknown }), delay: held.until }
        : undefined
    );
    world();
    await compareFromPicks([PUBLISHER, SECOND, THIRD]);
    await waitFor(
      () =>
        expect(chain.calls.some(({ path }) => mintingOf(path, SECOND))).toBe(
          true
        ),
      T
    );
    await settle();
    // A (Publisher) hasn't even been read yet: C (Third) waits for it.
    expect(chain.calls.some(({ path }) => mintingOf(path, THIRD))).toBe(false);
    await act(async () => held.release());
    await waitFor(
      () =>
        expect(chain.calls.some(({ path }) => mintingOf(path, THIRD))).toBe(
          true
        ),
      T
    );
  });

  it('an account whose read failed is still compared: never “add another account”', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      path === `/addresses/${SECOND}`
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    world();
    await compareFromPicks([PUBLISHER, SECOND]);
    const cards = await within(dialog()).findByRole(
      'list',
      { name: /accounts compared/i },
      T
    );
    await within(cards).findByText("Couldn't load this account.", {}, T);
    // Two accounts are compared: the page doesn't ask for one more.
    expect(dialog()).not.toHaveTextContent(
      'Add another account to compare it with.'
    );
  });

  it('the timeline: when first seen couldn’t be read, it says so, never leaving the name out as if there were nothing', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === PUBLISHER &&
      params(path).getAll('txType').length === 0 &&
      params(path).get('limit') === '1'
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    world();
    await compareFromPicks([PUBLISHER, SECOND]);
    const timeline = await section(/timeline together/i);
    const list = await within(timeline).findByRole(
      'list',
      { name: /timeline together, oldest first/i },
      T
    );
    await waitFor(
      () =>
        expect(timeline).not.toHaveTextContent(
          /reading where their first QORT came from/i
        ),
      T
    );
    expect(list).toHaveTextContent(/A: First QORT payment received/);
    expect(timeline).toHaveTextContent(
      /Couldn't read everything the timeline needs/
    );
  });

  it('a Refresh that couldn’t read the payments between them again keeps the payments read before, with Retry', async () => {
    let broken = false;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      broken &&
      path.startsWith('/transactions/payments/between?') &&
      params(path).get('senderAddress') === PUBLISHER &&
      params(path).get('recipientAddress') === SECOND
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    chain.account({ address: PUBLISHER, name: 'Publisher' });
    chain.account({ address: SECOND, name: 'Second' });
    chain.account({ address: FUNDER, name: 'Funder' });
    chain.account({ address: SHOP, name: 'Shop' });
    chain.pay(FUNDER, PUBLISHER, 1_000_050, '50');
    chain.pay(FUNDER, SECOND, 1_000_060, '20');
    chain.pay(PUBLISHER, SECOND, 1_500_000, '10');
    // Newer payments fill both accounts' own lists: only the exact read between them finds the one above.
    for (let i = 0; i < 120; i++) {
      chain.pay(PUBLISHER, SHOP, 1_600_000 + i, '1');
      chain.pay(SECOND, SHOP, 1_700_000 + i, '1');
    }
    await compareFromPicks([PUBLISHER, SECOND]);
    const recorded = await section(/recorded between them/i);
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(/Paid Second 10 QORT in 1 payment/),
      T
    );
    broken = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(
      () =>
        expect(recorded).toHaveTextContent(
          /Couldn't read the QORT payments between A and B/
        ),
      T
    );
    // What was read before stays on screen while the Refresh failed.
    expect(recorded).toHaveTextContent(/Paid Second 10 QORT in 1 payment/);
    broken = false;
    fireEvent.click(within(recorded).getByRole('button', { name: /^retry$/i }));
    await waitFor(
      () =>
        expect(recorded).not.toHaveTextContent(
          /Couldn't read the QORT payments/
        ),
      T
    );
    expect(recorded).toHaveTextContent(/Paid Second 10 QORT in 1 payment/);
  });

  it('an address the node has never seen says so on its card; nothing more is read about it', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const field = within(dialog()).getByRole('combobox', {
      name: /add an account to compare/i,
    });
    fireEvent.change(field, { target: { value: UNUSED } });
    fireEvent.keyDown(field, { key: 'Enter' });
    const cards = await within(dialog()).findByRole(
      'list',
      { name: /accounts compared/i },
      T
    );
    await waitFor(
      () =>
        expect(cards).toHaveTextContent(
          'This address has never been used: no transaction has involved it yet.'
        ),
      T
    );
    await settle();
    expect(
      chain.calls.filter(
        ({ path }) => path.includes(UNUSED) && path !== `/addresses/${UNUSED}`
      )
    ).toEqual([]);
  });
});

describe('Compare: Add and Remove', () => {
  it('Add by name opens a new step with it; one already compared, an AT and a name no one has are said', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const add = (value: string) => {
      const field = within(dialog()).getByRole('combobox', {
        name: /add an account to compare/i,
      });
      fireEvent.change(field, { target: { value } });
      fireEvent.keyDown(field, { key: 'Enter' });
    };
    add(SECOND);
    expect(
      await within(dialog()).findByText('Already in this comparison, as B.')
    ).toBeInTheDocument();
    add(`A${'X'.repeat(33)}`);
    expect(
      await within(dialog()).findByText(
        "That's an AT address (a program on the chain), not a personal account."
      )
    ).toBeInTheDocument();
    add('Nobody');
    expect(
      await within(dialog()).findByText(
        'No one has the name “\u2068Nobody\u2069”.'
      )
    ).toBeInTheDocument();
    add('Third');
    // A new step: its own list of cards.
    await waitFor(
      () =>
        expect(
          within(dialog()).getByRole('list', { name: /accounts compared/i })
        ).toHaveTextContent(/Third.*account C/i),
      T
    );
    // Back: the comparison of two, as it was.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await waitFor(() =>
      expect(
        within(
          within(dialog()).getByRole('list', { name: /accounts compared/i })
        ).queryByText(/account C/i)
      ).toBeNull()
    );
  });

  it('a name’s answer that arrives after the step was left is dropped', async () => {
    const held = hold();
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      path === '/names/Third'
        ? {
            body: { name: 'Third', owner: THIRD },
            delay: held.until,
          }
        : undefined
    );
    world();
    renderWindow();
    await comparePublisherAndSecond();
    const field = within(dialog()).getByRole('combobox', {
      name: /add an account to compare/i,
    });
    fireEvent.change(field, { target: { value: 'Third' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await within(dialog()).findByText('Looking up “\u2068Third\u2069”…');
    // Back to Second's page while the name is on its way.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: 'Second' },
      T
    );
    await act(async () => held.release());
    await settle();
    expect(
      within(dialog()).getByRole('heading', { level: 2, name: 'Second' })
    ).toBeInTheDocument();
    // Forward: the comparison of two, nothing added to it.
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^forward$/i })
    );
    const cards = await within(dialog()).findByRole(
      'list',
      { name: /accounts compared/i },
      T
    );
    expect(within(cards).queryByText(/account C/i)).toBeNull();
    expect(
      within(dialog()).getByRole('button', { name: /^forward$/i })
    ).toBeDisabled();
  });

  it('Remove opens the comparison without it; down to one, that account’s own page', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    fireEvent.click(
      await within(dialog()).findByRole(
        'button',
        { name: /^remove second \(B\) from this comparison$/i },
        T
      )
    );
    expect(
      await within(dialog()).findByRole(
        'heading',
        { level: 2, name: 'Publisher' },
        T
      )
    ).toBeInTheDocument();
  });

  it('Compare with…: the account found opens side by side with this one; this same one is said', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await openAccount(PUBLISHER, 'Publisher');
    fireEvent.click(
      await within(dialog()).findByRole(
        'button',
        { name: /^compare with…$/i },
        T
      )
    );
    const box = await screen.findByRole('dialog', { name: /compare with/i });
    const field = within(box).getByRole('combobox', {
      name: /a name or an address/i,
    });
    fireEvent.change(field, { target: { value: PUBLISHER } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      await within(box).findByText("That's this account. Find another one.")
    ).toBeInTheDocument();
    fireEvent.change(field, { target: { value: SECOND } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /compare with/i })).toBeNull()
    );
    const cards = await within(dialog()).findByRole(
      'list',
      { name: /accounts compared/i },
      T
    );
    expect(cards).toHaveTextContent(/Publisher.*account A.*Second.*account B/i);
  });
});

describe('Compare: for anyone the rule leaves out', () => {
  it('no Compare buttons, no picks on the start page, and nothing of Compare read', async () => {
    chain.routes.push(viewerRoute(LEVEL_FOUR, READER));
    world();
    window.sessionStorage.setItem(
      picksKey(READER),
      JSON.stringify([PUBLISHER, SECOND])
    );
    renderWindow();
    await lookUp();
    await within(dialog()).findByRole('combobox', { name: /find an account/i });
    await settle();
    expect(
      within(dialog()).queryByRole('region', { name: /picked to compare/i })
    ).toBeNull();
    await openAccount(PUBLISHER, 'Publisher');
    await settle();
    expect(
      within(dialog()).queryByRole('button', { name: /compare/i })
    ).toBeNull();
    expect(dialog()).not.toHaveTextContent(/compare/i);
    expect(compareReads()).toEqual([]);
  });

  it('a Compare step a viewer no longer may see shows the account it was about, and reads nothing of Compare', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await comparePublisherAndSecond();
    await section(/recorded between them/i);
    await settle();
    const before = compareReads().length;
    // The rule, read again, no longer lets this viewer in.
    act(() => {
      access.override = 'basic';
    });
    await lookUp(THIRD);
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: 'Third' },
      T
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    // Back on the Compare step: Second's page instead (it was opened from there).
    expect(
      await within(dialog()).findByRole(
        'heading',
        { level: 2, name: 'Second' },
        T
      )
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('heading', { name: /compare accounts/i })
    ).toBeNull();
    await settle();
    expect(compareReads()).toHaveLength(before);
  });
});
