import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';

const INTERNAL_TAB_SERVICE = 'INTERNAL';

/**
 * What pinning a tab's Q-App or website adds to the pinned apps and
 * bookmarks: its name and service, or a private app's full properties. Null
 * for a tab with nothing to pin (Hub's own tabs, a launcher tab, a private
 * app whose name, service or identifier isn't known).
 */
export function pinnedAppOfTab(tab: any) {
  if (tab?.isPrivate || tab?.privateAppProperties) {
    const privateAppProperties = tab?.privateAppProperties || {};
    const name = privateAppProperties.name || tab?.name;
    const service = privateAppProperties.service || tab?.service;
    const identifier = privateAppProperties.identifier || tab?.identifier;
    if (!name || !service || !identifier) return null;
    return {
      isPrivate: true,
      isPreview: tab.isPreview ?? true,
      privateAppProperties: {
        ...privateAppProperties,
        name,
        service,
        identifier,
      },
    };
  }
  if (!tab?.service || !tab?.name) return null;
  if (tab.internal || tab.service === INTERNAL_TAB_SERVICE) return null;
  return { name: tab.name, service: String(tab.service).toUpperCase() };
}

/** Whether a pinned app is the one `pinnedAppOfTab` made. */
export function isSamePinnedApp(item: any, candidate: any) {
  if (!item || !candidate) return false;

  if (candidate?.isPrivate) {
    const itemProperties = item?.privateAppProperties;
    const candidateProperties = candidate?.privateAppProperties;

    return (
      !!item?.isPrivate &&
      itemProperties?.name === candidateProperties?.name &&
      itemProperties?.service === candidateProperties?.service &&
      itemProperties?.identifier === candidateProperties?.identifier
    );
  }

  return (
    item?.name?.toLowerCase() === candidate.name.toLowerCase() &&
    item?.service?.toUpperCase() === candidate.service
  );
}

/** Whether `candidate` is among the pinned apps and bookmarks. */
export function isPinnedApp(pinnedApps: any[] | null | undefined, candidate) {
  return (
    !!candidate &&
    !!pinnedApps?.some((item) => isSamePinnedApp(item, candidate))
  );
}

/**
 * Pins `candidate` to the pinned apps and bookmarks, or unpins it if it's
 * there, and keeps the change for the next save to QDN.
 */
export function useTogglePinnedApp() {
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  return useCallback(
    (candidate) => {
      if (!candidate) return;
      setSortablePinnedApps((prev) => {
        const updatedApps = isPinnedApp(prev, candidate)
          ? prev.filter((item) => !isSamePinnedApp(item, candidate))
          : [...prev, candidate];
        saveToLocalStorage(
          'ext_saved_settings',
          'sortablePinnedApps',
          updatedApps
        );
        return updatedApps;
      });
      setSettingsLocalLastUpdated(Date.now());
    },
    [setSettingsLocalLastUpdated, setSortablePinnedApps]
  );
}

/** The pinned apps and bookmarks, for checking whether an app is in them. */
export const usePinnedAppsList = () => useAtomValue(sortablePinnedAppsAtom);
