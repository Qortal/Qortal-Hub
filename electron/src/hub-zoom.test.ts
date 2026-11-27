import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockWebContents } from '../../src/test/mocks/electron';
import {
  appZoomState,
  changeZoom,
  configureAppZoom,
  followHubZoom,
  installZoomKeys,
  loadAppZoomLevels,
  MAX_ZOOM_LEVEL,
  menuPopupPoint,
  MIN_ZOOM_LEVEL,
  nextZoomLevel,
  resetAppZoomForTests,
  resolveZoomKey,
  setZoomPanelPointer,
  setZoomScreen,
  viewMenu,
  ZOOM_STEP,
  type GuestZoomApp,
  type SavedAppZoom,
  type ZoomAction,
  type ZoomChange,
} from './hub-zoom';
import { resolveTabShortcut, type TabShortcutKey } from './tab-shortcuts';

afterEach(() => resetAppZoomForTests());

const press = (key: string, code: string, modifiers = {}): TabShortcutKey => ({
  alt: false,
  code,
  control: false,
  isAutoRepeat: false,
  isComposing: false,
  key,
  meta: false,
  shift: false,
  type: 'keyDown',
  ...modifiers,
});
const ctrl = (key: string, code: string, modifiers = {}) =>
  press(key, code, { control: true, ...modifiers });
const cmd = (key: string, code: string, modifiers = {}) =>
  press(key, code, { meta: true, ...modifiers });

// Ctrl+= and Ctrl++ (Shift+= on a US keyboard), Ctrl+- and Ctrl+_, Ctrl+0,
// and the keypad's +, - and 0.
const zoomKeys = (chord: typeof ctrl): Array<[TabShortcutKey, ZoomAction]> => [
  [chord('=', 'Equal'), 'in'],
  [chord('+', 'Equal', { shift: true }), 'in'],
  [chord('+', 'NumpadAdd'), 'in'],
  [chord('-', 'Minus'), 'out'],
  [chord('_', 'Minus', { shift: true }), 'out'],
  [chord('-', 'NumpadSubtract'), 'out'],
  [chord('0', 'Digit0'), 'reset'],
  [chord('0', 'Numpad0'), 'reset'],
];

describe('resolveZoomKey', () => {
  it.each(['linux', 'win32'])('reads the browser zoom keys on %s', (os) => {
    for (const [input, action] of zoomKeys(ctrl)) {
      expect(resolveZoomKey(input, os)).toBe(action);
    }
  });

  it('uses Cmd on macOS, where Ctrl stays with the page', () => {
    for (const [input, action] of zoomKeys(cmd)) {
      expect(resolveZoomKey(input, 'darwin')).toBe(action);
    }
    for (const [input] of zoomKeys(ctrl)) {
      expect(resolveZoomKey(input, 'darwin')).toBeNull();
    }
    expect(
      resolveZoomKey(cmd('=', 'Equal', { control: true }), 'darwin')
    ).toBeNull();
  });

  it('follows the keyboard layout', () => {
    // German: + has a key of its own, and - is where / is on a US keyboard.
    expect(resolveZoomKey(ctrl('+', 'BracketRight'), 'linux')).toBe('in');
    expect(resolveZoomKey(ctrl('-', 'Slash'), 'linux')).toBe('out');
    expect(resolveZoomKey(ctrl('ß', 'Minus'), 'linux')).toBeNull();
    // AZERTY: the 0 key types à without Shift.
    expect(resolveZoomKey(ctrl('à', 'Digit0'), 'linux')).toBe('reset');
    expect(resolveZoomKey(ctrl('=', 'Equal'), 'linux')).toBe('in');
  });

  it('takes no chord with Alt, with both Ctrl and Meta, or Shift with 0', () => {
    for (const input of [
      // AltGr arrives as Ctrl+Alt on Windows.
      ctrl('=', 'Equal', { alt: true }),
      ctrl('-', 'Minus', { alt: true }),
      ctrl('0', 'Digit0', { alt: true }),
      ctrl('=', 'Equal', { meta: true }),
      press('=', 'Equal', { meta: true }),
      ctrl(')', 'Digit0', { shift: true }),
      ctrl('0', 'Digit0', { shift: true }),
    ]) {
      expect(resolveZoomKey(input, 'win32')).toBeNull();
    }
  });

  it('reads the keypad 0 only with Num Lock on', () => {
    // Without Num Lock that key is Insert, and Ctrl+Insert copies.
    expect(resolveZoomKey(ctrl('Insert', 'Numpad0'), 'linux')).toBeNull();
  });

  it('leaves the keys without Ctrl to the page', () => {
    // The video player's + and - change its speed.
    for (const input of [
      press('+', 'NumpadAdd'),
      press('-', 'NumpadSubtract'),
      press('=', 'Equal'),
      press('+', 'Equal', { shift: true }),
      press('-', 'Minus'),
      press('0', 'Digit0'),
      ctrl('c', 'KeyC'),
      ctrl('9', 'Digit9'),
    ]) {
      expect(resolveZoomKey(input, 'linux')).toBeNull();
    }
  });

  it('ignores key-up and keys an input method is composing', () => {
    expect(
      resolveZoomKey(ctrl('=', 'Equal', { type: 'keyUp' }), 'linux')
    ).toBeNull();
    expect(
      resolveZoomKey(ctrl('=', 'Equal', { isComposing: true }), 'linux')
    ).toBeNull();
  });

  it('shares no key with the tab shortcuts', () => {
    for (const [os, chord] of [
      ['linux', ctrl],
      ['win32', ctrl],
      ['darwin', cmd],
    ] as const) {
      for (const [input] of zoomKeys(chord)) {
        expect(resolveTabShortcut(input, os)).toBeNull();
      }
    }
  });
});

