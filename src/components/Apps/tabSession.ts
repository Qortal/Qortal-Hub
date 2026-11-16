/**
 * The app tabs each account has open, kept on this device so Hub opens them
 * again after a restart. Ported from Qortal GO (mobileOpenTabsSession.ts).
 *
 * A tab is kept with what reopens it: service, name, identifier, the address
 * inside the app (a path relative to the app) and its title. Dev Mode tabs
 * are not kept: what they show is not on QDN. A private app keeps what Hub
 * needs to download and decrypt it again, as its pinned apps do; the address
 * of the copy the node built for this run is not kept.
 */
import { QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import { buildQortalResourceLink } from '../../utils/qortalLink';

const STORAGE_KEY = 'ext_open_tabs';
const STORAGE_VERSION = 1;

/** A new address inside an app is saved at most this often. */
export const TAB_ADDRESS_SAVE_DELAY_MS = 1000;

const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SERVICE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FLAG_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const API_KEY = /api[-_\s]?key/i;
const MAX_NAME_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
const MAX_PATH_LENGTH = 2048;
const MAX_FLAGS = 16;
// Enough for a tab icon; a bigger logo comes back when the app is reopened.
const MAX_LOGO_LENGTH = 64_000;

// Internal tabs Hub draws itself, which need nothing stored to reopen.
const RESTORABLE_INTERNAL_TABS = new Set([QCHAT_INTERNAL_TAB_ID]);

// True/false fields that are not carried as they are: the ones kept in their
// own right, and those that belong to the run they were set in (how the tab
// was opened, a close confirmation the app asked for, a preview the node
// built).
const NOT_CARRIED = new Set([
  'flags',
  'identifier',
  'internal',
  'isPreview',
  'isPrivate',
  'lock',
  'metadata',
  'name',
  'navigateIfAlreadyOpen',
  'path',
  'privateAppProperties',
  'service',
  'tabId',
  'title',
  'url',
]);

// Hub's own parameters on a Q-App's address (AppViewer), not the app's.
const HUB_RENDER_PARAMS = new Set([
  'identifier',
  'isManualNavigation',
  'lang',
  'theme',
  'time',
]);

export type SavedPrivateApp = {
  service: string;
  name: string;
  identifier: string;
  groupId?: number | string;
  appName?: string;
  logo?: string;
};

export type SavedTab = {
  tabId: string;
  service: string;
  name: string;
  identifier?: string;
  /** The address inside the app, relative to it ("video/abc?t=1"). */
  path?: string;
  title?: string;
  internal?: string;
  isPrivate?: true;
  privateAppProperties?: SavedPrivateApp;
  /** Other true/false marks the tab carried, such as `pinned`. */
  flags?: Record<string, boolean>;
};

export type TabSession = {
  tabs: SavedTab[];
  selectedTabId: string | null;
};

type TabLike = Record<string, any>;

export const tabSessionStorageKey = (address: string) =>
  `${STORAGE_KEY}:${address}`;

const emptySession = (): TabSession => ({ tabs: [], selectedTabId: null });

const hasControlChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const isObject = (value: unknown): value is TabLike =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > maxLength || hasControlChar(text)) {
    return undefined;
  }
  return text;
};

const decodeOnce = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/** "." or ".." as written, or after one or two decodes ("%2e%2e", "%252e"). */
const isUnsafeSegment = (segment: string): boolean => {
  let form = segment;
  for (let round = 0; round < 3; round += 1) {
    const bare = form.split(';')[0];
    if (bare === '.' || bare === '..' || form.includes('\\')) return true;
    const next = decodeOnce(form);
    if (next === null) return true;
    if (next === form) return false;
    form = next;
  }
  return false;
};

const paramName = (part: string): string => {
  const raw = part.split('=')[0];
  return decodeOnce(raw.replace(/\+/g, ' ')) ?? raw;
};

/**
 * The address inside an app as a path relative to the app: no leading "/",
 * without Hub's own render parameters (theme, lang, identifier, ...), and
 * never a whole address. Gives "" for the app's start page, and for anything
 * that is not a plain path inside the app.
 */
export function relativeAppPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_PATH_LENGTH ||
    trimmed.startsWith('//') ||
    hasControlChar(trimmed) ||
    trimmed.includes('\\')
  ) {
    return '';
  }
  const path = trimmed.replace(/^\/+/, '');
  const hashAt = path.indexOf('#');
  const fragment =
    hashAt === -1 || hashAt === path.length - 1 ? '' : path.slice(hashAt);
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);
  if (pathname.includes('://') || pathname.split('/').some(isUnsafeSegment)) {
    return '';
  }
  const params = query.split('&').filter((part) => {
    if (!part) return false;
    const name = paramName(part);
    return !HUB_RENDER_PARAMS.has(name) && !API_KEY.test(name);
  });
  const result = `${pathname}${params.length ? `?${params.join('&')}` : ''}${fragment}`;
  // Nothing that names a node API key, written or encoded.
  if (API_KEY.test(result) || API_KEY.test(decodeOnce(result) ?? '')) {
    return '';
  }
  return result;
}

