import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

// As the app's i18n: values aren't HTML-escaped (src/i18n/i18n.ts).
i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: { en: { core: {} } },
});

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
// Each public key here is 32 times one byte: its address names the byte.
vi.mock('../../../utils/generateWallet/publicKeyToAddress', () => ({
  default: (publicKey: Uint8Array) => `Q-${publicKey[0]}`,
}));

import Base58 from '../../../encryption/Base58';
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

describe("a widget's own poll", () => {
  const WIDGET_POLL = 'app-library-APP-rating-Q-Weather-id-go-widget-now';

  it('is read and created under the widget, not the app beside it', async () => {
    i18n.addResource(
      'en',
      'core',
      'message.generic.rating',
      'rating for {{ service }} {{ name }}'
    );
    // No poll yet: the first rating creates it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ message: 'POLL_NO_EXISTS' }), {
          status: 404,
        })
    );
    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </Provider>
    );
    const { result } = renderHook(
      () =>
        useAppVotes(
          { service: 'APP', name: 'Q-Weather', identifier: 'go-widget-now' },
          { address: 'QMe', name: 'Me' }
        ),
      { wrapper }
    );
    await flush();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(
      expect.arrayContaining([
        `http://node/polls/${WIDGET_POLL}`,
        `http://node/polls/votes/${WIDGET_POLL}`,
      ])
    );
    expect(urls.some((url) => url.endsWith('-rating-Q-Weather'))).toBe(false);

    await act(async () => {
      await result.current.vote(5);
    });
    const [action, payload] = vi.mocked(window.sendMessage).mock.calls[0] as [
      string,
      any,
    ];
    expect(action).toBe('createPoll');
    expect(payload).toMatchObject({
      pollName: WIDGET_POLL,
      pollOptions: ['1, 2, 3, 4, 5, initialValue-5'],
      pollOwnerAddress: 'Me',
    });
    expect(payload.pollDescription).toBe(
      'rating for APP Q-Weather/go-widget-now'
    );
    // Watched under the poll's subject, which is also what the library's
    // ratings keep the widget under, so its card shows the vote once in.
    const key = pendingVoteKey('QMe', 'APP', 'Q-Weather-id-go-widget-now');
    expect(store.get(pendingVotesAtom)[key]).toMatchObject({
      name: 'Q-Weather-id-go-widget-now',
      service: 'APP',
      rating: 5,
      createdPoll: true,
    });
  });
});

describe('the library while a vote waits, and after', () => {
  // A voter whose key and address the node and the page agree on.
  const VOTER_KEY = (Base58 as any).encode(new Uint8Array(32).fill(7));
  const VOTER = 'Q-7';

  /** The poll, with `votes` as the node lists them at the time. */
  const nodeWith = (votes: () => unknown[]) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/polls/votes/'))
        return new Response(JSON.stringify({ votes: votes(), voteCounts: [] }));
      if (url.includes('/polls/')) return new Response(JSON.stringify(POLL));
      return new Response('', { status: 404 });
    });

  it('records the earlier vote a new one moves', async () => {
    // The voter gave 3 stars before (option 2).
    nodeWith(() => [{ optionIndex: 2, voterPublicKey: VOTER_KEY }]);
    const store = createStore();
    const { result } = renderVotes(VOTER, store);
    await flush();
    expect(result.current.mine?.rating).toBe(3);
    await act(async () => {
      await result.current.vote(5);
    });
    expect(
      store.get(pendingVotesAtom)[pendingVoteKey(VOTER, 'APP', 'Q-Blog')]
    ).toMatchObject({ rating: 5, replaces: 3, createdPoll: false });
  });

  it('keeps the vote counted until the library has fetched the rating again', async () => {
    let votes: unknown[] = [];
    nodeWith(() => votes);
    let finish: (value: unknown) => void = () => {};
    refresh.mockImplementation(
      () => new Promise((resolve) => (finish = resolve))
    );
    const store = createStore();
    const key = pendingVoteKey(VOTER, 'APP', 'Q-Blog');
    const { result } = renderVotes(VOTER, store);
    await flush();
    await act(async () => {
      await result.current.vote(4);
    });
    expect(store.get(pendingVotesAtom)[key]).toMatchObject({
      rating: 4,
      replaces: null,
    });

    // The node has the vote now (option 3 is "4").
    votes = [{ optionIndex: 3, voterPublicKey: VOTER_KEY }];
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.get(pendingVotesAtom)[key]).toBeDefined();

    await act(async () => {
      finish(null);
    });
    expect(store.get(pendingVotesAtom)[key]).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