describe('nextZoomLevel', () => {
  it('steps half a level, as Electron’s zoom roles do', () => {
    expect(nextZoomLevel(0, 'in')).toBe(0.5);
    expect(nextZoomLevel(0.5, 'in')).toBe(1);
    expect(nextZoomLevel(0, 'out')).toBe(-0.5);
    expect(nextZoomLevel(-0.5, 'in')).toBe(0);
    expect(nextZoomLevel(3, 'reset')).toBe(0);
  });

  it('stops at the last steps Chromium shows, 25 % to 500 %', () => {
    expect(1.2 ** MAX_ZOOM_LEVEL).toBeLessThanOrEqual(5);
    expect(1.2 ** (MAX_ZOOM_LEVEL + ZOOM_STEP)).toBeGreaterThan(5);
    expect(1.2 ** MIN_ZOOM_LEVEL).toBeGreaterThanOrEqual(0.25);
    expect(1.2 ** (MIN_ZOOM_LEVEL - ZOOM_STEP)).toBeLessThan(0.25);

    expect(nextZoomLevel(MAX_ZOOM_LEVEL, 'in')).toBe(MAX_ZOOM_LEVEL);
    expect(nextZoomLevel(MIN_ZOOM_LEVEL, 'out')).toBe(MIN_ZOOM_LEVEL);
    // No press is spent past the end: the next one comes straight back.
    expect(nextZoomLevel(MAX_ZOOM_LEVEL, 'out')).toBe(
      MAX_ZOOM_LEVEL - ZOOM_STEP
    );
    expect(nextZoomLevel(MIN_ZOOM_LEVEL, 'in')).toBe(
      MIN_ZOOM_LEVEL + ZOOM_STEP
    );
  });

  it('brings a level set past the ends back in one press', () => {
    expect(nextZoomLevel(12, 'out')).toBe(MAX_ZOOM_LEVEL);
    expect(nextZoomLevel(-12, 'in')).toBe(MIN_ZOOM_LEVEL);
    expect(nextZoomLevel(Number.NaN, 'in')).toBe(0);
  });
});

