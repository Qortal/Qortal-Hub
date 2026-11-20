/**
 * Exactly one OS notification per post, the most specific kind.
 *
 * This file began as a failing reproduction of a reported bug — a user with
 * "All Messages" on received two notifications for one mentioning post. It now
 * locks in the fix.
 *
 * What it covers that the other suites do not:
 *
 *   - `reticulumNotificationPlan.test.ts` proves `Group.tsx` emits at most one
 *     *event*. That was already true and was never the bug.
 *   - `qChatNotificationSettings.test.ts` proves the push-level predicates are
 *     right in isolation. Also not the bug.
 *   - This file covers the composition: what `WebsocketNotifications` does once
 *     it receives those events. Four independent handlers each owned a private
 *     "already notified this eventId" Set, and two of them never consulted the
 *     push-level settings at all.
 *
 * The fix routes all four handlers through `OsNotificationClaims` in
 * `reticulumNotificationPrecedence.ts`, which answers "may this handler present
 * this kind for this event" once, for everyone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type EffectiveNotificationSettings,
} from '../../utils/qChatNotificationSettings';
import {
  OsNotificationClaims,
  osNotificationIdForEvent,
  resolveOsNotificationKind,
  type OsNotificationFacts,
} from './reticulumNotificationPrecedence';

// ---------------------------------------------------------------------------
// Model of the four handlers
// ---------------------------------------------------------------------------

const PUSH_ALL: EffectiveNotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  pushLevel: 'all',
};

const PUSH_MENTIONS: EffectiveNotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  pushLevel: 'mentions',
};

type NotificationKind = 'mention' | 'reply' | 'message' | 'reaction';

/**
 * Which kinds the four handlers would present for one post.
 *
 * Each handler now calls `claims.claimIfPermitted(...)` for its own kind, so the
 * model is: try every handler that this post reaches, in the order they are
 * subscribed, and let the claims object arbitrate.
 *
 * The subscription order in `WebsocketNotifications.tsx` is mention, reply,
 * reaction, message — which is deliberately *not* precedence order. That is
 * what makes the claims object necessary rather than redundant: precedence
 * alone would let the mention handler win simply by running first.
 */
function kindsEmitted(params: {
  settings: EffectiveNotificationSettings;
  facts: OsNotificationFacts;
  claims?: OsNotificationClaims;
  eventId?: string;
}): NotificationKind[] {
  const { settings, facts } = params;
  const claims = params.claims ?? new OsNotificationClaims();
  const eventId = params.eventId ?? 'evt-1';

  const emitted: NotificationKind[] = [];
  const attempt = (kind: NotificationKind, reached: boolean) => {
    if (!reached) return;
    if (claims.claimIfPermitted(eventId, settings, facts, kind)) {
      emitted.push(kind);
    }
  };

  attempt('mention', facts.isMentionOfMe === true);
  attempt('reply', facts.isReplyToMe === true);
  attempt('welcome', facts.isWelcomePost === true);
  attempt('reaction', facts.isReactionToMe === true);
  // The generic handler is subscribed for every post.
  attempt('message', true);

  return emitted;
}

// ---------------------------------------------------------------------------
// D1 — the reported bug: a mention under pushLevel "all"
// ---------------------------------------------------------------------------

describe('D1: a mention under pushLevel "all"', () => {
  it('presents exactly one notification, the mention', () => {
    const emitted = kindsEmitted({
      settings: PUSH_ALL,
      facts: { isMentionOfMe: true },
    });

    // Before the fix this was ['mention', 'message']: the mention handler and
    // the generic handler each passed their own gate, because
    // `shouldFirePushNotification` returns true unconditionally for 'all'.
    expect(emitted).toEqual(['mention']);
  });

  it('the generic handler alone would still have presented', () => {
    // Guards the fix from being "the generic handler was disabled": a plain
    // post at 'all' must still notify.
    const emitted = kindsEmitted({ settings: PUSH_ALL, facts: {} });
    expect(emitted).toEqual(['message']);
  });

  it('a mention at pushLevel "mentions" still presents the mention', () => {
    const emitted = kindsEmitted({
      settings: PUSH_MENTIONS,
      facts: { isMentionOfMe: true },
    });
    expect(emitted).toEqual(['mention']);
  });
});

// ---------------------------------------------------------------------------
// D2 — reply and reaction used to bypass the push gate
// ---------------------------------------------------------------------------

