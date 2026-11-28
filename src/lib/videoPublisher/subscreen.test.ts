import { describe, expect, it } from 'vitest';
import records from './__fixtures__/real-records.json';
import {
  convertedVideo,
  COVER,
  FRAMES,
  stepJson,
  last,
} from './__fixtures__/testData';
import {
  buildSubscreenEpisode,
  buildSubscreenFilm,
  buildSubscreenPlaylist,
  buildSubscreenSeries,
  isListedInSubscreen,
  subscreenEpisodeTitle,
  subscreenQuality,
  type SubscreenSeriesInfo,
} from './subscreen';

const film = records.subscreenFilmMetadata;

describe('subscreenQuality', () => {
  // Subscreen's rule since 2026-11-16: the largest 16:9 frame a video fills
  // on either side, so widescreen films are no longer a step low.
  it.each([
    [1920, 1080, 1080],
    [1920, 800, 1080],
    [1920, 804, 1080],
    [1916, 800, 1080],
    [1620, 1080, 1080],
    [1440, 1080, 1080],
    [1280, 720, 720],
    [1280, 536, 720],
    [960, 720, 720],
    [960, 540, 480],
    [720, 576, 480],
    [854, 480, 480],
    [640, 360, 360],
    [426, 240, 360],
    [1080, 1920, 1080],
    [720, 1280, 720],
    [3840, 2160, 2160],
    [3840, 1600, 2160],
  ])('%i×%i → %i', (width, height, quality) => {
    expect(subscreenQuality(width, height)).toBe(quality);
  });

  it('gives nothing for tiny or unknown sizes', () => {
    expect(subscreenQuality(320, 180)).toBeUndefined();
    expect(subscreenQuality(1920, 0)).toBeUndefined();
    expect(subscreenQuality(0, 0)).toBeUndefined();
  });
});

describe('buildSubscreenFilm', () => {
  const build = (overrides = {}) =>
    buildSubscreenFilm({
      name: 'Publisher',
      title: film.title,
      description: film.fullDescription,
      genre: film.subcategory,
      year: film.year,
      cover: COVER,
      extracts: FRAMES,
      video: convertedVideo(),
      ...overrides,
    });

  it('matches a film Subscreen published: keys, order and values', async () => {
    const plan = await build();
    const metadata = stepJson(last(plan.steps));
    expect(Object.keys(metadata)).toEqual(Object.keys(film));
    expect(metadata).toMatchObject({
      title: film.title,
      fullDescription: film.fullDescription,
      htmlDescription: film.htmlDescription,
      category: 1,
      subcategory: 105,
      year: 1981,
      filename: film.filename,
      quality: film.quality,
      fileSize: film.fileSize,
      duration: film.duration,
    });
    expect(last(plan.steps).title).toBe(
      records.subscreenFilmDocument.metadata.title
    );
    expect(last(plan.steps).description).toBe(
      `**category:1;subcategory:105;code:${plan.code}**${film.fullDescription}`
    );
  });

  it('keeps the whole description in fullDescription, as Subscreen does', async () => {
    const description = 'word '.repeat(60).trim();
    const plan = await build({ description });
    expect(stepJson(last(plan.steps)).fullDescription).toBe(description);
  });

  it('leaves the year out when there is none or it is not a year', async () => {
    for (const year of [null, 0, 12, 3000]) {
      const metadata = stepJson(last((await build({ year })).steps));
      expect('year' in metadata).toBe(false);
    }
  });

  it('links to the film in Subscreen', async () => {
    const plan = await build();
    expect(plan.record.app).toBe('subscreen');
    expect(plan.record.link).toBe(
      `qortal://APP/Subscreen/title/DOCUMENT/Publisher/${plan.metadataIdentifier}`
    );
    expect(plan.record.open.path).toBe(
      `title/DOCUMENT/Publisher/${plan.metadataIdentifier}`
    );
  });

  it('refuses a genre that is not a film genre', async () => {
    await expect(build({ genre: 201 })).rejects.toMatchObject({
      code: 'category-required',
    });
    await expect(build({ genre: 116 })).rejects.toMatchObject({
      code: 'category-required',
    });
  });

  it('says when Subscreen would leave a video out', () => {
    expect(isListedInSubscreen(599)).toBe(false);
    expect(isListedInSubscreen(600)).toBe(true);
  });
});

