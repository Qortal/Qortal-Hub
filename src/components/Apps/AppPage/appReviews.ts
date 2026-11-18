import { limitQdnDescription } from '../../../utils/qdnMetadataLimits';
import {
  appReviewKey,
  normalizeAppIdentifier,
  normalizeAppService,
  replyIdentifier,
  replyPrefixOf,
  reviewIdentifierKind,
} from './appPageIds';
import { AppRef, publishOnQdn } from './appPageQdn';
import { bytesToBase64 } from './blobBytes';

/**
 * Reviews and replies are COMMENT resources of their authors' names (see
 * appPageIds.ts). A review holds no stars of its own: the stars shown next to
 * it are the author's vote in the app's rating poll, so they can't be faked.
 */

export const REVIEW_LIMITS = { review: 2000, reply: 1000 };

/** The review identifier of the app, or of the widget when it has its own. */
export const reviewKeyOf = (app: AppRef): string =>
  appReviewKey(app.service, app.name, app.identifier);

export type ReviewKind = 'review' | 'reply';

export interface ReviewRecord {
  kind: ReviewKind;
  text: string;
  /** The review a reply answers. */
  parent: { name: string; identifier: string } | null;
  created: number;
  edited: number;
  deleted: boolean;
}

/** A review or reply as the search lists it. */
export interface ReviewResource {
  name: string;
  identifier: string;
  kind: ReviewKind;
  created: number;
  updated: number;
  /** The latest version's transaction signature ('' when not known). */
  signature: string;
  /** The start of the text, from the resource's QDN description. */
  snippet: string;
  /** A reply's review author, from the resource's QDN title. */
  parentName: string | null;
}

export interface ReviewItem extends ReviewResource {
  /** The whole text once the record is loaded, else the snippet. */
  text: string;
  complete: boolean;
  deleted: boolean;
  /** Sent by this user, not listed by the node yet. */
  pending: boolean;
}

export interface ReviewThread {
  review: ReviewItem;
  replies: ReviewItem[];
}

const asTime = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export const parseReviewRecord = (raw: unknown): ReviewRecord | null => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  const kind: ReviewKind = record.kind === 'reply' ? 'reply' : 'review';
  const parentValue = record.parent as Record<string, unknown> | undefined;
  const parent =
    kind === 'reply' &&
    parentValue &&
    typeof parentValue.name === 'string' &&
    typeof parentValue.identifier === 'string'
      ? { name: parentValue.name, identifier: parentValue.identifier }
      : null;
  const limit = kind === 'reply' ? REVIEW_LIMITS.reply : REVIEW_LIMITS.review;
  return {
    kind,
    text: typeof record.text === 'string' ? record.text.slice(0, limit) : '',
    parent,
    created: asTime(record.created),
    edited: asTime(record.edited),
    deleted: record.deleted === true,
  };
};

export const serializeReviewRecord = (
  record: ReviewRecord,
  app: AppRef
): string => {
  const identifier = normalizeAppIdentifier(app.identifier);
  return JSON.stringify({
    v: 1,
    kind: record.kind,
    app: {
      service: normalizeAppService(app.service),
      name: app.name,
      ...(identifier ? { identifier } : {}),
    },
    text: record.deleted ? '' : record.text.trim(),
    ...(record.parent ? { parent: record.parent } : {}),
    created: record.created,
    ...(record.edited ? { edited: record.edited } : {}),
    ...(record.deleted ? { deleted: true } : {}),
  });
};

/** What the node's search shows of the text: QDN's 240-byte description. */
export const reviewSnippet = (text: string): string =>
  limitQdnDescription(text.trim().replace(/\s+/g, ' '));

export interface ReviewSearchPage {
  items: ReviewResource[];
  /** Rows the node returned, before anything else was left out. */
  rows: number;
}

/**
 * One page of the app's reviews, or of the replies to them: they have
 * prefixes of their own, so each pages by itself. `name` finds one author's.
 */
