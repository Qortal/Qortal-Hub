/**
 * The real ffmpeg/ffprobe Hub ships, on a tiny generated clip: probe → plan
 * → encode → check the MP4. Skipped when the binaries for this platform
 * aren't built (CI) or no ffmpeg with test sources is on PATH to make clips.
 */
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, promises as fs, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VideoToolService, resolveFfmpegDir } from './video-tool';
import type { VideoJobEvent, VideoJobState } from './video-tool-types';

const binDir = resolveFfmpegDir({
  isPackaged: false,
  resourcesPath: '',
  appPath: path.resolve(__dirname, '..'),
});
const exe = process.platform === 'win32' ? '.exe' : '';
const shippedFfmpeg = path.join(binDir, `ffmpeg${exe}`);
const shippedFfprobe = path.join(binDir, `ffprobe${exe}`);

/** A full ffmpeg (with lavfi test sources and encoders) to make clips. */
function clipMaker(): string | null {
  for (const candidate of [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ]) {
    const result = spawnSync(candidate, ['-hide_banner', '-filters'], {
      encoding: 'utf8',
    });
    if (result.status === 0 && result.stdout.includes('testsrc2')) {
      return candidate;
    }
  }
  return null;
}

const maker = existsSync(shippedFfmpeg) ? clipMaker() : null;
const OWNER = 3;

/** Top-level MP4 box types, in file order. */
async function topLevelBoxes(filePath: string): Promise<string[]> {
  const data = await fs.readFile(filePath);
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    if (size === 1) size = Number(data.readBigUInt64BE(offset + 8));
    if (size < 8) break;
    boxes.push(type);
    offset += size;
  }
  return boxes;
}

function streamsOf(filePath: string) {
  return JSON.parse(
    execFileSync(shippedFfprobe, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      filePath,
    ]).toString('utf8')
  ) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      channels?: number;
      sample_rate?: string;
      side_data_list?: unknown[];
    }[];
    format: { duration: string; tags?: Record<string, string> };
  };
}

