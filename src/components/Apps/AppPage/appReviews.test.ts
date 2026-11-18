import { afterEach, describe, expect, it, vi } from 'vitest';
import { appReviewKey, replyIdentifier, replyPrefixOf } from './appPageIds';
import {
  buildReviewThreads,
  deleteReviewItem,
  fetchReviewRecord,
  isPendingReviewListed,
  parseReviewRecord,
  publishReply,
  publishReview,
  reviewItemKey,
  reviewKeyOf,
  ReviewRecord,
  ReviewResource,
  reviewSnippet,
  searchAppReviews,
  serializeReviewRecord,
  withPrevious,
} from './appReviews';

const APP = { service: 'APP', name: 'Q-Blog' };
const KEY = appReviewKey('APP', 'Q-Blog');

const review = (
  name: string,
  created: number,
  extra: Partial<ReviewResource> = {}
): ReviewResource => ({
  name,
  identifier: KEY,
  kind: 'review',
  created,
  updated: created,
  signature: `sig-${name}-${created}`,
  snippet: `${name} says hi`,
  parentName: null,
  ...extra,
});

const reply = (
  name: string,
  parent: string,
  created: number,
  suffix: string
): ReviewResource => ({
  name,
  identifier: replyIdentifier(KEY, suffix),
  kind: 'reply',
  created,
  updated: created,
  signature: `sig-${name}-${suffix}`,
  snippet: `${name} answers`,
  parentName: parent,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('review records', () => {
  it('round-trip, with the reply parent', () => {
    const record: ReviewRecord = {
      kind: 'reply',
      text: ' Thanks! ',
      parent: { name: 'Alice', identifier: KEY },
      created: 10,
      edited: 0,
      deleted: false,
    };
    const parsed = parseReviewRecord(serializeReviewRecord(record, APP));
    expect(parsed).toEqual({ ...record, text: 'Thanks!' });
  });

  it('refuse other shapes', () => {
    expect(parseReviewRecord('{"v":2}')).toBeNull();
    expect(parseReviewRecord('nope')).toBeNull();
    expect(
      parseReviewRecord({ v: 1, kind: 'reply', parent: 'x' })?.parent
    ).toBeNull();
  });

  it('cut long text to the limit', () => {
    const parsed = parseReviewRecord({
      v: 1,
      kind: 'review',
      text: 'x'.repeat(5000),
    });
    expect(parsed.text).toHaveLength(2000);
  });

  it('give the node a one-line snippet within 240 bytes', () => {
    expect(reviewSnippet('  Great\n\napp  ')).toBe('Great app');
    const long = reviewSnippet('ж'.repeat(300));
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(240);
  });
});

describe('buildReviewThreads', () => {
  it('puts replies under their review, newest reviews first', () => {
    const threads = buildReviewThreads(
      [
        review('Alice', 100),
        review('Bob', 300),
        reply('Q-Blog', 'alice', 200, 'a1'),
        reply('Carol', 'Alice', 150, 'a2'),
        reply('Dan', 'Nobody', 160, 'a3'),
      ],
      new Map()
    );
    expect(threads.map((thread) => thread.review.name)).toEqual([
      'Bob',
      'Alice',
    ]);
    expect(threads[1].replies.map((item) => item.name)).toEqual([
      'Carol',
      'Q-Blog',
    ]);
    expect(threads[1].review.text).toBe('Alice says hi');
    expect(threads[1].review.complete).toBe(false);
  });

  it('uses the loaded record for the whole text and removals', () => {
    const records = new Map<string, ReviewRecord | null>([
      [
        reviewItemKey('Alice', KEY),
        {
          kind: 'review',
          text: 'The whole text',
          parent: null,
          created: 100,
          edited: 0,
          deleted: false,
        },
      ],
      [
        reviewItemKey('Bob', KEY),
        {
          kind: 'review',
          text: '',
          parent: null,
          created: 300,
          edited: 400,
          deleted: true,
        },
      ],
    ]);
    const threads = buildReviewThreads(
      [review('Alice', 100), review('Bob', 300)],
      records
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].review).toMatchObject({
      text: 'The whole text',
      complete: true,
    });
  });

  it('keeps a removed review while it has replies', () => {
    const records = new Map<string, ReviewRecord | null>([
      [
        reviewItemKey('Bob', KEY),
        {
          kind: 'review',
          text: '',
          parent: null,
          created: 300,
          edited: 400,
          deleted: true,
        },
      ],
    ]);
    const threads = buildReviewThreads(
      [review('Bob', 300), reply('Q-Blog', 'Bob', 350, 'x')],
      records
    );
    expect(threads[0].review.deleted).toBe(true);
    expect(threads[0].replies).toHaveLength(1);
  });

  it('shows a sent review at the top until the node lists it', () => {
    const sentAt = 1_000_000;
    const pending = [
      {
        name: 'Me',
        identifier: KEY,
        sentAt,
        signature: 'sig-Me-995000',
        older: [],
        previousUpdated: 0,
        record: {
          kind: 'review' as const,
          text: 'Mine',
          parent: null,
          created: sentAt,
          edited: 0,
          deleted: false,
        },
      },
    ];
    const before = buildReviewThreads(
      [review('Alice', 2_000_000)],
      new Map(),
      pending
    );
    expect(before[0].review).toMatchObject({
      name: 'Me',
      pending: true,
      text: 'Mine',
    });

    const listed = buildReviewThreads(
      [review('Alice', 2_000_000), review('Me', sentAt - 5_000)],
      new Map(),
      pending
    );
    expect(
      listed.find((thread) => thread.review.name === 'Me')?.review.pending
    ).toBe(false);
  });

  it('shows an edit in place of the older listed review', () => {
    const pending = [
      {
        name: 'Alice',
        identifier: KEY,
        sentAt: 900_000,
        signature: 'sig-edit',
        older: ['sig-Alice-100'],
        previousUpdated: 100,
        record: {
          kind: 'review' as const,
          text: 'Edited',
          parent: null,
          created: 100,
          edited: 900_000,
          deleted: false,
        },
      },
    ];
    const threads = buildReviewThreads(
      [review('Alice', 100)],
      new Map(),
      pending
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].review).toMatchObject({
      text: 'Edited',
      pending: true,
      created: 100,
    });
  });

  it('shows an edit made a moment after the review until the edit is listed', () => {
    const posted = review('Alice', 1_000_000);
    const sent = {
      name: 'Alice',
      identifier: KEY,
      sentAt: 1_030_000,
      signature: 'sig-edit',
      record: {
        kind: 'review' as const,
        text: 'Fixed a typo',
        parent: null,
        created: 1_000_000,
        edited: 1_030_000,
        deleted: false,
      },
    };
    const pending = [withPrevious(sent, posted, undefined)];
    // Listed 30 s before the edit was sent: still the old version.
    expect(isPendingReviewListed(pending[0], posted)).toBe(false);
    expect(
      buildReviewThreads([posted], new Map(), pending)[0].review
    ).toMatchObject({ text: 'Fixed a typo', pending: true });

    const edited = { ...posted, updated: 1_031_000, signature: 'sig-edit' };
    expect(isPendingReviewListed(pending[0], edited)).toBe(true);
    expect(
      buildReviewThreads([edited], new Map(), pending)[0].review.pending
    ).toBe(false);
  });

  it("doesn't take the first post for a removal sent before it was listed", () => {
    const post = withPrevious(
      {
        name: 'Me',
        identifier: KEY,
        sentAt: 1_000_000,
        signature: 'sig-post',
        record: {
          kind: 'review',
          text: 'Hi',
          parent: null,
          created: 1_000_000,
          edited: 0,
          deleted: false,
        },
      },
      undefined,
      undefined
    );
    const removal = withPrevious(
      {
        ...post,
        sentAt: 1_020_000,
        signature: 'sig-removal',
        record: { ...post.record, text: '', deleted: true },
      },
      undefined,
      post
    );
    expect(removal.older).toEqual(['sig-post']);
    const listedPost = review('Me', 1_000_500, { signature: 'sig-post' });
    expect(isPendingReviewListed(removal, listedPost)).toBe(false);
    expect(buildReviewThreads([listedPost], new Map(), [removal])).toEqual([]);
  });

  it('hides a removal whose record has not loaded yet', () => {
    const threads = buildReviewThreads(
      [review('Alice', 100), review('Bob', 300, { snippet: '' })],
      new Map()
    );
    expect(threads.map((thread) => thread.review.name)).toEqual(['Alice']);
  });
});

