import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  DM_FRIENDS_LEGACY_BUCKET_KEY,
  dmFriendsByAccountAtom,
  parseDmFriendsPersisted,
  customWebsocketSubscriptionsByAddressAtom,
  filterSeenInAppRecordByAge,
  notificationSeenInAppKeysRecordAtom,
  parseSeenInAppStored,
  seenAllNotificationsByAddressAtom,
  userInfoAtom,
} from '../../atoms/global';
import {
  hydrateElectronPersistentCache,
  ELECTRON_PERSISTENT_ATOM_KEYS,
  primeElectronPersistentCacheKey,
} from '../../utils/electronPersistentStorage';

/**
 * When running in Electron, loads persisted values from appStorage and sets
 * the atoms so the UI shows the correct state. Renders nothing.
 */
export function ElectronPersistentStorageHydration() {
  const setCustomSubscriptionsByAddress = useSetAtom(
    customWebsocketSubscriptionsByAddressAtom
  );
  const setSeenInAppRecord = useSetAtom(notificationSeenInAppKeysRecordAtom);
  const setSeenAllNotificationsByAddress = useSetAtom(
    seenAllNotificationsByAddressAtom
  );
  const setDmFriendsByAccount = useSetAtom(dmFriendsByAccountAtom);
  const userAddress = useAtomValue(userInfoAtom)?.address;
  const dmFriendsByAccount = useAtomValue(dmFriendsByAccountAtom);
  const hydratedRef = useRef(false);
  const dmFriendsLegacyPresent = useMemo(
    () => Boolean(dmFriendsByAccount[DM_FRIENDS_LEGACY_BUCKET_KEY]),
    [dmFriendsByAccount]
  );

  useLayoutEffect(() => {
    if (!userAddress || !dmFriendsLegacyPresent) return;
    setDmFriendsByAccount((prev) => {
      const legacy = prev[DM_FRIENDS_LEGACY_BUCKET_KEY];
      if (!legacy || typeof legacy !== 'object') return prev;
      const mine = prev[userAddress] ?? {};
      const merged = { ...legacy, ...mine };
      const { [DM_FRIENDS_LEGACY_BUCKET_KEY]: _, ...rest } = prev;
      return { ...rest, [userAddress]: merged };
    });
  }, [userAddress, dmFriendsLegacyPresent, setDmFriendsByAccount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const appStorage = (
      window as Window & {
        appStorage?: { get: (k: string) => Promise<unknown> };
      }
    ).appStorage;
    if (!appStorage || hydratedRef.current) return;
    hydratedRef.current = true;

    (async () => {
      await hydrateElectronPersistentCache();
      const [subsPayload, seen, seenAllPayload, dmFriendsPayload] =
        await Promise.all([
          appStorage.get(
            ELECTRON_PERSISTENT_ATOM_KEYS.customWsSubscriptionsByAddress
          ),
          appStorage.get(ELECTRON_PERSISTENT_ATOM_KEYS.notificationSeenInApp),
          appStorage.get(
            ELECTRON_PERSISTENT_ATOM_KEYS.seenAllNotificationsByAddress
          ),
          appStorage.get(ELECTRON_PERSISTENT_ATOM_KEYS.dmFriends),
        ]);
      if (subsPayload != null) {
        if (Array.isArray(subsPayload)) {
          setCustomSubscriptionsByAddress({ __legacy: subsPayload });
        } else if (
          typeof subsPayload === 'object' &&
          !Array.isArray(subsPayload)
        ) {
          setCustomSubscriptionsByAddress(
            subsPayload as Record<
              string,
              import('../../atoms/global').CustomWebsocketSubscription[]
            >
          );
        }
      }
      if (seen != null && typeof seen === 'object' && !Array.isArray(seen)) {
        const record = filterSeenInAppRecordByAge(parseSeenInAppStored(seen));
        if (Object.keys(record).length > 0) setSeenInAppRecord(record);
      }
      if (
        seenAllPayload != null &&
        typeof seenAllPayload === 'object' &&
        !Array.isArray(seenAllPayload)
      ) {
        setSeenAllNotificationsByAddress(
          seenAllPayload as Record<string, number | null>
        );
      }
      if (
        dmFriendsPayload != null &&
        typeof dmFriendsPayload === 'object' &&
        !Array.isArray(dmFriendsPayload)
      ) {
        setDmFriendsByAccount(parseDmFriendsPersisted(dmFriendsPayload));
      }
    })();
  }, [
    setCustomSubscriptionsByAddress,
    setSeenInAppRecord,
    setSeenAllNotificationsByAddress,
    setDmFriendsByAccount,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const appStorage = (
      window as Window & {
        appStorage?: { get: (k: string) => Promise<unknown> };
      }
    ).appStorage;
    if (!appStorage) return;

    let cancelled = false;
    const key = ELECTRON_PERSISTENT_ATOM_KEYS.seenAllNotificationsByAddress;
    void (async () => {
      try {
        const seenAllPayload = await appStorage.get(key);
        if (cancelled) return;
        if (
          seenAllPayload != null &&
          typeof seenAllPayload === 'object' &&
          !Array.isArray(seenAllPayload)
        ) {
          primeElectronPersistentCacheKey(key, seenAllPayload);
          setSeenAllNotificationsByAddress(
            seenAllPayload as Record<string, number | null>
          );
        }
      } catch (err) {
        console.error(
          '[ElectronPersistentStorageHydration] reload seen-all on address change:',
          err
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userAddress, setSeenAllNotificationsByAddress]);

  return null;
}
