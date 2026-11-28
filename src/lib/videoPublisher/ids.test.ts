import { describe, expect, it } from 'vitest';
import {
  episodeLabel,
  identifierSlug,
  naturalCompare,
  parseEpisode,
  qdnTitle,
  randomAlphanumeric,
  singleLineTitle,
  sliceText,
  sortEpisodes,
  titleFromFileName,
  videoFileName,
} from './ids';

describe('randomAlphanumeric', () => {
  it('gives the length asked for, letters and digits only', () => {
    for (const length of [5, 6, 8, 15]) {
      expect(randomAlphanumeric(length)).toMatch(
        new RegExp(`^[0-9a-zA-Z]{${length}}$`)
      );
    }
  });

  it('does not repeat itself', () => {
    const ids = new Set(
      Array.from({ length: 200 }, () => randomAlphanumeric(6))
    );
    expect(ids.size).toBe(200);
  });
});

describe('identifierSlug', () => {
  it('cuts titles the way Q-Tube and Subscreen do', () => {
    // As their identifiers on QDN show: 30 characters at most.
    expect(identifierSlug('The Wonder Of The Old Lighthouse Keeper')).toBe(
      'the-wonder-of-the-old-lighthou'
    );
    expect(identifierSlug('Moon Base 2012')).toBe('moon-base-2012');
    expect(identifierSlug('Long Siege S01E01')).toBe('long-siege-s01e01');
    expect(
      identifierSlug('Plain - The long story of a small town — and why')
    ).toBe('plain-the-long-story-of-a-smal');
  });

  it('falls back when a title has no letter or digit', () => {
    expect(identifierSlug('!!! ???')).toBe('video');
    expect(identifierSlug('日本語のタイトル', 'series')).toBe('series');
  });
});

describe('titles', () => {
  it('slices without cutting a surrogate pair', () => {
    const title = `${'a'.repeat(49)}😀 more`;
    expect(sliceText(title, 50)).toBe('a'.repeat(49));
    expect(() => encodeURIComponent(sliceText(title, 50))).not.toThrow();
    expect(sliceText('short', 50)).toBe('short');
  });

  it('keeps titles on one line', () => {
    expect(singleLineTitle(' Line one\r\nline  two\n')).toBe(
      'Line one line two'
    );
    expect(qdnTitle(`${'x'.repeat(60)}`)).toHaveLength(50);
  });

  it('makes Subscreen-style file names', () => {
    expect(videoFileName('The Cabin Film')).toBe('TheCabinFilm.mp4');
    expect(videoFileName('Long Siege S01E01')).toBe('LongSiegeS01E01.mp4');
    expect(videoFileName('Émilie (2001)')).toBe('Emilie2001.mp4');
    expect(videoFileName('日本')).toBe('video.mp4');
    expect(videoFileName('x'.repeat(60))).toBe(`${'x'.repeat(40)}.mp4`);
  });
});

describe('titleFromFileName', () => {
  it.each([
    ['The.Cabin.Film.1981.1080p.BluRay.x264-GROUP.mkv', 'The Cabin Film', 1981],
    ['Moon Base (2012).mp4', 'Moon Base', 2012],
    ['Some_Movie_2019_720p_WEB-DL_AAC.mp4', 'Some Movie', 2019],
    ['Star Runner 2049.mkv', 'Star Runner 2049', undefined],
    ['Holiday video.mov', 'Holiday video', undefined],
    ['[YTS.MX] Film Name 2005 HEVC.mp4', 'Film Name', 2005],
    ['www.site.com - My Film (1999) DVDRip.avi', 'My Film', 1999],
    ['2001.A.Sea.Voyage.1968.REMUX.mkv', '2001 A Sea Voyage', 1968],
    ['VID_20240501_120000.mp4', 'VID 20240501 120000', undefined],
  ])('%s', (name, title, year) => {
    const result = titleFromFileName(name);
    expect(result.title).toBe(title);
    expect(result.year).toBe(year);
  });

  it('never gives an empty title', () => {
    expect(titleFromFileName('1080p.mkv').title).toBe('1080p');
    expect(titleFromFileName('.mp4').title).not.toBe('');
  });
});

describe('parseEpisode', () => {
  it.each([
    ['Show.Name.S01E02.720p.mkv', undefined, 1, 2, 'Show Name', null],
    ['show s1e2 the pilot.mp4', undefined, 1, 2, 'show', 'the pilot'],
    ['Show - 1x02 - Title.avi', undefined, 1, 2, 'Show', 'Title'],
    ['Season 2 Episode 10.mkv', undefined, 2, 10, null, null],
    ['Episode 02.mkv', 'Show/Season 1/Episode 02.mkv', 1, 2, null, null],
    [
      'E05 - The Return.mp4',
      'Show/S03/E05 - The Return.mp4',
      3,
      5,
      null,
      'The Return',
    ],
    ['02 - Title.mp4', undefined, null, 2, null, 'Title'],
    ['Long Siege S01E01.mp4', undefined, 1, 1, 'Long Siege', null],
    ['Show.S01E01E02.mkv', undefined, 1, 1, 'Show', null],
    ['Doc Part 3.mp4', undefined, null, 3, 'Doc', null],
  ])('%s', (name, path, season, episode, seriesTitle, episodeTitle) => {
    const parsed = parseEpisode(name, path);
    expect(parsed).not.toBeNull();
    expect(parsed.season).toBe(season);
    expect(parsed.episode).toBe(episode);
    expect(parsed.seriesTitle).toBe(seriesTitle);
    expect(parsed.episodeTitle).toBe(episodeTitle);
  });

  it('reads Part and Chapter as their own kinds', () => {
    expect(parseEpisode('Doc Part 3.mp4').episodeKind).toBe('part');
    expect(parseEpisode('Book Chapter 7.mp4').episodeKind).toBe('chapter');
    expect(parseEpisode('Show S01E01.mp4').episodeKind).toBe('episode');
  });

  it('does not take resolutions, years or plain titles for episodes', () => {
    expect(parseEpisode('Holiday 1920x1080.mp4')).toBeNull();
    expect(parseEpisode('Star Runner 2049.mkv')).toBeNull();
    expect(parseEpisode('2001 A Sea Voyage.mkv')).toBeNull();
    expect(parseEpisode('My cat video.mp4')).toBeNull();
    expect(parseEpisode('Movie.2012.1080p.x265.HEVC.mkv')).toBeNull();
  });
});

describe('episodes', () => {
  it('labels them as Subscreen does', () => {
    expect(episodeLabel(1, 2)).toBe('S01E02');
    expect(episodeLabel(null, 7)).toBe('E07');
    expect(episodeLabel(null, 3, 'part')).toBe('Part 3');
    expect(episodeLabel(null, 3, 'chapter')).toBe('Chapter 3');
    expect(episodeLabel(1, null)).toBe('');
  });

  it('sorts naturally, by season and episode first', () => {
    expect(['E10.mp4', 'E2.mp4', 'E1.mp4'].sort(naturalCompare)).toEqual([
      'E1.mp4',
      'E2.mp4',
      'E10.mp4',
    ]);
    const sorted = sortEpisodes([
      { fileName: 'b', season: 2, episode: 1 },
      { fileName: 'extra' },
      { fileName: 'a', season: 1, episode: 10 },
      { fileName: 'c', season: 1, episode: 2 },
    ]);
    expect(sorted.map((e) => e.fileName)).toEqual(['c', 'a', 'b', 'extra']);
  });
});
