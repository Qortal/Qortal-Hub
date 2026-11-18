import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveEffectiveSettings,
  shouldFirePushNotification,
  getGlobalNotificationSettings,
  setGlobalNotificationSettings,
  getGroupNotificationStore,
  setGroupNotificationStore,
  getEffectiveNotificationSettings,
  setScopeNotificationSettings,
  applyScopeNotificationSettings,
  applyNotificationSettingsToAllGroups,
  wipeAllChannelOverrides,
  isScopeMuted,
  getScopeMutedUntil,
  setScopeMuted,
  unmuteScope,
  getHideMutedChannels,
  setHideMutedChannels,
  groupHasUnreadConsideringMute,
  getGroupUnreadCountConsideringMute,
  needsNotificationMigration,
  migrateNotificationSettings,
  addWelcomeUnreadEventId,
  removeWelcomeUnreadEventId,
  clearWelcomeUnreadForGroup,
  getWelcomeUnreadCount,
  getEffectiveUnreadCount,
  reconcileWelcomeUnreadForGroup,
  DEFAULT_NOTIFICATION_SETTINGS,
  GLOBAL_SETTINGS_KEY,
  type EffectiveNotificationSettings,
  type GroupNotificationStore,
} from './qChatNotificationSettings';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockSendMessage(map: Record<string, unknown>) {
  vi.stubGlobal('window', {
    ...window,
    sendMessage: vi.fn(async (type: string, opts: { key?: string }) => {
      if (type === 'getUserSettings' && opts?.key) {
        return map[opts.key] ?? null;
      }
      if (type === 'addUserSettings') {
        return { error: null };
      }
      return null;
    }),
  });
}

// ---------------------------------------------------------------------------
// resolveEffectiveSettings (pure)
// ---------------------------------------------------------------------------

describe('resolveEffectiveSettings', () => {
  it('returns fallback defaults when no store provided', () => {
    const result = resolveEffectiveSettings(undefined as any, undefined);
    expect(result).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('applies global defaults when present on the store', () => {
    const store: GroupNotificationStore = {
      channels: {},
      // __globalDefaults is attached by the async loader; simulate here.
    } as any;
    (store as any).__globalDefaults = {
      pushLevel: 'none',
      suppressEveryoneHere: true,
      notifyOnReplies: false,
      notifyOnReactions: false,
      version: 3,
    };
    const result = resolveEffectiveSettings(store as any, undefined);
    expect(result.pushLevel).toBe('none');
    expect(result.suppressEveryoneHere).toBe(true);
    expect(result.notifyOnReplies).toBe(false);
    expect(result.notifyOnReactions).toBe(false);
  });

  it('overlays channel override onto global defaults', () => {
    const store: GroupNotificationStore = {
      channels: {
        announcements: { pushLevel: 'all' },
      },
    } as any;
    (store as any).__globalDefaults = {
      pushLevel: 'mentions',
      suppressEveryoneHere: false,
      notifyOnReplies: true,
      notifyOnReactions: true,
      version: 1,
    };
    const result = resolveEffectiveSettings(store as any, 'announcements');
    expect(result.pushLevel).toBe('all');
    expect(result.suppressEveryoneHere).toBe(false);
    expect(result.notifyOnReplies).toBe(true);
  });

  it('channel with no override inherits global defaults', () => {
    const store: GroupNotificationStore = {
      channels: {},
    } as any;
    (store as any).__globalDefaults = {
      pushLevel: 'none',
      suppressEveryoneHere: false,
      notifyOnReplies: true,
      notifyOnReactions: true,
      version: 1,
    };
    const result = resolveEffectiveSettings(store as any, 'some-channel');
    expect(result.pushLevel).toBe('none');
  });

  it('uses group notifyOnWelcomePosts when present', () => {
    const store: GroupNotificationStore = {
      notifyOnWelcomePosts: false,
      channels: {},
    } as any;
    const result = resolveEffectiveSettings(store as any, undefined);
    expect(result.notifyOnWelcomePosts).toBe(false);
  });

  it('falls back to fallback.notifyOnWelcomePosts when store has none', () => {
    const store: GroupNotificationStore = { channels: {} } as any;
    const result = resolveEffectiveSettings(store as any, undefined, {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      notifyOnWelcomePosts: false,
    });
    expect(result.notifyOnWelcomePosts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Global defaults persistence
// ---------------------------------------------------------------------------

describe('getGlobalNotificationSettings', () => {
  it('returns defaults when no global settings stored', async () => {
    mockSendMessage({});
    const result = await getGlobalNotificationSettings();
    expect(result.pushLevel).toBe('mentions');
    expect(result.suppressEveryoneHere).toBe(false);
    expect(result.notifyOnReplies).toBe(true);
    expect(result.notifyOnReactions).toBe(true);
    expect(result.version).toBe(1);
  });

  it('returns stored global settings', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'none',
        suppressEveryoneHere: true,
        notifyOnReplies: false,
        notifyOnReactions: true,
        version: 5,
      },
    });
    const result = await getGlobalNotificationSettings();
    expect(result.pushLevel).toBe('none');
    expect(result.suppressEveryoneHere).toBe(true);
    expect(result.notifyOnReplies).toBe(false);
    expect(result.version).toBe(5);
  });

  it('defaults missing fields', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: { pushLevel: 'all' },
    });
    const result = await getGlobalNotificationSettings();
    expect(result.pushLevel).toBe('all');
    expect(result.suppressEveryoneHere).toBe(false);
    expect(result.notifyOnReplies).toBe(true);
    expect(result.notifyOnReactions).toBe(true);
    expect(result.version).toBe(1);
  });
});

