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

  describe('from a Q-App or a widget', () => {
    const eventId = '06a3daa0-938c-40df-a7fe-a3cec373d992';
    // The join window, as it answers a link it opens for.
    const joinWindow = (e: Event) => {
      (e as CustomEvent).detail.opened = true;
    };

    afterEach(() => {
      document.removeEventListener('globalActionJoinGroup', joinWindow);
    });

    it('opens only the join window, for the join link and an event alike', async () => {
      const getCalendarEvent = vi.fn().mockResolvedValue(null);
      vi.stubGlobal('reticulumChat', { getCalendarEvent });
      document.addEventListener('globalActionJoinGroup', joinWindow);

      for (const link of [
        'qortal://use-group/action-join/groupid-123',
        `qortal://use-group/action-calendar/groupid-123/eventid-${eventId}`,
      ]) {
        await expect(
          openQortalUseGroupLink(link, { fromApp: true })
        ).resolves.toBe(true);
      }

      expect(events.map(({ name }) => name)).toEqual([
        'globalActionJoinGroup',
        'globalActionJoinGroup',
      ]);
      expect(events[0].detail).toMatchObject({
        groupId: '123',
        fromApp: true,
      });
      expect(getCalendarEvent).not.toHaveBeenCalled();
    });

    it('says so when no join window opened for it', async () => {
      await expect(
        openQortalUseGroupLink('qortal://use-group/action-join/groupid-123', {
          fromApp: true,
        })
      ).resolves.toBe(false);
    });
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
