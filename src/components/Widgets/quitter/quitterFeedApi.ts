import type {
  FetchQuitterFeedOptions,
  QuitterFeedDocument,
  QuitterFeedPage,
  QuitterFeedImageRef,
  QuitterFeedItem,
  QuitterFeedItemImage,
  QuitterFeedSearchResource,
  QuitterFeedVideoRef,
} from './quitterFeedTypes';
import { getBaseApiReact } from '../../../utils/globalApi';

export const QUITTER_PUBLIC_FEED_SEARCH_ENDPOINT =
  '/arbitrary/resources/search';

const QUITTER_PUBLIC_FEED_SEARCH_LIMIT = 10;
const QUITTER_WIDGET_ITEM_LIMIT = 6;
const QUITTER_MAX_PAGINATION_PASSES = 4;
const QUITTER_FOLLOWING_SCAN_TOTAL_LIMIT = 60;
const QUITTER_FOLLOW_CANDIDATE_MAX_SIZE = 160;
const QUITTER_FOLLOW_CANDIDATE_LIMIT = 24;
const QUITTER_FOLLOWING_CACHE_TTL_MS = 5 * 60 * 1000;
/** Max entries; LRU eviction. Payloads can be large (e.g. embedded images). */
const QUITTER_DOCUMENT_PAYLOAD_CACHE_MAX_ENTRIES = 250;

// Verified against the public node on April 19, 2026.
// This is Quitter's qapp-core-derived POST + ROOT search prefix.
const QUITTER_PUBLIC_POST_PREFIX = 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-';
const QUITTER_FOLLOWING_PREFIX = 'gY.TWOeB25Co.7';
const followedNamesCache = new Map<
  string,
  { fetchedAt: number; names: string[] }
>();

const documentPayloadLru = new Map<string, unknown>();

const documentPayloadCacheKey = (resource: QuitterFeedSearchResource) =>
  `${resource.name}:${resource.identifier}:${resource.latestSignature}`;

const readDocumentPayloadCache = (key: string): unknown | undefined => {
  const value = documentPayloadLru.get(key);
  if (value === undefined) {
    return undefined;
  }
  documentPayloadLru.delete(key);
  documentPayloadLru.set(key, value);
  return value;
};

const writeDocumentPayloadCache = (key: string, value: unknown) => {
  if (documentPayloadLru.has(key)) {
    documentPayloadLru.delete(key);
  }
  documentPayloadLru.set(key, value);

  while (documentPayloadLru.size > QUITTER_DOCUMENT_PAYLOAD_CACHE_MAX_ENTRIES) {
    const oldest = documentPayloadLru.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    documentPayloadLru.delete(oldest);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

const toSafeString = (value: unknown) =>
  typeof value === 'string' ? value : '';

const toSafeNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const detectImageMimeType = (base64: string): string => {
  try {
    const binary = atob(base64.slice(0, 20));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }

    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }

    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }

    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }
  } catch {
    return 'image/webp';
  }

  return 'image/webp';
};

const toRenderableImage = (
  image: QuitterFeedImageRef,
  author: string,
  index: number
): QuitterFeedItemImage | null => {
  const src = toSafeString(image?.src).trim();

  if (!src) {
    return null;
  }

  return {
    alt: `${author} image ${index + 1}`,
    src: `data:${detectImageMimeType(src)};base64,${src}`,
  };
};

const isQuitterVideoRef = (value: unknown): value is QuitterFeedVideoRef =>
  isRecord(value) &&
  toSafeString(value.identifier).length > 0 &&
  toSafeString(value.name).length > 0 &&
  toSafeString(value.service) === 'DOCUMENT';

const isQuitterDocument = (value: unknown): value is QuitterFeedDocument => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.text === 'string' &&
    typeof value.name === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp)
  );
};

const mapSearchResource = (
  value: unknown
): QuitterFeedSearchResource | null => {
  if (!isRecord(value)) {
    return null;
  }

  const created = toSafeNumber(value.created);
  const size = toSafeNumber(value.size);
  const updated = toSafeNumber(value.updated) ?? undefined;
  const name = toSafeString(value.name);
  const service = toSafeString(value.service);
  const identifier = toSafeString(value.identifier);
  const latestSignature = toSafeString(value.latestSignature);

  if (
    created == null ||
    size == null ||
    !name ||
    service !== 'DOCUMENT' ||
    !identifier ||
    !latestSignature
  ) {
    return null;
  }

  return {
    created,
    identifier,
    latestSignature,
    name,
    service: 'DOCUMENT',
    size,
    updated,
  };
};

const mapDocumentToFeedItem = (
  resource: QuitterFeedSearchResource,
  document: unknown
): QuitterFeedItem | null => {
  if (!isQuitterDocument(document)) {
    return null;
  }

  const author = document.name.trim() || resource.name;
  const images = (Array.isArray(document.images) ? document.images : [])
    .map((image, index) =>
      toRenderableImage(image, author || resource.name, index)
    )
    .filter((image): image is QuitterFeedItemImage => image != null);
  const hasVideo = (Array.isArray(document.videos) ? document.videos : []).some(
    isQuitterVideoRef
  );

  return {
    author,
    avatarUrl: getQuitterAvatarUrl(author),
    hasVideo,
    id: `${resource.name}:${resource.identifier}`,
    identifier: resource.identifier,
    images,
    latestSignature: resource.latestSignature,
    publishedAt: document.timestamp,
    searchCreatedAt: resource.created,
    service: resource.service,
    text: document.text,
    updatedAt: resource.updated,
  };
};

