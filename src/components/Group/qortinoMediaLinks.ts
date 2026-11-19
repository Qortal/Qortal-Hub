import { getBaseApiReact } from '../../App';
import { fetchEarbumpArtistTracks } from './earbumpLibraryApi';

/**
 * Links the Workspace's player plays: music and videos on QDN.
 *
 * - Q-Tube: `qortal://APP/Q-Tube/video/<name>/<identifier>`, the video's
 *   details (a DOCUMENT) naming the VIDEO.
 * - Q-Share: `qortal://APP/Q-Share/share/<name>/<identifier>`, a share's
 *   details (a DOCUMENT) listing its files; its first audio or video file.
 * - Subscreen: `qortal://APP/Subscreen/watch/<SERVICE>/<name>/<identifier>`
 *   (or `title/…`): a VIDEO itself, or a title's details (a DOCUMENT) naming
 *   it, or a series' episode (`?episode=<n>`, from 0).
 * - EarBump, the links its Share buttons copy: a playlist,
 *   `qortal://APP/EarBump/playlists/<name>/<playlist id>` (a PLAYLIST listing
 *   its songs), or an artist's songs, `qortal://APP/EarBump/all-songs/<artist>`.
 *   They play from the first song, and next and previous go through them.
 * - Any QDN audio or video: `qortal://AUDIO/<name>/<identifier>`,
 *   `qortal://VIDEO/…` or `qortal://FILE/…`.
 *
 * The details documents are the format Q-Tube publishes (`videoReference`,
 * `title`, `videoImage`, `duration`), which Subscreen uses too.
 */

/** A song of an EarBump playlist or artist link. */
export type QortinoMediaTrack = {
  /** The AUDIO resource. */
  name: string;
  identifier: string;
  title: string;
  artist: string;
};

/** What a link plays. */
export type QortinoMediaItem = {
  kind: 'audio' | 'video';
  /** The resource played. */
  service: string;
  name: string;
  identifier: string;
  title: string;
  /** Who published it. */
  publisher: string;
  /** A picture for it: a URL, or a data URL. */
  thumbnail?: string;
  durationSeconds?: number;
  /** The link it came from. */
  link: string;
  /**
   * The songs of an EarBump playlist or artist link, played in turn: the
   * item is `tracks[trackIndex]`.
   */
  tracks?: QortinoMediaTrack[];
  trackIndex?: number;
};

/** The most songs a link keeps, with the Workspace's state. */
export const QORTINO_LINK_TRACK_LIMIT = 200;

export type QortinoMediaLinkProblem =
  /** Not a link the player plays. */
  | 'unsupported'
  /** Its details couldn't be read from QDN. */
  | 'not_found'
  /** Its details name nothing to play. */
  | 'not_playable';

export class QortinoMediaLinkError extends Error {
  problem: QortinoMediaLinkProblem;

  constructor(problem: QortinoMediaLinkProblem) {
    super(`Media link: ${problem}`);
    this.problem = problem;
  }
}

type PlayableService = 'AUDIO' | 'VIDEO' | 'FILE';

export type QortinoMediaLinkTarget =
  | {
      kind: 'resource';
      service: PlayableService;
      name: string;
      identifier: string;
    }
  | {
      kind: 'document';
      app: 'Q-Tube' | 'Q-Share' | 'Subscreen';
      name: string;
      /** The details' identifiers to try, in order. */
      identifiers: string[];
      /** A series' episode, from 0. */
      episode: number;
    }
  | {
      kind: 'earbump-playlist';
      /** Who published the playlist, and its identifier. */
      name: string;
      identifier: string;
    }
  | {
      kind: 'earbump-artist';
      artist: string;
    };

const PLAYABLE_SERVICES: readonly PlayableService[] = [
  'AUDIO',
  'VIDEO',
  'FILE',
];

const isPlayableService = (value: string): value is PlayableService =>
  (PLAYABLE_SERVICES as readonly string[]).includes(value);

const decodePart = (value: string) => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

/**
 * Whether a name or identifier stays one part of the node's addresses:
 * no '.' or '..' part (also written %2e, or with tabs and newlines, which
 * URLs drop) and no '\', which URLs read as '/'.
 */
const isPathSafe = (value: string) => {
  const plain = value.replace(/[\t\n\r]/g, '');
  return (
    !plain.includes('\\') &&
    !plain.split('/').some((part) => /^(?:\.|%2e){1,2}$/i.test(part))
  );
};

/** Q-Tube's and Q-Share's links name the details with or without it. */
const detailsIdentifiers = (identifier: string) =>
  identifier.endsWith('_metadata')
    ? [identifier]
    : [identifier, `${identifier}_metadata`];

