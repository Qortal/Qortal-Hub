import { executeEvent } from './events';
import { parseQortalUseGroupLink } from './qortalGroupLinks';

/**
 * Route a `qortal://use-group/...` link to the global group handlers.
 * Returns false when the input is not a use-group link, so callers can
 * fall back to their own handling.
 */
export async function openQortalUseGroupLink(
  input: string | null | undefined
): Promise<boolean> {
  const groupAction = parseQortalUseGroupLink(input);
  if (!groupAction) return false;

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
