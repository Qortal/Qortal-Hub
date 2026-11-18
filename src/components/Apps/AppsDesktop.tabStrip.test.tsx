import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import type { TabShortcutAction } from '../../../electron/src/tab-shortcuts';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

const { clearSessionPermissionsByTabId } = vi.hoisted(() => ({
  clearSessionPermissionsByTabId: vi.fn(),
}));

// Only the tab strip is under test: the pages behind the tabs are left out.
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
vi.mock('./AppViewerContainer', () => ({ default: () => null }));
vi.mock('../../hooks/useAppRatings', () => ({
  RatingsCacheInitializer: () => null,
  useAppRatings: () => ({ refreshRatings: () => {} }),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  clearSessionPermissionsByTabId,
}));
vi.mock('../Desktop/CustomTitleBar', () => ({ appChromeOffsetPx: '0px' }));
vi.mock('../Chat/MessageDisplay', () => ({ extractComponents: () => null }));

import { AppsDesktop } from './AppsDesktop';

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

const renderStrip = () =>
  render(
    <Provider store={createStore()}>
      <ThemeProvider theme={lightTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );

const openTab = (name: string, extra: Record<string, unknown> = {}) =>
  act(() => {
    executeEvent('addTab', { data: { name, service: 'APP', ...extra } });
  });

const group = (name: 'pinned' | 'unpinned') =>
  document.querySelector<HTMLElement>(`[data-tab-group="${name}"]`);
const tabsIn = (name: 'pinned' | 'unpinned') =>
  Array.from(
    group(name)?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []
  ).map((tab) => tab.getAttribute('aria-label'));
const tabNamed = (name: string) => screen.getByRole('button', { name });
const tabIdOf = (name: string) => tabNamed(name).dataset.tabId;
/** The strip's row: the pinned tabs, the other tabs and the + button. */
const strip = () => group('unpinned')!.parentElement!;
/** The bar the strip sits in, which the pointer leaves. */
const tabBar = () => strip().parentElement!;
const closeButtonOf = (name: string) =>
  within(tabNamed(name)).getByRole('button', { name: 'Close tab' });
/** A click on a tab's ×, with the mouse (detail 1) or from the keyboard. */
const clickClose = (name: string, { byKeyboard = false } = {}) =>
  act(() => {
    fireEvent.click(closeButtonOf(name), { detail: byKeyboard ? 0 : 1 });
  });
const middleClick = (name: string) =>
  act(() => {
    fireEvent(
      tabNamed(name),
      new MouseEvent('auxclick', { bubbles: true, button: 1, cancelable: true })
    );
  });
const menuItem = (name: string) => screen.getByRole('menuitem', { name });

/** Room for a busy test machine: the top bar hears of tabs after 100 ms. */
const SLOW = { timeout: 3000 };

const chooseFromMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  tabName: string,
  item: string
) => {
  fireEvent.contextMenu(tabNamed(tabName));
  await user.click(screen.getByRole('menuitem', { name: item }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull(), SLOW);
};

let notes: string[] = [];
const recordNote = (event: CustomEvent) => notes.push(event.detail?.message);
/**
 * The order of the `tabs` list itself, as the top bar gets it: other code
 * goes by it too, so it has to match the strip. Pinned tabs end with *.
 */
let tabOrder: string[] = [];
/** The tab on screen, as the top bar last heard of it. */
let shownTab: string | null = null;
const recordTabOrder = (event: CustomEvent) => {
  tabOrder = (event.detail?.data?.tabs ?? []).map(
    (tab) => `${tab.name}${tab.pinned ? '*' : ''}`
  );
  shownTab = event.detail?.data?.selectedTab?.name ?? null;
};

let shortcut: ((action: TabShortcutAction) => void) | null = null;
/** A tab shortcut, as Electron main sends it. */
const press = (action: TabShortcutAction) =>
  act(() => {
    shortcut?.(action);
  });
/** Time for the top bar to hear of a selected tab, 100 ms later. */
const letTheTopBarHear = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

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
  notes = [];
  clearSessionPermissionsByTabId.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  tabOrder = [];
  shownTab = null;
  shortcut = null;
  vi.stubGlobal('electronAPI', {
    onTabShortcut: (callback: (action: TabShortcutAction) => void) => {
      shortcut = callback;
      return () => {
        if (shortcut === callback) shortcut = null;
      };
    },
  });
  subscribeToEvent('openGlobalSnackBar', recordNote);
  subscribeToEvent('setTabsToNav', recordTabOrder);
});

