import React, { useCallback, useEffect } from 'react'
import { useSetRecoilState } from 'recoil';
import { settingsLocalLastUpdatedAtom, sortablePinnedAppsAtom } from './atoms/global';

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

export const useRetrieveDataLocalStorage = () => {
    const setSortablePinnedApps = useSetRecoilState(sortablePinnedAppsAtom);
    const setSettingsLocalLastUpdated = useSetRecoilState(settingsLocalLastUpdatedAtom);
    
    const getSortablePinnedApps = useCallback(()=> {
        const pinnedAppsLocal = fetchFromLocalStorage('ext_saved_settings')
        if(pinnedAppsLocal?.sortablePinnedApps){
            setSortablePinnedApps(pinnedAppsLocal?.sortablePinnedApps)
            setSettingsLocalLastUpdated(pinnedAppsLocal?.timestamp || -1)
        } else {
            setSettingsLocalLastUpdated(-1)
        }
      
    }, [])
    useEffect(()=> {
      
        getSortablePinnedApps()
    }, [getSortablePinnedApps])
 
}
