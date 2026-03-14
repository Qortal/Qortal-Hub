/**
 * Jotai-compatible storage that backs onto window.appStorage (Electron persistent-store.json).
 * Uses an in-memory cache for sync getItem; setItem/removeItem persist async.
 * Use for atoms that should persist in Electron the same way as permissions.
 */

/** Sync storage compatible with Jotai's atomWithStorage (getItem returns same type as initialValue). */
export type ElectronPersistentStorage = {
  getItem: <T>(key: string, initialValue: T) => T;
  setItem: (key: string, value: unknown) => void;
  removeItem: (key: string) => void;
};

const cache: Record<string, unknown> = {};
let storageInstance: ElectronPersistentStorage | null = null;

function getAppStorage(): Window['appStorage'] {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { appStorage?: Window['appStorage'] }).appStorage;
}

export function getElectronPersistentStorage(): ElectronPersistentStorage | undefined {
  if (!getAppStorage()) return undefined;
  if (storageInstance) return storageInstance;
  const appStorage = getAppStorage()!;
  storageInstance = {
    getItem<T>(key: string, initialValue: T): T {
      return (key in cache ? cache[key] : initialValue) as T;
    },
    setItem(key: string, value: unknown): void {
      cache[key] = value;
      appStorage.set(key, value).catch((err) =>
        console.error('[electronPersistentStorage] setItem failed:', err)
      );
    },
    removeItem(key: string): void {
      delete cache[key];
      appStorage.delete(key).catch((err) =>
        console.error('[electronPersistentStorage] removeItem failed:', err)
      );
    },
  };
  return storageInstance;
}

/** Keys used for notification/ws atoms so hydration can load them. */
export const ELECTRON_PERSISTENT_ATOM_KEYS = {
  customWsSubscriptionsByAddress: 'qortal_custom_ws_subscriptions',
  notificationSeenInApp: 'qortal_notification_seen_in_app',
  seenAllNotificationsByAddress: 'qortal_seen_all_notifications',
} as const;

/** Populate in-memory cache from appStorage (call once when app mounts in Electron). */
export async function hydrateElectronPersistentCache(): Promise<void> {
  const appStorage = getAppStorage();
  if (!appStorage) return;
  const keys = Object.values(ELECTRON_PERSISTENT_ATOM_KEYS);
  const results = await Promise.all(keys.map((k) => appStorage.get(k)));
  keys.forEach((key, i) => {
    const value = results[i];
    if (value !== undefined && value !== null) cache[key] = value;
  });
}