/**
 * Choosing a tab tells the top bar 100 ms later, and closing one 400 ms later.
 * A test can end before that: the update must fire then, while the page is
 * still there, not after the last test, when the test page is gone.
 */
const LATE_TOP_BAR_UPDATE_MS = 400;

afterEach(async () => {
  unsubscribeFromEvent('openGlobalSnackBar', recordNote);
  unsubscribeFromEvent('setTabsToNav', recordTabOrder);
  // Timers fire in order, so this one comes after any late update.
  await new Promise((resolve) =>
    setTimeout(resolve, LATE_TOP_BAR_UPDATE_MS + 100)
  );
  vi.unstubAllGlobals();
});

describe('AppsDesktop tab strip: pinned tabs', () => {
  it('pins and unpins tabs from their menu, pinned tabs first', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    expect(group('pinned')).toBeNull();

    await chooseFromMenu(user, 'Q-Blog', 'Pin tab');
    expect(tabsIn('pinned')).toEqual(['Q-Blog']);
    expect(tabsIn('unpinned')).toEqual(['Q-Tube', 'Q-Mail']);

    // A newly pinned tab goes after the pinned ones.
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    expect(tabsIn('pinned')).toEqual(['Q-Blog', 'Q-Tube']);
    expect(tabsIn('unpinned')).toEqual(['Q-Mail']);

    // An unpinned tab goes first among the others.
    await chooseFromMenu(user, 'Q-Blog', 'Unpin tab');
    expect(tabsIn('pinned')).toEqual(['Q-Tube']);
    expect(tabsIn('unpinned')).toEqual(['Q-Blog', 'Q-Mail']);
    await waitFor(
      () => expect(tabOrder).toEqual(['Q-Tube*', 'Q-Blog', 'Q-Mail']),
      SLOW
    );
  });

  it('opens new tabs after the pinned ones, never pinned', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');

    // An event can't pin a tab on its own, a Q-App's request included.
    openTab('Q-Mail', { pinned: true });
    expect(tabsIn('pinned')).toEqual(['Q-Tube']);
    expect(tabsIn('unpinned')).toEqual(['Q-Mail']);
    expect(tabNamed('Q-Mail')).not.toHaveAttribute('data-pinned');
  });

  it('duplicates a pinned tab as an unpinned copy, after the pinned tabs', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Mail');
    openTab('Q-Tube');
    openTab('Q-Blog');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    await chooseFromMenu(user, 'Q-Blog', 'Pin tab');

    await chooseFromMenu(user, 'Q-Tube', 'Duplicate tab');
    expect(tabsIn('pinned')).toEqual(['Q-Tube', 'Q-Blog']);
    expect(tabsIn('unpinned')).toEqual(['Q-Tube', 'Q-Mail']);
    await waitFor(
      () =>
        expect(tabOrder).toEqual(['Q-Tube*', 'Q-Blog*', 'Q-Tube', 'Q-Mail']),
      SLOW
    );
  });

  it('keeps pinned tabs open on Close All, and says why', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    await chooseFromMenu(user, 'Q-Mail', 'Pin tab');
    const closedIds = [tabIdOf('Q-Tube'), tabIdOf('Q-Blog')];
    const pinnedId = tabIdOf('Q-Mail');

    await chooseFromMenu(user, 'Q-Tube', 'Close all tabs');

    expect(tabsIn('pinned')).toEqual(['Q-Mail']);
    expect(group('unpinned')).toBeNull();
    expect(notes).toEqual(['Pinned tabs stay open. Unpin a tab to close it.']);
    const cleared = clearSessionPermissionsByTabId.mock.calls.map(
      ([tabId]) => tabId
    );
    expect(cleared).toEqual(expect.arrayContaining(closedIds));
    expect(cleared).not.toContain(pinnedId);
  });

  it('has one note when pinned and locked tabs both stay open', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    act(() => {
      executeEvent('addLock', { data: { tabId: tabIdOf('Q-Blog') } });
    });

    await chooseFromMenu(user, 'Q-Mail', 'Close all tabs');

    expect(tabsIn('pinned')).toEqual(['Q-Tube']);
    expect(tabsIn('unpinned')).toEqual(['Q-Blog']);
    expect(notes).toEqual([
      'Pinned and locked tabs stay open. Unpin a pinned tab before closing it, and close each locked tab on its own to confirm.',
    ]);
  });
});

