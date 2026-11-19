import { act, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { qortinoAgentOpenAtom, rawWalletAtom } from '../../atoms/global';

// The curated answers and the Q-App catalog stay out: every question here
// goes to the model.
vi.mock('../goldenMatch', () => ({
  lookupGoldenAnswer: () => ({ instant: null, hints: [] }),
  warmGoldenIndex: () => undefined,
}));
vi.mock('../qAppCatalog', () => ({
  matchQAppCatalog: () => null,
  formatQAppAnswer: () => '',
  openQAppInNewTab: () => undefined,
}));

import { QortinoAgentChat } from '../../components/Group/QortinoAgent/QortinoAgentChat';
import { resetQortinoModelSessionForTests } from '../modelSession';
import { askQortino, clearPendingQortinoQuestion } from '../pendingQuestion';
import { resetQortinoSettingsForTests } from '../settings';

type Reply = {
  resolve: (text: string) => void;
  reject: (message: string) => void;
};

/** The model process, as far as the chat can tell. */
function fakeModelProcess() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (name: string, payload: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  const replies: Reply[] = [];
  const bridge = {
    loadModel: vi.fn(
      async (): Promise<unknown> => ({ loaded: true, path: 'p' })
    ),
    warmup: vi.fn(async () => ({ ok: true })),
    unload: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
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
  /** The next load finishes only when the returned function is called. */
  const holdLoad = () => {
    let loaded!: () => void;
    bridge.loadModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          loaded = () => resolve({ loaded: true, path: 'p' });
        })
    );
    return () => loaded();
  };
  return { bridge, replies, holdLoad };
}

const MODEL = {
  id: 'model_a',
  label: 'Model A',
  path: '/m/a.gguf',
  contextTokens: 4096,
  isQortino: false,
};

describe('Questions asked next to Qortino on Home while the model loads', () => {
  let model: ReturnType<typeof fakeModelProcess>;

  beforeEach(() => {
    localStorage.clear();
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
    localStorage.clear();
  });

  const settle = (ms = 60) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  const renderChat = () =>
    render(
      <ThemeProvider theme={createTheme()}>
        <QortinoAgentChat
          model={MODEL}
          onClose={vi.fn()}
          onOpenSettings={vi.fn()}
          expanded={false}
          onToggleExpanded={vi.fn()}
        />
      </ThemeProvider>
    );

  const asked = () => JSON.stringify(model.bridge.complete.mock.calls);

  it('are both asked when the second comes while Qortino wakes up', async () => {
    const finishLoad = model.holdLoad();
    renderChat();
    // Asked on Home: it waits in Qortino's box while the model loads.
    act(() => askQortino('first question'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Message Qortino…')).toHaveValue(
        'first question'
      )
    );
    // A second question on Home before Qortino is awake.
    act(() => askQortino('second question'));
    await settle(50);

    await act(async () => {
      finishLoad();
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalled());
    await act(async () => {
      model.replies[0].resolve('first answer');
    });
    await settle(600);
    expect(asked()).toContain('first question');
    expect(asked()).toContain('second question');
  });

  it('asks the first question too when a second one comes before the model is loaded', async () => {
    const finishLoad = model.holdLoad();
    renderChat();
    await waitFor(() => expect(model.bridge.loadModel).toHaveBeenCalled());

    // Asked next to Qortino on Home, then another one while he wakes up.
    act(() => askQortino('first question'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Message Qortino…')).toHaveValue(
        'first question'
      )
    );
    act(() => askQortino('second question'));
    await settle();

    await act(async () => {
      finishLoad();
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await settle(500);
    if (model.replies[1]) {
      await act(async () => {
        model.replies[1].resolve('another answer');
      });
      await settle(200);
    }

    expect(asked()).toContain('first question');
    expect(asked()).toContain('second question');
  });
});
