import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
afterEach(() => setPinnedAppsAccount(null));

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

  it("reads when the signed-in account's pins last changed", () => {
    setPinnedAppsAccount('QAlice');
    expect(localPinnedAppsTimestamp()).toBe(-1);
    localStorage.setItem('ext_saved_settings:QAlice', '{"timestamp":42}');
    expect(localPinnedAppsTimestamp()).toBe(42);
    localStorage.setItem('ext_saved_settings:QAlice', 'not json');
    expect(localPinnedAppsTimestamp()).toBe(-1);
  });
});
