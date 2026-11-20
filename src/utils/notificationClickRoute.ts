// Which click handler a notification id belongs to.
//
// Import-free on purpose: this is the decision the OS sends the user into when
// they click a notification, and getting it wrong means the click lands
// nowhere. Keeping it here makes it testable without an Electron shell or the
// heavily-mocked background module, in the same shape as
// reticulumNotificationPlan / reticulumNotificationPrecedence.
//
// The ids come from two places and must both be understood:
//
//   general_notification_<ts>_type=general-notification
//       payments, app resources, and anything with no event key
//
//   q-chat_notification_<eventId>
//       Q-Chat mentions, replies, welcomes, reactions and channel messages.
//       Keyed on the event so the main-process sink can replace an existing
//       entry instead of stacking a second notification for the same post.
//       This form carries no `_type=` segment, which is why it needs its own
//       prefix test rather than falling through the `_type=` chain.
//
// The `q-chat_notification_` prefix cannot collide with the other forms: none
// of them begin with `q-chat_`.

export type NotificationClickRoute =
  | 'general'
  | 'direct'
  | 'group'
  | 'group-announcement'
  | 'thread-post'
  | 'none';

export const QCHAT_NOTIFICATION_ID_PREFIX = 'q-chat_notification_';
export const GENERAL_NOTIFICATION_TYPE_MARKER = '_type=general-notification';

/**
 * The id a Q-Chat notification is keyed by, or null when the caller has no
 * event to key on. Callers encode the result before handing it to Electron.
 */
export function qchatNotificationIdForEvent(
  eventId: string | null | undefined
): string | null {
  const id = String(eventId ?? '').trim();
  return id ? `${QCHAT_NOTIFICATION_ID_PREFIX}${id}` : null;
}

/**
 * Queue key for a direct-message notification.
 *
 * Separate from the notification id: a Q-Chat event id used as the notification
 * id routes a click to `general` instead of the conversation, so a DM has to
 * keep its own id and be deduplicated and cancelled by this key instead.
 */
export function dmNotificationQueueKey(eventId: string | null | undefined) {
  const id = String(eventId ?? '').trim();
  return id ? `reticulum-dm-queued-${id}` : null;
}

/**
 * Classify a notification id. Accepts the id raw or URI-encoded.
 *
 * Order matters: the `_type=` tests are more specific than the Q-Chat prefix,
 * and `group-announcement` / `thread-post` share the `group` and `thread`
 * words, so the longer markers are checked first.
 */
export function notificationClickRoute(
  notificationId: string | null | undefined
): NotificationClickRoute {
  if (!notificationId) return 'none';

  let id = String(notificationId);
  // The main process encodes the id; tolerate a caller that already decoded it.
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape is not worth failing a click over; match on the raw.
  }

  if (id.includes(QCHAT_NOTIFICATION_ID_PREFIX)) return 'general';
  if (id.includes(GENERAL_NOTIFICATION_TYPE_MARKER)) return 'general';
  if (id.includes('_type=direct_')) return 'direct';
  if (id.includes('_type=group-announcement_')) return 'group-announcement';
  if (id.includes('_type=thread-post_')) return 'thread-post';
  if (id.includes('_type=group_')) return 'group';

  return 'none';
}
