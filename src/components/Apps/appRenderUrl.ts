import {
  hasControlCharacter,
  hasDotSegment,
} from '../../utils/nodeEndpointPath';

/**
 * True for a service or name that stays one path segment of
 * /render/<service>/<name>: not empty, not a "." or ".." segment (also with a
 * ";…" suffix or percent-encoded), and without a slash, backslash or control
 * character.
 */
export function isAppRenderSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    !/[/\\]/.test(value) &&
    !hasControlCharacter(value) &&
    !hasDotSegment(value)
  );
}

/** Keep the literal path punctuation used by Core's injected router base and
 * master's render URLs. Encoding '+' as '%2B', for example, breaks existing
 * routers and Core's navigation reports. Delimiters and literal '%' still need
 * encoding so a name cannot introduce another path segment, query or fragment.
 */
export function buildAppRenderRoot(
  baseUrl: string,
  service: string,
  name: string
): string {
  const encodedName = encodeURIComponent(name).replace(
    /%(24|26|2B|2C|3A|3B|3D|40|5B|5D|5E|7C)/g,
    (escaped) => decodeURIComponent(escaped)
  );
  return `${baseUrl}/render/${encodeURIComponent(service)}/${encodedName}`;
}

/**
 * An app's address with Hub's own query parameters (`hubQuery`, already
 * encoded) added. They go after the page's own query and before its fragment,
 * so neither changes: `search?q=hello#top` becomes
 * `search?q=hello&theme=dark#top`, and a hash router's `#/search?q=hello`
 * keeps its fragment whole.
 */
export function withHubQuery(address: string, hubQuery: string): string {
  const fragmentAt = address.indexOf('#');
  const beforeFragment =
    fragmentAt === -1 ? address : address.slice(0, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : address.slice(fragmentAt);
  const separator = !beforeFragment.includes('?')
    ? '?'
    : beforeFragment.endsWith('?') || beforeFragment.endsWith('&')
      ? ''
      : '&';
  return `${beforeFragment}${separator}${hubQuery}${fragment}`;
}
