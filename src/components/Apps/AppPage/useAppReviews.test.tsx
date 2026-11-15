import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: async () => undefined }),
}));
vi.mock('../../../background/background', () => ({
  getFee: async () => ({ fee: '0.01' }),
}));

import { appReviewKey, replyIdentifier, replyPrefixOf } from './appPageIds';
import { clearReviewRecordCache, useAppReviews } from './useAppReviews';

const KEY = appReviewKey('APP', 'Q-Blog');

const reviewRow = (index: number) => ({
  name: `Reviewer ${index}`,
  identifier: KEY,
  created: 1_000_000 - index,
  metadata: { description: `Review ${index}` },
});

type Answer = (url: URL) => unknown;

/** Answers searches with slices of `reviews` and `replies`, by limit/offset. */
const node = ({
  reviews = [] as unknown[],
  replies = [] as unknown[],
  record = (() => new Response('', { status: 404 })) as Answer,
} = {}) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/resources/search')) {
      const identifier = url.searchParams.get('identifier');
      const name = url.searchParams.get('name');
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset') || 0);
      let list = identifier === KEY ? reviews : replies;
      if (identifier !== KEY && identifier !== replyPrefixOf(KEY)) list = [];
      if (name) list = list.filter((item: any) => item.name === name);
      return new Response(JSON.stringify(list.slice(offset, offset + limit)));
    }
    const value = record(url);
    return value instanceof Response
      ? value
      : new Response(JSON.stringify(value));
  });

const renderReviews = (me: { name?: string } = {}) => {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Provider>
  );
  return renderHook(
    () => useAppReviews({ service: 'APP', name: 'Q-Blog' }, me),
    { wrapper }
  );
};

beforeEach(() => {
  clearReviewRecordCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loading reviews', () => {
  it("doesn't let many replies push the reviews off the page", async () => {
    const replies = Array.from({ length: 120 }, (_, index) => ({
      name: `Fan ${index}`,
      identifier: replyIdentifier(KEY, `r${index}`),
      created: 2_000_000 - index,
      metadata: { title: 'Nobody', description: 'spam' },
    }));
    node({ reviews: [reviewRow(1)], replies });
    const { result } = renderReviews();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.threads.map((thread) => thread.review.name)).toEqual([
      'Reviewer 1',
    ]);
  });

  it('keeps the pages loaded with Load more when it looks again', async () => {
    const reviews = Array.from({ length: 60 }, (_, index) => reviewRow(index));
    node({ reviews });
    const { result } = renderReviews();
    await waitFor(() => expect(result.current.threads).toHaveLength(50));
    expect(result.current.hasMore).toBe(true);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.threads).toHaveLength(60);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.threads).toHaveLength(60);
  });

  it("finds the user's own review when it isn't on the first page", async () => {
    const reviews = [
      ...Array.from({ length: 50 }, (_, index) => reviewRow(index)),
      { ...reviewRow(99), name: 'Me', metadata: { description: 'Mine' } },
    ];
    node({ reviews });
    const { result } = renderReviews({ name: 'Me' });
    await waitFor(() => expect(result.current.myReview?.name).toBe('Me'));
  });

  it('shows a reply whose review is on a page not loaded yet', async () => {
    const reviews = [
      ...Array.from({ length: 50 }, (_, index) => reviewRow(index)),
      { ...reviewRow(99), name: 'Old Timer' },
    ];
    node({
      reviews,
      replies: [
        {
          name: 'Q-Blog',
          identifier: replyIdentifier(KEY, 'x'),
          created: 3_000_000,
          metadata: { title: 'Old Timer', description: 'Thanks!' },
        },
      ],
    });
    const { result } = renderReviews();
    await waitFor(() =>
      expect(
        result.current.threads.find(
          (thread) => thread.review.name === 'Old Timer'
        )?.replies
      ).toHaveLength(1)
    );
  });
});

describe('loading the whole text', () => {
  it('asks again when the node could not serve a record yet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let tries = 0;
    node({
      reviews: [reviewRow(1)],
      record: () =>
        ++tries === 1
          ? new Response('Data unavailable. Please try again later.', {
              status: 404,
            })
          : { v: 1, kind: 'review', text: 'Review 1, in full.' },
    });
    const { result } = renderReviews();
    await waitFor(() => expect(tries).toBe(1));
    expect(result.current.threads[0].review).toMatchObject({
      text: 'Review 1',
      complete: false,
    });
    await act(async () => vi.advanceTimersByTimeAsync(21_000));
    await waitFor(() =>
      expect(result.current.threads[0].review).toMatchObject({
        text: 'Review 1, in full.',
        complete: true,
      })
    );
  });
});
