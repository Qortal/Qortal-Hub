/**
 * The videos this account published from the Video publisher, kept in this
 * Hub per account (localStorage), so their Open, Copy link and Remove
 * outlive "Clear finished" and a restart. Only what's needed to link to a
 * publish and to replace its resources: no files, no keys.
 */
import type {
  PublishedRecord,
  PublishService,
  PublishStepKind,
  VideoPublishApp,
} from '../../lib/videoPublisher';
import type { RemovalState } from './videoPublisherTypes';

/** What it was: one video of an app, or a Subscreen series or episode. */
export type PublishedKind =
  | 'qtube'
  | 'film'
  | 'series'
  | 'episode'
  | 'torq'
  | 'qshare';

export type PublishedEntry = {
  /** `item:<queue item id>` or `series:<playlist identifier>`. */
  id: string;
  /** The queue item it came from, while that is on the list (this session). */
  itemId?: string;
  kind: PublishedKind;
  record: PublishedRecord;
  /** ms since the epoch. */
  publishedAt: number;
  /** Only part of it went up (Remove takes that part away). */
  partial?: boolean;
  removal?: Exclude<RemovalState, 'confirm'>;
  removalError?: string;
  /** Removal steps that went through: a second Remove skips them. */
  removedKeys?: string[];
};

/**
 * Whether it can come off the published list: once removed, or while it's
 * published as a whole (it stays published; only this list forgets it). Not
 * while a removal runs or after one failed, and not when only part of it went
 * up: Remove is how those get cleaned up.
 */
export const canDismissPublished = (entry: PublishedEntry): boolean =>
  entry.removal === 'removed' || (!entry.partial && !entry.removal);

export const PUBLISHED_HISTORY_LIMIT = 200;

/**
 * Resources one entry may list, far above any real one: a long series with
 * many subtitle languages lists hundreds (each episode's VIDEO, listing and
 * subtitles, and the playlist).
 */
export const PUBLISHED_RECORD_MAX_RESOURCES = 10_000;

export const publishedHistoryKey = (address: string) =>
  `video-publisher-published-v1:${address}`;

const APPS = new Set<VideoPublishApp>(['qtube', 'subscreen', 'torq', 'qshare']);
const KINDS = new Set<PublishedKind>([
  'qtube',
  'film',
  'series',
  'episode',
  'torq',
  'qshare',
]);
const SERVICES = new Set<PublishService>([
  'VIDEO',
  'DOCUMENT',
  'FILE',
  'THUMBNAIL',
  'PLAYLIST',
]);
// A Subscreen title's cast & crew is its own to remove; a person, shared
// with other titles, is never on the list.
const STEP_KINDS = new Set<PublishStepKind>([
  'video',
  'subtitle',
  'metadata',
  'thumbnail',
  'playlist',
  'post',
  'file',
  'credits',
]);

const isText = (value: unknown, max = 1024): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

function readRecord(value: unknown): PublishedRecord | null {
  const record = value as PublishedRecord;
  if (!record || typeof record !== 'object') return null;
  if (!APPS.has(record.app) || !isText(record.name, 64)) return null;
  if (typeof record.title !== 'string' || record.title.length > 512) {
    return null;
  }
  if (!isText(record.link, 2048) || !record.link.startsWith('qortal://')) {
    return null;
  }
  const open = record.open;
  if (
    !open ||
    open.service !== 'APP' ||
    !isText(open.name, 64) ||
    typeof open.path !== 'string' ||
    open.path.length > 2048
  ) {
    return null;
  }
  if (
    !Array.isArray(record.resources) ||
    record.resources.length > PUBLISHED_RECORD_MAX_RESOURCES
  ) {
    return null;
  }
  const resources = record.resources.filter(
    (resource) =>
      resource &&
      SERVICES.has(resource.service) &&
      STEP_KINDS.has(resource.kind) &&
      isText(resource.name, 64) &&
      isText(resource.identifier, 256) &&
      (resource.filename === undefined || isText(resource.filename, 512))
  );
  if (!resources.length) return null;
  return {
    app: record.app,
    name: record.name,
    title: record.title,
    link: record.link,
    open: { service: 'APP', name: open.name, path: open.path },
    resources: resources.map((resource) => ({
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      kind: resource.kind,
      ...(resource.filename ? { filename: resource.filename } : {}),
    })),
  };
}

/** An entry as stored, checked field by field (anything odd is dropped). */
function readEntry(value: unknown): PublishedEntry | null {
  const entry = value as PublishedEntry;
  if (!entry || typeof entry !== 'object' || !isText(entry.id, 512)) {
    return null;
  }
  if (!KINDS.has(entry.kind)) return null;
  if (!Number.isFinite(entry.publishedAt)) return null;
  const record = readRecord(entry.record);
  if (!record) return null;
  // A Remove that was going when Hub closed didn't finish: it can go again
  // (what went through is skipped).
  const removal =
    entry.removal === 'removing'
      ? 'failed'
      : entry.removal === 'removed' || entry.removal === 'failed'
        ? entry.removal
        : undefined;
  return {
    id: entry.id,
    kind: entry.kind,
    record,
    publishedAt: entry.publishedAt,
    ...(entry.partial ? { partial: true } : {}),
    ...(removal ? { removal } : {}),
    ...(removal === 'failed'
      ? {
          removalError:
            entry.removal === 'removing'
              ? 'removal-interrupted'
              : isText(entry.removalError, 64)
                ? entry.removalError
                : 'publish-failed',
        }
      : {}),
    ...(Array.isArray(entry.removedKeys)
      ? {
          removedKeys: entry.removedKeys
            .filter((key) => isText(key, 512))
            .slice(0, PUBLISHED_RECORD_MAX_RESOURCES),
        }
      : {}),
  };
}

/** Newest first, at most PUBLISHED_HISTORY_LIMIT, one per id. */
export function normalizeHistory(
  entries: readonly PublishedEntry[]
): PublishedEntry[] {
  const seen = new Set<string>();
  return [...entries]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .slice(0, PUBLISHED_HISTORY_LIMIT);
}

/** This account's list; empty when there is none or it can't be read. */
export function readPublishedHistory(address: string | null): PublishedEntry[] {
  if (!address) return [];
  try {
    const raw = window.localStorage.getItem(publishedHistoryKey(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeHistory(
      parsed
        .map(readEntry)
        .filter((entry): entry is PublishedEntry => Boolean(entry))
    );
  } catch {
    return [];
  }
}

/** Keeps the list (the queue item ids stay out: they're this session's). */
export function writePublishedHistory(
  address: string | null,
  entries: readonly PublishedEntry[]
): void {
  if (!address) return;
  try {
    window.localStorage.setItem(
      publishedHistoryKey(address),
      JSON.stringify(
        normalizeHistory(entries).map(({ itemId: _itemId, ...entry }) => entry)
      )
    );
  } catch {
    // Full or blocked storage: the list lasts until Hub closes.
  }
}

/** Adds an entry, or replaces the one with its id. */
export function upsertEntry(
  entries: readonly PublishedEntry[],
  entry: PublishedEntry
): PublishedEntry[] {
  return normalizeHistory([
    ...entries.filter((current) => current.id !== entry.id),
    entry,
  ]);
}
