import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { useResetAtom } from 'jotai/utils';
import {
  canSaveSettingToQdnAtom,
  globalDownloadsAtom,
  groupAnnouncementsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  groupChatTimestampsAtom,
  lastPaymentSeenTimestampAtom,
  mailsAtom,
  memberGroupsAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  oldPinnedAppsAtom,
  qMailLastEnteredTimestampAtom,
  resourceDownloadControllerAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
  timestampEnterDataAtom,
  txListAtom,
  isUsingImportExportSettingsAtom,
} from '../atoms/global';

/**
 * Encapsulates all atom resets and global-downloads cleanup.
 * Returns a stable resetAllRecoil callback to avoid unnecessary re-renders.
 */
export function useAppReset() {
  const globalDownloadsValue = useAtomValue(globalDownloadsAtom);

  const resetAtomSortablePinnedAppsAtom = useResetAtom(sortablePinnedAppsAtom);
  const resetAtomCanSaveSettingToQdnAtom = useResetAtom(
    canSaveSettingToQdnAtom
  );
  const resetAtomSettingsQDNLastUpdatedAtom = useResetAtom(
    settingsQDNLastUpdatedAtom
  );
  const resetAtomSettingsLocalLastUpdatedAtom = useResetAtom(
    settingsLocalLastUpdatedAtom
  );
  const resetAtomOldPinnedAppsAtom = useResetAtom(oldPinnedAppsAtom);
  const resetAtomIsUsingImportExportSettingsAtom = useResetAtom(
    isUsingImportExportSettingsAtom
  );
  const resetAtomQMailLastEnteredTimestampAtom = useResetAtom(
    qMailLastEnteredTimestampAtom
  );
  const resetAtomMailsAtom = useResetAtom(mailsAtom);
  const resetGroupPropertiesAtom = useResetAtom(groupsPropertiesAtom);
  const resetLastPaymentSeenTimestampAtom = useResetAtom(
    lastPaymentSeenTimestampAtom
  );
  const resetGroupsOwnerNamesAtom = useResetAtom(groupsOwnerNamesAtom);
  const resetGroupAnnouncementsAtom = useResetAtom(groupAnnouncementsAtom);
  const resetMutedGroupsAtom = useResetAtom(mutedGroupsAtom);
  const resetGroupChatTimestampsAtom = useResetAtom(groupChatTimestampsAtom);
  const resetTimestampEnterAtom = useResetAtom(timestampEnterDataAtom);
  const resettxListAtomAtom = useResetAtom(txListAtom);
  const resetmemberGroupsAtomAtom = useResetAtom(memberGroupsAtom);
  const resetMyGroupsWhereIAmAdminAtom = useResetAtom(
    myGroupsWhereIAmAdminAtom
  );
  const resetResourceDownloadControllerAtom = useResetAtom(
    resourceDownloadControllerAtom
  );
  const resetGlobalDownloadsAtom = useResetAtom(globalDownloadsAtom);

  const resetAllRecoil = useCallback(() => {
    if (globalDownloadsValue && typeof globalDownloadsValue === 'object') {
      Object.values(globalDownloadsValue).forEach((entry: any) => {
        if (entry?.interval) clearInterval(entry.interval);
        if (entry?.timeout) clearTimeout(entry.timeout);
        if (entry?.retryTimeout) clearTimeout(entry.retryTimeout);
      });
    }
    resetAtomSortablePinnedAppsAtom();
    resetAtomCanSaveSettingToQdnAtom();
    resetAtomSettingsQDNLastUpdatedAtom();
    resetAtomSettingsLocalLastUpdatedAtom();
    resetAtomOldPinnedAppsAtom();
    resetAtomIsUsingImportExportSettingsAtom();
    resetAtomQMailLastEnteredTimestampAtom();
    resetAtomMailsAtom();
    resetGroupPropertiesAtom();
    resetLastPaymentSeenTimestampAtom();
    resetGroupsOwnerNamesAtom();
    resetGroupAnnouncementsAtom();
    resetMutedGroupsAtom();
    resetGroupChatTimestampsAtom();
    resetTimestampEnterAtom();
    resettxListAtomAtom();
    resetmemberGroupsAtomAtom();
    resetMyGroupsWhereIAmAdminAtom();
    resetResourceDownloadControllerAtom();
    resetGlobalDownloadsAtom();
  }, [
    globalDownloadsValue,
    resetAtomSortablePinnedAppsAtom,
    resetAtomCanSaveSettingToQdnAtom,
    resetAtomSettingsQDNLastUpdatedAtom,
    resetAtomSettingsLocalLastUpdatedAtom,
    resetAtomOldPinnedAppsAtom,
    resetAtomIsUsingImportExportSettingsAtom,
    resetAtomQMailLastEnteredTimestampAtom,
    resetAtomMailsAtom,
    resetGroupPropertiesAtom,
    resetLastPaymentSeenTimestampAtom,
    resetGroupsOwnerNamesAtom,
    resetGroupAnnouncementsAtom,
    resetMutedGroupsAtom,
    resetGroupChatTimestampsAtom,
    resetTimestampEnterAtom,
    resettxListAtomAtom,
    resetmemberGroupsAtomAtom,
    resetMyGroupsWhereIAmAdminAtom,
    resetResourceDownloadControllerAtom,
    resetGlobalDownloadsAtom,
  ]);

  return { resetAllRecoil };
}
