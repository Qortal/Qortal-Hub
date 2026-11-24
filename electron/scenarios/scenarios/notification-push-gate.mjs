/**
 * Replaces: "Push level 'Mentions' → only mention and reply produce anything."
 *
 * This is the scenario whose absence let the double-notification bug ship. Every
 * other notification scenario asserts on `planReticulumNotifications` and the
 * sink, which together guarantee *one event per post* — and that guarantee was
 * never the broken part. The duplication happened in
 * `WebsocketNotifications.tsx`, where four handlers each owned a private
 * "already notified this eventId" Set and two of them never consulted the
 * push-level settings at all.
 *
 * `reticulumNotificationPrecedence.ts` has no imports, so Node's type stripping
 * loads the shipping module here — the same trick `reticulumNotificationPlan.ts`
 * uses. What this asserts is therefore the real gate, not a copy of it.
 */

import {
  authorizedBroadcastApplies,
  loadMentionTitle,
  loadNotificationPolicy,
} from '../notifications.mjs';

const SETTINGS_ALL = {
  pushLevel: 'all',
  suppressEveryoneHere: false,
  notifyOnReplies: true,
  notifyOnReactions: true,
  notifyOnWelcomePosts: true,
};

const SETTINGS_MENTIONS = {
  pushLevel: 'mentions',
  suppressEveryoneHere: false,
  notifyOnReplies: true,
  notifyOnReactions: true,
  notifyOnWelcomePosts: true,
};

const SETTINGS_NONE = {
  pushLevel: 'none',
  suppressEveryoneHere: false,
  notifyOnReplies: false,
  notifyOnReactions: false,
  notifyOnWelcomePosts: true,
};

/**
 * Replay the four handlers in subscription order — mention, reply, reaction,
 * message — exactly as `WebsocketNotifications.tsx` does.
 *
 * The order matters: it is *not* precedence order, so this also proves the
 * claims object arbitrates by precedence rather than by whoever ran first.
 */
function replayHandlers(policyModule, settings, facts, eventId) {
  const claims = new policyModule.OsNotificationClaims();
  const presented = [];
  const attempt = (kind, reached) => {
    if (!reached) return;
    if (claims.claimIfPermitted(eventId, settings, facts, kind)) {
      presented.push(kind);
    }
  };

  attempt('mention', facts.isMentionOfMe === true);
  attempt('reply', facts.isReplyToMe === true);
  attempt('welcome', facts.isWelcomePost === true);
  attempt('reaction', facts.isReactionToMe === true);
  attempt('message', true);

  return presented;
}

