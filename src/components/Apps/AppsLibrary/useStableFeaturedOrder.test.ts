import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

import { getCacheKey } from '../../../hooks/useAppRatings';
import {
  sortByBestRating,
  useStableBestRatedOrder,
  useStableFeaturedOrder,
} from './useStableFeaturedOrder';

// None of these lead the carousel, so their order is by rating.
const apps = [
  { name: 'Q-Mail', service: 'APP' },
  { name: 'Q-Wallets', service: 'APP' },
  { name: 'Q-Trade', service: 'APP' },
];

const rated = (values: Record<string, number | null>) =>
  Object.fromEntries(
    Object.entries(values).map(([name, average]) => [
      getCacheKey(name, 'APP'),
      average === null
        ? null
        : ({ averageRating: average, totalVotes: 3 } as any),
    ])
  );

const names = (list: { name: string }[]) => list.map((app) => app.name);

describe('useStableFeaturedOrder', () => {
  it('sorts by rating once every rating is known', () => {
    const { result } = renderHook(() =>
      useStableFeaturedOrder(
        apps,
        rated({ 'Q-Mail': 3, 'Q-Wallets': 5, 'Q-Trade': 4 })
      )
    );
    expect(names(result.current)).toEqual(['Q-Wallets', 'Q-Trade', 'Q-Mail']);
  });

  it('keeps the order while ratings reload', () => {
    const { result, rerender } = renderHook(
      ({ ratings }) => useStableFeaturedOrder(apps, ratings),
      {
        initialProps: {
          ratings: rated({ 'Q-Mail': 3, 'Q-Wallets': 5, 'Q-Trade': 4 }),
        },
      }
    );

    // After a refresh the store is empty, then fills one app at a time.
    rerender({
      ratings: rated({ 'Q-Mail': 5, 'Q-Wallets': null, 'Q-Trade': null }),
    });
    expect(names(result.current)).toEqual(['Q-Wallets', 'Q-Trade', 'Q-Mail']);

    rerender({ ratings: rated({ 'Q-Mail': 5, 'Q-Wallets': 1, 'Q-Trade': 2 }) });
    expect(names(result.current)).toEqual(['Q-Mail', 'Q-Trade', 'Q-Wallets']);
  });

  it('starts over when the set of apps changes', () => {
    const { result, rerender } = renderHook(
      ({ list, ratings }) => useStableFeaturedOrder(list, ratings),
      {
        initialProps: {
          list: apps,
          ratings: rated({ 'Q-Mail': 3, 'Q-Wallets': 5, 'Q-Trade': 4 }),
        },
      }
    );
    const fewer = apps.slice(0, 2);
    rerender({
      list: fewer,
      ratings: rated({ 'Q-Mail': 4, 'Q-Wallets': null }),
    });
    expect(names(result.current)).toEqual(['Q-Mail', 'Q-Wallets']);
  });
});

describe('all official apps, best rated first', () => {
  const all = [
    { name: 'Names', service: 'APP' },
    { name: 'Q-Blog', service: 'APP' },
    { name: 'Q-Search', service: 'APP' },
    { name: 'Torq', service: 'APP' },
  ];
  const ratings: Record<string, any> = {
    Names: { averageRating: 4, totalVotes: 2 },
    'Q-Blog': { averageRating: 0, totalVotes: 0 },
    'Q-Search': { averageRating: 4, totalVotes: 9 },
    Torq: { averageRating: 5, totalVotes: 1 },
  };

  it('sorts by average, then votes, keeping the title order for a tie', () => {
    expect(names(sortByBestRating(all, (app) => ratings[app.name]))).toEqual([
      'Torq',
      'Q-Search',
      'Names',
      'Q-Blog',
    ]);
    // No ratings at all: the order they came in.
    expect(names(sortByBestRating(all, () => undefined))).toEqual(names(all));
  });

  it('ignores the Featured lead, and holds still while ratings reload', () => {
    const { result, rerender } = renderHook(
      ({ map }) => useStableBestRatedOrder(all, map),
      {
        initialProps: {
          map: Object.fromEntries(
            all.map((app) => [getCacheKey(app.name, 'APP'), ratings[app.name]])
          ),
        },
      }
    );
    expect(names(result.current)).toEqual([
      'Torq',
      'Q-Search',
      'Names',
      'Q-Blog',
    ]);
    // A refresh: the store refills one app at a time.
    rerender({ map: { [getCacheKey('Q-Blog', 'APP')]: ratings['Q-Blog'] } });
    expect(names(result.current)).toEqual([
      'Torq',
      'Q-Search',
      'Names',
      'Q-Blog',
    ]);
  });
});
