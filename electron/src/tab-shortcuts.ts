/**
 * Browser-style shortcuts for the Hub's tab strip: Ctrl+T, Ctrl+W,
 * Ctrl+Shift+T, Ctrl+Tab, Ctrl+1…9, Ctrl+L, Ctrl+R and F5 (Cmd on macOS).
 *
 * Keys typed in a Q-App's webview never reach the Hub page, so main reads them
 * before any page does, on the Hub's webContents and on every Q-App guest's,
 * and sends the action to the Hub page, which owns the tabs.
 *
 * The renderer imports the types from here, so this module must not import
 * Electron itself.
 */

/** Main → Hub page: one message per shortcut, carrying a TabShortcutAction. */
export const TAB_SHORTCUT_CHANNEL = 'tabShortcuts:action';

export type TabShortcutAction =
  | { type: 'newTab' }
  | { type: 'closeTab' }
  | { type: 'reopenClosedTab' }
  | { type: 'nextTab' }
  | { type: 'previousTab' }
  /** Ctrl+1…8: the tab at this index of the strip. */
  | { type: 'selectTab'; index: number }
  /** Ctrl+9: the last tab, as in browsers. */
  | { type: 'selectLastTab' }
  | { type: 'focusSearch' }
  | { type: 'reloadTab' };

/** The fields of Electron's `Input` that the shortcuts read. */
export type TabShortcutKey = {
  type: string;
  key: string;
  code: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
  isAutoRepeat?: boolean;
  isComposing?: boolean;
};

export type TabShortcut = {
  action: TabShortcutAction;
  /**
   * False for a held key's repeat of a shortcut that acts once per press. The
   * key is still the Hub's, so it doesn't reach the page or the menu.
   */
  run: boolean;
};

// Holding Ctrl+W must not close every tab, nor Ctrl+R restart a Q-App over and
// over. Holding Ctrl+Tab moves on through the tabs, as in browsers.
const ONCE_PER_PRESS = new Set<TabShortcutAction['type']>([
  'newTab',
  'closeTab',
  'reopenClosedTab',
  'reloadTab',
]);

/**
 * The tab shortcut a key press makes on this platform (`process.platform`),
 * or null to leave the key to the page.
 */
export function resolveTabShortcut(
  input: TabShortcutKey,
  platform: string
): TabShortcut | null {
  if (input.type !== 'keyDown' || input.isComposing) return null;
  const action = actionForKeys(input, platform === 'darwin');
  if (!action) return null;
  return {
    action,
    run: !(input.isAutoRepeat && ONCE_PER_PRESS.has(action.type)),
  };
}

function actionForKeys(
  input: TabShortcutKey,
  isMac: boolean
): TabShortcutAction | null {
  const { alt, control, key, meta, shift } = input;
  // Windows reports AltGr as Ctrl+Alt, so a chord with Alt is typing.
  if (alt) return null;
  if (!control && !meta) {
    return key === 'F5' && !shift ? { type: 'reloadTab' } : null;
  }
  // Tab switching keeps Ctrl on macOS too, as browsers there do.
  if (control && !meta) {
    if (key === 'Tab') return { type: shift ? 'previousTab' : 'nextTab' };
    if (key === 'PageDown' && !shift) return { type: 'nextTab' };
    if (key === 'PageUp' && !shift) return { type: 'previousTab' };
  }
  // The others take Cmd on macOS, where Ctrl+letter keys edit text, and Ctrl
  // elsewhere; never both.
  if (isMac ? control || !meta : meta || !control) return null;
  const letter = typedLetter(input);
  if (shift) return letter === 't' ? { type: 'reopenClosedTab' } : null;
  if (letter === 't') return { type: 'newTab' };
  if (letter === 'w') return { type: 'closeTab' };
  if (letter === 'l') return { type: 'focusSearch' };
  if (letter === 'r') return { type: 'reloadTab' };
  const number = tabNumber(input);
  if (number === 9) return { type: 'selectLastTab' };
  return number ? { type: 'selectTab', index: number - 1 } : null;
}

// The letter the key types, so the shortcuts follow the layout (AZERTY,
// Dvorak). A layout without Latin letters falls back to the key's place on a
// US keyboard, as browsers do.
function typedLetter({ code, key }: TabShortcutKey): string | null {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  if (key.length === 1 && key.charCodeAt(0) < 0x80) return null;
  const match = /^Key([A-Z])$/.exec(code);
  return match ? match[1].toLowerCase() : null;
}

// Digits go by the key's place, so Ctrl+1 also works where the digit row
// needs Shift (AZERTY). Keypad digits count only with Num Lock on: without
// it, Ctrl+End and Ctrl+Home are on those keys.
function tabNumber({ code, key }: TabShortcutKey): number | null {
  const row = /^Digit([1-9])$/.exec(code);
  if (row) return Number(row[1]);
  const pad = /^Numpad([1-9])$/.exec(code);
  return pad && key === pad[1] ? Number(pad[1]) : null;
}

/** A webContents whose key presses are read: the Hub page or a Q-App guest. */
type KeySource = {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: TabShortcutKey) => void
  ): unknown;
};

/** The Hub page's webContents. */
type HubPage = KeySource & {
  isDestroyed(): boolean;
  focus(): void;
  send(channel: string, ...args: unknown[]): void;
};

/**
 * Takes the tab shortcuts typed in `source` and hands them to the Hub page.
 * Other keys go on to the page as before.
 */
export function installTabShortcuts(
  source: KeySource,
  getHubPage: () => HubPage | null,
  platform: string
): void {
  source.on('before-input-event', (event, input) => {
    const shortcut = resolveTabShortcut(input, platform);
    if (!shortcut) return;
    // This also keeps the View menu's Ctrl+R from reloading the whole Hub.
    event.preventDefault();
    if (!shortcut.run) return;
    const hub = getHubPage();
    if (!hub || hub.isDestroyed()) return;
    // The search field is in the Hub page, so it has to take the keyboard
    // back from the Q-App first.
    if (shortcut.action.type === 'focusSearch' && hub !== source) {
      hub.focus();
    }
    try {
      hub.send(TAB_SHORTCUT_CHANNEL, shortcut.action);
    } catch {
      // The Hub page is reloading; the shortcut has nothing to act on.
    }
  });
}

type IpcListener = (event: unknown, ...args: any[]) => void;

/** The part of `ipcRenderer` the preload needs. */
type IpcSubscriber = {
  on(channel: string, listener: IpcListener): unknown;
  removeListener(channel: string, listener: IpcListener): unknown;
};

/** Preload side: calls back with each action until the result is called. */
export function subscribeTabShortcuts(
  ipc: IpcSubscriber,
  callback: (action: TabShortcutAction) => void
): () => void {
  const listener: IpcListener = (_event, action: TabShortcutAction) =>
    callback(action);
  ipc.on(TAB_SHORTCUT_CHANNEL, listener);
  return () => {
    ipc.removeListener(TAB_SHORTCUT_CHANNEL, listener);
  };
}
