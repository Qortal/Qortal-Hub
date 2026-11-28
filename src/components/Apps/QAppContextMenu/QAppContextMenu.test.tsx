import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { getDefaultStore, useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import i18n from '../../../i18n/i18n';
import { enabledDevModeAtom } from '../../../atoms/global';
import { appLockedAtom } from '../../../atoms/presence';
import { lightTheme } from '../../../styles/theme-light';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import {
  QAPP_MENU_TTL_MS,
  type QAppMenuOpen,
} from '../../../../electron/src/qapp-context-menu-types';
import { AuthenticatedLockScreen } from '../../App/AuthenticatedLockScreen';
import {
  FOCUS_SETTLE_MS,
  MENU_CLOSES_EARLY_MS,
  QAppContextMenu,
} from './QAppContextMenu';

const mocks = vi.hoisted(() => ({
  qortinoReady: false,
  openQortalLink: vi.fn(async (_link: string) => true),
  writeQortinoQuestion: vi.fn((_question: string) => undefined),
}));
// Qortino AI set up on this PC (a model downloaded), as Home checks it.
vi.mock('../../Group/qortinoHome/useQortinoReady', () => ({
  useQortinoReady: () => mocks.qortinoReady,
}));
vi.mock('../../../utils/qortalLink/openQortalLink', () => ({
  openQortalLink: mocks.openQortalLink,
}));
vi.mock('../../../qortinoAgent/pendingQuestion', () => ({
  writeQortinoQuestion: mocks.writeQortinoQuestion,
}));

type Box = { left: number; top: number; width: number; height: number };
type FakeView = HTMLElement & {
  box: Box | null;
  getWebContentsId: () => number;
};

let openMenu: ((menu: QAppMenuOpen) => void) | null;
let api: {
  onQAppMenuOpen: ReturnType<typeof vi.fn>;
  qappMenuAct: ReturnType<typeof vi.fn>;
  qappMenuDismiss: ReturnType<typeof vi.fn>;
  qappMenuHubLocked: ReturnType<typeof vi.fn>;
  qappMenuRightClick: ReturnType<typeof vi.fn>;
  qappMenuSettings: ReturnType<typeof vi.fn>;
};
let views: FakeView[];
let observed: ((visible: boolean) => void) | null;

/** An app's webview on screen at `box` of Hub's page (null: not shown). */
const placeApp = (box: Box | null, guestId = 7) => {
  const view = document.createElement('webview') as FakeView;
  view.tabIndex = -1;
  view.box = box;
  view.getBoundingClientRect = () => {
    const b = view.box ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      ...b,
      x: b.left,
      y: b.top,
      right: b.left + b.width,
      bottom: b.top + b.height,
    } as DOMRect;
  };
  view.getWebContentsId = () => guestId;
  document.body.append(view);
  views.push(view);
  return view;
};

const editMenu = (overrides: Partial<QAppMenuOpen> = {}): QAppMenuOpen => ({
  menuId: 'menu-1',
  tabId: 'tab-1',
  x: 120,
  y: 80,
  items: [
    { action: 'replaceMisspelling', index: 0, label: 'Testing' },
    { action: 'addToDictionary' },
    { separator: true },
    { action: 'cut', disabled: true },
    { action: 'copy', disabled: true },
    { action: 'paste', disabled: false },
  ],
  ...overrides,
});

const renderMenu = () =>
  render(
    <ThemeProvider theme={lightTheme}>
      <QAppContextMenu />
    </ThemeProvider>
  );

const show = (menu: QAppMenuOpen) =>
  act(() => {
    openMenu?.(menu);
  });

beforeEach(() => {
  openMenu = null;
  views = [];
  observed = null;
  api = {
    onQAppMenuOpen: vi.fn((callback) => {
      openMenu = callback;
      return () => {
        openMenu = null;
      };
    }),
    qappMenuAct: vi.fn(async () => true),
    qappMenuDismiss: vi.fn(async () => true),
    qappMenuHubLocked: vi.fn(async () => true),
    qappMenuRightClick: vi.fn(async () => true),
    qappMenuSettings: vi.fn(async () => true),
  };
  mocks.qortinoReady = false;
  mocks.openQortalLink.mockClear();
  mocks.writeQortinoQuestion.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  // jsdom lays nothing out: the webview at a point is the one whose box
  // holds it.
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (x: number, y: number) =>
      views.find(
        (view) =>
          view.box &&
          x >= view.box.left &&
          x <= view.box.left + view.box.width &&
          y >= view.box.top &&
          y <= view.box.top + view.box.height
      ) ?? null,
  });
  // The menu watches its app: tests say when it leaves the screen.
  (
    window as unknown as { IntersectionObserver: unknown }
  ).IntersectionObserver = class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      observed = (visible) => callback([{ isIntersecting: visible }]);
    }
    observe() {}
    disconnect() {
      observed = null;
    }
  };
  getDefaultStore().set(appLockedAtom, false);
});

