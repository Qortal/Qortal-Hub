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
