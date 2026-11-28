import { describe, expect, it } from 'vitest';
import {
  fpsRational,
  planVideoJob,
  retryTwoPassKbps,
  retryUnderOriginalKbps,
  sourceVideoKbps,
  subtitleFileArgs,
  subtitleStreamArgs,
  twoPassLogBytes,
  withMuxOverhead,
  withVideoBitrate,
  withVideoCap,
  type VideoPlan,
  type VideoPlanError,
  type VideoJobPaths,
} from './video-tool-plan';
import type { VideoJobSpec, VideoProbe } from './video-tool-types';

const GB = 1024 * 1024 * 1024;

type VideoOverrides = Partial<NonNullable<VideoProbe['video']>>;

function makeProbe(
  video: VideoOverrides = {},
  rest: Partial<Omit<VideoProbe, 'video'>> = {}
): VideoProbe {
  const width = video.width ?? 1920;
  const height = video.height ?? 1080;
  return {
    sourceId: 'src',
    name: 'film.mkv',
    size: 500 * 1024 * 1024,
    durationSec: 600,
    container: 'matroska,webm',
    video: {
      index: 0,
      codec: 'hevc',
      width,
      height,
      displayWidth: width,
      displayHeight: height,
      fps: 25,
      bitDepth: 8,
      pixFmt: 'yuv420p',
      hdr: false,
      interlaced: false,
      rotation: 0,
      ...video,
    },
    audio: [
      { index: 1, codec: 'ac3', channels: 6, isDefault: true, bitrate: 448000 },
    ],
    subtitles: [],
    playableAsIs: false,
    ...rest,
  };
}

const spec = (overrides: Partial<VideoJobSpec> = {}): VideoJobSpec => ({
  sourceId: 'src',
  quality: '720',
  subtitles: [],
  sizeLimitBytes: 2 * GB,
  ...overrides,
});

const paths: VideoJobPaths = {
  input: '/in/film.mkv',
  video: '/job/video.mp4',
  passLogPrefix: '/job/passlog',
  subtitle: (id) => `/job/subtitles/${id}.vtt`,
};

function ok(result: VideoPlan | VideoPlanError): VideoPlan {
  if (result.ok === false) {
    throw new Error(`expected a plan, got ${result.error}`);
  }
  return result;
}

function fail(result: VideoPlan | VideoPlanError): VideoPlanError {
  if (result.ok !== false) throw new Error('expected a plan error');
  return result;
}

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const graphOf = (plan: VideoPlan, pass = 0) =>
  argAfter(plan.passes[pass], '-filter_complex');

describe('planVideoJob: sizes', () => {
  it('fits a portrait video in the turned box', () => {
    const plan = ok(
      planVideoJob(makeProbe({ width: 1080, height: 1920 }), spec(), paths)
    );
    expect([plan.width, plan.height]).toEqual([720, 1280]);
    expect(graphOf(plan)).toContain('scale=720:1280');
    expect(plan.quality).toBe('720');
  });

  it('keeps a 2.40:1 film its shape', () => {
    const probe = makeProbe({ width: 1920, height: 800 });
    const at1080 = ok(planVideoJob(probe, spec({ quality: '1080' }), paths));
    expect([at1080.width, at1080.height]).toEqual([1920, 800]);
    expect(graphOf(at1080)).not.toContain('scale=');
    const at720 = ok(planVideoJob(probe, spec(), paths));
    expect([at720.width, at720.height]).toEqual([1280, 532]);
  });

  it('makes anamorphic pixels square', () => {
    const probe = makeProbe({
      codec: 'mpeg2video',
      width: 720,
      height: 576,
      displayWidth: 1024,
      displayHeight: 576,
    });
    const plan = ok(planVideoJob(probe, spec({ quality: 'original' }), paths));
    expect([plan.width, plan.height]).toEqual([1024, 576]);
    expect(graphOf(plan)).toContain('scale=1024:576,setsar=1');
    // 576 lines sit between 540p and 720p: 720p's settings, finer for
    // Original quality, and only the source's own bitrate as the cap.
    expect(plan.quality).toBe('720');
    expect(argAfter(plan.passes[0], '-crf')).toBe('19');
    expect(argAfter(plan.passes[0], '-maxrate')).toBe('6543k');
  });

  it('uses the display size of a rotated phone video', () => {
    const probe = makeProbe({
      codec: 'hevc',
      width: 1920,
      height: 1080,
      displayWidth: 1080,
      displayHeight: 1920,
      rotation: 90,
    });
    const plan = ok(planVideoJob(probe, spec(), paths));
    expect([plan.width, plan.height]).toEqual([720, 1280]);
    expect(graphOf(plan)).toContain('scale=720:1280');
  });

  it('resamples a turned anamorphic clip even when its width matches', () => {
    // 320×240 at 4:3 pixels, turned: shown 240×427, coded height 320.
    const probe = makeProbe({
      width: 320,
      height: 240,
      displayWidth: 240,
      displayHeight: 427,
      rotation: 270,
    });
    const plan = ok(planVideoJob(probe, spec({ quality: 'original' }), paths));
    expect([plan.width, plan.height]).toEqual([240, 426]);
    expect(graphOf(plan)).toContain('scale=240:426,setsar=1');
    expect(graphOf(plan)).not.toContain('crop=');
  });

  it('shrinks 4K into the 1080 box, also for original', () => {
    const probe = makeProbe({ width: 3840, height: 2160 });
    for (const quality of ['1080', 'original'] as const) {
      const plan = ok(planVideoJob(probe, spec({ quality }), paths));
      expect([plan.width, plan.height]).toEqual([1920, 1080]);
      expect(plan.quality).toBe('1080');
    }
  });

  it('never enlarges a source smaller than the chosen quality', () => {
    const probe = makeProbe({ width: 640, height: 360 });
    const plan = ok(planVideoJob(probe, spec({ quality: '1080' }), paths));
    expect([plan.width, plan.height]).toEqual([640, 360]);
    expect(graphOf(plan)).not.toContain('scale=');
    // The caps of what actually comes out.
    expect(plan.quality).toBe('360');
    expect(argAfter(plan.passes[0], '-crf')).toBe('26');
  });

  it('keeps a size between steps with original', () => {
    const probe = makeProbe({ width: 1024, height: 576 });
    const plan = ok(planVideoJob(probe, spec({ quality: 'original' }), paths));
    expect([plan.width, plan.height]).toEqual([1024, 576]);
    expect(graphOf(plan)).not.toContain('scale=');
    expect(plan.quality).toBe('720');
  });

  it('trims odd dimensions rather than resampling', () => {
    const probe = makeProbe({ width: 1281, height: 721 });
    const plan = ok(planVideoJob(probe, spec({ quality: '1080' }), paths));
    expect([plan.width, plan.height]).toEqual([1280, 720]);
    expect(graphOf(plan)).toContain('crop=1280:720:0:0');
    expect(graphOf(plan)).not.toContain('scale=');
  });
});

