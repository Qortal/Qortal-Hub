import { describe, expect, it } from 'vitest';
import { withMuxOverhead } from '../../../electron/src/video-tool-plan';
import { fakeProbe } from '../../test/mocks/videoTool';
import {
  effectiveQuality,
  qualityOptions,
  shownWindowQuality,
  windowQualityChoices,
} from './qualityOptions';

const GB2 = 2000 * 1024 * 1024;
const MB500 = 500 * 1024 * 1024;

const sized = (width: number, height: number, overrides = {}) =>
  fakeProbe({
    video: {
      ...fakeProbe().video,
      width,
      height,
      displayWidth: width,
      displayHeight: height,
    },
    ...overrides,
  });

const byId = (options: ReturnType<typeof qualityOptions>) =>
  Object.fromEntries(options.map((option) => [option.id, option]));

/**
 * A video this long, in a file as big as its 1.8 Mb/s picture and 128 kb/s
 * sound make it (the plan caps a re-encode at what the file holds).
 */
const lasting = (durationSec: number) => ({
  durationSec,
  size: Math.ceil(((1800 + 128) * 1000 * durationSec) / 8),
});

describe('qualityOptions', () => {
  it('offers every step, Original quality and Keep as is for a 1080p file that plays already', () => {
    const list = qualityOptions(sized(1920, 1080), GB2);
    const options = byId(list);
    expect(list.map((option) => option.id)).toEqual([
      '1080',
      '720',
      '540',
      '480',
      '360',
      'original',
      'keep',
    ]);
    expect(Object.values(options).every((option) => option.available)).toBe(
      true
    );
    // 20 minutes at 720p, capped at the source's own 1.8 Mb/s (not 720p's
    // 2.8): about 280 MiB at most, the MP4's overhead counted.
    expect(options['720'].estimateBytes).toBeGreaterThan(275 * 1024 * 1024);
    expect(options['720'].estimateBytes).toBeLessThan(285 * 1024 * 1024);
    expect(options['720'].width).toBe(1280);
    // An upper bound: the MP4's own bytes are counted too.
    expect(options['720'].estimateBytes).toBe(
      withMuxOverhead(((1800 + 128) * 1000 * 1200) / 8)
    );
  });

  it('never says more than the limit, overhead and all', () => {
    // An hour at 540p fills a public node's 500 MB with its streams alone.
    const options = byId(
      qualityOptions(sized(1920, 1080, lasting(3600)), MB500)
    );
    expect(options['540'].available).toBe(true);
    expect(options['540'].estimateBytes).toBeLessThanOrEqual(MB500);
  });

  it('greys steps above a DVD’s size and offers its own size', () => {
    const options = byId(
      qualityOptions(sized(1024, 576, { playableAsIs: false }), GB2)
    );
    expect(options['1080']).toMatchObject({
      available: false,
      reason: 'above-source',
    });
    expect(options['720']).toMatchObject({
      available: false,
      reason: 'above-source',
    });
    expect(options['540'].available).toBe(true);
    expect(options.original).toMatchObject({
      available: true,
      width: 1024,
      height: 576,
    });
    expect(options.keep).toBeUndefined();
  });

  it('turns the boxes for a portrait video', () => {
    const options = byId(qualityOptions(sized(1080, 1920), GB2));
    expect(options['1080'].available).toBe(true);
    expect(options['720']).toMatchObject({ width: 720, height: 1280 });
  });

  it('offers Original quality at a step’s own size too, not as an in-between size', () => {
    const options = byId(
      qualityOptions(sized(1920, 800, lasting(6300)), 500 * 1024 * 1024)
    );
    expect(options['1080'].reason).toBe('too-long');
    expect(options.original).toMatchObject({
      available: false,
      reason: 'too-long',
      between: false,
    });
  });

  it('keeps a widescreen film’s shape at its own step', () => {
    const options = byId(qualityOptions(sized(1920, 800), GB2));
    expect(options['1080']).toMatchObject({
      available: true,
      width: 1920,
      height: 800,
    });
    expect(options.original).toMatchObject({ available: true, between: false });
  });

  it('says how long a step could be when the video is too long for it', () => {
    const options = byId(
      qualityOptions(sized(1920, 1080, lasting(2 * 3600)), MB500)
    );
    expect(options['1080']).toMatchObject({
      available: false,
      reason: 'too-long',
    });
    // 98 % of 500 MiB at 1080p's floor (2000 + 160 kb/s): about 32 minutes.
    expect(options['1080'].maxDurationSec).toBeGreaterThan(31 * 60);
    expect(options['1080'].maxDurationSec).toBeLessThan(33 * 60);
    expect(options.keep).toMatchObject({ available: false, reason: 'too-big' });
    expect(options['360'].available).toBe(true);
  });

  it("estimates by what the source holds, not by its tag's claim", () => {
    // The film of 2026-11-16: its tag claimed 5.98 Mb/s, the window said
    // about 2 GB for 720p, and 2.06 GB came out of a 1.5 GB file.
    const film = fakeProbe({
      size: 1_505_029_098,
      durationSec: 6209.041,
      container: 'matroska,webm',
      playableAsIs: false,
      video: {
        ...fakeProbe().video,
        width: 1920,
        height: 804,
        displayWidth: 1920,
        displayHeight: 804,
        bitrate: 5_981_973,
      },
      audio: [
        {
          index: 1,
          codec: 'ac3',
          channels: 6,
          isDefault: true,
          bitrate: 320_000,
        },
      ],
    });
    const options = byId(qualityOptions(film, GB2));
    expect(options['720'].estimateBytes).toBeLessThan(1.4e9);
    // 1080p copies its picture: about the same size, at full resolution.
    expect(options['1080'].estimateBytes).toBeLessThan(1.45e9);
  });

  it('never offers a size bigger than the original', () => {
    // HEVC 1620×1080 in 1.6 GB for 1 h 49 min: 1080p and 720p were offered
    // at 2 GB (the limit), more than the file itself.
    const film = sized(1620, 1080, {
      size: Math.round(1.6 * 1024 * 1024 * 1024),
      durationSec: 6533,
      playableAsIs: false,
      video: {
        ...fakeProbe().video,
        codec: 'hevc',
        bitrate: undefined,
        width: 1620,
        height: 1080,
        displayWidth: 1620,
        displayHeight: 1080,
      },
      audio: [
        {
          index: 1,
          codec: 'aac',
          channels: 6,
          isDefault: true,
          bitrate: 384_000,
        },
      ],
    });
    const options = qualityOptions(film, GB2).filter(
      (option) => option.available
    );
    expect(options.map((option) => option.id)).toContain('original');
    for (const option of options) {
      expect(option.estimateBytes).toBeLessThanOrEqual(film.size);
    }
  });

  it('gives nothing without a video stream or a limit', () => {
    expect(qualityOptions(fakeProbe({ video: null }), GB2)).toEqual([]);
    expect(qualityOptions(sized(1920, 1080), 0)).toEqual([]);
    expect(qualityOptions(undefined, GB2)).toEqual([]);
  });
});

