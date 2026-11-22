import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://192.168.1.20:12391';

/** Fake disk: relative path -> { size, sha256 }. */
const disk = new Map<string, { size: number; sha256: string }>();

const llm = vi.hoisted(() => ({
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  cancelDownload: vi.fn(async () => undefined),
  cleanupStorage: vi.fn(),
  downloadUrl: vi.fn(),
  fileExists: vi.fn(),
  removeOtherModel: vi.fn(),
  getDeviceTier: vi.fn(async () => ({
    totalRamBytes: 64 * 1024 ** 3,
    availRamBytes: 32 * 1024 ** 3,
    availStorageBytes: 500 * 1024 ** 3,
    totalStorageBytes: 1_000 * 1024 ** 3,
    lowMemory: false,
  })),
  getStoragePaths: vi.fn(async () => ({
    knowledgeDir: '/agent/knowledge',
    modelsDir: '/agent/models',
    rootDir: '/agent',
  })),
  sha256File: vi.fn(),
}));

vi.mock('../../background/background', () => ({
  createEndpoint: async (path: string) => `${NODE}${path}`,
  getApiKeyFromStorage: async () => ({ url: NODE }),
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
    ...actual,
    discoverQortinoQshareFiles: vi.fn(async () => new Map(SHARE)),
    listQortinoResources: vi.fn(async () => []),
    knownPublishedEntry: vi.fn(() => undefined),
    resourcePublishState: vi.fn(async () => 'published'),
  };
});
vi.mock('../store', () => ({
  clearLegacyInstall: vi.fn(async () => undefined),
  saveInstallState: vi.fn(async () => undefined),
}));

import type { QortinoModelSpec } from '../manifest';
import { downloadQdnModelWithRetries } from '../qdnModelDownload';

const BIG: QortinoModelSpec = {
  id: 'big-model',
  label: 'Big',
  license: 'Apache-2.0',
  parts: [
    { filename: 'big-00001-of-00003.gguf', sizeBytes: 1000, sha256: 'aa11' },
    { filename: 'big-00002-of-00003.gguf', sizeBytes: 700, sha256: 'bb22' },
    { filename: 'big-00003-of-00003.gguf', sizeBytes: 500, sha256: 'cc33' },
  ],
  recommendedRamBytes: 0,
  contextTokens: 4096,
  folder: 'other-models/big-model',
};
const SHA: Record<string, string> = { B1: 'aa11', B2: 'bb22', B3: 'cc33' };
const SIZE: Record<string, number> = { B1: 1000, B2: 700, B3: 500 };
const SHARE: Array<
  [string, { filename: string; identifier: string; service: string }]
> = BIG.parts.map((part, i) => [
  part.filename,
  {
    filename: part.filename,
    identifier: `qshare_file_qortino-ai_B${i + 1}`,
    service: 'FILE',
  },
]);

const tries = new Map<string, number>();
const breakOnce = new Set<string>();
const damageOnce = new Set<string>();

function download() {
  return downloadQdnModelWithRetries(BIG, {
    signal: new AbortController().signal,
    onProgress: () => undefined,
    onRetry: () => undefined,
    // "Try now" at once, so the test does not wait 15 s.
    onWait: (wake) => wake(),
  });
}

describe('another model from QDN, carried on after a broken transfer', () => {
  beforeEach(() => {
    disk.clear();
    vi.clearAllMocks();
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
    llm.removeOtherModel.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        disk.delete(relativePath);
        return { freedBytes: 0 };
      }
    );
    tries.clear();
    breakOnce.clear();
    damageOnce.clear();
    llm.downloadUrl.mockImplementation(
      async ({ relativePath, url }: { relativePath: string; url: string }) => {
        const id = url.split('_').pop() as string;
        const tried = (tries.get(id) ?? 0) + 1;
        tries.set(id, tried);
        // The connection to the node breaks off once during this part.
        if (breakOnce.has(id) && tried === 1) throw new Error('terminated');
        // This part arrives damaged once, then whole.
        const sha = damageOnce.has(id) && tried === 1 ? 'damaged' : SHA[id];
        disk.set(relativePath, { size: SIZE[id], sha256: sha });
        return { bytesWritten: SIZE[id], path: `/agent/${relativePath}` };
      }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'READY' })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not read and hash every part it already checked again on each new try', async () => {
    breakOnce.add('B3');
    await download();

    const hashed = llm.sha256File.mock.calls.map(
      ([options]) => (options as { relativePath: string }).relativePath
    );
    // Parts 1 and 2 were saved and checked in the first try; the second try
    // only needs part 3. For the 30B that is up to ten 1.7 GB files read
    // again on every retry.
    expect(
      hashed.filter((path) => path.endsWith('big-00001-of-00003.gguf'))
    ).toHaveLength(1);
    expect(
      hashed.filter((path) => path.endsWith('big-00002-of-00003.gguf'))
    ).toHaveLength(1);
  });

  it('does not give up on a model whose different parts each arrived damaged once, when each came through whole on its next try', async () => {
    // One damaged copy for each of three parts: every part is fine on its
    // second download. The limit is meant for a part that keeps arriving
    // damaged ("not endlessly"), but it counts damaged copies over the whole
    // model: with the 30B's 11 parts, three unlucky parts end a 17 GB download.
    damageOnce.add('B1');
    damageOnce.add('B2');
    damageOnce.add('B3');

    await expect(download()).resolves.toEqual({
      path: '/agent/other-models/big-model/big-00001-of-00003.gguf',
    });
  });
});
