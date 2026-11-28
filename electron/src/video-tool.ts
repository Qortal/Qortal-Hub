/**
 * Home's Video publisher engine in Electron main: the files a page added,
 * ffprobe summaries, cover frames, one-at-a-time ffmpeg jobs in
 * <userData>/video-publisher-jobs, chunk uploads read from disk, and the
 * hub-video:// preview. The renderer reaches files only by id.
 */
import { randomBytes, randomUUID } from 'crypto';
import { spawn as spawnProcess } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { createReadStream, promises as fs, statSync } from 'fs';
import type { Dirent } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  VIDEO_TOOL_CHANNELS,
  VIDEO_TOOL_MAX_CHUNK_BYTES,
  VIDEO_TOOL_MAX_SUBTITLE_BYTES,
  VIDEO_TOOL_PREVIEW_SCHEME,
  videoToolErrorMessage,
} from './video-tool-types';
import type {
  VideoFrame,
  VideoJobErrorCode,
  VideoJobEvent,
  VideoJobFailedSubtitle,
  VideoJobOutput,
  VideoJobQuality,
  VideoJobSpec,
  VideoJobState,
  VideoJobSubtitle,
  VideoProbe,
  VideoSource,
  VideoToolErrorCode,
  VideoToolStatus,
  VideoUploadRequest,
  VideoCodec,
  VideoNodeBuildRequest,
  VideoNodeBuildResult,
  VideoPickRequest,
  VideoSaveResult,
  VideoUploadResult,
} from './video-tool-types';
import { ProbeSummaryError, summarizeProbe } from './video-tool-probe';
import type { FfprobeJson } from './video-tool-probe';
import {
  fpsRational,
  planVideoJob,
  retryTwoPassKbps,
  retryUnderOriginalKbps,
  withVideoCap,
  subtitleFileArgs,
  subtitleStreamArgs,
  twoPassLogBytes,
  withVideoBitrate,
  type PlannedSubtitle,
} from './video-tool-plan';
import { FfmpegProgressParser, jobProgress } from './video-tool-progress';
import {
  PICKABLE_EXTENSIONS,
  VideoSourceRegistry,
  type SourceEntry,
} from './video-tool-sources';

const MiB = 1024 * 1024;
const JOBS_FOLDER = 'video-publisher-jobs';
const VIDEO_FILE = 'video.mp4';
const SUBTITLE_FOLDER = 'subtitles';
/** Room kept free besides the output itself. */
const FREE_SPACE_MARGIN = 64 * MiB;
const FREE_SPACE_FACTOR = 1.1;
const MAX_SUBTITLE_SOURCE_BYTES = 10 * MiB;
const MAX_PROBE_OUTPUT_BYTES = 32 * MiB;
const MAX_FRAME_BYTES = 8 * MiB;
const MAX_FILES_PER_CALL = 2000;
const MAX_FRAMES = 32;
/** How deep a picked folder is read (a season inside a series folder…). */
const MAX_FOLDER_DEPTH = 6;
const MAX_DIALOG_TEXT = 200;
/** Saved videos a page can still open from its cards. */
const MAX_SAVED_FILES = 500;
const DEFAULT_FRAME_COUNT = 4;
const DEFAULT_FRAME_WIDTH = 640;
const MAX_FRAME_WIDTH = 1920;
const MIN_FRAME_WIDTH = 64;
/** Frames avoid the first and last 3 % (black fades, credits). */
const FRAME_EDGE_SHARE = 0.03;
const PROBE_TIMEOUT_MS = 60_000;
const FRAME_TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 15_000;
const SUBTITLE_TIMEOUT_MS = 60_000;
/** Reading a file that doesn't give its length, to measure it. */
const MEASURE_TIMEOUT_MS = 10 * 60_000;
/** A video's own tracks: ffmpeg reads the whole file to find their cues. */
const STREAM_SUBTITLE_TIMEOUT_MS = 30 * 60_000;
/** Probes and frame grabs that may run at once (encodes run one at a time). */
const SMALL_RUN_CONCURRENCY = 3;
const STDERR_TAIL_BYTES = 4096;
/** After encoding, subtitles fill the last few percent. */
const ENCODE_SHARE_WITH_SUBTITLES = 97;
/** ffmpeg's or the system's words for a full disk. */
const DISK_FULL = /No space left on device|ENOSPC/i;
// A configured node URL can include a reverse-proxy path prefix.
const CHUNK_ENDPOINT_PATH =
  /\/arbitrary\/[A-Za-z0-9_]+\/[^/]+(?:\/[^/]+)?\/chunk$/;
/** Core's publish-from-path route: /arbitrary/<SERVICE>/<name>[/<id>]. */
const PATH_ENDPOINT_PATH = /\/arbitrary\/[A-Z0-9_]+\/[^/]+(?:\/[^/]+)?$/;
/** Core's routes that would take the body as data instead of a path. */
const PATH_ENDPOINT_RESERVED = new Set([
  'base64',
  'string',
  'zip',
  'chunk',
  'finalize',
]);
/** The folders a node reads a job's file from, inside the job's folder. */
const NODE_LINK_PREFIX = 'node-';
/** Characters Windows can't have in a file name. */
const WINDOWS_NAME_FORBIDDEN = /[<>:"|?*]/g;
const BASE58_TEXT = /^[1-9A-HJ-NP-Za-km-z]+$/;
const QUALITIES: VideoJobQuality[] = [
  '1080',
  '720',
  '540',
  '480',
  '360',
  'original',
  'keep',
];
const JOB_ID = /^[0-9a-f-]{36}$/;

export class VideoToolError extends Error {
  constructor(
    readonly code: VideoToolErrorCode,
    readonly detail?: string
  ) {
    super(videoToolErrorMessage(code, detail));
  }
}

class JobFailure extends Error {
  constructor(
    readonly code: VideoJobErrorCode,
    detail?: string
  ) {
    super(detail ?? code);
  }
}

/** A run stopped for taking longer than its time limit. */
class RunTimedOut extends Error {}

/** Where ffmpeg and ffprobe live for this platform. */
export function resolveFfmpegDir({
  isPackaged,
  resourcesPath,
  appPath,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
}: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (env.QORTAL_HUB_FFMPEG_DIR) return path.resolve(env.QORTAL_HUB_FFMPEG_DIR);
  const name =
    platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux';
  const target = `${name}-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  return isPackaged
    ? path.join(resourcesPath, 'ffmpeg', target)
    : path.join(appPath, 'resources', 'ffmpeg', target);
}

/**
 * Decodes subtitle bytes for a preview or a conversion. A BOM wins; without
 * one, UTF-8 is tried strictly and `valid: false` means the user should pick
 * the file's real encoding.
 */
export function decodeSubtitleBytes(
  bytes: Uint8Array,
  encoding?: string
): { text: string; encoding: string; valid: boolean } {
  const bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? 'utf-8'
      : bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : undefined;
  const label = encoding?.trim() || bom || 'utf-8';
  let strict: TextDecoder;
  try {
    strict = new TextDecoder(label, { fatal: true });
  } catch {
    throw new VideoToolError('unsupported-encoding', label);
  }
  try {
    return {
      text: strict.decode(bytes),
      encoding: strict.encoding,
      valid: true,
    };
  } catch {
    return {
      text: new TextDecoder(label).decode(bytes),
      encoding: strict.encoding,
      valid: false,
    };
  }
}

/** The usual pre-UTF-8 encoding of each language (ISO 639-1 and 639-2). */
const LEGACY_SUBTITLE_ENCODINGS = new Map(
  Object.entries({
    'windows-1251': 'ru rus uk ukr bg bul be bel mk mac mkd',
    'windows-1250':
      'pl pol cs cze ces sk slo slk sl slv hu hun hr hrv ro rum ron bs bos sq alb sqi',
    'windows-1253': 'el gre ell',
    'windows-1254': 'tr tur az aze',
    'windows-1255': 'he heb yi yid',
    'windows-1256': 'ar ara fa per fas ur urd',
    'windows-1257': 'lt lit lv lav et est',
    'windows-1258': 'vi vie',
    'windows-874': 'th tha',
    shift_jis: 'ja jpn',
    'euc-kr': 'ko kor',
    gb18030: 'zh chi zho',
  }).flatMap(([encoding, languages]) =>
    languages.split(' ').map((language) => [language, encoding] as const)
  )
);

/**
 * The encoding a subtitle file that isn't UTF-8 most likely has, from its
 * track's language; Western European for any other.
 */
export function legacySubtitleEncoding(language?: string): string {
  const primary = (language ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return LEGACY_SUBTITLE_ENCODINGS.get(primary) ?? 'windows-1252';
}

/** Serves a file with single-range support, for the preview scheme. */
export async function fileResponse(
  filePath: string,
  {
    mimeType,
    range,
    method = 'GET',
    headers: extraHeaders = {},
  }: {
    mimeType: string;
    range?: string | null;
    method?: string;
    headers?: Record<string, string>;
  }
): Promise<Response> {
  const { size } = await fs.stat(filePath);
  const headers: Record<string, string> = {
    'content-type': mimeType,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    ...extraHeaders,
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      // "bytes=-500": the last 500 bytes.
      start = Math.max(0, size - Number(match[2]));
    }
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${size}` },
      });
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  const length = size === 0 ? 0 : end - start + 1;
  headers['content-length'] = String(length);
  if (method === 'HEAD' || length === 0) {
    return new Response(null, { status, headers });
  }
  const body = Readable.toWeb(
    createReadStream(filePath, { start, end })
  ) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

