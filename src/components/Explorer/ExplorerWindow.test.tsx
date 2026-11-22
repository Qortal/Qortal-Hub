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
import {
  blockedAddressesAtom,
  isRunningPublicNodeAtom,
  userInfoAtom,
} from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { recentKey, rememberKey } from '../../lib/explorer/recent';
import { ExplorerWindow } from './ExplorerWindow';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The Explorer window as App mounts it: opened by the event every way into
// User search sends, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const UNUSED = `Q${'U'.repeat(33)}`;
const PUBLIC_KEY = `${'k'.repeat(44)}`;

type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

function account(address: string, extra: Record<string, unknown> = {}) {
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

/** The node's answers that every account page reads, for `address`. */
function quietAccount(address: string, name: string | null): Route {
  return (path) => {
    if (path === `/addresses/${address}`) return { body: account(address) };
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

const commonRoutes: Route = (path) => {
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/names/search?')) return { body: [] };
  if (path.startsWith('/transactions/creator/')) return { body: [] };
  if (path.startsWith('/transactions/payments/between?')) return { body: [] };
  // The Overview's Q-Assets: none held.
  if (path.startsWith('/assets/balances?')) return { body: [] };
  if (path.startsWith('/assets?')) return { body: [] };
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
          text: async () => JSON.stringify(answer.body),
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
      {/* Hub's own toggle for the window (the title bar's), outside it. */}
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

function renderWindow(store = createStore()) {
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
  return store;
}

function signedIn(address = READER) {
  const store = createStore();
  store.set(userInfoAtom, { address, name: 'Reader' } as never);
  return store;
}

const lookUp = (addressOrName?: string) =>
  act(() => {
    executeEvent(
      'openUserLookupDrawer',
      addressOrName ? { addressOrName } : {}
    );
  });

const dialog = () => screen.getByRole('dialog');

beforeEach(() => {
  routes = [];
  calls = [];
  window.localStorage.clear();
  stubNode();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExplorerWindow', () => {
  it('opens the start page from Quick Tools and looks up a name typed there', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'), (path) =>
      path === '/names/Publisher'
        ? { body: { name: 'Publisher', owner: PUBLISHER } }
        : undefined
    );
    renderWindow(signedIn());
    await lookUp();
    const field = within(dialog()).getByRole('combobox', {
      name: /find an account/i,
    });
    fireEvent.change(field, { target: { value: 'Publisher' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Publisher',
      })
    ).toBeInTheDocument();
    expect(within(dialog()).getByText(PUBLISHER)).toBeInTheDocument();
  });

  it('opens an account from the event every way in sends', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Publisher',
      })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('adds a step to the trail when the event comes while it is open', async () => {
    routes.push(
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await lookUp(SECOND);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    const trail = await within(dialog()).findByRole('navigation', {
      name: /trail/i,
    });
    expect(
      within(trail).getByRole('button', { name: /Publisher/ })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('shows a failed read with Retry, and Retry reads again', async () => {
    let fail = true;
    routes.push((path) =>
      path === `/addresses/${PUBLISHER}` && fail
        ? { status: 500, body: { error: 1, message: 'busy' } }
        : undefined
    );
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByText(/couldn't load this account/i)
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(/never been used/i)
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /retry/i }));
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Publisher',
      })
    ).toBeInTheDocument();
  });

  it("doesn't take a failed read of its name for no name", async () => {
    let fail = true;
    routes.push((path) =>
      path === `/names/primary/${PUBLISHER}` && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined
    );
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByText(/couldn't load its name/i)
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(/no primary name/i)
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog()).getByRole('button', { name: /retry/i }));
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Publisher',
      })
    ).toBeInTheDocument();
  });

  it('tells an address never used from a failure', async () => {
    routes.push((path) =>
      path === `/addresses/${UNUSED}`
        ? {
            status: 404,
            body: { error: 124, message: 'account address unknown' },
          }
        : undefined
    );
    renderWindow(signedIn());
    await lookUp(UNUSED);
    expect(
      await within(dialog()).findByText(/never been used/i)
    ).toBeInTheDocument();
  });

  it('says when no one has a name', async () => {
    routes.push((path) =>
      path === '/names/Nobody'
        ? { status: 404, body: { error: 401, message: 'name unknown' } }
        : undefined
    );
    renderWindow(signedIn());
    await lookUp('Nobody');
    expect(
      await within(dialog()).findByText(/no one has the name/i)
    ).toBeInTheDocument();
  });

  it("says a name couldn't be looked up when the read fails, never that no one has it", async () => {
    routes.push((path) =>
      path === '/names/Publisher'
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined
    );
    renderWindow(signedIn());
    await lookUp('Publisher');
    expect(
      await within(dialog()).findByText(/couldn't look up this name/i)
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(/no one has the name/i)
    ).not.toBeInTheDocument();
  });

  it("starts again for another Hub account, with that account's own recent explorations", async () => {
    routes.push(
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    window.localStorage.setItem(recentKey(SECOND), JSON.stringify([PUBLISHER]));
    const store = renderWindow(signedIn(READER));
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    act(() => {
      store.set(userInfoAtom, { address: SECOND, name: 'Second' } as never);
    });
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
    const recent = within(dialog()).getByRole('region', {
      name: /recent explorations/i,
    });
    expect(await within(recent).findByText('Publisher')).toBeInTheDocument();
  });

  it('reads again after a failure, a close and a reopen', async () => {
    let fail = true;
    routes.push((path) =>
      path === `/addresses/${PUBLISHER}` && fail
        ? { status: 500, body: { error: 1, message: 'busy' } }
        : undefined
    );
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByText(/couldn't load this account/i);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^close$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    fail = false;
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByRole('heading', {
        level: 2,
        name: 'Publisher',
      })
    ).toBeInTheDocument();
  });

  it('keeps what it shows while it fades out, and starts again once it has closed', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^close$/i }));
    // On its way out it still shows the account, never the start page.
    expect(
      within(dialog()).getByRole('heading', { level: 2, name: 'Publisher' })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    act(() => executeEvent('openUserLookupDrawer', {}));
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('heading', { level: 2, name: 'Publisher' })
    ).not.toBeInTheDocument();
  });

  it('drops an answer that comes back after another account was opened', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    routes.push((path) =>
      path === `/addresses/${PUBLISHER}`
        ? { body: account(PUBLISHER), delay: slow }
        : undefined
    );
    routes.push(
      quietAccount(PUBLISHER, 'Publisher'),
      quietAccount(SECOND, 'Second')
    );
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await lookUp(SECOND);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });
    await act(async () => {
      release();
      await slow;
    });
    expect(
      within(dialog()).getByRole('heading', { level: 2, name: 'Second' })
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('heading', { level: 2, name: 'Publisher' })
    ).not.toBeInTheDocument();
  });

  it('starts again after closing: what it read is read anew', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^close$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    const before = calls.filter(
      (call) => call.path === `/addresses/${PUBLISHER}`
    ).length;
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    expect(
      calls.filter((call) => call.path === `/addresses/${PUBLISHER}`).length
    ).toBe(before + 1);
    expect(
      within(dialog()).queryByRole('navigation', { name: /trail/i })
    ).not.toBeInTheDocument();
  });

  it("starts again after Hub's own toggle closes and reopens it", async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    fireEvent.click(screen.getByText('hub toggle'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByText('hub toggle'));
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('heading', { level: 2, name: 'Publisher' })
    ).not.toBeInTheDocument();
  });

  it('keeps the page as it is while Refresh reads the account again', async () => {
    routes.push((path) =>
      path === `/groups/member/${PUBLISHER}`
        ? {
            body: [
              { groupId: 7, groupName: 'alpha', memberCount: 3 },
              { groupId: 9, groupName: 'beta', memberCount: 30 },
            ],
          }
        : undefined
    );
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    const groups = within(dialog()).getByRole('region', { name: /groups/i });
    fireEvent.mouseDown(within(groups).getByRole('combobox'));
    fireEvent.click(
      await screen.findByRole('option', { name: /most members/i })
    );
    expect(within(groups).getByRole('combobox')).toHaveTextContent(
      /most members/i
    );
    const reads = calls.filter(
      (call) => call.path === `/addresses/${PUBLISHER}`
    ).length;
    fireEvent.click(within(dialog()).getByRole('button', { name: /refresh/i }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path === `/addresses/${PUBLISHER}`).length
      ).toBe(reads + 1)
    );
    expect(
      within(dialog()).getByRole('heading', { level: 2, name: 'Publisher' })
    ).toBeInTheDocument();
    expect(
      within(
        within(dialog()).getByRole('region', { name: /groups/i })
      ).getByRole('combobox')
    ).toHaveTextContent(/most members/i);
  });

  it("shows Retry when the node's pace can't be read, never a figure worked out another way", async () => {
    let fail = true;
    routes.push((path) =>
      path === '/admin/status' && fail
        ? { status: 503, body: { error: 1, message: 'busy' } }
        : undefined
    );
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByText(/couldn't load the node's pace/i)
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText(/blocks to level/i)
    ).not.toBeInTheDocument();
    fail = false;
    const facts = within(dialog()).getByRole('region', {
      name: /at a glance/i,
    });
    fireEvent.click(within(facts).getByRole('button', { name: /retry/i }));
    expect(
      await within(facts).findByText(/blocks to level 4/i)
    ).toBeInTheDocument();
  });

  it('says its received and sent figures count QORT payments only', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByRole('img', { name: /QORT payments only/i })
    ).toBeInTheDocument();
  });

  it("doesn't add a step when the account on screen is sent again", async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await lookUp(PUBLISHER);
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    expect(
      await within(dialog()).findByRole('combobox', {
        name: /find an account/i,
      })
    ).toBeInTheDocument();
  });

  it('only reads: it never sends anything to the node', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await waitFor(() =>
      expect(
        calls.some((call) => call.path.startsWith('/transactions/search'))
      ).toBe(true)
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('keeps each Hub account its own recent explorations, and forgets them when asked', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn(READER));
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(recentKey(READER)) ?? '[]')
      ).toEqual([PUBLISHER])
    );
    expect(window.localStorage.getItem(recentKey(SECOND))).toBeNull();

    fireEvent.click(
      within(dialog()).getByRole('button', { name: /explorer settings/i })
    );
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /remember accounts/i })
    );
    expect(window.localStorage.getItem(recentKey(READER))).toBeNull();
    expect(window.localStorage.getItem(rememberKey(READER))).toBe('false');
  });

  it('hands Send QORT the address, and closes', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    const heard: unknown[] = [];
    const listener = (event: Event) =>
      heard.push((event as CustomEvent).detail);
    subscribeToEvent('openPaymentInternal', listener);
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    fireEvent.click(
      within(dialog()).getByRole('button', { name: /send qort/i })
    );
    unsubscribeFromEvent('openPaymentInternal', listener);
    // The address only: a name could change hands before the payment is sent.
    expect(heard).toEqual([{ address: PUBLISHER }]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it("doesn't offer Send QORT or Block on your own account", async () => {
    routes.push(quietAccount(READER, 'Reader'));
    renderWindow(signedIn(READER));
    await lookUp(READER);
    await within(dialog()).findByRole('heading', { level: 2, name: 'Reader' });
    expect(
      within(dialog()).getByRole('button', { name: /send qort/i })
    ).toBeDisabled();
    expect(
      within(dialog()).getByRole('button', { name: /^block$/i })
    ).toBeDisabled();
  });

  it("doesn't offer Block on a public node, and marks an account you blocked", async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    const store = signedIn();
    store.set(isRunningPublicNodeAtom, true);
    store.set(blockedAddressesAtom, { [PUBLISHER]: true } as never);
    renderWindow(store);
    await lookUp(PUBLISHER);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    expect(
      within(dialog()).getByRole('button', { name: /unblock/i })
    ).toBeDisabled();
    expect(within(dialog()).getByText(/^blocked$/i)).toBeInTheDocument();
  });

  it('says what its received and sent figures cover', async () => {
    const payments = Array.from({ length: 500 }, (_, index) => ({
      type: 'PAYMENT',
      timestamp: 1_700_000_000_000 - index,
      signature: `sig${index}`,
      blockHeight: 100 + index,
      creatorAddress: index % 2 ? PUBLISHER : SECOND,
      recipient: index % 2 ? SECOND : PUBLISHER,
      amount: '0.10000000',
    }));
    routes.push((path) =>
      path.startsWith('/transactions/search?') && path.includes(PUBLISHER)
        ? { body: payments }
        : undefined
    );
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    expect(
      await within(dialog()).findByText(/in its newest 500 payments/i)
    ).toBeInTheDocument();
    // 250 payments of 0.1 each way.
    expect(within(dialog()).getAllByText('25.00')).toHaveLength(2);
  });
});