describe('searchAppReviews', () => {
  const answer = (list: unknown[]) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => list,
    } as Response);

  it("keeps only this app's reviews, with every resource of each name", async () => {
    const other = appReviewKey('APP', 'Q-Blog2');
    answer([
      {
        name: 'Alice',
        identifier: KEY,
        created: 5,
        latestSignature: 'A1',
        metadata: { description: 'Nice' },
      },
      { name: 'Bob', identifier: replyIdentifier(KEY, 'abc'), created: 6 },
      { name: 'Eve', identifier: other, created: 7 },
      { name: 'Eve', identifier: `${KEY}x`, created: 8 },
    ]);
    const page = await searchAppReviews('http://node', APP);
    expect(page).toEqual({
      items: [
        {
          name: 'Alice',
          identifier: KEY,
          kind: 'review',
          created: 5,
          updated: 5,
          signature: 'A1',
          snippet: 'Nice',
          parentName: null,
        },
      ],
      rows: 4,
    });
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain('service=COMMENT');
    // Without mode=ALL, Core keeps one resource per name: a reviewer's
    // later reply would hide their review.
    expect(url).toContain('mode=ALL');
    expect(url).toContain(`identifier=${KEY}&`);
    expect(url).toContain('prefix=true');
    expect(url).toContain('excludeblocked=true');
  });

  it('pages the replies by themselves, under their own prefix', async () => {
    answer([
      {
        name: 'Bob',
        identifier: replyIdentifier(KEY, 'abc'),
        created: 6,
        updated: 9,
        metadata: { title: 'Alice', description: 'Agreed' },
      },
      { name: 'Alice', identifier: KEY, created: 5 },
    ]);
    const page = await searchAppReviews('http://node', APP, { kind: 'reply' });
    expect(page.items).toEqual([
      {
        name: 'Bob',
        identifier: replyIdentifier(KEY, 'abc'),
        kind: 'reply',
        created: 6,
        updated: 9,
        signature: '',
        snippet: 'Agreed',
        parentName: 'Alice',
      },
    ]);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain(`identifier=${replyPrefixOf(KEY)}&`);
    expect(url).toContain('mode=ALL');
  });

  it("finds one author's review by name", async () => {
    answer([
      {
        name: 'Me',
        identifier: KEY,
        created: 5,
        metadata: { description: 'x' },
      },
      { name: 'Meg', identifier: KEY, created: 6 },
    ]);
    const page = await searchAppReviews('http://node', APP, { name: 'Me' });
    expect(page.items.map((item) => item.name)).toEqual(['Me']);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain('&name=Me&exactmatchnames=true');
  });
});

