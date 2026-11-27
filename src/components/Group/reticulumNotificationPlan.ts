/**
 * Decides which notifications a single Reticulum group post should emit.
 *
 * This exists because the same decision, implemented inline in
 * `processReticulumBackgroundEvent`, has been wrong three times in a row:
 *
 *   1. The generic notification's guard inferred "a mention was notified" from
 *      `authorizedBroadcast` / `directMention`, which were assigned only inside
 *      the mention branch. A skipped mention therefore looked identical to no
 *      mention, and the generic notification fired alongside the specific one —
 *      two notifications for one post.
 *   2. Setting the flag unconditionally after calling the mention recorder fixed
 *      the duplicate but suppressed the generic notification for *every* plain
 *      post, because that recorder returns silently when the reader is not in
 *      the mentioned-address list.
 *   3. Rewriting a comment above the flag declarations deleted
 *      `replyNotificationEmitted` while leaving three references to it, which
 *      threw `ReferenceError` at runtime.
 *
 * Each failure was invisible because the logic lived inside a 200-line async
 * callback in a 6k-line component, with no test able to reach it. The decision
 * is now a plain function over injected dependencies: the async lookups are
 * parameters, so the whole sequence is deterministic and testable.
 *
 * Invariant: at most one of `reply` / `mention` / `welcome` / `message` is true.
 */

export type ReticulumNotificationKind =
  | 'reply'
  | 'mention'
  | 'welcome'
  | 'message';

export interface NotificationPlanInput {
  /** The post is a message (not an edit, delete, reaction, or metadata event). */
  isMessage: boolean;
  /** The post was authored by someone other than the reader. */
  isFromOther: boolean;
  /** The reader's own address is known. */
  hasMyAddress: boolean;
  /**
   * `eventType === 'message' && !skipReplyNotification`.
   *
   * Distinct from `isMessage`: the reply branch additionally requires that the
   * caller has not suppressed reply lookups (history replay does).
   */
  replyLookupAllowed: boolean;
  /**
   * The event this post replies to, or `undefined` when it is not a reply.
   *
   * A single value rather than a boolean plus a separate id: having both let
   * them disagree, which is how the reply branch became unreachable in the
   * first version of this function.
   */
  repliedToEventId?: string;
  /**
   * Whether this post may produce a notification at all. False for history
   * replay, which must not replay old posts as notifications.
   *
   * Despite the name only the mention branch is specifically about mentions:
   * `welcome` and the generic `message` require it too. History replay is the
   * reason all three do — the startup replay never sets this option, so any
   * branch that ignores it resurrects old posts as OS notifications on every
   * launch.
   */
  recordMentionNotification: boolean;
  /** A welcome post with welcome-post notifications disabled. */
  isWelcomePost: boolean;
  /** The group's `notifyOnWelcomePosts` setting. */
  notifyOnWelcomePosts: boolean;
}

export interface NotificationPlanDeps {
  /** Author address of the message this post replies to, or `null` if unknown. */
  lookupReplyParentAuthor: (repliedToEventId: string) => Promise<string | null>;
  /** Replies ↔ settings: `notifyOnReplies` for this channel. */
  getNotifyOnReplies: () => Promise<boolean>;
  /** Whether the channel is muted for this reader. */
  isChannelMuted: () => Promise<boolean>;
  /** `authorizedReticulumBroadcastApplies(event)` — an `@everyone`-style broadcast. */
  isAuthorizedBroadcast: () => boolean;
  /** `event.directMentionAuthorized === true` — a mention the reader may receive. */
  isDirectMention: () => boolean;
  /** The reader's own address. */
  myAddress: string;
}

export interface NotificationPlan {
  /** Emit a reply notification. */
  reply: boolean;
  /** Emit a mention notification. */
  mention: boolean;
  /** Emit a "member joined" notification for a welcome post. */
  welcome: boolean;
  /** Emit the generic "posted in channel" notification. */
  message: boolean;
  /**
   * The single kind to emit, or `null` for none. Derived from the booleans
   * above; present so callers cannot accidentally emit two.
   *
   * Precedence, most specific first:
   *
   *   reply > welcome > mention > message
   */
  kind: ReticulumNotificationKind | null;
  /** True when a welcome post had mention notifications suppressed. */
  suppressMention: boolean;
  /** Broadcast/mention flags, returned because the caller reuses them. */
  authorizedBroadcast: boolean;
  directMention: boolean;
}

