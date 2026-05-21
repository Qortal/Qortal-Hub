import { atom, type PrimitiveAtom } from 'jotai';
import {
  atomWithReset,
  atomFamily,
  atomWithStorage,
  useAtomCallback,
} from 'jotai/utils';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../constants/constants';
import { ApiKey } from '../types/auth';
import { extStates } from '../App';
import { Steps } from '../components/CoreSetupDialog';
import { LOCALHOST } from '../constants/constants';
import { GlobalDownloadEntry } from '../types/resources';
import { defaultPinnedApps } from '../components/Apps/config/officialApps';
import { getElectronPersistentStorage } from '../utils/electronPersistentStorage';
import type { QuitterDashboardFeedCache } from '../components/Widgets/quitter/quitterFeedTypes';

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
export const groupInvitesCacheAtom = atom<GroupInvitesCache>(
  null
) as PrimitiveAtom<GroupInvitesCache>;

/** Cache for join requests (admin list). Invalidated after TTL or explicit refresh. */
export type JoinRequestsCache = {
  data: Array<{ group: any; data: any[] }>;
  fetchedAt: number;
  adminGroupIds: number[];
} | null;
export const joinRequestsCacheAtom = atom<JoinRequestsCache>(
  null
) as PrimitiveAtom<JoinRequestsCache>;

/** Quitter home-dashboard widget feed. Reset on logout. Prefer useAtom only in QuitterFeedWidget. */
export const quitterDashboardFeedCacheAtom =
  atomWithReset<QuitterDashboardFeedCache | null>(null);

export const qMailLastEnteredTimestampAtom = atomWithReset(null);
export const resourceDownloadControllerAtom = atomWithReset({});
export const globalDownloadsAtom = atomWithReset<
  Record<string, GlobalDownloadEntry>
>({});
export const selectedGroupIdAtom = atomWithReset(null);
export const settingsLocalLastUpdatedAtom = atomWithReset(0);
export const settingsQDNLastUpdatedAtom = atomWithReset(-100);
export const timestampEnterDataAtom = atomWithReset({});

// When in Electron, use appStorage-backed persistence; otherwise Jotai uses localStorage (undefined = default).
const electronStorage = getElectronPersistentStorage();

/** Persisted: true = Q-Wallets embedded workspace opens edge-to-edge. */
export const qWalletsWorkspaceFullScreenAtom = atomWithStorage<boolean>(
  'qortal_q_wallets_workspace_full_screen',
  false
);

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
} | null>('qortal_chat_widget_bounds', null, undefined, { getOnInit: true });

/** Persisted: default microphone / speaker for 1v1 and group voice calls (`null` = OS default). */
export const CALL_AUDIO_DEVICES_STORAGE_KEY = 'qortal_call_audio_devices';
export type CallAudioDevicePrefs = {
  inputDeviceId: string | null;
  inputDeviceLabel?: string | null;
  inputDeviceGroupId?: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel?: string | null;
  outputDeviceGroupId?: string | null;
};
export const callAudioDevicesAtom = atomWithStorage<CallAudioDevicePrefs>(
  CALL_AUDIO_DEVICES_STORAGE_KEY,
  { inputDeviceId: null, outputDeviceId: null },
  electronStorage as any
);

/** Persisted: DM friends (see dmFriendsByAccountAtom / dmFriendsByAddressAtom). */
export const DM_FRIENDS_STORAGE_KEY = 'qortal_dm_friends';
export type DmFriendStored = {
  publicKey: string;
  name?: string;
  addedAt: number;
};

/** Persisted: custom websocket notification subscriptions. Sent as a second subscribe action when the notifications socket connects. */
export type CustomWebsocketSubscription = {
  event: string;
  resourceFilter?: {
    service: string;
    identifier: string;
    name?: string;
    excludeBlocked?: boolean;
    mode?: string;
  };
  filters?: Record<string, string>;
  image?: string;
  link?: string;
  notificationId?: string;
  appName?: string;
  appService?: string;
  message?: Record<string, string>;
  [key: string]: unknown;
};

/** Persisted: custom WS subscriptions per user address (key: qortal_custom_ws_subscriptions). */
export const CUSTOM_WS_SUBSCRIPTIONS_STORAGE_KEY =
  'qortal_custom_ws_subscriptions';
export const customWebsocketSubscriptionsByAddressAtom = atomWithStorage<
  Record<string, CustomWebsocketSubscription[]>
>(CUSTOM_WS_SUBSCRIPTIONS_STORAGE_KEY, {}, electronStorage as any);

