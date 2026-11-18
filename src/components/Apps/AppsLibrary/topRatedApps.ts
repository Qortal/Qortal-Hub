import { useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import {
  allRatingsLoadedAtom,
  getCacheKey,
} from '../../../hooks/useAppRatings';
import { ratingsWithPendingVotesAtom } from '../AppPage/optimisticRatings';
import type { AppRatingData } from '../../../types/ratings';
import { compareByWeightedRating } from '../../../utils/appRatingScore';

/** A Featured row of the best rated shows at most this many apps. */
export const TOP_RATED_LIMIT = 10;

/**
 * With fewer apps rated well than this, there is no row: the list below
 * starts with them anyway, since it sorts by rating.
 */
export const TOP_RATED_MIN = 3;

/** The middle of one to five stars: an app in the row is rated above it. */
const MIDDLE_RATING = 3;

type RatedApp = { name?: string; service?: string };

type RatingOf<T> = (app: T) => AppRatingData | null | undefined;

/**
 * Where the ratings store keeps an item's rating, and what tells two items
 * apart. A widget's is its own poll's (widgetRatingKey), not its app's.
 */
export type RatingKeyOf<T> = (app: T) => string;

/** The ratings store's key for an app; '' without a name and a service. */
export const topRatedKey = (app: RatedApp): string =>
  app?.name && app?.service ? getCacheKey(app.name, app.service) : '';

/** Voted on, and better than the middle of the scale. */
export const isRatedWell = (
  rating: Pick<AppRatingData, 'averageRating' | 'totalVotes'> | null | undefined
): boolean =>
  Number(rating?.totalVotes ?? 0) > 0 &&
  Number(rating?.averageRating ?? 0) > MIDDLE_RATING;

/**
 * The best rated of `apps`: at most `limit` of those rated above three
 * stars, in the order "Highest rated" sorts them, so the number of votes
 * counts too (one five-star vote does not beat fifty good ones). Apps rated
 * alike keep the order they came in.
 */
export const topRatedApps = <T extends RatedApp>(
  apps: readonly T[],
  ratingOf: RatingOf<T>,
  limit = TOP_RATED_LIMIT,
  keyOf: RatingKeyOf<T> = topRatedKey
): T[] => {
  const seen = new Set<string>();
  const rated: T[] = [];
  for (const app of apps ?? []) {
    const key = keyOf(app);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isRatedWell(ratingOf(app))) rated.push(app);
  }
  return rated
    .sort((a, b) => compareByWeightedRating(ratingOf(a), ratingOf(b)))
    .slice(0, limit);
};

const NO_APPS: never[] = [];

/**
 * The best rated of `apps` for a Featured row, from the ratings store with
 * the account's votes still on their way counted in, or none when fewer than
 * `min` (TOP_RATED_MIN) of them are rated well.
 *
 * The node's bulk list gives every app's rating. An older node has no such
 * list, and then the store only knows the apps seen so far: no row, rather
 * than a top 10 of whatever was scrolled past.
 *
 * A refresh empties the store and fills it again. The row on screen stays
 * until its apps have their ratings back, instead of going and coming back.
 */
export const useTopRatedApps = <T extends RatedApp>(
  apps: readonly T[],
  /** Keep it the same function from render to render (module level). */
  keyOf: RatingKeyOf<T> = topRatedKey,
  /** The fewest rated well for a row (widgets are few: one is enough). */
  min = TOP_RATED_MIN
): T[] => {
  // The account's own votes count at once, as on the page that sent them.
  const ratings = useAtomValue(ratingsWithPendingVotesAtom);
  const allLoaded = useAtomValue(allRatingsLoadedAtom);
  const shownRef = useRef<T[]>(NO_APPS);
  const keys = useMemo(() => new Set((apps ?? []).map(keyOf)), [apps, keyOf]);

  return useMemo(() => {
    if (allLoaded === false) {
      shownRef.current = NO_APPS;
      return NO_APPS as T[];
    }
    const shown = shownRef.current;
    const isReloading =
      shown.length > 0 &&
      shown.every((app) => keys.has(keyOf(app))) &&
      shown.some((app) => !ratings.has(keyOf(app)));
    if (isReloading) return shown;

    const top = topRatedApps(
      apps,
      (app) => ratings.get(keyOf(app)),
      TOP_RATED_LIMIT,
      keyOf
    );
    const next = top.length >= min ? top : (NO_APPS as T[]);
    shownRef.current = next;
    return next;
  }, [allLoaded, apps, keyOf, keys, min, ratings]);
};
