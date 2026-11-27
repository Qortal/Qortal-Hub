/**
 * Replaces: "Post replying to the reader's message → exactly one notification,
 * the reply."
 *
 * Runs through the transport. The reply relationship is a signed wire field
 * (`replyToEventId`); the parent's author is looked up from the reader's local
 * history rather than asserted, which is what the shipped dep does.
 */

import {
  GROUP,
  makeReaderAndAuthor,
  publishAndReceive,
  planAndEmit,
  assertExactlyOne,
} from './notification-support.mjs';

export default {
  name: 'notification-reply',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-reply',
      channels: ['random'],
    });
    const { reader, author, sink, readerManager } = harness;

    // A real parent message authored by the reader, so the lookup is honest.
    const parent = ctx.signEvent(reader, ctx.chat, {
      groupId: GROUP,
      channelId: 'random',
    });
    await readerManager.publishEvent(parent);

    const event = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: 'random',
      replyToEventId: parent.eventId,
    });

    const visible = await publishAndReceive(ctx, harness, event);

    await ctx.check('the reader received it through the transport', () => {
      if (visible.eventId !== event.eventId) {
        throw new Error(`got ${visible.eventId}`);
      }
      return visible.eventId;
    });

    await ctx.check('the reply parent is the reader’s own message', () => {
      if (visible.replyToEventId !== parent.eventId) {
        throw new Error(`parent ${visible.replyToEventId}`);
      }
      if (parent.authorAddress !== reader.address) {
        throw new Error('parent was not authored by the reader');
      }
      return parent.eventId;
    });

    const { plan, result } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      // The shipped dep queries local history; do the same rather than returning
      // a constant.
      lookupReplyParentAuthor: async (repliedToEventId) => {
        const match = readerManager
          .getMessageHistory(GROUP, 'random')
          .find((candidate) => candidate.eventId === repliedToEventId);
        return match?.authorAddress ?? null;
      },
    });

    await ctx.check('plan resolves to a reply', () => {
      if (plan.kind !== 'reply') throw new Error(`got ${plan.kind}`);
      return plan.kind;
    });

    await ctx.check('exactly one notification was registered', () =>
      assertExactlyOne(sink)
    );

    await ctx.check(
      'the reply wins over the generic message notification',
      () => {
        if (plan.message) throw new Error('generic message flag also set');
        return 'reply only';
      }
    );

    await ctx.check('the submission was not suppressed', () => {
      if (result?.suppressed === true) throw new Error('suppressed');
      return 'registered';
    });
  },
};