describe('planVideoJob: encoding settings', () => {
  it('writes the common H.264/AAC/MP4 settings and the input/output paths', () => {
    const plan = ok(planVideoJob(makeProbe(), spec(), paths));
    expect(plan.mode).toBe('encode');
    expect(plan.passes).toHaveLength(1);
    const args = plan.passes[0];
    expect(args).toEqual(
      expect.arrayContaining(['-progress', 'pipe:1', '-nostats'])
    );
    expect(argAfter(args, '-i')).toBe('file:/in/film.mkv');
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('medium');
    expect(argAfter(args, '-profile:v')).toBe('high');
    expect(argAfter(args, '-level:v')).toBe('4.1');
    expect(argAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(argAfter(args, '-g')).toBe('50');
    expect(argAfter(args, '-crf')).toBe('23');
    expect(argAfter(args, '-bufsize')).toBe('5600k');
    expect(argAfter(args, '-c:a')).toBe('aac');
    expect(argAfter(args, '-b:a')).toBe('128k');
    expect(argAfter(args, '-ac')).toBe('2');
    expect(argAfter(args, '-ar')).toBe('48000');
    expect(argAfter(args, '-map_metadata')).toBe('-1');
    expect(argAfter(args, '-map_chapters')).toBe('-1');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
    expect(argAfter(args, '-fps_mode')).toBe('passthrough');
    expect(args[args.length - 1]).toBe('file:/job/video.mp4');
    expect(graphOf(plan)).toBe(
      '[0:0]scale=1280:720,setsar=1,format=yuv420p[vout]'
    );
    expect(plan.estimateBytes).toBe(
      withMuxOverhead(((2800 + 128) * 1000 * 600) / 8)
    );
  });

  it('deinterlaces first', () => {
    const plan = ok(
      planVideoJob(makeProbe({ interlaced: true }), spec(), paths)
    );
    expect(graphOf(plan)).toMatch(/^\[0:0\]bwdif=mode=send_frame,/);
  });

  it('keeps a variable frame rate when under the cap', () => {
    const plan = ok(planVideoJob(makeProbe({ fps: 29.3 }), spec(), paths));
    expect(argAfter(plan.passes[0], '-fps_mode')).toBe('passthrough');
    expect(graphOf(plan)).not.toContain('fps=');
  });

  it('halves frame rates above the cap, exactly for NTSC rates', () => {
    const fast = ok(planVideoJob(makeProbe({ fps: 120 }), spec(), paths));
    expect(graphOf(fast)).toContain('fps=120000/2000');
    expect(fast.passes[0]).not.toContain('-fps_mode');
    expect(argAfter(fast.passes[0], '-g')).toBe('120');

    const ntsc = ok(
      planVideoJob(
        makeProbe({ fps: 60000 / 1001 }),
        spec({ quality: '480' }),
        paths
      )
    );
    expect(graphOf(ntsc)).toContain('fps=60000/2002');
    // 1080p at 60 is kept (its cap is 60) and needs level 4.2.
    const sixty = ok(
      planVideoJob(makeProbe({ fps: 60 }), spec({ quality: '1080' }), paths)
    );
    expect(graphOf(sixty)).not.toContain('fps=');
    expect(argAfter(sixty.passes[0], '-level:v')).toBe('4.2');
  });

  it('maps no sound when the source has none, or when asked', () => {
    const silent = ok(
      planVideoJob(makeProbe({}, { audio: [] }), spec(), paths)
    );
    expect(silent.hasAudio).toBe(false);
    expect(silent.audioIndex).toBeNull();
    expect(silent.passes[0]).toContain('-an');
    const muted = ok(
      planVideoJob(makeProbe(), spec({ audioIndex: null }), paths)
    );
    expect(muted.hasAudio).toBe(false);
    expect(muted.estimateBytes).toBe(withMuxOverhead((2800 * 1000 * 600) / 8));
  });

  it('picks the default sound, else the first, else the chosen one', () => {
    const audio = [
      { index: 1, codec: 'ac3', channels: 6, isDefault: false },
      { index: 2, codec: 'dts', channels: 6, isDefault: true },
      { index: 3, codec: 'aac', channels: 2, isDefault: false },
    ];
    const byDefault = ok(planVideoJob(makeProbe({}, { audio }), spec(), paths));
    expect(byDefault.audioIndex).toBe(2);
    expect(byDefault.passes[0]).toContain('0:2');
    const first = ok(
      planVideoJob(
        makeProbe(
          {},
          { audio: audio.map((stream) => ({ ...stream, isDefault: false })) }
        ),
        spec(),
        paths
      )
    );
    expect(first.audioIndex).toBe(1);
    const chosen = ok(
      planVideoJob(makeProbe({}, { audio }), spec({ audioIndex: 3 }), paths)
    );
    expect(chosen.audioIndex).toBe(3);
    expect(
      fail(planVideoJob(makeProbe({}, { audio }), spec({ audioIndex: 9 })))
        .error
    ).toBe('invalid-spec');
  });

  it('copies stereo AAC sound that is close to the planned rate', () => {
    const plan = ok(
      planVideoJob(
        makeProbe(
          {},
          {
            audio: [
              {
                index: 1,
                codec: 'aac',
                channels: 2,
                isDefault: true,
                bitrate: 160000,
              },
            ],
          }
        ),
        spec(),
        paths
      )
    );
    expect(argAfter(plan.passes[0], '-c:a')).toBe('copy');
    expect(plan.audioKbps).toBe(160);
  });

  it('treats HDR like any other source (flagged by the probe only)', () => {
    const plan = ok(
      planVideoJob(
        makeProbe({ hdr: true, bitDepth: 10, pixFmt: 'yuv420p10le' }),
        spec(),
        paths
      )
    );
    expect(argAfter(plan.passes[0], '-pix_fmt')).toBe('yuv420p');
  });
});

describe('planVideoJob: subtitles', () => {
  const subtitles: VideoProbe['subtitles'] = [
    {
      index: 2,
      codec: 'subrip',
      kind: 'text',
      isDefault: true,
      isForced: false,
      language: 'eng',
    },
    {
      index: 3,
      codec: 'hdmv_pgs_subtitle',
      kind: 'picture',
      isDefault: false,
      isForced: true,
      language: 'eng',
    },
  ];

  it('leaves subtitles out of the video passes and skips pictures', () => {
    const plan = ok(
      planVideoJob(
        makeProbe({}, { subtitles }),
        spec({
          subtitles: [
            { source: 'stream', index: 2, language: 'en', label: 'English' },
            { source: 'stream', index: 3, language: 'en' },
            {
              source: 'file',
              sourceId: 'cs-srt',
              language: 'cs',
              encoding: 'windows-1250',
            },
          ],
        }),
        paths
      )
    );
    const args = plan.passes[0];
    // A track ffmpeg can't convert must not fail the video: subtitles are
    // written in their own runs afterwards.
    expect(args[args.length - 1]).toBe('file:/job/video.mp4');
    expect(args).not.toContain('webvtt');
    expect(plan.subtitles).toEqual([
      {
        id: 's0',
        specIndex: 0,
        language: 'en',
        label: 'English',
        source: 'stream',
        streamIndex: 2,
      },
      {
        id: 's2',
        specIndex: 2,
        language: 'cs',
        source: 'file',
        sourceId: 'cs-srt',
        encoding: 'windows-1250',
      },
    ]);
    expect(plan.skippedSubtitles).toEqual([
      { specIndex: 1, language: 'en', reason: 'picture' },
    ]);
  });

  it('skips text tracks this build cannot decode', () => {
    const plan = ok(
      planVideoJob(
        makeProbe(
          {},
          {
            subtitles: [
              {
                index: 4,
                codec: 'dvb_teletext',
                kind: 'unsupported',
                isDefault: false,
                isForced: false,
                language: 'ger',
              },
            ],
          }
        ),
        spec({ subtitles: [{ source: 'stream', index: 4, language: 'de' }] }),
        paths
      )
    );
    expect(plan.subtitles).toEqual([]);
    expect(plan.skippedSubtitles).toEqual([
      { specIndex: 0, language: 'de', reason: 'unsupported' },
    ]);
  });

  it("writes a video's own tracks in one run of their own", () => {
    expect(
      subtitleStreamArgs('/in.mkv', [
        { streamIndex: 2, output: '/job/subtitles/s0.vtt' },
        { streamIndex: 5, output: '/job/subtitles/s1.vtt' },
      ])
    ).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'file:/in.mkv',
      '-map',
      '0:2',
      '-c:s',
      'webvtt',
      '-f',
      'webvtt',
      'file:/job/subtitles/s0.vtt',
      '-map',
      '0:5',
      '-c:s',
      'webvtt',
      '-f',
      'webvtt',
      'file:/job/subtitles/s1.vtt',
    ]);
  });

  it('burns a picture subtitle in with overlay', () => {
    const plan = ok(
      planVideoJob(
        makeProbe({ interlaced: true }, { subtitles }),
        spec({ burnSubtitleIndex: 3 }),
        paths
      )
    );
    expect(graphOf(plan)).toBe(
      '[0:0]bwdif=mode=send_frame[base];[base][0:3]' +
        'overlay=x=(W-w)/2:y=H-h:eof_action=pass,' +
        'scale=1280:720,setsar=1,format=yuv420p[vout]'
    );
  });

  it('refuses to burn in text (no libass) and unknown streams', () => {
    expect(
      fail(
        planVideoJob(
          makeProbe({}, { subtitles }),
          spec({ burnSubtitleIndex: 2 })
        )
      ).error
    ).toBe('burn-in-not-supported');
    expect(
      fail(
        planVideoJob(
          makeProbe({}, { subtitles }),
          spec({ subtitles: [{ source: 'stream', index: 7, language: 'en' }] })
        )
      ).error
    ).toBe('invalid-spec');
  });

  it('builds the external file conversion', () => {
    expect(subtitleFileArgs('/job/a.srt', '/job/a.vtt')).toEqual([
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'file:/job/a.srt',
      '-map',
      '0:s:0',
      '-c:s',
      'webvtt',
      '-f',
      'webvtt',
      'file:/job/a.vtt',
    ]);
    expect(
      subtitleFileArgs('/job/a.sub', '/job/a.vtt', ['-subfps', '25000/1000'])
    ).toEqual(expect.arrayContaining(['-subfps', '25000/1000', '-i']));
    const args = subtitleFileArgs('/job/a.sub', '/job/a.vtt', [
      '-subfps',
      '25',
    ]);
    expect(args.indexOf('-subfps')).toBeLessThan(args.indexOf('-i'));
  });

  it('writes NTSC rates exactly', () => {
    expect(fpsRational(23.976)).toBe('24000/1001');
    expect(fpsRational(25)).toBe('25000/1000');
  });
});

