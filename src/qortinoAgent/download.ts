import { createEndpoint } from '../background/background';
import QortinoLlm, { isQortinoLlmNativeAvailable } from './qortinoLlm';
import {
  createNativeNodeRequest,
  redactUrlQueries,
  stripUrlQuery,
} from './nodeRequest';
import {
  modelPartRelativePath,
  QORTINO_MODEL,
  QORTINO_MODEL_LAYOUTS,
  QORTINO_MODEL_PUBLIC_NODE,
  QORTINO_QDN_NAME,
  type QortinoModelPart,
  type QortinoModelSpec,
} from './manifest';
import {
  discoverQortinoQshareFiles,
  knownPublishedEntry,
  listQortinoResources,
  matchQshareEntry,
  matchResourceBySize,
  resourcePublishState,
} from './qshareDiscovery';
import {
  clearLegacyInstall,
  saveInstallState,
  type QortinoInstallState,
} from './store';

export type DownloadPhase =
  | 'locate'
  | 'fetch'
  | 'save'
  | 'verify'
  | 'finalizing'
  | 'done';

export type DownloadProgress = {
  phase: DownloadPhase;
  /** 1-based part being worked on. */
  partIndex: number;
  partCount: number;
  bytesDone: number;
  bytesTotal: number;
};

export type QortinoInstallErrorCode =
  | 'not_published'
  | 'qdn_failed'
  | 'stalled'
  | 'download'
  | 'checksum'
  | 'cancelled';

/** Install failure the gate can explain in the user's language; `detail` is technical. */
export class QortinoInstallError extends Error {
  readonly code: QortinoInstallErrorCode;
  readonly detail?: string;

  constructor(code: QortinoInstallErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'QortinoInstallError';
    this.code = code;
    this.detail = detail;
  }
}

type ResolvedPart = QortinoModelPart & { identifier: string; service: string };

function capacitorErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const o = err as { message?: string; errorMessage?: string; code?: string };
    if (o.errorMessage) return o.errorMessage;
    if (o.message) return o.message;
    if (o.code) return String(o.code);
  }
  return 'download failed';
}

/**
 * Find the identifier each part was published under: the Q-Share filename
 * map first, then the identifiers baked into this build, then an exact size
 * match against the resource listing (works on a node that has not fetched
 * the metadata document yet).
 */
export async function resolveModelParts(
  model: QortinoModelSpec = QORTINO_MODEL
): Promise<ResolvedPart[]> {
  const want = model.parts.map((part) => part.filename);
  const [shared, fileRows] = await Promise.all([
    discoverQortinoQshareFiles({ want }).catch(
      () => new Map<string, never>() as never
    ),
    listQortinoResources('FILE').catch(() => []),
  ]);

  const claimed = new Set<string>();
  const resolved: ResolvedPart[] = [];
  for (const part of model.parts) {
    const byName = matchQshareEntry(shared, part.filename);
    if (byName && !claimed.has(byName.identifier)) {
      claimed.add(byName.identifier);
      resolved.push({
        ...part,
        identifier: byName.identifier,
        service: byName.service || 'FILE',
      });
      continue;
    }

    const known = knownPublishedEntry(part.filename);
    if (
      known &&
      !claimed.has(known.identifier) &&
      (await resourcePublishState(
        known.service || 'FILE',
        known.identifier
      )) !== 'missing'
    ) {
      claimed.add(known.identifier);
      resolved.push({
        ...part,
        identifier: known.identifier,
        service: known.service || 'FILE',
      });
      continue;
    }

    const bySize = matchResourceBySize(fileRows, part.sizeBytes, {
      exclude: claimed,
    });
    if (bySize) {
      claimed.add(bySize.identifier);
      resolved.push({
        ...part,
        identifier: bySize.identifier,
        service: bySize.service || 'FILE',
      });
      continue;
    }

    throw new QortinoInstallError('not_published', part.filename);
  }
  return resolved;
}

