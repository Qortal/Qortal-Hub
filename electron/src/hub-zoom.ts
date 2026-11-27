/**
 * Zoom for the Hub and for each Q-App or website on its own: View → Actual
 * Size, Zoom In and Zoom Out, their keys (Ctrl+0, Ctrl+= or Ctrl++, Ctrl+-,
 * the keypad's 0, + and - too; Cmd on macOS), and Ctrl+mouse wheel.
 *
 * Electron's zoom roles act on the focused webContents. With Q-Apps, websites
 * and widgets in <webview>s, that is a guest (the newest one, even in a hidden
 * tab), never the Hub page. Keys typed in a guest never reach the menu either.
 * So main zooms each page itself.
 *
 * What the keys and the wheel zoom is what the pointer is over: over a
 * Q-App's or website's tab, that app; over any other part of the window
 * (Hub's bars, Home and its widgets, Hub's windows and dialogs), the Hub
 * page. With the pointer outside the window, the keyboard decides: a key typed
 * in the app on screen zooms that app, one typed in the Hub page the app on
 * screen too, unless one of Hub's windows has the keyboard. The View menu
 * zooms the app on screen, or the Hub page with none.
 *
 * An app's own zoom sits on top of the Hub's: zooming the Hub moves every app,
 * and each keeps its own difference. Every guest zooms on its own (Electron's
 * isolated mode), so an app's Home widget, which shares the app's partition,
 * stays at the Hub's zoom, and nothing is saved in the partitions.
 *
 * Kept free of Electron imports, so it runs in tests as it is.
 */
import type { MenuItemConstructorOptions } from 'electron';
import type { TabShortcutKey } from './tab-shortcuts';

export type ZoomAction = 'in' | 'out' | 'reset';

/** Half a zoom level a step (×1.2 a level), as Electron's zoom roles step. */
export const ZOOM_STEP = 0.5;
/**
 * Chromium shows pages at 25 % to 500 % (levels −7.6 to 8.8). The steps stop
 * at the last ones inside, so no press is lost at either end.
 */
export const MIN_ZOOM_LEVEL = -7.5;
export const MAX_ZOOM_LEVEL = 8.5;

export function nextZoomLevel(level: number, action: ZoomAction): number {
  if (action === 'reset' || !Number.isFinite(level)) return 0;
  const next = level + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP);
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, next));
}

const clampLevel = (level: number) =>
  Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level));

/** As Chromium compares zoom levels. */
const sameLevel = (a: number, b: number) => Math.abs(a - b) < 0.001;

/**
 * The zoom a key press asks for on this platform (`process.platform`), or
 * null to leave the key to the page.
 */
export function resolveZoomKey(
  input: TabShortcutKey,
  platform: string
): ZoomAction | null {
  if (input.type !== 'keyDown' || input.isComposing) return null;
  const { alt, code, control, key, meta, shift } = input;
  // Windows reports AltGr as Ctrl+Alt, so a chord with Alt is typing.
  if (alt) return null;
  // Cmd on macOS, where Ctrl+letter keys edit text, and Ctrl elsewhere;
  // never both.
  if (platform === 'darwin' ? control || !meta : meta || !control) return null;
  // Plus and minus go by what the key types, with Shift or without, as in
  // browsers: on a US keyboard + is Shift+=, on a German one it has a key of
  // its own. The keypad types + and - too.
  if (key === '=' || key === '+') return 'in';
  if (key === '-' || key === '_') return 'out';
  // 0 goes by the key's place, so Ctrl+0 also works where the digit row needs
  // Shift (AZERTY). The keypad's 0 counts only with Num Lock on: without it,
  // that key is Insert, and Ctrl+Insert copies.
  if (shift) return null;
  if (code === 'Digit0' || (code === 'Numpad0' && key === '0')) {
    return 'reset';
  }
  return null;
}

/** A webContents whose zoom is read and set: the Hub page or a guest. */
export type ZoomTarget = {
  isDestroyed(): boolean;
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
};

/**
 * A guest's webContents: a Q-App, a website or a Home widget. Typed loosely,
 * so Electron's WebContents and the tests' fakes both fit.
 */
type Guest = ZoomTarget & {
  on(event: string, listener: (...args: any[]) => void): unknown;
  setZoomMode?(mode: 'default' | 'isolated' | 'manual' | 'disabled'): void;
};

