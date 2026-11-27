/**
 * Tests for the notification plan — the decision a single Reticulum group post
 * makes about which notifications to emit.
 *
 * These exist because this decision was implemented inline and broke three times
 * without any test being able to reach it. Each historical failure has an
 * explicit regression test below, marked with the round it came from.
 *
 * Invariant under test throughout: **at most one** of reply / mention / message
 * is true for any input.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  planReticulumNotifications,
  type NotificationPlanDeps,
  type NotificationPlanInput,
} from './reticulumNotificationPlan';

const MY_ADDRESS = 'QmyAddress';
const OTHER = 'QotherAuthor';

const baseInput: NotificationPlanInput = {
  isMessage: true,
  isFromOther: true,
  hasMyAddress: true,
  replyLookupAllowed: true,
  recordMentionNotification: true,
  isWelcomePost: false,
  notifyOnWelcomePosts: true,
};

function makeDeps(
  overrides: Partial<NotificationPlanDeps> = {}
): NotificationPlanDeps {
  return {
    myAddress: MY_ADDRESS,
    lookupReplyParentAuthor: vi.fn(async () => OTHER),
    getNotifyOnReplies: vi.fn(async () => true),
    isChannelMuted: vi.fn(async () => false),
    isAuthorizedBroadcast: vi.fn(() => false),
    isDirectMention: vi.fn(() => false),
    ...overrides,
  };
}

function input(overrides: Partial<NotificationPlanInput> = {}) {
  return { ...baseInput, ...overrides };
}

/**
 * Assert the one-notification invariant.
 *
 * `welcome` must be included: this helper previously checked only reply /
 * mention / message, so a plan with welcome *and* message both true passed the
 * invariant while producing two OS notifications.
 */
function expectAtMostOne(plan: {
  reply: boolean;
  mention: boolean;
  welcome: boolean;
  message: boolean;
}) {
  const count = [plan.reply, plan.mention, plan.welcome, plan.message].filter(
    Boolean
  ).length;
  expect(count).toBeLessThanOrEqual(1);
}

describe('plain post', () => {
  it('emits exactly one generic notification', async () => {
    // Round 3 regression: setting the "higher priority emitted" flag
    // unconditionally after calling the mention recorder dropped this entirely.
    const plan = await planReticulumNotifications(input(), makeDeps());
    expect(plan.kind).toBe('message');
    expect(plan.message).toBe(true);
    expect(plan.reply).toBe(false);
    expect(plan.mention).toBe(false);
    expectAtMostOne(plan);
  });

  it('does not emit for the reader’s own post', async () => {
    const plan = await planReticulumNotifications(
      input({ isFromOther: false }),
      makeDeps()
    );
    expect(plan.kind).toBeNull();
    expectAtMostOne(plan);
  });

  it('does not emit when the address is unknown', async () => {
    const plan = await planReticulumNotifications(
      input({ hasMyAddress: false }),
      makeDeps()
    );
    expect(plan.kind).toBeNull();
  });

  it('does not emit for a non-message event', async () => {
    const plan = await planReticulumNotifications(
      input({ isMessage: false }),
      makeDeps()
    );
    expect(plan.kind).toBeNull();
  });
});

describe('mention', () => {
  it('emits a mention for a direct mention', async () => {
    const plan = await planReticulumNotifications(
      input(),
      makeDeps({ isDirectMention: () => true })
    );
    expect(plan.kind).toBe('mention');
    expect(plan.mention).toBe(true);
    expect(plan.message).toBe(false);
  });

  it('emits a mention for an authorized broadcast', async () => {
    const plan = await planReticulumNotifications(
      input(),
      makeDeps({ isAuthorizedBroadcast: () => true })
    );
    expect(plan.kind).toBe('mention');
  });

  it('does NOT emit a generic notification alongside the mention', async () => {
    // Round 1 regression: push level "all" plus a mention produced two.
    const plan = await planReticulumNotifications(
      input(),
      makeDeps({ isDirectMention: () => true })
    );
    expect(plan.message).toBe(false);
    expectAtMostOne(plan);
  });

  it('emits nothing when mentions are not recorded', async () => {
    const plan = await planReticulumNotifications(
      input({ recordMentionNotification: false }),
      makeDeps({ isDirectMention: () => true })
    );
    // History replay: no mention notification and no generic fallback.
    expect(plan.kind).toBeNull();
  });
});