describe('planVideoJob: fast paths', () => {
  const playable = (overrides: VideoOverrides = {}) =>
    makeProbe(
      {
        codec: 'h264',
        bitrate: 2_000_000,
        width: 1280,
        height: 720,
        ...overrides,
      },
      {
        playableAsIs: true,
        audio: [
          {
            index: 1,
            codec: 'aac',
            channels: 2,
            isDefault: true,
            bitrate: 128000,
          },
        ],
      }
    );

  it('repackages with keep', () => {
    const plan = ok(planVideoJob(playable(), spec({ quality: 'keep' }), paths));
    expect(plan.mode).toBe('keep');
    expect(plan.passes[0]).toEqual(
      expect.arrayContaining(['-map', '0:0', '-map', '0:1', '-c', 'copy'])
    );
    expect(plan.passes[0]).not.toContain('libx264');
    expect(argAfter(plan.passes[0], '-movflags')).toBe('+faststart');
    expect(plan.estimateBytes).toBe(
      withMuxOverhead(((2000 + 128) * 1000 * 600) / 8)
    );
  });

  it('keeps an AV1 file as it is, named AV1', () => {
    const probe = playable({ codec: 'av1' });
    const plan = ok(planVideoJob(probe, spec({ quality: 'keep' }), paths));
    expect(plan.mode).toBe('keep');
    expect(plan.codec).toBe('av1');
    expect(argAfter(plan.passes[0], '-c')).toBe('copy');
    // H.264 stays H.264.
    expect(
      ok(planVideoJob(playable(), spec({ quality: 'keep' }), paths)).codec
    ).toBe('h264');
  });

  it('refuses keep when the source is not playable or too big', () => {
    expect(fail(planVideoJob(makeProbe(), spec({ quality: 'keep' })))).toEqual({
      ok: false,
      error: 'keep-not-allowed',
      detail: 'not-playable',
    });
    expect(
      fail(
        planVideoJob(
          playable(),
          spec({ quality: 'keep', sizeLimitBytes: 50 * 1024 * 1024 })
        )
      )
    ).toEqual({ ok: false, error: 'keep-not-allowed', detail: 'too-big' });
  });

  it('copies an H.264 picture that fits and converts only the sound', () => {
    const probe = playable();
    probe.audio = [
      { index: 1, codec: 'ac3', channels: 6, isDefault: true, bitrate: 384000 },
    ];
    const plan = ok(planVideoJob(probe, spec(), paths));
    expect(plan.mode).toBe('copy-video');
    expect(argAfter(plan.passes[0], '-c:v')).toBe('copy');
    expect(argAfter(plan.passes[0], '-c:a')).toBe('aac');
    expect(plan.passes[0]).not.toContain('-filter_complex');
  });

  it('re-encodes H.264 that is bigger than the box, too fast or 10-bit', () => {
    expect(
      ok(planVideoJob(playable({ width: 1920, height: 1080 }), spec(), paths))
        .mode
    ).toBe('encode');
    expect(
      ok(planVideoJob(playable({ bitrate: 9_000_000 }), spec(), paths)).mode
    ).toBe('encode');
    expect(
      ok(
        planVideoJob(
          playable({ bitDepth: 10, pixFmt: 'yuv420p10le' }),
          spec(),
          paths
        )
      ).mode
    ).toBe('encode');
    expect(ok(planVideoJob(playable({ fps: 120 }), spec(), paths)).mode).toBe(
      'encode'
    );
  });
});

