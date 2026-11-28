import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The page Core reported last, as useQortalMessageListener keeps it.
const reported = vi.hoisted(() => ({ path: '' }));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../../hooks/useQortalMessageListener', () => ({
  useQortalMessageListener: () => ({
    path: reported.path,
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
import { forgetTabActivity, isTabBusy, noteTabFileSave } from '../tabActivity';
import { qappGuestUrlAllowed } from '../../../../electron/src/qapp-guest-policy';
import { executeEvent } from '../../../utils/events';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  reported.path = '';
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

describe("AppViewer keeps a page's own query and fragment", () => {
  const stubGuest = () => {
    const prepare = vi.fn().mockResolvedValue({
      partition: 'test-blog',
      preload: 'file:///test/qapp-guest-preload.js',
    });
    vi.stubGlobal('electronAPI', {
      qappGuestPrepare: prepare,
      qappGuestRelease: vi.fn().mockResolvedValue(true),
    });
    return prepare;
  };
  const owner = { name: 'Q-Blog', service: 'APP' };

  it("adds Hub's parameters after them when navigation falls back to loading the page", async () => {
    const prepare = stubGuest();
    const { container } = render(
      <AppViewer
        app={{ ...owner, identifier: 'beta', tabId: 'blog' }}
        isDevMode={false}
      />
    );
    const source = () =>
      container.querySelector('webview')?.getAttribute('src') ?? '';
    await waitFor(() => expect(source()).toContain('/render/APP/Q-Blog?'));

    // The guest never said hello, so in-page navigation fails at once.
    await act(async () => {
      executeEvent('navigateToPath-blog', { path: 'search?q=hello#top' });
    });
    await waitFor(() => expect(source()).toContain('/search?'));

    const url = new URL(source());
    expect(url.pathname).toBe('/render/APP/Q-Blog/search');
    expect(url.searchParams.get('q')).toBe('hello');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('identifier')).toBe('beta');
    expect(url.searchParams.get('isManualNavigation')).toBe('false');
    expect(url.hash).toBe('#top');
    expect(
      qappGuestUrlAllowed(
        prepare.mock.calls[0][1],
        source(),
        { ...owner, tabId: 'blog' },
        false
      )
    ).toBe(true);
  });

  it("puts Hub's parameters before a page's fragment when it first loads", async () => {
    stubGuest();
    const { container } = render(
      <AppViewer
        app={{ ...owner, path: 'page#top', tabId: 'blog' }}
        isDevMode={false}
      />
    );
    const source = () =>
      container.querySelector('webview')?.getAttribute('src') ?? '';
    await waitFor(() => expect(source()).toContain('/render/APP/Q-Blog/page'));

    const url = new URL(source());
    expect(url.pathname).toBe('/render/APP/Q-Blog/page');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.hash).toBe('#top');
  });

  // Core reports a page as its path and fragment, so a hash router's route
  // and query are in the fragment.
  it.each([
    {
      page: '/#/search?q=a',
      pathname: '/render/APP/Q-Blog/',
      hash: '#/search?q=a',
    },
    {
      page: '/page#top',
      pathname: '/render/APP/Q-Blog/page',
      hash: '#top',
    },
  ])(
    "puts Hub's parameters before the fragment of $page when the tab is refreshed",
    async ({ page, pathname, hash }) => {
      const prepare = stubGuest();
      reported.path = page;
      const { container } = render(
        <AppViewer
          app={{ ...owner, identifier: 'beta', tabId: 'blog' }}
          isDevMode={false}
        />
      );
      const source = () =>
        container.querySelector('webview')?.getAttribute('src') ?? '';
      await waitFor(() => expect(source()).toContain('/render/APP/Q-Blog?'));

      act(() => executeEvent('refreshApp', { tabId: 'blog' }));
      await waitFor(() => expect(source()).toContain('time='));

      const url = new URL(source());
      expect(url.pathname).toBe(pathname);
      expect(url.searchParams.get('theme')).toBe('dark');
      expect(url.searchParams.get('lang')).toBe('en');
      expect(url.searchParams.get('identifier')).toBe('beta');
      expect(url.searchParams.get('time')).toMatch(/^\d+$/);
      expect(url.hash).toBe(hash);
      expect(
        qappGuestUrlAllowed(
          prepare.mock.calls[0][1],
          source(),
          { ...owner, tabId: 'blog' },
          false
        )
      ).toBe(true);
    }
  );
});

// A file being saved keeps its tab awake (tabSleep.ts). Hub's main process
// ends a tab's saves with its page, so they stop counting then too.
describe("AppViewer ends a tab's saves with its page", () => {
  const renderGuest = async () => {
    vi.stubGlobal('electronAPI', {
      qappGuestPrepare: vi.fn().mockResolvedValue({
        partition: 'test-saves',
        preload: 'file:///test/qapp-guest-preload.js',
      }),
      qappGuestRelease: vi.fn().mockResolvedValue(true),
    });
    const view = render(
      <AppViewer
        app={{ tabId: 'saver', name: 'Example', service: 'APP' }}
        isDevMode={false}
      />
    );
    await waitFor(() =>
      expect(view.container.querySelector('webview')).not.toBeNull()
    );
    const webview = view.container.querySelector('webview')!;
    const fire = (type: string) =>
      act(() => {
        webview.dispatchEvent(new Event(type));
      });
    noteTabFileSave('saver', 'save-1', 'open');
    expect(isTabBusy('saver')).toBe(true);
    return { fire, view };
  };

  afterEach(() => forgetTabActivity('saver'));

  it('when a new page loads in it', async () => {
    const { fire } = await renderGuest();
    fire('did-navigate');
    expect(isTabBusy('saver')).toBe(false);
  });

  it('when its app is unloaded', async () => {
    const { view } = await renderGuest();
    view.unmount();
    expect(isTabBusy('saver')).toBe(false);
  });

  it('when its app stops working', async () => {
    const { fire } = await renderGuest();
    fire('render-process-gone');
    expect(isTabBusy('saver')).toBe(false);
  });
});
