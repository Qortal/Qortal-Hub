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
import {
  readSidePanel,
  saveSidePanel,
  SIDE_PANEL_DEFAULT,
  type SidePanelSettings,
  withSidePanelQdnItem,
} from '../Desktop/sidePanel';
import {
  readHomeLayout,
  saveHomeLayout,
} from '../Group/HomeDesktop/homeLayout';
import {
  hasUnsavedLayouts,
  readLocalLayouts,
  savedLayoutsAtom,
  type SavedLayoutsState,
  takeInSavedLayouts,
} from './savedLayouts';
import { useRevertSettings } from './useRevertSettings';
import { useSaveSettingsToQdn } from './useSaveSettingsToQdn';

const ADDRESS = 'Qaddress';
const NAME = 'simon';

const pin = (name: string) => ({ name, service: 'APP' });

/**
 * Saving and reverting, with the pins this device has. `result.current` is
 * read at each call, since both follow what the atoms hold now.
 */
const renderSettings = (pins: unknown[], layouts?: SavedLayoutsState) => {
  const store = createStore();
  store.set(sortablePinnedAppsAtom, pins);
  if (layouts) store.set(savedLayoutsAtom, layouts);
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

describe("saving Home's layout and the side panel", () => {
  const STACK = ['widgets', 'groupActivity', 'feed'];
  const homeLayout = (hidden: string[], changedAt: number) => ({
    v: 1,
    layout: { hidden, stack: STACK },
    changedAt,
  });
  const sidePanel = (settings: SidePanelSettings, changedAt: number) => ({
    v: 1,
    settings,
    changedAt,
  });
  const panelWith = (...names: string[]) =>
    names.reduce(
      (panel, name) => withSidePanelQdnItem(panel, { service: 'APP', name }),
      SIDE_PANEL_DEFAULT
    );
  const addedNames = (settings: { items: { name?: string }[] }) =>
    settings.items.flatMap((item) => (item.name ? [item.name] : []));

  /** What went into the publish. */
  const published = () => {
    const call = sent.calls.find((entry) => entry.action === 'ENCRYPT_DATA');
    return JSON.parse(String(call?.payload?.data64));
  };

  const nothingLeftToSave = (store: ReturnType<typeof createStore>) =>
    !hasUnsavedLayouts(
      store.get(savedLayoutsAtom),
      ADDRESS,
      readLocalLayouts(ADDRESS)
    );

  it('Revert puts them back as saved, with nothing left to save', async () => {
    // Read at sign-in on a device that never changed them, then changed here.
    const signIn = takeInSavedLayouts(ADDRESS, {
      homeLayout: homeLayout(['feed'], 70),
      sidePanel: sidePanel(SIDE_PANEL_DEFAULT, 70),
    });
    saveHomeLayout(ADDRESS, { hidden: ['status'], stack: [] });
    saveSidePanel(ADDRESS, { ...readSidePanel(ADDRESS), show: 'always' });
    const { store, result } = renderSettings([], signIn);
    expect(nothingLeftToSave(store)).toBe(false);

    await act(async () => {
      await result.current.revert();
    });

    expect(readHomeLayout(ADDRESS).hidden).toEqual(['feed']);
    expect(readSidePanel(ADDRESS).show).toBe('hover');
    expect(nothingLeftToSave(store)).toBe(true);
  });

  it('keeps a layout from another device through Cancel, Revert and a later save', async () => {
    const signIn = takeInSavedLayouts(ADDRESS, {
      homeLayout: homeLayout(['feed'], 70),
    });
    saveHomeLayout(ADDRESS, { hidden: ['status'], stack: [] });
    // Another device saved a newer one since.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = {
      sortablePinnedApps: [],
      homeLayout: homeLayout(['groupActivity'], 90),
    };
    const { result } = renderSettings([], signIn);

    ui.cancel = true;
    await act(async () => {
      expect(await result.current.save()).toBe('canceled');
    });
    // Changed both here and there: this device's stays until asked.
    expect(readHomeLayout(ADDRESS).hidden).toEqual(['status']);

    ui.cancel = false;
    await act(async () => {
      await result.current.revert();
    });
    // Revert goes back to the newer one, not to the one read at sign-in.
    expect(readHomeLayout(ADDRESS).hidden).toEqual(['groupActivity']);

    sent.calls = [];
    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });
    expect(qdn.read).toBe(1);
    expect(published().homeLayout).toEqual(
      expect.objectContaining({
        changedAt: 90,
        layout: expect.objectContaining({ hidden: ['groupActivity'] }),
      })
    );
  });

  it('keeps the Q-Apps and websites added to the side panel on another device', async () => {
    const signIn = takeInSavedLayouts(ADDRESS, {
      sidePanel: sidePanel(SIDE_PANEL_DEFAULT, 70),
    });
    saveSidePanel(ADDRESS, { ...panelWith('Q-Tube'), show: 'always' });
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = {
      sortablePinnedApps: [],
      sidePanel: sidePanel(panelWith('Q-Mail'), 90),
    };
    const { store, result } = renderSettings([], signIn);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    const saved = published().sidePanel.settings;
    // This device's settings, with both devices' apps.
    expect(saved.show).toBe('always');
    expect(addedNames(saved)).toEqual(['Q-Tube', 'Q-Mail']);
    // Here too, with nothing left to save or to offer.
    expect(addedNames(readSidePanel(ADDRESS))).toEqual(['Q-Tube', 'Q-Mail']);
    expect(store.get(savedLayoutsAtom).offer).toEqual([]);
    expect(nothingLeftToSave(store)).toBe(true);
  });

  it("keeps this device's side panel order against newer settings with the old one", async () => {
    const signIn = takeInSavedLayouts(ADDRESS, {
      sidePanel: sidePanel(panelWith('A', 'B'), 70),
    });
    saveSidePanel(ADDRESS, panelWith('B', 'A'));
    // Saved since on another device, whose side panel still has A, B.
    qdn.record = { hasPublishRecord: true, timestamp: 500 };
    qdn.settings = {
      sortablePinnedApps: [],
      homeLayout: homeLayout(['feed'], 90),
      sidePanel: sidePanel(panelWith('A', 'B'), 85),
    };
    const { result } = renderSettings([], signIn);

    await act(async () => {
      expect(await result.current.save()).toBe('saved');
    });

    expect(addedNames(published().sidePanel.settings)).toEqual(['B', 'A']);
    expect(addedNames(readSidePanel(ADDRESS))).toEqual(['B', 'A']);
  });
});
