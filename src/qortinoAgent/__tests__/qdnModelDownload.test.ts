import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  downloadQdnModel: vi.fn(),
  savedModelBytes: vi.fn(async () => 0),
  readDeviceTier: vi.fn(),
}));

vi.mock('../download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../download')>()),
  downloadQdnModel: fake.downloadQdnModel,
  savedModelBytes: fake.savedModelBytes,
}));
vi.mock('../deviceTier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../deviceTier')>()),
  readDeviceTier: fake.readDeviceTier,
}));

import { isRunningPublicNodeAtom } from '../../atoms/global';
import { QortinoInstallError } from '../download';
import { MAX_TRIES_WITHOUT_PROGRESS } from '../installJob';
import type { QortinoModelSpec } from '../manifest';
import {
  downloadQdnModelWithRetries,
  QdnModelDownloadError,
  type QdnModelRetry,
} from '../qdnModelDownload';

const BIG: QortinoModelSpec = {
  id: 'big-model',
  label: 'Big',
  license: 'Apache-2.0',
  parts: [
    { filename: 'big-00001-of-00002.gguf', sizeBytes: 6_000, sha256: 'aa' },
    { filename: 'big-00002-of-00002.gguf', sizeBytes: 4_000, sha256: 'bb' },
  ],
  recommendedRamBytes: 0,
  contextTokens: 4096,
  folder: 'other-models/big-model',
};

const GB = 1024 ** 3;

function run(
  options: {
    signal?: AbortSignal;
    /** Ends every wait at once, as "Try now" does. */
    wakeAtOnce?: boolean;
  } = {}
) {
  const retries: Array<QdnModelRetry | null> = [];
  const done = downloadQdnModelWithRetries(BIG, {
    signal: options.signal ?? new AbortController().signal,
    onProgress: () => undefined,
    onRetry: (retry) => retries.push(retry),
    onWait: (wake) => {
      if (options.wakeAtOnce) wake();
    },
  });
  return { done, retries };
}

describe('downloading another model from QDN, with retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.savedModelBytes.mockResolvedValue(0);
    fake.readDeviceTier.mockResolvedValue({
      totalRamBytes: 64 * GB,
      availRamBytes: 32 * GB,
      availStorageBytes: 500 * GB,
      totalStorageBytes: 1_000 * GB,
      lowMemory: false,
    });
  });

  afterEach(() => {
    getDefaultStore().set(isRunningPublicNodeAtom, false);
  });

  it('downloads nothing through the public node', async () => {
    getDefaultStore().set(isRunningPublicNodeAtom, true);

    const failure = await run().done.catch((error: unknown) => error);

    expect((failure as QdnModelDownloadError).failure).toEqual({
      code: 'public_node',
    });
    expect(fake.downloadQdnModel).not.toHaveBeenCalled();
  });

  it('stops when Hub goes to the public node between two tries', async () => {
    fake.downloadQdnModel.mockImplementationOnce(async () => {
      getDefaultStore().set(isRunningPublicNodeAtom, true);
      throw new QortinoInstallError('stalled', 'part 1');
    });

    const failure = await run({ wakeAtOnce: true }).done.catch(
      (error: unknown) => error
    );

    expect((failure as QdnModelDownloadError).failure).toEqual({
      code: 'public_node',
    });
    expect(fake.downloadQdnModel).toHaveBeenCalledTimes(1);
  });

  it('tries again when peers stop sending, and carries on', async () => {
    fake.downloadQdnModel
      .mockRejectedValueOnce(new QortinoInstallError('stalled', 'part 1'))
      .mockResolvedValueOnce({ path: '/agent/other-models/big-model/b.gguf' });

    const { done, retries } = run({ wakeAtOnce: true });

    await expect(done).resolves.toEqual({
      path: '/agent/other-models/big-model/b.gguf',
    });
    expect(fake.downloadQdnModel).toHaveBeenCalledTimes(2);
    const waits = retries.filter(Boolean) as QdnModelRetry[];
    expect(waits).toHaveLength(1);
    expect(waits[0].error).toMatchObject({ code: 'stalled' });
    expect(waits[0].retryAt).toBeGreaterThan(Date.now());
  });

  it('checks the free space for what is still to download, before each try', async () => {
    fake.savedModelBytes.mockResolvedValue(6_000);
    fake.readDeviceTier.mockResolvedValue({
      totalRamBytes: 64 * GB,
      availRamBytes: 32 * GB,
      availStorageBytes: 1_000,
      totalStorageBytes: 1_000 * GB,
      lowMemory: false,
    });

    const failure = await run().done.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(QdnModelDownloadError);
    expect((failure as QdnModelDownloadError).failure).toEqual({
      code: 'low_storage',
      neededBytes: 4_000,
      freeBytes: 1_000,
    });
    expect(fake.downloadQdnModel).not.toHaveBeenCalled();
  });

  it('gives up at once on what another try cannot change', async () => {
    fake.downloadQdnModel.mockRejectedValue(
      new QortinoInstallError('download', 'desktop app required')
    );

    const { done, retries } = run({ wakeAtOnce: true });
    const failure = await done.catch((error: unknown) => error);

    expect((failure as QdnModelDownloadError).failure).toMatchObject({
      code: 'download',
    });
    expect(fake.downloadQdnModel).toHaveBeenCalledTimes(1);
    expect(retries.filter(Boolean)).toEqual([]);
  });

  it('gives up after many tries that got no further', async () => {
    fake.downloadQdnModel.mockRejectedValue(
      new QortinoInstallError('stalled', 'part 1')
    );

    const failure = await run({ wakeAtOnce: true }).done.catch(
      (error: unknown) => error
    );

    expect((failure as QdnModelDownloadError).failure).toMatchObject({
      code: 'stalled',
    });
    expect(fake.downloadQdnModel).toHaveBeenCalledTimes(
      MAX_TRIES_WITHOUT_PROGRESS
    );
  });

  it('stops while it waits for the next try', async () => {
    fake.downloadQdnModel.mockRejectedValue(
      new QortinoInstallError('stalled', 'part 1')
    );
    const controller = new AbortController();
    const { done, retries } = run({ signal: controller.signal });
    await vi.waitFor(() => expect(retries.filter(Boolean)).toHaveLength(1));

    controller.abort();

    await expect(done).rejects.toMatchObject({ code: 'cancelled' });
    expect(fake.downloadQdnModel).toHaveBeenCalledTimes(1);
  });
});
