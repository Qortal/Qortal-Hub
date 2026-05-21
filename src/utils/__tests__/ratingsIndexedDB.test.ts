import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Reset IndexedDB state between tests by replacing the global with a fresh instance
// fake-indexeddb/auto installs IDBFactory on globalThis; we reload it per test to get isolation.
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../../constants/constants', () => ({
  RATING_CACHE_TTL: 30 * 60 * 1000,
}));

import type { AppRatingData } from '../../types/ratings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEntry = (overrides: Partial<AppRatingData> = {}): AppRatingData => ({
  averageRating: 4.5,
  totalVotes: 10,
  voteCounts: [{ optionName: '5', voteCount: 10 }],
  hasPublishedRating: true,
  pollInfo: null,
  lastFetched: Date.now(),
  ...overrides,
});

// Wait for the 1-second debounce in saveRatingsCacheToDB
const waitForSave = () => new Promise((r) => setTimeout(r, 1100));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ratingsIndexedDB', () => {
  beforeEach(() => {
    // Give each test a fresh IndexedDB instance so stores don't bleed between tests
    globalThis.indexedDB = new IDBFactory();
  });

  it('returns an empty map when the database has no entries', async () => {
    const { loadRatingsCacheFromDB } = await import('../ratingsIndexedDB');
    const result = await loadRatingsCacheFromDB();
    expect(result.size).toBe(0);
  });

  it('round-trips a single cache entry', async () => {
    vi.useFakeTimers();

    const { saveRatingsCacheToDB, loadRatingsCacheFromDB } =
      await import('../ratingsIndexedDB');

    const map = new Map([['app-q-tube', makeEntry({ totalVotes: 7 })]]);
    saveRatingsCacheToDB(map);

    // Advance past the 1000ms debounce
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const loaded = await loadRatingsCacheFromDB();
    expect(loaded.has('app-q-tube')).toBe(true);
    expect(loaded.get('app-q-tube')?.totalVotes).toBe(7);
  });

  it('discards expired entries on load', async () => {
    vi.useFakeTimers();

    const { saveRatingsCacheToDB, loadRatingsCacheFromDB } =
      await import('../ratingsIndexedDB');

    const expired = makeEntry({
      lastFetched: Date.now() - 31 * 60 * 1000, // 31 minutes ago
    });
    saveRatingsCacheToDB(new Map([['app-old', expired]]));

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const loaded = await loadRatingsCacheFromDB();
    expect(loaded.has('app-old')).toBe(false);
  });

  it('keeps non-expired entries and drops expired ones in the same load', async () => {
    vi.useFakeTimers();

    const { saveRatingsCacheToDB, loadRatingsCacheFromDB } =
      await import('../ratingsIndexedDB');

    const fresh = makeEntry({ totalVotes: 5 });
    const expired = makeEntry({ lastFetched: Date.now() - 31 * 60 * 1000 });

    saveRatingsCacheToDB(
      new Map([
        ['app-fresh', fresh],
        ['app-expired', expired],
      ])
    );

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const loaded = await loadRatingsCacheFromDB();
    expect(loaded.has('app-fresh')).toBe(true);
    expect(loaded.has('app-expired')).toBe(false);
  });

  it('overwrites previous data when saved again', async () => {
    vi.useFakeTimers();

    const { saveRatingsCacheToDB, loadRatingsCacheFromDB } =
      await import('../ratingsIndexedDB');

    saveRatingsCacheToDB(new Map([['app-q-tube', makeEntry({ totalVotes: 3 })]]));
    await vi.runAllTimersAsync();

    saveRatingsCacheToDB(new Map([['app-q-tube', makeEntry({ totalVotes: 9 })]]));
    await vi.runAllTimersAsync();

    vi.useRealTimers();

    const loaded = await loadRatingsCacheFromDB();
    expect(loaded.get('app-q-tube')?.totalVotes).toBe(9);
  });
});
