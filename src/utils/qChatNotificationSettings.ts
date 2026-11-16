import { executeEvent } from './events';

export const NOTIFICATION_SETTINGS_UPDATED_EVENT =
  'q-chat-notification-settings-updated';
export const QCHAT_REPLY_NOTIFICATION_EVENT = 'Q_CHAT_REPLY';

export type PushLevel = 'all' | 'mentions' | 'none';

// ---------------------------------------------------------------------------
// New flat channel-override model
//
// Storage keys:
//   q-chat-notif-global        — GlobalNotificationSettings (source of truth)
//   q-chat-notif-{groupId}     — GroupNotificationStore (flat channel diffs)
//
// A channel entry stores ONLY fields that differ from the global defaults.
// A channel with no entry inherits the global defaults exactly.
// ---------------------------------------------------------------------------

export interface GlobalNotificationSettings {
  pushLevel: PushLevel;
  suppressEveryoneHere: boolean;
  notifyOnReplies: boolean;
  notifyOnReactions: boolean;
  version: number; // incremented on every global defaults change
}

export interface ChannelOverride {
  pushLevel?: PushLevel;
  suppressEveryoneHere?: boolean;
  notifyOnReplies?: boolean;
  notifyOnReactions?: boolean;
  mutedUntil?: number | null;
}

export interface GroupNotificationStore {
  /** Global defaults version this store was last synchronized with. */
  globalVersion?: number;
  /** Group-only setting: whether welcome posts notify. Not per-channel. */
  notifyOnWelcomePosts?: boolean;
  /** Group-only setting: hide muted channels in the UI. Not per-channel. */
  hideMutedChannels?: boolean;
  /** Flat per-channel overrides. Keyed by channel ID. Only diffs stored. */
  channels: Record<string, ChannelOverride>;
}