describe('planVideoJob: the size budget', () => {
  it('counts the MP4 overhead in its estimate, so it is an upper bound', () => {
    // A 2-minute 1080p encode once came out 74.1 MB against an estimate of
    // 73.8 MB: the streams' bytes without the container's own.
    const probe = makeProbe(
      { width: 1920, height: 1080, codec: 'hevc' },
      { durationSec: 120 }
    );
    const plan = ok(planVideoJob(probe, spec({ quality: '1080' }), paths));
    const streams = Math.ceil(((plan.audioKbps + 5000) * 1000 * 120) / 8);
    expect(plan.mode).toBe('encode');
    expect(plan.estimateBytes).toBe(Math.ceil(streams * 1.015) + 256 * 1024);
    expect(withMuxOverhead(73.8 * 1024 * 1024)).toBeGreaterThan(
      74.1 * 1024 * 1024
    );
  });

  it('goes two-pass when the cap would overflow the limit', () => {
    // 1 hour at 720p: the cap would be (2800+128) kb/s × 3600 s ≈ 1.32 GB.
    // The source has bits to spare (4 GB), so its own bitrate isn't the cap.
    const probe = makeProbe({}, { durationSec: 3600, size: 4 * GB });
    const plan = ok(
      planVideoJob(probe, spec({ sizeLimitBytes: 1000 * 1000 * 1000 }), paths)
    );
    const budget = Math.floor(1e9 * 0.98);
    const videoKbps = Math.floor((budget * 8) / 3600 / 1000 - 128);
    expect(plan.twoPass).toBe(true);
    expect(plan.videoKbps).toBe(videoKbps);
    expect(plan.passes).toHaveLength(2);
    const [first, second] = plan.passes;
    expect(argAfter(first, '-pass')).toBe('1');
    expect(argAfter(first, '-passlogfile')).toBe('/job/passlog');
    expect(first.slice(-4)).toEqual(['-an', '-f', 'null', '-']);
    expect(argAfter(second, '-pass')).toBe('2');
    expect(argAfter(second, '-b:v')).toBe(`${videoKbps}k`);
    expect(argAfter(second, '-maxrate')).toBe(
      `${Math.round(videoKbps * 1.5)}k`
    );
    expect(argAfter(second, '-bufsize')).toBe(`${videoKbps * 3}k`);
    expect(second).not.toContain('-crf');
    // The streams fill the budget; with the MP4's overhead the estimate
    // stays an upper bound within the limit.
    expect(plan.estimateBytes).toBeGreaterThan(budget);
    expect(plan.estimateBytes).toBeLessThanOrEqual(1e9);
  });

  it('counts the two-pass stats files x264 keeps beside the MP4', () => {
    // 2 hours of 1080p at 24 fps: 120 × 68 macroblocks × 172,800 frames.
    const probe = makeProbe(
      { width: 1920, height: 1080, fps: 24 },
      { durationSec: 7200, size: 8 * GB }
    );
    const plan = ok(
      planVideoJob(
        probe,
        spec({ quality: '1080', sizeLimitBytes: 2000 * 1024 * 1024 }),
        paths
      )
    );
    expect(plan.twoPass).toBe(true);
    expect(plan.outputFps).toBe(24);
    const bytes = twoPassLogBytes(plan, 7200);
    expect(bytes).toBeGreaterThan(120 * 68 * 172_800);
    expect(bytes).toBeLessThan(1.6e9);
    const onePass = ok(planVideoJob(makeProbe(), spec(), paths));
    expect(twoPassLogBytes(onePass, 60)).toBe(0);
  });

  it('refuses before encoding when even the floor is too big', () => {
    // 3 hours at 720p in 500 MB is far below 1.1 Mb/s.
    const error = fail(
      planVideoJob(
        makeProbe({}, { durationSec: 3 * 3600 }),
        spec({ sizeLimitBytes: 500 * 1024 * 1024 })
      )
    );
    expect(error.error).toBe('too-long-for-limit');
    const budget = Math.floor(500 * 1024 * 1024 * 0.98);
    expect(error.maxDurationSec).toBe(
      Math.floor((budget * 8) / ((1100 + 128) * 1000))
    );
  });

  it('plans one pass when the duration is unknown', () => {
    const plan = ok(
      planVideoJob(makeProbe({}, { durationSec: 0 }), spec(), paths)
    );
    expect(plan.twoPass).toBe(false);
  });

  it('rejects a missing size limit or an unknown quality', () => {
    expect(
      fail(planVideoJob(makeProbe(), spec({ sizeLimitBytes: 0 }))).error
    ).toBe('invalid-spec');
    expect(
      fail(planVideoJob(makeProbe(), spec({ quality: '4k' as never }))).error
    ).toBe('invalid-spec');
    expect(
      fail(planVideoJob({ ...makeProbe(), video: null }, spec())).error
    ).toBe('no-video');
  });
});