/**
 * Where an open app is, read from the link its address bar shows (the
 * `currentLink` useQortalMessageListener keeps in navigationControllerAtom):
 * `qortal://SERVICE/name` until the app reports a page, then that page's path
 * after it, starting with "/" ("/" for its start page). Undefined until the
 * app has reported one.
 */
export function reportedAppPath(
  tab: unknown,
  currentLink: unknown
): string | undefined {
  if (!isObject(tab) || typeof currentLink !== 'string') return undefined;
  if (typeof tab.service !== 'string' || typeof tab.name !== 'string') {
    return undefined;
  }
  const appLink = buildQortalResourceLink({
    service: tab.service,
    name: tab.name,
  });
  if (!currentLink.startsWith(appLink)) return undefined;
  const rest = currentLink.slice(appLink.length);
  return rest.startsWith('/') ? rest : undefined;
}

/** The true/false marks a tab carries that Hub keeps as they are (`pinned`). */
export function tabFlags(tab: unknown): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  if (!isObject(tab)) return flags;
  let count = 0;
  for (const [key, value] of Object.entries(tab)) {
    if (typeof value !== 'boolean' || NOT_CARRIED.has(key)) continue;
    if (!FLAG_NAME.test(key) || count >= MAX_FLAGS) continue;
    flags[key] = value;
    count += 1;
  }
  return flags;
}

const savedPrivateApp = (tab: TabLike): SavedPrivateApp | null => {
  const props = isObject(tab.privateAppProperties)
    ? tab.privateAppProperties
    : {};
  const service = cleanText(props.service ?? tab.service, 64);
  const name = cleanText(props.name ?? tab.name, MAX_NAME_LENGTH);
  const identifier = cleanText(props.identifier ?? tab.identifier, 128);
  if (!service || !SERVICE.test(service) || !name || !identifier) return null;
  const groupId =
    typeof props.groupId === 'number' && Number.isFinite(props.groupId)
      ? props.groupId
      : cleanText(props.groupId, 32);
  const appName = cleanText(props.appName, MAX_TITLE_LENGTH);
  const logo =
    typeof props.logo === 'string' &&
    props.logo.startsWith('data:image/') &&
    props.logo.length <= MAX_LOGO_LENGTH
      ? props.logo
      : undefined;
  return {
    service,
    name,
    identifier,
    ...(groupId != null ? { groupId } : {}),
    ...(appName ? { appName } : {}),
    ...(logo ? { logo } : {}),
  };
};

/**
 * What is kept of one open tab, or null for a tab that is not kept. `path` is
 * where the app is now; without it, the address the tab was opened at.
 */
export function toSavedTab(tab: unknown, path?: string): SavedTab | null {
  if (!isObject(tab)) return null;
  const { tabId } = tab;
  if (typeof tabId !== 'string' || !TAB_ID.test(tabId)) return null;
  // Dev Mode tabs (isLocalDevTab) have no service.
  if (!tab.service) return null;
  const flags = tabFlags(tab);
  const withFlags = Object.keys(flags).length ? { flags } : {};

  if (tab.internal != null) {
    const service = cleanText(tab.service, 64);
    const name = cleanText(tab.name, MAX_NAME_LENGTH);
    if (!RESTORABLE_INTERNAL_TABS.has(tab.internal) || !service || !name) {
      return null;
    }
    return { tabId, service, name, internal: tab.internal, ...withFlags };
  }

  if (tab.isPrivate === true || isObject(tab.privateAppProperties)) {
    const privateApp = savedPrivateApp(tab);
    if (!privateApp) return null;
    return {
      tabId,
      service: privateApp.service,
      name: privateApp.name,
      identifier: privateApp.identifier,
      isPrivate: true,
      privateAppProperties: privateApp,
      ...withFlags,
    };
  }

  // Any other preview is a copy the node built for this run only.
  if (tab.isPreview) return null;
  const service = cleanText(tab.service, 64);
  const name = cleanText(tab.name, MAX_NAME_LENGTH);
  if (!service || !SERVICE.test(service) || !name) return null;
  const identifier = cleanText(tab.identifier, 128);
  const appPath = relativeAppPath(path ?? tab.path);
  const title = cleanText(tab.metadata?.title, MAX_TITLE_LENGTH);
  return {
    tabId,
    service,
    name,
    ...(identifier && identifier !== 'null' ? { identifier } : {}),
    ...(appPath ? { path: appPath } : {}),
    ...(title ? { title } : {}),
    ...withFlags,
  };
}

/** The tab object AppsDesktop opens for a saved tab. */
export function restoredTab(saved: SavedTab): TabLike & { tabId: string } {
  return {
    ...tabFlags(saved.flags),
    tabId: saved.tabId,
    service: saved.service,
    name: saved.name,
    ...(saved.identifier ? { identifier: saved.identifier } : {}),
    ...(saved.path ? { path: saved.path } : {}),
    ...(saved.title ? { metadata: { title: saved.title } } : {}),
    ...(saved.internal != null ? { internal: saved.internal } : {}),
    ...(saved.isPrivate
      ? { isPrivate: true, privateAppProperties: saved.privateAppProperties }
      : {}),
  };
}

