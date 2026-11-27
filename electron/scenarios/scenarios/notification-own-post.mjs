/**
 * Replaces: "Reader's own post → no notification at all."
 *
 * Runs through the transport. The reader is also the author, so the event arrives
 * at the reader's own manager the way a second device would see it, and the plan
 * must short-circuit before looking at mentions or replies.
 */

import {
  GROUP,
  makeReaderAndAuthor,
  mentionHashesFor,
  publishAndReceive,
  planAndEmit,
  assertNone,
} from './notification-support.mjs';

export default {
  name: 'notification-own-post',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-own-post',
    });
    const { reader, sink } = harness;

    // Authored by the reader, mentioning the reader, replying to the reader: the
    // strongest possible case for emitting, which must still emit nothing.
    const event = ctx.signEvent(reader, ctx.chat, {
      groupId: GROUP,
      channelId: 'general',
      mentionAddressHashes: mentionHashesFor(ctx, reader),
      replyToEventId: 'parent-from-reader',
    });

    const visible = await publishAndReceive(ctx, harness, event);

    await ctx.check('the reader received its own event back', () => {
      if (visible.eventId !== event.eventId) {
        throw new Error(`got ${visible.eventId}`);
      }
      return visible.eventId;
    });

    const { plan, emitted } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
      lookupReplyParentAuthor: async () => reader.address,
    });

    await ctx.check('the plan resolves to no kind', () => {
      if (plan.kind !== null) throw new Error(`got ${plan.kind}`);
      return 'null';
    });

    await ctx.check('no notification event would be emitted', () => {
      if (emitted) throw new Error('an event was emitted');
      return 'none';
    });

    await ctx.check('the registry stayed empty', () => assertNone(sink));
  },
};
