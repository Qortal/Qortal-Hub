import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NodeAnswerError,
  coreErrorMessage,
  isRetryableStatus,
  isWorthRetrying,
  nodeAnswerError,
} from './nodeAnswer';
import { publishData } from './publish';

vi.mock('../../i18n/i18n', () => ({
  default: { t: (key: string) => key },
}));
vi.mock('../../background/background', () => ({
  getBaseApi: async () => 'https://test.invalid',
  createEndpoint: async (path: string) => `https://test.invalid${path}`,
}));
vi.mock('../../utils/chromeStorage', () => ({ getData: vi.fn() }));
vi.mock('../../utils/events', () => ({ executeEvent: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = (status: number, text = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => text,
  json: async () => JSON.parse(text),
});

describe('reading the node answer', () => {
  it('retries only what can recover', () => {
    for (const status of [500, 502, 503, 408, 429]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it("uses Core's own message", () => {
    expect(
      coreErrorMessage('{"error":1201,"message":"name already exists"}')
    ).toBe('name already exists');
    expect(coreErrorMessage('plain text')).toBe('plain text');
  });

  it('says the node needs its API key on 401 and 403', async () => {
    for (const status of [401, 403]) {
      const error = await nodeAnswerError(
        answer(status, "Missing 'X-API-KEY' header")
      );
      expect(error.message).toBe('auth:message.error.publish_needs_api_key');
      expect(isWorthRetrying(error)).toBe(false);
    }
  });

  it('retries network errors and 5xx, not other refusals', async () => {
    expect(isWorthRetrying(new TypeError('Failed to fetch'))).toBe(true);
    expect(isWorthRetrying(await nodeAnswerError(answer(503)))).toBe(true);
    expect(isWorthRetrying(await nodeAnswerError(answer(400)))).toBe(false);
    expect(new NodeAnswerError('x', 404).retryable).toBe(false);
  });
});

describe('publishing against those answers', () => {
  const video = () => new File(['video'], 'video.mp4');
  const publishVideo = () =>
    publishData({
      data: video(),
      uploadType: 'file',
      registeredName: 'test',
      service: 'VIDEO',
    });

  it('stops at once when the node wants its API key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(answer(401, "Missing 'X-API-KEY' header"));
    vi.stubGlobal('fetch', fetchMock);

    await expect(publishVideo()).rejects.toThrow(
      'auth:message.error.publish_needs_api_key'
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('says so at finalize too', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(answer(403, 'Forbidden'))
    );

    await expect(publishVideo()).rejects.toThrow(
      'auth:message.error.publish_needs_api_key'
    );
  });

  it('still retries a chunk after a server error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(answer(503, 'busy'))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, text: async () => 'unsigned' });
    vi.stubGlobal('fetch', fetchMock);

    const publishing = publishVideo();
    await vi.advanceTimersByTimeAsync(25_000);
    await publishing;
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://test.invalid/names/test',
      'https://test.invalid/arbitrary/check/tmp?totalSize=5',
      'https://test.invalid/arbitrary/VIDEO/test/chunk',
      'https://test.invalid/arbitrary/VIDEO/test/chunk',
      'https://test.invalid/arbitrary/VIDEO/test/finalize?fee=null',
    ]);
  });

  it("shows Core's message for other refusals, without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
      .mockResolvedValue(
        answer(400, '{"error":1201,"message":"invalid data"}')
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      publishData({
        data: new File([], 'empty.txt'),
        uploadType: 'file',
        registeredName: 'test',
        service: 'DOCUMENT',
      })
    ).rejects.toThrow('invalid data');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
