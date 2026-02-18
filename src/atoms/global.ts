import { atom } from 'jotai';
import { atomWithReset, atomFamily, useAtomCallback } from 'jotai/utils';
import { HTTP_LOCALHOST_12391 } from '../constants/constants';
import { ApiKey } from '../types/auth';
import { extStates } from '../App';
import { Steps } from '../components/CoreSetupDialog';
import { LOCALHOST } from '../constants/constants';
import { defaultPinnedApps } from '../components/Apps/config/officialApps';
import { GlobalDownloadEntry } from '../types/resources';

export const sortablePinnedAppsAtom = atomWithReset(defaultPinnedApps);

/** Derived atom family: each card subscribes only to "is this app pinned?". Key: `${service}\\0${name}` */
export const isAppPinnedAtomFamily = atomFamily((key: string) =>
  atom((get) => {
    const list = get(sortablePinnedAppsAtom);
    if (!key || !list?.length) return false;
    const sep = key.indexOf('\0');
    const service = sep >= 0 ? key.slice(0, sep) : key;
    const name = sep >= 0 ? key.slice(sep + 1) : '';
    return !!list.find(
      (item) => item?.service === service && item?.name === name
    );
  })
);

export const addressInfoControllerAtom = atomWithReset({});
export const blobControllerAtom = atomWithReset({});
export const canSaveSettingToQdnAtom = atomWithReset(false);
export const enabledDevModeAtom = atomWithReset(false);
export const fullScreenAtom = atomWithReset(false);
export const groupAnnouncementsAtom = atomWithReset({});
export const groupChatTimestampsAtom = atomWithReset({});
export const groupsOwnerNamesAtom = atomWithReset({});
export const groupsPropertiesAtom = atomWithReset({});
export const hasSettingsChangedAtom = atomWithReset(false);
export const isDisabledEditorEnterAtom = atomWithReset(false);
export const isOpenBlockedModalAtom = atomWithReset(false);
export const isRunningPublicNodeAtom = atomWithReset(false);
export const isUsingImportExportSettingsAtom = atomWithReset(null);
export const lastPaymentSeenTimestampAtom = atomWithReset(null);
export const mailsAtom = atomWithReset([]);
export const memberGroupsAtom = atomWithReset([]);
export const mutedGroupsAtom = atomWithReset([]);
export const myGroupsWhereIAmAdminAtom = atomWithReset([]);
export const navigationControllerAtom = atomWithReset({});
export const oldPinnedAppsAtom = atomWithReset([]);
export const promotionsAtom = atomWithReset([]);
export const promotionTimeIntervalAtom = atomWithReset(0);
export const qMailLastEnteredTimestampAtom = atomWithReset(null);
export const resourceDownloadControllerAtom = atomWithReset({});
export const globalDownloadsAtom = atomWithReset<
  Record<string, GlobalDownloadEntry>
>({});
export const selectedGroupIdAtom = atomWithReset(null);
export const settingsLocalLastUpdatedAtom = atomWithReset(0);
export const settingsQDNLastUpdatedAtom = atomWithReset(-100);
export const timestampEnterDataAtom = atomWithReset({});
export const txListAtom = atomWithReset([]);
export const isOpenDialogCoreRecommendationAtom = atomWithReset(false);
export const isLoadingAuthenticateAtom = atomWithReset(false);
export const authenticatePasswordAtom = atomWithReset('');
export const extStateAtom = atomWithReset<extStates>('not-authenticated');
export const userInfoAtom = atomWithReset<any>(null);
export const rawWalletAtom = atomWithReset<any>(null);
export const walletToBeDecryptedErrorAtom = atomWithReset<string>('');
export const balanceAtom = atomWithReset<any>(null);
export const qortBalanceLoadingAtom = atomWithReset<boolean>(false);
export const isOpenDialogResetApikey = atomWithReset<boolean>(false);
export const isOpenDialogCustomApikey = atomWithReset<boolean>(false);
export const isOpenCoreSetup = atomWithReset<boolean>(false);
export const isOpenSyncingDialogAtom = atomWithReset<boolean>(false);
export const isOpenSettingUpLocalCoreAtom = atomWithReset<any>({
  isShow: false,
});
export const enableAuthWhenSyncingAtom = atomWithReset<boolean>(false);
export const isOpenUrlInvalidAtom = atomWithReset<boolean>(false);
export const devServerDomainAtom = atomWithReset(LOCALHOST);
export const devServerPortAtom = atomWithReset('');
export const nodeInfosAtom = atomWithReset({});
export const selectedNodeInfoAtom = atomWithReset<ApiKey | null>({
  url: HTTP_LOCALHOST_12391,
  apikey: '',
});
export const statusesAtom = atomWithReset<Steps>({
  coreRunning: {
    status: 'idle',
    progress: 0,
    message: '',
  },
  downloadedCore: {
    status: 'idle',
    progress: 0,
    message: '',
  },
  hasJava: {
    status: 'idle',
    progress: 0,
    message: '',
  },
});

export const isNewTabWindowAtom = atomWithReset<boolean>(false);

// Global snack (reduces context re-renders when snack opens/closes)
export const openSnackGlobalAtom = atomWithReset<boolean>(false);
export const infoSnackGlobalAtom = atomWithReset<{
  message?: string;
  type?: string;
  duration?: number | null;
} | null>(null);

// Tutorial state (reduces context re-renders for tutorial UI)
export const openTutorialModalAtom = atomWithReset<any>(null);
export const shownTutorialsAtom = atomWithReset<Record<string, boolean> | null>(
  null
);
export const hasSeenGettingStartedAtom = atom((get) => {
  const shown = get(shownTutorialsAtom);
  return shown === null ? null : !!(shown || {})['getting-started'];
});

// Block list (reduces context re-renders; useBlockedAddresses reads/writes these)
export const blockedAddressesAtom = atomWithReset<Record<string, boolean>>({});
export const blockedNamesAtom = atomWithReset<Record<string, boolean>>({});

// Atom Families (replacing selectorFamily)
export const resourceKeySelector = atomFamily((key) =>
  atom((get) => get(resourceDownloadControllerAtom)[key] || null)
);

export const blobKeySelector = atomFamily((key) =>
  atom((get) => get(blobControllerAtom)[key] || null)
);

export const addressInfoKeySelector = atomFamily((key) =>
  atom((get) => get(addressInfoControllerAtom)[key] || null)
);

export const groupsOwnerNamesSelector = atomFamily((key) =>
  atom((get) => get(groupsOwnerNamesAtom)[key] || null)
);

export const groupAnnouncementSelector = atomFamily((key) =>
  atom((get) => get(groupAnnouncementsAtom)[key] || null)
);

export const groupPropertySelector = atomFamily((key) =>
  atom((get) => get(groupsPropertiesAtom)[key] || null)
);

export const groupChatTimestampSelector = atomFamily((key) =>
  atom((get) => get(groupChatTimestampsAtom)[key] || null)
);

export const timestampEnterDataSelector = atomFamily((key) =>
  atom((get) => get(timestampEnterDataAtom)[key] || null)
);

export function useGetResourceStatus() {
  return useAtomCallback(async (get, _set, id: string) => {
    const resources = get(resourceDownloadControllerAtom);
    return resources?.[id];
  });
}