/** A small concurrency limit for probes and frame grabs. */
function limiter(size: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= size) await new Promise<void>((go) => waiting.push(go));
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderrTail: string;
};

type RunOptions = {
  onStdout?: (text: string) => void;
  /** Keep stdout (up to this many bytes) for the result. */
  keepStdout?: number;
  timeoutMs?: number;
  lowPriority?: boolean;
};

export type VideoToolDeps = {
  /** <userData>/video-publisher-jobs's parent, read when first needed. */
  userDataDir: () => string;
  /** The folder holding ffmpeg and ffprobe. */
  binDir: () => string;
  /** Sends a job's state to the page that started it. */
  emit: (ownerId: number, event: VideoJobEvent) => void;
  /** Chromium's fetch (net.fetch), so Hub's certificate rules apply. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  showSaveDialog: (options: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
    properties?: ('showOverwriteConfirmation' | 'createDirectory')[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog?: (options: {
    title: string;
    buttonLabel: string;
    properties: ('openFile' | 'openDirectory' | 'multiSelections')[];
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  /** The system's player for a saved video. */
  openPath?: (filePath: string) => Promise<void>;
  /** The file manager, with the saved video selected. */
  showItemInFolder?: (filePath: string) => void;
  spawn?: (
    command: string,
    args: string[],
    options: SpawnOptions
  ) => ChildProcess;
  freeBytes?: (dir: string) => Promise<number | null>;
  /** The PC's logical processors (tests); os.cpus() otherwise. */
  cpuThreads?: () => number;
  /**
   * Whether a chunk may be posted to this endpoint (the node Hub uses).
   * Without it, only localhost is allowed.
   */
  allowEndpoint?: (endpoint: string) => boolean;
  platform?: NodeJS.Platform;
  /** Milliseconds (tests); Date.now otherwise. */
  now?: () => number;
  log?: (...args: unknown[]) => void;
};

type Job = {
  ownerId: number;
  state: VideoJobState;
  dir: string;
  source: SourceEntry;
  /** External subtitle files, by spec index, captured at start. */
  subtitleSources: Map<number, SourceEntry>;
  child?: ChildProcess;
  /** The running process may be stopped for a pause (it has no timeout). */
  childPausable?: boolean;
  cancelled: boolean;
  released: boolean;
  /** The source as read when the job started. */
  probe?: VideoProbe;
  outputProbe?: VideoProbe;
  paused: boolean;
  pausedAt?: number;
  /** Time spent paused, all told (time left leaves it out). */
  pausedMs: number;
  /** Runs waiting for a resume before they start their process. */
  resumeWaiters: (() => void)[];
  /** Subtitles written again after the job: new names each time. */
  subtitleGeneration: number;
  /**
   * The WebVTT file written from each subtitle source (stream index, or
   * file and encoding), by output id: a language or label change reuses it.
   */
  writtenSubtitles: Map<string, string>;
  /** The subtitles being written again, one list at a time. */
  remaking?: Promise<unknown>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const shortString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** A clean copy of a renderer's spec, or null when it's malformed. */
export function normalizeJobSpec(raw: unknown): VideoJobSpec | null {
  if (!isObject(raw)) return null;
  const {
    sourceId,
    quality,
    codec,
    audioIndex,
    burnSubtitleIndex,
    sizeLimitBytes,
  } = raw;
  if (!shortString(sourceId, 200)) return null;
  if (!QUALITIES.includes(quality as VideoJobQuality)) return null;
  if (codec !== undefined && codec !== 'av1' && codec !== 'h264') return null;
  if (audioIndex !== undefined && audioIndex !== null && !isIndex(audioIndex))
    return null;
  if (
    burnSubtitleIndex !== undefined &&
    burnSubtitleIndex !== null &&
    !isIndex(burnSubtitleIndex)
  )
    return null;
  if (
    typeof sizeLimitBytes !== 'number' ||
    !Number.isSafeInteger(sizeLimitBytes) ||
    sizeLimitBytes <= 0
  )
    return null;
  const subtitles = normalizeSubtitles(raw.subtitles);
  if (!subtitles) return null;
  return {
    sourceId: sourceId as string,
    quality: quality as VideoJobQuality,
    ...(codec ? { codec: codec as VideoCodec } : {}),
    ...(audioIndex !== undefined ? { audioIndex: audioIndex as number } : {}),
    subtitles,
    ...(burnSubtitleIndex !== undefined
      ? { burnSubtitleIndex: burnSubtitleIndex as number }
      : {}),
    sizeLimitBytes,
  };
}

/** A job's subtitle list from the renderer, checked; null when malformed. */
function normalizeSubtitles(raw: unknown): VideoJobSubtitle[] | null {
  const rawSubtitles = raw ?? [];
  if (!Array.isArray(rawSubtitles) || rawSubtitles.length > 64) return null;
  const subtitles: VideoJobSubtitle[] = [];
  for (const track of rawSubtitles) {
    if (!isObject(track) || !shortString(track.language, 35)) return null;
    if (track.label !== undefined && typeof track.label !== 'string')
      return null;
    const label =
      typeof track.label === 'string' && track.label
        ? { label: track.label.slice(0, 200) }
        : {};
    if (track.source === 'stream' && isIndex(track.index)) {
      subtitles.push({
        source: 'stream',
        index: track.index,
        language: track.language as string,
        ...label,
      });
    } else if (track.source === 'file' && shortString(track.sourceId, 200)) {
      if (track.encoding !== undefined && !shortString(track.encoding, 64))
        return null;
      subtitles.push({
        source: 'file',
        sourceId: track.sourceId as string,
        language: track.language as string,
        ...label,
        ...(track.encoding ? { encoding: track.encoding as string } : {}),
      });
    } else return null;
  }
  return subtitles;
}

/** Checks a publishData chunk endpoint: http(s)://…/arbitrary/…/chunk. */
export function isChunkEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      CHUNK_ENDPOINT_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Checks a publishData endpoint for Core's publish-from-path route:
 * http(s)://…/arbitrary/<SERVICE>/<name>[/<identifier>], not one of the
 * routes beside it that would read the body as the data itself.
 */
export function isPathPublishEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      !PATH_ENDPOINT_PATH.test(url.pathname)
    ) {
      return false;
    }
    // Each of those routes ends in its own name.
    const last = url.pathname.split('/').pop() ?? '';
    return !PATH_ENDPOINT_RESERVED.has(decodeURIComponent(last).toLowerCase());
  } catch {
    return false;
  }
}

/** A node on this PC, which can read Hub's files itself. */
export function isThisPcEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return (
      host === 'localhost' ||
      host === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
}

/**
 * The name a node publishes a file under: the last part of the name
 * publishData gives (as Core's finalize takes it), else the file's own.
 */
export function nodeFileName(
  filename: unknown,
  fallback: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (typeof filename !== 'string') return fallback;
  let last = (filename.split(/[\\/]/).pop() ?? '').trim();
  if (platform === 'win32') last = last.replace(WINDOWS_NAME_FORBIDDEN, '_');
  if (
    !last ||
    last === '.' ||
    last === '..' ||
    [...last].some((char) => char.charCodeAt(0) < 32) ||
    Buffer.byteLength(last) > 200
  ) {
    return fallback;
  }
  return last;
}

/**
 * Whether main may send a job's file to `endpoint`: the same origins the main
 * window's CSP lets it connect to (localhost, and the node addresses Hub
 * knows, with any scheme for a local or private one).
 */
export function isAllowedNodeEndpoint(
  endpoint: string,
  allowedDomains: readonly string[],
  isLocalPrivateHost: (host: string) => boolean = () => false
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  return allowedDomains.some((domain) => {
    try {
      const allowed = new URL(domain);
      if (allowed.origin === url.origin) return true;
      return isLocalPrivateHost(allowed.hostname) && allowed.host === url.host;
    } catch {
      return false;
    }
  });
}

/** A MicroDVD file ({start}{end}text, in frames), and its own rate line. */
export function microdvdTiming(text: string): {
  microdvd: boolean;
  ownRate: boolean;
} {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const first = lines.find((line) => line.trim()) ?? '';
  const microdvd = /^\s*\{\d+\}\{\d*\}/.test(first);
  return {
    microdvd,
    ownRate: microdvd && /^\s*\{1\}\{1\}\s*\d+(?:[.,]\d+)?\s*$/.test(first),
  };
}

/** A binary (VobSub/MPEG-PS) .sub: pictures, not text. */
export function looksLikePictureSub(bytes: Uint8Array): boolean {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0xba
  ) {
    return true;
  }
  const head = bytes.subarray(0, 4096);
  return head.includes(0);
}

