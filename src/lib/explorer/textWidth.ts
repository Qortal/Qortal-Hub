/**
 * How wide a line of text is drawn, estimated never narrower than Hub
 * draws it: for the Connections circle, which makes room for the amounts
 * under its bottom avatars before they are drawn (a line that wraps takes
 * a row more, and the room under them follows). At 12 px, the size the
 * circle draws them at, whatever character a Q-Asset's name or Hub's
 * languages bring.
 *
 * Everything is in CSS px, so it holds at any zoom of Hub's page: a zoom
 * changes how many CSS px the window has, never how wide a CSS px of text
 * is, save for Chromium placing each glyph on 1/64 of a device pixel. That
 * is up to 1/192 em at 12 px at Hub's smallest zoom (about 25 %), and each
 * width below has that room.
 *
 * - Printable ASCII: Inter Medium's own advance widths (Hub's font at weight
 *   500, src/styles/fonts/Inter-Medium.ttf) with that room, rounded up to
 *   0.01 em; and what kerning adds where Inter sets a pair wider than its two
 *   letters (WIDER_PAIRS), the most Chromium adds from a 25 % to a 470 %
 *   zoom. Every other pair is set as wide or narrower.
 * - Latin-1 to Cyrillic Supplement (Inter's): 1.03 em, wider than most of
 *   its letters; the ones drawn wider than that less 0.05 em (room for
 *   kerning) at their own width with that room (WIDE_LETTERS).
 * - Everything else by ranges (RANGES): the widest Hub's Chromium draws in
 *   each, with Inter and, for what Inter lacks, the Noto fonts Linux falls
 *   back to (Noto Color Emoji for emoji), measured character by character
 *   (Arabic in its joined forms too), with that room. CJK and Hangul at
 *   1.03 em (an em, with that room), emoji at 1.4 em (Noto's are 1.245 em;
 *   room for other platforms'), and the few drawn far wider (the Bismillah
 *   ligature, cuneiform, the three-em dash) in ranges of their own.
 * - An emoji variation selector (U+FE0F) draws the character before it as
 *   an emoji: that character is counted at least an emoji wide.
 */

/** An emoji (em): Noto Color Emoji draws them 1.245 em wide; room for other platforms' emoji. */
const EMOJI = 1.4;

/** Inter Medium's advance widths (em) for U+0020 to U+007E, as above. */
const ASCII = [
  0.28, 0.3, 0.41, 0.65, 0.65, 0.84, 0.66, 0.23, 0.39, 0.39, 0.53, 0.68, 0.3,
  0.47, 0.29, 0.38, 0.66, 0.48, 0.62, 0.65, 0.66, 0.63, 0.65, 0.59, 0.64, 0.65,
  0.29, 0.3, 0.68, 0.68, 0.68, 0.54, 0.98, 0.71, 0.66, 0.75, 0.73, 0.61, 0.6,
  0.76, 0.75, 0.28, 0.56, 0.67, 0.57, 0.91, 0.76, 0.78, 0.65, 0.78, 0.66, 0.65,
  0.66, 0.75, 0.71, 0.99, 0.68, 0.69, 0.65, 0.39, 0.38, 0.39, 0.49, 0.47, 0.51,
  0.58, 0.64, 0.58, 0.64, 0.6, 0.38, 0.63, 0.61, 0.26, 0.26, 0.57, 0.26, 0.89,
  0.61, 0.61, 0.63, 0.63, 0.39, 0.55, 0.38, 0.6, 0.58, 0.84, 0.56, 0.58, 0.56,
  0.39, 0.35, 0.39, 0.68,
];

/**
 * The ASCII pairs Inter Medium sets wider than their two letters, as
 * Chromium draws them (kerning that adds), and the most each adds (em,
 * rounded up): each string is its pairs, two characters each.
 */
const WIDER_PAIRS: ReadonlyArray<readonly [number, string]> = [
  [0.1, '_j'],
  [0.05, 'YT\\,_m_n_p_ri_j_'],
  [0.04, 'GiGjH_I_KiLAM_N_\\._id_g_i)iViWi\\i]i}j)jVjWj\\j]j}l_q_rfrt|_'],
  [0.03, '(j77[j{j'],
  [0.02, 'rvrxrytBtDtEtFtHtItKtLtMtNtPtRtbthtktlt|'],
  [0.01, '/V/W/\\AiCvCyV\\W\\\\ifYgjkvkyqjrw'],
];
const WIDER = new Map<string, number>(
  WIDER_PAIRS.flatMap(([em, pairs]) =>
    Array.from({ length: pairs.length / 2 }, (_, i): [string, number] => [
      pairs.slice(2 * i, 2 * i + 2),
      em,
    ])
  )
);

