import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../../hooks/useQortalMessageListener', () => ({
  useQortalMessageListener: () => ({
    path: '',
    history: {},
    resetHistory: vi.fn(),
  }),
}));
vi.mock('../../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

import { AppViewer } from '../AppViewer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppViewer guest recovery', () => {
  it('reattaches the source and handshake listener when Retry remounts a failed guest', async () => {
    const prepare = vi.fn().mockResolvedValue({
      partition: 'test-qmail',
      preload: 'file:///test/qapp-guest-preload.js',
    });
    vi.stubGlobal('electronAPI', {
      qappGuestPrepare: prepare,
      qappGuestRelease: vi.fn().mockResolvedValue(true),
    });
    const { container } = render(
      <AppViewer
        app={{ tabId: 'mail', name: 'Q-Mail', service: 'APP' }}
        isDevMode={false}
      />
    );
    await waitFor(() =>
      expect(container.querySelector('webview')?.getAttribute('src')).toContain(
        '/render/APP/Q-Mail'
      )
    );
    const original = container.querySelector('webview')!;
    act(() =>
      original.dispatchEvent(
        Object.assign(new Event('ipc-message'), { channel: 'qapp:error' })
      )
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'core:retry' }));
    const replacement = container.querySelector('webview')!;
    expect(replacement).not.toBe(original);
    expect(replacement.getAttribute('src')).toBe(original.getAttribute('src'));
    const send = vi.fn();
    Object.assign(replacement, { send });
    act(() =>
      replacement.dispatchEvent(
        Object.assign(new Event('ipc-message'), {
          channel: 'qapp:hello',
          args: [{ documentId: 'a'.repeat(32) }],
        })
      )
    );
    expect(send).toHaveBeenCalledWith('qapp:ready', 'a'.repeat(32));
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