/** The same multipart body a renderer's FormData would send. */
export function chunkFormData(
  bytes: Uint8Array,
  index: number,
  filename: string,
  boundary = `----HubVideoTool${randomBytes(12).toString('hex')}`
): { body: Uint8Array; contentType: string } {
  const safeName = filename.replace(/["\r\n\\]/g, '_');
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="chunk"; ` +
        `filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ),
    bytes,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="index"` +
        `\r\n\r\n${index}\r\n--${boundary}--\r\n`
    ),
  ]);
  return {
    body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** A file name for the save dialog: no folders, no control characters. */
export function safeOutputName(suggested: unknown): string {
  const text = typeof suggested === 'string' ? suggested : '';
  const base = [...text]
    .map((char) => (char < ' ' ? ' ' : char))
    .join('')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, 120)
    .trim();
  const name = base || 'video';
  return /\.mp4$/i.test(name) ? name : `${name}.mp4`;
}

async function statfsFree(dir: string): Promise<number | null> {
  try {
    const stats = await fs.statfs(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function setLowPriority(pid: number | undefined): void {
  if (!pid) return;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not allowed on this system: ffmpeg runs at normal priority.
  }
}

/**
 * Every file in a folder and the folders in it, sorted by name, as
 * { path, name, relativePath } with the folder's own name first in
 * relativePath. Hidden entries and links are left out; at most `limit`.
 */
export async function listFolder(
  root: string,
  limit: number
): Promise<{ path: string; name: string; relativePath: string }[]> {
  const found: { path: string; name: string; relativePath: string }[] = [];
  const walk = async (dir: string, relative: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    for (const entry of entries) {
      if (found.length >= limit) return;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth < MAX_FOLDER_DEPTH) await walk(full, rel, depth + 1);
      } else if (entry.isFile()) {
        found.push({ path: full, name: entry.name, relativePath: rel });
      }
    }
  };
  await walk(root, path.basename(root), 1);
  return found;
}

export class VideoToolService {
  readonly sources = new VideoSourceRegistry();
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private readonly smallRuns = limiter(SMALL_RUN_CONCURRENCY);
  /** Reading a whole file for its length: one at a time. */
  private readonly measureRuns = limiter(1);
  /** Probes under way, so a second caller waits for the same one. */
  private readonly probing = new WeakMap<
    SourceEntry,
    { size: number; mtimeMs: number; result: Promise<VideoProbe> }
  >();
  private readonly children = new Set<ChildProcess>();
  private version: string | null = null;
  /** Whether this ffmpeg can write AV1 (asked once, with the version). */
  private av1: boolean | null = null;
  /** Hub is quitting: nothing new starts. */
  private stopping = false;
  /** Files saved through the dialog, per page: openSaved opens only these. */
  private readonly savedFiles = new Map<number, Map<string, string>>();

  constructor(private readonly deps: VideoToolDeps) {}

  private get spawn() {
    return this.deps.spawn ?? spawnProcess;
  }

  jobsRoot(): string {
    return path.join(this.deps.userDataDir(), JOBS_FOLDER);
  }

  private binary(name: 'ffmpeg' | 'ffprobe'): string {
    const platform = this.deps.platform ?? process.platform;
    return path.join(
      this.deps.binDir(),
      platform === 'win32' ? `${name}.exe` : name
    );
  }

  /**
   * Whether ffmpeg and ffprobe came with this Hub, asked as the main window
   * opens: a Hub built without them gets no Video publisher at all.
   */
  hasBinaries(): boolean {
    return (['ffmpeg', 'ffprobe'] as const).every((name) => {
      try {
        return statSync(this.binary(name)).isFile();
      } catch {
        return false;
      }
    });
  }

  /** Jobs live only in memory, so every folder left from a last run goes. */
  async removeStaleJobs(): Promise<void> {
    await fs.rm(this.jobsRoot(), { recursive: true, force: true });
  }

  /**
   * Kills every ffmpeg/ffprobe (on quit) and starts nothing more: the queued
   * jobs are cancelled. Their folders go at next start.
   */
  shutdown(): void {
    this.stopping = true;
    for (const job of this.queue.splice(0)) {
      job.cancelled = true;
      this.update(job, { phase: 'cancelled', etaSec: undefined });
    }
    if (this.running) {
      this.running.cancelled = true;
      this.wakePaused(this.running);
    }
    for (const child of this.children) child.kill('SIGKILL');
    this.children.clear();
  }

  private async run(
    name: 'ffmpeg' | 'ffprobe',
    args: string[],
    options: RunOptions = {},
    job?: Job
  ): Promise<RunResult> {
    // A paused job starts nothing new until it's resumed (or cancelled).
    if (job?.paused) {
      await new Promise<void>((resume) => job.resumeWaiters.push(resume));
      this.checkCancelled(job);
    }
    return this.spawnRun(name, args, options, job);
  }

  private spawnRun(
    name: 'ffmpeg' | 'ffprobe',
    args: string[],
    options: RunOptions,
    job?: Job
  ): Promise<RunResult> {
    if (this.stopping) {
      return Promise.reject(new VideoToolError('cancelled'));
    }
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawn(this.binary(name), args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(error);
        return;
      }
      this.children.add(child);
      if (job) {
        job.child = child;
        // One with a timeout (subtitles, frames) is short: a pause lets it
        // finish and holds the next one instead.
        job.childPausable = !options.timeoutMs;
      }
      if (options.lowPriority) setLowPriority(child.pid);
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrTail = '';
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      const finish = (error: Error | null, result?: RunResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.children.delete(child);
        if (job?.child === child) job.child = undefined;
        if (error) reject(error);
        else resolve(result);
      };
      child.stdout?.on('data', (data: Buffer) => {
        if (options.onStdout) options.onStdout(data.toString('utf8'));
        if (options.keepStdout === undefined) return;
        stdoutBytes += data.length;
        if (stdoutBytes > options.keepStdout) {
          child.kill('SIGKILL');
          finish(new Error(`${name} printed more than expected`));
          return;
        }
        stdout.push(data);
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderrTail = (stderrTail + data.toString('utf8')).slice(
          -STDERR_TAIL_BYTES
        );
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code, signal) =>
        finish(null, {
          code,
          signal,
          stdout: Buffer.concat(stdout),
          stderrTail: stderrTail.trim(),
        })
      );
      if (options.timeoutMs) {
        timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(new RunTimedOut(`${name} timed out`));
        }, options.timeoutMs);
      }
    });
  }

  async status(): Promise<VideoToolStatus> {
    try {
      await fs.access(this.binary('ffmpeg'));
      await fs.access(this.binary('ffprobe'));
    } catch {
      return { available: false, reason: 'missing-binary' };
    }
    if (!this.version) {
      try {
        const result = await this.run('ffmpeg', ['-hide_banner', '-version'], {
          keepStdout: 1 * MiB,
          timeoutMs: VERSION_TIMEOUT_MS,
        });
        if (result.code !== 0) throw new Error(result.stderrTail);
        this.version =
          /ffmpeg version (\S+)/.exec(result.stdout.toString('utf8'))?.[1] ??
          'unknown';
      } catch (error) {
        this.deps.log?.('[VideoTool] ffmpeg -version failed:', error);
        return { available: false, reason: 'failed' };
      }
    }
    if (this.av1 === null) {
      try {
        const result = await this.run('ffmpeg', ['-hide_banner', '-encoders'], {
          keepStdout: 1 * MiB,
          timeoutMs: VERSION_TIMEOUT_MS,
        });
        // A list that didn't come says nothing: it's asked for again next
        // time, rather than leaving AV1 off until Hub restarts.
        if (result.code === 0) {
          this.av1 = /\blibsvtav1\b/.test(result.stdout.toString('utf8'));
        }
      } catch (error) {
        this.deps.log?.('[VideoTool] ffmpeg -encoders failed:', error);
      }
    }
    await fs.mkdir(this.jobsRoot(), { recursive: true }).catch(() => undefined);
    const freeBytes = await (this.deps.freeBytes ?? statfsFree)(
      this.jobsRoot()
    );
    return {
      available: true,
      ffmpegVersion: this.version,
      freeBytes,
      av1: this.av1 === true,
      canPause: this.canPause(),
      cpuThreads: Math.max(
        1,
        this.deps.cpuThreads?.() ?? os.cpus().length ?? 1
      ),
    };
  }

  async addFiles(ownerId: number, files: unknown): Promise<VideoSource[]> {
    if (!Array.isArray(files) || files.length > MAX_FILES_PER_CALL) {
      throw new VideoToolError('invalid-request', 'files');
    }
    const checked = [];
    for (const file of files) {
      if (
        !isObject(file) ||
        typeof file.path !== 'string' ||
        !path.isAbsolute(file.path) ||
        file.path.includes('\0')
      ) {
        continue;
      }
      try {
        const stats = await fs.stat(file.path);
        if (!stats.isFile()) continue;
        const relativePath =
          typeof file.relativePath === 'string' &&
          file.relativePath.length <= 4096
            ? file.relativePath
            : undefined;
        const name =
          typeof file.name === 'string' && file.name && file.name.length <= 1024
            ? file.name
            : path.basename(file.path);
        checked.push({ path: file.path, name, size: stats.size, relativePath });
      } catch {
        // Gone or unreadable since it was picked: skipped like a path-less File.
      }
    }
    return this.sources.add(ownerId, checked);
  }

  /**
   * The open dialog with the window's own words, then what was picked goes
   * through addFiles. A folder is read like Chromium's folder picker does
   * (relativePath "<folder>/<sub>/<file>"), without hidden files and links.
   */
  async pickFiles(ownerId: number, request: unknown): Promise<VideoSource[]> {
    const text = (value: unknown) =>
      typeof value === 'string' && value.length <= MAX_DIALOG_TEXT
        ? value
        : null;
    const pick = request as VideoPickRequest;
    if (
      !isObject(request) ||
      typeof pick.folder !== 'boolean' ||
      text(pick.title) === null ||
      text(pick.buttonLabel) === null ||
      text(pick.filterName) === null
    ) {
      throw new VideoToolError('invalid-request', 'pick');
    }
    if (!this.deps.showOpenDialog) return [];
    const result = await this.deps.showOpenDialog({
      title: pick.title,
      buttonLabel: pick.buttonLabel,
      properties: pick.folder
        ? ['openDirectory']
        : ['openFile', 'multiSelections'],
      filters: pick.folder
        ? undefined
        : [{ name: pick.filterName, extensions: [...PICKABLE_EXTENSIONS] }],
    });
    if (result.canceled || !result.filePaths?.length) return [];
    const files = pick.folder
      ? await listFolder(result.filePaths[0], MAX_FILES_PER_CALL)
      : result.filePaths.map((filePath) => ({
          path: filePath,
          name: path.basename(filePath),
        }));
    return this.addFiles(ownerId, files.slice(0, MAX_FILES_PER_CALL));
  }

  forgetSource(ownerId: number, sourceId: unknown): void {
    if (typeof sourceId === 'string') this.sources.forget(ownerId, sourceId);
  }

  private source(ownerId: number, sourceId: unknown): SourceEntry {
    const entry = this.sources.get(ownerId, sourceId);
    if (!entry) throw new VideoToolError('source-missing');
    return entry;
  }

  private async probeFile(
    filePath: string,
    identity: { id: string; name: string; size: number }
  ): Promise<VideoProbe> {
    const result = await this.smallRuns(() =>
      this.run(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          `file:${filePath}`,
        ],
        { keepStdout: MAX_PROBE_OUTPUT_BYTES, timeoutMs: PROBE_TIMEOUT_MS }
      )
    ).catch((error) => {
      throw new VideoToolError('probe-failed', String(error?.message ?? error));
    });
    if (result.code !== 0) {
      throw new VideoToolError('probe-failed', result.stderrTail);
    }
    let json: FfprobeJson;
    try {
      json = JSON.parse(result.stdout.toString('utf8'));
    } catch {
      throw new VideoToolError('probe-failed', 'unreadable ffprobe output');
    }
    try {
      return summarizeProbe(json, identity);
    } catch (error) {
      if (error instanceof ProbeSummaryError) {
        throw new VideoToolError(error.code);
      }
      throw error;
    }
  }

  /** Probes a source, reusing the last result while the file is unchanged. */
  private async probeSource(entry: SourceEntry): Promise<VideoProbe> {
    let stats: { size: number; mtimeMs: number };
    try {
      stats = await fs.stat(entry.path);
    } catch {
      throw new VideoToolError('source-missing');
    }
    if (
      entry.probe &&
      entry.probe.size === stats.size &&
      entry.probe.mtimeMs === stats.mtimeMs
    ) {
      return entry.probe.result;
    }
    // A probe of the same file already under way (it may be reading the
    // whole file for its length) is waited for, not started again.
    const pending = this.probing.get(entry);
    if (
      pending &&
      pending.size === stats.size &&
      pending.mtimeMs === stats.mtimeMs
    ) {
      return pending.result;
    }
    const probing = this.probeAndMeasure(entry, stats);
    this.probing.set(entry, { ...stats, result: probing });
    try {
      return await probing;
    } finally {
      if (this.probing.get(entry)?.result === probing) {
        this.probing.delete(entry);
      }
    }
  }

  private async probeAndMeasure(
    entry: SourceEntry,
    stats: { size: number; mtimeMs: number }
  ): Promise<VideoProbe> {
    let result = await this.probeFile(entry.path, {
      id: entry.id,
      name: entry.name,
      size: stats.size,
    });
    // A file that doesn't say how long it is (a browser's MediaRecorder
    // WebM): read through once, and its length kept with the probe.
    if (!(result.durationSec > 0) && result.video) {
      const durationSec = await this.measureDuration(
        entry.path,
        result.video.index
      );
      if (durationSec > 0) result = { ...result, durationSec };
    }
    entry.probe = { size: stats.size, mtimeMs: stats.mtimeMs, result };
    return result;
  }

  /**
   * How long a video runs, from ffmpeg reading its picture through without
   * decoding it; 0 when that fails.
   */
  private async measureDuration(
    filePath: string,
    streamIndex: number
  ): Promise<number> {
    const parser = new FfmpegProgressParser();
    let lastSec = 0;
    try {
      const result = await this.measureRuns(() =>
        this.run(
          'ffmpeg',
          [
            '-hide_banner',
            '-nostdin',
            '-loglevel',
            'error',
            '-progress',
            'pipe:1',
            '-nostats',
            '-i',
            `file:${filePath}`,
            '-map',
            `0:${streamIndex}`,
            '-c',
            'copy',
            '-f',
            'null',
            '-',
          ],
          {
            timeoutMs: MEASURE_TIMEOUT_MS,
            lowPriority: true,
            onStdout: (text) => {
              for (const sample of parser.push(text)) {
                if (sample.outTimeSec > 0) lastSec = sample.outTimeSec;
              }
            },
          }
        )
      );
      return result.code === 0 ? lastSec : 0;
    } catch (error) {
      this.deps.log?.('[VideoTool] Could not measure a video:', error);
      return 0;
    }
  }

  async probe(ownerId: number, sourceId: unknown): Promise<VideoProbe> {
    return this.probeSource(this.source(ownerId, sourceId));
  }

  async frames(
    ownerId: number,
    target: unknown,
    options: unknown
  ): Promise<VideoFrame[]> {
    let filePath: string;
    let probe: VideoProbe;
    if (isObject(target) && typeof target.jobId === 'string') {
      const job = this.doneJob(ownerId, target.jobId);
      filePath = path.join(job.dir, VIDEO_FILE);
      probe = job.outputProbe;
    } else if (isObject(target) && typeof target.sourceId === 'string') {
      const entry = this.source(ownerId, target.sourceId);
      probe = await this.probeSource(entry);
      filePath = entry.path;
    } else {
      throw new VideoToolError('invalid-request', 'target');
    }
    const video = probe?.video;
    if (!video) throw new VideoToolError('no-video');
    const settings = isObject(options) ? options : {};

    const requestedWidth =
      typeof settings.width === 'number' && Number.isFinite(settings.width)
        ? Math.round(settings.width)
        : DEFAULT_FRAME_WIDTH;
    const width = evenFloor(
      Math.min(
        Math.max(requestedWidth, MIN_FRAME_WIDTH),
        MAX_FRAME_WIDTH,
        video.displayWidth
      )
    );
    const height = evenFloor(
      Math.round((video.displayHeight * width) / video.displayWidth)
    );

    const duration = probe.durationSec;
    let times: number[];
    if (Array.isArray(settings.times)) {
      times = settings.times
        .filter(
          (time): time is number =>
            typeof time === 'number' && Number.isFinite(time) && time >= 0
        )
        .slice(0, MAX_FRAMES)
        .map((time) => (duration > 0 ? Math.min(time, duration) : time));
    } else {
      const count = Math.min(
        MAX_FRAMES,
        Math.max(
          1,
          typeof settings.count === 'number' && Number.isFinite(settings.count)
            ? Math.round(settings.count)
            : DEFAULT_FRAME_COUNT
        )
      );
      const span = 1 - 2 * FRAME_EDGE_SHARE;
      times = Array.from(
        { length: count },
        (_, index) =>
          duration * (FRAME_EDGE_SHARE + (span * (index + 0.5)) / count)
      );
    }

    const filter = [
      ...(video.interlaced ? ['bwdif=mode=send_frame'] : []),
      `scale=${width}:${height}`,
      'setsar=1',
    ].join(',');
    const frames: VideoFrame[] = [];
    for (const time of times) {
      const timeSec = Math.round(time * 1000) / 1000;
      const result = await this.smallRuns(() =>
        this.run(
          'ffmpeg',
          [
            '-hide_banner',
            '-nostdin',
            '-loglevel',
            'error',
            '-ss',
            String(timeSec),
            '-i',
            `file:${filePath}`,
            '-map',
            `0:${video.index}`,
            '-frames:v',
            '1',
            '-vf',
            filter,
            '-c:v',
            'mjpeg',
            '-q:v',
            '3',
            '-f',
            'image2',
            '-update',
            '1',
            'pipe:1',
          ],
          {
            keepStdout: MAX_FRAME_BYTES,
            timeoutMs: FRAME_TIMEOUT_MS,
            lowPriority: true,
          }
        )
      ).catch((error) => {
        throw new VideoToolError('frames-failed', String(error?.message));
      });
      // A time past the last frame gives nothing: skipped.
      if (result.code === 0 && result.stdout.length > 0) {
        frames.push({
          timeSec,
          dataUrl: `data:image/jpeg;base64,${result.stdout.toString('base64')}`,
        });
      }
    }
    return frames;
  }

  async readSubtitleFile(
    ownerId: number,
    sourceId: unknown,
    encoding?: unknown
  ): Promise<{ text: string; encoding: string; valid: boolean }> {
    const entry = this.source(ownerId, sourceId);
    if (
      encoding !== undefined &&
      encoding !== null &&
      !shortString(encoding, 64)
    )
      throw new VideoToolError('invalid-request', 'encoding');
    const bytes = await this.readSmallFile(entry.path);
    return decodeSubtitleBytes(bytes, (encoding as string) || undefined);
  }

  private async readSmallFile(filePath: string): Promise<Buffer> {
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      throw new VideoToolError('source-missing');
    }
    if (size > MAX_SUBTITLE_SOURCE_BYTES) throw new VideoToolError('too-big');
    return fs.readFile(filePath);
  }

  // ---- Jobs ----

  startJob(ownerId: number, rawSpec: unknown): VideoJobState {
    if (this.stopping) throw new VideoToolError('cancelled');
    const spec = normalizeJobSpec(rawSpec);
    if (!spec) throw new VideoToolError('invalid-request', 'spec');
    const source = this.source(ownerId, spec.sourceId);
    const subtitleSources = new Map<number, SourceEntry>();
    spec.subtitles.forEach((track, index) => {
      if (track.source !== 'file') return;
      const entry = this.sources.get(ownerId, track.sourceId);
      if (entry) subtitleSources.set(index, entry);
    });
    const jobId = randomUUID();
    const job: Job = {
      ownerId,
      state: { jobId, spec, phase: 'queued', percent: 0 },
      dir: path.join(this.jobsRoot(), jobId),
      source,
      subtitleSources,
      cancelled: false,
      released: false,
      paused: false,
      pausedMs: 0,
      resumeWaiters: [],
      subtitleGeneration: 0,
      writtenSubtitles: new Map(),
    };
    this.jobs.set(jobId, job);
    this.queue.push(job);
    const queued = { ...job.state };
    this.pump();
    return queued;
  }

  listJobs(ownerId: number): VideoJobState[] {
    return [...this.jobs.values()]
      .filter((job) => job.ownerId === ownerId)
      .map((job) => ({ ...job.state }));
  }

  private ownJob(ownerId: number, jobId: unknown): Job {
    const job =
      typeof jobId === 'string' && JOB_ID.test(jobId)
        ? this.jobs.get(jobId)
        : undefined;
    if (!job || job.ownerId !== ownerId)
      throw new VideoToolError('job-missing');
    return job;
  }

  private doneJob(ownerId: number, jobId: unknown): Job {
    const job = this.ownJob(ownerId, jobId);
    if (job.state.phase !== 'done') throw new VideoToolError('not-ready');
    return job;
  }

  cancelJob(ownerId: number, jobId: unknown): void {
    this.cancel(this.ownJob(ownerId, jobId));
  }

  private cancel(job: Job): void {
    if (['done', 'failed', 'cancelled'].includes(job.state.phase)) return;
    job.cancelled = true;
    this.wakePaused(job);
    const queued = this.queue.indexOf(job);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      this.update(job, { phase: 'cancelled', etaSec: undefined });
      return;
    }
    // The running job notices once its process has exited, then cleans up.
    job.child?.kill('SIGKILL');
  }

  async releaseJob(ownerId: number, jobId: unknown): Promise<void> {
    await this.release(this.ownJob(ownerId, jobId));
  }

  /** SIGSTOP/SIGCONT: Windows has no such signals. */
  private canPause(): boolean {
    return (this.deps.platform ?? process.platform) !== 'win32';
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Stops a job's ffmpeg where it is, so the PC gets its power back; the
   * job goes on from there on resume. A short step (subtitles) finishes
   * first, and nothing new starts while paused.
   */
  pauseJob(ownerId: number, jobId: unknown): VideoJobState {
    const job = this.ownJob(ownerId, jobId);
    if (!this.canPause()) throw new VideoToolError('not-supported');
    if (job.paused || ['done', 'failed', 'cancelled'].includes(job.state.phase))
      return { ...job.state };
    job.paused = true;
    job.pausedAt = this.now();
    if (job.child && job.childPausable) job.child.kill('SIGSTOP');
    this.update(job, { paused: true, etaSec: undefined });
    return { ...job.state };
  }

  resumeJob(ownerId: number, jobId: unknown): VideoJobState {
    const job = this.ownJob(ownerId, jobId);
    if (!job.paused) return { ...job.state };
    if (job.child && job.childPausable) job.child.kill('SIGCONT');
    this.wakePaused(job);
    this.update(job, { paused: false });
    return { ...job.state };
  }

  /** Ends a pause: the time it took is counted, waiting runs go on. */
  private wakePaused(job: Job): void {
    if (!job.paused) return;
    job.paused = false;
    job.pausedMs += Math.max(0, this.now() - (job.pausedAt ?? this.now()));
    job.pausedAt = undefined;
    for (const resume of job.resumeWaiters.splice(0)) resume();
  }

  /**
   * A finished job's subtitles again, as `rawSubtitles` lists them now
   * (added, taken out, another language): written under new names, as a
   * preview may be reading the old ones, which go once the new ones are
   * listed. The picture isn't touched. One list at a time per job.
   */
  async remakeSubtitles(
    ownerId: number,
    jobId: unknown,
    rawSubtitles: unknown
  ): Promise<VideoJobState> {
    const job = this.doneJob(ownerId, jobId);
    const subtitles = normalizeSubtitles(rawSubtitles);
    if (!subtitles) throw new VideoToolError('invalid-request', 'subtitles');
    const next = (job.remaking ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.writeSubtitlesAgain(job, subtitles));
    job.remaking = next;
    try {
      return await next;
    } finally {
      if (job.remaking === next) job.remaking = undefined;
    }
  }

  private async writeSubtitlesAgain(
    job: Job,
    subtitles: VideoJobSubtitle[]
  ): Promise<VideoJobState> {
    const stillDone = () =>
      !job.released && job.state.phase === 'done' && job.state.output;
    if (!stillDone()) throw new VideoToolError('not-ready');
    const probe = job.probe ?? (await this.probeSource(job.source));
    job.probe = probe;
    const subtitleDir = path.join(job.dir, SUBTITLE_FOLDER);
    const plan = planVideoJob(
      probe,
      { ...job.state.spec, subtitles },
      {
        input: job.source.path,
        video: path.join(job.dir, VIDEO_FILE),
        passLogPrefix: path.join(job.dir, 'passlog'),
        subtitle: (id) => path.join(subtitleDir, `${id}.vtt`),
      }
    );
    if (plan.ok === false) {
      throw new VideoToolError('invalid-request', plan.error);
    }
    job.subtitleGeneration += 1;
    const generation = job.subtitleGeneration;
    const planned = plan.subtitles.map((track) => ({
      ...track,
      id: `g${generation}${track.id}`,
    }));
    const subtitleSources = new Map<number, SourceEntry>();
    subtitles.forEach((track, index) => {
      if (track.source !== 'file') return;
      const entry = this.sources.get(job.ownerId, track.sourceId);
      if (entry) subtitleSources.set(index, entry);
    });
    job.subtitleSources = subtitleSources;
    await fs.mkdir(subtitleDir, { recursive: true });
    const failedSubtitles: VideoJobFailedSubtitle[] = [
      ...plan.skippedSubtitles,
    ];
    // A source already written (only its language or label changed) is
    // copied: the video isn't read through again for it.
    const reused = new Set<string>();
    for (const track of planned) {
      const earlier = job.writtenSubtitles.get(subtitleSourceKey(track));
      if (!earlier) continue;
      const copied = await fs
        .copyFile(
          path.join(subtitleDir, `${earlier}.vtt`),
          path.join(subtitleDir, `${track.id}.vtt`)
        )
        .then(() => true)
        .catch(() => false);
      if (copied) reused.add(track.id);
    }
    failedSubtitles.push(
      ...(await this.convertSubtitleStreams(
        job,
        planned.filter(
          (track): track is Extract<PlannedSubtitle, { source: 'stream' }> =>
            track.source === 'stream' && !reused.has(track.id)
        ),
        subtitleDir
      ))
    );
    for (const track of planned) {
      if (track.source !== 'file' || reused.has(track.id)) continue;
      const written = await this.convertSubtitleFile(
        job,
        track,
        subtitleDir,
        probe.video?.fps
      );
      if (written !== true) failedSubtitles.push(written);
    }
    const written = await this.collectSubtitles(
      planned,
      failedSubtitles,
      subtitleDir
    );
    if (!stillDone()) {
      await Promise.all(
        written.map((track) =>
          fs.rm(path.join(subtitleDir, `${track.id}.vtt`), { force: true })
        )
      );
      throw new VideoToolError('not-ready');
    }
    const before = job.state.output.subtitles ?? [];
    job.writtenSubtitles = writtenBySource(planned, written);
    this.update(job, {
      output: {
        ...job.state.output,
        subtitles: written,
        failedSubtitles: failedSubtitles.sort(
          (a, b) => a.specIndex - b.specIndex
        ),
      },
    });
    await Promise.all(
      before
        .filter((old) => !written.some((track) => track.id === old.id))
        .map((old) =>
          fs.rm(path.join(subtitleDir, `${old.id}.vtt`), { force: true })
        )
    );
    return { ...job.state };
  }

  private async release(job: Job): Promise<void> {
    this.cancel(job);
    // A job released half-way says it has ended now: its page may be
    // waiting for that, and nothing is said about a released job later
    // (when its process has stopped).
    if (!['done', 'failed', 'cancelled'].includes(job.state.phase)) {
      this.update(job, { phase: 'cancelled', etaSec: undefined });
    }
    job.released = true;
    this.jobs.delete(job.state.jobId);
    // A running job removes its own folder when its process has stopped.
    if (this.running !== job) await this.removeDir(job.dir);
  }

  /** The page navigated or died: its sources and jobs go. */
  releaseOwner(ownerId: number): void {
    this.sources.clearOwner(ownerId);
    this.savedFiles.delete(ownerId);
    for (const job of [...this.jobs.values()]) {
      if (job.ownerId !== ownerId) continue;
      // There's no page left to tell.
      job.released = true;
      void this.release(job);
    }
  }

  private update(job: Job, changes: Partial<VideoJobState>): void {
    job.state = { ...job.state, ...changes };
    if (job.released) return;
    try {
      this.deps.emit(job.ownerId, { type: 'state', state: { ...job.state } });
    } catch (error) {
      this.deps.log?.('[VideoTool] Could not send a job event:', error);
    }
  }

  private pump(): void {
    if (this.stopping || this.running || this.queue.length === 0) return;
    const job = this.queue.shift();
    this.running = job;
    void this.execute(job).finally(() => {
      this.running = null;
      this.pump();
    });
  }

  private async removeDir(dir: string): Promise<void> {
    await fs
      .rm(dir, { recursive: true, force: true })
      .catch((error) =>
        this.deps.log?.('[VideoTool] Could not remove job files:', error)
      );
  }

  private async execute(job: Job): Promise<void> {
    try {
      await this.encode(job);
    } catch (error) {
      if (job.cancelled) {
        await this.removeDir(job.dir);
        this.update(job, { phase: 'cancelled', etaSec: undefined });
      } else {
        const failure =
          error instanceof JobFailure
            ? error
            : (error as NodeJS.ErrnoException)?.code === 'ENOSPC'
              ? new JobFailure('disk-full', String(error?.message ?? error))
              : error instanceof VideoToolError &&
                  ['source-missing', 'probe-failed', 'no-video'].includes(
                    error.code
                  )
                ? new JobFailure(error.code as VideoJobErrorCode, error.detail)
                : new JobFailure(
                    'ffmpeg-failed',
                    String(error?.message ?? error)
                  );
        this.deps.log?.(
          '[VideoTool] Job failed:',
          failure.code,
          failure.message
        );
        await this.removeDir(job.dir);
        this.update(job, {
          phase: 'failed',
          etaSec: undefined,
          errorCode: failure.code,
          ...(failure.message !== failure.code
            ? { errorDetail: failure.message.slice(0, 2000) }
            : {}),
        });
      }
    } finally {
      if (job.released) await this.removeDir(job.dir);
    }
  }

  private checkCancelled(job: Job): void {
    if (job.cancelled) throw new JobFailure('ffmpeg-failed', 'cancelled');
  }

  private async encode(job: Job): Promise<void> {
    this.update(job, { phase: 'analyzing', percent: 0 });
    const probe = await this.probeSource(job.source);
    this.checkCancelled(job);
    job.probe = probe;

    const subtitleDir = path.join(job.dir, SUBTITLE_FOLDER);
    const videoPath = path.join(job.dir, VIDEO_FILE);
    const plan = planVideoJob(probe, job.state.spec, {
      input: job.source.path,
      video: videoPath,
      passLogPrefix: path.join(job.dir, 'passlog'),
      subtitle: (id) => path.join(subtitleDir, `${id}.vtt`),
    });
    if (plan.ok === false) {
      const failed = plan;
      throw new JobFailure(
        failed.error,
        failed.maxDurationSec !== undefined
          ? `maxDurationSec=${failed.maxDurationSec}`
          : failed.detail
      );
    }
    this.update(job, {
      plan: {
        mode: plan.mode,
        codec: plan.codec,
        twoPass: plan.twoPass,
        estimateBytes: plan.estimateBytes,
        width: plan.width,
        height: plan.height,
      },
    });

    await fs.mkdir(subtitleDir, { recursive: true });
    const free = await (this.deps.freeBytes ?? statfsFree)(job.dir);
    // Two-pass keeps x264's stats (the .mbtree) on disk beside the MP4.
    const needed =
      plan.estimateBytes * FREE_SPACE_FACTOR +
      twoPassLogBytes(plan, probe.durationSec) +
      FREE_SPACE_MARGIN;
    if (free !== null && free < needed) {
      throw new JobFailure('disk-full', `needs ${Math.ceil(needed)} bytes`);
    }

    const fileTracks = plan.subtitles.filter(
      (track) => track.source === 'file'
    );
    const streamTracks = plan.subtitles.filter(
      (track) => track.source === 'stream'
    );
    const scale = plan.subtitles.length ? ENCODE_SHARE_WITH_SUBTITLES : 100;
    const passOptions = {
      durationSec: probe.durationSec,
      passes: plan.passes.length,
      scale,
    };
    for (const [index, args] of plan.passes.entries()) {
      await this.runPass(job, args, { ...passOptions, pass: index + 1 });
    }
    const limit = job.state.spec.sizeLimitBytes;
    let size = (await fs.stat(videoPath)).size;
    // Two-pass can overshoot a little on short videos: one more second pass
    // at the bitrate that lands under the limit (AV1 capped to fit: the
    // pass again, with a lower cap).
    const retryKbps =
      size > limit
        ? retryTwoPassKbps(plan, size, limit, probe.durationSec)
        : null;
    if (retryKbps) {
      const last = plan.passes.length - 1;
      await this.runPass(
        job,
        plan.twoPass
          ? withVideoBitrate(plan.passes[last], retryKbps)
          : withVideoCap(plan.passes[last], retryKbps),
        { ...passOptions, pass: last + 1 }
      );
      size = (await fs.stat(videoPath)).size;
    }
    // No video comes out bigger than its original (the window says so): an
    // encode that did (a hard, noisy picture) runs its last pass again once,
    // lower.
    const smallerKbps = retryKbps
      ? null
      : retryUnderOriginalKbps(plan, size, probe.size, probe.durationSec);
    if (smallerKbps) {
      const last = plan.passes.length - 1;
      await this.runPass(
        job,
        plan.twoPass
          ? withVideoBitrate(plan.passes[last], smallerKbps)
          : withVideoCap(plan.passes[last], smallerKbps),
        { ...passOptions, pass: last + 1 }
      );
      size = (await fs.stat(videoPath)).size;
    }
    if (size > limit) throw new JobFailure('output-too-big', String(size));

    const failedSubtitles: VideoJobFailedSubtitle[] = [
      ...plan.skippedSubtitles,
    ];
    if (plan.subtitles.length) {
      this.update(job, { phase: 'subtitles', etaSec: undefined });
      failedSubtitles.push(
        ...(await this.convertSubtitleStreams(job, streamTracks, subtitleDir))
      );
      for (const track of fileTracks) {
        this.checkCancelled(job);
        const written = await this.convertSubtitleFile(
          job,
          track,
          subtitleDir,
          probe.video?.fps
        );
        if (written !== true) failedSubtitles.push(written);
      }
    }
    await removePassLogs(job.dir);

    const subtitles = await this.collectSubtitles(
      plan.subtitles,
      failedSubtitles,
      subtitleDir
    );
    job.writtenSubtitles = writtenBySource(plan.subtitles, subtitles);

    const outputProbe = await this.probeFile(videoPath, {
      id: job.state.jobId,
      name: VIDEO_FILE,
      size,
    }).catch((error) => {
      throw new JobFailure('ffmpeg-failed', String(error?.message ?? error));
    });
    this.checkCancelled(job);
    job.outputProbe = outputProbe;
    this.update(job, {
      phase: 'done',
      percent: 100,
      etaSec: undefined,
      output: {
        size,
        durationSec: outputProbe.durationSec,
        width: outputProbe.video.displayWidth,
        height: outputProbe.video.displayHeight,
        mimeType: 'video/mp4',
        ...(outputProbe.video.codec === 'av1' ||
        outputProbe.video.codec === 'h264'
          ? { codec: outputProbe.video.codec as VideoCodec }
          : {}),
        hasAudio: outputProbe.audio.length > 0,
        subtitles,
        failedSubtitles: failedSubtitles.sort(
          (a, b) => a.specIndex - b.specIndex
        ),
      },
    });
  }

  private async runPass(
    job: Job,
    args: string[],
    options: {
      durationSec: number;
      pass: number;
      passes: number;
      scale: number;
    }
  ): Promise<void> {
    this.checkCancelled(job);
    this.update(job, {
      phase: options.passes === 2 && options.pass === 1 ? 'pass1' : 'encoding',
    });
    const parser = new FfmpegProgressParser();
    const startedAt = this.now();
    const pausedBefore = job.pausedMs;
    const result = await this.run(
      'ffmpeg',
      args,
      {
        lowPriority: true,
        onStdout: (text) => {
          const sample = parser.push(text).pop();
          if (!sample) return;
          // ffmpeg's speed counts the time it stood paused: after a pause
          // it's the media written over the time it really ran.
          const pausedSince = job.pausedMs - pausedBefore;
          const ranSec = (this.now() - startedAt - pausedSince) / 1000;
          const speed =
            pausedSince > 0 && sample.outTimeSec !== undefined && ranSec > 0
              ? sample.outTimeSec / ranSec
              : sample.speed;
          this.update(job, {
            ...jobProgress({ ...sample, speed }, options),
            ...(job.paused ? { etaSec: undefined } : {}),
          });
        },
      },
      job
    );
    this.checkCancelled(job);
    if (result.code !== 0) {
      throw new JobFailure(
        DISK_FULL.test(result.stderrTail) ? 'disk-full' : 'ffmpeg-failed',
        result.stderrTail
      );
    }
  }

  /**
   * The written WebVTT files of `planned` (those not already failed): too
   * big or missing ones are added to `failedSubtitles`.
   */
  private async collectSubtitles(
    planned: PlannedSubtitle[],
    failedSubtitles: VideoJobFailedSubtitle[],
    subtitleDir: string
  ): Promise<VideoJobOutput['subtitles']> {
    const subtitles: VideoJobOutput['subtitles'] = [];
    for (const track of planned) {
      if (
        failedSubtitles.some((failed) => failed.specIndex === track.specIndex)
      )
        continue;
      const file = path.join(subtitleDir, `${track.id}.vtt`);
      const bytes = await fs
        .stat(file)
        .then((stats) => stats.size)
        .catch(() => -1);
      const failed = failedEntry(track);
      if (bytes < 0) failedSubtitles.push({ ...failed, reason: 'failed' });
      else if (bytes > VIDEO_TOOL_MAX_SUBTITLE_BYTES) {
        await fs.rm(file, { force: true });
        failedSubtitles.push({ ...failed, reason: 'too-big' });
      } else {
        subtitles.push({
          id: track.id,
          language: track.language,
          ...(track.label ? { label: track.label } : {}),
          bytes,
        });
      }
    }
    return subtitles;
  }

  /**
   * The video's own subtitle tracks, after the video: one run for all of
   * them (the file is read once); when that fails, each alone, so one track
   * ffmpeg can't convert is left out and the others still go. Returns the
   * tracks that couldn't be written.
   */
  private async convertSubtitleStreams(
    job: Job,
    tracks: Extract<PlannedSubtitle, { source: 'stream' }>[],
    subtitleDir: string
  ): Promise<VideoJobFailedSubtitle[]> {
    if (!tracks.length) return [];
    const output = (track: PlannedSubtitle) =>
      path.join(subtitleDir, `${track.id}.vtt`);
    let timedOut = false;
    const runFor = async (group: typeof tracks) => {
      this.checkCancelled(job);
      const result = await this.run(
        'ffmpeg',
        subtitleStreamArgs(
          job.source.path,
          group.map((track) => ({
            streamIndex: track.streamIndex,
            output: output(track),
          }))
        ),
        { timeoutMs: STREAM_SUBTITLE_TIMEOUT_MS, lowPriority: true },
        job
      ).catch((error) => {
        if (job.cancelled) throw error;
        if (error instanceof RunTimedOut) timedOut = true;
        return { code: -1, stderrTail: String(error?.message ?? error) };
      });
      this.checkCancelled(job);
      if (result.code !== 0) {
        this.deps.log?.(
          '[VideoTool] Subtitle track failed:',
          result.stderrTail
        );
        await Promise.all(
          group.map((track) => fs.rm(output(track), { force: true }))
        );
      }
      return result.code === 0;
    };
    if (await runFor(tracks)) return [];
    if (tracks.length === 1) {
      return [{ ...failedEntry(tracks[0]), reason: 'failed' }];
    }
    const failed: VideoJobFailedSubtitle[] = [];
    for (const track of tracks) {
      // A run that ran out of time: the file is too slow to read, and each
      // track alone would read all of it again.
      if (timedOut || !(await runFor([track]))) {
        failed.push({ ...failedEntry(track), reason: 'failed' });
      }
    }
    return failed;
  }

  /** true when written, else why not. */
  private async convertSubtitleFile(
    job: Job,
    track: Extract<PlannedSubtitle, { source: 'file' }>,
    subtitleDir: string,
    videoFps?: number
  ): Promise<true | VideoJobFailedSubtitle> {
    const failed = failedEntry(track);
    const entry = job.subtitleSources.get(track.specIndex);
    const extension = path.extname(entry?.name ?? '').toLowerCase();
    if (!entry) return { ...failed, reason: 'failed' };
    // PGS (.sup) is pictures: it can't become text.
    if (extension === '.sup') return { ...failed, reason: 'picture' };
    const input = path.join(subtitleDir, `${track.id}.source${extension}`);
    try {
      const bytes = await this.readSmallFile(entry.path);
      // A VobSub .sub (MPEG-PS) is pictures, not text.
      if (extension === '.sub' && looksLikePictureSub(bytes)) {
        return { ...failed, reason: 'picture' };
      }
      let decoded = decodeSubtitleBytes(bytes, track.encoding);
      // No encoding chosen and not UTF-8: the legacy one of its language.
      if (!decoded.valid && !track.encoding) {
        try {
          decoded = decodeSubtitleBytes(
            bytes,
            legacySubtitleEncoding(track.language)
          );
        } catch (error) {
          // This build can't decode that one.
          if (!(error instanceof VideoToolError)) throw error;
          decoded = decodeSubtitleBytes(bytes, 'windows-1252');
        }
      }
      // MicroDVD counts frames: without its own rate line ffmpeg assumes
      // 23.976 fps, so it's timed at the video's rate instead. Named, as
      // ffmpeg's guess needs a few lines to recognise it.
      const timing = microdvdTiming(decoded.text);
      const inputOptions = timing.microdvd
        ? [
            '-f',
            'microdvd',
            ...(!timing.ownRate && videoFps > 0
              ? ['-subfps', fpsRational(videoFps)]
              : []),
          ]
        : [];
      await fs.writeFile(input, decoded.text.replace(/^\uFEFF/, ''), 'utf8');
      const result = await this.run(
        'ffmpeg',
        subtitleFileArgs(
          input,
          path.join(subtitleDir, `${track.id}.vtt`),
          inputOptions
        ),
        { timeoutMs: SUBTITLE_TIMEOUT_MS },
        job
      );
      if (result.code !== 0) {
        this.deps.log?.('[VideoTool] Subtitle file failed:', result.stderrTail);
        await fs.rm(path.join(subtitleDir, `${track.id}.vtt`), { force: true });
        return { ...failed, reason: 'failed' };
      }
      return true;
    } catch (error) {
      if (job.cancelled) throw error;
      this.deps.log?.('[VideoTool] Subtitle file failed:', error);
      return {
        ...failed,
        reason:
          error instanceof VideoToolError && error.code === 'too-big'
            ? 'too-big'
            : 'failed',
      };
    } finally {
      await fs.rm(input, { force: true }).catch(() => undefined);
    }
  }

  // ---- Outputs ----

  /** 'video' or a subtitle id of a finished job → its path. */
  private outputPath(job: Job, file: unknown): string | null {
    if (file === 'video') return path.join(job.dir, VIDEO_FILE);
    const track = job.state.output?.subtitles.find(
      (entry) => entry.id === file
    );
    return track
      ? path.join(job.dir, SUBTITLE_FOLDER, `${track.id}.vtt`)
      : null;
  }

  async readText(ownerId: number, jobId: unknown, file: unknown) {
    const job = this.doneJob(ownerId, jobId);
    const filePath = file === 'video' ? null : this.outputPath(job, file);
    if (!filePath) throw new VideoToolError('invalid-request', 'file');
    return fs.readFile(filePath, 'utf8');
  }

  async uploadChunk(
    ownerId: number,
    request: unknown
  ): Promise<VideoUploadResult> {
    if (!isObject(request)) throw new VideoToolError('invalid-request');
    const { jobId, file, start, end, index, endpoint } =
      request as Partial<VideoUploadRequest>;
    const job = this.doneJob(ownerId, jobId);
    const filePath = this.outputPath(job, file);
    if (!filePath) throw new VideoToolError('invalid-request', 'file');
    const size = (await fs.stat(filePath)).size;
    if (
      !isIndex(start) ||
      !isIndex(end) ||
      !isIndex(index) ||
      start >= end ||
      end > size ||
      end - start > VIDEO_TOOL_MAX_CHUNK_BYTES
    ) {
      throw new VideoToolError('invalid-request', 'range');
    }
    if (
      !isChunkEndpoint(endpoint) ||
      !(this.deps.allowEndpoint ?? isLocalEndpoint)(endpoint)
    ) {
      throw new VideoToolError('invalid-request', 'endpoint');
    }

    const bytes = Buffer.alloc(end - start);
    const handle = await fs.open(filePath, 'r');
    try {
      let read = 0;
      while (read < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          read,
          bytes.length - read,
          start + read
        );
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      if (read !== bytes.length) {
        throw new VideoToolError('invalid-request', 'short read');
      }
    } finally {
      await handle.close();
    }

    const form = chunkFormData(bytes, index, path.basename(filePath));
    try {
      const response = await this.deps.fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': form.contentType },
        body: form.body as BodyInit,
        redirect: 'error',
        credentials: 'omit',
      });
      // The node's answer (a few bytes) is read to the end, never
      // cancelled: with net.fetch a cancelled answer keeps its request
      // alive, and with it both copies of the chunk. A 2 GB video once
      // held 6 GB in the main process (1 GB of chunks: 3 GB that garbage
      // collection couldn't free; read instead: 36 MB).
      await response.arrayBuffer().catch(() => undefined);
      return response.ok
        ? { ok: true }
        : { ok: false, status: response.status };
    } catch (error) {
      this.deps.log?.('[VideoTool] Chunk upload failed:', error);
      return { ok: false, status: 0 };
    }
  }

  /**
   * Has a node on this PC build a finished file's publish transaction from
   * the file itself: Core's publish-from-path route (POST
   * /arbitrary/<SERVICE>/<name>[/<identifier>], the path as its body).
   * Nothing is uploaded, and the node keeps no copies of its own: an
   * upload's chunks are saved in its folder, then joined in the system's
   * temporary folder, which some Linux systems keep in memory, with a
   * quota. The node reads the file through a hard link named as it's to
   * be published. Anything but a transaction is { ok: false }, and the
   * file is uploaded instead.
   */
  async buildOnNode(
    ownerId: number,
    request: unknown
  ): Promise<VideoNodeBuildResult> {
    if (!isObject(request)) throw new VideoToolError('invalid-request');
    const { jobId, file, endpoint, filename } =
      request as Partial<VideoNodeBuildRequest>;
    const job = this.doneJob(ownerId, jobId);
    const filePath = this.outputPath(job, file);
    if (!filePath) throw new VideoToolError('invalid-request', 'file');
    if (
      !isPathPublishEndpoint(endpoint) ||
      !(this.deps.allowEndpoint ?? isLocalEndpoint)(endpoint)
    ) {
      throw new VideoToolError('invalid-request', 'endpoint');
    }
    if (!isThisPcEndpoint(endpoint)) {
      return { ok: false, status: 0, reason: 'not-local' };
    }

    let linkDir: string | null = null;
    try {
      let linked: string;
      try {
        linkDir = await fs.mkdtemp(path.join(job.dir, NODE_LINK_PREFIX));
        linked = path.join(
          linkDir,
          nodeFileName(filename, path.basename(filePath), this.deps.platform)
        );
        await fs.link(filePath, linked);
      } catch (error) {
        this.deps.log?.('[VideoTool] No file for the node to read:', error);
        return { ok: false, status: 0, reason: 'link' };
      }

      let response: Response;
      try {
        response = await this.deps.fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          body: linked,
          redirect: 'error',
          credentials: 'omit',
        });
      } catch (error) {
        this.deps.log?.('[VideoTool] The node built nothing:', error);
        return { ok: false, status: 0, reason: 'network' };
      }
      // Read to the end, never cancelled (see uploadChunk).
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        this.deps.log?.(
          `[VideoTool] The node didn't build it (${response.status}):`,
          text.slice(0, 300)
        );
        return { ok: false, status: response.status, reason: 'refused' };
      }
      const transaction = text.trim();
      return BASE58_TEXT.test(transaction)
        ? { ok: true, transaction }
        : { ok: false, status: response.status, reason: 'answer' };
    } finally {
      if (linkDir) {
        await fs
          .rm(linkDir, { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
  }

  async saveOutput(
    ownerId: number,
    jobId: unknown,
    suggestedName: unknown
  ): Promise<VideoSaveResult> {
    const job = this.doneJob(ownerId, jobId);
    const result = await this.deps.showSaveDialog({
      defaultPath: safeOutputName(suggestedName),
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    // The job may have been released while the dialog was open.
    if (job.released) throw new VideoToolError('job-missing');
    try {
      await fs.copyFile(path.join(job.dir, VIDEO_FILE), result.filePath);
    } catch (error) {
      throw new VideoToolError('save-failed', String(error?.message ?? error));
    }
    let saved = this.savedFiles.get(ownerId);
    if (!saved) {
      saved = new Map();
      this.savedFiles.set(ownerId, saved);
    }
    const savedId = randomUUID();
    saved.set(savedId, result.filePath);
    // The oldest go first: a page keeps its last ones.
    while (saved.size > MAX_SAVED_FILES) {
      saved.delete(saved.keys().next().value);
    }
    return { saved: true, savedId, filePath: result.filePath };
  }

  /** Opens a video saved by saveOutput, or shows it in its folder. */
  async openSaved(
    ownerId: number,
    savedId: unknown,
    how: unknown
  ): Promise<void> {
    const filePath =
      typeof savedId === 'string'
        ? this.savedFiles.get(ownerId)?.get(savedId)
        : undefined;
    if (!filePath || (how !== 'open' && how !== 'folder')) {
      throw new VideoToolError('invalid-request', 'saved file');
    }
    try {
      await fs.access(filePath);
    } catch {
      throw new VideoToolError('saved-missing');
    }
    if (how === 'folder') this.deps.showItemInFolder?.(filePath);
    else await this.deps.openPath?.(filePath);
  }

  /** hub-video://job/<jobId>/video.mp4 or …/subtitles/<id>.vtt. */
  previewFile(url: string): { path: string; mimeType: string } | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (
      parsed.protocol !== `${VIDEO_TOOL_PREVIEW_SCHEME}:` ||
      parsed.hostname !== 'job'
    ) {
      return null;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    const job = this.jobs.get(decodeURIComponent(parts[0] ?? ''));
    if (!job || job.state.phase !== 'done') return null;
    if (parts.length === 2 && parts[1] === VIDEO_FILE) {
      return { path: path.join(job.dir, VIDEO_FILE), mimeType: 'video/mp4' };
    }
    const subtitle = /^(.+)\.vtt$/.exec(parts[2] ?? '');
    if (parts.length === 3 && parts[1] === SUBTITLE_FOLDER && subtitle) {
      const filePath = this.outputPath(job, subtitle[1]);
      return filePath ? { path: filePath, mimeType: 'text/vtt' } : null;
    }
    return null;
  }

  /** The protocol handler: a job's outputs, with Range, for the shell only. */
  async previewResponse(
    request: Request,
    allowedOrigin: string
  ): Promise<Response> {
    const file =
      request.method === 'GET' || request.method === 'HEAD'
        ? this.previewFile(request.url)
        : null;
    if (!file) return new Response('Not Found', { status: 404 });
    const origin = request.headers.get('origin');
    try {
      return await fileResponse(file.path, {
        mimeType: file.mimeType,
        range: request.headers.get('range'),
        method: request.method,
        // <track> loads subtitles in CORS mode.
        headers:
          origin === allowedOrigin
            ? { 'access-control-allow-origin': allowedOrigin }
            : {},
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }
}

const isLocalEndpoint = (endpoint: string) =>
  isAllowedNodeEndpoint(endpoint, []);

function evenFloor(value: number): number {
  const whole = Math.floor(value);
  return Math.max(2, whole - (whole % 2));
}

/** What a subtitle is written from: a reuse key for its WebVTT file. */
function subtitleSourceKey(track: PlannedSubtitle): string {
  return track.source === 'stream'
    ? `stream:${track.streamIndex}`
    : `file:${track.sourceId}:${track.encoding ?? ''}`;
}

/** Each source's written file (by output id), for a later reuse. */
function writtenBySource(
  planned: PlannedSubtitle[],
  written: VideoJobOutput['subtitles']
): Map<string, string> {
  const files = new Map<string, string>();
  for (const track of planned) {
    if (written.some((entry) => entry.id === track.id)) {
      files.set(subtitleSourceKey(track), track.id);
    }
  }
  return files;
}

function failedEntry(track: PlannedSubtitle) {
  return {
    specIndex: track.specIndex,
    language: track.language,
    ...(track.label ? { label: track.label } : {}),
  };
}

async function removePassLogs(dir: string): Promise<void> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith('passlog'))
      .map((entry) => fs.rm(path.join(dir, entry), { force: true }))
  );
}

/** Registers videoTool:* for the main window only. */
export function registerVideoToolIpc({
  ipcMain,
  checkSender,
  service,
}: {
  ipcMain: Pick<IpcMain, 'handle'>;
  checkSender: (event: IpcMainInvokeEvent) => void;
  service: VideoToolService;
}): void {
  const handle = (
    channel: string,
    handler: (ownerId: number, ...args: unknown[]) => unknown
  ) =>
    ipcMain.handle(channel, (event, ...args) => {
      checkSender(event);
      return handler(event.sender.id, ...args);
    });
  const channels = VIDEO_TOOL_CHANNELS;
  handle(channels.status, () => service.status());
  handle(channels.addFiles, (owner, files) => service.addFiles(owner, files));
  handle(channels.forgetSource, (owner, id) => service.forgetSource(owner, id));
  handle(channels.probe, (owner, id) => service.probe(owner, id));
  handle(channels.frames, (owner, target, options) =>
    service.frames(owner, target, options)
  );
  handle(channels.readSubtitleFile, (owner, id, encoding) =>
    service.readSubtitleFile(owner, id, encoding)
  );
  handle(channels.startJob, (owner, spec) => service.startJob(owner, spec));
  handle(channels.cancelJob, (owner, jobId) => service.cancelJob(owner, jobId));
  handle(channels.pauseJob, (owner, jobId) => service.pauseJob(owner, jobId));
  handle(channels.resumeJob, (owner, jobId) => service.resumeJob(owner, jobId));
  handle(channels.remakeSubtitles, (owner, jobId, subtitles) =>
    service.remakeSubtitles(owner, jobId, subtitles)
  );
  handle(channels.listJobs, (owner) => service.listJobs(owner));
  handle(channels.releaseJob, (owner, jobId) =>
    service.releaseJob(owner, jobId)
  );
  handle(channels.readText, (owner, jobId, file) =>
    service.readText(owner, jobId, file)
  );
  handle(channels.uploadChunk, (owner, request) =>
    service.uploadChunk(owner, request)
  );
  handle(channels.buildOnNode, (owner, request) =>
    service.buildOnNode(owner, request)
  );
  handle(channels.saveOutput, (owner, jobId, name) =>
    service.saveOutput(owner, jobId, name)
  );
  handle(channels.openSaved, (owner, savedId, how) =>
    service.openSaved(owner, savedId, how)
  );
  handle(channels.pickFiles, (owner, request) =>
    service.pickFiles(owner, request)
  );
}
