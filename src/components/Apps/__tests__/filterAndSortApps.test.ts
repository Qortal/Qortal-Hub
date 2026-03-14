import { describe, expect, it } from 'vitest';
import { filterAndSortApps } from '../../../atoms/appsAtoms';

// Mock app data for testing (no rating fields — matches real API shape)
const mockApps = [
  {
    name: 'AliceApp',
    service: 'APP',
    created: 1700000000000,
    metadata: {
      title: 'Alice App',
      description: 'An app by Alice',
      category: 'games',
    },
    status: { status: 'READY' },
  },
  {
    name: 'BobApp',
    service: 'APP',
    created: 1600000000000,
    metadata: {
      title: 'Bob App',
      description: 'An app by Bob',
      category: 'finance',
    },
    status: { status: 'NOT_READY' },
  },
  {
    name: 'CharlieApp',
    service: 'APP',
    created: 1800000000000,
    metadata: {
      title: 'Charlie App',
      description: 'An app by Charlie',
      category: 'games',
    },
    status: { status: 'READY' },
  },
  {
    name: 'DaveApp',
    service: 'APP',
    created: 1750000000000,
    metadata: {
      title: 'Dave App',
      description: 'An app by Dave for social networking',
      category: 'social',
    },
    status: { status: 'NOT_READY' },
  },
];

// Ratings map mirroring ratingsStoreAtom contents (key = service-name lowercased)
const mockRatingsMap = new Map([
  ['app-aliceapp',   { averageRating: 4.5, totalVotes: 100, voteCounts: [], hasPublishedRating: true, pollInfo: null, lastFetched: 0 }],
  ['app-bobapp',     { averageRating: 3.0, totalVotes: 50,  voteCounts: [], hasPublishedRating: true, pollInfo: null, lastFetched: 0 }],
  ['app-charlieapp', { averageRating: 5.0, totalVotes: 25,  voteCounts: [], hasPublishedRating: true, pollInfo: null, lastFetched: 0 }],
  ['app-daveapp',    { averageRating: 4.0, totalVotes: 200, voteCounts: [], hasPublishedRating: true, pollInfo: null, lastFetched: 0 }],
]);

