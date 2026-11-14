import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import {
  installTabShortcuts,
  subscribeTabShortcuts,
  TAB_SHORTCUT_CHANNEL,
  type TabShortcutKey,
} from '../../../electron/src/tab-shortcuts';
import { navigationControllerAtom } from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import { MockIpcRenderer, MockWebContents } from '../../test/mocks/electron';
import {
  MAX_CLOSED_TABS,
  tabForShortcut,
  useTabShortcuts,
} from './useTabShortcuts';

const mail = { name: 'Q-Mail', service: 'APP', tabId: 'mail' };
const chat = {
  internal: 'q-chat',
  name: 'Q-Chat',
  service: 'INTERNAL',
  tabId: 'chat',
};
const tube = { name: 'Q-Tube', service: 'APP', tabId: 'tube' };
const devTab = { tabId: 'dev', url: 'http://127.0.0.1:5173' };

type Options = Parameters<typeof useTabShortcuts>[0];

let openNewTab: Mock<() => void>;

function Strip(props: Partial<Options>) {
  useTabShortcuts({
    isNewTabWindow: false,
    maxTabs: 10,
    openNewTab,
    selectedTab: null,
    show: true,
    tabs: [],
    ...props,
  });
  return null;
}

let store: ReturnType<typeof createStore>;

const renderStrip = (props: Partial<Options>) => {
  store = createStore();
  const view = render(
    <Provider store={store}>
      <Strip {...props} />
    </Provider>
  );
  return {
    rerender: (next: Partial<Options>) =>
      view.rerender(
        <Provider store={store}>
          <Strip {...next} />
        </Provider>
      ),
    unmount: view.unmount,
  };
};

// The whole way of a key press: main reads it in the Hub page and sends the
// action, which the preload hands to the hook.
let ipc: MockIpcRenderer;
let hubPage: MockWebContents;

const typeKey = (key: string, code: string, modifiers = {}) => {
  const input: TabShortcutKey = {
    alt: false,
    code,
    control: true,
    key,
    meta: false,
    shift: false,
    type: 'keyDown',
    ...modifiers,
  };
  act(() => {
    hubPage.emit('before-input-event', { preventDefault() {} }, input);
    hubPage.sent
      .splice(0)
      .forEach(({ args, channel }) => ipc.deliver(channel, ...args));
  });
};

const EVENTS = [
  'addTab',
  'appsDevModeAddTab',
  'focusNavInput',
  'open-apps-mode',
  'open-dev-mode',
  'refreshApp',
  'removeTab',
  'setSelectedTab',
];
let heard: Array<{ detail: any; event: string }>;
const listen = (e: Event) =>
  heard.push({ detail: (e as CustomEvent).detail, event: e.type });
const shownTabs = () =>
  heard
    .filter(({ event }) => event === 'setSelectedTab')
    .map(({ detail }) => detail.data.tabId);
const reopened = () =>
  heard
    .filter(({ event }) => event === 'addTab' || event === 'appsDevModeAddTab')
    .map(({ detail }) => detail.data);

beforeEach(() => {
  heard = [];
  EVENTS.forEach((event) => document.addEventListener(event, listen));
  openNewTab = vi.fn<() => void>();
  ipc = new MockIpcRenderer();
  hubPage = new MockWebContents();
  installTabShortcuts(hubPage, () => hubPage, 'linux');
  vi.stubGlobal('electronAPI', {
    onTabShortcut: (callback) => subscribeTabShortcuts(ipc, callback),
  });
});

afterEach(() => {
  EVENTS.forEach((event) => document.removeEventListener(event, listen));
  cleanup();
  vi.unstubAllGlobals();
});

