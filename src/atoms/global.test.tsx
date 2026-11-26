import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import {
  groupChatHasUnreadAtom,
  memberGroupsAtom,
  memberGroupsWithReticulumChatAtom,
  reticulumChatSummariesAtom,
  reticulumChatEnabledAtom,
  userInfoAtom,
  notificationSettingsCacheAtom,
  muteExpiryTickAtom,
  groupChatTimestampsAtom,
  timestampEnterDataAtom,
  globalNotificationFormAtom,
  DEFAULT_GLOBAL_NOTIF_FORM,
  groupJoinBumpTimestampsAtom,
} from './global';
import {
  type GroupNotificationStore,
  groupHasUnreadConsideringMute,
  getGroupUnreadCountConsideringMute,
} from '../utils/qChatNotificationSettings';

function setupStore(overrides: {
  groups?: any[];
  muteCache?: Record<string, GroupNotificationStore>;
  myAddress?: string;
  reticulumChatEnabled?: boolean;
}) {
  const store = createStore();
  store.set(memberGroupsAtom, overrides.groups ?? []);
  // Set to null so memberGroupsWithReticulumChatAtom returns groups as-is
  store.set(reticulumChatSummariesAtom, null as any);
  store.set(reticulumChatEnabledAtom, overrides.reticulumChatEnabled ?? true);
  store.set(userInfoAtom, { address: overrides.myAddress ?? 'test-address' });
  store.set(notificationSettingsCacheAtom, overrides.muteCache ?? {});
  store.set(muteExpiryTickAtom, 0);
  store.set(groupChatTimestampsAtom, {});
  store.set(timestampEnterDataAtom, {});
  return store;
}

function renderHookWithStore(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => useAtomValue(groupChatHasUnreadAtom), { wrapper });
}

// Need to import useAtomValue
import { useAtomValue } from 'jotai';

describe('groupChatHasUnreadAtom', () => {
  it('returns false when no groups', () => {
    const store = setupStore({ groups: [] });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when group has unread and is not muted', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
      ],
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when group is muted', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [
              { channelId: 'general', unreadCount: 5, mentionCount: 0 },
            ],
          },
        },
      ],
      muteCache: {
        '1': {
          channels: { general: { mutedUntil: null } },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when expired mute', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
      ],
      muteCache: {
        '1': { mutedUntil: Date.now() - 60000 },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns true when one group muted but another has unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: { unreadCount: 5, mentionCount: 0 },
        },
        {
          groupId: '2',
          reticulumChatSummary: { unreadCount: 3, mentionCount: 0 },
        },
      ],
      muteCache: {
        '1': { mutedUntil: null },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('skips group 0 (General)', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '0',
          reticulumChatSummary: { unreadCount: 99, mentionCount: 0 },
        },
      ],
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when group is muted but has unmuted channel with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 3, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when group is muted and unmuted channel has no unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [
              { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
              { channelId: 'ch-2', unreadCount: 5, mentionCount: 0 },
            ],
          },
        },
      ],
      muteCache: {
        '1': {
          channels: {
            'ch-1': { mutedUntil: 0 },
            'ch-2': { mutedUntil: null },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when non-muted group has non-muted channel with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {},
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when non-muted group has only muted channels with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when non-muted group has mixed muted and non-muted channels with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 8,
            mentionCount: 0,
            channels: [
              { channelId: 'ch-1', unreadCount: 3, mentionCount: 0 },
              { channelId: 'ch-2', unreadCount: 5, mentionCount: 0 },
            ],
          },
        },
      ],
      muteCache: {
        '1': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });

  it('returns false when muted group has no unmuted channels with unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }],
          },
        },
      ],
      muteCache: {
        '1': {
          channels: {
            'ch-1': { mutedUntil: null },
          },
        },
      },
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(false);
  });

  it('returns true when non-muted group has empty channels array with aggregate unread', () => {
    const store = setupStore({
      groups: [
        {
          groupId: '1',
          reticulumChatSummary: {
            unreadCount: 5,
            mentionCount: 0,
            channels: [],
          },
        },
      ],
    });
    const { result } = renderHookWithStore(store);
    expect(result.current).toBe(true);
  });
});

