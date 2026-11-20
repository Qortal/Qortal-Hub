/**
 * Module-level buffer for Q-Chat notification clicks that arrive before
 * Group.tsx is mounted (e.g. clicking a notification from the Home page).
 *
 * When a notification click fires `openGroupMessage` / `openDirectMessage`
 * events, the subscribers in Group.tsx may not exist yet. This buffer stores
 * the navigation detail so Group.tsx can drain it on mount and replay the
 * navigation — closing the gap between "switch to Q-Chat tab" (async React
 * reconciliation) and "event dispatched" (synchronous CustomEvent).
 *
 * Entry points that write to this buffer:
 *  - useAppMessageHandler.ts (OS notification clicks via window.postMessage)
 *  - GeneralNotifications.tsx (in-app bell notification clicks)
 *
 * Consumer that drains it:
 *  - Group.tsx — on mount, reads and clears the buffer, then dispatches
 *    the pending navigation event again so the subscribers fire.
 */

export interface PendingNav {
  /** Event name to re-dispatch (e.g. 'openGroupMessage', 'openDirectMessage') */
  eventName: string;
  detail: Record<string, unknown>;
}

let pending: PendingNav | null = null;
let hostMounted = false;

/**
 * Store a pending navigation. Called BEFORE opening the Q-Chat tab so the
 * buffer is ready for Group.tsx to consume on mount.
 *
 * Does nothing while the host is already mounted. In that case the caller's own
 * `executeEvent` is delivered directly, and buffering the same payload as well
 * left a stale entry behind: the drain only runs on mount, so the copy would
 * survive until Group unmounted and mounted again, then navigate somewhere the
 * user had long since left.
 */
export function setPendingNotificationNav(nav: PendingNav): void {
  if (hostMounted) return;
  pending = nav;
}

/**
 * Records that the consumer is mounted, so later clicks are not buffered.
 *
 * Group.tsx calls this on mount and clears it on unmount. Between those points
 * its subscribers are live and handle clicks directly.
 */
export function setNotificationNavHostMounted(mounted: boolean): void {
  hostMounted = mounted;
}

/**
 * Drain and return the pending nav (or null if none). Called by Group.tsx
 * on mount. Clears the buffer atomically.
 */
export function drainPendingNotificationNav(): PendingNav | null {
  const result = pending;
  pending = null;
  return result;
}