/** Persisted: keys of notifications already "seen in app" (excluded from unread count), by address then notification key. Keys older than this are pruned. */
export const NOTIFICATION_SEEN_IN_APP_STORAGE_KEY =
  'qortal_notification_seen_in_app';
const NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** Per-address record of notificationKey -> mark time (ms). Pruned to last 3 days when read/set. */
export type SeenInAppKeyRecord = Record<string, number>;
/** Stored shape: address -> notificationKey -> timestamp. */
export type SeenInAppRecordByAddress = Record<string, SeenInAppKeyRecord>;

export function parseSeenInAppStored(
  raw: string | null | unknown
): SeenInAppRecordByAddress {
  if (raw == null || raw === '') return {};
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (Array.isArray(parsed)) return {};
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  const result: SeenInAppRecordByAddress = {};
  for (const [addr, inner] of Object.entries(obj)) {
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const keyRecord: SeenInAppKeyRecord = {};
      for (const [k, t] of Object.entries(inner)) {
        if (typeof t === 'number') keyRecord[k] = t;
      }
      result[addr] = keyRecord;
    }
  }
  return result;
}

function filterSeenInAppKeyRecordByAge(
  record: SeenInAppKeyRecord
): SeenInAppKeyRecord {
  const cutoff = Date.now() - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, t]) => typeof t === 'number' && t > cutoff
    )
  );
}

export function filterSeenInAppRecordByAge(
  record: SeenInAppRecordByAddress
): SeenInAppRecordByAddress {
  const out: SeenInAppRecordByAddress = {};
  for (const [addr, inner] of Object.entries(record)) {
    const pruned = filterSeenInAppKeyRecordByAge(inner);
    if (Object.keys(pruned).length > 0) out[addr] = pruned;
  }
  return out;
}

/** Keys for one address from the last 3 days. */
function seenInAppRecordToKeysForAddress(
  record: SeenInAppRecordByAddress,
  address: string | null | undefined
): string[] {
  if (!address) return [];
  const cutoff = Date.now() - NOTIFICATION_SEEN_IN_APP_MAX_AGE_MS;
  const byAddr = record[address] ?? {};
  return Object.keys(byAddr).filter(
    (k) => typeof byAddr[k] === 'number' && byAddr[k] > cutoff
  );
}

const seenInAppStorage = {
  getItem: (key: string): SeenInAppRecordByAddress => {
    const raw: string | null | unknown =
      electronStorage != null
        ? (electronStorage as any).getItem(key, null)
        : typeof localStorage !== 'undefined'
          ? localStorage.getItem(key)
          : null;
    const record = parseSeenInAppStored(raw);
    return filterSeenInAppRecordByAge(record);
  },
  setItem: (key: string, value: string | SeenInAppRecordByAddress): void => {
    const record =
      typeof value === 'string' ? parseSeenInAppStored(value) : value;
    const pruned = filterSeenInAppRecordByAge(record);
    if (electronStorage != null) {
      (electronStorage as any).setItem(key, pruned);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(pruned));
    }
  },
  removeItem: (key: string): void => {
    if (electronStorage != null) {
      (electronStorage as any).removeItem?.(key);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  },
};

export const notificationSeenInAppKeysRecordAtom =
  atomWithStorage<SeenInAppRecordByAddress>(
    NOTIFICATION_SEEN_IN_APP_STORAGE_KEY,
    {},
    seenInAppStorage as any
  );

/** Keys for current user (from last 3 days). Set with string[] for current address or { address, keys } to merge for an address. */
export const notificationSeenInAppKeysAtom = atom(
  (get) =>
    seenInAppRecordToKeysForAddress(
      get(notificationSeenInAppKeysRecordAtom) as SeenInAppRecordByAddress,
      get(userInfoAtom)?.address
    ),
  (get, set, update: string[] | { address: string; keys: string[] }) => {
    const full = get(
      notificationSeenInAppKeysRecordAtom
    ) as SeenInAppRecordByAddress;
    const address =
      typeof update === 'object' && update !== null && 'address' in update
        ? (update as { address: string; keys: string[] }).address
        : get(userInfoAtom)?.address;
    const keys =
      typeof update === 'object' && update !== null && 'keys' in update
        ? (update as { address: string; keys: string[] }).keys
        : (update as string[]);
    if (!address || !Array.isArray(keys)) return;
    const record = { ...full };
    record[address] = { ...(record[address] ?? {}) };
    const now = Date.now();
    for (const k of keys) record[address][k] = now;
    const pruned = filterSeenInAppRecordByAge(record);
    set(notificationSeenInAppKeysRecordAtom, pruned);
  }
);

