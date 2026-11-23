import { describe, expect, it } from 'vitest';
import {
  ProbeSummaryError,
  parseRational,
  summarizeProbe,
  type FfprobeJson,
} from './video-tool-probe';

const source = { id: 'src-1', name: 'film.mkv', size: 1_000_000 };

const videoStream = (overrides: Record<string, unknown> = {}) => ({
  index: 0,
  codec_type: 'video',
  codec_name: 'h264',
  profile: 'High',
  width: 1920,
  height: 1080,
  sample_aspect_ratio: '1:1',
  pix_fmt: 'yuv420p',
  avg_frame_rate: '30000/1001',
  r_frame_rate: '30000/1001',
  field_order: 'progressive',
  disposition: { default: 1, attached_pic: 0 },
  ...overrides,
});

const probeOf = (
  streams: Record<string, unknown>[],
  format: FfprobeJson['format'] = {
    format_name: 'matroska,webm',
    duration: '120.5',
  }
) => summarizeProbe({ streams, format } as FfprobeJson, source);

describe('summarizeProbe', () => {
  it('summarizes a plain H.264 + AAC file as playable', () => {
    const probe = probeOf([
      videoStream({ bit_rate: '4000000' }),
      {
        index: 1,
        codec_type: 'audio',
        codec_name: 'aac',
        channels: 2,
        bit_rate: '128000',
        tags: { language: 'eng' },
        disposition: { default: 1 },
      },
    ]);
    expect(probe).toMatchObject({
      sourceId: 'src-1',
      name: 'film.mkv',
      size: 1_000_000,
      durationSec: 120.5,
      container: 'matroska,webm',
      playableAsIs: true,
      video: {
        index: 0,
        codec: 'h264',
        profile: 'High',
        width: 1920,
        height: 1080,
        displayWidth: 1920,
        displayHeight: 1080,
        bitDepth: 8,
        hdr: false,
        interlaced: false,
        rotation: 0,
        bitrate: 4_000_000,
      },
      audio: [
        {
          index: 1,
          codec: 'aac',
          channels: 2,
          bitrate: 128_000,
          language: 'eng',
          isDefault: true,
        },
      ],
      subtitles: [],
    });
    expect(probe.video.fps).toBeCloseTo(29.97, 2);
  });

  it('skips cover art and uses the real video stream', () => {
    const probe = probeOf([
      videoStream({
        index: 0,
        codec_name: 'mjpeg',
        width: 600,
        height: 600,
        disposition: { attached_pic: 1 },
      }),
      videoStream({ index: 1, codec_name: 'hevc' }),
    ]);
    expect(probe.video.index).toBe(1);
    expect(probe.video.codec).toBe('hevc');
  });

  it('applies the sample aspect ratio to the display size (anamorphic DVD)', () => {
    const probe = probeOf([
      videoStream({
        codec_name: 'mpeg2video',
        width: 720,
        height: 576,
        sample_aspect_ratio: '64:45',
        field_order: 'tt',
      }),
    ]);
    expect(probe.video).toMatchObject({
      width: 720,
      height: 576,
      displayWidth: 1024,
      displayHeight: 576,
      interlaced: true,
    });
    expect(probe.playableAsIs).toBe(false);
  });

  it('turns the display size for a phone video rotated by the display matrix', () => {
    const probe = probeOf([
      videoStream({
        side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
      }),
    ]);
    expect(probe.video).toMatchObject({
      rotation: 90,
      width: 1920,
      height: 1080,
      displayWidth: 1080,
      displayHeight: 1920,
    });
  });

  it('reads the older rotate tag and normalizes 180/270', () => {
    expect(
      probeOf([videoStream({ tags: { rotate: '270' } })]).video
    ).toMatchObject({ rotation: 270, displayWidth: 1080 });
    expect(
      probeOf([
        videoStream({
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: 180 }],
        }),
      ]).video
    ).toMatchObject({ rotation: 180, displayWidth: 1920 });
  });

  it('flags HDR and 10-bit from the transfer and the pixel format', () => {
    const probe = probeOf([
      videoStream({
        codec_name: 'hevc',
        pix_fmt: 'yuv420p10le',
        color_transfer: 'smpte2084',
      }),
    ]);
    expect(probe.video).toMatchObject({ hdr: true, bitDepth: 10 });
    expect(
      probeOf([videoStream({ color_transfer: 'arib-std-b67' })]).video.hdr
    ).toBe(true);
    expect(
      probeOf([videoStream({ bits_per_raw_sample: '10' })]).video.bitDepth
    ).toBe(10);
  });

  it('is not playable as is with 10-bit H.264 or non-AAC default sound', () => {
    expect(
      probeOf([videoStream({ pix_fmt: 'yuv420p10le' })]).playableAsIs
    ).toBe(false);
    expect(
      probeOf([
        videoStream(),
        { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6 },
      ]).playableAsIs
    ).toBe(false);
    // No sound at all is fine.
    expect(probeOf([videoStream()]).playableAsIs).toBe(true);
  });

  it('is playable as is in AV1 too, at 8 or 10 bits, with AAC sound', () => {
    expect(
      probeOf([videoStream({ codec_name: 'av1', pix_fmt: 'yuv420p' })])
        .playableAsIs
    ).toBe(true);
    expect(
      probeOf([videoStream({ codec_name: 'av1', pix_fmt: 'yuv420p10le' })])
        .playableAsIs
    ).toBe(true);
    expect(
      probeOf([
        videoStream({ codec_name: 'av1' }),
        { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 },
      ]).playableAsIs
    ).toBe(true);
    // Opus sound, 4:4:4, or HEVC: converted.
    expect(
      probeOf([
        videoStream({ codec_name: 'av1' }),
        { index: 1, codec_type: 'audio', codec_name: 'opus', channels: 2 },
      ]).playableAsIs
    ).toBe(false);
    expect(
      probeOf([videoStream({ codec_name: 'av1', pix_fmt: 'yuv444p' })])
        .playableAsIs
    ).toBe(false);
    expect(probeOf([videoStream({ codec_name: 'hevc' })]).playableAsIs).toBe(
      false
    );
  });

  it('judges playability by the default sound, else the first', () => {
    const probe = probeOf([
      videoStream(),
      { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6 },
      {
        index: 2,
        codec_type: 'audio',
        codec_name: 'aac',
        channels: 2,
        disposition: { default: 1 },
      },
    ]);
    expect(probe.playableAsIs).toBe(true);
  });

  it('tells picture subtitles from text ones and keeps forced/default', () => {
    const probe = probeOf([
      videoStream(),
      {
        index: 2,
        codec_type: 'subtitle',
        codec_name: 'subrip',
        tags: { language: 'ger', title: 'Deutsch' },
        disposition: { default: 1, forced: 0 },
      },
      {
        index: 3,
        codec_type: 'subtitle',
        codec_name: 'hdmv_pgs_subtitle',
        tags: { language: 'eng' },
        disposition: { forced: 1 },
      },
      { index: 4, codec_type: 'subtitle', codec_name: 'dvd_subtitle' },
      {
        index: 5,
        codec_type: 'subtitle',
        codec_name: 'ass',
        tags: { language: 'und' },
      },
    ]);
    expect(probe.subtitles).toEqual([
      {
        index: 2,
        codec: 'subrip',
        language: 'ger',
        title: 'Deutsch',
        isDefault: true,
        kind: 'text',
        isForced: false,
      },
      {
        index: 3,
        codec: 'hdmv_pgs_subtitle',
        language: 'eng',
        title: undefined,
        isDefault: false,
        kind: 'picture',
        isForced: true,
      },
      {
        index: 4,
        codec: 'dvd_subtitle',
        language: undefined,
        title: undefined,
        isDefault: false,
        kind: 'picture',
        isForced: false,
      },
      {
        index: 5,
        codec: 'ass',
        language: undefined,
        title: undefined,
        isDefault: false,
        kind: 'text',
        isForced: false,
      },
    ]);
  });

  it('marks subtitle codecs this build cannot decode as unsupported', () => {
    const probe = probeOf([
      videoStream(),
      { index: 1, codec_type: 'subtitle', codec_name: 'dvb_teletext' },
      { index: 2, codec_type: 'subtitle', codec_name: 'hdmv_text_subtitle' },
      { index: 3, codec_type: 'subtitle', codec_name: 'eia_608' },
      { index: 4, codec_type: 'subtitle', codec_name: 'mov_text' },
    ]);
    expect(probe.subtitles.map((track) => [track.codec, track.kind])).toEqual([
      ['dvb_teletext', 'unsupported'],
      ['hdmv_text_subtitle', 'unsupported'],
      ['eia_608', 'unsupported'],
      ['mov_text', 'text'],
    ]);
  });

  it('falls back from a missing average rate and ignores timebase rates', () => {
    expect(
      probeOf([videoStream({ avg_frame_rate: '0/0', r_frame_rate: '25/1' })])
        .video.fps
    ).toBe(25);
    expect(
      probeOf([videoStream({ avg_frame_rate: '0/0', r_frame_rate: '1000/1' })])
        .video.fps
    ).toBe(30);
  });

  it('reads Matroska BPS and DURATION tags when the numbers are missing', () => {
    const probe = probeOf(
      [
        videoStream({
          tags: { 'BPS-eng': '2500000', DURATION: '00:01:23.500000000' },
        }),
      ],
      { format_name: 'matroska,webm' }
    );
    expect(probe.durationSec).toBeCloseTo(83.5, 3);
    expect(probe.video.bitrate).toBe(2_500_000);
  });

  it('throws no-video for a sound-only file and probe-failed for junk', () => {
    expect(() =>
      probeOf([{ index: 0, codec_type: 'audio', codec_name: 'mp3' }])
    ).toThrowError(ProbeSummaryError);
    try {
      probeOf([{ index: 0, codec_type: 'audio', codec_name: 'mp3' }]);
    } catch (error) {
      expect((error as ProbeSummaryError).code).toBe('no-video');
    }
    try {
      summarizeProbe({} as FfprobeJson, source);
    } catch (error) {
      expect((error as ProbeSummaryError).code).toBe('probe-failed');
    }
  });

  it('parses rationals', () => {
    expect(parseRational('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRational('64:45')).toBeCloseTo(1.4222, 3);
    expect(parseRational('0:1')).toBeUndefined();
    expect(parseRational('N/A')).toBeUndefined();
    expect(parseRational(undefined)).toBeUndefined();
  });
});
