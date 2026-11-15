import { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { getBaseApiReact } from '../../../App';
import { useAppRatings } from '../../../hooks/useAppRatings';
import { isPendingVoteWatchedOnPage, pendingVotesAtom } from './appPageStore';
import {
  fetchPollInfo,
  fetchPollVotes,
  isPendingVoteConfirmed,
  PENDING_VOTE_CHECK_MS,
  PENDING_VOTE_TTL,
  type PendingVote,
  votersFromPoll,
} from './appVotes';

/** Whether the node now lists the pending vote in the app's poll. */
export const isPendingVoteOnNode = async (
  base: string,
  pending: PendingVote,
  signal?: AbortSignal
): Promise<boolean> => {
  const [poll, list] = await Promise.all([
    fetchPollInfo(base, pending.service, pending.name, signal),
    fetchPollVotes(base, pending.service, pending.name, signal),
  ]);
  if (!poll) return false;
  const mine =
    votersFromPoll(poll, list?.votes || []).find(
      (voter) => voter.address === pending.voter
    ) || null;
  return isPendingVoteConfirmed(pending, mine);
};

/**
 * Votes are cast on an app's page, which looks for its vote until the node
 * has it (useAppVotes). A page closed before then leaves the vote here: it is
 * looked for until it is in, or too old, and then the app's rating is fetched
 * again, so the library's cards show it. Mount once, beside the ratings cache.
 */
export const PendingVotesWatcher = () => {
  const [pendingVotes, setPendingVotes] = useAtom(pendingVotesAtom);
  const { fetchRating } = useAppRatings();
  const latest = useRef(pendingVotes);
  latest.current = pendingVotes;
  const hasPending = Object.keys(pendingVotes).length > 0;

  useEffect(() => {
    if (!hasPending) return;
    const controller = new AbortController();
    let isChecking = false;

    const check = async () => {
      if (isChecking) return;
      isChecking = true;
      try {
        const base = getBaseApiReact();
        const settled: [string, PendingVote][] = [];
        await Promise.all(
          Object.entries(latest.current).map(async ([key, pending]) => {
            if (!pending?.name || !pending.service) return;
            if (isPendingVoteWatchedOnPage(key)) return;
            const isTooOld = Date.now() - pending.sentAt > PENDING_VOTE_TTL;
            const isIn =
              !isTooOld &&
              (await isPendingVoteOnNode(
                base,
                pending,
                controller.signal
              ).catch(() => false));
            if (isTooOld || isIn) settled.push([key, pending]);
          })
        );
        if (controller.signal.aborted || !settled.length) return;
        setPendingVotes((previous) => {
          const next = { ...previous };
          // A newer vote sent meanwhile stays.
          settled.forEach(([key, pending]) => {
            if (next[key] === pending) delete next[key];
          });
          return next;
        });
        // A vote dropped as too old may still have come in.
        settled.forEach(([, pending]) =>
          fetchRating(pending.name, pending.service, true)
        );
      } finally {
        isChecking = false;
      }
    };

    const timer = setInterval(check, PENDING_VOTE_CHECK_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [fetchRating, hasPending, setPendingVotes]);

  return null;
};
