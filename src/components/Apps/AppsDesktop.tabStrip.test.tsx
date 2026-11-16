import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
const recordTabOrder = (event: CustomEvent) => {
  tabOrder = (event.detail?.data?.tabs ?? []).map(
    (tab) => `${tab.name}${tab.pinned ? '*' : ''}`
  );
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
  notes = [];
  clearSessionPermissionsByTabId.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }))
  );
  tabOrder = [];
  subscribeToEvent('openGlobalSnackBar', recordNote);
  subscribeToEvent('setTabsToNav', recordTabOrder);
});

afterEach(() => {
  unsubscribeFromEvent('openGlobalSnackBar', recordNote);
  unsubscribeFromEvent('setTabsToNav', recordTabOrder);
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
});
