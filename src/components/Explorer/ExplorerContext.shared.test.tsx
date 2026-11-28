import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

// One read shown in two places (the header and the trail both show the
// account's name, through useExplorerRead and the window's cache). Retry
// on one of them, after the node failed both.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const PUBLIC_KEY = `${'k'.repeat(44)}`;

let publisherNameFails = false;

function answerFor(path: string): { status?: number; body: unknown } {
  if (path === `/names/primary/${PUBLISHER}`)
    return publisherNameFails
      ? { status: 503, body: { error: 1, message: 'busy' } }
      : { body: { name: 'Publisher', owner: PUBLISHER } };
  for (const [address, name] of [
    [PUBLISHER, 'Publisher'],
    [SECOND, 'Second'],
  ]) {
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
    if (path === `/addresses/balance/${address}`) return { body: 1 };
    if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
  }
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/names/search?')) return { body: [] };
  if (path.startsWith('/transactions/')) return { body: [] };
  return { status: 500, body: { error: 1, message: 'not here' } };
}

beforeEach(() => {
  publisherNameFails = false;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { status = 200, body } = answerFor(
        String(url).slice('http://node.test'.length)
      );
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <ExplorerWindow isOpenDrawerLookup={open} setIsOpenDrawerLookup={setOpen} />
  );
}

const dialog = () => screen.getByRole('dialog');

describe('one read shown in two places', () => {
  it('shows the name everywhere once Retry has read it, not only where Retry was pressed', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: READER, name: 'Reader' } as never);
    render(
      <Provider store={store}>
        <ThemeProvider theme={darkTheme}>
          <Harness />
        </ThemeProvider>
      </Provider>
    );
    act(() => {
      executeEvent('openUserLookupDrawer', { addressOrName: SECOND });
    });
    await within(dialog()).findByRole('heading', { level: 2, name: 'Second' });

    // Publisher, opened from Second while the node can't answer for its name.
    publisherNameFails = true;
    act(() => {
      executeEvent('openUserLookupDrawer', { addressOrName: PUBLISHER });
    });
    const trail = await within(dialog()).findByRole('navigation', {
      name: /trail/i,
    });
    await within(dialog()).findAllByRole('button', { name: /retry/i });

    // The node answers again; Retry on the header's failed name.
    publisherNameFails = false;
    const retries = within(dialog()).getAllByRole('button', { name: /retry/i });
    fireEvent.click(retries[0]);
    await within(dialog()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });

    // The trail's step for this account shows the same name.
    const current = trail.querySelector('[aria-current="page"] bdi');
    expect(current?.textContent).toBe('Publisher');
  });
});