/** What a guest shows, as far as zoom goes. */
export type GuestZoomApp =
  /** A Q-App's or website's tab; its own zoom is kept under `key`. */
  | { kind: 'app'; key: string; tabId: string }
  /** A Home widget or a screenshot preview: always at the Hub's zoom. */
  | { kind: 'hub' };

/** What a zoom applies to. */
type Zoomed = { kind: 'hub' } | { kind: 'app'; key: string };
const HUB: Zoomed = { kind: 'hub' };

/**
 * How a zoom was asked for: the user's keys, the menu, the wheel or the
 * magnifier's own buttons; or `load`: a page loaded, or the saved levels
 * were read, and the magnifier asks again (nothing changed for the user).
 */
export type ZoomSource = 'keys' | 'menu' | 'wheel' | 'panel' | 'load';

/**
 * Sent to the Hub page after every change, for its magnifier. `pointer`: the
 * pointer left the magnifier or its panel, for an app's page or out of the
 * window. Going straight onto a webview, the Hub page gets no pointerleave.
 */
export type ZoomChange =
  | { what: 'hub'; source: ZoomSource }
  | { what: 'app'; key: string; tabIds: string[]; source: ZoomSource }
  | { what: 'pointer' };

/** An app's own zoom, in levels on top of the Hub's, and when it was set. */
export type SavedAppZoom = { level: number; at: number };

export type AppZoomDeps = {
  /** The app a guest shows, or null while Hub doesn't know it yet. */
  appOf(guest: Guest): GuestZoomApp | null;
  getHubPage(): ZoomTarget | null;
  /** Called before the levels are first needed: read them then. */
  beforeUse?(): void;
  /** Each app's own zoom changed: save them. */
  onLevelsChange?(levels: ReadonlyMap<string, SavedAppZoom>): void;
  onChange?(change: ZoomChange): void;
};

/** Where the pointer is, as the last mouse event said. */
type Pointer =
  | { over: 'hub' }
  | { over: 'guest'; guest: Guest }
  /** On the magnifier or its panel, which zoom the app on screen or Hub. */
  | { over: 'panel'; tabId: string | null }
  /** Outside the window, or not known. */
  | null;

/** One Hub window, one zoom state: kept here, reset by tests. */
const state = {
  deps: null as AppZoomDeps | null,
  levels: new Map<string, SavedAppZoom>(),
  guests: new Set<Guest>(),
  pointer: null as Pointer,
  /** The app tab on screen, as the Hub page reports it. */
  screen: { tabId: null as string | null, locked: false },
  /** When each page last zoomed by wheel, to take one step a notch. */
  lastWheel: new WeakMap<object, number>(),
};

/** Wheel notches closer together than this zoom one step. */
const WHEEL_STEP_MS = 60;

export function configureAppZoom(deps: AppZoomDeps): void {
  state.deps = deps;
}

/** For tests: forgets every guest, level and report. */
export function resetAppZoomForTests(): void {
  state.deps = null;
  state.levels = new Map();
  state.guests = new Set();
  state.pointer = null;
  state.screen = { tabId: null, locked: false };
  state.lastWheel = new WeakMap();
}

const ownLevel = (key: string) => state.levels.get(key)?.level ?? 0;

const appOf = (guest: Guest): GuestZoomApp | null => {
  if (!state.deps || guest.isDestroyed()) return null;
  try {
    return state.deps.appOf(guest);
  } catch {
    return null;
  }
};

/** The level a guest should be at, with the Hub page at `hubLevel`. */
function levelFor(guest: Guest, hubLevel: number): number {
  const app = appOf(guest);
  return app?.kind === 'app'
    ? clampLevel(hubLevel + ownLevel(app.key))
    : hubLevel;
}

function applyGuest(guest: Guest, hub: ZoomTarget): void {
  if (guest.isDestroyed() || hub.isDestroyed()) return;
  const level = levelFor(guest, hub.getZoomLevel());
  if (!sameLevel(guest.getZoomLevel(), level)) guest.setZoomLevel(level);
}

/**
 * Puts every guest at its level. Electron moves every guest to the Hub page's
 * level when the Hub page zooms (isolated ones too, at once); the apps with a
 * zoom of their own go back on top of it here, in the same call.
 */
