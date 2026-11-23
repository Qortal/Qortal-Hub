import { describe, expect, it } from 'vitest';
import { fakeOutput, fakeProbe } from '../../test/mocks/videoTool';
import {
  chosenSubtitles,
  effectiveFields,
  initialFields,
  isClearable,
  looksLikeSeries,
  matchSubtitleToVideo,
  missingFields,
  missingSeriesFields,
  savedFileName,
  shortOutput,
  subtitleFromFile,
  subtitlesFromProbe,
  suggestedSeries,
} from './queueHelpers';
import type { SubtitleChoice } from './videoPublisherTypes';

const source = (name: string, relativePath?: string) => ({
  id: name,
  name,
  size: 1,
  kind: 'video' as const,
  ...(relativePath ? { relativePath } : {}),
});

const track = (
  key: string,
  language: string | null,
  include = true
): SubtitleChoice => ({
  key,
  source: 'stream',
  streamIndex: 2,
  language,
  include,
  picture: false,
});

describe('matchSubtitleToVideo', () => {
  const videos = [
    { id: 'a', name: 'Movie.mkv' },
    { id: 'b', name: 'Movie Part 2.mkv' },
  ];

  it('goes with the video it is named after, the longest name winning', () => {
    expect(matchSubtitleToVideo('Movie.en.srt', videos)).toBe('a');
    expect(matchSubtitleToVideo('Movie Part 2.de.forced.srt', videos)).toBe(
      'b'
    );
    expect(matchSubtitleToVideo('movie.srt', videos)).toBe('a');
  });

  it('is left out when it names no video, unless only one came', () => {
    expect(matchSubtitleToVideo('Other.en.srt', videos)).toBeNull();
    expect(matchSubtitleToVideo('Other.en.srt', [videos[0]])).toBe('a');
    expect(matchSubtitleToVideo('Movies.en.srt', videos)).toBeNull();
  });
});

