import { useMemo } from 'react';
import { atom, useAtomValue } from 'jotai';
import { ratingsWithPendingVotesAtom } from '../AppPage/optimisticRatings';
import type { AppRatingData } from '../../../types/ratings';
import type { SortOption } from '../Filters/SortDropdown';

const EMPTY_RATINGS_MAP = new Map<string, AppRatingData>();

/**
 * The ratings store, for the sorts that need it, with the account's votes
 * still on their way counted in. Any other sort gets an empty map, so a list
 * sorted by name does not re-render each time a rating loads.
 */
export const useRatingsForSort = (
  sort: SortOption
): Map<string, AppRatingData> => {
  const isRatingSort = sort === 'highest_rated' || sort === 'most_rated';
  const ratingsForSortAtom = useMemo(
    () =>
      atom((get) =>
        isRatingSort ? get(ratingsWithPendingVotesAtom) : EMPTY_RATINGS_MAP
      ),
    [isRatingSort]
  );
  return useAtomValue(ratingsForSortAtom);
};
