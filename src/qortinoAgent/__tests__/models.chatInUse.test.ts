import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The model process as qortino-llm-worker.ts runs it: calls wait in one line
 * and run one after another, while cancel does not wait in line: it stops
 * the answer being written, and one still waiting in line never starts.
 */
const worker = vi.hoisted(() => {
  let line: Promise<unknown> = Promise.resolve();
  let stopReply: (() => void) | null = null;
  let cancelEpoch = 0;
  const inLine = <T>(work: () => T | Promise<T>): Promise<T> => {
    const next = line.then(work, work);
    line = next.catch(() => undefined);
    return next;
  };
  return {
    loaded: null as string | null,
    inLine,
    /** The answer being written ends (by itself or by cancel). */
    endReply: () => {
      stopReply?.();
      stopReply = null;
    },
    cancel: () => {
      cancelEpoch += 1;
      stopReply?.();
      stopReply = null;
    },
    reply: () => {
      const epoch = cancelEpoch;
      return inLine(() => {
        if (epoch !== cancelEpoch) throw new Error('cancelled');
        return new Promise<{ ok: boolean; text: string }>((resolve) => {
          stopReply = () => resolve({ ok: true, text: 'An answer' });
        });
      });
    },
    reset: () => {
      line = Promise.resolve();
      stopReply = null;
    },
  };
});

const llm = vi.hoisted(() => ({
  getStoragePaths: vi.fn(async () => ({
    rootDir: '/data/Qortino AI',
    modelsDir: '/data/Qortino AI/models',
    knowledgeDir: '/data/Qortino AI/knowledge',
  })),
  cancelDownload: vi.fn(async () => undefined),
  removeOtherModel: vi.fn(async (_options: { relativePath: string }) => ({
    freedBytes: 1,
  })),
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  loadModel: vi.fn(({ path }: { path: string }) =>
    worker.inLine(() => {
      worker.loaded = path;
      return { loaded: true, path };
    })
  ),
  warmup: vi.fn(async () => ({ ok: true })),
  complete: vi.fn((_request?: unknown) => worker.reply()),
  cancel: vi.fn(async () => {
    worker.cancel();
  }),
  unload: vi.fn(() =>
    worker.inLine(() => {
      worker.loaded = null;
    })
  ),
}));

vi.mock('../qortinoLlm', () => ({
  default: llm,
  isQortinoLlmNativeAvailable: () => true,
}));

const qdn = vi.hoisted(() => ({
  downloadQdnModelWithRetries: vi.fn<() => Promise<{ path: string }>>(),
}));
vi.mock('../qdnModelDownload', () => qdn);

import { modelPartPath, QWEN3_30B_MODEL } from '../manifest';
import {
  addFileModel,
  downloadQdnOtherModel,
  getQortinoModels,
  qdnModelEntryId,
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
import { resetQortinoSettingsForTests } from '../settings';

const settle = async (ms = 0) => {
  // The first download from QDN also loads its module.
  await vi.dynamicImportSettled();
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe('Qortino models while the chat is in use', () => {
  beforeEach(() => {
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
    worker.reset();
    worker.loaded = null;
    vi.clearAllMocks();
    qdn.downloadQdnModelWithRetries.mockReset();
  });

  afterEach(() => {
    worker.endReply();
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
  });

  it('removes a model that is writing an answer without waiting for the answer to end', async () => {
    const first = modelPartPath(QWEN3_30B_MODEL, QWEN3_30B_MODEL.parts[0]);
    qdn.downloadQdnModelWithRetries.mockResolvedValueOnce({
      path: `/data/Qortino AI/${first}`,
    });
    await downloadQdnOtherModel(QWEN3_30B_MODEL);
    const id = qdnModelEntryId(QWEN3_30B_MODEL);
    setActiveQortinoModel(id);
    const ready = getQortinoModels().others[0];
    expect(ready.status).toBe('ready');

    // The chat loaded it and is writing an answer with it.
    await ensureQortinoModel({ path: ready.path, nCtx: 4096 });
    markQortinoBusy(true);
    void askQuestion();
    await settle();

    // Settings, over the chat: Remove, confirmed.
    let removed = false;
    void removeOtherModel(id).then(() => {
      removed = true;
    });
    await settle(50);

    expect(removed).toBe(true);
    expect(getQortinoModels().others).toEqual([]);
    // Every part goes.
    expect(llm.removeOtherModel.mock.calls.map(([args]) => args)).toEqual(
      QWEN3_30B_MODEL.parts.map((part) => ({
        relativePath: modelPartPath(QWEN3_30B_MODEL, part),
      }))
    );
  });

  it("keeps Qortino's own model when the user chose it while another one was downloading", async () => {
    // Another model was in use.
    addFileModel({ path: '/home/me/b.gguf', name: 'b.gguf', size: 5 });
    let finish!: (value: { path: string }) => void;
    qdn.downloadQdnModelWithRetries.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    void downloadQdnOtherModel(QWEN3_30B_MODEL);
    await settle();

    // The user picks Qortino's own model and chats with it.
    setActiveQortinoModel(QORTINO_OWN_MODEL_ID);
    await ensureQortinoModel({
      path: '/data/Qortino AI/models/q-00001-of-00002.gguf',
      nCtx: 4096,
    });
    markQortinoBusy(true);
    void askQuestion();
    await settle();

    // The download ends in the middle of that chat.
    finish({ path: '/data/Qortino AI/other-models/big/big-1.gguf' });
    await settle();
    await settle();

    expect(
      getQortinoModels().others.find(
        (m) => m.id === qdnModelEntryId(QWEN3_30B_MODEL)
      )?.status
    ).toBe('ready');
    expect(getQortinoModels().activeId).toBe(QORTINO_OWN_MODEL_ID);
  });
});

/** What the chat sends for an answer (QortinoAgentChat's generate). */
function askQuestion() {
  return llm
    .complete({
      system: 'You are Qortino.',
      messages: [{ role: 'user', content: 'What is QDN?' }],
    })
    .catch(() => undefined);
}