function putGuestsBack(hub: ZoomTarget): void {
  for (const guest of state.guests) applyGuest(guest, hub);
}

const guestsOf = (key: string) =>
  [...state.guests].filter((guest) => {
    const app = appOf(guest);
    return app?.kind === 'app' && app.key === key;
  });

function zoomedOfGuest(guest: Guest): Zoomed {
  const app = appOf(guest);
  return app?.kind === 'app' ? { kind: 'app', key: app.key } : HUB;
}

/** The app of a tab, while its guest is attached and known. */
function zoomedOfTab(tabId: string): Zoomed | null {
  for (const guest of state.guests) {
    const app = appOf(guest);
    if (app?.kind === 'app' && app.tabId === tabId) {
      return { kind: 'app', key: app.key };
    }
  }
  return null;
}

/** The app on screen, or Hub. */
function zoomedOnScreen(): Zoomed {
  if (state.screen.locked) return HUB;
  return (state.screen.tabId && zoomedOfTab(state.screen.tabId)) || HUB;
}

/** What a key typed in `source` zooms now. */
function zoomedFor(source: object | null): Zoomed {
  if (state.screen.locked) return HUB;
  const pointer = state.pointer;
  if (pointer?.over === 'panel') {
    return (pointer.tabId && zoomedOfTab(pointer.tabId)) || HUB;
  }
  if (pointer?.over === 'guest' && !pointer.guest.isDestroyed()) {
    return zoomedOfGuest(pointer.guest);
  }
  if (pointer?.over === 'hub') return HUB;
  // The pointer is outside the window, or not known since another tab came
  // on screen: what is on screen, wherever the keyboard is. A tab another
  // one replaced (an app opening a tab, a link) can keep it. A Home widget
  // with the keyboard: Hub.
  if (
    source &&
    state.guests.has(source as Guest) &&
    appOf(source as Guest)?.kind !== 'app'
  ) {
    return HUB;
  }
  return zoomedOnScreen();
}

function applyZoom(
  zoomed: Zoomed,
  hub: ZoomTarget | null,
  action: ZoomAction,
  source: ZoomSource
): void {
  if (!hub || hub.isDestroyed()) return;
  if (zoomed.kind === 'hub') {
    hub.setZoomLevel(nextZoomLevel(hub.getZoomLevel(), action));
    putGuestsBack(hub);
    state.deps?.onChange?.({ what: 'hub', source });
    return;
  }
  const hubLevel = hub.getZoomLevel();
  const current = clampLevel(hubLevel + ownLevel(zoomed.key));
  // Reset goes back to the Hub's zoom, and forgets the app's own.
  const next = action === 'reset' ? hubLevel : nextZoomLevel(current, action);
  const own = next - hubLevel;
  if (sameLevel(own, 0)) state.levels.delete(zoomed.key);
  else state.levels.set(zoomed.key, { level: own, at: Date.now() });
  const guests = guestsOf(zoomed.key);
  guests.forEach((guest) => applyGuest(guest, hub));
  state.deps?.onLevelsChange?.(state.levels);
  const tabIds = guests
    .map((guest) => appOf(guest))
    .map((app) => (app?.kind === 'app' ? app.tabId : ''))
    .filter(Boolean);
  state.deps?.onChange?.({ what: 'app', key: zoomed.key, tabIds, source });
}

/**
 * Keeps a guest at its zoom: the Hub page's, or for an app with a zoom of its
 * own, that on top of the Hub's. It zooms on its own (isolated), keeps its
 * level across its own pages, and gets it again on each page it loads, for
 * the first page and in case Hub learnt which app it shows since.
 */
export function followHubZoom(
  guest: Guest,
  getHubPage: () => ZoomTarget | null
): void {
  try {
    guest.setZoomMode?.('isolated');
  } catch {
    // A guest gone already: nothing to keep.
  }
  state.deps?.beforeUse?.();
  state.guests.add(guest);
  guest.on('destroyed', () => {
    state.guests.delete(guest);
    if (state.pointer?.over === 'guest' && state.pointer.guest === guest) {
      state.pointer = null;
    }
  });
  const loaded = () => {
    const hub = getHubPage();
    if (!hub || hub.isDestroyed() || guest.isDestroyed()) return;
    applyGuest(guest, hub);
    // The magnifier asks again: it may have asked before this app was known.
    const app = appOf(guest);
    if (app?.kind === 'app') {
      state.deps?.onChange?.({
        what: 'app',
        key: app.key,
        tabIds: [app.tabId],
        source: 'load',
      });
    }
  };
  guest.on('did-navigate', loaded);
  // Again once the page is there: Hub may only have learnt since which app
  // the guest shows (its hello), after a redirect, say.
  guest.on('dom-ready', loaded);
}

