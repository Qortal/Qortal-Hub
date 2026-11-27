/**
 * Direct-injection scenarios and the harness self-test.
 *
 * This scenario proves the harness itself works: two identities, real SQLite,
 * real signing, real receive path. It uses `deliverEventDirect` because the
 * transport round trip needs the resource-transfer fake (design D7, task group
 * 4) — see `delivery` below.
 *
 * Declared `delivery: 'direct'` so it is never mistaken for transport coverage.
 */

import { join } from 'node:path';

export default {
  name: 'group-message-roundtrip',
  delivery: 'direct',

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
    });
    ctx.onCleanup(() => {
      try {
        aliceManager.close();
      } catch {}
      try {
        bobManager.close();
      } catch {}
    });

    ctx.joinGroup(aliceManager, GROUP);
    ctx.joinGroup(bobManager, GROUP);

    await ctx.check(
      'two identities have distinct addresses and databases',
      () => {
        if (alice.address === bob.address) throw new Error('addresses collide');
        if (alice.presence === bob.presence)
          throw new Error('presence collides');
        return `${alice.address.slice(0, 6)} vs ${bob.address.slice(0, 6)}`;
      }
    );

    await ctx.check('alice stores her own published event', async () => {
      const event = ctx.signEvent(alice, ctx.chat, { groupId: GROUP });
      const result = await aliceManager.publishEvent(event);
      if (result?.ok !== true) throw new Error(JSON.stringify(result));
      const ids = ctx.historyIds(aliceManager, GROUP);
      if (!ids.includes(event.eventId)) {
        throw new Error(`stored ids: ${ids.join(',') || 'none'}`);
      }
      return event.eventId;
    });

    await ctx.check('bob accepts a directly delivered event', async () => {
      const event = ctx.signEvent(alice, ctx.chat, { groupId: GROUP });
      const received = ctx.waitForEvent(
        bobManager,
        (e) => e?.eventId === event.eventId
      );
      const accepted = await ctx.deliverEventDirect(bobManager, event, alice);
      if (!accepted) throw new Error('acceptEvent returned false');
      const observed = await received;
      if (!observed) throw new Error('accepted but never emitted to the UI');
      return observed.eventId;
    });

    await ctx.check('bob stores the delivered event in history', async () => {
      const event = ctx.signEvent(alice, ctx.chat, { groupId: GROUP });
      const accepted = await ctx.deliverEventDirect(bobManager, event, alice);
      if (!accepted) throw new Error('acceptEvent returned false');
      await ctx.settle(200);
      const ids = ctx.historyIds(bobManager, GROUP);
      if (!ids.includes(event.eventId)) {
        throw new Error(`bob stored: ${ids.join(',') || 'none'}`);
      }
      return `${ids.length} event(s)`;
    });

    await ctx.check(
      'an event signed by the wrong key is rejected',
      async () => {
        const event = ctx.signEvent(alice, ctx.chat, { groupId: GROUP });
        // Overwrite the signature with one made by bob.
        const forged = ctx.signEvent(bob, ctx.chat, {
          groupId: GROUP,
          eventId: event.eventId,
        });
        forged.authorAddress = alice.address;
        forged.authorPublicKey = alice.publicKey;
        const result = await aliceManager.publishEvent(forged);
        if (result?.ok === true)
          throw new Error('accepted a forged authorship');
        return String(result?.error ?? result?.reason ?? 'rejected');
      }
    );

    await ctx.check(
      'the router reports unknown peers instead of dropping silently',
      async () => {
        const result = await aliceBridge.sendReticulumChatDetailed(
          'f'.repeat(32),
          { k: 'x' }
        );
        if (result?.ok !== false) throw new Error(JSON.stringify(result));
        if (result.reason !== 'unknown-peer-presence-hash') {
          throw new Error(`unexpected reason ${result.reason}`);
        }
        return result.reason;
      }
    );

    await ctx.check(
      'bridge contract lists the surface the manager uses',
      () => {
        const required = [
          'getState',
          'getLocalDestinationHash',
          'sendReticulumChatDetailed',
          'sendReticulumChatTargetsDetailed',
          'fanoutReticulumChatDetailed',
          'sendReticulumChatResourceDetailed',
          'configureReticulumChatPinnedPeers',
        ];
        const missing = required.filter(
          (name) => typeof aliceBridge[name] !== 'function'
        );
        if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
        return `${required.length} methods`;
      }
    );
  },
};
