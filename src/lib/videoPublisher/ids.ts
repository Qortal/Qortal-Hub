/**
 * Identifiers and titles the way the target apps make them, plus reading a
 * title, a year and an episode number out of a video's file name.
 */

/** short-unique-id's "alphanum" dictionary, which the apps' ids use. */
const ALPHANUMERIC =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Random letters and digits, unbiased (rejection sampling). */
export function randomAlphanumeric(length: number): string {
  const limit = 256 - (256 % ALPHANUMERIC.length);
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += ALPHANUMERIC[byte % ALPHANUMERIC.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Q-Tube's and Subscreen's id after the slug (6; Torq uses 8). */
export const QTUBE_ID_LENGTH = 6;
export const TORQ_VIDEO_ID_LENGTH = 8;
/** The `code` in a video's metadata and description. */
export const CODE_LENGTH = 5;

export const randomVideoId = (length = QTUBE_ID_LENGTH): string =>
  randomAlphanumeric(length);

export const randomCode = (): string => randomAlphanumeric(CODE_LENGTH);

/**
 * The slug in `qtube_vid_<slug>_<id>`, `qtube_playlist_…` and
 * `qshare_file_…`: letters, digits and dashes, lower case, 30 at most
 * (Q-Tube, Subscreen, Torq and Q-Share all cut it the same way). A title
 * without any letter or digit gets `fallback`, as Subscreen and Q-Share do.
 */
export function identifierSlug(title: string, fallback = 'video'): string {
  const slug = title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .toLowerCase()
    .slice(0, 30);
  return /[a-z0-9]/.test(slug) ? slug : fallback;
}

/**
 * At most `max` UTF-16 units without cutting a surrogate pair in half (a
 * lone surrogate would make `encodeURIComponent` throw when publishing).
 */
export function sliceText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** One line: Q-Tube drops line breaks from titles as they are typed. */
export const singleLineTitle = (title: string): string =>
  title
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** QDN's own title field, which every app fills with the first 50. */
export const QDN_TITLE_LENGTH = 50;
export const qdnTitle = (title: string): string =>
  sliceText(singleLineTitle(title), QDN_TITLE_LENGTH);

/**
 * The `.mp4` name Subscreen writes into a video's metadata (`filename`):
 * the title in letters, digits and `_`, 40 at most. Q-Tube stores the
 * picked file's name there; the converted file has none worth keeping, and
 * this form is safe in every app's download.
 */
export function videoFileName(title: string, extension = 'mp4'): string {
  const base =
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 40) || 'video';
  return `${base}.${extension}`;
}

// --- Titles from file names -------------------------------------------------

/**
 * Release tags: from the first one on, the rest of a scene-style name is
 * technical (quality, source, codecs, group).
 */
const RELEASE_TAG =
  /(?<![\p{L}\p{N}])(?:\d{3,4}[pi]|[248]k|uhd|hdr(?:10\+?)?|dv|dovi|sdr|10-?bit|8-?bit|x\.?26[45]|h\.?\s?26[45]|hevc|avc|xvid|divx|av1|vp9|blu-?ray|bdrip|brrip|bdremux|remux|web-?dl|web-?rip|webrip|hdtv|hdrip|dvdrip|dvdscr|dvd5|dvd9|hdcam|camrip|aac(?:2\.0|5\.1)?|ac-?3|e-?ac-?3|ddp?(?:\s?[257]\.[01])?|dts(?:-?hd)?|truehd|atmos|flac|opus|mp3|[257]\.1|2\.0|proper|repack|rerip|internal|multi|dual(?:-audio)?|nf|amzn|dsnp|hmax|atvp)(?![\p{L}\p{N}])/iu;

const KNOWN_EXTENSION = /\.[a-z0-9]{2,4}$/i;
const SITE_PREFIX =
  /^(?:www\.)?[\w-]+\.(?:com|net|org|to|mx|cc|lol|tv|me)\s*-\s*/i;
const YEAR = /(?<![\p{L}\p{N}])\(?((?:18|19|20)\d{2})\)?(?![\p{L}\p{N}])/gu;

const isPlausibleYear = (year: number): boolean =>
  year >= 1888 && year <= new Date().getFullYear() + 1;

const trimSeparators = (text: string): string =>
  text.replace(/^[\s\-–—:(,]+|[\s\-–—:(,]+$/g, '').trim();

/** The file name without folders and its extension, separators as spaces. */
function readableBaseName(fileName: string): {
  text: string;
  sceneStyle: boolean;
} {
  const base = fileName.split(/[\\/]/).pop() || '';
  const withoutExtension = base.replace(KNOWN_EXTENSION, '');
  const sceneStyle =
    !/\s/.test(withoutExtension) && /[._]/.test(withoutExtension);
  const text = withoutExtension
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(SITE_PREFIX, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, sceneStyle };
}

/** `text` up to its first release tag (kept whole if it starts with one). */
function beforeReleaseTags(text: string): { text: string; tagged: boolean } {
  const index = text.search(RELEASE_TAG);
  return index > 0
    ? { text: text.slice(0, index).trim(), tagged: true }
    : { text, tagged: false };
}

/**
 * A title for a video from its file name: without the extension, dots and
 * underscores as spaces, release tags (1080p, x264, WEB-DL, BluRay, HEVC,
 * AAC, the group…) dropped, and a year kept apart (Subscreen's rule: a year
 * in brackets, before the tags, or in a dotted scene name is the film's
 * year; a year that ends a plain title, like "Star Runner 2049", is not).
 */
export function titleFromFileName(fileName: string): {
  title: string;
  year?: number;
} {
  const { text: readable, sceneStyle } = readableBaseName(fileName);
  const { text, tagged } = beforeReleaseTags(readable);

  let yearMatch: RegExpMatchArray | undefined;
  for (const match of text.matchAll(YEAR)) {
    if ((match.index ?? 0) > 0 && isPlausibleYear(Number(match[1]))) {
      yearMatch = match;
    }
  }
  if (yearMatch) {
    const start = yearMatch.index ?? 0;
    const end = start + yearMatch[0].length;
    const isYear =
      sceneStyle || yearMatch[0].startsWith('(') || end < text.length || tagged;
    if (isYear) {
      const title = trimSeparators(text.slice(0, start));
      if (title) return { title, year: Number(yearMatch[1]) };
    }
  }
  return { title: trimSeparators(text) || readable || fileName };
}

// --- Episodes ---------------------------------------------------------------

export type EpisodeKind = 'episode' | 'part' | 'chapter';

export type ParsedEpisode = {
  season: number | null;
  episode: number;
  episodeKind: EpisodeKind;
  /** The text after the episode number, without release tags. */
  episodeTitle: string | null;
  /** The text before it: the show's name in "Show.S01E02…". */
  seriesTitle: string | null;
};

const SEASON_FOLDER =
  /^(?:season|series|staffel|saison|temporada|stagione|seizoen|sezon|säsong|sesong|kausi|сезон)\s*0*(\d{1,2})\b|^s0*(\d{1,2})$/iu;

function seasonFromPath(relativePath?: string): number | null {
  if (!relativePath) return null;
  const folders = relativePath.split(/[\\/]/).slice(0, -1).reverse();
  for (const folder of folders) {
    const match = SEASON_FOLDER.exec(folder.trim());
    if (match) return Number(match[1] ?? match[2]);
  }
  return null;
}

type EpisodeMatch = {
  index: number;
  length: number;
  season: number | null;
  episode: number;
  kind: EpisodeKind;
};

/** Patterns, most specific first. Numbers never touch other digits. */
const EPISODE_PATTERNS: {
  re: RegExp;
  read: (m: RegExpExecArray) => Omit<EpisodeMatch, 'index' | 'length'>;
}[] = [
  {
    // S01E02, s1e2, S01.E02, S01 E02, S01E01E02 (the first one)
    re: /(?<![\p{L}\p{N}])s(\d{1,2})[\s.\-_]?e(\d{1,4})(?:[\s.\-_]?e\d{1,4})*(?![\p{N}])/iu,
    read: (m) => ({
      season: Number(m[1]),
      episode: Number(m[2]),
      kind: 'episode',
    }),
  },
  {
    // 1x02
    re: /(?<![\p{L}\p{N}])(\d{1,2})x(\d{2,3})(?![\p{L}\p{N}])/iu,
    read: (m) => ({
      season: Number(m[1]),
      episode: Number(m[2]),
      kind: 'episode',
    }),
  },
  {
    // Season 1 Episode 2
    re: /(?<![\p{L}\p{N}])season\s*(\d{1,2})\s*[,\-–]?\s*episode\s*(\d{1,4})(?![\p{N}])/iu,
    read: (m) => ({
      season: Number(m[1]),
      episode: Number(m[2]),
      kind: 'episode',
    }),
  },
  {
    // Episode 2, Ep 2, Ep.02, E02
    re: /(?<![\p{L}\p{N}])(?:episode|ep\.?|e)\s*(\d{1,4})(?![\p{L}\p{N}])/iu,
    read: (m) => ({ season: null, episode: Number(m[1]), kind: 'episode' }),
  },
  {
    re: /(?<![\p{L}\p{N}])part\s*(\d{1,3})(?![\p{L}\p{N}])/iu,
    read: (m) => ({ season: null, episode: Number(m[1]), kind: 'part' }),
  },
  {
    re: /(?<![\p{L}\p{N}])chapter\s*(\d{1,3})(?![\p{L}\p{N}])/iu,
    read: (m) => ({ season: null, episode: Number(m[1]), kind: 'chapter' }),
  },
  {
    // A leading number with a separator: "02 - Title", "02. Title", "02"
    re: /^(\d{1,3})(?:\s*[-–—.)]\s+|\s*$)/u,
    read: (m) => ({ season: null, episode: Number(m[1]), kind: 'episode' }),
  },
];

function findEpisode(text: string): EpisodeMatch | null {
  for (const { re, read } of EPISODE_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      return { ...read(match), index: match.index, length: match[0].length };
    }
  }
  return null;
}

const cleanPart = (text: string): string | null => {
  const cleaned = trimSeparators(beforeReleaseTags(text).text);
  return cleaned || null;
};

/**
 * Season and episode from a file name, and from its folders when the name
 * has no season ("Season 1/Episode 02.mkv"). Understands S01E02, s1e2,
 * 1x02, "Season 1 Episode 2", E02 / Ep 2 / Episode 2, Part 2, Chapter 2 and
 * a leading "02 - Title". Null when nothing looks like an episode.
 */
export function parseEpisode(
  fileName: string,
  relativePath?: string
): ParsedEpisode | null {
  const { text } = readableBaseName(fileName);
  const found = findEpisode(text);
  if (!found || found.episode < 0) return null;
  const season = found.season ?? seasonFromPath(relativePath);
  const before = text.slice(0, found.index);
  const after = text.slice(found.index + found.length);
  return {
    season,
    episode: found.episode,
    episodeKind: found.kind,
    episodeTitle: cleanPart(after),
    seriesTitle: cleanPart(before.replace(/\b(?:19|20)\d{2}\s*$/, '')),
  };
}

/** Subscreen's label: S01E02, E02, Part 2, Chapter 2 ('' without a number). */
export function episodeLabel(
  season: number | null | undefined,
  episode: number | null | undefined,
  kind?: EpisodeKind
): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  if (season != null && episode != null)
    return `S${pad(season)}E${pad(episode)}`;
  if (episode == null) return '';
  if (kind === 'chapter') return `Chapter ${episode}`;
  if (kind === 'part') return `Part ${episode}`;
  return `E${pad(episode)}`;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** "Episode 2" before "Episode 10". */
export const naturalCompare = (a: string, b: string): number =>
  collator.compare(a, b);

/**
 * Episodes in watching order, as Subscreen sorts them: by season, then
 * episode (unnumbered ones last), then file name.
 */
export function sortEpisodes<
  T extends {
    season?: number | null;
    episode?: number | null;
    fileName: string;
  },
>(episodes: readonly T[]): T[] {
  return [...episodes].sort(
    (a, b) =>
      (a.season ?? 9999) - (b.season ?? 9999) ||
      (a.episode ?? 9999) - (b.episode ?? 9999) ||
      naturalCompare(a.fileName, b.fileName)
  );
}
