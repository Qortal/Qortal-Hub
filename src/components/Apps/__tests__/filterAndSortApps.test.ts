import { describe, expect, it } from 'vitest';
import { filterAndSortApps } from '../../../atoms/appsAtoms';

// Mock app data for testing
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
    averageRating: 4.5,
    ratingCount: 100,
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
    averageRating: 3.0,
    ratingCount: 50,
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
    averageRating: 5.0,
    ratingCount: 25,
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
    averageRating: 4.0,
    ratingCount: 200,
  },
];

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
