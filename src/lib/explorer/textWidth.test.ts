import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOTTOM_ROW_MARGIN } from './circle';
import { textWidth, wrapRows } from './textWidth';

// How wide the circle's amounts are drawn, estimated never narrower than
// Hub draws them. The real widths below are as Hub's Chromium (Electron 44)
// draws them at 12 px, the size the circle draws its amounts at, in CSS px:
// in Inter Medium (src/styles/fonts/Inter-Medium.ttf), and for what Inter
// lacks in the Noto fonts Linux falls back to, the widest of Hub's zooms
// from 25 % to 470 %. Inter's own widths and an emoji font's are also read
// from the fonts themselves (their cmap and hmtx tables).

/** Chromium places each glyph on 1/64 of a device pixel: up to this much (px) at Hub's smallest zoom (25 %). */
const ROUNDING = 1 / 64 / 0.25;

const REAL_AT_12 = [
  ['88 QORT in, 13,277 out', 132.25],
  ['88 QORT empfangen, 13.277 gesendet', 222.25],
  ['983 BHC Coin in, 10,000 out', 162.41],
  ['получено 88 QORT, отправлено 13 277', 228.72],
  ['Wm@WMW', 67.82],
  ['QORT', 34],
  ['327 QORT in, 530 out', 123.97],
  ['980 QORT in, 30 out', 117.47],
  ['14 Abcdefghij in', 92.1],
] as const;
/** Made up of the pairs Inter sets wider than their two letters ("_j", "YT", "LA", "Gi", "rt", "77", ...). */
const KERNED_AT_12 = [
  ['_j_j_j_j', 40.1],
  ['YT_m_n_p', 59.29],
  ['LAYTGiKi', 54.69],
  ['777 rvrxry', 59.16],
  ['Art_jam 77 rt', 74.91],
] as const;

/** A font's advance widths (em) by code point, from its cmap (format 12) and hmtx tables. */
function fontAdvances(path: string): Map<number, number> {
  const data = readFileSync(path);
  const u16 = (o: number) => data.readUInt16BE(o);
  const u32 = (o: number) => data.readUInt32BE(o);
  const tables = new Map<string, number>();
  for (let i = 0; i < u16(4); i++)
    tables.set(
      data.toString('latin1', 12 + 16 * i, 16 + 16 * i),
      u32(20 + 16 * i)
    );
  const upm = u16((tables.get('head') as number) + 18);
  const longMetrics = u16((tables.get('hhea') as number) + 34);
  const hmtx = tables.get('hmtx') as number;
  const cmap = tables.get('cmap') as number;
  const advances = new Map<number, number>();
  for (let i = 0; i < u16(cmap + 2); i++) {
    const sub = cmap + u32(cmap + 8 + 8 * i);
    if (u16(sub) !== 12) continue;
    for (let g = 0; g < u32(sub + 12); g++) {
      const at = sub + 16 + 12 * g;
      for (let code = u32(at); code <= u32(at + 4); code++) {
        const glyph = u32(at + 8) + code - u32(at);
        advances.set(
          code,
          u16(hmtx + 4 * Math.min(glyph, longMetrics - 1)) / upm
        );
      }
    }
  }
  return advances;
}

const INTER = fontAdvances(
  resolve(process.cwd(), 'src/styles/fonts/Inter-Medium.ttf')
);
/** The colour emoji font Chromium falls back to on Linux, where it is installed. */
const EMOJI_FONT = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf';

