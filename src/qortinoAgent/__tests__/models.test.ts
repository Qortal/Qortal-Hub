import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DownloadListener = (event: {
  relativePath?: string;
  bytesReceived: number;
  bytesTotal: number;
  done: boolean;
}) => void;

const llm = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    otherModelPath: vi.fn(async ({ url }: { url: string }) => {
      const name = url.split('?')[0].split('/').pop() as string;
      return { relativePath: `other-models/${name}`, filename: name };
    }),
    getStoragePaths: vi.fn(async () => ({
      rootDir: '/data/Qortino AI',
      modelsDir: '/data/Qortino AI/models',
      knowledgeDir: '/data/Qortino AI/knowledge',
    })),
    downloadUrl: vi.fn(),
    cancelDownload: vi.fn(async () => undefined),
    removeOtherModel: vi.fn(async () => ({ freedBytes: 1 })),
    addListener: vi.fn(async (_name: string, listener: DownloadListener) => {
      listeners.push(listener as (event: unknown) => void);
      return { remove: async () => undefined };
    }),
  };
});

vi.mock('../qortinoLlm', () => ({ default: llm }));
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

import { QORTINO_MODEL } from '../manifest';
import {
  addFileModel,
  addLinkModel,
  cancelOtherModelDownload,
  getQortinoModels,
  isLaterSplitPart,
  modelLabelFromFileName,
  QORTINO_OWN_MODEL_ID,
  removeOtherModel,
  resetQortinoModelsForTests,
  resolveActiveQortinoModel,
  setActiveQortinoModel,
} from '../models';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Qortino's models", () => {
  beforeEach(() => {
    resetQortinoModelsForTests();
    llm.listeners.length = 0;
    session.loaded = null;
    vi.clearAllMocks();
    llm.downloadUrl.mockReset();
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

  it('downloads a model by link and switches to it when done', async () => {
    let finish!: (value: { path: string; bytesWritten: number }) => void;
    llm.downloadUrl.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const model = await addLinkModel({
      url: 'https://huggingface.co/x/resolve/main/phi.gguf',
    });
    expect(model).toMatchObject({
      status: 'downloading',
      relativePath: 'other-models/phi.gguf',
      path: '/data/Qortino AI/other-models/phi.gguf',
    });
    // Not usable while it downloads.
    setActiveQortinoModel(model.id);
    expect(getQortinoModels().activeId).toBe(QORTINO_OWN_MODEL_ID);

    await flush();
    finish({ path: '/data/Qortino AI/other-models/phi.gguf', bytesWritten: 9 });
    await flush();
    expect(getQortinoModels().others[0]).toMatchObject({
      status: 'ready',
      sizeBytes: 9,
    });
    expect(getQortinoModels().activeId).toBe(model.id);

    await removeOtherModel(model.id);
    expect(llm.removeOtherModel).toHaveBeenCalledWith({
      relativePath: 'other-models/phi.gguf',
    });
  });

  it('keeps a failed download to try again, and drops a cancelled one', async () => {
    llm.downloadUrl.mockRejectedValueOnce(new Error('HTTP 503'));
    const failed = await addLinkModel({ url: 'https://example.com/a.gguf' });
    await flush();
    await flush();
    expect(getQortinoModels().others[0]).toMatchObject({
      id: failed.id,
      status: 'failed',
      error: 'HTTP 503',
    });

    llm.downloadUrl.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          llm.cancelDownload.mockImplementationOnce(async () => {
            reject(new Error('cancelled'));
          });
        })
    );
    const cancelled = await addLinkModel({ url: 'https://example.com/b.gguf' });
    await flush();
    await cancelOtherModelDownload(cancelled.id);
    await flush();
    await flush();
    expect(getQortinoModels().others.map((m) => m.id)).toEqual([failed.id]);
  });

  it('finds the same file again instead of downloading it twice', async () => {
    llm.downloadUrl.mockImplementation(() => new Promise(() => undefined));
    const first = await addLinkModel({ url: 'https://e.com/x/m.gguf' });
    const again = await addLinkModel({
      url: 'https://e.com/x/m.gguf?download=true',
    });
    expect(again.id).toBe(first.id);
    expect(getQortinoModels().others).toHaveLength(1);
    expect(llm.downloadUrl).toHaveBeenCalledTimes(1);
  });

  it('unloads the model in use before deleting it, and keeps it if deleting fails', async () => {
    llm.downloadUrl.mockResolvedValueOnce({
      path: '/data/Qortino AI/other-models/m.gguf',
      bytesWritten: 5,
    });
    const model = await addLinkModel({ url: 'https://e.com/m.gguf' });
    await flush();
    await flush();
    session.loaded = '/data/Qortino AI/other-models/m.gguf';
    llm.removeOtherModel.mockRejectedValueOnce(new Error('EBUSY'));
    await expect(removeOtherModel(model.id)).rejects.toThrow('EBUSY');
    expect(session.unloadQortinoModelNow).toHaveBeenCalled();
    expect(getQortinoModels().others.map((m) => m.id)).toEqual([model.id]);
    await removeOtherModel(model.id);
    expect(getQortinoModels().others).toEqual([]);
  });

  it('refuses something that is not a web link', async () => {
    await expect(addLinkModel({ url: 'ftp://x/y.gguf' })).rejects.toThrow(
      'invalid_link'
    );
  });

  it('shows a download Hub was closed during as stopped', () => {
    localStorage.setItem(
      'qortino:models:v1',
      JSON.stringify({
        activeId: 'model_a',
        others: [
          {
            id: 'model_a',
            label: 'A',
            source: 'link',
            path: '/x/a.gguf',
            sizeBytes: 0,
            addedAt: 1,
            url: 'https://e.com/a.gguf',
            relativePath: 'other-models/a.gguf',
            status: 'downloading',
          },
        ],
      })
    );
    const state = getQortinoModels();
    expect(state.others[0].status).toBe('failed');
    // Not ready, so not in use.
    expect(resolveActiveQortinoModel(null).isQortino).toBe(true);
  });
});
