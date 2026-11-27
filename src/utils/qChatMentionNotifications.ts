/**
 * Constants for Q-Chat mention notifications.
 *
 * The global "Q-Chat → Mentions" switch that used to live here was retired in
 * favour of per-channel push levels (see the "Remove global mention
 * notification toggle" requirement in
 * `openspec/specs/per-scope-notification-settings/spec.md`). Its accessors,
 * `getQChatMentionNotificationsEnabled` and
 * `setQChatMentionNotificationsEnabled`, were deleted with it — they had no
 * runtime caller and the `q-chat-mention-notifications-disabled` key they wrote
 * is now read only by the one-time migration that maps it to per-channel
 * `pushLevel: 'none'`.
 *
 * These constants remain because they identify the notification itself, which
 * is still raised; they no longer gate anything.
 */

export const QCHAT_MENTION_NOTIFICATION_APP_NAME = 'q-chat';
export const QCHAT_MENTION_NOTIFICATION_EVENT = 'Q_CHAT_MENTION';