describe("planVideoJob: the source's own bitrate", () => {
  const LIMIT = 2000 * 1024 * 1024;
  /**
   * A film seen in practice: a 1080p H.264 MKV of 1.5 GB whose BPS tag says
   * 5.98 Mb/s, where the file holds 1.62 at most beside its 320 kb/s sound.
   */
  const film = () =>
    makeProbe(
      { codec: 'h264', width: 1920, height: 804, bitrate: 5_981_973 },
      {
        size: 1_505_029_098,
        durationSec: 6209.041,
        audio: [
          {
            index: 1,
            codec: 'ac3',
            channels: 6,
            isDefault: true,
            bitrate: 320_000,
          },
        ],
      }
    );

  it('trusts what the file can hold over a stream tag that says more', () => {
    expect(sourceVideoKbps(film())).toBeCloseTo(1619.1, 1);
    // A tag the file can hold stands; without one, the file's own share.
    expect(sourceVideoKbps(makeProbe({ bitrate: 1_200_000 }))).toBe(1200);
    expect(
      sourceVideoKbps(makeProbe({}, { size: 600_000_000, durationSec: 600 }))
    ).toBeCloseTo(8000 - 448, 6);
    expect(
      sourceVideoKbps(makeProbe({ bitrate: 1_200_000 }, { durationSec: 0 }))
    ).toBe(1200);
    expect(sourceVideoKbps(makeProbe({}, { durationSec: 0 }))).toBeUndefined();
  });

  it('never gives a smaller picture more bits than the source had', () => {
    // It used to fill the limit at 720p (two-pass, 2.5 Mb/s of video):
    // 2.06 GB out of the 1.5 GB file.
    const plan = ok(
      planVideoJob(film(), spec({ sizeLimitBytes: LIMIT }), paths)
    );
    expect(plan.mode).toBe('encode');
    expect(plan.twoPass).toBe(false);
    const [pass] = plan.passes;
    expect(argAfter(pass, '-maxrate')).toBe('1619k');
    expect(argAfter(pass, '-bufsize')).toBe('3238k');
    expect(plan.estimateBytes).toBe(
      withMuxOverhead(Math.ceil(((1619 + 128) * 1000 * 6209.041) / 8))
    );
    expect(plan.estimateBytes).toBeLessThan(1.4e9);
  });

  it("copies the film's picture at 1080p and converts only the sound", () => {
    // The tag's 5.98 Mb/s made the copy look too big for the limit.
    const plan = ok(
      planVideoJob(
        film(),
        spec({ quality: '1080', sizeLimitBytes: LIMIT }),
        paths
      )
    );
    expect(plan.mode).toBe('copy-video');
    expect(plan.estimateBytes).toBeLessThan(1.45e9);
  });

  it('lets a newer codec keep more: H.264 needs more bits for its picture', () => {
    const maxrate = (codec: string) =>
      argAfter(
        ok(
          planVideoJob(makeProbe({ codec, bitrate: 1_200_000 }), spec(), paths)
        ).passes[0],
        '-maxrate'
      );
    expect(maxrate('h264')).toBe('1200k');
    expect(maxrate('mpeg2video')).toBe('1200k');
    expect(maxrate('hevc')).toBe('1800k');
    expect(maxrate('vp9')).toBe('1680k');
    expect(maxrate('av1')).toBe('2160k');
  });

  it("keeps the quality's own cap when the source has more, or is unknown", () => {
    const maxrate = (probe: VideoProbe) =>
      argAfter(ok(planVideoJob(probe, spec(), paths)).passes[0], '-maxrate');
    expect(maxrate(makeProbe({ codec: 'h264', bitrate: 6_000_000 }))).toBe(
      '2800k'
    );
    expect(maxrate(makeProbe({}, { durationSec: 0 }))).toBe('2800k');
    // A near-still picture: never under 200 kb/s, while its original has
    // room for that.
    expect(maxrate(makeProbe({ codec: 'h264', bitrate: 50_000 }))).toBe('200k');
  });

  it('lowers the near-still floor to what keeps the file within the original', () => {
    // 10 minutes of a still picture at 50 kb/s with 48 kb/s AAC: 7.35 MB.
    const still = makeProbe(
      { codec: 'h264', width: 1280, height: 720, bitrate: 50_000 },
      {
        size: ((50 + 48) * 1000 * 600) / 8,
        audio: [
          {
            index: 1,
            codec: 'aac',
            channels: 2,
            isDefault: true,
            bitrate: 48_000,
          },
        ],
      }
    );
    const plan = ok(planVideoJob(still, spec({ quality: '480' }), paths));
    expect(plan.mode).toBe('encode');
    const maxrate = Number.parseInt(argAfter(plan.passes[0], '-maxrate'));
    expect(maxrate).toBeLessThan(200);
    expect(maxrate).toBeGreaterThan(0);
    expect(plan.estimateBytes).toBeLessThanOrEqual(still.size);
  });

  it('no longer refuses a long video that fits at its own bitrate', () => {
    // 4 hours of 720p MPEG-4 at 700 kb/s: the 720p cap (2.8 Mb/s) overflowed
    // the limit and the two-pass rate fell under the floor: "too long".
    const lecture = makeProbe(
      { codec: 'mpeg4', width: 1280, height: 720, bitrate: 700_000 },
      {
        durationSec: 4 * 3600,
        size: ((700 + 128) * 1000 * 4 * 3600) / 8,
        audio: [
          {
            index: 1,
            codec: 'mp3',
            channels: 2,
            isDefault: true,
            bitrate: 128_000,
          },
        ],
      }
    );
    const plan = ok(
      planVideoJob(lecture, spec({ sizeLimitBytes: LIMIT }), paths)
    );
    expect(plan.twoPass).toBe(false);
    // Its own 700 kb/s, less the MP4's own bytes: never bigger than it.
    expect(argAfter(plan.passes[0], '-maxrate')).toBe('687k');
    expect(plan.estimateBytes).toBeLessThanOrEqual(lecture.size);
  });

  /**
   * A film like one tried in practice: HEVC 1620×1080 in 1.6 GB for
   * 1 h 49 min, AAC 5.1 sound. 1080p and 720p were offered at 2 GB.
   */
  const hevcFilm = () =>
    makeProbe(
      { codec: 'hevc', width: 1620, height: 1080 },
      {
        size: Math.round(1.6 * GB),
        durationSec: 6533,
        audio: [
          {
            index: 1,
            codec: 'aac',
            channels: 6,
            isDefault: true,
            bitrate: 384_000,
          },
        ],
      }
    );

  it('never plans a file bigger than the original', () => {
    const film = hevcFilm();
    for (const quality of ['1080', '720', 'original'] as const) {
      const plan = ok(
        planVideoJob(film, spec({ quality, sizeLimitBytes: LIMIT }), paths)
      );
      expect(plan.estimateBytes).toBeLessThanOrEqual(film.size);
    }
    // The cap says so too: the streams fit the original, overhead and all.
    const plan = ok(planVideoJob(film, spec({ sizeLimitBytes: LIMIT }), paths));
    const maxrate = Number.parseInt(argAfter(plan.passes[0], '-maxrate'));
    expect(
      withMuxOverhead(Math.ceil(((maxrate + 128) * 1000 * 6533) / 8))
    ).toBeLessThanOrEqual(film.size);
  });
});

/**
 * The window says no quality comes out bigger than the original
 * (quality.never_bigger): also when the 200 kb/s floor would lift the cap,
 * and when a copied picture's sound is converted.
 */
