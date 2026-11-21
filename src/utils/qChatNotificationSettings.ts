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
  /**
   * Set once the legacy settings for this group have been migrated.
   *
   * This is a marker of *having migrated*, not of holding data. Without it the
   * migration could only recognise an already-migrated group by its store being
   * non-empty, so a user who cleared every override silently opted back in to
   * the legacy values on the next launch: a stale `q-chat-mention-notifications-
   * disabled` would rewrite every channel to `pushLevel: 'none'`. Migration is
   * also re-invoked whenever the membership list reloads, so the check has to be
   * cheap and stable rather than inferred from content.
   */
  legacyMigratedAt?: number;
  /** Flat per-channel overrides. Keyed by channel ID. Only diffs stored. */
  channels: Record<string, ChannelOverride>;
}

/**
 * Read-path wrapper carrying the global defaults alongside a group store.
 *
 * `getEffectiveNotificationSettings` attaches this so the pure resolver does not
 * need a second argument. It is never persisted: `setGroupNotificationStore`
 * writes only a real `GroupNotificationStore`.
 */
type GroupNotificationStoreWithDefaults = GroupNotificationStore & {
  __globalDefaults?: GlobalNotificationSettings;
};

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
  await writeUserSetting(GLOBAL_SETTINGS_KEY, next);
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
    // Must be carried through. This reader rebuilds the store from a fixed set
    // of fields, so a marker it does not name is dropped on every read and the
    // migration can never see that a group was already migrated. Adding the
    // field to the interface alone is not enough.
    legacyMigratedAt:
      typeof store.legacyMigratedAt === 'number'
        ? store.legacyMigratedAt
        : undefined,
    channels,
  };
}

/**
 * Persists one user setting and throws when it did not land.
 *
 * `addUserSettings` resolves a bare `true` on success and `false` on failure; it
 * never resolves an `{ error }` object. Checking `response?.error` therefore
 * never fired and every failed write was silent — which matters most for the
 * migration, where a silent failure combined with a completion flag loses the
 * user's previous preferences permanently.
 */
async function writeUserSetting(key: string, value: unknown): Promise<void> {
  const saved = await window
    .sendMessage('addUserSettings', { keyValue: { key, value } })
    .catch(() => false);
  if (saved !== true) {
    throw new Error(`Failed to save notification setting: ${key}`);
  }
}

