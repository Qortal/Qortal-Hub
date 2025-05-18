import { useCallback, useEffect } from 'react';
import {
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { useSetAtom } from 'jotai';

function fetchFromLocalStorage(key) {
  try {
    const serializedValue = localStorage.getItem(key);
    if (serializedValue === null) {
      return null;
    }
    return JSON.parse(serializedValue);
  } catch (error) {
    console.error('Error fetching from localStorage:', error);
    return null;
  }
}

export const useRetrieveDataLocalStorage = (address) => {
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const setIsUsingImportExportSettings = useSetAtom(
    isUsingImportExportSettingsAtom
  );
  const setSettingsQDNLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);

  const getSortablePinnedApps = useCallback(() => {
    const pinnedAppsLocal = fetchFromLocalStorage('ext_saved_settings');

    if (pinnedAppsLocal?.sortablePinnedApps) {
      setSortablePinnedApps(pinnedAppsLocal?.sortablePinnedApps);
      setSettingsLocalLastUpdated(pinnedAppsLocal?.timestamp || -1);
    } else {
      setSettingsLocalLastUpdated(-1);
    }
  }, []);

  const getSortablePinnedAppsImportExport = useCallback(() => {
    const pinnedAppsLocal = fetchFromLocalStorage(
      'ext_saved_settings_import_export'
    );
    if (pinnedAppsLocal?.sortablePinnedApps) {
      setOldPinnedApps(pinnedAppsLocal?.sortablePinnedApps);
      setIsUsingImportExportSettings(true);
      setSettingsQDNLastUpdated(pinnedAppsLocal?.timestamp || 0);
    } else {
      setIsUsingImportExportSettings(false);
    }
  }, []);

  useEffect(() => {
    getSortablePinnedApps();
    getSortablePinnedAppsImportExport();
  }, [getSortablePinnedApps, address]);
};
