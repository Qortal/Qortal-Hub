/**
 * The notification session: one epoch, owned by the queue, shared by everything
 * that presents an OS notification.
 *
 * It lives here rather than inside `background.ts` because two modules need it.
 * `background.ts` owns the drain, but the Q-Chat handlers in
 * `WebsocketNotifications.tsx` are the ones that await before they enqueue, and
 * they can only prove which account their work belongs to if they read the same
 * epoch the queue stamps items with. Reaching into the background module for it
 * would mean the handlers were the only callers of a 3,500-line module's
 * internals, and a test could not exercise the real session without loading it.
 *
 * The rules are in `notificationQueue.ts`: logout bumps the epoch, items from an
 * older epoch are dropped, and an item may be submitted on behalf of a token it
 * captured earlier — if that token is stale, the submission is abandoned.
 */

import {
  createNotificationQueue,
  type NotificationQueue,
  type NotificationSessionToken,
} from './notificationQueue';

/**
 * Gap between presented notifications.
 *
 * Matches `NOTIFICATION_DISPLAY_DURATION_MS` so a notification is replaced
 * rather than stacked: each item gets the tray to itself for its turn.
 */
export const NOTIFICATION_QUEUE_INTERVAL_MS = 5000;

export const notificationQueue: NotificationQueue = createNotificationQueue({
  intervalMs: NOTIFICATION_QUEUE_INTERVAL_MS,
});

/**
 * Snapshot the session a piece of notification work belongs to.
 *
 * Call this synchronously, before the first await, so the token names the
 * account that produced the event rather than the one that happens to be signed
 * in when the lookups settle.
 */
export function captureNotificationSession(): NotificationSessionToken {
  return notificationQueue.captureSession();
}

/** True while the account that started the work is still the signed-in one. */
export function isNotificationSessionCurrent(
  token: NotificationSessionToken
): boolean {
  return notificationQueue.isSessionCurrent(token);
}

/** End the session — called on logout, before the next account can sign in. */
export function invalidateNotificationSession(): void {
  notificationQueue.invalidateSession();
}