describe('setGlobalNotificationSettings', () => {
  it('persists partial over current values and increments version', async () => {
    const map: Record<string, unknown> = {
      [GLOBAL_SETTINGS_KEY]: { pushLevel: 'mentions', version: 2 },
    };
    mockSendMessage(map);
    const result = await setGlobalNotificationSettings({ pushLevel: 'none' });
    expect(result.pushLevel).toBe('none');
    expect(result.version).toBe(3);
    // addUserSettings captured the merged object.
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue.value;
    expect(stored.pushLevel).toBe('none');
    expect(stored.suppressEveryoneHere).toBe(false);
    expect(stored.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Group store persistence
// ---------------------------------------------------------------------------

describe('getGroupNotificationStore', () => {
  it('returns empty channels store when nothing stored', async () => {
    mockSendMessage({});
    const result = await getGroupNotificationStore(456);
    expect(result).toEqual({ channels: {} });
  });

  it('returns stored store', async () => {
    mockSendMessage({
      'q-chat-notif-456': {
        notifyOnWelcomePosts: false,
        hideMutedChannels: true,
        channels: { 'ch-1': { pushLevel: 'none' } },
      },
    });
    const result = await getGroupNotificationStore(456);
    expect(result.hideMutedChannels).toBe(true);
    expect(result.channels['ch-1'].pushLevel).toBe('none');
  });
});

describe('setGroupNotificationStore', () => {
  it('writes store via addUserSettings', async () => {
    mockSendMessage({});
    const store: GroupNotificationStore = {
      channels: { 'ch-1': { mutedUntil: null } },
    };
    await setGroupNotificationStore(789, store);
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][1].keyValue.key).toBe('q-chat-notif-789');
  });
});

// ---------------------------------------------------------------------------
// Scope application (parent always overwrites children)
// ---------------------------------------------------------------------------

describe('applyScopeNotificationSettings / setScopeNotificationSettings', () => {
  it('group-scope write materializes into all channels, deleting entries that match global defaults', async () => {
    // Global defaults: pushLevel mentions, suppressEveryoneHere false.
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
    });
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => [
        { channelId: 'general', categoryId: '' },
        { channelId: 'random', categoryId: '' },
      ]),
    };

    await setScopeNotificationSettings({ groupId: 123 }, { pushLevel: 'none' });

    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    // Both channels get pushLevel none because it differs from global 'mentions'.
    expect(stored.channels['general']?.pushLevel).toBe('none');
    expect(stored.channels['random']?.pushLevel).toBe('none');
  });

  it('writes suppressEveryoneHere to all channels in scope', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
    });
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => [
        { channelId: 'general', categoryId: '' },
        { channelId: 'random', categoryId: '' },
      ]),
    };

    await setScopeNotificationSettings(
      { groupId: 1 },
      { suppressEveryoneHere: true }
    );

    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['general']?.suppressEveryoneHere).toBe(true);
    expect(stored.channels['random']?.suppressEveryoneHere).toBe(true);
  });

  it('deletes channel entry when settings match global defaults', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
      'q-chat-notif-1': {
        channels: {
          general: { pushLevel: 'none' },
          random: { pushLevel: 'mentions' },
        },
      },
    });
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => [
        { channelId: 'general', categoryId: '' },
        { channelId: 'random', categoryId: '' },
      ]),
    };

    // Apply pushLevel 'mentions' (matches global default) to the group.
    await setScopeNotificationSettings(
      { groupId: 1 },
      { pushLevel: 'mentions' }
    );

    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['general']).toBeUndefined();
    expect(stored.channels['random']).toBeUndefined();
  });

  it('section-scope writes affect only channels in that section', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
    });
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => [
        { channelId: 'general', categoryId: 'sec-1' },
        { channelId: 'support', categoryId: 'sec-1' },
        { channelId: 'offtopic', categoryId: 'sec-2' },
      ]),
    };

    await setScopeNotificationSettings(
      { groupId: 9, sectionId: 'sec-1' },
      { pushLevel: 'all' }
    );

    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['general']?.pushLevel).toBe('all');
    expect(stored.channels['support']?.pushLevel).toBe('all');
    expect(stored.channels['offtopic']).toBeUndefined();
  });

  it('channel-scope write affects only that channel', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
      'q-chat-notif-9': {
        channels: { 'ch-1': { pushLevel: 'all' }, 'ch-2': {} },
      },
    });

    await setScopeNotificationSettings(
      { groupId: 9, sectionId: 'sec-1', channelId: 'ch-1' },
      { pushLevel: 'none' }
    );

    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['ch-1']?.pushLevel).toBe('none');
    // ch-2 was empty; it stays absent.
    expect(stored.channels['ch-2']).toBeUndefined();
  });

  it('writes group-only fields when scope is group-wide', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
    });
    await applyScopeNotificationSettings(
      { groupId: 4 },
      { notifyOnWelcomePosts: false, hideMutedChannels: true }
    );
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.notifyOnWelcomePosts).toBe(false);
    expect(stored.hideMutedChannels).toBe(true);
  });
});