describe('effectiveQuality', () => {
  it('takes the preferred step when it fits', () => {
    const options = qualityOptions(sized(1920, 1080), GB2);
    expect(effectiveQuality(options, '720')).toEqual({
      quality: '720',
      steppedDown: false,
    });
  });

  it('keeps a smaller video at its own step rather than enlarging', () => {
    const options = qualityOptions(sized(1280, 720), GB2);
    expect(effectiveQuality(options, '1080')).toEqual({
      quality: '720',
      steppedDown: false,
    });
  });

  it('keeps a video between two steps at its own size', () => {
    const options = qualityOptions(sized(1024, 576), GB2);
    expect(effectiveQuality(options, '720').quality).toBe('original');
    expect(effectiveQuality(options, '480').quality).toBe('480');
  });

  it('steps down when the video is too long for the preferred step', () => {
    const options = qualityOptions(sized(1920, 1080, lasting(3600)), MB500);
    const chosen = effectiveQuality(options, '1080');
    expect(chosen.steppedDown).toBe(true);
    expect(['540', '480', '360']).toContain(chosen.quality);
  });

  it('honours the video’s own choice only when it’s available', () => {
    const options = qualityOptions(sized(1280, 720), GB2);
    expect(effectiveQuality(options, '720', '360').quality).toBe('360');
    expect(effectiveQuality(options, '720', '1080').quality).toBe('720');
    expect(effectiveQuality(options, '720', 'keep').quality).toBe('keep');
  });

  it('uses Original size for a video smaller than every step', () => {
    const options = qualityOptions(sized(320, 240), GB2);
    expect(effectiveQuality(options, '720').quality).toBe('original');
  });

  it('takes Original quality when chosen, else steps down from the top', () => {
    const fits = qualityOptions(sized(1920, 1080), GB2);
    expect(effectiveQuality(fits, 'original')).toEqual({
      quality: 'original',
      steppedDown: false,
    });
    // An hour at 1080p in a public node's 500 MB: too long at its own size.
    const tooLong = qualityOptions(sized(1920, 1080, lasting(3600)), MB500);
    expect(byId(tooLong).original.reason).toBe('too-long');
    const chosen = effectiveQuality(tooLong, 'original');
    expect(chosen.steppedDown).toBe(true);
    expect(['720', '540', '480', '360']).toContain(chosen.quality);
  });

  it('finds nothing when no quality fits', () => {
    const options = qualityOptions(
      sized(1920, 1080, { durationSec: 40 * 3600 }),
      GB2
    );
    expect(effectiveQuality(options, '1080')).toEqual({
      quality: null,
      steppedDown: true,
    });
  });
});