const getFollowedNameFromDocument = (document: unknown) => {
  if (!isRecord(document)) {
    return null;
  }

  const followedName = toSafeString(document.followedName).trim();
  return followedName || null;
};

const fetchText = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.text();
};

const fetchJSON = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
};
const buildQuitterFeedSearchUrl = (
  searchLimit: number,
  offset: number,
  names: string[] = []
) => {
  const params = new URLSearchParams({
    identifier: QUITTER_PUBLIC_POST_PREFIX,
    limit: String(searchLimit),
    mode: 'ALL',
    offset: String(offset),
    prefix: 'true',
    reverse: 'true',
    service: 'DOCUMENT',
    excludeblocked: 'true',
  });

  names.forEach((name) => {
    params.append('name', name);
  });

  return `${getBaseApiReact()}${QUITTER_PUBLIC_FEED_SEARCH_ENDPOINT}?${params.toString()}`;
};

const buildQuitterUserResourceSearchUrl = (
  userName: string,
  searchLimit: number,
  offset: number
) => {
  const params = new URLSearchParams({
    exactmatchnames: 'true',
    limit: String(searchLimit),
    mode: 'ALL',
    name: userName,
    offset: String(offset),
    reverse: 'true',
    service: 'DOCUMENT',
    excludeblocked: 'true',
    identifier: QUITTER_FOLLOWING_PREFIX,
    prefix: 'true',
  });

  return `${getBaseApiReact()}${QUITTER_PUBLIC_FEED_SEARCH_ENDPOINT}?${params.toString()}`;
};