const EMPTY_PLAN: NotificationPlan = {
  reply: false,
  mention: false,
  welcome: false,
  message: false,
  kind: null,
  suppressMention: false,
  authorizedBroadcast: false,
  directMention: false,
};

/**
 * Resolve the emission plan for one post.
 *
 * Ordering is reply → mention → message, most specific first. The first
 * applicable kind wins and the rest are suppressed, so a post that replies *and*
 * mentions emits exactly one reply notification.
 */
export async function planReticulumNotifications(
  input: NotificationPlanInput,
  deps: NotificationPlanDeps
): Promise<NotificationPlan> {
  if (!input.isMessage || !input.isFromOther || !input.hasMyAddress) {
    return EMPTY_PLAN;
  }

  // ---- reply -------------------------------------------------------------
  let reply = false;
  const repliedToEventId = String(input.repliedToEventId || '').trim();
  if (input.replyLookupAllowed && repliedToEventId) {
    try {
      const parentAuthor = await deps.lookupReplyParentAuthor(repliedToEventId);
      if (parentAuthor && parentAuthor === deps.myAddress) {
        const notifyOnReplies = await deps.getNotifyOnReplies();
        if (notifyOnReplies) {
          const muted = await deps.isChannelMuted();
          if (!muted) reply = true;
        }
      }
    } catch {
      // Parent lookup failed — skip the reply notification, as before.
    }
  }

  // ---- welcome-post suppression -----------------------------------------
  // A member who turned welcome posts off gets nothing for them at all: not the
  // welcome kind, not the mention the post carries, and not the generic
  // fallback.
  const suppressMention =
    input.isWelcomePost && input.notifyOnWelcomePosts === false;

  // ---- welcome -----------------------------------------------------------
  // Its own kind rather than a generic "posted in channel": a welcome post says
  // someone joined, and the OS notification should say that too.
  //
  // Above `mention` on purpose. A welcome post self-mentions its author — that
  // is how the post renders the joiner's name — and it can also carry an
  // `@everyone`. With `mention` first, a reader who has mention notifications
  // enabled received a *mention* notification for someone joining. A join
  // notice is a join notice; only a reply outranks it.
  //
  // `recordMentionNotification` is required here for the same reason the
  // mention and message branches require it: it is the "this post may notify at
  // all" switch, false during the startup history replay. Omitting it made every
  // historic welcome post raise an OS notification on every launch — a flood of
  // old join notices, because the replay path never sets the flag and this was
  // the one kind that ignored it.
  const welcome =
    !reply &&
    !suppressMention &&
    input.recordMentionNotification &&
    input.isMessage &&
    input.isWelcomePost;

  // ---- mention -----------------------------------------------------------
  let mention = false;
  let authorizedBroadcast = false;
  let directMention = false;
  if (
    !reply &&
    !welcome &&
    input.recordMentionNotification &&
    !suppressMention &&
    input.isMessage
  ) {
    authorizedBroadcast = deps.isAuthorizedBroadcast();
    directMention = deps.isDirectMention();
    // A mention notification is emitted only when the reader is the one
    // mentioned. This is the condition the recorder itself checks, so the plan
    // and the recorder cannot disagree.
    mention = authorizedBroadcast || directMention;
  }

  // ---- generic message ---------------------------------------------------
  // The fallback: only when nothing more specific applies, and never for a post
  // the reader authored, nor for a broadcast/mention that already notified.
  const message =
    !reply &&
    !welcome &&
    !mention &&
    !suppressMention &&
    input.recordMentionNotification &&
    input.isMessage &&
    !authorizedBroadcast &&
    !directMention;

  const kind: ReticulumNotificationKind | null = reply
    ? 'reply'
    : welcome
      ? 'welcome'
      : mention
        ? 'mention'
        : message
          ? 'message'
          : null;

  return {
    reply,
    mention,
    welcome,
    message,
    kind,
    suppressMention,
    authorizedBroadcast,
    directMention,
  };
}