describe('textWidth', () => {
  it('is never narrower than Hub draws a line, at any of its zooms, and close to it in ASCII', () => {
    for (const [text, real] of REAL_AT_12) {
      const estimate = textWidth(text, 12);
      expect(estimate, text).toBeGreaterThanOrEqual(real);
      // ASCII is read from the font itself: off by its rounding, and by
      // kerning that narrows a pair, only.
      if (/^[\x20-\x7e]*$/.test(text))
        expect(estimate - real, text).toBeLessThan(0.25 * text.length);
    }
  });

  it('counts every character Inter Medium has at least as wide as Inter draws it', () => {
    // Њ, Љ, Ǳ, Ǌ, Ѹ, №, ①, ‰, ⟺, the squared letters, ...: all of them.
    let checked = 0;
    for (const [code, advance] of INTER) {
      if (code < 0x20) continue;
      const char = String.fromCodePoint(code);
      expect(
        textWidth(char, 12),
        `U+${code.toString(16)}: drawn ${12 * advance} px`
      ).toBeGreaterThanOrEqual(12 * advance + (advance > 0 ? ROUNDING : 0));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2400);
  });

  it('counts an emoji in a Q-Asset’s name as wide as Hub draws it', () => {
    // Noto Color Emoji (Linux): 2550 of 2048 units an em, all of its emoji.
    const emoji = existsSync(EMOJI_FONT)
      ? fontAdvances(EMOJI_FONT)
      : new Map(
          ['💦', '🚀', '🎉', '🇩', '🧑', '🏽', '⚡', '❤'].map((char) => [
            char.codePointAt(0) as number,
            2550 / 2048,
          ])
        );
    for (const [code, advance] of emoji) {
      // What Inter has is drawn by Inter (digits, ©, ...), and a character
      // drawn as text unless an emoji variation selector follows (〰, ❤, ...)
      // by a text font: only those drawn as emoji by themselves.
      const char = String.fromCodePoint(code);
      if (INTER.has(code) || !/\p{Emoji_Presentation}/u.test(char)) continue;
      expect(
        textWidth(char, 12),
        `U+${code.toString(16)}`
      ).toBeGreaterThanOrEqual(12 * advance + ROUNDING);
    }
    expect(textWidth('💦', 12)).toBeGreaterThanOrEqual(
      (12 * 2550) / 2048 + ROUNDING
    );
  });

  it('counts the characters Inter lacks as wide as Hub draws them, those far wider than an em too', () => {
    // As Hub's Chromium draws them at 100 %, in the Noto fonts Linux falls
    // back to (em): at 25 % up to 1/64 px wider, and 1/64 of a device px more.
    for (const [code, real] of [
      [0xfdfd, 7.22], // the Bismillah ligature
      [0x2e3b, 2.841], // the three-em dash
      [0x1242b, 4.638], // a cuneiform numeric sign
      [0x0bcc, 2.534], // a Tamil vowel sign
      [0x102a, 2.453], // a Myanmar letter
      [0x0604, 2.108], // an Arabic number sign
      [0x11310, 2.768], // a Grantha letter
      [0x0d78, 2.178], // a Malayalam fraction
      [0xa9c3, 2.013], // Javanese punctuation
      [0x1f747, 1.466], // an alchemical symbol
      [0x0628, 1.117], // Arabic beh, in its joined forms
      [0x0905, 0.764], // Devanagari a
      [0x05d0, 0.629], // Hebrew alef
      [0x0e01, 0.6], // Thai ko kai
      [0xac00, 0.921], // a Hangul syllable
      [0x3164, 0.921], // the Hangul filler, drawn as a blank
      [0x4e00, 1.001], // a CJK ideograph
      [0x3042, 1.001], // hiragana a
      [0x0661, 0.281], // an Arabic-Indic digit
      [0x202f, 0.173], // the narrow no-break space in French numbers
    ] as const)
      expect(
        textWidth(String.fromCodePoint(code), 12),
        `U+${code.toString(16)}`
      ).toBeGreaterThanOrEqual(12 * real + ROUNDING + 1 / 64);
    // A full em, a little over, for CJK; a narrow space as narrow as it is.
    expect(textWidth('受取送金', 12)).toBeCloseTo(4 * 1.03 * 12);
    expect(textWidth('\u202f', 12)).toBeLessThan(3);
  });

  it('draws the character before an emoji variation selector as an emoji', () => {
    // As Hub draws them: an emoji, 1.249 em (1.486 em for a keycap without it).
    for (const [text, real] of [
      ['©\ufe0f', 1.249],
      ['™\ufe0f', 1.249],
      ['❤\ufe0f', 1.249],
      ['1\ufe0f\u20e3', 1.249],
      ['#\ufe0f\u20e3', 1.249],
      ['1\u20e3', 1.486],
    ] as const)
      expect(textWidth(text, 12), JSON.stringify(text)).toBeGreaterThanOrEqual(
        12 * real + ROUNDING
      );
    // No more than an emoji for one already drawn as one.
    expect(textWidth('💦\ufe0f', 12)).toBeCloseTo(textWidth('💦', 12));
  });

  it('adds what kerning adds where Inter sets a pair wider than its two letters', () => {
    for (const [text, real] of KERNED_AT_12)
      expect(textWidth(text, 12), text).toBeGreaterThanOrEqual(real);
    // The most Chromium adds to a pair at any of Hub's zooms (em), rounded up.
    for (const [pair, kern] of [
      ['_j', 0.0972],
      ['YT', 0.0469],
      ['\\,', 0.0408],
      ['i_', 0.0401],
      ['j_', 0.0401],
      ['LA', 0.0391],
      ['Gi', 0.0365],
      ['rf', 0.0326],
      ['rt', 0.0323],
      ['77', 0.0201],
      ['ry', 0.0195],
    ] as const)
      expect(
        textWidth(pair, 12) - textWidth(pair[0], 12) - textWidth(pair[1], 12),
        pair
      ).toBeGreaterThanOrEqual(12 * kern);
    // An isolate between them keeps them apart: no kerning across it.
    expect(textWidth('_\u2068j', 12)).toBeCloseTo(
      textWidth('_', 12) + textWidth('j', 12)
    );
  });

  it('never narrower than Hub draws a character at any of its zooms, down to 25 %', () => {
    // At 25 % Chromium's 1/64 of a device pixel is the most a CSS px of text
    // grows: "0" is drawn 7.8125 px wide there, 7.75 px at 100 %.
    for (const [char, real] of [
      ['0', 7.8125],
      ['6', 7.6875],
      ['9', 7.6875],
      ['b', 7.5625],
      ['d', 7.5625],
      ['"', 4.82],
      ['5', 7.47],
      ['A', 8.41],
      ['_', 5.54],
      ['a', 6.85],
      ['W', 11.75],
    ] as const)
      expect(textWidth(char, 12), char).toBeGreaterThanOrEqual(real);
  });

  it('grows with the font size: CSS px at any zoom', () => {
    expect(textWidth('QORT', 24)).toBeCloseTo(2 * textWidth('QORT', 12));
  });

  it('takes nothing for an isolate', () => {
    expect(textWidth('\u2068QORT\u2069', 12)).toBeCloseTo(
      textWidth('QORT', 12)
    );
  });
});

