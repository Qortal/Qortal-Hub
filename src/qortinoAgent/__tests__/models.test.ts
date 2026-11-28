import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const llm = vi.hoisted(() => ({
  cancel: vi.fn(async () => undefined),
  removeOtherModel: vi.fn(async (_options: { relativePath: string }) => ({
    freedBytes: 1,
  })),
}));

vi.mock('../qortinoLlm', () => ({ default: llm }));

type QdnRun = {
  signal: AbortSignal;
  finish: (value: { path: string }) => void;
  fail: (error: unknown) => void;
};

/**
 * Each download from QDN ends when the test says so, or a moment after it is
 * stopped (as one does that is saving a part).
 */
const qdn = vi.hoisted(() => ({
  runs: [] as QdnRun[],
  log: [] as string[],
  downloadQdnModelWithRetries: vi.fn(
    (_model: unknown, options: { signal: AbortSignal }) =>
      new Promise<{ path: string }>((resolve, reject) => {
        qdn.runs.push({
          signal: options.signal,
          finish: resolve,
          fail: reject,
        });
        options.signal.addEventListener('abort', () =>
          setTimeout(() => {
            qdn.log.push('ended');
            reject(new Error('cancelled'));
          }, 5)
        );
      })
  ),
}));
vi.mock('../qdnModelDownload', () => ({
  downloadQdnModelWithRetries: qdn.downloadQdnModelWithRetries,
}));
const session = vi.hoisted(() => ({
  loaded: null as string | null,
  unloadQortinoModelNow: vi.fn(async () => {
    session.loaded = null;
  }),
}));
vi.mock('../modelSession', () => ({
  isQortinoModelPathInUse: (modelPath: string) => session.loaded === modelPath,
  unloadQortinoModelNow: session.unloadQortinoModelNow,
}));

import { modelPartPath, QORTINO_MODEL, QWEN3_30B_MODEL } from '../manifest';
import {
  addFileModel,
  downloadQdnOtherModel,
  getQortinoModels,
  isLaterSplitPart,
  modelLabelFromFileName,
  qdnModelEntryId,
  QORTINO_OWN_MODEL_ID,
  removeOtherModel,
  resetQortinoModelsForTests,
  resolveActiveQortinoModel,
  retryOtherModelDownload,
  setActiveQortinoModel,
  stopOtherModelDownload,
} from '../models';

const BIG = QWEN3_30B_MODEL;
const BIG_ID = qdnModelEntryId(BIG);
const BIG_FIRST = `/data/Qortino AI/${modelPartPath(BIG, BIG.parts[0])}`;
const bigEntry = () => getQortinoModels().others.find((m) => m.id === BIG_ID);

