import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const { show } = vi.hoisted(() => ({
  show: vi.fn(async (_options: unknown) => undefined),
}));
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show }),
}));
vi.mock('../../../background/background', () => ({
  getFee: async () => ({ fee: '0.01' }),
}));

import { appReviewKey, replyIdentifier, replyPrefixOf } from './appPageIds';
import {
  clearReviewRecordCache,
  ReviewActionResult,
  useAppReviews,
} from './useAppReviews';

const KEY = appReviewKey('APP', 'Q-Blog');

const reviewRow = (index: number) => ({
  name: `Reviewer ${index}`,
  identifier: KEY,
  created: 1_000_000 - index,
  metadata: { description: `Review ${index}` },
});

type Answer = (url: URL) => unknown;

/**
 * Answers searches with slices of `reviews` and `replies`, by limit/offset.
 * `own`, when given, answers the search for one author's review.
 */
const node = ({
  reviews = [] as unknown[],
  replies = [] as unknown[],
  record = (() => new Response('', { status: 404 })) as Answer,
  own = undefined as undefined | ((url: URL) => Promise<Response> | Response),
} = {}) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/resources/search')) {
      const identifier = url.searchParams.get('identifier');
      const name = url.searchParams.get('name');
      if (name && own) return own(url);
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
  show.mockClear();
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

describe('reviews of a widget', () => {
  it('lists and publishes them under the widget, apart from its app', async () => {
    const widgetKey = appReviewKey('APP', 'Q-Weather', 'go-widget-now');
    const searched: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/resources/search')) {
        const identifier = url.searchParams.get('identifier') || '';
        searched.push(identifier);
        return new Response(
          JSON.stringify(
            identifier === widgetKey
              ? [
                  {
                    name: 'Alice',
                    identifier: widgetKey,
                    created: 5,
                    metadata: { description: 'Handy' },
                  },
                ]
              : []
          )
        );
      }
      return new Response('', { status: 404 });
    });
    window.sendMessage = vi.fn().mockResolvedValue({ signature: 'TX' });
    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </Provider>
    );
    const { result } = renderHook(
      () =>
        useAppReviews(
          { service: 'APP', name: 'Q-Weather', identifier: 'go-widget-now' },
          { name: 'Me' }
        ),
      { wrapper }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.threads.map((thread) => thread.review.name)).toEqual([
      'Alice',
    ]);
    expect(searched).toContain(widgetKey);
    expect(searched).toContain(replyPrefixOf(widgetKey));
    expect(searched).not.toContain(appReviewKey('APP', 'Q-Weather'));

    await act(async () => {
      expect(await result.current.submitReview('Nice clock')).toEqual({
        ok: true,
      });
    });
    const payload = vi.mocked(window.sendMessage).mock.calls[0][1] as any;
    expect(payload.identifier).toBe(widgetKey);
    // Sent and shown on the widget's page only.
    expect(result.current.threads[0].review).toMatchObject({
      name: 'Me',
      pending: true,
    });
  });
});

describe("the user's own review, before writing", () => {
  const mine = {
    ...reviewRow(7),
    name: 'Me',
    metadata: { description: 'My old review' },
  };
  const fullText = { v: 1, kind: 'review', text: 'My old review, in full.' };

  it("doesn't write until the search for it has answered", async () => {
    node({
      reviews: [reviewRow(1)],
      own: () => new Promise<Response>(() => {}),
    });
    const { result } = renderReviews({ name: 'Me' });
    expect(result.current.myReviewStatus).toBe('loading');
    let outcome: ReviewActionResult | undefined;
    await act(async () => {
      outcome = await result.current.submitReview('Great app');
    });
    expect(outcome).toEqual({
      ok: false,
      message: 'app_page.reviews.loading_yours',
    });
    expect(show).not.toHaveBeenCalled();
  });

  it("doesn't take a failed search for no review, and looks again on Retry", async () => {
    let answer = (): Response => new Response('', { status: 500 });
    node({
      reviews: [reviewRow(1)],
      own: () => answer(),
      record: (url) =>
        url.pathname.includes('/Me/')
          ? fullText
          : new Response('', { status: 404 }),
    });
    const { result } = renderReviews({ name: 'Me' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.myReviewStatus).toBe('failed');
    // The other reviews still show.
    expect(result.current.threads.map((thread) => thread.review.name)).toEqual([
      'Reviewer 1',
    ]);
    let outcome: ReviewActionResult | undefined;
    await act(async () => {
      outcome = await result.current.submitReview('A new review');
    });
    expect(outcome).toEqual({
      ok: false,
      message: 'app_page.reviews.yours_failed',
    });
    expect(show).not.toHaveBeenCalled();

    answer = () => new Response(JSON.stringify([mine]));
    act(() => result.current.retryMyReview());
    await waitFor(() => expect(result.current.myReviewStatus).toBe('ready'));
    expect(result.current.myReview).toMatchObject({
      name: 'Me',
      text: 'My old review, in full.',
      complete: true,
    });
  });

  it("waits for its whole text, and offers Retry when that can't load", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let served = false;
    node({
      reviews: [mine],
      record: () =>
        served
          ? fullText
          : new Response('Data unavailable. Please try again later.', {
              status: 404,
            }),
    });
    const recordFetches = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) =>
          String(url).includes('/arbitrary/COMMENT/Me/')
        ).length;
    const { result } = renderReviews({ name: 'Me' });
    await waitFor(() => expect(result.current.myReview?.name).toBe('Me'));
    expect(result.current.myReviewStatus).toBe('loading');
    // Asked three times, 20 s apart, then given up on.
    await waitFor(() => expect(recordFetches()).toBe(1));
    for (const tries of [2, 3]) {
      await act(async () => vi.advanceTimersByTimeAsync(21_000));
      await waitFor(() => expect(recordFetches()).toBe(tries));
    }
    await waitFor(() => expect(result.current.myReviewStatus).toBe('failed'));

    served = true;
    act(() => result.current.retryMyReview());
    await waitFor(() => expect(result.current.myReviewStatus).toBe('ready'));
    expect(result.current.myReview?.text).toBe('My old review, in full.');
  });
});

describe('Load more', () => {
  it('asks for one page at a time, and moves past each page once', async () => {
    const reviews = Array.from({ length: 160 }, (_, index) => reviewRow(index));
    const fetches = node({ reviews });
    const { result } = renderReviews();
    await waitFor(() => expect(result.current.threads).toHaveLength(50));

    // Two quick clicks ask for the next page once.
    await act(async () => {
      await Promise.all([result.current.loadMore(), result.current.loadMore()]);
    });
    for (let page = 0; page < 3 && result.current.hasMore; page++) {
      await act(async () => {
        await result.current.loadMore();
      });
    }
    expect(result.current.threads).toHaveLength(160);
    expect(result.current.loadingMore).toBe(false);
    const offsets = fetches.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter(
        (url) =>
          url.pathname.endsWith('/resources/search') &&
          url.searchParams.get('identifier') === KEY
      )
      .map((url) => Number(url.searchParams.get('offset')));
    expect(offsets).toEqual([0, 50, 100, 150]);
  });
});
