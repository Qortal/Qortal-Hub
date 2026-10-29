import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPublishStorage, requirePublishFile } from './upload-validation';
import { publishData } from './publish';

vi.mock('../../i18n/i18n', () => ({
  default: {
    t: (key: string, values?: { status: number }) =>
      values ? `${key}:${values.status}` : key,
  },
}));
vi.mock('../../background/background', () => ({
  getBaseApi: async () => 'https://test.invalid',
  createEndpoint: async (path: string) => `https://test.invalid${path}`,
}));
vi.mock('../../utils/chromeStorage', () => ({ getData: vi.fn() }));
vi.mock('../../utils/events', () => ({ executeEvent: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe('publishing input and storage checks', () => {
  it('continues through chunk upload and finalization when the precheck succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'unsigned-transaction',
      });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['video'], 'video.mp4');
    await publishData({
      data: file,
      uploadType: 'file',
      registeredName: 'test',
      service: 'VIDEO',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://test.invalid/names/test',
      'https://test.invalid/arbitrary/check/tmp?totalSize=5',
      'https://test.invalid/arbitrary/VIDEO/test/chunk',
      'https://test.invalid/arbitrary/VIDEO/test/finalize?fee=null',
    ]);
    const form = fetchMock.mock.calls[2][1].body as FormData;
    expect((form.get('chunk') as File).size).toBe(5);
    expect((form.get('chunk') as File).name).toBe('video.mp4');
  });
  it.each([{}, { size: 10 }, null, 'not a file'])(
    'rejects damaged file data before building a storage request: %j',
    (input) => {
      expect(() => requirePublishFile(input)).toThrow(
        'question:publish_validation.invalid_file'
      );
    }
  );

  it('accepts Blob, File and empty-file inputs', () => {
    for (const file of [
      new Blob(['video']),
      new File(['video'], 'video.mp4'),
      new Blob([]),
    ]) {
      expect(() => requirePublishFile(file)).not.toThrow();
    }
  });

  it.each([undefined, NaN, -1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'does not submit an invalid size: %s',
    async (size) => {
      const endpoint = vi.fn();
      await expect(checkPublishStorage(size, endpoint)).rejects.toThrow(
        'question:publish_validation.invalid_file'
      );
      expect(endpoint).not.toHaveBeenCalled();
    }
  );

  it.each([400, 401, 404, 500, 507])(
    'does not mislabel HTTP %s as a full disk',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        checkPublishStorage(123, async (path) => path)
      ).rejects.toThrow(
        `question:publish_validation.storage_check_failed:${status}`
      );
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/arbitrary/check/tmp?totalSize=123'
      );
    }
  );

  it('prevents a damaged single-file publish from issuing totalSize=undefined', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ name: 'test' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      publishData({
        data: {},
        uploadType: 'file',
        registeredName: 'test',
        service: 'VIDEO',
      })
    ).rejects.toThrow('question:publish_validation.invalid_file');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://test.invalid/names/test',
    ]);
  });

  it('passes the exact video size to the precheck and reports its actual failed status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ name: 'test' }) })
      .mockResolvedValueOnce({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array(1025)], 'video.mp4');
    await expect(
      publishData({
        data: file,
        uploadType: 'file',
        registeredName: 'test',
        service: 'VIDEO',
      })
    ).rejects.toThrow('question:publish_validation.storage_check_failed:400');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://test.invalid/names/test',
      'https://test.invalid/arbitrary/check/tmp?totalSize=1025',
    ]);
  });
});
