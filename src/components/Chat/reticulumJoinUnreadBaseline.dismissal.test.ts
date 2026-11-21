/**
 * Regression tests for the relationship between the Reticulum join-unread
 * baseline and OS notification dismissal.
 *
 * The baseline marks a user's pre-join messages as read so they do not appear
 * unread. It must NOT dismiss OS notifications.
 *
 * History of this file, because it has now been wrong twice:
 *
 *   1. The baseline originally dismissed with `dismissNotifications(groupId)`
 *      — no channelId — which is group-wide. Entering a group cleared every
 *      notification in it.
 *   2. It was narrowed to dismiss only the channels it baselined. That is still
 *      wrong: the baseline runs on the first load of every group and baselines
 *      every channel, so a notification in General was cleared while the reader
 *      was in a different channel. The persisted baseline makes it one-shot per
 *      membership period, so it was invisible on later loads but reliable on the
 *      first — including automated welcome messages.
 *
 * Baselining is a read-watermark concern; dismissal is a "the reader has seen
 * this channel" concern. Only entering or reading a channel may dismiss.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyReticulumJoinUnreadBaseline } from './reticulumJoinUnreadBaseline';

const ADDRESS = 'Q-test-address';
const GROUP_ID = 1144;
const JOINED_AT = 1_700_000_000_000;

type DismissCall = [number, string | undefined];

function setup(options: {
  channels?: Array<{ channelId: string }>;
  markReadResult?: { success: boolean };
}) {
  const dismissCalls: DismissCall[] = [];
  const markRead = vi.fn(
    async () => options.markReadResult ?? { success: true }
  );
  const getChannels = vi.fn(async () => options.channels ?? []);

  (window as any).reticulumChat = {
    markRead,
    getChannels,
    dismissNotifications: (groupId: number, channelId?: string) => {
      dismissCalls.push([groupId, channelId]);
    },
  };

  return { dismissCalls, markRead, getChannels };
}

describe('applyReticulumJoinUnreadBaseline', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('notification dismissal', () => {
    it('never dismisses notifications', async () => {
      const { dismissCalls } = setup({
        channels: [{ channelId: 'general' }, { channelId: 'random' }],
      });

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      // The whole point: baselining must not clear anything.
      expect(dismissCalls).toEqual([]);
    });

    it('does not dismiss even when markRead succeeds for every channel', async () => {
      const { dismissCalls, markRead } = setup({
        channels: [{ channelId: 'general' }, { channelId: 'random' }],
        markReadResult: { success: true },
      });

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      expect(markRead).toHaveBeenCalled();
      expect(dismissCalls).toEqual([]);
    });

    it('does not dismiss on a second run either', async () => {
      const { dismissCalls } = setup({
        channels: [{ channelId: 'general' }],
      });

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });
      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      expect(dismissCalls).toEqual([]);
    });
  });

  describe('read watermark', () => {
    it('marks every known channel read up to joinedAt', async () => {
      const { markRead } = setup({
        channels: [{ channelId: 'general' }, { channelId: 'random' }],
      });

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      expect(markRead).toHaveBeenCalledWith(
        GROUP_ID,
        'general',
        JOINED_AT,
        ADDRESS
      );
      expect(markRead).toHaveBeenCalledWith(
        GROUP_ID,
        'random',
        JOINED_AT,
        ADDRESS
      );
    });

    it('still baselines the default channel when getChannels fails', async () => {
      (window as any).reticulumChat = {
        markRead: vi.fn(async () => ({ success: true })),
        getChannels: vi.fn(async () => {
          throw new Error('bridge not ready');
        }),
        dismissNotifications: () => {},
      };

      const completed = await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      expect(completed).toBe(true);
    });

    it('is idempotent across runs', async () => {
      const { markRead } = setup({
        channels: [{ channelId: 'general' }],
      });

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });
      const firstRunCalls = markRead.mock.calls.length;

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      expect(markRead.mock.calls.length).toBe(firstRunCalls);
    });

    it('retries a channel whose markRead failed', async () => {
      let attempt = 0;
      const markRead = vi.fn(async () => {
        attempt += 1;
        return attempt === 1 ? { success: false } : { success: true };
      });
      (window as any).reticulumChat = {
        markRead,
        getChannels: async () => [{ channelId: 'general' }],
        dismissNotifications: () => {},
      };

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });
      const afterFirst = markRead.mock.calls.length;

      await applyReticulumJoinUnreadBaseline({
        address: ADDRESS,
        groupId: GROUP_ID,
        joinedAt: JOINED_AT,
      });

      // The failed channel is retried on the next run.
      expect(markRead.mock.calls.length).toBeGreaterThan(afterFirst);
    });
  });
});