/** Current user: seen-in-app key → mark time (ms). Same ageing as notificationSeenInAppKeysAtom. */
export const notificationSeenInAppKeyTimesAtom = atom((get) => {
  const byAddress = get(
    notificationSeenInAppKeysRecordAtom
  ) as SeenInAppRecordByAddress;
  const address = get(userInfoAtom)?.address;
  if (!address) return {} as SeenInAppKeyRecord;
  return filterSeenInAppKeyRecordByAge(byAddress[address] ?? {});
});

/** Same field order as GeneralNotifications getNotificationTimestamp (for prefix cutoff). */
export function getNotificationSeenComparableTimeMs(notification: {
  data?: { created?: unknown; timestamp?: unknown };
  timestamp?: unknown;
}): number | null {
  const raw =
    notification?.data?.created ??
    notification?.data?.timestamp ??
    notification?.timestamp;
  if (raw == null || typeof raw !== 'number') return null;
  return raw < 1e12 ? raw * 1000 : raw;
}

/**
 * Full key: that exact notification is seen. Prefix key: seen only if resource time ≤ persisted mark time
 * (so new items after mark stay unread).
 */
export function isNotificationSeenInAppFromKeyTimes(
  notification: {
    event?: string;
    data?: {
      signature?: string;
      identifier?: string;
      created?: unknown;
      timestamp?: unknown;
    };
    appName?: string;
    appService?: string;
    notificationId?: string;
    timestamp?: unknown;
  },
  seenInAppByKey: SeenInAppKeyRecord | null | undefined
): boolean {
  if (!seenInAppByKey || Object.keys(seenInAppByKey).length === 0) return false;
  const fullKey = getNotificationSeenKey(notification);
  if (typeof seenInAppByKey[fullKey] === 'number') return true;
  const prefixKey = getNotificationSeenPrefixKey(notification);
  const markedAt = seenInAppByKey[prefixKey];
  if (typeof markedAt !== 'number') return false;
  const notifTs = getNotificationSeenComparableTimeMs(notification);
  if (notifTs == null) return false;
  return notifTs <= markedAt;
}

/** Stable key for a notification (for "seen in app" matching). */
export function getNotificationSeenKey(notification: {
  event?: string;
  data?: { signature?: string; identifier?: string; created?: unknown };
  appName?: string;
  appService?: string;
  notificationId?: string;
}): string {
  if (notification?.event === 'PAYMENT_RECEIVED') {
    return `PAYMENT_RECEIVED-${notification?.data?.signature ?? ''}`;
  }
  if (notification?.event === 'RESOURCE_PUBLISHED') {
    const appName = (notification?.appName ?? '').toLowerCase();
    const appService = notification?.appService ?? 'APP';
    const notificationId = notification?.notificationId ?? '';
    const id =
      notification?.data?.identifier ?? notification?.data?.created ?? '';
    return `RESOURCE_PUBLISHED-${appName}-${appService}-${notificationId}-${id}`;
  }
  return `other-${notification?.event ?? ''}-${Date.now()}`;
}

/** Prefix key (app + notificationId only); when app marks by notificationId, we add this. */
export function getNotificationSeenPrefixKey(notification: {
  event?: string;
  appName?: string;
  appService?: string;
  notificationId?: string;
}): string {
  if (notification?.event === 'RESOURCE_PUBLISHED') {
    const appName = (notification?.appName ?? '').toLowerCase();
    const appService = notification?.appService ?? 'APP';
    const notificationId = notification?.notificationId ?? '';
    return `RESOURCE_PUBLISHED-${appName}-${appService}-${notificationId}`;
  }
  return getNotificationSeenKey(notification as any);
}

/** Build prefix for a subscription (same shape as getNotificationSeenPrefixKey). */
function getSubscriptionSeenPrefix(sub: CustomWebsocketSubscription): string {
  const appName = ((sub.appName as string) ?? '').toLowerCase();
  const appService = (sub.appService as string) ?? 'APP';
  const notificationId = (sub.notificationId as string) ?? '';
  return `RESOURCE_PUBLISHED-${appName}-${appService}-${notificationId}`;
}

/** Keep only seen-in-app keys that still match a rule in customWebsocketSubscriptions. */
export function filterSeenInAppKeysByRules(
  seenKeys: string[],
  customSubscriptions: CustomWebsocketSubscription[]
): string[] {
  if (!Array.isArray(seenKeys) || seenKeys.length === 0) return [];
  const validPrefixes = new Set(
    (customSubscriptions ?? []).map(getSubscriptionSeenPrefix)
  );
  if (validPrefixes.size === 0) return [];
  return seenKeys.filter((key) => {
    if (validPrefixes.has(key)) return true;
    for (const prefix of validPrefixes) {
      if (key.startsWith(prefix + '-')) return true;
    }
    return false;
  });
}

