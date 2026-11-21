/**
 * Notification precedence: exactly one OS notification per post, the most
 * specific kind that applies.
 *
 * The bug these lock down: with push level "all", a post that also mentioned
 * the reader produced two notifications — one for the mention, one for the
 * generic post. The generic emitter's guard read `authorizedBroadcast` and
 * `directMention`, which were only assigned inside the mention branch, so when
 * the mention path was skipped they stayed `false` and the generic notification
 * fired as well.
 */

import { describe, expect, it } from 'vitest';
import {
  RETICULUM_NOTIFICATION_PRECEDENCE,
  resolveEmittedNotificationKind,
  resolveReticulumNotificationKind,
  shouldEmitGenericMessageNotification,
  type NotificationKindContext,
} from './reticulumNotificationPrecedence';

const base: NotificationKindContext = {
  isMessage: true,
  isFromOther: true,
  hasMyAddress: true,
  isReplyToMe: false,
  isMentionOfMe: false,
};

describe('RETICULUM_NOTIFICATION_PRECEDENCE', () => {
  it('orders reply, then mention, then message', () => {
    expect(RETICULUM_NOTIFICATION_PRECEDENCE).toEqual([
      'reply',
      'mention',
      'message',
    ]);
  });
});

describe('resolveReticulumNotificationKind', () => {
  it('returns message for a plain post', () => {
    expect(resolveReticulumNotificationKind(base)).toBe('message');
  });

  it('returns mention when the post mentions the reader', () => {
    expect(
      resolveReticulumNotificationKind({ ...base, isMentionOfMe: true })
    ).toBe('mention');
  });

  it('returns reply when the post replies to the reader', () => {
    expect(
      resolveReticulumNotificationKind({ ...base, isReplyToMe: true })
    ).toBe('reply');
  });

  it('prefers mention over message when both apply', () => {
    // The reported bug: push level "all" plus a mention.
    expect(
      resolveReticulumNotificationKind({ ...base, isMentionOfMe: true })
    ).toBe('mention');
  });

  it('prefers reply over mention when both apply', () => {
    expect(
      resolveReticulumNotificationKind({
        ...base,
        isReplyToMe: true,
        isMentionOfMe: true,
      })
    ).toBe('reply');
  });

  it('prefers reply over mention and message when all apply', () => {
    expect(
      resolveReticulumNotificationKind({
        ...base,
        isReplyToMe: true,
        isMentionOfMe: true,
      })
    ).toBe('reply');
  });

  it('returns null when the author is the reader', () => {
    expect(
      resolveReticulumNotificationKind({ ...base, isFromOther: false })
    ).toBeNull();
  });

  it('returns null when the address is unknown', () => {
    expect(
      resolveReticulumNotificationKind({ ...base, hasMyAddress: false })
    ).toBeNull();
  });

  it('returns null for a non-message event', () => {
    expect(
      resolveReticulumNotificationKind({ ...base, isMessage: false })
    ).toBeNull();
  });
});

describe('shouldEmitGenericMessageNotification', () => {
  it('emits for a plain post', () => {
    expect(shouldEmitGenericMessageNotification(base)).toBe(true);
  });

  it('does NOT emit when the post also mentions the reader', () => {
    // Regression: this returned true, producing a second notification.
    expect(
      shouldEmitGenericMessageNotification({ ...base, isMentionOfMe: true })
    ).toBe(false);
  });

  it('does NOT emit when the post also replies to the reader', () => {
    expect(
      shouldEmitGenericMessageNotification({ ...base, isReplyToMe: true })
    ).toBe(false);
  });

  it('does NOT emit when both reply and mention apply', () => {
    expect(
      shouldEmitGenericMessageNotification({
        ...base,
        isReplyToMe: true,
        isMentionOfMe: true,
      })
    ).toBe(false);
  });

  it('does not emit for the reader’s own post', () => {
    expect(
      shouldEmitGenericMessageNotification({ ...base, isFromOther: false })
    ).toBe(false);
  });
});

describe('resolveEmittedNotificationKind (mirrors the emitter)', () => {
  const params = {
    replyEmitted: false,
    mentionEmitted: false,
    suppressMention: false,
  };

  it('emits message for a plain post', () => {
    // Regression: an earlier fix set the "higher priority emitted" flag
    // unconditionally after calling the mention recorder, which returns
    // silently for a plain message — so ordinary posts emitted nothing.
    expect(resolveEmittedNotificationKind(params)).toBe('message');
  });

  it('emits mention when a mention was emitted', () => {
    expect(
      resolveEmittedNotificationKind({ ...params, mentionEmitted: true })
    ).toBe('mention');
  });

  it('emits reply when a reply was emitted', () => {
    expect(
      resolveEmittedNotificationKind({ ...params, replyEmitted: true })
    ).toBe('reply');
  });

  it('prefers reply over mention', () => {
    expect(
      resolveEmittedNotificationKind({
        ...params,
        replyEmitted: true,
        mentionEmitted: true,
      })
    ).toBe('reply');
  });

  it('emits nothing when mentions are suppressed', () => {
    expect(
      resolveEmittedNotificationKind({ ...params, suppressMention: true })
    ).toBeNull();
  });

  it('still emits the reply when mentions are suppressed', () => {
    expect(
      resolveEmittedNotificationKind({
        ...params,
        replyEmitted: true,
        suppressMention: true,
      })
    ).toBe('reply');
  });
});

describe('one notification per post', () => {
  it('every combination resolves to at most one kind', () => {
    const combinations: Array<[boolean, boolean]> = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];
    for (const [isReplyToMe, isMentionOfMe] of combinations) {
      const kind = resolveReticulumNotificationKind({
        ...base,
        isReplyToMe,
        isMentionOfMe,
      });
      // A single value, never a set: the caller emits exactly one.
      expect(['reply', 'mention', 'message', null]).toContain(kind);
      // And the generic emitter agrees with it.
      expect(
        shouldEmitGenericMessageNotification({
          ...base,
          isReplyToMe,
          isMentionOfMe,
        })
      ).toBe(kind === 'message');
    }
  });
});