describe('AppsDesktop tab strip: closing from a tab’s menu', () => {
  it('closes the other tabs, but not the pinned ones, and stays on the tab', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    openTab('Q-Share');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    const closedIds = [tabIdOf('Q-Mail'), tabIdOf('Q-Share')];
    clearSessionPermissionsByTabId.mockClear();

    await chooseFromMenu(user, 'Q-Blog', 'Close other tabs');

    expect(tabsIn('pinned')).toEqual(['Q-Tube']);
    expect(tabsIn('unpinned')).toEqual(['Q-Blog']);
    // Q-Share was on screen and closed: the tab whose menu closed it shows.
    await waitFor(() => expect(shownTab).toBe('Q-Blog'), SLOW);
    // Pinned tabs aren't among the other tabs: no note about them.
    expect(notes).toEqual([]);
    expect(
      clearSessionPermissionsByTabId.mock.calls.map(([tabId]) => tabId)
    ).toEqual(closedIds);
  });

  it('opens a tab’s menu without switching to the tab', async () => {
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    await waitFor(() => expect(shownTab).toBe('Q-Mail'), SLOW);

    fireEvent.contextMenu(tabNamed('Q-Tube'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Long enough for the top bar to hear of a change, if there were one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(shownTab).toBe('Q-Mail');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull(), SLOW);
    expect(shownTab).toBe('Q-Mail');
  });

  it('stays on the tab on screen when an item is chosen from another tab’s menu', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    await waitFor(() => expect(shownTab).toBe('Q-Mail'), SLOW);

    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');

    expect(tabsIn('pinned')).toEqual(['Q-Tube']);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(shownTab).toBe('Q-Mail');
  });

  it('keeps a tab open when its menu gets a middle click', async () => {
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');

    fireEvent.contextMenu(tabNamed('Q-Tube'));
    act(() => {
      fireEvent(
        menuItem('Duplicate tab'),
        new MouseEvent('auxclick', {
          bubbles: true,
          button: 1,
          cancelable: true,
        })
      );
    });

    expect(tabsIn('unpinned')).toEqual(['Q-Tube', 'Q-Mail']);
  });

  it('shows the tab whose menu closed the other tabs, also when a pinned tab was viewed more recently', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    // Q-Tube (pinned) is viewed, then Q-Mail: Q-Blog was viewed least lately.
    fireEvent.click(tabNamed('Q-Tube'));
    fireEvent.click(tabNamed('Q-Mail'));
    await waitFor(() => expect(shownTab).toBe('Q-Mail'), SLOW);

    await chooseFromMenu(user, 'Q-Blog', 'Close other tabs');

    expect(tabsIn('pinned')).toEqual(['Q-Tube']);
    expect(tabsIn('unpinned')).toEqual(['Q-Blog']);
    await waitFor(() => expect(shownTab).toBe('Q-Blog'), SLOW);
  });

  it('shows the tab whose menu closed the tabs to its right, the one on screen among them', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    openTab('Q-Share');
    await chooseFromMenu(user, 'Q-Share', 'Pin tab');
    fireEvent.click(tabNamed('Q-Share'));
    fireEvent.click(tabNamed('Q-Blog'));
    await waitFor(() => expect(shownTab).toBe('Q-Blog'), SLOW);

    await chooseFromMenu(user, 'Q-Tube', 'Close tabs to the right');

    expect(tabsIn('pinned')).toEqual(['Q-Share']);
    expect(tabsIn('unpinned')).toEqual(['Q-Tube']);
    await waitFor(() => expect(shownTab).toBe('Q-Tube'), SLOW);
  });

  it('closes the tabs to the right, but not the pinned ones', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    openTab('Q-Share');
    await chooseFromMenu(user, 'Q-Share', 'Pin tab');

    await chooseFromMenu(user, 'Q-Mail', 'Close tabs to the right');
    expect(tabsIn('pinned')).toEqual(['Q-Share']);
    expect(tabsIn('unpinned')).toEqual(['Q-Tube', 'Q-Mail']);

    // Every other tab is to the right of a pinned one.
    await chooseFromMenu(user, 'Q-Share', 'Close tabs to the right');
    expect(tabsIn('pinned')).toEqual(['Q-Share']);
    expect(group('unpinned')).toBeNull();
    expect(notes).toEqual([]);
  });

  it('keeps a locked tab open, says why, and asks when it is closed on its own', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    act(() => {
      executeEvent('addLock', { data: { tabId: tabIdOf('Q-Mail') } });
    });

    await chooseFromMenu(user, 'Q-Tube', 'Close other tabs');

    expect(tabsIn('unpinned')).toEqual(['Q-Tube', 'Q-Mail']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(notes).toEqual([
      'Locked tabs stay open. Close each one on its own to confirm.',
    ]);

    clickClose('Q-Mail');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Close Tab Confirmation'
    );
    expect(tabsIn('unpinned')).toEqual(['Q-Tube', 'Q-Mail']);
  });

  it('greys out an item that would close nothing', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');

    // Q-Mail is the last tab, and the only other one is pinned.
    fireEvent.contextMenu(tabNamed('Q-Mail'));
    expect(menuItem('Close other tabs')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(menuItem('Close tabs to the right')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull(), SLOW);

    fireEvent.contextMenu(tabNamed('Q-Tube'));
    expect(menuItem('Close other tabs')).not.toHaveAttribute('aria-disabled');
    expect(menuItem('Close tabs to the right')).not.toHaveAttribute(
      'aria-disabled'
    );
  });
});

