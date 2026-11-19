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
import '../../i18n/i18n';
import {
  qortinoAgentOpenAtom,
  rawWalletAtom,
  userInfoAtom,
} from '../../atoms/global';

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
import { loadChatSessions } from '../chatHistoryStore';
import { resetQortinoModelSessionForTests } from '../modelSession';
import { clearPendingQortinoQuestion } from '../pendingQuestion';
import { resetQortinoSettingsForTests } from '../settings';

const ACCOUNT = 'QTESTACCOUNT';
const store = getDefaultStore();

/** The model process, as far as the chat can tell: replies never finish. */
function fakeModelProcess() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const bridge = {
    loadModel: vi.fn(
      async (): Promise<unknown> => ({ loaded: true, path: 'p' })
    ),
    warmup: vi.fn(async () => ({ ok: true })),
    unload: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    complete: vi.fn(() => new Promise(() => undefined)),
    on: (name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
  return { bridge };
}

const MODEL = {
  id: 'model_a',
  label: 'Model A',
  path: '/m/a.gguf',
  contextTokens: 4096,
  isQortino: false,
};

describe("Qortino's saved chats while an answer is being written", () => {
  let model: ReturnType<typeof fakeModelProcess>;

  beforeEach(() => {
    localStorage.clear();
    resetQortinoModelSessionForTests();
    resetQortinoSettingsForTests();
    clearPendingQortinoQuestion();
    store.set(rawWalletAtom, { address0: ACCOUNT });
    model = fakeModelProcess();
    window.qortinoLlm = model.bridge as unknown as typeof window.qortinoLlm;
  });

  afterEach(() => {
    delete window.qortinoLlm;
    store.set(rawWalletAtom, null);
    store.set(userInfoAtom, null);
    store.set(qortinoAgentOpenAtom, false);
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

  /** Type a question and click Send. */
  const ask = async (question: string) => {
    fireEvent.change(screen.getByPlaceholderText('Message Qortino…'), {
      target: { value: question },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(model.bridge.complete).toHaveBeenCalledTimes(1));
  };

  const savedMessages = async () =>
    (await loadChatSessions()).flatMap((session) => session.messages);

  const savedQuestions = async () =>
    (await savedMessages())
      .filter((message) => message.role === 'user')
      .map((message) => message.content);

  it('keep a question whose answer was being written when the account signed out', async () => {
    const view = renderChat();
    await ask('how do I purify water?');

    // Signing out: the account goes, and Qortino's panel with it.
    act(() => {
      store.set(rawWalletAtom, null);
      store.set(userInfoAtom, null);
      view.unmount();
    });

    // The same account signs in again.
    store.set(rawWalletAtom, { address0: ACCOUNT });
    expect((await savedMessages()).map((m) => m.content)).toContain(
      'how do I purify water?'
    );
  });

  it('keep a question asked just before signing out', async () => {
    const { unmount } = renderChat();
    await ask('how do I purify water?');

    // Signing out while the answer is written: Hub clears the account
    // (App's resetAllStates), then the panel goes with the session.
    act(() => {
      store.set(rawWalletAtom, null);
      store.set(userInfoAtom, null);
      unmount();
    });

    // The same account signs in again and opens its chats.
    store.set(rawWalletAtom, { address0: ACCOUNT });
    expect(await savedQuestions()).toContain('how do I purify water?');
  });

  it('keep a question asked just before Hub is closed', async () => {
    renderChat();
    await ask('how do I purify water?');

    // Hub's window closes while the answer is written: the page goes away
    // without React unmounting anything.
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(await savedQuestions()).toContain('how do I purify water?');
  });
});
