export const MAX_NOTIFICATION_PREVIEW_CHARS = 200;

/**
 * How long a push notification toast/popup stays visible before being
 * auto-dismissed. The notification remains accessible in the OS notification
 * center on platforms that support it (Windows Action Center, GNOME Notifications).
 *
 * Five seconds matches the queue's one-at-a-time cadence, so a notification
 * is replaced rather than stacked: each item gets the tray to itself for its
 * whole visible life, and the tray does not fill while several posts arrive
 * together. The tray keeps the history on platforms that retain it.
 */
export const NOTIFICATION_DISPLAY_DURATION_MS = 5_000;
