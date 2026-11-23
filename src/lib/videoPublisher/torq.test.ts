import { describe, expect, it } from 'vitest';
import { quitterHashString } from '../../components/Widgets/quitter/quitterIdentity';
import {
  convertedVideo,
  COVER,
  FRAMES,
  stepJson,
  VTT,
  last,
} from './__fixtures__/testData';
import { buildTorqLinkPost, buildTorqVideoPost } from './torq';

const POST_ID = /^MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-[0-9A-Za-z]{15}-v1$/;

const videoPost = (overrides = {}) =>
  buildTorqVideoPost({
    key: 't',
    name: 'Video Maker',
    text: 'Look at this #Qortal #video\r\n\r\n\r\nby @Alice',
    title: 'Clip',
    category: 5,
    cover: COVER,
    extracts: FRAMES,
    video: convertedVideo({ size: 2048, durationSec: 12 }),
    ...overrides,
  });

describe('buildTorqVideoPost', () => {
  it('uploads a Q-Tube video with Torq ids, then the post', async () => {
    const plan = await videoPost({ subtitles: [{ language: 'en', vtt: VTT }] });
    expect(plan.steps.map((s) => s.key)).toEqual([
      't:video',
      't:subtitle:0',
      't:metadata',
      't:post',
    ]);
    expect(plan.video.videoIdentifier).toMatch(
      /^qtube_vid_clip_[A-Za-z0-9]{8}$/
    );
    const post = last(plan.steps);
    expect(post).toMatchObject({
      kind: 'post',
      service: 'DOCUMENT',
      identifier: plan.postIdentifier,
      dependsOn: ['t:metadata'],
    });
    expect(post.identifier).toMatch(POST_ID);
    expect(post.title).toBeUndefined();
    expect(post.filename).toBeUndefined();
  });

  it("writes the post in Torq's format, the video as an uploaded card", async () => {
    const plan = await videoPost();
    const post = stepJson(last(plan.steps));
    expect(Object.keys(post)).toEqual(['text', 'timestamp', 'name', 'videos']);
    expect(post).toEqual({
      text: 'Look at this #Qortal #video\n\nby @Alice',
      timestamp: expect.any(Number),
      name: 'Video Maker',
      videos: [
        {
          identifier: plan.video.metadataIdentifier,
          service: 'DOCUMENT',
          name: 'Video Maker',
          mimeType: 'video/mp4',
          source: 'upload',
          display: 'card',
        },
      ],
    });
    expect(Object.keys(post.videos[0])).toEqual([
      'identifier',
      'service',
      'name',
      'mimeType',
      'source',
      'display',
    ]);
  });

  it('describes the post with its hashtags and first mention', async () => {
    const plan = await videoPost();
    const mention = `~@${await quitterHashString('Alice')}~`;
    expect(last(plan.steps).description).toBe(`~#qortal~,~#video~,${mention}`);
  });

  it('may have no text and no description', async () => {
    const plan = await videoPost({ text: '' });
    expect(stepJson(last(plan.steps)).text).toBe('');
    expect(last(plan.steps).description).toBeUndefined();
  });

  it('links to the post and keeps every resource for removal', async () => {
    const plan = await videoPost();
    expect(plan.record).toMatchObject({
      app: 'torq',
      link: `qortal://APP/Torq/post/Video%20Maker/${plan.postIdentifier}`,
      open: { service: 'APP', name: 'Torq' },
    });
    expect(plan.record.resources.map((r) => r.kind)).toEqual([
      'video',
      'metadata',
      'post',
    ]);
  });

  it("keeps Torq's 100-character title limit", async () => {
    const plan = await videoPost({ title: 'x'.repeat(150) });
    expect(plan.video.title).toHaveLength(100);
  });
});

describe('buildTorqLinkPost', () => {
  it('posts a Q-Tube video without uploading it', async () => {
    const plan = await buildTorqLinkPost({
      name: 'Video Maker',
      text: 'Watch this',
      video: {
        name: 'Other Name',
        metadataIdentifier: 'qtube_vid_film_abcdef_metadata',
      },
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].dependsOn).toEqual([]);
    const post = stepJson(plan.steps[0]);
    expect(post.text).toBe(
      'Watch this\n\nqortal://APP/Q-Tube/video/Other%20Name/qtube_vid_film_abcdef_metadata'
    );
    expect(post.videos).toEqual([
      {
        identifier: 'qtube_vid_film_abcdef_metadata',
        service: 'DOCUMENT',
        name: 'Other Name',
        display: 'card',
      },
    ]);
    // Removing the post later leaves the video alone.
    expect(plan.record.resources).toEqual([
      {
        service: 'DOCUMENT',
        name: 'Video Maker',
        identifier: plan.postIdentifier,
        kind: 'post',
      },
    ]);
  });

  it('does not add the link twice, and needs a video', async () => {
    const link = 'qortal://APP/Q-Tube/video/Me/qtube_vid_film_abcdef_metadata';
    const plan = await buildTorqLinkPost({
      name: 'Me',
      text: `Here: ${link}`,
      video: {
        name: 'Me',
        metadataIdentifier: 'qtube_vid_film_abcdef_metadata',
      },
    });
    expect(stepJson(plan.steps[0]).text).toBe(`Here: ${link}`);
    await expect(
      buildTorqLinkPost({
        name: 'Me',
        video: { name: '', metadataIdentifier: 'x' },
      })
    ).rejects.toMatchObject({ code: 'video-required' });
  });
});
