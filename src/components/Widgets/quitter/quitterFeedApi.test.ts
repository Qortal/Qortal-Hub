import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  QUITTER_FEED_NAMES_QUERY_BUDGET,
  buildQuitterFeedSearchUrl,
  fetchQuitterFollowedNames,
  quitterFeedNamesWithinBudget,
} from './quitterFeedApi';

/** A follow document as Core's search lists it, newest first. */
const followDoc = (index: number, size = 96) => ({
  created: 1_700_000_000_000 - index,
  identifier: `gY.TWOeB25Co.7follow${index}`,
  latestSignature: `sig${index}`,
  name: 'Reader',
  service: 'DOCUMENT',
  size,
});

/**
 * A node with `docs` follow documents for every user. Follow document N says
 * the user follows `Followed N`. `refuse(n)` says whether the n-th read of
 * follow data (1-based) gets Core's answer for a repository problem: HTTP 500
 * with a JSON error body.
 */
const mockNode = (
  docs: ReturnType<typeof followDoc>[],
  refuse: (read: number) => boolean = () => false
) => {
  let reads = 0;
  const fetchMock = vi.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        reads += 1;
        if (refuse(reads)) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 5, message: 'repository issue' }),
          };
        }
        const asked = JSON.parse(init.body as string) as {
          identifier: string;
        }[];
        return {
          ok: true,
          json: async () =>
            asked.map(({ identifier }) => ({
              identifier,
              data: btoa(
                JSON.stringify({
                  followedName: `Followed ${identifier.split('follow')[1]}`,
                })
              ),
            })),
        };
      }
      return { ok: true, json: async () => docs };
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const postsTo = (fetchMock: ReturnType<typeof mockNode>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchQuitterFollowedNames', () => {
  it('reads every follow document, not only the newest 60', async () => {
    const fetchMock = mockNode([followDoc(1)]);
    await fetchQuitterFollowedNames('All Docs Reader');

    const searchUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(searchUrl.searchParams.get('limit')).toBe('0');
  });

  it('keeps all follows, beyond 24, newest first', async () => {
    mockNode(Array.from({ length: 47 }, (_, i) => followDoc(i + 1)));

    const names = await fetchQuitterFollowedNames('Many Follows Reader');
    expect(names).toHaveLength(47);
    expect(names.slice(0, 2)).toEqual(['Followed 1', 'Followed 2']);
  });

  it('skips unfollowed (32-byte) and oversized documents', async () => {
    mockNode([followDoc(1), followDoc(2, 32), followDoc(3, 400), followDoc(4)]);

    expect(await fetchQuitterFollowedNames('Unfollow Reader')).toEqual([
      'Followed 1',
      'Followed 4',
    ]);
  });

  it('reads follow data in batches of 100', async () => {
    const fetchMock = mockNode(
      Array.from({ length: 150 }, (_, i) => followDoc(i + 1))
    );

    expect(await fetchQuitterFollowedNames('Batch Reader')).toHaveLength(150);
    const posts = postsTo(fetchMock);
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0][1].body)).toHaveLength(100);
    expect(JSON.parse(posts[1][1].body)).toHaveLength(50);
  });

  it('leaves out a follow of the reader under other letter case', async () => {
    mockNode([followDoc(1), followDoc(2)]);

    // Follow document 1 names the reader, written as "Followed 1".
    expect(await fetchQuitterFollowedNames('followed 1')).toEqual([
      'Followed 2',
    ]);
  });

  it('stops at 400 names', async () => {
    const fetchMock = mockNode(
      Array.from({ length: 450 }, (_, i) => followDoc(i + 1))
    );

    expect(await fetchQuitterFollowedNames('Busy Reader')).toHaveLength(400);
    expect(postsTo(fetchMock)).toHaveLength(4);
  });
});

describe('fetchQuitterFollowedNames when the node refuses the follow data', () => {
  it('fails rather than say the reader follows nobody', async () => {
    mockNode([followDoc(1)], () => true);

    await expect(fetchQuitterFollowedNames('Refused Reader')).rejects.toThrow(
      'Request failed with status 500'
    );
  });

  it('asks the node again next time, within the 5-minute cache', async () => {
    const fetchMock = mockNode([followDoc(1)], (read) => read === 1);

    await expect(
      fetchQuitterFollowedNames('Recovering Reader')
    ).rejects.toThrow();
    expect(await fetchQuitterFollowedNames('Recovering Reader')).toEqual([
      'Followed 1',
    ]);
    expect(postsTo(fetchMock)).toHaveLength(2);
  });

  it('keeps no list cut short by one refused batch', async () => {
    // 150 follows are two reads; the second one is refused the first time.
    mockNode(
      Array.from({ length: 150 }, (_, i) => followDoc(i + 1)),
      (read) => read === 2
    );

    await expect(fetchQuitterFollowedNames('Half Reader')).rejects.toThrow();
    expect(await fetchQuitterFollowedNames('Half Reader')).toHaveLength(150);
  });

  it('stops reading when the feed load is cancelled', async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { method?: string; signal?: AbortSignal }) =>
        init?.method === 'POST'
          ? // The node takes its time: only a cancel ends this read.
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError'))
              );
            })
          : { ok: true, json: async () => [followDoc(1)] }
    );
    vi.stubGlobal('fetch', fetchMock);
    const load = new AbortController();

    const names = fetchQuitterFollowedNames('Patient Reader', load.signal);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
      ).toBe(true)
    );
    load.abort();

    await expect(names).rejects.toThrow('Aborted');
  });
});

describe('the Following feed search', () => {
  it('asks for exact name matches when it filters by names', () => {
    const url = new URL(buildQuitterFeedSearchUrl(10, 0, ['Al', 'Bo']));
    expect(url.searchParams.get('exactmatchnames')).toBe('true');
    expect(url.searchParams.getAll('name')).toEqual(['Al', 'Bo']);
  });

  it('leaves the general feed unfiltered', () => {
    const url = new URL(buildQuitterFeedSearchUrl(10, 0));
    expect(url.searchParams.has('exactmatchnames')).toBe(false);
    expect(url.searchParams.has('name')).toBe(false);
  });

  it("keeps the names within Core's request size, newest first", () => {
    const names = Array.from(
      { length: 400 },
      (_, i) => `A rather long followed name ${i}`
    );
    const kept = quitterFeedNamesWithinBudget(names);

    expect(kept.length).toBeGreaterThan(100);
    expect(kept.length).toBeLessThan(names.length);
    expect(kept).toEqual(names.slice(0, kept.length));
    const query = kept
      .map((name) => `&name=${encodeURIComponent(name)}`)
      .join('');
    expect(query.length).toBeLessThanOrEqual(QUITTER_FEED_NAMES_QUERY_BUDGET);

    const url = buildQuitterFeedSearchUrl(10, 0, names);
    expect(url.length).toBeLessThan(7000);
  });
});
