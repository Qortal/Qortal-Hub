import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { useRetrieveDataLocalStorage } from './useRetrieveDataLocalStorage';
import { sortablePinnedAppsAtom } from '../atoms/global';
import { defaultPinnedApps } from '../components/Apps/config/officialApps';
import { setPinnedAppsAccount } from '../utils/pinnedAppsStorage';

const pins = (...names: string[]) =>
  names.map((name) => ({ name, service: 'APP' }));

const saved = (address: string, list: unknown) =>
  localStorage.setItem(
    `ext_saved_settings:${address}`,
    JSON.stringify({ timestamp: 10, sortablePinnedApps: list })
  );

const signIn = () => {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    ({ address }: { address?: string }) => useRetrieveDataLocalStorage(address),
    { wrapper, initialProps: { address: undefined } }
  );
  return {
    as: (address: string) => act(() => hook.rerender({ address })),
    pinned: () => store.get(sortablePinnedAppsAtom),
  };
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  setPinnedAppsAccount(null);
  vi.restoreAllMocks();
});

describe('useRetrieveDataLocalStorage', () => {
  it("shows each account its own pins, never the previous account's", () => {
    saved('QAlice', pins('Private for Alice'));
    const session = signIn();

    session.as('QAlice');
    expect(session.pinned()).toEqual(pins('Private for Alice'));

    session.as('QBob');
    expect(session.pinned()).toEqual(defaultPinnedApps);
  });

  it('gives the old shared list to the first account that signs in', () => {
    localStorage.setItem(
      'ext_saved_settings',
      JSON.stringify({ timestamp: 5, sortablePinnedApps: pins('Old') })
    );
    const session = signIn();

    session.as('QAlice');
    expect(session.pinned()).toEqual(pins('Old'));

    session.as('QBob');
    expect(session.pinned()).toEqual(defaultPinnedApps);
  });

  it('goes on signing in when storage is too full to move the old list', () => {
    const shared = JSON.stringify({
      timestamp: 5,
      sortablePinnedApps: pins('Old'),
    });
    localStorage.setItem('ext_saved_settings', shared);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const session = signIn();

    session.as('QAlice');

    expect(session.pinned()).toEqual(defaultPinnedApps);
    expect(localStorage.getItem('ext_saved_settings')).toBe(shared);
  });
});
