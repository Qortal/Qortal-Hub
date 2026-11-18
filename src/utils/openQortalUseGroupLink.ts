import { executeEvent } from './events';
import { parseQortalUseGroupLink } from './qortalGroupLinks';

/**
 * Route a `qortal://use-group/...` link to the global group handlers.
 * Returns false when the input is not a use-group link, so callers can
 * fall back to their own handling.
 *
 * A link a Q-App or widget opens (`fromApp`) only opens the group's join
 * window, the join link and an event's link alike, and only while no join
 * window or other Hub dialog is open: it never opens a chat or the calendar.
 * It resolves false when the join window didn't open.
 */
export async function openQortalUseGroupLink(
  input: string | null | undefined,
  options: { fromApp?: boolean } = {}
): Promise<boolean> {
  const groupAction = parseQortalUseGroupLink(input);
  if (!groupAction) return false;

  if (options.fromApp) {
    // The join window (JoinGroup) marks the request when it opens for it.
    const request = {
      groupId: String(groupAction.groupId),
      fromApp: true,
      opened: false,
    };
    executeEvent('globalActionJoinGroup', request);
    return request.opened;
  }

  if (groupAction.action === 'join') {
    executeEvent('globalActionJoinGroup', {
      groupId: String(groupAction.groupId),
    });
    return true;
  }

  const occurrence = await window.reticulumChat
    ?.getCalendarEvent(groupAction.groupId, groupAction.eventId)
    .catch(() => null);
  executeEvent('openGroupMessage', {
    eventId: groupAction.eventId,
    from: groupAction.groupId,
    occurrenceStart: occurrence?.occurrenceStart ?? Date.now(),
    openCalendar: true,
    timezone: occurrence?.timezone ?? '',
  });
  return true;
}
