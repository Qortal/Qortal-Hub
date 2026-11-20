import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { RESET } from 'jotai/utils';
import { oldPinnedAppsAtom, sortablePinnedAppsAtom } from '../../atoms/global';
import { PINNED_APPS_STORAGE_KEY } from '../../utils/pinnedAppsStorage';
import { useSavedAppsSync } from '../Apps/AppsLauncher/savedAppsSync';
import { saveToLocalStorage } from '../Apps/AppsNavBarDesktop';
import { revertToSavedLayouts, savedLayoutsAtom } from './savedLayouts';

/**
 * Puts the settings back to what is saved on QDN: the pins, folders,
 * bookmarks and where each stands (saved apps), Home's layout and the side
 * panel. Settings saved on another device that a save took in since are what
 * it goes back to, even if that save was called off.
 *
 * With nothing saved on QDN, the pins go back to the default ones and the
 * bookmarks stay, since there is nothing to go back to.
 */
export const useRevertSettings = (address: string | null | undefined) => {
  const oldPinnedApps = useAtomValue(oldPinnedAppsAtom);
  const setPinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const savedApps = useSavedAppsSync();
  const setSavedLayouts = useSetAtom(savedLayoutsAtom);

  return useCallback(async () => {
    let reverted: 'reverted' | 'no-copy' | 'unknown' = 'unknown';
    if (address) {
      try {
        reverted = await savedApps.revert(address);
      } catch (error) {
        console.error(error);
      }
    }
    if (reverted !== 'reverted') {
      // The pin list kept on this device is cleared, so the saved one is
      // read again at the next sign-in.
      setPinnedApps(reverted === 'no-copy' ? RESET : oldPinnedApps);
      saveToLocalStorage(PINNED_APPS_STORAGE_KEY, 'sortablePinnedApps', null);
    }
    if (address) {
      try {
        // The layouts as last read, by this save or at sign-in.
        setSavedLayouts((current) => revertToSavedLayouts(address, current));
      } catch (error) {
        console.error(error);
      }
    }
  }, [address, oldPinnedApps, savedApps, setPinnedApps, setSavedLayouts]);
};
