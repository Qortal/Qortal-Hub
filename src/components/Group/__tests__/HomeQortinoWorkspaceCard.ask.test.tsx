import { createContext } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  balanceAtom,
  qortinoAgentOpenAtom,
  qortinoAgentParkedAtom,
  rawWalletAtom,
  txListAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { resetHomeDraftWarmupForTests } from '../../../qortinoAgent/homeDraftWarmup';
import { resetQortinoModelSessionForTests } from '../../../qortinoAgent/modelSession';
import {
  addFileModel,
  resetQortinoModelsForTests,
} from '../../../qortinoAgent/models';
import {
  clearPendingQortinoQuestion,
  getPendingQortinoQuestion,
} from '../../../qortinoAgent/pendingQuestion';
import { resetQortinoSettingsForTests } from '../../../qortinoAgent/settings';
import { HomeQortinoWorkspaceCard } from '../HomeQortinoWorkspaceCard';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
  extStates: {},
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { group: {} } },
  interpolation: { escapeValue: false },
});

// The desktop app's bridge to the model process (preload.ts).
const bridge = {
  loadModel: vi.fn(async () => ({ loaded: true, path: '/m/phi.gguf' })),
  warmup: vi.fn(async () => ({ ok: true })),
  unload: vi.fn(async () => undefined),
  on: () => () => undefined,
};

const store = getDefaultStore();

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

/** Home with Qortino AI ready: the signed-in account sees the ask box. */
const renderHome = async () => {
  window.qortinoLlm = bridge as unknown as typeof window.qortinoLlm;
  addFileModel({ path: '/m/phi.gguf', name: 'phi.gguf', size: 10 });
  localStorage.setItem('getting_started_status_QADDR', 'completed');
  store.set(rawWalletAtom, { address0: 'QADDR' });
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 10);
  store.set(txListAtom, []);
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve([]),
  }) as typeof fetch;
  window.sendMessage = vi.fn(async () => null) as typeof window.sendMessage;
  const view = render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <HomeQortinoWorkspaceCard />
      </I18nextProvider>
    </ThemeProvider>
  );
  await flush();
  await flush();
  return view;
};

/** Types a question next to Qortino and sends it with Enter. */
const askOnHome = async (question: string) => {
  const box = screen.getByRole('textbox', { name: /composer\.placeholder/ });
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: question } });
  await flush();
  fireEvent.keyDown(box, { key: 'Enter' });
};

describe('A question sent next to Qortino on Home', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
    resetHomeDraftWarmupForTests();
    resetQortinoSettingsForTests();
    clearPendingQortinoQuestion();
    store.set(qortinoAgentOpenAtom, false);
    store.set(qortinoAgentParkedAtom, false);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.qortinoLlm;
    clearPendingQortinoQuestion();
    resetQortinoModelsForTests();
    resetQortinoModelSessionForTests();
    store.set(qortinoAgentOpenAtom, false);
    store.set(rawWalletAtom, null);
    store.set(userInfoAtom, null);
    store.set(balanceAtom, null);
    store.set(txListAtom, []);
  });

  it('opens Qortino with it after his hop', async () => {
    await renderHome();
    await askOnHome('what is QDN?');
    expect(bridge.loadModel).toHaveBeenCalledTimes(1);
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(store.get(qortinoAgentOpenAtom)).toBe(true);
    expect(getPendingQortinoQuestion()).toBe('what is QDN?');
  });

  it('is still asked when Home is left right after sending', async () => {
    const view = await renderHome();
    await askOnHome('what is QDN?');
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(store.get(qortinoAgentOpenAtom)).toBe(true);
    expect(getPendingQortinoQuestion()).toBe('what is QDN?');
  });

  it('is not kept for the next account when the sender signs out first', async () => {
    const view = await renderHome();
    await askOnHome('what is QDN?');
    expect(bridge.loadModel).toHaveBeenCalledTimes(1);
    // Signing out: the account goes and Home with it.
    act(() => {
      store.set(rawWalletAtom, null);
      store.set(userInfoAtom, null);
      view.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
    expect(getPendingQortinoQuestion()).toBeNull();
    // The model loaded for it is let go as well.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(bridge.unload).toHaveBeenCalledTimes(1);
  });
});
