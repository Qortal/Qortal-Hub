import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openQortalUseGroupLink } from './openQortalUseGroupLink';

describe('openQortalUseGroupLink', () => {
  const events: Array<{ name: string; detail: unknown }> = [];
  const record = (e: Event) =>
    events.push({ name: e.type, detail: (e as CustomEvent).detail });

  beforeEach(() => {
    events.length = 0;
    document.addEventListener('globalActionJoinGroup', record);
    document.addEventListener('openGroupMessage', record);
  });

  afterEach(() => {
    document.removeEventListener('globalActionJoinGroup', record);
    document.removeEventListener('openGroupMessage', record);
    vi.unstubAllGlobals();
  });

  it('opens the join dialog for a group join link', async () => {
    await expect(
      openQortalUseGroupLink('qortal://use-group/action-join/groupid-123')
    ).resolves.toBe(true);
    expect(events).toEqual([
      { name: 'globalActionJoinGroup', detail: { groupId: '123' } },
    ]);
  });

  it('accepts surrounding whitespace, as pasted into the address bar', async () => {
    await expect(
      openQortalUseGroupLink('  qortal://use-group/action-join/groupid-7  ')
    ).resolves.toBe(true);
    expect(events[0]).toEqual({
      name: 'globalActionJoinGroup',
      detail: { groupId: '7' },
    });
  });

  it('opens the group calendar for a calendar link', async () => {
    const eventId = '06a3daa0-938c-40df-a7fe-a3cec373d992';
    vi.stubGlobal('reticulumChat', {
      getCalendarEvent: vi.fn().mockResolvedValue({
        occurrenceStart: 1700000000000,
        timezone: 'UTC',
      }),
    });
    await expect(
      openQortalUseGroupLink(
        `qortal://use-group/action-calendar/groupid-1143/eventid-${eventId}`
      )
    ).resolves.toBe(true);
    expect(events).toEqual([
      {
        name: 'openGroupMessage',
        detail: {
          eventId,
          from: 1143,
          occurrenceStart: 1700000000000,
          openCalendar: true,
          timezone: 'UTC',
        },
      },
    ]);
  });

  it('leaves app links and search text to the caller', async () => {
    for (const input of [
      'qortal://APP/Q-Tube',
      'qortal://use-group/action-join/groupid-0',
      'q-tube',
      '',
    ]) {
      await expect(openQortalUseGroupLink(input)).resolves.toBe(false);
    }
    expect(events).toEqual([]);
  });
});