describe('switching tabs', () => {
  it('goes round the strip in its order with Ctrl+Tab and Ctrl+Shift+Tab', () => {
    const view = renderStrip({ selectedTab: tube, tabs: [mail, chat, tube] });

    typeKey('Tab', 'Tab');
    expect(heard).toEqual([
      { detail: {}, event: 'open-apps-mode' },
      { detail: { data: mail }, event: 'setSelectedTab' },
    ]);

    view.rerender({ selectedTab: mail, tabs: [mail, chat, tube] });
    typeKey('Tab', 'Tab', { shift: true });
    typeKey('PageDown', 'PageDown');
    typeKey('PageUp', 'PageUp');
    expect(shownTabs()).toEqual(['mail', 'tube', 'chat', 'tube']);
  });

  it('picks a tab with Ctrl+1…8 and the last one with Ctrl+9', () => {
    renderStrip({ selectedTab: mail, tabs: [mail, chat, tube] });

    typeKey('2', 'Digit2');
    typeKey('9', 'Digit9');
    typeKey('4', 'Digit4');
    typeKey('1', 'Digit1');

    expect(shownTabs()).toEqual(['chat', 'tube']);
  });

  it('starts from either end when no tab is on screen', () => {
    const view = renderStrip({
      selectedTab: chat,
      show: false,
      tabs: [mail, chat, tube],
    });
    typeKey('Tab', 'Tab');
    typeKey('Tab', 'Tab', { shift: true });

    view.rerender({ isNewTabWindow: true, tabs: [mail, chat, tube] });
    typeKey('Tab', 'Tab');

    expect(shownTabs()).toEqual(['mail', 'tube', 'mail']);
  });

  it('shows a local dev tab in Dev mode, as the strip does', () => {
    renderStrip({ selectedTab: mail, tabs: [mail, devTab] });

    typeKey('Tab', 'Tab');

    expect(heard).toEqual([
      { detail: {}, event: 'open-dev-mode' },
      { detail: { data: devTab, isDevMode: true }, event: 'setSelectedTab' },
    ]);
  });

  it('leaves the keyboard focus only when another tab shows', () => {
    const page = document.createElement('webview');
    page.tabIndex = 0;
    document.body.appendChild(page);
    page.focus();
    renderStrip({ selectedTab: mail, tabs: [mail, tube] });

    typeKey('5', 'Digit5');
    typeKey('r', 'KeyR');
    expect(document.activeElement).toBe(page);

    typeKey('Tab', 'Tab');
    expect(document.activeElement).toBe(document.body);
    page.remove();
  });

  it('gives nothing for an empty strip', () => {
    expect(tabForShortcut([], null, { type: 'nextTab' })).toBeNull();
  });
});

describe('new, close and reload', () => {
  it('opens a new tab the way the strip’s + does, from any view', () => {
    renderStrip({ show: false, tabs: [mail] });

    typeKey('t', 'KeyT');
    typeKey('t', 'KeyT', { isAutoRepeat: true });

    expect(openNewTab).toHaveBeenCalledTimes(1);
  });

  it('closes the tab on screen the way its × does', () => {
    const view = renderStrip({ selectedTab: tube, tabs: [mail, tube] });
    typeKey('w', 'KeyW');
    expect(heard).toEqual([{ detail: { data: tube }, event: 'removeTab' }]);

    // Home is on screen: the selected tab is hidden, so it stays.
    view.rerender({ selectedTab: tube, show: false, tabs: [mail, tube] });
    typeKey('w', 'KeyW');
    expect(heard).toHaveLength(1);
  });

  it('reloads the Q-App on screen with Ctrl+R or F5, and nothing else', () => {
    const refreshFunc = vi.fn();
    const privateApp = {
      name: 'Notes',
      refreshFunc,
      service: 'APP',
      tabId: 'p',
    };
    const tabs = [mail, chat, privateApp];
    const view = renderStrip({ selectedTab: mail, tabs });

    typeKey('r', 'KeyR');
    typeKey('F5', 'F5', { control: false });
    expect(heard).toEqual([
      { detail: { tabId: 'mail' }, event: 'refreshApp' },
      { detail: { tabId: 'mail' }, event: 'refreshApp' },
    ]);

    // A private app rebuilds its preview, as the reload button does.
    view.rerender({ selectedTab: privateApp, tabs });
    typeKey('r', 'KeyR');
    expect(refreshFunc).toHaveBeenCalledWith('p');

    view.rerender({ selectedTab: chat, tabs });
    typeKey('r', 'KeyR');
    view.rerender({ selectedTab: mail, show: false, tabs });
    typeKey('r', 'KeyR');
    expect(heard).toHaveLength(2);
    expect(refreshFunc).toHaveBeenCalledTimes(1);
  });

  it('asks the top bar to focus its search field on Ctrl+L', () => {
    renderStrip({ show: false, tabs: [] });

    typeKey('l', 'KeyL');

    expect(heard).toEqual([{ detail: {}, event: 'focusNavInput' }]);
  });
});

