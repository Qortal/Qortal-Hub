import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  shouldFirePushNotification,
  isScopeMuted,
  DEFAULT_NOTIFICATION_SETTINGS,
  type GroupNotificationStore,
} from '../../utils/qChatNotificationSettings';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('q-chat-message-notification event emission', () => {
  it('dispatches q-chat-message-notification with payload', () => {
    const handler = vi.fn();
    subscribeToEvent('q-chat-message-notification', handler);

    executeEvent('q-chat-message-notification', {
      channelId: 'general',
      eventId: 'evt-1',
      groupId: 42,
      groupName: 'Test Group',
      timestamp: 1700000000000,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({
      channelId: 'general',
      eventId: 'evt-1',
      groupId: 42,
      groupName: 'Test Group',
      timestamp: 1700000000000,
    });

    unsubscribeFromEvent('q-chat-message-notification', handler);
  });

  it('does not dispatch q-chat-message-notification for mentioned messages', () => {
    const mentionHandler = vi.fn();
    const messageHandler = vi.fn();
    subscribeToEvent('q-chat-mention-notification', mentionHandler);
    subscribeToEvent('q-chat-message-notification', messageHandler);

    executeEvent('q-chat-mention-notification', {
      channelId: 'general',
      eventId: 'evt-2',
      groupId: 42,
      groupName: 'Test Group',
      isEveryoneOrHere: false,
      timestamp: 1700000000000,
    });

    expect(mentionHandler).toHaveBeenCalledTimes(1);
    expect(messageHandler).not.toHaveBeenCalled();

    unsubscribeFromEvent('q-chat-mention-notification', mentionHandler);
    unsubscribeFromEvent('q-chat-message-notification', messageHandler);
  });
});

describe('All Messages push decision with isMention false', () => {
  const base = DEFAULT_NOTIFICATION_SETTINGS;

  it('fires when pushLevel is all and channel is not muted', () => {
    const effective = { ...base, pushLevel: 'all' as const };
    const channelMuted = false;
    const shouldPush =
      effective != null &&
      shouldFirePushNotification(effective, false, false, false) &&
      !(channelMuted && effective.pushLevel === 'all');
    expect(shouldPush).toBe(true);
  });

  it('does not fire when pushLevel is mentions', () => {
    const effective = { ...base, pushLevel: 'mentions' as const };
    const channelMuted = false;
    const shouldPush =
      effective != null &&
      shouldFirePushNotification(effective, false, false, false) &&
      !(channelMuted && effective.pushLevel === 'all');
    expect(shouldPush).toBe(false);
  });

  it('does not fire when pushLevel is none', () => {
    const effective = { ...base, pushLevel: 'none' as const };
    const channelMuted = false;
    const shouldPush =
      effective != null &&
      shouldFirePushNotification(effective, false, false, false) &&
      !(channelMuted && effective.pushLevel === 'all');
    expect(shouldPush).toBe(false);
  });

  it('does not fire when pushLevel is all but channel is muted', () => {
    const effective = { ...base, pushLevel: 'all' as const };
    const channelMuted = true;
    const shouldPush =
      effective != null &&
      shouldFirePushNotification(effective, false, false, false) &&
      !(channelMuted && effective.pushLevel === 'all');
    expect(shouldPush).toBe(false);
  });

  it('fires when pushLevel is all and channel mute check passes with non-muted channel', () => {
    const settings: GroupNotificationStore = {
      channels: {},
    };
    const muted = isScopeMuted(settings, undefined, 'general');
    const effective = { ...base, pushLevel: 'all' as const };
    const shouldPush =
      effective != null &&
      shouldFirePushNotification(effective, false, false, false) &&
      !(muted && effective.pushLevel === 'all');
    expect(shouldPush).toBe(true);
  });
});

describe('OS notification dedup for All Messages', () => {
  it('does not fire a second OS notification for the same eventId', () => {
    const notifiedSet = new Set<string>();
    const eventId = 'evt-dedup-1';
    const maxTracked = 500;

    function shouldNotify(id: string): boolean {
      if (notifiedSet.has(id)) return false;
      notifiedSet.add(id);
      if (notifiedSet.size > maxTracked) {
        const oldest = notifiedSet.values().next().value;
        if (oldest) notifiedSet.delete(oldest);
      }
      return true;
    }

    expect(shouldNotify(eventId)).toBe(true);
    expect(shouldNotify(eventId)).toBe(false);
  });

  it('evicts oldest entry when exceeding 500 tracked', () => {
    const notifiedSet = new Set<string>();
    const maxTracked = 500;

    function shouldNotify(id: string): boolean {
      if (notifiedSet.has(id)) return false;
      notifiedSet.add(id);
      if (notifiedSet.size > maxTracked) {
        const oldest = notifiedSet.values().next().value;
        if (oldest) notifiedSet.delete(oldest);
      }
      return true;
    }

    for (let i = 0; i < 500; i++) {
      shouldNotify(`evt-${i}`);
    }
    expect(notifiedSet.size).toBe(500);
    expect(notifiedSet.has('evt-0')).toBe(true);

    shouldNotify('evt-500');
    expect(notifiedSet.size).toBe(500);
    expect(notifiedSet.has('evt-0')).toBe(false);
    expect(notifiedSet.has('evt-500')).toBe(true);
  });
});
