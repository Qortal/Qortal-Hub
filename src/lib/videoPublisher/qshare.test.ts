import { describe, expect, it } from 'vitest';
import records from './__fixtures__/real-records.json';
import {
  convertedVideo,
  COVER,
  last,
  stepJson,
  VTT,
} from './__fixtures__/testData';
import { base64ToBytes } from './encoding';
import { buildQshareVideo, qshareTitle, type QshareVideoInput } from './qshare';

const input = (
  overrides: Partial<QshareVideoInput> = {}
): QshareVideoInput => ({
  key: 's',
  name: 'Video Maker',
  title: 'Sunday talk: Part 28',
  description: '113MB, 39m40s',
  subcategory: 421,
  video: convertedVideo({ size: 112_527_161 }),
  fileName: 'Harbour_Part_28.mkv',
  thumbnail: COVER,
  ...overrides,
});

describe('buildQshareVideo', () => {
  it('matches a real Q-Share video share: keys, order and values', async () => {
    const plan = await buildQshareVideo(input());
    const metadata = stepJson(last(plan.steps));
    const real = records.qshareMetadata;
    expect(Object.keys(metadata)).toEqual(Object.keys(real));
    expect(Object.keys(metadata.files[0])).toEqual(Object.keys(real.files[0]));
    expect(Object.keys(metadata.thumbnail)).toEqual(
      Object.keys(real.thumbnail)
    );
    expect(metadata).toMatchObject({
      title: 'Sunday talk: Part 28',
      version: 1,
      fullDescription: real.fullDescription,
      htmlDescription: real.htmlDescription,
      category: '4',
      subcategory: '421',
      subcategory2: '',
      files: [
        {
          filename: 'Harbour_Part_28.mp4',
          identifier: plan.fileIdentifier,
          name: 'Video Maker',
          service: 'FILE',
          mimetype: 'video/mp4',
          size: 112_527_161,
        },
      ],
      thumbnail: { service: 'THUMBNAIL', name: 'Video Maker' },
    });
    expect(last(plan.steps).description).toBe(
      records.qshareDocument.metadata.description
    );
  });

  it('names everything as Q-Share does', async () => {
    const plan = await buildQshareVideo(input());
    expect(plan.fileIdentifier).toMatch(
      /^qshare_file_sunday-talk-part-28_[A-Za-z0-9]{6}$/
    );
    expect(plan.metadataIdentifier).toMatch(
      /^qshare_file_sunday-talk-part-28_[A-Za-z0-9]{6}_metadata$/
    );
    const metadata = stepJson(last(plan.steps));
    expect(metadata.commentsId).toBe(
      `qshare_file__cm_${plan.metadataIdentifier.slice(-15, -9)}`
    );
    const [file, thumbnail, doc] = plan.steps;
    expect(file).toMatchObject({
      service: 'FILE',
      tag1: 'qshare_file_',
      filename: 'Harbour_Part_28.mp4',
      title: 'Sunday talk: Part 28',
    });
    expect(thumbnail).toMatchObject({
      service: 'THUMBNAIL',
      tag1: 'qshare_thumb_',
      filename: 'thumbnail.webp',
      identifier: expect.stringMatching(/^qshare_thumb_sunday-talk-part-28_/),
      data: { base64: COVER.split(',')[1] },
      // No thumbnail for a file that didn't go up.
      dependsOn: ['s:file'],
    });
    expect(doc).toMatchObject({
      service: 'DOCUMENT',
      filename: 'video_metadata.json',
      tag1: 'qshare_file_',
      dependsOn: ['s:file', 's:thumbnail'],
    });
    expect(plan.record.link).toBe(
      `qortal://APP/Q-Share/share/Video%20Maker/${plan.metadataIdentifier}`
    );
  });

  it('adds subtitles as .vtt files of the share', async () => {
    const plan = await buildQshareVideo(
      input({ thumbnail: null, subtitles: [{ language: 'de', vtt: VTT }] })
    );
    expect(plan.steps.map((s) => s.key)).toEqual([
      's:file',
      's:subtitle:0',
      's:metadata',
    ]);
    const vtt = plan.steps[1];
    expect(vtt).toMatchObject({
      service: 'FILE',
      filename: 'Harbour_Part_28.de.vtt',
      dependsOn: ['s:file'],
    });
    expect(
      new TextDecoder().decode(
        base64ToBytes((vtt.data as { base64: string }).base64)
      )
    ).toBe(VTT);
    const metadata = stepJson(last(plan.steps));
    expect(metadata.files[1]).toMatchObject({
      filename: 'Harbour_Part_28.de.vtt',
      mimetype: 'text/vtt',
    });
    expect('thumbnail' in metadata).toBe(false);
  });

  it("drops the characters Q-Share's title field drops", () => {
    expect(qshareTitle('Amélie — café\n"quote" 日本')).toBe(
      'Amelie — cafe "quote"'
    );
  });

  it.each([
    [
      'a title of only dropped characters',
      { title: '日本語' },
      'title-required',
    ],
    ['a non-video subcategory', { subcategory: 101 }, 'category-required'],
    ['no video', { video: convertedVideo({ size: 0 }) }, 'video-required'],
    [
      'a thumbnail over 200 KB',
      { thumbnail: `data:image/webp;base64,${'A'.repeat(300_000)}` },
      'image-too-large',
    ],
    [
      'a thumbnail that is not an image',
      { thumbnail: 'nope' },
      'image-unreadable',
    ],
  ] as const)('refuses %s', async (_label, overrides, code) => {
    await expect(
      buildQshareVideo(input(overrides as Partial<QshareVideoInput>))
    ).rejects.toMatchObject({ code });
  });
});
