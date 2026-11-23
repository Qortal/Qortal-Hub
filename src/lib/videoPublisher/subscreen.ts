/**
 * Films and TV series for Subscreen (1.1.3), which publishes them in
 * Q-Tube's format: they show in Q-Tube too.
 *
 * - A film: a Q-Tube video in category 1 with a genre, plus `year` and
 *   `quality` (Subscreen's PublishPage, real records in __fixtures__).
 * - A series: every episode a Q-Tube video in category 2 with the series'
 *   genre and description, then one PLAYLIST listing them with season,
 *   episode, label and order.
 *
 * Episodes can be built one by one (as each finishes converting) with
 * buildSubscreenEpisode, then listed with buildSubscreenPlaylist.
 */
import {
  isFilmGenre,
  isSeriesGenre,
  QTUBE_CATEGORY_MOVIES,
  QTUBE_CATEGORY_SERIES,
} from './categories';
import { base64ByteLength, jsonToBase64 } from './encoding';
import { VideoPublishError } from './errors';
import {
  fullDescription,
  htmlDescription,
  playlistQdnDescription,
} from './html';
import {
  episodeLabel,
  type EpisodeKind,
  identifierSlug,
  qdnTitle,
  QTUBE_ID_LENGTH,
  randomVideoId,
} from './ids';
import { subscreenTitleLink, subscreenTitleTarget } from './links';
import {
  assertListingFits,
  buildQtubeFormatVideo,
  QTUBE_TITLE_MAX_LENGTH,
  QTUBE_VIDEO_BASE,
  type QtubeVideoInput,
  type QtubeVideoPlan,
  requireName,
  requireTitle,
} from './qtube';
import type {
  ConvertedVideo,
  PublishedRecord,
  PublishStep,
  SubtitleTrack,
} from './types';

export const SUBSCREEN_TITLE_MAX_LENGTH = 120;
/** Subscreen leaves shorter films out of its lists (Q-Tube still shows them). */
export const SUBSCREEN_MIN_FILM_SECONDS = 600;
export const QTUBE_PLAYLIST_BASE = 'qtube_playlist_';
export const PLAYLIST_FILENAME = 'playlist.json';

/**
 * Each step's 16:9 frame, largest first: [step, long side, short side].
 * A video is the largest step whose frame it fills on either side (97 % will
 * do), so a 2.39:1 film of 1280×536 is 720p and 1920×804 is 1080p.
 * Subscreen's own rule since 2026-11-16 (it used the shorter side before,
 * which put widescreen films a step low); the same here keeps Hub's
 * listings like the ones Subscreen writes.
 */
const QUALITY_FRAMES = [
  [4320, 7680, 4320],
  [2160, 3840, 2160],
  [1440, 2560, 1440],
  [1080, 1920, 1080],
  [720, 1280, 720],
  [480, 854, 480],
  [360, 640, 360],
] as const;
const FRAME_SHARE = 0.97;

/**
 * The `quality` (its "p") of a video this size, as Subscreen names it.
 * Undefined under 240 lines.
 */
export function subscreenQuality(
  width: number,
  height: number
): number | undefined {
  const w = width > 0 ? width : 0;
  const h = height > 0 ? height : 0;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (!(short >= 240)) return undefined;
  for (const [step, frameLong, frameShort] of QUALITY_FRAMES) {
    if (long >= frameLong * FRAME_SHARE || short >= frameShort * FRAME_SHARE) {
      return step;
    }
  }
  return 360;
}

export const isListedInSubscreen = (durationSec: number): boolean =>
  durationSec >= SUBSCREEN_MIN_FILM_SECONDS;

const validYear = (year: number | null | undefined): number | undefined =>
  Number.isInteger(year) && year >= 1888 && year <= new Date().getFullYear() + 1
    ? year
    : undefined;

// --- Films ------------------------------------------------------------------

export type SubscreenFilmInput = Omit<
  QtubeVideoInput,
  'category' | 'subcategory'
> & {
  /** 101–115 or 199 (FILM_GENRES). */
  genre: number;
  year?: number | null;
};

export async function buildSubscreenFilm(
  input: SubscreenFilmInput
): Promise<QtubeVideoPlan & { record: PublishedRecord }> {
  if (!isFilmGenre(input.genre)) {
    throw new VideoPublishError('category-required', String(input.genre));
  }
  const { genre, year, ...rest } = input;
  const plan = await buildQtubeFormatVideo(
    { ...rest, category: QTUBE_CATEGORY_MOVIES, subcategory: genre },
    {
      titleMaxLength: SUBSCREEN_TITLE_MAX_LENGTH,
      fullDescriptionLimit: null,
      year: validYear(year),
      quality: subscreenQuality(input.video?.width, input.video?.height),
    }
  );
  const name = input.name.trim();
  return {
    ...plan,
    record: {
      app: 'subscreen',
      name,
      title: plan.title,
      link: subscreenTitleLink('DOCUMENT', name, plan.metadataIdentifier),
      open: subscreenTitleTarget('DOCUMENT', name, plan.metadataIdentifier),
      resources: plan.resources,
    },
  };
}

