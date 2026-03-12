import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useResetAtom } from 'jotai/utils';
import { clearMemberGroupsPolling } from '../subscriptions/useInitializeMySubscriptions';
import {
  addressInfoControllerAtom,
  blobControllerAtom,
  canSaveSettingToQdnAtom,
  enabledDevModeAtom,
  fullScreenAtom,
  globalDownloadsAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupInvitesCacheAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  hasSettingsChangedAtom,
  isDisabledEditorEnterAtom,
  isOpenBlockedModalAtom,
  isRunningPublicNodeAtom,
  joinRequestsCacheAtom,
  lastPaymentSeenTimestampAtom,
  mailsAtom,
  managedSubscriptionsAtom,
  managedSubscriptionsLoadingAtom,
  memberGroupsAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  myMemberGroupsAtom,
  myMemberGroupsLastFetchedAtom,
  mySubscriptionsAtom,
  navigationControllerAtom,
  oldPinnedAppsAtom,
  promotionTimeIntervalAtom,
  promotionsAtom,
  qMailLastEnteredTimestampAtom,
  resourceDownloadControllerAtom,
  selectedGroupIdAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
  subscriptionsLoadingAtom,
  timestampEnterDataAtom,
  txListAtom,
  isUsingImportExportSettingsAtom,
} from '../atoms/global';
import {
  appCategoryFilterAtom,
  appSearchQueryAtom,
  appSortAtom,
  appStatusFilterAtom,
  currentAppsTabAtom,
  publishEditTargetAtom,
} from '../atoms/appsAtoms';

/**
 * Encapsulates all atom resets and global-downloads cleanup.
 * Returns a stable resetAllRecoil callback to avoid unnecessary re-renders.
 */
export function useAppReset() {
  const globalDownloadsValue = useAtomValue(globalDownloadsAtom);

  const setGroupInvitesCache = useSetAtom(groupInvitesCacheAtom);
  const setJoinRequestsCache = useSetAtom(joinRequestsCacheAtom);

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
  const resetMyMemberGroupsAtom = useResetAtom(myMemberGroupsAtom);
  const resetMyMemberGroupsLastFetchedAtom = useResetAtom(
    myMemberGroupsLastFetchedAtom
  );
  const resetMySubscriptionsAtom = useResetAtom(mySubscriptionsAtom);
  const resetManagedSubscriptionsAtom = useResetAtom(managedSubscriptionsAtom);
  const resetSubscriptionsLoadingAtom = useResetAtom(subscriptionsLoadingAtom);
  const resetManagedSubscriptionsLoadingAtom = useResetAtom(
    managedSubscriptionsLoadingAtom
  );
  const resetResourceDownloadControllerAtom = useResetAtom(
    resourceDownloadControllerAtom
  );
  const resetGlobalDownloadsAtom = useResetAtom(globalDownloadsAtom);

  const resetAddressInfoControllerAtom = useResetAtom(addressInfoControllerAtom);
  const resetBlobControllerAtom = useResetAtom(blobControllerAtom);
  const resetNavigationControllerAtom = useResetAtom(navigationControllerAtom);
  const resetEnabledDevModeAtom = useResetAtom(enabledDevModeAtom);
  const resetFullScreenAtom = useResetAtom(fullScreenAtom);
  const resetHasSettingsChangedAtom = useResetAtom(hasSettingsChangedAtom);
  const resetIsDisabledEditorEnterAtom = useResetAtom(isDisabledEditorEnterAtom);
  const resetIsOpenBlockedModalAtom = useResetAtom(isOpenBlockedModalAtom);
  const resetIsRunningPublicNodeAtom = useResetAtom(isRunningPublicNodeAtom);
  const resetSelectedGroupIdAtom = useResetAtom(selectedGroupIdAtom);
  const resetPromotionsAtom = useResetAtom(promotionsAtom);
  const resetPromotionTimeIntervalAtom = useResetAtom(
    promotionTimeIntervalAtom
  );

  const resetAppSortAtom = useResetAtom(appSortAtom);
  const resetAppCategoryFilterAtom = useResetAtom(appCategoryFilterAtom);
  const resetAppStatusFilterAtom = useResetAtom(appStatusFilterAtom);
  const resetAppSearchQueryAtom = useResetAtom(appSearchQueryAtom);
  const resetCurrentAppsTabAtom = useResetAtom(currentAppsTabAtom);
  const resetPublishEditTargetAtom = useResetAtom(publishEditTargetAtom);

  const resetAllRecoil = useCallback(() => {
    if (globalDownloadsValue && typeof globalDownloadsValue === 'object') {
      Object.values(globalDownloadsValue).forEach((entry: any) => {
        if (entry?.interval) clearInterval(entry.interval);
        if (entry?.timeout) clearTimeout(entry.timeout);
        if (entry?.retryTimeout) clearTimeout(entry.retryTimeout);
      });
    }
    setGroupInvitesCache(null);
    setJoinRequestsCache(null);
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
    resetMyMemberGroupsAtom();
    resetMyMemberGroupsLastFetchedAtom();
    resetMySubscriptionsAtom();
    resetManagedSubscriptionsAtom();
    resetSubscriptionsLoadingAtom();
    resetManagedSubscriptionsLoadingAtom();
    clearMemberGroupsPolling();
    resetResourceDownloadControllerAtom();
    resetGlobalDownloadsAtom();
    resetAddressInfoControllerAtom();
    resetBlobControllerAtom();
    resetNavigationControllerAtom();
    resetEnabledDevModeAtom();
    resetFullScreenAtom();
    resetHasSettingsChangedAtom();
    resetIsDisabledEditorEnterAtom();
    resetIsOpenBlockedModalAtom();
    resetIsRunningPublicNodeAtom();
    resetSelectedGroupIdAtom();
    resetPromotionsAtom();
    resetPromotionTimeIntervalAtom();
    resetAppSortAtom();
    resetAppCategoryFilterAtom();
    resetAppStatusFilterAtom();
    resetAppSearchQueryAtom();
    resetCurrentAppsTabAtom();
    resetPublishEditTargetAtom();
  }, [
    globalDownloadsValue,
    setGroupInvitesCache,
    setJoinRequestsCache,
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
    resetMyMemberGroupsAtom,
    resetMyMemberGroupsLastFetchedAtom,
    resetMySubscriptionsAtom,
    resetManagedSubscriptionsAtom,
    resetSubscriptionsLoadingAtom,
    resetManagedSubscriptionsLoadingAtom,
    resetResourceDownloadControllerAtom,
    resetGlobalDownloadsAtom,
    resetAddressInfoControllerAtom,
    resetBlobControllerAtom,
    resetNavigationControllerAtom,
    resetEnabledDevModeAtom,
    resetFullScreenAtom,
    resetHasSettingsChangedAtom,
    resetIsDisabledEditorEnterAtom,
    resetIsOpenBlockedModalAtom,
    resetIsRunningPublicNodeAtom,
    resetSelectedGroupIdAtom,
    resetPromotionsAtom,
    resetPromotionTimeIntervalAtom,
    resetAppSortAtom,
    resetAppCategoryFilterAtom,
    resetAppStatusFilterAtom,
    resetAppSearchQueryAtom,
    resetCurrentAppsTabAtom,
    resetPublishEditTargetAtom,
  ]);

  return { resetAllRecoil };
}
