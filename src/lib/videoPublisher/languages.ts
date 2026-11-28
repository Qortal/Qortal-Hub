/**
 * Subtitle languages. The players (qapp-core's) list a subtitle under its
 * ISO 639-1 code, the record's QDN title, while video files and subtitle
 * file names use ISO 639-2 (eng, ger/deu), 639-3, or English names.
 */

/**
 * ISO 639-1 → its ISO 639-2/B, 639-2/T and other three-letter codes, and
 * English names, for the languages subtitles come in most often.
 */
const LANGUAGES: Record<string, string[]> = {
  af: ['afr', 'afrikaans'],
  am: ['amh', 'amharic'],
  ar: ['ara', 'arabic'],
  az: ['aze', 'azerbaijani'],
  be: ['bel', 'belarusian'],
  bg: ['bul', 'bulgarian'],
  bn: ['ben', 'bengali', 'bangla'],
  bs: ['bos', 'bosnian'],
  ca: ['cat', 'catalan'],
  cs: ['cze', 'ces', 'czech'],
  cy: ['wel', 'cym', 'welsh'],
  da: ['dan', 'danish'],
  de: ['ger', 'deu', 'german', 'deutsch'],
  el: ['gre', 'ell', 'greek'],
  en: ['eng', 'english'],
  eo: ['epo', 'esperanto'],
  es: ['spa', 'spanish', 'espanol', 'español', 'castellano'],
  et: ['est', 'estonian'],
  eu: ['baq', 'eus', 'basque'],
  fa: ['per', 'fas', 'persian', 'farsi'],
  fi: ['fin', 'finnish', 'suomi'],
  fr: ['fre', 'fra', 'french', 'francais', 'français'],
  ga: ['gle', 'irish'],
  gl: ['glg', 'galician'],
  gu: ['guj', 'gujarati'],
  he: ['heb', 'hebrew', 'iw'],
  hi: ['hin', 'hindi'],
  hr: ['hrv', 'scr', 'croatian'],
  hu: ['hun', 'hungarian', 'magyar'],
  hy: ['arm', 'hye', 'armenian'],
  id: ['ind', 'indonesian', 'in'],
  is: ['ice', 'isl', 'icelandic'],
  it: ['ita', 'italian', 'italiano'],
  ja: ['jpn', 'japanese'],
  ka: ['geo', 'kat', 'georgian'],
  kk: ['kaz', 'kazakh'],
  km: ['khm', 'khmer'],
  kn: ['kan', 'kannada'],
  ko: ['kor', 'korean'],
  ku: ['kur', 'kurdish'],
  lo: ['lao'],
  lt: ['lit', 'lithuanian'],
  lv: ['lav', 'latvian'],
  mk: ['mac', 'mkd', 'macedonian'],
  ml: ['mal', 'malayalam'],
  mn: ['mon', 'mongolian'],
  mr: ['mar', 'marathi'],
  ms: ['may', 'msa', 'malay'],
  mt: ['mlt', 'maltese'],
  my: ['bur', 'mya', 'burmese'],
  nb: ['nob', 'norwegian bokmal', 'bokmal', 'bokmål'],
  ne: ['nep', 'nepali'],
  nl: ['dut', 'nld', 'dutch', 'nederlands', 'flemish'],
  nn: ['nno', 'nynorsk'],
  no: ['nor', 'norwegian', 'norsk'],
  pa: ['pan', 'punjabi'],
  pl: ['pol', 'polish', 'polski'],
  ps: ['pus', 'pashto'],
  pt: ['por', 'portuguese', 'portugues', 'português'],
  ro: ['rum', 'ron', 'romanian', 'mol', 'moldavian'],
  ru: ['rus', 'russian'],
  si: ['sin', 'sinhala', 'sinhalese'],
  sk: ['slo', 'slk', 'slovak'],
  sl: ['slv', 'slovenian', 'slovene'],
  so: ['som', 'somali'],
  sq: ['alb', 'sqi', 'albanian'],
  sr: ['srp', 'scc', 'serbian'],
  sv: ['swe', 'swedish', 'svenska'],
  sw: ['swa', 'swahili'],
  ta: ['tam', 'tamil'],
  te: ['tel', 'telugu'],
  th: ['tha', 'thai'],
  tl: ['tgl', 'tagalog', 'fil', 'filipino'],
  tr: ['tur', 'turkish'],
  uk: ['ukr', 'ukrainian'],
  ur: ['urd', 'urdu'],
  uz: ['uzb', 'uzbek'],
  vi: ['vie', 'vietnamese'],
  yi: ['yid', 'yiddish'],
  zh: [
    'chi',
    'zho',
    'chinese',
    'cmn',
    'mandarin',
    'yue',
    'cantonese',
    'chs',
    'cht',
  ],
  zu: ['zul', 'zulu'],
};