/** What a link points to, or null for any other text or link. */
export const parseQortinoMediaLink = (
  value: string
): QortinoMediaLinkTarget | null => {
  const match = /^qortal:\/\/([^?#\s]+)(\?[^#\s]*)?(#\S*)?$/i.exec(
    value.trim()
  );
  if (!match) return null;
  const parts = match[1].split('/').filter(Boolean).map(decodePart);
  if (!parts.every(isPathSafe)) return null;
  const query = new URLSearchParams(match[2] ?? '');
  const [first = '', ...rest] = parts;
  const service = first.toUpperCase();

  if (service !== 'APP') {
    if (!isPlayableService(service) || !rest[0] || !rest[1]) return null;
    return {
      identifier: rest[1],
      kind: 'resource',
      name: rest[0],
      service,
    };
  }

  const [app = '', route = '', ...params] = rest;
  const appName = app.toLowerCase();
  const routeName = route.toLowerCase();
  if (appName === 'q-tube' && routeName === 'video' && params[1]) {
    return {
      app: 'Q-Tube',
      episode: 0,
      identifiers: detailsIdentifiers(params[1]),
      kind: 'document',
      name: params[0],
    };
  }
  if (appName === 'q-share' && routeName === 'share' && params[1]) {
    return {
      app: 'Q-Share',
      episode: 0,
      identifiers: detailsIdentifiers(params[1]),
      kind: 'document',
      name: params[0],
    };
  }
  if (
    appName === 'subscreen' &&
    (routeName === 'watch' || routeName === 'title') &&
    params[2]
  ) {
    const [resourceService, name, identifier] = params;
    const upper = resourceService.toUpperCase();
    if (isPlayableService(upper)) {
      return { identifier, kind: 'resource', name, service: upper };
    }
    if (upper !== 'DOCUMENT') return null;
    const episode = Math.max(0, Math.floor(Number(query.get('episode'))) || 0);
    return {
      app: 'Subscreen',
      episode,
      identifiers: [identifier],
      kind: 'document',
      name,
    };
  }
  // EarBump is published as EarBump, and before that as Ear-Bump.
  if (appName === 'earbump' || appName === 'ear-bump') {
    if (routeName === 'playlists' && params[0] && params[1]) {
      return {
        identifier: params[1],
        kind: 'earbump-playlist',
        name: params[0],
      };
    }
    if (routeName === 'all-songs' && params[0]) {
      return { artist: params[0], kind: 'earbump-artist' };
    }
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const seconds = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const kindOfMime = (mime: string): 'audio' | 'video' | null =>
  mime.startsWith('audio/')
    ? 'audio'
    : mime.startsWith('video/')
      ? 'video'
      : null;

const resourceUrl = (service: string, name: string, identifier: string) =>
  `${getBaseApiReact()}/arbitrary/${encodeURIComponent(
    service
  )}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;

/** A picture given as a URL, a data URL, or a QDN resource. */
const pictureOf = (value: unknown, name: string) => {
  const direct = text(value);
  if (/^(data:image\/|https?:\/\/)/i.test(direct)) return direct;
  if (!isRecord(value)) return undefined;
  const service = text(value.service) || 'THUMBNAIL';
  const owner = text(value.name) || name;
  const identifier = text(value.identifier);
  if (!identifier) return undefined;
  if (![service, owner, identifier].every(isPathSafe)) return undefined;
  return `${resourceUrl(service, owner, identifier)}?async=true`;
};

type FetchJson = (url: string, signal?: AbortSignal) => Promise<unknown>;

const fetchJsonFromNode: FetchJson = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`QDN request failed (${response.status})`);
  return response.json();
};

/** The played resource a video's details name. */
const fromVideoDetails = (
  details: Record<string, unknown>,
  target: Extract<QortinoMediaLinkTarget, { kind: 'document' }>,
  link: string
): QortinoMediaItem => {
  const episodes = Array.isArray(details.episodes) ? details.episodes : [];
  const episode = isRecord(episodes[target.episode])
    ? (episodes[target.episode] as Record<string, unknown>)
    : null;
  const source =
    episode && isRecord(episode.videoReference) ? episode : details;
  const reference = isRecord(source.videoReference)
    ? source.videoReference
    : null;
  const name = text(reference?.name) || target.name;
  const identifier = text(reference?.identifier);
  const service = text(reference?.service).toUpperCase() || 'VIDEO';
  if (
    !identifier ||
    !isPlayableService(service) ||
    !isPathSafe(name) ||
    !isPathSafe(identifier)
  ) {
    throw new QortinoMediaLinkError('not_playable');
  }
  return {
    durationSeconds: seconds(source.duration) ?? seconds(details.duration),
    identifier,
    kind: kindOfMime(text(source.videoType)) ?? 'video',
    link,
    name,
    publisher: target.name,
    service,
    thumbnail:
      pictureOf(source.videoImage, target.name) ??
      pictureOf(details.videoImage, target.name),
    title: text(source.title) || text(details.title) || identifier,
  };
};

/** A share's first audio or video file. */
const fromShareDetails = (
  details: Record<string, unknown>,
  target: Extract<QortinoMediaLinkTarget, { kind: 'document' }>,
  link: string
): QortinoMediaItem => {
  const files = Array.isArray(details.files) ? details.files : [];
  for (const file of files) {
    if (!isRecord(file)) continue;
    const kind = kindOfMime(text(file.mimetype) || text(file.mimeType));
    const identifier = text(file.identifier);
    const service = text(file.service).toUpperCase() || 'FILE';
    const name = text(file.name) || target.name;
    if (!kind || !identifier || !isPlayableService(service)) continue;
    if (!isPathSafe(name) || !isPathSafe(identifier)) continue;
    return {
      identifier,
      kind,
      link,
      name,
      publisher: target.name,
      service,
      thumbnail: pictureOf(details.thumbnail, target.name),
      title: text(details.title) || text(file.filename) || identifier,
    };
  }
  throw new QortinoMediaLinkError('not_playable');
};

/** The songs an EarBump playlist lists, as it stores them. */
const playlistTracks = (playlist: Record<string, unknown>) => {
  const songs = Array.isArray(playlist.songs) ? playlist.songs : [];
  const tracks: QortinoMediaTrack[] = [];
  for (const song of songs) {
    // No further than the songs kept, however long the playlist is.
    if (tracks.length >= QORTINO_LINK_TRACK_LIMIT) break;
    if (!isRecord(song)) continue;
    const identifier = text(song.identifier) || text(song.id);
    const name = text(song.name);
    const service = text(song.service).toUpperCase() || 'AUDIO';
    if (!identifier || !name || service !== 'AUDIO') continue;
    if (!isPathSafe(name) || !isPathSafe(identifier)) continue;
    if (tracks.some((track) => track.identifier === identifier)) continue;
    tracks.push({
      artist: text(song.author) || text(song.artist),
      identifier,
      name,
      title: text(song.title) || identifier,
    });
  }
  return tracks.slice(0, QORTINO_LINK_TRACK_LIMIT);
};

/** One song of a link's songs, as what the player plays. */
const trackItem = (
  tracks: QortinoMediaTrack[],
  index: number,
  link: string
): QortinoMediaItem => {
  const track = tracks[index];
  return {
    identifier: track.identifier,
    kind: 'audio',
    link,
    name: track.name,
    publisher: track.artist || track.name,
    service: 'AUDIO',
    title: track.title,
    trackIndex: index,
    tracks,
  };
};

/**
 * The next or previous song of an EarBump link, going round; null for an
 * item that plays one thing.
 */
export const stepQortinoMediaItem = (
  item: QortinoMediaItem | null | undefined,
  direction: 'next' | 'previous'
): QortinoMediaItem | null => {
  const tracks = item?.tracks;
  if (!item || !tracks || tracks.length < 2) return null;
  const index = item.trackIndex ?? 0;
  const next =
    direction === 'next'
      ? (index + 1) % tracks.length
      : (index - 1 + tracks.length) % tracks.length;
  return trackItem(tracks, next, item.link);
};

type FindArtistTracks = (
  artist: string,
  signal?: AbortSignal
) => Promise<QortinoMediaTrack[]>;

const findArtistTracksOnNode: FindArtistTracks = async (artist, signal) =>
  (
    await fetchEarbumpArtistTracks(artist, {
      limit: QORTINO_LINK_TRACK_LIMIT,
      signal,
    })
  )
    .filter((track) => isPathSafe(track.name) && isPathSafe(track.id))
    .slice(0, QORTINO_LINK_TRACK_LIMIT)
    .map((track) => ({
      artist: track.artist,
      identifier: track.id,
      name: track.name,
      title: track.title,
    }));

/**
 * What a link plays, from its details on QDN. Throws a
 * QortinoMediaLinkError saying why it can't be played.
 */
export const resolveQortinoMediaLink = async (
  link: string,
  options: {
    fetchJson?: FetchJson;
    findArtistTracks?: FindArtistTracks;
    signal?: AbortSignal;
  } = {}
): Promise<QortinoMediaItem> => {
  const fetchJson = options.fetchJson ?? fetchJsonFromNode;
  const target = parseQortinoMediaLink(link);
  if (!target) throw new QortinoMediaLinkError('unsupported');
  const trimmed = link.trim();

  if (target.kind === 'earbump-playlist') {
    let playlist: unknown = null;
    try {
      playlist = await fetchJson(
        resourceUrl('PLAYLIST', target.name, target.identifier),
        options.signal
      );
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
    if (!isRecord(playlist)) throw new QortinoMediaLinkError('not_found');
    const tracks = playlistTracks(playlist);
    if (tracks.length === 0) throw new QortinoMediaLinkError('not_playable');
    return trackItem(tracks, 0, trimmed);
  }

  if (target.kind === 'earbump-artist') {
    let tracks: QortinoMediaTrack[] = [];
    try {
      tracks = await (options.findArtistTracks ?? findArtistTracksOnNode)(
        target.artist,
        options.signal
      );
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
    if (tracks.length === 0) throw new QortinoMediaLinkError('not_found');
    return trackItem(tracks, 0, trimmed);
  }

  if (target.kind === 'resource') {
    let kind: 'audio' | 'video' =
      target.service === 'AUDIO' ? 'audio' : 'video';
    let title = target.identifier;
    if (target.service === 'FILE') {
      // A file plays by its type. The node only describes a file it has;
      // until then, the type given when it was published says. If neither
      // says, it's tried as a video, which also has the node get it.
      const path = `FILE/${encodeURIComponent(
        target.name
      )}/${encodeURIComponent(target.identifier)}`;
      let properties: unknown = null;
      try {
        properties = await fetchJson(
          `${getBaseApiReact()}/arbitrary/resource/properties/${path}`,
          options.signal
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        try {
          properties = await fetchJson(
            `${getBaseApiReact()}/arbitrary/metadata/${path}`,
            options.signal
          );
        } catch (metadataError) {
          if (options.signal?.aborted) throw metadataError;
        }
      }
      if (isRecord(properties)) {
        const fileKind = kindOfMime(text(properties.mimeType));
        if (!fileKind && text(properties.mimeType)) {
          throw new QortinoMediaLinkError('not_playable');
        }
        kind = fileKind ?? kind;
        title = text(properties.filename) || title;
      }
    }
    return {
      identifier: target.identifier,
      kind,
      link: trimmed,
      name: target.name,
      publisher: target.name,
      service: target.service,
      title,
    };
  }

  let details: Record<string, unknown> | null = null;
  for (const identifier of target.identifiers) {
    try {
      const value = await fetchJson(
        resourceUrl('DOCUMENT', target.name, identifier),
        options.signal
      );
      if (isRecord(value)) {
        details = value;
        break;
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
  }
  if (!details) throw new QortinoMediaLinkError('not_found');
  return target.app === 'Q-Share'
    ? fromShareDetails(details, target, trimmed)
    : fromVideoDetails(details, target, trimmed);
};

/** Where the node serves a resource that's ready. */
export const qortinoMediaUrl = (
  item: Pick<QortinoMediaItem, 'identifier' | 'name' | 'service'>
) => resourceUrl(item.service, item.name, item.identifier);

/** The item kept in the Workspace's state, cleaned; null for anything else. */
export const sanitizeQortinoMediaItem = (
  value: unknown
): QortinoMediaItem | null => {
  if (!isRecord(value)) return null;
  const kind =
    value.kind === 'audio' || value.kind === 'video' ? value.kind : null;
  const service = text(value.service).toUpperCase();
  const name = text(value.name);
  const identifier = text(value.identifier);
  const link = text(value.link);
  if (!kind || !isPlayableService(service) || !name || !identifier || !link) {
    return null;
  }
  if (!isPathSafe(name) || !isPathSafe(identifier)) return null;
  const thumbnail = text(value.thumbnail);
  const tracks = sanitizeTracks(value.tracks);
  return {
    identifier,
    kind,
    link,
    name,
    publisher: text(value.publisher) || name,
    service,
    title: text(value.title) || identifier,
    ...(seconds(value.durationSeconds)
      ? { durationSeconds: seconds(value.durationSeconds) }
      : {}),
    // A data URL can be big: only short pictures are kept.
    ...(thumbnail && thumbnail.length <= 24_000 ? { thumbnail } : {}),
    ...(tracks
      ? {
          trackIndex: Math.min(
            tracks.length - 1,
            Math.max(0, Math.floor(Number(value.trackIndex)) || 0)
          ),
          tracks,
        }
      : {}),
  };
};

/** A link's songs kept in the Workspace's state, cleaned. */
const sanitizeTracks = (value: unknown): QortinoMediaTrack[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const tracks: QortinoMediaTrack[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = text(entry.name);
    const identifier = text(entry.identifier);
    if (!name || !identifier) continue;
    if (!isPathSafe(name) || !isPathSafe(identifier)) continue;
    tracks.push({
      artist: text(entry.artist),
      identifier,
      name,
      title: text(entry.title) || identifier,
    });
    if (tracks.length >= QORTINO_LINK_TRACK_LIMIT) break;
  }
  return tracks.length > 0 ? tracks : undefined;
};
