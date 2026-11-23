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
  writeQortinoQuestion,
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
    for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
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
  return { bridge, replies, emit };
}

const MODEL = {
  id: 'model_a',
  label: 'Model A',
  path: '/m/a.gguf',
  contextTokens: 4096,
  isQortino: false,
};

const ACCOUNT = 'QTESTACCOUNT';

describe('Questions asked next to Qortino on Home', () => {
  let model: ReturnType<typeof fakeModelProcess>;

  beforeEach(() => {
    localStorage.clear();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
    clearPendingQortinoQuestion();
    getDefaultStore().set(rawWalletAtom, { address0: ACCOUNT });
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

  const composer = () =>
    screen.getByPlaceholderText('Message Qortino…') as HTMLTextAreaElement;

  const settle = (ms = 60) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  /** The model takes its time to load (a big file, a slow disk). */
  const slowLoad = () => {
    let loaded!: (value: unknown) => void;
    model.bridge.loadModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          loaded = resolve;
        })
    );
    return () => loaded({ loaded: true, path: MODEL.path });
  };

  /** What the user asked in each reply the model was asked for. */
  const askedQuestions = () =>
    model.bridge.complete.mock.calls.map((call) => {
      const turns = (
        (call as unknown[])[0] as { messages: { content: string }[] }
      ).messages;
      return turns[turns.length - 1]?.content ?? '';
    });

  it('keeps a question from Home as the user edited it while the model loaded', async () => {
    const finishLoad = slowLoad();
    renderChat();
    act(() => askQortino('what is QDN'));
    await waitFor(() => expect(composer().value).toBe('what is QDN'));
    // The question waits in the box: the user adds to it.
    const edited = 'what is QDN and how big can one file be';
    fireEvent.change(composer(), { target: { value: edited } });
    await act(async () => {
      finishLoad();
    });
    await settle(200);
    const sent = askedQuestions().some((q) => q.includes(edited));
    const stillInBox = composer().value === edited;
    expect(sent || stillInBox).toBe(true);
  });

  it('asks both questions sent from Home while the model loaded', async () => {
    const finishLoad = slowLoad();
    renderChat();
    act(() => askQortino('first question from home'));
    await waitFor(() =>
      expect(composer().value).toBe('first question from home')
    );
    act(() => askQortino('second question from home'));
    await settle();
    await act(async () => {
      finishLoad();
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalled());
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await settle(500);
    if (model.replies[1]) {
      await act(async () => {
        model.replies[1].resolve('another answer');
      });
    }
    await settle(500);
    const asked = askedQuestions();
    expect(asked.some((q) => q.includes('first question from home'))).toBe(
      true
    );
    expect(asked.some((q) => q.includes('second question from home'))).toBe(
      true
    );
  });

  it('asks both questions from Home when the first came before the chat opened', async () => {
    const finishLoad = slowLoad();
    act(() => askQortino('first question'));
    renderChat();
    await waitFor(() => expect(composer().value).toBe('first question'));
    // Another question typed next to Qortino on Home, still loading.
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
    }
    expect(askedQuestions()).toEqual(
      expect.arrayContaining(['first question', 'second question'])
    );
  });

  it('keeps the first question from Home as edited while a second one waits', async () => {
    const finishLoad = slowLoad();
    renderChat();
    act(() => askQortino('first question'));
    await waitFor(() => expect(composer().value).toBe('first question'));
    act(() => askQortino('second question'));
    await settle();
    // The user edits the first question while the model loads.
    fireEvent.change(composer(), {
      target: { value: 'first question, edited' },
    });
    await settle();
    expect(composer().value).toBe('first question, edited');
    fireEvent.change(composer(), {
      target: { value: 'first question, edited again' },
    });
    await settle();
    expect(composer().value).toBe('first question, edited again');
    await act(async () => {
      finishLoad();
    });
    await settle(100);
    // The edited question is the user's to send; the second one waits.
    expect(composer().value).toBe('first question, edited again');
    expect(model.bridge.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(2));
    await act(async () => {
      model.replies[1].resolve('another answer');
    });
    await settle(100);
    expect(askedQuestions()).toEqual([
      'first question, edited again',
      'second question',
    ]);
    expect(composer().value).toBe('');
  });

  it("leaves a question written from an app's menu in the box, for the user to send", async () => {
    renderChat();
    await settle(100);
    const draft = 'a long question I am still writing';
    fireEvent.change(composer(), { target: { value: draft } });
    act(() => writeQortinoQuestion('What does “minting” mean?'));
    await waitFor(() =>
      expect(composer().value).toBe('What does “minting” mean?')
    );
    // The model is ready, and still nothing is asked until the user sends.
    await settle(200);
    expect(model.bridge.complete).not.toHaveBeenCalled();
    fireEvent.change(composer(), {
      target: { value: 'What does “minting” mean on Qortal?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    expect(askedQuestions()).toEqual(['What does “minting” mean on Qortal?']);
    // What the user was typing before comes back.
    expect(composer().value).toBe(draft);
  });

  it('shows the newest question asked from the menu while Qortino stays open', async () => {
    renderChat();
    await settle(100);
    const draft = 'a long question I am still writing';
    fireEvent.change(composer(), { target: { value: draft } });
    act(() => writeQortinoQuestion('What does “minting” mean?'));
    await waitFor(() =>
      expect(composer().value).toBe('What does “minting” mean?')
    );
    // Not sent: the user selects another word in the app and asks again.
    act(() => writeQortinoQuestion('What does “QDN” mean?'));
    await waitFor(() => expect(composer().value).toBe('What does “QDN” mean?'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    expect(askedQuestions()).toEqual(['What does “QDN” mean?']);
    // What the user was typing before the first question comes back.
    expect(composer().value).toBe(draft);
  });

  it('keeps a question from the menu the user changed when the menu asks another', async () => {
    renderChat();
    await settle(100);
    act(() => writeQortinoQuestion('What does “sponsee” mean?'));
    await waitFor(() =>
      expect(composer().value).toBe('What does “sponsee” mean?')
    );
    fireEvent.change(composer(), {
      target: { value: 'What does “sponsee” mean exactly?' },
    });
    act(() => writeQortinoQuestion('What does “QDN” mean?'));
    await settle(200);
    expect(composer().value).toBe('What does “sponsee” mean exactly?');
    // Once the changed one is sent and answered, the next one comes in.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await waitFor(() => expect(composer().value).toBe('What does “QDN” mean?'));
    expect(askedQuestions()).toEqual(['What does “sponsee” mean exactly?']);
  });

  it('brings back what the user was typing after an edited question from Home is sent', async () => {
    const finishLoad = slowLoad();
    renderChat();
    await settle(100);
    const draft = 'a long question I am still writing';
    fireEvent.change(composer(), { target: { value: draft } });
    act(() => askQortino('a quick question from home'));
    await waitFor(() =>
      expect(composer().value).toBe('a quick question from home')
    );
    fireEvent.change(composer(), {
      target: { value: 'a quick question from home, edited' },
    });
    await act(async () => {
      finishLoad();
    });
    await settle(100);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    expect(askedQuestions()).toEqual(['a quick question from home, edited']);
    expect(composer().value).toBe(draft);
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await settle(100);
    expect(composer().value).toBe(draft);
  });

  it('takes the next question from Home after an edited one is erased', async () => {
    const finishLoad = slowLoad();
    renderChat();
    act(() => askQortino('first question'));
    await waitFor(() => expect(composer().value).toBe('first question'));
    // The user edits the question, then erases it without sending.
    fireEvent.change(composer(), {
      target: { value: 'first question, edited' },
    });
    await settle();
    fireEvent.change(composer(), { target: { value: '' } });
    await settle();
    act(() => askQortino('second question'));
    await waitFor(() => expect(composer().value).toBe('second question'));
    await act(async () => {
      finishLoad();
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    expect(askedQuestions()).toEqual(['second question']);
  });

  it('brings back what the user was typing when an edited question from Home is erased', async () => {
    const finishLoad = slowLoad();
    renderChat();
    await settle(100);
    const draft = 'a long question I am still writing';
    fireEvent.change(composer(), { target: { value: draft } });
    act(() => askQortino('a quick question from home'));
    await waitFor(() =>
      expect(composer().value).toBe('a quick question from home')
    );
    fireEvent.change(composer(), {
      target: { value: 'a quick question from home, edited' },
    });
    await settle();
    fireEvent.change(composer(), { target: { value: '' } });
    await settle();
    expect(composer().value).toBe(draft);
    act(() => askQortino('another question from home'));
    await waitFor(() =>
      expect(composer().value).toBe('another question from home')
    );
    await act(async () => {
      finishLoad();
    });
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    expect(askedQuestions()).toEqual(['another question from home']);
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await settle(100);
    expect(composer().value).toBe(draft);
  });

  it('keeps what the user was typing when a question comes from Home', async () => {
    renderChat();
    await waitFor(() => expect(model.bridge.loadModel).toHaveBeenCalled());
    await settle(100);
    const draft = 'a long question I am still writing';
    fireEvent.change(composer(), { target: { value: draft } });
    act(() => askQortino('a quick question from home'));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
    await act(async () => {
      model.replies[0].resolve('an answer');
    });
    await settle(100);
    expect(composer().value).toBe(draft);
  });
});
