import { atom, type PrimitiveAtom } from 'jotai';
import {
  atomWithReset,
  atomFamily,
  atomWithStorage,
  useAtomCallback,
} from 'jotai/utils';
import { HTTP_LOCALHOST_12391 } from '../constants/constants';
import { ApiKey } from '../types/auth';
import { extStates } from '../App';
import { Steps } from '../components/CoreSetupDialog';
import { LOCALHOST } from '../constants/constants';
import { GlobalDownloadEntry } from '../types/resources';
import { defaultPinnedApps } from '../components/Apps/config/officialApps';

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

/** TTL in ms for join requests and group invites cache (3 minutes). */
export const GROUP_ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000;

/** Cache for group invites (user's list). Invalidated after TTL or explicit refresh. */
export type GroupInvitesCache = {
  data: any[];
  fetchedAt: number;
  address: string;
} | null;
export const groupInvitesCacheAtom = atom<GroupInvitesCache>(null) as PrimitiveAtom<GroupInvitesCache>;

/** Cache for join requests (admin list). Invalidated after TTL or explicit refresh. */
export type JoinRequestsCache = {
  data: Array<{ group: any; data: any[] }>;
  fetchedAt: number;
  adminGroupIds: number[];
} | null;
export const joinRequestsCacheAtom = atom<JoinRequestsCache>(null) as PrimitiveAtom<JoinRequestsCache>;
export const qMailLastEnteredTimestampAtom = atomWithReset(null);
export const resourceDownloadControllerAtom = atomWithReset({});
export const globalDownloadsAtom = atomWithReset<
  Record<string, GlobalDownloadEntry>
>({});
export const selectedGroupIdAtom = atomWithReset(null);
export const settingsLocalLastUpdatedAtom = atomWithReset(0);
export const settingsQDNLastUpdatedAtom = atomWithReset(-100);
export const timestampEnterDataAtom = atomWithReset({});

/** Persisted: true = chat widget is closed (hidden). Reopen via right sidebar. */
export const chatWidgetClosedAtom = atomWithStorage<boolean>(
  'qortal_chat_widget_closed',
  false
);

/** Persisted: global chat widget position and size. Saved only on drag/resize end. */
export const globalChatWidgetBoundsAtom = atomWithStorage<{
  x: number;
  width: number;
  height: number;
} | null>(
  'qortal_chat_widget_bounds',
  null,
  undefined,
  { getOnInit: true }
);

export const txListAtom = atomWithReset([]);

/** Groups the current user is a member of – refreshed every 5 minutes. */
export const myMemberGroupsAtom = atomWithReset<any[]>([]);
/** Unix-ms timestamp of the last successful fetch for myMemberGroupsAtom. */
export const myMemberGroupsLastFetchedAtom = atomWithReset<number>(0);
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

/** Time window (ms) for unread chat notifications – keep in sync with groupConstants */
const TIME_DIFF_UNREAD_CHATS_MS = 900000;

/** Derived: any group chat has unread. Subscribe here instead of memberGroupsAtom to avoid re-renders on list change. */
export const groupChatHasUnreadAtom = atom((get) => {
  const groups = get(memberGroupsAtom);
  const myAddress = get(userInfoAtom)?.address;
  const groupChatTimestamps = get(groupChatTimestampsAtom);
  const timestampEnterData = get(timestampEnterDataAtom) || {};
  if (!groups?.length || !myAddress) return false;
  return groups.some(
    (group: any) =>
      group?.groupId !== '0' &&
      group?.data &&
      group?.sender !== myAddress &&
      group?.timestamp &&
      groupChatTimestamps[group?.groupId] &&
      ((!timestampEnterData[group?.groupId] &&
        Date.now() - group?.timestamp < TIME_DIFF_UNREAD_CHATS_MS) ||
        timestampEnterData[group?.groupId] < group?.timestamp)
  );
});

/** Derived: any group announcement has unread. */
export const groupsAnnHasUnreadAtom = atom((get) => {
  const groups = get(memberGroupsAtom);
  const groupAnnouncements = get(groupAnnouncementsAtom);
  if (!groups?.length) return false;
  return groups.some(
    (group: any) =>
      groupAnnouncements[group?.groupId] &&
      !groupAnnouncements[group?.groupId]?.seentimestamp
  );
});

/** Combined: groups tab has any unread (chat or announcements). */
export const hasUnreadGroupsAtom = atom((get) => {
  return get(groupChatHasUnreadAtom) || get(groupsAnnHasUnreadAtom);
});

/** Derived: is the selected group's chat unread? Key: selectedGroupId (string) or empty. */
export const isUnreadChatAtomFamily = atomFamily((selectedGroupId: string) =>
  atom((get) => {
    if (!selectedGroupId) return false;
    const groups = get(memberGroupsAtom);
    const myAddress = get(userInfoAtom)?.address;
    const groupChatTimestamps = get(groupChatTimestampsAtom);
    const timestampEnterData = get(timestampEnterDataAtom) || {};
    const findGroup = groups
      ?.filter((g: any) => g?.sender !== myAddress)
      ?.find((g: any) => g?.groupId === selectedGroupId);
    if (!findGroup?.data || !findGroup?.timestamp) return false;
    return !!(
      groupChatTimestamps[findGroup?.groupId] &&
      ((!timestampEnterData[selectedGroupId] &&
        Date.now() - findGroup.timestamp < TIME_DIFF_UNREAD_CHATS_MS) ||
        timestampEnterData[selectedGroupId] < findGroup.timestamp)
    );
  })
);

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
