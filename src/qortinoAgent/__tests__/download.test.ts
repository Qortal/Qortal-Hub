import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://192.168.1.20:12391';
const KEY = 'SECRET_NODE_KEY';

/** Fake phone storage: relative path -> { size, sha256 }. */
const disk = new Map<string, { size: number; sha256: string }>();

const llm = vi.hoisted(() => ({
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  cancelDownload: vi.fn(async () => undefined),
  cleanupStorage: vi.fn(),
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
  saveInstallState: vi.fn(async () => undefined),
}));

vi.mock('../../background/background', () => ({
  createEndpoint: async (path: string) =>
    `${NODE}${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`,
  getApiKeyFromStorage: async () => ({ apikey: KEY, url: NODE }),
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

import {
  chooseQortinoModelLayout,
  installQortinoModel,
  reclaimOldQortinoFiles,
  savedModelBytes,
  QortinoInstallError,
  resolveModelParts,
} from '../download';
import {
  modelPartRelativePath,
  QORTINO_MODEL,
  QORTINO_MODEL_PUBLIC_NODE,
  type QortinoModelSpec,
} from '../manifest';

const MODEL: QortinoModelSpec = {
  id: 'test-model',
  label: 'Test',
  license: 'Apache-2.0',
  parts: [
    { filename: 'test-00001-of-00002.gguf', sizeBytes: 1000, sha256: 'aa11' },
    { filename: 'test-00002-of-00002.gguf', sizeBytes: 700, sha256: 'bb22' },
  ],
  recommendedRamBytes: 0,
  contextTokens: 4096,
};

const SHA_BY_SIZE: Record<number, string> = { 1000: 'aa11', 700: 'bb22' };

function shareMap(): Map<
  string,
  { filename: string; identifier: string; service: string }
> {
  return new Map([
    [
      'test-00001-of-00002.gguf',
      {
        filename: 'test-00001-of-00002.gguf',
        identifier: 'qshare_file_qortino-ai_P1',
        service: 'FILE',
      },
    ],
    [
      'test-00002-of-00002.gguf',
      {
        filename: 'test-00002-of-00002.gguf',
        identifier: 'qshare_file_qortino-ai_P2',
        service: 'FILE',
      },
    ],
  ]);
}

describe('Qortino model install', () => {
  beforeEach(() => {
    disk.clear();
    vi.clearAllMocks();
    discovery.discoverQortinoQshareFiles.mockResolvedValue(shareMap());
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
        const size = url.endsWith('P1') ? 1000 : 700;
        disk.set(relativePath, { size, sha256: SHA_BY_SIZE[size] });
        return { bytesWritten: size, path: `/agent/${relativePath}` };
      }
    );
    llm.cleanupStorage.mockImplementation(
      async ({ keep }: { keep: string[] }) => {
        for (const path of [...disk.keys()])
          if (!keep.includes(path)) disk.delete(path);
        return { deletedFiles: 0, freedBytes: 0 };
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

  it('saves both parts side by side and records the first one', async () => {
    const state = await installQortinoModel({ model: MODEL });

    expect(llm.downloadUrl).toHaveBeenCalledTimes(2);
    const paths = llm.downloadUrl.mock.calls.map(
      ([options]) => (options as { relativePath: string }).relativePath
    );
    expect(paths).toEqual([
      'models/test-00001-of-00002.gguf',
      'models/test-00002-of-00002.gguf',
    ]);
    expect(state).toMatchObject({
      installed: true,
      modelId: 'test-model',
      llmPath: '/agent/models/test-00001-of-00002.gguf',
    });
    expect(store.saveInstallState).toHaveBeenCalledWith(state);
    expect(store.clearLegacyInstall).toHaveBeenCalled();
  });

  it('passes the node key separately, never inside the URL', async () => {
    await installQortinoModel({ model: MODEL });

    const [options] = llm.downloadUrl.mock.calls[0] as [
      { apiKey?: string; relativePath: string; url: string },
    ];
    expect(options.apiKey).toBe(KEY);
    expect(options.url).toBe(
      `${NODE}/arbitrary/FILE/Qortino%20AI/qshare_file_qortino-ai_P1`
    );
    expect(options.url).not.toContain(KEY);
  });

  it('shows no key in the error when a download fails', async () => {
    llm.downloadUrl.mockRejectedValue(
      Object.assign(new Error(`HTTP 404 for ${NODE}/x?apiKey=${KEY}`), {
        code: 'ERR',
      })
    );

    const failure = await installQortinoModel({ model: MODEL }).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(QortinoInstallError);
    const err = failure as QortinoInstallError;
    expect(err.code).toBe('download');
    expect(err.message).not.toContain(KEY);
    expect(err.detail).toContain('HTTP 404');
    expect(err.detail).toContain(
      `${NODE}/arbitrary/FILE/Qortino%20AI/qshare_file_qortino-ai_P1`
    );
  });

  it('removes a part whose checksum is wrong and reports it', async () => {
    llm.downloadUrl.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        disk.set(relativePath, { size: 1000, sha256: 'corrupt' });
        return { bytesWritten: 1000, path: `/agent/${relativePath}` };
      }
    );

    const failure = await installQortinoModel({ model: MODEL }).catch(
      (error: unknown) => error
    );

    expect((failure as QortinoInstallError).code).toBe('checksum');
    expect(disk.has('models/test-00001-of-00002.gguf')).toBe(false);
    expect(store.saveInstallState).not.toHaveBeenCalled();
  });

  it('keeps a part that is already on the phone and verified', async () => {
    disk.set('models/test-00001-of-00002.gguf', { size: 1000, sha256: 'aa11' });

    await installQortinoModel({ model: MODEL });

    expect(llm.downloadUrl).toHaveBeenCalledTimes(1);
    expect(
      (llm.downloadUrl.mock.calls[0][0] as { relativePath: string })
        .relativePath
    ).toBe('models/test-00002-of-00002.gguf');
  });

  it('downloads a part again when the copy on the phone is damaged', async () => {
    disk.set('models/test-00001-of-00002.gguf', {
      size: 1000,
      sha256: 'stale',
    });

    await installQortinoModel({ model: MODEL });

    expect(llm.downloadUrl).toHaveBeenCalledTimes(2);
  });

  it('asks the node again when no new chunk came for two minutes', async () => {
    vi.useFakeTimers();
    try {
      let polls = 0;
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/arbitrary/resource/status/')) {
          polls += 1;
          // Stuck at 3 of 10 chunks for a while, then the node has it all.
          const ready = Date.now() - start > 150_000;
          return new Response(
            JSON.stringify(
              ready
                ? { status: 'READY' }
                : {
                    status: 'MISSING_DATA',
                    localChunkCount: 3,
                    totalChunkCount: 10,
                  }
            )
          );
        }
        return new Response('{}');
      });
      vi.stubGlobal('fetch', fetchMock);
      const start = Date.now();
      const done = installQortinoModel({ model: MODEL });
      await vi.advanceTimersByTimeAsync(200_000);
      await done;

      const asks = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('?async=true')
      );
      // Once per part at the start, and once more for the stuck part.
      expect(asks.length).toBeGreaterThanOrEqual(3);
      expect(polls).toBeGreaterThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a part that broke off half way when clearing old files', async () => {
    const [first] = MODEL.parts;
    await reclaimOldQortinoFiles([MODEL]);
    const calls = llm.cleanupStorage.mock.calls;
    const { keep } = calls[calls.length - 1][0];
    expect(keep).toContain(modelPartRelativePath(first));
    expect(keep).toContain(`${modelPartRelativePath(first)}.part`);
  });

  it('counts a half-saved part toward what is already on the phone', async () => {
    const [first, second] = MODEL.parts;
    disk.set(modelPartRelativePath(first), {
      size: first.sizeBytes,
      sha256: first.sha256,
    });
    disk.set(`${modelPartRelativePath(second)}.part`, {
      size: 300,
      sha256: '',
    });
    expect(await savedModelBytes(MODEL)).toBe(first.sizeBytes + 300);
  });

  it('picks three parts on the public node and two on a private node', async () => {
    expect(await chooseQortinoModelLayout(true)).toBe(
      QORTINO_MODEL_PUBLIC_NODE
    );
    expect(await chooseQortinoModelLayout(false)).toBe(QORTINO_MODEL);
  });

  it('carries on with the layout already on the phone after a node switch', async () => {
    const [first] = QORTINO_MODEL_PUBLIC_NODE.parts;
    disk.set(`${modelPartRelativePath(first)}.part`, { size: 500, sha256: '' });
    // Now on a private node, but part of the three-part download is here.
    expect(await chooseQortinoModelLayout(false)).toBe(
      QORTINO_MODEL_PUBLIC_NODE
    );
  });

  it('keeps both layouts and their half-saved parts while downloading', async () => {
    await reclaimOldQortinoFiles();
    const calls = llm.cleanupStorage.mock.calls;
    const { keep } = calls[calls.length - 1][0];
    for (const layout of [QORTINO_MODEL, QORTINO_MODEL_PUBLIC_NODE]) {
      for (const part of layout.parts) {
        expect(keep).toContain(modelPartRelativePath(part));
        expect(keep).toContain(`${modelPartRelativePath(part)}.part`);
      }
    }
  });
});