describe('applyNotificationSettingsToAllGroups', () => {
  it('applies settings to all provided groups', async () => {
    mockSendMessage({});
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => []),
    };
    await applyNotificationSettingsToAllGroups([1, 2, 3], {
      pushLevel: 'none',
    });
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const keys = calls.map((c: any[]) => c[1].keyValue.key);
    expect(keys).toContain('q-chat-notif-1');
    expect(keys).toContain('q-chat-notif-2');
    expect(keys).toContain('q-chat-notif-3');
  });

  it('handles empty group list without error', async () => {
    mockSendMessage({});
    await expect(
      applyNotificationSettingsToAllGroups([], {})
    ).resolves.toBeUndefined();
  });
});

describe('wipeAllChannelOverrides', () => {
  const storedChannels = (): GroupNotificationStore[] =>
    (window.sendMessage as any).mock.calls
      .filter((c: any[]) => c[0] === 'addUserSettings')
      .map((c: any[]) => c[1].keyValue.value as GroupNotificationStore);

  it('clears diff overrides for the given groups', async () => {
    mockSendMessage({
      'q-chat-notif-1': { channels: { general: { pushLevel: 'none' } } },
      'q-chat-notif-2': { channels: { random: { pushLevel: 'mentions' } } },
    });
    await wipeAllChannelOverrides([1, 2]);
    for (const stored of storedChannels()) {
      expect(Object.keys(stored.channels).length).toBe(0);
    }
  });

  it('preserves channel mutes when global settings change', async () => {
    // Regression: changing global notification settings unmuted every channel
    // because the implementation cleared the whole `channels` map. Mute is
    // explicit user intent for one channel, not a diff against the defaults.
    const mutedUntil = Date.now() + 60 * 60 * 1000;
    mockSendMessage({
      'q-chat-notif-1': {
        channels: {
          general: { mutedUntil },
          random: { mutedUntil: null },
        },
      },
    });
    await wipeAllChannelOverrides([1]);

    const [stored] = storedChannels();
    expect(stored.channels.general?.mutedUntil).toBe(mutedUntil);
    expect(stored.channels.random?.mutedUntil).toBeNull();
  });

  it('drops diff fields but keeps the mute on the same channel', async () => {
    const mutedUntil = Date.now() + 60 * 60 * 1000;
    mockSendMessage({
      'q-chat-notif-1': {
        channels: {
          general: {
            mutedUntil,
            pushLevel: 'none',
            notifyOnReplies: false,
            notifyOnReactions: false,
            suppressEveryoneHere: true,
          },
        },
      },
    });
    await wipeAllChannelOverrides([1]);

    const [stored] = storedChannels();
    expect(stored.channels.general).toEqual({ mutedUntil });
  });

  it('drops an explicit unmute marker of 0', async () => {
    mockSendMessage({
      'q-chat-notif-1': { channels: { general: { mutedUntil: 0 } } },
    });
    await wipeAllChannelOverrides([1]);
    const [stored] = storedChannels();
    expect(stored.channels.general).toBeUndefined();
  });

  it('records the new global version after clearing', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'all',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 7,
      },
      'q-chat-notif-1': { channels: { general: { pushLevel: 'none' } } },
    });
    await wipeAllChannelOverrides([1]);
    const [stored] = storedChannels();
    expect(stored.globalVersion).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Effective settings (async)