const buildQuitterDocumentUrl = (name: string, identifier: string) =>
  `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;

export const getQuitterAvatarUrl = (author: string) =>
  `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(author)}/qortal_avatar?async=true`;

const fetchQuitterSearchResources = async (
  searchLimit: number,
  offset = 0,
  names: string[] = [],
  signal?: AbortSignal
) => {
  const parsed = await fetchJSON(
    buildQuitterFeedSearchUrl(searchLimit, offset, names),
    signal
  );

  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected Quitter feed response shape');
  }

  return parsed
    .map(mapSearchResource)
    .filter(
      (resource): resource is QuitterFeedSearchResource => resource != null
    );
};

const fetchQuitterUserResources = async (
  userName: string,
  searchLimit: number,
  offset = 0,
  signal?: AbortSignal
) => {
  const text = await fetchJSON(
    buildQuitterUserResourceSearchUrl(userName, searchLimit, offset),
    signal
  );
  console.log('fetchQuitterUserResources text', text);
  const parsed = text;

  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected Quitter user resource response shape');
  }

  return parsed
    .map(mapSearchResource)
    .filter(
      (resource): resource is QuitterFeedSearchResource => resource != null
    );
};

const fetchQuitterDocumentPayload = async (
  resource: QuitterFeedSearchResource,
  signal?: AbortSignal
) => {
  const cacheKey = documentPayloadCacheKey(resource);
  const cached = readDocumentPayloadCache(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const text = await fetchText(
    buildQuitterDocumentUrl(resource.name, resource.identifier),
    signal
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  writeDocumentPayloadCache(cacheKey, parsed);
  return parsed;
};

const fetchFollowedNames = async (
  resources: QuitterFeedSearchResource[],
  signal?: AbortSignal
) => {
  const response = await fetch(
    `${getBaseApiReact()}/arbitrary/resources/onchain/data`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        resources.map((resource) => ({
          service: resource.service,
          name: resource.name,
          identifier: resource.identifier,
        }))
      ),
    }
  );
  const followedNames = new Set<string>();
  const results = await response.json();
  console.log('fetchFollowedNames results', results);
  if (response.ok) {
    for (const result of results) {
      if (!result.data || result.error) continue;

      try {
        const json = JSON.parse(atob(result.data));
        if (!json.followedName) continue;
        followedNames.add(json.followedName);
      } catch {
        console.warn(
          'Failed to decode follow data for identifier:',
          result.identifier
        );
      }
    }
  }

  return Array.from(followedNames);
};

export const fetchQuitterFeed = async ({
  excludeIds = [],
  itemLimit = QUITTER_WIDGET_ITEM_LIMIT,
  offset = 0,
  searchLimit = QUITTER_PUBLIC_FEED_SEARCH_LIMIT,
  signal,
}: FetchQuitterFeedOptions = {}): Promise<QuitterFeedItem[]> => {
  const page = await fetchQuitterFeedPage({
    excludeIds,
    itemLimit,
    offset,
    searchLimit,
    signal,
  });

  return page.items;
};

export const fetchQuitterFeedPage = async ({
  allowedAuthors,
  excludeIds = [],
  itemLimit = QUITTER_WIDGET_ITEM_LIMIT,
  offset = 0,
  searchLimit = QUITTER_PUBLIC_FEED_SEARCH_LIMIT,
  signal,
}: FetchQuitterFeedOptions = {}): Promise<QuitterFeedPage> => {
  console.log('fetchQuitterFeedPage allowedAuthors', allowedAuthors);
  const seenIds = new Set(excludeIds);
  const normalizedAllowedAuthors =
    allowedAuthors
      ?.map((author) => author.trim().toLowerCase())
      .filter(Boolean) ?? null;
  const allowedAuthorsSet =
    normalizedAllowedAuthors != null ? new Set(normalizedAllowedAuthors) : null;

  if (allowedAuthorsSet && allowedAuthorsSet.size === 0) {
    return {
      hasMore: false,
      items: [],
      nextOffset: offset,
    };
  }

  const items: QuitterFeedItem[] = [];
  let hasMore = true;
  let nextOffset = offset;

  for (
    let pass = 0;
    pass < QUITTER_MAX_PAGINATION_PASSES && items.length < itemLimit && hasMore;
    pass += 1
  ) {
    const requestedOffset = nextOffset;
    const remaining = itemLimit - items.length;
    const requestLimit = Math.max(
      1,
      Math.min(
        QUITTER_PUBLIC_FEED_SEARCH_LIMIT,
        Math.max(searchLimit, remaining + 4)
      )
    );
    const resources = await fetchQuitterSearchResources(
      requestLimit,
      requestedOffset,
      allowedAuthors || [],
      signal
    );
    const filteredResources = resources
      .map((resource, resourceIndex) => ({
        resource,
        resourceIndex,
      }))
      .filter(({ resource }) => {
        const normalizedName = resource.name.trim().toLowerCase();
        return allowedAuthorsSet ? allowedAuthorsSet.has(normalizedName) : true;
      });

    const reachedSearchEnd = resources.length < requestLimit;

    if (resources.length === 0) {
      hasMore = false;
      break;
    }

    const settled = await Promise.allSettled(
      filteredResources.map(async (resourceEntry) => {
        const resource = resourceEntry.resource;
        const payload = await fetchQuitterDocumentPayload(resource, signal);
        return mapDocumentToFeedItem(resource, payload);
      })
    );
    let consumedResourceCount = resources.length;
    let reachedItemLimit = false;

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];

      if (result.status === 'fulfilled') {
        if (!result.value) {
          continue;
        }

        if (seenIds.has(result.value.id)) {
          continue;
        }

        seenIds.add(result.value.id);
        items.push(result.value);

        if (items.length >= itemLimit) {
          consumedResourceCount = filteredResources[index].resourceIndex + 1;
          reachedItemLimit = true;
          break;
        }

        continue;
      }

      if (!isAbortError(result.reason)) {
        console.error('Failed to load Quitter feed document', result.reason);
      }
    }

    nextOffset = requestedOffset + consumedResourceCount;
    const hasBufferedResources =
      reachedItemLimit && consumedResourceCount < resources.length;

    if (reachedSearchEnd && !hasBufferedResources) {
      hasMore = false;
    }
  }

  return {
    hasMore,
    items,
    nextOffset,
  };
};

export const fetchQuitterFollowedNames = async (
  userName: string,
  signal?: AbortSignal
) => {
  console.log('fetchQuitterFollowedNames', userName);
  const normalizedUserName = userName.trim();

  if (!normalizedUserName) {
    return [];
  }

  const cached = followedNamesCache.get(normalizedUserName);
  if (
    cached &&
    Date.now() - cached.fetchedAt < QUITTER_FOLLOWING_CACHE_TTL_MS
  ) {
    console.log('fetchQuitterFollowedNames cached', cached.names);
    return cached.names;
  }

  const followedNames = new Set<string>();
  const resources = await fetchQuitterUserResources(
    normalizedUserName,
    QUITTER_FOLLOWING_SCAN_TOTAL_LIMIT,
    0,
    signal
  );
  console.log('fetchQuitterFollowedNames resources', resources);
  const candidateResources = resources
    .filter(
      (resource) =>
        resource.size <= QUITTER_FOLLOW_CANDIDATE_MAX_SIZE &&
        resource.size !== 32
    )
    .sort((left, right) => left.size - right.size)
    .slice(0, QUITTER_FOLLOW_CANDIDATE_LIMIT);
  console.log(
    'fetchQuitterFollowedNames candidateResources',
    candidateResources
  );
  const settled = await fetchFollowedNames(candidateResources, signal);
  // const settled = await Promise.allSettled(
  //   candidateResources.map(async (resource) => {
  //     const payload = await fetchQuitterDocumentPayload(resource, signal);
  //     console.log('fetchQuitterFollowedNames payload', payload);
  //     return getFollowedNameFromDocument(payload);
  //   })
  // );
  console.log('settled', settled);
  for (const result of settled) {
    if (!result || result === normalizedUserName) {
      continue;
    }

    followedNames.add(result);
  }

  const names = [...followedNames];
  followedNamesCache.set(normalizedUserName, {
    fetchedAt: Date.now(),
    names,
  });

  return names;
};
