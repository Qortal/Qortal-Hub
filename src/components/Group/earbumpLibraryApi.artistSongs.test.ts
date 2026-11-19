import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEarbumpArtistTracks } from './earbumpLibraryApi';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node',
}));

type Song = {
  /** Left out of the description when absent, as some songs have it. */
  author?: string;
  created: number;
  identifier: string;
  name: string;
  title: string;
};

/**
 * The node's search as Core runs it: `query` anywhere in the name,
 * identifier, title or description, `identifier` anywhere in the
 * identifier, `description` in the description, newest first, then
 * `offset` and `limit`.
 */
const nodeSearch = (songs: Song[]) =>
  vi.fn(async (url: string) => {
    const params = new URL(url).searchParams;
    const query = params.get('query')?.toLowerCase();
    const identifier = params.get('identifier')?.toLowerCase();
    const description = params.get('description')?.toLowerCase();
    const offset = Number(params.get('offset') ?? 0);
    const limit = Number(params.get('limit') ?? 20);
    const found = songs
      .map((song) => ({
        ...song,
        description: song.author
          ? `title=${song.title};author=${song.author}`
          : '',
      }))
      .filter(
        (song) =>
          (!query ||
            [song.name, song.identifier, song.title, song.description].some(
              (field) => field.toLowerCase().includes(query)
            )) &&
          (!identifier || song.identifier.toLowerCase().includes(identifier)) &&
          (!description || song.description.toLowerCase().includes(description))
      )
      .sort((a, b) => b.created - a.created)
      .slice(offset, offset + limit);
    return {
      json: async () =>
        found.map((song) => ({
          created: song.created,
          identifier: song.identifier,
          metadata: { description: song.description, title: song.title },
          name: song.name,
          service: 'AUDIO',
        })),
      ok: true,
    };
  });

describe('an EarBump artist’s songs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds an artist whose name other songs mention too', async () => {
    // The artist "Sun" has three songs. Newer songs by others have "sun"
    // in their titles (Sunday, Sunset, ...).
    const artistSongs: Song[] = [1, 2, 3].map((n) => ({
      author: 'Sun',
      created: n,
      identifier: `earbump_song_sun_${n}`,
      name: 'SunMusic',
      title: `Track ${n}`,
    }));
    const others: Song[] = Array.from({ length: 150 }, (_, n) => ({
      author: `Band ${n}`,
      created: 1_000 + n,
      identifier: `earbump_song_other_${n}`,
      name: `Band${n}`,
      title: `Sunday ${n}`,
    }));
    global.fetch = nodeSearch([
      ...artistSongs,
      ...others,
    ]) as unknown as typeof fetch;

    const tracks = await fetchEarbumpArtistTracks('Sun');

    expect(tracks.map((track) => track.id)).toEqual([
      'earbump_song_sun_3',
      'earbump_song_sun_2',
      'earbump_song_sun_1',
    ]);
  });

  it('finds the songs whose artist is their publisher’s name', async () => {
    // Songs published without an author in their description: EarBump
    // and the player show the publisher's name as their artist.
    const publisherSongs: Song[] = [1, 2].map((n) => ({
      created: n,
      identifier: `earbump_song_quiet_${n}`,
      name: 'QuietPublisher',
      title: `Track ${n}`,
    }));
    const others: Song[] = [1, 2].map((n) => ({
      author: `Band ${n}`,
      created: 100 + n,
      identifier: `earbump_song_band_${n}`,
      name: `Band${n}`,
      title: `Song ${n}`,
    }));
    global.fetch = nodeSearch([
      ...publisherSongs,
      ...others,
    ]) as unknown as typeof fetch;

    const tracks = await fetchEarbumpArtistTracks('QuietPublisher');

    expect(tracks.map((track) => track.id)).toEqual([
      'earbump_song_quiet_2',
      'earbump_song_quiet_1',
    ]);
    expect(tracks[0]).toMatchObject({ artist: 'QuietPublisher' });
  });
});
