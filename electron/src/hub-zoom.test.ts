import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MockWebContents } from '../../src/test/mocks/electron';
import {
  followHubZoom,
  installZoomKeys,
  MAX_ZOOM_LEVEL,
  menuPopupPoint,
  MIN_ZOOM_LEVEL,
  nextZoomLevel,
  resolveZoomKey,
  viewMenu,
  ZOOM_STEP,
  type ZoomAction,
} from './hub-zoom';
import { resolveTabShortcut, type TabShortcutKey } from './tab-shortcuts';

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