describe('groupHasUnreadConsideringMute with globalNotificationFormAtom fallback', () => {
  /**
   * A welcome set equal to the unread total is ambiguous — it cannot be told
   * apart from a set that has absorbed already-read welcome posts — so it is no
   * longer subtracted. The boolean therefore no longer hides a group whose only
   * unread posts are welcome posts; it errs toward showing the dot. The count
   * helper still reflects the setting, which is what the companion test below
   * pins.
   */
  it('uncustomized group unread dot stays visible when the welcome set is ambiguous', () => {
    const store = createStore();
    store.set(memberGroupsAtom, []);
    store.set(reticulumChatSummariesAtom, null as any);
    store.set(reticulumChatEnabledAtom, true);
    store.set(userInfoAtom, { address: 'test-address' });
    store.set(notificationSettingsCacheAtom, { '1': {} });
    store.set(muteExpiryTickAtom, 0);
    store.set(groupChatTimestampsAtom, {});
    store.set(timestampEnterDataAtom, {});
    store.set(globalNotificationFormAtom, {
      ...DEFAULT_GLOBAL_NOTIF_FORM,
      notifyOnWelcomePosts: false,
    });

    const globalForm = store.get(globalNotificationFormAtom);
    const groupSettings: GroupNotificationStore = { channels: {} };
    const summary = { unreadCount: 1, mentionCount: 0 };

    // Welcome set equals the unread total -> ambiguous -> not subtracted.
    expect(
      groupHasUnreadConsideringMute(groupSettings, summary, 1, globalForm)
    ).toBe(true);

    // But the global setting still applies when the set is unambiguously
    // smaller than the unread total: 3 unread, 1 welcome post -> 2 remain.
    expect(
      getGroupUnreadCountConsideringMute(
        groupSettings,
        { unreadCount: 3, mentionCount: 0 },
        1,
        globalForm
      )
    ).toBe(2);
  });

  it('uncustomized group unread dot reflects global notifyOnWelcomePosts=true', () => {
    const store = createStore();
    store.set(memberGroupsAtom, []);
    store.set(reticulumChatSummariesAtom, null as any);
    store.set(reticulumChatEnabledAtom, true);
    store.set(userInfoAtom, { address: 'test-address' });
    store.set(notificationSettingsCacheAtom, { '1': {} });
    store.set(muteExpiryTickAtom, 0);
    store.set(groupChatTimestampsAtom, {});
    store.set(timestampEnterDataAtom, {});
    store.set(globalNotificationFormAtom, {
      ...DEFAULT_GLOBAL_NOTIF_FORM,
      notifyOnWelcomePosts: true,
    });

    const globalForm = store.get(globalNotificationFormAtom);
    const groupSettings: GroupNotificationStore = { channels: {} };
    const summary = { unreadCount: 1, mentionCount: 0 };

    expect(
      groupHasUnreadConsideringMute(groupSettings, summary, 1, globalForm)
    ).toBe(true);
  });
});

describe('memberGroupsWithReticulumChatAtom — join bump', () => {
  function setupBumpStore(
    groups: any[],
    bumpTimestamps: Record<string, number> = {},
    reticulumChatEnabled = false
  ) {
    const store = createStore();
    store.set(memberGroupsAtom, groups);
    store.set(reticulumChatSummariesAtom, {} as any);
    store.set(reticulumChatEnabledAtom, reticulumChatEnabled);
    store.set(userInfoAtom, { address: 'test-address' });
    store.set(notificationSettingsCacheAtom, {});
    store.set(muteExpiryTickAtom, 0);
    store.set(groupChatTimestampsAtom, {});
    store.set(timestampEnterDataAtom, {});
    store.set(groupJoinBumpTimestampsAtom, bumpTimestamps);
    return store;
  }

  it('bumps a group with timestamp 0 to the top when it has a join bump', () => {
    const store = setupBumpStore(
      [
        { groupId: '1', groupName: 'Alpha', timestamp: 1000 },
        { groupId: '2', groupName: 'Beta', timestamp: 0 },
      ],
      { '2': 9999 }
    );
    const result = store.get(memberGroupsWithReticulumChatAtom);
    expect(String(result[0].groupId)).toBe('2');
    expect(String(result[1].groupId)).toBe('1');
  });

  it('does not bump when no join bump timestamp is set', () => {
    const store = setupBumpStore([
      { groupId: '1', groupName: 'Alpha', timestamp: 1000 },
      { groupId: '2', groupName: 'Beta', timestamp: 0 },
    ]);
    const result = store.get(memberGroupsWithReticulumChatAtom);
    expect(String(result[0].groupId)).toBe('1');
    expect(String(result[1].groupId)).toBe('2');
  });

  it('a group with a real message timestamp newer than the bump sorts above the bump', () => {
    const store = setupBumpStore(
      [
        { groupId: '1', groupName: 'Alpha', timestamp: 20000 },
        { groupId: '2', groupName: 'Beta', timestamp: 0 },
      ],
      { '2': 9999 }
    );
    const result = store.get(memberGroupsWithReticulumChatAtom);
    expect(String(result[0].groupId)).toBe('1');
    expect(String(result[1].groupId)).toBe('2');
  });

  it('General group (id 0) is not affected by bump', () => {
    const store = setupBumpStore(
      [{ groupId: '0', groupName: 'General', timestamp: 0 }],
      { '0': 9999 }
    );
    const result = store.get(memberGroupsWithReticulumChatAtom);
    expect(String(result[0].groupId)).toBe('0');
  });

  it('reticulum enabled but no summaries — sorts by core timestamp, not alphabetically', () => {
    const store = setupBumpStore(
      [
        { groupId: '1', groupName: 'Zebra', timestamp: 100 },
        { groupId: '2', groupName: 'Alpha', timestamp: 500 },
        { groupId: '3', groupName: 'Middle', timestamp: 300 },
      ],
      {},
      true
    );
    const result = store.get(memberGroupsWithReticulumChatAtom);
    expect(String(result[0].groupId)).toBe('2');
    expect(String(result[1].groupId)).toBe('3');
    expect(String(result[2].groupId)).toBe('1');
  });
});
