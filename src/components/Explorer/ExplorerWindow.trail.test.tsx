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

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The trail ("accounts opened one from another") against Back: replayed
// step by step as a user would, on a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const THIRD = `Q${'T'.repeat(33)}`;
const PUBLIC_KEY = `${'k'.repeat(44)}`;

const NAMES: Record<string, string> = {
  [PUBLISHER]: 'Publisher',
  [SECOND]: 'Second',
  [THIRD]: 'Third',
};

function answerFor(path: string): { status?: number; body: unknown } {
  for (const [address, name] of Object.entries(NAMES)) {
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
  if (path === `/names/primary/${READER}`) return { body: { owner: READER } };
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/names/search?')) return { body: [] };
  if (path.startsWith('/transactions/')) return { body: [] };
  return { status: 500, body: { error: 1, message: 'not here' } };
}

beforeEach(() => {
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

const lookUp = (addressOrName: string) =>
  act(() => {
    executeEvent('openUserLookupDrawer', { addressOrName });
  });

const shown = (name: string) =>
  within(dialog()).findByRole('heading', { level: 2, name });

/** The names on the trail, in order, or [] when it isn't shown. */
function trailNames(): string[] {
  const trail = within(dialog()).queryByRole('navigation', {
    name: /trail/i,
  });
  if (!trail) return [];
  return within(trail)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('bdi')?.textContent ?? '');
}

describe('the trail after Back', () => {
  it('shows how the account was reached, not the account searched for after it', async () => {
    renderSignedIn();
    // Publisher, then Second opened from it.
    await lookUp(PUBLISHER);
    await shown('Publisher');
    await lookUp(SECOND);
    await shown('Second');
    expect(trailNames()).toEqual(['Publisher', 'Second']);

    // A new search: Third, a trail of its own.
    const field = within(dialog()).getByRole('combobox', {
      name: /search the explorer/i,
    });
    fireEvent.change(field, { target: { value: THIRD } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await shown('Third');

    // Back to Second: it was reached from Publisher, never from Third.
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await shown('Second');
    expect(trailNames()).not.toContain('Third');
  });

  it('keeps the step in between after a crumb and then Back', async () => {
    renderSignedIn();
    await lookUp(PUBLISHER);
    await shown('Publisher');
    await lookUp(SECOND);
    await shown('Second');
    await lookUp(THIRD);
    await shown('Third');
    expect(trailNames()).toEqual(['Publisher', 'Second', 'Third']);

    // The first crumb, then Back: Third again, which was opened from Second.
    const trail = within(dialog()).getByRole('navigation', { name: /trail/i });
    fireEvent.click(within(trail).getByRole('button', { name: /Publisher/ }));
    await shown('Publisher');
    fireEvent.click(within(dialog()).getByRole('button', { name: /^back$/i }));
    await shown('Third');
    const names = trailNames();
    if (names.length)
      expect(names.slice(names.indexOf('Third') - 1)).toEqual([
        'Second',
        'Third',
      ]);
  });
});