/** A webContents whose key presses and pointer are read: the Hub page or a guest. */
type InputSource = {
  on(event: string, listener: (...args: any[]) => void): unknown;
};

/** The mouse events that say the pointer is on a page. */
const POINTER_ON = new Set([
  'mouseDown',
  'mouseUp',
  'mouseEnter',
  'mouseMove',
  'contextMenu',
]);

function notePointer(source: object, type: unknown): void {
  const onPanel = state.pointer?.over === 'panel';
  if (type === 'mouseLeave') {
    const pointer = state.pointer;
    const left =
      pointer?.over === 'guest'
        ? pointer.guest === source
        : !state.guests.has(source as Guest);
    if (left) state.pointer = null;
  } else if (typeof type === 'string' && POINTER_ON.has(type)) {
    if (state.guests.has(source as Guest)) {
      state.pointer = { over: 'guest', guest: source as Guest };
    } else if (!onPanel) {
      // The Hub page; on the magnifier, the Hub page says when the pointer
      // leaves it.
      state.pointer = { over: 'hub' };
    }
  }
  // Off the magnifier without the Hub page seeing it (onto an app's page):
  // its panel would wait for the pointer forever.
  if (onPanel && state.pointer?.over !== 'panel') {
    state.deps?.onChange?.({ what: 'pointer' });
  }
}

/**
 * Takes the zoom keys typed in `source` and zooms what the pointer is over
 * (see the top of this file). Other keys go on to the page as before. Also
 * notes where the pointer is, and zooms on Ctrl+wheel over `source`.
 */
export function installZoomKeys(
  source: InputSource,
  getHubPage: () => ZoomTarget | null,
  platform: string
): void {
  source.on('before-input-event', (event, input) => {
    const action = resolveZoomKey(input, platform);
    if (!action) return;
    // The key is the Hub's: it reaches neither the page nor the View menu's
    // own shortcut, which would zoom a second time.
    event.preventDefault();
    applyZoom(zoomedFor(source), getHubPage(), action, 'keys');
  });
  source.on('before-mouse-event', (_event, mouse) => {
    notePointer(source, mouse?.type);
  });
  // Ctrl+wheel the page didn't take for itself (maps, image viewers do).
  source.on('zoom-changed', (_event, direction) => {
    if (direction !== 'in' && direction !== 'out') return;
    const now = Date.now();
    const last = state.lastWheel.get(source);
    if (last !== undefined && now - last < WHEEL_STEP_MS) return;
    state.lastWheel.set(source, now);
    const zoomed = state.guests.has(source as Guest)
      ? zoomedOfGuest(source as Guest)
      : state.pointer?.over === 'panel' && state.pointer.tabId
        ? zoomedOfTab(state.pointer.tabId) || HUB
        : HUB;
    applyZoom(zoomed, getHubPage(), direction, 'wheel');
  });
}

/**
 * The View menu, laid out as Electron's viewMenu role lays it out, with the
 * same labels and keys. Its zoom items zoom the app on screen, or the Hub
 * page with none (or while Hub is locked).
 */
export function viewMenu(
  getHubPage: () => ZoomTarget | null
): MenuItemConstructorOptions {
  // Not by the pointer: it is on the menu, which on some systems the Hub
  // page sees it go to and on others not.
  const zoom = (action: ZoomAction) => () => {
    applyZoom(zoomedOnScreen(), getHubPage(), action, 'menu');
  };
  return {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: 'Actual Size',
        accelerator: 'CommandOrControl+0',
        click: zoom('reset'),
      },
      {
        label: 'Zoom In',
        accelerator: 'CommandOrControl+Plus',
        click: zoom('in'),
      },
      {
        label: 'Zoom Out',
        accelerator: 'CommandOrControl+-',
        click: zoom('out'),
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };
}

