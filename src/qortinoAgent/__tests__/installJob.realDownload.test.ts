import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';

const NODE = 'http://127.0.0.1:12391';

/** Fake storage: relative path -> { size, sha256 }. */
const disk = new Map<string, { size: number; sha256: string }>();

const llm = vi.hoisted(() => ({
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  cancelDownload: vi.fn(async () => undefined),
  cleanupStorage: vi.fn(async () => ({ deletedFiles: 0, freedBytes: 0 })),
  downloadUrl: vi.fn(),
  fileExists: vi.fn(),
  getStoragePaths: vi.fn(async () => ({
    knowledgeDir: '/agent/knowledge',
    modelsDir: '/agent/models',
    rootDir: '/agent',
  })),
  sha256File: vi.fn(),
}));
const discovery = vi.hoisted(() => ({
  discoverQortinoQshareFiles: vi.fn(),
  knownPublishedEntry: vi.fn(),
  listQortinoResources: vi.fn(),
  resourcePublishState: vi.fn(),
}));
const store = vi.hoisted(() => ({
  clearLegacyInstall: vi.fn(async () => undefined),
  loadInstallState: vi.fn(async () => ({ installed: false })),
  saveInstallState: vi.fn(async () => undefined),
}));
const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));

vi.mock('../../background/background', () => ({
  createEndpoint: async (path: string) => `${NODE}${path}`,
  getApiKeyFromStorage: async () => null,
  getBaseApi: async () => NODE,
}));
vi.mock('../qortinoLlm', () => ({
  default: llm,
  isQortinoLlmNativeAvailable: () => true,
}));
vi.mock('../qshareDiscovery', async () => {
  const actual =
    await vi.importActual<typeof import('../qshareDiscovery')>(
      '../qshareDiscovery'
    );
  return {
    ...discovery,
    matchQshareEntry: actual.matchQshareEntry,
    matchResourceBySize: actual.matchResourceBySize,
  };
});
vi.mock('../store', () => store);
vi.mock('../../utils/events', () => events);
vi.mock('../deviceTier', () => ({
  readDeviceTier: async () => ({
    totalRamBytes: 8 * 1024 ** 3,
    availRamBytes: 4 * 1024 ** 3,
    availStorageBytes: 20 * 1024 ** 3,
    totalStorageBytes: 64 * 1024 ** 3,
    lowMemory: false,
  }),
  checkDeviceForModel: (tier: unknown) => ({
    tier,
    neededBytes: 0,
    enoughStorage: true,
    lowRam: false,
  }),
}));

import { isRunningPublicNodeAtom } from '../../atoms/global';
import {
  announceQortinoBackgroundDownload,
  cancelQortinoInstallJob,
  resetQortinoInstallJobForTests,
  startQortinoInstallJob,
} from '../installJob';
import {
  attachQortinoInstallView,
  getQortinoInstallJob,
} from '../installJobStore';
import { setPendingQortinoInstall } from '../installPending';
import {
  modelPartRelativePath,
  QORTINO_MODEL,
  type QortinoModelSpec,
} from '../manifest';

/** The Q-Share list with every part of `model`. */
function shareMapFor(model: QortinoModelSpec) {
  return new Map(
    model.parts.map((part, index) => [
      part.filename.toLowerCase(),
      {
        filename: part.filename,
        identifier: `qshare_file_qortino-ai_${index + 1}`,
        service: 'FILE',
      },
    ])
  );
}

const partOfUrl = (model: QortinoModelSpec, url: string) =>
  model.parts[Number(url.slice(url.lastIndexOf('_') + 1)) - 1];

const bannerTypes = () =>
  events.executeEvent.mock.calls
    .filter(([name]) => name === 'openGlobalSnackBar')
    .map(([, payload]) => payload.type);

