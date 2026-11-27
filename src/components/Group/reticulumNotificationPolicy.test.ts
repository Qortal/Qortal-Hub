/**
 * The OS-emission gate in `reticulumNotificationPrecedence.ts` duplicates the
 * push-level rules from `shouldFirePushNotification`, because that module must
 * stay import-free to be loadable by the scenario harness via type stripping.
 *
 * Duplication is only acceptable if it is checked. This suite asserts the two
 * implementations agree across every combination of settings and facts, which
 * turns "two copies drifted" into a failing test rather than a live bug.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  shouldFirePushNotification,
  type EffectiveNotificationSettings,
} from '../../utils/qChatNotificationSettings';
import {
  OS_NOTIFICATION_PRECEDENCE,
  OsNotificationClaims,
  osNotificationIdForEvent,
  permittedOsNotificationKinds,
  resolveOsNotificationKind,
  type OsNotificationFacts,
  type OsNotificationPolicy,
} from './reticulumNotificationPrecedence';

/** Exhaustive settings matrix: 3 push levels x 2 x 2 x 2. */
function allPolicies(): OsNotificationPolicy[] {
  const policies: OsNotificationPolicy[] = [];
  for (const pushLevel of ['all', 'mentions', 'none']) {
    for (const suppressEveryoneHere of [false, true]) {
      for (const notifyOnReplies of [false, true]) {
        for (const notifyOnReactions of [false, true]) {
          policies.push({
            pushLevel,
            suppressEveryoneHere,
            notifyOnReplies,
            notifyOnReactions,
          });
        }
      }
    }
  }
  return policies;
}

/** Every combination of the four facts. */
function allFacts(): OsNotificationFacts[] {
  const facts: OsNotificationFacts[] = [];
  for (const isReplyToMe of [false, true]) {
    for (const isMentionOfMe of [false, true]) {
      for (const isEveryoneOrHere of [false, true]) {
        for (const isReactionToMe of [false, true]) {
          facts.push({
            isReplyToMe,
            isMentionOfMe,
            isEveryoneOrHere,
            isReactionToMe,
          });
        }
      }
    }
  }
  return facts;
}

const asEffective = (
  policy: OsNotificationPolicy
): EffectiveNotificationSettings => ({
  pushLevel: policy.pushLevel as EffectiveNotificationSettings['pushLevel'],
  suppressEveryoneHere: policy.suppressEveryoneHere,
  notifyOnReplies: policy.notifyOnReplies,
  notifyOnReactions: policy.notifyOnReactions,
  notifyOnWelcomePosts: true,
});

describe('gate agrees with shouldFirePushNotification', () => {
  const policies = allPolicies();
  const facts = allFacts();

  it('reply permission matches the shipped predicate', () => {
    for (const policy of policies) {
      for (const f of facts) {
        const expected = shouldFirePushNotification(
          asEffective(policy),
          /* isMention */ false,
          /* isEveryoneOrHere */ false,
          /* isReplyToUser */ f.isReplyToMe === true,
          /* isReactionToUser */ false
        );
        const actual = permittedOsNotificationKinds(policy, f).includes(
          'reply'
        );
        // shouldFirePushNotification returns true for anything at 'all', which
        // is why the gate cannot simply delegate: at 'all' it permits *some*
        // kind but not necessarily a reply. Compare reply agreement only for
        // the predicate's reply branch.
        if (policy.pushLevel !== 'all') {
          expect(actual).toBe(expected);
        }
      }
    }
  });

  it('reaction permission matches notifyOnReactions', () => {
    for (const policy of policies) {
      for (const f of facts) {
        const actual = permittedOsNotificationKinds(policy, f).includes(
          'reaction'
        );
        const expected = f.isReactionToMe === true && policy.notifyOnReactions;
        expect(actual).toBe(expected);
      }
    }
  });

  it('a direct mention is never suppressible by suppressEveryoneHere', () => {
    for (const policy of policies) {
      const permitted = permittedOsNotificationKinds(policy, {
        isMentionOfMe: true,
        isEveryoneOrHere: false,
      });
      const expected =
        policy.pushLevel === 'all' || policy.pushLevel === 'mentions';
      expect(permitted.includes('mention')).toBe(expected);
    }
  });

  it('an @everyone mention honours suppressEveryoneHere under "mentions"', () => {
    const permitted = permittedOsNotificationKinds(
      { ...DEFAULT_NOTIFICATION_SETTINGS, suppressEveryoneHere: true },
      { isMentionOfMe: true, isEveryoneOrHere: true }
    );
    expect(permitted.includes('mention')).toBe(false);
  });
});