/**
 * The Hub page's report of what it shows: the tab of the Q-App or website on
 * screen (null for Home, Hub's own pages, or one of Hub's windows with the
 * keyboard), and whether Hub is locked. A pointer last seen on a guest may
 * be on another one now, so it counts as not known until it moves.
 */
export function setZoomScreen(screen: {
  tabId: string | null;
  locked: boolean;
}): void {
  const changed =
    screen.tabId !== state.screen.tabId ||
    screen.locked !== state.screen.locked;
  state.screen = { tabId: screen.tabId, locked: screen.locked };
  if (!changed) return;
  if (state.pointer?.over === 'guest') state.pointer = null;
  // The magnifier now shows another app's zoom, or Hub's; the Hub page says
  // again when the pointer is on it.
  if (state.pointer?.over === 'panel') state.pointer = { over: 'hub' };
}

/**
 * The pointer is on the magnifier or its panel, which zoom the app of
 * `tabId` (null: Hub). Undefined: it left them, onto the Hub page.
 */
export function setZoomPanelPointer(tabId: string | null | undefined): void {
  if (tabId === undefined) {
    if (state.pointer?.over === 'panel') state.pointer = { over: 'hub' };
    return;
  }
  state.pointer = { over: 'panel', tabId };
}

/** Takes the saved levels (read at start) and puts every guest at its own. */
export function loadAppZoomLevels(
  levels: Iterable<[string, SavedAppZoom]>
): void {
  // A level set before the file was read stays: it is the newer.
  const next = new Map(levels);
  state.levels.forEach((saved, key) => next.set(key, saved));
  state.levels = next;
  const hub = state.deps?.getHubPage() ?? null;
  if (hub && !hub.isDestroyed()) putGuestsBack(hub);
  state.deps?.onChange?.({ what: 'hub', source: 'load' });
}

/** What the magnifier shows: the Hub's zoom, and the zoom of a tab's app. */
export type AppZoomState = {
  hub: { level: number; canIn: boolean; canOut: boolean };
  /** Null while the tab's app isn't known (no tab, or not loaded yet). */
  app: {
    /** On top of the Hub's, as the app shows it now (within the limits). */
    level: number;
    canIn: boolean;
    canOut: boolean;
  } | null;
};

export function appZoomState(tabId: string | null): AppZoomState {
  const hub = state.deps?.getHubPage() ?? null;
  const hubLevel = hub && !hub.isDestroyed() ? hub.getZoomLevel() : 0;
  const zoomed = tabId ? zoomedOfTab(tabId) : null;
  let app: AppZoomState['app'] = null;
  if (zoomed?.kind === 'app') {
    const level = clampLevel(hubLevel + ownLevel(zoomed.key));
    app = {
      level: level - hubLevel,
      canIn: level < MAX_ZOOM_LEVEL,
      canOut: level > MIN_ZOOM_LEVEL,
    };
  }
  return {
    hub: {
      level: hubLevel,
      canIn: hubLevel < MAX_ZOOM_LEVEL,
      canOut: hubLevel > MIN_ZOOM_LEVEL,
    },
    app,
  };
}

/**
 * The magnifier's buttons: zooms the app of `tabId`, or Hub. A tab whose app
 * isn't known yet zooms nothing.
 */
export function changeZoom(
  target: { tabId: string } | 'hub',
  action: ZoomAction
): void {
  const hub = state.deps?.getHubPage() ?? null;
  if (target === 'hub') {
    applyZoom(HUB, hub, action, 'panel');
    return;
  }
  const zoomed = zoomedOfTab(target.tabId);
  if (zoomed) applyZoom(zoomed, hub, action, 'panel');
}

/**
 * Where the title bar's menu opens. The page sends its click in CSS pixels;
 * the menu takes window pixels, which the Hub's zoom scales, and whole ones
 * only (Electron throws on 12.5).
 */
export function menuPopupPoint(
  point: { x?: number; y?: number } | null | undefined,
  zoomFactor: number
): { x: number; y: number } {
  const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const at = (value: unknown, fallback: number) =>
    Math.round((Number.isFinite(value) ? (value as number) : fallback) * scale);
  return { x: at(point?.x, 0), y: at(point?.y, 32) };
}
