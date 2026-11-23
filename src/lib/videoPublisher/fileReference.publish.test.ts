import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../background/background', () => ({
  getBaseApi: vi.fn(async () => 'http://node'),
  createEndpoint: vi.fn(async (endpoint: string) => `http://node${endpoint}`),
}));
vi.mock('../../utils/chromeStorage', () => ({ getData: vi.fn() }));

import Base58Module from '../../encryption/Base58';
import naclModule from '../../encryption/nacl-fast';
import { getData } from '../../utils/chromeStorage';
import { publishData } from '../../qdn/publish/publish';
import type { VideoUploadRequest } from '../../../electron/src/video-tool-types';
import { createJobFileReference } from './fileReference';
import { classifyPublishError } from './runner';

// Both are untyped JavaScript modules.
const Base58 = Base58Module as unknown as {
  encode(bytes: Uint8Array): string;
};
const nacl = naclModule as unknown as {
  sign: { keyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } };
};
const CHUNK = 5 * 1024 * 1024;
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

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes('/names/')) return response({ name: 'Me' });
  if (url.includes('/addresses/balance/')) return response(5);
  if (url.includes('/transactions/unitfee')) return response('1000000');
  if (url.includes('/arbitrary/check/tmp')) return response('');
  if (url.includes('/finalize')) return response(UNSIGNED_TX);
  if (url.includes('/transactions/convert')) return response(UNSIGNED_TX);
  if (url.includes('/transactions/process')) return response({ ok: true });
  return response('not found', 404);
});

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
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a chunk Electron main turns down', () => {
  it("isn't waited on and retried as if the node couldn't be reached", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Main refuses the request itself (here the node's address);
    // ipcRenderer.invoke rejects with its message. The node was never asked.
    const uploadChunk = vi.fn(async (_request: VideoUploadRequest) => {
      throw new Error(
        "Error invoking remote method 'videoTool:uploadChunk': Error: [video-tool:invalid-request] endpoint"
      );
    });
    const file = createJobFileReference({
      jobId: 'job',
      file: 'video',
      size: 2 * CHUNK,
      name: 'Clip.mp4',
      type: 'video/mp4',
      bridge: { uploadChunk },
    });
    let outcome: unknown = 'pending';
    void publishData({
      registeredName: 'Me',
      data: file,
      service: 'VIDEO',
      identifier: 'qtube_vid_clip_abcdef',
      filename: 'Clip.mp4',
      uploadType: 'file',
      withFee: true,
    }).then(
      () => (outcome = 'published'),
      (error) => (outcome = error)
    );

    // A second's worth of time: no 25-second waits between tries.
    await vi.advanceTimersByTimeAsync(1000);
    expect(uploadChunk).toHaveBeenCalledTimes(1);
    expect(outcome).toBeInstanceOf(Error);
    // Not a network failure, which the video publisher's runner would try
    // twice more (each try three chunk attempts, 25 s apart).
    expect(classifyPublishError(outcome).error.code).not.toBe('network');
  });
});
