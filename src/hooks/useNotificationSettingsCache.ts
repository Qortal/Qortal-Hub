import { useCallback, useEffect, useRef } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import {
  notificationSettingsCacheAtom,
  globalNotificationSettingsAtom,
  muteExpiryTickAtom,
  memberGroupsAtom,
} from '../atoms/global';
import {
  getGroupNotificationStore,
  getGlobalNotificationSettings,
  migrateNotificationSettings,
  NOTIFICATION_SETTINGS_UPDATED_EVENT,
  type GroupNotificationStore,
} from '../utils/qChatNotificationSettings';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';

const POLL_INTERVAL_MS = 30_000;

export function useNotificationSettingsCache() {
  const setCache = useSetAtom(notificationSettingsCacheAtom);
  const setGlobalCache = useSetAtom(globalNotificationSettingsAtom);
  const setTick = useSetAtom(muteExpiryTickAtom);
  const memberGroups = useAtomValue(memberGroupsAtom);
  const cacheRef = useRef<Record<string, GroupNotificationStore>>({});
  const memberGroupIdsRef = useRef<Array<string | number>>([]);

  useEffect(() => {
    memberGroupIdsRef.current = (memberGroups || [])
      .map((g: any) => g?.groupId)
      .filter((id: any) => id !== undefined && id !== null);
  }, [memberGroups]);

  const refreshGlobal = useCallback(async () => {
    const global = await getGlobalNotificationSettings();
    setGlobalCache(global);
    return global;
  }, [setGlobalCache]);

  const refreshGroup = useCallback(
    async (groupId: string | number) => {
      const settings = await getGroupNotificationStore(groupId);
      cacheRef.current = {
        ...cacheRef.current,
        [String(groupId)]: settings,
      };
      setCache({ ...cacheRef.current });
    },
    [setCache]
  );

  useEffect(() => {
    const handler = (event: any) => {
      const groupId = event?.detail?.groupId;
      const settings = event?.detail?.settings;
      const globalSettings = event?.detail?.globalSettings;
      if (globalSettings && typeof globalSettings === 'object') {
        setGlobalCache(globalSettings);
        void refreshGlobal().catch(() => {});
        return;
      }
      if (groupId === undefined || groupId === null) return;
      if (settings && typeof settings === 'object') {
        cacheRef.current = {
          ...cacheRef.current,
          [String(groupId)]: settings,
        };
        setCache({ ...cacheRef.current });
      } else {
        void refreshGroup(groupId);
      }
    };
    subscribeToEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, handler);
    return () => {
      unsubscribeFromEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, handler);
    };
  }, [refreshGroup, refreshGlobal, setGlobalCache, setCache]);

  // Initial load: run migration, then populate global + per-group caches.
  //
  // The pass is NOT gated on `needsNotificationMigration`. That only asks
  // whether the global key exists, so once any pass had written it the gate
  // closed for good — including for the groups that pass could not migrate
  // because their channel list had not loaded yet. Their legacy mute then sat
  // unapplied until some later session, and mentions in those groups notified in
  // the meantime. `migrateNotificationSettings` is idempotent: it skips every
  // group that already carries its marker and returns which ones are still
  // unresolved, so calling it on each load is what retries them.
  useEffect(() => {
    const ids = memberGroupIdsRef.current;
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      try {
        await migrateNotificationSettings(ids);
      } catch (error) {
        // Migration is best-effort; continue with defaults if it fails.
        console.error('Failed to migrate notification settings:', error);
      }
      if (cancelled) return;
      const global = await getGlobalNotificationSettings();
      if (cancelled) return;
      setGlobalCache(global);

      const entries: Record<string, GroupNotificationStore> = {};
      for (const id of ids) {
        const store = await getGroupNotificationStore(id);
        if (cancelled) return;
        entries[String(id)] = store;
      }
      if (cancelled) return;
      cacheRef.current = entries;
      setCache({ ...entries });
    })();
    return () => {
      cancelled = true;
    };
  }, [memberGroups, setCache, setGlobalCache]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTick((t) => t + 1);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [setTick]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTick((t) => t + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setTick]);
}
