import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each test reads a set through the window: more than Vitest's 5 s default under load.
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
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';
import {
  addr,
  hold,
  LEVEL_FIVE,
  minterGroup,
  params,
  TestChain,
  viewerRoute,
  type Answer,
} from './explorerTestChain';

// The sets, as App mounts the window, reading a made-up chain: the
// accounts a sponsor sponsored and the accounts whose first QORT payment
// came from an account, opened from the Connections tab's sentences, the
// checks across a set, and how far each one read.

const READER = addr('R');
const PUBLISHER = addr('P');
const SECOND = addr('S');
const THIRD = addr('T');
const SPONSOR = addr('N');
const FUNDER = addr('F');
const OTHER = addr('H');
const SIBLING = addr('G');
const SHOP = addr('K');

let chain: TestChain;

function world() {
  chain.account({ address: PUBLISHER, name: 'Publisher' });
  chain.account({
    address: SECOND,
    name: 'Second',
    groups: [minterGroup(false)],
  });
  chain.account({ address: THIRD, name: 'Third', penalty: -500 });
  chain.account({ address: SPONSOR, name: 'Sponsor' });
  chain.account({ address: FUNDER, name: 'Funder' });
  chain.account({ address: OTHER, name: 'Other' });
  chain.account({ address: SIBLING, name: 'Sibling', level: 7 });
  chain.account({ address: SHOP, name: 'Shop' });
  chain.pay(OTHER, THIRD, 1_000_010, '1');
  chain.pay(FUNDER, PUBLISHER, 1_000_050, '50');
  chain.pay(FUNDER, SECOND, 1_000_060, '20');
  chain.pay(FUNDER, THIRD, 1_000_070, '5');
  chain.share(SPONSOR, PUBLISHER, 1_371_641);
  chain.share(SPONSOR, PUBLISHER, 1_378_875, '-1.00');
  chain.share(SPONSOR, SECOND, 1_371_700);
  chain.share(SPONSOR, SIBLING, 1_372_000);
  chain.share(SPONSOR, SIBLING, 1_373_000, '-1.00');
  chain.share(SPONSOR, SIBLING, 1_374_000);
  chain.pay(PUBLISHER, SHOP, 1_500_000, '3');
  chain.pay(SECOND, SHOP, 1_500_100, '4');
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

const lookUp = (addressOrName: string) =>
  act(() => {
    executeEvent('openUserLookupDrawer', { addressOrName });
  });

const dialog = () => screen.getAllByRole('dialog')[0];
const T = { timeout: 4000 };
/** A name as a person reads it: without the marks that isolate a name in a sentence. */
const named = (pattern: RegExp) => (name: string) =>
  pattern.test(name.replace(/[\u2068\u2069]/g, ''));
const plain = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/[\u2068\u2069]/g, '');

async function openConnections(address: string, name: string) {
  await lookUp(address);
  await within(dialog()).findByRole('heading', { level: 2, name }, T);
  fireEvent.click(
    await within(dialog()).findByRole('tab', { name: /^connections$/i }, T)
  );
  return within(dialog()).findByRole('tabpanel', { name: /connections/i });
}

/** The accounts Sponsor sponsored, from Publisher's In common. */
async function openSponsees() {
  const panel = await openConnections(PUBLISHER, 'Publisher');
  fireEvent.click(
    await within(panel).findByRole(
      'button',
      { name: named(/^the accounts sponsor sponsored$/i) },
      T
    )
  );
  return within(dialog()).findByRole(
    'heading',
    { level: 2, name: named(/^accounts sponsor sponsored$/i) },
    T
  );
}

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 60)));

/** Sponsor's own Connections tab, then the accounts it sponsored: its two checks. */
async function openSponsorsChecks() {
  const panel = await openConnections(SPONSOR, 'Sponsor');
  fireEvent.click(
    await within(panel).findByRole(
      'button',
      { name: /^the accounts it sponsored$/i },
      T
    )
  );
  const checks = await within(dialog()).findByRole(
    'region',
    { name: /checks across these accounts/i },
    T
  );
  return {
    first: within(checks).getByRole('region', {
      name: /who made their first qort payment/i,
    }),
    went: within(checks).getByRole('region', {
      name: /where their qort went/i,
    }),
  };
}