export default {
  name: 'notification-push-gate',
  delivery: 'direct',
  timeoutMs: 30_000,

  async run(ctx) {
    const policy = await loadNotificationPolicy();

    await ctx.check('the policy module loaded the shipping gate', () => {
      for (const name of [
        'resolveOsNotificationKind',
        'permittedOsNotificationKinds',
        'OsNotificationClaims',
        'osNotificationIdForEvent',
      ]) {
        if (typeof policy[name] !== 'function') {
          throw new Error(
            `${name} missing from reticulumNotificationPrecedence`
          );
        }
      }
      return 'four exports present';
    });

    // ---- the reported bug -------------------------------------------------
    const mentionUnderAll = replayHandlers(
      policy,
      SETTINGS_ALL,
      { isMentionOfMe: true },
      'evt-gate-1'
    );

    await ctx.check(
      'a mention under "all messages" presents only the mention',
      () => {
        if (mentionUnderAll.length !== 1 || mentionUnderAll[0] !== 'mention') {
          throw new Error(`got ${JSON.stringify(mentionUnderAll)}`);
        }
        return 'mention only';
      }
    );

    const replyAndMention = replayHandlers(
      policy,
      SETTINGS_ALL,
      { isReplyToMe: true, isMentionOfMe: true },
      'evt-gate-2'
    );

    await ctx.check(
      'a reply that also mentions presents only the reply',
      () => {
        if (replyAndMention.length !== 1 || replyAndMention[0] !== 'reply') {
          throw new Error(`got ${JSON.stringify(replyAndMention)}`);
        }
        return 'reply only';
      }
    );

    // ---- plain posts still notify at "all" --------------------------------
    const plainUnderAll = replayHandlers(
      policy,
      SETTINGS_ALL,
      {},
      'evt-gate-3'
    );

    await ctx.check('a plain post under "all messages" presents once', () => {
      if (plainUnderAll.length !== 1 || plainUnderAll[0] !== 'message') {
        throw new Error(`got ${JSON.stringify(plainUnderAll)}`);
      }
      return 'message only';
    });

    // ---- "mentions" level --------------------------------------------------
    const plainUnderMentions = replayHandlers(
      policy,
      SETTINGS_MENTIONS,
      {},
      'evt-gate-4'
    );

    await ctx.check('a plain post under "mentions" presents nothing', () => {
      if (plainUnderMentions.length !== 0) {
        throw new Error(`got ${JSON.stringify(plainUnderMentions)}`);
      }
      return 'nothing';
    });

    const mentionUnderMentions = replayHandlers(
      policy,
      SETTINGS_MENTIONS,
      { isMentionOfMe: true },
      'evt-gate-5'
    );

    await ctx.check('a mention under "mentions" presents the mention', () => {
      if (
        mentionUnderMentions.length !== 1 ||
        mentionUnderMentions[0] !== 'mention'
      ) {
        throw new Error(`got ${JSON.stringify(mentionUnderMentions)}`);
      }
      return 'mention only';
    });

    // ---- "none" level ------------------------------------------------------
    const everythingUnderNone = replayHandlers(
      policy,
      SETTINGS_NONE,
      { isReplyToMe: true, isMentionOfMe: true, isReactionToMe: true },
      'evt-gate-6'
    );

    await ctx.check('"none" presents nothing even for reply+mention', () => {
      if (everythingUnderNone.length !== 0) {
        throw new Error(`got ${JSON.stringify(everythingUnderNone)}`);
      }
      return 'nothing';
    });

    // ---- reply and reaction no longer bypass their settings ---------------
    const replyWithRepliesOff = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnReplies: false },
      { isReplyToMe: true },
      'evt-gate-7'
    );

    await ctx.check(
      'a reply presents nothing when notifyOnReplies is off and level is "none"',
      () => {
        const emitted = replayHandlers(
          policy,
          { ...SETTINGS_NONE, notifyOnReplies: false },
          { isReplyToMe: true },
          'evt-gate-7b'
        );
        if (emitted.length !== 0) {
          throw new Error(`got ${JSON.stringify(emitted)}`);
        }
        return 'nothing';
      }
    );

    await ctx.check(
      'with replies off at "all", the reply degrades to the generic message',
      () => {
        // The post still matches "all messages", so one notification is correct.
        // Before the fix this path produced a reply notification that ignored
        // the setting entirely.
        if (
          replyWithRepliesOff.length !== 1 ||
          replyWithRepliesOff[0] !== 'message'
        ) {
          throw new Error(`got ${JSON.stringify(replyWithRepliesOff)}`);
        }
        return 'message only';
      }
    );

    const reactionWithReactionsOff = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnReactions: false },
      { isReactionToMe: true },
      'evt-gate-8'
    );

    await ctx.check(
      'a reaction with notifyOnReactions off does not present a reaction',
      () => {
        if (reactionWithReactionsOff.includes('reaction')) {
          throw new Error(`got ${JSON.stringify(reactionWithReactionsOff)}`);
        }
        return 'reaction suppressed';
      }
    );

    // ---- welcome is its own kind, between mention and reaction -------------
    const welcome = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnWelcomePosts: true },
      { isWelcomePost: true },
      'evt-gate-welcome'
    );

    await ctx.check(
      'a join notice presents the welcome kind, not a post',
      () => {
        if (welcome.length !== 1 || welcome[0] !== 'welcome') {
          throw new Error(`got ${JSON.stringify(welcome)}`);
        }
        return 'welcome only';
      }
    );

    const welcomeBeatsReaction = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnWelcomePosts: true },
      { isWelcomePost: true, isReactionToMe: true },
      'evt-gate-welcome-rxn'
    );

    await ctx.check('welcome sits above reaction in the hierarchy', () => {
      if (
        welcomeBeatsReaction.length !== 1 ||
        welcomeBeatsReaction[0] !== 'welcome'
      ) {
        throw new Error(`got ${JSON.stringify(welcomeBeatsReaction)}`);
      }
      return 'welcome beats reaction';
    });

    const welcomeBeatsMention = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnWelcomePosts: true },
      { isWelcomePost: true, isMentionOfMe: true },
      'evt-gate-welcome-mention'
    );

    await ctx.check('welcome sits above mention', () => {
      // A welcome post self-mentions its author so the post shows the joiner's
      // name. With mention above welcome, a reader who has mention notifications
      // on received a mention notification for someone joining instead.
      if (
        welcomeBeatsMention.length !== 1 ||
        welcomeBeatsMention[0] !== 'welcome'
      ) {
        throw new Error(`got ${JSON.stringify(welcomeBeatsMention)}`);
      }
      return 'welcome beats mention';
    });

    const welcomeBeatsEveryone = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnWelcomePosts: true },
      { isWelcomePost: true, isMentionOfMe: true, isEveryoneOrHere: true },
      'evt-gate-welcome-everyone'
    );

    await ctx.check('welcome sits above an @everyone mention too', () => {
      if (
        welcomeBeatsEveryone.length !== 1 ||
        welcomeBeatsEveryone[0] !== 'welcome'
      ) {
        throw new Error(`got ${JSON.stringify(welcomeBeatsEveryone)}`);
      }
      return 'welcome beats @everyone';
    });

    const welcomeOff = replayHandlers(
      policy,
      { ...SETTINGS_ALL, notifyOnWelcomePosts: false },
      { isWelcomePost: true },
      'evt-gate-welcome-off'
    );

    await ctx.check(
      'notifyOnWelcomePosts: false suppresses the join kind',
      () => {
        if (welcomeOff.includes('welcome')) {
          throw new Error(`got ${JSON.stringify(welcomeOff)}`);
        }
        return 'welcome suppressed';
      }
    );

    // ---- suppressEveryoneHere never silences a direct mention --------------
    // `isEveryoneOrHere` is set by the producer from the broadcast scope, and
    // the producer clears it when the reader was also @-mentioned by name. These
    // two cases lock the contract from the gate's side: the setting only
    // applies when the broadcast is the reader's sole claim.
    const SETTINGS_MENTIONS_SUPPRESS = {
      pushLevel: 'mentions',
      suppressEveryoneHere: true,
      notifyOnReplies: true,
      notifyOnReactions: true,
      notifyOnWelcomePosts: true,
    };

    const directMentionAlongsideEveryone = replayHandlers(
      policy,
      SETTINGS_MENTIONS_SUPPRESS,
      // The producer saw a direct ping and cleared the flag.
      { isMentionOfMe: true, isEveryoneOrHere: false },
      'evt-gate-suppress-direct-mention'
    );

    await ctx.check(
      'suppressEveryoneHere does not silence a post that also named the reader',
      () => {
        if (directMentionAlongsideEveryone.length !== 1) {
          throw new Error(
            `got ${JSON.stringify(directMentionAlongsideEveryone)}`
          );
        }
        if (directMentionAlongsideEveryone[0] !== 'mention') {
          throw new Error(
            `got ${JSON.stringify(directMentionAlongsideEveryone)}`
          );
        }
        return 'direct mention still notifies';
      }
    );

    const broadcastOnlyEveryone = replayHandlers(
      policy,
      SETTINGS_MENTIONS_SUPPRESS,
      { isMentionOfMe: true, isEveryoneOrHere: true },
      'evt-gate-suppress-broadcast-only'
    );

    await ctx.check(
      'suppressEveryoneHere still silences a broadcast-only mention',
      () => {
        if (broadcastOnlyEveryone.includes('mention')) {
          throw new Error(`got ${JSON.stringify(broadcastOnlyEveryone)}`);
        }
        return 'broadcast suppressed';
      }
    );

    // ---- the shipping scope rule drives the gate, not a harness copy -------
    // `authorizedBroadcastApplies` in notifications.mjs resolves through
    // `reticulumMentionNotificationTitle.ts` by type stripping, so a change to
    // the scope rule cannot leave this suite green while the gate and the title
    // diverge. Everything is awaited before the checks so the assertions stay
    // synchronous like the rest of this file.
    const mentionTitle = await loadMentionTitle();

    const everyoneEvent = {
      privilegedMentionAuthorized: true,
      groupId: 716,
      channelId: 'general',
      timestamp: 2_000_000,
      mentionTargets: [{ type: 'everyone', groupId: 716 }],
    };
    const everyoneApplies = await authorizedBroadcastApplies(
      everyoneEvent,
      1_000_000
    );
    const everyoneScope = mentionTitle.mentionBroadcastScope({
      privilegedMentionAuthorized: true,
      groupId: 716,
      channelId: 'general',
      timestamp: 2_000_000,
      onlineSinceMs: 1_000_000,
      mentionTargets: everyoneEvent.mentionTargets,
    });
    const otherChannelHereApplies = await authorizedBroadcastApplies(
      {
        ...everyoneEvent,
        mentionTargets: [{ type: 'here', groupId: 716, channelId: 'random' }],
      },
      1_000_000
    );
    const staleHereApplies = await authorizedBroadcastApplies(
      {
        ...everyoneEvent,
        timestamp: 500_000,
        mentionTargets: [{ type: 'here', groupId: 716, channelId: 'general' }],
      },
      1_000_000
    );

    await ctx.check(
      'an authorized @everyone resolves to a scope, so the gate opens',
      () => {
        if (everyoneApplies !== true) throw new Error(`got ${everyoneApplies}`);
        if (everyoneScope !== 'everyone')
          throw new Error(`scope ${everyoneScope}`);
        return 'scope=everyone';
      }
    );

    await ctx.check(
      'an @here for another channel is not treated as a broadcast',
      () => {
        if (otherChannelHereApplies !== false) {
          throw new Error(`got ${otherChannelHereApplies}`);
        }
        return 'not a broadcast';
      }
    );

    await ctx.check(
      'an @here older than this session is not treated as a broadcast',
      () => {
        if (staleHereApplies !== false) {
          throw new Error(`got ${staleHereApplies}`);
        }
        return 'stale @here ignored';
      }
    );

    await ctx.check('the title key and target follow the scope', () => {
      const cases = [
        [null, 'reticulum:notification.mention_you_in_group'],
        ['here', 'reticulum:notification.mention_special_in_group'],
        ['everyone', 'reticulum:notification.mention_special_in_group'],
      ];
      for (const [scope, expected] of cases) {
        const key = mentionTitle.mentionTitleKey(scope);
        if (key !== expected) throw new Error(`${scope} -> ${key}`);
      }
      if (mentionTitle.mentionTitleTarget('here') !== '@here') {
        throw new Error('here target');
      }
      if (mentionTitle.mentionTitleTarget('everyone') !== '@everyone') {
        throw new Error('everyone target');
      }
      return 'keys and targets match the scope';
    });

    // ---- once per event, even if the same event arrives twice --------------
    const claims = new policy.OsNotificationClaims();
    const facts = { isMentionOfMe: true };
    const first = claims.claimIfPermitted(
      'evt-gate-dup',
      SETTINGS_ALL,
      facts,
      'mention'
    );
    const second = claims.claimIfPermitted(
      'evt-gate-dup',
      SETTINGS_ALL,
      facts,
      'mention'
    );

    await ctx.check('the same event cannot present twice', () => {
      if (first !== true || second !== false) {
        throw new Error(`first=${first} second=${second}`);
      }
      return 'claimed once';
    });

    // ---- the id is stable, so the main-process sink can dedupe -------------
    await ctx.check('the notification id is stable per event', () => {
      const a = policy.osNotificationIdForEvent('evt-gate-id');
      const b = policy.osNotificationIdForEvent('evt-gate-id');
      if (a !== b) throw new Error(`${a} !== ${b}`);
      return a;
    });
  },
};
