import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { useQortalGetSaveSettings } from './useQortalGetSaveSettings';
import { useRetrieveDataLocalStorage } from './useRetrieveDataLocalStorage';
import {
  canSaveSettingToQdnAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';
import { setPinnedAppsAccount } from '../utils/pinnedAppsStorage';

const qdn = vi.hoisted(() => ({ settings: null as unknown }));

vi.mock('../App', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
}));
vi.mock('../components/Group/Group', () => ({
  decryptResource: async () => ({ data: '' }),
}));
vi.mock('../encryption/encryption', () => ({
  base64ToUint8Array: () => new Uint8Array(),
  uint8ArrayToObject: () => qdn.settings,
}));

const pins = (...names: string[]) =>
  names.map((name) => ({ name, service: 'APP' }));

/** The account's settings on QDN, published `updated` ms since the epoch. */
const publishedOnQdn = (updated: number, sortablePinnedApps: unknown) => {
  qdn.settings = { sortablePinnedApps };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('identifier=ext_saved_settings')
        ? ({ ok: true, json: async () => [{ updated }] } as Response)
        : ({ ok: true, text: async () => 'encrypted' } as Response)
    )
  );
};

/** What this device saved locally for an account, through the real helper. */
const savedLocally = (address: string, sortablePinnedApps: unknown) => {
  setPinnedAppsAccount(address);
  saveToLocalStorage(
    'ext_saved_settings',
    'sortablePinnedApps',
    sortablePinnedApps
  );
  setPinnedAppsAccount(null);
};

/** Signs in and waits until the QDN answer has been handled. */
const signIn = async (address: string, name: string) => {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  renderHook(
    () => {
      useRetrieveDataLocalStorage(address);
      useQortalGetSaveSettings(name, true);
    },
    { wrapper }
  );
  await waitFor(() => expect(store.get(canSaveSettingToQdnAtom)).toBe(true));
  return store.get(sortablePinnedAppsAtom);
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  setPinnedAppsAccount(null);
  vi.unstubAllGlobals();
});

describe('useQortalGetSaveSettings at sign-in', () => {
  it('restores the QDN pins after a Revert', async () => {
    publishedOnQdn(Date.now() - 60_000, pins('Saved on QDN'));
    // Revert, as Save does it: no list, and a timestamp newer than QDN's.
    savedLocally('QAlice', null);

    expect(await signIn('QAlice', 'Alice')).toEqual(pins('Saved on QDN'));
  });

  it('keeps a local list emptied after the QDN publish', async () => {
    publishedOnQdn(Date.now() - 60_000, pins('Saved on QDN'));
    savedLocally('QAlice', []);

    expect(await signIn('QAlice', 'Alice')).toEqual([]);
  });

  it('takes the QDN pins over an older local list', async () => {
    savedLocally('QAlice', pins('Older on this device'));
    publishedOnQdn(Date.now() + 60_000, pins('Saved on QDN'));

    expect(await signIn('QAlice', 'Alice')).toEqual(pins('Saved on QDN'));
  });
});
