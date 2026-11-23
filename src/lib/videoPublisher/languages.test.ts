import { describe, expect, it } from 'vitest';
import {
  languageFromFileName,
  languageName,
  normalizeLanguage,
  SUBTITLE_LANGUAGE_CODES,
} from './languages';

describe('normalizeLanguage', () => {
  it.each([
    ['en', 'en'],
    ['eng', 'en'],
    ['English', 'en'],
    ['ger', 'de'],
    ['deu', 'de'],
    ['fre', 'fr'],
    ['fra', 'fr'],
    ['chi', 'zh'],
    ['zho', 'zh'],
    ['cze', 'cs'],
    ['dut', 'nl'],
    ['gre', 'el'],
    ['per', 'fa'],
    ['rum', 'ro'],
    ['scc', 'sr'],
    ['iw', 'he'],
    ['pt-BR', 'pt'],
    ['zh_Hant', 'zh'],
    [' SPA ', 'es'],
  ])('%s → %s', (tag, code) => {
    expect(normalizeLanguage(tag)).toBe(code);
  });

  it('gives null for unknown or undetermined tags', () => {
    expect(normalizeLanguage('und')).toBeNull();
    expect(normalizeLanguage('xyz')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });

  it('covers the common languages with two-letter codes', () => {
    expect(SUBTITLE_LANGUAGE_CODES.length).toBeGreaterThanOrEqual(60);
    for (const code of SUBTITLE_LANGUAGE_CODES) {
      expect(code).toMatch(/^[a-z]{2}$/);
      expect(normalizeLanguage(code)).toBe(code);
    }
  });
});

describe('languageFromFileName', () => {
  it.each([
    ['movie.en.srt', 'en'],
    ['movie.eng.srt', 'en'],
    ['movie.English.srt', 'en'],
    ['Movie Name.ger.ass', 'de'],
    ['movie_es.vtt', 'es'],
    ['Moon Base 2012 Directors Cut.en.srt', 'en'],
    ['Film.2012.1080p.BluRay.x264.swe.srt', 'sv'],
    ['English.srt', 'en'],
    ['movie.hi.srt', 'hi'],
  ])('%s → %s', (name, code) => {
    expect(languageFromFileName(name).language).toBe(code);
  });

  it('reads forced and SDH flags', () => {
    expect(languageFromFileName('movie.pt-BR.forced.srt')).toEqual({
      language: 'pt',
      forced: true,
      hearingImpaired: false,
    });
    expect(languageFromFileName('movie.en.sdh.srt').hearingImpaired).toBe(true);
  });

  // Subtitle folders name files by their tags only (Forced.eng.srt), and
  // "hi" beside another language means "hearing impaired" (Bazarr's
  // movie.en.hi.srt), not Hindi.
  it.each([
    ['SDH.eng.HI.srt', 'en', false, true],
    ['Forced.eng.srt', 'en', true, false],
    ['en.forced.srt', 'en', true, false],
    ['movie.en.hi.srt', 'en', false, true],
    ['Movie.2020.HI.ENG.srt', 'en', false, true],
    ['SDH.hin.srt', 'hi', false, true],
    ['hin.srt', 'hi', false, false],
    ['Movie.HI.srt', 'hi', false, false],
    ['Simplified.chi.srt', 'zh', false, false],
    ['2_English.srt', 'en', false, false],
  ])('%s → %s, forced %s, hearing impaired %s', (name, code, forced, sdh) => {
    expect(languageFromFileName(name)).toEqual({
      language: code,
      forced,
      hearingImpaired: sdh,
    });
  });

  it('reads tags only from the end, not words of the title', () => {
    expect(languageFromFileName('Forced.Entry.2020.en.srt')).toEqual({
      language: 'en',
      forced: false,
      hearingImpaired: false,
    });
    expect(languageFromFileName('Hi.Mom.2021.fr.srt')).toEqual({
      language: 'fr',
      forced: false,
      hearingImpaired: false,
    });
  });

  it('does not read words of the title as languages', () => {
    expect(languageFromFileName('Lost in Translation.srt').language).toBeNull();
    expect(languageFromFileName('This Is It.srt').language).toBeNull();
    expect(languageFromFileName('Film.2012.1080p.srt').language).toBeNull();
  });
});

describe('languageName', () => {
  it('names a language in the asked locale', () => {
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('de', 'de')).toBe('Deutsch');
  });

  it('falls back to the code', () => {
    expect(languageName('de', 'not a locale!')).toBe('de');
  });
});