describe.skipIf(!maker)('video tool with the real ffmpeg', () => {
  const work = path.join(
    os.homedir(),
    '.cache',
    'video-publisher-test',
    `integration-${process.pid}-${Date.now()}`
  );
  const events: VideoJobEvent[] = [];
  let service: VideoToolService;

  const make = (args: string[]) =>
    execFileSync(maker, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

  beforeAll(() => {
    mkdirSync(work, { recursive: true });
    writeFileSync(
      path.join(work, 'track.srt'),
      '1\n00:00:00,500 --> 00:00:01,500\nHello <i>there</i>\n\n' +
        '2\n00:00:01,800 --> 00:00:02,600\nSecond line\n'
    );
    // "Žluťoučký kůň" in Windows-1250, as old Czech subtitles are.
    writeFileSync(
      path.join(work, 'clip.cs.srt'),
      Buffer.concat([
        Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\n'),
        Buffer.from([
          0x8e, 0x6c, 0x75, 0x9d, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b,
          0xf9, 0xf2,
        ]),
        Buffer.from('\r\n'),
      ])
    );
    // MKV: MPEG-4 Part 2 picture, 5.1 AC-3 sound, an SRT track; 3 s.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-i',
      path.join(work, 'track.srt'),
      '-t',
      '3',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:s',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-c:a',
      'ac3',
      '-ac',
      '6',
      '-c:s',
      'srt',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata',
      'title=Secret place',
      path.join(work, 'clip.mkv'),
    ]);
    // A busy picture at 2 Mb/s, no sound: its own bitrate is no cap at 360p.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=25',
      '-t',
      '3',
      '-c:v',
      'mpeg4',
      '-b:v',
      '2M',
      '-minrate',
      '2M',
      '-maxrate',
      '2M',
      '-bufsize',
      '2M',
      path.join(work, 'busy.mkv'),
    ]);
    // A phone-style clip: anamorphic, turned by the display matrix.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-t',
      '2',
      '-vf',
      'setsar=4/3',
      '-c:v',
      'mpeg4',
      path.join(work, 'flat.mp4'),
    ]);
    make([
      '-display_rotation',
      '90',
      '-i',
      path.join(work, 'flat.mp4'),
      '-c',
      'copy',
      path.join(work, 'turned.mp4'),
    ]);
    // H.264 with AC-3 (picture copied, sound converted) and with AAC (kept).
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=sample_rate=48000',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'ac3',
      path.join(work, 'h264-ac3.mkv'),
    ]);
    make([
      '-i',
      path.join(work, 'h264-ac3.mkv'),
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      path.join(work, 'h264-aac.mkv'),
    ]);
    // Interlaced 50 fields/s MPEG-2 in a transport stream, at 100 fps out.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=720x576:rate=100',
      '-t',
      '1',
      '-vf',
      'setsar=16/15',
      '-c:v',
      'mpeg2video',
      '-flags',
      '+ilme+ildct',
      '-top',
      '1',
      '-b:v',
      '4M',
      path.join(work, 'interlaced.ts'),
    ]);
    // MP4 with a tagged mov_text (tx3g) track, as phones and iTunes write.
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-i',
      path.join(work, 'track.srt'),
      '-t',
      '3',
      '-map',
      '0:v',
      '-map',
      '1:s',
      '-c:v',
      'mpeg4',
      '-c:s',
      'mov_text',
      '-metadata:s:s:0',
      'language=eng',
      path.join(work, 'movtext.mp4'),
    ]);
    // MicroDVD counts frames: 250 is 10 s at the clip's 25 fps.
    writeFileSync(path.join(work, 'movtext.sub'), '{25}{50}Hello\n');
    service = new VideoToolService({
      userDataDir: () => path.join(work, 'userData'),
      binDir: () => binDir,
      emit: (_owner, event) => events.push(event),
      fetch: async () => new Response(null, { status: 200 }),
      showSaveDialog: async () => ({ canceled: true }),
    });
  });

  afterAll(async () => {
    service?.shutdown();
    await fs.rm(work, { recursive: true, force: true });
  });

  async function finished(jobId: string): Promise<VideoJobState> {
    const end = Date.now() + 60_000;
    for (;;) {
      const state = [...events]
        .reverse()
        .find((event) => event.state.jobId === jobId)?.state;
      if (state && ['done', 'failed', 'cancelled'].includes(state.phase)) {
        return state;
      }
      if (Date.now() > end) throw new Error('job did not finish');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('reports the shipped ffmpeg, which writes AV1', async () => {
    const status = await service.status();
    expect(status).toMatchObject({ available: true, av1: true });
  });

  it('converts to AV1 with SVT-AV1, in one pass, on a fine clock', async () => {
    const [clip] = await service.addFiles(OWNER, [
      { path: path.join(work, 'busy.mkv'), name: 'busy.mkv' },
    ]);
    const job = service.startJob(OWNER, {
      sourceId: clip.id,
      quality: '360',
      codec: 'av1',
      subtitles: [],
      sizeLimitBytes: 2 * 1024 * 1024 * 1024,
    });
    const done = await finished(job.jobId);
    expect(done.errorDetail).toBeUndefined();
    expect(done.plan).toMatchObject({ codec: 'av1', twoPass: false });
    expect(done.output).toMatchObject({
      codec: 'av1',
      width: 640,
      height: 360,
    });
    const video = path.join(
      work,
      'userData',
      'video-publisher-jobs',
      job.jobId,
      'video.mp4'
    );
    const info = streamsOf(video);
    expect(info.streams[0]).toMatchObject({
      codec_type: 'video',
      codec_name: 'av1',
      pix_fmt: 'yuv420p',
    });
    // Every frame its own time: none shares one with the frame before.
    const times = execFileSync(shippedFfprobe, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=pts_time',
      '-of',
      'csv=p=0',
      video,
    ])
      .toString('utf8')
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(times.length).toBeGreaterThan(60);
    expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(true);
  }, 90_000);

  it('converts an MKV with AC-3 and subtitles into a faststart H.264/AAC MP4', async () => {
    const [clip, czech] = await service.addFiles(OWNER, [
      { path: path.join(work, 'clip.mkv'), name: 'clip.mkv' },
      { path: path.join(work, 'clip.cs.srt'), name: 'clip.cs.srt' },
    ]);
    const probe = await service.probe(OWNER, clip.id);
    expect(probe.video).toMatchObject({
      codec: 'mpeg4',
      displayWidth: 320,
      displayHeight: 240,
    });
    expect(probe.durationSec).toBeCloseTo(3, 0);
    expect(probe.audio).toMatchObject([{ codec: 'ac3', channels: 6 }]);
    expect(probe.subtitles).toMatchObject([
      { codec: 'subrip', kind: 'text', language: 'eng' },
    ]);
    expect(probe.playableAsIs).toBe(false);

    const job = service.startJob(OWNER, {
      sourceId: clip.id,
      quality: '360',
      subtitles: [
        { source: 'stream', index: probe.subtitles[0].index, language: 'en' },
        {
          source: 'file',
          sourceId: czech.id,
          language: 'cs',
          encoding: 'windows-1250',
        },
      ],
      sizeLimitBytes: 100 * 1024 * 1024,
    });
    const done = await finished(job.jobId);
    expect(done.errorDetail).toBeUndefined();
    expect(done).toMatchObject({
      phase: 'done',
      plan: { mode: 'encode', twoPass: false, width: 320, height: 240 },
      output: {
        width: 320,
        height: 240,
        hasAudio: true,
        mimeType: 'video/mp4',
        failedSubtitles: [],
      },
    });
    expect(
      events.some(
        (event) =>
          event.state.jobId === job.jobId &&
          event.state.phase === 'encoding' &&
          event.state.percent > 0 &&
          event.state.percent < 100
      ) || done.output.durationSec < 5
    ).toBe(true);

    const video = path.join(
      work,
      'userData',
      'video-publisher-jobs',
      job.jobId,
      'video.mp4'
    );
    const info = streamsOf(video);
    expect(info.streams.map((stream) => stream.codec_name)).toEqual([
      'h264',
      'aac',
    ]);
    expect(info.streams[0]).toMatchObject({ pix_fmt: 'yuv420p' });
    expect(info.streams[1]).toMatchObject({
      channels: 2,
      sample_rate: '48000',
    });
    // Metadata dropped (-map_metadata -1).
    expect(info.format.tags?.title).toBeUndefined();
    const boxes = await topLevelBoxes(video);
    expect(boxes.indexOf('moov')).toBeGreaterThanOrEqual(0);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));

    const [english, czechTrack] = done.output.subtitles;
    expect(english).toMatchObject({ id: 's0', language: 'en' });
    expect(czechTrack).toMatchObject({ id: 's1', language: 'cs' });
    const englishText = await service.readText(OWNER, job.jobId, 's0');
    expect(englishText).toMatch(/^WEBVTT/);
    // ffmpeg moves every stream by the input's start (AC-3 starts at
    // -5 ms here), so the cues keep in step with the picture.
    const [, cueStart] = /(\d\d:\d\d\.\d{3}) -->/.exec(englishText);
    const startSec =
      Number(cueStart.slice(0, 2)) * 60 + Number(cueStart.slice(3));
    expect(startSec).toBeGreaterThanOrEqual(0.5);
    expect(startSec).toBeLessThan(0.52);
    expect(englishText).toContain('Hello <i>there</i>');
    expect(await service.readText(OWNER, job.jobId, 's1')).toContain(
      'Žluťoučký kůň'
    );

    const frames = await service.frames(
      OWNER,
      { jobId: job.jobId },
      { count: 2, width: 160 }
    );
    expect(frames).toHaveLength(2);
    expect(frames[0].dataUrl).toMatch(/^data:image\/jpeg;base64,\/9j\//);

    const preview = await service.previewResponse(
      new Request(`hub-video://job/${job.jobId}/video.mp4`, {
        headers: { range: 'bytes=0-7' },
      }),
      'app://-'
    );
    expect(preview.status).toBe(206);
    const head = Buffer.from(await preview.arrayBuffer());
    expect(head.toString('latin1', 4, 8)).toBe('ftyp');

    await service.releaseJob(OWNER, job.jobId);
    expect(existsSync(video)).toBe(false);
  }, 90_000);

  it('fits a tight limit with two passes and cleans the pass logs', async () => {
    const [clip] = await service.addFiles(OWNER, [
      { path: path.join(work, 'busy.mkv'), name: 'busy.mkv' },
    ]);
    // 3 s at 360p: the cap would be 300 kB (800 kb/s, no sound; the source
    // has more); 250 kB forces two-pass.
    const limit = 250_000;
    const job = service.startJob(OWNER, {
      sourceId: clip.id,
      quality: '360',
      subtitles: [],
      sizeLimitBytes: limit,
    });
    const done = await finished(job.jobId);
    expect(done.errorDetail).toBeUndefined();
    expect(done.plan).toMatchObject({ twoPass: true });
    expect(done.output.size).toBeLessThanOrEqual(limit);
    expect(
      events.some(
        (event) =>
          event.state.jobId === job.jobId && event.state.phase === 'pass1'
      )
    ).toBe(true);
    const dir = path.join(work, 'userData', 'video-publisher-jobs', job.jobId);
    expect((await fs.readdir(dir)).sort()).toEqual(['subtitles', 'video.mp4']);
  }, 90_000);

  it("writes an MP4's mov_text track and times MicroDVD at the video's rate", async () => {
    const [clip, micro] = await service.addFiles(OWNER, [
      { path: path.join(work, 'movtext.mp4'), name: 'movtext.mp4' },
      { path: path.join(work, 'movtext.sub'), name: 'movtext.sub' },
    ]);
    const probe = await service.probe(OWNER, clip.id);
    expect(probe.subtitles).toMatchObject([
      { codec: 'mov_text', kind: 'text' },
    ]);
    const job = service.startJob(OWNER, {
      sourceId: clip.id,
      quality: '360',
      subtitles: [
        { source: 'stream', index: probe.subtitles[0].index, language: 'en' },
        { source: 'file', sourceId: micro.id, language: 'de' },
      ],
      sizeLimitBytes: 100 * 1024 * 1024,
    });
    const done = await finished(job.jobId);
    expect(done.errorDetail).toBeUndefined();
    expect(done.phase).toBe('done');
    expect(done.output.failedSubtitles).toEqual([]);
    expect(await service.readText(OWNER, job.jobId, 's0')).toContain(
      'Second line'
    );
    // {25}{50} at 25 fps is 1 s to 2 s (not 1.043 s at 23.976).
    expect(await service.readText(OWNER, job.jobId, 's1')).toMatch(
      /00:01\.000 --> 00:02\.000/
    );
  }, 90_000);

  it('copies an H.264 picture, and keeps H.264 + AAC as is', async () => {
    const [ac3, aac] = await service.addFiles(OWNER, [
      { path: path.join(work, 'h264-ac3.mkv'), name: 'h264-ac3.mkv' },
      { path: path.join(work, 'h264-aac.mkv'), name: 'h264-aac.mkv' },
    ]);
    const copy = service.startJob(OWNER, {
      sourceId: ac3.id,
      quality: '720',
      subtitles: [],
      sizeLimitBytes: 100 * 1024 * 1024,
    });
    const copied = await finished(copy.jobId);
    expect(copied.errorDetail).toBeUndefined();
    expect(copied.plan.mode).toBe('copy-video');
    expect((await service.probe(OWNER, aac.id)).playableAsIs).toBe(true);
    const keep = service.startJob(OWNER, {
      sourceId: aac.id,
      quality: 'keep',
      subtitles: [],
      sizeLimitBytes: 100 * 1024 * 1024,
    });
    const kept = await finished(keep.jobId);
    expect(kept.errorDetail).toBeUndefined();
    expect(kept).toMatchObject({
      phase: 'done',
      plan: { mode: 'keep' },
      output: { width: 320, height: 240, hasAudio: true },
    });
    for (const job of [copy, keep]) {
      const video = path.join(
        work,
        'userData',
        'video-publisher-jobs',
        job.jobId,
        'video.mp4'
      );
      const boxes = await topLevelBoxes(video);
      expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
      expect(streamsOf(video).streams.map((s) => s.codec_name)).toEqual([
        'h264',
        'aac',
      ]);
    }
  }, 90_000);

  it('deinterlaces, makes DVD pixels square and caps the frame rate', async () => {
    const [clip] = await service.addFiles(OWNER, [
      { path: path.join(work, 'interlaced.ts'), name: 'interlaced.ts' },
    ]);
    const probe = await service.probe(OWNER, clip.id);
    expect(probe.video).toMatchObject({
      codec: 'mpeg2video',
      interlaced: true,
      displayWidth: 768,
    });
    const job = service.startJob(OWNER, {
      sourceId: clip.id,
      quality: '480',
      subtitles: [],
      sizeLimitBytes: 100 * 1024 * 1024,
    });
    const done = await finished(job.jobId);
    expect(done.errorDetail).toBeUndefined();
    expect(done.output).toMatchObject({ width: 640, height: 480 });
    const [stream] = streamsOf(
      path.join(
        work,
        'userData',
        'video-publisher-jobs',
        job.jobId,
        'video.mp4'
      )
    ).streams as { avg_frame_rate?: string }[];
    // 100 fps halved twice, under 480p's cap of 30.
    expect(stream.avg_frame_rate).toBe('25/1');
  }, 90_000);

  it('shows a turned, anamorphic phone clip upright with square pixels', async () => {
    const [clip] = await service.addFiles(OWNER, [
      { path: path.join(work, 'turned.mp4'), name: 'turned.mp4' },
    ]);
    const probe = await service.probe(OWNER, clip.id);
    expect(probe.video).toMatchObject({
      width: 320,
      height: 240,
      displayWidth: 240,
      displayHeight: 427,
    });
    expect([90, 270]).toContain(probe.video.rotation);
    const job = service.startJob(OWNER, {
      sourceId: clip.id,
      quality: 'original',
      subtitles: [],
      sizeLimitBytes: 100 * 1024 * 1024,
    });
    const done = await finished(job.jobId);
    expect(done.errorDetail).toBeUndefined();
    expect(done.output).toMatchObject({
      width: 240,
      height: 426,
      hasAudio: false,
    });
    const video = path.join(
      work,
      'userData',
      'video-publisher-jobs',
      job.jobId,
      'video.mp4'
    );
    const [stream] = streamsOf(video).streams;
    // Turned in the pixels, not by a display matrix any more.
    expect(stream).toMatchObject({ width: 240, height: 426 });
    expect(stream.side_data_list ?? []).toEqual([]);
  }, 90_000);
});
