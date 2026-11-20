/**
 * Notification-type precedence for Q-Chat group posts.
 *
 * A single post can match several notification kinds at once: a reply that also
 * mentions the reader, a mention that also matches "all messages", and so on.
 * Each post must produce **at most one** OS notification, and it must be the
 * most specific kind that applies. Emitting one per matched kind produced two
 * notifications for one post whenever the push level was "all".
 *
 * This module holds **two** orderings, and they are deliberately different:
 *
 * 1. `RETICULUM_NOTIFICATION_PRECEDENCE` — which kind the *emitter* is
 *    allowed to produce for a post, most specific first:
 *
 *        reply  >  mention  >  message
 *
 *    Reactions are a different event type (`reaction_add`) and are not in this
 *    list — a reaction is never also a message, so it never competes here. The
 *    emitter in `Group.tsx` evaluates these in order and stops at the first
 *    kind that fires.
 *
 * 2. `OS_NOTIFICATION_PRECEDENCE` — which kind the *OS-presentation gate*
 *    allows when several handlers fire for the same post, most specific first:
 *
 *        reply  >  welcome  >  mention  >  reaction  >  message
 *
 *    This list is longer because it has to arbitrate between handlers that
 *    cover event types the emitter list does not contain. `welcome` and
 *    `reaction` exist only here.
 *
 * The distinction matters: reading list 1 as the module's only ordering makes
 * the gate look wrong, and reading list 2 as the emitter's ordering makes it
 * look like reactions compete with messages. Neither is the case.
 *
 * This module exists because the ordering was previously implicit in nested
 * booleans, and one of the guards read variables that were only assigned inside
 * an earlier branch — so "skipped" and "not applicable" were indistinguishable,
 * and the generic notification fired alongside the specific one.
 */

export type ReticulumNotificationKind = 'reply' | 'mention' | 'message';

/** Highest precedence first. */
export const RETICULUM_NOTIFICATION_PRECEDENCE: readonly ReticulumNotificationKind[] =
  ['reply', 'mention', 'message'];

export interface NotificationKindContext {
  /** The post is a message (not an edit, delete, or reaction). */
  isMessage: boolean;
  /** The author is someone other than the reader. */
  isFromOther: boolean;
  /** The reader's own address is known. */
  hasMyAddress: boolean;
  /**
   * The post replies to a message authored by the reader, AND a reply
   * notification is permitted (settings allow it, channel not muted, and the
   * caller did not suppress reply lookups).
   */
  isReplyToMe: boolean;
  /**
   * The post mentions the reader directly, or via `@everyone` / `@here` where
   * the reader is authorised to receive it — AND a mention notification is
   * permitted.
   */
  isMentionOfMe: boolean;
}

/**
 * The single notification kind to emit for this post, or `null` for none.
 *
 * Returns the most specific applicable kind. Callers must emit exactly one
 * notification for the returned kind and none for the others.
 */
export function resolveReticulumNotificationKind(
  context: NotificationKindContext
): ReticulumNotificationKind | null {
  if (!context.isMessage || !context.isFromOther || !context.hasMyAddress) {
    return null;
  }
  if (context.isReplyToMe) return 'reply';
  if (context.isMentionOfMe) return 'mention';
  return 'message';
}

/**
 * True when a generic "someone posted" notification should be emitted.
 *
 * The generic kind is the fallback: it applies only when no more specific kind
 * does. Expressed as a separate predicate because that is the bug's shape —
 * the generic emitter needs to know about *every* higher kind, not just the
 * ones whose flag variables happen to be in scope.
 */
export function shouldEmitGenericMessageNotification(
  context: NotificationKindContext
): boolean {
  return resolveReticulumNotificationKind(context) === 'message';
}

/**
 * The kind to emit, given what the emitter *actually did* rather than what was
 * merely applicable.
 *
 * This mirrors the emitter in `Group.tsx` exactly, and exists because the
 * wiring there has now been wrong in both directions:
 *
 *   - Inferred "a mention happened" from flags assigned only inside the mention
 *     branch, so a skipped mention looked like no mention and the generic
 *     notification fired alongside the specific one (duplicates).
 *   - Set the "higher priority emitted" flag unconditionally after calling the
 *     mention recorder, which returns silently for a plain message, so ordinary
 *     posts lost their notification entirely.
 *
 * Both failures are invisible when the decision is spread across a 200-line
 * async callback. Here it is one pure function with both directions tested.
 */
