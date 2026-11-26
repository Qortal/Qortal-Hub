/**
 * Reproduction + regression guard for "the unread badge does not appear".
 *
 * The reported symptom: after a fresh start or a rejoin, a group shows no unread
 * badge and the channel dot is missing too — while OS notifications keep firing,
 * because they never consult the read watermark.
 *
 * Two defects produce that. This scenario exercises both against the shipping
 * code: the real `ReticulumChatManager` over real SQLite for the watermark half,
 * and the real `src/utils/qChatNotificationSettings.ts` for the counting half.
 *
 * The assertions are written as documented behaviour, not as observations of the
 * current implementation, so they FAIL while the defects exist and pass once
 * they are fixed. Running it before and after the fix is the confirmation the
 * change asks for (tasks 1.4 and 5.4).
 */

import { join } from 'node:path';
import { importRenderer } from './renderer-support.mjs';

export const GROUP = 913;
export const CHANNEL = 'general';

/** Five minutes, matching `RETICULUM_CHAT_MAX_FUTURE_SKEW_MS`. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

function summariesFor(manager, address) {
  const summaries = manager.getChatSummaries(address);
  const group = summaries.find((entry) => entry.groupId === GROUP);
  const channel = group?.channels?.find((entry) => entry.channelId === CHANNEL);
  return { group, channel };
}

export default {
  name: 'unread-badge-visibility',
  delivery: 'direct',
  timeoutMs: 120_000,

  async run(ctx) {
    const reader = ctx.makeIdentity({ label: 'reader' });
    const author = ctx.makeIdentity({ label: 'author' });

    const router = ctx.createRouter();
    const readerBridge = router.register(reader);
    const authorBridge = router.register(author);

    const readerManager = ctx.makeManager({
      identity: reader,
      bridge: readerBridge,
      dbPath: join(ctx.workDir, 'reader.db'),
      canSign: true,
    });
    const authorManager = ctx.makeManager({
      identity: author,
      bridge: authorBridge,
      dbPath: join(ctx.workDir, 'author.db'),
      canSign: true,
    });
    ctx.onCleanup(() => {
      try {
        authorManager.close();
      } catch {}
      try {
        readerManager.close();
      } catch {}
    });
    router.attachManager(reader, readerManager);
    router.attachManager(author, authorManager);

    ctx.joinGroup(readerManager, GROUP, reader.address);
    ctx.joinGroup(authorManager, GROUP, author.address);
    await ctx.settle(200);

    // A message the reader has never seen. Timestamped slightly in the past so
    // it always satisfies protocol age validation, and inside the 5-minute
    // future bound so clock skew cannot reject it.
    const messageAt = Date.now() - 60_000;
    const message = ctx.signEvent(author, ctx.chat, {
      groupId: GROUP,
      channelId: CHANNEL,
      encryptedPayload: JSON.stringify({
        messageText: '<p>a message the reader has not opened</p>',
        version: 3,
      }),
      timestamp: messageAt,
    });
    const delivered = await ctx.deliverEventDirect(
      readerManager,
      message,
      author
    );

    await ctx.check('the unread message reached the reader', () => {
      if (!delivered) throw new Error('event was not accepted');
      const { channel } = summariesFor(readerManager, reader.address);
      if (!channel) throw new Error('no channel summary');
      if (channel.unreadCount !== 1) {
        throw new Error(`unreadCount=${channel.unreadCount}`);
      }
      return 'unreadCount=1';
    });

    // ---------------------------------------------------------------------
    // The join baseline.
    //
    // `applyReticulumJoinUnreadBaseline` calls `markRead(groupId, channelId,
    // joinedAt, address)` for every known channel on each membership sync and
    // each channel-list load. Its contract is narrow: clear messages that
    // predate the membership, and nothing else.
    //
    // Measured behaviour (this scenario, before and after the welcome fix): a
    // baseline at a `joinedAt` *older* than the message leaves it unread, and
    // repeated runs are idempotent. The main process only clamps a read
    // *downward* to the newest stored event, so it cannot push a watermark past
    // a newer message. These assertions pin that contract so a future change
    // cannot quietly widen the baseline into a full read.
    // ---------------------------------------------------------------------
    const joinedAt = messageAt - 1_000; // joined before the message landed
    readerManager.markRead(GROUP, CHANNEL, joinedAt, reader.address);
    await ctx.settle(100);

    await ctx.check(
      'a baseline older than the message leaves it unread',
      () => {
        const { channel } = summariesFor(readerManager, reader.address);
        if (!channel) throw new Error('no channel summary');
        return `unreadCount=${channel.unreadCount}`;
      }
    );

    const afterBaseline = summariesFor(readerManager, reader.address).channel
      ?.unreadCount;
    await ctx.check(
      'the channel still reports the message as unread after the baseline',
      () => {
        if (afterBaseline !== 1) {
          throw new Error(
            `expected 1, got ${afterBaseline} — the baseline cleared a ` +
              `message that postdates the join boundary`
          );
        }
        return 'unreadCount=1';
      }
    );

    // Repeating the baseline must be idempotent: ChatGroup re-runs it on every
    // channel-list load, so a non-idempotent baseline would clear unread as the
    // user navigates.
    readerManager.markRead(GROUP, CHANNEL, joinedAt, reader.address);
    await ctx.settle(100);

    await ctx.check('repeating the baseline is idempotent', () => {
      const { channel } = summariesFor(readerManager, reader.address);
      const count = channel?.unreadCount;
      if (count !== 1) {
        throw new Error(
          `expected 1, got ${count} — a repeated baseline cleared unread`
        );
      }
      return 'unreadCount=1';
    });

    // ---------------------------------------------------------------------
    // Defect B: welcome-unread ids are subtracted without a bound.
    //
    // `unreadWelcomeEventIdsAtom` accumulates every welcome post seen during the
    // startup history replay and is never reconciled when those posts are read.
    // `groupHasUnreadConsideringMute` then subtracts that accumulated figure from
    // real unread, so a group with genuine unread messages reports no unread.
    // ---------------------------------------------------------------------
    const settings = await importRenderer(
      'src/utils/qChatNotificationSettings.ts'
    );

    const summary = {
      unreadCount: 3,
      replyCount: 0,
      mentionCount: 0,
      hasUnreadMention: false,
      channels: [
        {
          channelId: CHANNEL,
          unreadCount: 3,
          replyCount: 0,
          mentionCount: 0,
          hasUnreadMention: false,
        },
      ],
    };
    const groupStore = { channels: {}, notifyOnWelcomePosts: false };
    const fallback = {
      pushLevel: 'mentions',
      suppressEveryoneHere: false,
      notifyOnReplies: true,
      notifyOnReactions: true,
      notifyOnWelcomePosts: false,
    };

    await ctx.check(
      'accumulated welcome ids cannot hide a group with real unread',
      () => {
        // Nine stale welcome ids against three real unread messages.
        const hasUnread = settings.groupHasUnreadConsideringMute(
          groupStore,
          summary,
          9,
          fallback
        );
        if (hasUnread !== true) {
          throw new Error(
            'groupHasUnreadConsideringMute returned false while 3 non-welcome ' +
              'messages are unread — the welcome subtraction is unbounded'
          );
        }
        return 'true';
      }
    );

    await ctx.check(
      'the filtered count is not erased by accumulated welcome ids',
      () => {
        const count = settings.getGroupUnreadCountConsideringMute(
          groupStore,
          summary,
          9,
          fallback
        );
        if (!(count > 0)) {
          throw new Error(
            `getGroupUnreadCountConsideringMute returned ${count} for a group ` +
              `with 3 unread messages and 9 stale welcome ids`
          );
        }
        return `count=${count}`;
      }
    );

    // A welcome set EQUAL to the unread total is ambiguous: it cannot be told
    // apart from a set that has absorbed already-read welcome posts, which is
    // the shape that was cancelling real unread messages and hiding the dot.
    //
    // This pins the deliberate consequence of resolving that ambiguity toward
    // showing the badge: a group whose only unread posts are welcome posts now
    // DOES show a dot when notifyOnWelcomePosts is off. That is the accepted
    // cost — a visible, self-correcting dot beats a hidden real message.
    await ctx.check(
      'an ambiguous welcome set no longer suppresses the dot',
      () => {
        const welcomeOnly = {
          unreadCount: 2,
          replyCount: 0,
          mentionCount: 0,
          hasUnreadMention: false,
          channels: [
            {
              channelId: CHANNEL,
              unreadCount: 2,
              replyCount: 0,
              mentionCount: 0,
              hasUnreadMention: false,
            },
          ],
        };
        const hasUnread = settings.groupHasUnreadConsideringMute(
          groupStore,
          welcomeOnly,
          2,
          fallback
        );
        if (hasUnread !== true) {
          throw new Error(
            'an ambiguous (equal-count) welcome set must not be subtracted; ' +
              'subtracting it can cancel a real message'
          );
        }
        return 'true';
      }
    );

    // The setting must still do something, which is the part that matters:
    // when the set is unambiguously smaller than the unread total, at least one
    // real message remains and the subtraction still applies to the count.
    await ctx.check(
      'an unambiguous welcome set is still subtracted from the count',
      () => {
        const count = settings.getGroupUnreadCountConsideringMute(
          groupStore,
          {
            unreadCount: 3,
            replyCount: 0,
            mentionCount: 0,
            channels: [{ channelId: CHANNEL, unreadCount: 3, mentionCount: 0 }],
          },
          1,
          fallback
        );
        if (count !== 2) throw new Error(`count=${count}, expected 2`);
        return 'count=2';
      }
    );

    // A future-guard assertion: the message timestamp must have been plausible,
    // otherwise the first check passed for the wrong reason.
    await ctx.check(
      'the reproduction used a protocol-plausible timestamp',
      () => {
        const skew = messageAt - Date.now();
        if (skew > MAX_FUTURE_SKEW_MS) {
          throw new Error(`message was ${skew}ms in the future`);
        }
        return `skew=${skew}ms`;
      }
    );

    // A `mutedUntil` key outlives the mute it recorded: it becomes an expired
    // timestamp when the mute lapses, or 0 on an explicit unmute. Treating any
    // key as "the group is muted" zeroed the group whenever its summary carried
    // no channel breakdown, hiding the dot while messages were unread.
    await ctx.check('an expired mute does not hide the group dot', () => {
      const repo = {
        channels: { [CHANNEL]: { mutedUntil: Date.now() - 60_000 } },
      };
      const summary = { unreadCount: 4, mentionCount: 0 };
      if (
        settings.groupHasUnreadConsideringMute(repo, summary, 0, fallback) !==
        true
      ) {
        throw new Error('an expired mute must not count as muted');
      }
      if (
        settings.getGroupUnreadCountConsideringMute(
          repo,
          summary,
          0,
          fallback
        ) !== 4
      ) {
        throw new Error('expired mute changed the count');
      }
      return 'unreadCount=4';
    });

    await ctx.check(
      'an explicit unmute (0) does not hide the group dot',
      () => {
        const repo = { channels: { [CHANNEL]: { mutedUntil: 0 } } };
        const summary = { unreadCount: 4, mentionCount: 0 };
        if (
          settings.groupHasUnreadConsideringMute(repo, summary, 0, fallback) !==
          true
        ) {
          throw new Error('mutedUntil: 0 means unmuted, not muted');
        }
        return 'true';
      }
    );

    await ctx.check('a group-wide active mute still hides the dot', () => {
      const repo = {
        channels: {
          [CHANNEL]: { mutedUntil: null },
          other: { mutedUntil: null },
        },
      };
      const summary = { unreadCount: 4, mentionCount: 0 };
      if (
        settings.groupHasUnreadConsideringMute(repo, summary, 0, fallback) !==
        false
      ) {
        throw new Error('every entry actively muted means the group is muted');
      }
      return 'false';
    });

    await runClockSkewCase(ctx, settings);
  },
};

/**
 * Defect C: one sender's clock pushes the read watermark past another's message.
 *
 * `computeChannelSummary` counts a message unread when
 * `event.timestamp > watermark`. Both sides come from *senders'* clocks, so the
 * watermark is a value in one participant's clock space that is then compared
 * against every other participant's clock. A sender whose clock runs ahead
 * therefore writes a watermark in the future, and every later message whose
 * timestamp falls under it is silently treated as read.
 *
 * The reported symptom is exactly this shape: a push notification for a post
 * that produced no badge. Notifications are generated from live events and never
 * consult the watermark, so they keep firing while the count stays zero. The
 * intermittency follows too — it needs a fast-clocked sender to have dragged the
 * watermark ahead first.
 *
 * The existing guard does not cover this direction. `markChannelsRead` clamps a
 * watermark *down* to the newest stored event, which stops the reader's own wall
 * clock poisoning it, but a stored event timestamped in the future is what it
 * clamps *to* — so the future watermark survives as legitimate.
 */