describe('subtitles', () => {
  it('reads an added file’s language from its name', () => {
    expect(
      subtitleFromFile({
        id: 's',
        name: 'Film.pt-BR.forced.srt',
        size: 1,
        kind: 'subtitle',
      })
    ).toMatchObject({
      language: 'pt',
      include: true,
      forced: true,
      key: 'file:s',
    });
    expect(
      subtitleFromFile({ id: 't', name: 'Film.srt', size: 1, kind: 'subtitle' })
    ).toMatchObject({ language: null, include: false });
  });

  it('ticks the file’s text tracks with a known language, not pictures or forced ones', () => {
    const probe = fakeProbe({
      subtitles: [
        {
          index: 2,
          codec: 'subrip',
          language: 'ger',
          isDefault: false,
          kind: 'text',
          isForced: false,
        },
        {
          index: 3,
          codec: 'subrip',
          language: 'und',
          isDefault: false,
          kind: 'text',
          isForced: false,
        },
        {
          index: 4,
          codec: 'hdmv_pgs_subtitle',
          language: 'eng',
          isDefault: false,
          kind: 'picture',
          isForced: false,
        },
        {
          index: 5,
          codec: 'subrip',
          language: 'eng',
          isDefault: false,
          kind: 'text',
          isForced: true,
        },
        {
          index: 6,
          codec: 'dvb_teletext',
          language: 'ger',
          isDefault: false,
          kind: 'unsupported',
          isForced: false,
        },
      ],
    });
    expect(
      subtitlesFromProbe(probe).map((entry) => [
        entry.language,
        entry.include,
        entry.picture,
      ])
    ).toEqual([
      ['de', true, false],
      [null, false, false],
      ['en', false, true],
      ['en', false, false],
      // Teletext can't be read: never ticked.
      ['de', false, false],
    ]);
    expect(subtitlesFromProbe(probe)[4].unsupported).toBe(true);
    expect(
      chosenSubtitles([{ ...subtitlesFromProbe(probe)[4], include: true }])
    ).toEqual([]);
  });

  it('takes a language’s full track before an SDH one, and that before a forced one', () => {
    const forced = { ...track('forced', 'en'), forced: true };
    const sdh = { ...track('sdh', 'en'), hearingImpaired: true };
    const full = track('full', 'en');
    const german = track('german', 'de');
    expect(
      chosenSubtitles([forced, german, sdh, full]).map((entry) => entry.key)
    ).toEqual(['german', 'full']);
    expect(chosenSubtitles([forced, sdh]).map((entry) => entry.key)).toEqual([
      'sdh',
    ]);
    // A forced track still goes when it is its language's only one.
    expect(chosenSubtitles([forced]).map((entry) => entry.key)).toEqual([
      'forced',
    ]);
    // Of equals, the first.
    expect(
      chosenSubtitles([track('a', 'en'), track('b', 'en')]).map(
        (entry) => entry.key
      )
    ).toEqual(['a']);
  });

  it('sends a subtitle folder’s right tracks in any order', () => {
    // A film's subtitle folder: SDH.eng.HI.srt was read as Hindi and
    // Forced.eng.srt as a full English track, so the order decided.
    const names = [
      'SDH.eng.HI.srt',
      'Forced.eng.srt',
      'hin.srt',
      'English.srt',
    ];
    const file = (name: string) =>
      subtitleFromFile({ id: name, name, size: 1, kind: 'subtitle' });
    for (const order of [names, [...names].reverse()]) {
      expect(
        chosenSubtitles(order.map(file)).map((entry) => [
          entry.language,
          entry.fileName,
        ])
      ).toEqual(
        expect.arrayContaining([
          ['hi', 'hin.srt'],
          ['en', 'English.srt'],
        ])
      );
      expect(chosenSubtitles(order.map(file))).toHaveLength(2);
    }
    expect(file('SDH.eng.HI.srt')).toMatchObject({
      language: 'en',
      include: true,
      hearingImpaired: true,
    });
  });

  it('takes one text track per language', () => {
    expect(
      chosenSubtitles([
        track('a', 'en'),
        track('b', 'en'),
        track('c', 'de', false),
        track('d', null),
        { ...track('e', 'fr'), picture: true },
        track('f', 'es'),
      ]).map((entry) => entry.key)
    ).toEqual(['a', 'f']);
  });
});

describe('fields', () => {
  it('starts from the file name: title, year, episode', () => {
    expect(
      initialFields(source('Star.Runner.1982.1080p.BluRay.x264.mkv'))
    ).toEqual({
      title: 'Star Runner',
      year: 1982,
    });
    expect(
      initialFields(
        source('E05 - The Storm.mkv', 'Show/Season 2/E05 - The Storm.mkv')
      )
    ).toMatchObject({ season: 2, episode: 5, episodeTitle: 'The Storm' });
  });

  it('takes the shared values where the video sets none', () => {
    const fields = effectiveFields(
      { fields: { title: 'A', category: 3 } },
      { category: 99, description: 'All', postText: 'Hi' }
    );
    expect(fields).toMatchObject({
      title: 'A',
      category: 3,
      description: 'All',
      postText: 'Hi',
    });
    expect(
      effectiveFields({ fields: { description: '' } }, { description: 'All' })
        .description
    ).toBe('');
  });

  it('says what each app still needs', () => {
    const item = { fields: { title: 'Clip' }, subtitles: [] };
    expect(missingFields('qtube', item, {})).toEqual(['category']);
    expect(
      missingFields('qtube', item, { category: 4, subcategory: 999 })
    ).toEqual(['subcategory']);
    expect(missingFields('torq', item, { category: 99 })).toEqual([]);
    expect(missingFields('subscreen-film', item, {})).toEqual(['genre']);
    expect(missingFields('subscreen-film', item, { genre: 199 })).toEqual([]);
    expect(
      missingFields('qshare', { fields: { title: 'ççç' }, subtitles: [] }, {})
    ).toEqual(['subcategory']);
    expect(
      missingFields(
        'qshare',
        { fields: { title: '日本' }, subtitles: [] },
        { qshareSubcategory: 404 }
      )
    ).toEqual(['title']);
    expect(missingFields('subscreen-series', item, {})).toEqual([]);
    expect(missingFields('save', { fields: {}, subtitles: [] }, {})).toEqual(
      []
    );
    expect(
      missingFields(
        'qtube',
        { fields: { title: 'x' }, subtitles: [track('a', null)] },
        { category: 99 }
      )
    ).toEqual(['subtitle_language']);
  });

  it('says what a series still needs', () => {
    const series = {
      title: ' ',
      year: null,
      genre: null,
      description: '',
      poster: null,
    };
    expect(missingSeriesFields(series)).toEqual([
      'series_title',
      'series_genre',
    ]);
    expect(
      missingSeriesFields({ ...series, title: 'Show', genre: 299 })
    ).toEqual([]);
  });
});

