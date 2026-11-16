import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

const fetchRating = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));
vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRatings: () => ({ fetchRating }),
}));
// Each public key below is 32 times one byte: its address names the byte.
vi.mock('../../../utils/generateWallet/publicKeyToAddress', () => ({
  default: (publicKey: Uint8Array) => `Q-${publicKey[0]}`,
}));

import Base58 from '../../../encryption/Base58';
import {
  pendingVoteKey,
  pendingVotesAtom,
  watchPendingVoteOnPage,
} from './appPageStore';
import {
  addressFromPublicKey,
  PENDING_VOTE_CHECK_MS,
  PENDING_VOTE_TTL,
  type PendingVote,
} from './appVotes';
import { PendingVotesWatcher } from './PendingVotesWatcher';

const voterPublicKey = (Base58 as any).encode(new Uint8Array(32).fill(7));
const voter = addressFromPublicKey(voterPublicKey) as string;
const key = pendingVoteKey(voter, 'APP', 'Q-Blog');

const POLL = {
  pollName: 'app-library-APP-rating-Q-Blog',
  owner: 'QOwner',
  creatorPublicKey: (Base58 as any).encode(new Uint8Array(32).fill(9)),
  pollOptions: ['1', '2', '3', '4', '5', 'initialValue-3'].map(
    (optionName) => ({ optionName })
  ),
};

/** The node's poll, with the user's 5 stars once `hasVote()` says so. */
const node = (hasVote: () => boolean) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/polls/votes/'))
      return new Response(
        JSON.stringify({
          votes: hasVote() ? [{ optionIndex: 4, voterPublicKey }] : [],
          voteCounts: [],
        })
      );
    if (url.includes('/polls/')) return new Response(JSON.stringify(POLL));
    return new Response('', { status: 404 });
  });

const sentVote = (): PendingVote => ({
  voter,
  rating: 5,
  createdPoll: false,
  sentAt: Date.now(),
  name: 'Q-Blog',
  service: 'APP',
});

const renderWatcher = (pending: PendingVote) => {
  const store = createStore();
  store.set(pendingVotesAtom, { [key]: pending });
  render(
    <Provider store={store}>
      <PendingVotesWatcher />
    </Provider>
  );
  return store;
};

const nextCheck = () =>
  act(async () => vi.advanceTimersByTimeAsync(PENDING_VOTE_CHECK_MS));

beforeEach(() => {
  vi.useFakeTimers();
  fetchRating.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The library's cards only read the cached rating: voting is on the app's
// page. Leaving the page before the vote is in a block mustn't leave the
// cards on the old rating for the cache's half hour.
describe('a vote whose app page has closed', () => {
  it('is looked for until the node has it, then the rating is fetched again', async () => {
    let isIn = false;
    node(() => isIn);
    const store = renderWatcher(sentVote());

    await nextCheck();
    await nextCheck();
    expect(fetchRating).not.toHaveBeenCalled();
    expect(store.get(pendingVotesAtom)[key]).toBeDefined();

    isIn = true;
    await nextCheck();
    expect(fetchRating).toHaveBeenCalledWith('Q-Blog', 'APP', true);
    expect(store.get(pendingVotesAtom)[key]).toBeUndefined();
  });

  it('is dropped when too old, and the rating is fetched once more', async () => {
    node(() => false);
    const store = renderWatcher({
      ...sentVote(),
      sentAt: Date.now() - PENDING_VOTE_TTL - 1,
    });

    await nextCheck();
    expect(store.get(pendingVotesAtom)[key]).toBeUndefined();
    expect(fetchRating).toHaveBeenCalledTimes(1);
  });

  it('is left to its page while the page is open', async () => {
    node(() => true);
    const release = watchPendingVoteOnPage(key);
    const store = renderWatcher(sentVote());

    await nextCheck();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get(pendingVotesAtom)[key]).toBeDefined();

    release();
    await nextCheck();
    expect(fetchRating).toHaveBeenCalledWith('Q-Blog', 'APP', true);
    expect(store.get(pendingVotesAtom)[key]).toBeUndefined();
  });

  it('asks the node nothing while no vote waits', async () => {
    node(() => true);
    const store = createStore();
    render(
      <Provider store={store}>
        <PendingVotesWatcher />
      </Provider>
    );
    await nextCheck();
    expect(fetch).not.toHaveBeenCalled();
  });
});
