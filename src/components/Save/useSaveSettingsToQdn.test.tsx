import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

const qdn = vi.hoisted(() => ({
  record: { hasPublishRecord: false, timestamp: 0 },
  settings: null as unknown,
  asked: 0,
  read: 0,
}));

/** Whether the question before publishing is answered with Cancel. */
const ui = vi.hoisted(() => ({ cancel: false }));

const sent = vi.hoisted(() => ({
  calls: [] as { action: string; payload: Record<string, unknown> }[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../App', async () => {
  const { createContext } = await import('react');
  return {
    QORTAL_APP_CONTEXT: createContext({
      show: async () => {
        if (ui.cancel) throw { isCanceled: true };
      },
    }),
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
  getPublish: async () => {
    qdn.read += 1;
    return qdn.settings;
  },
}));

vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

import { oldPinnedAppsAtom, sortablePinnedAppsAtom } from '../../atoms/global';
import {
  pinnedAppsStorageKey,
  setPinnedAppsAccount,
} from '../../utils/pinnedAppsStorage';
import { useRevertSettings } from './useRevertSettings';
import { useSaveSettingsToQdn } from './useSaveSettingsToQdn';

const ADDRESS = 'Qaddress';
const NAME = 'simon';

const pin = (name: string) => ({ name, service: 'APP' });

/**
 * Saving and reverting, with the pins this device has. `result.current` is
 * read at each call, since both follow what the atoms hold now.
 */
const renderSettings = (pins: unknown[]) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins);
  const { result } = renderHook(
    () => ({
      save: useSaveSettingsToQdn(ADDRESS, NAME),
      revert: useRevertSettings(ADDRESS),
    }),
    { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> }
  );
  return { store, result };
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
  qdn.read = 0;
  ui.cancel = false;
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
    const { store, result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
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
    const { result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save({ overwrite: true })).toBe('saved');
    });

    expect(qdn.asked).toBe(0);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
  });

  it('leaves the list alone when nothing newer was saved', async () => {
    const { store, result } = renderSettings([pin('Q-Tube')]);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(qdn.asked).toBe(1);
    expect(publishedPins()).toEqual([pin('Q-Tube')]);
    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Tube')]);
    expect(keptHere()).toBeUndefined();
  });

  it('keeps a remote pin through Cancel, Revert and a later save', async () => {
    // Another device pinned Q-Mail and saved.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = { sortablePinnedApps: [pin('Q-Mail')] };
    const { store, result } = renderSettings([pin('Q-Tube')]);

    // The question before publishing is answered with Cancel.
    ui.cancel = true;
    await act(async () => {
      expect(await result.current.save()).toBe('canceled');
    });
    // Those settings are what Revert goes back to now.
    expect(store.get(oldPinnedAppsAtom)).toEqual([pin('Q-Mail')]);

    ui.cancel = false;
    await act(async () => {
      await result.current.revert();
    });
    expect(store.get(sortablePinnedAppsAtom)).toEqual([pin('Q-Mail')]);

    sent.calls = [];
    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    // That version is known, so it is not read or merged a second time.
    expect(qdn.read).toBe(1);
    // And the app pinned on the other device is still there.
    expect(publishedPins()).toEqual([pin('Q-Mail')]);
  });
});