describe('series', () => {
  const playlistFixture = records.subscreenPlaylist;
  const series: SubscreenSeriesInfo = {
    name: 'Publisher',
    title: playlistFixture.title,
    description: playlistFixture.description,
    genre: 201,
    year: 1981,
    poster: COVER,
  };

  it('titles episodes as Subscreen does', () => {
    expect(
      subscreenEpisodeTitle({ season: 1, episode: 1 }, 0, 'Long Siege')
    ).toBe('Long Siege S01E01');
    expect(subscreenEpisodeTitle({ title: 'Pilot' }, 0, 'Long Siege')).toBe(
      'Pilot'
    );
    expect(subscreenEpisodeTitle({}, 2, 'Long Siege')).toBe(
      'Long Siege — Episode 3'
    );
  });

  it('builds every episode like a real Long Siege episode', async () => {
    const episode = await buildSubscreenEpisode(
      series,
      { season: 1, episode: 1, video: convertedVideo({ durationSec: 5723.9 }) },
      0
    );
    const metadata = stepJson(last(episode.steps));
    expect(Object.keys(metadata)).toEqual(
      Object.keys(records.subscreenEpisodeMetadata)
    );
    expect(metadata).toMatchObject({
      title: 'Long Siege S01E01',
      category: 2,
      subcategory: 201,
      filename: 'LongSiegeS01E01.mp4',
      quality: 480,
      videoImage: COVER,
      fullDescription: records.subscreenEpisodeMetadata.fullDescription,
    });
    expect(episode.videoIdentifier).toMatch(
      /^qtube_vid_long-siege-s01e01_[A-Za-z0-9]{6}$/
    );
  });

  it('lists the episodes in a playlist like the real Long Siege one', async () => {
    const plan = await buildSubscreenSeries({
      ...series,
      key: 's',
      episodes: [
        { season: 1, episode: 1, video: convertedVideo() },
        { season: 1, episode: 2, video: convertedVideo() },
      ],
    });
    const playlist = stepJson(plan.playlist.step);
    expect(Object.keys(playlist)).toEqual(Object.keys(playlistFixture));
    expect(Object.keys(playlist.videos[0])).toEqual(
      Object.keys(playlistFixture.videos[0])
    );
    expect(playlist.videos[1]).toEqual({
      name: 'Publisher',
      identifier: plan.episodes[1].metadataIdentifier,
      service: 'DOCUMENT',
      code: plan.episodes[1].code,
      season: 1,
      episode: 2,
      episodeKind: 'episode',
      episodeTitle: 'Long Siege S01E02',
      label: 'Long Siege S01E02',
      order: 1,
      duration: 5118.780333,
      quality: 480,
    });
    expect(playlist).toMatchObject({
      title: 'Long Siege',
      description: playlistFixture.description,
      htmlDescription: playlistFixture.htmlDescription,
      image: COVER,
      category: 2,
      subcategory: 201,
      year: 1981,
    });
    expect(plan.playlist.identifier).toMatch(
      /^qtube_playlist_long-siege_[A-Za-z0-9]{6}$/
    );
    expect(playlist.commentsId).toBe(
      `qtube_playlist__cm_${plan.playlist.identifier.slice(-6)}`
    );
    expect(plan.playlist.step).toMatchObject({
      service: 'PLAYLIST',
      filename: 'playlist.json',
      tag1: 'qtube_vid_',
      title: 'Long Siege',
      description: `**category:2;subcategory:201;c:${plan.episodes[0].code};c:${plan.episodes[1].code};**${playlistFixture.description.slice(0, 120)}`,
      dependsOn: plan.episodes.map((e) => e.metadataStepKey),
    });
  });

  it('publishes each episode, then the playlist last', async () => {
    const plan = await buildSubscreenSeries({
      ...series,
      key: 's',
      episodes: [
        { season: 1, episode: 1, video: convertedVideo() },
        { season: 1, episode: 2, video: convertedVideo() },
      ],
    });
    expect(plan.steps.map((s) => s.key)).toEqual([
      's:episode-0:video',
      's:episode-0:metadata',
      's:episode-1:video',
      's:episode-1:metadata',
      's:playlist',
    ]);
    expect(plan.record.link).toBe(
      `qortal://APP/Subscreen/title/PLAYLIST/Publisher/${plan.playlist.identifier}`
    );
    expect(last(plan.record.resources)).toMatchObject({
      service: 'PLAYLIST',
      kind: 'playlist',
    });
  });

  it('rebuilds the same playlist with the episodes that went through', async () => {
    const episodes = await Promise.all(
      [1, 2, 3].map((n) =>
        buildSubscreenEpisode(
          series,
          { key: `e${n}`, season: 1, episode: n, video: convertedVideo() },
          n - 1
        )
      )
    );
    const first = buildSubscreenPlaylist({ series, episodes });
    const again = buildSubscreenPlaylist({
      series,
      episodes: [episodes[0], episodes[2]],
      identifier: first.identifier,
    });
    expect(again.identifier).toBe(first.identifier);
    expect(again.playlist.commentsId).toBe(first.playlist.commentsId);
    expect(again.playlist.videos.map((v) => v.episode)).toEqual([1, 3]);
    expect(again.step.dependsOn).toEqual(['e1:metadata', 'e3:metadata']);
  });

  it('uses the first episode cover when the series has no poster', async () => {
    const plan = await buildSubscreenSeries({
      ...series,
      poster: null,
      episodes: [{ episode: 4, video: convertedVideo(), extracts: FRAMES }],
    });
    expect(stepJson(plan.playlist.step).image).toBe(FRAMES[0]);
    const entry = stepJson(plan.playlist.step).videos[0];
    expect(entry.season).toBeUndefined();
    expect(entry.episodeKind).toBe('episode');
    expect(entry.episodeTitle).toBe('Long Siege E04');
  });

  it('refuses a series without episodes or with a film genre', async () => {
    await expect(
      buildSubscreenSeries({ ...series, episodes: [] })
    ).rejects.toMatchObject({ code: 'episodes-required' });
    await expect(
      buildSubscreenSeries({
        ...series,
        genre: 101,
        episodes: [{ video: convertedVideo() }],
      })
    ).rejects.toMatchObject({ code: 'category-required' });
    await expect(
      buildSubscreenSeries({
        ...series,
        poster: null,
        episodes: [{ video: convertedVideo() }],
      })
    ).rejects.toMatchObject({ code: 'cover-required' });
  });
});