const LOOKUP = new Map<string, string>();
for (const [code, aliases] of Object.entries(LANGUAGES)) {
  LOOKUP.set(code, code);
  for (const alias of aliases) LOOKUP.set(alias, code);
}

/**
 * Tags that say what kind of track it is, not its language. "hi" is left
 * out: alone it is Hindi; beside another language (movie.en.hi.srt,
 * SDH.eng.HI.srt) it means "hearing impaired" (languageFromFileName).
 */
const TRACK_FLAGS = new Set([
  'forced',
  'sdh',
  'cc',
  'default',
  'full',
  'signs',
  'songs',
  'commentary',
]);

/** The ISO 639-1 codes this module knows. */
export const SUBTITLE_LANGUAGE_CODES: readonly string[] =
  Object.keys(LANGUAGES);

/**
 * ISO 639-1 for a language tag: "en", "eng", "ger", "deu", "English",
 * "pt-BR", "zh_Hant". Null when unknown, "und" (undetermined), or empty.
 */
export function normalizeLanguage(
  tag: string | null | undefined
): string | null {
  if (!tag) return null;
  const lower = tag.trim().toLowerCase();
  if (!lower) return null;
  const direct = LOOKUP.get(lower);
  if (direct) return direct;
  // BCP 47 with a region or script: pt-BR, zh-Hant, en_US.
  const primary = lower.split(/[-_]/)[0];
  return LOOKUP.get(primary) ?? null;
}

export type FileNameLanguage = {
  language: string | null;
  forced: boolean;
  hearingImpaired: boolean;
};

/** A part of a file name that describes a subtitle: a flag or a language. */
const isSubtitleTag = (part: string): boolean =>
  TRACK_FLAGS.has(part.toLowerCase()) || normalizeLanguage(part) !== null;

/**
 * The language a subtitle file's name gives: movie.en.srt, movie.eng.srt,
 * movie.English.srt, movie.pt-BR.forced.srt, movie_en.srt, movie.en.hi.srt,
 * and names made only of tags, as subtitle folders have them: English.srt,
 * Forced.eng.srt, SDH.eng.HI.srt.
 */
export function languageFromFileName(fileName: string): FileNameLanguage {
  const base = (fileName.split(/[\\/]/).pop() || '').replace(
    /\.[a-z0-9]{2,4}$/i,
    ''
  );
  // Dots and underscores separate tags; spaces belong to the video's name.
  const parts = base
    .split(/[._]+/)
    .map((part) => part.replace(/^[[(]+|[\])]+$/g, '').trim())
    .filter(Boolean);
  // The tags at the end describe the subtitle and what's before them is the
  // video's own name; a name of tags only describes the subtitle whole.
  let start = parts.length;
  while (start > 0 && isSubtitleTag(parts[start - 1])) start -= 1;
  let forced = false;
  let hearingImpaired = false;
  let named: string | null = null;
  let hindiOrFlag = false;
  for (const tag of parts.slice(start).map((part) => part.toLowerCase())) {
    if (TRACK_FLAGS.has(tag)) {
      if (tag === 'forced') forced = true;
      if (tag === 'sdh' || tag === 'cc') hearingImpaired = true;
    } else if (tag === 'hi') {
      hindiOrFlag = true;
    } else {
      // The last language named wins, as the one right before the extension.
      named = normalizeLanguage(tag);
    }
  }
  // "hi" beside another language is that one's hearing-impaired track.
  if (named && hindiOrFlag) hearingImpaired = true;
  return {
    language: named ?? (hindiOrFlag ? 'hi' : null),
    forced,
    hearingImpaired,
  };
}

/** The language's name in `displayLocale` ("German", "Deutsch"), or the code. */
export function languageName(code: string, displayLocale = 'en'): string {
  try {
    const names = new Intl.DisplayNames([displayLocale], { type: 'language' });
    return names.of(code) || code;
  } catch {
    return code;
  }
}
