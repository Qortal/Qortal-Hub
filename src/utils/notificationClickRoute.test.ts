import { describe, expect, it } from 'vitest';
import {
  GENERAL_NOTIFICATION_TYPE_MARKER,
  QCHAT_NOTIFICATION_ID_PREFIX,
  dmNotificationQueueKey,
  notificationClickRoute,
  qchatNotificationIdForEvent,
} from './notificationClickRoute';

describe('notificationClickRoute', () => {
  it('routes the event-keyed Q-Chat form', () => {
    // Regression: this form has no `_type=` segment, so it fell through every
    // branch and the click navigated nowhere.
    expect(notificationClickRoute('q-chat_notification_abc')).toBe('general');
    expect(
      notificationClickRoute(`${QCHAT_NOTIFICATION_ID_PREFIX}1672531200000-42`)
    ).toBe('general');
  });

  it('routes the clock-derived general form', () => {
    expect(
      notificationClickRoute(
        `general_notification_1672531200000${GENERAL_NOTIFICATION_TYPE_MARKER}`
      )
    ).toBe('general');
  });

  it('still routes the older type markers', () => {
    expect(notificationClickRoute('chat_notification_1_type=direct_abc')).toBe(
      'direct'
    );
    expect(notificationClickRoute('a_type=group-announcement_5')).toBe(
      'group-announcement'
    );
    expect(notificationClickRoute('a_type=group_5')).toBe('group');
    expect(notificationClickRoute('a_type=thread-post_9')).toBe('thread-post');
  });

  it('prefers the longer marker over the shorter one it contains', () => {
    // `_type=group-` is a prefix of `_type=group-announcement_`, so a naive
    // `includes('_type=group_')` test alone would mis-route this.
    expect(notificationClickRoute('x_type=group-announcement_1')).toBe(
      'group-announcement'
    );
  });

  it('accepts an id that arrives URI-encoded', () => {
    expect(
      notificationClickRoute(encodeURIComponent('q-chat_notification_abc'))
    ).toBe('general');
  });

  it('survives a malformed escape sequence', () => {
    expect(notificationClickRoute('q-chat_notification_%E0%A4%A')).toBe(
      'general'
    );
  });

  it('returns none for an unrecognised or empty id', () => {
    expect(notificationClickRoute('')).toBe('none');
    expect(notificationClickRoute(null)).toBe('none');
    expect(notificationClickRoute(undefined)).toBe('none');
    expect(notificationClickRoute('something-else')).toBe('none');
  });
});

describe('dmNotificationQueueKey', () => {
  it('is distinct from the notification id so a DM click still opens the DM', () => {
    // Using the event id as the notification id would route the click to
    // `general` instead of the conversation, so the queue key is separate.
    expect(dmNotificationQueueKey('evt-1')).toBe('reticulum-dm-queued-evt-1');
    expect(dmNotificationQueueKey('evt-1')).not.toBe(
      qchatNotificationIdForEvent('evt-1')
    );
  });

  it('returns null when there is no event to key on', () => {
    expect(dmNotificationQueueKey('')).toBeNull();
    expect(dmNotificationQueueKey(null)).toBeNull();
  });
});

describe('qchatNotificationIdForEvent', () => {
  it('keys the id on the event so the sink can dedupe', () => {
    expect(qchatNotificationIdForEvent('evt-1')).toBe(
      'q-chat_notification_evt-1'
    );
  });

  it('is stable across calls and free of a clock', () => {
    expect(qchatNotificationIdForEvent('evt-1')).toBe(
      qchatNotificationIdForEvent('evt-1')
    );
    expect(qchatNotificationIdForEvent('evt-1')).not.toMatch(/\d{10,}/);
  });

  it('returns null when there is no event to key on', () => {
    expect(qchatNotificationIdForEvent('')).toBeNull();
    expect(qchatNotificationIdForEvent('   ')).toBeNull();
    expect(qchatNotificationIdForEvent(null)).toBeNull();
    expect(qchatNotificationIdForEvent(undefined)).toBeNull();
  });
});
