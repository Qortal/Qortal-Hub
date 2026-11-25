/**
 * Replaces: "Post mentioning the reader in an unviewed channel → exactly one
 * notification, the mention."
 *
 * Runs through the transport. The mention is a real signed wire field
 * (`mentionAddressHashes`), and the reader derives `directMentionAuthorized`
 * itself from its own local address — so this asserts the derivation, not a
 * flag the harness set.
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
  name: 'notification-mention',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-mention',
      channels: ['random'],
    });
    const { reader, author, sink } = harness;

    const event = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: 'random',
      mentionAddressHashes: mentionHashesFor(ctx, reader),
    });

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
        if (visible.directMentionAuthorized !== true) {
          throw new Error('directMentionAuthorized missing after round trip');
        }
        return 'mention authorized';
      }
    );

    const { plan, result } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
    });

    await ctx.check('plan resolves to a mention', () => {
      if (plan.kind !== 'mention') throw new Error(`got ${plan.kind}`);
      return plan.kind;
    });

    await ctx.check('exactly one notification was registered', () =>
      assertExactlyOne(sink)
    );

    await ctx.check('the notification targets the posting channel', () => {
      const entry = sink.snapshot()[0];
      if (entry.groupContext?.channelId !== 'random') {
        throw new Error(`channel ${entry.groupContext?.channelId}`);
      }
      if (entry.eventId !== event.eventId) {
        throw new Error(`event ${entry.eventId}`);
      }
      return entry.groupContext.channelId;
    });

    await ctx.check('the submission was not treated as suppressed', () => {
      if (result?.suppressed === true) throw new Error('suppressed');
      return 'registered';
    });
  },
};
