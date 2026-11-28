import { describe, expect, it, vi } from 'vitest';
import { QAppFileUploadError } from '../../../electron/src/qapp-file-protocol';
import { isQAppFileReference } from '../../qortal/qapp-file-reference';
import type { VideoToolBridge } from '../../../electron/src/video-tool-types';
import { createJobFileReference } from './fileReference';

const reference = (
  uploadChunk: VideoToolBridge['uploadChunk'] = vi.fn(async () => ({
    ok: true as const,
  }))
) => ({
  uploadChunk,
  file: createJobFileReference({
    jobId: 'job-1',
    file: 'video',
    size: 12_000_000,
    name: 'clip.mp4',
    type: 'video/mp4',
    bridge: { uploadChunk },
  }),
});

const range = { start: 0, end: 5_242_880, index: 0, endpoint: 'http://n/c' };

describe('createJobFileReference', () => {
  it('is a reference publishData uploads chunk by chunk', async () => {
    const { file, uploadChunk } = reference();
    expect(isQAppFileReference(file)).toBe(true);
    expect(file).toMatchObject({
      size: 12_000_000,
      name: 'clip.mp4',
      type: 'video/mp4',
    });
    await file.upload(range);
    expect(uploadChunk).toHaveBeenCalledWith({
      jobId: 'job-1',
      file: 'video',
      ...range,
    });
  });

  it("passes the node's answer on as QAppFileUploadError", async () => {
    const { file } = reference(vi.fn(async () => ({ ok: false, status: 503 })));
    const error = await file.upload(range).catch((e) => e);
    expect(error).toBeInstanceOf(QAppFileUploadError);
    expect(error.status).toBe(503);
  });

  it('turns a network failure into a plain error, which gets retried', async () => {
    const { file } = reference(vi.fn(async () => ({ ok: false, status: 0 })));
    const error = await file.upload(range).catch((e) => e);
    expect(error).not.toBeInstanceOf(QAppFileUploadError);
    expect(error).toBeInstanceOf(Error);
  });

  it('cannot be read back or encrypted through', async () => {
    const { file, uploadChunk } = reference();
    await expect(file.base64()).rejects.toMatchObject({
      code: 'unsupported-operation',
    });
    await expect(
      file.upload({
        ...range,
        encryption: { key: new Uint8Array(32), iv: new Uint8Array(16) },
      })
    ).rejects.toMatchObject({ code: 'unsupported-operation' });
    expect(uploadChunk).not.toHaveBeenCalled();
  });

  it('needs the video tool bridge', () => {
    expect(() =>
      createJobFileReference({
        jobId: 'j',
        file: 'video',
        size: 1,
        name: 'a',
        type: 'video/mp4',
        bridge: undefined,
      })
    ).toThrow(expect.objectContaining({ code: 'bridge-missing' }));
  });
});
