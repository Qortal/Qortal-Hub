/**
 * View-context suppression predicate for Q-Chat group channel notifications.
 *
 * One rule decides whether an OS notification should be suppressed because the
 * user is currently looking at the channel it targets:
 *
 *     visible && context.groupId === groupId && context.channelId === channelId
 *
 * Scroll position is deliberately NOT part of the predicate. Being scrolled up
 * in the channel you have open still counts as viewing it.
 *
 * The same rule is evaluated in two places:
 *   - the renderer, at submit time, as a cheap early-out (WebsocketNotifications)
 *   - the Electron main process, at show time, as the authoritative gate
 *     (electron/src/setup.ts), because notifications are shown from a queue
 *     with a multi-second delay and the renderer state at submit time may be
 *     stale by the time the notification is actually presented.
 *
 * electron/ is a separate npm project and cannot import this file, so the
 * three-clause predicate is mirrored there. Keep the two in sync; both are
 * covered by tests.
 */

export const DEFAULT_NOT_VIEWING_GROUP_ID = -1;

export interface QChatViewContext {
  groupId: number;
  channelId: string;
  visible: boolean;
}

export function isViewContextActive(
  context: QChatViewContext | null | undefined
) {
  if (!context) return false;
  return Number.isFinite(context.groupId) && context.groupId >= 0;
}

export function shouldSuppressForViewedChannel(
  context: QChatViewContext | null | undefined,
  groupId: number,
  channelId: string
): boolean {
  if (!context) return false;
  if (context.visible !== true) return false;
  if (!isViewContextActive(context)) return false;
  return context.groupId === groupId && context.channelId === channelId;
}

/**
 * The channel currently on screen, held in a module-level store rather than
 * only carried by the `qchat-view-channel` DOM event.
 *
 * `executeEvent` is synchronous: if `ChatGroup` publishes on mount before
 * `WebsocketNotifications` has subscribed, the payload is dropped and the
 * subscriber keeps its initial not-viewing sentinel. Suppression then does not
 * apply until the user happens to switch channels — which is exactly the
 * "notification fires for the channel I am looking at" symptom.
 *
 * A store that both sides read and write removes that ordering dependency.
 * Only the *location* is stored. Visibility is evaluated live at check time by
 * `computeQChatVisible()`, because a window can lose focus between publish and
 * check.
 */
let publishedLocation: { groupId: number; channelId: string } = {
  groupId: DEFAULT_NOT_VIEWING_GROUP_ID,
  channelId: '',
};

/** Record the channel on screen. Called by ChatGroup whenever it changes. */
export function setPublishedViewChannel(payload: {
  groupId: number;
  channelId: string;
}): void {
  const groupId = Number(payload?.groupId);
  publishedLocation = {
    groupId: Number.isFinite(groupId) ? groupId : DEFAULT_NOT_VIEWING_GROUP_ID,
    channelId: typeof payload?.channelId === 'string' ? payload.channelId : '',
  };
}

/** The channel on screen, combined with live window visibility. */
export function getPublishedViewContext(): QChatViewContext {
  return {
    ...publishedLocation,
    visible: computeQChatVisible(),
  };
}

/** Clear the published channel. Used on logout and by tests. */
export function resetPublishedViewChannel(): void {
  publishedLocation = {
    groupId: DEFAULT_NOT_VIEWING_GROUP_ID,
    channelId: '',
  };
}

/**
 * The authoritative suppression check: is the user looking at this exact
 * group and channel right now?
 */
export function isViewingChannel(groupId: number, channelId: string): boolean {
  return shouldSuppressForViewedChannel(
    getPublishedViewContext(),
    groupId,
    channelId
  );
}

/**
 * `visible` is true only when the document is visible AND the window has focus.
 * `document.visibilityState` alone is insufficient: a focused-but-minimised
 * Electron window on Linux and Windows can still report `visible`.
 */
export function computeQChatVisible(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  return typeof document.hasFocus === 'function' ? document.hasFocus() : false;
}
