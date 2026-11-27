import { QORTAL_PROTOCOL } from '../constants/constants';

const GROUP_ID_PATTERN = '[1-9]\\d*';
const EVENT_ID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const JOIN_PATTERN = new RegExp(
  `^qortal://use-group/action-join/groupid-(${GROUP_ID_PATTERN})$`,
  'i'
);
const CALENDAR_PATTERN = new RegExp(
  `^qortal://use-group/action-calendar/groupid-(${GROUP_ID_PATTERN})/eventid-(${EVENT_ID_PATTERN})$`,
  'i'
);

export type QortalUseGroupLink =
  | { action: 'join'; groupId: number }
  | { action: 'calendar'; eventId: string; groupId: number };

const readGroupId = (value: string): number | null => {
  const groupId = Number(value);
  return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
};

export function parseQortalUseGroupLink(
  input: string | null | undefined
): QortalUseGroupLink | null {
  const link = String(input || '').trim();
  const joinMatch = link.match(JOIN_PATTERN);
  if (joinMatch) {
    const groupId = readGroupId(joinMatch[1]);
    return groupId ? { action: 'join', groupId } : null;
  }
  const calendarMatch = link.match(CALENDAR_PATTERN);
  if (!calendarMatch) return null;
  const groupId = readGroupId(calendarMatch[1]);
  return groupId
    ? {
        action: 'calendar',
        eventId: calendarMatch[2].toLowerCase(),
        groupId,
      }
    : null;
}

export function buildQortalGroupCalendarLink(
  groupId: number,
  eventId: string
): string {
  const parsedGroupId = readGroupId(String(groupId));
  const normalizedEventId = String(eventId || '')
    .trim()
    .toLowerCase();
  if (
    !parsedGroupId ||
    !new RegExp(`^${EVENT_ID_PATTERN}$`, 'i').test(normalizedEventId)
  ) {
    throw new Error('Invalid Qortal group calendar link');
  }
  return `${QORTAL_PROTOCOL}use-group/action-calendar/groupid-${parsedGroupId}/eventid-${normalizedEventId}`;
}
