import { beforeEach, describe, expect, it } from 'vitest';
import {
  TIME_DAYS_1_IN_MILLISECONDS,
  TIME_MONTHS_1_IN_MILLISECONDS,
  TIME_WEEKS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import {
  buildReticulumMessageExpiryPayload,
  formatReticulumExpiryDuration,
  isReticulumMessageExpiryOptionAllowed,
  loadReticulumMessageExpiryPreference,
  RETICULUM_MESSAGE_EXPIRY_OPTIONS,
  reticulumMessageExpiryPreferenceStorageKey,
  resolveReticulumPreferredMessageExpiryDurationMs,
  saveReticulumMessageExpiryPreference,
} from './reticulumMessageExpiry';

describe('Reticulum message expiry', () => {
  beforeEach(() => window.localStorage.clear());

  it('provides the intended fixed expiry choices', () => {
    expect(RETICULUM_MESSAGE_EXPIRY_OPTIONS).toEqual([
      expect.objectContaining({ durationMs: TIME_DAYS_1_IN_MILLISECONDS }),
      expect.objectContaining({ durationMs: 2 * TIME_DAYS_1_IN_MILLISECONDS }),
      expect.objectContaining({ durationMs: 3 * TIME_DAYS_1_IN_MILLISECONDS }),
      expect.objectContaining({ durationMs: TIME_WEEKS_1_IN_MILLISECONDS }),
      expect.objectContaining({ durationMs: TIME_MONTHS_1_IN_MILLISECONDS }),
    ]);
  });

  it('omits the payload override when channel default is selected', () => {
    expect(buildReticulumMessageExpiryPayload(undefined, undefined)).toEqual(
      {}
    );
    expect(
      buildReticulumMessageExpiryPayload(
        undefined,
        2 * TIME_DAYS_1_IN_MILLISECONDS
      )
    ).toEqual({});
  });

  it('emits the no-expiry sentinel for an explicit null selection', () => {
    expect(buildReticulumMessageExpiryPayload(null, undefined)).toEqual({
      expiryDurationMs: 0,
    });
    expect(
      buildReticulumMessageExpiryPayload(null, 2 * TIME_DAYS_1_IN_MILLISECONDS)
    ).toEqual({ expiryDurationMs: 0 });
  });

  it('includes an allowed message expiry in the signed payload', () => {
    expect(
      buildReticulumMessageExpiryPayload(
        TIME_DAYS_1_IN_MILLISECONDS,
        2 * TIME_DAYS_1_IN_MILLISECONDS
      )
    ).toEqual({ expiryDurationMs: TIME_DAYS_1_IN_MILLISECONDS });
  });

  it('rejects a message expiry longer than the channel maximum', () => {
    expect(
      isReticulumMessageExpiryOptionAllowed(
        3 * TIME_DAYS_1_IN_MILLISECONDS,
        2 * TIME_DAYS_1_IN_MILLISECONDS
      )
    ).toBe(false);
    expect(
      buildReticulumMessageExpiryPayload(
        3 * TIME_DAYS_1_IN_MILLISECONDS,
        2 * TIME_DAYS_1_IN_MILLISECONDS
      )
    ).toEqual({});
  });

  it('uses a locked preference unless the channel has a shorter expiry', () => {
    expect(
      resolveReticulumPreferredMessageExpiryDurationMs(
        TIME_WEEKS_1_IN_MILLISECONDS,
        TIME_MONTHS_1_IN_MILLISECONDS
      )
    ).toBe(TIME_WEEKS_1_IN_MILLISECONDS);
    expect(
      resolveReticulumPreferredMessageExpiryDurationMs(
        TIME_WEEKS_1_IN_MILLISECONDS,
        TIME_DAYS_1_IN_MILLISECONDS
      )
    ).toBeUndefined();
  });

  it('stores the locked preference per account, group, and channel', () => {
    expect(
      saveReticulumMessageExpiryPreference(
        'QAccountAddress',
        42,
        TIME_WEEKS_1_IN_MILLISECONDS,
        'general'
      )
    ).toBe(true);
    expect(
      loadReticulumMessageExpiryPreference('qaccountaddress', 42, 'general')
    ).toBe(TIME_WEEKS_1_IN_MILLISECONDS);
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 43, 'general')
    ).toBeUndefined();
    expect(
      loadReticulumMessageExpiryPreference('QOtherAccount', 42, 'general')
    ).toBeUndefined();

    saveReticulumMessageExpiryPreference(
      'QAccountAddress',
      42,
      undefined,
      'general'
    );
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 42, 'general')
    ).toBeUndefined();
  });

  it('isolates preferences per channel within the same group', () => {
    saveReticulumMessageExpiryPreference(
      'QAccountAddress',
      42,
      TIME_WEEKS_1_IN_MILLISECONDS,
      'general'
    );
    saveReticulumMessageExpiryPreference(
      'QAccountAddress',
      42,
      TIME_DAYS_1_IN_MILLISECONDS,
      'random'
    );
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 42, 'general')
    ).toBe(TIME_WEEKS_1_IN_MILLISECONDS);
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 42, 'random')
    ).toBe(TIME_DAYS_1_IN_MILLISECONDS);
  });

  it('persists null as "no expiry" preference and restores it', () => {
    const key = reticulumMessageExpiryPreferenceStorageKey(
      'QAccountAddress',
      42,
      'general'
    );
    saveReticulumMessageExpiryPreference(
      'QAccountAddress',
      42,
      null,
      'general'
    );
    expect(window.localStorage.getItem(key!)).toBe('__null__');
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 42, 'general')
    ).toBe(null);
  });

  it('resolves null preference as null regardless of channel expiry', () => {
    expect(
      resolveReticulumPreferredMessageExpiryDurationMs(null, undefined)
    ).toBe(null);
    expect(
      resolveReticulumPreferredMessageExpiryDurationMs(
        null,
        TIME_DAYS_1_IN_MILLISECONDS
      )
    ).toBe(null);
  });

  it('deletes the saved preference when the user selects channel default', () => {
    saveReticulumMessageExpiryPreference(
      'QAccountAddress',
      42,
      TIME_WEEKS_1_IN_MILLISECONDS,
      'general'
    );
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 42, 'general')
    ).toBe(TIME_WEEKS_1_IN_MILLISECONDS);

    saveReticulumMessageExpiryPreference(
      'QAccountAddress',
      42,
      undefined,
      'general'
    );
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 42, 'general')
    ).toBeUndefined();
  });

  it('loads undefined when no preference has been saved', () => {
    expect(
      loadReticulumMessageExpiryPreference('QAccountAddress', 99, 'general')
    ).toBeUndefined();
  });

  it('formats standard and custom channel limits clearly', () => {
    expect(formatReticulumExpiryDuration(undefined)).toBe('No expiry');
    expect(formatReticulumExpiryDuration(TIME_WEEKS_1_IN_MILLISECONDS)).toBe(
      '1 week'
    );
    expect(formatReticulumExpiryDuration(TIME_MONTHS_1_IN_MILLISECONDS)).toBe(
      '1 month'
    );
    expect(formatReticulumExpiryDuration(12 * 60 * 60 * 1_000)).toBe(
      '12 hours'
    );
  });
});