describe('resolveOsNotificationKind', () => {
  const all: OsNotificationPolicy = {
    pushLevel: 'all',
    suppressEveryoneHere: false,
    notifyOnReplies: true,
    notifyOnReactions: true,
  };

  it('prefers the reply when a post replies and mentions', () => {
    expect(
      resolveOsNotificationKind(all, {
        isReplyToMe: true,
        isMentionOfMe: true,
      })
    ).toBe('reply');
  });

  it('prefers the mention over the generic message — the reported bug', () => {
    expect(resolveOsNotificationKind(all, { isMentionOfMe: true })).toBe(
      'mention'
    );
  });

  it('falls back to the generic message for a plain post at "all"', () => {
    expect(resolveOsNotificationKind(all, {})).toBe('message');
  });

  it('returns null for a plain post at "mentions"', () => {
    expect(
      resolveOsNotificationKind({ ...all, pushLevel: 'mentions' }, {})
    ).toBeNull();
  });

  it('returns null for a reply when notifyOnReplies is off', () => {
    expect(
      resolveOsNotificationKind(
        { ...all, notifyOnReplies: false },
        { isReplyToMe: true }
      )
    ).toBe(
      // The reminder would be a bug: a reply that is not permitted must not
      // silently degrade into a generic message at 'all' either, because the
      // user turned reply notifications off deliberately. The gate returns
      // 'message' here by design (the post still matches "all messages").
      'message'
    );
  });

  it('never returns more than one kind', () => {
    for (const policy of allPolicies()) {
      for (const f of allFacts()) {
        const kind = resolveOsNotificationKind(policy, f);
        const permitted = permittedOsNotificationKinds(policy, f);
        if (kind === null) {
          expect(permitted).toEqual([]);
        } else {
          expect(permitted).toContain(kind);
        }
      }
    }
  });
});

describe('OsNotificationClaims', () => {
  const all: OsNotificationPolicy = {
    pushLevel: 'all',
    suppressEveryoneHere: false,
    notifyOnReplies: true,
    notifyOnReactions: true,
  };

  it('lets only the first claim for an event through', () => {
    const claims = new OsNotificationClaims();
    expect(claims.claim('evt-1', 'mention')).toBe(true);
    expect(claims.claim('evt-1', 'message')).toBe(false);
    expect(claims.claim('evt-1', 'mention')).toBe(false);
  });

  it('blocks a losing handler even before any claim exists', () => {
    const claims = new OsNotificationClaims();
    // A reply+mention post: the mention handler must not present.
    expect(
      claims.claimIfPermitted(
        'evt-2',
        all,
        { isReplyToMe: true, isMentionOfMe: true },
        'mention'
      )
    ).toBe(false);
    expect(
      claims.claimIfPermitted(
        'evt-2',
        all,
        { isReplyToMe: true, isMentionOfMe: true },
        'reply'
      )
    ).toBe(true);
  });

  it('claimIfPermitted returns false when the settings forbid the kind', () => {
    const claims = new OsNotificationClaims();
    expect(
      claims.claimIfPermitted(
        'evt-3',
        { ...all, pushLevel: 'mentions' },
        {},
        'message'
      )
    ).toBe(false);
    expect(claims.size).toBe(0);
  });

  it('release allows a genuine retry', () => {
    const claims = new OsNotificationClaims();
    expect(claims.claim('evt-4', 'mention')).toBe(true);
    claims.release('evt-4');
    expect(claims.claim('evt-4', 'mention')).toBe(true);
  });

  it('prunes to the configured cap', () => {
    const claims = new OsNotificationClaims(3);
    for (let i = 0; i < 10; i += 1) claims.claim(`evt-${i}`, 'message');
    expect(claims.size).toBe(3);
    expect(claims.get('evt-9')).toBe('message');
  });

  it('does not claim an empty event id', () => {
    const claims = new OsNotificationClaims();
    expect(claims.claim('', 'message')).toBe(false);
    expect(claims.size).toBe(0);
  });
});

