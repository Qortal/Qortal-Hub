import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://localhost:12391';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));
vi.mock('../../../i18n/i18n', () => ({
  default: { t: (key: string) => key },
}));
vi.mock('../../../qortal/get', () => ({
  saveFile: vi.fn(),
  authorizeRnsDestination: vi.fn(),
}));
vi.mock('../../../qortal/qortal-requests', () => ({
  hasSessionPermission: vi.fn(() => false),
}));

// The guest bridge: each guest document's request listener, as the real
// bridge hands it the guest's requests.
const bridges = vi.hoisted(
  () =>
    [] as Array<{
      documentId: string;
      listener: (event: {
        data: any;
        ports: { postMessage: (result: any) => void }[];
      }) => Promise<void>;
    }>
);
vi.mock('../../../qortal/qapp-guest-request-bridge', () => ({
  attachQAppRequestBridge: (_view, documentId, listener) => {
    bridges.push({ documentId, listener });
    return () => undefined;
  },
}));

import { AppViewer } from '../AppViewer';
import { qappGuestUrlAllowed } from '../../../../electron/src/qapp-guest-policy';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../../utils/events';
import { createWidgetRequestHandler } from '../../HomeWidgets/widgetRequests';

let prepare: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let openedTabs: any[];
const onAddTab = (event: CustomEvent) => openedTabs.push(event.detail?.data);

// What AppsDesktop's addTab listener makes of an addTab event.
const asTab = (data: any, tabId: string) => ({ ...data, tabId });

const documentIdFor = (tabId: string) =>
  tabId
    .padEnd(32, '0')
    .replace(/[^a-f0-9]/g, 'a')
    .slice(0, 32);

// Renders a tab and lets its guest say hello, as Electron does once the
// guest's page has loaded; returns that guest's request listener.
const openTab = async (app: any) => {
  const { container } = render(<AppViewer app={app} isDevMode={false} />);
  await waitFor(() =>
    expect(container.querySelector('webview')).not.toBeNull()
  );
  const view = container.querySelector('webview')!;
  Object.assign(view, { send: vi.fn() });
  const documentId = documentIdFor(app.tabId);
  act(() =>
    view.dispatchEvent(
      Object.assign(new Event('ipc-message'), {
        channel: 'qapp:hello',
        args: [{ documentId }],
      })
    )
  );
  await waitFor(() =>
    expect(bridges.some((bridge) => bridge.documentId === documentId)).toBe(
      true
    )
  );
  return bridges
    .filter((bridge) => bridge.documentId === documentId)
    .slice(-1)[0].listener;
};

const ask = (listener, data) =>
  new Promise((resolve) =>
    listener({
      data: { requestedHandler: 'UI', ...data },
      ports: [{ postMessage: resolve }],
    })
  );

