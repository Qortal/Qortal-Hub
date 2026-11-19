import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { qortinoAgentOpenAtom, rawWalletAtom } from '../../../atoms/global';

// Qortino's own model is on this computer.
const store = vi.hoisted(() => ({
  loadInstallState: vi.fn(async () => ({
    installed: true,
    modelId: 'qwen3-4b-instruct-2507-q4km',
    llmPath: '/q/models/qortino-qwen3-4b-2507-q4km-00001-of-00002.gguf',
  })),
  saveInstallState: vi.fn(async () => undefined),
  clearInstallState: vi.fn(async () => undefined),
  clearLegacyInstall: vi.fn(async () => undefined),
  hasLegacyInstall: vi.fn(async () => false),
}));
vi.mock('../../../qortinoAgent/store', () => store);
// Every question here goes to the model.
vi.mock('../../../qortinoAgent/goldenMatch', () => ({
  lookupGoldenAnswer: () => ({ instant: null, hints: [] }),
  warmGoldenIndex: () => undefined,
}));
vi.mock('../../../qortinoAgent/qAppCatalog', () => ({
  matchQAppCatalog: () => null,
  formatQAppAnswer: () => '',
  openQAppInNewTab: () => undefined,
}));

import { QortinoAgentPanel } from './QortinoAgentPanel';
// Loaded ahead, as the panel loads it on first open.
import './QortinoAgentChat';
import { resetQortinoModelSessionForTests } from '../../../qortinoAgent/modelSession';
import {
  addFileModel,
  resetQortinoModelsForTests,
} from '../../../qortinoAgent/models';
import { clearPendingQortinoQuestion } from '../../../qortinoAgent/pendingQuestion';
import { resetQortinoSettingsForTests } from '../../../qortinoAgent/settings';

/**
 * The model process, as far as Hub can tell. A cancel or an unload ends the
 * reply being written with what it wrote so far, as the model process does.
 */
function fakeModelProcess() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (name: string, payload: unknown) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
  };
  let running: { written: string; end: (text: string) => void } | null = null;
  const stopRunning = async () => {
    running?.end(running.written);
  };
  const bridge = {
    getDeviceTier: vi.fn(async () => ({
      totalRamBytes: 16 * 1024 ** 3,
      availRamBytes: 8 * 1024 ** 3,
      availStorageBytes: 100 * 1024 ** 3,
      totalStorageBytes: 500 * 1024 ** 3,
      lowMemory: false,
    })),
    loadModel: vi.fn(
      async (): Promise<unknown> => ({ loaded: true, path: 'p' })
    ),
    warmup: vi.fn(async () => ({ ok: true })),
    unload: vi.fn(stopRunning),
    cancel: vi.fn(stopRunning),
    cleanupStorage: vi.fn(async () => ({ deletedFiles: 2, freedBytes: 10 })),
    cancelDownload: vi.fn(async () => undefined),
    complete: vi.fn(
      () =>
        new Promise((resolve) => {
          const reply = {
            written: '',
            end: (text: string) => {
              if (running === reply) running = null;
              emit('token', { token: '', done: true });
              resolve({ ok: true, text });
            },
          };
          running = reply;
        })
    ),
    on: (name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
  /** The model writes `token`. */
  const write = (token: string) => {
    if (running) running.written += token;
    emit('token', { token, done: false });
  };
  /** The model finishes its answer. */
  const finish = (text: string) => running?.end(text);
  const isWriting = () => running !== null;
  return { bridge, write, finish, isWriting };
}

describe("Qortino's panel with its chat and settings", () => {
  let model: ReturnType<typeof fakeModelProcess>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
    clearPendingQortinoQuestion();
    getDefaultStore().set(rawWalletAtom, { address0: 'QTESTACCOUNT' });
    model = fakeModelProcess();
    window.qortinoLlm = model.bridge as unknown as typeof window.qortinoLlm;
  });

  afterEach(() => {
    delete window.qortinoLlm;
    getDefaultStore().set(rawWalletAtom, null);
    getDefaultStore().set(qortinoAgentOpenAtom, false);
    clearPendingQortinoQuestion();
    resetQortinoModelSessionForTests();
    resetQortinoModelsForTests();
    localStorage.clear();
  });

  const renderPanel = () => {
    getDefaultStore().set(qortinoAgentOpenAtom, true);
    return render(
      <ThemeProvider theme={createTheme()}>
        <QortinoAgentPanel />
      </ThemeProvider>
    );
  };

  const settle = (ms = 60) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  // The chat's code loads the first time the panel shows it.
  const composer = () =>
    screen.findByPlaceholderText('Message Qortino…', undefined, {
      timeout: 8000,
    }) as Promise<HTMLTextAreaElement>;

  const ask = async (question: string) => {
    fireEvent.change(await composer(), { target: { value: question } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  it("keeps another model's answer when Qortino's own model is removed meanwhile", async () => {
    // The user chats with a model of their own.
    addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
    renderPanel();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.write('The answer starts');
    });
    // While it answers: Settings, Remove Qortino's model.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: "Remove Qortino's model from this computer",
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(model.bridge.cleanupStorage).toHaveBeenCalled());
    await settle();
    // The model writes the rest of its answer, if it still may.
    await act(async () => {
      if (!model.isWriting()) return;
      model.write(' and goes on to its end.');
      model.finish('The answer starts and goes on to its end.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await settle(100);
    expect(screen.getByText(/^The answer starts/).textContent).toBe(
      'The answer starts and goes on to its end.'
    );
    // The model in use stays loaded for the next question.
    expect(model.bridge.unload).not.toHaveBeenCalled();
  }, 30000);

  it('lets all chats be deleted once the answer being written when settings opened is saved', async () => {
    addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
    renderPanel();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    // Settings opened while the first answer is written.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('dialog', { name: 'Settings' });
    await act(async () => {
      model.finish('An answer.');
    });
    // The chat under settings has saved its question and answer.
    await settle(600);
    expect(
      screen.getByRole('button', { name: 'Delete all chats' })
    ).not.toBeDisabled();
  }, 30000);
});
