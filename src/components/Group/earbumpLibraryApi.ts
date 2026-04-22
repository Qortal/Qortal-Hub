export type EarbumpTrack = {
  artist: string;
  coverColors: [string, string, string];
  created: number;
  id: string;
  length: string;
  name: string;
  status: string | null;
  streamUrl: string;
  title: string;
  updated: number | null;
  uploaded: string;
};

const EARBUMP_PUBLIC_NODE_URL = 'https://ext-node.qortal.link';
const EARBUMP_SEARCH_ENDPOINT = '/arbitrary/resources/search';
const EARBUMP_SONG_IDENTIFIER_PREFIX = 'earbump_song_';

type SearchResponseItem = {
  created?: number;
  identifier?: string;
  metadata?: {
    author?: string;
    description?: string;
    title?: string;
  };
  name?: string;
  service?: string;
  status?: {
    status?: string;
  };
  updated?: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const toSafeString = (value: unknown) =>
  typeof value === 'string' ? value : '';

const toSafeNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const slugifySearchQuery = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const formatRelativeTimestamp = (timestamp: number) => {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) {
    return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) {
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  }

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
};

const hashSeed = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
};

const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = c;
    green = x;
  } else if (hue < 120) {
    red = x;
    green = c;
  } else if (hue < 180) {
    green = c;
    blue = x;
  } else if (hue < 240) {
    green = x;
    blue = c;
  } else if (hue < 300) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
};

const buildCoverColors = (seedValue: string): [string, string, string] => {
  const seed = hashSeed(seedValue);
  const hue = seed % 360;

  return [
    hslToHex(hue, 78, 62),
    hslToHex((hue + 42) % 360, 58, 28),
    hslToHex((hue + 14) % 360, 84, 78),
  ];
};

const parseDescriptionFields = (description: string) => {
  const fields = description.split(';');
  const parsed: Record<string, string> = {};

  for (const field of fields) {
    const [rawKey, rawValue] = field.split('=');
    if (!rawKey || !rawValue) continue;

    const key = rawKey.trim().toLowerCase();
    if (key !== 'title' && key !== 'author') continue;
    parsed[key] = rawValue.trim();
  }

  return parsed;
};

const mapSearchResponseItem = (value: unknown): EarbumpTrack | null => {
  if (!isRecord(value)) {
    return null;
  }

  const resource = value as SearchResponseItem;
  const identifier = toSafeString(resource.identifier).trim();
  const name = toSafeString(resource.name).trim();
  const service = toSafeString(resource.service).trim();
  const created = toSafeNumber(resource.created);

  if (!identifier || !name || service !== 'AUDIO' || created == null) {
    return null;
  }

  const metadataTitle = toSafeString(resource.metadata?.title).trim();
  const metadataAuthor = toSafeString(resource.metadata?.author).trim();
  const description = toSafeString(resource.metadata?.description).trim();
  const parsedDescription = parseDescriptionFields(description);
  const title = parsedDescription.title || metadataTitle || identifier;
  const artist = parsedDescription.author || metadataAuthor || name;

  return {
    artist,
    coverColors: buildCoverColors(`${name}:${identifier}:${title}:${artist}`),
    created,
    id: identifier,
    length: '--:--',
    name,
    status: toSafeString(resource.status?.status).trim() || null,
    streamUrl: `${EARBUMP_PUBLIC_NODE_URL}/arbitrary/AUDIO/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`,
    title,
    updated: toSafeNumber(resource.updated),
    uploaded: formatRelativeTimestamp(created),
  };
};

const dedupeTracks = (tracks: EarbumpTrack[]) => {
  const seenIds = new Set<string>();

  return tracks.filter((track) => {
    if (seenIds.has(track.id)) {
      return false;
    }

    seenIds.add(track.id);
    return true;
  });
};

const fetchTrackSearch = async (
  params: URLSearchParams,
  signal?: AbortSignal
) => {
  const response = await fetch(
    `${EARBUMP_PUBLIC_NODE_URL}${EARBUMP_SEARCH_ENDPOINT}?${params.toString()}`,
    {
      cache: 'no-store',
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`EarBump search failed with status ${response.status}`);
  }

  const parsed = (await response.json()) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected EarBump search response shape');
  }

  return dedupeTracks(
    parsed
      .map(mapSearchResponseItem)
      .filter((track): track is EarbumpTrack => track != null)
  );
};

const buildSearchParams = (
  query: string,
  options?: { limit?: number; offset?: number; useIdentifierQuery?: boolean }
) => {
  const params = new URLSearchParams({
    excludeblocked: 'true',
    includemetadata: 'true',
    includestatus: 'true',
    limit: String(options?.limit ?? 12),
    mode: 'ALL',
    offset: String(options?.offset ?? 0),
    reverse: 'true',
    service: 'AUDIO',
  });

  if (options?.useIdentifierQuery === true) {
    params.set('query', EARBUMP_SONG_IDENTIFIER_PREFIX);
  } else {
    params.set('identifier', EARBUMP_SONG_IDENTIFIER_PREFIX);
    params.set('query', query);
  }

  return params;
};

export const fetchEarbumpRecentTracks = async (
  options?: { limit?: number; offset?: number; signal?: AbortSignal }
) =>
  fetchTrackSearch(
    buildSearchParams('', {
      limit: options?.limit,
      offset: options?.offset,
      useIdentifierQuery: true,
    }),
    options?.signal
  );

export const searchEarbumpTracks = async (
  query: string,
  options?: { limit?: number; offset?: number; signal?: AbortSignal }
) => {
  const normalizedQuery = slugifySearchQuery(query);
  if (!normalizedQuery) {
    return fetchEarbumpRecentTracks(options);
  }

  const primaryResults = await fetchTrackSearch(
    buildSearchParams(normalizedQuery, {
      limit: options?.limit,
      offset: options?.offset,
    }),
    options?.signal
  );

  if (primaryResults.length > 0) {
    return primaryResults;
  }

  const rawQuery = query.trim().toLowerCase();
  if (!rawQuery || rawQuery === normalizedQuery) {
    return primaryResults;
  }

  return fetchTrackSearch(
    buildSearchParams(rawQuery, {
      limit: options?.limit,
      offset: options?.offset,
    }),
    options?.signal
  );
};

export const fetchEarbumpTrackById = async (
  trackId: string,
  options?: { signal?: AbortSignal }
) => {
  const trimmedTrackId = trackId.trim();
  if (!trimmedTrackId) return null;

  const params = new URLSearchParams({
    excludeblocked: 'true',
    includemetadata: 'true',
    includestatus: 'true',
    identifier: trimmedTrackId,
    limit: '1',
    mode: 'ALL',
    offset: '0',
    reverse: 'true',
    service: 'AUDIO',
  });

  const tracks = await fetchTrackSearch(params, options?.signal);
  return tracks[0] ?? null;
};
