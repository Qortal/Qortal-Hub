import { executeEvent } from '../../../utils/events';
import { getBaseApiReact } from '../../../utils/globalApi';
import type { QuitterFeedItem } from './quitterFeedTypes';

/** The Q-App Home's feed reads and opens. */
export const TORQ_APP_NAME = 'Torq';

/**
 * How Torq reads the feed, so Home's Torq feed matches Torq itself:
 * - it leaves out the users the account hides in Torq;
 * - it drops the links Torq adds to a post for Quitter readers.
 */

/** qapp-core's public salt for the Quitter app, which Torq shares. */
const QUITTER_PUBLIC_SALT = '6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=';

const CACHE_TTL_MS = 5 * 60 * 1000;
/** After a timeout or a node error, try again this much later. */
const RETRY_AFTER_MS = 60 * 1000;
/** The feed must not wait long on a node that is still fetching the file. */
const FETCH_TIMEOUT_MS = 6_000;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

/** qapp-core's hashString: SHA-256 of salt + word, URL-safe, cut short. */
export const qappCoreHash = async (
  word: string,
  length: number,
  salt: string = QUITTER_PUBLIC_SALT
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(salt + word)
  );
  return bytesToBase64(new Uint8Array(digest))
    .replace(/\+/g, '.')
    .replace(/\//g, '~')
    .replace(/_/g, '!')
    .replace(/=+$/, '')
    .slice(0, length);
};

/** The identifier of the settings DOCUMENT Torq's "Save to QDN" publishes. */
export const torqSettingsIdentifier = (): Promise<string> =>
  qappCoreHash('settings', 14);

/** Torq's normalizeHiddenUser: trimmed, no leading @, single spaces. */
const normalizeHiddenUser = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ');

/** How Torq compares a name with its hidden users. */
export const hiddenUserKey = (value: string): string =>
  normalizeHiddenUser(value).toLowerCase();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const decodeJson = (value: unknown): Record<string, unknown> | null => {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    // The node may hand back the published base64.
  }
  try {
    const bytes = Uint8Array.from(atob(value.trim()), (c) => c.charCodeAt(0));
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
};

/** The hidden names in a Torq settings document, in any shape Torq saves. */
export const parseTorqHiddenUsers = (payload: unknown): string[] => {
  const record = decodeJson(payload);
  if (!record) return [];
  const candidates = [record];
  const nested = decodeJson(record.data);
  if (nested) candidates.push(nested);
  const settings = candidates.find((item) => Array.isArray(item.hiddenUsers));
  if (!settings) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of settings.hiddenUsers as unknown[]) {
    if (typeof raw !== 'string') continue;
    const name = normalizeHiddenUser(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
};

const hiddenUsersCache = new Map<
  string,
  { expiresAt: number; names: string[] }
>();

/**
 * The names `userName` hides in Torq, from its public Torq settings on QDN.
 * Never throws: without saved settings, or with the node unreachable, it gives
 * the last known list, else none. `force` skips the 5-minute cache.
 */
export const fetchTorqHiddenUsers = async (
  userName: string,
  { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {}
): Promise<string[]> => {
  const name = userName.trim();
  if (!name) return [];
  const cached = hiddenUsersCache.get(name);
  if (!force && cached && Date.now() < cached.expiresAt) return cached.names;
  const remember = (names: string[], ttl: number) => {
    hiddenUsersCache.set(name, { expiresAt: Date.now() + ttl, names });
    return names;
  };

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS);
  try {
    const identifier = await torqSettingsIdentifier();
    const response = await fetch(
      `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(
        name
      )}/${encodeURIComponent(identifier)}`,
      { cache: 'no-store', signal: controller.signal }
    );
    if (response.ok) {
      return remember(
        parseTorqHiddenUsers(await response.text()),
        CACHE_TTL_MS
      );
    }
    // 4xx: this account never saved its Torq settings to QDN.
    if (response.status >= 400 && response.status < 500) {
      return remember([], CACHE_TTL_MS);
    }
    return remember(cached?.names ?? [], RETRY_AFTER_MS);
  } catch {
    if (signal?.aborted) return cached?.names ?? [];
    return remember(cached?.names ?? [], RETRY_AFTER_MS);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

/** For tests. */
export const resetTorqHiddenUsersCache = (): void => hiddenUsersCache.clear();

export const torqPostLink = (author: string, identifier: string): string =>
  `qortal://APP/Torq/post/${encodeURIComponent(
    author
  )}/${encodeURIComponent(identifier)}`;

/** Open a post in Torq, in a Q-Apps tab. */
export const openTorqPost = (author: string, identifier: string): void => {
  executeEvent('addTab', {
    data: {
      identifier: '',
      name: TORQ_APP_NAME,
      path: `post/${encodeURIComponent(author)}/${encodeURIComponent(
        identifier
      )}`,
      service: 'APP',
    },
  });
  executeEvent('open-apps-mode', {});
};

const QORTAL_URL_RE = /qortal:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]]+$/;

const sameLink = (a: string, b: string): boolean => {
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    return a === b;
  }
};

/**
 * A Torq post's text as Torq shows it. Torq adds links for Quitter readers:
 * the post's own Torq link, `qortal://use-embed/…` links for GIFs and files,
 * and a Q-Share link for an attachment. Torq hides them (its
 * stripQuitterCompatLinks) and shows the GIF, file or poll instead.
 */
export const visibleTorqPostText = (
  text: string,
  post: { author: string; identifier: string; hasAttachments?: boolean }
): string => {
  const ownLink = torqPostLink(post.author, post.identifier);
  return String(text || '')
    .replace(QORTAL_URL_RE, (raw) => {
      const url = raw.replace(TRAILING_PUNCTUATION_RE, '');
      const tail = raw.slice(url.length);
      if (/^qortal:\/\/use-embed\//i.test(url)) return tail;
      if (sameLink(url, ownLink)) return tail;
      if (
        post.hasAttachments &&
        /^qortal:\/\/APP\/Q-Share\/share\//i.test(url)
      ) {
        return tail;
      }
      return raw;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Feed posts as Torq shows them: none by the users the account hides in
 * Torq, and without the links Torq adds for Quitter readers.
 */
export const torqFeedItems = (
  items: QuitterFeedItem[],
  hiddenKeys: ReadonlySet<string>
): QuitterFeedItem[] =>
  items
    .filter((item) => !hiddenKeys.has(hiddenUserKey(item.author)))
    .map((item) => {
      const text = visibleTorqPostText(item.text, {
        author: item.author,
        hasAttachments: item.images.length > 0 || item.hasVideo,
        identifier: item.identifier,
      });
      return text === item.text ? item : { ...item, text };
    });
