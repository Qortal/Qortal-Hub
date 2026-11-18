import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

import { userInfoAtom } from '../../../atoms/global';
import { getCacheKey, ratingsStoreAtom } from '../../../hooks/useAppRatings';
import { pendingVotesAtom } from './appPageStore';
import {
  myPendingVotesAtom,
  ratingsWithPendingVotesAtom,
  usePendingVoteFor,
} from './optimisticRatings';

const vote = (voter: string, name: string, rating = 5) => ({
  voter,
  rating,
  createdPoll: true,
  sentAt: 1,
  name,
  service: 'APP',
});

const signedIn = (address: string | null = 'QMe') => {
  const store = createStore();
  store.set(userInfoAtom, address ? { address } : null);
  return store;
};

describe('the library’s ratings with votes on their way', () => {
  it("counts only the signed-in account's votes", () => {
    const store = signedIn();
    store.set(pendingVotesAtom, {
      a: vote('QMe', 'Q-Weather-id-go-widget-now'),
      b: vote('QOther', 'Notes'),
    });
    expect(store.get(myPendingVotesAtom).map((item) => item.name)).toEqual([
      'Q-Weather-id-go-widget-now',
    ]);
    const ratings = store.get(ratingsWithPendingVotesAtom);
    expect(
      ratings.get(getCacheKey('Q-Weather-id-go-widget-now', 'APP'))
    ).toMatchObject({ averageRating: 5, totalVotes: 1 });
    expect(ratings.has(getCacheKey('Notes', 'APP'))).toBe(false);
  });

  it('is the store itself while none is on its way, or nobody is signed in', () => {
    const store = signedIn();
    const ratings = new Map();
    store.set(ratingsStoreAtom, ratings);
    expect(store.get(ratingsWithPendingVotesAtom)).toBe(ratings);

    store.set(userInfoAtom, null);
    store.set(pendingVotesAtom, { a: vote('QMe', 'Chess') });
    expect(store.get(ratingsWithPendingVotesAtom)).toBe(ratings);
  });

  it("gives a card its own vote, whatever the name's casing", () => {
    const store = signedIn();
    store.set(pendingVotesAtom, { a: vote('QMe', 'Chess', 4) });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const chess = renderHook(() => usePendingVoteFor('chess', 'app'), {
      wrapper,
    });
    expect(chess.result.current?.rating).toBe(4);
    const notes = renderHook(() => usePendingVoteFor('Notes', 'APP'), {
      wrapper,
    });
    expect(notes.result.current).toBeNull();
  });
});
