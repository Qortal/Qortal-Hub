/**
 * Replaces: "Reaction to the reader's post → one reaction notification, no
 * generic one."
 *
 * Runs through the transport. `planReticulumNotifications` only models `message`
 * posts, so a reaction resolves to no kind; the reaction notification is emitted
 * by a separate path the plan deliberately does not decide. The assertion that
 * matters is that the reaction does not *also* produce a generic message
 * notification — and doing it over the wire proves the reaction survives the
 * round trip with its `eventType` intact.
 */

import {
  GROUP,
  makeReaderAndAuthor,
  publishAndReceive,
  planAndEmit,
  assertNone,
} from './notification-support.mjs';

export default {
  name: 'notification-reaction',
  delivery: 'resource',
  timeoutMs: 60_000,

  async run(ctx) {
    const harness = await makeReaderAndAuthor(ctx, {
      join: 'notification-reaction',
      channels: ['random'],
    });
    const { reader, author, sink, readerManager } = harness;

    // A real post to react to.
    const target = ctx.signEvent(reader, ctx.chat, {
      groupId: GROUP,
      channelId: 'random',
    });
    await readerManager.publishEvent(target);

    const event = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: 'random',
      eventType: 'reaction_add',
      targetEventId: target.eventId,
    });

    const visible = await publishAndReceive(ctx, harness, event);

    await ctx.check(
      'the reaction reached the reader through the transport',
      () => {
        if (visible.eventId !== event.eventId) {
          throw new Error(`got ${visible.eventId}`);
        }
        if (visible.eventType !== 'reaction_add') {
          throw new Error(`eventType became ${visible.eventType}`);
        }
        return `${visible.eventType} -> ${visible.targetEventId}`;
      }
    );

    const { plan, emitted } = await planAndEmit(ctx, sink, {
      event: visible,
      myAddress: reader.address,
      recordMentionNotification: true,
    });

    await ctx.check('a reaction is not a message post for this plan', () => {
      if (plan.kind !== null) throw new Error(`got ${plan.kind}`);
      return 'null';
    });

    await ctx.check(
      'no generic notification is produced for a reaction',
      () => {
        if (plan.message) throw new Error('generic message flag set');
        return 'no generic';
      }
    );

    await ctx.check('the plan emits nothing for a reaction', () => {
      if (emitted) throw new Error('an event was emitted');
      return 'none';
    });

    await ctx.check('the registry stayed empty', () => assertNone(sink));
  },
};
