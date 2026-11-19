import { ThemeProvider } from '@mui/material/styles';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useState } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';

const NODE = 'http://node.test';

// The tabs and the real viewers behind them: only the pages that aren't
// tabs are left out.
vi.mock('../../App', () => ({ getBaseApiReact: () => 'http://node.test' }));
vi.mock('./AppsLauncher', async () => ({
  ...(await vi.importActual<typeof import('./AppsLauncher/launcherRouting')>(
    './AppsLauncher/launcherRouting'
  )),
  AppsLauncher: () => null,
}));
vi.mock('./AppsDevModeHome', () => ({ AppsDevModeHome: () => null }));
vi.mock('./AppInfo', () => ({ AppInfo: () => null }));
vi.mock('./AppPublish', () => ({ AppPublish: () => null }));
vi.mock('./AppsCategoryDesktop', () => ({ AppsCategoryDesktop: () => null }));
vi.mock('../../hooks/useAppRatings', () => ({
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: () => {} }),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId: vi.fn(),
  hasSessionPermission: vi.fn(() => false),
}));
vi.mock('../../qortal/get', () => ({
  saveFile: vi.fn(),
  authorizeRnsDestination: vi.fn(),
}));
vi.mock('../Desktop/CustomTitleBar', () => ({
  appChromeOffsetPx: '0px',
  appHeighOffsetPx: '0px',
}));
vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: () => null }));
vi.mock('../Theme/ThemeContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../Theme/ThemeContext')>()),
  useThemeContext: () => ({ themeMode: 'dark' }),
}));

// Each guest document's request listener, as the real bridge hands it the
// guest's requests.
const bridges = vi.hoisted(
  () =>
    [] as Array<{
      view: Element;
      listener: (event: {
        data: any;
        ports: { postMessage: (result: any) => void }[];
      }) => Promise<void>;
    }>
);
vi.mock('../../qortal/qapp-guest-request-bridge', () => ({
  attachQAppRequestBridge: (view, _documentId, listener) => {
    bridges.push({ view, listener });
    return () => undefined;
  },
}));

import { AppsDesktop } from './AppsDesktop';
import { qappGuestUrlAllowed } from '../../../electron/src/qapp-guest-policy';
import { createWidgetRequestHandler } from '../HomeWidgets/widgetRequests';

const Harness = () => {
  const [mode, setMode] = useState('home');
  const [devMode, setDevMode] = useState('home');
  const [desktopViewMode, setDesktopViewMode] = useState('apps');
  return (
    <AppsDesktop
      desktopViewMode={desktopViewMode}
      devMode={devMode}
      mode={mode}
      setDesktopViewMode={setDesktopViewMode}
      setDevMode={setDevMode}
      setMode={setMode}
      show
    />
  );
};

const SLOW = { timeout: 5000 };

let container: HTMLElement;
let prepare: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

const webviews = () => Array.from(container.querySelectorAll('webview'));

// The guest in the n-th webview loads and says hello, as Electron's preload
// does; returns the request listener Hub attaches to it.
const guestSaysHello = async (index: number) => {
  await waitFor(() => expect(webviews().length).toBeGreaterThan(index), SLOW);
  const view = webviews()[index];
  Object.assign(view, { send: vi.fn() });
  act(() =>
    view.dispatchEvent(
      Object.assign(new Event('ipc-message'), {
        channel: 'qapp:hello',
        args: [{ documentId: String(index + 1).repeat(32) }],
      })
    )
  );
  await waitFor(
    () => expect(bridges.some((bridge) => bridge.view === view)).toBe(true),
    SLOW
  );
  return bridges.filter((bridge) => bridge.view === view).slice(-1)[0].listener;
};

const ask = (listener, data) =>
  act(
    () =>
      new Promise((resolve) => {
        void listener({
          data: { requestedHandler: 'UI', ...data },
          ports: [{ postMessage: resolve }],
        });
      })
  );

// A SET_TAB payload with fields besides service, name, identifier and path.
const TAB_WITH_EXTRA_FIELDS = {
  name: 'Opened-App',
  service: 'APP',
  isPreview: true,
  url: `${NODE}/render/hash/AnotherPage?q=1`,
};

// The named app's root page from the node, with nothing after its name.
const APP_ROOT =
  /^http:\/\/node\.test\/render\/APP\/Opened-App\?theme=dark&lang=[^&]+&identifier=$/;

// The page the n-th tab's guest loads.
const loadedUrl = (index: number) =>
  webviews()[index].getAttribute('src') ?? '';

const preparedUrls = () => prepare.mock.calls.map(([, url]) => url as string);

// A request from the tab the guest is in, and the app info Hub sends with
// it.
const appInfoOfRequestFrom = async (listener) => {
  sendMessage.mockClear();
  await ask(listener, {
    action: 'GET_USER_ACCOUNT',
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  return sendMessage.mock.calls[0][4];
};

// The n-th tab runs the named app's root page from the node, no other page
// was prepared, and its requests carry that app.
const expectAppFromTheNode = async (index: number) => {
  const opened = await guestSaysHello(index);
  expect(webviews()).toHaveLength(index + 1);
  expect(loadedUrl(index)).toMatch(APP_ROOT);
  expect(new URL(loadedUrl(index)).pathname).toBe('/render/APP/Opened-App');
  expect(preparedUrls().filter((url) => url.includes('AnotherPage'))).toEqual(
    []
  );
  expect(await appInfoOfRequestFrom(opened)).toMatchObject({
    name: 'Opened-App',
    service: 'APP',
  });
};

const realResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = realResizeObserver;
});

