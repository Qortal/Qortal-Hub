import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../../i18n/i18n';
import { qortinoAgentOpenAtom } from '../../../../atoms/global';

const store = vi.hoisted(() => ({
  loadInstallState: vi.fn(async () => ({ installed: false })),
  saveInstallState: vi.fn(async () => undefined),
}));
const session = vi.hoisted(() => ({
  ensureQortinoModel: vi.fn(async () => {}),
  releaseQortinoModelAfterClose: vi.fn(),
}));

vi.mock('../../../../qortinoAgent/store', () => store);
vi.mock('../../../../qortinoAgent/modelSession', () => session);
vi.mock('../QortinoAgentGate', () => ({
  QortinoAgentGate: ({ onOpenModels }: { onOpenModels: () => void }) => (
    <button type="button" onClick={onOpenModels}>
      gate
    </button>
  ),
}));
vi.mock('../loadQortinoAgentChat', () => ({
  loadQortinoAgentChat: async () => ({
    QortinoAgentChat: ({ model }: { model: { label: string } }) => (
      <div>chat with {model.label}</div>
    ),
  }),
}));
vi.mock('../QortinoSettingsView', () => ({
  QortinoSettingsView: ({ onBack }: { onBack: () => void }) => (
    <button type="button" onClick={onBack}>
      settings view
    </button>
  ),
}));

import { QortinoAgentPanel } from '../QortinoAgentPanel';
import {
  askQortino,
  getPendingQortinoQuestion,
} from '../../../../qortinoAgent/pendingQuestion';
import {
  addFileModel,
  resetQortinoModelsForTests,
} from '../../../../qortinoAgent/models';

const renderPanel = () => {
  const jotai = createStore();
  jotai.set(qortinoAgentOpenAtom, true);
  render(
    <JotaiProvider store={jotai}>
      <ThemeProvider theme={createTheme()}>
        <QortinoAgentPanel />
      </ThemeProvider>
    </JotaiProvider>
  );
  return jotai;
};

describe("Qortino's panel", () => {
  beforeEach(() => {
    resetQortinoModelsForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetQortinoModelsForTests();
    localStorage.clear();
  });

  it('shows the download until a model is on this computer', async () => {
    renderPanel();
    expect(
      await screen.findByRole('button', { name: 'gate' })
    ).toBeInTheDocument();
    expect(session.ensureQortinoModel).not.toHaveBeenCalled();
  });

  it('opens the model list from the download', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'gate' }));
    expect(
      screen.getByRole('button', { name: 'settings view' })
    ).toBeInTheDocument();
  });

  it('chats with another model the user added, loading it right away', async () => {
    addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
    renderPanel();
    expect(await screen.findByText('chat with phi')).toBeInTheDocument();
    expect(session.ensureQortinoModel).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/m/phi.gguf' })
    );
  });

  it('closes with Escape, after its settings', async () => {
    const jotai = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const panel = screen.getByTestId('qortino-agent-panel');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(
      screen.queryByRole('button', { name: 'settings view' })
    ).not.toBeInTheDocument();
    expect(jotai.get(qortinoAgentOpenAtom)).toBe(true);
    await act(async () => {
      fireEvent.keyDown(panel, { key: 'Escape' });
    });
    expect(jotai.get(qortinoAgentOpenAtom)).toBe(false);
  });

  it('drops a question from Home nobody took when it is closed from elsewhere', async () => {
    const jotai = renderPanel();
    await screen.findByRole('button', { name: 'gate' });
    askQortino('what is QDN?');
    expect(getPendingQortinoQuestion()).toBe('what is QDN?');
    await act(async () => {
      jotai.set(qortinoAgentOpenAtom, false);
    });
    expect(getPendingQortinoQuestion()).toBeNull();
  });

  it('starts no model load when closed while its checks still run', async () => {
    addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
    let answer!: (state: { installed: boolean }) => void;
    store.loadInstallState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const jotai = renderPanel();
    await act(async () => {
      jotai.set(qortinoAgentOpenAtom, false);
    });
    await act(async () => {
      answer({ installed: false });
    });
    expect(session.ensureQortinoModel).not.toHaveBeenCalled();
  });

  it('lets go of a model it started loading when closed before the chat', async () => {
    addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
    const jotai = renderPanel();
    await screen.findByText('chat with phi');
    expect(session.ensureQortinoModel).toHaveBeenCalled();
    await act(async () => {
      jotai.set(qortinoAgentOpenAtom, false);
    });
    expect(session.releaseQortinoModelAfterClose).toHaveBeenCalled();
  });

  it('acts as closed when taken away while open (signing out)', async () => {
    addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
    let answer!: (state: { installed: boolean }) => void;
    store.loadInstallState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const jotai = createStore();
    jotai.set(qortinoAgentOpenAtom, true);
    const { unmount } = render(
      <JotaiProvider store={jotai}>
        <ThemeProvider theme={createTheme()}>
          <QortinoAgentPanel />
        </ThemeProvider>
      </JotaiProvider>
    );
    unmount();
    expect(session.releaseQortinoModelAfterClose).toHaveBeenCalled();
    await act(async () => {
      answer({ installed: false });
    });
    expect(session.ensureQortinoModel).not.toHaveBeenCalled();
  });

  it('widens and remembers it', async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make the panel wider' })
    );
    expect(
      screen.getByRole('button', { name: 'Make the panel narrower' })
    ).toBeInTheDocument();
    expect(localStorage.getItem('qortino:panel-wide:v1')).toBe('1');
  });
});