describe('resolveModelParts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discovery.knownPublishedEntry.mockReturnValue(undefined);
    discovery.resourcePublishState.mockResolvedValue('published');
  });

  it('prefers the Q-Share filename map', async () => {
    discovery.discoverQortinoQshareFiles.mockResolvedValue(shareMap());
    discovery.listQortinoResources.mockResolvedValue([]);

    const parts = await resolveModelParts(MODEL);

    expect(parts.map((p) => p.identifier)).toEqual([
      'qshare_file_qortino-ai_P1',
      'qshare_file_qortino-ai_P2',
    ]);
  });

  it('falls back to an exact size match on a cold node', async () => {
    discovery.discoverQortinoQshareFiles.mockResolvedValue(new Map());
    discovery.listQortinoResources.mockResolvedValue([
      // The old Lite pack is near in size but not a match.
      { identifier: 'old-lite', service: 'FILE', size: 988, created: 1 },
      { identifier: 'part-two', service: 'FILE', size: 700, created: 3 },
      { identifier: 'part-one', service: 'FILE', size: 1000, created: 2 },
    ]);

    const parts = await resolveModelParts(MODEL);

    expect(parts.map((p) => p.identifier)).toEqual(['part-one', 'part-two']);
  });

  it('says the model is not published when nothing matches', async () => {
    discovery.discoverQortinoQshareFiles.mockResolvedValue(new Map());
    discovery.listQortinoResources.mockResolvedValue([]);

    const failure = await resolveModelParts(MODEL).catch((e: unknown) => e);

    expect((failure as QortinoInstallError).code).toBe('not_published');
  });
});
