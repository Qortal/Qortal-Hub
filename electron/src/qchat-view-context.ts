/**
 * Q-Chat view-context tracking for OS notification suppression.
 *
 * The renderer publishes the channel it currently has on screen over
 * `reticulumChat:setViewContext`. This module stores it and answers one
 * question at notification *show* time: is the user looking at the channel
 * this notification targets?
 *
 * Show time, not submit time, because `fireOsNotificationPayment` drains a
 * queue with a multi-second delay — the renderer state when a notification was
 * submitted can be stale by the time it is actually presented.
 *
 * The predicate mirrors the renderer's
 * `shouldSuppressForViewedChannel` in src/utils/qChatViewContextSuppression.ts.
 * `electron/` is a separate npm project and cannot import renderer modules, so
 * the three-clause rule is duplicated deliberately. Keep the two in sync.
 */

export interface QChatViewContext {
  groupId: number;
  channelId: string;
  visible: boolean;
}

/** `groupId < 0` is the renderer's "not viewing Q-Chat" sentinel. */
export const NOT_VIEWING_GROUP_ID = -1;

/**
 * `visible && context.groupId === groupId && context.channelId === channelId`
 *
 * Absence of a context, a negative group id, or `visible: false` all mean
 * "suppress nothing". Suppression requires a positive match, so a stale context
 * can only ever suppress for a window that genuinely claimed to be focused.
 */
export function shouldSuppressForViewedChannel(
  context: QChatViewContext | null | undefined,
  groupId: number | undefined,
  channelId: string | undefined
): boolean {
  if (!context) return false;
  if (context.visible !== true) return false;
  if (!Number.isFinite(context.groupId) || context.groupId < 0) return false;
  if (typeof groupId !== 'number' || !Number.isFinite(groupId)) return false;
  if (typeof channelId !== 'string' || channelId.length === 0) return false;
  return context.groupId === groupId && context.channelId === channelId;
}

/**
 * Normalises an untrusted IPC payload. Returns `null` — meaning "no context,
 * suppress nothing" — when the group id is not a finite number.
 */
export function normalizeViewContext(
  payload: unknown
): QChatViewContext | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<QChatViewContext>;
  const groupId = Number(candidate.groupId);
  if (!Number.isFinite(groupId)) return null;
  return {
    groupId,
    channelId:
      typeof candidate.channelId === 'string' ? candidate.channelId : '',
    visible: candidate.visible === true,
  };
}

/**
 * Holds the current view context and exposes the show-time gate. Kept as a
 * small mutable holder so both the IPC handler and the notification handler
 * operate on the same state without module-level `let` juggling at call sites.
 */
export class QChatViewContextStore {
  private context: QChatViewContext | null = null;

  set(payload: unknown): void {
    this.context = normalizeViewContext(payload);
  }

  get(): QChatViewContext | null {
    return this.context;
  }

  clear(): void {
    this.context = null;
  }

  shouldSuppress(
    groupId: number | undefined,
    channelId: string | undefined
  ): boolean {
    return shouldSuppressForViewedChannel(this.context, groupId, channelId);
  }
}