/**
 * A private app's tab as restored: it has no copy of the app yet, so it is
 * downloaded and decrypted again before it can show anything.
 */
export const isPrivateTabToReopen = (tab: unknown): boolean =>
  isObject(tab) && tab.isPrivate === true && !(tab.isPreview && tab.url);

const keepTabs = (
  candidates: (SavedTab | null)[],
  limit: number
): SavedTab[] => {
  const seen = new Set<string>();
  const tabs: SavedTab[] = [];
  for (const tab of candidates) {
    if (!tab || seen.has(tab.tabId)) continue;
    seen.add(tab.tabId);
    tabs.push(tab);
    if (tabs.length >= limit) break;
  }
  return tabs;
};

const sessionOf = (tabs: SavedTab[], selectedTabId: unknown): TabSession => ({
  tabs,
  selectedTabId:
    typeof selectedTabId === 'string' &&
    tabs.some((tab) => tab.tabId === selectedTabId)
      ? selectedTabId
      : null,
});

/** What is kept of the open tabs, in their order, at most `limit` of them. */
export function serializeTabSession(
  tabs: unknown[],
  selectedTabId: string | null | undefined,
  limit: number,
  currentPathOf: (tab: TabLike) => string | undefined = () => undefined
): TabSession {
  const saved = (Array.isArray(tabs) ? tabs : []).map((tab) =>
    isObject(tab) ? toSavedTab(tab, currentPathOf(tab)) : null
  );
  return sessionOf(keepTabs(saved, limit), selectedTabId);
}

/** Reads a stored session, keeping only tabs that would be saved today. */
export function parseTabSession(value: unknown, limit: number): TabSession {
  if (!isObject(value) || value.version !== STORAGE_VERSION) {
    return emptySession();
  }
  const stored = Array.isArray(value.tabs) ? value.tabs : [];
  const tabs = stored.map((tab) =>
    isObject(tab) ? toSavedTab(restoredTab(tab as SavedTab)) : null
  );
  return sessionOf(keepTabs(tabs, limit), value.selectedTabId);
}

export function loadTabSession(
  address: string | null | undefined,
  limit: number,
  storage?: Pick<Storage, 'getItem'>
): TabSession {
  if (!address) return emptySession();
  try {
    const stored = (storage ?? localStorage).getItem(
      tabSessionStorageKey(address)
    );
    return stored ? parseTabSession(JSON.parse(stored), limit) : emptySession();
  } catch {
    return emptySession();
  }
}

/** Saves the session; false (and the tab strip goes on) when it can't. */
export function saveTabSession(
  address: string | null | undefined,
  session: TabSession,
  storage?: Pick<Storage, 'setItem'>
): boolean {
  if (!address) return false;
  try {
    (storage ?? localStorage).setItem(
      tabSessionStorageKey(address),
      JSON.stringify({ version: STORAGE_VERSION, ...session })
    );
    return true;
  } catch (error) {
    console.error('Error saving the open tabs:', error);
    return false;
  }
}

/** The session without the addresses inside the apps. */
const layoutOf = (session: TabSession): string =>
  JSON.stringify({
    selectedTabId: session.selectedTabId,
    tabs: session.tabs.map(({ path, ...tab }) => tab),
  });

export type TabSessionWriter = {
  /** Saves a changed tab list, order or selection at once; a new address
   * inside an app after TAB_ADDRESS_SAVE_DELAY_MS. */
  update: (session: TabSession) => void;
  /** Saves what is waiting now. */
  flush: () => void;
};

export function createTabSessionWriter(
  address: string,
  {
    delayMs = TAB_ADDRESS_SAVE_DELAY_MS,
    saved,
    storage,
  }: {
    delayMs?: number;
    /** What is stored already, so it is not written again. */
    saved?: TabSession;
    storage?: Pick<Storage, 'setItem'>;
  } = {}
): TabSessionWriter {
  let savedJson = saved ? JSON.stringify(saved) : '';
  let savedLayout = saved ? layoutOf(saved) : '';
  let pending: TabSession | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stopWaiting = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  const write = (session: TabSession) => {
    stopWaiting();
    const json = JSON.stringify(session);
    if (json === savedJson) return;
    if (saveTabSession(address, session, storage)) {
      savedJson = json;
      savedLayout = layoutOf(session);
    }
  };

  return {
    update(session) {
      if (JSON.stringify(session) === savedJson) {
        stopWaiting();
        return;
      }
      if (layoutOf(session) !== savedLayout) {
        write(session);
        return;
      }
      pending = session;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (pending) write(pending);
        }, delayMs);
      }
    },
    flush() {
      if (pending) write(pending);
    },
  };
}