describe('installZoomKeys', () => {
  const setup = (platform = 'linux') => {
    const hub = new MockWebContents();
    const guest = new MockWebContents();
    installZoomKeys(hub, () => hub, platform);
    installZoomKeys(guest, () => hub, platform);
    const type = (source: MockWebContents, input: TabShortcutKey) => {
      const event = { preventDefault: vi.fn() };
      source.emit('before-input-event', event, input);
      return event.preventDefault;
    };
    return { guest, hub, type };
  };

  it('zooms the Hub page for a key typed in it', () => {
    const { hub, type } = setup();

    expect(type(hub, ctrl('=', 'Equal'))).toHaveBeenCalled();
    expect(hub.zoomLevel).toBe(0.5);
    type(hub, ctrl('-', 'Minus'));
    type(hub, ctrl('-', 'NumpadSubtract'));
    expect(hub.zoomLevel).toBe(-0.5);
    type(hub, ctrl('0', 'Digit0'));
    expect(hub.zoomLevel).toBe(0);
  });

  it('zooms the Hub page, not the Q-App, for a key typed in a Q-App', () => {
    const { guest, hub, type } = setup();

    expect(type(guest, ctrl('+', 'Equal', { shift: true }))).toHaveBeenCalled();
    expect(hub.zoomLevel).toBe(0.5);
    // Electron makes every guest follow the Hub page's zoom by itself.
    expect(guest.zoomLevel).toBe(0);
  });

  it('uses Cmd on macOS', () => {
    const { hub, type } = setup('darwin');

    expect(type(hub, ctrl('=', 'Equal'))).not.toHaveBeenCalled();
    expect(hub.zoomLevel).toBe(0);
    expect(type(hub, cmd('=', 'Equal'))).toHaveBeenCalled();
    expect(hub.zoomLevel).toBe(0.5);
  });

  it('keeps zooming while the key is held, as browsers do', () => {
    const { hub, type } = setup();
    const held = { isAutoRepeat: true };

    type(hub, ctrl('=', 'Equal'));
    type(hub, ctrl('=', 'Equal', held));
    type(hub, ctrl('=', 'Equal', held));
    expect(hub.zoomLevel).toBe(1.5);
  });

  it('leaves other keys alone', () => {
    const { guest, hub, type } = setup();

    expect(type(guest, ctrl('c', 'KeyC'))).not.toHaveBeenCalled();
    // Ctrl+W is the tab shortcuts' key.
    expect(type(hub, ctrl('w', 'KeyW'))).not.toHaveBeenCalled();
    expect(type(guest, press('+', 'NumpadAdd'))).not.toHaveBeenCalled();
    expect(
      type(hub, ctrl('=', 'Equal', { type: 'keyUp' }))
    ).not.toHaveBeenCalled();
    expect(hub.zoomLevel).toBe(0);
  });

  it('keeps the key from the page while the Hub page is gone or reloading', () => {
    const guest = new MockWebContents();
    let hub: MockWebContents | null = null;
    installZoomKeys(guest, () => hub, 'linux');
    const event = { preventDefault: vi.fn() };

    guest.emit('before-input-event', event, ctrl('=', 'Equal'));
    expect(event.preventDefault).toHaveBeenCalled();

    hub = new MockWebContents();
    hub.destroyed = true;
    expect(() =>
      guest.emit('before-input-event', event, ctrl('=', 'Equal'))
    ).not.toThrow();
    expect(hub.zoomLevel).toBe(0);
  });
});

describe('followHubZoom', () => {
  it('puts a Q-App that loads a page at the Hub page’s zoom', () => {
    const hub = new MockWebContents();
    const guest = new MockWebContents();
    hub.zoomLevel = 1;
    // What its partition kept for the site, from an earlier zoom.
    guest.zoomLevel = 2.5;
    followHubZoom(guest, () => hub);

    guest.emit('did-navigate');
    expect(guest.zoomLevel).toBe(1);

    hub.zoomLevel = -0.5;
    guest.emit('did-navigate');
    expect(guest.zoomLevel).toBe(-0.5);
  });

  it('leaves the Q-App alone once the Hub page or the Q-App is gone', () => {
    const guest = new MockWebContents();
    guest.zoomLevel = 2;
    let hub: MockWebContents | null = null;
    followHubZoom(guest, () => hub);

    expect(() => guest.emit('did-navigate')).not.toThrow();
    hub = new MockWebContents();
    hub.destroyed = true;
    expect(() => guest.emit('did-navigate')).not.toThrow();
    expect(guest.zoomLevel).toBe(2);

    hub.destroyed = false;
    guest.destroyed = true;
    expect(() => guest.emit('did-navigate')).not.toThrow();
  });
});

