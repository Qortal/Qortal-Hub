import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { oldPinnedAppsAtom, sortablePinnedAppsAtom } from '../../atoms/global';
import { PINNED_APPS_STORAGE_KEY } from '../../utils/pinnedAppsStorage';
import { useRevertSavedLauncher } from '../Apps/AppsLauncher/launcherQdnSync';
import { saveToLocalStorage } from '../Apps/AppsNavBarDesktop';

/**
 * Puts the settings back to what is saved on QDN: the pin list as it was read
 * at sign-in, and with it the launcher's bookmarks, folders and arrangement.
 *
 * The pin list kept on this device is cleared, so the saved one is read again
 * at the next sign-in. Settings that hold no launcher leave the bookmarks of
 * this device alone, since there is nothing to go back to.
 */
export const useRevertSettings = (address: string | null | undefined) => {
  const oldPinnedApps = useAtomValue(oldPinnedAppsAtom);
  const setPinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const revertLauncher = useRevertSavedLauncher();

  return useCallback(async () => {
    setPinnedApps(oldPinnedApps);
    saveToLocalStorage(PINNED_APPS_STORAGE_KEY, 'sortablePinnedApps', null);
    try {
      await revertLauncher(address);
    } catch (error) {
      console.error(error);
    }
  }, [address, oldPinnedApps, revertLauncher, setPinnedApps]);
};
