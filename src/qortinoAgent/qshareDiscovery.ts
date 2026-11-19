/**
 * Resolve the real QDN identifiers for the Qortino AI model parts.
 *
 * The parts are published with Q-Share, which mints a random identifier per
 * file (e.g. `qshare_file_qortino-ai_hE3ZLM`). Strategies, best first, so a
 * slow or cold node can still find them:
 *
 *  1. Q-Share metadata DOCUMENT (`…_metadata`) — authoritative filename ->
 *     identifier map, but requires downloading that resource's content.
 *  2. Resource listing + exact size match — index-only, no content fetch, so
 *     it works instantly on a node that has never seen the data.
 *  3. The identifiers of the current publish baked into this build.
 */
import { createEndpoint } from '../background/background';
import { PUBLISHED_QSHARE_FILES, QORTINO_QDN_NAME } from './manifest';

type QshareFileEntry = {
  filename: string;
  identifier: string;
  service: string;
  size?: number;
  mimetype?: string;
};

type QdnResourceRow = {
  identifier: string;
  service: string;
  size: number;
  created: number;
};

type QshareMetadataDoc = {
  files?: QshareFileEntry[];
};

const QSHARE_IDENTIFIER_PREFIX = 'qshare_file_';
const QSHARE_METADATA_SUFFIX = '_metadata';

/** Index lookups are cheap; fetching resource *content* can need peer chunks. */
const LIST_TIMEOUT_MS = 20_000;
const CONTENT_TIMEOUT_MS = 90_000;

/**
 * A part matches a listed resource when the sizes differ by at most this
 * fraction. Q-Share stores a FILE as-is, so sizes agree to the byte bar a
 * little container overhead; the two parts differ by far more than this.
 */
const SIZE_MATCH_TOLERANCE = 0.002;

let cachedFiles: Map<string, QshareFileEntry> | null = null;
let cachedFileRows: QdnResourceRow[] | null = null;

export function clearQortinoQshareCache(): void {
  cachedFiles = null;
  cachedFileRows = null;
}

