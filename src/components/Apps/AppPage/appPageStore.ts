import { atom } from 'jotai';
import type { PendingVote } from './appVotes';
import type { PendingReview } from './appReviews';
import { normalizeAppIdentifier, normalizeAppService } from './appPageIds';

/**
 * One key per app, the same however the name is cased. A widget (an APP
 * under an identifier of its own) adds its identifier after a line break,
 * which no name can hold.
 */
export const appStoreKey = (
  service: string,
  name: string,
  identifier?: string | null
) => {
  const own = normalizeAppIdentifier(identifier);
  return `${normalizeAppService(service)}:${String(name || '').toLowerCase()}${
    own ? `\n${own}` : ''
  }`;
};

/** The key of a vote sent by `address` on the app. */
export const pendingVoteKey = (
  address: string | undefined,
  service: string,
  name: string
) => `${address || ''}|${appStoreKey(service, name)}`;

/**
 * Votes sent from this Hub that the node doesn't show yet, per account and
 * app (pendingVoteKey).
 */
export const pendingVotesAtom = atom<Record<string, PendingVote>>({});

/** The pending vote keys an open app page looks for itself, and how often. */
const votesWatchedOnPage = new Map<string, number>();

/**
 * An open app page looks for its own pending vote (useAppVotes): while it
 * does, PendingVotesWatcher leaves that vote to it. Returns the release.
 */
export const watchPendingVoteOnPage = (key: string) => {
  votesWatchedOnPage.set(key, (votesWatchedOnPage.get(key) ?? 0) + 1);
  return () => {
    const left = (votesWatchedOnPage.get(key) ?? 1) - 1;
    if (left > 0) votesWatchedOnPage.set(key, left);
    else votesWatchedOnPage.delete(key);
  };
};

export const isPendingVoteWatchedOnPage = (key: string) =>
  votesWatchedOnPage.has(key);

/** Reviews and replies sent from this Hub, not listed yet, per app. */
export const pendingReviewsAtom = atom<Record<string, PendingReview[]>>({});

/** The app whose page asked the user to review it after their vote. */
export const reviewPromptAtom = atom<{ key: string; rating: number } | null>(
  null
);
