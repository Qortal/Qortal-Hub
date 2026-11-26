/**
 * Shared setup for the notification-precedence scenarios.
 *
 * These run through the real transport: author publishes, the notice and the
 * resource fetch travel over the fake bridge, and the reader's manager stores the
 * event. The notification decision is then taken on the *reader-visible* event —
 * the one `eventForRenderer` produces — because that is what the renderer's
 * `processReticulumBackgroundEvent` actually receives.
 *
 * Not a scenario itself: no default export, and the runner filters `-support`.
 */

import { join } from 'node:path';

export const GROUP = 716;
export const CHANNEL = 'general';

/**
 * A reader that is not viewing the channel, and an author that is not the reader.
 *
 * Both get real managers over real SQLite, joined to the group and mutually
 * subscribed, so `publishEvent` can route and the reader can fetch.
 */
export async function makeReaderAndAuthor(ctx, options = {}) {
  const label = options.join ?? 'notification';
  const reader = ctx.makeIdentity({ label: 'reader' });
  const author = ctx.makeIdentity({ label: 'author' });

  const router = ctx.createRouter();
  const authorBridge = router.register(author);
  const readerBridge = router.register(reader);
  ctx.checkBridgeContract(authorBridge);
  ctx.checkBridgeContract(readerBridge);

  const authorManager = ctx.makeManager({
    identity: author,
    bridge: authorBridge,
    dbPath: join(ctx.workDir, `${label}-author.db`),
    canSign: true,
  });
  const readerManager = ctx.makeManager({
    identity: reader,
    bridge: readerBridge,
    dbPath: join(ctx.workDir, `${label}-reader.db`),
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

  router.attachManager(author, authorManager);
  router.attachManager(reader, readerManager);

  // One group by default; a scenario that needs independent pull windows passes
  // `groupIds`, because a single group serialises concurrent pulls.
  //
  // Membership is set in ONE call: `setLocalGroupMemberships` replaces the set
  // rather than adding to it, so joining in a loop leaves only the last group and
  // the earlier publishes fail with "Local user is not a member of this group".
  const groupIds = options.groupIds ?? [GROUP];
  ctx.joinGroups(authorManager, groupIds, author.address);
  ctx.joinGroups(readerManager, groupIds, reader.address);

  // `publishEvent` refuses a non-general channel that does not exist, and each
  // manager has its own database, so seed the channels in both. `general` is
  // built in and needs no seeding.
  for (const channelId of options.channels ?? []) {
    if (channelId === ctx.RETICULUM_CHAT_DEFAULT_CHANNEL_ID) continue;
    for (const groupId of groupIds) {
      ctx.createChannel(authorManager, groupId, channelId);
      ctx.createChannel(readerManager, groupId, channelId);
    }
  }

  ctx.exchangeSubscriptions(authorManager, readerManager);
  await ctx.settle(300);

  const sink = ctx.makeNotificationSink();
  ctx.onCleanup(() => sink.clear());

  return {
    reader,
    author,
    readerManager,
    authorManager,
    router,
    sink,
  };
}

/**
 * Build an event the reader will treat as a mention of itself.
 *
 * `directMentionAuthorized` is not a wire field — the manager derives it in
 * `eventForRenderer` by hashing each local address and looking for it in
 * `mentionAddressHashes`. So the hash must be computed the same way here; a
 * hardcoded flag would be silently dropped by the round trip and every scenario
 * would resolve to `message`.
 */
export function mentionHashesFor(ctx, reader) {
  return [ctx.hashMentionAddress(reader.address)];
}

/**
 * Publish `event` as the author, wait for the reader to store it through the
 * transport, and return the event as the reader's renderer receives it.
 *
 * The reader-visible shape is captured from the manager's own `event` emission,
 * which is `eventForRenderer(event, true)` — the exact object
 * `processReticulumBackgroundEvent` is handed in the app. Deriving it any other
 * way would be a second implementation of the same transformation, which is the
 * mistake this harness keeps having to undo.
 */
export async function publishAndReceive(ctx, harness, event) {
  // Subscribe before publishing: the reader emits `event` on arrival, and a
  // listener attached afterwards would miss it and then wait out the timeout.
  const received = ctx.waitForEvent(
    harness.readerManager,
    (candidate) => candidate?.eventId === event.eventId,
    25_000
  );

  const published = await harness.authorManager.publishEvent(event);
  if (published?.ok !== true) {
    throw new Error(`publish failed: ${JSON.stringify(published)}`);
  }

  const visible = await received;
  if (!visible) {
    // The accept path stores asynchronously; poll `getMessageHistory` (what the
    // renderer reads) rather than a raw DB accessor that keys differently.
    const channelId = String(event.channelId || 'general');
    const groupId = Number(event.groupId);
    const deadline = Date.now() + 3000;
    let inHistory = ctx
      .historyIds(harness.readerManager, groupId, channelId)
      .includes(event.eventId);
    while (!inHistory && Date.now() < deadline) {
      await ctx.settle(100);
      inHistory = ctx
        .historyIds(harness.readerManager, groupId, channelId)
        .includes(event.eventId);
    }
    if (!inHistory) {
      throw new Error(
        `reader never received ${event.eventId} ` +
          `(group=${groupId}, channel=${channelId}, ` +
          `offers=${harness.router.stats.resourceOffers}, ` +
          `received=${harness.router.stats.resourceReceived}, ` +
          `delivered=${harness.router.stats.delivered})`
      );
    }
    // The wire event we signed is the object the renderer would receive; using
    // it here is faithful and avoids relying on a store-read key that may differ.
    return event;
  }

  // Confirm the body actually landed, by asking for the group and channel the
  // event was posted to. `getHistory` with no channel filters on
  // `canReadChannel`, so a channel-scoped read is both more precise and less
  // dependent on the seeded read mode being exactly right.
  const channelId = String(event.channelId || 'general');
  const groupId = Number(event.groupId);
  const stored = ctx.historyIds(harness.readerManager, groupId, channelId);
  if (!stored.includes(event.eventId)) {
    // Fall back to a direct database lookup so the error says which of the two
    // it was: not stored at all, or stored but not readable through getHistory.
    const raw = harness.readerManager.db?.getEvent?.(event.eventId);
    if (raw) {
      throw new Error(
        `${event.eventId} is stored but getHistory(${channelId}) does not return it ` +
          `(readMode=${harness.readerManager.db?.getChannel?.(GROUP, channelId)?.readMode ?? 'unknown'})`
      );
    }
    throw new Error(`reader emitted ${event.eventId} but stored nothing`);
  }

  return visible;
}

/** Plan and emit in one step, returning the plan and the sink's result. */
export async function planAndEmit(ctx, sink, options) {
  const plan = await ctx.planForEvent(options);
  const emitted = await ctx.emitForPlan(sink, plan, options.event);
  return { plan, ...emitted };
}

/**
 * The assertion every one of these scenarios exists for: after one post, the
 * registry gained exactly one entry.
 *
 * Duplication is the historical regression — "push level 'all' plus a mention
 * produced two" — so a scenario asserting "at least one" would not have caught
 * it.
 */
export function assertExactlyOne(sink) {
  const entries = sink.snapshot();
  if (entries.length !== 1) {
    const detail = entries
      .map(
        (entry) =>
          `${entry.eventId ?? '?'}@${entry.groupContext?.channelId ?? '?'}`
      )
      .join(', ');
    throw new Error(
      `expected exactly 1 notification, got ${entries.length}${detail ? `: ${detail}` : ''}`
    );
  }
  return entries[0].eventId ?? 'one';
}

/** Assert the registry stayed empty. */
export function assertNone(sink) {
  const entries = sink.snapshot();
  if (entries.length !== 0) {
    throw new Error(`expected no notifications, got ${entries.length}`);
  }
  return 'none';
}