describe('D2: reply and reaction honour their settings', () => {
  it('does not present a reply when notifyOnReplies is off', () => {
    const settings: EffectiveNotificationSettings = {
      ...PUSH_MENTIONS,
      pushLevel: 'none',
      notifyOnReplies: false,
    };

    // Before the fix `handleQChatReplyNotification` never called
    // `shouldFirePushNotification`, so this produced a reply notification
    // regardless of the setting — and Group.tsx honoured the setting, so the
    // two disagreed.
    expect(kindsEmitted({ settings, facts: { isReplyToMe: true } })).toEqual(
      []
    );
  });

  it('presents a reply when notifyOnReplies is on, even at "mentions"', () => {
    const settings: EffectiveNotificationSettings = {
      ...PUSH_MENTIONS,
      notifyOnReplies: true,
    };
    expect(kindsEmitted({ settings, facts: { isReplyToMe: true } })).toEqual([
      'reply',
    ]);
  });

  it('does not present a reaction when notifyOnReactions is off', () => {
    const settings: EffectiveNotificationSettings = {
      ...PUSH_ALL,
      notifyOnReactions: false,
    };
    // The generic kind would otherwise fire at 'all'; the gate refuses
    // 'reaction', and the post is not a mention or reply, so 'message' wins.
    const emitted = kindsEmitted({ settings, facts: { isReactionToMe: true } });
    expect(emitted).toEqual(['message']);
  });

  it('presents a reaction when notifyOnReactions is on', () => {
    const settings: EffectiveNotificationSettings = {
      ...PUSH_MENTIONS,
      notifyOnReactions: true,
    };
    expect(kindsEmitted({ settings, facts: { isReactionToMe: true } })).toEqual(
      ['reaction']
    );
  });
});

// ---------------------------------------------------------------------------
// D3 — a reply that also mentions
// ---------------------------------------------------------------------------

describe('D3: a reply that also mentions the reader', () => {
  it('presents exactly one notification, the reply', () => {
    const emitted = kindsEmitted({
      settings: PUSH_ALL,
      facts: { isReplyToMe: true, isMentionOfMe: true },
    });

    // Before the fix this was ['mention', 'reply', 'message'] — three OS
    // notifications for one post. Note the mention handler is subscribed first,
    // so this also proves the claims object arbitrates by precedence rather
    // than by subscription order.
    expect(emitted).toEqual(['reply']);
  });

  it('arbitrates correctly regardless of handler order', () => {
    const claims = new OsNotificationClaims();
    const facts = { isReplyToMe: true, isMentionOfMe: true };

    // Simulate the reply handler running last: it must still win.
    expect(claims.claimIfPermitted('evt-x', PUSH_ALL, facts, 'mention')).toBe(
      false
    );
    expect(claims.claimIfPermitted('evt-x', PUSH_ALL, facts, 'reply')).toBe(
      true
    );
    expect(claims.get('evt-x')).toBe('reply');
  });
});

// ---------------------------------------------------------------------------
// D4 — the sync-unread path rebuilt the bell entry before suppressing
// ---------------------------------------------------------------------------

describe('D4: the sync-unread path now checks suppression first', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/Group/WebsocketNotifications.tsx'),
    'utf8'
  );

  /**
   * Source-order assertion, deliberately done on the file text.
   *
   * This cannot be expressed behaviourally without rendering a 1,500-line
   * component and driving its effects, and the defect was the *order* of two
   * statements rather than their outcomes. Reading the source is honest about
   * the coverage; a render harness would imply more than it gives.
   */
  it('consults view suppression before rebuilding the bell entry', () => {
    const mentionHandlerStart = source.indexOf(
      'const handleQChatMention = async ('
    );
    const stateMerge = source.indexOf(
      'setPaymentNotifications((previous) => {',
      mentionHandlerStart
    );
    const syncSuppression = source.indexOf(
      'isUnreadCountSync &&',
      mentionHandlerStart
    );

    expect(mentionHandlerStart).toBeGreaterThan(-1);
    expect(syncSuppression).toBeGreaterThan(-1);
    // Before the fix the only sync guard sat after the state merge, so a
    // summaries refresh rebuilt the entry for the channel in view.
    expect(syncSuppression).toBeLessThan(stateMerge);
  });

  it('guards the sync path with shouldSuppressForCurrentView', () => {
    const mentionHandlerStart = source.indexOf(
      'const handleQChatMention = async ('
    );
    const stateMerge = source.indexOf(
      'setPaymentNotifications((previous) => {',
      mentionHandlerStart
    );
    const guardText = source.slice(mentionHandlerStart, stateMerge);

    expect(guardText).toContain('shouldSuppressForCurrentView');
  });
});

