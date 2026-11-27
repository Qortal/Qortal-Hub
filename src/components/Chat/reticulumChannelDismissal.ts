/**
 * Pure decision helper for the Q-Chat "dismiss OS notifications for the
 * channel on screen" effect.
 *
 * The effect itself is deliberately separate from the read effect, because
 * dismissal has no timestamp, unread-count, or loaded-event precondition. The
 * read effect gates `markRead` behind a deferral so the unread divider
 * survives scroll restoration; keeping dismissal there meant it sat downstream
 * of early returns and was skipped whenever the selected channel was already
 * the stored channel. This helper makes the decision testable without mounting
 * a 13k-line component.
 */

import { DEFAULT_NOT_VIEWING_GROUP_ID } from '../../utils/qChatViewContextSuppression';

export interface DismissalTarget {
  groupId: number;
  channelId: string;
}

export interface ViewChannelPayload {
  groupId: number;
  channelId: string;
}

/**
 * Explicit "the user is no longer looking at any Q-Chat channel" payload.
 *
 * This MUST be published rather than skipping the publish. ChatGroup lives
 * inside a PersistentSectionLayer and stays mounted for the lifetime of the
 * group view, so an early return would leave the main process holding the
 * last-published channel indefinitely. Because the window stays focused while
 * the user browses other sections, `visible` still reads true, and every
 * notification for that channel would be suppressed forever.
 */
export const NOT_VIEWING_VIEW_CONTEXT: ViewChannelPayload = {
  groupId: DEFAULT_NOT_VIEWING_GROUP_ID,
  channelId: '',
};

export function getReticulumChannelDismissalTarget(params: {
  reticulumChatEnabled: boolean;
  isActive: boolean;
  selectedGroup: string | number | null | undefined;
  selectedChannelId: string | null | undefined;
  /**
   * `groupId` whose channel list is currently loaded, from
   * `reticulumChannelStateGroupId`.
   *
   * Group switch deliberately retains the *previous* group's channel id while
   * the new group's metadata loads (see the group-change effect in ChatGroup),
   * so between those two moments `selectedGroup` is the new group while
   * `selectedChannelId` still belongs to the old one. Acting on that pair
   * dismisses notifications for `(newGroup, oldChannel)` — a channel the reader
   * is not viewing — and publishes it as the view context, which both clears
   * the wrong channel's notifications and stops the right one from being
   * suppressed.
   *
   * When provided, the target is withheld unless it matches the loaded group.
   * Omit it only where no such state exists.
   */
  channelStateGroupId?: string | null | undefined;
}): DismissalTarget | null {
  if (!params.reticulumChatEnabled) return null;
  if (!params.isActive) return null;
  if (params.selectedGroup === null || params.selectedGroup === undefined) {
    return null;
  }
  if (params.selectedGroup === '') return null;
  const groupId = Number(params.selectedGroup);
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  const channelId = params.selectedChannelId;
  if (typeof channelId !== 'string' || channelId.length === 0) return null;
  // Reject a channel that has not been resolved for the group now selected.
  // An empty/mismatched state group id means the channel list for this group
  // has not loaded yet, so the retained channel id is not trustworthy.
  if (
    params.channelStateGroupId !== undefined &&
    String(params.channelStateGroupId ?? '') !== String(groupId)
  ) {
    return null;
  }
  return { groupId, channelId };
}

/**
 * The channel-view payload to publish, which is never null: inactive or
 * invalid states resolve to the not-viewing sentinel so a stale context can
 * never survive.
 */
export function getReticulumViewChannelPayload(params: {
  reticulumChatEnabled: boolean;
  isActive: boolean;
  selectedGroup: string | number | null | undefined;
  selectedChannelId: string | null | undefined;
  /**
   * The group the selected channel id was resolved for, if known.
   *
   * Declared here because this wrapper is the published contract: without it,
   * a caller can pass the field and it works at runtime while the type says it
   * is not part of the contract. Any future rewrite of this function that
   * builds its result from the declared fields would then silently drop the
   * group-switch gate and publish `(newGroup, oldChannel)` — the wrong-channel
   * suppression the gate exists to prevent.
   */
  channelStateGroupId?: string | null | undefined;
}): ViewChannelPayload {
  return getReticulumChannelDismissalTarget(params) ?? NOT_VIEWING_VIEW_CONTEXT;
}
