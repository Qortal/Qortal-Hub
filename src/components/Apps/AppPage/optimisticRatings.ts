import { useMemo } from 'react';
import { atom, useAtomValue } from 'jotai';
import { userInfoAtom } from '../../../atoms/global';
import { getCacheKey, ratingsStoreAtom } from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { pendingVotesAtom } from './appPageStore';
import { type PendingVote, ratingWithPendingVote } from './appVotes';

/**
 * A vote is shown at once on the page that sent it (useAppVotes). These show
 * it at once in the library too: on the cards, in the Featured rows and in
 * the "Highest rated" sort, while its transaction waits for a block. Only the
 * account that voted sees it, as on the page.
 *
 * The vote stays pending until the node has it and the store has fetched the
 * app's rating again (useAppVotes, PendingVotesWatcher), so it is never
 * counted twice for long, nor dropped in between.
 */

const NO_VOTES: PendingVote[] = [];

/** The signed-in account's votes still on their way. */
export const myPendingVotesAtom = atom((get): PendingVote[] => {
  const address: string | undefined = get(userInfoAtom)?.address;
  if (!address) return NO_VOTES;
  const mine = Object.values(get(pendingVotesAtom)).filter(
    (pending) =>
      pending?.voter === address && !!pending.name && !!pending.service
  );
  return mine.length ? mine : NO_VOTES;
});

const isFor = (pending: PendingVote, name: string, service: string) =>
  String(pending.name).toLowerCase() === name.toLowerCase() &&
  String(pending.service).toUpperCase() === service.toUpperCase();

/**
 * The account's pending vote on the app (or the widget, by its poll's name),
 * or null. A card re-renders only when its own vote changes.
 */
export const usePendingVoteFor = (
  name?: string,
  service?: string
): PendingVote | null => {
  const voteAtom = useMemo(
    () =>
      atom((get) =>
        name && service
          ? (get(myPendingVotesAtom).find((pending) =>
              isFor(pending, name, service)
            ) ?? null)
          : null
      ),
    [name, service]
  );
  return useAtomValue(voteAtom);
};

/**
 * The ratings store with the account's pending votes counted in: the same
 * store while there are none.
 */
export const ratingsWithPendingVotesAtom = atom(
  (get): Map<string, AppRatingData> => {
    const store = get(ratingsStoreAtom);
    const pending = get(myPendingVotesAtom);
    if (pending.length === 0) return store;
    const next = new Map(store);
    pending.forEach((vote) => {
      const key = getCacheKey(String(vote.name), String(vote.service));
      const rating = ratingWithPendingVote(store.get(key), vote);
      if (rating) next.set(key, rating);
    });
    return next;
  }
);
