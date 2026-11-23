/**
 * Pure helpers of the Video publisher's queue: matching subtitle files to
 * their videos, the fields each video starts with, what's still missing
 * before publishing, and how many resources (fees) a run publishes.
 */
import type {
  VideoProbe,
  VideoSource,
} from '../../../electron/src/video-tool-types';
import {
  isFilmGenre,
  isQshareVideoSubcategory,
  isQtubeCategory,
  isSeriesGenre,
  languageFromFileName,
  normalizeLanguage,
  parseEpisode,
  qshareTitle,
  qtubeSubcategories,
  QSHARE_TITLE_MAX_LENGTH,
  QTUBE_CATEGORY_MOVIES,
  QTUBE_CATEGORY_SERIES,
  QTUBE_TITLE_MAX_LENGTH,
  SUBSCREEN_TITLE_MAX_LENGTH,
  TORQ_VIDEO_TITLE_MAX_LENGTH,
  titleFromFileName,
} from '../../lib/videoPublisher';
import type {
  ItemFields,
  QueueItem,
  SeriesFields,
  SharedFields,
  SubtitleChoice,
  VideoDestination,
} from './videoPublisherTypes';

const AUDIO_EXTENSIONS = new Set(
  `mp3 m4a m4b aac flac wav wave ogg oga opus wma aif aiff alac ape mka ac3
  eac3 dts amr mid midi`.split(/\s+/)
);

/** A sound file (by its extension): left out as "audio only". */
export function isAudioFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** The file name without its folders and extension. */
export const baseName = (fileName: string): string =>
  (fileName.split(/[\\/]/).pop() || '').replace(/\.[a-z0-9]{2,4}$/i, '');

const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .trim();

/** The folder a picked file is in (its relative path without its name). */
export const folderOf = (relativePath?: string): string =>
  (relativePath ?? '').split(/[\\/]/).slice(0, -1).join('/');

/**
 * The video a subtitle file belongs to: the one whose name it starts with
 * ("Movie.en.srt" → "Movie.mkv"), the longest such name winning, and among
 * videos of the same name (one per season folder) the one in the subtitle's
 * own `folder`. When only one video came with it, that one (unless
 * `fallback` is false: then by name only).
 */
export function matchSubtitleToVideo(
  subtitleName: string,
  videos: readonly { id: string; name: string; folder?: string }[],
  folder?: string,
  fallback = true
): string | null {
  const subtitle = comparable(baseName(subtitleName));
  let best: { id: string; length: number; beside: boolean } | null = null;
  for (const video of videos) {
    const base = comparable(baseName(video.name));
    if (!base) continue;
    const matches =
      subtitle === base ||
      (subtitle.startsWith(base) && subtitle[base.length] === ' ');
    const beside = folder !== undefined && video.folder === folder;
    if (
      matches &&
      (!best ||
        base.length > best.length ||
        (base.length === best.length && beside && !best.beside))
    ) {
      best = { id: video.id, length: base.length, beside };
    }
  }
  if (best) return best.id;
  return fallback && videos.length === 1 ? videos[0].id : null;
}

/** An added subtitle file, ticked when its name gives the language. */
export function subtitleFromFile(source: VideoSource): SubtitleChoice {
  const { language, forced, hearingImpaired } = languageFromFileName(
    source.name
  );
  return {
    key: `file:${source.id}`,
    source: 'file',
    sourceId: source.id,
    fileName: source.name,
    language,
    include: Boolean(language),
    picture: false,
    ...(forced ? { forced: true } : {}),
    ...(hearingImpaired ? { hearingImpaired: true } : {}),
  };
}

/** The file's own subtitle tracks: text ones ticked when their language is known. */
export function subtitlesFromProbe(probe: VideoProbe): SubtitleChoice[] {
  return (probe?.subtitles ?? []).map((stream) => {
    const language = normalizeLanguage(stream.language);
    const picture = stream.kind === 'picture';
    const unsupported = stream.kind === 'unsupported';
    return {
      key: `stream:${stream.index}`,
      source: 'stream',
      streamIndex: stream.index,
      ...(stream.title ? { label: stream.title } : {}),
      language,
      include:
        !picture && !unsupported && Boolean(language) && !stream.isForced,
      picture,
      ...(unsupported ? { unsupported: true } : {}),
      ...(stream.isForced ? { forced: true } : {}),
    };
  });
}