describe('viewMenu', () => {
  const itemsOf = (hub: MockWebContents | null) =>
    viewMenu(() => hub).submenu as MenuItemConstructorOptions[];
  const click = (items: MenuItemConstructorOptions[], label: string) =>
    items
      .find((item) => item.label === label)
      .click(undefined as never, undefined, undefined as never);

  it('is Electron’s View menu, with zoom items of its own', () => {
    const menu = viewMenu(() => null);
    const items = menu.submenu as MenuItemConstructorOptions[];

    expect(menu.label).toBe('View');
    expect(items.map((item) => item.role ?? item.label ?? item.type)).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      'separator',
      'Actual Size',
      'Zoom In',
      'Zoom Out',
      'separator',
      'togglefullscreen',
    ]);
    // A zoom role acts on the focused webContents: a Q-App, not the Hub.
    const zoomItems = items.slice(4, 7);
    expect(zoomItems.map((item) => item.role)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(zoomItems.map((item) => item.accelerator)).toEqual([
      'CommandOrControl+0',
      'CommandOrControl+Plus',
      'CommandOrControl+-',
    ]);
  });

  it('zooms the Hub page', () => {
    const hub = new MockWebContents();
    const items = itemsOf(hub);

    click(items, 'Zoom In');
    click(items, 'Zoom In');
    expect(hub.zoomLevel).toBe(1);
    click(items, 'Zoom Out');
    expect(hub.zoomLevel).toBe(0.5);
    click(items, 'Actual Size');
    expect(hub.zoomLevel).toBe(0);
  });

  it('does nothing once the Hub window is gone', () => {
    const hub = new MockWebContents();
    hub.destroyed = true;

    expect(() => click(itemsOf(null), 'Zoom In')).not.toThrow();
    expect(() => click(itemsOf(hub), 'Zoom In')).not.toThrow();
    expect(hub.zoomLevel).toBe(0);
  });
});

describe('menuPopupPoint', () => {
  it('opens the menu at the click, whatever the Hub’s zoom', () => {
    expect(menuPopupPoint({ x: 20, y: 16 }, 1)).toEqual({ x: 20, y: 16 });
    // At 150 % a CSS pixel of the page is 1.5 pixels of the window.
    expect(menuPopupPoint({ x: 20, y: 16 }, 1.5)).toEqual({ x: 30, y: 24 });
  });

  it('gives whole pixels, which menu.popup needs', () => {
    // One step in (×1.0954) rarely lands on a whole pixel.
    expect(menuPopupPoint({ x: 12.25, y: 3.5 }, 1.2 ** 0.5)).toEqual({
      x: 13,
      y: 4,
    });
  });

  it('falls back to the old place, and to no zoom', () => {
    expect(menuPopupPoint(undefined, 1)).toEqual({ x: 0, y: 32 });
    expect(menuPopupPoint({}, 1.2)).toEqual({ x: 0, y: 38 });
    expect(menuPopupPoint({ x: Number.NaN, y: 10 }, Number.NaN)).toEqual({
      x: 0,
      y: 10,
    });
    expect(menuPopupPoint({ x: 5, y: 10 }, 0)).toEqual({ x: 5, y: 10 });
  });
});

