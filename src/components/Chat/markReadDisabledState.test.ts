import { describe, it, expect } from 'vitest';

type Summary = {
  unreadCount?: number;
  mentionCount?: number;
  hasUnreadMention?: boolean;
};

function channelHasUnread(summary: Summary | undefined): boolean {
  return (
    Math.max(0, Number(summary?.unreadCount) || 0) > 0 ||
    summary?.hasUnreadMention === true ||
    Math.max(0, Number(summary?.mentionCount) || 0) > 0
  );
}

function sectionHasUnread(
  channelIds: string[],
  summaries: Map<string, Summary>
): boolean {
  return channelIds.some((id) => channelHasUnread(summaries.get(id)));
}

describe('channel mark-read disabled state', () => {
  it('is disabled when unreadCount is 0 and no unread mention', () => {
    const summary = {
      unreadCount: 0,
      mentionCount: 0,
      hasUnreadMention: false,
    };
    expect(channelHasUnread(summary)).toBe(false);
  });

  it('is enabled when unreadCount > 0', () => {
    const summary = {
      unreadCount: 5,
      mentionCount: 0,
      hasUnreadMention: false,
    };
    expect(channelHasUnread(summary)).toBe(true);
  });

  it('is enabled when hasUnreadMention is true', () => {
    const summary = { unreadCount: 0, mentionCount: 0, hasUnreadMention: true };
    expect(channelHasUnread(summary)).toBe(true);
  });

  it('is enabled when mentionCount > 0', () => {
    const summary = {
      unreadCount: 0,
      mentionCount: 3,
      hasUnreadMention: false,
    };
    expect(channelHasUnread(summary)).toBe(true);
  });

  it('is disabled when summary is undefined', () => {
    expect(channelHasUnread(undefined)).toBe(false);
  });

  it('is disabled when all numeric fields are 0 or missing', () => {
    const summary = {};
    expect(channelHasUnread(summary)).toBe(false);
  });
});

describe('section mark-read disabled state', () => {
  const summaries = new Map<string, Summary>([
    ['ch1', { unreadCount: 0, mentionCount: 0, hasUnreadMention: false }],
    ['ch2', { unreadCount: 0, mentionCount: 0, hasUnreadMention: false }],
    ['ch3', { unreadCount: 0, mentionCount: 0, hasUnreadMention: false }],
  ]);

  it('is disabled when all child channels have no unread', () => {
    expect(sectionHasUnread(['ch1', 'ch2', 'ch3'], summaries)).toBe(false);
  });

  it('is enabled when any child channel has unreadCount > 0', () => {
    const withUnread = new Map(summaries);
    withUnread.set('ch2', {
      unreadCount: 3,
      mentionCount: 0,
      hasUnreadMention: false,
    });
    expect(sectionHasUnread(['ch1', 'ch2', 'ch3'], withUnread)).toBe(true);
  });

  it('is enabled when any child channel has hasUnreadMention true', () => {
    const withMention = new Map(summaries);
    withMention.set('ch1', {
      unreadCount: 0,
      mentionCount: 0,
      hasUnreadMention: true,
    });
    expect(sectionHasUnread(['ch1', 'ch2', 'ch3'], withMention)).toBe(true);
  });

  it('is enabled when any child channel has mentionCount > 0', () => {
    const withMentionCount = new Map(summaries);
    withMentionCount.set('ch3', {
      unreadCount: 0,
      mentionCount: 2,
      hasUnreadMention: false,
    });
    expect(sectionHasUnread(['ch1', 'ch2', 'ch3'], withMentionCount)).toBe(
      true
    );
  });

  it('is disabled when channel list is empty', () => {
    expect(sectionHasUnread([], summaries)).toBe(false);
  });

  it('is disabled when summaries are missing for all channels', () => {
    expect(sectionHasUnread(['unknown1', 'unknown2'], summaries)).toBe(false);
  });
});
