/**
 * Qortino AI's files on this computer: the model parts downloaded from QDN,
 * other models the user added by link, and the downloads that lead to them.
 * Everything stays inside one folder in Hub's user data; paths from the
 * renderer are checked so they cannot leave it.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/** Folder name under Hub's user data. */
export const QORTINO_ROOT_NAME = 'Qortino AI';
/** Under the root: models the user added by a download link. */
export const OTHER_MODELS_DIR = 'other-models';

/**
 * `relativePath` inside `root`, or an error for a path that is absolute,
 * empty, or walks out of it.
 */
export function resolveInsideRoot(root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('A file inside the Qortino folder is required');
  }
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new Error('Qortino paths are relative to its folder');
  }
  const parts = relativePath.split(/[\\/]+/);
  if (parts.some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error('Qortino paths may not contain . or .. segments');
  }
  if ([...relativePath].some((ch) => ch.charCodeAt(0) < 0x20)) {
    throw new Error('Qortino paths may not contain control characters');
  }
  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Qortino paths must stay inside its folder');
  }
  return resolved;
}

/** A file name for a model downloaded by link, from its URL. */
export function modelFileNameFromUrl(url: string): string {
  let name = 'model.gguf';
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last) name = decodeURIComponent(last);
  } catch {
    /* keep the default */
  }
  const base = name
    .replace(/\.gguf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 150);
  return `${base || 'model'}.gguf`;
}

/**
 * Where a model downloaded by link is saved, under `other-models/`: a folder
 * per link (its address without the query), so two links that end in the
 * same file name never share a file, and the same file asked for again
 * (with `?download=true`, say) is found where it is.
 */
export function otherModelRelativePath(url: string): {
  relativePath: string;
  filename: string;
} {
  let key = url.trim();
  try {
    const parsed = new URL(url);
    // "?download=true" asks for the same file; any other query may name
    // another one (download.php?file=…).
    parsed.searchParams.delete('download');
    parsed.hash = '';
    key = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    /* hash what was given */
  }
  const folder = createHash('sha256').update(key).digest('hex').slice(0, 12);
  const filename = modelFileNameFromUrl(url);
  return {
    relativePath: `${OTHER_MODELS_DIR}/${folder}/${filename}`,
    filename,
  };
}

/** `absolutePath` (not resolved through links) lies inside `root`. */
export function isInsideRoot(root: string, absolutePath: string): boolean {
  if (!path.isAbsolute(absolutePath)) return false;
  const relative = path.relative(
    path.resolve(root),
    path.resolve(absolutePath)
  );
  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

/**
 * Model files the user picked in the file dialog, remembered across
 * restarts. Kept beside Qortino's folder, not in it: nothing that cleans or
 * downloads into that folder can touch the list.
 */
export const PICKED_MODELS_FILE = 'qortino-picked-models.json';

export function readPickedModels(listDir: string): Set<string> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(listDir, PICKED_MODELS_FILE), 'utf8')
    );
    return new Set(
      Array.isArray(raw)
        ? raw.filter((item: unknown) => typeof item === 'string')
        : []
    );
  } catch {
    return new Set();
  }
}

let pickedWrites: Promise<void> = Promise.resolve();

/** Add a picked file to the list; writes are in order, and each is whole. */
export function rememberPickedModel(
  listDir: string,
  picked: Set<string>,
  modelPath: string
): Promise<void> {
  picked.add(path.resolve(modelPath));
  const snapshot = JSON.stringify([...picked], null, 2);
  const write = async () => {
    await fs.promises.mkdir(listDir, { recursive: true });
    const target = path.join(listDir, PICKED_MODELS_FILE);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, snapshot);
    await fs.promises.rename(temp, target);
  };
  pickedWrites = pickedWrites.then(write, write);
  return pickedWrites;
}

/** Only model files are downloaded, and only into their two folders. */
export function isDownloadTarget(relativePath: string): boolean {
  return (
    /\.gguf$/i.test(relativePath) &&
    (relativePath.startsWith('models/') ||
      relativePath.startsWith(`${OTHER_MODELS_DIR}/`))
  );
}

/**
 * A model path the renderer may ask to load: inside Qortino's folder, or a
 * file the user picked in the dialog. Checked before the path is touched, so
 * a network path (\\host\share on Windows) the user never chose is not
 * opened.
 */
export function isLoadableModelPath(
  root: string,
  picked: Set<string>,
  modelPath: string
): boolean {
  if (!path.isAbsolute(modelPath) || !/\.gguf$/i.test(modelPath)) return false;
  return isInsideRoot(root, modelPath) || picked.has(path.resolve(modelPath));
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

export async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

export async function sha256File(
  filePath: string,
  onProgress?: (bytesRead: number, bytesTotal: number) => void
): Promise<{ sha256: string; size: number }> {
  const size = (await fileSize(filePath)) ?? 0;
  const hash = createHash('sha256');
  let read = 0;
  let lastReport = 0;
  const stream = fs.createReadStream(filePath, { highWaterMark: 4 << 20 });
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
    read += (chunk as Buffer).length;
    const now = Date.now();
    if (onProgress && now - lastReport > 200) {
      lastReport = now;
      onProgress(read, size);
    }
  }
  onProgress?.(read, size);
  return { sha256: hash.digest('hex'), size: read };
}

