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

// The curated answers and the Q-App catalog stay out: every question here
// goes to the model.
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
import { resetQortinoModelSessionForTests } from '../../../qortinoAgent/modelSession';
import {
  askQortino,
  clearPendingQortinoQuestion,
} from '../../../qortinoAgent/pendingQuestion';
import { resetQortinoSettingsForTests } from '../../../qortinoAgent/settings';

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
  return { bridge, replies };
}

const MODEL = {
  id: 'model_a',
  label: 'Model A',
  path: '/m/a.gguf',
  contextTokens: 4096,
  isQortino: false,
};

describe("Qortino's chat", () => {
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

  const composer = () => screen.getByPlaceholderText('Message Qortino…');

  /** Type a question and click Send. */
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

  /** Stop the reply, as a click of its own (not the end of a double click on Send). */
  const stopReply = async () => {
    await settle(450);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settle();
  };

  const openHistory = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    return screen.findByRole('dialog', { name: 'Chat history' });
  };

  it('keeps a chat whose answer just ended when a question from Home opens a new one', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    // Asked next to Qortino on Home while the first answer is being written.
    act(() => askQortino('second question'));
    await act(async () => {
      model.replies[0].resolve('first answer');
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(2));
    await act(async () => {
      model.replies[1].resolve('second answer');
    });
    await screen.findByText('second answer');

    const history = await openHistory();
    fireEvent.click(
      within(history).getByRole('button', { name: 'first question' })
    );
    expect(await screen.findByText('first answer')).toBeInTheDocument();
  });

  it('keeps a chat left for a new one right after its answer', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.replies[0].resolve('first answer');
    });
    await screen.findByText('first answer');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await settle(500);

    const history = await openHistory();
    fireEvent.click(
      within(history).getByRole('button', { name: 'first question' })
    );
    expect(await screen.findByText('first answer')).toBeInTheDocument();
  });

  it('does not start a reply stopped while the one before it winds down', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    // Stop: the first reply takes a moment to wind down.
    await stopReply();
    await ask('second question');
    await screen.findByRole('button', { name: 'Stop' });
    // Stop again, before the second reply could start.
    await stopReply();
    await act(async () => {
      model.replies[0].reject('cancelled');
    });
    await settle(200);
    expect(model.bridge.complete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('does not start a reply stopped while the model loads again', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    let loaded!: (value: unknown) => void;
    model.bridge.loadModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          loaded = resolve;
        })
    );
    // The model process went away: the chat loads the model again.
    await act(async () => {
      model.replies[0].reject('Model is not loaded');
    });
    await waitFor(() =>
      expect(model.bridge.loadModel).toHaveBeenCalledTimes(2)
    );
    await stopReply();
    await act(async () => {
      loaded({ loaded: true, path: 'p' });
    });
    await settle(200);
    expect(model.bridge.complete).toHaveBeenCalledTimes(1);
  });

  it('loads no model again for a reply whose chat was closed', async () => {
    const { unmount } = renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    unmount();
    // The model process went away as the panel closed.
    await act(async () => {
      model.replies[0].reject('Model is not loaded');
    });
    await settle(200);
    expect(model.bridge.loadModel).toHaveBeenCalledTimes(1);
    expect(model.bridge.complete).toHaveBeenCalledTimes(1);
  });

  it('does not stop a reply on the second click of a double click on Send', async () => {
    renderChat();
    fireEvent.change(composer(), { target: { value: 'first question' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    // The button under the pointer is Stop by now.
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settle();
    expect(model.bridge.cancel).not.toHaveBeenCalled();
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.replies[0].resolve('first answer');
    });
    expect(await screen.findByText('first answer')).toBeInTheDocument();
  });

  it('stops a reply on a click of its own', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await stopReply();
    expect(model.bridge.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it("stops a reply after the computer's clock was set back", async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    // The clock is set back an hour while the answer is written.
    const wallClock = Date.now;
    const setBack = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => wallClock() - 3_600_000);
    try {
      await stopReply();
      expect(model.bridge.cancel).toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    } finally {
      setBack.mockRestore();
    }
  });

  it('answers a question asked right after a Stop', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await stopReply();
    await ask('second question');
    // The stopped reply winds down; the new one starts after it.
    await act(async () => {
      model.replies[0].reject('cancelled');
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(2));
    await act(async () => {
      model.replies[1].resolve('second answer');
    });
    expect(await screen.findByText('second answer')).toBeInTheDocument();
  });

  it('stops the reply of a chat deleted while it is being written', async () => {
    renderChat();
    await ask('first question');
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    const history = await openHistory();
    fireEvent.click(
      within(history).getByRole('button', { name: 'Delete chat' })
    );
    await settle();
    expect(model.bridge.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