export interface EffectiveNotificationSettings {
  pushLevel: PushLevel;
  suppressEveryoneHere: boolean;
  notifyOnReplies: boolean;
  notifyOnReactions: boolean;
  notifyOnWelcomePosts: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: EffectiveNotificationSettings = {
  pushLevel: 'mentions',
  suppressEveryoneHere: false,
  notifyOnReplies: true,
  notifyOnReactions: true,
  notifyOnWelcomePosts: true,
};

export const DEFAULT_GLOBAL_NOTIFICATION_SETTINGS: GlobalNotificationSettings =
  {
    pushLevel: 'mentions',
    suppressEveryoneHere: false,
    notifyOnReplies: true,
    notifyOnReactions: true,
    version: 1,
  };

export const GLOBAL_SETTINGS_KEY = 'q-chat-notif-global';
const GROUP_SETTINGS_KEY_PREFIX = 'q-chat-notif-';
const MIGRATION_FLAG_KEY = 'q-chat-notification-settings-migrated';
const OLD_MENTION_DISABLED_KEY = 'q-chat-mention-notifications-disabled';
const OLD_MUTED_GROUPS_KEY = 'mutedGroups';
export const OLD_GROUP_SETTINGS_KEY_PREFIX = 'q-chat-notification-settings-';

function groupSettingsKey(groupId: string | number): string {
  return `${GROUP_SETTINGS_KEY_PREFIX}${groupId}`;
}

function oldGroupSettingsKey(groupId: string | number): string {
  return `${OLD_GROUP_SETTINGS_KEY_PREFIX}${groupId}`;
}

// ---------------------------------------------------------------------------
// Global defaults
// ---------------------------------------------------------------------------

/**
 * Reads the persisted global notification settings. Returns a merged object
 * seeded with DEFAULT_GLOBAL_NOTIFICATION_SETTINGS so callers always get a
 * complete object (version is taken from storage when present, else 1).
 */
export async function getGlobalNotificationSettings(): Promise<GlobalNotificationSettings> {
  const data = await window
    .sendMessage('getUserSettings', { key: GLOBAL_SETTINGS_KEY })
    .catch(() => null);
  if (!data || typeof data !== 'object') {
    return { ...DEFAULT_GLOBAL_NOTIFICATION_SETTINGS };
  }
  const stored = data as Partial<GlobalNotificationSettings>;
  return {
    pushLevel:
      stored.pushLevel ?? DEFAULT_GLOBAL_NOTIFICATION_SETTINGS.pushLevel,
    suppressEveryoneHere:
      stored.suppressEveryoneHere ??
      DEFAULT_GLOBAL_NOTIFICATION_SETTINGS.suppressEveryoneHere,
    notifyOnReplies:
      stored.notifyOnReplies ??
      DEFAULT_GLOBAL_NOTIFICATION_SETTINGS.notifyOnReplies,
    notifyOnReactions:
      stored.notifyOnReactions ??
      DEFAULT_GLOBAL_NOTIFICATION_SETTINGS.notifyOnReactions,
    version:
      typeof stored.version === 'number' && stored.version > 0
        ? stored.version
        : DEFAULT_GLOBAL_NOTIFICATION_SETTINGS.version,
  };
}

/**
 * Persists global notification settings, incrementing the version. Accepts a
 * partial and merges it over the current stored values (or default values).
 * After writing, fires NOTIFICATION_SETTINGS_UPDATED_EVENT with a groupId of
 * null so caches can refresh global defaults.
 */
export async function setGlobalNotificationSettings(
  partial: Partial<GlobalNotificationSettings>
): Promise<GlobalNotificationSettings> {
  const current = await getGlobalNotificationSettings();
  const next: GlobalNotificationSettings = {
    ...current,
    ...partial,
    version: (current.version ?? 0) + 1,
  };
  const response = await window.sendMessage('addUserSettings', {
    keyValue: {
      key: GLOBAL_SETTINGS_KEY,
      value: next,
    },
  });
  if (response?.error) {
    throw new Error(response.error);
  }
  executeEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, {
    groupId: null,
    settings: null,
    globalSettings: next,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Per-group store
// ---------------------------------------------------------------------------

export async function getGroupNotificationStore(
  groupId: string | number
): Promise<GroupNotificationStore> {
  const data = await window
    .sendMessage('getUserSettings', { key: groupSettingsKey(groupId) })
    .catch(() => null);
  if (!data || typeof data !== 'object') {
    return { channels: {} };
  }
  const store = data as Partial<GroupNotificationStore>;
  const channels: Record<string, ChannelOverride> = {};
  if (store.channels && typeof store.channels === 'object') {
    for (const [chId, override] of Object.entries(store.channels)) {
      // An empty override means "inherits global defaults" — no entry needed.
      if (
        override &&
        typeof override === 'object' &&
        Object.keys(override as object).length > 0
      ) {
        channels[chId] = override as ChannelOverride;
      }
    }
  }
  return {
    globalVersion: store.globalVersion,
    notifyOnWelcomePosts: store.notifyOnWelcomePosts,
    hideMutedChannels: store.hideMutedChannels,
    channels,
  };
}

export async function setGroupNotificationStore(
  groupId: string | number,
  store: GroupNotificationStore
): Promise<void> {
  const response = await window.sendMessage('addUserSettings', {
    keyValue: {
      key: groupSettingsKey(groupId),
      value: store,
    },
  });
  if (response?.error) {
    throw new Error(response.error);
  }
  executeEvent(NOTIFICATION_SETTINGS_UPDATED_EVENT, {
    groupId,
    settings: store,
  });
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

function pruneChannelOverride(
  override: ChannelOverride,
  global: GlobalNotificationSettings,
  stripMuteOnly: boolean = false
): ChannelOverride | null {
  const next: ChannelOverride = {};
  if (stripMuteOnly) {
    // Keep only mute state; prune diff fields that match global defaults.
    if (override.mutedUntil !== undefined && override.mutedUntil !== 0) {
      next.mutedUntil = override.mutedUntil;
    }
    return Object.keys(next).length > 0 ? next : null;
  }
  if (
    override.pushLevel !== undefined &&
    override.pushLevel !== global.pushLevel
  ) {
    next.pushLevel = override.pushLevel;
  }
  if (
    override.suppressEveryoneHere !== undefined &&
    override.suppressEveryoneHere !== global.suppressEveryoneHere
  ) {
    next.suppressEveryoneHere = override.suppressEveryoneHere;
  }
  if (
    override.notifyOnReplies !== undefined &&
    override.notifyOnReplies !== global.notifyOnReplies
  ) {
    next.notifyOnReplies = override.notifyOnReplies;
  }
  if (
    override.notifyOnReactions !== undefined &&
    override.notifyOnReactions !== global.notifyOnReactions
  ) {
    next.notifyOnReactions = override.notifyOnReactions;
  }
  if (override.mutedUntil !== undefined && override.mutedUntil !== 0) {
    next.mutedUntil = override.mutedUntil;
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Fetches known channels for a group from the Reticulum channel API when
 * available. Returns channel IDs, optionally filtered to one section.
 */
async function fetchChannelIds(
  groupId: string | number,
  sectionFilter?: string
): Promise<string[]> {
  try {
    const channels = await (window as any).reticulumChat?.getChannels?.(
      Number(groupId),
      true
    );
    if (!Array.isArray(channels) || channels.length === 0) return [];
    const ids: string[] = [];
    for (const ch of channels) {
      const chId = String(ch?.channelId || '').trim();
      if (!chId) continue;
      const catId = String(ch?.categoryId ?? '').trim();
      if (sectionFilter != null && catId !== sectionFilter) continue;
      ids.push(chId);
    }
    return ids;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scope application (parent always overwrites children)
// ---------------------------------------------------------------------------

export interface ScopeDescriptor {
  groupId: string | number;
  sectionId?: string;
  channelId?: string;
}

export type ScopeNotificationSettings = Partial<ChannelOverride> & {
  notifyOnWelcomePosts?: boolean;
  hideMutedChannels?: boolean;
};

/**
 * Core scope application. Determines the channels in scope and writes the
 * given partial settings to each channel's override in the flat map. Any
 * channel entry that ends up matching the global defaults (or having only an
 * inactive mute) is deleted. Group-only fields (notifyOnWelcomePosts,
 * hideMutedChannels) are written to the store top level when scope is
 * group-wide (no sectionId/channelId).
 */
export async function applyScopeNotificationSettings(
  scope: ScopeDescriptor,
  settings: ScopeNotificationSettings
): Promise<void> {
  const global = await getGlobalNotificationSettings();
  const store = await getGroupNotificationStore(scope.groupId);

  // Group-only fields apply at group-wide scope only.
  if (scope.sectionId == null && scope.channelId == null) {
    if (settings.notifyOnWelcomePosts !== undefined) {
      store.notifyOnWelcomePosts = settings.notifyOnWelcomePosts;
    }
    if (settings.hideMutedChannels !== undefined) {
      store.hideMutedChannels = settings.hideMutedChannels;
    }
  }

  // Determine the channel IDs in scope.
  let channelIds: string[] = [];
  if (scope.channelId != null) {
    channelIds = [String(scope.channelId)];
  } else {
    const known = Object.keys(store.channels);
    const fetched = await fetchChannelIds(scope.groupId, scope.sectionId);
    channelIds = fetched.length > 0 ? fetched : known;
    if (scope.sectionId != null && fetched.length === 0) {
      // Section filtering requested but channel API unavailable: cannot
      // determine section membership — fall back to existing channels only.
      channelIds = known;
    }
  }

  const diffSettings: ChannelOverride = {
    pushLevel: settings.pushLevel,
    suppressEveryoneHere: settings.suppressEveryoneHere,
    notifyOnReplies: settings.notifyOnReplies,
    notifyOnReactions: settings.notifyOnReactions,
    mutedUntil: settings.mutedUntil,
  };
  // Preserve pruned values: undefined fields are treated as "leave as-is",
  // except mutedUntil where 0 means explicitly unmuted.
  const hasAnySetting =
    diffSettings.pushLevel !== undefined ||
    diffSettings.suppressEveryoneHere !== undefined ||
    diffSettings.notifyOnReplies !== undefined ||
    diffSettings.notifyOnReactions !== undefined ||
    diffSettings.mutedUntil !== undefined;

  if (hasAnySetting) {
    for (const chId of channelIds) {
      const existing = store.channels[chId] ?? {};
      const merged: ChannelOverride = { ...existing };
      if (diffSettings.pushLevel !== undefined) {
        merged.pushLevel = diffSettings.pushLevel;
      }
      if (diffSettings.suppressEveryoneHere !== undefined) {
        merged.suppressEveryoneHere = diffSettings.suppressEveryoneHere;
      }
      if (diffSettings.notifyOnReplies !== undefined) {
        merged.notifyOnReplies = diffSettings.notifyOnReplies;
      }
      if (diffSettings.notifyOnReactions !== undefined) {
        merged.notifyOnReactions = diffSettings.notifyOnReactions;
      }
      if (diffSettings.mutedUntil !== undefined) {
        merged.mutedUntil = diffSettings.mutedUntil;
      }
      const pruned = pruneChannelOverride(merged, global);
      if (pruned) {
        store.channels[chId] = pruned;
      } else {
        delete store.channels[chId];
      }
    }
  }

  store.globalVersion = global.version;
  await setGroupNotificationStore(scope.groupId, store);
}

/**
 * Legacy-name wrapper used by consumers: writes partial settings to all
 * channels in scope. Parent scope changes overwrite child channel values.
 */
export async function setScopeNotificationSettings(
  scope: ScopeDescriptor,
  settings: ScopeNotificationSettings
): Promise<void> {
  await applyScopeNotificationSettings(scope, settings);
}

/**
 * Applies settings to all channels of every provided group.
 */
export async function applyNotificationSettingsToAllGroups(
  groupIds: Array<string | number>,
  settings: ScopeNotificationSettings
): Promise<void> {
  await Promise.all(
    groupIds.map((groupId) =>
      applyScopeNotificationSettings({ groupId }, settings)
    )
  );
}

/**
 * Clears the per-channel *diff* overrides in every provided group's store so
 * all channels inherit the new global defaults. Used when global defaults
 * change.
 *
 * Mute state is NOT a diff against the global defaults — it is explicit user
 * intent for one channel — so it survives. `pruneChannelOverride`'s
 * `stripMuteOnly` mode keeps `mutedUntil` and drops `pushLevel`,
 * `suppressEveryoneHere`, `notifyOnReplies` and `notifyOnReactions`, which are
 * exactly the fields that are now redundant with the new defaults.
 *
 * Previously this assigned `store.channels = {}`, silently unmuting every
 * channel whenever the global notification settings were changed.
 */
export async function wipeAllChannelOverrides(
  groupIds: Array<string | number>
): Promise<void> {
  const global = await getGlobalNotificationSettings();
  await Promise.all(
    groupIds.map(async (groupId) => {
      const store = await getGroupNotificationStore(groupId);
      const nextChannels: GroupNotificationStore['channels'] = {};
      for (const [chId, override] of Object.entries(store.channels ?? {})) {
        const pruned = pruneChannelOverride(override ?? {}, global, true);
        if (pruned) nextChannels[chId] = pruned;
      }
      store.channels = nextChannels;
      store.globalVersion = global.version;
      await setGroupNotificationStore(groupId, store);
    })
  );
}

// ---------------------------------------------------------------------------
// Effective settings resolution (read path)
// ---------------------------------------------------------------------------

/**
 * Resolves effective settings for a single channel under the flat model:
 * global defaults overlaid with the channel override (if any), plus the
 * group-only notifyOnWelcomePosts value.
 *
 * @param groupStore Per-group store (may be undefined for no data)
 * @param channelId  Channel ID; when omitted only group-level/global values apply
 * @param fallback   Default values used when global defaults are absent (e.g. tests)
 */
export function resolveEffectiveSettings(
  groupStore: GroupNotificationStore | undefined,
  channelId: string | undefined,
  fallback: EffectiveNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
): EffectiveNotificationSettings {
  const result: EffectiveNotificationSettings = {
    ...fallback,
  };
  const global =
    groupStore?.__globalDefaults ??
    (fallback as unknown as GlobalNotificationSettings);
  if (global && typeof global === 'object' && 'pushLevel' in global) {
    const g = global as GlobalNotificationSettings;
    if (typeof g.pushLevel === 'string') {
      result.pushLevel = g.pushLevel;
    }
    if (typeof g.suppressEveryoneHere === 'boolean') {
      result.suppressEveryoneHere = g.suppressEveryoneHere;
    }
    if (typeof g.notifyOnReplies === 'boolean') {
      result.notifyOnReplies = g.notifyOnReplies;
    }
    if (typeof g.notifyOnReactions === 'boolean') {
      result.notifyOnReactions = g.notifyOnReactions;
    }
  }
  if (groupStore) {
    if (groupStore.notifyOnWelcomePosts !== undefined) {
      result.notifyOnWelcomePosts = groupStore.notifyOnWelcomePosts;
    }
    if (channelId != null) {
      const channel = groupStore.channels?.[String(channelId)];
      if (channel?.pushLevel !== undefined)
        result.pushLevel = channel.pushLevel;
      if (channel?.suppressEveryoneHere !== undefined) {
        result.suppressEveryoneHere = channel.suppressEveryoneHere;
      }
      if (channel?.notifyOnReplies !== undefined) {
        result.notifyOnReplies = channel.notifyOnReplies;
      }
      if (channel?.notifyOnReactions !== undefined) {
        result.notifyOnReactions = channel.notifyOnReactions;
      }
    }
  }
  return result;
}

/**
 * Async read path: loads global defaults + the group store, then resolves
 * effective settings for a single channel.
 */
export async function getEffectiveNotificationSettings(
  groupId: string | number,
  sectionId?: string,
  channelId?: string,
  fallback: EffectiveNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
): Promise<EffectiveNotificationSettings> {
  const [global, store] = await Promise.all([
    getGlobalNotificationSettings(),
    getGroupNotificationStore(groupId),
  ]);
  // Attach global defaults so the pure resolver can use them without an extra arg.
  // (__globalDefaults is a transient field; it is not persisted.)
  (store as any).__globalDefaults = global;
  return resolveEffectiveSettings(store, channelId, fallback);
}

// ---------------------------------------------------------------------------
// Mute helpers (flat model)
// ---------------------------------------------------------------------------

/**
 * Sentinel value for "not individually muted."
 */
export const EXPLICITLY_UNMUTED = 0;

export function isMutedUntilActive(
  mutedUntil: number | null | undefined
): boolean {
  if (mutedUntil === undefined) return false;
  if (mutedUntil === null) return true;
  return mutedUntil > Date.now();
}

/**
 * Checks whether a channel is muted. `mutedUntil` is stored per-channel only;
 * a parent-scope mute is expressed as a bulk write to every child channel.
 * The sectionId parameter is accepted for API compatibility but is not used
 * for lookup in the flat model (channel IDs are unique within a group).
 */
export function isScopeMuted(
  groupStore: GroupNotificationStore,
  sectionId?: string,
  channelId?: string
): boolean {
  if (channelId == null) return false;
  const channel = groupStore.channels?.[String(channelId)];
  if (channel?.mutedUntil !== undefined) {
    return isMutedUntilActive(channel.mutedUntil);
  }
  return false;
}

export function getScopeMutedUntil(
  groupStore: GroupNotificationStore,
  sectionId?: string,
  channelId?: string
): number | null | undefined {
  if (channelId == null) return undefined;
  const channel = groupStore.channels?.[String(channelId)];
  if (channel?.mutedUntil !== undefined) {
    return channel.mutedUntil;
  }
  return undefined;
}

export async function setScopeMuted(
  scope: ScopeDescriptor,
  mutedUntil: number | null
): Promise<void> {
  await applyScopeNotificationSettings(scope, { mutedUntil });
}

export async function unmuteScope(scope: ScopeDescriptor): Promise<void> {
  await applyScopeNotificationSettings(scope, { mutedUntil: 0 });
}

/**
 * Builds a map from channelId to sectionId. In the flat model section
 * membership is not stored per channel; this returns an empty map for API
 * compatibility. Callers that need section membership should query the
 * Reticulum channel API directly.
 */
export function buildChannelSectionMap(
  groupStore: GroupNotificationStore | undefined
): Map<string, string> {
  return new Map<string, string>();
}

// ---------------------------------------------------------------------------
// Push decision helpers (unchanged semantics)
// ---------------------------------------------------------------------------

/**
 * Determines whether a message in a muted channel should be suppressed.
 * Discord semantics:
 * - pushLevel 'all' or 'mentions': @mentions still push through, non-mentions suppressed
 * - pushLevel 'none': everything suppressed
 */
export function shouldSuppressForMutedChannel(
  muted: boolean,
  pushLevel: PushLevel,
  isMention: boolean
): boolean {
  if (!muted) return false;
  if (pushLevel === 'none') return true;
  if (pushLevel === 'mentions' || pushLevel === 'all') return !isMention;
  return true;
}

export function shouldFirePushNotification(
  effective: EffectiveNotificationSettings,
  isMention: boolean,
  isEveryoneOrHere: boolean,
  isReplyToUser: boolean,
  isReactionToUser: boolean = false
): boolean {
  if (effective.pushLevel === 'all') return true;

  if (effective.notifyOnReactions && isReactionToUser) return true;

  if (
    effective.pushLevel === 'mentions' &&
    isMention &&
    !(effective.suppressEveryoneHere && isEveryoneOrHere)
  ) {
    return true;
  }

  if (effective.notifyOnReplies && isReplyToUser) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Unread-count helpers (flat model)
// ---------------------------------------------------------------------------

function computeFilteredChannelCounts(
  groupStore: GroupNotificationStore | undefined,
  summary: any
): { totalUnread: number; totalMention: number; anyUnreadMention: boolean } {
  if (!summary) {
    return { totalUnread: 0, totalMention: 0, anyUnreadMention: false };
  }

  const channels = Array.isArray(summary?.channels) ? summary.channels : [];

  if (channels.length === 0) {
    // No per-channel breakdown, so nothing can be filtered channel by channel.
    //
    // Previously any `mutedUntil` key at all was read as "this group is muted"
    // and the whole group was reported as zero. But a key survives as an
    // expired mute (a mute the user let lapse) or an explicit `mutedUntil: 0`
    // (unmuted), and neither mutes anything. Such a group then silently lost
    // its red dot while messages were genuinely unread — the intermittent
    // "group badge sometimes missing" report.
    //
    // A group-wide mute is stored as a bulk write of the same active mute to
    // every known channel, so "every known entry is actively muted" is the
    // shape that legitimately means muted. Anything else falls back to the
    // aggregate and shows the dot.
    const muteEntries = groupStore?.channels
      ? Object.values(groupStore.channels)
      : [];
    const hasActiveMute = muteEntries.some((ch) =>
      isMutedUntilActive(ch?.mutedUntil)
    );
    const hasNonActiveEntry = muteEntries.some(
      (ch) => !isMutedUntilActive(ch?.mutedUntil)
    );
    if (hasActiveMute && !hasNonActiveEntry) {
      return { totalUnread: 0, totalMention: 0, anyUnreadMention: false };
    }
    return {
      totalUnread: Number(summary?.unreadCount ?? 0),
      totalMention: Number(summary?.mentionCount ?? 0),
      anyUnreadMention: summary?.hasUnreadMention === true,
    };
  }

  let totalUnread = 0;
  let totalMention = 0;
  let anyUnreadMention = false;
  for (const ch of channels) {
    const chId = String(ch?.channelId || '');
    if (chId && groupStore && isScopeMuted(groupStore, undefined, chId)) {
      continue;
    }
    totalUnread += Number(ch?.unreadCount ?? 0);
    totalMention += Number(ch?.mentionCount ?? 0);
    if (ch?.hasUnreadMention === true) anyUnreadMention = true;
  }

  return { totalUnread, totalMention, anyUnreadMention };
}

/**
 * How many welcome-post unreads it is legitimate to subtract from a group's
 * unread count.
 *
 * `unreadWelcomeEventIdsAtom` records every welcome post the client has seen
 * while it was unread, and is reconciled lazily. If that reconciliation has not
 * run — first launch after an upgrade, or a welcome post read on another device
 * — the set can hold more ids than the group has unread messages. Subtracting
 * the raw size then drives the arithmetic negative and the group reports no
 * unread at all, so the badge and count silently disappear while real messages
 * remain unread.
 *
 * A set claiming more unread welcome posts than there are unread messages is
 * provably inconsistent with the summary, so it is disregarded rather than
 * trusted.
 *
 * A set *equal* to the unread total is ambiguous and is also disregarded. The
 * set carries no timestamps, so "3 unread, all welcome posts" and "3 unread,
 * one stale welcome id plus 2 real messages" are the same input. Subtracting in
 * full resolves the ambiguity in the direction that hides a real message, which
 * is the reported bug; disregarding it can only show a dot for a muted welcome
 * post, which is visible and self-corrects. When the two readings cannot be
 * told apart, this deliberately errs toward showing the badge.
 *
 * A set below the total is subtracted: at least one real unread message remains
 * however the ambiguity resolves, so the dot still shows either way.
 */
function resolveEffectiveWelcomeUnread(
  welcomeUnreadCount: number | undefined,
  totalUnread: number
): number {
  const welcomeCount = Math.max(0, Number(welcomeUnreadCount) || 0);
  if (welcomeCount === 0) return 0;
  if (welcomeCount >= Math.max(0, totalUnread)) return 0;
  return welcomeCount;
}

/**
 * Determines whether a group should show its red unread dot, considering
 * per-channel mute state.
 */
export function groupHasUnreadConsideringMute(
  groupStore: GroupNotificationStore | undefined,
  summary: any,
  welcomeUnreadCount?: number,
  fallback: EffectiveNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
): boolean {
  if (!summary) return false;

  const notifyOnWelcomePosts =
    groupStore?.notifyOnWelcomePosts ?? fallback.notifyOnWelcomePosts ?? true;

  const { totalUnread, totalMention, anyUnreadMention } =
    computeFilteredChannelCounts(groupStore, summary);

  const welcomeCount = notifyOnWelcomePosts
    ? 0
    : resolveEffectiveWelcomeUnread(welcomeUnreadCount, totalUnread);

  if (welcomeCount > 0) {
    return (
      anyUnreadMention ||
      totalMention - welcomeCount > 0 ||
      totalUnread - welcomeCount > 0
    );
  }
  return anyUnreadMention || totalMention > 0 || totalUnread > 0;
}

/**
 * Returns the total numeric unread count for a group, considering
 * per-channel mute state.
 */
export function getGroupUnreadCountConsideringMute(
  groupStore: GroupNotificationStore | undefined,
  summary: any,
  welcomeUnreadCount?: number,
  fallback: EffectiveNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
): number {
  if (!summary) return 0;

  const notifyOnWelcomePosts =
    groupStore?.notifyOnWelcomePosts ?? fallback.notifyOnWelcomePosts ?? true;

  const { totalUnread } = computeFilteredChannelCounts(groupStore, summary);

  // Same bound as the boolean predicate: a welcome set larger than the unread
  // total is stale, and subtracting it in full would clamp the count to zero.
  const welcomeCount = notifyOnWelcomePosts
    ? 0
    : resolveEffectiveWelcomeUnread(welcomeUnreadCount, totalUnread);

  return Math.max(0, totalUnread - welcomeCount);
}

// ---------------------------------------------------------------------------
// Group-only settings accessors
// ---------------------------------------------------------------------------

export async function getHideMutedChannels(
  groupId: string | number
): Promise<boolean> {
  const store = await getGroupNotificationStore(groupId);
  return store.hideMutedChannels === true;
}

export async function setHideMutedChannels(
  groupId: string | number,
  value: boolean
): Promise<void> {
  const store = await getGroupNotificationStore(groupId);
  store.hideMutedChannels = value;
  await setGroupNotificationStore(groupId, store);
}

// ---------------------------------------------------------------------------
// Migration from the legacy nested model
// ---------------------------------------------------------------------------

export const MIGRATION_KEYS = {
  MIGRATION_FLAG: MIGRATION_FLAG_KEY,
  OLD_MENTION_DISABLED: OLD_MENTION_DISABLED_KEY,
  OLD_MUTED_GROUPS: OLD_MUTED_GROUPS_KEY,
};

// Legacy types (only used during migration).
interface LegacyScopeSettings {
  pushLevel?: PushLevel;
  suppressEveryoneHere?: boolean;
  notifyOnReplies?: boolean;
  notifyOnReactions?: boolean;
  mutedUntil?: number | null;
}
interface LegacySectionSettings extends LegacyScopeSettings {
  channels?: Record<string, LegacyScopeSettings>;
}
interface LegacyGroupSettings extends LegacyScopeSettings {
  sections?: Record<string, LegacySectionSettings>;
  hideMutedChannels?: boolean;
  notifyOnWelcomePosts?: boolean;
}

async function getLegacyGroupSettings(
  groupId: string | number
): Promise<LegacyGroupSettings | null> {
  const data = await window
    .sendMessage('getUserSettings', { key: oldGroupSettingsKey(groupId) })
    .catch(() => null);
  if (!data || typeof data !== 'object') return null;
  return data as LegacyGroupSettings;
}

/**
 * Computes the effective settings for a channel under the legacy
 * most-specific-wins rules, seeded from the *new* global defaults so the
 * migration result matches what the flat model would produce for a channel
 * that differs from defaults.
 */
function legacyResolve(
  group: LegacyGroupSettings,
  global: GlobalNotificationSettings,
  sectionId?: string,
  channelId?: string
): EffectiveNotificationSettings {
  const result: EffectiveNotificationSettings = {
    pushLevel: global.pushLevel,
    suppressEveryoneHere: global.suppressEveryoneHere,
    notifyOnReplies: global.notifyOnReplies,
    notifyOnReactions: global.notifyOnReactions,
    notifyOnWelcomePosts: group.notifyOnWelcomePosts ?? true,
  };

  if (group.pushLevel !== undefined) result.pushLevel = group.pushLevel;
  if (group.suppressEveryoneHere !== undefined) {
    result.suppressEveryoneHere = group.suppressEveryoneHere;
  }
  if (group.notifyOnReplies !== undefined) {
    result.notifyOnReplies = group.notifyOnReplies;
  }
  if (group.notifyOnReactions !== undefined) {
    result.notifyOnReactions = group.notifyOnReactions;
  }

  if (sectionId != null && group.sections?.[sectionId]) {
    const section = group.sections[sectionId];
    if (section.pushLevel !== undefined) result.pushLevel = section.pushLevel;
    if (section.suppressEveryoneHere !== undefined) {
      result.suppressEveryoneHere = section.suppressEveryoneHere;
    }
    if (section.notifyOnReplies !== undefined) {
      result.notifyOnReplies = section.notifyOnReplies;
    }
    if (section.notifyOnReactions !== undefined) {
      result.notifyOnReactions = section.notifyOnReactions;
    }
    if (channelId != null && section.channels?.[channelId]) {
      const channel = section.channels[channelId];
      if (channel.pushLevel !== undefined) result.pushLevel = channel.pushLevel;
      if (channel.suppressEveryoneHere !== undefined) {
        result.suppressEveryoneHere = channel.suppressEveryoneHere;
      }
      if (channel.notifyOnReplies !== undefined) {
        result.notifyOnReplies = channel.notifyOnReplies;
      }
      if (channel.notifyOnReactions !== undefined) {
        result.notifyOnReactions = channel.notifyOnReactions;
      }
    }
  } else if (channelId != null) {
    // channelId without a sectionId — legacy default section uses ''.
    const defaultSection = group.sections?.[''];
    const channel = defaultSection?.channels?.[channelId];
    if (channel) {
      if (channel.pushLevel !== undefined) result.pushLevel = channel.pushLevel;
      if (channel.suppressEveryoneHere !== undefined) {
        result.suppressEveryoneHere = channel.suppressEveryoneHere;
      }
      if (channel.notifyOnReplies !== undefined) {
        result.notifyOnReplies = channel.notifyOnReplies;
      }
      if (channel.notifyOnReactions !== undefined) {
        result.notifyOnReactions = channel.notifyOnReactions;
      }
    }
  }

  return result;
}

/**
 * Returns true when a migration from the legacy nested model to the flat
 * channel-override model is required. Sentinel: the new global key does not
 * yet exist.
 */
export async function needsNotificationMigration(): Promise<boolean> {
  const global = await window
    .sendMessage('getUserSettings', { key: GLOBAL_SETTINGS_KEY })
    .catch(() => null);
  return !global || typeof global !== 'object';
}

/**
 * Migrates legacy per-group nested settings to the flat channel-override
 * model. Idempotent: only runs when the new global key is absent. Old keys
 * are left in place (never read again after migration).
 */
export async function migrateNotificationSettings(
  memberGroupIds: Array<string | number>
): Promise<void> {
  const alreadyMigrated = await window
    .sendMessage('getUserSettings', {
      key: MIGRATION_FLAG_KEY,
    })
    .catch(() => false);
  if (alreadyMigrated === true) return;

  const global = await getGlobalNotificationSettings();

  const oldMentionDisabled = await window
    .sendMessage('getUserSettings', {
      key: OLD_MENTION_DISABLED_KEY,
    })
    .catch(() => false);
  const wasMentionsDisabled = oldMentionDisabled === true;

  const mutedGroups = await window
    .sendMessage('getUserSettings', {
      key: OLD_MUTED_GROUPS_KEY,
    })
    .catch(() => []);
  const mutedGroupIds = Array.isArray(mutedGroups) ? mutedGroups : [];

  for (const groupId of memberGroupIds) {
    const legacy = await getLegacyGroupSettings(groupId);
    const channels: Record<string, ChannelOverride> = {};

    if (legacy) {
      // Channel-level mutes live per-channel in the legacy shape.
      const sections = legacy.sections ?? {};
      for (const section of Object.values(sections)) {
        const sectionChannels = section?.channels ?? {};
        for (const [chId, ch] of Object.entries(sectionChannels)) {
          if (ch?.mutedUntil !== undefined && ch.mutedUntil !== 0) {
            channels[chId] = { ...channels[chId], mutedUntil: ch.mutedUntil };
          }
        }
      }
      // Diff each known channel against the global defaults.
      const knownChannelIds = new Set<string>();
      for (const section of Object.values(sections)) {
        for (const chId of Object.keys(section?.channels ?? {})) {
          knownChannelIds.add(chId);
        }
      }
      for (const chId of knownChannelIds) {
        const effective = legacyResolve(legacy, global, undefined, chId);
        const override: ChannelOverride = {};
        if (effective.pushLevel !== global.pushLevel) {
          override.pushLevel = effective.pushLevel;
        }
        if (effective.suppressEveryoneHere !== global.suppressEveryoneHere) {
          override.suppressEveryoneHere = effective.suppressEveryoneHere;
        }
        if (effective.notifyOnReplies !== global.notifyOnReplies) {
          override.notifyOnReplies = effective.notifyOnReplies;
        }
        if (effective.notifyOnReactions !== global.notifyOnReactions) {
          override.notifyOnReactions = effective.notifyOnReactions;
        }
        if (Object.keys(override).length > 0) {
          channels[chId] = { ...channels[chId], ...override };
        }
      }
    }

    const store: GroupNotificationStore = {
      globalVersion: global.version,
      channels,
    };
    if (legacy?.hideMutedChannels !== undefined) {
      store.hideMutedChannels = legacy.hideMutedChannels;
    }
    if (legacy?.notifyOnWelcomePosts !== undefined) {
      store.notifyOnWelcomePosts = legacy.notifyOnWelcomePosts;
    }

    // Apply legacy group-level pushLevel/mutes that were not channel-specific:
    // if the legacy group root had a pushLevel of 'none' (permanent mute) but
    // no channels were materialized, apply to all known channels is skipped —
    // instead the channel API is consulted at write time. To preserve old
    // group-root mutes the root mutedUntil is propagated to all channels.
    if (legacy?.mutedUntil !== undefined && legacy.mutedUntil !== 0) {
      const fetched = await fetchChannelIds(groupId);
      const ids = fetched.length > 0 ? fetched : Object.keys(channels);
      for (const chId of ids) {
        channels[chId] = { ...channels[chId], mutedUntil: legacy.mutedUntil };
      }
    }
    if (
      wasMentionsDisabled ||
      mutedGroupIds.some((id) => String(id) === String(groupId))
    ) {
      if (store.channels == null) store.channels = {};
      const fetched = await fetchChannelIds(groupId);
      const ids = fetched.length > 0 ? fetched : Object.keys(store.channels);
      for (const chId of ids) {
        store.channels[chId] = {
          ...store.channels[chId],
          pushLevel: 'none',
        };
      }
    }

    await setGroupNotificationStore(groupId, store);
  }

  await window.sendMessage('addUserSettings', {
    keyValue: {
      key: MIGRATION_FLAG_KEY,
      value: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Notification delivery method (unchanged)
// ---------------------------------------------------------------------------

const NOTIFICATION_DELIVERY_KEY = 'q-chat-notification-delivery';

export type NotificationDeliveryMethod = 'native' | 'ephemeral';

export async function getNotificationDeliveryMethod(): Promise<NotificationDeliveryMethod> {
  const value = await window
    .sendMessage('getUserSettings', { key: NOTIFICATION_DELIVERY_KEY })
    .catch(() => null);
  if (value === 'ephemeral') return 'ephemeral';
  return 'native';
}

export async function setNotificationDeliveryMethod(
  method: NotificationDeliveryMethod
): Promise<void> {
  const response = await window.sendMessage('addUserSettings', {
    keyValue: {
      key: NOTIFICATION_DELIVERY_KEY,
      value: method,
    },
  });
  if (response?.error) {
    throw new Error(response.error);
  }
}

export function getDefaultNotificationDeliveryMethod(): NotificationDeliveryMethod {
  return 'native';
}

// ---------------------------------------------------------------------------
// Welcome-post unread tracking helpers (unchanged)
// ---------------------------------------------------------------------------

export type WelcomeUnreadMap = Record<string, Set<string>>;

export function addWelcomeUnreadEventId(
  map: WelcomeUnreadMap,
  groupId: string | number,
  eventId: string
): WelcomeUnreadMap {
  const key = String(groupId);
  const existing = map[key];
  if (existing?.has(eventId)) return map;
  const nextSet = new Set(existing);
  nextSet.add(eventId);
  return { ...map, [key]: nextSet };
}

export function removeWelcomeUnreadEventId(
  map: WelcomeUnreadMap,
  groupId: string | number,
  eventId: string
): WelcomeUnreadMap {
  const key = String(groupId);
  const existing = map[key];
  if (!existing?.has(eventId)) return map;
  const nextSet = new Set(existing);
  nextSet.delete(eventId);
  if (nextSet.size === 0) {
    const { [key]: _, ...rest } = map;
    return rest;
  }
  return { ...map, [key]: nextSet };
}

export function clearWelcomeUnreadForGroup(
  map: WelcomeUnreadMap,
  groupId: string | number
): WelcomeUnreadMap {
  const key = String(groupId);
  if (!map[key]) return map;
  const { [key]: _, ...rest } = map;
  return rest;
}

export function getWelcomeUnreadCount(
  map: WelcomeUnreadMap | undefined,
  groupId: string | number
): number {
  if (!map) return 0;
  return map[String(groupId)]?.size ?? 0;
}

/**
 * Trims a group's welcome-unread set down to what the group can still hold as
 * unread, returning the same object when nothing changed.
 *
 * At most `totalUnread` recorded welcome posts can still be unread, so a set
 * larger than that contains entries whose messages have since been read. The set
 * carries no timestamps, so rather than guessing which specific entries are
 * stale, the oldest insertions are dropped — `Set` preserves insertion order and
 * welcome posts are added in arrival order, so the front of the set is the
 * likeliest to have aged out.
 *
 * The bound matters even though the subtraction helpers also clamp: leaving an
 * inflated set in place means every future read of the group re-clamps it, and
 * the OS badge arithmetic has to keep working around it.
 */
export function reconcileWelcomeUnreadForGroup(
  map: WelcomeUnreadMap,
  groupId: string | number,
  totalUnread: number
): WelcomeUnreadMap {
  const key = String(groupId);
  const existing = map[key];
  if (!existing || existing.size === 0) return map;
  const keep = Math.max(0, Math.floor(Number(totalUnread) || 0));
  if (existing.size <= keep) return map;
  if (keep === 0) {
    const { [key]: _, ...rest } = map;
    return rest;
  }
  const trimmed = new Set([...existing].slice(existing.size - keep));
  return { ...map, [key]: trimmed };
}

/**
 * Returns the effective unread count after subtracting welcome-post unreads
 * when notifyOnWelcomePosts is false. Used by derived red-dot atoms.
 */
export function getEffectiveUnreadCount(
  summary: any,
  notifyOnWelcomePosts: boolean,
  welcomeUnreadCount: number
): number {
  const mentionCount = Number(summary?.mentionCount ?? 0);
  const unreadCount = Number(summary?.unreadCount ?? 0);
  const total = mentionCount + unreadCount;
  if (!notifyOnWelcomePosts && welcomeUnreadCount > 0) {
    return Math.max(
      0,
      total - resolveEffectiveWelcomeUnread(welcomeUnreadCount, total)
    );
  }
  return total;
}
