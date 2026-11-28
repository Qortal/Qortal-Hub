import { describe, expect, it } from 'vitest';
import { convertedVideo, COVER, VTT } from './__fixtures__/testData';
import { buildQshareVideo } from './qshare';
import { buildQtubeVideo } from './qtube';
import { buildRemovalSteps, DELETED_DATA64 } from './removal';
import { buildSubscreenFilm, buildSubscreenSeries } from './subscreen';
import { planSubscreenCredits } from './subscreenCredits';
import { buildTorqLinkPost, buildTorqVideoPost } from './torq';
import type { PublishedRecord } from './types';

const qtube = () =>
  buildQtubeVideo({
    name: 'Me',
    title: 'Clip',
    category: 5,
    cover: COVER,
    video: convertedVideo(),
    subtitles: [{ language: 'en', vtt: VTT }],
  });

describe('buildRemovalSteps', () => {
  it('replaces a Q-Tube video listing first, as qapp-core deletes', async () => {
    const { record, metadataIdentifier, videoIdentifier } = await qtube();
    const steps = buildRemovalSteps(record);
    expect(steps.map((s) => [s.service, s.kind])).toEqual([
      ['DOCUMENT', 'metadata'],
      ['VIDEO', 'video'],
      ['FILE', 'subtitle'],
    ]);
    expect(steps[0].identifier).toBe(metadataIdentifier);
    expect(steps[1].identifier).toBe(videoIdentifier);
    for (const step of steps) {
      expect(step.data).toEqual({ base64: DELETED_DATA64 });
      expect(step.title).toBeUndefined();
      expect(step.filename).toBeUndefined();
    }
    expect(steps[0].dependsOn).toEqual([]);
    expect(steps[1].dependsOn).toEqual([steps[0].key]);
    expect(steps[2].dependsOn).toEqual([steps[0].key]);
  });

  it('removes a Torq post first, then the video it uploaded', async () => {
    const plan = await buildTorqVideoPost({
      name: 'Me',
      title: 'Clip',
      category: 5,
      cover: COVER,
      video: convertedVideo(),
    });
    const steps = buildRemovalSteps(plan.record);
    expect(steps.map((s) => s.kind)).toEqual(['post', 'metadata', 'video']);
    expect(steps[1].dependsOn).toEqual([steps[0].key]);
    expect(steps[2].dependsOn).toEqual([steps[0].key, steps[1].key]);
  });

  it("leaves a linked video alone: only the post is someone's to remove", async () => {
    const plan = await buildTorqLinkPost({
      name: 'Me',
      video: { name: 'Me', metadataIdentifier: 'qtube_vid_a_abcdef_metadata' },
    });
    const steps = buildRemovalSteps(plan.record);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'post', service: 'DOCUMENT' });
  });

  it('removes a series playlist before its episodes', async () => {
    const plan = await buildSubscreenSeries({
      name: 'Me',
      title: 'Show',
      genre: 201,
      poster: COVER,
      episodes: [
        { season: 1, episode: 1, video: convertedVideo() },
        { season: 1, episode: 2, video: convertedVideo() },
      ],
    });
    const kinds = buildRemovalSteps(plan.record).map((s) => s.kind);
    expect(kinds).toEqual([
      'playlist',
      'metadata',
      'metadata',
      'video',
      'video',
    ]);
  });

  it("marks a Q-Share share the way Q-Share's own removal does", async () => {
    const plan = await buildQshareVideo({
      name: 'Me',
      title: 'Share',
      subcategory: 404,
      video: convertedVideo(),
      fileName: 'clip.mp4',
      thumbnail: COVER,
    });
    const steps = buildRemovalSteps(plan.record);
    expect(
      steps.map((s) => [s.service, s.title, s.description, s.tag1, s.filename])
    ).toEqual([
      ['DOCUMENT', 'deleted', 'deleted', 'deleted', 'video_metadata.json'],
      ['FILE', 'deleted', 'deleted', 'deleted', 'clip.mp4'],
      ['THUMBNAIL', 'deleted', 'deleted', 'deleted', 'deleted'],
    ]);
  });

  it('gives the same keys again, so a retry skips what is done', async () => {
    const { record } = await qtube();
    expect(buildRemovalSteps(record).map((s) => s.key)).toEqual(
      buildRemovalSteps(record).map((s) => s.key)
    );
  });

  it("skips other names' resources and refuses an empty record", () => {
    const record: PublishedRecord = {
      app: 'qtube',
      name: 'Me',
      title: '',
      link: '',
      open: { service: 'APP', name: 'Q-Tube', path: '' },
      resources: [
        { service: 'VIDEO', name: 'Other', identifier: 'x', kind: 'video' },
      ],
    };
    expect(() => buildRemovalSteps(record)).toThrow(
      expect.objectContaining({ code: 'nothing-to-remove' })
    );
  });

  it("takes a Subscreen title's cast & crew first, and never a person", async () => {
    const film = await buildSubscreenFilm({
      name: 'Me',
      title: 'Film',
      genre: 101,
      cover: COVER,
      video: convertedVideo(),
    });
    const credits = await planSubscreenCredits({
      key: 'film',
      name: 'Me',
      titleRef: {
        name: 'Me',
        identifier: film.metadataIdentifier,
        service: 'DOCUMENT',
      },
      credits: [{ role: 'director', displayName: 'Someone New' }],
      dependsOn: [film.metadataStepKey],
      findPerson: async () => null,
    });
    const record: PublishedRecord = {
      ...film.record,
      resources: [
        ...film.record.resources,
        // Never in a record, but if one were: still left alone.
        {
          service: 'DOCUMENT',
          name: 'Me',
          identifier: credits.people[0].step.identifier,
          kind: 'person',
        },
        credits.resource,
      ],
    };
    const steps = buildRemovalSteps(record);
    expect(steps.map((s) => [s.kind, s.identifier])).toEqual([
      ['credits', credits.identifier],
      ['metadata', film.metadataIdentifier],
      ['video', film.videoIdentifier],
    ]);
    expect(steps[0]).toMatchObject({ data: { base64: DELETED_DATA64 } });
    expect(steps[0].title).toBeUndefined();
    expect(steps[0].dependsOn).toEqual([]);
    expect(steps[1].dependsOn).toEqual([steps[0].key]);
  });

  it('never removes a record of people alone', () => {
    const record: PublishedRecord = {
      app: 'subscreen',
      name: 'Me',
      title: '',
      link: '',
      open: { service: 'APP', name: 'Subscreen', path: '' },
      resources: [
        {
          service: 'DOCUMENT',
          name: 'Me',
          identifier: 'subscreen_person_someone_abcde',
          kind: 'person',
        },
      ],
    };
    expect(() => buildRemovalSteps(record)).toThrow(
      expect.objectContaining({ code: 'nothing-to-remove' })
    );
  });
});