describe('AppsDesktop tab strip: widths and scrolling', () => {
  const undoStubs: (() => void)[] = [];
  /** Gives `target` a fixed `key`, as a browser's layout would. */
  const stub = (
    target: object,
    key: string,
    get: (this: HTMLElement) => number
  ) => {
    const own = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, get });
    undoStubs.push(() => {
      if (own) Object.defineProperty(target, key, own);
      else delete (target as Record<string, unknown>)[key];
    });
  };
  /** A scroll position the test can read back (jsdom keeps none). */
  const scrollable = (element: HTMLElement) => {
    let scrollLeft = 0;
    Object.defineProperty(element, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });
    return () => scrollLeft;
  };
  const wheel = (target: Element, init: WheelEventInit) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  const widthOf = (name: string) => getComputedStyle(tabNamed(name)).width;

  afterEach(() => {
    undoStubs
      .splice(0)
      .reverse()
      .forEach((undo) => undo());
  });

  it('keeps 180 px tabs while they fit, then shrinks them, then icons', () => {
    renderStrip();
    openTab('App 1');
    stub(strip(), 'clientWidth', () => 620);

    openTab('App 2');
    expect(widthOf('App 1')).toBe('180px');

    openTab('App 3');
    openTab('App 4');
    const shrunk = parseFloat(widthOf('App 1'));
    expect(shrunk).toBeLessThan(180);
    expect(shrunk).toBeGreaterThanOrEqual(100);
    expect(widthOf('App 4')).toBe(widthOf('App 1'));
    expect(tabNamed('App 1')).toHaveTextContent('App 1');

    for (let i = 5; i <= 10; i++) openTab(`App ${i}`);
    expect(widthOf('App 1')).toBe('72px');
    // Narrow tabs show their icon, and keep their title as their name.
    expect(tabNamed('App 1')).not.toHaveTextContent('App 1');
  });

  it('keeps the tab widths while tabs are closed with the mouse, until the pointer leaves', () => {
    renderStrip();
    openTab('App 1');
    stub(strip(), 'clientWidth', () => 620);
    for (let i = 2; i <= 4; i++) openTab(`App ${i}`);
    const shrunk = widthOf('App 1');
    expect(parseFloat(shrunk)).toBeLessThan(180);

    // Three tabs would fit at 180 px, two even more so.
    clickClose('App 2');
    expect(tabsIn('unpinned')).toEqual(['App 1', 'App 3', 'App 4']);
    expect(widthOf('App 3')).toBe(shrunk);
    middleClick('App 3');
    expect(tabsIn('unpinned')).toEqual(['App 1', 'App 4']);
    expect(widthOf('App 4')).toBe(shrunk);

    act(() => {
      fireEvent.pointerLeave(tabBar());
    });
    expect(widthOf('App 4')).toBe('180px');
  });

  it('fits the tabs again at once after a close from the keyboard or the menu', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('App 1');
    stub(strip(), 'clientWidth', () => 620);
    for (let i = 2; i <= 4; i++) openTab(`App ${i}`);
    const fourWide = widthOf('App 1');
    openTab('App 5');
    expect(parseFloat(widthOf('App 1'))).toBeLessThan(parseFloat(fourWide));

    clickClose('App 2', { byKeyboard: true });
    expect(widthOf('App 1')).toBe(fourWide);

    clickClose('App 3');
    expect(widthOf('App 1')).toBe(fourWide);
    await chooseFromMenu(user, 'App 1', 'Close other tabs');
    expect(tabsIn('unpinned')).toEqual(['App 1']);
    expect(widthOf('App 1')).toBe('180px');
  });

  it('fits the tabs again once a tab is pinned', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('App 1');
    stub(strip(), 'clientWidth', () => 620);
    for (let i = 2; i <= 4; i++) openTab(`App ${i}`);
    const shrunk = widthOf('App 1');

    clickClose('App 2');
    expect(widthOf('App 3')).toBe(shrunk);
    await chooseFromMenu(user, 'App 1', 'Pin tab');

    expect(tabsIn('unpinned')).toEqual(['App 3', 'App 4']);
    expect(widthOf('App 3')).toBe('180px');
  });

  it('leaves the tabs under the pointer in place while it closes them', () => {
    // Tabs 72 px wide with a 2 px gap, side by side.
    stub(HTMLElement.prototype, 'offsetLeft', function () {
      if (!this.dataset?.tabId) return 0;
      return Array.from(this.parentElement!.children).indexOf(this) * 74;
    });
    stub(HTMLElement.prototype, 'offsetWidth', function () {
      return this.dataset?.tabId ? 72 : 0;
    });
    renderStrip();
    openTab('App 1');
    const area = group('unpinned')!;
    const scrollLeft = scrollable(area);
    stub(area, 'clientWidth', () => 300);
    for (let i = 2; i <= 6; i++) openTab(`App ${i}`);
    act(() => {
      fireEvent.click(tabNamed('App 1'));
    });
    act(() => {
      fireEvent.click(tabNamed('App 6'));
    });
    expect(scrollLeft()).toBe(442 - 300);

    // App 1, viewed before App 6, shows in its place: it comes into view
    // only once the pointer leaves the strip.
    clickClose('App 6');
    expect(scrollLeft()).toBe(442 - 300);
    act(() => {
      fireEvent.pointerLeave(tabBar());
    });
    expect(scrollLeft()).toBe(0);

    // A tab that opens fits the strip again, and comes into view.
    clickClose('App 2');
    openTab('App 7');
    // App 7 is the fifth tab now: from 4 × 74 = 296 to 368.
    expect(scrollLeft()).toBe(368 - 300);
  });

  it('gives pinned tabs their own fixed width', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    expect(widthOf('Q-Tube')).toBe('44px');
    expect(widthOf('Q-Mail')).toBe('180px');
  });

  it('scrolls the tabs sideways with the mouse wheel, over the whole strip', () => {
    renderStrip();
    openTab('App 1');
    const area = group('unpinned')!;
    const scrollLeft = scrollable(area);
    stub(area, 'clientWidth', () => 300);
    stub(area, 'scrollWidth', () => 740);

    const down = wheel(tabNamed('App 1'), { deltaY: 100 });
    expect(scrollLeft()).toBe(100);
    expect(down.defaultPrevented).toBe(true);

    // Over the + button too, and never past either end.
    wheel(strip().lastElementChild!, { deltaY: 1000 });
    expect(scrollLeft()).toBe(440);
    wheel(tabNamed('App 1'), { deltaY: -1000 });
    expect(scrollLeft()).toBe(0);

    // A sideways swipe over the tabs is left to the browser.
    expect(wheel(tabNamed('App 1'), { deltaX: 60 }).defaultPrevented).toBe(
      false
    );
  });

  it('leaves the wheel alone while the tabs fit', () => {
    renderStrip();
    openTab('App 1');
    const area = group('unpinned')!;
    stub(area, 'clientWidth', () => 300);
    stub(area, 'scrollWidth', () => 300);
    expect(wheel(tabNamed('App 1'), { deltaY: 100 }).defaultPrevented).toBe(
      false
    );
  });

  it('scrolls a new tab, and the selected tab, into view', () => {
    // Tabs 72 px wide with a 2 px gap, side by side.
    stub(HTMLElement.prototype, 'offsetLeft', function () {
      if (!this.dataset?.tabId) return 0;
      return Array.from(this.parentElement!.children).indexOf(this) * 74;
    });
    stub(HTMLElement.prototype, 'offsetWidth', function () {
      return this.dataset?.tabId ? 72 : 0;
    });
    renderStrip();
    openTab('App 1');
    const area = group('unpinned')!;
    const scrollLeft = scrollable(area);
    stub(area, 'clientWidth', () => 300);

    for (let i = 2; i <= 6; i++) openTab(`App ${i}`);
    // App 6 runs from 5 × 74 = 370 to 442: just in view.
    expect(scrollLeft()).toBe(442 - 300);

    act(() => {
      fireEvent.click(tabNamed('App 1'));
    });
    expect(scrollLeft()).toBe(0);
  });

  describe('after a tab is closed', () => {
    const withAncestors = (node: Element | null) => {
      const nodes: Element[] = [];
      for (let element = node; element; element = element.parentElement) {
        nodes.push(element);
      }
      return nodes;
    };
    /** An event of `type` from a pointer of `pointerType`. */
    const pointerEvent = (
      type: string,
      pointerType: string,
      init: MouseEventInit
    ) => {
      const event = new MouseEvent(type, init);
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      return event;
    };
    /**
     * The pointer going from `from` to `to` (null: off the page), with the
     * events a browser sends: pointerout and pointerover, which bubble
     * (React's onPointerLeave and onPointerEnter come from these), and
     * pointerleave and pointerenter on each element left or entered. jsdom
     * has no PointerEvent; the type and `relatedTarget` are what is read.
     */
    const pointerMoves = (
      from: Element | null,
      to: Element | null,
      pointerType = 'mouse'
    ) =>
      act(() => {
        const left = withAncestors(from).filter((node) => !node.contains(to));
        const entered = withAncestors(to).filter(
          (node) => !node.contains(from)
        );
        const send = (node: Element, type: string, init: MouseEventInit) =>
          node.dispatchEvent(pointerEvent(type, pointerType, init));
        if (from) {
          send(from, 'pointerout', { bubbles: true, relatedTarget: to });
        }
        left.forEach((node) =>
          send(node, 'pointerleave', { relatedTarget: to })
        );
        if (to) send(to, 'pointerover', { bubbles: true, relatedTarget: from });
        entered
          .reverse()
          .forEach((node) =>
            send(node, 'pointerenter', { relatedTarget: from })
          );
      });
    /** A finger on a touch screen comes down on `target` and lifts. */
    const touchDownUp = (target: Element) =>
      act(() => {
        for (const type of ['pointerdown', 'pointerup']) {
          target.dispatchEvent(
            pointerEvent(type, 'touch', {
              bubbles: true,
              button: 0,
              cancelable: true,
            })
          );
        }
      });

    afterEach(async () => {
      await letTheTopBarHear();
    });

    /**
     * Nine tabs 72 px wide with a 2 px gap in a 300 px strip, scrolled by the
     * wheel to show 180 to 480: App 3 (148 to 220) and App 7 (444 to 516)
     * are cut off. Then App 5 (296 to 368) is closed with the mouse. The
     * strip, 590 px of tabs by then, can stay where it is.
     */
    const scrolledStripAfterAMouseClose = () => {
      stub(HTMLElement.prototype, 'offsetLeft', function () {
        if (!this.dataset?.tabId) return 0;
        return Array.from(this.parentElement!.children).indexOf(this) * 74;
      });
      stub(HTMLElement.prototype, 'offsetWidth', function () {
        return this.dataset?.tabId ? 72 : 0;
      });
      renderStrip();
      openTab('App 1');
      const area = group('unpinned')!;
      const scrollLeft = scrollable(area);
      stub(area, 'clientWidth', () => 300);
      for (let i = 2; i <= 9; i++) openTab(`App ${i}`);
      expect(scrollLeft()).toBe(664 - 300);
      area.scrollLeft = 180;

      clickClose('App 5');
      expect(tabsIn('unpinned')).not.toContain('App 5');
      expect(scrollLeft()).toBe(180);
      return scrollLeft;
    };

    it('brings a tab chosen with a click while the widths are held into view', () => {
      const scrollLeft = scrolledStripAfterAMouseClose();

      // App 3 shows only its right half. Chosen with a click, it comes into
      // view, as a chosen tab does when no tab was just closed.
      act(() => {
        fireEvent.click(tabNamed('App 3'));
      });
      expect(scrollLeft()).toBe(148);
    });

    it('brings a tab chosen from the keyboard while the widths are held into view', () => {
      const scrollLeft = scrolledStripAfterAMouseClose();

      // The mouse rests on the strip, where it closed App 5. Ctrl+1: App 1,
      // from 0 to 72, is out of view.
      press({ type: 'selectTab', index: 0 });
      expect(scrollLeft()).toBe(0);
    });

    it('brings each tab chosen in turn into view while the widths are held', async () => {
      // Tabs 72 px wide with a 2 px gap, side by side.
      stub(HTMLElement.prototype, 'offsetLeft', function () {
        if (!this.dataset?.tabId) return 0;
        return Array.from(this.parentElement!.children).indexOf(this) * 74;
      });
      stub(HTMLElement.prototype, 'offsetWidth', function () {
        return this.dataset?.tabId ? 72 : 0;
      });
      renderStrip();
      openTab('App 1');
      const area = group('unpinned')!;
      const scrollLeft = scrollable(area);
      stub(area, 'clientWidth', () => 300);
      for (let i = 2; i <= 8; i++) openTab(`App ${i}`);
      // App 8 runs from 7 × 74 = 518 to 590: the strip shows 290 to 590.
      expect(scrollLeft()).toBe(590 - 300);

      // App 7 is closed with the mouse, which stays on the strip.
      clickClose('App 7');
      expect(scrollLeft()).toBe(590 - 300);

      // Ctrl+1 shows App 1, whose tab (0 to 72) is out of view.
      press({ type: 'selectTab', index: 0 });
      await waitFor(() => expect(shownTab).toBe('App 1'), SLOW);
      expect(scrollLeft()).toBe(0);

      // App 5 (296 to 368) shows only its edge. Chosen with a click, it comes
      // into view, as a chosen tab does when no tab was just closed.
      act(() => {
        fireEvent.click(tabNamed('App 5'));
      });
      expect(scrollLeft()).toBe(368 - 300);
    });

    it('fits the tabs again after a tab is closed with a tap', async () => {
      renderStrip();
      openTab('App 1');
      stub(strip(), 'clientWidth', () => 620);
      for (let i = 2; i <= 4; i++) openTab(`App ${i}`);
      expect(parseFloat(widthOf('App 1'))).toBeLessThan(180);

      // A tap on a touch screen: the finger comes down on the ×, lifts, and
      // the pointer leaves with it. The click only comes after that.
      const close = closeButtonOf('App 2');
      pointerMoves(null, close, 'touch');
      touchDownUp(close);
      pointerMoves(close, null, 'touch');
      act(() => {
        close.dispatchEvent(
          pointerEvent('click', 'touch', {
            bubbles: true,
            button: 0,
            cancelable: true,
            detail: 1,
          })
        );
      });
      expect(tabsIn('unpinned')).toEqual(['App 1', 'App 3', 'App 4']);

      // No pointer rests on the strip after a tap: three tabs fit at 180 px.
      await waitFor(() => expect(widthOf('App 3')).toBe('180px'), {
        timeout: 5000,
      });
    }, 15_000);

    it('fits the tabs again once the pointer left the strip over a tab’s menu', async () => {
      const user = userEvent.setup();
      renderStrip();
      openTab('App 1');
      stub(strip(), 'clientWidth', () => 620);
      for (let i = 2; i <= 4; i++) openTab(`App ${i}`);
      const shrunk = widthOf('App 1');

      clickClose('App 2');
      expect(widthOf('App 3')).toBe(shrunk);

      // A right click opens a tab's menu below the strip. The pointer goes
      // down onto it, the menu is dismissed, and the pointer is over the page.
      const app1 = tabNamed('App 1');
      fireEvent.contextMenu(app1);
      const menu = screen.getByRole('menu');
      pointerMoves(app1, menu);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull(), SLOW);
      pointerMoves(null, document.body);

      // Three tabs fit at 180 px once the pointer is off the strip.
      expect(widthOf('App 3')).toBe('180px');
    });
  });
});

