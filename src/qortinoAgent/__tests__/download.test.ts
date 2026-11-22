import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://192.168.1.20:12391';
const KEY = 'SECRET_NODE_KEY';

/** Fake phone storage: relative path -> { size, sha256 }. */
const disk = new Map<string, { size: number; sha256: string }>();

type Listener = (event: Record<string, unknown>) => void;
const listeners = new Map<string, Listener>();
const hooks: { onKeyRead?: () => void } = {};

const llm = vi.hoisted(() => ({
  addListener: vi.fn(),
  cancelDownload: vi.fn(async () => undefined),
  cleanupStorage: vi.fn(),
  downloadUrl: vi.fn(),
  fileExists: vi.fn(),
  removeOtherModel: vi.fn(),
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
  getApiKeyFromStorage: async () => {
    hooks.onKeyRead?.();
    return { apikey: KEY, url: NODE };
  },
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
  downloadQdnModel,
  installQortinoModel,
  reclaimOldQortinoFiles,
  savedModelBytes,
  QortinoInstallError,
  resolveModelParts,
  type DownloadProgress,
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
    llm.addListener.mockImplementation(async () => ({
      remove: async () => undefined,
    }));
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
    llm.removeOtherModel.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        disk.delete(relativePath);
        return { freedBytes: 0 };
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
  it("asks the node for every part of Qortino's own model up front", async () => {
    const THREE: QortinoModelSpec = {
      ...MODEL,
      parts: [
        {
          filename: 'three-00001-of-00003.gguf',
          sizeBytes: 1000,
          sha256: 'aa11',
        },
        {
          filename: 'three-00002-of-00003.gguf',
          sizeBytes: 700,
          sha256: 'bb22',
        },
        {
          filename: 'three-00003-of-00003.gguf',
          sizeBytes: 500,
          sha256: 'cc33',
        },
      ],
    };
    const sizes: Record<string, number> = { T1: 1000, T2: 700, T3: 500 };
    const shas: Record<string, string> = { T1: 'aa11', T2: 'bb22', T3: 'cc33' };
    discovery.discoverQortinoQshareFiles.mockResolvedValue(
      new Map(
        THREE.parts.map((part, i) => [
          part.filename,
          {
            filename: part.filename,
            identifier: `qshare_file_qortino-ai_T${i + 1}`,
            service: 'FILE',
          },
        ])
      )
    );
    const log: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('?async=true')) {
          log.push(`ask ${/_(T\d)\?/.exec(url)?.[1]}`);
        }
        return new Response(JSON.stringify({ status: 'READY' }));
      })
    );
    llm.downloadUrl.mockImplementation(
      async ({ relativePath, url }: { relativePath: string; url: string }) => {
        const id = url.split('_').pop() as string;
        log.push(`save ${relativePath}`);
        disk.set(relativePath, { size: sizes[id], sha256: shas[id] });
        return { bytesWritten: sizes[id], path: `/agent/${relativePath}` };
      }
    );

    await installQortinoModel({ model: THREE });

    expect(log).toEqual([
      'ask T1',
      'ask T2',
      'ask T3',
      'save models/three-00001-of-00003.gguf',
      'save models/three-00002-of-00003.gguf',
      'save models/three-00003-of-00003.gguf',
    ]);
  });

  describe('another model from QDN', () => {
    const BIG: QortinoModelSpec = {
      id: 'big-model',
      label: 'Big',
      license: 'Apache-2.0',
      parts: [
        {
          filename: 'big-00001-of-00003.gguf',
          sizeBytes: 1000,
          sha256: 'aa11',
        },
        { filename: 'big-00002-of-00003.gguf', sizeBytes: 700, sha256: 'bb22' },
        { filename: 'big-00003-of-00003.gguf', sizeBytes: 500, sha256: 'cc33' },
      ],
      recommendedRamBytes: 0,
      contextTokens: 4096,
      folder: 'other-models/big-model',
    };
    const BIG_SHA: Record<string, string> = {
      B1: 'aa11',
      B2: 'bb22',
      B3: 'cc33',
    };
    const BIG_SIZE: Record<string, number> = { B1: 1000, B2: 700, B3: 500 };
    let log: string[];

    beforeEach(() => {
      log = [];
      discovery.discoverQortinoQshareFiles.mockResolvedValue(
        new Map(
          BIG.parts.map((part, i) => [
            part.filename,
            {
              filename: part.filename,
              identifier: `qshare_file_qortino-ai_B${i + 1}`,
              service: 'FILE',
            },
          ])
        )
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('?async=true')) {
            log.push(`ask ${/_(B\d)\?/.exec(url)?.[1]}`);
          }
          return new Response(JSON.stringify({ status: 'READY' }));
        })
      );
      llm.downloadUrl.mockImplementation(
        async ({
          relativePath,
          url,
        }: {
          relativePath: string;
          url: string;
        }) => {
          const id = url.split('_').pop() as string;
          log.push(`save ${relativePath}`);
          disk.set(relativePath, { size: BIG_SIZE[id], sha256: BIG_SHA[id] });
          return { bytesWritten: BIG_SIZE[id], path: `/agent/${relativePath}` };
        }
      );
    });

    it('saves every part in its own folder and gives the first part to load', async () => {
      const result = await downloadQdnModel(BIG, {});

      expect(result).toEqual({
        path: '/agent/other-models/big-model/big-00001-of-00003.gguf',
      });
      expect([...disk.keys()].sort()).toEqual([
        'other-models/big-model/big-00001-of-00003.gguf',
        'other-models/big-model/big-00002-of-00003.gguf',
        'other-models/big-model/big-00003-of-00003.gguf',
      ]);
      // Not Qortino's own install.
      expect(store.saveInstallState).not.toHaveBeenCalled();
      expect(llm.cleanupStorage).not.toHaveBeenCalled();
    });

    it('asks the node for one part ahead, not for all of them at once', async () => {
      await downloadQdnModel(BIG, {});

      expect(log).toEqual([
        'ask B1',
        'ask B2',
        'save other-models/big-model/big-00001-of-00003.gguf',
        'ask B3',
        'save other-models/big-model/big-00002-of-00003.gguf',
        'save other-models/big-model/big-00003-of-00003.gguf',
      ]);
    });

    it("deletes only a damaged part, and leaves Qortino's own model alone", async () => {
      disk.set('models/test-00001-of-00002.gguf', {
        size: 1000,
        sha256: 'aa11',
      });
      disk.set('models/test-00002-of-00002.gguf', {
        size: 700,
        sha256: 'bb22',
      });
      const save = llm.downloadUrl.getMockImplementation()!;
      llm.downloadUrl.mockImplementation(
        async (options: { relativePath: string; url: string }) => {
          const result = await save(options);
          if (options.url.endsWith('B2')) {
            disk.set(options.relativePath, { size: 700, sha256: 'broken' });
          }
          return result;
        }
      );

      const failure = await downloadQdnModel(BIG, {}).catch(
        (error: unknown) => error
      );

      expect((failure as QortinoInstallError).code).toBe('checksum');
      expect(llm.removeOtherModel).toHaveBeenCalledWith({
        relativePath: 'other-models/big-model/big-00002-of-00003.gguf',
      });
      expect(llm.cleanupStorage).not.toHaveBeenCalled();
      expect([...disk.keys()].sort()).toEqual([
        'models/test-00001-of-00002.gguf',
        'models/test-00002-of-00002.gguf',
        'other-models/big-model/big-00001-of-00003.gguf',
      ]);
    });

    it('counts the parts already saved in its folder', async () => {
      disk.set('other-models/big-model/big-00001-of-00003.gguf', {
        size: 1000,
        sha256: 'aa11',
      });
      disk.set('other-models/big-model/big-00002-of-00003.gguf.part', {
        size: 300,
        sha256: '',
      });

      expect(await savedModelBytes(BIG)).toBe(1300);
    });
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