// ---------------------------------------------------------------------------
// D5 — the notification id is stable per event, so the sink can dedupe
// ---------------------------------------------------------------------------

describe('D5: notification ids are stable per event', () => {
  const backgroundSource = readFileSync(
    join(process.cwd(), 'src/background/background.ts'),
    'utf8'
  );

  it('keys the id on the event when one is supplied', () => {
    // The id shape is now built by qchatNotificationIdForEvent, which is
    // exercised directly in src/utils/notificationClickRoute.test.ts. Assert
    // that background.ts delegates to it rather than re-inlining the literal.
    expect(backgroundSource).toContain('qchatNotificationIdForEvent(eventId)');
  });

  it('keeps the clock-derived id only for notifications with no event', () => {
    // Payments and app resources have no eventId; they must still get an id
    // that carries the marker the click router requires.
    expect(backgroundSource).toContain('general_notification_');
    expect(backgroundSource).toContain('Date.now()');
    expect(backgroundSource).toContain('GENERAL_NOTIFICATION_TYPE_MARKER');
  });

  it('routes ids through the shared classifier rather than ad-hoc includes', () => {
    // Regression: the event-keyed id carries no `_type=` segment and used to
    // fall through every branch, so clicking a Q-Chat notification navigated
    // nowhere. The classifier is the single place that mapping lives.
    expect(backgroundSource).toContain('notificationClickRoute(');
  });

  it('osNotificationIdForEvent is stable and clock-free', () => {
    expect(osNotificationIdForEvent('evt-1')).toBe(
      osNotificationIdForEvent('evt-1')
    );
    expect(osNotificationIdForEvent('evt-1')).not.toMatch(/\d{10,}/);
  });
});

// ---------------------------------------------------------------------------
// The invariant, stated once
// ---------------------------------------------------------------------------

describe('invariant: at most one OS notification per post', () => {
  const cases: Array<
    [string, EffectiveNotificationSettings, OsNotificationFacts]
  > = [
    ['plain post, all', PUSH_ALL, {}],
    ['plain post, mentions', PUSH_MENTIONS, {}],
    ['mention, all', PUSH_ALL, { isMentionOfMe: true }],
    ['mention, mentions', PUSH_MENTIONS, { isMentionOfMe: true }],
    [
      'mention, everyone suppressed',
      { ...PUSH_ALL, suppressEveryoneHere: true },
      { isMentionOfMe: true, isEveryoneOrHere: true },
    ],
    ['reply, all', PUSH_ALL, { isReplyToMe: true }],
    [
      'reply+mention, all',
      PUSH_ALL,
      { isReplyToMe: true, isMentionOfMe: true },
    ],
    [
      'reply+mention+reaction, all',
      PUSH_ALL,
      {
        isReplyToMe: true,
        isMentionOfMe: true,
        isReactionToMe: true,
      },
    ],
    ['reaction, all', PUSH_ALL, { isReactionToMe: true }],
    [
      'everything, mentions',
      PUSH_MENTIONS,
      {
        isReplyToMe: true,
        isMentionOfMe: true,
        isReactionToMe: true,
      },
    ],
  ];

  it.each(cases)('%s → at most one kind', (_label, settings, facts) => {
    // `mentions` level legitimately presents nothing for a plain post, so the
    // assertion is the upper bound rather than equality with 1.
    expect(kindsEmitted({ settings, facts }).length).toBeLessThanOrEqual(1);
  });

  it.each(cases)(
    '%s → the presented kind is the highest-precedence permitted one',
    (_label, settings, facts) => {
      const emitted = kindsEmitted({ settings, facts });
      const expected = resolveOsNotificationKind(settings, facts);
      if (expected === null) {
        expect(emitted).toEqual([]);
      } else {
        expect(emitted).toEqual([expected]);
      }
    }
  );

  it('a repeated event cannot present twice', () => {
    const claims = new OsNotificationClaims();
    const params = {
      settings: PUSH_ALL,
      facts: { isMentionOfMe: true } as OsNotificationFacts,
      claims,
      eventId: 'evt-dup',
    };

    expect(kindsEmitted(params)).toEqual(['mention']);
    // The same event delivered again — duplicate notice, retried fetch — must
    // not produce a second notification.
    expect(kindsEmitted(params)).toEqual([]);
  });
});