export const txListAtom = atomWithReset([]);

/** Notifications per user address (in-memory only; repopulated from WebSocket). */
export const notificationsByAddressAtom = atomWithReset<Record<string, any[]>>(
  {}
);

/** Persisted: timestamp when user last "saw all" notifications, per address (Electron: appStorage). */
export const SEEN_ALL_NOTIFICATIONS_STORAGE_KEY =
  'qortal_seen_all_notifications';
export const seenAllNotificationsByAddressAtom = atomWithStorage<
  Record<string, number | null>
>(SEEN_ALL_NOTIFICATIONS_STORAGE_KEY, {}, electronStorage as any);

/** Groups the current user is a member of – refreshed every 5 minutes. */
export const myMemberGroupsAtom = atomWithReset<any[]>([]);
/** Unix-ms timestamp of the last successful fetch for myMemberGroupsAtom. */
export const myMemberGroupsLastFetchedAtom = atomWithReset<number>(0);

/** Subscriptions the current user is subscribed to (fetched globally in the title bar). */
export const mySubscriptionsAtom = atomWithReset<any[]>([]);
/** Subscriptions belonging to groups the current user manages as admin. */
export const managedSubscriptionsAtom = atomWithReset<any[]>([]);
/** Whether the global subscription fetch is currently in progress. */
export const subscriptionsLoadingAtom = atomWithReset<boolean>(false);
/** Whether the global managed subscription fetch is currently in progress. */
export const managedSubscriptionsLoadingAtom = atomWithReset<boolean>(false);

export const isPublicNodeUnavailableAtom = atomWithReset(false);
export const isLoadingAuthenticateAtom = atomWithReset(false);
export const authenticatePasswordAtom = atomWithReset('');
export const extStateAtom = atomWithReset<extStates>('not-authenticated');
export const userInfoAtom = atomWithReset<any>(null);

/** Pre–per-account storage: flat friend map; merged into first logged-in user on migrate. */
export const DM_FRIENDS_LEGACY_BUCKET_KEY = '__legacy_dm_friends_flat_v1__';

function isDmFriendStoredEntry(v: unknown): v is DmFriendStored {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as DmFriendStored).publicKey === 'string' &&
    typeof (v as DmFriendStored).addedAt === 'number'
  );
}

function isLegacyFlatDmFriendsRoot(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj).filter((k) => !k.startsWith('__'));
  if (keys.length === 0) return false;
  return keys.every((k) => isDmFriendStoredEntry(obj[k]));
}

/** Stored: authenticated address → friend address → metadata. */
export type DmFriendsByAccount = Record<string, Record<string, DmFriendStored>>;

export function parseDmFriendsPersisted(
  raw: string | null | unknown
): DmFriendsByAccount {
  if (raw == null || raw === '') return {};
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;

  if (isLegacyFlatDmFriendsRoot(obj)) {
    const bucket: Record<string, DmFriendStored> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isDmFriendStoredEntry(v)) bucket[k] = v;
    }
    return { [DM_FRIENDS_LEGACY_BUCKET_KEY]: bucket };
  }

  const result: DmFriendsByAccount = {};
  for (const [accountKey, inner] of Object.entries(obj)) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
    const innerObj = inner as Record<string, unknown>;
    const friendMap: Record<string, DmFriendStored> = {};
    for (const [fk, fv] of Object.entries(innerObj)) {
      if (isDmFriendStoredEntry(fv)) friendMap[fk] = fv;
    }
    result[accountKey] = friendMap;
  }
  return result;
}

const dmFriendsByAccountStorage = {
  getItem: (key: string): DmFriendsByAccount => {
    const raw: string | null | unknown =
      electronStorage != null
        ? (electronStorage as any).getItem(key, null)
        : typeof localStorage !== 'undefined'
          ? localStorage.getItem(key)
          : null;
    return parseDmFriendsPersisted(raw);
  },
  setItem: (key: string, value: string | DmFriendsByAccount): void => {
    const record =
      typeof value === 'string' ? parseDmFriendsPersisted(value) : value;
    if (electronStorage != null) {
      (electronStorage as any).setItem(key, record);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(record));
    }
  },
  removeItem: (key: string): void => {
    if (electronStorage != null) {
      (electronStorage as any).removeItem?.(key);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  },
};

/** Persisted: DM friends per authenticated address (friend address → metadata). */
export const dmFriendsByAccountAtom = atomWithStorage<DmFriendsByAccount>(
  DM_FRIENDS_STORAGE_KEY,
  {},
  dmFriendsByAccountStorage as any
);