afterEach(async () => {
  // Unmounted first: the resets below would re-render it outside act().
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  delete (window as unknown as { IntersectionObserver?: unknown })
    .IntersectionObserver;
  delete (document as unknown as { elementFromPoint?: unknown })
    .elementFromPoint;
  views.forEach((view) => view.remove());
  getDefaultStore().set(appLockedAtom, false);
  getDefaultStore().set(enabledDevModeAtom, false);
  await i18n.changeLanguage('en');
});

describe('QAppContextMenu', () => {
  it('shows the menu main asked for, suggestions first', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu());
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Testing',
      'Add to dictionary',
      'Cut',
      'Copy',
      'Paste',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Cut' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menu', { name: 'App menu' })).toBeInTheDocument();
  });

  it('opens for any app on screen, also outside the tab strip (Q-Wallets)', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu({ tabId: 'a-window-not-a-tab' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it("hands back unopened a menu for an app that isn't on screen there", () => {
    placeApp(null);
    renderMenu();
    show(editMenu());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1');
  });

  it('tells main only the item chosen, once', async () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Testing' }));
    await waitFor(() =>
      expect(api.qappMenuAct).toHaveBeenCalledWith(
        'menu-1',
        'replaceMisspelling',
        0
      )
    );
    show(editMenu({ menuId: 'menu-2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    await waitFor(() =>
      expect(api.qappMenuAct).toHaveBeenLastCalledWith(
        'menu-2',
        'paste',
        undefined
      )
    );
    expect(api.qappMenuAct).toHaveBeenCalledTimes(2);
  });

  it('gives the keyboard to the app under the menu before main acts', async () => {
    const order: string[] = [];
    const view = placeApp({ left: 0, top: 40, width: 800, height: 560 });
    const elsewhere = placeApp({ left: 900, top: 40, width: 300, height: 560 });
    view.blur = () => {
      order.push('app blurred');
    };
    view.focus = () => {
      order.push('app focused');
    };
    elsewhere.focus = () => {
      order.push('wrong app focused');
    };
    api.qappMenuAct.mockImplementation(async () => {
      order.push('main acts');
      return true;
    });
    renderMenu();
    show(editMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    await waitFor(() =>
      expect(order).toEqual(['app blurred', 'app focused', 'main acts'])
    );
  });

  it('sends nothing when its app left the screen before the menu finished closing', async () => {
    const view = placeApp({ left: 0, top: 40, width: 800, height: 560 });
    const focus = vi.fn();
    view.focus = focus;
    renderMenu();
    show(editMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    // A tab shortcut hides the tab while the menu fades out.
    view.box = null;
    await waitFor(() =>
      expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS * 4));
    });
    expect(api.qappMenuAct).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('closes, running nothing, when its app leaves the screen while open', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu());
    act(() => observed?.(false));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1');
    expect(api.qappMenuAct).not.toHaveBeenCalled();
  });

  it('does nothing for a greyed-out item', async () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS + 20));
    });
    expect(api.qappMenuAct).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it("says why something can't be saved, without calling it a video", () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(
      editMenu({
        items: [{ action: 'saveSound', disabled: true, reason: 'streamed' }],
      })
    );
    const item = screen.getByRole('menuitem');
    expect(item.textContent).toContain(
      "Can't be saved: the app plays it in parts, or it hasn't loaded"
    );
    expect(item.textContent).not.toMatch(/video/i);
  });

  it('closes with nothing chosen and hands the keyboard back to the app', async () => {
    const view = placeApp({ left: 0, top: 40, width: 800, height: 560 });
    const focus = vi.fn();
    view.focus = focus;
    renderMenu();
    show(editMenu());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() =>
      expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1')
    );
    expect(focus).toHaveBeenCalled();
    expect(api.qappMenuAct).not.toHaveBeenCalled();
  });

  it('keeps its items while it fades out', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.querySelector('.MuiMenu-paper')).not.toBeNull();
    expect(
      screen.queryAllByRole('menuitem', { hidden: true }).length
    ).toBeGreaterThan(0);
  });

  it('drops a choice still waiting when a newer menu opens', async () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(editMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    show(editMenu({ menuId: 'menu-2' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS * 4));
    });
    expect(api.qappMenuAct).not.toHaveBeenCalledWith(
      'menu-1',
      expect.anything(),
      expect.anything()
    );
  });

  it('passes a right-click outside the menu on to the app under it', () => {
    placeApp({ left: 30, top: 40, width: 800, height: 560 }, 7);
    renderMenu();
    show(editMenu());
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;
    fireEvent.contextMenu(backdrop, { clientX: 330, clientY: 240 });
    expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1');
    expect(api.qappMenuRightClick).toHaveBeenCalledWith(7, 300, 200, false);
  });

  it('closes when Hub locks, opens none while locked, and tells main', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    expect(api.qappMenuHubLocked).toHaveBeenLastCalledWith(false);
    show(editMenu());
    act(() => getDefaultStore().set(appLockedAtom, true));
    expect(api.qappMenuHubLocked).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    show(editMenu({ menuId: 'menu-3' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-3');
  });

  it('tells main what it follows: dev mode, and Qortino once set up', () => {
    renderMenu();
    expect(api.qappMenuSettings).toHaveBeenLastCalledWith({
      devMode: false,
      qortino: false,
    });
    act(() => getDefaultStore().set(enabledDevModeAtom, true));
    expect(api.qappMenuSettings).toHaveBeenLastCalledWith({
      devMode: true,
      qortino: false,
    });
  });

  it('tells main once Qortino has a model on this PC', () => {
    mocks.qortinoReady = true;
    renderMenu();
    expect(api.qappMenuSettings).toHaveBeenLastCalledWith({
      devMode: false,
      qortino: true,
    });
  });

  it('names what it looks up and the app whose page it opens', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(
      editMenu({
        items: [
          { action: 'lookUp', label: 'Publisher' },
          { action: 'askQortino' },
          { separator: true },
          { action: 'aboutApp', label: 'Opened-App' },
          { separator: true },
          { action: 'copyElement' },
          { action: 'copyElementPicture' },
          { action: 'inspectElement' },
        ],
      })
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual([
      'Look up “Publisher”',
      'Ask Qortino about this',
      'About Opened-App',
      'Copy element description',
      'Copy element as picture',
      'Inspect element',
    ]);
  });

  it("opens what main hands back with Hub's own openers", async () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    const lookedUp: unknown[] = [];
    const listener = (event: CustomEvent) => lookedUp.push(event.detail);
    subscribeToEvent('openUserLookupDrawer', listener);
    renderMenu();
    const choose = async (
      action: 'openLink' | 'lookUp' | 'askQortino',
      result: unknown,
      name: string
    ) => {
      api.qappMenuAct.mockResolvedValueOnce(result);
      show(
        editMenu({ menuId: action, items: [{ action, label: 'Publisher' }] })
      );
      fireEvent.click(screen.getByRole('menuitem', { name }));
      await waitFor(() =>
        expect(api.qappMenuAct).toHaveBeenLastCalledWith(
          action,
          action,
          undefined
        )
      );
      await act(async () => {});
    };
    await choose(
      'openLink',
      { open: 'qortal://APP/Opened-App/video/1' },
      'Open link in new tab'
    );
    expect(mocks.openQortalLink).toHaveBeenCalledWith(
      'qortal://APP/Opened-App/video/1'
    );
    await choose('lookUp', { lookUp: 'Publisher' }, 'Look up “Publisher”');
    expect(lookedUp).toEqual([{ addressOrName: 'Publisher' }]);
    await choose(
      'askQortino',
      { ask: 'what is minting' },
      'Ask Qortino about this'
    );
    expect(mocks.writeQortinoQuestion).toHaveBeenCalledWith(
      'What does “what is minting” mean?'
    );
    unsubscribeFromEvent('openUserLookupDrawer', listener);
  });

  it('carries out nothing once Hub locked or signed out meanwhile', async () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    let answer: (result: unknown) => void = () => undefined;
    api.qappMenuAct.mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    );
    const view = renderMenu();
    show(editMenu({ items: [{ action: 'openLink' }] }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Open link in new tab' })
    );
    await waitFor(() => expect(api.qappMenuAct).toHaveBeenCalled());
    act(() => getDefaultStore().set(appLockedAtom, true));
    await act(async () => answer({ open: 'qortal://APP/Opened-App' }));
    expect(mocks.openQortalLink).not.toHaveBeenCalled();

    act(() => getDefaultStore().set(appLockedAtom, false));
    show(editMenu({ menuId: 'menu-2', items: [{ action: 'openLink' }] }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Open link in new tab' })
    );
    await waitFor(() => expect(api.qappMenuAct).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => answer({ open: 'qortal://APP/Opened-App' }));
    expect(mocks.openQortalLink).not.toHaveBeenCalled();
  });

  it.each([
    ['et', 'opened-app teave'],
    ['ja', 'opened-appについて'],
  ])(
    "shows the app's name as it is in 'About' (%s puts it first)",
    async (language, label) => {
      await i18n.changeLanguage(language);
      placeApp({ left: 0, top: 40, width: 800, height: 560 });
      renderMenu();
      show(editMenu({ items: [{ action: 'aboutApp', label: 'opened-app' }] }));
      expect(screen.getByRole('menuitem').textContent).toBe(label);
    }
  );

  it.each([
    // The links main gives "About <name>" (its tests pin them).
    ['Publisher Co.', 'qortal://use-app-page/APP/Publisher%20Co%2E'],
    ['Publisher!', 'qortal://use-app-page/APP/Publisher%21'],
    ['Publisher (beta)', 'qortal://use-app-page/APP/Publisher%20%28beta%29'],
  ])(
    'opens the page of %s, punctuation at its end and all',
    async (name, link) => {
      // Read by Hub's own link opener, as the Hub page carries it out.
      const { openQortalLink } = await vi.importActual<
        typeof import('../../../utils/qortalLink/openQortalLink')
      >('../../../utils/qortalLink/openQortalLink');
      const opened: unknown[] = [];
      const listener = (event: CustomEvent) => opened.push(event.detail?.data);
      subscribeToEvent('selectedAppInfo', listener);
      try {
        expect(await openQortalLink(link)).toBe(true);
        await waitFor(() => expect(opened).toHaveLength(1));
        expect(opened[0]).toMatchObject({ service: 'APP', name });
      } finally {
        unsubscribeFromEvent('selectedAppInfo', listener);
      }
    }
  );

  it('names how each kind of link opens', () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(
      editMenu({
        items: [
          { action: 'openLink' },
          { action: 'openQortalLink' },
          { action: 'openWebLink' },
          { action: 'copyLink' },
        ],
      })
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual([
      'Open link in new tab',
      'Open link',
      'Open link in browser',
      'Copy link',
    ]);
  });

  it('keeps Shift on a right-click passed on from outside the menu', () => {
    placeApp({ left: 30, top: 40, width: 800, height: 560 }, 7);
    renderMenu();
    show(editMenu({ items: [{ action: 'saveVideoFrame' }] }));
    expect(screen.getByRole('menuitem').textContent).toBe(
      'Save video frame as…'
    );
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;
    fireEvent.contextMenu(backdrop, {
      clientX: 330,
      clientY: 240,
      shiftKey: true,
    });
    expect(api.qappMenuRightClick).toHaveBeenCalledWith(7, 300, 200, true);
  });

  it('stops listening when it unmounts, and works without Electron', () => {
    const view = renderMenu();
    view.unmount();
    expect(openMenu).toBeNull();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    expect(() => renderMenu()).not.toThrow();
  });
});