/** A payment's read of the payments `who` sent, at `offset` (Funded's pages and the check's). */
const sentPage = (path: string, who: string, offset: number) =>
  path.startsWith('/transactions/payments/between?') &&
  params(path).get('senderAddress') === who &&
  params(path).get('recipientAddress') === null &&
  Number(params(path).get('offset') ?? 0) === offset;

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

describe('the accounts a sponsor sponsored', () => {
  it('opened from the sponsorship sentences: each with when and at what percent, its removal and shares', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      path === '/addresses/online'
        ? { body: [{ minterAddress: SECOND, recipientAddress: SECOND }] }
        : undefined
    );
    world();
    renderWindow();
    await openSponsees();
    const list = await within(dialog()).findByRole(
      'list',
      { name: /^accounts sponsor sponsored$/i },
      T
    );
    await waitFor(() =>
      expect(within(list).getAllByRole('checkbox')).toHaveLength(3)
    );
    const rows = within(list)
      .getAllByRole('checkbox')
      .map((box) => box.closest('li') as HTMLElement);
    expect(plain(rows[0])).toMatch(
      /Publisher.*Sponsored .* at 0% \(block 1,371,641\)/
    );
    expect(plain(rows[0])).toMatch(
      /removed 7,234 blocks later \(block 1,378,875\)/
    );
    expect(plain(rows[1])).toMatch(/Second.*not removed/);
    expect(plain(rows[2])).toMatch(
      /Sibling.*removed 1,000 blocks later.*2 reward shares in all · sponsored again since/
    );
    // Once a row nears the screen: its level and where it stands in MINTER.
    await waitFor(() => expect(plain(rows[2])).toMatch(/Level 7/));
    await waitFor(() => expect(plain(rows[1])).toMatch(/MINTER member/));
    const page = dialog();
    expect(plain(page)).toMatch(
      /3 accounts sponsored \(.*\)\. 1 of them is minting now\./
    );
    expect(plain(page)).toMatch(/Read: all 6 of its minting transactions\./);
    // A link on Sponsor's own Connections tab too.
    const panel = await openConnections(SPONSOR, 'Sponsor');
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^the accounts it sponsored$/i },
        T
      )
    );
    expect(
      await within(dialog()).findByRole(
        'heading',
        { level: 2, name: named(/^accounts sponsor sponsored$/i) },
        T
      )
    ).toBeInTheDocument();
  });

  it('a list that stopped short says how far it read, never “none”, and reads 100 older on request', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await openSponsees();
    await waitFor(() =>
      expect(plain(dialog())).toMatch(/3 accounts sponsored/)
    );
    // More than a page arrives: Refresh starts its list over from the newest 100.
    for (let i = 0; i < 100; i++) chain.share(SPONSOR, SPONSOR, 1_600_000 + i);
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        'It made no reward shares to other accounts in its newest minting transactions read: there may be older ones.'
      )
    );
    expect(plain(dialog())).toMatch(
      'Read: its newest 100 minting transactions.'
    );
    expect(plain(dialog())).not.toMatch(
      /It made no reward shares to other accounts\.$/
    );
    fireEvent.click(
      within(dialog()).getByRole('button', {
        name: /^read older transactions$/i,
      })
    );
    await waitFor(() =>
      expect(plain(dialog())).toMatch(/3 accounts sponsored/)
    );
    expect(plain(dialog())).toMatch(
      'Read: all 106 of its minting transactions.'
    );
  });

  it('a list that stopped short: a sponsee’s shares are “in what was read”, never “in all”', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    // Older minting transactions than its newest 100: the list stops short.
    for (let i = 0; i < 100; i++) chain.share(SPONSOR, SPONSOR, 1_300_000 + i);
    renderWindow();
    await openSponsees();
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        /Sibling.*2 reward shares in what was read/
      )
    );
    expect(plain(dialog())).not.toMatch(/reward shares in all/);
  });

  it('a list that couldn’t be read is said with Retry, never “none”', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let broken = false;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      broken &&
      path.startsWith('/transactions/search?') &&
      params(path).get('address') === SPONSOR &&
      params(path).getAll('txType').includes('REWARD_SHARE')
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    world();
    renderWindow();
    await openSponsees();
    await waitFor(() =>
      expect(plain(dialog())).toMatch(/3 accounts sponsored/)
    );
    await lookUp(THIRD);
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: 'Third' },
      T
    );
    // What was read grows old; Back reads the list again, and that read fails.
    now += 10 * 60_000;
    broken = true;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByText(
      "Couldn't read its minting transactions (reward shares and level moves).",
      {},
      T
    );
    expect(plain(dialog())).not.toMatch(/It made no reward shares/);
    broken = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^retry$/i }));
    await waitFor(() =>
      expect(plain(dialog())).toMatch(/3 accounts sponsored/)
    );
  });

  it('pick two of them, and Compare opens them side by side', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await openSponsees();
    const list = await within(dialog()).findByRole(
      'list',
      { name: /^accounts sponsor sponsored$/i },
      T
    );
    const compare = within(dialog()).getByRole('button', {
      name: /^compare \(0\)$/i,
    });
    expect(compare).toBeDisabled();
    fireEvent.click(
      await within(list).findByRole(
        'checkbox',
        { name: /^pick publisher to compare$/i },
        T
      )
    );
    fireEvent.click(
      within(list).getByRole('checkbox', { name: /^pick second to compare$/i })
    );
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^compare \(2\)$/i })
    );
    const cards = await within(dialog()).findByRole(
      'list',
      { name: /accounts compared/i },
      T
    );
    expect(cards).toHaveTextContent(/Publisher.*account A.*Second.*account B/i);
    // Back: the set as it was left, the two still picked.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('checkbox', {
        name: /^pick second to compare$/i,
      })
    ).toBeChecked();
  });
});

