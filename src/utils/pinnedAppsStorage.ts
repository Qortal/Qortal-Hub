/**
 * Pinned apps are kept in localStorage per account. Under one shared key, the
 * next account to sign in saw the previous account's pins, private apps
 * included, and its changes then replaced them.
 */

export const PINNED_APPS_STORAGE_KEY = 'ext_saved_settings';

let currentAccount: string | null = null;

/** Called when an account signs in, before its pins are read. */
export const setPinnedAppsAccount = (address: string | null | undefined) => {
  currentAccount = address || null;
};

/** The localStorage key holding an account's pins (the signed-in one by default). */
export const pinnedAppsStorageKey = (
  address: string | null | undefined = currentAccount
): string =>
  address ? `${PINNED_APPS_STORAGE_KEY}:${address}` : PINNED_APPS_STORAGE_KEY;

/** Maps the shared key callers use to the signed-in account's own key. */
export const localStorageKeyFor = (key: string): string =>
  key === PINNED_APPS_STORAGE_KEY ? pinnedAppsStorageKey() : key;

/**
 * The list saved under the old shared key moves, once, to the first account
 * that signs in after this change, which is most often its owner. Every other
 * account starts from its own settings saved on QDN.
 */
export const adoptSharedPinnedApps = (
  address: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage
): void => {
  const ownKey = pinnedAppsStorageKey(address);
  if (storage.getItem(ownKey) !== null) return;
  const shared = storage.getItem(PINNED_APPS_STORAGE_KEY);
  if (shared === null) return;
  storage.setItem(ownKey, shared);
  storage.removeItem(PINNED_APPS_STORAGE_KEY);
};

/** When the signed-in account's pins last changed on this device, or -1. */
export const localPinnedAppsTimestamp = (
  storage: Pick<Storage, 'getItem'> = localStorage
): number => {
  try {
    const saved = JSON.parse(storage.getItem(pinnedAppsStorageKey()) ?? 'null');
    return typeof saved?.timestamp === 'number' ? saved.timestamp : -1;
  } catch {
    return -1;
  }
};
