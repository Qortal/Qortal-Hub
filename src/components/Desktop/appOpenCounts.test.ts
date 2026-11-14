import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appOpenCountKey,
  MAX_APP_OPEN_COUNTS,
  readAppOpenCounts,
  recordAppOpen,
} from './appOpenCounts';

describe('app open counts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keys an app by its service and its name in lower case', () => {
    expect(appOpenCountKey('app', ' Q-Tube ')).toBe('APP:q-tube');
    expect(appOpenCountKey('APP', '')).toBeNull();
    expect(appOpenCountKey(undefined, 'Q-Tube')).toBeNull();
  });

  it('counts the Q-Apps and websites each account opens', () => {
    recordAppOpen('QAlice', 'APP', 'Q-Tube');
    recordAppOpen('QAlice', 'APP', 'q-tube');
    expect(recordAppOpen('QAlice', 'WEBSITE', 'Wiki')).toEqual({
      'APP:q-tube': 2,
      'WEBSITE:wiki': 1,
    });
    expect(readAppOpenCounts('QBob')).toEqual({});
    expect(recordAppOpen('QBob', 'APP', 'Torq')).toEqual({ 'APP:torq': 1 });
    expect(readAppOpenCounts('QAlice')).toEqual({
      'APP:q-tube': 2,
      'WEBSITE:wiki': 1,
    });
  });

  it('ignores other services and opens without an account', () => {
    expect(recordAppOpen('QAlice', 'DOCUMENT', 'Notes')).toEqual({});
    expect(recordAppOpen('QAlice', 'INTERNAL', 'q-chat')).toEqual({});
    expect(recordAppOpen(null, 'APP', 'Q-Tube')).toEqual({});
    expect(localStorage.length).toBe(0);
  });

  it('drops the least opened past the limit, never the app just opened', () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_APP_OPEN_COUNTS }, (_, index) => [
        `APP:app-${index}`,
        index === 0 ? 1 : 2,
      ])
    );
    localStorage.setItem('app_open_counts:QAlice', JSON.stringify(full));

    const next = recordAppOpen('QAlice', 'APP', 'New App');

    expect(Object.keys(next)).toHaveLength(MAX_APP_OPEN_COUNTS);
    expect(next['APP:new app']).toBe(1);
    expect(next['APP:app-0']).toBeUndefined();
  });

  it('reads nothing from a broken or odd stored list', () => {
    localStorage.setItem('app_open_counts:QAlice', '{not json');
    expect(readAppOpenCounts('QAlice')).toEqual({});
    localStorage.setItem(
      'app_open_counts:QAlice',
      JSON.stringify({ 'APP:a': 2, 'APP:b': -1, 'APP:c': 'x', 'APP:d': null })
    );
    expect(readAppOpenCounts('QAlice')).toEqual({ 'APP:a': 2 });
  });

  it('keeps counting when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(recordAppOpen('QAlice', 'APP', 'Q-Tube')).toEqual({
      'APP:q-tube': 1,
    });
  });
});
