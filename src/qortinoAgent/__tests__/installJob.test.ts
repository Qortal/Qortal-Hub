import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const dl = vi.hoisted(() => ({
  chooseQortinoModelLayout: vi.fn(),
  installQortinoModel: vi.fn(),
  reclaimOldQortinoFiles: vi.fn(async () => 0),
  savedModelBytes: vi.fn(async () => 0),
}));
const device = vi.hoisted(() => ({
  enoughStorage: true,
  readDeviceTier: vi.fn(async () => ({
    totalRamBytes: 8 * 1024 ** 3,
    availRamBytes: 4 * 1024 ** 3,
    availStorageBytes: 20 * 1024 ** 3,
    totalStorageBytes: 64 * 1024 ** 3,
    lowMemory: false,
  })),
}));
const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
const store = vi.hoisted(() => ({
  loadInstallState: vi.fn(async () => ({ installed: false })),
}));

vi.mock('../download', async () => {
  const actual =
    await vi.importActual<typeof import('../download')>('../download');
  return { ...actual, ...dl };
});
vi.mock('../deviceTier', () => ({
  readDeviceTier: device.readDeviceTier,
  checkDeviceForModel: (tier) => ({
    tier,
    neededBytes: 2_497_278_976,
    enoughStorage: device.enoughStorage,
    lowRam: false,
  }),
}));
vi.mock('../qortinoLlm', () => ({
  default: {},
  isQortinoLlmNativeAvailable: () => true,
}));
vi.mock('../../utils/events', () => events);
vi.mock('../store', () => store);
vi.mock('../qortinoSheetNav', () => ({ openQortinoAgentSheet: vi.fn() }));

import { QortinoInstallError } from '../download';
import { QORTINO_MODEL, QORTINO_MODEL_PUBLIC_NODE } from '../manifest';
import {
  cancelQortinoInstallJob,
  MAX_TRIES_WITHOUT_PROGRESS,
  resetQortinoInstallJobForTests,
  resumeQortinoInstallIfPending,
  retryQortinoInstallNow,
  startQortinoInstallJob,
} from '../installJob';
import {
  attachQortinoInstallView,
  dismissQortinoInstallRow,
  getQortinoInstallJob,
  qortinoInstallUnseen,
} from '../installJobStore';
import {
  hasPendingQortinoInstall,
  setPendingQortinoInstall,
} from '../installPending';

const INSTALL = {
  installed: true,
  modelId: 'qwen3-4b-2507',
  llmPath: '/agent/models/part1.gguf',
  installedAt: 1,
};

const fetchProgress = (percent: number) => ({
  phase: 'fetch' as const,
  partIndex: 1,
  partCount: 2,
  bytesDone: percent,
  bytesTotal: 100,
});