/** Latin-1 to Cyrillic Supplement: most of it at this (em). */
const LETTERS = 1.03;

/**
 * Latin-1 to Cyrillic Supplement drawn wider than LETTERS less room for
 * kerning (Inter's digraph and Cyrillic ligature letters, Æ, Œ, Ж, Ш, Ю,
 * Њ, Љ, Ѹ, ..., and the boxes for Greek's unassigned code points): their
 * width (em) with that room, and their code points.
 */
const WIDE_LETTER_GROUPS: ReadonlyArray<readonly [number, readonly number[]]> =
  [
    [1.47, [0x052a]],
    [1.42, [0x01f1]],
    [1.4, [0x0478]],
    [1.36, [0x01ca]],
    [1.35, [0x01c4]],
    [1.34, [0x01c5, 0x01f2]],
    [1.26, [0x046c]],
    [1.23, [0x02a5, 0x052b]],
    [1.21, [0x0479]],
    [1.19, [0x040a]],
    [1.18, [0x01c7, 0x01f6]],
    [1.17, [0x04a6]],
    [1.16, [0x0409]],
    [1.15, [0x0522]],
    [1.14, [0x01c6, 0x01f3, 0x02a3]],
    [1.09, [0x042e]],
    [1.08, [0x050a]],
    [
      1.07,
      [
        0x00c6, 0x01e2, 0x01fc, 0x0378, 0x0379, 0x0380, 0x0381, 0x0382, 0x0383,
        0x038b, 0x038d, 0x03a2, 0x0429, 0x046d, 0x04d4, 0x0520,
      ],
    ],
    [1.06, [0x0416, 0x0496, 0x04a4, 0x04c1, 0x04dc]],
    [1.05, [0x0153, 0x0428, 0x0508]],
    [1.04, [0x0152, 0x0174, 0x01cb]],
  ];
const WIDE_LETTERS = new Map<number, number>(
  WIDE_LETTER_GROUPS.flatMap(([em, codes]) =>
    codes.map((code): [number, number] => [code, em])
  )
);

/**
 * Everything from U+00A0 on: [first code point, em], each range running to
 * the next one's start, at the widest Hub draws in it (as above).
 */
const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00a0, LETTERS], // Latin-1 to Cyrillic Supplement (Inter): WIDE_LETTERS apart
  [0x0530, 1.03], // Armenian, Hebrew
  [0x0600, 2.15], // Arabic number signs, drawn across the digits after them
  [0x0606, 1.4], // Arabic
  [0x0700, 1.5], // Syriac to Mandaic
  [0x08a0, 2.6], // Arabic Extended-A
  [0x0900, 1.2], // Devanagari, Bengali
  [0x0a00, 1.55], // Gurmukhi, Gujarati, Oriya
  [0x0b80, 2.55], // Tamil
  [0x0c00, 1.8], // Telugu, Kannada
  [0x0d00, 2.2], // Malayalam
  [0x0d80, 1.9], // Sinhala
  [0x0e00, 1.03], // Thai
  [0x0e80, 1.65], // Lao, Tibetan
  [0x1000, 2.5], // Myanmar
  [0x10a0, 1.1], // Georgian, Hangul Jamo
  [0x1200, 1.5], // Ethiopic to Tai Le
  [0x1780, 2.0], // Khmer
  [0x1800, 1.85], // Mongolian to Sundanese
  [0x1d00, 1.03], // phonetic letters, combining marks, Latin Extended Additional
  [0x1f00, 1.15], // Greek Extended
  [0x2000, 1.15], // spaces
  [0x200b, 0], // zero-width spaces and joiners, direction marks
  [0x2010, 1.03], // dashes, quotes, dots
  [0x2028, 0.3], // separators, embeddings
  [0x202f, 0.2], // narrow no-break space (French thousands)
  [0x2030, 1.3], // per mille, primes and other punctuation
  [0x205f, 0.3], // a mathematical space
  [0x2060, 0], // word joiner, invisible operators, isolates
  [0x2070, 1.03], // superscripts, subscripts
  [0x20a0, 1.35], // currency
  [0x20d0, 1.8], // marks for symbols: an enclosing one adds what it encloses
  [0x2100, 1.2], // letterlike
  [0x2150, 1.55], // number forms
  [0x2190, 1.4], // arrows, mathematical operators
  [0x2300, 1.75], // technical
  [0x2400, 1.03], // control pictures, OCR
  [0x2460, 1.4], // enclosed alphanumerics
  [0x2500, 0.8], // box drawing, blocks
  [0x25a0, 1.4], // shapes, symbols, dingbats, mathematical symbols
  [0x27f0, 1.8], // long arrows
  [0x2800, 0.75], // Braille
  [0x2900, 1.4], // arrows, mathematical symbols, Glagolitic, Coptic
  [0x2de0, 0], // combining Cyrillic letters
  [0x2e00, 1.05], // supplemental punctuation
  [0x2e3a, 2.85], // the two- and three-em dashes
  [0x2e3c, 1.03], // CJK radicals, CJK punctuation
  [0x302e, 1.3], // Hangul tone marks
  [0x3030, 1.03], // kana, CJK, Hangul compatibility, Yi
  [0xa4d0, 1.4], // Lisu, Vai, Cyrillic Extended-B
  [0xa6a0, 1.03], // Bamum, tone letters
  [0xa700, 1.4], // Latin Extended-D
  [0xa800, 2.05], // Syloti Nagri to Meetei Mayek
  [0xac00, 1.03], // Hangul syllables (a lone surrogate: a replacement box)
  [0xe000, 1.4], // private use
  [0xf900, 1.03], // CJK compatibility ideographs
  [0xfb00, 1.55], // presentation forms: ligatures, Armenian, Hebrew
  [0xfb50, 2.35], // Arabic presentation forms
  [0xfdfd, 7.25], // the Bismillah ligature
  [0xfdfe, 1.03], // Arabic presentation forms
  [0xfe00, 0], // variation selectors (an emoji one: see textWidth)
  [0xfe10, 1.03], // vertical forms
  [0xfe20, 0.01], // combining half marks
  [0xfe30, 1.03], // CJK compatibility and small forms
  [0xfe70, 1.4], // Arabic presentation forms
  [0xff00, 1.03], // halfwidth and fullwidth forms, specials
  [0x10000, 2.8], // historic scripts and symbols
  [0x12000, 4.65], // cuneiform
  [0x12550, 2.2], // historic scripts and symbols
  [0x1f000, EMOJI], // tiles, cards, enclosed letters, emoji
  [0x1f700, 1.5], // alchemical symbols, shapes
  [0x1f800, 1.1], // arrows
  [0x1f850, 2.7], // long arrows
  [0x1f853, 1.1], // arrows
  [0x1f900, EMOJI], // emoji
  [0x1fb00, 1.03], // legacy computing, CJK extensions, unassigned planes
  [0xe0000, 0], // tags
  [0xe0080, 1.03], // unassigned
  [0xe0100, 0], // variation selectors
  [0xe01f0, 1.03], // unassigned, private use
];