describe('QAppContextMenu with what is on screen around it', () => {
  /** Hub's own layers over the apps (Qortino's panel, a card), lowest first. */
  let overlays: { element: HTMLElement; box: Box }[];

  /** A part of Hub's own page fixed over the apps, as Qortino's panel is. */
  const placeHubPanel = (box: Box) => {
    const element = document.createElement('div');
    document.body.append(element);
    overlays.push({ element, box });
  };

  const inBox = (box: Box | null, x: number, y: number) =>
    !!box &&
    x >= box.left &&
    x <= box.left + box.width &&
    y >= box.top &&
    y <= box.top + box.height;

  beforeEach(() => {
    overlays = [];
    // What a browser finds at a point, topmost first: a Hub modal (the menu,
    // also while it fades out) over the whole window, then Hub's own
    // panels, then the app.
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: (x: number, y: number) => {
        const stack: Element[] = [];
        const modal = [...document.querySelectorAll('.MuiModal-root')].find(
          (root) => !root.classList.contains('MuiModal-hidden')
        );
        if (modal) {
          const backdrop = modal.querySelector('.MuiBackdrop-root');
          if (backdrop) stack.push(backdrop);
          stack.push(modal);
        }
        for (const overlay of [...overlays].reverse()) {
          if (inBox(overlay.box, x, y)) stack.push(overlay.element);
        }
        for (const view of views) {
          if (inBox(view.box, x, y)) stack.push(view);
        }
        return stack;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document as unknown as { elementsFromPoint?: unknown })
      .elementsFromPoint;
    overlays.forEach((overlay) => overlay.element.remove());
  });

  const aboutMenu = (): QAppMenuOpen => ({
    menuId: 'menu-1',
    tabId: 'tab-1',
    x: 120,
    y: 80,
    items: [{ action: 'aboutApp', label: 'Opened-App' }],
  });

  it('opens the next menu where the user right-clicks again while one is open', async () => {
    placeApp({ left: 30, top: 40, width: 800, height: 560 }, 7);
    renderMenu();
    show(aboutMenu());
    // The second right-click lands on the open menu's layer: it goes on to
    // the app at that point...
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;
    fireEvent.contextMenu(backdrop, { clientX: 330, clientY: 240 });
    expect(api.qappMenuRightClick).toHaveBeenCalledWith(7, 300, 200, false);
    // ...and main asks for Hub's menu there while the first one still fades
    // out.
    show(
      editMenu({
        menuId: 'menu-2',
        x: 330,
        y: 240,
        items: [{ action: 'openLink' }, { action: 'copyLink' }],
      })
    );
    expect(api.qappMenuDismiss).not.toHaveBeenCalledWith('menu-2');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(
      screen.getByRole('menuitem', { name: 'Copy link' })
    ).toBeInTheDocument();
  });

  it("passes no right-click into an app where Hub's own panel covers it", () => {
    placeApp({ left: 0, top: 40, width: 800, height: 560 }, 7);
    // Qortino's panel, open over the right part of the app.
    placeHubPanel({ left: 500, top: 40, width: 300, height: 560 });
    renderMenu();
    show(aboutMenu());
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;
    fireEvent.contextMenu(backdrop, { clientX: 650, clientY: 300 });
    expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1');
    expect(api.qappMenuRightClick).not.toHaveBeenCalled();
  });

  it('closes a menu left open a moment before main forgets it', () => {
    vi.useFakeTimers();
    placeApp({ left: 0, top: 40, width: 800, height: 560 });
    renderMenu();
    show(aboutMenu());
    act(() => {
      vi.advanceTimersByTime(QAPP_MENU_TTL_MS - MENU_CLOSES_EARLY_MS - 1);
    });
    expect(api.qappMenuDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(api.qappMenuDismiss).toHaveBeenCalledWith('menu-1');
    expect(MENU_CLOSES_EARLY_MS).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(api.qappMenuAct).not.toHaveBeenCalled();
  });

  it("leaves the lock screen's password field the keyboard when Hub locks with a menu open", async () => {
    // Hub's page as App lays it out: the menu, and the lock screen over all.
    const LockedHub = () => {
      const locked = useAtomValue(appLockedAtom);
      return (
        <>
          <QAppContextMenu />
          {locked && <AuthenticatedLockScreen onUnlock={vi.fn()} />}
        </>
      );
    };
    const view = placeApp({ left: 0, top: 40, width: 800, height: 560 });
    // The user was in the app.
    view.focus();
    render(
      <ThemeProvider theme={lightTheme}>
        <LockedHub />
      </ThemeProvider>
    );
    show(aboutMenu());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Left open; Hub locks (idle, or the system's lock).
    act(() => getDefaultStore().set(appLockedAtom, true));
    const password = screen.getByLabelText('Qortal account password');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(document.activeElement).not.toBe(view);
    await waitFor(() => expect(password).toHaveFocus());
  });
});