export const searchAppReviews = async (
  base: string,
  app: AppRef,
  {
    kind = 'review',
    name,
    limit = 100,
    offset = 0,
    signal,
  }: {
    kind?: ReviewKind;
    name?: string;
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
  } = {}
): Promise<ReviewSearchPage> => {
  const key = reviewKeyOf(app);
  const prefix = kind === 'reply' ? replyPrefixOf(key) : key;
  // mode=ALL: by default Core keeps only one resource per name and service.
  const url =
    `${base}/arbitrary/resources/search?service=COMMENT&mode=ALL` +
    `&identifier=${encodeURIComponent(prefix)}&prefix=true&includemetadata=true` +
    (name ? `&name=${encodeURIComponent(name)}&exactmatchnames=true` : '') +
    `&excludeblocked=true&reverse=true&limit=${limit}&offset=${offset}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('REVIEW_SEARCH_FAILED');
  const list = await response.json();
  if (!Array.isArray(list)) return { items: [], rows: 0 };
  const items: ReviewResource[] = [];
  list.forEach((item) => {
    if (!item || typeof item.name !== 'string') return;
    if (name && item.name.toLowerCase() !== name.toLowerCase()) return;
    const itemKind = reviewIdentifierKind(String(item.identifier || ''), key);
    if (itemKind !== kind) return;
    items.push({
      name: item.name,
      identifier: item.identifier,
      kind,
      created: asTime(item.created),
      updated: asTime(item.updated) || asTime(item.created),
      signature:
        typeof item.latestSignature === 'string' ? item.latestSignature : '',
      snippet:
        typeof item.metadata?.description === 'string'
          ? item.metadata.description
          : '',
      parentName:
        kind === 'reply' && typeof item.metadata?.title === 'string'
          ? item.metadata.title
          : null,
    });
  });
  return { items, rows: list.length };
};

/**
 * The whole review or reply. Undefined when the node can't serve it yet (it
 * may still be fetching it from peers): ask again later. Null for data that
 * isn't a review record.
 */
export const fetchReviewRecord = async (
  base: string,
  name: string,
  identifier: string,
  signal?: AbortSignal
): Promise<ReviewRecord | null | undefined> => {
  const response = await fetch(
    `${base}/arbitrary/COMMENT/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`,
    { signal }
  );
  if (!response.ok) return undefined;
  return parseReviewRecord(await response.text());
};

const toItem = (
  resource: ReviewResource,
  record: ReviewRecord | null,
  pending = false
): ReviewItem => ({
  ...resource,
  parentName: record?.parent?.name ?? resource.parentName,
  text: record ? record.text : resource.snippet,
  complete: !!record,
  // Hub publishes a removal without a description: until the record loads,
  // an item with no snippet counts as removed rather than as an empty one.
  deleted: record ? record.deleted : !resource.snippet,
  pending,
});

export const reviewItemKey = (name: string, identifier: string) =>
  `${name.toLowerCase()}\n${identifier}`;

/** A review sent from this Hub that the node doesn't list yet. */
export interface PendingReview {
  name: string;
  identifier: string;
  record: ReviewRecord;
  sentAt: number;
  /** The publish's transaction signature, when the node gave it. */
  signature?: string;
  /** Versions that were already there when this one was sent. */
  older?: string[];
  /** When the version listed then was published (0: none was listed). */
  previousUpdated?: number;
}

/** A sent item as published, before what was there then is known. */
export type SentReview = Omit<PendingReview, 'older' | 'previousUpdated'>;

/**
 * Remembers what was there when an item was sent: the version the node
 * listed, and any earlier sent version not listed yet, so neither is taken
 * for the new one.
 */
export const withPrevious = (
  sent: SentReview,
  listed: ReviewResource | undefined,
  earlier: PendingReview | undefined
): PendingReview => ({
  ...sent,
  older: Array.from(
    new Set(
      [listed?.signature, earlier?.signature, ...(earlier?.older || [])].filter(
        (value): value is string => !!value && value !== sent.signature
      )
    )
  ),
  previousUpdated: Math.max(
    listed?.updated || 0,
    earlier?.previousUpdated || 0
  ),
});

/** Whether the node now lists the sent version, or one newer than it. */
export const isPendingReviewListed = (
  entry: PendingReview,
  listed: ReviewResource | undefined
): boolean => {
  if (!listed) return false;
  if (entry.signature && listed.signature) {
    if (listed.signature === entry.signature) return true;
    if (entry.older?.includes(listed.signature)) return false;
  }
  return listed.updated > (entry.previousUpdated || 0);
};

/**
 * Reviews (newest first) with their replies (oldest first). A pending item
 * replaces the listed one until the node lists the new version.
 */
export const buildReviewThreads = (
  resources: ReviewResource[],
  records: Map<string, ReviewRecord | null>,
  pending: PendingReview[] = []
): ReviewThread[] => {
  const items = new Map<string, ReviewItem>();
  resources.forEach((resource) => {
    const key = reviewItemKey(resource.name, resource.identifier);
    items.set(key, toItem(resource, records.get(key) ?? null));
  });
  pending.forEach((entry) => {
    const key = reviewItemKey(entry.name, entry.identifier);
    const listed = items.get(key);
    if (isPendingReviewListed(entry, listed)) return;
    const resource: ReviewResource = {
      name: entry.name,
      identifier: entry.identifier,
      kind: entry.record.kind,
      created: listed?.created || entry.record.created || entry.sentAt,
      updated: entry.sentAt,
      signature: entry.signature || '',
      snippet: reviewSnippet(entry.record.text),
      parentName: entry.record.parent?.name ?? null,
    };
    items.set(key, toItem(resource, entry.record, true));
  });

  const reviews = new Map<string, ReviewThread>();
  items.forEach((item, key) => {
    if (item.kind === 'review') reviews.set(key, { review: item, replies: [] });
  });
  // Every review of an app has the same identifier: the author tells which.
  const byAuthor = new Map<string, ReviewThread>();
  reviews.forEach((thread) =>
    byAuthor.set(thread.review.name.toLowerCase(), thread)
  );
  items.forEach((item) => {
    if (item.kind !== 'reply' || item.deleted || !item.parentName) return;
    byAuthor.get(item.parentName.toLowerCase())?.replies.push(item);
  });
  const threads = Array.from(reviews.values()).filter(
    (thread) => !thread.review.deleted || thread.replies.length > 0
  );
  threads.forEach((thread) =>
    thread.replies.sort((a, b) => a.created - b.created)
  );
  return threads.sort(
    (a, b) =>
      Number(b.review.pending) - Number(a.review.pending) ||
      b.review.created - a.review.created
  );
};

const utf8ToBase64 = (text: string): string =>
  bytesToBase64(new TextEncoder().encode(text));

const publishRecord = async (
  app: AppRef,
  author: string,
  identifier: string,
  record: ReviewRecord
): Promise<string | undefined> => {
  const snippet = record.deleted ? '' : reviewSnippet(record.text);
  const response: any = await publishOnQdn({
    data: utf8ToBase64(serializeReviewRecord(record, app)),
    ...(snippet ? { description: snippet } : {}),
    identifier,
    name: author,
    service: 'COMMENT',
    // A reply's review author, so the list can thread it before loading it.
    ...(record.parent ? { title: record.parent.name } : {}),
    uploadType: 'base64',
  });
  return typeof response?.signature === 'string' && response.signature
    ? response.signature
    : undefined;
};

const sentReview = (
  author: string,
  identifier: string,
  record: ReviewRecord,
  sentAt: number,
  signature: string | undefined
): SentReview => ({
  name: author,
  identifier,
  record,
  sentAt,
  ...(signature ? { signature } : {}),
});

/** Publishes (or replaces) the author's review of the app. */
export const publishReview = async (
  app: AppRef,
  author: string,
  text: string,
  { created, now = Date.now() }: { created?: number; now?: number } = {}
): Promise<SentReview> => {
  const identifier = reviewKeyOf(app);
  const record: ReviewRecord = {
    kind: 'review',
    text: text.trim().slice(0, REVIEW_LIMITS.review),
    parent: null,
    created: created || now,
    edited: created ? now : 0,
    deleted: false,
  };
  const signature = await publishRecord(app, author, identifier, record);
  return sentReview(author, identifier, record, now, signature);
};

export const publishReply = async (
  app: AppRef,
  author: string,
  parent: { name: string; identifier: string },
  text: string,
  now = Date.now()
): Promise<SentReview> => {
  const identifier = replyIdentifier(reviewKeyOf(app));
  const record: ReviewRecord = {
    kind: 'reply',
    text: text.trim().slice(0, REVIEW_LIMITS.reply),
    parent,
    created: now,
    edited: 0,
    deleted: false,
  };
  const signature = await publishRecord(app, author, identifier, record);
  return sentReview(author, identifier, record, now, signature);
};

/** QDN keeps every resource; deleting publishes an empty one in its place. */
export const deleteReviewItem = async (
  app: AppRef,
  author: string,
  item: Pick<ReviewItem, 'identifier' | 'kind' | 'created' | 'parentName'>,
  now = Date.now()
): Promise<SentReview> => {
  const record: ReviewRecord = {
    kind: item.kind,
    text: '',
    parent:
      item.kind === 'reply' && item.parentName
        ? {
            name: item.parentName,
            identifier: reviewKeyOf(app),
          }
        : null,
    created: item.created || now,
    edited: now,
    deleted: true,
  };
  const signature = await publishRecord(app, author, item.identifier, record);
  return sentReview(author, item.identifier, record, now, signature);
};