async function runClockSkewCase(ctx, settings) {
  const SKEW_GROUP = GROUP + 1;
  const reader = ctx.makeIdentity({ label: 'skew-reader' });
  const fast = ctx.makeIdentity({ label: 'skew-fast' });
  const normal = ctx.makeIdentity({ label: 'skew-normal' });

  const router = ctx.createRouter();
  const readerManager = ctx.makeManager({
    identity: reader,
    bridge: router.register(reader),
    dbPath: join(ctx.workDir, 'skew-reader.db'),
    canSign: true,
  });
  const fastManager = ctx.makeManager({
    identity: fast,
    bridge: router.register(fast),
    dbPath: join(ctx.workDir, 'skew-fast.db'),
    canSign: true,
  });
  const normalManager = ctx.makeManager({
    identity: normal,
    bridge: router.register(normal),
    dbPath: join(ctx.workDir, 'skew-normal.db'),
    canSign: true,
  });
  ctx.onCleanup(() => {
    for (const manager of [readerManager, fastManager, normalManager]) {
      try {
        manager.close();
      } catch {}
    }
  });
  router.attachManager(reader, readerManager);
  router.attachManager(fast, fastManager);
  router.attachManager(normal, normalManager);

  for (const [manager, identity] of [
    [readerManager, reader],
    [fastManager, fast],
    [normalManager, normal],
  ]) {
    ctx.joinGroup(manager, SKEW_GROUP, identity.address);
  }
  await ctx.settle(200);

  const skewUnread = () => {
    const summaries = readerManager.getChatSummaries(reader.address);
    const group = summaries.find((entry) => entry.groupId === SKEW_GROUP);
    return group?.channels?.find((entry) => entry.channelId === CHANNEL)
      ?.unreadCount;
  };

  const base = Date.now();
  // Two minutes ahead: inside the protocol's 5-minute future allowance, so the
  // event is legitimately stored. This is a clock-skewed client, not a forgery.
  const aheadAt = base + 120_000;
  const aheadEvent = ctx.signEvent(fast, ctx.chat, {
    groupId: SKEW_GROUP,
    channelId: CHANNEL,
    encryptedPayload: JSON.stringify({
      messageText: '<p>from a fast clock</p>',
      version: 3,
    }),
    timestamp: aheadAt,
  });
  await ctx.deliverEventDirect(readerManager, aheadEvent, fast);

  await ctx.check('the fast-clocked message is unread on arrival', () => {
    const count = skewUnread();
    if (count !== 1) throw new Error(`unreadCount=${count}`);
    return 'unreadCount=1';
  });

  // The reader opens the channel and reads it. The watermark now sits at the
  // fast sender's timestamp, which is in the future.
  readerManager.markRead(SKEW_GROUP, CHANNEL, aheadAt, reader.address);
  await ctx.settle(100);

  await ctx.check('reading the fast-clocked message clears it', () => {
    const count = skewUnread();
    if (count !== 0) throw new Error(`unreadCount=${count}`);
    return 'unreadCount=0';
  });

  // A brand-new message from a normally-clocked sender. Its timestamp is after
  // the previous message in wall-clock terms but below the watermark, because
  // the watermark was dragged into the future. The reader has never seen it, a
  // push notification would fire for it, and it must count as unread.
  const normalAt = base + 60_000;
  const normalEvent = ctx.signEvent(normal, ctx.chat, {
    groupId: SKEW_GROUP,
    channelId: CHANNEL,
    encryptedPayload: JSON.stringify({
      messageText: '<p>never seen by the reader</p>',
      version: 3,
    }),
    timestamp: normalAt,
  });
  await ctx.deliverEventDirect(readerManager, normalEvent, normal);

  await ctx.check(
    'a new message below a future watermark still counts as unread',
    () => {
      const count = skewUnread();
      if (count !== 1) {
        throw new Error(
          `unreadCount=${count} — a message the reader has never seen was ` +
            `counted as read because a fast-clocked sender had pushed the ` +
            `watermark to ${aheadAt} (message was ${normalAt})`
        );
      }
      return 'unreadCount=1';
    }
  );

  // Pin the disagrees-with-notifications property directly, since "push fired
  // but no dot" is what was reported.
  await ctx.check(
    'the badge agrees with the notification path for that message',
    () => {
      const count = skewUnread();
      const notified = normalEvent.eventId !== aheadEvent.eventId;
      if (notified && !(count > 0)) {
        throw new Error(
          'the message would raise a push notification but the channel ' +
            'reports no unread'
        );
      }
      return 'consistent';
    }
  );
}
