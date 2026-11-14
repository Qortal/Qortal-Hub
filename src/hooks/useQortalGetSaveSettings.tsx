import { useCallback, useEffect, useRef } from 'react';
import {
  canSaveSettingToQdnAtom,
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { removeBrokenPinnedApps } from '../utils/pinnedAppsSettings';
import { localPinnedAppsTimestamp } from '../utils/pinnedAppsStorage';
import { getArbitraryEndpointReact, getBaseApiReact } from '../App';
import { decryptResource } from '../components/Group/Group';
import {
  base64ToUint8Array,
  uint8ArrayToObject,
} from '../encryption/encryption';
import { useAtom, useSetAtom } from 'jotai';

function fetchFromLocalStorage(key) {
  try {
    const serializedValue = localStorage.getItem(key);
    if (serializedValue === null) {
      console.log(`No data found for key: ${key}`);
      return null;
    }
    return JSON.parse(serializedValue);
  } catch (error) {
    console.error('Error fetching from localStorage:', error);
    return null;
  }
}

const getPublishRecord = async (myName) => {
  const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=ext_saved_settings&exactmatchnames=true&limit=1&prefix=true&name=${myName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('network error');
  }
  const publishData = await response.json();

  if (publishData?.length > 0)
    return {
      hasPublishRecord: true,
      timestamp: publishData[0]?.updated || publishData[0].created,
    };

  return { hasPublishRecord: false };
};

const getPublish = async (myName) => {
  try {
    const res = await fetch(
      `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${myName}/ext_saved_settings?encoding=base64`
    );
    const data = await res.text();

    if (!data) throw new Error('Unable to fetch publish');

    const decryptedKey: any = await decryptResource(data);
    const dataint8Array = base64ToUint8Array(decryptedKey.data);
    const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
    return decryptedKeyToObject;
  } catch (error) {
    return null;
  }
};

export const useQortalGetSaveSettings = (myName, isAuthenticated) => {
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setCanSave = useSetAtom(canSaveSettingToQdnAtom);
  const setSettingsQDNLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);

  const [settingsLocalLastUpdated] = useAtom(settingsLocalLastUpdatedAtom);
  const [isUsingImportExportSettings] = useAtom(
    isUsingImportExportSettingsAtom
  );
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);
  // The name whose settings are wanted now: an answer for another one (an
  // account switched meanwhile) is dropped.
  const currentNameRef = useRef(myName);
  currentNameRef.current = myName;

  const getSavedSettings = useCallback(
    async (myName, settingsLocalLastUpdated) => {
      try {
        const { hasPublishRecord, timestamp } = await getPublishRecord(myName);
        if (hasPublishRecord) {
          const settings = await getPublish(myName);
          if (currentNameRef.current !== myName) return;
          // Compare with the pins as they are now, not as they were when this
          // fetch started: a pin made meanwhile is newer than the QDN copy.
          const latestLocal = Math.max(
            settingsLocalLastUpdated,
            localPinnedAppsTimestamp()
          );
          if (settings?.sortablePinnedApps && timestamp > latestLocal) {
            setSortablePinnedApps(
              removeBrokenPinnedApps(settings.sortablePinnedApps)
            );

            setSettingsQDNLastUpdated(timestamp || 0);
          } else if (settings?.sortablePinnedApps) {
            setSettingsQDNLastUpdated(timestamp || 0);
            setOldPinnedApps(settings.sortablePinnedApps);
          }
          if (!settings) {
            // set -100 to indicate that it couldn't fetch the publish
            setSettingsQDNLastUpdated(-100);
          }
        } else {
          setSettingsQDNLastUpdated(0);
        }
        setCanSave(true);
      } catch (error) {
        console.log(error);
      }
    },
    []
  );

  useEffect(() => {
    if (
      !myName ||
      !settingsLocalLastUpdated ||
      !isAuthenticated ||
      isUsingImportExportSettings === null
    )
      return;
    if (isUsingImportExportSettings) return;
    getSavedSettings(myName, settingsLocalLastUpdated);
  }, [
    getSavedSettings,
    myName,
    settingsLocalLastUpdated,
    isAuthenticated,
    isUsingImportExportSettings,
  ]);
};
