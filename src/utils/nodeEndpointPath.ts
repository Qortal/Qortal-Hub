import i18n from 'i18next';

/**
 * Every request Hub sends through createEndpoint carries the node API key when
 * one is set. Some paths contain text that a Q-App chose: a coin, a list name,
 * a QDN name or identifier. If that text becomes a "." or ".." path segment,
 * the URL parser drops it and the request reaches a different node endpoint,
 * still with the key.
 *
 * These checks refuse a path that the URL parser (or the node) could rewrite
 * that way, and confirm that the final URL is still on the node it was built
 * for. Real node endpoints never contain anything they refuse.
 */

const PATH_SEPARATORS = /[/\\]/;
const MAX_DECODE_ROUNDS = 4;

/**
 * Escapes Hub never puts in a path, which some servers decode in their own
 * way: the legacy %uXXXX form and an encoded NUL.
 */
const UNUSUAL_PATH_ESCAPE = /%u[0-9a-f]{4}|%00/i;

export class UnsafeNodeEndpointError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.unsafe_node_path', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'UnsafeNodeEndpointError';
  }
}

/**
 * True for any control character. The URL parser silently drops tab, LF and
 * CR anywhere in its input, so ".\t." becomes "..".
 */
export const hasControlCharacter = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

/** Decodes valid %XX and %uXXXX escapes, and leaves anything else as it is. */
const decodePercentEscapes = (value: string): string =>
  value.replace(
    /%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g,
    (_match, wide: string | undefined, hex: string | undefined) =>
      String.fromCharCode(parseInt(wide ?? hex, 16))
  );

/**
 * True for a segment the node may treat as "." or "..". Servlet containers
 * drop a ";parameter" before resolving dot segments, and native code can stop
 * at a NUL, so "..;x" and "..\0" count too.
 */
const isDotSegment = (segment: string): boolean => {
  const name = segment.split(';')[0].split('\0')[0];
  return name === '.' || name === '..';
};

/**
 * True when the path, raw or after one or more rounds of percent-decoding,
 * has a "." or ".." segment. A "\" counts as "/".
 */
export const hasDotSegment = (path: string): boolean => {
  let current = path;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    if (current.split(PATH_SEPARATORS).some(isDotSegment)) return true;
    const decoded = decodePercentEscapes(current);
    if (decoded === current) return false;
    current = decoded;
  }
  // Still decoding after several rounds: no real path is encoded like that.
  return true;
};

/** The part of an endpoint before its query string or fragment. */
export const endpointPathPart = (endpoint: string): string => {
  const end = endpoint.search(/[?#]/);
  return end === -1 ? endpoint : endpoint.slice(0, end);
};

/** Returns `endpoint` when it is a node path the URL parser can't rewrite. */
export const assertSafeNodeEndpoint = (endpoint: unknown): string => {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
    throw new UnsafeNodeEndpointError();
  }
  const path = endpointPathPart(endpoint);
  // A "#" before the query would send the request to the shorter path.
  if (endpoint.charAt(path.length) === '#') {
    throw new UnsafeNodeEndpointError();
  }
  if (
    hasControlCharacter(path) ||
    UNUSUAL_PATH_ESCAPE.test(path) ||
    hasDotSegment(path)
  ) {
    throw new UnsafeNodeEndpointError();
  }
  return endpoint;
};

const basePathname = (base: URL): string =>
  base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;

/**
 * `${base}${endpoint}`, exactly as before, once the endpoint has passed
 * assertSafeNodeEndpoint and the joined URL is known to stay on the same
 * node, under the base path.
 */
export const joinNodeEndpoint = (base: string, endpoint: unknown): string => {
  const safeEndpoint = assertSafeNodeEndpoint(endpoint);
  const joined = `${base}${safeEndpoint}`;

  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    // No usable base yet: the request fails on its own, and the path itself
    // has been checked.
    return joined;
  }

  let joinedUrl: URL;
  try {
    joinedUrl = new URL(joined);
  } catch {
    throw new UnsafeNodeEndpointError();
  }
  if (joinedUrl.origin !== baseUrl.origin) {
    throw new UnsafeNodeEndpointError();
  }
  const prefix = basePathname(baseUrl);
  if (prefix !== '/' && !`${joinedUrl.pathname}/`.startsWith(prefix)) {
    throw new UnsafeNodeEndpointError();
  }
  return joined;
};

/**
 * Encodes one path segment that came from outside Hub, such as a Q-App.
 * Refuses an empty value and one that would become a "." or ".." segment.
 */
export const nodePathSegment = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new UnsafeNodeEndpointError();
  }
  const raw = String(value);
  if (!raw || hasControlCharacter(raw) || hasDotSegment(raw)) {
    throw new UnsafeNodeEndpointError();
  }
  return encodeURIComponent(raw);
};