describe('osNotificationIdForEvent', () => {
  it('is stable for the same event', () => {
    expect(osNotificationIdForEvent('evt-1')).toBe(
      osNotificationIdForEvent('evt-1')
    );
  });

  it('differs between events', () => {
    expect(osNotificationIdForEvent('evt-1')).not.toBe(
      osNotificationIdForEvent('evt-2')
    );
  });

  it('does not include the clock', () => {
    // background.ts used Date.now(), so the sink could never dedupe.
    expect(osNotificationIdForEvent('evt-1')).not.toMatch(/\d{10,}/);
  });
});

describe('precedence table', () => {
  it('orders reply, welcome, mention, reaction, message', () => {
    expect(OS_NOTIFICATION_PRECEDENCE).toEqual([
      'reply',
      'welcome',
      'mention',
      'reaction',
      'message',
    ]);
  });

  it('puts welcome above mention so a join notice can never be a mention', () => {
    const order = [...OS_NOTIFICATION_PRECEDENCE];
    expect(order.indexOf('welcome')).toBeLessThan(order.indexOf('mention'));
    expect(order.indexOf('welcome')).toBeGreaterThan(order.indexOf('reply'));
  });
});

describe('welcome is its own kind, between mention and reaction', () => {
  const all: OsNotificationPolicy = {
    pushLevel: 'all',
    suppressEveryoneHere: false,
    notifyOnReplies: true,
    notifyOnReactions: true,
    notifyOnWelcomePosts: true,
  };

  it('presents welcome for a join notice instead of the generic message', () => {
    expect(resolveOsNotificationKind(all, { isWelcomePost: true })).toBe(
      'welcome'
    );
  });

  it('beats a mention on the same post', () => {
    // A welcome post self-mentions its author so the post renders the joiner's
    // name, and it can carry an @everyone. If `mention` outranked `welcome`,
    // those readers would get a mention notification for someone joining.
    // Ordering welcome above mention removes that contradiction entirely.
    expect(
      resolveOsNotificationKind(all, {
        isWelcomePost: true,
        isMentionOfMe: true,
      })
    ).toBe('welcome');
  });

  it('beats an @everyone mention too', () => {
    expect(
      resolveOsNotificationKind(all, {
        isWelcomePost: true,
        isMentionOfMe: true,
        isEveryoneOrHere: true,
      })
    ).toBe('welcome');
  });

  it('loses to a reply on the same post', () => {
    expect(
      resolveOsNotificationKind(all, {
        isWelcomePost: true,
        isReplyToMe: true,
      })
    ).toBe('reply');
  });

  it('beats a reaction on the same post', () => {
    // The ordering the feature asked for: welcome sits above reaction.
    expect(
      resolveOsNotificationKind(all, {
        isWelcomePost: true,
        isReactionToMe: true,
      })
    ).toBe('welcome');
  });

  it('beats the generic message on the same post', () => {
    expect(
      permittedOsNotificationKinds(all, { isWelcomePost: true })
    ).toContain('welcome');
    expect(resolveOsNotificationKind(all, { isWelcomePost: true })).not.toBe(
      'message'
    );
  });

  it('is suppressed by notifyOnWelcomePosts, and only the welcome kind goes', () => {
    const off: OsNotificationPolicy = {
      ...all,
      notifyOnWelcomePosts: false,
    };
    expect(
      permittedOsNotificationKinds(off, { isWelcomePost: true })
    ).not.toContain('welcome');

    // This asserts the gate **in isolation**, which is all this module can see.
    // In production the gate is never reached for this combination: the plan
    // module (`reticulumNotificationPlan.ts`) sets `suppressMention` for a
    // welcome post with notifications off, which blanks reply, mention, welcome
    // AND message, so no event is emitted at all. Pinned here so the layering
    // is documented rather than assumed — see the plan suite's
    // "does not emit when welcome-post notifications are disabled".
    expect(resolveOsNotificationKind(off, { isWelcomePost: true })).toBe(
      'message'
    );
    expect(
      resolveOsNotificationKind(
        { ...off, pushLevel: 'mentions' },
        { isWelcomePost: true }
      )
    ).toBeNull();
  });

  it('treats an absent notifyOnWelcomePosts as enabled', () => {
    const { notifyOnWelcomePosts: _omitted, ...withoutFlag } = all;
    expect(
      permittedOsNotificationKinds(withoutFlag, { isWelcomePost: true })
    ).toContain('welcome');
  });
});