type ResourceStatusPayload = {
  status?: string;
  localChunkCount?: number;
  totalChunkCount?: number;
};

const TERMINAL_STATUS_FAILURES = new Set([
  'BLOCKED',
  'BUILD_FAILED',
  'FAILED_TO_DOWNLOAD',
  'NOT_PUBLISHED',
  'UNSUPPORTED',
]);

/** Give up only when the node stops making progress, not on a fixed clock. */
const CHUNK_STALL_TIMEOUT_MS = 6 * 60_000;
/**
 * Ask the node for the part again after this long without a new chunk. A node
 * that could not find the rest ("Unable to locate all files. Please try again
 * later") looks for peers again when asked.
 */
const REFETCH_AFTER_MS = 2 * 60_000;

function resourcePath(part: ResolvedPart): string {
  return (
    `/arbitrary/${encodeURIComponent(part.service)}/` +
    `${encodeURIComponent(QORTINO_QDN_NAME)}/${encodeURIComponent(part.identifier)}`
  );
}

function statusPath(part: ResolvedPart): string {
  return (
    `/arbitrary/resource/status/${encodeURIComponent(part.service)}/` +
    `${encodeURIComponent(QORTINO_QDN_NAME)}/${encodeURIComponent(part.identifier)}`
  );
}

async function fetchResourceStatus(
  part: ResolvedPart,
  signal?: AbortSignal
): Promise<ResourceStatusPayload | null> {
  try {
    const res = await fetch(await createEndpoint(statusPath(part)), { signal });
    if (!res.ok) return null;
    return (await res.json()) as ResourceStatusPayload;
  } catch {
    return null;
  }
}

/**
 * Ask the node to start pulling a part's chunks from peers. Fired for every
 * part up front, so the node fetches part 2 while part 1 is being saved.
 */
async function kickPartFetch(
  part: ResolvedPart,
  signal?: AbortSignal
): Promise<void> {
  const url = await createEndpoint(`${resourcePath(part)}?async=true`);
  void fetch(url, { signal }).catch(() => undefined);
}

/**
 * Wait until the node holds the assembled part.
 *
 * `GET /arbitrary/{service}/{name}/{identifier}` 404s while the data is not
 * assembled locally, which is always the case the first time a device asks for
 * a multi-GB file. Kicking an async build and polling the status endpoint is
 * what turns that 404 into a served file.
 */
