import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Static mocks — used only by pure-function tests (getCacheKey)
// ---------------------------------------------------------------------------

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

vi.mock('../../utils/ratingsIndexedDB', () => ({
  loadRatingsCacheFromDB: vi.fn().mockResolvedValue(new Map()),
  saveRatingsCacheToDB: vi.fn(),
}));

vi.mock('../../constants/constants', () => ({
  RATING_CACHE_TTL: 30 * 60 * 1000,
}));

// Static import — only pure functions that don't rely on module-level state
import { getCacheKey } from '../useAppRatings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:12391';

const makeBulkResponse = (
  entries: Array<{
    pollName: string;
    service: string;
    appName: string;
    voteCounts: Array<{ optionName: string; voteCount: number }>;
  }> = [
    {
      pollName: 'app-library-APP-rating-Q-Tube',
      service: 'APP',
      appName: 'Q-Tube',
      voteCounts: [
        { optionName: '5', voteCount: 5 },
        { optionName: '4', voteCount: 5 },
      ],
    },
  ]
) => ({
  count: entries.length,
  offset: 0,
  ratings: Object.fromEntries(
    entries.map((e) => [
      e.pollName,
      {
        pollName: e.pollName,
        service: e.service,
        appName: e.appName,
        owner: 'addr1',
        published: 1700000000000,
        totalVotes: e.voteCounts.reduce((s, v) => s + v.voteCount, 0),
        voteCounts: e.voteCounts,
      },
    ])
  ),
});

const fakeResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

// Re-import a fresh copy of the module with custom mocks applied.
// Must be called after vi.resetModules() + vi.doMock() calls.
const freshImport = () => import('../useAppRatings');

type FreshModule = Awaited<ReturnType<typeof freshImport>>;

// Render RatingsCacheInitializer + a hook consumer using a fresh module instance
const renderWithInit = (mod: FreshModule) => {
  const { RatingsCacheInitializer, useAppRatings } = mod;
  return renderHook(() => ({ ratings: useAppRatings() }), {
    wrapper: ({ children }) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(RatingsCacheInitializer),
        children
      ),
  });
};

// Reset module registry after each integration test so singletons start fresh
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pure-function tests (no module-state issues)
// ---------------------------------------------------------------------------

