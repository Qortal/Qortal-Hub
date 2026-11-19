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
import { clearPendingQortinoQuestion } from '../../../qortinoAgent/pendingQuestion';
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

describe("Qortino's saved chats", () => {
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

  /** Type a question and click Send. */
  const ask = async (question: string) => {
    fireEvent.change(composer(), { target: { value: question } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  };

  const openHistory = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    return screen.findByRole('dialog', { name: 'Chat history' });
  };

  describe('when the account signs out while an answer is written', () => {
    it('keeps the question and the part of its answer written', async () => {
      const { unmount } = renderChat();
      await ask('first question');
      await waitFor(() =>
        expect(model.bridge.complete).toHaveBeenCalledTimes(1)
      );
      await act(async () => {
        model.emit('token', { token: 'A partial answer', done: false });
      });
      await screen.findByText('A partial answer');
      // Signing out: the account goes first, then Hub takes Qortino away.
      act(() => {
        getDefaultStore().set(rawWalletAtom, null);
        unmount();
      });
      await settle();
      // The same account signs in again.
      getDefaultStore().set(rawWalletAtom, { address0: ACCOUNT });
      renderChat();
      await settle(100);
      const history = await openHistory();
      expect(
        within(history).queryByRole('button', { name: 'first question' })
      ).not.toBeNull();
    });

    it('shows the question again when the same account signs in', async () => {
      const first = renderChat();
      await ask('first question');
      await waitFor(() =>
        expect(model.bridge.complete).toHaveBeenCalledTimes(1)
      );
      // Signing out: the account goes, and Qortino with it.
      act(() => {
        getDefaultStore().set(rawWalletAtom, null);
        first.unmount();
      });
      await settle(100);
      // The same account signs in again.
      getDefaultStore().set(rawWalletAtom, { address0: ACCOUNT });
      renderChat();
      expect(await screen.findByText('first question')).toBeInTheDocument();
    });
  });

  describe('New chat on a chat that is still empty', () => {
    it("adds no second empty chat from the list's +", async () => {
      renderChat();
      await settle(100);
      for (let i = 0; i < 2; i += 1) {
        const history = await openHistory();
        // The first button named New chat is the + in the list's header.
        fireEvent.click(
          within(history).getAllByRole('button', { name: 'New chat' })[0]
        );
        await settle();
      }
      const history = await openHistory();
      // The + itself, and one empty chat.
      expect(
        within(history).getAllByRole('button', { name: 'New chat' })
      ).toHaveLength(2);
    });

    it('keeps one empty chat however often the list asks for a new one', async () => {
      renderChat();
      await waitFor(() => expect(composer()).toBeInTheDocument());
      await settle();
      for (let i = 0; i < 3; i += 1) {
        const history = await openHistory();
        // The list's own "+": the header's is off for an empty chat.
        fireEvent.click(
          within(history).getAllByRole('button', { name: 'New chat' })[0]
        );
        await settle();
      }
      const history = await openHistory();
      expect(
        within(history).getAllByRole('button', { name: 'Delete chat' })
      ).toHaveLength(1);
    });
  });
});