describe('reopening closed tabs', () => {
  const reopen = () => typeKey('T', 'KeyT', { shift: true });

  it('reopens the latest first, at the page it showed, in its place', () => {
    const view = renderStrip({ selectedTab: mail, tabs: [mail, chat, tube] });
    act(() => {
      store.set(navigationControllerAtom, {
        tube: { currentLink: 'qortal://APP/Q-Tube/watch?v=42' },
      });
    });
    view.rerender({ selectedTab: mail, tabs: [mail, chat] });
    view.rerender({ selectedTab: chat, tabs: [chat] });

    reopen();
    reopen();
    reopen();

    expect(reopened()).toEqual([
      { name: 'Q-Mail', service: 'APP' },
      {
        afterTabId: 'chat',
        name: 'Q-Tube',
        path: 'watch?v=42',
        service: 'APP',
      },
    ]);
    expect(
      heard.filter(({ event }) => event === 'open-apps-mode')
    ).toHaveLength(2);
  });

  it('brings tabs closed together back in the strip’s order', () => {
    const locked = { ...mail, lock: true, tabId: 'locked' };
    const view = renderStrip({ tabs: [locked, chat, tube] });
    view.rerender({ tabs: [locked] });

    reopen();
    reopen();

    expect(reopened()).toEqual([
      {
        afterTabId: 'locked',
        internal: 'q-chat',
        name: 'Q-Chat',
        service: 'INTERNAL',
      },
      { name: 'Q-Tube', service: 'APP' },
    ]);
  });

  it('reopens a dev tab in Dev mode, without its old id or lock', () => {
    const lockedDevTab = { ...devTab, lock: true, lockMessage: 'Unsaved' };
    const view = renderStrip({ tabs: [mail, lockedDevTab] });
    act(() => {
      store.set(navigationControllerAtom, {
        dev: { currentLink: 'qortal://APP/devapp/index.html' },
      });
    });
    view.rerender({ tabs: [mail] });

    reopen();

    expect(heard).toEqual([
      {
        detail: { data: { url: 'http://127.0.0.1:5173' } },
        event: 'appsDevModeAddTab',
      },
    ]);
  });

  it('only warns at the tab limit, and keeps the tab for later', () => {
    const view = renderStrip({ maxTabs: 2, tabs: [mail, chat, tube] });
    view.rerender({ maxTabs: 2, tabs: [chat, tube] });

    // AppsDesktop answers this addTab with its "limit reached" warning.
    reopen();
    view.rerender({ maxTabs: 3, tabs: [chat, tube] });
    reopen();
    reopen();

    expect(reopened()).toEqual([
      { name: 'Q-Mail', service: 'APP' },
      { name: 'Q-Mail', service: 'APP' },
    ]);
  });

  it(`remembers the last ${MAX_CLOSED_TABS} closed tabs`, () => {
    const tabs = Array.from({ length: MAX_CLOSED_TABS + 1 }, (_, n) => ({
      name: `App ${n}`,
      service: 'APP',
      tabId: `t${n}`,
    }));
    const view = renderStrip({ tabs });
    for (let open = tabs.length - 1; open >= 0; open -= 1) {
      view.rerender({ tabs: tabs.slice(0, open) });
    }

    for (let n = 0; n <= MAX_CLOSED_TABS; n += 1) reopen();

    expect(reopened().map(({ name }) => name)).toEqual(
      tabs.slice(0, MAX_CLOSED_TABS).map(({ name }) => name)
    );
  });
});

describe('the bridge', () => {
  it('does nothing behind the lock screen', () => {
    renderStrip({ selectedTab: mail, tabs: [mail, tube] });
    act(() => store.set(appLockedAtom, true));

    typeKey('Tab', 'Tab');
    typeKey('t', 'KeyT');
    typeKey('w', 'KeyW');
    typeKey('l', 'KeyL');

    expect(heard).toEqual([]);
    expect(openNewTab).not.toHaveBeenCalled();
  });

  it('does nothing while a Hub dialog is open, as a Q-App request is', () => {
    renderStrip({ selectedTab: mail, tabs: [mail, tube] });
    const dialog = document.createElement('div');
    dialog.className = 'MuiDialog-root MuiModal-root';
    document.body.append(dialog);

    typeKey('w', 'KeyW');
    typeKey('Tab', 'Tab');
    expect(heard).toEqual([]);

    // A dialog kept mounted while closed doesn't count.
    dialog.classList.add('MuiModal-hidden');
    typeKey('w', 'KeyW');
    expect(heard.map(({ event }) => event)).toEqual(['removeTab']);
    dialog.remove();
  });

  it('unsubscribes when unmounted', () => {
    const view = renderStrip({ tabs: [mail] });
    expect(ipc.listenerCount(TAB_SHORTCUT_CHANNEL)).toBe(1);

    view.unmount();

    expect(ipc.listenerCount(TAB_SHORTCUT_CHANNEL)).toBe(0);
  });

  it('does nothing without the desktop bridge', () => {
    vi.stubGlobal('electronAPI', undefined);
    renderStrip({ selectedTab: mail, tabs: [mail, tube] });

    typeKey('t', 'KeyT');
    typeKey('Tab', 'Tab');

    expect(heard).toEqual([]);
    expect(openNewTab).not.toHaveBeenCalled();
  });
});