describe('wrapRows', () => {
  it('one row where the line fits, more as the room narrows', () => {
    const line = '88 QORT in, 13,277 out';
    expect(wrapRows(line, 220, 12)).toBe(1);
    expect(wrapRows(line, 124, 12)).toBe(2);
    expect(wrapRows(line, 60, 12)).toBeGreaterThan(2);
  });

  it('never fewer rows than the words take, a word longer than the room broken', () => {
    // Each word alone fills a row.
    expect(wrapRows('8888888 9999999', 60, 12)).toBe(2);
    // One word three rooms wide: broken over at least three rows.
    const word = '1234567890123456';
    const rows = wrapRows(word, textWidth(word, 12) / 3, 12);
    expect(rows).toBeGreaterThanOrEqual(3);
    expect(wrapRows('', 100, 12)).toBe(1);
  });

  it('a word of characters each wider than half the room: one a row, as the page breaks it', () => {
    // The three-em dash is drawn 34.1 px wide: two don't fit in 67 px.
    expect(wrapRows('\u2e3b\u2e3b\u2e3b', 67, 12)).toBe(3);
    // One wider than the room has a row to itself.
    expect(wrapRows('\ufdfd\ufdfd', 60, 12)).toBe(2);
  });

  it('a bottom avatar’s amounts in an emoji-named Q-Asset: as many rows as the page wraps it into', () => {
    // "100 💦 in" is drawn 52.67 px wide (Inter, and Noto Color Emoji for
    // the emoji): in a name 52 px wide it wraps at its last space.
    expect(textWidth('100 💦 in', 12)).toBeGreaterThanOrEqual(52.67);
    expect(wrapRows('100 💦 in', 52 - BOTTOM_ROW_MARGIN, 12)).toBe(2);
  });
});
