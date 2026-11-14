import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const llm = vi.hoisted(() => ({
  loadModel: vi.fn(async () => ({ loaded: true, path: 'p' })),
  unload: vi.fn(async () => undefined),
  warmup: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../qortinoLlm', () => ({
  default: llm,
  isQortinoLlmNativeAvailable: () => false,
}));

import {
  ensureQortinoModel,
  forgetQortinoModel,
  isQortinoModelLoaded,
  isQortinoModelPathInUse,
  loadedQortinoModelPath,
  markQortinoBusy,
  qortinoKvHistoryStart,
  releaseQortinoModelAfterClose,
  releaseQortinoModelSoon,
  resetQortinoModelSessionForTests,
  setQortinoKvOwner,
  unloadQortinoModelNow,
  warmQortinoSystemPrompt,
} from '../modelSession';
import {
  resetQortinoSettingsForTests,
  updateQortinoSettings,
} from '../settings';

const LOAD = { path: '/agent/models/m-00001-of-00002.gguf', nCtx: 4096 };

describe('Qortino model session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads once for concurrent and repeated callers', async () => {
    await Promise.all([ensureQortinoModel(LOAD), ensureQortinoModel(LOAD)]);
    await ensureQortinoModel(LOAD);
    expect(llm.loadModel).toHaveBeenCalledTimes(1);
    expect(isQortinoModelLoaded(LOAD)).toBe(true);
  });

  it('keeps the model through a quick close and reopen', async () => {
    await ensureQortinoModel(LOAD);
    releaseQortinoModelSoon(90_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await ensureQortinoModel(LOAD);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(llm.unload).not.toHaveBeenCalled();
    expect(llm.loadModel).toHaveBeenCalledTimes(1);
  });

  it('unloads after the delay, but not while a reply is being written', async () => {
    await ensureQortinoModel(LOAD);
    markQortinoBusy(true);
    releaseQortinoModelSoon(1_000);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(llm.unload).not.toHaveBeenCalled();
    markQortinoBusy(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(llm.unload).toHaveBeenCalledTimes(1);
    expect(isQortinoModelLoaded(LOAD)).toBe(false);
  });

  it('warms each system prompt once per load', async () => {
    await ensureQortinoModel(LOAD);
    await warmQortinoSystemPrompt('persona');
    await warmQortinoSystemPrompt('persona');
    expect(llm.warmup).toHaveBeenCalledTimes(1);

    await unloadQortinoModelNow();
    await ensureQortinoModel(LOAD);
    await warmQortinoSystemPrompt('persona');
    expect(llm.warmup).toHaveBeenCalledTimes(2);
  });

  it('does not count a load that finished after an unload', async () => {
    let finish!: () => void;
    llm.loadModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ loaded: true, path: 'p' });
        })
    );
    const pending = ensureQortinoModel(LOAD);
    await unloadQortinoModelNow();
    finish();
    await pending;
    expect(isQortinoModelLoaded(LOAD)).toBe(false);
  });

  it('remembers which chat the cache holds until the model is reloaded', async () => {
    await ensureQortinoModel(LOAD);
    expect(qortinoKvHistoryStart('chat-a')).toBeNull();
    setQortinoKvOwner('chat-a', 4);
    expect(qortinoKvHistoryStart('chat-a')).toBe(4);
    expect(qortinoKvHistoryStart('chat-b')).toBeNull();

    await unloadQortinoModelNow();
    await ensureQortinoModel(LOAD);
    expect(qortinoKvHistoryStart('chat-a')).toBeNull();
  });

  it('forgets the chat in the cache when another system prompt is read', async () => {
    await ensureQortinoModel(LOAD);
    await warmQortinoSystemPrompt('persona');
    setQortinoKvOwner('chat-a', 2);
    // The same prompt again reads nothing and keeps the conversation.
    await warmQortinoSystemPrompt('persona');
    expect(qortinoKvHistoryStart('chat-a')).toBe(2);

    // The answer length changed: only the new prompt is in the cache now.
    await warmQortinoSystemPrompt('persona + short answers');
    expect(llm.warmup).toHaveBeenCalledTimes(2);
    expect(qortinoKvHistoryStart('chat-a')).toBeNull();
  });

  it('forgets a reply that finished while the new prompt waited its turn', async () => {
    await ensureQortinoModel(LOAD);
    await warmQortinoSystemPrompt('persona');
    let finishWarm!: () => void;
    llm.warmup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWarm = () => resolve({ ok: true });
        })
    );
    const warming = warmQortinoSystemPrompt('persona + short answers');
    // The running reply ends and records its chat before the warm-up runs.
    setQortinoKvOwner('chat-a', 2);
    finishWarm();
    await warming;
    expect(qortinoKvHistoryStart('chat-a')).toBeNull();
  });

  describe('after the Qortino window closes', () => {
    it('keeps the model for a minute and a half by default', async () => {
      await ensureQortinoModel(LOAD);
      releaseQortinoModelAfterClose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(llm.unload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(31_000);
      expect(llm.unload).toHaveBeenCalledTimes(1);
    });

    it('frees the memory right away when set to', async () => {
      updateQortinoSettings({ keepReady: 'off' });
      await ensureQortinoModel(LOAD);
      releaseQortinoModelAfterClose();
      await vi.advanceTimersByTimeAsync(2_500);
      expect(llm.unload).toHaveBeenCalledTimes(1);
    });

    it('keeps it while GO is open when set to', async () => {
      updateQortinoSettings({ keepReady: 'open' });
      await ensureQortinoModel(LOAD);
      releaseQortinoModelAfterClose();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(llm.unload).not.toHaveBeenCalled();
      expect(isQortinoModelLoaded(LOAD)).toBe(true);
    });
  });

  describe('switching and unloading', () => {
    it('does not keep the old model looking loaded when a switch fails', async () => {
      await ensureQortinoModel(LOAD);
      expect(loadedQortinoModelPath()).toBe(LOAD.path);
      llm.loadModel.mockRejectedValueOnce(
        new Error('unknown model architecture')
      );
      await expect(
        ensureQortinoModel({ path: '/other/broken.gguf', nCtx: 4096 })
      ).rejects.toThrow('unknown model architecture');
      // The model process let go of the first model before trying the other.
      expect(isQortinoModelLoaded(LOAD)).toBe(false);
      expect(loadedQortinoModelPath()).toBeNull();
      await ensureQortinoModel(LOAD);
      expect(llm.loadModel).toHaveBeenCalledTimes(3);
    });

    it('starts a new load after an unload instead of joining the undone one', async () => {
      let finishFirst!: () => void;
      llm.loadModel.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () => resolve({ loaded: true, path: LOAD.path });
          })
      );
      const first = ensureQortinoModel(LOAD);
      await unloadQortinoModelNow();
      const second = ensureQortinoModel(LOAD);
      finishFirst();
      await first;
      await second;
      expect(llm.loadModel).toHaveBeenCalledTimes(2);
      expect(isQortinoModelLoaded(LOAD)).toBe(true);
    });

    it('forgets a load in flight too', async () => {
      llm.loadModel.mockImplementationOnce(() => new Promise(() => undefined));
      void ensureQortinoModel(LOAD);
      forgetQortinoModel();
      await ensureQortinoModel(LOAD);
      expect(llm.loadModel).toHaveBeenCalledTimes(2);
    });

    it('does not record a load that a switch replaced while it ran', async () => {
      let finishFirst!: () => void;
      llm.loadModel.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () => resolve({ loaded: true, path: LOAD.path });
          })
      );
      const first = ensureQortinoModel(LOAD);
      llm.loadModel.mockRejectedValueOnce(new Error('broken'));
      const other = ensureQortinoModel({ path: '/m/other.gguf', nCtx: 4096 });
      finishFirst();
      await first;
      await expect(other).rejects.toThrow('broken');
      expect(isQortinoModelLoaded(LOAD)).toBe(false);
    });

    it('lets go of the old model when a switch is refused before loading', async () => {
      await ensureQortinoModel(LOAD);
      llm.loadModel.mockRejectedValueOnce(
        new Error('The model file is missing')
      );
      await expect(
        ensureQortinoModel({ path: '/m/gone.gguf', nCtx: 4096 })
      ).rejects.toThrow('missing');
      expect(llm.unload).toHaveBeenCalled();
    });

    it('counts a model still loading as in use', async () => {
      llm.loadModel.mockImplementationOnce(() => new Promise(() => undefined));
      void ensureQortinoModel(LOAD);
      expect(isQortinoModelPathInUse(LOAD.path)).toBe(true);
      expect(isQortinoModelPathInUse('/m/other.gguf')).toBe(false);
    });

    it('keeps the processor choice in what counts as loaded', async () => {
      await ensureQortinoModel(LOAD);
      await ensureQortinoModel({ ...LOAD, gpu: false });
      expect(llm.loadModel).toHaveBeenLastCalledWith(
        expect.objectContaining({ gpu: false })
      );
      expect(loadedQortinoModelPath()).toBe(LOAD.path);
    });
  });
});