async function waitForPartReady(
  part: ResolvedPart,
  onPercent: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  let delay = 500;
  let bestChunks = -1;
  let lastProgressAt = Date.now();
  let lastAskedAt = Date.now();

  for (;;) {
    if (signal?.aborted) throw new QortinoInstallError('cancelled');

    const status = await fetchResourceStatus(part, signal);
    const state = String(status?.status || '');
    const local = Number(status?.localChunkCount || 0);
    const total = Number(status?.totalChunkCount || 0);
    onPercent(
      state === 'READY'
        ? 100
        : total > 0
          ? Math.min(99, Math.round((local / total) * 100))
          : 0
    );

    if (state === 'READY') return;
    if (TERMINAL_STATUS_FAILURES.has(state)) {
      throw new QortinoInstallError('qdn_failed', `${part.filename}: ${state}`);
    }

    if (local > bestChunks) {
      bestChunks = local;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > CHUNK_STALL_TIMEOUT_MS) {
      throw new QortinoInstallError(
        'stalled',
        `${part.filename}: ${local}/${total || '?'} chunks (${state || 'unknown'})`
      );
    } else if (
      Date.now() - lastProgressAt > REFETCH_AFTER_MS &&
      Date.now() - lastAskedAt > REFETCH_AFTER_MS
    ) {
      lastAskedAt = Date.now();
      await kickPartFetch(part, signal);
    }

    // All chunks present but not assembled yet — ask the node to build.
    if (state === 'DOWNLOADED') {
      const buildUrl = await createEndpoint(`${statusPath(part)}?build=true`);
      void fetch(buildUrl, { signal }).catch(() => undefined);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(3_000, Math.round(delay * 1.2));
  }
}

/** Stream a part from the connected node straight into Qortino's folder. */
async function savePart(
  part: ResolvedPart,
  onBytes: (received: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const relativePath = modelPartRelativePath(part);
  const progressHandle = await QortinoLlm.addListener(
    'downloadProgress',
    (event) => {
      // Another model may be downloading at the same time.
      if (event.relativePath && event.relativePath !== relativePath) return;
      if (typeof event.bytesReceived === 'number') onBytes(event.bytesReceived);
    }
  );
  const onAbort = () => {
    void QortinoLlm.cancelDownload({ relativePath }).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort);
  try {
    // The main process sends the API key as an X-API-KEY header, so the
    // URL it logs and reports never contains it.
    const { apiKey, url } = await createNativeNodeRequest(resourcePath(part));
    try {
      await QortinoLlm.downloadUrl({
        ...(apiKey ? { apiKey } : {}),
        url,
        relativePath,
      });
    } catch (e) {
      if (signal?.aborted) throw new QortinoInstallError('cancelled');
      throw new QortinoInstallError(
        'download',
        `${redactUrlQueries(capacitorErrorMessage(e))} (${stripUrlQuery(url)})`
      );
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await progressHandle.remove().catch(() => undefined);
  }
}

async function partMatches(
  part: QortinoModelPart,
  onBytes?: (read: number) => void
): Promise<boolean> {
  const rel = modelPartRelativePath(part);
  const hit = await QortinoLlm.fileExists({ relativePath: rel });
  if (!hit.exists || (part.sizeBytes > 0 && hit.size !== part.sizeBytes))
    return false;
  if (!part.sha256) return true;
  const handle = onBytes
    ? await QortinoLlm.addListener('verifyProgress', (event) => {
        if (event.relativePath && event.relativePath !== rel) return;
        onBytes(event.bytesRead);
      })
    : null;
  try {
    const { sha256 } = await QortinoLlm.sha256File({ relativePath: rel });
    return sha256.toLowerCase() === part.sha256.toLowerCase();
  } finally {
    await handle?.remove().catch(() => undefined);
  }
}

/** Bytes of the model already on this computer at the right size (a retry after a failed part). */
export async function savedModelBytes(
  model?: QortinoModelSpec
): Promise<number> {
  if (!isQortinoLlmNativeAvailable()) return 0;
  // Without a layout: whichever one this computer has most of.
  if (!model) {
    const saved = await Promise.all(
      QORTINO_MODEL_LAYOUTS.map((layout) => savedModelBytes(layout))
    );
    return Math.max(0, ...saved);
  }
  let total = 0;
  for (const part of model.parts) {
    const hit = await QortinoLlm.fileExists({
      relativePath: modelPartRelativePath(part),
    }).catch(() => null);
    if (hit?.exists && hit.size === part.sizeBytes) {
      total += part.sizeBytes;
      continue;
    }
    // A download that broke off already holds its share of the space.
    const partial = await QortinoLlm.fileExists({
      relativePath: `${modelPartRelativePath(part)}.part`,
    }).catch(() => null);
    if (partial?.exists) total += Math.min(partial.size, part.sizeBytes);
  }
  return total;
}

/**
 * Delete everything in the Qortino folder that is not part of the current
 * model: the old Lite/Standard zips, their unpacked models and the old
 * knowledge file. Parts of either layout stay, also ones that broke off half
 * way (`.part`), so a download carries on from there even after Hub
 * switched nodes.
 */
export async function reclaimOldQortinoFiles(
  layouts: QortinoModelSpec[] = QORTINO_MODEL_LAYOUTS
): Promise<number> {
  if (!isQortinoLlmNativeAvailable()) return 0;
  const { freedBytes } = await QortinoLlm.cleanupStorage({
    keep: layouts.flatMap((layout) =>
      layout.parts.flatMap((part) => [
        modelPartRelativePath(part),
        `${modelPartRelativePath(part)}.part`,
      ])
    ),
  });
  return freedBytes;
}

/**
 * Which layout to download: the one already (partly) on this computer, so no
 * progress is thrown away; otherwise three parts under 1 GiB on the public
 * node and two on a private node.
 */
export async function chooseQortinoModelLayout(
  publicNode: boolean
): Promise<QortinoModelSpec> {
  let best: QortinoModelSpec | null = null;
  let bestBytes = 0;
  for (const layout of QORTINO_MODEL_LAYOUTS) {
    const bytes = await savedModelBytes(layout);
    if (bytes > bestBytes) {
      best = layout;
      bestBytes = bytes;
    }
  }
  if (best) return best;
  return publicNode ? QORTINO_MODEL_PUBLIC_NODE : QORTINO_MODEL;
}

/**
 * Download, verify and record the model. Parts already on this computer with
 * the right checksum (a retry after a failed second part) are kept.
 */
export async function installQortinoModel(options: {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  model?: QortinoModelSpec;
}): Promise<QortinoInstallState> {
  const { onProgress, signal } = options;
  const model = options.model ?? QORTINO_MODEL;
  if (!isQortinoLlmNativeAvailable()) {
    throw new QortinoInstallError('download', 'desktop app required');
  }
  const partCount = model.parts.length;
  const report = (
    phase: DownloadPhase,
    partIndex: number,
    bytesDone: number,
    bytesTotal: number
  ) => onProgress?.({ phase, partIndex, partCount, bytesDone, bytesTotal });

  report('locate', 1, 0, 0);
  const resolved = await resolveModelParts(model);
  if (signal?.aborted) throw new QortinoInstallError('cancelled');
  const onDisk = await Promise.all(
    resolved.map(async (part) => {
      const hit = await QortinoLlm.fileExists({
        relativePath: modelPartRelativePath(part),
      });
      return hit.exists && hit.size === part.sizeBytes;
    })
  );
  await Promise.all(
    resolved
      .filter((_, i) => !onDisk[i])
      .map((part) => kickPartFetch(part, signal))
  );

  for (let i = 0; i < resolved.length; i += 1) {
    const part = resolved[i];
    const index = i + 1;
    if (signal?.aborted) throw new QortinoInstallError('cancelled');

    if (onDisk[i]) {
      report('verify', index, 0, part.sizeBytes);
      if (
        await partMatches(part, (read) =>
          report('verify', index, read, part.sizeBytes)
        )
      ) {
        continue;
      }
      await kickPartFetch(part, signal);
    }

    await waitForPartReady(
      part,
      (percent) =>
        report(
          'fetch',
          index,
          Math.round((percent / 100) * part.sizeBytes),
          part.sizeBytes
        ),
      signal
    );
    await savePart(
      part,
      (received) => report('save', index, received, part.sizeBytes),
      signal
    );

    report('verify', index, 0, part.sizeBytes);
    if (
      !(await partMatches(part, (read) =>
        report('verify', index, read, part.sizeBytes)
      ))
    ) {
      // Drop the bad copy so the next attempt downloads it again.
      await QortinoLlm.cleanupStorage({
        keep: model.parts
          .filter((other) => other.filename !== part.filename)
          .map(modelPartRelativePath),
      }).catch(() => undefined);
      throw new QortinoInstallError('checksum', part.filename);
    }
  }

  report('finalizing', partCount, 0, 0);
  // The model is whole: the other layout's leftovers can go.
  await reclaimOldQortinoFiles([model]).catch(() => 0);
  const { rootDir } = await QortinoLlm.getStoragePaths();
  const state: QortinoInstallState = {
    installed: true,
    modelId: model.id,
    llmPath: `${rootDir.replace(/\/$/, '')}/${modelPartRelativePath(model.parts[0])}`,
    installedAt: Date.now(),
  };
  await saveInstallState(state);
  await clearLegacyInstall();
  report('done', partCount, 1, 1);
  return state;
}
