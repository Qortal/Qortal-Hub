import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const llm = vi.hoisted(() => ({
  loadModel: vi.fn(async () => ({ loaded: true, path: 'p' })),
  unload: vi.fn(async () => undefined),
  warmup: vi.fn(async () => ({ ok: true })),
}));
const install = vi.hoisted(() => ({
  state: {
    installed: true,
    llmPath: '/agent/models/m-00001-of-00002.gguf',
  } as { installed: boolean; llmPath?: string },
}));

vi.mock('../qortinoLlm', () => ({
  default: llm,
  isQortinoLlmInferenceAvailable: () => true,
  isQortinoLlmNativeAvailable: () => false,
}));
const store = vi.hoisted(() => ({
  loadInstallState: vi.fn(async () => install.state),
}));
vi.mock('../store', () => store);

import {
  qortinoAgentOpenAtom,
  qortinoAgentParkedAtom,
} from '../../atoms/global';
import {
  RELEASE_HOME_DRAFT_OFF_MS,
  releaseQortinoAfterHomeDraft,
  resetHomeDraftWarmupForTests,
  warmQortinoForHomeDraft,
} from '../homeDraftWarmup';
import { QORTINO_MODEL } from '../manifest';
import {
  ensureQortinoModel,
  isQortinoModelLoaded,
  resetQortinoModelSessionForTests,
} from '../modelSession';
import { buildSystemPrompt } from '../persona';
import {
  resetQortinoSettingsForTests,
  updateQortinoSettings,
} from '../settings';

const LOAD = {
  path: '/agent/models/m-00001-of-00002.gguf',
  nCtx: QORTINO_MODEL.contextTokens,
};

describe('Qortino getting ready while a question is typed on Home', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
    resetHomeDraftWarmupForTests();
    install.state = { installed: true, llmPath: LOAD.path };
    const store = getDefaultStore();
    store.set(qortinoAgentOpenAtom, false);
    store.set(qortinoAgentParkedAtom, false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts no load for a draft left while its install check ran', async () => {
    let answer!: (state: typeof install.state) => void;
    store.loadInstallState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const warming = warmQortinoForHomeDraft();
    // The box is left before the check answers.
    releaseQortinoAfterHomeDraft();
    answer(install.state);
    await warming;
    expect(llm.loadModel).not.toHaveBeenCalled();
    expect(isQortinoModelLoaded(LOAD)).toBe(false);
  });

  it('releases a load the draft started when the draft is left during it', async () => {
    let finishLoad!: () => void;
    llm.loadModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = () => resolve({ loaded: true, path: LOAD.path });
        })
    );
    const warming = warmQortinoForHomeDraft();
    await vi.advanceTimersByTimeAsync(0);
    expect(llm.loadModel).toHaveBeenCalledTimes(1);
    releaseQortinoAfterHomeDraft();
    finishLoad();
    await warming;
    // Not read for a draft nobody will send.
    expect(llm.warmup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELEASE_HOME_DRAFT_OFF_MS * 10);
    expect(llm.unload).toHaveBeenCalled();
    expect(isQortinoModelLoaded(LOAD)).toBe(false);
  });

  it('lets only the newest warm-up go on', async () => {
    let first!: (state: typeof install.state) => void;
    store.loadInstallState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        })
    );
    const older = warmQortinoForHomeDraft();
    const newer = warmQortinoForHomeDraft();
    await newer;
    first(install.state);
    await older;
    expect(llm.loadModel).toHaveBeenCalledTimes(1);
  });

  it('loads the model and reads the system prompt the chat will use', async () => {
    updateQortinoSettings({ answerLength: 'short' });
    await warmQortinoForHomeDraft();
    expect(llm.loadModel).toHaveBeenCalledWith({
      path: LOAD.path,
      nCtx: LOAD.nCtx,
    });
    expect(llm.warmup).toHaveBeenCalledWith({
      system: buildSystemPrompt('short'),
    });
    expect(isQortinoModelLoaded(LOAD)).toBe(true);
  });

  it('lets the chat join the load still running when the question is sent', async () => {
    let finish!: () => void;
    llm.loadModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ loaded: true, path: 'p' });
        })
    );
    const warming = warmQortinoForHomeDraft();
    await vi.advanceTimersByTimeAsync(0);
    const chat = ensureQortinoModel(LOAD);
    finish();
    await Promise.all([warming, chat]);
    expect(llm.loadModel).toHaveBeenCalledTimes(1);
  });

  it('does nothing while Qortino AI is not on the phone', async () => {
    install.state = { installed: false };
    await warmQortinoForHomeDraft();
    expect(llm.loadModel).not.toHaveBeenCalled();
  });

  it('frees an unsent draft after a minute and a half by default', async () => {
    await warmQortinoForHomeDraft();
    releaseQortinoAfterHomeDraft();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llm.unload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(llm.unload).toHaveBeenCalledTimes(1);
  });

  it('frees it sooner when "Keep ready" is off, with time left to send', async () => {
    updateQortinoSettings({ keepReady: 'off' });
    await warmQortinoForHomeDraft();
    releaseQortinoAfterHomeDraft();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(llm.unload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELEASE_HOME_DRAFT_OFF_MS);
    expect(llm.unload).toHaveBeenCalledTimes(1);
  });

  it('keeps it while GO is open when set to', async () => {
    updateQortinoSettings({ keepReady: 'open' });
    await warmQortinoForHomeDraft();
    releaseQortinoAfterHomeDraft();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(llm.unload).not.toHaveBeenCalled();
  });

  it('typing again before the release keeps the model', async () => {
    await warmQortinoForHomeDraft();
    releaseQortinoAfterHomeDraft();
    await vi.advanceTimersByTimeAsync(60_000);
    await warmQortinoForHomeDraft();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(llm.unload).not.toHaveBeenCalled();
    expect(llm.loadModel).toHaveBeenCalledTimes(1);
  });

  it('never frees the model under an open or parked Qortino window', async () => {
    await warmQortinoForHomeDraft();
    getDefaultStore().set(qortinoAgentParkedAtom, true);
    releaseQortinoAfterHomeDraft();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(llm.unload).not.toHaveBeenCalled();
  });
});