// --- Series -----------------------------------------------------------------

/** What every episode shares. */
export type SubscreenSeriesInfo = {
  name: string;
  title: string;
  description?: string;
  /** 201–215 or 299 (SERIES_GENRES). */
  genre: number;
  year?: number | null;
  /** The series' poster (WebP data URL); every episode's cover by default. */
  poster?: string | null;
};

export type SubscreenEpisodeInput = {
  key?: string;
  /** As the user left it; empty gives "<series> S01E02" (Subscreen's rule). */
  title?: string;
  season?: number | null;
  episode?: number | null;
  episodeKind?: EpisodeKind;
  video: ConvertedVideo;
  /** Defaults to the series' poster, then the first hover frame. */
  cover?: string | null;
  extracts?: readonly string[];
  subtitles?: readonly SubtitleTrack[];
};

/** One episode as built, with what the playlist needs from it. */
export type SubscreenEpisodePlan = QtubeVideoPlan & {
  season: number | null;
  episode: number | null;
  episodeKind: EpisodeKind | undefined;
  quality: number | undefined;
};

/** Subscreen's episode title: the one given, else "<series> S01E02". */
export function subscreenEpisodeTitle(
  episode: Pick<
    SubscreenEpisodeInput,
    'title' | 'season' | 'episode' | 'episodeKind'
  >,
  index: number,
  seriesTitle: string
): string {
  const own = (episode.title || '').trim();
  if (own) return own;
  const label = episodeLabel(
    episode.season,
    episode.episode,
    episode.episodeKind
  );
  const series = seriesTitle.trim();
  return label
    ? `${series} ${label}`.trim()
    : `${series} — Episode ${index + 1}`;
}

function requireSeriesGenre(genre: number): void {
  if (!isSeriesGenre(genre)) {
    throw new VideoPublishError('category-required', String(genre));
  }
}

const episodeKindOf = (
  episode: Pick<SubscreenEpisodeInput, 'episode' | 'episodeKind'>
): EpisodeKind | undefined =>
  episode.episode == null ? undefined : (episode.episodeKind ?? 'episode');

export async function buildSubscreenEpisode(
  series: SubscreenSeriesInfo,
  episode: SubscreenEpisodeInput,
  index: number
): Promise<SubscreenEpisodePlan> {
  requireSeriesGenre(series.genre);
  const seriesTitle = requireTitle(series.title, SUBSCREEN_TITLE_MAX_LENGTH);
  const extracts = episode.extracts || [];
  const cover = episode.cover || series.poster || extracts[0];
  const quality = subscreenQuality(episode.video?.width, episode.video?.height);
  const plan = await buildQtubeFormatVideo(
    {
      key: episode.key || `episode-${index}`,
      name: series.name,
      title: subscreenEpisodeTitle(episode, index, seriesTitle),
      description: series.description,
      category: QTUBE_CATEGORY_SERIES,
      subcategory: series.genre,
      cover,
      extracts,
      video: episode.video,
      subtitles: episode.subtitles,
    },
    {
      titleMaxLength: QTUBE_TITLE_MAX_LENGTH,
      fullDescriptionLimit: null,
      quality,
    }
  );
  return {
    ...plan,
    season: episode.season ?? null,
    episode: episode.episode ?? null,
    episodeKind: episodeKindOf(episode),
    quality,
  };
}

/** One entry of the playlist's `videos`, keys in Subscreen's order. */
export type SubscreenPlaylistVideo = {
  name: string;
  identifier: string;
  service: 'DOCUMENT';
  code: string;
  season?: number;
  episode?: number;
  episodeKind?: EpisodeKind;
  episodeTitle: string;
  label: string;
  order: number;
  duration: number;
  quality?: number;
};

export type SubscreenPlaylist = {
  title: string;
  version: 1;
  description: string;
  htmlDescription: string;
  image: string;
  videos: SubscreenPlaylistVideo[];
  commentsId: string;
  category: typeof QTUBE_CATEGORY_SERIES;
  subcategory: number;
  year?: number;
};

export type SubscreenPlaylistPlan = {
  step: PublishStep;
  identifier: string;
  playlist: SubscreenPlaylist;
};

/**
 * The series' PLAYLIST, listing `episodes` in the order given. Pass the
 * `identifier` of an earlier build to rebuild the same playlist (after a
 * retry, or with fewer episodes); it depends on every episode's metadata.
 */