describe("the window's one quality choice", () => {
  const ids = (choices: ReturnType<typeof windowQualityChoices>) =>
    choices.filter((choice) => !choice.available).map((choice) => choice.id);

  it('greys the steps above every video: a 720p video greys 1080p', () => {
    const choices = windowQualityChoices([
      qualityOptions(sized(1280, 720), GB2),
    ]);
    expect(ids(choices)).toEqual(['1080']);
    expect(shownWindowQuality(choices, '1080')).toBe('720');
    expect(shownWindowQuality(choices, '540')).toBe('540');
  });

  it('opens a step when any of the videos reaches it', () => {
    const choices = windowQualityChoices([
      qualityOptions(sized(854, 480), GB2),
      qualityOptions(sized(1920, 1080), GB2),
    ]);
    expect(ids(choices)).toEqual([]);
  });

  it('keeps a step that is only too long for the limit (it steps down)', () => {
    const choices = windowQualityChoices([
      qualityOptions(sized(1920, 1080, lasting(3600)), MB500),
    ]);
    // Its file is too big to keep, though: Keep as is is greyed.
    expect(ids(choices)).toEqual(['keep']);
  });

  it('always offers Original quality', () => {
    const choices = windowQualityChoices([
      qualityOptions(sized(1280, 720), GB2),
    ]);
    expect(choices.find((choice) => choice.id === 'original')).toEqual({
      id: 'original',
      available: true,
    });
    expect(shownWindowQuality(choices, 'original')).toBe('original');
  });

  it('opens every step before a video is read', () => {
    expect(ids(windowQualityChoices([]))).toEqual([]);
    expect(ids(windowQualityChoices([[]]))).toEqual([]);
  });

  it('offers Keep as is when a video can keep its file, else the best step', () => {
    const keepable = qualityOptions(sized(1280, 720), GB2);
    expect(keepable.some((option) => option.id === 'keep')).toBe(true);
    const choices = windowQualityChoices([keepable]);
    expect(choices.map((choice) => choice.id)).toContain('keep');
    expect(effectiveQuality(keepable, 'keep').quality).toBe('keep');
    const notKeepable = qualityOptions(
      sized(1280, 720, { playableAsIs: false }),
      GB2
    );
    expect(effectiveQuality(notKeepable, 'keep').quality).toBe('720');
  });
});