/** Current user's DM friends (derived from dmFriendsByAccountAtom). */
export const dmFriendsByAddressAtom = atom(
  (get) => {
    const byAccount = get(dmFriendsByAccountAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return {};
    return (byAccount[address] ?? {}) as Record<string, DmFriendStored>;
  },
  (
    get,
    set,
    update:
      | Record<string, DmFriendStored>
      | ((
          prev: Record<string, DmFriendStored>
        ) => Record<string, DmFriendStored>)
  ) => {
    const byAccount = get(dmFriendsByAccountAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const prev = (byAccount[address] ?? {}) as Record<string, DmFriendStored>;
    const next = typeof update === 'function' ? update(prev) : update;
    set(dmFriendsByAccountAtom, { ...byAccount, [address]: next });
  }
);

/** Current user's custom WS subscriptions (derived from customWebsocketSubscriptionsByAddressAtom by address). */
export const customWebsocketSubscriptionsAtom = atom(
  (get) => {
    const byAddress = get(customWebsocketSubscriptionsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return [];
    return (byAddress[address] ?? []) as CustomWebsocketSubscription[];
  },
  (
    get,
    set,
    update:
      | CustomWebsocketSubscription[]
      | ((prev: CustomWebsocketSubscription[]) => CustomWebsocketSubscription[])
  ) => {
    const byAddress = get(customWebsocketSubscriptionsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const prev = (byAddress[address] ?? []) as CustomWebsocketSubscription[];
    const next = typeof update === 'function' ? update(prev) : update;
    set(customWebsocketSubscriptionsByAddressAtom, {
      ...byAddress,
      [address]: next,
    });
  }
);

/** Current user's notifications (derived from notificationsByAddressAtom by address). */
export const paymentNotificationsAtom = atom(
  (get) => {
    const byAddress = get(notificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return [];
    return (byAddress[address] ?? []) as any[];
  },
  (get, set, update: any[] | ((prev: any[]) => any[])) => {
    const byAddress = get(notificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    const prev = (byAddress[address] ?? []) as any[];
    const next = typeof update === 'function' ? update(prev) : update;
    set(notificationsByAddressAtom, { ...byAddress, [address]: next });
  }
);

/** Current user's "seen all notifications" timestamp (derived from seenAllNotificationsByAddressAtom by address). */
export const lastPaymentSeenTimestampAtom = atom(
  (get) => {
    const byAddress = get(seenAllNotificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return null;
    return (byAddress[address] ?? null) as number | null;
  },
  (get, set, value: number | null) => {
    const byAddress = get(seenAllNotificationsByAddressAtom);
    const address = get(userInfoAtom)?.address;
    if (!address) return;
    set(seenAllNotificationsByAddressAtom, { ...byAddress, [address]: value });
  }
);

export const notificationSeenInAppKeysByAddressAtom = atomWithStorage<
  Record<string, Record<string, number>>
>('qortal_notification_seen_in_app_by_address', {});

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
  url: HTTPS_EXT_NODE_QORTAL_LINK,
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
  compact?: boolean;
  dismissible?: boolean;
  sourceId?: string;
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

/** Controls visibility of the support chat panel (toggled via sidebar icon). */
export const supportChatOpenAtom = atom(false);

/** Controls visibility of the group call panel (separate from 1v1 support chat). */
export const groupChatOpenAtom = atom(false);

/** Qortal group voice: full-screen stage hidden; slim rail next to group list. */
export const qortalGroupVoiceCallMinimizedAtom = atom(false);

/**
 * P2P mesh hint: groupId (string) → at least one participant may be in a voice call
 * for `gcall-qortal-<id>`. Updated from Electron main (debounced); not cryptographically verified.
 */
export const qortalGroupMeshCallActiveAtom = atom<Record<string, boolean>>({});

/** P2P mesh hint: groupId (string) → latest advertised participant count for a group call. */
export const qortalGroupMeshCallParticipantCountAtom = atom<
  Record<string, number>
>({});

/** P2P mesh hint: groupId (string) → advertised max participant count for a group call. */
export const qortalGroupMeshCallMaxParticipantsAtom = atom<
  Record<string, number>
>({});

/** Local user's active Qortal group call room id (`gcall-qortal-<n>`), or null. */
export const qortalGroupSelfGcallRoomIdAtom = atom<string | null>(null);

/** UI-only address → primaryName cache for active Qortal group call participants. */
export const qortalGroupCallPrimaryNamesAtom = atom<Record<string, string>>({});
