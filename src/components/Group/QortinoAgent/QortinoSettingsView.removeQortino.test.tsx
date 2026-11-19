import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { qortinoAgentOpenAtom, rawWalletAtom } from '../../../atoms/global';

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

import { QortinoAgentChat } from './QortinoAgentChat';
import { QortinoSettingsView } from './QortinoSettingsView';
import { resetQortinoModelSessionForTests } from '../../../qortinoAgent/modelSession';
import { clearPendingQortinoQuestion } from '../../../qortinoAgent/pendingQuestion';
import { resetQortinoSettingsForTests } from '../../../qortinoAgent/settings';
import {
  addFileModel,
  resetQortinoModelsForTests,
} from '../../../qortinoAgent/models';

type Reply = {
  resolve: (text: string) => void;
  reject: (message: string) => void;
};

/** The model process, as far as the panel can tell. */
function fakeModelProcess() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (name: string, payload: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  const replies: Reply[] = [];
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
    unload: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    cancelDownload: vi.fn(async () => undefined),
    cleanupStorage: vi.fn(async () => ({ deletedFiles: 2, freedBytes: 10 })),
    complete: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          replies.push({
            resolve: (text) => {
              emit('token', { token: '', done: true });
              resolve({ ok: true, text });
            },
            reject: (message) => {
              emit('token', { token: '', done: true, error: message });
              reject(new Error(message));
            },
          });
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
  return { bridge, replies };
}

/** A model the user added, in use now. */
const OTHER_MODEL = {
  id: 'model_a',
  label: 'Model A',
  path: '/m/a.gguf',
  contextTokens: 4096,
  isQortino: false,
};

/** Qortino's own model, downloaded to this computer. */
const QORTINO_PATH = '/q/models/qortino.gguf';
const QORTINO_MODEL = {
  id: 'qortino',
  label: 'Qortino',
  path: QORTINO_PATH,
  contextTokens: 4096,
  isQortino: true,
};

describe("Removing Qortino's own model while a model answers", () => {
  let model: ReturnType<typeof fakeModelProcess>;

  beforeEach(() => {
    localStorage.clear();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
    resetQortinoModelsForTests();
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

  const install = { installed: true, llmPath: QORTINO_PATH };

  /** The panel: the chat, with its settings slid over it when open. */
  const Panel = ({
    settingsOpen,
    chatModel,
  }: {
    settingsOpen: boolean;
    chatModel: typeof OTHER_MODEL;
  }) => (
    <ThemeProvider theme={createTheme()}>
      <QortinoAgentChat
        model={chatModel}
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        expanded={false}
        onToggleExpanded={vi.fn()}
      />
      {settingsOpen ? (
        <QortinoSettingsView
          install={install}
          onBack={vi.fn()}
          onRemoved={vi.fn()}
        />
      ) : null}
    </ThemeProvider>
  );

  const composer = () => screen.getByPlaceholderText('Message Qortino…');

  const ask = async (question: string) => {
    fireEvent.change(composer(), { target: { value: question } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  const settle = (ms = 60) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  /** While `chatModel` answers: Settings, Remove Qortino's model, Remove. */
  const removeQortinoWhileAnswering = async (chatModel: typeof OTHER_MODEL) => {
    const view = render(<Panel settingsOpen={false} chatModel={chatModel} />);
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    view.rerender(<Panel settingsOpen chatModel={chatModel} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: "Remove Qortino's model from this computer",
      })
    );
    const confirm = screen.getByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    });
    await waitFor(() => expect(model.bridge.cleanupStorage).toHaveBeenCalled());
    await settle();
  };

  it("leaves another model's answer alone", async () => {
    addFileModel({ path: OTHER_MODEL.path, name: 'a.gguf', size: 10 });
    await removeQortinoWhileAnswering(OTHER_MODEL);
    // Model A's answer goes on, and Model A stays loaded.
    expect(model.bridge.cancel).not.toHaveBeenCalled();
    expect(model.bridge.unload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it("stops Qortino's own answer and unloads its model before deleting it", async () => {
    await removeQortinoWhileAnswering(QORTINO_MODEL);
    expect(model.bridge.cancel).toHaveBeenCalled();
    expect(model.bridge.unload).toHaveBeenCalled();
    expect(model.bridge.unload.mock.invocationCallOrder[0]).toBeLessThan(
      model.bridge.cleanupStorage.mock.invocationCallOrder[0]
    );
  });
});