// A request from the opened tab, and the app info Hub sends with it.
const appInfoOfRequestFrom = async (listener) => {
  sendMessage.mockClear();
  await ask(listener, {
    action: 'GET_USER_ACCOUNT',
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  return sendMessage.mock.calls[0][4];
};

// The URL Hub asked Electron to load in the tab `tabId`.
const preparedUrlFor = (tabId: string) =>
  prepare.mock.calls.find(([owner]) => owner.tabId === tabId)?.[1];

const preparedUrls = () => prepare.mock.calls.map(([, url]) => url);

// The named app's root page, from the node.
const APP_ROOT = `${NODE}/render/APP/Opened-App?theme=dark&lang=en&identifier=`;

// An address sent in a SET_TAB payload's url field.
const OTHER_PAGE = 'https://elsewhere.example/render/hash/abc';

describe('a tab opened by SET_TAB', () => {
  beforeEach(() => {
    bridges.length = 0;
    openedTabs = [];
    prepare = vi.fn().mockImplementation((owner, url) =>
      qappGuestUrlAllowed(url, url, owner, false)
        ? Promise.resolve({
            partition: `persist:test-${owner.tabId}`,
            preload: 'file:///test/qapp-guest-preload.js',
          })
        : Promise.reject(new Error('QAPP_INVALID_URL'))
    );
    vi.stubGlobal('electronAPI', {
      qappGuestPrepare: prepare,
      qappGuestRelease: vi.fn().mockResolvedValue(true),
    });
    sendMessage = vi.fn().mockResolvedValue({ ok: true });
    (window as any).sendMessage = sendMessage;
    subscribeToEvent('addTab', onAddTab);
  });

  afterEach(() => {
    unsubscribeFromEvent('addTab', onAddTab);
    cleanup();
    vi.unstubAllGlobals();
  });

  it('from a Q-App loads the named app from the node and ignores other fields', async () => {
    // 1. The user opens some Q-App.
    const someApp = await openTab({
      tabId: 'some-app',
      name: 'Some App',
      service: 'APP',
    });

    // 2. That app sends SET_TAB with fields besides the resource.
    const answer = await ask(someApp, {
      action: 'SET_TAB',
      payload: {
        name: 'Opened-App',
        service: 'APP',
        isPreview: true,
        url: OTHER_PAGE,
      },
    });

    // The tab is built from the resource alone.
    expect(answer).toEqual({ result: true, error: null });
    expect(openedTabs).toEqual([{ service: 'APP', name: 'Opened-App' }]);
    expect(openedTabs[0]).not.toHaveProperty('url');
    expect(openedTabs[0]).not.toHaveProperty('isPreview');

    // 3. The new tab loads the named app from the node, and its requests
    // carry that tab's app.
    const opened = await openTab(asTab(openedTabs[0], 'opened'));
    expect(preparedUrlFor('opened')).toBe(APP_ROOT);
    expect(
      preparedUrls().filter((url) => url.includes('elsewhere.example'))
    ).toEqual([]);
    expect(await appInfoOfRequestFrom(opened)).toEqual({
      name: 'Opened-App',
      service: 'APP',
      tabId: 'opened',
    });
  });

  it('from a Home widget loads the named app from the node and ignores other fields', async () => {
    // 1. A widget on Home sends SET_TAB with fields besides the resource.
    const widget = createWidgetRequestHandler({
      owner: { tabId: 'widget:Some App', name: 'Some App', service: 'APP' },
      isOnScreen: () => true,
      answerOwn: () => null,
      sendMessage,
    });
    const answer = await new Promise((resolve) =>
      widget({
        data: {
          requestedHandler: 'UI',
          action: 'SET_TAB',
          payload: {
            name: 'Opened-App',
            service: 'APP',
            isPreview: true,
            url: OTHER_PAGE,
          },
        },
        ports: [{ postMessage: resolve }],
      })
    );

    expect(answer).toEqual({ result: true, error: null });
    expect(openedTabs).toEqual([{ service: 'APP', name: 'Opened-App' }]);
    expect(openedTabs[0]).not.toHaveProperty('url');
    expect(openedTabs[0]).not.toHaveProperty('isPreview');

    // 2. The new tab loads the named app from the node, and its requests
    // carry that tab's app.
    const opened = await openTab(asTab(openedTabs[0], 'opened'));
    expect(preparedUrlFor('opened')).toBe(APP_ROOT);
    expect(
      preparedUrls().filter((url) => url.includes('elsewhere.example'))
    ).toEqual([]);
    expect(await appInfoOfRequestFrom(opened)).toEqual({
      name: 'Opened-App',
      service: 'APP',
      tabId: 'opened',
    });
  });

  it('with “..” segments in the path loads the app’s root page', async () => {
    // 1. The user opens some Q-App.
    const someApp = await openTab({
      tabId: 'some-app',
      name: 'Some App',
      service: 'APP',
    });

    // 2. That app sends SET_TAB with “..” segments in the path.
    const answer = await ask(someApp, {
      action: 'SET_TAB',
      payload: {
        name: 'Opened-App',
        service: 'APP',
        path: '../../hash/AnotherPage?q=1',
      },
    });
    expect(answer).toEqual({ result: true, error: null });
    expect(openedTabs).toEqual([
      {
        service: 'APP',
        name: 'Opened-App',
        path: '../../hash/AnotherPage?q=1',
      },
    ]);

    // 3. The tab loads the app's root page, and its requests carry that
    // tab's app.
    const opened = await openTab(asTab(openedTabs[0], 'opened'));
    expect(preparedUrlFor('opened')).toBe(APP_ROOT);
    expect(preparedUrls().filter((url) => url.includes('AnotherPage'))).toEqual(
      []
    );
    expect(await appInfoOfRequestFrom(opened)).toEqual({
      name: 'Opened-App',
      service: 'APP',
      tabId: 'opened',
    });
  });

  it('still opens a SET_TAB tab at the identifier and path it asks for', async () => {
    const someApp = await openTab({
      tabId: 'some-app',
      name: 'Some App',
      service: 'APP',
    });

    const answer = await ask(someApp, {
      action: 'SET_TAB',
      payload: {
        service: 'APP',
        name: 'Opened-App',
        identifier: 'main',
        path: 'send/v1.2/index.html?coin=QORT',
      },
    });
    expect(answer).toEqual({ result: true, error: null });
    expect(openedTabs).toEqual([
      {
        service: 'APP',
        name: 'Opened-App',
        identifier: 'main',
        path: 'send/v1.2/index.html?coin=QORT',
      },
    ]);

    const opened = await openTab(asTab(openedTabs[0], 'opened'));
    expect(preparedUrlFor('opened')).toBe(
      `${NODE}/render/APP/Opened-App/send/v1.2/index.html?coin=QORT&theme=dark&lang=en&identifier=main`
    );
    expect(await appInfoOfRequestFrom(opened)).toEqual({
      name: 'Opened-App',
      service: 'APP',
      tabId: 'opened',
    });
  });

  it('opens nothing for a SET_TAB without a service, and says so', async () => {
    const someApp = await openTab({
      tabId: 'some-app',
      name: 'Some App',
      service: 'APP',
    });

    const answer = await ask(someApp, {
      action: 'SET_TAB',
      payload: { name: 'Opened-App', url: OTHER_PAGE },
    });

    expect(openedTabs).toEqual([]);
    expect(answer).toEqual({
      result: null,
      error: expect.objectContaining({ message: expect.any(String) }),
    });
  });

  it.each([
    ['APP', '..'],
    ['APP', '.'],
    ['..', 'Opened-App'],
    ['.', '.'],
    ['APP', ''],
    ['', 'Opened-App'],
    ['APP', 'Opened-App/..'],
    ['APP', 'Opened-App\\..'],
    ['APP', 'Opened-App\t'],
    ['APP/..', 'Opened-App'],
  ])(
    'opens nothing for a SET_TAB with service %j and name %j, and says so',
    async (service, name) => {
      const someApp = await openTab({
        tabId: 'some-app',
        name: 'Some App',
        service: 'APP',
      });

      const answer = await ask(someApp, {
        action: 'SET_TAB',
        payload: { service, name, path: 'hash/AnotherPage?q=1' },
      });

      expect(openedTabs).toEqual([]);
      expect(answer).toEqual({
        result: null,
        error: expect.objectContaining({ message: expect.any(String) }),
      });
    }
  );
});

describe('a tab path', () => {
  beforeEach(() => {
    bridges.length = 0;
    prepare = vi.fn().mockResolvedValue({
      partition: 'persist:test-path',
      preload: 'file:///test/qapp-guest-preload.js',
    });
    vi.stubGlobal('electronAPI', {
      qappGuestPrepare: prepare,
      qappGuestRelease: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const loadedFor = async (path: string) => {
    render(
      <AppViewer
        app={{ tabId: 'app-tab', name: 'Opened-App', service: 'APP', path }}
        isDevMode={false}
      />
    );
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    return preparedUrlFor('app-tab');
  };

  it.each([
    '../../hash/AnotherPage?q=1',
    'docs/../../../hash/AnotherPage',
    '%2e%2e/%2E%2E/hash/AnotherPage',
    '.%2e/%2e./hash/AnotherPage',
    '..\\..\\hash\\AnotherPage',
    '.\t./.\n./hash/AnotherPage',
    './index.html',
  ])('%j with “.” or “..” segments loads the app’s root page', async (path) => {
    const loaded = await loadedFor(path);
    expect(loaded).toBe(APP_ROOT);
    expect(new URL(loaded).pathname).toBe('/render/APP/Opened-App');
  });

  it.each([
    [
      'send/v1.2/index.html?coin=QORT',
      `${NODE}/render/APP/Opened-App/send/v1.2/index.html?coin=QORT&theme=dark&lang=en&identifier=`,
    ],
    [
      'notes/release..1/index.html',
      `${NODE}/render/APP/Opened-App/notes/release..1/index.html?theme=dark&lang=en&identifier=`,
    ],
  ])('%j inside the app is kept', async (path, expected) => {
    expect(await loadedFor(path)).toBe(expected);
  });

  // An open tab asked to show a path, as AppsDesktop asks when a link or
  // SET_TAB names an app whose tab is already open. The app doesn't answer
  // within a second, so the tab loads the page itself. Returns its webview.
  const navigatedTo = async (path: string) => {
    await openTab({ tabId: 'app-tab', name: 'Opened-App', service: 'APP' });
    const view = document.querySelector('webview')!;
    expect(view.getAttribute('src')).toBe(APP_ROOT);
    await act(async () => {
      executeEvent('navigateToPath-app-tab', { path });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });
    return view;
  };

  it.each([
    '../../hash/AnotherPage?q=1',
    'docs/../../../hash/AnotherPage',
    '%2e%2e/%2E%2E/hash/AnotherPage',
    '.%2e/%2e./hash/AnotherPage',
    '..\\..\\hash\\AnotherPage',
    '.\t./.\n./hash/AnotherPage',
    './index.html',
  ])('%j sent to an open tab leaves the tab where it is', async (path) => {
    const view = await navigatedTo(path);
    expect(view.getAttribute('src')).toBe(APP_ROOT);
    expect((view as any).send).not.toHaveBeenCalledWith(
      'qapp:event',
      expect.objectContaining({ action: 'NAVIGATE_TO_PATH' })
    );
  });

  it('a path inside the app sent to an open tab loads that page', async () => {
    const view = await navigatedTo('send/v1.2/index.html?coin=QORT');
    expect((view as any).send).toHaveBeenCalledWith(
      'qapp:event',
      expect.objectContaining({
        action: 'NAVIGATE_TO_PATH',
        path: 'send/v1.2/index.html?coin=QORT',
      })
    );
    const loaded = new URL(view.getAttribute('src')!);
    expect(loaded.pathname).toBe('/render/APP/Opened-App/send/v1.2/index.html');
    expect(loaded.searchParams.get('coin')).toBe('QORT');
  });

  // An open tab whose page reported `path` as the page it shows (Core's
  // q-apps.js sends QDN_RESOURCE_DISPLAYED once a page has loaded, with the
  // path the node decoded), then refreshed. Returns the address it loads.
  const refreshedAt = async (path: string) => {
    const tab = await openTab({
      tabId: 'app-tab',
      name: 'Opened-App',
      service: 'APP',
    });
    const view = document.querySelector('webview')!;
    await act(() =>
      ask(tab, {
        action: 'QDN_RESOURCE_DISPLAYED',
        service: 'APP',
        name: 'Opened-App',
        identifier: 'default',
        path,
      })
    );
    await act(async () => {
      executeEvent('refreshApp', { tabId: 'app-tab' });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return new URL(view.getAttribute('src')!);
  };

  it.each([
    '/docs/../../Other-App',
    '/%2e%2e/%2e%2e/Other-App',
    '/./index.html',
  ])(
    'a reported page %j with “.” or “..” segments reloads the app’s root page',
    async (path) => {
      const loaded = await refreshedAt(path);
      expect(loaded.pathname).toBe('/render/APP/Opened-App');
      expect(loaded.searchParams.get('theme')).toBe('dark');
    }
  );

  it('a reported page inside the app reloads that page', async () => {
    const loaded = await refreshedAt('/send/v1.2/index.html');
    expect(loaded.pathname).toBe('/render/APP/Opened-App/send/v1.2/index.html');
  });

  // An open tab whose page reported its history, then asked to go back; the
  // app doesn't answer within a second, so the tab loads the page itself.
  // Returns its webview.
  const wentBackFrom = async (paths: string[]) => {
    const tab = await openTab({
      tabId: 'app-tab',
      name: 'Opened-App',
      service: 'APP',
    });
    const view = document.querySelector('webview')!;
    await act(() =>
      ask(tab, {
        action: 'NAVIGATION_HISTORY',
        payload: {
          customQDNHistoryPaths: paths,
          currentIndex: paths.length - 1,
          isDOMContentLoaded: false,
        },
      })
    );
    await act(async () => {
      executeEvent('navigateBackApp-app-tab', {});
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });
    return view;
  };

  it('back to a page with “..” segments leaves the tab where it is', async () => {
    const view = await wentBackFrom(['/docs/../../Other-App', '/page']);
    expect(view.getAttribute('src')).toBe(APP_ROOT);
  });

  it('back to a page inside the app loads that page', async () => {
    const view = await wentBackFrom(['/first', '/page']);
    expect(new URL(view.getAttribute('src')!).pathname).toBe(
      '/render/APP/Opened-App/first'
    );
  });
});

describe('a tab service or name', () => {
  beforeEach(() => {
    prepare = vi.fn().mockImplementation((owner, url) =>
      qappGuestUrlAllowed(url, url, owner, false)
        ? Promise.resolve({
            partition: `persist:test-${owner.tabId}`,
            preload: 'file:///test/qapp-guest-preload.js',
          })
        : Promise.reject(new Error('QAPP_INVALID_URL'))
    );
    vi.stubGlobal('electronAPI', {
      qappGuestPrepare: prepare,
      qappGuestRelease: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ['APP', '..'],
    ['APP', '.'],
    ['..', 'Opened-App'],
    ['.', '.'],
    ['APP', 'Opened-App/..'],
    ['APP', 'Opened-App\\..'],
    ['APP', 'Opened-App\t'],
    ['APP/..', 'Opened-App'],
    ['APP', '..;x'],
    ['APP', '%2e%2e'],
  ])(
    'service %j with name %j loads nothing, at the start, on a page change or a refresh',
    async (service, name) => {
      const { container } = render(
        <AppViewer
          app={{ tabId: 'named', service, name, path: 'hash/AnotherPage' }}
          isDevMode={false}
        />
      );
      await act(async () => {
        executeEvent('navigateToPath-named', { path: 'hash/AnotherPage' });
        executeEvent('refreshApp', { tabId: 'named' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(prepare).not.toHaveBeenCalled();
      expect(container.querySelector('webview')).toBeNull();
    }
  );

  it.each([
    'Q.Shop',
    'Qortal World',
    'Q-Mail+',
    'Кошелёк',
    '名前',
    '...',
    '100%',
    'a;b',
  ])('name %j loads that app’s own page', async (name) => {
    const { container } = render(
      <AppViewer
        app={{ tabId: 'named', service: 'APP', name, path: 'send' }}
        isDevMode={false}
      />
    );
    await waitFor(() =>
      expect(container.querySelector('webview')).not.toBeNull()
    );
    const loaded = new URL(preparedUrlFor('named'));
    expect(
      loaded.pathname.split('/').map((part) => decodeURIComponent(part))
    ).toEqual(['', 'render', 'APP', name, 'send']);
  });
});