describe('planVideoJob: never bigger than the original, low bitrates', () => {
  const sizeOf = (videoKbps: number, audioKbps: number, seconds: number) =>
    Math.round(((videoKbps + audioKbps) * 1000 * seconds) / 8);

  it('holds for a low-bitrate video that is encoded again', () => {
    // An hour of a 720p screen recording: H.264 at 120 kb/s, AAC at 64.
    const probe = makeProbe(
      { codec: 'h264', width: 1280, height: 720, bitrate: 120_000 },
      {
        size: sizeOf(120, 64, 3600),
        durationSec: 3600,
        audio: [
          {
            index: 1,
            codec: 'aac',
            channels: 2,
            isDefault: true,
            bitrate: 64_000,
          },
        ],
      }
    );
    const plan = ok(planVideoJob(probe, spec({ codec: 'av1' })));
    expect(plan.mode).toBe('encode');
    expect(plan.estimateBytes).toBeLessThanOrEqual(probe.size);
  });

  it('holds for a copied picture whose sound is converted', () => {
    // 20 minutes of 720p H.264 at 500 kb/s with Opus sound at 32 kb/s.
    const probe = makeProbe(
      { codec: 'h264', width: 1280, height: 720, bitrate: 500_000 },
      {
        size: sizeOf(500, 32, 1200),
        durationSec: 1200,
        audio: [
          {
            index: 1,
            codec: 'opus',
            channels: 2,
            isDefault: true,
            bitrate: 32_000,
          },
        ],
      }
    );
    const plan = ok(planVideoJob(probe, spec()));
    expect(plan.mode).toBe('copy-video');
    expect(plan.estimateBytes).toBeLessThanOrEqual(probe.size);
    // Its sound at no more than the original's own rate.
    expect(plan.audioKbps).toBeLessThanOrEqual(32);
    expect(argAfter(plan.passes[0], '-b:a')).toBe(`${plan.audioKbps}k`);
  });

  it('converts sound at no more than its own rate, nor under 64 kb/s', () => {
    // An HEVC picture is encoded; its Opus sound at 32 kb/s becomes AAC at
    // 64, not at the step's 128.
    const probe = makeProbe(
      { codec: 'hevc', width: 1280, height: 720, bitrate: 600_000 },
      {
        size: sizeOf(600, 32, 1200),
        durationSec: 1200,
        audio: [
          {
            index: 1,
            codec: 'opus',
            channels: 2,
            isDefault: true,
            bitrate: 32_000,
          },
        ],
      }
    );
    const plan = ok(planVideoJob(probe, spec(), paths));
    expect(plan.audioKbps).toBe(64);
    expect(argAfter(plan.passes[0], '-b:a')).toBe('64k');
    expect(plan.estimateBytes).toBeLessThanOrEqual(probe.size);
  });

  it('holds on every path: steps, Original quality, Keep as is, AV1 and H.264', () => {
    const aac = (kbps: number, channels = 2) => [
      {
        index: 1,
        codec: 'aac',
        channels,
        isDefault: true,
        bitrate: kbps * 1000,
      },
    ];
    const probes: VideoProbe[] = [
      // Low bitrates, as in the two cases above.
      makeProbe(
        { codec: 'h264', width: 1280, height: 720, bitrate: 120_000 },
        { size: sizeOf(120, 64, 3600), durationSec: 3600, audio: aac(64) }
      ),
      makeProbe(
        { codec: 'h264', width: 1280, height: 720, bitrate: 500_000 },
        {
          size: sizeOf(500, 32, 1200),
          durationSec: 1200,
          audio: [
            {
              index: 1,
              codec: 'opus',
              channels: 2,
              isDefault: true,
              bitrate: 32_000,
            },
          ],
        }
      ),
      // A playable MP4 (Keep as is), its streams filling the file.
      makeProbe(
        { codec: 'h264', width: 1920, height: 1080, bitrate: 2_000_000 },
        {
          size: sizeOf(2000, 128, 600),
          playableAsIs: true,
          audio: aac(128),
        }
      ),
      // 5.1 AAC beside a copied picture, and a busy picture of 8 Mb/s.
      makeProbe(
        { codec: 'h264', width: 1920, height: 1080, bitrate: 8_000_000 },
        { size: sizeOf(8000, 192, 1800), durationSec: 1800, audio: aac(192, 6) }
      ),
      // An AV1 picture (copied with AV1), and a long one that goes two-pass
      // or capped under a tight limit.
      makeProbe(
        { codec: 'av1', width: 1920, height: 1080, bitrate: 1_000_000 },
        { size: sizeOf(1000, 96, 1200), durationSec: 1200, audio: aac(96) }
      ),
      makeProbe(
        { codec: 'hevc', width: 1920, height: 1080, bitrate: 3_000_000 },
        { size: sizeOf(3000, 448, 7200), durationSec: 7200 }
      ),
    ];
    const qualities = [
      '1080',
      '720',
      '480',
      '360',
      'original',
      'keep',
    ] as const;
    for (const [index, probe] of probes.entries()) {
      for (const quality of qualities) {
        for (const codec of ['h264', 'av1'] as const) {
          for (const sizeLimitBytes of [2 * GB, 500 * 1024 * 1024]) {
            const plan = planVideoJob(
              probe,
              spec({ quality, codec, sizeLimitBytes }),
              paths
            );
            if (plan.ok === false) continue;
            expect(
              plan.estimateBytes,
              `probe ${index}, ${quality}, ${codec}, ${plan.mode}`
            ).toBeLessThanOrEqual(probe.size);
          }
        }
      }
    }
  });
});

describe('planVideoJob: Original quality', () => {
  const LIMIT = 2000 * 1024 * 1024;

  it('copies an H.264 picture whatever its bitrate, when it fits the limit', () => {
    // 30 minutes of 1080p H.264 at 8 Mb/s: over 1080p's cap, so the step
    // re-encodes it, while Original quality keeps the picture as it is.
    const probe = makeProbe(
      { codec: 'h264', bitrate: 8_000_000 },
      {
        size: Math.ceil(((8000 + 448) * 1000 * 1800) / 8),
        durationSec: 1800,
      }
    );
    const original = ok(
      planVideoJob(
        probe,
        spec({ quality: 'original', sizeLimitBytes: LIMIT }),
        paths
      )
    );
    expect(original.mode).toBe('copy-video');
    expect(
      ok(
        planVideoJob(
          probe,
          spec({ quality: '1080', sizeLimitBytes: LIMIT }),
          paths
        )
      ).mode
    ).toBe('encode');
  });

  it("encodes finer, without the step's own cap, never past the original", () => {
    // HEVC at 6 Mb/s: 1080p stops at its 5 Mb/s cap and CRF 22; Original
    // quality goes up to what the original's size allows, at CRF 18.
    const probe = makeProbe(
      { codec: 'hevc', bitrate: 6_000_000 },
      { size: Math.ceil(((6000 + 448) * 1000 * 600) / 8) }
    );
    const step = ok(planVideoJob(probe, spec({ quality: '1080' }), paths));
    expect(argAfter(step.passes[0], '-crf')).toBe('22');
    expect(argAfter(step.passes[0], '-maxrate')).toBe('5000k');
    const original = ok(
      planVideoJob(probe, spec({ quality: 'original' }), paths)
    );
    expect(argAfter(original.passes[0], '-crf')).toBe('18');
    expect(
      Number.parseInt(argAfter(original.passes[0], '-maxrate'))
    ).toBeGreaterThan(5000);
    expect(original.estimateBytes).toBeLessThanOrEqual(probe.size);
  });

  it("keeps the step's cap when nothing is known of the source", () => {
    const plan = ok(
      planVideoJob(
        makeProbe({}, { durationSec: 0 }),
        spec({ quality: 'original' }),
        paths
      )
    );
    expect(argAfter(plan.passes[0], '-maxrate')).toBe('5000k');
  });
});

