import Base58 from '../../../encryption/Base58';
import publicKeyToAddress from '../../../utils/generateWallet/publicKeyToAddress';
import type { PollInfo, VoteCount } from '../../../types/ratings';
import { normalizeAppService } from './appPageIds';

/**
 * Ratings are the existing Qortal polls `app-library-<SERVICE>-rating-<name>`:
 * options "1".."5" plus "initialValue-N", the rating of whoever created the
 * poll (creating it is their vote). These helpers read who voted what, and
 * show a vote at once while its transaction waits for a block.
 */

export const ratingPollName = (service: string, name: string) =>
  `app-library-${normalizeAppService(service)}-rating-${name}`;

export interface PollVote {
  optionIndex: number;
  voterPublicKey: string;
}

export interface PollVotes {
  votes: PollVote[];
  voteCounts: VoteCount[];
}

export interface Voter {
  address: string;
  rating: number;
  /** The poll's creator, whose rating came with creating it. */
  isInitial: boolean;
}

export type StarCounts = Record<1 | 2 | 3 | 4 | 5, number>;

export interface RatingSummary {
  average: number;
  total: number;
  counts: StarCounts;
}

export const EMPTY_COUNTS = (): StarCounts => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
});

const INITIAL_PREFIX = 'initialValue-';

const starOf = (value: unknown): 1 | 2 | 3 | 4 | 5 | null => {
  const number =
    typeof value === 'number' ? value : parseInt(String(value), 10);
  return number >= 1 && number <= 5 && Number.isInteger(number)
    ? (number as 1 | 2 | 3 | 4 | 5)
    : null;
};

/** The creator's rating, from the poll's "initialValue-N" option. */
export const initialRating = (
  options: Array<{ optionName: string }> | undefined
): number | null => {
  const option = options?.find((item) =>
    String(item?.optionName || '').startsWith(INITIAL_PREFIX)
  );
  return option ? starOf(option.optionName.slice(INITIAL_PREFIX.length)) : null;
};

/**
 * Counts per star, the same way the library's cards count them: every vote
 * on "1".."5", plus one for the creator's initial rating.
 */
export const summarizeVoteCounts = (
  voteCounts: VoteCount[] = []
): RatingSummary => {
  const counts = EMPTY_COUNTS();
  voteCounts.forEach((vote) => {
    const name = String(vote?.optionName || '');
    if (name.startsWith(INITIAL_PREFIX)) {
      const star = starOf(name.slice(INITIAL_PREFIX.length));
      if (star) counts[star] += 1;
      return;
    }
    const star = starOf(name);
    if (star) counts[star] += Math.max(0, Number(vote?.voteCount) || 0);
  });
  return summaryFromCounts(counts);
};

/**
 * Counts per star from the rows of votersFromPoll: each voter's latest vote,
 * plus the creator's first rating. That is how the library's cards count
 * (summarizeVoteCounts), so the page and the library show the same rating.
 */
export const summaryFromVoters = (voters: Voter[]): RatingSummary => {
  const counts = EMPTY_COUNTS();
  voters.forEach((voter) => {
    const star = starOf(voter.rating);
    if (star) counts[star] += 1;
  });
  return summaryFromCounts(counts);
};

export const summaryFromCounts = (counts: StarCounts): RatingSummary => {
  let total = 0;
  let score = 0;
  ([1, 2, 3, 4, 5] as const).forEach((star) => {
    total += counts[star];
    score += counts[star] * star;
  });
  return { average: total > 0 ? score / total : 0, total, counts };
};

const addressCache = new Map<string, string>();

export const addressFromPublicKey = (publicKey: string): string | null => {
  if (!publicKey) return null;
  const cached = addressCache.get(publicKey);
  if (cached) return cached;
  try {
    const address = publicKeyToAddress((Base58 as any).decode(publicKey));
    if (typeof address !== 'string' || !address) return null;
    addressCache.set(publicKey, address);
    return address;
  } catch {
    return null;
  }
};

/**
 * One row per person: their latest vote on "1".."5", or for the poll's
 * creator, the initial rating when they never voted afterwards. The creator
 * is read from the creator's public key: the poll's `owner` is any address
 * the creator chose, so it can't say who gave the first rating.
 */