beforeEach(() => {
  bridges.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  // Electron's own check of where a tab's guest may load.
  prepare = vi.fn().mockImplementation((owner, url, isDevMode) =>
    qappGuestUrlAllowed(url, url, owner, isDevMode === true)
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
  vi.stubGlobal('sendMessage', sendMessage);
  ({ container } = render(
    <Provider store={createStore()}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  ));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tabs opened by SET_TAB, links and widgets', () => {
  it('from a Q-App’s SET_TAB load the named app from the node and ignore other fields', async () => {
    // 1. The user opens some Q-App.
    act(() => {
      executeEvent('addTab', { data: { name: 'Some App', service: 'APP' } });
    });
    const someApp = await guestSaysHello(0);

    // 2. That app sends SET_TAB with fields besides the resource.
    const answer = await ask(someApp, {
      action: 'SET_TAB',
      payload: TAB_WITH_EXTRA_FIELDS,
    });
    expect(answer).toEqual({ result: true, error: null });

    // 3. The new tab loads the named app from the node, and its requests
    // carry that app.
    await expectAppFromTheNode(1);
  });

  it('from SET_TAB with “..” segments in the path load the app’s root page', async () => {
    // 1. The user opens some Q-App.
    act(() => {
      executeEvent('addTab', { data: { name: 'Some App', service: 'APP' } });
    });
    const someApp = await guestSaysHello(0);

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

    // 3. The new tab loads the app’s root page, and its requests carry that
    // app.
    await expectAppFromTheNode(1);
  });

  it('from a chat link with “..” segments in the path load the app’s root page', async () => {
    // 1. A chat message holds a link with “..” segments in its path.
    const { extractComponents } = await vi.importActual<
      typeof import('../Chat/MessageDisplay')
    >('../Chat/MessageDisplay');
    const link = extractComponents(
      'qortal://APP/Opened-App/../../hash/AnotherPage?q=1'
    );
    expect(link).toEqual({
      service: 'APP',
      name: 'Opened-App',
      identifier: undefined,
      path: '../../hash/AnotherPage?q=1',
    });

    // 2. The user clicks it: the chat opens it as MessageDisplay's click
    // handler does.
    const { service, name, identifier, path } = link;
    act(() => {
      executeEvent('addTab', { data: { service, name, identifier, path } });
    });

    // 3. The tab loads the app’s root page, and its requests carry that app.
    await expectAppFromTheNode(0);
    // Loading the chat's message module takes a few seconds.
  }, 30_000);

  it('from a Home widget’s SET_TAB load the named app from the node and ignore other fields', async () => {
    // 1. A widget on Home sends SET_TAB with fields besides the resource.
    const widget = createWidgetRequestHandler({
      owner: { tabId: 'widget:Some App', name: 'Some App', service: 'APP' },
      isOnScreen: () => true,
      answerOwn: () => null,
      sendMessage,
    });
    const answer = await act(
      () =>
        new Promise((resolve) => {
          void widget({
            data: {
              requestedHandler: 'UI',
              action: 'SET_TAB',
              payload: TAB_WITH_EXTRA_FIELDS,
            },
            ports: [{ postMessage: resolve }],
          });
        })
    );
    expect(answer).toEqual({ result: true, error: null });

    // 2. The new tab loads the named app from the node, and its requests
    // carry that app.
    await expectAppFromTheNode(0);
  });

  it('from SET_TAB still open at the identifier and path it asks for', async () => {
    act(() => {
      executeEvent('addTab', { data: { name: 'Some App', service: 'APP' } });
    });
    const someApp = await guestSaysHello(0);

    const answer = await ask(someApp, {
      action: 'SET_TAB',
      payload: {
        service: 'APP',
        name: 'Opened-App',
        identifier: 'main',
        path: 'send?coin=QORT',
      },
    });
    expect(answer).toEqual({ result: true, error: null });

    const opened = await guestSaysHello(1);
    expect(webviews()).toHaveLength(2);
    expect(loadedUrl(1)).toMatch(
      /^http:\/\/node\.test\/render\/APP\/Opened-App\/send\?coin=QORT&theme=dark&lang=[^&]+&identifier=main$/
    );
    expect(await appInfoOfRequestFrom(opened)).toMatchObject({
      name: 'Opened-App',
      service: 'APP',
    });
  });

  it('from a link whose name is ".." load nothing, also when opened again', async () => {
    // 1. A notification link whose name is “..”.
    const { extractComponents } = await vi.importActual<
      typeof import('../Chat/MessageDisplay')
    >('../Chat/MessageDisplay');
    const link = extractComponents('qortal://APP/../hash/AnotherPage?q=1');
    expect(link).toEqual({
      service: 'APP',
      name: '..',
      identifier: undefined,
      path: 'hash/AnotherPage?q=1',
    });

    // 2. The user clicks it twice: the notification opens it as
    // GeneralNotifications does, so the second click shows that page in the
    // tab the first one opened.
    for (let click = 0; click < 2; click++) {
      act(() => {
        executeEvent('addTab', {
          data: { ...link, navigateIfAlreadyOpen: true },
        });
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    }

    // 3. Nothing was loaded for it.
    expect(prepare).not.toHaveBeenCalled();
    expect(webviews()).toEqual([]);
    // Loading the chat's message module takes a few seconds.
  }, 30_000);
});