// ---------------------------------------------------------------------------

describe('getEffectiveNotificationSettings', () => {
  it('returns global defaults when no channel override stored', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'none',
        suppressEveryoneHere: true,
        notifyOnReplies: false,
        notifyOnReactions: false,
        version: 2,
      },
    });
    const result = await getEffectiveNotificationSettings(
      123,
      undefined,
      'ch-1'
    );
    expect(result.pushLevel).toBe('none');
    expect(result.suppressEveryoneHere).toBe(true);
    expect(result.notifyOnReplies).toBe(false);
  });

  it('applies channel override onto global defaults', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: {
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
        version: 1,
      },
      'q-chat-notif-123': {
        channels: { 'ch-1': { pushLevel: 'all' } },
      },
    });
    const result = await getEffectiveNotificationSettings(
      123,
      undefined,
      'ch-1'
    );
    expect(result.pushLevel).toBe('all');
  });

  it('uses DEFAULT_NOTIFICATION_SETTINGS when no global stored', async () => {
    mockSendMessage({});
    const result = await getEffectiveNotificationSettings(
      123,
      undefined,
      'ch-1'
    );
    expect(result.pushLevel).toBe('mentions');
    expect(result.notifyOnReplies).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mute helpers (flat model)
// ---------------------------------------------------------------------------

describe('isScopeMuted', () => {
  it('returns false when no mutedUntil set at any level', () => {
    const settings: GroupNotificationStore = { channels: {} };
    expect(isScopeMuted(settings, undefined, 'ch-1')).toBe(false);
  });

  it('returns true when channel mute is active with future timestamp', () => {
    const settings: GroupNotificationStore = {
      channels: { 'ch-1': { mutedUntil: Date.now() + 60_000 } },
    };
    expect(isScopeMuted(settings, undefined, 'ch-1')).toBe(true);
  });

  it('returns true when channel is muted indefinitely (null)', () => {
    const settings: GroupNotificationStore = {
      channels: { 'ch-1': { mutedUntil: null } },
    };
    expect(isScopeMuted(settings, undefined, 'ch-1')).toBe(true);
  });

  it('returns false when channel mute has expired', () => {
    const settings: GroupNotificationStore = {
      channels: { 'ch-1': { mutedUntil: Date.now() - 60_000 } },
    };
    expect(isScopeMuted(settings, undefined, 'ch-1')).toBe(false);
  });

  it('channel without an entry is not muted', () => {
    const settings: GroupNotificationStore = {
      channels: { 'ch-1': { mutedUntil: null } },
    };
    expect(isScopeMuted(settings, undefined, 'ch-2')).toBe(false);
  });
});

describe('getScopeMutedUntil', () => {
  it('returns undefined when no channel', () => {
    const settings: GroupNotificationStore = { channels: {} };
    expect(getScopeMutedUntil(settings, undefined, 'ch-1')).toBeUndefined();
  });

  it('returns stored value', () => {
    const settings: GroupNotificationStore = {
      channels: { 'ch-1': { mutedUntil: null } },
    };
    expect(getScopeMutedUntil(settings, undefined, 'ch-1')).toBeNull();
  });
});

describe('setScopeMuted / unmuteScope', () => {
  it('writes mutedUntil on all channels for group scope', async () => {
    mockSendMessage({});
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => [
        { channelId: 'general', categoryId: '' },
        { channelId: 'random', categoryId: '' },
      ]),
    };
    const ts = Date.now() + 60_000;
    await setScopeMuted({ groupId: 123 }, ts);
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['general']?.mutedUntil).toBe(ts);
    expect(stored.channels['random']?.mutedUntil).toBe(ts);
  });

  it('writes mutedUntil on all channels in section for section scope', async () => {
    mockSendMessage({});
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => [
        { channelId: 'support', categoryId: 'sec-1' },
        { channelId: 'offtopic', categoryId: 'sec-1' },
        { channelId: 'general', categoryId: 'sec-2' },
      ]),
    };
    await setScopeMuted({ groupId: 123, sectionId: 'sec-1' }, null);
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['support']?.mutedUntil).toBeNull();
    expect(stored.channels['offtopic']?.mutedUntil).toBeNull();
    expect(stored.channels['general']?.mutedUntil).toBeUndefined();
  });

  it('writes mutedUntil at channel level', async () => {
    mockSendMessage({});
    const ts = Date.now() + 60_000;
    await setScopeMuted(
      { groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' },
      ts
    );
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.channels['ch-1']?.mutedUntil).toBe(ts);
  });

  it('unmuteScope clears mutedUntil at channel level', async () => {
    mockSendMessage({});
    await unmuteScope({ groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' });
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    // 0 = explicitly unmuted = treated as "no override" and pruned.
    expect(stored.channels['ch-1']?.mutedUntil).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group-only settings accessors
// ---------------------------------------------------------------------------

describe('getHideMutedChannels / setHideMutedChannels', () => {
  it('reads hideMutedChannels from store', async () => {
    mockSendMessage({
      'q-chat-notif-123': { hideMutedChannels: true, channels: {} },
    });
    expect(await getHideMutedChannels(123)).toBe(true);
  });

  it('writes hideMutedChannels preserving channels', async () => {
    mockSendMessage({
      'q-chat-notif-123': { channels: { 'ch-1': { pushLevel: 'none' } } },
    });
    await setHideMutedChannels(123, true);
    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls[calls.length - 1][1].keyValue
      .value as GroupNotificationStore;
    expect(stored.hideMutedChannels).toBe(true);
    expect(stored.channels['ch-1']?.pushLevel).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Unread-count helpers (flat model)
// ---------------------------------------------------------------------------

describe('groupHasUnreadConsideringMute', () => {
  it('returns true when group is not muted and has unread', () => {
    const settings: GroupNotificationStore = { channels: {} };
    const summary = { unreadCount: 5, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('returns false when group is not muted and no unread', () => {
    const settings: GroupNotificationStore = { channels: {} };
    const summary = { unreadCount: 0, mentionCount: 0 };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns false when all channels with unread are muted', () => {
    const settings: GroupNotificationStore = {
      channels: {
        general: { mutedUntil: null },
        random: { mutedUntil: null },
      },
    };
    const summary = {
      channels: [
        { channelId: 'general', unreadCount: 3, mentionCount: 0 },
        { channelId: 'random', unreadCount: 2, mentionCount: 0 },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });

  it('returns true when unmuted channel has mention', () => {
    const settings: GroupNotificationStore = {
      channels: {
        general: { mutedUntil: null },
        random: {},
      },
    };
    const summary = {
      channels: [
        { channelId: 'general', unreadCount: 3, mentionCount: 0 },
        { channelId: 'random', unreadCount: 0, mentionCount: 1 },
      ],
    };
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });
});

describe('getGroupUnreadCountConsideringMute', () => {
  it('returns 0 when all channels are muted', () => {
    const settings: GroupNotificationStore = {
      channels: {
        general: { mutedUntil: null },
        random: { mutedUntil: null },
      },
    };
    const summary = {
      channels: [
        { channelId: 'general', unreadCount: 3, mentionCount: 0 },
        { channelId: 'random', unreadCount: 2, mentionCount: 0 },
      ],
    };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(0);
  });

  it('returns sum across mixed muted/unmuted channels', () => {
    const settings: GroupNotificationStore = {
      channels: {
        general: {},
        random: { mutedUntil: null },
      },
    };
    const summary = {
      channels: [
        { channelId: 'general', unreadCount: 3, mentionCount: 0 },
        { channelId: 'random', unreadCount: 2, mentionCount: 0 },
      ],
    };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(3);
  });

  it('falls back to aggregate count when no per-channel data', () => {
    const settings: GroupNotificationStore = { channels: {} };
    const summary = { unreadCount: 7, mentionCount: 3 };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(7);
  });

  // A `mutedUntil` key outlives the mute it recorded: it becomes an expired
  // timestamp once the mute lapses, or 0 on an explicit unmute. Treating any
  // key as "muted" made the group report zero unread with no channel breakdown
  // available, so its red dot vanished while messages were unread.
  it('does not treat an expired mute as muting the group', () => {
    const settings: GroupNotificationStore = {
      channels: { general: { mutedUntil: Date.now() - 60_000 } },
    };
    const summary = { unreadCount: 4, mentionCount: 0 };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(4);
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('does not treat an explicit unmute (0) as muting the group', () => {
    const settings: GroupNotificationStore = {
      channels: { general: { mutedUntil: 0 } },
    };
    const summary = { unreadCount: 4, mentionCount: 0 };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(4);
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(true);
  });

  it('does not treat a non-mute channel override as muting the group', () => {
    const settings: GroupNotificationStore = {
      channels: { general: { pushLevel: 'all' as const } },
    };
    const summary = { unreadCount: 4, mentionCount: 0 };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(4);
  });

  it('still reports zero for a group-wide mute with no channel breakdown', () => {
    // A group-wide mute is stored as the same active mute written to every
    // known channel, so every entry being actively muted is the shape that
    // legitimately means "this group is muted".
    const settings: GroupNotificationStore = {
      channels: {
        general: { mutedUntil: null },
        random: { mutedUntil: null },
      },
    };
    const summary = { unreadCount: 4, mentionCount: 0 };
    expect(getGroupUnreadCountConsideringMute(settings, summary)).toBe(0);
    expect(groupHasUnreadConsideringMute(settings, summary)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('needsNotificationMigration', () => {
  it('returns true when global key absent', async () => {
    mockSendMessage({});
    expect(await needsNotificationMigration()).toBe(true);
  });

  it('returns false when global key present', async () => {
    mockSendMessage({
      [GLOBAL_SETTINGS_KEY]: { pushLevel: 'mentions', version: 1 },
    });
    expect(await needsNotificationMigration()).toBe(false);
  });
});

describe('migrateNotificationSettings', () => {
  it('writes new keys and preserves group-only fields', async () => {
    const map: Record<string, unknown> = {
      'q-chat-notification-settings-migrated': false,
      'q-chat-notification-settings-1': {
        notifyOnWelcomePosts: false,
        hideMutedChannels: true,
        sections: {
          '': { channels: { general: { mutedUntil: null } } },
        },
      },
    };
    mockSendMessage(map);
    (window as any).reticulumChat = {
      getChannels: vi.fn(async () => []),
    };
    await migrateNotificationSettings([1]);

    const calls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    const stored = calls.find(
      (c: any[]) => c[1]?.keyValue?.key === 'q-chat-notif-1'
    )?.[1]?.keyValue?.value as GroupNotificationStore;
    expect(stored).toBeTruthy();
    expect(stored.notifyOnWelcomePosts).toBe(false);
    expect(stored.hideMutedChannels).toBe(true);
    expect(stored.channels['general']?.mutedUntil).toBeNull();
  });

  it('skips when already migrated', async () => {
    mockSendMessage({ 'q-chat-notification-settings-migrated': true });
    await migrateNotificationSettings([1, 2]);
    const addCalls = (window.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0] === 'addUserSettings'
    );
    expect(addCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Push decision helpers (unchanged)
// ---------------------------------------------------------------------------

describe('shouldFirePushNotification', () => {
  it('fires for any message when pushLevel is all', () => {
    const effective: EffectiveNotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      pushLevel: 'all',
    };
    expect(shouldFirePushNotification(effective, false, false, false)).toBe(
      true
    );
  });

  it('fires for mention when pushLevel is mentions', () => {
    const effective: EffectiveNotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      pushLevel: 'mentions',
    };
    expect(shouldFirePushNotification(effective, true, false, false)).toBe(
      true
    );
  });

  it('suppresses everyone/here mention when suppressEveryoneHere', () => {
    const effective: EffectiveNotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      pushLevel: 'mentions',
      suppressEveryoneHere: true,
    };
    expect(shouldFirePushNotification(effective, true, true, false)).toBe(
      false
    );
  });

  it('fires for reply when notifyOnReplies', () => {
    const effective: EffectiveNotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      pushLevel: 'none',
      notifyOnReplies: true,
    };
    expect(shouldFirePushNotification(effective, false, false, true)).toBe(
      true
    );
  });

  it('fires for reaction when notifyOnReactions', () => {
    const effective: EffectiveNotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      pushLevel: 'none',
      notifyOnReactions: true,
    };
    expect(
      shouldFirePushNotification(effective, false, false, false, true)
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Welcome-post unread helpers
// ---------------------------------------------------------------------------

describe('welcome unread helpers', () => {
  it('addWelcomeUnreadEventId adds and dedupes', () => {
    const m1 = addWelcomeUnreadEventId({}, '1', 'evt-1');
    expect(m1['1']?.has('evt-1')).toBe(true);
    const m2 = addWelcomeUnreadEventId(m1, '1', 'evt-1');
    expect(m2['1']?.size).toBe(1);
  });

  it('removeWelcomeUnreadEventId removes', () => {
    const m1 = addWelcomeUnreadEventId({}, '1', 'evt-1');
    const m2 = removeWelcomeUnreadEventId(m1, '1', 'evt-1');
    // When the set becomes empty the key is dropped entirely.
    expect(m2['1']).toBeUndefined();
  });

  it('clearWelcomeUnreadForGroup clears', () => {
    const m1 = addWelcomeUnreadEventId({}, '1', 'evt-1');
    const m2 = clearWelcomeUnreadForGroup(m1, '1');
    expect(m2['1']).toBeUndefined();
  });

  it('getWelcomeUnreadCount counts', () => {
    const m1 = addWelcomeUnreadEventId(
      addWelcomeUnreadEventId({}, '1', 'a'),
      '1',
      'b'
    );
    expect(getWelcomeUnreadCount(m1, '1')).toBe(2);
    expect(getWelcomeUnreadCount(undefined, '1')).toBe(0);
  });

  it('getEffectiveUnreadCount subtracts welcome count when suppressed', () => {
    expect(
      getEffectiveUnreadCount({ unreadCount: 5, mentionCount: 2 }, false, 3)
    ).toBe(4);
    expect(
      getEffectiveUnreadCount({ unreadCount: 5, mentionCount: 2 }, true, 3)
    ).toBe(7);
  });

  it('getEffectiveUnreadCount ignores a welcome count larger than the total', () => {
    // A stale set must not be able to subtract real unread away.
    expect(
      getEffectiveUnreadCount({ unreadCount: 3, mentionCount: 0 }, false, 9)
    ).toBe(3);
  });

  it('reconcileWelcomeUnreadForGroup drops entries beyond the unread total', () => {
    const map = {
      '1': new Set(['a', 'b', 'c', 'd', 'e']),
    };
    const reconciled = reconcileWelcomeUnreadForGroup(map, '1', 3);
    expect(reconciled['1']?.size).toBe(3);
    // The oldest insertions are dropped; the newest are kept.
    expect([...reconciled['1']]).toEqual(['c', 'd', 'e']);
  });

  it('reconcileWelcomeUnreadForGroup leaves a consistent set untouched', () => {
    const map = { '1': new Set(['a', 'b']) };
    // Same reference: no spurious state write on every summaries refresh.
    expect(reconcileWelcomeUnreadForGroup(map, '1', 2)).toBe(map);
    expect(reconcileWelcomeUnreadForGroup(map, '1', 5)).toBe(map);
  });

  it('reconcileWelcomeUnreadForGroup clears the key at zero unread', () => {
    const map = { '1': new Set(['a', 'b']) };
    const reconciled = reconcileWelcomeUnreadForGroup(map, '1', 0);
    expect(reconciled['1']).toBeUndefined();
  });

  it('reconcileWelcomeUnreadForGroup ignores unknown groups', () => {
    const map = { '1': new Set(['a']) };
    expect(reconcileWelcomeUnreadForGroup(map, '2', 0)).toBe(map);
  });
});

describe('welcome subtraction is bounded by real unread', () => {
  const fallback: EffectiveNotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    notifyOnWelcomePosts: false,
  };
  const groupStore: GroupNotificationStore = { channels: {} };
  const summary = {
    unreadCount: 3,
    mentionCount: 0,
    channels: [{ channelId: 'general', unreadCount: 3, mentionCount: 0 }],
  };

  it('groupHasUnreadConsideringMute ignores an inflated welcome count', () => {
    expect(
      groupHasUnreadConsideringMute(groupStore, summary, 9, fallback)
    ).toBe(true);
  });

  it('getGroupUnreadCountConsideringMute ignores an inflated welcome count', () => {
    expect(
      getGroupUnreadCountConsideringMute(groupStore, summary, 9, fallback)
    ).toBe(3);
  });

  it('does not subtract a welcome count equal to the unread total', () => {
    // Equal counts are ambiguous: the set cannot be told apart from one that
    // has absorbed already-read welcome posts, which would cancel a real
    // message. Erring toward showing the dot, so the group still reports unread.
    expect(
      groupHasUnreadConsideringMute(groupStore, summary, 3, fallback)
    ).toBe(true);
    expect(
      getGroupUnreadCountConsideringMute(groupStore, summary, 3, fallback)
    ).toBe(3);
  });

  it('still subtracts a welcome count below the unread total', () => {
    expect(
      getGroupUnreadCountConsideringMute(groupStore, summary, 1, fallback)
    ).toBe(2);
  });
});