describe('planVideoJob: frame timing', () => {
  it('keeps the source timing on a fine clock, unless the rate is capped', () => {
    // On the frame rate's own clock a film's millisecond timestamps landed
    // two frames on one tick (one film: 419 of its first 1,439 frames).
    for (const codec of ['h264', 'av1'] as const) {
      const [pass] = ok(
        planVideoJob(makeProbe(), spec({ codec }), paths)
      ).passes;
      expect(argAfter(pass, '-fps_mode')).toBe('passthrough');
      expect(argAfter(pass, '-enc_time_base:v')).toBe('1:90000');
    }
    const capped = ok(planVideoJob(makeProbe({ fps: 120 }), spec(), paths))
      .passes[0];
    expect(capped).not.toContain('-enc_time_base:v');
    expect(capped).not.toContain('passthrough');
  });
});

describe('planVideoJob: a frame rate that averages just over the cap', () => {
  const fpsOf = (fps: number, quality: VideoJobSpec['quality']) =>
    ok(planVideoJob(makeProbe({ codec: 'hevc', fps }), spec({ quality })))
      .outputFps;

  it('keeps a phone clip shot at 30 its 30 frames a second', () => {
    // 157 frames in 5.2 s average 30.19: ffprobe counts frames over time.
    expect(fpsOf(157 / 5.2, '480')).toBeGreaterThan(29);
    expect(fpsOf(30.08, '360')).toBeGreaterThan(29);
  });

  it('halves a clip shot at 60, rather than cutting it to a third', () => {
    expect(fpsOf(60.2, '480')).toBeGreaterThan(29);
    expect(fpsOf(60.2, '720')).toBeGreaterThan(59);
  });

  it('still halves real 50 and 60 for the small sizes', () => {
    expect(fpsOf(50, '480')).toBe(25);
    expect(fpsOf(60, '480')).toBe(30);
    expect(fpsOf(60000 / 1001, '540')).toBeCloseTo(29.97, 2);
    expect(fpsOf(120, '720')).toBe(60);
    expect(fpsOf(120, '360')).toBe(30);
  });

  it('treats an average a little off a real rate as that rate', () => {
    // [shot at, divided by at 480p (30 at most), at 720p (60 at most)]
    const rates: [number, number, number][] = [
      [24000 / 1001, 1, 1],
      [24, 1, 1],
      [25, 1, 1],
      [30000 / 1001, 1, 1],
      [30, 1, 1],
      [48, 2, 1],
      [50, 2, 1],
      [60000 / 1001, 2, 1],
      [60, 2, 1],
      [120, 4, 2],
    ];
    for (const [shot, small, large] of rates) {
      for (const off of [0.97, 0.995, 1, 1.005, 1.03]) {
        const fps = shot * off;
        expect(fpsOf(fps, '480'), `${fps} at 480p`).toBeCloseTo(fps / small, 6);
        expect(fpsOf(fps, '720'), `${fps} at 720p`).toBeCloseTo(fps / large, 6);
      }
    }
  });
});

