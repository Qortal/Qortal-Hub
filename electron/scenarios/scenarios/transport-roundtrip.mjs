/**
 * End-to-end transport round trip: publish, notice, fetch, store.
 *
 * Unlike `group-message-roundtrip` (which declares `delivery: 'direct'`), this
 * scenario never bypasses the transport. Identity A publishes; the notice, the
 * event request, the offer and the resource fetch all go through the fake
 * bridge. A failure here means the transport path is broken, not the assertion.
 *
 * What it proves: the send path, the notice, the resource handshake, and the
 * receive path agree with each other well enough for an event body to land in
 * the recipient's database.
 *
 * What it does NOT prove: real Reticulum framing, link auth against a real
 * provider, or byte-range assembly for oversized events. The fake copies bytes.
 */

import { join } from 'node:path';

export default {
  name: 'transport-roundtrip',
  delivery: 'resource',
  timeoutMs: 40_000,

  async run(ctx) {
    const GROUP = 716;

    const alice = ctx.makeIdentity({ label: 'alice' });
    const bob = ctx.makeIdentity({ label: 'bob' });
    const router = ctx.createRouter();

    const aliceBridge = router.register(alice);
    const bobBridge = router.register(bob);
    ctx.checkBridgeContract(aliceBridge);
    ctx.checkBridgeContract(bobBridge);

    const aliceManager = ctx.makeManager({
      identity: alice,
      bridge: aliceBridge,
      dbPath: join(ctx.workDir, 'alice.db'),
      canSign: true,
    });
    const bobManager = ctx.makeManager({
      identity: bob,
      bridge: bobBridge,
      dbPath: join(ctx.workDir, 'bob.db'),
      canSign: true,
    });
    ctx.onCleanup(() => {
      try {
        aliceManager.close();
      } catch {}
      try {
        bobManager.close();
      } catch {}
    });

    // The fake needs each identity's manager so it can deliver resource-auth
    // requests the way the real bridge does — not over a wire.
    router.attachManager(alice, aliceManager);
    router.attachManager(bob, bobManager);

    ctx.joinGroup(aliceManager, GROUP);
    ctx.joinGroup(bobManager, GROUP);
    ctx.exchangeSubscriptions(aliceManager, bobManager);
    await ctx.settle(300);

    const event = ctx.signEvent(alice, ctx.chat, {
      groupId: GROUP,
      channelId: 'general',
    });

    await ctx.check('alice publishes the event locally', async () => {
      const result = await aliceManager.publishEvent(event);
      if (result?.ok !== true) throw new Error(JSON.stringify(result));
      const ids = ctx.historyIds(aliceManager, GROUP);
      if (!ids.includes(event.eventId)) throw new Error('not stored locally');
      return event.eventId;
    });

    await ctx.check('the publish sent at least one wire to bob', () => {
      if (router.stats.delivered === 0) {
        throw new Error('router delivered nothing');
      }
      return `${router.stats.delivered} wire(s)`;
    });

    // The reader does not pull immediately. It first tries a linked event
    // request and only falls back to a plain pull after
    // RETICULUM_CHAT_LINKED_EVENT_FALLBACK_GRACE_MS (8s), or
    // RETICULUM_CHAT_LINKED_EVENT_ACTIVITY_STALE_MS (4s) of inactivity, with a
    // hard cap at 12s. Waiting less than that looks like "the transport is
    // broken" when it is really "the reader is being patient".
    const PULL_WINDOW_MS = 16_000;

    await ctx.check(
      'bob eventually requests and receives the event body',
      async () => {
        const deadline = Date.now() + PULL_WINDOW_MS;
        while (Date.now() < deadline) {
          if (router.stats.resourceReceived > 0) break;
          await ctx.settle(250);
        }
        if (router.stats.resourceReceived === 0) {
          throw new Error(
            `no resource accepted within ${PULL_WINDOW_MS}ms ` +
              `(offers=${router.stats.resourceOffers}, delivered=${router.stats.delivered})`
          );
        }
        return `${router.stats.resourceReceived} resource(s) received`;
      }
    );

    await ctx.check('bob stores the event body in history', async () => {
      const deadline = Date.now() + 6_000;
      let ids = ctx.historyIds(bobManager, GROUP);
      while (!ids.includes(event.eventId) && Date.now() < deadline) {
        await ctx.settle(250);
        ids = ctx.historyIds(bobManager, GROUP);
      }
      if (!ids.includes(event.eventId)) {
        throw new Error(
          `bob stored: ${ids.join(',') || 'none'} (offers=${router.stats.resourceOffers}, received=${router.stats.resourceReceived}, delivered=${router.stats.delivered})`
        );
      }
      return `${ids.length} event(s)`;
    });

    await ctx.check(
      'the event was stored by both identities independently',
      () => {
        const aliceIds = ctx.historyIds(aliceManager, GROUP);
        const bobIds = ctx.historyIds(bobManager, GROUP);
        if (
          !aliceIds.includes(event.eventId) ||
          !bobIds.includes(event.eventId)
        ) {
          throw new Error('not stored on both sides');
        }
        return `alice=${aliceIds.length} bob=${bobIds.length}`;
      }
    );
  },
};