export function resolveEmittedNotificationKind(params: {
  /** A reply notification was actually emitted. */
  replyEmitted: boolean;
  /** A mention notification was actually emitted. */
  mentionEmitted: boolean;
  /**
   * Mentions are suppressed for this post — e.g. a welcome post with welcome
   * notifications disabled. Suppression also suppresses the generic fallback:
   * the user asked not to be notified about this class of post at all.
   */
  suppressMention: boolean;
}): ReticulumNotificationKind | null {
  if (params.replyEmitted) return 'reply';
  if (params.mentionEmitted) return 'mention';
  if (params.suppressMention) return null;
  return 'message';
}

// ---------------------------------------------------------------------------
// OS-emission gate
// ---------------------------------------------------------------------------
//
// The functions above decide what `Group.tsx` *emits*. Everything below decides
// what `WebsocketNotifications` is allowed to *present*, and that is a separate
// question — it is where duplicates actually reached the desktop.
//
// The four handlers in `WebsocketNotifications.tsx` each owned a private
// "already notified this eventId" Set, and two of them (reply, reaction) never
// consulted the push-level settings at all. So:
//
//   - a mention under `pushLevel: 'all'` satisfied both the mention gate and the
//     generic-message gate, producing two OS notifications for one post;
//   - a reply fired even at `pushLevel: 'none'` with `notifyOnReplies: false`,
//     contradicting the emitter, which honours both.
//
// Both are fixed by making every handler ask the same question, and by keying
// the answer on the event rather than on the handler.

/** Every kind that can be presented to the OS, including the reaction kind. */
export type OsNotificationKind =
  | 'reply'
  | 'mention'
  | 'welcome'
  | 'reaction'
  | 'message';

/**
 * Higher wins. A post presents at most one of these.
 *
 * `welcome` sits above `mention` and `reaction`, below only `reply`.
 *
 * A welcome post self-mentions its author (so the post renders the joiner's
 * name), and it can also carry an `@everyone`. Placing `welcome` below `mention`
 * meant a reader with mention notifications on saw a *mention* notification for
 * a join — which contradicts any rule that says a join notice is a join notice.
 * There is now no combination that turns a welcome into a mention.
 */
export const OS_NOTIFICATION_PRECEDENCE: readonly OsNotificationKind[] = [
  'reply',
  'welcome',
  'mention',
  'reaction',
  'message',
];

export interface OsNotificationFacts {
  /** The post replies to a message authored by the reader. */
  isReplyToMe?: boolean;
  /** The post mentions the reader, or an @everyone/@here they may receive. */
  isMentionOfMe?: boolean;
  /** The mention was @everyone or @here rather than a direct ping. */
  isEveryoneOrHere?: boolean;
  /** The post is a reaction to a post authored by the reader. */
  isReactionToMe?: boolean;
  /** The post is a `group-welcome` notice announcing a new member. */
  isWelcomePost?: boolean;
}

export interface OsNotificationPolicy {
  pushLevel: string;
  suppressEveryoneHere: boolean;
  notifyOnReplies: boolean;
  notifyOnReactions: boolean;
  /**
   * `notifyOnWelcomePosts`. Absent is treated as enabled, matching the plan
   * module's `notifyOnWelcomePosts !== false` reading.
   */
  notifyOnWelcomePosts?: boolean;
}

/**
 * Which kinds the settings permit for this post, most specific first.
 *
 * Uses `shouldFirePushNotification` for all four kinds so a handler cannot
 * disagree with the settings — the bug in D2 was that two handlers never
 * called it. Duplicated here rather than imported to keep this module free of
 * imports (it is loaded by source in the scenario harness, like
 * `reticulumNotificationPlan.ts`); `reticulumNotificationPolicy.test.ts` asserts
 * the two implementations agree.
 */
export function permittedOsNotificationKinds(
  policy: OsNotificationPolicy,
  facts: OsNotificationFacts
): OsNotificationKind[] {
  const permitted: OsNotificationKind[] = [];

  // Reply — honours notifyOnReplies at every push level.
  if (facts.isReplyToMe === true && policy.notifyOnReplies) {
    permitted.push('reply');
  }

  // Mention — at 'all' or 'mentions'; the suppressEveryoneHere switch only
  // applies to @everyone/@here, never to a direct ping.
  if (facts.isMentionOfMe === true) {
    const everyoneSuppressed =
      policy.suppressEveryoneHere && facts.isEveryoneOrHere === true;
    if (
      !everyoneSuppressed &&
      (policy.pushLevel === 'all' || policy.pushLevel === 'mentions')
    ) {
      permitted.push('mention');
    }
  }

  // Welcome — "someone joined". Its own kind, gated by notifyOnWelcomePosts
  // rather than by the push level: the group-level switch is the specific
  // control the settings UI offers for it, and it applies at every level.
  if (facts.isWelcomePost === true && policy.notifyOnWelcomePosts !== false) {
    permitted.push('welcome');
  }

  // Reaction — a distinct event type; requires notifyOnReactions.
  if (facts.isReactionToMe === true && policy.notifyOnReactions) {
    permitted.push('reaction');
  }

  // Generic — the fallback, and only at push level 'all'.
  if (policy.pushLevel === 'all') {
    permitted.push('message');
  }

  return permitted;
}