export const votersFromPoll = (
  poll: Pick<PollInfo, 'creatorPublicKey' | 'pollOptions'> | null,
  votes: PollVote[] = [],
  toAddress: (publicKey: string) => string | null = addressFromPublicKey
): Voter[] => {
  const options = poll?.pollOptions || [];
  const byAddress = new Map<string, Voter>();
  votes.forEach((vote) => {
    const option = options[vote?.optionIndex];
    const star = option ? starOf(option.optionName) : null;
    if (!star) return;
    const address = toAddress(vote.voterPublicKey);
    if (!address) return;
    byAddress.set(address, { address, rating: star, isInitial: false });
  });
  const rows = Array.from(byAddress.values());
  // The creator's first rating counts as well, also once they have voted
  // again: the library's cards count it from the poll's totals, which can't
  // say who voted. So it keeps a row of its own.
  const initial = initialRating(options);
  const creator = poll?.creatorPublicKey
    ? toAddress(poll.creatorPublicKey)
    : null;
  if (creator && initial) {
    rows.push({ address: creator, rating: initial, isInitial: true });
  }
  return rows.sort((a, b) => b.rating - a.rating);
};

/**
 * Someone's rating as it stands: their latest vote, or else the first rating
 * they gave by creating the poll.
 */
export const voterOf = (
  voters: Voter[],
  address: string | null | undefined
): Voter | null =>
  (address &&
    (voters.find((voter) => voter.address === address && !voter.isInitial) ||
      voters.find((voter) => voter.address === address))) ||
  null;

/**
 * Each person's stars, as their review shows them: their latest vote, or else
 * the first rating they gave by creating the poll.
 */
export const ratingsByAddress = (voters: Voter[]): Map<string, number> => {
  const ratings = new Map<string, number>();
  voters.forEach((voter) => {
    if (!voter.isInitial || !ratings.has(voter.address)) {
      ratings.set(voter.address, voter.rating);
    }
  });
  return ratings;
};

export const fetchPollVotes = async (
  base: string,
  service: string,
  name: string,
  signal?: AbortSignal
): Promise<PollVotes | null> => {
  const response = await fetch(
    `${base}/polls/votes/${encodeURIComponent(ratingPollName(service, name))}`,
    { signal }
  );
  if (!response.ok) return null;
  const data = await response.json();
  if (!data || !Array.isArray(data.votes)) return null;
  return {
    votes: data.votes,
    voteCounts: Array.isArray(data.voteCounts) ? data.voteCounts : [],
  };
};

/** Core's answer for a poll it doesn't have: 404, error 501 (POLL_NO_EXISTS). */
const isNoSuchPoll = (data: any): boolean =>
  data?.error === 501 || String(data?.message || '').includes('POLL_NO_EXISTS');

/**
 * The app's rating poll, or null when the node says there is none. Anything
 * else throws (an error page, a timeout, an answer that isn't a poll): a poll
 * the node couldn't send is not a missing one, and voting must not create it
 * again.
 */
export const fetchPollInfo = async (
  base: string,
  service: string,
  name: string,
  signal?: AbortSignal
): Promise<PollInfo | null> => {
  const response = await fetch(
    `${base}/polls/${encodeURIComponent(ratingPollName(service, name))}`,
    { signal }
  );
  const data = await response.json().catch(() => null);
  if (response.ok && data?.pollName) return data;
  if (response.status === 404 && isNoSuchPoll(data)) return null;
  throw new Error(`Rating poll not read (${response.status})`);
};

/** A vote the user sent that the node doesn't show yet. */
export interface PendingVote {
  /** The account that voted: another account on this Hub doesn't see it. */
  voter: string;
  rating: number;
  /** The vote created the poll: the rating is its initial value. */
  createdPoll: boolean;
  sentAt: number;
  /**
   * The app, as its poll is named: after its page has closed, the vote is
   * still looked for by these (PendingVotesWatcher).
   */
  name?: string;
  service?: string;
}

/** Whether the node now shows the pending vote. */
export const isPendingVoteConfirmed = (
  pending: PendingVote | null,
  mine: Voter | null
): boolean =>
  !!pending &&
  !!mine &&
  mine.rating === pending.rating &&
  (!mine.isInitial || pending.createdPoll);

/** The summary as it will be once the pending vote is in a block. */
export const applyPendingVote = (
  summary: RatingSummary,
  pending: PendingVote | null,
  mine: Voter | null
): RatingSummary => {
  if (!pending || isPendingVoteConfirmed(pending, mine)) return summary;
  const star = starOf(pending.rating);
  if (!star) return summary;
  const counts = { ...summary.counts };
  // A vote replaces the voter's earlier vote. The creator's first rating
  // stays: it counts as well, as the library counts it.
  const before = mine && !mine.isInitial ? starOf(mine.rating) : null;
  if (before && counts[before] > 0) counts[before] -= 1;
  counts[star] += 1;
  return summaryFromCounts(counts);
};

/** How long a sent vote is shown before it's dropped as lost. */
export const PENDING_VOTE_TTL = 10 * 60 * 1000;

/** How often a sent vote is looked for, until the node has it. */
export const PENDING_VOTE_CHECK_MS = 12_000;
