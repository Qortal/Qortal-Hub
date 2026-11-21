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
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// Block in the account header, replayed as a user would: the account's page
// is on screen while the node is still answering for its name.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const PUBLIC_KEY = `${'k'.repeat(44)}`;

type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let listActions: Array<{ type: string; listName: string; items: string[] }> =
  [];

const quietAccount =
  (address: string, name: string): Route =>
  (path) => {
    if (path === `/addresses/${address}`)
      return {
        body: {
          address,
          reference: 'ref',
          publicKey: PUBLIC_KEY,
          level: 3,
          blocksMinted: 250_000,
          blocksMintedAdjustment: 0,
          blocksMintedPenalty: 0,
        },
      };
    if (path === `/names/primary/${address}`)
      return { body: { name, owner: address } };
    if (path.startsWith(`/names/address/${address}`))
      return { body: [{ name, owner: address }] };
    if (path === `/groups/member/${address}`) return { body: [] };
    if (path === `/addresses/balance/${address}`) return { body: 12.5 };
    if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
    if (path.startsWith('/transactions/search?')) return { body: [] };
    if (path === '/addresses/online') return { body: [] };
    if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
    if (path.startsWith('/transactions/')) return { body: [] };
    if (path === '/admin/status') return { status: 500, body: {} };
    return undefined;
  };

beforeEach(() => {
  routes = [];
  listActions = [];
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      for (const route of routes) {
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
  // Hub's bridge to the node's lists (blockedAddresses, blockedNames).
  (window as unknown as { sendMessage: unknown }).sendMessage = vi.fn(
    async (
      type: string,
      payload: { type: string; listName: string; items?: string[] }
    ) => {
      if (type === 'listActions' && payload.type !== 'get')
        listActions.push({
          type: payload.type,
          listName: payload.listName,
          items: payload.items ?? [],
        });
      return payload.type === 'get' ? [] : true;
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { sendMessage?: unknown }).sendMessage;
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <ExplorerWindow isOpenDrawerLookup={open} setIsOpenDrawerLookup={setOpen} />
  );
}

function renderSignedIn() {
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

const dialog = () => screen.getByRole('dialog');

describe('AccountHeader Block', () => {
  it("blocks the account's name along with its address, also when Block is pressed before the name has loaded", async () => {
    let releaseName: () => void = () => undefined;
    const nameLater = new Promise<void>((resolve) => {
      releaseName = resolve;
    });
    routes.push(
      (path) =>
        path === `/names/primary/${PUBLISHER}`
          ? {
              body: { name: 'Publisher', owner: PUBLISHER },
              delay: nameLater,
            }
          : undefined,
      quietAccount(PUBLISHER, 'Publisher')
    );
    renderSignedIn();
    act(() => {
      executeEvent('openUserLookupDrawer', { addressOrName: PUBLISHER });
    });

    // The account is on screen; its name is still on its way.
    const block = await within(dialog()).findByRole('button', {
      name: /^block$/i,
    });
    fireEvent.click(block);

    await act(async () => {
      releaseName();
      await nameLater;
    });
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    // Let any block that was started finish.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const blockedAddress = listActions.some(
      (call) =>
        call.type === 'add' &&
        call.listName === 'blockedAddresses' &&
        call.items.includes(PUBLISHER)
    );
    const blockedName = listActions.some(
      (call) =>
        call.type === 'add' &&
        call.listName === 'blockedNames' &&
        call.items.includes('Publisher')
    );
    // Either Block waited (nothing blocked yet), or it blocked both, as
    // User search did: never the address alone while the name was unknown.
    expect({ blockedAddress, blockedName }).not.toEqual({
      blockedAddress: true,
      blockedName: false,
    });
  });

  it('blocks the name and the address once the name has loaded', async () => {
    routes.push(quietAccount(PUBLISHER, 'Publisher'));
    renderSignedIn();
    act(() => {
      executeEvent('openUserLookupDrawer', { addressOrName: PUBLISHER });
    });
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^block$/i }));
    await waitFor(() =>
      expect(listActions).toEqual([
        { type: 'add', listName: 'blockedNames', items: ['Publisher'] },
        { type: 'add', listName: 'blockedAddresses', items: [PUBLISHER] },
      ])
    );
  });
});
