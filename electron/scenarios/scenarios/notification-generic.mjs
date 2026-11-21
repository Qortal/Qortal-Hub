/**
 * Replaces: "Post not mentioning or replying to the reader → exactly one
 * generic notification."
 *
 * Also guards the opposite historical failure: an over-eager mention flag once
 * suppressed the generic notification for *every* plain post. Running through the
 * transport makes that check meaningful — a post with no mention hashes must
 * arrive with no mention flag.
 */

import {
  GROUP,
  makeReaderAndAuthor,
  publishAndReceive,
  planAndEmit,
  assertExactlyOne,
} from './notification-support.mjs';

export default {
  name: 'notification-generic',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-generic',
      channels: ['random'],
    });
    const { reader, author, sink } = harness;

    const event = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: 'random',
      mentionAddressHashes: [],
    });

    const visible = await publishAndReceive(ctx, harness, event);

    await ctx.check('the reader received it through the transport', () => {
      if (visible.eventId !== event.eventId) {
        throw new Error(`got ${visible.eventId}`);
      }
      return visible.eventId;
    });

    await ctx.check(
      'a post with no mention hashes is not flagged as a mention',
      () => {
        if (visible.directMentionAuthorized === true) {
          throw new Error('directMentionAuthorized set without a hash');
        }
        return 'not a mention';
      }
    );

    const { plan } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
      lookupReplyParentAuthor: async () => null,
    });

    await ctx.check('plan resolves to a generic message notification', () => {
      if (plan.kind !== 'message') throw new Error(`got ${plan.kind}`);
      return plan.kind;
    });

    await ctx.check('the generic notification was not swallowed', () => {
      if (!plan.message) throw new Error('message flag false');
      return 'emitted';
    });

    await ctx.check('exactly one notification was registered', () =>
      assertExactlyOne(sink)
    );
  },
};
