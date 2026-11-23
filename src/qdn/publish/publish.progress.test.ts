import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

vi.mock('../../background/background', () => ({
  getBaseApi: vi.fn(async () => 'http://node'),
  createEndpoint: vi.fn(async (endpoint: string) => `http://node${endpoint}`),
}));
vi.mock('../../utils/chromeStorage', () => ({ getData: vi.fn() }));

import Base58Module from '../../encryption/Base58';
import naclModule from '../../encryption/nacl-fast';
import { getData } from '../../utils/chromeStorage';
import { publishOnQDN } from '../../encryption/encryption';
import { createJobFileReference } from '../../lib/videoPublisher/fileReference';
import type {
  VideoNodeBuildRequest,
  VideoNodeBuildResult,
  VideoUploadRequest,
} from '../../../electron/src/video-tool-types';
import { NodeAnswerError } from './nodeAnswer';
import { publishData } from './publish';

// Both are untyped JavaScript modules.
const Base58 = Base58Module as unknown as {
  encode(bytes: Uint8Array): string;
};
const nacl = naclModule as unknown as {
  sign: { keyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } };
};
const CHUNK = 5 * 1024 * 1024;
/** Any valid Base58: the node's unsigned transaction bytes. */
const UNSIGNED_TX = Base58.encode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

const response = (body: unknown, status = 200) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const answer = {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => answer,
  };
  return answer;
};

const defaultFetch = async (url: string) => {
  if (url.includes('/names/')) return response({ name: 'Me' });
  if (url.includes('/addresses/balance/')) return response(5);
  if (url.includes('/transactions/unitfee')) return response('1000000');
  if (url.includes('/arbitrary/check/tmp')) return response('');
  if (url.includes('/finalize') || url.includes('/base64')) {
    return response(UNSIGNED_TX);
  }
  if (url.includes('/transactions/convert')) return response(UNSIGNED_TX);
  if (url.includes('/transactions/process')) return response({ ok: true });
  if (url.includes('/chunk')) return response('');
  return response('not found', 404);
};
const fetchMock = vi.fn(defaultFetch);

