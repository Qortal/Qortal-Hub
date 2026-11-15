import { describe, expect, it, vi } from 'vitest';
import {
  QortinoMediaLinkError,
  parseQortinoMediaLink,
  qortinoMediaUrl,
  resolveQortinoMediaLink,
  sanitizeQortinoMediaItem,
  stepQortinoMediaItem,
} from './qortinoMediaLinks';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

/** A video's details as Q-Tube publishes them (trimmed). */
const QTUBE_DETAILS = {
  title: 'Gold vs. treasuries',
  videoImage: 'data:image/jpeg;base64,/9j/4AAQ',
  videoReference: {
    identifier: 'qtube_vid_gold_bcura2',
    name: 'BigPicture',
    service: 'VIDEO',
  },
  videoType: 'video/mp4',
  duration: 3626,
};

/** A share's details as Q-Share publishes them (trimmed). */
const QSHARE_DETAILS = {
  title: 'Through the Bible - John 1',
  files: [
    {
      filename: 'cover.jpg',
      identifier: 'qshare_file_cover',
      mimetype: 'image/jpeg',
      name: 'PixelMage',
      service: 'FILE',
    },
    {
      filename: 'john.mp3',
      identifier: 'qshare_file_john_5lDFHX',
      mimetype: 'audio/mpeg',
      name: 'PixelMage',
      service: 'FILE',
    },
  ],
  thumbnail: {
    identifier: 'qshare_thumb_john',
    name: 'PixelMage',
    service: 'THUMBNAIL',
  },
};

/** QDN as a map of URLs; anything else is not found. */
const qdn =
  (documents: Record<string, unknown>) =>
  async (url: string): Promise<unknown> => {
    if (url in documents) return documents[url];
    throw new Error(`404 ${url}`);
  };

const problemOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof QortinoMediaLinkError ? error.problem : 'other';
  }
};

describe('parseQortinoMediaLink', () => {
  it('reads Q-Tube, Q-Share and Subscreen links, in any case', () => {
    expect(
      parseQortinoMediaLink(
        'qortal://APP/Q-Tube/video/BigPicture/qtube_vid_gold'
      )
    ).toEqual({
      app: 'Q-Tube',
      episode: 0,
      identifiers: ['qtube_vid_gold', 'qtube_vid_gold_metadata'],
      kind: 'document',
      name: 'BigPicture',
    });
    expect(
      parseQortinoMediaLink(
        ' qortal://app/q-share/share/Pixel%20Mage/qshare_file_john_metadata '
      )
    ).toEqual({
      app: 'Q-Share',
      episode: 0,
      identifiers: ['qshare_file_john_metadata'],
      kind: 'document',
      name: 'Pixel Mage',
    });
    expect(
      parseQortinoMediaLink(
        'qortal://APP/Subscreen/watch/DOCUMENT/Studio/show_metadata?episode=2'
      )
    ).toMatchObject({
      app: 'Subscreen',
      episode: 2,
      identifiers: ['show_metadata'],
    });
    expect(
      parseQortinoMediaLink('qortal://APP/Subscreen/title/VIDEO/Studio/movie_1')
    ).toEqual({
      identifier: 'movie_1',
      kind: 'resource',
      name: 'Studio',
      service: 'VIDEO',
    });
  });

  it('reads a link straight to audio, a video or a file', () => {
    expect(parseQortinoMediaLink('qortal://AUDIO/Earbump/track_1')).toEqual({
      identifier: 'track_1',
      kind: 'resource',
      name: 'Earbump',
      service: 'AUDIO',
    });
    expect(parseQortinoMediaLink('qortal://video/a/b')).toMatchObject({
      service: 'VIDEO',
    });
  });

  it('leaves other text and links alone', () => {
    for (const value of [
      '',
      'hello',
      'https://example.com/video.mp4',
      'qortal://APP/Q-Mail',
      'qortal://APP/Q-Tube/channel/BigPicture',
      'qortal://APP/Q-Tube/video/BigPicture',
      'qortal://WEBSITE/site/page',
      'qortal://APP/Subscreen/watch/IMAGE/a/b',
      'qortal://APP/Q-Share/share/a/b more text',
    ]) {
      expect(parseQortinoMediaLink(value)).toBeNull();
    }
  });
});

