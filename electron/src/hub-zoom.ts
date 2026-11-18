/**
 * Zoom for the whole Hub: View → Actual Size, Zoom In and Zoom Out, and their
 * keys: Ctrl+0, Ctrl+= (or Ctrl++) and Ctrl+-, the keypad's 0, + and - too
 * (Cmd on macOS).
 *
 * Electron's zoom roles act on the focused webContents. With Q-Apps, websites
 * and widgets in <webview>s, that is a guest (the newest one, even in a hidden
 * tab), never the Hub page. Keys typed in a guest never reach the menu either.
 * So main zooms the Hub page itself, and every guest is kept at its zoom, as
 * the iframes were.
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

export function zoomHub(hub: ZoomTarget | null, action: ZoomAction): void {
  if (!hub || hub.isDestroyed()) return;
  hub.setZoomLevel(nextZoomLevel(hub.getZoomLevel(), action));
}

/** A guest's webContents: a Q-App, a website or a Home widget. */
type Guest = ZoomTarget & {
  on(event: 'did-navigate', listener: () => void): unknown;
};

/**
 * Puts a guest at the Hub page's zoom whenever it loads a page. Electron
 * makes open guests follow each change of the Hub page's zoom, and saves the
 * level for the guest's site in its partition. A guest loaded later starts
 * at that saved level instead: one from before the Hub's last change, or one
 * Electron's zoom roles set before this fix.
 */
export function followHubZoom(
  guest: Guest,
  getHubPage: () => ZoomTarget | null
): void {
  guest.on('did-navigate', () => {
    const hub = getHubPage();
    if (!hub || hub.isDestroyed() || guest.isDestroyed()) return;
    const level = hub.getZoomLevel();
    if (guest.getZoomLevel() !== level) guest.setZoomLevel(level);
  });
}

/** A webContents whose key presses are read: the Hub page or a guest. */
type KeySource = {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: TabShortcutKey) => void
  ): unknown;
};

/**
 * Takes the zoom keys typed in `source` and zooms the Hub page. Other keys go
 * on to the page as before.
 */
export function installZoomKeys(
  source: KeySource,
  getHubPage: () => ZoomTarget | null,
  platform: string
): void {
  source.on('before-input-event', (event, input) => {
    const action = resolveZoomKey(input, platform);
    if (!action) return;
    // The key is the Hub's: it reaches neither the page nor the View menu's
    // own shortcut, which would zoom a second time.
    event.preventDefault();
    zoomHub(getHubPage(), action);
  });
}

/**
 * The View menu, laid out as Electron's viewMenu role lays it out, with the
 * same labels and keys, but zooming the Hub page.
 */
export function viewMenu(
  getHubPage: () => ZoomTarget | null
): MenuItemConstructorOptions {
  const zoom = (action: ZoomAction) => () => zoomHub(getHubPage(), action);
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