async function fetchJson<T>(
  path: string,
  timeoutMs: number
): Promise<T | null> {
  try {
    const url = await createEndpoint(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function encodedName(): string {
  return encodeURIComponent(QORTINO_QDN_NAME);
}

/**
 * Every resource published under the Qortino AI name for a service.
 * `/arbitrary/resources` is used rather than `/resources/search` because the
 * search index only returns one row per name+service.
 */
export async function listQortinoResources(
  service: 'FILE' | 'DOCUMENT'
): Promise<QdnResourceRow[]> {
  if (service === 'FILE' && cachedFileRows) return cachedFileRows;
  const rows =
    (await fetchJson<Partial<QdnResourceRow>[]>(
      `/arbitrary/resources?service=${service}&name=${encodedName()}&limit=100`,
      LIST_TIMEOUT_MS
    )) || [];
  const parsed = rows
    .filter((row) => typeof row?.identifier === 'string')
    .map((row) => ({
      identifier: String(row.identifier),
      service: String(row.service || service),
      size: typeof row.size === 'number' ? row.size : 0,
      created: typeof row.created === 'number' ? row.created : 0,
    }));
  // Never cache an empty result — a node whose arbitrary-resource cache is
  // still building would otherwise stay "empty" for the whole session.
  if (service === 'FILE' && parsed.length) cachedFileRows = parsed;
  return parsed;
}

/**
 * Identifier for a part from the publish baked into this build. Last line of
 * defence when the node can serve neither the Q-Share metadata document nor
 * a resource listing.
 */
export function knownPublishedEntry(
  filename: string
): QshareFileEntry | undefined {
  const key = filename.toLowerCase();
  const hit = PUBLISHED_QSHARE_FILES[key];
  if (!hit) return undefined;
  return {
    filename: key,
    identifier: hit.identifier,
    service: hit.service,
    size: hit.sizeBytes,
  };
}

/**
 * Cheap status probe. `unknown` means the node did not answer — the caller
 * should keep going rather than treat that as a missing resource.
 */
export async function resourcePublishState(
  service: string,
  identifier: string
): Promise<'published' | 'missing' | 'unknown'> {
  const status = await fetchJson<{ status?: string }>(
    `/arbitrary/resource/status/${service}/${encodedName()}/${encodeURIComponent(identifier)}`,
    LIST_TIMEOUT_MS
  );
  if (!status?.status) return 'unknown';
  return status.status === 'NOT_PUBLISHED' ? 'missing' : 'published';
}

/** Newest-first Q-Share metadata documents for the Qortino AI name. */
async function listQshareMetadataIdentifiers(): Promise<string[]> {
  const rows = await listQortinoResources('DOCUMENT');
  return rows
    .filter(
      (row) =>
        row.identifier.startsWith(QSHARE_IDENTIFIER_PREFIX) &&
        row.identifier.endsWith(QSHARE_METADATA_SUFFIX)
    )
    .sort((a, b) => b.created - a.created)
    .map((row) => row.identifier);
}

/** Metadata documents read before giving up on finding every wanted file. */
const MAX_SHARES_SCANNED = 4;

/**
 * Map of lowercased filename -> Q-Share file entry, newest share first.
 * Shares are read until every name in `want` is found (or a few shares have
 * been read), so a later unrelated publish under the name does not hide the
 * model. Empty when no metadata document can be read (cold node, offline
 * peers) — callers fall back to size match.
 */
export async function discoverQortinoQshareFiles(options?: {
  force?: boolean;
  want?: string[];
}): Promise<Map<string, QshareFileEntry>> {
  const want = (options?.want || []).map((name) => name.toLowerCase());
  const hasAll = (map: Map<string, QshareFileEntry>) =>
    map.size > 0 && want.every((name) => map.has(name));
  if (cachedFiles && !options?.force && (!want.length || hasAll(cachedFiles))) {
    return cachedFiles;
  }

  const result = new Map<string, QshareFileEntry>();
  const metadataIds = await listQshareMetadataIdentifiers();
  let scanned = 0;

  for (const metadataId of metadataIds) {
    if (scanned >= MAX_SHARES_SCANNED) break;
    const doc = await fetchJson<QshareMetadataDoc>(
      `/arbitrary/DOCUMENT/${encodedName()}/${encodeURIComponent(metadataId)}`,
      CONTENT_TIMEOUT_MS
    );
    if (!doc?.files?.length) continue;
    scanned += 1;
    for (const file of doc.files) {
      const filename = String(file?.filename || '').trim();
      const identifier = String(file?.identifier || '').trim();
      if (!filename || !identifier) continue;
      const key = filename.toLowerCase();
      // Newest share wins — never overwrite with an older publish.
      if (result.has(key)) continue;
      result.set(key, {
        filename,
        identifier,
        service: String(file?.service || 'FILE'),
        size: typeof file?.size === 'number' ? file.size : undefined,
        mimetype: file?.mimetype,
      });
    }
    if (!want.length || hasAll(result)) break;
  }

  // Only cache a useful result, so a cold-node miss can be retried.
  if (result.size) cachedFiles = result;
  return result;
}

/** Q-Share entry for a part, by filename (case-insensitive). */
export function matchQshareEntry(
  files: Map<string, QshareFileEntry>,
  filename: string
): QshareFileEntry | undefined {
  return files.get(filename.toLowerCase());
}

/** The listed resource whose size is closest to `expectedBytes`, if close enough. */
export function matchResourceBySize(
  rows: QdnResourceRow[],
  expectedBytes: number,
  options?: { exclude?: Set<string> }
): QdnResourceRow | undefined {
  if (!rows.length || !expectedBytes || expectedBytes <= 0) return undefined;
  let best: QdnResourceRow | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!row.size) continue;
    if (options?.exclude?.has(row.identifier)) continue;
    const delta = Math.abs(row.size - expectedBytes) / expectedBytes;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = row;
    }
  }
  return bestDelta <= SIZE_MATCH_TOLERANCE ? best : undefined;
}
