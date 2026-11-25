/**
 * A join notice is its own notification kind, and says who joined.
 *
 * Runs through the transport: the joiner publishes a real signed
 * `group-welcome` payload, the reader receives it, and the plan resolves to
 * `welcome` rather than the generic "posted in channel".
 *
 * The distinction matters because a welcome post also carries a self-mention
 * from the joiner (see `ChatGroup.tsx`, which mentions its own address so the
 * post shows the member's name). Before this kind existed, that combination
 * reached the generic path and the reader saw "X posted in General" instead of
 * "X has joined the group".
 */

import {
  GROUP,
  makeReaderAndAuthor,
  publishAndReceive,
  planAndEmit,
  assertExactlyOne,
} from './notification-support.mjs';

export const WELCOME_CHANNEL = 'general';

export default {
  name: 'notification-welcome',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-welcome',
    });
    const { reader, author, sink } = harness;

    // A welcome payload shaped exactly as ChatGroup.tsx publishes it.
    const welcomePayload = {
      messageText: `<p>hello, I am ${author.label}</p>`,
      mentionedAddresses: [author.address],
      qchatSystem: {
        type: 'group-welcome',
        welcomeKey: 'welcome-key-1',
        groupId: GROUP,
        groupName: 'Welcome Test Group',
        joinedAddress: author.address,
        joinedAt: Date.now(),
        joinedName: author.label,
      },
      version: 3,
    };

    const event = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: WELCOME_CHANNEL,
      encryptedPayload: JSON.stringify(welcomePayload),
    });

    const visible = await publishAndReceive(ctx, harness, event);

    await ctx.check('the reader received the join notice', () => {
      if (visible.eventId !== event.eventId) {
        throw new Error(`got ${visible.eventId}`);
      }
      return visible.eventId;
    });

    await ctx.check('the payload is recognisable as a group-welcome', () => {
      const parsed = JSON.parse(String(visible.encryptedPayload || '{}'));
      if (parsed?.qchatSystem?.type !== 'group-welcome') {
        throw new Error('qchatSystem.type missing after round trip');
      }
      return 'group-welcome';
    });

    // Group.tsx derives `isWelcomePost` from exactly this field, and passes the
    // group's `notifyOnWelcomePosts` alongside it.
    const { plan } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
      isWelcomePost: true,
      notifyOnWelcomePosts: true,
    });

    await ctx.check('the plan resolves to the welcome kind', () => {
      if (plan.kind !== 'welcome') throw new Error(`got ${plan.kind}`);
      return plan.kind;
    });

    await ctx.check('the generic message kind is not also set', () => {
      if (plan.message !== false) throw new Error('message was true');
      return 'message false';
    });

    await ctx.check('exactly one notification was registered', () =>
      assertExactlyOne(sink)
    );

    // The group-level switch is the one the settings UI offers for this kind.
    const suppressed = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
      isWelcomePost: true,
      notifyOnWelcomePosts: false,
      notificationId: 'welcome-off',
    });

    await ctx.check(
      'notifyOnWelcomePosts: false silences the join notice',
      () => {
        if (suppressed.plan.kind !== null) {
          throw new Error(`got ${suppressed.plan.kind}`);
        }
        return 'null';
      }
    );

    // The startup history replay. Group.tsx passes only
    // `{ skipReplyNotification: true }`, so `recordMentionNotification` is
    // undefined and reaches the plan as false. A join notice must stay silent
    // there, or every launch re-notifies every historic welcome post.
    const replayed = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: false,
      isWelcomePost: true,
      notifyOnWelcomePosts: true,
      notificationId: 'welcome-replay',
    });

    await ctx.check('the startup history replay stays silent', () => {
      if (replayed.plan.kind !== null) {
        throw new Error(
          `replay produced ${replayed.plan.kind} for a historic welcome post`
        );
      }
      return 'null';
    });
  },
};