/** What a video starts with: its title, year and episode from the file name. */
export function initialFields(source: VideoSource): ItemFields {
  const { title, year } = titleFromFileName(source.name);
  const episode = parseEpisode(source.name, source.relativePath);
  return {
    title,
    ...(year ? { year } : {}),
    ...(episode
      ? {
          season: episode.season,
          episode: episode.episode,
          episodeKind: episode.episodeKind,
          ...(episode.episodeTitle
            ? { episodeTitle: episode.episodeTitle }
            : {}),
        }
      : {}),
  };
}

/**
 * Videos that look like a series' episodes: at least two, mostly with an
 * episode number in their names.
 */
export function looksLikeSeries(
  sources: readonly Pick<VideoSource, 'name' | 'relativePath'>[]
): boolean {
  if (sources.length < 2) return false;
  const numbered = sources.filter((source) =>
    parseEpisode(source.name, source.relativePath)
  ).length;
  return numbered >= Math.ceil((sources.length * 2) / 3);
}

/** A series' title and year from its files: the shows' name, or the folder. */
export function suggestedSeries(
  sources: readonly Pick<VideoSource, 'name' | 'relativePath'>[]
): Partial<SeriesFields> {
  for (const source of sources) {
    const parsed = parseEpisode(source.name, source.relativePath);
    if (parsed?.seriesTitle) {
      // The episode parser drops a year before the number: the name has it.
      const year =
        titleFromFileName(parsed.seriesTitle).year ??
        titleFromFileName(source.name).year;
      return {
        title: titleFromFileName(parsed.seriesTitle).title,
        ...(year ? { year } : {}),
      };
    }
  }
  const folder = sources
    .map((source) => source.relativePath?.split(/[\\/]/)[0])
    .find(Boolean);
  if (folder) {
    const { title, year } = titleFromFileName(folder);
    return { title, ...(year ? { year } : {}) };
  }
  return {};
}

/** The item's own value, else the "same for all" one. */
export function effectiveFields(
  item: Pick<QueueItem, 'fields'>,
  shared: SharedFields
): ItemFields {
  const own = item.fields;
  const pick = <K extends keyof SharedFields>(key: K) =>
    own[key] !== undefined ? own[key] : shared[key];
  return {
    ...own,
    description: pick('description'),
    category: pick('category'),
    subcategory: pick('subcategory'),
    genre: pick('genre'),
    postText: pick('postText'),
    qshareSubcategory: pick('qshareSubcategory'),
  };
}

export const titleMaxLength = (destination: VideoDestination): number => {
  switch (destination) {
    case 'subscreen-film':
    case 'subscreen-series':
      return SUBSCREEN_TITLE_MAX_LENGTH;
    case 'torq':
      return TORQ_VIDEO_TITLE_MAX_LENGTH;
    case 'qshare':
      return QSHARE_TITLE_MAX_LENGTH;
    default:
      return QTUBE_TITLE_MAX_LENGTH;
  }
};

export type MissingField =
  | 'title'
  | 'category'
  | 'subcategory'
  | 'genre'
  | 'subtitle_language'
  | 'title_too_long'
  | 'series_title'
  | 'series_title_too_long'
  | 'series_genre';

/** What this video still needs before it can go to the destination. */
export function missingFields(
  destination: VideoDestination,
  item: Pick<QueueItem, 'fields' | 'subtitles'>,
  shared: SharedFields
): MissingField[] {
  if (destination === 'save') return [];
  const fields = effectiveFields(item, shared);
  const missing: MissingField[] = [];
  const title = (fields.title || '').trim();
  if (destination === 'qshare') {
    if (!qshareTitle(title)) missing.push('title');
    if (!isQshareVideoSubcategory(fields.qshareSubcategory)) {
      missing.push('subcategory');
    }
  } else if (destination === 'subscreen-film') {
    if (!title) missing.push('title');
    if (!isFilmGenre(fields.genre)) missing.push('genre');
  } else if (destination === 'qtube' || destination === 'torq') {
    if (!title) missing.push('title');
    if (!isQtubeCategory(fields.category)) missing.push('category');
    else if (
      fields.subcategory != null &&
      !qtubeSubcategories(fields.category).some(
        (option) => option.id === fields.subcategory
      )
    ) {
      missing.push('subcategory');
    }
  }
  // Over the app's limit the field shows red, and publishing would cut the
  // title without a word: it has to be shortened first.
  const ownTitle =
    destination === 'subscreen-series'
      ? (fields.episodeTitle ?? '')
      : (fields.title ?? '');
  if (ownTitle.length > titleMaxLength(destination)) {
    missing.push('title_too_long');
  }
  if (
    item.subtitles.some(
      (track) =>
        track.include && !track.picture && !track.unsupported && !track.language
    )
  ) {
    missing.push('subtitle_language');
  }
  return missing;
}