describe('series', () => {
  it('sees episodes in names that mostly have numbers', () => {
    expect(
      looksLikeSeries([source('Show S01E01.mkv'), source('Show S01E02.mkv')])
    ).toBe(true);
    expect(
      looksLikeSeries([
        source('01 - Intro.mkv'),
        source('02 - Next.mkv'),
        source('Bonus.mkv'),
      ])
    ).toBe(true);
    expect(looksLikeSeries([source('Holiday.mov'), source('Beach.mov')])).toBe(
      false
    );
    expect(looksLikeSeries([source('Show S01E01.mkv')])).toBe(false);
  });

  it('suggests the show’s name, else the folder’s', () => {
    expect(suggestedSeries([source('The.Show.2020.S01E01.mkv')])).toEqual({
      title: 'The Show',
      year: 2020,
    });
    expect(
      suggestedSeries([source('E01.mkv', 'My Series (2019)/E01.mkv')])
    ).toEqual({
      title: 'My Series',
      year: 2019,
    });
    expect(suggestedSeries([source('E01.mkv')])).toEqual({});
  });
});

describe('shortOutput', () => {
  const item = (originalSec: number, convertedSec: number) => ({
    probe: fakeProbe({ durationSec: originalSec }),
    output: fakeOutput({ durationSec: convertedSec }),
  });

  it('finds a converted video shorter by more than 5 s or 3 %', () => {
    // Two hours: 3 % is 216 s.
    expect(shortOutput(item(7200, 7000))).toBeNull();
    expect(shortOutput(item(7200, 6900))).toEqual({
      convertedSec: 6900,
      originalSec: 7200,
    });
    // A minute: 5 s, not 3 % (1.8 s).
    expect(shortOutput(item(60, 56))).toBeNull();
    expect(shortOutput(item(60, 54))).not.toBeNull();
  });

  it("says nothing when a length isn't known", () => {
    expect(shortOutput(item(0, 10))).toBeNull();
    expect(shortOutput({ probe: fakeProbe(), output: undefined })).toBeNull();
  });
});

describe('isClearable', () => {
  it('takes off what is over, but not a cancelled video Retry would publish', () => {
    expect(isClearable({ phase: 'done' })).toBe(true);
    expect(isClearable({ phase: 'discarded' })).toBe(true);
    expect(isClearable({ phase: 'unusable' })).toBe(true);
    expect(isClearable({ phase: 'cancelled' })).toBe(true);
    expect(
      isClearable({
        phase: 'cancelled',
        jobId: 'job-1',
        output: fakeOutput(),
      })
    ).toBe(false);
    expect(isClearable({ phase: 'failed' })).toBe(false);
    expect(isClearable({ phase: 'ready' })).toBe(false);
  });
});

it('saves a video under its own name, as an MP4', () => {
  expect(savedFileName('Holiday 2024.MOV')).toBe('Holiday 2024.mp4');
  expect(savedFileName('.mkv')).toBe('video.mp4');
});