describe('each app’s own zoom', () => {
  /**
   * The Hub page; app A in two tabs and as a Home widget (one partition);
   * app B in a tab. Wired as setup.ts wires them.
   */
  const setup = (platform = 'linux') => {
    const hub = new MockWebContents();
    const tabA1 = new MockWebContents();
    const tabA2 = new MockWebContents();
    const widgetA = new MockWebContents();
    const tabB = new MockWebContents();
    const apps = new Map<MockWebContents, GuestZoomApp | null>([
      [tabA1, { kind: 'app', key: 'APP a', tabId: 'a1' }],
      [tabA2, { kind: 'app', key: 'APP a', tabId: 'a2' }],
      [widgetA, { kind: 'hub' }],
      [tabB, { kind: 'app', key: 'WEBSITE b', tabId: 'b' }],
    ]);
    const saved: Array<Map<string, SavedAppZoom>> = [];
    const changes: ZoomChange[] = [];
    configureAppZoom({
      appOf: (guest) => apps.get(guest as unknown as MockWebContents) ?? null,
      getHubPage: () => hub,
      onLevelsChange: (levels) => saved.push(new Map(levels)),
      onChange: (change) => changes.push(change),
    });
    installZoomKeys(hub, () => hub, platform);
    for (const guest of [tabA1, tabA2, widgetA, tabB]) {
      installZoomKeys(guest, () => hub, platform);
      followHubZoom(guest, () => hub);
    }
    const type = (source: MockWebContents, input = ctrl('=', 'Equal')) => {
      const event = { preventDefault: vi.fn() };
      source.emit('before-input-event', event, input);
      return event.preventDefault;
    };
    const pointerOn = (contents: MockWebContents, kind = 'mouseMove') =>
      contents.emit('before-mouse-event', {}, { type: kind, x: 5, y: 5 });
    const levels = () => ({
      hub: hub.zoomLevel,
      tabA1: tabA1.zoomLevel,
      tabA2: tabA2.zoomLevel,
      widgetA: widgetA.zoomLevel,
      tabB: tabB.zoomLevel,
    });
    return {
      apps,
      changes,
      hub,
      levels,
      pointerOn,
      saved,
      tabA1,
      tabA2,
      tabB,
      type,
      widgetA,
    };
  };

  it('zooms every webview on its own (isolated)', () => {
    const { tabA1, widgetA } = setup();

    expect(tabA1.zoomMode).toBe('isolated');
    expect(widgetA.zoomMode).toBe('isolated');
  });

  it('zooms the app the pointer is over, in all its tabs, and nothing else', () => {
    const { hub, levels, pointerOn, tabA1, type } = setup();

    pointerOn(tabA1);
    expect(type(tabA1)).toHaveBeenCalled();
    expect(levels()).toEqual({
      hub: 0,
      tabA1: 0.5,
      tabA2: 0.5,
      widgetA: 0,
      tabB: 0,
    });
    // A key typed in the Hub page (the search bar, say) does the same while
    // the pointer is on the app.
    type(hub);
    expect(levels()).toMatchObject({ hub: 0, tabA1: 1, tabA2: 1, widgetA: 0 });
  });

  it('zooms Hub while the pointer is on Hub’s own parts, also for a key typed in an app', () => {
    const { hub, levels, pointerOn, tabA1, type } = setup();

    pointerOn(hub);
    type(tabA1);
    expect(levels()).toEqual({
      hub: 0.5,
      tabA1: 0.5,
      tabA2: 0.5,
      widgetA: 0.5,
      tabB: 0.5,
    });
  });

  it('zooms Hub while the pointer is on a Home widget', () => {
    const { hub, levels, pointerOn, type, widgetA } = setup();

    pointerOn(widgetA);
    type(hub);
    expect(levels()).toMatchObject({ hub: 0.5, widgetA: 0.5, tabA1: 0.5 });
    type(widgetA, ctrl('0', 'Digit0'));
    expect(levels()).toMatchObject({ hub: 0, widgetA: 0, tabA1: 0 });
  });

  it('lets the keyboard decide while the pointer is outside the window', () => {
    const { hub, levels, pointerOn, tabA1, type } = setup();

    pointerOn(hub);
    pointerOn(hub, 'mouseLeave');
    // Typed in the app on screen: that app.
    setZoomScreen({ tabId: 'a1', locked: false });
    type(tabA1);
    expect(levels()).toMatchObject({ hub: 0, tabA1: 0.5, tabB: 0 });
    // Typed in the Hub page: the app on screen.
    setZoomScreen({ tabId: 'b', locked: false });
    type(hub);
    expect(levels()).toMatchObject({ hub: 0, tabA1: 0.5, tabB: 0.5 });
    // No app on screen (Home, a Hub page, a Hub window with the keyboard):
    // Hub.
    setZoomScreen({ tabId: null, locked: false });
    type(hub);
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 1, tabB: 1 });
  });

  it('zooms the app on screen, not a hidden tab that kept the keyboard', () => {
    const { levels, pointerOn, tabA1, type, widgetA } = setup();

    // A link in app A opens app B in a new tab: Hub switches tabs without
    // moving the keyboard, which stays in A's page, now hidden.
    setZoomScreen({ tabId: 'a1', locked: false });
    pointerOn(tabA1);
    setZoomScreen({ tabId: 'b', locked: false });
    // Ctrl+= before the pointer moves again.
    type(tabA1);
    expect(levels()).toEqual({
      hub: 0,
      tabA1: 0,
      tabA2: 0,
      widgetA: 0,
      tabB: 0.5,
    });
    // The keyboard left in a Home widget: Hub.
    type(widgetA);
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 0.5, tabB: 1 });
  });

  it('keeps each app’s difference when Hub zooms', () => {
    const { hub, levels, pointerOn, tabA1, tabB, type } = setup();

    pointerOn(tabA1);
    type(tabA1);
    type(tabA1);
    pointerOn(tabB);
    type(tabB, ctrl('-', 'Minus'));
    pointerOn(hub);
    type(hub);
    expect(levels()).toEqual({
      hub: 0.5,
      tabA1: 1.5,
      tabA2: 1.5,
      widgetA: 0.5,
      tabB: 0,
    });
    type(hub, ctrl('0', 'Digit0'));
    expect(levels()).toMatchObject({ hub: 0, tabA1: 1, tabB: -0.5 });
  });

  it('brings an app back to Hub’s zoom with Ctrl+0, and forgets its own', () => {
    const { hub, levels, pointerOn, saved, tabA1, type } = setup();

    pointerOn(hub);
    type(hub);
    pointerOn(tabA1);
    type(tabA1);
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 1 });
    expect([...saved[saved.length - 1].keys()]).toEqual(['APP a']);
    type(tabA1, ctrl('0', 'Digit0'));
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 0.5, tabA2: 0.5 });
    expect(saved[saved.length - 1].size).toBe(0);
    // Stepping back to Hub's zoom forgets it too.
    type(tabA1);
    type(tabA1, ctrl('-', 'Minus'));
    expect(saved[saved.length - 1].size).toBe(0);
  });

  it('keeps an app inside Chromium’s limits, together with Hub’s zoom', () => {
    const { hub, levels, pointerOn, tabA1, type } = setup();

    hub.zoomLevel = MAX_ZOOM_LEVEL - 0.5;
    pointerOn(tabA1);
    type(tabA1);
    type(tabA1);
    type(tabA1);
    expect(levels()).toMatchObject({
      tabA1: MAX_ZOOM_LEVEL,
      tabA2: MAX_ZOOM_LEVEL,
    });
    expect(appZoomState('a1').app).toEqual({
      level: 0.5,
      canIn: false,
      canOut: true,
    });
    // Hub zoomed to its top: the app stays at the top too, not past it.
    pointerOn(hub);
    type(hub);
    expect(levels()).toMatchObject({
      hub: MAX_ZOOM_LEVEL,
      tabA1: MAX_ZOOM_LEVEL,
      widgetA: MAX_ZOOM_LEVEL,
    });
    type(hub, ctrl('-', 'Minus'));
    expect(levels()).toMatchObject({
      hub: MAX_ZOOM_LEVEL - 0.5,
      tabA1: MAX_ZOOM_LEVEL,
    });
    pointerOn(tabA1);
    // One step out is one step, from what is on screen.
    type(tabA1, ctrl('-', 'Minus'));
    expect(levels().tabA1).toBe(MAX_ZOOM_LEVEL - 0.5);
    expect(appZoomState('a1').app.level).toBe(0);

    hub.zoomLevel = MIN_ZOOM_LEVEL;
    type(tabA1, ctrl('-', 'Minus'));
    expect(levels().tabA1).toBe(MIN_ZOOM_LEVEL);
    expect(appZoomState('a1').app).toMatchObject({ canOut: false });
  });

  it('puts a webview that loads a page at its app’s zoom, and a widget at the Hub’s', () => {
    const { hub, pointerOn, tabA1, tabA2, type, widgetA } = setup();

    pointerOn(tabA1);
    type(tabA1);
    hub.zoomLevel = 1;
    // What each had before: an older level, or one a widget picked up.
    tabA2.zoomLevel = 3;
    widgetA.zoomLevel = 2;
    tabA2.emit('did-navigate');
    widgetA.emit('did-navigate');
    expect(tabA2.zoomLevel).toBe(1.5);
    expect(widgetA.zoomLevel).toBe(1);
  });

  it('gives a webview whose app Hub doesn’t know yet the Hub’s zoom', () => {
    const { apps, hub, pointerOn, tabA1, type } = setup();

    pointerOn(tabA1);
    type(tabA1);
    apps.set(tabA1, null);
    tabA1.emit('did-navigate');
    expect(tabA1.zoomLevel).toBe(hub.zoomLevel);
    // Once Hub knows it (the guest said hello), its next page has its zoom.
    apps.set(tabA1, { kind: 'app', key: 'APP a', tabId: 'a1' });
    tabA1.emit('did-navigate');
    expect(tabA1.zoomLevel).toBe(0.5);
  });

  it('puts a webview at its app’s zoom once its page is there, if Hub only learnt its app then', () => {
    const { apps, changes, pointerOn, tabA1, tabA2, type } = setup();

    pointerOn(tabA1);
    type(tabA1);
    // Its first page, under an address Hub didn't prepare (a redirect, say):
    // not known yet.
    apps.set(tabA2, null);
    tabA2.zoomLevel = 0;
    tabA2.emit('did-navigate');
    expect(tabA2.zoomLevel).toBe(0);
    // Its hello came: on dom-ready it gets the app's zoom, and the magnifier
    // is told to ask again.
    apps.set(tabA2, { kind: 'app', key: 'APP a', tabId: 'a2' });
    changes.length = 0;
    tabA2.emit('dom-ready');
    expect(tabA2.zoomLevel).toBe(0.5);
    expect(changes).toEqual([
      { what: 'app', key: 'APP a', tabIds: ['a2'], source: 'load' },
    ]);
  });

  it('forgets a pointer last seen on a guest when the tab on screen changes', () => {
    const { hub, levels, pointerOn, tabA1, type } = setup();

    setZoomScreen({ tabId: 'a1', locked: false });
    pointerOn(tabA1);
    // Ctrl+Tab: app B is under the pointer now, which hasn't moved.
    setZoomScreen({ tabId: 'b', locked: false });
    type(hub);
    expect(levels()).toMatchObject({ tabA1: 0, tabB: 0.5, hub: 0 });
  });

  it('keeps a pointer on Hub’s parts when the tab on screen changes', () => {
    const { hub, levels, pointerOn, type } = setup();

    pointerOn(hub);
    // A click on another tab in the strip, then a key: still Hub.
    setZoomScreen({ tabId: 'b', locked: false });
    type(hub);
    expect(levels()).toMatchObject({ hub: 0.5, tabB: 0.5 });
  });

  it('zooms only Hub while Hub is locked', () => {
    const { levels, pointerOn, tabA1, type } = setup();

    setZoomScreen({ tabId: 'a1', locked: true });
    pointerOn(tabA1);
    type(tabA1);
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 0.5, tabA2: 0.5 });
    expect(appZoomState('a1').app.level).toBe(0);
  });

  it('forgets a pointer on a webview that is gone', () => {
    const { hub, levels, pointerOn, tabA1, type } = setup();

    setZoomScreen({ tabId: 'b', locked: false });
    pointerOn(tabA1);
    tabA1.destroy();
    type(hub);
    expect(levels()).toMatchObject({ tabB: 0.5, tabA2: 0, hub: 0 });
  });

  it('zooms with Ctrl+wheel where the wheel turns, one step a notch', () => {
    const { hub, levels, tabA1, widgetA } = setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    tabA1.emit('zoom-changed', {}, 'in');
    // The same notch reported twice.
    tabA1.emit('zoom-changed', {}, 'in');
    expect(levels()).toMatchObject({ hub: 0, tabA1: 0.5, tabA2: 0.5 });
    now.mockReturnValue(1_100);
    tabA1.emit('zoom-changed', {}, 'in');
    expect(levels().tabA1).toBe(1);
    // Over Hub's parts and over a widget: Hub.
    hub.emit('zoom-changed', {}, 'out');
    widgetA.emit('zoom-changed', {}, 'in');
    now.mockReturnValue(1_200);
    widgetA.emit('zoom-changed', {}, 'in');
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 1.5, widgetA: 0.5 });
    tabA1.emit('zoom-changed', {}, 'sideways');
    expect(levels().tabA1).toBe(1.5);
    now.mockRestore();
  });

  it('zooms what the magnifier shows while the pointer is on it', () => {
    const { hub, levels, pointerOn, type } = setup();

    pointerOn(hub);
    setZoomPanelPointer('a1');
    pointerOn(hub);
    type(hub);
    expect(levels()).toMatchObject({ hub: 0, tabA1: 0.5 });
    hub.emit('zoom-changed', {}, 'in');
    expect(levels()).toMatchObject({ hub: 0, tabA1: 1 });
    // Off the magnifier, onto the bar: Hub again.
    setZoomPanelPointer(undefined);
    type(hub);
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 1.5 });
    // A magnifier for Hub.
    setZoomPanelPointer(null);
    type(hub);
    expect(levels()).toMatchObject({ hub: 1, tabA1: 2 });
  });

  it('tells the Hub page when the pointer leaves the magnifier without its knowing', () => {
    const { changes, hub, pointerOn, tabA1 } = setup();

    pointerOn(hub);
    setZoomPanelPointer('a1');
    pointerOn(hub);
    expect(changes).toEqual([]);
    // From the panel straight onto the app's page: the Hub page gets no
    // pointerleave for it.
    pointerOn(tabA1);
    expect(changes).toEqual([{ what: 'pointer' }]);
    pointerOn(tabA1);
    pointerOn(hub);
    expect(changes).toEqual([{ what: 'pointer' }]);
    // Out of the window from Hub's magnifier.
    setZoomPanelPointer(null);
    pointerOn(hub, 'mouseLeave');
    expect(changes).toEqual([{ what: 'pointer' }, { what: 'pointer' }]);
    // The Hub page saw the pointer leave: nothing to tell it.
    setZoomPanelPointer('a1');
    setZoomPanelPointer(undefined);
    pointerOn(tabA1);
    expect(changes).toHaveLength(2);
  });

  it('forgets the pointer on the magnifier when the tab on screen changes', () => {
    const { hub, levels, type } = setup();

    setZoomScreen({ tabId: 'a1', locked: false });
    setZoomPanelPointer('a1');
    setZoomScreen({ tabId: 'b', locked: false });
    type(hub);
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 0.5, tabB: 0.5 });
  });

  it('zooms with the View menu the app on screen, wherever the pointer is', () => {
    const { hub, levels, pointerOn, tabA1 } = setup();
    const items = viewMenu(() => hub).submenu as MenuItemConstructorOptions[];
    const click = (label: string) =>
      items
        .find((item) => item.label === label)
        .click(undefined as never, undefined, undefined as never);

    // No app on screen: Hub.
    pointerOn(hub);
    click('Zoom In');
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 0.5 });
    // An app on screen, the menu opened from the title bar: the app.
    setZoomScreen({ tabId: 'a1', locked: false });
    pointerOn(hub);
    click('Zoom In');
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 1 });
    // From macOS's menu bar, outside the window: the same.
    pointerOn(hub, 'mouseLeave');
    click('Zoom In');
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 1.5 });
    click('Actual Size');
    expect(levels()).toMatchObject({ hub: 0.5, tabA1: 0.5 });
    // Locked: Hub only.
    setZoomScreen({ tabId: 'a1', locked: true });
    click('Zoom In');
    expect(levels()).toMatchObject({ hub: 1, tabA1: 1 });
  });

  it('tells the Hub page what changed, and how', () => {
    const { changes, hub, pointerOn, tabA1, type } = setup();

    pointerOn(tabA1);
    type(tabA1);
    pointerOn(hub);
    type(hub);
    changeZoom({ tabId: 'b' }, 'in');
    changeZoom('hub', 'reset');
    expect(changes).toEqual([
      { what: 'app', key: 'APP a', tabIds: ['a1', 'a2'], source: 'keys' },
      { what: 'hub', source: 'keys' },
      { what: 'app', key: 'WEBSITE b', tabIds: ['b'], source: 'panel' },
      { what: 'hub', source: 'panel' },
    ]);
  });

  it('answers the magnifier: the Hub’s zoom, and the app’s on top of it', () => {
    const { hub, pointerOn, tabA1, type } = setup();

    hub.zoomLevel = 1;
    pointerOn(tabA1);
    type(tabA1);
    expect(appZoomState('a2')).toEqual({
      hub: { level: 1, canIn: true, canOut: true },
      app: { level: 0.5, canIn: true, canOut: true },
    });
    expect(appZoomState('b').app.level).toBe(0);
    // No tab, or a tab whose app isn't loaded or known.
    expect(appZoomState(null).app).toBeNull();
    expect(appZoomState('not-open').app).toBeNull();
    changeZoom({ tabId: 'not-open' }, 'in');
    expect(hub.zoomLevel).toBe(1);
  });

  it('takes the saved levels at start; a level set before the read stays', () => {
    const { hub, pointerOn, tabA1, tabB, type } = setup();

    pointerOn(tabB);
    type(tabB, ctrl('-', 'Minus'));
    loadAppZoomLevels([
      ['APP a', { level: 1, at: 5 }],
      ['WEBSITE b', { level: 2, at: 5 }],
    ]);
    expect(tabA1.zoomLevel).toBe(1);
    expect(tabB.zoomLevel).toBe(-0.5);
    expect(appZoomState('b').app.level).toBe(-0.5);
    expect(hub.zoomLevel).toBe(0);
  });

  it('works as before without any app known', () => {
    resetAppZoomForTests();
    const hub = new MockWebContents();
    const guest = new MockWebContents();
    installZoomKeys(hub, () => hub, 'linux');
    installZoomKeys(guest, () => hub, 'linux');
    followHubZoom(guest, () => hub);
    guest.emit('before-mouse-event', {}, { type: 'mouseMove' });

    guest.emit(
      'before-input-event',
      { preventDefault: vi.fn() },
      ctrl('=', 'Equal')
    );
    expect(hub.zoomLevel).toBe(0.5);
    expect(guest.zoomLevel).toBe(0.5);
  });
});