export function missingSeriesFields(series: SeriesFields): MissingField[] {
  const missing: MissingField[] = [];
  if (!series.title.trim()) missing.push('series_title');
  // Over the limit the field shows red: publishing would cut it unseen.
  else if (series.title.length > SUBSCREEN_TITLE_MAX_LENGTH) {
    missing.push('series_title_too_long');
  }
  if (!isSeriesGenre(series.genre)) missing.push('series_genre');
  return missing;
}

/**
 * Whether a video should get its real poster, and why: a Subscreen film
 * shows one upright (2:3), and so does a Q-Tube or Torq video in Movies or
 * Series, which Subscreen lists too. A series' episodes take the series'
 * poster (its form asks for that one).
 */
export function posterWanted(
  destination: VideoDestination,
  category: number | null | undefined
): 'subscreen' | 'qtube' | null {
  if (destination === 'subscreen-film') return 'subscreen';
  if (
    (destination === 'qtube' || destination === 'torq') &&
    (category === QTUBE_CATEGORY_MOVIES || category === QTUBE_CATEGORY_SERIES)
  ) {
    return 'qtube';
  }
  return null;
}

/** Which of a language's tracks goes first: full, then SDH, then forced. */
const subtitleRank = (track: SubtitleChoice): number =>
  track.forced ? 2 : track.hearingImpaired ? 1 : 0;

/**
 * The text subtitles a video takes along, one per language, in their order.
 * Of a language's ticked tracks, a full one goes before one for the hearing
 * impaired, and that before a forced one (only the lines in other
 * languages); of equal ones, the first.
 */
export function chosenSubtitles(
  subtitles: readonly SubtitleChoice[]
): SubtitleChoice[] {
  const best = new Map<string, SubtitleChoice>();
  for (const track of subtitles) {
    if (!track.include || track.picture || track.unsupported) continue;
    if (!track.language) continue;
    const current = best.get(track.language);
    if (!current || subtitleRank(track) < subtitleRank(current)) {
      best.set(track.language, track);
    }
  }
  const chosen = new Set(best.values());
  return subtitles.filter((track) => chosen.has(track));
}

/**
 * Whether Clear finished takes a video off the list: published, discarded,
 * not a video, or cancelled before it was converted. A cancelled video that
 * kept its converted file stays: Retry would still publish it.
 */
export function isClearable(
  item: Pick<QueueItem, 'phase' | 'output' | 'jobId'>
): boolean {
  return (
    item.phase === 'done' ||
    item.phase === 'discarded' ||
    item.phase === 'unusable' ||
    (item.phase === 'cancelled' && !(item.output && item.jobId))
  );
}

/** A video's own name for Save to this PC: its file name, as an MP4. */
export const savedFileName = (sourceName: string): string =>
  `${baseName(sourceName).trim() || 'video'}.mp4`;

/** A converted video this much shorter than its original isn't all there. */
const SHORT_OUTPUT_MIN_SEC = 5;
const SHORT_OUTPUT_SHARE = 0.03;

/**
 * The converted video's and the original's lengths when the converted one
 * came out shorter by more than max(5 s, 3 %): ffmpeg ends normally where a
 * cut-off file (a download not finished) stops being readable. Else null.
 */
export function shortOutput(
  item: Pick<QueueItem, 'probe' | 'output'>
): { convertedSec: number; originalSec: number } | null {
  const originalSec = item.probe?.durationSec;
  const convertedSec = item.output?.durationSec;
  if (!(originalSec > 0) || !(convertedSec >= 0)) return null;
  const allowed = Math.max(
    SHORT_OUTPUT_MIN_SEC,
    originalSec * SHORT_OUTPUT_SHARE
  );
  return originalSec - convertedSec > allowed
    ? { convertedSec, originalSec }
    : null;
}