/** The first download also loads its module: wait for that too. */
const flush = async (times = 5) => {
  for (let i = 0; i < times; i += 1) {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("Qortino's models", () => {
  beforeEach(() => {
    resetQortinoModelsForTests();
    qdn.runs.length = 0;
    qdn.log.length = 0;
    session.loaded = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetQortinoModelsForTests();
  });

  it('uses his own model until another is chosen', () => {
    expect(resolveActiveQortinoModel(null)).toMatchObject({
      id: QORTINO_OWN_MODEL_ID,
      path: null,
      isQortino: true,
      label: QORTINO_MODEL.label,
    });
    expect(resolveActiveQortinoModel('/q/part-1.gguf').path).toBe(
      '/q/part-1.gguf'
    );
  });

  it('names models after their files and spots later split parts', () => {
    expect(modelLabelFromFileName('/m/Llama-3.2-3B-Instruct-Q4_K_M.gguf')).toBe(
      'Llama-3.2-3B-Instruct-Q4 K M'
    );
    expect(modelLabelFromFileName('big-model-00001-of-00003.gguf')).toBe(
      'big-model'
    );
    expect(isLaterSplitPart('big-model-00002-of-00003.gguf')).toBe(true);
    expect(isLaterSplitPart('big-model-00001-of-00003.gguf')).toBe(false);
    expect(isLaterSplitPart('plain.gguf')).toBe(false);
  });

  it('adds a file from this computer, uses it, and forgets it on remove', async () => {
    const model = addFileModel({
      path: '/home/me/phi.gguf',
      name: 'phi.gguf',
      size: 2_000,
    });
    expect(getQortinoModels().activeId).toBe(model.id);
    expect(resolveActiveQortinoModel(null)).toMatchObject({
      path: '/home/me/phi.gguf',
      isQortino: false,
      label: 'phi',
    });
    // The same file again is not added twice.
    expect(
      addFileModel({ path: '/home/me/phi.gguf', name: 'phi.gguf', size: 2_000 })
        .id
    ).toBe(model.id);

    await removeOtherModel(model.id);
    expect(getQortinoModels().others).toEqual([]);
    expect(getQortinoModels().activeId).toBe(QORTINO_OWN_MODEL_ID);
    // A file the user picked is left on disk.
    expect(llm.removeOtherModel).not.toHaveBeenCalled();
  });

  it('downloads a model from QDN and switches to it when done', async () => {
    void downloadQdnOtherModel(BIG);
    await flush();
    expect(bigEntry()).toMatchObject({
      source: 'qdn',
      qdnModelId: BIG.id,
      status: 'downloading',
      sizeBytes: BIG.parts.reduce((sum, part) => sum + part.sizeBytes, 0),
      partPaths: BIG.parts.map((part) => modelPartPath(BIG, part)),
    });
    // Not usable while it downloads.
    setActiveQortinoModel(BIG_ID);
    expect(getQortinoModels().activeId).toBe(QORTINO_OWN_MODEL_ID);

    qdn.runs[0].finish({ path: BIG_FIRST });
    await flush();
    expect(bigEntry()).toMatchObject({ status: 'ready', path: BIG_FIRST });
    expect(getQortinoModels().activeId).toBe(BIG_ID);
    expect(resolveActiveQortinoModel(null)).toMatchObject({
      path: BIG_FIRST,
      isQortino: false,
    });
  });

  it('starts a download once, however often it is asked for', async () => {
    void downloadQdnOtherModel(BIG);
    void downloadQdnOtherModel(BIG);
    void retryOtherModelDownload(BIG_ID);
    await flush();

    expect(qdn.downloadQdnModelWithRetries).toHaveBeenCalledTimes(1);
    expect(getQortinoModels().others).toHaveLength(1);
    expect(bigEntry()?.status).toBe('downloading');
  });

  it('keeps the parts of a stopped download, and carries on when asked', async () => {
    void downloadQdnOtherModel(BIG);
    await flush();

    stopOtherModelDownload(BIG_ID);
    await flush();
    expect(bigEntry()).toMatchObject({ status: 'failed', failure: undefined });
    expect(llm.removeOtherModel).not.toHaveBeenCalled();

    void retryOtherModelDownload(BIG_ID);
    await flush();
    expect(qdn.downloadQdnModelWithRetries).toHaveBeenCalledTimes(2);
    expect(bigEntry()?.status).toBe('downloading');
  });

  it('says why a download gave up', async () => {
    void downloadQdnOtherModel(BIG);
    await flush();

    qdn.runs[0].fail(
      Object.assign(new Error('stalled'), {
        failure: { code: 'stalled', detail: 'part 3' },
      })
    );
    await flush();

    expect(bigEntry()).toMatchObject({
      status: 'failed',
      failure: { code: 'stalled', detail: 'part 3' },
    });
  });

  it('stops a download and lets it end before deleting every part', async () => {
    llm.removeOtherModel.mockImplementation(async ({ relativePath }) => {
      qdn.log.push(`delete ${relativePath}`);
      return { freedBytes: 1 };
    });
    void downloadQdnOtherModel(BIG);
    await flush();
    qdn.runs[0].signal.addEventListener('abort', () => qdn.log.push('stopped'));

    await removeOtherModel(BIG_ID);

    // Nothing is deleted while the download may still write.
    expect(qdn.log).toEqual([
      'stopped',
      'ended',
      ...BIG.parts.map((part) => `delete ${modelPartPath(BIG, part)}`),
    ]);
    expect(getQortinoModels().others).toEqual([]);
    // Offered again from the start.
    void downloadQdnOtherModel(BIG);
    await flush();
    expect(qdn.downloadQdnModelWithRetries).toHaveBeenCalledTimes(2);
  });

  it('unloads the model in use before deleting it, and keeps it if deleting fails', async () => {
    void downloadQdnOtherModel(BIG);
    await flush();
    qdn.runs[0].finish({ path: BIG_FIRST });
    await flush();
    session.loaded = BIG_FIRST;
    llm.removeOtherModel.mockRejectedValueOnce(new Error('EBUSY'));
    await expect(removeOtherModel(BIG_ID)).rejects.toThrow('EBUSY');
    expect(session.unloadQortinoModelNow).toHaveBeenCalled();
    expect(getQortinoModels().others.map((m) => m.id)).toEqual([BIG_ID]);
    await removeOtherModel(BIG_ID);
    expect(getQortinoModels().others).toEqual([]);
  });

  it('keeps models an earlier test build downloaded by link, to use or delete', async () => {
    localStorage.setItem(
      'qortino:models:v1',
      JSON.stringify({
        activeId: 'model_done',
        others: [
          {
            id: 'model_done',
            label: 'Done',
            source: 'link',
            path: '/data/Qortino AI/other-models/abc/done.gguf',
            sizeBytes: 9,
            addedAt: 1,
            url: 'https://example.com/done.gguf',
            relativePath: 'other-models/abc/done.gguf',
            status: 'ready',
          },
          {
            id: 'model_half',
            label: 'Half',
            source: 'link',
            path: '/data/Qortino AI/other-models/def/half.gguf',
            sizeBytes: 0,
            addedAt: 2,
            url: 'https://example.com/half.gguf',
            relativePath: 'other-models/def/half.gguf',
            status: 'downloading',
          },
        ],
      })
    );

    expect(resolveActiveQortinoModel(null).path).toBe(
      '/data/Qortino AI/other-models/abc/done.gguf'
    );
    expect(getQortinoModels().others.map((m) => m.status)).toEqual([
      'ready',
      'failed',
    ]);
    // Nothing downloads from a web link again.
    await retryOtherModelDownload('model_half');
    expect(qdn.downloadQdnModelWithRetries).not.toHaveBeenCalled();

    await removeOtherModel('model_half');
    expect(llm.removeOtherModel).toHaveBeenCalledWith({
      relativePath: 'other-models/def/half.gguf',
    });
    expect(getQortinoModels().others.map((m) => m.id)).toEqual(['model_done']);
  });

  it('shows a download Hub was closed during as stopped', () => {
    localStorage.setItem(
      'qortino:models:v1',
      JSON.stringify({
        activeId: BIG_ID,
        others: [
          {
            id: BIG_ID,
            label: BIG.label,
            source: 'qdn',
            qdnModelId: BIG.id,
            path: '',
            sizeBytes: 1,
            addedAt: 1,
            relativePath: modelPartPath(BIG, BIG.parts[0]),
            status: 'downloading',
          },
        ],
      })
    );
    const state = getQortinoModels();
    expect(state.others[0]).toMatchObject({
      status: 'failed',
      failure: undefined,
    });
    // Not ready, so not in use.
    expect(resolveActiveQortinoModel(null).isQortino).toBe(true);
  });

  it('deletes on Remove the parts an earlier build named otherwise too', async () => {
    const old =
      'other-models/qwen3-30b-a3b-instruct-2507-q4km/old-00001-of-00002.gguf';
    localStorage.setItem(
      'qortino:models:v1',
      JSON.stringify({
        activeId: QORTINO_OWN_MODEL_ID,
        others: [
          {
            id: BIG_ID,
            label: BIG.label,
            source: 'qdn',
            qdnModelId: BIG.id,
            path: '',
            sizeBytes: 1,
            addedAt: 1,
            relativePath: old,
            partPaths: [old],
            status: 'failed',
          },
        ],
      })
    );
    void downloadQdnOtherModel(BIG);
    await flush();
    llm.removeOtherModel.mockClear();

    await removeOtherModel(BIG_ID);

    const deleted = llm.removeOtherModel.mock.calls.map(
      ([args]) => args.relativePath
    );
    expect(deleted).toContain(old);
    expect(deleted).toEqual(
      expect.arrayContaining(BIG.parts.map((part) => modelPartPath(BIG, part)))
    );
  });
});