beforeEach(() => {
  const keys = nacl.sign.keyPair();
  vi.mocked(getData).mockImplementation(async (key: string) =>
    key === 'walletInfo'
      ? { address0: 'Qaddress' }
      : {
          privateKey: Base58.encode(keys.secretKey),
          publicKey: Base58.encode(keys.publicKey),
        }
  );
  fetchMock.mockClear();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const publishFile = (file: unknown, onProgress?: unknown) =>
  publishData({
    registeredName: 'Me',
    data: file,
    service: 'VIDEO',
    identifier: 'qtube_vid_clip_abcdef',
    filename: 'Clip.mp4',
    uploadType: 'file',
    withFee: true,
    onProgress,
  });

describe('publishData progress', () => {
  it('reports each chunk of a file sent from Electron main', async () => {
    const uploadChunk = vi.fn(async (_request: VideoUploadRequest) => ({
      ok: true as const,
    }));
    const file = createJobFileReference({
      jobId: 'job',
      file: 'video',
      size: 2 * CHUNK + 10,
      name: 'Clip.mp4',
      type: 'video/mp4',
      bridge: { uploadChunk },
    });
    const onProgress = vi.fn();
    await publishFile(file, onProgress);
    expect(onProgress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(
      uploadChunk.mock.calls.map(([r]) => [r.start, r.end, r.index])
    ).toEqual([
      [0, CHUNK, 0],
      [CHUNK, 2 * CHUNK, 1],
      [2 * CHUNK, 2 * CHUNK + 10, 2],
    ]);
    expect(uploadChunk.mock.calls[0][0].endpoint).toBe(
      'http://node/arbitrary/VIDEO/Me/qtube_vid_clip_abcdef/chunk'
    );
    const finalize = fetchMock.mock.calls.find(([url]) =>
      url.includes('/finalize')
    )?.[0];
    expect(finalize).toContain('&filename=Clip.mp4');
  });

  it('reports a base64 publish as one step', async () => {
    const onProgress = vi.fn();
    await publishData({
      registeredName: 'Me',
      data: 'e30=',
      service: 'DOCUMENT',
      identifier: 'doc',
      filename: 'video_metadata.json',
      uploadType: 'base64',
      withFee: true,
      onProgress,
    });
    expect(onProgress.mock.calls).toEqual([[1, 1]]);
  });

  it('still publishes without a progress callback', async () => {
    await expect(publishFile(new Blob(['tiny']))).resolves.toEqual({
      ok: true,
    });
  });

  it("keeps the node's refusal as a NodeAnswerError", async () => {
    const file = createJobFileReference({
      jobId: 'job',
      file: 'video',
      size: 10,
      name: 'Clip.mp4',
      type: 'video/mp4',
      bridge: { uploadChunk: vi.fn(async () => ({ ok: false, status: 403 })) },
    });
    const error = await publishFile(file).catch((e) => e);
    expect(error).toBeInstanceOf(NodeAnswerError);
    expect(error.status).toBe(403);
  });
});

describe('publishData with a node on this PC reading the file itself', () => {
  /** What the node built from the file: what gets signed. */
  const BUILT_TX = Base58.encode(new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]));
  const builds = (result: VideoNodeBuildResult | Error) =>
    vi.fn(async (_request: VideoNodeBuildRequest) => {
      if (result instanceof Error) throw result;
      return result;
    });
  const reference = (
    buildOnNode: ReturnType<typeof builds> | undefined,
    onNodeBuild?: (building: boolean) => void
  ) => {
    const uploadChunk = vi.fn(async (_request: VideoUploadRequest) => ({
      ok: true as const,
    }));
    const file = createJobFileReference({
      jobId: 'job',
      file: 'video',
      size: 2 * CHUNK + 10,
      name: 'Clip.mp4',
      type: 'video/mp4',
      bridge: buildOnNode ? { uploadChunk, buildOnNode } : { uploadChunk },
      onNodeBuild,
    });
    return { file, uploadChunk };
  };
  const urls = () => fetchMock.mock.calls.map(([url]) => url as string);

  it('signs what the node built and uploads nothing', async () => {
    const buildOnNode = builds({ ok: true, transaction: BUILT_TX });
    const onNodeBuild = vi.fn();
    const { file, uploadChunk } = reference(buildOnNode, onNodeBuild);
    const onProgress = vi.fn();

    await expect(publishFile(file, onProgress)).resolves.toEqual({ ok: true });
    expect(buildOnNode).toHaveBeenCalledTimes(1);
    expect(buildOnNode.mock.calls[0][0]).toEqual({
      jobId: 'job',
      file: 'video',
      endpoint: expect.stringMatching(
        /^http:\/\/node\/arbitrary\/VIDEO\/Me\/qtube_vid_clip_abcdef\?fee=\d+&filename=Clip\.mp4$/
      ),
      filename: 'Clip.mp4',
    });
    expect(uploadChunk).not.toHaveBeenCalled();
    expect(urls().some((url) => /\/chunk|\/finalize/.test(url))).toBe(false);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const convert = calls.find(([url]) =>
      url.includes('/transactions/convert')
    );
    expect(convert?.[1].body).toBe(BUILT_TX);
    expect(urls().some((url) => url.includes('/transactions/process'))).toBe(
      true
    );
    expect(onProgress.mock.calls).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(onNodeBuild.mock.calls).toEqual([[true], [false]]);
  });

  it("uploads it when the node can't read it", async () => {
    for (const result of [
      { ok: false as const, status: 500, reason: 'refused' as const },
      { ok: false as const, status: 0, reason: 'not-local' as const },
      new Error('[video-tool:invalid-request] endpoint'),
    ]) {
      fetchMock.mockClear();
      const buildOnNode = builds(result);
      const onNodeBuild = vi.fn();
      const { file, uploadChunk } = reference(buildOnNode, onNodeBuild);
      await expect(publishFile(file)).resolves.toEqual({ ok: true });
      expect(buildOnNode).toHaveBeenCalledTimes(1);
      expect(uploadChunk).toHaveBeenCalledTimes(3);
      expect(urls().some((url) => url.includes('/finalize'))).toBe(true);
      expect(onNodeBuild.mock.calls).toEqual([[true], [false]]);
    }
  });

  it('stops for a missing API key, as an upload would', async () => {
    const { file, uploadChunk } = reference(
      builds({ ok: false, status: 401, reason: 'refused' })
    );
    const error = await publishFile(file).catch((e) => e);
    expect(error).toBeInstanceOf(NodeAnswerError);
    expect(error.status).toBe(401);
    expect(uploadChunk).not.toHaveBeenCalled();
  });

  it('uploads as before with an older bridge, or encrypted', async () => {
    const old = reference(undefined);
    expect('buildOnNode' in old.file).toBe(false);
    await expect(publishFile(old.file)).resolves.toEqual({ ok: true });
    expect(old.uploadChunk).toHaveBeenCalledTimes(3);

    // The node would publish the file as it is: an encrypted one goes up
    // encrypted, chunk by chunk.
    const buildOnNode = vi.fn(async () => BUILT_TX);
    // jsdom's Blob can't read itself as an ArrayBuffer.
    const hadArrayBuffer = 'arrayBuffer' in Blob.prototype;
    if (!hadArrayBuffer) {
      Object.defineProperty(Blob.prototype, 'arrayBuffer', {
        configurable: true,
        value(this: Blob) {
          return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
          });
        },
      });
    }
    onTestFinished(() => {
      if (!hadArrayBuffer) {
        delete (Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer;
      }
    });
    await expect(
      publishData({
        registeredName: 'Me',
        data: Object.assign(new Blob(['tiny']), { buildOnNode }),
        service: 'VIDEO',
        identifier: 'qtube_vid_clip_abcdef',
        uploadType: 'file',
        withFee: true,
        encryption: { key: new Uint8Array(32), iv: new Uint8Array(16) },
      })
    ).resolves.toEqual({ ok: true });
    expect(buildOnNode).not.toHaveBeenCalled();
    expect(urls().some((url) => url.includes('/chunk'))).toBe(true);
  });

  it('never asks the node after a cancel', async () => {
    const abort = new AbortController();
    abort.abort();
    const buildOnNode = builds({ ok: true, transaction: BUILT_TX });
    const error = await publishData({
      registeredName: 'Me',
      data: reference(buildOnNode).file,
      service: 'VIDEO',
      identifier: 'qtube_vid_clip_abcdef',
      uploadType: 'file',
      withFee: true,
      signal: abort.signal,
    }).catch((e) => e);
    expect(error.name).toBe('AbortError');
    expect(buildOnNode).not.toHaveBeenCalled();
    expect(urls().some((url) => url.includes('/transactions/process'))).toBe(
      false
    );
  });
});