describe('resolveQortinoMediaLink', () => {
  it('plays the video a Q-Tube link’s details name', async () => {
    const item = await resolveQortinoMediaLink(
      'qortal://APP/Q-Tube/video/BigPicture/qtube_vid_gold_bcura2',
      {
        fetchJson: qdn({
          'http://node/arbitrary/DOCUMENT/BigPicture/qtube_vid_gold_bcura2_metadata':
            QTUBE_DETAILS,
        }),
      }
    );
    expect(item).toEqual({
      durationSeconds: 3626,
      identifier: 'qtube_vid_gold_bcura2',
      kind: 'video',
      link: 'qortal://APP/Q-Tube/video/BigPicture/qtube_vid_gold_bcura2',
      name: 'BigPicture',
      publisher: 'BigPicture',
      service: 'VIDEO',
      thumbnail: 'data:image/jpeg;base64,/9j/4AAQ',
      title: 'Gold vs. treasuries',
    });
    expect(qortinoMediaUrl(item)).toBe(
      'http://node/arbitrary/VIDEO/BigPicture/qtube_vid_gold_bcura2'
    );
  });

  it('plays the first audio or video file of a Q-Share share', async () => {
    const item = await resolveQortinoMediaLink(
      'qortal://APP/Q-Share/share/PixelMage/qshare_file_john_metadata',
      {
        fetchJson: qdn({
          'http://node/arbitrary/DOCUMENT/PixelMage/qshare_file_john_metadata':
            QSHARE_DETAILS,
        }),
      }
    );
    expect(item).toMatchObject({
      identifier: 'qshare_file_john_5lDFHX',
      kind: 'audio',
      name: 'PixelMage',
      service: 'FILE',
      thumbnail:
        'http://node/arbitrary/THUMBNAIL/PixelMage/qshare_thumb_john?async=true',
      title: 'Through the Bible - John 1',
    });
  });

  it('plays a Subscreen series’ episode', async () => {
    const item = await resolveQortinoMediaLink(
      'qortal://APP/Subscreen/watch/DOCUMENT/Studio/show_metadata?episode=1',
      {
        fetchJson: qdn({
          'http://node/arbitrary/DOCUMENT/Studio/show_metadata': {
            title: 'The show',
            episodes: [
              {
                title: 'Pilot',
                videoReference: {
                  identifier: 'e0',
                  name: 'Studio',
                  service: 'VIDEO',
                },
              },
              {
                title: 'Second',
                videoReference: {
                  identifier: 'e1',
                  name: 'Studio',
                  service: 'VIDEO',
                },
              },
            ],
          },
        }),
      }
    );
    expect(item).toMatchObject({
      identifier: 'e1',
      kind: 'video',
      title: 'Second',
    });
  });

  it('plays a file by its type', async () => {
    const fetchJson = qdn({
      'http://node/arbitrary/resource/properties/FILE/a/song': {
        filename: 'song.ogg',
        mimeType: 'audio/ogg',
      },
      'http://node/arbitrary/resource/properties/FILE/a/sheet': {
        filename: 'sheet.pdf',
        mimeType: 'application/pdf',
      },
    });
    expect(
      await resolveQortinoMediaLink('qortal://FILE/a/song', { fetchJson })
    ).toMatchObject({ kind: 'audio', title: 'song.ogg' });
    expect(
      await problemOf(
        resolveQortinoMediaLink('qortal://FILE/a/sheet', { fetchJson })
      )
    ).toBe('not_playable');
  });

  it('says why a link can’t be played', async () => {
    const fetchJson = qdn({
      'http://node/arbitrary/DOCUMENT/a/pictures_metadata': {
        files: [{ identifier: 'p', mimetype: 'image/png', service: 'FILE' }],
      },
    });
    expect(
      await problemOf(
        resolveQortinoMediaLink('qortal://APP/Q-Mail', { fetchJson })
      )
    ).toBe('unsupported');
    expect(
      await problemOf(
        resolveQortinoMediaLink('qortal://APP/Q-Tube/video/a/gone', {
          fetchJson,
        })
      )
    ).toBe('not_found');
    expect(
      await problemOf(
        resolveQortinoMediaLink('qortal://APP/Q-Share/share/a/pictures', {
          fetchJson,
        })
      )
    ).toBe('not_playable');
  });
});