describe('AppsDesktop tab strip: closed tabs come back where they were', () => {
  /** Every tab in the strip, pinned ones first, as they show. */
  const stripTabs = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]')).map(
      (tab) => tab.getAttribute('aria-label')
    );

  afterEach(async () => {
    await letTheTopBarHear();
  });

  it('brings the tabs Close other tabs closed back where they were', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    openTab('Q-Share');

    await chooseFromMenu(user, 'Q-Blog', 'Close other tabs');
    expect(stripTabs()).toEqual(['Q-Blog']);

    // Ctrl+Shift+T, once for each closed tab.
    press({ type: 'reopenClosedTab' });
    press({ type: 'reopenClosedTab' });
    press({ type: 'reopenClosedTab' });

    expect(stripTabs()).toEqual(['Q-Tube', 'Q-Mail', 'Q-Blog', 'Q-Share']);
  });

  it('brings tabs back on both sides of a locked tab that stayed open', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    act(() => {
      executeEvent('addLock', { data: { tabId: tabIdOf('Q-Mail') } });
    });

    await chooseFromMenu(user, 'Q-Mail', 'Close all tabs');
    expect(stripTabs()).toEqual(['Q-Mail']);

    press({ type: 'reopenClosedTab' });
    press({ type: 'reopenClosedTab' });

    expect(stripTabs()).toEqual(['Q-Tube', 'Q-Mail', 'Q-Blog']);
  });

  it('brings the first tab back first when it was closed on its own', () => {
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');

    act(() => {
      fireEvent.click(closeButtonOf('Q-Tube'));
    });
    expect(stripTabs()).toEqual(['Q-Mail', 'Q-Blog']);

    press({ type: 'reopenClosedTab' });

    expect(stripTabs()).toEqual(['Q-Tube', 'Q-Mail', 'Q-Blog']);
  });

  it('brings a launcher tab back before the tab that was on its right', async () => {
    const user = userEvent.setup();
    renderStrip();
    act(() => {
      executeEvent('newTabWindow', {});
    });
    openTab('Q-Tube');
    openTab('Q-Mail');
    expect(stripTabs()).toEqual(['New tab', 'Q-Tube', 'Q-Mail']);

    await chooseFromMenu(user, 'Q-Mail', 'Close other tabs');
    expect(stripTabs()).toEqual(['Q-Mail']);

    press({ type: 'reopenClosedTab' });
    press({ type: 'reopenClosedTab' });

    expect(stripTabs()).toEqual(['New tab', 'Q-Tube', 'Q-Mail']);
  });

  it('brings a pinned tab closed on its own back first among the other tabs', async () => {
    const user = userEvent.setup();
    renderStrip();
    openTab('Q-Tube');
    openTab('Q-Mail');
    openTab('Q-Blog');
    await chooseFromMenu(user, 'Q-Tube', 'Pin tab');
    await chooseFromMenu(user, 'Q-Mail', 'Pin tab');

    // What Ctrl+W sends: it closes a pinned tab too.
    act(() => {
      executeEvent('removeTab', { data: { tabId: tabIdOf('Q-Tube') } });
    });
    expect(stripTabs()).toEqual(['Q-Mail', 'Q-Blog']);

    press({ type: 'reopenClosedTab' });

    // It comes back unpinned, and the pinned tab stays first in the list.
    expect(stripTabs()).toEqual(['Q-Mail', 'Q-Tube', 'Q-Blog']);
    await waitFor(
      () => expect(tabOrder).toEqual(['Q-Mail*', 'Q-Tube', 'Q-Blog']),
      SLOW
    );
  });
});
