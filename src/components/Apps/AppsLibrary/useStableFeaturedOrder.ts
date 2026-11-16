import { useMemo, useRef } from 'react';
import { getCacheKey } from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { sortFeaturedApps } from '../config/officialApps';

type RatedApp = { name: string; service: string };
type RatingOf<T> = (app: T) => AppRatingData | undefined;

const appKey = (app: RatedApp) => `${app?.service}-${app?.name}`;

const ratingKey = (app: RatedApp) =>
  app?.name && app?.service ? getCacheKey(app.name, app.service) : '';

/**
 * Best rated first: by average rating, then by votes. Apps rated alike keep
 * the order they came in (by title, in the Official tab).
 */
export const sortByBestRating = <T extends RatedApp>(
  apps: readonly T[],
  ratingOf: RatingOf<T>
): T[] =>
  [...apps].sort((a, b) => {
    const ratingA = ratingOf(a);
    const ratingB = ratingOf(b);
    const byAverage =
      (ratingB?.averageRating || 0) - (ratingA?.averageRating || 0);
    if (byAverage !== 0) return byAverage;
    return (ratingB?.totalVotes || 0) - (ratingA?.totalVotes || 0);
  });

/**
 * `apps` in `sort`'s order by rating, held still while ratings load. A
 * refresh empties the ratings store and refills it one app at a time; without
 * this the list would reorder with every rating that comes back. The order is
 * worked out again once every app has its rating, or when the set of apps
 * changes.
 */
export const useStableRatingOrder = <T extends RatedApp>(
  apps: T[],
  ratingsMap: Record<string, AppRatingData | null | undefined>,
  sort: (apps: readonly T[], ratingOf: RatingOf<T>) => T[]
): T[] => {
  const storedRef = useRef<{ namesKey: string; orderKeys: string[] } | null>(
    null
  );

  return useMemo(() => {
    const namesKey = apps.map(appKey).sort().join('|');
    const isAnyRatingMissing = apps.some(
      (app) => !ratingsMap?.[ratingKey(app)]
    );
    const stored = storedRef.current;

    if (isAnyRatingMissing && stored && stored.namesKey === namesKey) {
      const byKey = new Map(apps.map((app) => [appKey(app), app]));
      return stored.orderKeys
        .map((key) => byKey.get(key))
        .filter((app): app is T => !!app);
    }

    const sorted = sort(
      apps,
      (app) => ratingsMap?.[ratingKey(app)] ?? undefined
    );
    storedRef.current = { namesKey, orderKeys: sorted.map(appKey) };
    return sorted;
    // `sort` is a module function: it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, ratingsMap]);
};

/** The Featured order (the configured lead, then by rating), held still. */
export const useStableFeaturedOrder = <T extends RatedApp>(
  featuredAppsBase: T[],
  ratingsForFeaturedMap: Record<string, AppRatingData | null | undefined>
): T[] =>
  useStableRatingOrder(
    featuredAppsBase,
    ratingsForFeaturedMap,
    sortFeaturedApps
  );

/** Every official app, best rated first, held still. */
export const useStableBestRatedOrder = <T extends RatedApp>(
  apps: T[],
  ratingsMap: Record<string, AppRatingData | null | undefined>
): T[] => useStableRatingOrder(apps, ratingsMap, sortByBestRating);