describe('picking from the accounts it sponsored', () => {
  it('four picked: the rest can’t be picked, until one is taken out', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    chain.share(SPONSOR, THIRD, 1_372_100);
    chain.share(SPONSOR, SHOP, 1_372_200);
    renderWindow();
    await openSponsees();
    const list = await within(dialog()).findByRole(
      'list',
      { name: /^accounts sponsor sponsored$/i },
      T
    );
    const box = (name: string) =>
      within(list).getByRole('checkbox', {
        name: new RegExp(`^pick ${name} to compare$`, 'i'),
      });
    await within(list).findByRole(
      'checkbox',
      { name: /^pick shop to compare$/i },
      T
    );
    for (const name of ['Publisher', 'Second', 'Sibling', 'Third'])
      fireEvent.click(box(name));
    expect(box('Shop')).toBeDisabled();
    expect(box('Third')).toBeEnabled();
    expect(
      within(dialog()).getByRole('button', { name: /^compare \(4\)$/i })
    ).toBeEnabled();
    fireEvent.click(box('Third'));
    expect(box('Shop')).toBeEnabled();
  });
});

describe('whose first QORT payment came from an account', () => {
  it('from the first QORT row: its payments, then the accounts it paid checked, counted', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    const panel = await openConnections(PUBLISHER, 'Publisher');
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: named(/^who got their first qort payment from funder$/i) },
        T
      )
    );
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: named(/first qort payments from funder/i) },
      T
    );
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        'In the payments read, it paid 3 accounts. It made the first QORT payment to 2 of them.'
      )
    );
    expect(plain(dialog())).toMatch('Read: all 3 of its QORT payments sent.');
    const list = within(dialog()).getByRole('list', {
      name: /^first qort payments from funder$/i,
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(plain(list)).toMatch(/Publisher.*50 QORT, .* · block 1,000,050/);
    expect(plain(list)).not.toMatch(/Third/);
    // Its payments were read oldest first, by sender.
    expect(
      chain.calls.some(
        ({ path }) =>
          path.startsWith('/transactions/payments/between?') &&
          params(path).get('senderAddress') === FUNDER &&
          params(path).get('reverse') === 'false'
      )
    ).toBe(true);
  });

  it('a Refresh that couldn’t read its payments again keeps the accounts read before, with Retry', async () => {
    chain.account({ address: PUBLISHER, name: 'Publisher' });
    chain.account({ address: SECOND, name: 'Second' });
    chain.account({ address: FUNDER, name: 'Funder' });
    chain.pay(FUNDER, PUBLISHER, 1_000_050, '50');
    chain.pay(FUNDER, SECOND, 1_000_060, '20');
    let broken = false;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      broken && sentPage(path, FUNDER, 0)
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    renderWindow();
    const panel = await openConnections(FUNDER, 'Funder');
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^who got their first qort payment from this account$/i },
        T
      )
    );
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        'It made the first QORT payment to 2 of them.'
      )
    );
    const listed = () =>
      within(dialog()).queryByRole('list', {
        name: /^first qort payments from funder$/i,
      });
    expect(listed()).toHaveTextContent(/Publisher/);
    broken = true;
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /^refresh$/i })
    );
    await within(dialog()).findByRole('button', { name: /^retry$/i }, T);
    // What was read before stays on screen while the Refresh failed.
    expect(listed()).not.toBeNull();
    expect(plain(listed() as HTMLElement)).toMatch(/Publisher/);
    broken = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^retry$/i }));
    await waitFor(() =>
      expect(
        within(dialog()).queryByRole('button', { name: /^retry$/i })
      ).toBeNull()
    );
    expect(plain(listed() as HTMLElement)).toMatch(/Publisher/);
  });

  it('a check that failed is said with Retry, never counted as “not its first”', async () => {
    let broken = true;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      broken &&
      path.startsWith('/transactions/payments/between?') &&
      params(path).get('recipientAddress') === SECOND &&
      params(path).get('senderAddress') === null
        ? { status: 500, body: { error: 5, message: 'repository issue' } }
        : undefined
    );
    world();
    renderWindow();
    await lookUp(FUNDER);
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: 'Funder' },
      T
    );
    fireEvent.click(
      await within(dialog()).findByRole('tab', { name: /^connections$/i }, T)
    );
    fireEvent.click(
      await within(dialog()).findByRole(
        'button',
        { name: /^who got their first qort payment from this account$/i },
        T
      )
    );
    await waitFor(() =>
      expect(plain(dialog())).toMatch("Couldn't check 1 of the accounts.")
    );
    expect(plain(dialog())).toMatch(
      'Of the 2 checked so far, it made the first QORT payment to 1.'
    );
    broken = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /^retry$/i }));
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        'It made the first QORT payment to 2 of them.'
      )
    );
  });

  it('50 at once, then 50 more on request; its payments read on page by page, up to 1,000, saying whether there are more', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    // 1,001 payments to 60 new accounts, each one's first.
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    for (let i = 0; i < 1001; i++) {
      const j = i % 60;
      const to = `Q${ALPHABET[j % 58]}${ALPHABET[Math.floor(j / 58)]}${'Y'.repeat(31)}`;
      chain.pay(FUNDER, to, 1_100_000 + i, '1');
    }
    renderWindow();
    await lookUp(FUNDER);
    await within(dialog()).findByRole(
      'heading',
      { level: 2, name: 'Funder' },
      T
    );
    fireEvent.click(
      await within(dialog()).findByRole('tab', { name: /^connections$/i }, T)
    );
    fireEvent.click(
      await within(dialog()).findByRole(
        'button',
        { name: /^who got their first qort payment from this account$/i },
        T
      )
    );
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        /Read: its first 100 QORT payments sent \(it may have sent more\)\./
      )
    );
    // 3 of the world's own and the new ones: the first 50 checked, then 50 more.
    await waitFor(() =>
      expect(plain(dialog())).toMatch(/Of the 50 checked so far/)
    );
    const more = within(dialog()).getByRole('button', {
      name: /^check 13 more$/i,
    });
    fireEvent.click(more);
    await waitFor(() =>
      expect(plain(dialog())).toMatch(
        /It made the first QORT payment to \d+ of them\./
      )
    );
    for (let page = 1; page < 10; page++) {
      fireEvent.click(
        await within(dialog()).findByRole(
          'button',
          { name: /^read later payments$/i },
          T
        )
      );
    }
    await waitFor(
      () =>
        expect(plain(dialog())).toMatch(
          /Read: its first 1,000 QORT payments sent \(it sent more; the Explorer reads up to 1,000\)\./
        ),
      { timeout: 8000 }
    );
    expect(
      within(dialog()).queryByRole('button', { name: /^read later payments$/i })
    ).toBeNull();
  });
});

