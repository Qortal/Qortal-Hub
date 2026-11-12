import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEED_APP, readFeedApp, saveFeedApp } from './feedApp';

describe('feed app choice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is Torq until the user picks one', () => {
    expect(DEFAULT_FEED_APP).toBe('Torq');
    expect(readFeedApp()).toBe('Torq');
  });

  it('remembers the app the user picked', () => {
    saveFeedApp('Quitter');
    expect(readFeedApp()).toBe('Quitter');
    saveFeedApp('Torq');
    expect(readFeedApp()).toBe('Torq');
  });

  it('ignores anything else in storage', () => {
    localStorage.setItem('home_feed_app', 'quitter');
    expect(readFeedApp()).toBe('Torq');
  });

  it('falls back to Torq when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => saveFeedApp('Quitter')).not.toThrow();
    expect(readFeedApp()).toBe('Torq');
  });
});