describe('reply', () => {
  const replyInput = input({ repliedToEventId: 'evt-parent' });

  it('emits a reply when the parent is the reader’s own message', async () => {
    const plan = await planReticulumNotifications(
      replyInput,
      makeDeps({
        myAddress: MY_ADDRESS,
        lookupReplyParentAuthor: async () => MY_ADDRESS,
      })
    );
    expect(plan.kind).toBe('reply');
    expect(plan.reply).toBe(true);
  });

  it('does not emit a reply when the parent is someone else’s message', async () => {
    const plan = await planReticulumNotifications(
      replyInput,
      makeDeps({ lookupReplyParentAuthor: async () => OTHER })
    );
    // Falls through to the generic notification, still exactly one.
    expect(plan.kind).toBe('message');
    expectAtMostOne(plan);
  });

  it('does not emit when reply notifications are disabled', async () => {
    const plan = await planReticulumNotifications(
      replyInput,
      makeDeps({
        lookupReplyParentAuthor: async () => MY_ADDRESS,
        getNotifyOnReplies: async () => false,
      })
    );
    expect(plan.reply).toBe(false);
    expectAtMostOne(plan);
  });

  it('does not emit when the channel is muted', async () => {
    const plan = await planReticulumNotifications(
      replyInput,
      makeDeps({
        lookupReplyParentAuthor: async () => MY_ADDRESS,
        isChannelMuted: async () => true,
      })
    );
    expect(plan.reply).toBe(false);
  });

  it('survives a failing parent lookup', async () => {
    const plan = await planReticulumNotifications(
      replyInput,
      makeDeps({
        lookupReplyParentAuthor: async () => {
          throw new Error('bridge unavailable');
        },
      })
    );
    // The throw is swallowed; the post still gets one notification.
    expect(plan.reply).toBe(false);
    expect(plan.kind).toBe('message');
  });

  it('does not look up the parent when reply lookups are suppressed', async () => {
    const lookup = vi.fn(async () => MY_ADDRESS);
    const plan = await planReticulumNotifications(
      input({ repliedToEventId: 'evt-parent', replyLookupAllowed: false }),
      makeDeps({ lookupReplyParentAuthor: lookup })
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(plan.kind).toBe('message');
  });
});

describe('precedence', () => {
  it('reply beats mention', async () => {
    const plan = await planReticulumNotifications(
      input({ repliedToEventId: 'evt-parent' }),
      makeDeps({
        lookupReplyParentAuthor: async () => MY_ADDRESS,
        isDirectMention: () => true,
      })
    );
    expect(plan.kind).toBe('reply');
    expect(plan.mention).toBe(false);
    expect(plan.message).toBe(false);
    expectAtMostOne(plan);
  });
});

describe('welcome posts', () => {
  it('emits nothing when welcome-post notifications are disabled', async () => {
    const plan = await planReticulumNotifications(
      input({ isWelcomePost: true, notifyOnWelcomePosts: false }),
      makeDeps()
    );
    expect(plan.kind).toBeNull();
    expect(plan.suppressMention).toBe(true);
  });

  it('emits the welcome kind when welcome-post notifications are enabled', async () => {
    const plan = await planReticulumNotifications(
      input({ isWelcomePost: true, notifyOnWelcomePosts: true }),
      makeDeps()
    );
    // A join notice is more specific than "posted in channel", so it no longer
    // borrows the generic message kind.
    expect(plan.kind).toBe('welcome');
    expect(plan.welcome).toBe(true);
    expect(plan.message).toBe(false);
  });

  it('keeps the welcome kind above the generic message', async () => {
    const plan = await planReticulumNotifications(
      input({
        isWelcomePost: true,
        notifyOnWelcomePosts: true,
        recordMentionNotification: true,
      }),
      makeDeps()
    );
    expect(plan.kind).toBe('welcome');
  });

  it('prefers a welcome over a mention of the reader', async () => {
    // A welcome post self-mentions its author, so `isDirectMention` is true for
    // the joiner. With mention ranked first, that reader got a mention
    // notification for someone joining rather than a join notice.
    const plan = await planReticulumNotifications(
      input({
        isWelcomePost: true,
        notifyOnWelcomePosts: true,
        recordMentionNotification: true,
      }),
      makeDeps({ isDirectMention: () => true })
    );
    expect(plan.kind).toBe('welcome');
    expect(plan.welcome).toBe(true);
    expect(plan.mention).toBe(false);
  });

  it('prefers a welcome over an authorized @everyone mention', async () => {
    const plan = await planReticulumNotifications(
      input({
        isWelcomePost: true,
        notifyOnWelcomePosts: true,
        recordMentionNotification: true,
      }),
      makeDeps({ isAuthorizedBroadcast: () => true })
    );
    expect(plan.kind).toBe('welcome');
    expect(plan.mention).toBe(false);
  });

  it('still prefers a reply over a welcome', async () => {
    const plan = await planReticulumNotifications(
      input({
        isWelcomePost: true,
        notifyOnWelcomePosts: true,
        repliedToEventId: 'evt-parent',
      }),
      makeDeps({ lookupReplyParentAuthor: async () => MY_ADDRESS })
    );
    expect(plan.kind).toBe('reply');
    expect(plan.welcome).toBe(false);
  });

  it('emits nothing when notifications are disabled for this pass', async () => {
    // Regression: the welcome branch originally omitted
    // `recordMentionNotification`, so it fired for history replay — which never
    // sets that option — and every historic welcome post raised an OS
    // notification on each launch.
    const plan = await planReticulumNotifications(
      input({
        isWelcomePost: true,
        notifyOnWelcomePosts: true,
        recordMentionNotification: false,
      }),
      makeDeps()
    );
    expect(plan.kind).toBeNull();
    expect(plan.welcome).toBe(false);
    expect(plan.message).toBe(false);
  });
});

describe('history replay is silent', () => {
  /**
   * Group.tsx replays the last 50 events of every member group at startup, and
   * passes only `{ skipReplyNotification: true }`. `recordMentionNotification`
   * is therefore `undefined` on that path, which Group.tsx turns into `false`.
   *
   * Every kind must stay silent for that option set. Testing it as a property
   * rather than per-branch is the point: the welcome kind was added later and
   * simply forgot the flag, which no per-branch test would have caught.
   */
  const replayInput = (overrides: Partial<NotificationPlanInput> = {}) =>
    input({ recordMentionNotification: false, ...overrides });

  it('emits nothing for a welcome post', async () => {
    const plan = await planReticulumNotifications(
      replayInput({ isWelcomePost: true }),
      makeDeps({ isDirectMention: () => true })
    );
    expect(plan.kind).toBeNull();
  });

  it('emits nothing for a mention of the reader', async () => {
    const plan = await planReticulumNotifications(
      replayInput(),
      makeDeps({ isDirectMention: () => true })
    );
    expect(plan.kind).toBeNull();
  });

  it('emits nothing for an authorized @everyone', async () => {
    const plan = await planReticulumNotifications(
      replayInput(),
      makeDeps({ isAuthorizedBroadcast: () => true })
    );
    expect(plan.kind).toBeNull();
  });

  it('emits nothing for a plain post', async () => {
    const plan = await planReticulumNotifications(replayInput(), makeDeps());
    expect(plan.kind).toBeNull();
  });

  it('emits nothing for a welcome post that also mentions the reader', async () => {
    const plan = await planReticulumNotifications(
      replayInput({ isWelcomePost: true }),
      makeDeps({
        isDirectMention: () => true,
        isAuthorizedBroadcast: () => true,
      })
    );
    expect(plan.kind).toBeNull();
  });
});

describe('one notification per post — exhaustive', () => {
  const booleans = [false, true];

  it('never emits more than one kind across all combinations', async () => {
    for (const hasReplyTarget of booleans) {
      for (const recordMentionNotification of booleans) {
        for (const authorizedBroadcast of booleans) {
          for (const directMention of booleans) {
            for (const isWelcomePost of booleans) {
              for (const notifyOnWelcomePosts of booleans) {
                for (const replyAllowed of booleans) {
                  const plan = await planReticulumNotifications(
                    input({
                      repliedToEventId: hasReplyTarget
                        ? 'evt-parent'
                        : undefined,
                      recordMentionNotification,
                      isWelcomePost,
                      notifyOnWelcomePosts,
                      replyLookupAllowed: replyAllowed,
                    }),
                    makeDeps({
                      lookupReplyParentAuthor: async () => MY_ADDRESS,
                      isAuthorizedBroadcast: () => authorizedBroadcast,
                      isDirectMention: () => directMention,
                    })
                  );
                  expectAtMostOne(plan);
                  // `kind` must agree with the booleans, in precedence order:
                  // reply > welcome > mention > message.
                  const expected = plan.reply
                    ? 'reply'
                    : plan.welcome
                      ? 'welcome'
                      : plan.mention
                        ? 'mention'
                        : plan.message
                          ? 'message'
                          : null;
                  expect(plan.kind).toBe(expected);
                }
              }
            }
          }
        }
      }
    }
  });
});