describe('fetchReviewRecord', () => {
  it('asks again later when the node has no data yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Data unavailable. Please try again later.', { status: 404 })
    );
    expect(
      await fetchReviewRecord('http://node', 'Alice', KEY)
    ).toBeUndefined();
  });

  it('is null for data that is not a review record', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('hello'));
    expect(await fetchReviewRecord('http://node', 'Alice', KEY)).toBeNull();
  });
});

describe('publishing', () => {
  it('publishes a review under the app key, with a snippet', async () => {
    const send = vi.fn().mockResolvedValue({ signature: 'sig' });
    window.sendMessage = send;
    const sent = await publishReview(APP, 'Alice', '  Love it  ', { now: 50 });
    expect(sent).toMatchObject({
      name: 'Alice',
      identifier: KEY,
      sentAt: 50,
      signature: 'sig',
    });
    const [action, payload] = send.mock.calls[0];
    expect(action).toBe('publishOnQDN');
    expect(payload).toMatchObject({
      service: 'COMMENT',
      identifier: KEY,
      name: 'Alice',
      description: 'Love it',
      uploadType: 'base64',
    });
    const json = JSON.parse(atob(payload.data));
    expect(json).toMatchObject({
      v: 1,
      kind: 'review',
      text: 'Love it',
      created: 50,
    });
  });

  it("keeps a review's first date when it's edited", async () => {
    window.sendMessage = vi.fn().mockResolvedValue({});
    const sent = await publishReview(APP, 'Alice', 'New text', {
      created: 10,
      now: 99,
    });
    expect(sent.record).toMatchObject({ created: 10, edited: 99 });
  });

  it('names the review a reply answers in its title', async () => {
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    await publishReply(
      APP,
      'Q-Blog',
      { name: 'Alice', identifier: KEY },
      'Thanks'
    );
    const payload = send.mock.calls[0][1];
    expect(payload.title).toBe('Alice');
    expect(payload.identifier.startsWith(replyPrefixOf(KEY))).toBe(true);
  });

  it('removes an item by publishing an empty one, without a snippet', async () => {
    const send = vi.fn().mockResolvedValue({ signature: 'gone' });
    window.sendMessage = send;
    const sent = await deleteReviewItem(APP, 'Alice', {
      identifier: KEY,
      kind: 'review',
      created: 10,
      parentName: null,
    });
    expect(sent.signature).toBe('gone');
    expect(send.mock.calls[0][1].description).toBeUndefined();
    expect(JSON.parse(atob(send.mock.calls[0][1].data)).deleted).toBe(true);
  });

  it('turns a node error into a rejection', async () => {
    window.sendMessage = vi
      .fn()
      .mockResolvedValue({ error: 'Insufficient balance' });
    await expect(publishReview(APP, 'Alice', 'x')).rejects.toThrow(
      'Insufficient balance'
    );
  });
});