describe('sanitizeQortinoMediaItem', () => {
  it('keeps a stored item, and nothing that is not one', () => {
    const item = {
      identifier: 'v',
      kind: 'video',
      link: 'qortal://VIDEO/a/v',
      name: 'a',
      publisher: 'a',
      service: 'VIDEO',
      title: 'A video',
    };
    expect(sanitizeQortinoMediaItem(item)).toEqual(item);
    expect(sanitizeQortinoMediaItem({ ...item, kind: 'image' })).toBeNull();
    expect(sanitizeQortinoMediaItem({ ...item, service: 'IMAGE' })).toBeNull();
    expect(sanitizeQortinoMediaItem('x')).toBeNull();
    // A big picture isn't kept.
    expect(
      sanitizeQortinoMediaItem({ ...item, thumbnail: 'x'.repeat(300_000) })
    ).not.toHaveProperty('thumbnail');
  });
});

/** A playlist as EarBump publishes it (trimmed). */
const EARBUMP_PLAYLIST = {
  title: 'Road trip',
  songs: [
    {
      author: 'Sun64',
      identifier: 'earbump_song_crazy',
      name: 'Sun64',
      service: 'AUDIO',
      title: 'Crazy Insane (alpha remix)',
    },
    // Older playlists name a song by `id`.
    { id: 'earbump_song_wind', name: 'Wind Up', title: 'Second Wind' },
    // Not a song: left out.
    { identifier: 'earbump_cover', name: 'Sun64', service: 'IMAGE' },
    { identifier: 'earbump_song_crazy', name: 'Sun64' },
  ],
};