/**
 * Delete every file under `root` that is not in `keep` (paths relative to
 * the root, with forward slashes), then the folders left empty. Models the
 * user added by link are kept: they have a remove of their own.
 */
export async function cleanupStorage(
  root: string,
  keep: string[]
): Promise<{ deletedFiles: number; freedBytes: number }> {
  const kept = new Set(keep.map((item) => item.replace(/\\/g, '/')));
  let deletedFiles = 0;
  let freedBytes = 0;

  const walk = async (dir: string): Promise<boolean> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = toPosix(path.relative(root, full));
      if (relative === OTHER_MODELS_DIR) {
        empty = false;
        continue;
      }
      if (entry.isDirectory()) {
        if (await walk(full)) {
          await fs.promises.rmdir(full).catch(() => undefined);
        } else {
          empty = false;
        }
        continue;
      }
      if (kept.has(relative)) {
        empty = false;
        continue;
      }
      const size = (await fileSize(full)) ?? 0;
      try {
        await fs.promises.unlink(full);
        deletedFiles += 1;
        freedBytes += size;
      } catch {
        empty = false;
      }
    }
    return empty;
  };

  await walk(root);
  return { deletedFiles, freedBytes };
}

/** Free memory: Linux counts reclaimable cache too, like the system monitor. */
export function availableMemoryBytes(): number {
  if (process.platform === 'linux') {
    try {
      const info = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(info);
      if (match) return Number(match[1]) * 1024;
    } catch {
      /* fall through */
    }
  }
  return os.freemem();
}

export async function diskSpace(
  dir: string
): Promise<{ availBytes: number; totalBytes: number }> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const stat = await fs.promises.statfs(dir);
    return {
      availBytes: Number(stat.bavail) * Number(stat.bsize),
      totalBytes: Number(stat.blocks) * Number(stat.bsize),
    };
  } catch {
    return { availBytes: 0, totalBytes: 0 };
  }
}

export type DownloadEvents = {
  onProgress: (bytesReceived: number, bytesTotal: number) => void;
};

/** "fetch failed (ECONNREFUSED)" rather than just "fetch failed". */
export function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; message?: string } })
    ?.cause;
  const detail = cause?.code || cause?.message;
  return detail && detail !== message ? `${message} (${detail})` : message;
}

export class DownloadCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'DownloadCancelledError';
  }
}

/**
 * Download `url` to `target`, through `<target>.part`. A `.part` left by a
 * download that broke off is carried on with a Range request (a node behind
 * a proxy may cut long transfers). Cancel deletes the `.part`; any other
 * failure keeps it for the next try.
 */
export async function downloadToFile(options: {
  url: string;
  target: string;
  apiKey?: string;
  signal: AbortSignal;
  events: DownloadEvents;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; bytesWritten: number }> {
  const { target, signal, events } = options;
  const doFetch = options.fetchImpl ?? fetch;
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error('Not a valid download link');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https links can be downloaded');
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const partPath = `${target}.part`;

  const attempt = async (resume: boolean) => {
    const start = resume ? ((await fileSize(partPath)) ?? 0) : 0;
    const headers: Record<string, string> = {};
    if (options.apiKey) headers['X-API-KEY'] = options.apiKey;
    if (start > 0) headers.Range = `bytes=${start}-`;
    let res: Response;
    try {
      res = await doFetch(parsed.href, { headers, redirect: 'follow', signal });
    } catch (error) {
      if (signal.aborted) throw error;
      // fetch() says only "fetch failed"; the reason is in its cause.
      throw new Error(describeFetchError(error));
    }
    if (res.status === 416 && start > 0) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${res.status}`);
    }
    let from = 0;
    if (res.status === 206) {
      const range = /bytes\s+(\d+)-\d+\/(\d+|\*)/i.exec(
        res.headers.get('content-range') || ''
      );
      if (!range || Number(range[1]) !== start) {
        await res.body.cancel().catch(() => undefined);
        return null;
      }
      from = start;
    }
    const length = Number(res.headers.get('content-length') || 0);
    const total = length > 0 ? from + length : 0;
    let received = from;
    let lastReport = 0;
    events.onProgress(received, total);
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastReport > 250) {
        lastReport = now;
        events.onProgress(received, total);
      }
    });
    await pipeline(
      body,
      fs.createWriteStream(partPath, { flags: from > 0 ? 'a' : 'w' })
    );
    events.onProgress(received, total || received);
    return received;
  };

  try {
    let written = await attempt(true);
    if (written === null) {
      // The server would not carry on from where the last try stopped.
      await fs.promises.rm(partPath, { force: true });
      written = await attempt(false);
    }
    if (written === null) throw new Error('The server refused to resume');
    await fs.promises.rename(partPath, target);
    return { path: target, bytesWritten: written };
  } catch (error) {
    if (signal.aborted) {
      await fs.promises.rm(partPath, { force: true }).catch(() => undefined);
      throw new DownloadCancelledError();
    }
    throw error;
  }
}