describe('a widget under its own identifier', () => {
  const WIDGET = {
    service: 'APP',
    name: 'Q-Weather',
    identifier: 'go-widget-now',
  };
  const WIDGET_KEY = appReviewKey('APP', 'Q-Weather', 'go-widget-now');
  const APP_KEY = appReviewKey('APP', 'Q-Weather');

  it('has its own reviews, not those of the app beside it', async () => {
    expect(reviewKeyOf(WIDGET)).toBe(WIDGET_KEY);
    expect(reviewKeyOf({ ...WIDGET, identifier: null })).toBe(APP_KEY);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { name: 'Alice', identifier: WIDGET_KEY, created: 5 },
        { name: 'Bob', identifier: APP_KEY, created: 6 },
      ],
    } as Response);
    const page = await searchAppReviews('http://node', WIDGET);
    expect(page.items.map((item) => item.name)).toEqual(['Alice']);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain(`identifier=${WIDGET_KEY}&`);
  });

  it('publishes reviews, replies and removals under its key, naming it', async () => {
    const send = vi.fn().mockResolvedValue({ signature: 'sig' });
    window.sendMessage = send;
    await publishReview(WIDGET, 'Alice', 'Handy', { now: 50 });
    await publishReply(
      WIDGET,
      'Q-Weather',
      { name: 'Alice', identifier: WIDGET_KEY },
      'Thanks'
    );
    await deleteReviewItem(WIDGET, 'Bob', {
      identifier: replyIdentifier(WIDGET_KEY, 'abc'),
      kind: 'reply',
      created: 10,
      parentName: 'Alice',
    });
    const [review, answer, removal] = send.mock.calls.map((call) => call[1]);
    expect(review.identifier).toBe(WIDGET_KEY);
    expect(JSON.parse(atob(review.data)).app).toEqual(WIDGET);
    expect(answer.identifier.startsWith(replyPrefixOf(WIDGET_KEY))).toBe(true);
    expect(JSON.parse(atob(removal.data)).parent).toEqual({
      name: 'Alice',
      identifier: WIDGET_KEY,
    });
  });

  it("leaves the identifier out of an app's record", () => {
    const record = parseReviewRecord(
      serializeReviewRecord(
        {
          kind: 'review',
          text: 'Hi',
          parent: null,
          created: 1,
          edited: 0,
          deleted: false,
        },
        { service: 'APP', name: 'Q-Weather', identifier: 'default' }
      )
    );
    expect(record?.text).toBe('Hi');
    expect(
      JSON.parse(
        serializeReviewRecord(
          {
            kind: 'review',
            text: 'Hi',
            parent: null,
            created: 1,
            edited: 0,
            deleted: false,
          },
          APP
        )
      ).app
    ).toEqual({ service: 'APP', name: 'Q-Blog' });
  });
});