/** The range `code` (from U+00A0) is in: its width (em). */
function rangeWidth(code: number): number {
  let low = 0;
  let high = RANGES.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (RANGES[middle][0] <= code) low = middle;
    else high = middle - 1;
  }
  return RANGES[low][1];
}

/** A character's width (em), never less than it is drawn. */
function charWidth(code: number): number {
  if (code >= 0x20 && code <= 0x7e) return ASCII[code - 0x20];
  // Controls: drawn as nothing, a space or a box.
  if (code < 0xa0) return 1.03;
  return WIDE_LETTERS.get(code) ?? rangeWidth(code);
}

/** How wide `text` is drawn at `fontPx` (CSS px), at most this. */
export function textWidth(text: string, fontPx: number): number {
  let em = 0;
  let before = '';
  let beforeEm = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // An emoji variation selector: the character before it drawn as an emoji.
    const width =
      code === 0xfe0f
        ? Math.max(0, EMOJI - beforeEm)
        : charWidth(code) + (WIDER.get(before + char) ?? 0);
    em += width;
    beforeEm = code === 0xfe0f ? Math.max(beforeEm, EMOJI) : width;
    before = char;
  }
  return em * fontPx;
}

/**
 * How many rows `text` takes in a box `room` CSS px wide at `fontPx`,
 * wrapped at its spaces, a word wider than the box broken anywhere (as
 * CSS's overflow-wrap: anywhere does), each of its rows filled character
 * by character: never fewer than it takes.
 */
export function wrapRows(text: string, room: number, fontPx: number): number {
  const words = text.split(' ').filter((word) => word.length > 0);
  if (!words.length) return 1;
  const space = textWidth(' ', fontPx);
  let rows = 1;
  let x = 0;
  for (const word of words) {
    const w = textWidth(word, fontPx);
    if (x > 0 && x + space + w <= room) {
      x += space + w;
      continue;
    }
    if (x > 0) {
      rows += 1;
      x = 0;
    }
    if (w <= room) {
      x = w;
      continue;
    }
    let row = '';
    for (const char of word) {
      if (row && textWidth(row + char, fontPx) > room) {
        rows += 1;
        row = '';
      }
      row += char;
    }
    x = textWidth(row, fontPx);
  }
  return rows;
}
