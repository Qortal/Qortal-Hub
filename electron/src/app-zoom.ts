/**
 * Each Q-App's and website's own zoom (see hub-zoom.ts): which app a webview
 * shows, the levels this PC keeps for them, and the Hub page's view of them
 * (the magnifier in its search bar).
 *
 * The levels stay in userData/app-zoom.json, on this PC only: one number per
 * app, on top of the Hub's zoom. They are never published.
 *
 * Kept free of Electron imports, so it runs in tests as it is.
 */
import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';
import { randomBytes } from 'crypto';
import {
  mkdirSync,
  promises as fs,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import {
  appZoomState,
  changeZoom,
  configureAppZoom,
  loadAppZoomLevels,
  setZoomPanelPointer,
  setZoomScreen,
  type GuestZoomApp,
  type SavedAppZoom,
  type ZoomAction,
  type ZoomChange,
  type ZoomTarget,
} from './hub-zoom';

export const APP_ZOOM_FILE = 'app-zoom.json';

const STORE_VERSION = 1;
/** The apps kept, the most recently zoomed first. */
export const MAX_SAVED_APPS = 500;
const MAX_KEY_LENGTH = 600;
const MAX_TAB_ID_LENGTH = 256;
/** An app's own zoom, in levels on top of the Hub's (×1.2 a level). */
const MAX_OWN_LEVEL = 16;
/** Saves wait this long after the last change. */
const SAVE_DELAY_MS = 500;

/**
 * The owner tab ids of guests that always show at the Hub's zoom: Home
 * widgets (HomeWidgetView's widgetGuestOwner) and the screenshot preview
 * (ScreenshotCaptureDialog). A test keeps them in step with those files.
 */
export const HUB_ZOOM_TAB_PREFIXES = ['home-widget:', 'qhub-shots-'] as const;

/** What Hub prepared a webview for (setup.ts's PreparedQAppGuest). */
export type PreparedGuest = {
  /**
   * A private app's tab also gives its resource's identifier (AppViewer), so
   * its zoom stays apart from the publisher's other private apps.
   */
  owner: { tabId: string; name: string; service: string; identifier?: string };
  url: string;
  isDevMode: boolean;
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The key an app's zoom is kept under: its service and name (names don't
 * depend on case, so in lower case), so a Q-App and a website of one name
 * stay apart. A private app with its identifier too, so each of one
 * publisher's private apps has its own. A dev mode tab by its address.
 */
export function appZoomKey(prepared: PreparedGuest): string | null {
  if (prepared.isDevMode) {
    try {
      const origin = new URL(prepared.url).origin;
      return origin && origin !== 'null'
        ? JSON.stringify(['dev', origin])
        : null;
    } catch {
      return null;
    }
  }
  const { service, name, identifier } = prepared.owner;
  if (!service || !name) return null;
  const parts = [service, name.toLowerCase()];
  if (typeof identifier === 'string' && identifier) parts.push(identifier);
  const key = JSON.stringify(parts);
  return key.length <= MAX_KEY_LENGTH && !CONTROL_CHARACTERS.test(key)
    ? key
    : null;
}

/** An address as Chromium writes it once loaded (`http://host:1?a` → `/?a`). */
const addressOf = (url: string) => {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
};

/**
 * What Hub prepared a webview for: the record its hello bound, or before the
 * hello (its first page commits first), the one prepared for its partition at
 * the address it shows.
 */
export function preparedForGuest<T extends { partition: string; url: string }>(
  bound: T | null | undefined,
  candidates: Iterable<T>,
  inPartition: (partition: string) => boolean,
  url: string
): T | null {
  if (bound) return bound;
  const address = addressOf(url);
  for (const candidate of candidates) {
    if (
      inPartition(candidate.partition) &&
      addressOf(candidate.url) === address
    ) {
      return candidate;
    }
  }
  return null;
}

/** What a prepared webview shows, for the zoom. */
export function guestZoomApp(
  prepared: PreparedGuest | null
): GuestZoomApp | null {
  if (!prepared?.owner || typeof prepared.owner.tabId !== 'string') return null;
  const { tabId } = prepared.owner;
  if (HUB_ZOOM_TAB_PREFIXES.some((prefix) => tabId.startsWith(prefix))) {
    return { kind: 'hub' };
  }
  const key = appZoomKey(prepared);
  return key ? { kind: 'app', key, tabId } : null;
}

const validKey = (key: string) =>
  key.length > 0 &&
  key.length <= MAX_KEY_LENGTH &&
  !CONTROL_CHARACTERS.test(key);

const validLevel = (level: unknown): level is number =>
  typeof level === 'number' &&
  Number.isFinite(level) &&
  level !== 0 &&
  Math.abs(level) <= MAX_OWN_LEVEL;

/** The levels to keep: valid ones only, the most recent first, at most 500. */
export function keptLevels(
  levels: Iterable<[string, SavedAppZoom]>
): Array<[string, SavedAppZoom]> {
  return [...levels]
    .filter(([key, saved]) => validKey(key) && validLevel(saved?.level))
    .map(([key, saved]): [string, SavedAppZoom] => [
      key,
      {
        level: saved.level,
        at:
          Number.isFinite(saved.at) && saved.at > 0 ? Math.floor(saved.at) : 0,
      },
    ])
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_SAVED_APPS);
}

