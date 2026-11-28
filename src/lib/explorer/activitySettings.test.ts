import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampActivityRead,
  DEFAULT_ACTIVITY_SETTINGS,
  firstReadKey,
  hiddenMarksKey,
  readActivitySettings,
  writeActivitySettings,
} from './activitySettings';

const HUB_A = `Q${'A'.repeat(33)}`;
const HUB_B = `Q${'B'.repeat(33)}`;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('Activity’s first read', () => {
  it('keeps to whole pages of 100, from 100 to 20,000', () => {
    expect(clampActivityRead(500)).toBe(500);
    expect(clampActivityRead(150)).toBe(200);
    expect(clampActivityRead(1)).toBe(100);
    expect(clampActivityRead(0)).toBe(100);
    expect(clampActivityRead(50_000)).toBe(20_000);
    // Anything stored that isn't a number is the default.
    expect(clampActivityRead('lots')).toBe(1000);
    expect(clampActivityRead(Number.NaN)).toBe(1000);
  });
});

describe('Activity settings on this device', () => {
  it('keeps each Hub account its own, and leaves the defaults unstored', () => {
    writeActivitySettings(HUB_A, { firstRead: 500, hiddenMarks: ['name'] });
    expect(readActivitySettings(HUB_A)).toEqual({
      firstRead: 500,
      hiddenMarks: ['name'],
    });
    expect(readActivitySettings(HUB_B)).toEqual(DEFAULT_ACTIVITY_SETTINGS);
    writeActivitySettings(HUB_A, DEFAULT_ACTIVITY_SETTINGS);
    expect(window.localStorage.getItem(firstReadKey(HUB_A))).toBeNull();
    expect(window.localStorage.getItem(hiddenMarksKey(HUB_A))).toBeNull();
  });

  it('reads back only kinds of milestones it knows, each once, and a sound number', () => {
    window.localStorage.setItem(firstReadKey(HUB_A), '123');
    window.localStorage.setItem(
      hiddenMarksKey(HUB_A),
      JSON.stringify(['name', 'name', '<b>', 42, 'banned'])
    );
    expect(readActivitySettings(HUB_A)).toEqual({
      firstRead: 200,
      hiddenMarks: ['name', 'banned'],
    });
    window.localStorage.setItem(hiddenMarksKey(HUB_A), '{not json');
    expect(readActivitySettings(HUB_A)).toEqual(DEFAULT_ACTIVITY_SETTINGS);
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readActivitySettings(HUB_A)).toEqual(DEFAULT_ACTIVITY_SETTINGS);
    expect(() =>
      writeActivitySettings(HUB_A, { firstRead: 500, hiddenMarks: [] })
    ).not.toThrow();
  });

  it('has nothing to keep without a Hub account', () => {
    expect(readActivitySettings(null)).toEqual(DEFAULT_ACTIVITY_SETTINGS);
  });
});