describe('publishData when stopped or unsure', () => {
  it('stops between chunks on a cancel and never signs', async () => {
    const abort = new AbortController();
    const uploadChunk = vi.fn(async (_request: VideoUploadRequest) => {
      abort.abort();
      return { ok: true as const };
    });
    const file = createJobFileReference({
      jobId: 'job',
      file: 'video',
      size: 3 * CHUNK,
      name: 'Clip.mp4',
      type: 'video/mp4',
      bridge: { uploadChunk },
    });
    const error = await publishData({
      registeredName: 'Me',
      data: file,
      service: 'VIDEO',
      identifier: 'qtube_vid_clip_abcdef',
      uploadType: 'file',
      withFee: true,
      signal: abort.signal,
    }).catch((e) => e);
    expect(error.name).toBe('AbortError');
    expect(uploadChunk).toHaveBeenCalledTimes(1);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('/finalize'))).toBe(false);
    expect(urls.some((url) => url.includes('/transactions/process'))).toBe(
      false
    );
  });

  it('counts a transaction the node already has as published', async () => {
    // The first answer was lost; the node now says it has it already.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/transactions/process')) {
        return response(
          { error: 1003, message: 'TRANSACTION_ALREADY_EXISTS' },
          400
        );
      }
      const known = /\/transactions\/signature\/([^/?]+)/.exec(url);
      if (known) return response({ signature: decodeURIComponent(known[1]) });
      if (url.includes('/names/')) return response({ name: 'Me' });
      if (url.includes('/transactions/unitfee')) return response('1000000');
      if (url.includes('/base64') || url.includes('/transactions/convert')) {
        return response(UNSIGNED_TX);
      }
      return response('not found', 404);
    });
    const result = await publishData({
      registeredName: 'Me',
      data: 'e30=',
      service: 'DOCUMENT',
      identifier: 'doc',
      uploadType: 'base64',
      withFee: true,
    });
    expect(result).toMatchObject({ signature: expect.any(String) });
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url.includes('/transactions/process')
      )
    ).toHaveLength(1);
  });

  it('still fails when the node does not have it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/transactions/process')) {
        return response({ error: 1003, message: 'INVALID_NAME_OWNER' }, 400);
      }
      if (url.includes('/names/')) return response({ name: 'Me' });
      if (url.includes('/transactions/unitfee')) return response('1000000');
      if (url.includes('/base64') || url.includes('/transactions/convert')) {
        return response(UNSIGNED_TX);
      }
      return response('not found', 404);
    });
    const error = await publishData({
      registeredName: 'Me',
      data: 'e30=',
      service: 'DOCUMENT',
      identifier: 'doc',
      uploadType: 'base64',
      withFee: true,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(NodeAnswerError);
    expect(error.message).toBe('INVALID_NAME_OWNER');
  });
});

describe('publishOnQDN', () => {
  it('passes the file name and progress on to publishData', async () => {
    const onProgress = vi.fn();
    await publishOnQDN({
      data: new Blob(['tiny']),
      name: 'Me',
      service: 'VIDEO',
      identifier: 'qtube_vid_clip_abcdef',
      filename: 'Clip.mp4',
      uploadType: 'file',
      onProgress,
    });
    expect(onProgress).toHaveBeenLastCalledWith(1, 1);
    const finalize = fetchMock.mock.calls.find(([url]) =>
      url.includes('/finalize')
    )?.[0];
    expect(finalize).toContain('&filename=Clip.mp4');
  });
});