export function createAppZoomStore(
  getFilePath: () => string,
  onError: (error: unknown) => void = () => undefined
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Array<[string, SavedAppZoom]> | null = null;
  let writing: Promise<void> = Promise.resolve();

  /** Missing, unreadable or broken data reads as no levels. */
  const read = async (): Promise<Array<[string, SavedAppZoom]>> => {
    let raw: string;
    try {
      raw = await fs.readFile(getFilePath(), 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') onError(error);
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      onError(error);
      return [];
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== STORE_VERSION ||
      !isRecord(parsed.apps)
    ) {
      return [];
    }
    return keptLevels(
      Object.entries(parsed.apps)
        .filter(([, saved]) => isRecord(saved))
        .map(([key, saved]): [string, SavedAppZoom] => [
          key,
          {
            level: (saved as Record<string, unknown>).level as number,
            at: (saved as Record<string, unknown>).at as number,
          },
        ])
    );
  };

  const contents = (levels: Array<[string, SavedAppZoom]>) =>
    JSON.stringify(
      { version: STORE_VERSION, apps: Object.fromEntries(levels) },
      null,
      2
    );
  const temporaryFor = (filePath: string) =>
    join(
      dirname(filePath),
      `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    );

  const write = async (levels: Array<[string, SavedAppZoom]>) => {
    const filePath = getFilePath();
    await fs.mkdir(dirname(filePath), { recursive: true });
    // Write a sibling file, then rename it over the store in one step.
    const temporary = temporaryFor(filePath);
    try {
      await fs.writeFile(temporary, contents(levels), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  /** Writes what is pending now, after any write under way. */
  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const levels = pending;
    pending = null;
    if (!levels) return writing;
    writing = writing
      .then(() => write(levels))
      .catch((error) => onError(error));
    return writing;
  };

  /** On quit, when nothing can wait: writes what is pending at once. */
  const flushNow = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const levels = pending;
    pending = null;
    if (!levels) return;
    const filePath = getFilePath();
    const temporary = temporaryFor(filePath);
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporary, contents(levels), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, filePath);
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // No temporary file was made.
      }
      onError(error);
    }
  };

  return {
    read,
    /** Saves the levels a moment after the last change. */
    save(levels: Iterable<[string, SavedAppZoom]>) {
      pending = keptLevels(levels);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    flush,
    flushNow,
  };
}

const ZOOM_ACTIONS = new Set<ZoomAction>(['in', 'out', 'reset']);

const tabIdOf = (value: unknown): string | null =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_TAB_ID_LENGTH &&
  !CONTROL_CHARACTERS.test(value)
    ? value
    : null;

/**
 * Wires the zoom of each app: the saved levels, which app a webview shows
 * (`preparedOf`, from what the Hub page prepared it for), and the IPC the
 * Hub page's magnifier uses. Only the Hub page's own document may call it.
 */
export function registerHubZoomIpc({
  ipcMain,
  app,
  checkSender,
  getHubPage,
  preparedOf,
  getFilePath,
  onError,
}: {
  ipcMain: Pick<IpcMain, 'handle' | 'on'>;
  /** Hub's quit: `before-quit`, the last event it emits (index.ts holds the
   * quit there and ends with app.exit(), which emits no will-quit). */
  app: { on(event: 'before-quit', listener: () => void): unknown };
  checkSender: (event: IpcMainInvokeEvent) => void;
  getHubPage: () => (ZoomTarget & Pick<WebContents, 'send'>) | null;
  preparedOf: (guest: WebContents) => PreparedGuest | null;
  getFilePath: () => string;
  onError?: (error: unknown) => void;
}) {
  const store = createAppZoomStore(getFilePath, onError);
  // A zoom changed just before quitting is written before Hub exits.
  app.on('before-quit', () => store.flushNow());
  // Read once, when a webview or the Hub page first needs the levels: by
  // then userData is this Hub instance's own (index.ts moves it for a second
  // instance after this file is loaded).
  let reading: Promise<void> | null = null;
  const read = () => {
    reading ??= store.read().then(loadAppZoomLevels, onError);
    return reading;
  };
  configureAppZoom({
    appOf: (guest) => guestZoomApp(preparedOf(guest as unknown as WebContents)),
    getHubPage,
    beforeUse: () => void read(),
    onLevelsChange: (levels) => store.save(levels),
    onChange: (change: ZoomChange) => {
      const hub = getHubPage();
      if (hub && !hub.isDestroyed()) hub.send('hubZoom:changed', change);
    },
  });

  const fromHubPage = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    try {
      checkSender(event as IpcMainInvokeEvent);
    } catch {
      return false;
    }
    void read();
    return true;
  };

  ipcMain.on('hubZoom:onScreen', (event, report) => {
    if (!fromHubPage(event) || !isRecord(report)) return;
    setZoomScreen({
      tabId: tabIdOf(report.tabId),
      locked: report.locked === true,
    });
  });
  ipcMain.on('hubZoom:panelPointer', (event, tabId) => {
    if (!fromHubPage(event)) return;
    setZoomPanelPointer(tabId === undefined ? undefined : tabIdOf(tabId));
  });
  ipcMain.handle('hubZoom:get', (event, tabId) => {
    checkSender(event);
    void read();
    return appZoomState(tabIdOf(tabId));
  });
  ipcMain.handle('hubZoom:change', (event, target, action) => {
    checkSender(event);
    void read();
    if (!ZOOM_ACTIONS.has(action)) throw new Error('HUB_ZOOM_INVALID_ACTION');
    const tabId = isRecord(target) ? tabIdOf(target.tabId) : null;
    if (target !== 'hub' && !tabId) throw new Error('HUB_ZOOM_INVALID_TARGET');
    changeZoom(target === 'hub' ? 'hub' : { tabId }, action);
    return appZoomState(tabId);
  });
  return store;
}