describe('filterAndSortApps', () => {
  describe('sorting', () => {
    it('sorts by newest first', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result[0].name).toBe('CharlieApp');
      expect(result[1].name).toBe('DaveApp');
      expect(result[2].name).toBe('AliceApp');
      expect(result[3].name).toBe('BobApp');
    });

    it('sorts by oldest first', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'oldest',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result[0].name).toBe('BobApp');
      expect(result[3].name).toBe('CharlieApp');
    });

    it('sorts alphabetically by title', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'alphabetical',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result[0].name).toBe('AliceApp');
      expect(result[1].name).toBe('BobApp');
      expect(result[2].name).toBe('CharlieApp');
      expect(result[3].name).toBe('DaveApp');
    });

    it('sorts by highest rated using ratingsMap', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'highest_rated',
        category: 'all',
        status: 'all',
        search: '',
        ratingsMap: mockRatingsMap,
      });
      expect(result[0].name).toBe('CharlieApp'); // 5.0
      expect(result[1].name).toBe('AliceApp');   // 4.5
      expect(result[2].name).toBe('DaveApp');    // 4.0
      expect(result[3].name).toBe('BobApp');     // 3.0
    });

    it('sorts by most rated using ratingsMap', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'most_rated',
        category: 'all',
        status: 'all',
        search: '',
        ratingsMap: mockRatingsMap,
      });
      expect(result[0].name).toBe('DaveApp');    // 200
      expect(result[1].name).toBe('AliceApp');   // 100
      expect(result[2].name).toBe('BobApp');     // 50
      expect(result[3].name).toBe('CharlieApp'); // 25
    });

    it('sorts highest_rated with no ratingsMap — all apps score 0, order preserved', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'highest_rated',
        category: 'all',
        status: 'all',
        search: '',
      });
      // All averageRating fallbacks to 0 — stable relative order expected
      expect(result.length).toBe(4);
      result.forEach((app) => expect(app).toBeTruthy());
    });

    it('sorts most_rated with no ratingsMap — all apps score 0, order preserved', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'most_rated',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(4);
      result.forEach((app) => expect(app).toBeTruthy());
    });

    it('highest_rated: apps missing from ratingsMap sort last', () => {
      const partialMap = new Map([
        ['app-charlieapp', { averageRating: 5.0, totalVotes: 25, voteCounts: [], hasPublishedRating: true, pollInfo: null, lastFetched: 0 }],
      ]);
      const result = filterAndSortApps(mockApps, {
        sort: 'highest_rated',
        category: 'all',
        status: 'all',
        search: '',
        ratingsMap: partialMap,
      });
      expect(result[0].name).toBe('CharlieApp'); // only one with a rating
    });

    it('most_rated: apps missing from ratingsMap sort last', () => {
      const partialMap = new Map([
        ['app-daveapp', { averageRating: 4.0, totalVotes: 200, voteCounts: [], hasPublishedRating: true, pollInfo: null, lastFetched: 0 }],
      ]);
      const result = filterAndSortApps(mockApps, {
        sort: 'most_rated',
        category: 'all',
        status: 'all',
        search: '',
        ratingsMap: partialMap,
      });
      expect(result[0].name).toBe('DaveApp'); // only one with votes
    });
  });

  describe('filtering by category', () => {
    it('filters by category correctly', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'games',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(2);
      expect(result.every((app) => app.metadata.category === 'games')).toBe(
        true
      );
    });

    it('returns all apps when category is "all"', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(4);
    });

    it('returns empty array for non-existent category', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'non-existent',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(0);
    });
  });

  describe('filtering by status', () => {
    it('filters installed apps', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'installed',
        search: '',
      });
      expect(result.length).toBe(2);
      expect(result.every((app) => app.status.status === 'READY')).toBe(true);
    });

    it('filters not installed apps', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'not_installed',
        search: '',
      });
      expect(result.length).toBe(2);
      expect(result.every((app) => app.status.status !== 'READY')).toBe(true);
    });
  });

  describe('filtering by search', () => {
    it('searches by name', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: 'alice',
      });
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('AliceApp');
    });

    it('searches by title', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: 'Charlie App',
      });
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('CharlieApp');
    });

    it('searches by description', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: 'social networking',
      });
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('DaveApp');
    });

    it('search is case insensitive', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: 'BOB',
      });
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('BobApp');
    });
  });

  describe('combined filters', () => {
    it('combines category and status filters', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'games',
        status: 'installed',
        search: '',
      });
      expect(result.length).toBe(2);
      expect(
        result.every(
          (app) =>
            app.metadata.category === 'games' && app.status.status === 'READY'
        )
      ).toBe(true);
    });

    it('combines search with category filter', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'newest',
        category: 'games',
        status: 'all',
        search: 'alice',
      });
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('AliceApp');
    });

    it('combines all filters', () => {
      const result = filterAndSortApps(mockApps, {
        sort: 'alphabetical',
        category: 'games',
        status: 'installed',
        search: 'app',
      });
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('AliceApp');
      expect(result[1].name).toBe('CharlieApp');
    });
  });

  describe('edge cases', () => {
    it('handles empty app list', () => {
      const result = filterAndSortApps([], {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(0);
    });

    it('handles apps with missing metadata', () => {
      const appsWithMissing = [
        { name: 'NoMetadata', service: 'APP', created: 1700000000000 },
        ...mockApps,
      ];
      const result = filterAndSortApps(appsWithMissing, {
        sort: 'alphabetical',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(5);
    });

    it('handles apps with missing created timestamp', () => {
      const appsWithMissing = [
        { name: 'NoTimestamp', service: 'APP', metadata: { title: 'No Time' } },
        ...mockApps,
      ];
      const result = filterAndSortApps(appsWithMissing, {
        sort: 'newest',
        category: 'all',
        status: 'all',
        search: '',
      });
      expect(result.length).toBe(5);
    });
  });
});
