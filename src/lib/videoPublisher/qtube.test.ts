import { describe, expect, it } from 'vitest';
import records from './__fixtures__/real-records.json';
import {
  convertedVideo,
  COVER,
  FRAMES,
  stepJson,
  VTT,
  last,
} from './__fixtures__/testData';
import { buildQtubeVideo, type QtubeVideoInput } from './qtube';

const input = (overrides: Partial<QtubeVideoInput> = {}): QtubeVideoInput => ({
  name: 'Video Maker',
  title: 'My Holiday: Part 1',
  description: 'First line\nsecond line\n\nAnother paragraph',
  category: 17,
  cover: COVER,
  extracts: FRAMES,
  video: convertedVideo({ size: 31_464_556, durationSec: 58 }),
  ...overrides,
});

describe('buildQtubeVideo', () => {
  it("writes the metadata with Q-Tube's keys, in its order", async () => {
    const plan = await buildQtubeVideo(input());
    const metadata = stepJson(last(plan.steps));
    expect(Object.keys(metadata)).toEqual(Object.keys(records.qtubeMetadata));
    expect(metadata).toEqual({
      title: 'My Holiday: Part 1',
      version: 1,
      fullDescription: 'First line second line Another paragraph',
      htmlDescription:
        '<p>First line<br />second line</p><p>Another paragraph</p>',
      videoImage: COVER,
      videoReference: {
        name: 'Video Maker',
        identifier: plan.videoIdentifier,
        service: 'VIDEO',
      },
      extracts: FRAMES,
      commentsId: expect.stringMatching(/^qtube_vid__cm_[A-Za-z0-9]{6}$/),
      category: 17,
      subcategory: '',
      code: plan.code,
      videoType: 'video/mp4',
      filename: 'MyHolidayPart1.mp4',
      fileSize: 31_464_556,
      duration: 58,
    });
    expect(metadata.commentsId.slice(-6)).toBe(plan.videoIdentifier.slice(-6));
  });

  it('names the resources as Q-Tube does', async () => {
    const plan = await buildQtubeVideo(input());
    expect(plan.videoIdentifier).toMatch(
      /^qtube_vid_my-holiday-part-1_[A-Za-z0-9]{6}$/
    );
    expect(plan.metadataIdentifier).toBe(`${plan.videoIdentifier}_metadata`);
    expect(plan.code).toMatch(/^[A-Za-z0-9]{5}$/);
    const [video, metadata] = plan.steps;
    for (const step of [video, metadata]) {
      expect(step.title).toBe('My Holiday: Part 1');
      expect(step.tag1).toBe('qtube_vid_');
      expect(step.description).toBe(
        `**category:17;subcategory:;code:${plan.code}**First line second line Another paragraph`
      );
    }
    expect(video).toMatchObject({
      kind: 'video',
      service: 'VIDEO',
      filename: 'MyHolidayPart1.mp4',
      bytes: 31_464_556,
    });
    expect('file' in video.data).toBe(true);
    expect(metadata).toMatchObject({
      kind: 'metadata',
      service: 'DOCUMENT',
      filename: 'video_metadata.json',
      dependsOn: [plan.videoStepKey],
    });
  });

  it('sends the VIDEO first, its subtitles, then the listing', async () => {
    const plan = await buildQtubeVideo(
      input({
        key: 'q1',
        subtitles: [
          { language: 'en', vtt: VTT },
          { language: 'nl', vtt: VTT },
        ],
      })
    );
    expect(plan.steps.map((s) => s.key)).toEqual([
      'q1:video',
      'q1:subtitle:0',
      'q1:subtitle:1',
      'q1:metadata',
    ]);
    // The listing names the subtitles: it waits for every one of them.
    expect(plan.steps[3].dependsOn).toEqual([
      'q1:video',
      'q1:subtitle:0',
      'q1:subtitle:1',
    ]);
    expect(plan.steps[1].filename).toBe('MyHolidayPart1.en.vtt');
    expect(plan.record).toMatchObject({
      app: 'qtube',
      name: 'Video Maker',
      link: `qortal://APP/Q-Tube/video/Video%20Maker/${plan.metadataIdentifier}`,
      open: {
        service: 'APP',
        name: 'Q-Tube',
        path: `video/Video%20Maker/${plan.metadataIdentifier}`,
      },
    });
    expect(plan.record.resources.map((r) => r.kind)).toEqual([
      'video',
      'subtitle',
      'subtitle',
      'metadata',
    ]);
  });

  it('keeps a subcategory, and the cover stands in for missing frames', async () => {
    const plan = await buildQtubeVideo(
      input({ category: 4, subcategory: 400, extracts: [] })
    );
    const metadata = stepJson(last(plan.steps));
    expect(metadata.subcategory).toBe(400);
    expect(metadata.extracts).toEqual([COVER, COVER, COVER, COVER]);
    expect(plan.steps[0].description).toMatch(
      /^\*\*category:4;subcategory:400;/
    );
  });

  it('cuts QDN titles at 50 and keeps the long title in the metadata', async () => {
    const long = 'A'.repeat(70);
    const plan = await buildQtubeVideo(input({ title: `${long}\nmore` }));
    expect(plan.steps[0].title).toBe('A'.repeat(50));
    expect(stepJson(last(plan.steps)).title).toBe(`${long} more`);
    expect(plan.videoIdentifier.length).toBeLessThanOrEqual(64);
    expect(plan.metadataIdentifier.length).toBeLessThanOrEqual(64);
  });

  it.each([
    ['an empty name', { name: ' ' }, 'name-required'],
    ['an empty title', { title: ' \n ' }, 'title-required'],
    ['an unknown category', { category: 0 }, 'category-required'],
    [
      "another category's subcategory",
      { category: 3, subcategory: 101 },
      'category-required',
    ],
    ['no cover', { cover: '' }, 'cover-required'],
    [
      'a cover that is not a data URL',
      { cover: 'https://example.com/a.webp' },
      'cover-required',
    ],
    [
      'an empty video',
      { video: convertedVideo({ size: 0 }) },
      'video-required',
    ],
  ] as const)('refuses %s', async (_label, overrides, code) => {
    await expect(
      buildQtubeVideo(input(overrides as Partial<QtubeVideoInput>))
    ).rejects.toMatchObject({ code });
  });

  it('refuses a listing that qapp-core lists would skip (5 MiB)', async () => {
    const huge = `data:image/webp;base64,${'A'.repeat(5.2 * 1024 * 1024)}`;
    await expect(buildQtubeVideo(input({ cover: huge }))).rejects.toMatchObject(
      { code: 'metadata-too-large' }
    );
  });
});
