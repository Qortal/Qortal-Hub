import { getApiKeyFromStorage } from '../../background/background';
import { EXT_NODE_QORTAL_LINK } from '../../constants/constants';
import { joinNodeEndpoint } from '../../utils/nodeEndpointPath';

/**
 * Why an action on the node didn't happen:
 * - `public`: the public node takes no admin actions;
 * - `no_key`: Hub has no API key for this node;
 * - `node_changed`: the key Hub holds is for another node;
 * - `refused`: the node refused the key;
 * - `invalid`: the node refused what was sent (an address it can't read);
 * - `no_time_sync`: the node's clock isn't synced yet;
 * - `failed`: anything else (no answer, an error page, a timeout).
 */
export type NodeAdminFailure =
  | 'public'
  | 'no_key'
  | 'node_changed'
  | 'refused'
  | 'invalid'
  | 'no_time_sync'
  | 'failed';

export class NodeAdminError extends Error {
  readonly reason: NodeAdminFailure;

  constructor(reason: NodeAdminFailure) {
    super(reason);
    this.reason = reason;
  }
}

/** Core's numbered errors (`ApiError`) the Node Manager tells apart. */
const CORE_ERRORS: Record<number, NodeAdminFailure> = {
  4: 'refused', // UNAUTHORIZED
  8: 'no_time_sync', // NO_TIME_SYNC
  115: 'invalid', // INVALID_DATA
  123: 'invalid', // INVALID_NETWORK_ADDRESS
};

/** Actions wait this long for the node; a force sync can take minutes. */
export const ADMIN_TIMEOUT_MS = 30_000;

const sameNode = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * Runs an admin call on the node in use, with Hub's API key for it.
 *
 * The key goes only to that node: never to the public node, never when the
 * key Hub holds belongs to another node, and never through a redirect. It
 * travels as the `apiKey` parameter, as Hub's other admin calls send it (a
 * custom header would need a CORS preflight the node doesn't allow).
 * Returns the node's answer as text; throws `NodeAdminError` otherwise.
 */
export const nodeAdminRequest = async (
  nodeBase: string,
  path: string,
  {
    body,
    method = 'GET',
    signal,
    timeoutMs = ADMIN_TIMEOUT_MS,
  }: {
    body?: string;
    method?: 'GET' | 'POST' | 'DELETE';
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<string> => {
  if (nodeBase.includes(EXT_NODE_QORTAL_LINK))
    throw new NodeAdminError('public');
  const stored = (await getApiKeyFromStorage()) as unknown as {
    apikey?: unknown;
    url?: unknown;
  } | null;
  const apiKey = typeof stored?.apikey === 'string' ? stored.apikey : '';
  if (!apiKey) throw new NodeAdminError('no_key');
  if (typeof stored?.url !== 'string' || !sameNode(stored.url, nodeBase))
    throw new NodeAdminError('node_changed');

  const url = new URL(joinNodeEndpoint(nodeBase, path));
  url.searchParams.set('apiKey', apiKey);

  // The caller may have given up while the key was read.
  if (signal?.aborted) throw new NodeAdminError('failed');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url.toString(), {
      body,
      credentials: 'omit',
      headers:
        body === undefined ? undefined : { 'Content-Type': 'text/plain' },
      method,
      redirect: 'error',
      signal: controller.signal,
    });
    text = await response.text();
  } catch {
    throw new NodeAdminError('failed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }

  let coreError: unknown = null;
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && typeof data.error === 'number')
      coreError = data.error;
  } catch {
    // Not JSON: Core's plain answers ("true", a sync result).
  }
  if (typeof coreError === 'number')
    throw new NodeAdminError(CORE_ERRORS[coreError] ?? 'failed');
  if (response.status === 401 || response.status === 403)
    throw new NodeAdminError('refused');
  if (!response.ok) throw new NodeAdminError('failed');
  return text.trim();
};

/** `host`, `host:port`, an IPv4 address, or `[IPv6]` with an optional port. */
const PEER_ADDRESS =
  /^(?:\[[0-9A-Fa-f:.]{2,45}\]|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)(?::(\d{1,5}))?$/;

/** A peer address the node can take, trimmed; null when it isn't one. */
export const parsePeerAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (!address || address.length > 300) return null;
  const match = PEER_ADDRESS.exec(address);
  if (!match) return null;
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (port < 1 || port > 65_535) return null;
  }
  return address;
};