describe('planVideoJob: AV1', () => {
  const LIMIT = 2000 * 1024 * 1024;
  const av1 = (overrides: Partial<VideoJobSpec> = {}) =>
    spec({ codec: 'av1', ...overrides });

  it('writes SVT-AV1 at preset 8, its CRF and caps a share of x264’s', () => {
    // A source with bits to spare: the step's own cap applies.
    const probe = makeProbe({}, { size: 4 * GB });
    const plan = ok(planVideoJob(probe, av1(), paths));
    expect(plan.codec).toBe('av1');
    const [pass] = plan.passes;
    expect(argAfter(pass, '-c:v')).toBe('libsvtav1');
    expect(argAfter(pass, '-preset')).toBe('8');
    expect(argAfter(pass, '-pix_fmt')).toBe('yuv420p');
    // x264's 23 at 720p, plus 9; 2800 kb/s × 0.6.
    expect(argAfter(pass, '-crf')).toBe('32');
    expect(argAfter(pass, '-maxrate')).toBe('1680k');
    expect(argAfter(pass, '-bufsize')).toBe('3360k');
    expect(pass).not.toContain('libx264');
    expect(pass).not.toContain('-profile:v');
    // Original quality: finer still (x264's 18 at 1080p, plus 9).
    const original = ok(
      planVideoJob(probe, av1({ quality: 'original' }), paths)
    ).passes[0];
    expect(argAfter(original, '-crf')).toBe('27');
  });

  it('plans a smaller file than H.264 for the same film', () => {
    // HEVC 1620×1080, 1.6 GB, 1 h 49 min: capped by its own bitrate.
    const film = makeProbe(
      { codec: 'hevc', width: 1620, height: 1080 },
      { size: Math.round(1.6 * GB), durationSec: 6533 }
    );
    const h264 = ok(planVideoJob(film, spec({ sizeLimitBytes: LIMIT }), paths));
    const plan = ok(planVideoJob(film, av1({ sizeLimitBytes: LIMIT }), paths));
    expect(plan.estimateBytes).toBeLessThan(h264.estimateBytes * 0.8);
  });

  it('copies an AV1 picture, and re-encodes H.264 at a step', () => {
    const av1Source = makeProbe(
      { codec: 'av1', width: 1280, height: 720, bitrate: 900_000 },
      { size: 200 * 1024 * 1024 }
    );
    expect(ok(planVideoJob(av1Source, av1(), paths)).mode).toBe('copy-video');
    const tenBit = makeProbe(
      {
        codec: 'av1',
        width: 1280,
        height: 720,
        bitrate: 900_000,
        bitDepth: 10,
        pixFmt: 'yuv420p10le',
      },
      { size: 200 * 1024 * 1024 }
    );
    expect(ok(planVideoJob(tenBit, av1(), paths)).mode).toBe('copy-video');
    // With H.264 chosen, an AV1 source is written as H.264.
    expect(ok(planVideoJob(av1Source, spec(), paths)).codec).toBe('h264');
    // An H.264 picture is written as AV1 at a step (smaller), but kept as
    // it is for Original quality.
    const h264Source = makeProbe(
      { codec: 'h264', width: 1280, height: 720, bitrate: 2_000_000 },
      { size: 200 * 1024 * 1024 }
    );
    const step = ok(planVideoJob(h264Source, av1(), paths));
    expect(step.mode).toBe('encode');
    expect(step.codec).toBe('av1');
    const original = ok(
      planVideoJob(h264Source, av1({ quality: 'original' }), paths)
    );
    expect(original.mode).toBe('copy-video');
    expect(original.codec).toBe('h264');
  });

  it('fits a tight limit in one capped pass, and retries lower if over', () => {
    // An hour at 720p in 500 MB: AV1 has no two-pass here.
    const probe = makeProbe({}, { durationSec: 3600, size: 4 * GB });
    const limit = 500 * 1000 * 1000;
    const plan = ok(planVideoJob(probe, av1({ sizeLimitBytes: limit }), paths));
    const fitting = Math.floor(
      (Math.floor(limit * 0.98) * 8) / 3600 / 1000 - 128
    );
    expect(plan.twoPass).toBe(false);
    expect(plan.capFit).toBe(true);
    expect(plan.videoKbps).toBe(fitting);
    expect(plan.passes).toHaveLength(1);
    expect(argAfter(plan.passes[0], '-maxrate')).toBe(`${fitting}k`);
    expect(plan.passes[0]).not.toContain('-pass');
    expect(plan.estimateBytes).toBeLessThanOrEqual(limit);
    // Over the limit anyway: the pass again with a lower cap.
    const kbps = retryTwoPassKbps(plan, limit * 1.02, limit, 3600);
    expect(kbps).toBeLessThan(fitting);
    const again = withVideoCap(plan.passes[0], kbps);
    expect(argAfter(again, '-maxrate')).toBe(`${kbps}k`);
    expect(argAfter(again, '-bufsize')).toBe(`${kbps * 2}k`);
    expect(argAfter(again, '-crf')).toBe(argAfter(plan.passes[0], '-crf'));
  });

  it('says too long at AV1’s own floor', () => {
    // 3 hours at 720p in 500 MiB: under AV1's 660 kb/s floor too.
    const error = fail(
      planVideoJob(
        makeProbe({}, { durationSec: 3 * 3600, size: 8 * GB }),
        av1({ sizeLimitBytes: 500 * 1024 * 1024 })
      )
    );
    expect(error.error).toBe('too-long-for-limit');
    const budget = Math.floor(500 * 1024 * 1024 * 0.98);
    expect(error.maxDurationSec).toBe(
      Math.floor((budget * 8) / ((660 + 128) * 1000))
    );
  });
});

describe('never bigger than the original', () => {
  // 20 minutes of a dense 1 GB 1080p file at 720p: CRF capped at the source.
  const capped = () =>
    ok(
      planVideoJob(
        makeProbe({}, { durationSec: 1200, size: 1e9 }),
        spec({ sizeLimitBytes: 2e9 }),
        paths
      )
    );

  it('runs a one-pass encode that came out bigger again, with a lower cap', () => {
    const plan = capped();
    expect(plan.twoPass).toBe(false);
    expect(plan.maxrateKbps).toBeGreaterThan(0);
    expect(argAfter(plan.passes[0], '-maxrate')).toBe(`${plan.maxrateKbps}k`);
    const kbps = retryUnderOriginalKbps(plan, 1.1e9, 1e9, 1200);
    const audioBytes = (plan.audioKbps * 1000 * 1200) / 8;
    expect(kbps).toBe(
      Math.floor(
        (plan.maxrateKbps * (1e9 * 0.96 - audioBytes)) / (1.1e9 - audioBytes)
      )
    );
    const again = withVideoCap(plan.passes[0], kbps);
    expect(argAfter(again, '-maxrate')).toBe(`${kbps}k`);
    expect(argAfter(again, '-crf')).toBe(argAfter(plan.passes[0], '-crf'));
  });

  it('leaves alone a result that is not bigger, and copies', () => {
    const plan = capped();
    expect(retryUnderOriginalKbps(plan, 1e9, 1e9, 1200)).toBeNull();
    expect(retryUnderOriginalKbps(plan, 0.8e9, 1e9, 1200)).toBeNull();
    const keep = ok(
      planVideoJob(
        makeProbe(
          { codec: 'h264', bitrate: 2_000_000, width: 1280, height: 720 },
          {
            playableAsIs: true,
            audio: [
              {
                index: 1,
                codec: 'aac',
                channels: 2,
                isDefault: true,
                bitrate: 128000,
              },
            ],
          }
        ),
        spec({ quality: 'keep' }),
        paths
      )
    );
    expect(retryUnderOriginalKbps(keep, 2e9, 1e9, 1200)).toBeNull();
  });
});

describe('retrying an overshoot', () => {
  // An hour with bits to spare (4 GB): the limit, not the source, decides.
  const twoPass = () =>
    ok(
      planVideoJob(
        makeProbe({}, { durationSec: 3600, size: 4 * GB }),
        spec({ sizeLimitBytes: 1e9 }),
        paths
      )
    );

  it('lowers only the video bitrate of a too-big two-pass result', () => {
    const plan = twoPass();
    const kbps = retryTwoPassKbps(plan, 1.01e9, 1e9, 3600);
    const audioBytes = (128 * 1000 * 3600) / 8;
    expect(kbps).toBe(
      Math.floor(
        (plan.videoKbps * (1e9 * 0.96 - audioBytes)) / (1.01e9 - audioBytes)
      )
    );
    const retried = withVideoBitrate(plan.passes[1], kbps);
    expect(argAfter(retried, '-b:v')).toBe(`${kbps}k`);
    expect(argAfter(retried, '-maxrate')).toBe(`${Math.round(kbps * 1.5)}k`);
    expect(argAfter(retried, '-bufsize')).toBe(`${kbps * 3}k`);
    expect(argAfter(retried, '-b:a')).toBe('128k');
    expect(retried).toHaveLength(plan.passes[1].length);
  });

  it('does not retry one-pass jobs or hopeless cases', () => {
    const onePass = ok(planVideoJob(makeProbe(), spec(), paths));
    expect(retryTwoPassKbps(onePass, 3e9, 2e9, 600)).toBeNull();
    expect(retryTwoPassKbps(twoPass(), 1.01e9, 1e9, 0)).toBeNull();
    expect(retryTwoPassKbps(twoPass(), 1.01e9, 1000, 3600)).toBeNull();
  });
});
