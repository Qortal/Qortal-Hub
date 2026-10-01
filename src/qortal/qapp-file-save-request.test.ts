import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchQAppFileSaveRequest,
  isQAppFileSaveAction,
} from './qapp-file-save-request';

describe('stream save request boundary', () => {
  const context = { tabId: 7, appName: 'Example', appService: 'APP' };
  const api = vi.fn();
  beforeEach(() => {
    api.mockReset();
    window.electronAPI = { qappFileSave: api } as any;
  });
  it('uses the trusted tab/app and replaces all iframe permission labels', async () => {
    api.mockResolvedValue({ saveId: 'random', maxChunkBytes: 262144 });
    await dispatchQAppFileSaveRequest(
      {
        action: 'FILE_SAVE_OPEN',
        filename: 'file.zip',
        size: 3,
        owner: { tabId: 'other' },
        labels: { title: 'Verified safe file' },
        path: '/sensitive',
      },
      context
    );
    const [owner, request] = api.mock.calls[0];
    expect(owner).toEqual({ tabId: '7', name: 'example', service: 'APP' });
    expect(request).not.toHaveProperty('path');
    expect(request).not.toHaveProperty('owner');
    expect(request.labels.title).not.toBe('Verified safe file');
  });
  it('preserves redacted machine-readable errors', async () => {
    api.mockResolvedValue({ error: 'SAVE_CANCELLED' });
    await expect(
      dispatchQAppFileSaveRequest(
        { action: 'FILE_SAVE_ABORT', saveId: 'id' },
        context
      )
    ).rejects.toMatchObject({ code: 'SAVE_CANCELLED' });
  });
  it('does not expose internal lifecycle cleanup as a QApp action', () => {
    expect(isQAppFileSaveAction('FILE_SAVE_CLEANUP')).toBe(false);
    expect(isQAppFileSaveAction('FILE_SAVE_OPEN')).toBe(true);
  });
});