describe('Qortino model install: progress, failed requests and cancel', () => {
  const ready = () => new Response(JSON.stringify({ status: 'READY' }));

  beforeEach(() => {
    disk.clear();
    listeners.clear();
    hooks.onKeyRead = undefined;
    vi.clearAllMocks();
    llm.cleanupStorage.mockResolvedValue({ deletedFiles: 0, freedBytes: 0 });
    discovery.discoverQortinoQshareFiles.mockResolvedValue(shareMap());
    discovery.knownPublishedEntry.mockReturnValue(undefined);
    discovery.listQortinoResources.mockResolvedValue([]);
    discovery.resourcePublishState.mockResolvedValue('published');
    llm.addListener.mockImplementation(
      async (name: string, listener: Listener) => {
        listeners.set(name, listener);
        return {
          remove: async () => {
            if (listeners.get(name) === listener) listeners.delete(name);
          },
        };
      }
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ready())
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the saved bytes on show when saving a part breaks off', async () => {
    const seen: DownloadProgress[] = [];
    llm.downloadUrl.mockImplementation(
      async ({ relativePath }: { relativePath: string }) => {
        const emit = listeners.get('downloadProgress');
        emit?.({
          relativePath,
          bytesReceived: 600,
          bytesTotal: 1000,
          done: false,
        });
        // What the main process sends when the transfer fails.
        emit?.({
          relativePath,
          bytesReceived: 0,
          bytesTotal: 0,
          done: true,
          error: 'HTTP 502',
        });
        throw new Error('HTTP 502');
      }
    );

    const failure = await installQortinoModel({
      model: MODEL,
      onProgress: (progress) => seen.push(progress),
    }).catch((error: unknown) => error);

    expect((failure as QortinoInstallError).code).toBe('download');
    const saved = seen.filter((progress) => progress.phase === 'save');
    // The 600 bytes are still in the half-saved file for the next try.
    expect(saved[saved.length - 1]?.bytesDone).toBe(600);
  });

  it('does not show a part back at zero when one status request fails', async () => {
    vi.useFakeTimers();
    const seen: DownloadProgress[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!url.includes('/arbitrary/resource/status/')) {
          return new Response('{}');
        }
        if (!url.includes('_P1')) return ready();
        polls += 1;
        if (polls === 1) {
          return new Response(
            JSON.stringify({
              status: 'DOWNLOADING',
              localChunkCount: 6,
              totalChunkCount: 10,
            })
          );
        }
        // The node did not answer this once.
        if (polls === 2) throw new TypeError('Failed to fetch');
        return ready();
      })
    );

    const done = installQortinoModel({
      model: MODEL,
      onProgress: (progress) => seen.push(progress),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    const fetched = seen
      .filter(
        (progress) => progress.phase === 'fetch' && progress.partIndex === 1
      )
      .map((progress) => progress.bytesDone);
    expect(fetched).toEqual([600, 1000]);
  });

  it('does not leave the answer to "start fetching" unread', async () => {
    const kicks: Array<{ cancelled: boolean }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!url.includes('async=true')) return ready();
        // A node that already holds the part answers with the whole file.
        const kick = { cancelled: false };
        kicks.push(kick);
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
              kick.cancelled = true;
            },
          })
        );
      })
    );

    await installQortinoModel({ model: MODEL });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(kicks).toHaveLength(2);
    expect(kicks.every((kick) => kick.cancelled)).toBe(true);
  });

  it('starts no transfer for a download cancelled just before it', async () => {
    const controller = new AbortController();
    // Cancelled while the node address is being read for the first part.
    hooks.onKeyRead = () => controller.abort();

    const failure = await installQortinoModel({
      model: MODEL,
      signal: controller.signal,
    }).catch((error: unknown) => error);

    expect((failure as QortinoInstallError).code).toBe('cancelled');
    expect(llm.downloadUrl).not.toHaveBeenCalled();
  });

  it('stops looking for the model as soon as it is cancelled', async () => {
    const controller = new AbortController();
    // A cold node: the Q-Share list takes minutes to come.
    discovery.discoverQortinoQshareFiles.mockReturnValue(
      new Promise(() => undefined)
    );
    let outcome: unknown = 'pending';
    void installQortinoModel({ model: MODEL, signal: controller.signal }).catch(
      (error: unknown) => {
        outcome = error;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcome).toBe('pending');

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((outcome as QortinoInstallError).code).toBe('cancelled');
  });

  it('stops waiting for peers as soon as it is cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
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
    let outcome: unknown = 'pending';
    void installQortinoModel({ model: MODEL, signal: controller.signal }).catch(
      (error: unknown) => {
        outcome = error;
      }
    );
    // Well into the wait between two status checks.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outcome).toBe('pending');

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect((outcome as QortinoInstallError).code).toBe('cancelled');
  });
});