/** Let the job's awaits run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

const bannerTypes = () =>
  events.executeEvent.mock.calls
    .filter(([name]) => name === 'openGlobalSnackBar')
    .map(([, payload]) => payload.type);

describe('Qortino install job', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    device.enoughStorage = true;
    setPendingQortinoInstall(false);
    dl.chooseQortinoModelLayout.mockResolvedValue(QORTINO_MODEL);
  });
  afterEach(() => {
    resetQortinoInstallJobForTests();
    setPendingQortinoInstall(false);
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('finishes without a window and says so in a banner', async () => {
    dl.installQortinoModel.mockResolvedValue(INSTALL);
    startQortinoInstallJob();
    expect(hasPendingQortinoInstall()).toBe(true);
    await settle();

    const job = getQortinoInstallJob();
    expect(job.status).toBe('done');
    expect(job.install).toEqual(INSTALL);
    expect(hasPendingQortinoInstall()).toBe(false);
    expect(bannerTypes()).toEqual(['success']);
  });

  it('downloads the layout picked for the node', async () => {
    dl.chooseQortinoModelLayout.mockResolvedValue(QORTINO_MODEL_PUBLIC_NODE);
    dl.installQortinoModel.mockResolvedValue(INSTALL);
    startQortinoInstallJob();
    await settle();
    expect(dl.installQortinoModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: QORTINO_MODEL_PUBLIC_NODE })
    );
    expect(dl.savedModelBytes).toHaveBeenCalledWith(QORTINO_MODEL_PUBLIC_NODE);
  });

  it('falls back to the other layout when the picked one is not on QDN', async () => {
    dl.chooseQortinoModelLayout.mockResolvedValue(QORTINO_MODEL_PUBLIC_NODE);
    dl.installQortinoModel.mockImplementation(async ({ model }) => {
      if (model === QORTINO_MODEL_PUBLIC_NODE) {
        throw new QortinoInstallError('not_published');
      }
      return INSTALL;
    });
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().status).toBe('done');
    expect(dl.installQortinoModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: QORTINO_MODEL })
    );
  });

  it('leaves the outcome to the window while one is open', async () => {
    dl.installQortinoModel.mockResolvedValue(INSTALL);
    const detach = attachQortinoInstallView();
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().status).toBe('done');
    expect(bannerTypes()).toEqual([]);
    detach();
  });

  it('tries again by itself when peers stop sending', async () => {
    dl.installQortinoModel
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress(fetchProgress(40));
        throw new QortinoInstallError('stalled', 'part1: 40/100');
      })
      .mockResolvedValueOnce(INSTALL);
    startQortinoInstallJob();
    await settle();

    const waiting = getQortinoInstallJob();
    expect(waiting.status).toBe('retrying');
    expect(waiting.error?.code).toBe('stalled');
    // It moved on before stalling, so the next try comes soon.
    expect(waiting.retryAt! - Date.now()).toBe(15_000);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(dl.installQortinoModel).toHaveBeenCalledTimes(2);
    expect(getQortinoInstallJob().status).toBe('done');
  });

  it('starts the next try at once on Try now', async () => {
    dl.installQortinoModel
      .mockRejectedValueOnce(new QortinoInstallError('stalled'))
      .mockResolvedValueOnce(INSTALL);
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().status).toBe('retrying');

    retryQortinoInstallNow();
    await settle();
    expect(dl.installQortinoModel).toHaveBeenCalledTimes(2);
    expect(getQortinoInstallJob().status).toBe('done');
  });

  it('gives up after tries that get no further', async () => {
    dl.installQortinoModel.mockRejectedValue(
      new QortinoInstallError('not_published')
    );
    startQortinoInstallJob();
    for (let i = 0; i < MAX_TRIES_WITHOUT_PROGRESS + 2; i += 1) {
      await vi.advanceTimersByTimeAsync(300_000);
    }

    const job = getQortinoInstallJob();
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('not_published');
    // One more: the first miss also tries the other layout.
    expect(dl.installQortinoModel).toHaveBeenCalledTimes(
      MAX_TRIES_WITHOUT_PROGRESS + 1
    );
    expect(hasPendingQortinoInstall()).toBe(false);
    expect(bannerTypes()).toEqual(['error']);
  });

  it('keeps trying while each try gets further', async () => {
    let percent = 0;
    dl.installQortinoModel.mockImplementation(async ({ onProgress }) => {
      percent += 5;
      onProgress(fetchProgress(percent));
      if (percent < 100) throw new QortinoInstallError('stalled');
      return INSTALL;
    });
    startQortinoInstallJob();
    for (let i = 0; i < 25; i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(getQortinoInstallJob().status).toBe('done');
    expect(dl.installQortinoModel).toHaveBeenCalledTimes(20);
  });

  it('does not retry outside the desktop app', async () => {
    dl.installQortinoModel.mockRejectedValue(
      new QortinoInstallError('download', 'desktop app required')
    );
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().status).toBe('failed');
    expect(dl.installQortinoModel).toHaveBeenCalledTimes(1);
  });

  it('stops before downloading when the disk is short of space', async () => {
    device.enoughStorage = false;
    startQortinoInstallJob();
    await settle();
    const job = getQortinoInstallJob();
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('low_storage');
    expect(dl.installQortinoModel).not.toHaveBeenCalled();
  });

  it('cancels and clears the pending mark', async () => {
    dl.installQortinoModel.mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () =>
            reject(new QortinoInstallError('cancelled'))
          );
        })
    );
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().status).toBe('running');

    cancelQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().status).toBe('cancelled');
    expect(hasPendingQortinoInstall()).toBe(false);
    expect(bannerTypes()).toEqual([]);
  });

  it('carries on with a download Hub was closed during', async () => {
    dl.installQortinoModel.mockResolvedValue(INSTALL);
    setPendingQortinoInstall(true);
    await resumeQortinoInstallIfPending();
    await settle();
    expect(dl.installQortinoModel).toHaveBeenCalledTimes(1);
    expect(getQortinoInstallJob().status).toBe('done');
  });

  it('only clears the mark when the model is already installed', async () => {
    store.loadInstallState.mockResolvedValueOnce(INSTALL);
    setPendingQortinoInstall(true);
    await resumeQortinoInstallIfPending();
    expect(dl.installQortinoModel).not.toHaveBeenCalled();
    expect(hasPendingQortinoInstall()).toBe(false);
  });

  it('shows in the notifications panel, counted while its window is closed', async () => {
    let finishInstall: (value: typeof INSTALL) => void = () => undefined;
    dl.installQortinoModel.mockImplementation(
      () => new Promise((resolve) => (finishInstall = resolve))
    );
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().listed).toBe(true);
    expect(qortinoInstallUnseen()).toBe(1);

    const detach = attachQortinoInstallView();
    expect(qortinoInstallUnseen()).toBe(0);
    detach();
    expect(qortinoInstallUnseen()).toBe(1);

    finishInstall(INSTALL);
    await settle();
    // Finished out of sight: it stays listed until dismissed.
    expect(getQortinoInstallJob().listed).toBe(true);
    dismissQortinoInstallRow();
    expect(getQortinoInstallJob().listed).toBe(false);
  });

  it('leaves the panel once the window has shown how it ended', async () => {
    dl.installQortinoModel.mockRejectedValue(
      new QortinoInstallError('download', 'desktop app required')
    );
    startQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().listed).toBe(true);
    const detach = attachQortinoInstallView();
    expect(getQortinoInstallJob().listed).toBe(false);
    detach();
  });

  it('drops a cancelled download from the panel', async () => {
    dl.installQortinoModel.mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () =>
            reject(new QortinoInstallError('cancelled'))
          );
        })
    );
    startQortinoInstallJob();
    await settle();
    cancelQortinoInstallJob();
    await settle();
    expect(getQortinoInstallJob().listed).toBe(false);
    expect(qortinoInstallUnseen()).toBe(0);
  });

  it('does nothing on resume without a pending download', async () => {
    await resumeQortinoInstallIfPending();
    expect(dl.installQortinoModel).not.toHaveBeenCalled();
    expect(getQortinoInstallJob().status).toBe('idle');
  });
});
