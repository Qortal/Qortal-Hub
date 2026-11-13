import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PINNED_APPS_STORAGE_KEY,
  adoptSharedPinnedApps,
  localPinnedAppsTimestamp,
  localStorageKeyFor,
  pinnedAppsStorageKey,
  setPinnedAppsAccount,
} from './pinnedAppsStorage';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';

const pins = (...names: string[]) =>
  names.map((name) => ({ name, service: 'APP' }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  setPinnedAppsAccount(null);
  vi.restoreAllMocks();
});

describe('pinned apps storage', () => {
  it('keeps each account under its own key', () => {
    expect(pinnedAppsStorageKey('QAlice')).toBe('ext_saved_settings:QAlice');
    expect(pinnedAppsStorageKey(null)).toBe(PINNED_APPS_STORAGE_KEY);

    setPinnedAppsAccount('QAlice');
    expect(localStorageKeyFor('ext_saved_settings')).toBe(
      'ext_saved_settings:QAlice'
    );
    expect(localStorageKeyFor('ext_saved_settings_import_export')).toBe(
      'ext_saved_settings_import_export'
    );
  });

  it('saves one account without touching another', () => {
    setPinnedAppsAccount('QAlice');
    saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', pins('A'));
    setPinnedAppsAccount('QBob');
    saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', pins('B'));

    const read = (address: string) =>
      JSON.parse(localStorage.getItem(`ext_saved_settings:${address}`) ?? '{}')
        .sortablePinnedApps;
    expect(read('QAlice')).toEqual(pins('A'));
    expect(read('QBob')).toEqual(pins('B'));
    expect(localStorage.getItem(PINNED_APPS_STORAGE_KEY)).toBeNull();
  });

  it('gives the old shared list to the first account, once', () => {
    localStorage.setItem(
      PINNED_APPS_STORAGE_KEY,
      JSON.stringify({ timestamp: 5, sortablePinnedApps: pins('Shared') })
    );

    adoptSharedPinnedApps('QAlice');
    adoptSharedPinnedApps('QBob');

    expect(localStorage.getItem('ext_saved_settings:QAlice')).toContain(
      'Shared'
    );
    expect(localStorage.getItem('ext_saved_settings:QBob')).toBeNull();
    expect(localStorage.getItem(PINNED_APPS_STORAGE_KEY)).toBeNull();
  });

  it("never replaces an account's own list", () => {
    localStorage.setItem('ext_saved_settings:QAlice', '{"timestamp":9}');
    localStorage.setItem(PINNED_APPS_STORAGE_KEY, '{"timestamp":5}');

    adoptSharedPinnedApps('QAlice');

    expect(localStorage.getItem('ext_saved_settings:QAlice')).toBe(
      '{"timestamp":9}'
    );
  });

  it('keeps the old list when its copy cannot be saved', () => {
    const shared = '{"timestamp":5,"sortablePinnedApps":[]}';
    const storage = {
      items: new Map([[PINNED_APPS_STORAGE_KEY, shared]]),
      getItem(key: string) {
        return this.items.get(key) ?? null;
      },
      setItem() {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      },
      removeItem(key: string) {
        this.items.delete(key);
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => adoptSharedPinnedApps('QAlice', storage)).not.toThrow();
    expect(storage.getItem(PINNED_APPS_STORAGE_KEY)).toBe(shared);
    expect(storage.getItem('ext_saved_settings:QAlice')).toBeNull();
  });

  it("reads when the signed-in account's pins last changed", () => {
    const save = (value: object) =>
      localStorage.setItem('ext_saved_settings:QAlice', JSON.stringify(value));
    setPinnedAppsAccount('QAlice');
    expect(localPinnedAppsTimestamp()).toBe(-1);

    save({ timestamp: 42, sortablePinnedApps: pins('A') });
    expect(localPinnedAppsTimestamp()).toBe(42);

    // All pins removed: still a list, and still newer than an older QDN copy.
    save({ timestamp: 43, sortablePinnedApps: [] });
    expect(localPinnedAppsTimestamp()).toBe(43);

    // Revert leaves no list behind, only a timestamp: nothing to compare.
    save({ timestamp: 44, sortablePinnedApps: null });
    expect(localPinnedAppsTimestamp()).toBe(-1);
    save({ timestamp: 45 });
    expect(localPinnedAppsTimestamp()).toBe(-1);

    localStorage.setItem('ext_saved_settings:QAlice', 'not json');
    expect(localPinnedAppsTimestamp()).toBe(-1);
  });
});