describe('getCacheKey', () => {
  it('lowercases both service and name', () => {
    expect(getCacheKey('Q-Tube', 'APP')).toBe('app-q-tube');
    expect(getCacheKey('My-App', 'WEBSITE')).toBe('website-my-app');
  });

  it('handles single-word names', () => {
    expect(getCacheKey('Quitter', 'APP')).toBe('app-quitter');
  });

  it('is idempotent for already-lowercase input', () => {
    expect(getCacheKey('q-tube', 'app')).toBe('app-q-tube');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — each test resets modules first so singletons are fresh
// ---------------------------------------------------------------------------

describe('RatingsCacheInitializer — bulk endpoint 200 OK', () => {
  it('populates the store with average rating and vote counts', async () => {
    vi.doMock('../../App', () => ({ getBaseApiReact: () => BASE_URL }));
    vi.doMock('../../utils/ratingsIndexedDB', () => ({
      loadRatingsCacheFromDB: vi.fn().mockResolvedValue(new Map()),
      saveRatingsCacheToDB: vi.fn(),
    }));
    vi.doMock('../../constants/constants', () => ({
      RATING_CACHE_TTL: 30 * 60 * 1000,
    }));

    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, makeBulkResponse()));

    const mod = await freshImport();
    const { result } = renderWithInit(mod);

    await waitFor(() => {
      expect(mod.getCacheKey('Q-Tube', 'APP')).toBe('app-q-tube');
      expect(result.current.ratings.getRating('Q-Tube', 'APP')).not.toBeNull();
    });

    const rating = result.current.ratings.getRating('Q-Tube', 'APP')!;
    // (5*5 + 4*5) / 10 = 4.5
    expect(rating.averageRating).toBe(4.5);
    expect(rating.totalVotes).toBe(10);
    expect(rating.hasPublishedRating).toBe(true);
  });

  it('handles initialValue-X option via calculateRating', async () => {
    vi.doMock('../../App', () => ({ getBaseApiReact: () => BASE_URL }));
    vi.doMock('../../utils/ratingsIndexedDB', () => ({
      loadRatingsCacheFromDB: vi.fn().mockResolvedValue(new Map()),
      saveRatingsCacheToDB: vi.fn(),
    }));
    vi.doMock('../../constants/constants', () => ({
      RATING_CACHE_TTL: 30 * 60 * 1000,
    }));

    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse(
        200,
        makeBulkResponse([
          {
            pollName: 'app-library-APP-rating-TestApp',
            service: 'APP',
            appName: 'TestApp',
            voteCounts: [
              { optionName: '5', voteCount: 1 },
              { optionName: 'initialValue-3', voteCount: 1 },
            ],
          },
        ])
      )
    );

    const mod = await freshImport();
    const { result } = renderWithInit(mod);

    await waitFor(() => {
      expect(result.current.ratings.getRating('TestApp', 'APP')).not.toBeNull();
    });

    const rating = result.current.ratings.getRating('TestApp', 'APP')!;
    // initialValue-3 → treated as rating 3 with count 1
    // (5*1 + 3*1) / 2 = 4.0
    expect(rating.averageRating).toBe(4.0);
    expect(rating.totalVotes).toBe(2);
  });
});

describe('RatingsCacheInitializer — bulk endpoint 404 (old node)', () => {
  it('does not throw and leaves store empty', async () => {
    vi.doMock('../../App', () => ({ getBaseApiReact: () => BASE_URL }));
    vi.doMock('../../utils/ratingsIndexedDB', () => ({
      loadRatingsCacheFromDB: vi.fn().mockResolvedValue(new Map()),
      saveRatingsCacheToDB: vi.fn(),
    }));
    vi.doMock('../../constants/constants', () => ({
      RATING_CACHE_TTL: 30 * 60 * 1000,
    }));

    global.fetch = vi.fn().mockResolvedValue(fakeResponse(404, {}));

    const mod = await freshImport();
    const { result } = renderWithInit(mod);

    // Give the async effect time to resolve
    await new Promise((r) => setTimeout(r, 100));

    // Store empty — intersection observer will handle individual fetches
    expect(result.current.ratings.getRating('Q-Tube', 'APP')).toBeNull();
  });
});

describe('RatingsCacheInitializer — network error', () => {
  it('does not throw and leaves store empty', async () => {
    vi.doMock('../../App', () => ({ getBaseApiReact: () => BASE_URL }));
    vi.doMock('../../utils/ratingsIndexedDB', () => ({
      loadRatingsCacheFromDB: vi.fn().mockResolvedValue(new Map()),
      saveRatingsCacheToDB: vi.fn(),
    }));
    vi.doMock('../../constants/constants', () => ({
      RATING_CACHE_TTL: 30 * 60 * 1000,
    }));

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const mod = await freshImport();
    const { result } = renderWithInit(mod);

    await new Promise((r) => setTimeout(r, 100));

    // Should not throw; bulkEndpointAvailable stays null (retries next session)
    expect(result.current.ratings.getRating('Q-Tube', 'APP')).toBeNull();
  });
});

describe('RatingsCacheInitializer — IndexedDB cache hit', () => {
  it('bulk data overwrites cached data with fresher values', async () => {
    vi.doMock('../../App', () => ({ getBaseApiReact: () => BASE_URL }));

    const cachedEntry = {
      averageRating: 3.5,
      totalVotes: 4,
      voteCounts: [
        { optionName: '4', voteCount: 2 },
        { optionName: '3', voteCount: 2 },
      ],
      hasPublishedRating: true,
      pollInfo: null,
      lastFetched: Date.now(),
    };

    vi.doMock('../../utils/ratingsIndexedDB', () => ({
      loadRatingsCacheFromDB: vi
        .fn()
        .mockResolvedValue(new Map([['app-q-tube', cachedEntry]])),
      saveRatingsCacheToDB: vi.fn(),
    }));
    vi.doMock('../../constants/constants', () => ({
      RATING_CACHE_TTL: 30 * 60 * 1000,
    }));

    // Bulk endpoint returns updated data (4.5 average)
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, makeBulkResponse()));

    const mod = await freshImport();
    const { result } = renderWithInit(mod);

    // After bulk fetch: bulk wins over IndexedDB (4.5, not 3.5)
    await waitFor(() => {
      const r = result.current.ratings.getRating('Q-Tube', 'APP');
      expect(r?.averageRating).toBe(4.5);
    });
  });
});
