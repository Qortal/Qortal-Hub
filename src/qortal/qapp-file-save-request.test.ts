import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchQAppFileSaveRequest,
  isQAppFileSaveAction,
} from './qapp-file-save-request';
import {
  FILE_SAVE_IDLE_MS,
  forgetTabActivity,
  isTabBusy,
} from '../components/Apps/tabActivity';

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

// A file saved piece by piece keeps its tab awake (tabSleep.ts) from the
// moment Hub opens it until it is finished or abandoned, also between its
// requests.
describe('a file being saved keeps its tab awake', () => {
  const context = {
    tabId: 'saving-tab',
    appName: 'Example',
    appService: 'APP',
  };
  const api = vi.fn();
  const step = (action: string, extra: Record<string, unknown> = {}) =>
    dispatchQAppFileSaveRequest(
      { action, saveId: 'save-1', ...extra },
      context
    );

  beforeEach(() => {
    api.mockReset();
    window.electronAPI = { qappFileSave: api } as any;
  });
  afterEach(() => {
    forgetTabActivity('saving-tab');
    vi.useRealTimers();
  });

  const open = async () => {
    api.mockResolvedValueOnce({ saveId: 'save-1', maxChunkBytes: 262144 });
    await dispatchQAppFileSaveRequest(
      { action: 'FILE_SAVE_OPEN', filename: 'a.bin', size: 3 },
      context
    );
  };

  it('from its opening until it is finished', async () => {
    await open();
    expect(isTabBusy('saving-tab')).toBe(true);

    api.mockResolvedValueOnce({ bytesWritten: 3 });
    await step('FILE_SAVE_WRITE', { offset: 0, data: new Uint8Array(3) });
    expect(isTabBusy('saving-tab')).toBe(true);

    api.mockResolvedValueOnce({ saved: true });
    await step('FILE_SAVE_FINISH');
    expect(isTabBusy('saving-tab')).toBe(false);
  });

  it('until it is abandoned', async () => {
    await open();
    api.mockResolvedValueOnce({ aborted: true });
    await step('FILE_SAVE_ABORT');
    expect(isTabBusy('saving-tab')).toBe(false);
  });

  it('until a piece fails, which ends it', async () => {
    await open();
    api.mockResolvedValueOnce({ error: 'SAVE_IO_ERROR' });
    await expect(
      step('FILE_SAVE_WRITE', { offset: 0, data: new Uint8Array(3) })
    ).rejects.toMatchObject({ code: 'SAVE_IO_ERROR' });
    expect(isTabBusy('saving-tab')).toBe(false);
  });

  it.each([
    [
      'a piece sent at the wrong place',
      'FILE_SAVE_WRITE',
      'SAVE_INVALID_CHUNK',
    ],
    ['a piece sent while one is written', 'FILE_SAVE_WRITE', 'SAVE_BUSY'],
    ['a finish before every piece', 'FILE_SAVE_FINISH', 'SAVE_INCOMPLETE'],
  ])(
    'also after %s, which Hub refuses and keeps the save open',
    async (_case, action, error) => {
      await open();
      api.mockResolvedValueOnce({ error });
      await expect(
        step(action, { offset: 0, data: new Uint8Array(3) })
      ).rejects.toMatchObject({ code: error });
      expect(isTabBusy('saving-tab')).toBe(true);
    }
  );

  it('until a step fails to reach Hub, which ends it', async () => {
    await open();
    api.mockRejectedValueOnce(new Error('no answer'));
    await expect(
      step('FILE_SAVE_WRITE', { offset: 0, data: new Uint8Array(3) })
    ).rejects.toThrow('no answer');
    expect(isTabBusy('saving-tab')).toBe(false);
  });

  it('for as long after its last piece as Hub keeps a save', async () => {
    vi.useFakeTimers({ now: 0 });
    await open();
    vi.setSystemTime(FILE_SAVE_IDLE_MS - 1);
    api.mockResolvedValueOnce({ bytesWritten: 1 });
    await step('FILE_SAVE_WRITE', { offset: 0, data: new Uint8Array(1) });

    vi.setSystemTime(2 * FILE_SAVE_IDLE_MS - 1);
    expect(isTabBusy('saving-tab')).toBe(true);
    vi.setSystemTime(2 * FILE_SAVE_IDLE_MS);
    expect(isTabBusy('saving-tab')).toBe(false);
  });

  it('not when no save was opened', async () => {
    api.mockResolvedValueOnce({ error: 'SAVE_CANCELLED' });
    await expect(
      dispatchQAppFileSaveRequest(
        { action: 'FILE_SAVE_OPEN', filename: 'a.bin', size: 3 },
        context
      )
    ).rejects.toMatchObject({ code: 'SAVE_CANCELLED' });
    expect(isTabBusy('saving-tab')).toBe(false);
  });
});
