import { describe, expect, it } from 'vitest';
import {
  NOT_VIEWING_VIEW_CONTEXT,
  getReticulumChannelDismissalTarget,
  getReticulumViewChannelPayload,
} from './reticulumChannelDismissal';
import { shouldSuppressForViewedChannel } from '../../utils/qChatViewContextSuppression';

const base = {
  reticulumChatEnabled: true,
  isActive: true,
  selectedGroup: '7',
  selectedChannelId: 'general',
};

describe('getReticulumChannelDismissalTarget', () => {
  it('targets the selected group and channel', () => {
    expect(getReticulumChannelDismissalTarget(base)).toEqual({
      groupId: 7,
      channelId: 'general',
    });
  });

  it('is independent of unread count, deferral, and loaded events', () => {
    // The bug: dismissal used to sit behind the read effect's early returns, so
    // a channel with no unread count, or one whose markRead was deferred, never
    // got dismissed. None of that is an input here by design.
    expect(getReticulumChannelDismissalTarget(base)).not.toBeNull();
    expect(
      getReticulumChannelDismissalTarget({ ...base, unreadCount: 0 } as any)
    ).not.toBeNull();
    expect(
      getReticulumChannelDismissalTarget({
        ...base,
        hasLoadedEvents: false,
      } as any)
    ).not.toBeNull();
  });

  it('accepts a numeric group id', () => {
    expect(
      getReticulumChannelDismissalTarget({ ...base, selectedGroup: 7 })
    ).toEqual({ groupId: 7, channelId: 'general' });
  });

  it('returns null when Reticulum chat is disabled', () => {
    expect(
      getReticulumChannelDismissalTarget({
        ...base,
        reticulumChatEnabled: false,
      })
    ).toBeNull();
  });

  it('returns null when the view is not active', () => {
    expect(
      getReticulumChannelDismissalTarget({ ...base, isActive: false })
    ).toBeNull();
  });

  it('returns null for a missing or invalid group id', () => {
    for (const selectedGroup of [null, undefined, '', 'abc', 0, -1, 1.5]) {
      expect(
        getReticulumChannelDismissalTarget({ ...base, selectedGroup } as any)
      ).toBeNull();
    }
  });

  it('returns null for a missing channel id', () => {
    for (const selectedChannelId of [null, undefined, '']) {
      expect(
        getReticulumChannelDismissalTarget({
          ...base,
          selectedChannelId,
        } as any)
      ).toBeNull();
    }
  });
});

describe('getReticulumViewChannelPayload', () => {
  it('publishes the active channel', () => {
    expect(getReticulumViewChannelPayload(base)).toEqual({
      groupId: 7,
      channelId: 'general',
    });
  });

  it('publishes the not-viewing sentinel when inactive', () => {
    // Regression: ChatGroup stays mounted inside PersistentSectionLayer, so
    // leaving the chat view only flips isActive. Skipping the publish instead
    // of sending a sentinel left main holding the last channel forever, which
    // suppressed every notification for it — General Chat stopped notifying.
    const payload = getReticulumViewChannelPayload({
      ...base,
      isActive: false,
    });
    expect(payload).toEqual(NOT_VIEWING_VIEW_CONTEXT);
    expect(payload.groupId).toBeLessThan(0);
  });

  it('never returns null, so a stale context can never survive', () => {
    const invalidStates = [
      { reticulumChatEnabled: false },
      { isActive: false },
      { selectedGroup: null },
      { selectedGroup: 'abc' },
      { selectedChannelId: '' },
      { selectedChannelId: null },
    ];
    for (const overrides of invalidStates) {
      const payload = getReticulumViewChannelPayload({
        ...base,
        ...overrides,
      } as any);
      expect(payload).toEqual(NOT_VIEWING_VIEW_CONTEXT);
    }
  });

  it('the sentinel suppresses nothing for any real channel', () => {
    const payload = getReticulumViewChannelPayload({
      ...base,
      isActive: false,
    });
    const context = { ...payload, visible: true };
    expect(shouldSuppressForViewedChannel(context, 7, 'general')).toBe(false);
    expect(shouldSuppressForViewedChannel(context, 1, 'general')).toBe(false);
  });

  it('an active channel still suppresses for itself', () => {
    const payload = getReticulumViewChannelPayload(base);
    const context = { ...payload, visible: true };
    expect(shouldSuppressForViewedChannel(context, 7, 'general')).toBe(true);
    expect(shouldSuppressForViewedChannel(context, 7, 'announcements')).toBe(
      false
    );
  });

  describe('channel state group gate', () => {
    // Regression: group switch retains the previous group's channel id while
    // the new group's metadata loads. Acting on that pair dismissed and
    // published (newGroup, oldChannel), which cleared the wrong channel's
    // notifications and stopped the right one being suppressed. Introduced by
    // restoring the last-viewed channel instead of always starting on general.

    it('withholds the target while the group channels are still loading', () => {
      expect(
        getReticulumChannelDismissalTarget({
          ...base,
          selectedGroup: '9',
          // Still the previous group's loaded state.
          channelStateGroupId: '7',
        })
      ).toBeNull();
    });

    it('withholds the target when no group channels have loaded', () => {
      expect(
        getReticulumChannelDismissalTarget({
          ...base,
          channelStateGroupId: '',
        })
      ).toBeNull();
    });

    it('targets normally once the selected group channels are loaded', () => {
      expect(
        getReticulumChannelDismissalTarget({
          ...base,
          channelStateGroupId: '7',
        })
      ).toEqual({ groupId: 7, channelId: 'general' });
    });

    it('publishes the not-viewing sentinel while channels are loading', () => {
      const payload = getReticulumViewChannelPayload({
        ...base,
        selectedGroup: '9',
        channelStateGroupId: '7',
      });
      expect(payload).toEqual(NOT_VIEWING_VIEW_CONTEXT);
      const context = { ...payload, visible: true };
      // Nothing suppressed for the new group, and crucially nothing suppressed
      // for the channel retained from the previous group either.
      expect(shouldSuppressForViewedChannel(context, 9, 'general')).toBe(false);
      expect(shouldSuppressForViewedChannel(context, 7, 'general')).toBe(false);
    });

    it('omitting the gate keeps the previous behaviour', () => {
      // Callers with no channel-load state must not be affected.
      expect(getReticulumChannelDismissalTarget(base)).toEqual({
        groupId: 7,
        channelId: 'general',
      });
    });
  });
});
