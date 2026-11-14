import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const llm = vi.hoisted(() => ({
  cleanupStorage: vi.fn(async () => {
    calls.push('cleanupStorage');
    return { deletedFiles: 4, freedBytes: 2_497_279_104 };
  }),
}));
const job = vi.hoisted(() => ({
  cancelQortinoInstallJob: vi.fn(() => {
    calls.push('cancelJob');
  }),
}));
const session = vi.hoisted(() => ({
  unloadQortinoModelNow: vi.fn(async () => {
    calls.push('unload');
  }),
  forgetQortinoModel: vi.fn(),
}));
const store = vi.hoisted(() => ({
  clearInstallState: vi.fn(async () => {
    calls.push('clearInstall');
  }),
  clearLegacyInstall: vi.fn(async () => undefined),
}));

vi.mock('../qortinoLlm', () => ({ default: llm }));
vi.mock('../installJob', () => job);
vi.mock('../modelSession', () => session);
vi.mock('../store', () => store);

import {
  getQortinoInstallJob,
  resetQortinoInstallJobStoreForTests,
  updateQortinoInstallJob,
} from '../installJobStore';
import {
  hasPendingQortinoInstall,
  setPendingQortinoInstall,
} from '../installPending';
import { removeQortinoFromComputer } from '../removeFromComputer';

describe('Remove Qortino from this phone', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    resetQortinoInstallJobStoreForTests();
  });

  it('unloads the model before deleting every file, then forgets the install', async () => {
    const result = await removeQortinoFromComputer();
    expect(result.freedBytes).toBe(2_497_279_104);
    expect(calls).toEqual([
      'cancelJob',
      'unload',
      'cleanupStorage',
      'clearInstall',
    ]);
    // Nothing is kept: parts, half-saved parts and the warm-up state go.
    expect(llm.cleanupStorage).toHaveBeenCalledWith({ keep: [] });
    expect(session.forgetQortinoModel).toHaveBeenCalled();
    expect(store.clearLegacyInstall).toHaveBeenCalled();
  });

  it('leaves no download to carry on and clears the finished one', async () => {
    setPendingQortinoInstall(true);
    updateQortinoInstallJob({ status: 'done', listed: true, viewOpen: true });
    await removeQortinoFromComputer();
    expect(hasPendingQortinoInstall()).toBe(false);
    expect(getQortinoInstallJob()).toMatchObject({
      status: 'idle',
      listed: false,
      install: null,
      // The Qortino window is still the one showing it.
      viewOpen: true,
    });
  });

  it('keeps the install record when the files could not be deleted', async () => {
    llm.cleanupStorage.mockRejectedValueOnce(new Error('disk busy'));
    await expect(removeQortinoFromComputer()).rejects.toThrow('disk busy');
    expect(store.clearInstallState).not.toHaveBeenCalled();
  });
});
