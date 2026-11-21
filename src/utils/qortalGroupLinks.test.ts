import { describe, expect, it } from 'vitest';
import {
  buildQortalGroupCalendarLink,
  parseQortalUseGroupLink,
} from './qortalGroupLinks';

describe('Qortal use-group links', () => {
  it('preserves the existing group join format', () => {
    expect(
      parseQortalUseGroupLink('qortal://use-group/action-join/groupid-1143')
    ).toEqual({ action: 'join', groupId: 1143 });
  });

  it('builds and parses calendar links as a separate group action', () => {
    const eventId = '06a3daa0-938c-40df-a7fe-a3cec373d992';
    const link = buildQortalGroupCalendarLink(1143, eventId);
    expect(link).toBe(
      `qortal://use-group/action-calendar/groupid-1143/eventid-${eventId}`
    );
    expect(parseQortalUseGroupLink(link)).toEqual({
      action: 'calendar',
      eventId,
      groupId: 1143,
    });
  });

  it('rejects unknown, malformed, and cross-action links', () => {
    expect(
      parseQortalUseGroupLink(
        'qortal://use-group/action-join/groupid-1143/eventid-06a3daa0-938c-40df-a7fe-a3cec373d992'
      )
    ).toBeNull();
    expect(
      parseQortalUseGroupLink(
        'qortal://use-group/action-calendar/groupid-0/eventid-06a3daa0-938c-40df-a7fe-a3cec373d992'
      )
    ).toBeNull();
    expect(
      parseQortalUseGroupLink('qortal://use-group/action-delete/groupid-1143')
    ).toBeNull();
  });
});