describe('checks across a set', () => {
  it('who made their first QORT payment, on request, grouped by who paid; where their QORT went', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await openSponsees();
    const checks = await within(dialog()).findByRole(
      'region',
      { name: /checks across these accounts/i },
      T
    );
    // Nothing is read until asked.
    const before = chain.calls.length;
    await settle();
    const first = within(checks).getByRole('region', {
      name: /who made their first qort payment/i,
    });
    fireEvent.click(
      within(first).getByRole('button', { name: /^check 3 accounts$/i })
    );
    await waitFor(() =>
      expect(plain(first)).toMatch(
        /Funder made the first QORT payment to 2 of the 3 accounts checked/
      )
    );
    expect(plain(first)).toMatch('Checked all 3 accounts.');
    expect(plain(first)).toMatch(
      /1 account had another first transaction|No first QORT found for 1 account/
    );
    expect(chain.calls.length).toBeGreaterThan(before);
    const went = within(checks).getByRole('region', {
      name: /where their qort went/i,
    });
    fireEvent.click(
      within(went).getByRole('button', { name: /^check 3 accounts$/i })
    );
    await waitFor(() =>
      expect(plain(went)).toMatch(
        /Shop received 7 QORT from 2 of the 3 accounts checked/
      )
    );
    expect(plain(went)).toMatch(/2 payments/);
  });

  it('Stop: no new account starts once the ones on their way end', async () => {
    const held = hold();
    world();
    const fundingOf = (address: string) =>
      chain.rows.find((row) => row.recipient === address)?.signature as string;
    const waiting = new Set([fundingOf(PUBLISHER), fundingOf(SECOND)]);
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) => {
      const one = /^\/transactions\/signature\/([^/?]+)$/.exec(path);
      return one && waiting.has(decodeURIComponent(one[1])) && checking
        ? { ...(chain.answer(path) as Answer), delay: held.until }
        : undefined;
    });
    let checking = false;
    renderWindow();
    const panel = await openConnections(SPONSOR, 'Sponsor');
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^the accounts it sponsored$/i },
        T
      )
    );
    const checks = await within(dialog()).findByRole(
      'region',
      { name: /checks across these accounts/i },
      T
    );
    const first = within(checks).getByRole('region', {
      name: /who made their first qort payment/i,
    });
    checking = true;
    fireEvent.click(
      within(first).getByRole('button', { name: /^check 3 accounts$/i })
    );
    fireEvent.click(
      await within(first).findByRole('button', { name: /^stop$/i })
    );
    await act(async () => held.release());
    await waitFor(() => expect(plain(first)).toMatch('Stopped after 2 of 3.'));
    expect(
      chain.calls.some(
        ({ path }) => path === `/transactions/signature/${fundingOf(SIBLING)}`
      )
    ).toBe(false);
  });

  it('leaving the step stops a check: what comes back after is dropped, and no new account starts', async () => {
    const held = hold();
    world();
    const fundingOf = (address: string) =>
      chain.rows.find((row) => row.recipient === address)?.signature as string;
    const waiting = new Set([fundingOf(PUBLISHER), fundingOf(SECOND)]);
    let checking = false;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) => {
      const one = /^\/transactions\/signature\/([^/?]+)$/.exec(path);
      return one && waiting.has(decodeURIComponent(one[1])) && checking
        ? { ...(chain.answer(path) as Answer), delay: held.until }
        : undefined;
    });
    renderWindow();
    const panel = await openConnections(SPONSOR, 'Sponsor');
    fireEvent.click(
      await within(panel).findByRole(
        'button',
        { name: /^the accounts it sponsored$/i },
        T
      )
    );
    const checks = await within(dialog()).findByRole(
      'region',
      { name: /checks across these accounts/i },
      T
    );
    const first = within(checks).getByRole('region', {
      name: /who made their first qort payment/i,
    });
    checking = true;
    fireEvent.click(
      within(first).getByRole('button', { name: /^check 3 accounts$/i })
    );
    await within(first).findByRole('button', { name: /^stop$/i });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await within(dialog()).findByRole('tab', { name: /^connections$/i }, T);
    await act(async () => held.release());
    await settle();
    expect(
      chain.calls.some(
        ({ path }) => path === `/transactions/signature/${fundingOf(SIBLING)}`
      )
    ).toBe(false);
  });
});

