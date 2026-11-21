/**
 * Notification pipeline for scenarios.
 *
 * Replays the shipped decision path end to end without a renderer:
 *
 *   planReticulumNotifications  (the real module, type-stripped — not a copy)
 *     -> one of q-chat-{reply,mention,message}-notification
 *     -> the sink's suppression gate and registry
 *
 * `Group.tsx` allows at most one of reply / mention / message per post and
 * emits exactly one DOM event name accordingly; `WebsocketNotifications.tsx`
 * subscribes to those three names and hands the result to
 * `fireOsNotificationPayment`, which calls `window.reticulumChat.showNotification`.
 * This module stops at the same boundary and records what crossed it.
 *
 * The push-level gate is covered too, by `notification-push-gate`, via
 * {@link loadNotificationPolicy}. Its absence was a real gap: every other
 * notification scenario asserted on the plan and the sink, so a post that
 * reached two handlers produced two OS notifications with a green suite.
 *
 * Still NOT covered: per-channel mute storage and the OS presentation itself.
 */

const NOTIFICATION_PLAN_PATH = new URL(
  '../../src/components/Group/reticulumNotificationPlan.ts',
  import.meta.url
).pathname;

const NOTIFICATION_POLICY_PATH = new URL(
  '../../src/components/Group/reticulumNotificationPrecedence.ts',
  import.meta.url
).pathname;

/** The event names `Group.tsx` emits and `WebsocketNotifications` listens for. */
export const NOTIFICATION_EVENT_BY_KIND = {
  reply: 'q-chat-reply-notification',
  mention: 'q-chat-mention-notification',
  welcome: 'q-chat-welcome-notification',
  message: 'q-chat-message-notification',
};

let cachedPlanModule = null;

/**
 * The real `planReticulumNotifications`. Node strips the TypeScript types, so
 * scenarios exercise the shipping decision instead of a copy of it that could
 * drift.
 */
export async function loadNotificationPlan() {
  if (cachedPlanModule) return cachedPlanModule;
  cachedPlanModule = await import(NOTIFICATION_PLAN_PATH);
  if (typeof cachedPlanModule.planReticulumNotifications !== 'function') {
    throw new Error(
      `reticulumNotificationPlan.ts no longer exports planReticulumNotifications`
    );
  }
  return cachedPlanModule;
}

let cachedPolicyModule = null;

/**
 * The real `resolveOsNotificationKind` / `OsNotificationClaims` — the gate every
 * `WebsocketNotifications` handler calls.
 *
 * Loadable by type stripping for the same reason as the plan module: it imports
 * nothing. If that ever stops being true, this throws rather than silently
 * testing a stale copy.
 */
export async function loadNotificationPolicy() {
  if (cachedPolicyModule) return cachedPolicyModule;
  cachedPolicyModule = await import(NOTIFICATION_POLICY_PATH);
  if (typeof cachedPolicyModule.OsNotificationClaims !== 'function') {
    throw new Error(
      `reticulumNotificationPrecedence.ts no longer exports OsNotificationClaims`
    );
  }
  return cachedPolicyModule;
}

/**
 * Mirrors `authorizedReticulumBroadcastApplies` in Group.tsx, which is not
 * exported. Kept small and adjacent to the note above so it stays honest.
 */
export function authorizedBroadcastApplies(event, onlineSinceMs = 0) {
  if (event?.privilegedMentionAuthorized !== true) return false;
  const groupId = Number(event?.groupId);
  const channelId = String(event?.channelId || 'general');
  for (const target of event?.mentionTargets || []) {
    if (Number(target?.groupId) !== groupId) continue;
    if (target?.type === 'everyone') return true;
    if (
      target?.type === 'here' &&
      String(target?.channelId || channelId) === channelId &&
      Number(event?.timestamp || 0) >= onlineSinceMs
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Build the `NotificationPlanInput`/`Deps` pair the way `Group.tsx` builds it,
 * then run the real plan.
 *
 * @param {object} options
 * @param {object} options.event            a signed `ReticulumChatEvent`
 * @param {string} options.myAddress        the reader
 * @param {boolean} [options.recordMentionNotification]
 * @param {boolean} [options.notifyOnReplies]
 * @param {boolean} [options.channelMuted]
 * @param {(eventId: string) => Promise<string|null>} [options.lookupReplyParentAuthor]
 * @param {boolean} [options.isWelcomePost]
 * @param {boolean} [options.notifyOnWelcomePosts]
 */
export async function planForEvent(options) {
  const {
    event,
    myAddress,
    recordMentionNotification = true,
    notifyOnReplies = true,
    channelMuted = false,
    lookupReplyParentAuthor = async () => null,
    isWelcomePost = false,
    notifyOnWelcomePosts = true,
    onlineSinceMs = 0,
  } = options;

  const { planReticulumNotifications } = await loadNotificationPlan();

  return planReticulumNotifications(
    {
      isMessage: event?.eventType === 'message',
      isFromOther: event?.authorAddress !== myAddress,
      hasMyAddress: Boolean(myAddress),
      replyLookupAllowed: true,
      repliedToEventId: event?.replyToEventId || undefined,
      recordMentionNotification,
      isWelcomePost,
      notifyOnWelcomePosts,
    },
    {
      myAddress,
      lookupReplyParentAuthor,
      getNotifyOnReplies: async () => notifyOnReplies,
      isChannelMuted: async () => channelMuted,
      isAuthorizedBroadcast: () =>
        authorizedBroadcastApplies(event, onlineSinceMs),
      isDirectMention: () => event?.directMentionAuthorized === true,
    }
  );
}

/**
 * The event name `Group.tsx` would emit for this plan, or `null` for silence.
 * Derived from `plan.kind` so the scenario never re-implements the precedence.
 */
export function eventNameForPlan(plan) {
  if (!plan?.kind) return null;
  return NOTIFICATION_EVENT_BY_KIND[plan.kind] ?? null;
}

/**
 * Deliver a plan to the sink exactly as `fireOsNotificationPayment` would: one
 * `showNotification` call carrying the group context.
 *
 * Returns the sink's result, which reports suppression separately from
 * registration — the distinction the affected specs care about.
 */
export async function emitForPlan(sink, plan, event, options = {}) {
  const eventName = eventNameForPlan(plan);
  if (!eventName) return { emitted: false, eventName: null, result: null };

  const result = await sink.submit({
    title: options.title ?? 'Q-Chat',
    body: options.body ?? `notification for ${event.eventId}`,
    groupContext: {
      groupId: Number(event.groupId),
      channelId: String(event.channelId || 'general'),
    },
    eventId: event.eventId,
    notificationId: options.notificationId,
  });

  return { emitted: true, eventName, result };
}

/**
 * Full pipeline for one post: plan, then emit. Returns everything an assertion
 * might want.
 */
export async function notifyForEvent(sink, options) {
  const plan = await planForEvent(options);
  const emitted = await emitForPlan(sink, plan, options.event);
  return { plan, ...emitted };
}
