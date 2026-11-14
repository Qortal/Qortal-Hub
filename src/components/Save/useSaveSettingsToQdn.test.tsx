import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

const qdn = vi.hoisted(() => ({
  record: { hasPublishRecord: false, timestamp: 0 },
  settings: null as unknown,
  asked: 0,
}));

const sent = vi.hoisted(() => ({
  calls: [] as { action: string; payload: Record<string, unknown> }[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../App', async () => {
  const { createContext } = await import('react');
  return {
    QORTAL_APP_CONTEXT: createContext({ show: async () => undefined }),
    getBaseApiReact: () => 'http://127.0.0.1:12391',
    getArbitraryEndpointReact: () => '/arbitrary/resources/searchsimple',
  };
});

vi.mock('../../background/background', () => ({
  getFee: async () => ({ fee: '0.01' }),
}));

vi.mock('../../qdn/encryption/group-encryption', () => ({
  objectToBase64: async (value: unknown) => JSON.stringify(value),
}));

vi.mock('../../hooks/useQortalGetSaveSettings', () => ({
  getPublishRecord: async () => {
    qdn.asked += 1;
    return qdn.record;
  },
  getPublish: async () => qdn.settings,
}));

vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import { oldPinnedAppsAtom, sortablePinnedAppsAtom } from '../../atoms/global';
import {
  pinnedAppsStorageKey,
  setPinnedAppsAccount,
} from '../../utils/pinnedAppsStorage';
import { useSaveSettingsToQdn } from './useSaveSettingsToQdn';

const ADDRESS = 'Qaddress';
const NAME = 'simon';

const pin = (name: string) => ({ name, service: 'APP' });

/** The hook, with the pins this device has. */
const renderSave = (pins: unknown[]) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins);
  const { result } = renderHook(() => useSaveSettingsToQdn(ADDRESS, NAME), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  return { store, save: result.current };
};

/** The pin list that went into the publish. */
const publishedPins = () => {
  const call = sent.calls.find((entry) => entry.action === 'ENCRYPT_DATA');
  return JSON.parse(String(call?.payload?.data64)).sortablePinnedApps;
};

/** The pin list this device kept. */
const keptHere = () =>
  JSON.parse(localStorage.getItem(pinnedAppsStorageKey(ADDRESS)) || 'null')
    ?.sortablePinnedApps;

beforeEach(() => {
  localStorage.clear();
  setPinnedAppsAccount(ADDRESS);
  qdn.record = { hasPublishRecord: false, timestamp: 0 };
  qdn.settings = null;
  qdn.asked = 0;
  sent.calls = [];
  (window as unknown as { sendMessage: unknown }).sendMessage = vi.fn(
    async (action: string, payload: Record<string, unknown>) => {
      sent.calls.push({ action, payload });
      return action === 'publishOnQDN'
        ? { identifier: 'ext_saved_settings' }
        : { encrypted: 'encrypted' };
    }
  );
});

afterEach(() => {
  setPinnedAppsAccount(null);
  vi.unstubAllGlobals();
});

describe('saving the settings to QDN', () => {
  it('keeps an app pinned on another device', async () => {
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = { sortablePinnedApps: [pin('Q-Mail')] };
    const { store, save } = renderSave([pin('Q-Tube')]);

    await act(async () => {
      expect(await save()).toBe('saved');
    });

    const both = [pin('Q-Tube'), pin('Q-Mail')];
    expect(publishedPins()).toEqual(both);
    expect(store.get(sortablePinnedAppsAtom)).toEqual(both);
    // What is saved now, so the Save button has nothing left to offer.
    expect(store.get(oldPinnedAppsAtom)).toEqual(both);
    // And on this device, for the next sign-in.
    expect(keptHere()).toEqual(both);
  });

  it("publishes this device's list when told to write over", async () => {
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = { sortablePinnedApps: [pin('Q-Mail')] };
    const { save } = renderSave([pin('Q-Tube')]);

    await act(async () => {
      expect(await save({ overwrite: true })).toBe('saved');
    });

    expect(qdn.asked).toBe(0);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
  });

  it('leaves the list alone when nothing newer was saved', async () => {
    const { store, save } = renderSave([pin('Q-Tube')]);

    await act(async () => {
      expect(await save()).toBe('saved');
    });

    expect(qdn.asked).toBe(1);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    expect(keptHere()).toBeUndefined();
  });
});
