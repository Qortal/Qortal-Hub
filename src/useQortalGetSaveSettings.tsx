import React, { useCallback, useEffect } from 'react'
import { useRecoilState, useSetRecoilState } from 'recoil';
import { canSaveSettingToQdnAtom, oldPinnedAppsAtom, settingsLocalLastUpdatedAtom, settingsQDNLastUpdatedAtom, sortablePinnedAppsAtom } from './atoms/global';
import { getArbitraryEndpointReact, getBaseApiReact } from './App';
import { decryptResource } from './components/Group/Group';
import { base64ToUint8Array, uint8ArrayToObject } from './backgroundFunctions/encryption';

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
    // const validApi = await findUsableApi();
    const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=ext_saved_settings&exactmatchnames=true&limit=1&prefix=true&name=${myName}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("network error");
    }
    const publishData = await response.json();

    if(publishData?.length > 0) return {hasPublishRecord: true,  timestamp: publishData[0]?.updated || publishData[0].created}

    return {hasPublishRecord: false}
  };
  const getPublish = async (myName) => {
    try {
        let data
    const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${myName}/ext_saved_settings?encoding=base64`
      );
      data = await res.text();
    
    if(!data) throw new Error('Unable to fetch publish')

    const decryptedKey: any = await decryptResource(data);

    const dataint8Array = base64ToUint8Array(decryptedKey.data);
    const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
    return decryptedKeyToObject
    } catch (error) {
        return null
    }
  };


export const useQortalGetSaveSettings = (myName, isAuthenticated) => {
    const setSortablePinnedApps = useSetRecoilState(sortablePinnedAppsAtom);
    const setCanSave = useSetRecoilState(canSaveSettingToQdnAtom);
    const setSettingsQDNLastUpdated = useSetRecoilState(settingsQDNLastUpdatedAtom);
    const [settingsLocalLastUpdated] = useRecoilState(settingsLocalLastUpdatedAtom);
    const [oldPinnedApps, setOldPinnedApps] =  useRecoilState(oldPinnedAppsAtom)

    const getSavedSettings = useCallback(async (myName, settingsLocalLastUpdated)=> {
        try {
         const {hasPublishRecord, timestamp} =    await getPublishRecord(myName)
         if(hasPublishRecord){
            const settings = await getPublish(myName)
            if(settings?.sortablePinnedApps && timestamp > settingsLocalLastUpdated){
                setSortablePinnedApps(settings.sortablePinnedApps)
                
                setSettingsQDNLastUpdated(timestamp || 0)
            } else if(settings?.sortablePinnedApps){
                setSettingsQDNLastUpdated(timestamp || 0)
                setOldPinnedApps(settings.sortablePinnedApps)
            }
            if(!settings){
                // set -100 to indicate that it couldn't fetch the publish
                setSettingsQDNLastUpdated(-100)

            }
         } else {
            setSettingsQDNLastUpdated( 0)
         }
         setCanSave(true)
        } catch (error) {
            
        }
    }, [])
    useEffect(()=> {
        if(!myName || !settingsLocalLastUpdated || !isAuthenticated) return
        getSavedSettings(myName, settingsLocalLastUpdated)
    }, [getSavedSettings, myName, settingsLocalLastUpdated, isAuthenticated])
 
}
