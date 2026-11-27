/**
 * Replaces: "Post that both replies to the reader and mentions them → exactly
 * one notification, the reply."
 *
 * This is the case that failed three times in a row before the decision was
 * extracted into `reticulumNotificationPlan.ts`. It is the reason the priority
 * order is data rather than statement ordering.
 *
 * Runs through the transport: the author publishes, the reader fetches and
 * stores the event, and the decision is taken on the reader-visible event. A
 * transport regression fails here, not only in `transport-roundtrip`.
 */

import {
  GROUP,
  makeReaderAndAuthor,
  mentionHashesFor,
  publishAndReceive,
  planAndEmit,
  assertExactlyOne,
} from './notification-support.mjs';

export default {
  name: 'notification-reply-beats-mention',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-reply-beats-mention',
    });
    const { reader, author, sink } = harness;

    const parentEventId = 'parent-message-from-reader';
    const event = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: 'general',
      replyToEventId: parentEventId,
      mentionAddressHashes: mentionHashesFor(ctx, reader),
    });

    await ctx.check('the author published the event', () => event.eventId);

    const visible = await publishAndReceive(ctx, harness, event);

    await ctx.check('the reader received it through the transport', () => {
      if (visible.eventId !== event.eventId) {
        throw new Error(`got ${visible.eventId}`);
      }
      return visible.eventId;
    });

    await ctx.check(
      'the reader derived the mention from the signed hashes',
      () => {
        // This is the assertion that would have caught a hardcoded flag: the
        // round trip carries `mentionAddressHashes`, and the manager recomputes
        // the flag on the reader side.
        if (visible.directMentionAuthorized !== true) {
          throw new Error('directMentionAuthorized missing after round trip');
        }
        return 'mention authorized';
      }
    );

    const { plan } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
      lookupReplyParentAuthor: async () => reader.address,
    });

    await ctx.check('the reply is the single resolved kind', () => {
      if (plan.kind !== 'reply') throw new Error(`got ${plan.kind}`);
      return plan.kind;
    });

    await ctx.check('the mention is suppressed by the reply', () => {
      if (plan.mention) throw new Error('mention flag also set');
      return 'mention suppressed';
    });

    await ctx.check('at most one of reply/mention/message is true', () => {
      const set = [plan.reply, plan.mention, plan.message].filter(Boolean);
      if (set.length > 1) throw new Error(`${set.length} kinds set`);
      return `${set.length} kind`;
    });

    await ctx.check('exactly one notification was registered', () =>
      assertExactlyOne(sink)
    );
  },
};
