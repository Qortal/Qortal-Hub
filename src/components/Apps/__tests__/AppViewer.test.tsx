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
import { qappGuestUrlAllowed } from '../../../../electron/src/qapp-guest-policy';
import { executeEvent } from '../../../utils/events';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppViewer guest recovery', () => {
  it.each(['Q-Mail+', 'Q-Shop+', 'Qortal World'])(
    'prepares, refreshes and navigates %s with Core-compatible URLs',
    async (name) => {
      const prepare = vi.fn().mockImplementation((owner, url) => {
        if (!qappGuestUrlAllowed(url, url, owner, false)) {
          return Promise.reject(new Error('QAPP_INVALID_URL'));
        }
        return Promise.resolve({
          partition: 'test-compatible-url',
          preload: 'file:///test/qapp-guest-preload.js',
        });
      });
      vi.stubGlobal('electronAPI', {
        qappGuestPrepare: prepare,
        qappGuestRelease: vi.fn().mockResolvedValue(true),
      });
      const { container } = render(
        <AppViewer
          app={{ tabId: 'mail', name, service: 'APP' }}
          isDevMode={false}
        />
      );
      const root = `http://localhost:12391/render/APP/${name.replace(/ /g, '%20')}`;
      const source = () =>
        container.querySelector('webview')?.getAttribute('src');
      await waitFor(() => expect(source()).toContain(`${root}?`));
      act(() => executeEvent('refreshApp', { tabId: 'mail' }));
      await waitFor(() => expect(source()).toContain(`${root}?`));
      await act(async () => {
        executeEvent('navigateToPath-mail', { path: 'inbox' });
      });
      await waitFor(() => expect(source()).toContain(`${root}/inbox?`));
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(
        qappGuestUrlAllowed(
          prepare.mock.calls[0][1],
          source()!,
          prepare.mock.calls[0][0],
          false
        )
      ).toBe(true);
    }
  );

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