describe('checks across a set: what they claim', () => {
  /** Publisher, Second and Third, all sponsored by Sponsor and first paid by Funder. */
  function three() {
    chain.account({ address: PUBLISHER, name: 'Publisher' });
    chain.account({ address: SECOND, name: 'Second' });
    chain.account({ address: THIRD, name: 'Third' });
    chain.account({ address: SPONSOR, name: 'Sponsor' });
    chain.account({ address: FUNDER, name: 'Funder' });
    chain.account({ address: SHOP, name: 'Shop' });
    chain.pay(FUNDER, PUBLISHER, 1_000_050, '50');
    chain.pay(FUNDER, SECOND, 1_000_060, '20');
    chain.pay(FUNDER, THIRD, 1_000_070, '5');
    chain.share(SPONSOR, PUBLISHER, 1_371_641);
    chain.share(SPONSOR, SECOND, 1_371_700);
    chain.share(SPONSOR, THIRD, 1_372_000);
  }

  it('a check stopped after 2 of 3 counts the 2 checked, never “of these 3 accounts”', async () => {
    three();
    const held = hold();
    const fundingOf = (address: string) =>
      chain.rows.find((row) => row.recipient === address)?.signature as string;
    const waiting = new Set([fundingOf(PUBLISHER), fundingOf(SECOND)]);
    let checking = false;
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) => {
      const one = /^\/transactions\/signature\/([^/?]+)$/.exec(path);
      return one && waiting.has(decodeURIComponent(one[1])) && checking
        ? { ...(chain.answer(path) as Answer), delay: held.until }
        : undefined;
    });
    renderWindow();
    const { first } = await openSponsorsChecks();
    checking = true;
    fireEvent.click(
      within(first).getByRole('button', { name: /^check 3 accounts$/i })
    );
    fireEvent.click(
      await within(first).findByRole('button', { name: /^stop$/i })
    );
    await act(async () => held.release());
    await waitFor(() => expect(plain(first)).toMatch('Stopped after 2 of 3.'));
    // Third was never checked (and its first QORT payment came from Funder too).
    expect(plain(first)).toMatch(
      /Funder made the first QORT payment to 2 of the 2 accounts checked/
    );
    expect(plain(first)).not.toMatch(/of these 3 accounts|of the 3 accounts/);
  });

  it('a set of one account has a sentence of its own: never “of these 1 accounts”', async () => {
    chain.account({ address: PUBLISHER, name: 'Publisher' });
    chain.account({ address: SPONSOR, name: 'Sponsor' });
    chain.account({ address: FUNDER, name: 'Funder' });
    chain.account({ address: SHOP, name: 'Shop' });
    chain.pay(FUNDER, PUBLISHER, 1_000_050, '50');
    chain.pay(PUBLISHER, SHOP, 1_500_000, '3');
    chain.share(SPONSOR, PUBLISHER, 1_371_641);
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    renderWindow();
    const { first, went } = await openSponsorsChecks();
    fireEvent.click(
      within(first).getByRole('button', { name: /^check 1 account$/i })
    );
    await waitFor(() =>
      expect(plain(first)).toMatch(
        'Funder made the first QORT payment to 1 account (the only one checked)'
      )
    );
    expect(plain(first)).not.toMatch(/of these 1 accounts|of the 1 account/);
    fireEvent.click(
      within(went).getByRole('button', { name: /^check 1 account$/i })
    );
    await waitFor(() =>
      expect(plain(went)).toMatch(
        'Shop received 3 QORT from 1 account (the only one checked)'
      )
    );
  });

  it('Stop, or leaving the step, ends an account being checked in “Where their QORT went”: no more pages for it', async () => {
    three();
    // Publisher sent more than a page: its check reads a second one.
    for (let i = 0; i < 120; i++)
      chain.pay(PUBLISHER, SHOP, 1_600_000 + i, '1');
    chain.pay(SECOND, SHOP, 1_500_000, '4');
    for (const how of ['stop', 'leave'] as const) {
      chain.calls = [];
      const held = hold();
      chain.routes = [
        viewerRoute(LEVEL_FIVE, READER),
        (path) =>
          sentPage(path, PUBLISHER, 0)
            ? { ...(chain.answer(path) as Answer), delay: held.until }
            : undefined,
      ];
      renderWindow();
      const { went } = await openSponsorsChecks();
      fireEvent.click(
        within(went).getByRole('button', { name: /^check 3 accounts$/i })
      );
      await waitFor(() =>
        expect(
          chain.calls.some(({ path }) => sentPage(path, PUBLISHER, 0))
        ).toBe(true)
      );
      if (how === 'stop') {
        // Second is checked (one page) while Publisher's first page is on its way.
        await waitFor(() => expect(plain(went)).toMatch(/Checked [12] of 3/));
        fireEvent.click(within(went).getByRole('button', { name: /^stop$/i }));
      } else {
        fireEvent.click(
          within(dialog()).getByRole('button', { name: /^back$/i })
        );
        await within(dialog()).findByRole('tab', { name: /^connections$/i }, T);
      }
      await act(async () => held.release());
      await settle();
      expect(
        chain.calls.some(({ path }) => sentPage(path, PUBLISHER, 100)),
        how
      ).toBe(false);
      if (how === 'stop') {
        // Publisher, stopped part-way, isn't one of the accounts checked.
        await waitFor(() => expect(plain(went)).toMatch(/Stopped after/));
        expect(plain(went)).toMatch(/Shop received 4 QORT from 1/);
        expect(plain(went)).not.toMatch(/of the 3 accounts checked/);
      }
      cleanup();
    }
  });

  it('a check’s results stay with its step: Back shows them as they were left', async () => {
    three();
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    renderWindow();
    const { first } = await openSponsorsChecks();
    fireEvent.click(
      within(first).getByRole('button', { name: /^check 3 accounts$/i })
    );
    await waitFor(() =>
      expect(plain(first)).toMatch('Checked all 3 accounts.')
    );
    await lookUp(SHOP);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Shop' }, T);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    const checks = await within(dialog()).findByRole(
      'region',
      { name: /checks across these accounts/i },
      T
    );
    const again = within(checks).getByRole('region', {
      name: /who made their first qort payment/i,
    });
    expect(plain(again)).toMatch('Checked all 3 accounts.');
    expect(plain(again)).toMatch(
      /Funder made the first QORT payment to 3 of the 3 accounts checked/
    );
    expect(
      within(again).getByRole('button', { name: /^check again$/i })
    ).toBeInTheDocument();
  });

  it('on a node that can’t read payments between accounts, “Where their QORT went” says so', async () => {
    three();
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER), (path) =>
      path.startsWith('/transactions/payments/between?')
        ? { status: 404, body: 'Not Found' }
        : undefined
    );
    renderWindow();
    const { went } = await openSponsorsChecks();
    fireEvent.click(
      within(went).getByRole('button', { name: /^check 3 accounts$/i })
    );
    await waitFor(() =>
      expect(plain(went)).toMatch(
        "This node can't read the payments between accounts, which this needs."
      )
    );
    expect(plain(went)).not.toMatch(/couldn't be read/);
  });
});

describe('for anyone the rule leaves out', () => {
  it('a set step a viewer may no longer see shows the account it was about', async () => {
    chain.routes.push(viewerRoute(LEVEL_FIVE, READER));
    world();
    renderWindow();
    await openSponsees();
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
    expect(
      await within(dialog()).findByRole(
        'heading',
        { level: 2, name: 'Sponsor' },
        T
      )
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('heading', {
        name: named(/accounts sponsor sponsored/i),
      })
    ).toBeNull();
  });
});
