/**
 * Node requests the desktop app's main process makes for Qortino (the model
 * download). The node API key travels apart from the URL, as an X-API-KEY
 * header, so it never shows up in a URL that lands in a log or an error.
 * Same as GO's utils/nativeNodeRequest.ts.
 */
import { getApiKeyFromStorage, getBaseApi } from '../background/background';
import { joinNodeEndpoint } from '../utils/nodeEndpointPath';

export type NodeRequest = {
  /** Present only when a custom node with an API key is configured. */
  apiKey?: string;
  /** The node URL, without the API key. */
  url: string;
};

type StoredNode = { apikey?: unknown; url?: unknown } | null;

/**
 * The same node and path createEndpoint would use, with the key split out.
 * The key is only sent to a custom node the user set up with one, exactly
 * as createEndpoint only adds it there.
 */
export async function createNativeNodeRequest(
  endpoint: string
): Promise<NodeRequest> {
  const stored = (await getApiKeyFromStorage()) as unknown as StoredNode;
  const customUrl =
    stored && typeof stored.url === 'string' && stored.url ? stored.url : '';
  const base = customUrl || (await getBaseApi());
  const url = joinNodeEndpoint(base, endpoint);
  const apiKey =
    customUrl && typeof stored?.apikey === 'string' ? stored.apikey.trim() : '';
  return apiKey ? { apiKey, url } : { url };
}

/** The URL without its query string, fragment or user info. */
export function stripUrlQuery(url: string): string {
  const value = String(url ?? '').trim();
  const cut = value.search(/[?#]/);
  const withoutQuery = cut === -1 ? value : value.slice(0, cut);
  return withoutQuery.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

/**
 * Free text with the query string removed from every http(s) URL in it and
 * any `apiKey=` value masked.
 */
export function redactUrlQueries(text: string): string {
  return String(text ?? '')
    .replace(/\b(https?:\/\/[^\s"'<>()?#]*)[?#][^\s"'<>()]*/gi, '$1')
    .replace(
      /\b(api[_-]?key|apikey)(\s*[=:]\s*)[^\s&"'<>,;]+/gi,
      '$1$2<redacted>'
    );
}
