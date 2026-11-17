import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

import { availableQappsAtom } from '../../../atoms/appsAtoms';
import { HIDDEN_APPS_REFRESH_MS, useHiddenAppsLoader } from './useHiddenApps';

const LIBRARY = [
  { service: 'APP', name: 'Q-Blog' },
  { service: 'WEBSITE', name: 'Q-Blog' },
  { service: 'APP', name: 'Mine' },
  { service: 'APP', name: 'Back' },
];

const record = (name: string, service: string, title: string) => ({
  name,
  service: 'JSON',
  identifier: `qhub_app_hidden_v1_${service}`,
  metadata: { title },
});

const answer = (records: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/names/address/QMe')) {
      return new Response(JSON.stringify([{ name: 'Mine' }]));
    }
    if (url.includes('identifier=qhub_app_hidden_v1_')) {
      return new Response(JSON.stringify(records), { status });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

const listed = (store: ReturnType<typeof createStore>) =>
  store.get(availableQappsAtom).map((app) => `${app.service}/${app.name}`);

const load = () => {
  const store = createStore();
  store.set(availableQappsAtom, LIBRARY);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(() => useHiddenAppsLoader('QMe', 'Me'), {
    wrapper,
  });
  return { store, hook };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('apps hidden by their publishers', () => {
  it('leave the library, but the user’s own stay listed for them', async () => {
    answer([
      record('Q-Blog', 'APP', 'hidden'),
      record('Mine', 'APP', 'hidden'),
      record('Back', 'APP', 'shown'),
    ]);
    const { store } = load();
    await waitFor(() =>
      expect(listed(store)).toEqual(['WEBSITE/Q-Blog', 'APP/Mine', 'APP/Back'])
    );
    // A new list from the node is filtered the same way.
    act(() => {
      store.set(availableQappsAtom, [
        ...LIBRARY,
        { service: 'APP', name: 'New' },
      ]);
    });
    expect(listed(store)).toEqual([
      'WEBSITE/Q-Blog',
      'APP/Mine',
      'APP/Back',
      'APP/New',
    ]);
  });

  it('leave the library as it is when the node can’t say', async () => {
    const fetch = answer({ error: 'down' }, 500);
    const { store } = load();
    await waitFor(() =>
      expect(
        fetch.mock.calls.some((call) =>
          String(call[0]).includes('qhub_app_hidden_v1_')
        )
      ).toBe(true)
    );
    expect(listed(store)).toEqual(
      LIBRARY.map((app) => `${app.service}/${app.name}`)
    );
  });

  it('are asked for again every 10 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = answer([]);
    const { hook } = load();
    const asked = () =>
      fetch.mock.calls.filter((call) =>
        String(call[0]).includes('qhub_app_hidden_v1_')
      ).length;
    await waitFor(() => expect(asked()).toBe(1));
    await act(async () => {
      vi.advanceTimersByTime(HIDDEN_APPS_REFRESH_MS);
    });
    expect(asked()).toBe(2);
    hook.unmount();
    await act(async () => {
      vi.advanceTimersByTime(HIDDEN_APPS_REFRESH_MS);
    });
    expect(asked()).toBe(2);
  });
});

describe('apps hidden by their publishers, when the node couldn’t say', () => {
  const library = [
    { service: 'APP', name: 'Q-Blog' },
    { service: 'WEBSITE', name: 'Q-Blog' },
  ];

  it('are asked for again within a minute, not at the next round', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The node is still starting when Hub first asks.
    let down = true;
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/names/address/')) {
          return new Response(JSON.stringify([]));
        }
        if (url.includes('identifier=qhub_app_hidden_v1_')) {
          return down
            ? new Response('', { status: 503 })
            : new Response(JSON.stringify([record('Q-Blog', 'APP', 'hidden')]));
        }
        throw new Error(`unexpected fetch ${url}`);
      });
    const asked = () =>
      fetch.mock.calls.filter((call) =>
        String(call[0]).includes('qhub_app_hidden_v1_')
      ).length;

    const store = createStore();
    store.set(availableQappsAtom, library);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const hook = renderHook(() => useHiddenAppsLoader('QMe', 'Me'), {
      wrapper,
    });
    await waitFor(() => expect(asked()).toBe(1));
    // Let the failed answer land.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(listed(store)).toEqual(['APP/Q-Blog', 'WEBSITE/Q-Blog']);

    down = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(asked()).toBe(2);
    await waitFor(() => expect(listed(store)).toEqual(['WEBSITE/Q-Blog']));

    // Once it has answered, it's every 10 minutes again, and not after it
    // is gone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(asked()).toBe(2);
    hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });
    expect(asked()).toBe(2);
  });
});

describe('the user’s own hidden apps, when their names couldn’t be read', () => {
  // Each test has an address of its own: the names the node gave for one are
  // kept for the session.

  /** The node is still starting when Hub first asks for the user's names. */
  const namesAtFirstDown = (
    address: string,
    names: string[],
    hidden: unknown[]
  ) => {
    const state = { namesDown: true };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(`/names/address/${address}`)) {
        return state.namesDown
          ? new Response('', { status: 503 })
          : new Response(JSON.stringify(names.map((name) => ({ name }))));
      }
      if (url.includes('identifier=qhub_app_hidden_v1_')) {
        return new Response(JSON.stringify(hidden));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    return state;
  };

  const loadWith = (
    address: string,
    library: { service: string; name: string }[],
    myName: string
  ) => {
    const store = createStore();
    store.set(availableQappsAtom, library);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    renderHook(() => useHiddenAppsLoader(address, myName), { wrapper });
    return store;
  };

  it('come back to their library once the node answers again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The user hid their app under their second name.
    const node = namesAtFirstDown(
      'QMain',
      ['Main', 'Second'],
      [record('Second', 'APP', 'hidden')]
    );
    const store = loadWith(
      'QMain',
      [
        { service: 'APP', name: 'Main' },
        { service: 'APP', name: 'Second' },
      ],
      'Main'
    );
    await waitFor(() => expect(listed(store)).toEqual(['APP/Main']));

    // The node is up; the hidden list is asked for again at its next round.
    node.namesDown = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDDEN_APPS_REFRESH_MS + 1_000);
    });
    // Their own app, under their second name, is theirs to see.
    expect(listed(store)).toEqual(['APP/Main', 'APP/Second']);
  });

  it('come back while other publishers’ hidden apps stay out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Both hidden by their publishers; "Second" is one of the user's names.
    const node = namesAtFirstDown(
      'QSecond',
      ['Me', 'Second'],
      [record('Q-Blog', 'APP', 'hidden'), record('Second', 'APP', 'hidden')]
    );
    const store = loadWith(
      'QSecond',
      [
        { service: 'APP', name: 'Q-Blog' },
        { service: 'APP', name: 'Second' },
      ],
      'Me'
    );
    await waitFor(() => expect(listed(store)).toEqual([]));

    // The node is up again; the hidden list is asked for at its next round.
    node.namesDown = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIDDEN_APPS_REFRESH_MS + 60_000);
    });
    // The app under the user's second name is theirs: it is listed for them,
    // as their apps under their main name are.
    expect(listed(store)).toEqual(['APP/Second']);
  });
});
