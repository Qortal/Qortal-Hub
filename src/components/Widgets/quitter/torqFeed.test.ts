import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuitterFeedItem } from './quitterFeedTypes';
import {
  fetchTorqHiddenUsers,
  hiddenUserKey,
  parseTorqHiddenUsers,
  qappCoreHash,
  resetTorqHiddenUsersCache,
  torqFeedItems,
  torqPostLink,
  torqSettingsIdentifier,
  visibleTorqPostText,
} from './torqFeed';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

const toBase64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

const feedItem = (overrides: Partial<QuitterFeedItem>): QuitterFeedItem => ({
  author: 'Alice',
  avatarUrl: '',
  hasVideo: false,
  id: 'Alice:post-1',
  identifier: 'post-1',
  images: [],
  latestSignature: 'sig',
  publishedAt: 1,
  searchCreatedAt: 1,
  service: 'DOCUMENT',
  text: 'hello',
  ...overrides,
});

describe('qappCoreHash', () => {
  it('gives the prefix Quitter and Torq posts are published under', async () => {
    await expect(qappCoreHash('quitter', 14)).resolves.toBe('MhNiRYdzkaP9dz');
  });

  it('gives the identifier of the Torq settings document', async () => {
    await expect(torqSettingsIdentifier()).resolves.toBe('J1C9DVxuyT0OMH');
  });
});

describe('parseTorqHiddenUsers', () => {
  it('reads the hidden users from the settings JSON', () => {
    expect(
      parseTorqHiddenUsers(JSON.stringify({ hiddenUsers: ['Bob', 'Carol'] }))
    ).toEqual(['Bob', 'Carol']);
  });

  it('reads base64 and settings nested under data', () => {
    expect(
      parseTorqHiddenUsers(toBase64(JSON.stringify({ hiddenUsers: ['Bob'] })))
    ).toEqual(['Bob']);
    expect(
      parseTorqHiddenUsers({ data: JSON.stringify({ hiddenUsers: ['Dan'] }) })
    ).toEqual(['Dan']);
  });

  it('tidies names and drops repeats the way Torq compares them', () => {
    expect(
      parseTorqHiddenUsers({
        hiddenUsers: ['@Bob', ' bob ', 'Carol  Smith', 42, '', '@@'],
      })
    ).toEqual(['Bob', 'Carol Smith']);
  });

  it('gives none for anything else', () => {
    expect(parseTorqHiddenUsers('not json')).toEqual([]);
    expect(parseTorqHiddenUsers({ hiddenUsers: 'Bob' })).toEqual([]);
    expect(parseTorqHiddenUsers(null)).toEqual([]);
  });
});

describe('hiddenUserKey', () => {
  it('ignores case, a leading @ and extra spaces', () => {
    expect(hiddenUserKey(' @Carol   Smith ')).toBe(
      hiddenUserKey('carol smith')
    );
  });
});

describe('visibleTorqPostText', () => {
  const post = { author: 'Alice B', identifier: 'post-1' };

  it('drops the links Torq adds for Quitter readers', () => {
    const text = [
      'gm everyone',
      'qortal://use-embed/GIF/abc',
      '',
      '',
      `Open in Torq: ${torqPostLink(post.author, post.identifier)}.`,
    ].join('\n');
    expect(visibleTorqPostText(text, post)).toBe(
      'gm everyone\n\nOpen in Torq: .'
    );
  });

  it('keeps other links', () => {
    const text =
      'see qortal://APP/Q-Tube/video/x and qortal://APP/Torq/post/Bob/2';
    expect(visibleTorqPostText(text, post)).toBe(text);
  });

  it('drops a Q-Share link only when the post has attachments', () => {
    const text = 'file: qortal://APP/Q-Share/share/Alice/f1';
    expect(visibleTorqPostText(text, post)).toBe(text);
    expect(visibleTorqPostText(text, { ...post, hasAttachments: true })).toBe(
      'file:'
    );
  });
});

describe('torqFeedItems', () => {
  it('leaves out hidden users and cleans the text', () => {
    const kept = feedItem({ author: 'Alice', id: 'a' });
    const cleaned = feedItem({
      author: 'Carol',
      id: 'c',
      text: 'hi qortal://use-embed/GIF/abc',
    });
    const hidden = feedItem({ author: 'BOB', id: 'b' });

    const result = torqFeedItems(
      [kept, hidden, cleaned],
      new Set([hiddenUserKey('bob')])
    );

    expect(result.map((item) => item.id)).toEqual(['a', 'c']);
    expect(result[0]).toBe(kept);
    expect(result[1].text).toBe('hi');
    expect(cleaned.text).toBe('hi qortal://use-embed/GIF/abc');
  });
});

describe('fetchTorqHiddenUsers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetTorqHiddenUsersCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body = '') =>
    Promise.resolve(new Response(body, { status }));

  it('reads the account’s Torq settings document and caches the list', async () => {
    fetchMock.mockReturnValue(
      answer(200, JSON.stringify({ hiddenUsers: ['Bob'] }))
    );

    await expect(fetchTorqHiddenUsers('Alice B')).resolves.toEqual(['Bob']);
    await expect(fetchTorqHiddenUsers('Alice B')).resolves.toEqual(['Bob']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://node.test/arbitrary/DOCUMENT/Alice%20B/J1C9DVxuyT0OMH'
    );
  });

  it('reads it again when forced', async () => {
    fetchMock
      .mockReturnValueOnce(
        answer(200, JSON.stringify({ hiddenUsers: ['Bob'] }))
      )
      .mockReturnValueOnce(
        answer(200, JSON.stringify({ hiddenUsers: ['Bob', 'Carol'] }))
      );

    await fetchTorqHiddenUsers('Alice');
    await expect(
      fetchTorqHiddenUsers('Alice', { force: true })
    ).resolves.toEqual(['Bob', 'Carol']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives none when the account never saved Torq settings', async () => {
    fetchMock.mockReturnValue(answer(404));
    await expect(fetchTorqHiddenUsers('Alice')).resolves.toEqual([]);
  });

  it('keeps the last list when the node fails, and retries a minute later', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockReturnValueOnce(
        answer(200, JSON.stringify({ hiddenUsers: ['Bob'] }))
      )
      .mockReturnValueOnce(answer(500))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await fetchTorqHiddenUsers('Alice');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(fetchTorqHiddenUsers('Alice')).resolves.toEqual(['Bob']);
    await expect(fetchTorqHiddenUsers('Alice')).resolves.toEqual(['Bob']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60 * 1000 + 1);
    await expect(fetchTorqHiddenUsers('Alice')).resolves.toEqual(['Bob']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('asks nothing without a name', async () => {
    await expect(fetchTorqHiddenUsers('  ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
