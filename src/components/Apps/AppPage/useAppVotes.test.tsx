import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const refresh = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: async () => undefined }),
}));
vi.mock('../../../background/background', () => ({
  getFee: async () => ({ fee: '0.01' }),
}));
// A stable refresh, as the real hook gives: the page mustn't rely on it
// changing to look again.
vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({ refresh }),
}));

import { useAppVotes } from './useAppVotes';
import { PENDING_VOTE_TTL } from './appVotes';
import {
  isPendingVoteWatchedOnPage,
  pendingVoteKey,
  pendingVotesAtom,
} from './appPageStore';

const POLL = {
  pollName: 'app-library-APP-rating-Q-Blog',
  owner: 'QOwner',
  pollOptions: ['1', '2', '3', '4', '5', 'initialValue-5'].map(
    (optionName) => ({ optionName })
  ),
};

/** The node has the poll, but never the user's vote. */
const node = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/polls/votes/'))
      return new Response(JSON.stringify({ votes: [], voteCounts: [] }));
    if (url.includes('/polls/')) return new Response(JSON.stringify(POLL));
    return new Response('', { status: 404 });
  });

const votesFetches = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes('/polls/votes/')).length;

const renderVotes = (address = 'QMe', store = createStore()) => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Provider>
  );
  return renderHook(
    ({ me }) => useAppVotes({ service: 'APP', name: 'Q-Blog' }, me),
    { initialProps: { me: { address, name: 'Me' } }, wrapper }
  );
};

const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  window.sendMessage = vi.fn().mockResolvedValue({ signature: 'TX' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a first vote waiting for its block', () => {
  it('keeps looking every block, not just once', async () => {
    node();
    const { result } = renderVotes();
    await flush();
    await act(async () => {
      await result.current.vote(4);
    });
    expect(result.current.pending?.rating).toBe(4);
    const before = votesFetches();

    for (let i = 0; i < 5; i++) {
      await act(async () => vi.advanceTimersByTimeAsync(12_000));
    }
    expect(votesFetches() - before).toBeGreaterThanOrEqual(5);
    expect(result.current.pending?.rating).toBe(4);
  });

  it('is dropped as lost after a while', async () => {
    node();
    const { result } = renderVotes();
    await flush();
    await act(async () => {
      await result.current.vote(4);
    });
    await act(async () =>
      vi.advanceTimersByTimeAsync(PENDING_VOTE_TTL + 15_000)
    );
    expect(result.current.pending).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("isn't shown to another account on this Hub", async () => {
    node();
    const { result, rerender } = renderVotes();
    await flush();
    await act(async () => {
      await result.current.vote(4);
    });
    rerender({ me: { address: 'QOther', name: 'Other' } });
    expect(result.current.pending).toBeNull();
    // Their own 4 stars aren't refused as already given.
    let outcome: Awaited<ReturnType<typeof result.current.vote>>;
    await act(async () => {
      outcome = await result.current.vote(4);
    });
    expect(outcome!).toEqual({ ok: true });
  });
});

describe('a vote left behind when its page closes', () => {
  it('names its app, and is the page’s to look for only while it is open', async () => {
    node();
    const store = createStore();
    const key = pendingVoteKey('QMe', 'APP', 'Q-Blog');
    const { result, unmount } = renderVotes('QMe', store);
    await flush();
    expect(isPendingVoteWatchedOnPage(key)).toBe(true);

    await act(async () => {
      await result.current.vote(4);
    });
    expect(store.get(pendingVotesAtom)[key]).toMatchObject({
      name: 'Q-Blog',
      rating: 4,
      service: 'APP',
    });

    unmount();
    // PendingVotesWatcher takes it from here.
    expect(isPendingVoteWatchedOnPage(key)).toBe(false);
    expect(store.get(pendingVotesAtom)[key]).toBeDefined();
  });
});