/**
 * The single kind to present for this post, or `null` for none.
 *
 * Precedence is applied across *all* kinds, which is what makes a mention under
 * `pushLevel: 'all'` present the mention instead of also presenting the generic
 * message. This is the function every handler must agree on.
 */
export function resolveOsNotificationKind(
  policy: OsNotificationPolicy,
  facts: OsNotificationFacts
): OsNotificationKind | null {
  const permitted = permittedOsNotificationKinds(policy, facts);
  for (const kind of OS_NOTIFICATION_PRECEDENCE) {
    if (permitted.includes(kind)) return kind;
  }
  return null;
}

/**
 * True when a handler presenting `kind` is allowed to proceed.
 *
 * Handlers for the kinds that lost precedence must bail out here. Called by all
 * four handlers, so "two notifications for one post" requires two decision
 * sites to disagree — which they no longer can, because there is one.
 */
export function mayPresentOsNotification(
  policy: OsNotificationPolicy,
  facts: OsNotificationFacts,
  kind: OsNotificationKind
): boolean {
  return resolveOsNotificationKind(policy, facts) === kind;
}

/**
 * Claim tracker: at most one OS notification per event, across all handlers.
 *
 * Handlers run from independent DOM events, so precedence alone is not enough —
 * the losing handler must also be prevented from presenting if the winner has
 * already gone through. Claims are recorded per `eventId` and the first claim
 * wins; a later, more specific claim does not get to present a second time.
 *
 * Kept as a class so the state can be reset between tests and so the scenario
 * harness can share one instance.
 */
export class OsNotificationClaims {
  private readonly claimed = new Map<string, OsNotificationKind>();
  private readonly maxEntries: number;

  /**
   * No `constructor(private readonly maxEntries = 500)`: parameter properties
   * are TypeScript syntax that Node's strip-only type stripping rejects
   * (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), and this module has to stay loadable
   * by the scenario harness. Plain field assignment keeps it erasable.
   */
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  /** The kind already presented for this event, if any. */
  get(eventId: string): OsNotificationKind | undefined {
    return this.claimed.get(eventId);
  }

  /**
   * Claim the right to present `kind` for `eventId`.
   *
   * Returns true only the first time an event is claimed. A repeated claim —
   * same kind from a retried handler, or a different kind from a handler that
   * lost precedence — returns false.
   */
  claim(eventId: string, kind: OsNotificationKind): boolean {
    if (!eventId) return false;
    if (this.claimed.has(eventId)) return false;
    this.claimed.set(eventId, kind);
    this.prune();
    return true;
  }

  /**
   * Claim only if `kind` is the winner under precedence. Combines the settings
   * decision and the once-per-event rule in the order handlers need: decide,
   * then claim.
   */
  claimIfPermitted(
    eventId: string,
    policy: OsNotificationPolicy,
    facts: OsNotificationFacts,
    kind: OsNotificationKind
  ): boolean {
    if (!mayPresentOsNotification(policy, facts, kind)) return false;
    return this.claim(eventId, kind);
  }

  /** Release a claim so a genuine retry can present. */
  release(eventId: string): void {
    this.claimed.delete(eventId);
  }

  reset(): void {
    this.claimed.clear();
  }

  get size(): number {
    return this.claimed.size;
  }

  private prune(): void {
    if (this.claimed.size <= this.maxEntries) return;
    const excess = this.claimed.size - this.maxEntries;
    let removed = 0;
    for (const key of this.claimed.keys()) {
      if (removed >= excess) break;
      this.claimed.delete(key);
      removed += 1;
    }
  }
}

/**
 * Stable notification id for one event.
 *
 * Deliberately excludes the kind: `background.ts` used `Date.now()`, so the
 * main-process sink saw a fresh id on every call and its dedupe never engaged.
 * Keying on the event alone means a second emission for the same post replaces
 * the first entry instead of adding one.
 */
export function osNotificationIdForEvent(eventId: string): string {
  return `q-chat-${eventId}`;
}