export function buildSubscreenPlaylist({
  key = 'series',
  series,
  episodes,
  identifier,
}: {
  key?: string;
  series: SubscreenSeriesInfo;
  episodes: readonly SubscreenEpisodePlan[];
  identifier?: string;
}): SubscreenPlaylistPlan {
  requireSeriesGenre(series.genre);
  const name = requireName(series.name);
  const title = requireTitle(series.title, SUBSCREEN_TITLE_MAX_LENGTH);
  if (!episodes.length) throw new VideoPublishError('episodes-required');

  const id =
    identifier?.match(/_([A-Za-z0-9]+)$/)?.[1] ??
    randomVideoId(QTUBE_ID_LENGTH);
  const playlistIdentifier =
    identifier ??
    `${QTUBE_PLAYLIST_BASE}${identifierSlug(title, 'series')}_${id}`;
  const description = series.description || '';
  const plain = fullDescription(description, null);
  const image = series.poster || episodes[0].metadata.videoImage;
  if (!image) throw new VideoPublishError('cover-required');

  const videos: SubscreenPlaylistVideo[] = episodes.map((episode, order) => ({
    name,
    identifier: episode.metadataIdentifier,
    service: 'DOCUMENT',
    code: episode.code,
    season: episode.season ?? undefined,
    episode: episode.episode ?? undefined,
    episodeKind: episode.episodeKind,
    episodeTitle: episode.title,
    label: episode.title,
    order,
    duration: episode.metadata.duration,
    quality: episode.quality,
  }));
  const year = validYear(series.year);
  const playlist: SubscreenPlaylist = {
    title,
    version: 1,
    description: plain,
    htmlDescription: htmlDescription(description),
    image,
    videos,
    commentsId: `${QTUBE_PLAYLIST_BASE}_cm_${id}`,
    category: QTUBE_CATEGORY_SERIES,
    subcategory: series.genre,
    ...(year ? { year } : {}),
  };
  const base64 = jsonToBase64(playlist);
  assertListingFits(base64);
  return {
    identifier: playlistIdentifier,
    playlist,
    step: {
      key: `${key}:playlist`,
      kind: 'playlist',
      service: 'PLAYLIST',
      identifier: playlistIdentifier,
      title: qdnTitle(title),
      description: playlistQdnDescription(
        QTUBE_CATEGORY_SERIES,
        series.genre,
        episodes.map((episode) => episode.code),
        plain
      ),
      tag1: QTUBE_VIDEO_BASE,
      filename: PLAYLIST_FILENAME,
      data: { base64 },
      dependsOn: episodes.map((episode) => episode.metadataStepKey),
      bytes: base64ByteLength(base64),
    },
  };
}

export type SubscreenSeriesPlan = {
  steps: PublishStep[];
  episodes: SubscreenEpisodePlan[];
  playlist: SubscreenPlaylistPlan;
  record: PublishedRecord;
};

export function subscreenSeriesRecord(
  series: SubscreenSeriesInfo,
  episodes: readonly SubscreenEpisodePlan[],
  playlist: SubscreenPlaylistPlan
): PublishedRecord {
  const name = series.name.trim();
  return {
    app: 'subscreen',
    name,
    title: playlist.playlist.title,
    link: subscreenTitleLink('PLAYLIST', name, playlist.identifier),
    open: subscreenTitleTarget('PLAYLIST', name, playlist.identifier),
    resources: [
      ...episodes.flatMap((episode) => episode.resources),
      {
        service: 'PLAYLIST',
        name,
        identifier: playlist.identifier,
        kind: 'playlist',
        filename: PLAYLIST_FILENAME,
      },
    ],
  };
}

/** A whole series at once: every episode, then the playlist. */
export async function buildSubscreenSeries(
  series: SubscreenSeriesInfo & {
    key?: string;
    episodes: readonly SubscreenEpisodeInput[];
  }
): Promise<SubscreenSeriesPlan> {
  if (!series.episodes?.length) {
    throw new VideoPublishError('episodes-required');
  }
  const key = series.key || 'series';
  const episodes: SubscreenEpisodePlan[] = [];
  for (const [index, episode] of series.episodes.entries()) {
    episodes.push(
      await buildSubscreenEpisode(
        series,
        { ...episode, key: episode.key || `${key}:episode-${index}` },
        index
      )
    );
  }
  const playlist = buildSubscreenPlaylist({ key, series, episodes });
  return {
    steps: [...episodes.flatMap((episode) => episode.steps), playlist.step],
    episodes,
    playlist,
    record: subscreenSeriesRecord(series, episodes, playlist),
  };
}