describe('Qortino install job with the real download', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    disk.clear();
    setPendingQortinoInstall(false);
    discovery.discoverQortinoQshareFiles.mockResolvedValue(
      shareMapFor(QORTINO_MODEL)
    );
    discovery.knownPublishedEntry.mockReturnValue(undefined);
    discovery.listQortinoResources.mockResolvedValue([]);
    discovery.resourcePublishState.mockResolvedValue('published');
    llm.fileExists.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        const hit = disk.get(relativePath);
        return {
          exists: !!hit,
          path: `/agent/${relativePath}`,
          size: hit?.size ?? 0,
        };
      }
    );
    llm.sha256File.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        const hit = disk.get(relativePath);
        return { sha256: hit?.sha256 ?? '', size: hit?.size ?? 0 };
      }
    );
    llm.downloadUrl.mockImplementation(
      async ({ relativePath, url }: { relativePath: string; url: string }) => {
        const part = partOfUrl(QORTINO_MODEL, url);
        disk.set(relativePath, { size: part.sizeBytes, sha256: part.sha256 });
        return { bytesWritten: part.sizeBytes, path: `/agent/${relativePath}` };
      }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'READY' })))
    );
  });

  afterEach(() => {
    resetQortinoInstallJobForTests();
    setPendingQortinoInstall(false);
    getDefaultStore().set(isRunningPublicNodeAtom, false);
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('downloads the other layout when the one picked for the node is not on QDN', async () => {
    // The public node gets the three-part layout, but only the two-part one
    // is published.
    getDefaultStore().set(isRunningPublicNodeAtom, true);

    startQortinoInstallJob();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getQortinoInstallJob().status).toBe('done');
    expect(
      llm.downloadUrl.mock.calls.map(
        ([options]) => (options as { relativePath: string }).relativePath
      )
    ).toEqual(QORTINO_MODEL.parts.map(modelPartRelativePath));
  });

  it('does not say the download goes on in the background after Cancel', async () => {
    // The first part is on this computer and is being checked: a step that
    // cannot be broken off.
    const [first] = QORTINO_MODEL.parts;
    disk.set(modelPartRelativePath(first), {
      size: first.sizeBytes,
      sha256: first.sha256,
    });
    let finishCheck: () => void = () => undefined;
    llm.sha256File.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCheck = () =>
            resolve({ sha256: first.sha256, size: first.sizeBytes });
        })
    );
    const closeWindow = attachQortinoInstallView();
    startQortinoInstallJob();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getQortinoInstallJob().progress?.phase).toBe('verify');

    // Cancel in the window, which then closes.
    cancelQortinoInstallJob();
    await vi.advanceTimersByTimeAsync(200);
    closeWindow();
    announceQortinoBackgroundDownload();

    expect(bannerTypes()).toEqual([]);
    finishCheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQortinoInstallJob().status).toBe('cancelled');
    expect(bannerTypes()).toEqual([]);
  });

  it('does not install the model after Cancel during the last check', async () => {
    // Every part is on this computer; the last one is being checked.
    for (const part of QORTINO_MODEL.parts) {
      disk.set(modelPartRelativePath(part), {
        size: part.sizeBytes,
        sha256: part.sha256,
      });
    }
    const last = QORTINO_MODEL.parts[QORTINO_MODEL.parts.length - 1];
    let finishCheck: () => void = () => undefined;
    llm.sha256File.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        const hit = disk.get(relativePath);
        const result = { sha256: hit?.sha256 ?? '', size: hit?.size ?? 0 };
        if (relativePath !== modelPartRelativePath(last)) return result;
        return new Promise((resolve) => {
          finishCheck = () => resolve(result);
        });
      }
    );
    const closeWindow = attachQortinoInstallView();
    startQortinoInstallJob();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getQortinoInstallJob().progress).toMatchObject({
      phase: 'verify',
      partIndex: QORTINO_MODEL.parts.length,
    });

    cancelQortinoInstallJob();
    closeWindow();
    finishCheck();
    await vi.advanceTimersByTimeAsync(0);

    expect(getQortinoInstallJob().status).toBe('cancelled');
    expect(store.saveInstallState).not.toHaveBeenCalled();
    expect(bannerTypes()).toEqual([]);
  });

  it('is over when the window closes after Cancel while waiting for peers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/arbitrary/resource/status/')
          ? new Response(
              JSON.stringify({
                status: 'DOWNLOADING',
                localChunkCount: 3,
                totalChunkCount: 10,
              })
            )
          : new Response('{}')
      )
    );
    const closeWindow = attachQortinoInstallView();
    startQortinoInstallJob();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getQortinoInstallJob().progress?.phase).toBe('fetch');

    cancelQortinoInstallJob();
    // The window's closing animation.
    await vi.advanceTimersByTimeAsync(200);
    closeWindow();
    announceQortinoBackgroundDownload();

    expect(getQortinoInstallJob().status).toBe('cancelled');
    expect(bannerTypes()).toEqual([]);
  });
});
