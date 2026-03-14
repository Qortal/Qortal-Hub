import { useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import {
  customWebsocketSubscriptionsByAddressAtom,
  notificationSeenInAppKeysAtom,
  seenAllNotificationsByAddressAtom,
} from '../../atoms/global';
import { ELECTRON_PERSISTENT_ATOM_KEYS } from '../../utils/electronPersistentStorage';

/**
 * When running in Electron, loads persisted values from appStorage and sets
 * the atoms so the UI shows the correct state. Renders nothing.
 */
export function ElectronPersistentStorageHydration() {
  const setCustomSubscriptionsByAddress = useSetAtom(customWebsocketSubscriptionsByAddressAtom);
  const setSeenInAppKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const setSeenAllNotificationsByAddress = useSetAtom(seenAllNotificationsByAddressAtom);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const appStorage = (window as Window & { appStorage?: { get: (k: string) => Promise<unknown> } }).appStorage;
    if (!appStorage || hydratedRef.current) return;
    hydratedRef.current = true;

    (async () => {
      const [subsPayload, seen, seenAllPayload] = await Promise.all([
        appStorage.get(ELECTRON_PERSISTENT_ATOM_KEYS.customWsSubscriptionsByAddress),
        appStorage.get(ELECTRON_PERSISTENT_ATOM_KEYS.notificationSeenInApp),
        appStorage.get(ELECTRON_PERSISTENT_ATOM_KEYS.seenAllNotificationsByAddress),
      ]);
      if (subsPayload != null) {
        if (Array.isArray(subsPayload)) {
          setCustomSubscriptionsByAddress({ __legacy: subsPayload });
        } else if (typeof subsPayload === 'object' && !Array.isArray(subsPayload)) {
          setCustomSubscriptionsByAddress(subsPayload as Record<string, import('../../atoms/global').CustomWebsocketSubscription[]>);
        }
      }
      if (Array.isArray(seen)) setSeenInAppKeys(seen);
      if (seenAllPayload != null && typeof seenAllPayload === 'object' && !Array.isArray(seenAllPayload)) {
        setSeenAllNotificationsByAddress(seenAllPayload as Record<string, number | null>);
      }
    })();
  }, [setCustomSubscriptionsByAddress, setSeenInAppKeys, setSeenAllNotificationsByAddress]);

  return null;
}
