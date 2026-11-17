import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bridge to the model process, as it behaves: calls run one after
 * another, a cancel does not wait in line and ends the reply running.
 */
const llm = vi.hoisted(() => {
  let line: Promise<unknown> = Promise.resolve();
  let stopReply: ((error?: Error) => void) | null = null;
  let finishDownload:
    | ((value: { path: string; bytesWritten: number }) => void)
    | null = null;
  const inLine = <T>(work: () => Promise<T>): Promise<T> => {
    const next = line.then(work, work);
    line = next.catch(() => undefined);
    return next;
  };
  return {
    replyRunning: () => stopReply !== null,
    endReply: () => stopReply?.(),
    finishDownload: (value: { path: string; bytesWritten: number }) =>
      finishDownload?.(value),
    loadModel: vi.fn((options: { path: string }) =>
      inLine(async () => ({ loaded: true, path: options.path }))
    ),
    warmup: vi.fn(() => inLine(async () => ({ ok: true }))),
    complete: vi.fn(() =>
      inLine(
        () =>
          new Promise<{ ok: boolean; text: string }>((resolve, reject) => {
            stopReply = (error?: Error) => {
              stopReply = null;
              if (error) reject(error);
              else resolve({ ok: true, text: 'a long answer' });
            };
          })
      )
    ),
    cancel: vi.fn(async () => {
      stopReply?.(new Error('cancelled'));
    }),
    unload: vi.fn(() => inLine(async () => undefined)),
    otherModelPath: vi.fn(async ({ url }: { url: string }) => {
      const name = url.split('?')[0].split('/').pop() as string;
      return { relativePath: `other-models/${name}`, filename: name };
    }),
    getStoragePaths: vi.fn(async () => ({
      rootDir: '/data/Qortino AI',
      modelsDir: '/data/Qortino AI/models',
      knowledgeDir: '/data/Qortino AI/knowledge',
    })),
    downloadUrl: vi.fn(
      () =>
        new Promise<{ path: string; bytesWritten: number }>((resolve) => {
          finishDownload = resolve;
        })
    ),
    cancelDownload: vi.fn(async () => undefined),
    removeOtherModel: vi.fn(async () => ({ freedBytes: 1 })),
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
  };
});

vi.mock('../qortinoLlm', () => ({
  default: llm,
  isQortinoLlmNativeAvailable: () => true,
}));

import {
  addFileModel,
  addLinkModel,
  getQortinoModels,
  QORTINO_OWN_MODEL_ID,
  removeOtherModel,
  resetQortinoModelsForTests,
  setActiveQortinoModel,
} from '../models';
import {
  ensureQortinoModel,
  markQortinoBusy,
  resetQortinoModelSessionForTests,
} from '../modelSession';

const flush = async (times = 10) => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("Qortino's other models, against the model process", () => {
  beforeEach(() => {
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    llm.endReply();
    await flush();
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
  });

  it('removes the model in use while it is answering, without waiting for the whole answer', async () => {
    // A model from this computer, in use in the chat.
    const model = addFileModel({
      path: '/home/me/phi.gguf',
      name: 'phi.gguf',
      size: 2_000,
    });
    await ensureQortinoModel({ path: model.path, nCtx: 4096 });
    // A question is being answered.
    markQortinoBusy(true);
    const reply = llm.complete();
    reply.catch(() => undefined);
    await flush();
    expect(llm.replyRunning()).toBe(true);

    // Settings → Remove → Remove, while the answer is still being written.
    let removed = false;
    void removeOtherModel(model.id).then(() => {
      removed = true;
    });
    await flush();

    expect(removed).toBe(true);
    expect(getQortinoModels().others).toEqual([]);
    markQortinoBusy(false);
  });

  it("keeps Qortino's own model in use when it was picked while another model downloaded", async () => {
    // Another model was in use; a link model starts downloading.
    const file = addFileModel({
      path: '/home/me/phi.gguf',
      name: 'phi.gguf',
      size: 2_000,
    });
    expect(getQortinoModels().activeId).toBe(file.id);
    const link = await addLinkModel({
      url: 'https://huggingface.co/x/resolve/main/big.gguf',
    });
    await flush();

    // The user picks Qortino's own model in the list.
    setActiveQortinoModel(QORTINO_OWN_MODEL_ID);
    expect(getQortinoModels().activeId).toBe(QORTINO_OWN_MODEL_ID);

    // The download finishes later.
    llm.finishDownload({
      path: '/data/Qortino AI/other-models/big.gguf',
      bytesWritten: 9,
    });
    await flush();

    expect(
      getQortinoModels().others.find((m) => m.id === link.id)?.status
    ).toBe('ready');
    expect(getQortinoModels().activeId).toBe(QORTINO_OWN_MODEL_ID);
  });
});