export async function setGroupNotificationStore(
  groupId: string | number,
  store: GroupNotificationStore
): Promise<void> {
  await writeUserSetting(groupSettingsKey(groupId), store);
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
 * Menu id used for the hidden default section.
 *
 * Its channels store an empty `categoryId`, so comparing the two literally
 * never matches and the default section's menu actions would find no channels
 * of its own. Always map it through {@link sectionFilterMatches}.
 */
export const DEFAULT_SECTION_MENU_ID = 'cat-qchat-default';

/**
 * Whether a channel's stored category belongs to the section a menu targets.
 *
 * The default section is addressed as `cat-qchat-default` in the UI but stored
 * as an empty `categoryId`, so this is the one place the two are reconciled.
 */
export function sectionFilterMatches(
  categoryId: string | null | undefined,
  sectionFilter: string | null | undefined
): boolean {
  const normalizedCategory = String(categoryId ?? '').trim();
  const normalizedFilter = String(sectionFilter ?? '').trim();
  if (normalizedFilter === DEFAULT_SECTION_MENU_ID) {
    return normalizedCategory === '';
  }
  return normalizedCategory === normalizedFilter;
}

/**
 * Result of a channel lookup.
 *
 * `unavailable` is deliberately distinct from an empty `ok`. A failed lookup
 * used to be flattened to `[]`, which made "we could not ask" indistinguishable
 * from "there are no channels here" and let section-scoped writes fall back to
 * every stored override in the group.
 */
export type ChannelLookup =
  | { status: 'ok'; channelIds: string[] }
  | { status: 'unavailable' };

/**
 * Resolves the channel ids a scope covers.
 *
 * Exposed for the parent menus, which need the list to display a truthful state
 * and cannot get it from the store (the store only holds channels that differ
 * from the defaults). Returns `null` when the lookup is unavailable, so a caller
 * can tell that from an empty scope.
 */
export async function getScopeChannelIds(
  groupId: string | number,
  sectionId?: string
): Promise<string[] | null> {
  const lookup = await fetchChannelIds(groupId, sectionId);
  return lookup.status === 'ok' ? lookup.channelIds : null;
}

/** Fetches the group's channels, optionally filtered to one section. */
async function fetchChannelIds(
  groupId: string | number,
  sectionFilter?: string
): Promise<ChannelLookup> {
  const getChannels = (window as any).reticulumChat?.getChannels;
  if (typeof getChannels !== 'function') return { status: 'unavailable' };
  try {
    const channels = await getChannels(Number(groupId), true);
    if (!Array.isArray(channels)) return { status: 'unavailable' };
    const channelIds: string[] = [];
    for (const ch of channels) {
      const chId = String(ch?.channelId || '').trim();
      if (!chId) continue;
      if (
        sectionFilter != null &&
        !sectionFilterMatches(ch?.categoryId, sectionFilter)
      ) {
        continue;
      }
      channelIds.push(chId);
    }
    return { status: 'ok', channelIds };
  } catch {
    return { status: 'unavailable' };
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
  //
  // A failed lookup must never widen the scope. The previous code fell back to
  // every stored override in the group, so muting an empty section whose lookup
  // had failed wrote to channels in other sections. A successful empty lookup is
  // a no-op; an unavailable one fails the operation so the caller can retry.
  let channelIds: string[] = [];
  if (scope.channelId != null) {
    channelIds = [String(scope.channelId)];
  } else {
    const known = Object.keys(store.channels);
    const lookup = await fetchChannelIds(scope.groupId, scope.sectionId);
    if (scope.sectionId != null) {
      if (lookup.status === 'unavailable') {
        throw new Error(
          `Cannot resolve channels for section ${scope.sectionId}: channel list unavailable`
        );
      }
      channelIds = lookup.channelIds;
    } else {
      // Group scope covers the whole group, so the stored overrides are already
      // in scope. They are the fallback when the lookup cannot answer.
      channelIds =
        lookup.status === 'ok' && lookup.channelIds.length > 0
          ? lookup.channelIds
          : known;
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

  // Mirror a group-wide mute into the legacy `mutedGroups` key.
  //
  // Group announcements are still gated on that key in background.ts, which has
  // no access to the per-channel store, and the group context menu now writes
  // through this function instead of the old handleSetGroupMute. Without the
  // mirror, muting a group from its right-click menu left announcement
  // notifications arriving. `mutedUntil` of 0 is an explicit unmute, so the
  // group is removed again.
  //
  // ONLY "until I turn it back on" (`null`) is mirrored. That list has no end
  // time — announcements are gated on `!mutedGroups.includes(groupId)` — so a
  // timed mute written into it silenced announcements forever: once the 15
  // minutes elapsed the channels notified again but the announcement stayed
  // muted, and the group menu then offered no Unmute because the channel mutes
  // had also expired. The per-channel store already carries the end time, and
  // Q-Chat itself ignores this legacy key.
  //
  // Written before the store so the store stays the last and authoritative
  // write for this operation.
  const isGroupScope = scope.sectionId == null && scope.channelId == null;
  if (isGroupScope && settings.mutedUntil !== undefined) {
    try {
      const numericGroupId = Number(scope.groupId);
      if (Number.isFinite(numericGroupId)) {
        const raw = await window
          .sendMessage('getUserSettings', { key: OLD_MUTED_GROUPS_KEY })
          .catch(() => []);
        const list: number[] = Array.isArray(raw)
          ? raw.map((id) => Number(id)).filter((id) => Number.isFinite(id))
          : [];
        // `null` is the only indefinite mute. A number is a deadline, and
        // removing the group is also correct for one, so a timed mute clears
        // any stale entry the group may already have.
        const muted = settings.mutedUntil === null;
        const next = muted
          ? Array.from(new Set([...list, numericGroupId]))
          : list.filter((id) => id !== numericGroupId);
        if (
          next.length !== list.length ||
          next.some((id, i) => id !== list[i])
        ) {
          await writeUserSetting(OLD_MUTED_GROUPS_KEY, next);
        }
      }
    } catch (error) {
      // Best effort: the per-channel store is the source of truth for Q-Chat
      // itself. Failing to mirror must not fail the mute the user asked for.
      console.error('Failed to mirror group mute to mutedGroups:', error);
    }
  }

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
    (groupStore as GroupNotificationStoreWithDefaults | undefined)
      ?.__globalDefaults ?? (fallback as unknown as GlobalNotificationSettings);
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
  (store as GroupNotificationStoreWithDefaults).__globalDefaults = global;
  return resolveEffectiveSettings(store, channelId, fallback);
}

export interface ScopedNotificationState {
  /** The state when the channels agree, or the first channel's state otherwise. */
  settings: EffectiveNotificationSettings;
  /**
   * True when the channels in scope disagree on at least one field.
   *
   * A parent menu (group or section) has no override of its own, so the only
   * truthful thing it can display is the state of the channels inside it. When
   * those differ, no single option is correct and the menu has to say so rather
   * than picking one and looking right when it is wrong.
   */
  mixed: boolean;
  /** Fields the channels in scope disagree on. Empty when they agree. */
  mixedFields: Array<keyof EffectiveNotificationSettings>;
  /** How many channels the state was derived from. 0 means the scope is empty. */
  channelCount: number;
}

/**
 * Resolves the state of a whole scope — a group or a section — from the channels
 * inside it.
 *
 * Channels without an override resolve to the global defaults, which is exactly
 * what they will behave like, so they participate like any other channel. This
 * is the read path a parent menu needs; passing no channel id would only ever
 * return the global defaults.
 */
export function resolveScopedNotificationSettings(
  groupStore: GroupNotificationStore | undefined,
  channelIds: readonly string[],
  fallback: EffectiveNotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
): ScopedNotificationState {
  const resolved = channelIds.map((channelId) =>
    resolveEffectiveSettings(groupStore, channelId, fallback)
  );
  if (resolved.length === 0) {
    return {
      settings: resolveEffectiveSettings(groupStore, undefined, fallback),
      mixed: false,
      mixedFields: [],
      channelCount: 0,
    };
  }
  const [first, ...rest] = resolved;
  const fields: Array<keyof EffectiveNotificationSettings> = [
    'pushLevel',
    'suppressEveryoneHere',
    'notifyOnReplies',
    'notifyOnReactions',
  ];
  // Tracked per field: a group where every channel allows notifications but
  // only some notify on replies is mixed for that checkbox alone, and reporting
  // the whole menu as mixed would blank controls that are in fact settled.
  const mixedFields = fields.filter((field) =>
    rest.some((candidate) => candidate[field] !== first[field])
  );
  return {
    settings: first,
    mixed: mixedFields.length > 0,
    mixedFields,
    channelCount: resolved.length,
  };
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
  await applyScopeNotificationSettings(scope, { mutedUntil: EXPLICITLY_UNMUTED });
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

export interface MigrateNotificationSettingsResult {
  /** Groups whose channels could not be resolved; retry them later. */
  unresolvedGroupIds: string[];
  /** True when every affected group migrated and the completion flag was set. */
  complete: boolean;
}

/**
 * Migrates legacy per-group nested settings to the flat channel-override
 * model.
 *
 * Completion is only recorded when every group actually migrated. A group whose
 * channel list was unavailable keeps its legacy preferences pending and is
 * retried on the next call; previously the flag was written unconditionally, so
 * a first login that raced membership loading dropped the user's mutes and
 * disabled mentions for good.
 *
 * Old keys are left in place, which is what makes the retry possible.
 */
export async function migrateNotificationSettings(
  memberGroupIds: Array<string | number>
): Promise<MigrateNotificationSettingsResult> {
  const alreadyMigrated = await window
    .sendMessage('getUserSettings', {
      key: MIGRATION_FLAG_KEY,
    })
    .catch(() => false);
  // A completion flag from an earlier run does not stop the pass. That run may
  // have set it while some groups had no resolvable channels, leaving them with
  // no overrides at all; those groups are repaired below. Groups that were
  // migrated properly are skipped individually, so a later user change is never
  // overwritten.
  const previouslyComplete = alreadyMigrated === true;

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

  // Groups whose legacy preference needs channel IDs that could not be resolved.
  const unresolvedGroupIds: string[] = [];

  for (const groupId of memberGroupIds) {
    const legacy = await getLegacyGroupSettings(groupId);
    // Already migrated in an earlier pass, so this group's store may hold
    // choices the user made afterwards. Leave it alone.
    //
    // The per-group marker is checked unconditionally. Gating it on the global
    // flag was not enough: when any group's channel lookup fails the global flag
    // stays unset, the next pass re-enters migration for every group, and a
    // migrated group is rewritten from the stale legacy values — a channel the
    // user set back to "All messages" returns to "None". The flag says "the last
    // pass finished cleanly", which is a different question from "this group was
    // migrated", and only the marker answers the second.
    const existing = await getGroupNotificationStore(groupId);
    if (existing.legacyMigratedAt !== undefined) {
      continue;
    }
    if (previouslyComplete) {
      // Groups migrated by an earlier build carry no marker. Fall back to their
      // store being non-empty so they are not re-run once.
      if (
        Object.keys(existing.channels ?? {}).length > 0 ||
        existing.notifyOnWelcomePosts !== undefined ||
        existing.hideMutedChannels !== undefined
      ) {
        continue;
      }
    }
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
      legacyMigratedAt: Date.now(),
      channels,
    };
    if (legacy?.hideMutedChannels !== undefined) {
      store.hideMutedChannels = legacy.hideMutedChannels;
    }
    if (legacy?.notifyOnWelcomePosts !== undefined) {
      store.notifyOnWelcomePosts = legacy.notifyOnWelcomePosts;
    }

    const legacyGroupMute =
      legacy?.mutedUntil !== undefined && legacy.mutedUntil !== 0;
    const legacyGroupMentionsOff =
      wasMentionsDisabled ||
      mutedGroupIds.some((id) => String(id) === String(groupId));

    // Group-level legacy preferences need channel IDs. Resolve once, and skip
    // the whole group rather than write a partial store when the list is not
    // available: a group written with no overrides is a group whose preferences
    // were silently dropped.
    if (legacyGroupMute || legacyGroupMentionsOff) {
      const lookup = await fetchChannelIds(groupId);
      // An `ok` but empty answer is ambiguous. Main reports a membership that
      // has not been applied yet as an empty list rather than an error, and a
      // genuinely empty group looks identical. Treating it as "no channels"
      // wrote a store with no overrides and set the migration marker, so a mute
      // or a mentions-off that needed those channels was dropped and the marker
      // then stopped the retry that would have repaired it. A group-level
      // preference with nothing to write is unresolved, not done.
      const resolved =
        lookup.status === 'ok' && lookup.channelIds.length > 0
          ? lookup.channelIds
          : // Only fall back to entries this group already has. Never borrow
            // another group's channels.
            Object.keys(channels);
      const canMaterialize = resolved.length > 0;
      if (!canMaterialize) {
        unresolvedGroupIds.push(String(groupId));
        continue;
      }
      if (legacyGroupMute) {
        for (const chId of resolved) {
          channels[chId] = {
            ...channels[chId],
            mutedUntil: legacy.mutedUntil as number,
          };
        }
      }
      if (legacyGroupMentionsOff) {
        if (store.channels == null) store.channels = {};
        for (const chId of resolved) {
          store.channels[chId] = {
            ...store.channels[chId],
            pushLevel: 'none',
          };
        }
      }
    }

    await setGroupNotificationStore(groupId, store);
  }

  // Only record completion when nothing is left to retry. Writing the flag
  // unconditionally is what lost preferences for users whose first login raced
  // membership loading: the channel list was unavailable, no override was
  // written, and the flag meant it was never retried.
  const complete = unresolvedGroupIds.length === 0;
  if (complete) {
    await writeUserSetting(MIGRATION_FLAG_KEY, true);
  }

  return { unresolvedGroupIds, complete };
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
  await writeUserSetting(NOTIFICATION_DELIVERY_KEY, method);
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