describe('EarBump links', () => {
  const PLAYLIST_LINK =
    'qortal://APP/EarBump/playlists/Music%20Fan/earbump_playlist_road_trip';

  it('reads its playlist and artist links, under either of its names', () => {
    expect(parseQortinoMediaLink(PLAYLIST_LINK)).toEqual({
      identifier: 'earbump_playlist_road_trip',
      kind: 'earbump-playlist',
      name: 'Music Fan',
    });
    expect(
      parseQortinoMediaLink('qortal://app/earbump/all-songs/Sun%2064')
    ).toEqual({ artist: 'Sun 64', kind: 'earbump-artist' });
    expect(
      parseQortinoMediaLink('qortal://APP/Ear-Bump/all-songs/Sun64')
    ).toEqual({ artist: 'Sun64', kind: 'earbump-artist' });
    expect(parseQortinoMediaLink('qortal://APP/EarBump/library')).toBeNull();
    expect(
      parseQortinoMediaLink('qortal://APP/EarBump/playlists/x')
    ).toBeNull();
  });

  it('plays a playlist from its first song, with its songs to go through', async () => {
    const fetchJson = vi.fn(async () => EARBUMP_PLAYLIST);
    const item = await resolveQortinoMediaLink(PLAYLIST_LINK, { fetchJson });

    expect(fetchJson).toHaveBeenCalledWith(
      'http://node/arbitrary/PLAYLIST/Music%20Fan/earbump_playlist_road_trip',
      undefined
    );
    expect(item).toMatchObject({
      identifier: 'earbump_song_crazy',
      kind: 'audio',
      link: PLAYLIST_LINK,
      name: 'Sun64',
      publisher: 'Sun64',
      service: 'AUDIO',
      title: 'Crazy Insane (alpha remix)',
      trackIndex: 0,
    });
    expect(item.tracks).toEqual([
      {
        artist: 'Sun64',
        identifier: 'earbump_song_crazy',
        name: 'Sun64',
        title: 'Crazy Insane (alpha remix)',
      },
      {
        artist: '',
        identifier: 'earbump_song_wind',
        name: 'Wind Up',
        title: 'Second Wind',
      },
    ]);
  });

  it('plays an artist’s songs', async () => {
    const findArtistTracks = vi.fn(async () => [
      { artist: 'Sun64', identifier: 'a', name: 'Sun64', title: 'Newest' },
      { artist: 'Sun64', identifier: 'b', name: 'Sun64', title: 'Older' },
    ]);
    const item = await resolveQortinoMediaLink(
      'qortal://APP/EarBump/all-songs/Sun64',
      { findArtistTracks }
    );
    expect(findArtistTracks).toHaveBeenCalledWith('Sun64', undefined);
    expect(item).toMatchObject({
      identifier: 'a',
      publisher: 'Sun64',
      title: 'Newest',
      trackIndex: 0,
    });
    expect(item.tracks).toHaveLength(2);
  });

  it('says why one can’t be played', async () => {
    const problem = (promise: Promise<unknown>) =>
      promise.then(
        () => 'played',
        (error) => (error as QortinoMediaLinkError).problem
      );
    await expect(
      problem(
        resolveQortinoMediaLink(PLAYLIST_LINK, {
          fetchJson: async () => {
            throw new Error('404');
          },
        })
      )
    ).resolves.toBe('not_found');
    await expect(
      problem(
        resolveQortinoMediaLink(PLAYLIST_LINK, {
          fetchJson: async () => ({ songs: [] }),
        })
      )
    ).resolves.toBe('not_playable');
    await expect(
      problem(
        resolveQortinoMediaLink('qortal://APP/EarBump/all-songs/Nobody', {
          findArtistTracks: async () => [],
        })
      )
    ).resolves.toBe('not_found');
  });

  it('goes through the songs both ways, round the ends', async () => {
    const item = await resolveQortinoMediaLink(PLAYLIST_LINK, {
      fetchJson: async () => EARBUMP_PLAYLIST,
    });
    const second = stepQortinoMediaItem(item, 'next');
    expect(second).toMatchObject({
      identifier: 'earbump_song_wind',
      link: PLAYLIST_LINK,
      name: 'Wind Up',
      publisher: 'Wind Up',
      trackIndex: 1,
    });
    expect(stepQortinoMediaItem(second, 'next')).toMatchObject({
      identifier: 'earbump_song_crazy',
      trackIndex: 0,
    });
    expect(stepQortinoMediaItem(item, 'previous')).toMatchObject({
      identifier: 'earbump_song_wind',
      trackIndex: 1,
    });
    // One thing to play: next and previous are the player's own.
    expect(
      stepQortinoMediaItem(
        { ...item, tracks: item.tracks?.slice(0, 1) },
        'next'
      )
    ).toBeNull();
    expect(stepQortinoMediaItem(undefined, 'next')).toBeNull();
  });

  it('keeps a playlist’s songs with the stored item', async () => {
    const item = await resolveQortinoMediaLink(PLAYLIST_LINK, {
      fetchJson: async () => EARBUMP_PLAYLIST,
    });
    const stored = JSON.parse(
      JSON.stringify(stepQortinoMediaItem(item, 'next'))
    );
    expect(sanitizeQortinoMediaItem(stored)).toEqual(stored);
    expect(
      sanitizeQortinoMediaItem({ ...stored, trackIndex: 9, tracks: [{}] })
    ).not.toHaveProperty('tracks');
    expect(
      sanitizeQortinoMediaItem({ ...stored, trackIndex: 9 })
    ).toMatchObject({ trackIndex: 1 });
  });
});
