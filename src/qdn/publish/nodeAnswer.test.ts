import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NodeAnswerError,
  coreErrorMessage,
  isRetryableStatus,
  isWorthRetrying,
  nodeAnswerError,
} from './nodeAnswer';
import { publishData } from './publish';
import { attachQAppFileClient } from '../../qortal/qapp-file-reference';

vi.mock('../../i18n/i18n', () => ({
  default: { t: (key: string) => key },
}));
vi.mock('../../background/background', () => ({
  getBaseApi: async () => 'https://test.invalid',
  createEndpoint: async (path: string) => `https://test.invalid${path}`,
}));
vi.mock('../../utils/chromeStorage', () => ({ getData: vi.fn() }));
vi.mock('../../utils/events', () => ({ executeEvent: vi.fn() }));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = (status: number, text = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => text,
  json: async () => JSON.parse(text),
});

// Exercise the real client decoding and publisher retry logic together. The
// executor tests cover producing these replies across a real MessageChannel.
const nativeVideo = (replies: Array<number | 'network' | 'ok'>) => {
  let file;
  const upload = vi.fn();
  const port = {
    close: vi.fn(),
    addEventListener: vi.fn(),
    onmessage: undefined,
    postMessage: ({ id, operation }) => {
      if (!operation) return;
      upload(operation);
      const reply = replies.shift();
      queueMicrotask(() =>
        port.onmessage({
          data:
            reply === 'ok'
              ? { id, result: null }
              : reply === 'network'
                ? { id, error: 'QAPP_FILE_OPERATION_FAILED' }
                : { id, error: 'QAPP_FILE_UPLOAD_FAILED', status: reply },
        })
      );
    },
  } as any;
  cleanups.push(
    attachQAppFileClient(
      port,
      (data) => {
        file = data.file;
      },
      vi.fn()
    )
  );
  const reference = {};
  port.onmessage({
    data: {
      kind: 'request',
      data: { file: reference },
      files: [{ reference, size: 5, type: 'video/mp4', name: 'video.mp4' }],
    },
  });
  return { file, upload };
};

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

  it.each([400, 401, 403, 404, 409])(
    'does not retry a native Q-App upload refused with HTTP %s',
    async (status) => {
      const { file, upload } = nativeVideo([status]);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        publishData({
          data: file,
          uploadType: 'file',
          registeredName: 'test',
          service: 'VIDEO',
        })
      ).rejects.toThrow(
        status === 401 || status === 403
          ? 'auth:message.error.publish_needs_api_key'
          : `HTTP ${status}`
      );
      expect(upload).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2); // No finalize after refusal.
    }
  );

  it.each([408, 429, 500, 503, 'network'] as const)(
    'still retries native Q-App uploads after %s and finalizes once',
    async (status) => {
      vi.useFakeTimers();
      const { file, upload } = nativeVideo([status, 'ok']);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, text: async () => 'unsigned' });
      vi.stubGlobal('fetch', fetchMock);
      const publishing = publishData({
        data: file,
        uploadType: 'file',
        registeredName: 'test',
        service: 'VIDEO',
      });
      await vi.advanceTimersByTimeAsync(24_999);
      expect(upload).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await publishing;
      expect(upload).toHaveBeenCalledTimes(2);
      expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][0]).toContain('/finalize');
    }
  );

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

  it('bounds retries of a persistently failing native upload without finalizing', async () => {
    vi.useFakeTimers();
    const { file, upload } = nativeVideo([503, 503, 503]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const rejected = expect(
      publishData({
        data: file,
        uploadType: 'file',
        registeredName: 'test',
        service: 'VIDEO',
      })
    ).rejects.toThrow('Chunk 0 failed after 3 attempts');
    await vi.advanceTimersByTimeAsync(50_000);
    await rejected;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])(
    'explains HTTP %s at the storage precheck before uploading',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
        .mockResolvedValueOnce(answer(status, 'Forbidden'));
      vi.stubGlobal('fetch', fetchMock);

      await expect(publishVideo()).rejects.toThrow(
        'auth:message.error.publish_needs_api_key'
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain('/arbitrary/check/tmp');
    }
  );

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
