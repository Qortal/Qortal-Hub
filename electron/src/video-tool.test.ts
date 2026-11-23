import { EventEmitter } from 'events';
import { existsSync, mkdirSync, promises as fs, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VideoToolService,
  chunkFormData,
  decodeSubtitleBytes,
  fileResponse,
  isAllowedNodeEndpoint,
  isChunkEndpoint,
  isPathPublishEndpoint,
  isThisPcEndpoint,
  legacySubtitleEncoding,
  listFolder,
  looksLikePictureSub,
  microdvdTiming,
  nodeFileName,
  normalizeJobSpec,
  registerVideoToolIpc,
  resolveFfmpegDir,
  safeOutputName,
  type VideoToolDeps,
} from './video-tool';
import {
  VIDEO_TOOL_CHANNELS,
  videoToolErrorCode,
  type VideoJobEvent,
  type VideoJobState,
} from './video-tool-types';
import { joinNodeEndpoint } from '../../src/utils/nodeEndpointPath';

const OWNER = 7;
const MiB = 1024 * 1024;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number | undefined = undefined;
  killedWith: string | null = null;
  /** SIGSTOP/SIGCONT received: they pause it, it doesn't exit. */
  signals: string[] = [];
  private closed = false;

  constructor(
    readonly command: string,
    readonly args: string[]
  ) {
    super();
  }

  kill(signal?: string) {
    if (signal === 'SIGSTOP' || signal === 'SIGCONT') {
      this.signals.push(signal);
      return true;
    }
    this.killedWith = signal ?? 'SIGTERM';
    this.exit(null, this.killedWith);
    return true;
  }

  exit(code: number | null, signal: string | null = null) {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    // After the streams' last data events, like a real process.
    setTimeout(() => this.emit('close', code, signal), 5);
  }
}

type Behaviour = (child: FakeChild) => void | Promise<void>;

const ffprobeJson = (overrides: Record<string, unknown> = {}) => ({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'hevc',
      width: 1920,
      height: 1080,
      sample_aspect_ratio: '1:1',
      pix_fmt: 'yuv420p',
      avg_frame_rate: '25/1',
      disposition: { default: 1 },
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'ac3',
      channels: 6,
      disposition: { default: 1 },
    },
  ],
  format: { format_name: 'matroska,webm', duration: '10.0' },
  ...overrides,
});

const fileArgs = (args: string[]) =>
  args.filter((arg) => arg.startsWith('file:')).map((arg) => arg.slice(5));

/** Writes every output an encode/subtitle run names, then exits 0. */
const writeOutputs =
  (videoBytes = 1000): Behaviour =>
  async (child) => {
    const [, ...outputs] = fileArgs(child.args);
    for (const output of outputs) {
      await fs.writeFile(
        output,
        output.endsWith('.vtt') ? 'WEBVTT\n\n' : Buffer.alloc(videoBytes, 1)
      );
    }
    child.stdout.write('out_time_us=5000000\nspeed=2.0x\nprogress=continue\n');
    await new Promise((resolve) => setTimeout(resolve, 5));
    child.stdout.write('out_time_us=10000000\nspeed=2.0x\nprogress=end\n');
    child.exit(0);
  };

const outputProbe = {
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1280,
      height: 720,
      pix_fmt: 'yuv420p',
      avg_frame_rate: '25/1',
    },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 },
  ],
  format: { format_name: 'mov,mp4', duration: '10.0' },
};

let root: string;
let mediaDir: string;
let binDir: string;
let events: VideoJobEvent[];
let children: FakeChild[];
let probeOf: (filePath: string) => unknown;
let encode: Behaviour;
let frame: Behaviour;
let deps: VideoToolDeps;
let service: VideoToolService;
/** What `ffmpeg -encoders` lists (Hub's build: SVT-AV1 and x264). */
let encodersList: string;
let encodersCode: number;

beforeEach(() => {
  root = path.join(
    os.homedir(),
    '.cache',
    'video-publisher-test',
    `unit-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mediaDir = path.join(root, 'media');
  binDir = path.join(root, 'bin');
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, 'ffmpeg'), '');
  writeFileSync(path.join(binDir, 'ffprobe'), '');
  writeFileSync(path.join(mediaDir, 'film.mkv'), Buffer.alloc(4096, 2));
  events = [];
  children = [];
  probeOf = (filePath) =>
    filePath.endsWith('video.mp4') ? outputProbe : ffprobeJson();
  encode = writeOutputs();
  encodersList =
    ' V....D libx264    libx264 H.264\n V..... libsvtav1  SVT-AV1 encoder\n';
  encodersCode = 0;
  frame = (child) => {
    child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    child.exit(0);
  };
  deps = {
    userDataDir: () => path.join(root, 'userData'),
    binDir: () => binDir,
    emit: (_owner, event) => events.push(event),
    fetch: vi.fn(async () => new Response('ok', { status: 200 })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    freeBytes: async () => 1024 * 1024 * MiB,
    cpuThreads: () => 16,
    platform: 'linux',
    spawn: ((command: string, args: string[]) => {
      const child = new FakeChild(command, args);
      children.push(child);
      setTimeout(() => {
        if (command.endsWith('ffprobe')) {
          child.stdout.write(JSON.stringify(probeOf(fileArgs(args)[0] ?? '')));
          child.exit(0);
        } else if (args.includes('-version')) {
          child.stdout.write('ffmpeg version 8.0.1 Copyright (c) 2000-2025\n');
          child.exit(0);
        } else if (args.includes('-encoders')) {
          child.stdout.write(encodersList);
          child.exit(encodersCode);
        } else if (args.includes('image2')) void frame(child);
        else void encode(child);
      }, 1);
      return child as never;
    }) as VideoToolDeps['spawn'],
  };
  service = new VideoToolService(deps);
});

afterEach(async () => {
  service.shutdown();
  await fs.rm(root, { recursive: true, force: true });
});

async function waitFor<T>(check: () => T | undefined | false, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForGone(filePath: string) {
  const end = Date.now() + 3000;
  while (
    await fs.stat(filePath).then(
      () => true,
      () => false
    )
  ) {
    if (Date.now() > end) throw new Error(`${filePath} is still there`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const lastState = (jobId: string): VideoJobState | undefined =>
  [...events].reverse().find((event) => event.state.jobId === jobId)?.state;

const finished = (jobId: string) =>
  waitFor(() => {
    const state = lastState(jobId);
    return state && ['done', 'failed', 'cancelled'].includes(state.phase)
      ? state
      : undefined;
  });

async function addFilm(name = 'film.mkv') {
  const [source] = await service.addFiles(OWNER, [
    { path: path.join(mediaDir, name), name },
  ]);
  return source;
}

const rejectionCode = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => videoToolErrorCode(error)
  );

describe('status', () => {
  it('reports the version, free space, AV1 writing, the threads and pausing', async () => {
    expect(await service.status()).toEqual({
      available: true,
      ffmpegVersion: '8.0.1',
      freeBytes: 1024 * 1024 * MiB,
      av1: true,
      cpuThreads: 16,
      canPause: true,
    });
  });

  it('says no AV1 when this ffmpeg has no SVT-AV1', async () => {
    encodersList = ' V....D libx264    libx264 H.264\n';
    expect(await service.status()).toMatchObject({
      available: true,
      av1: false,
    });
  });

  it('asks again whether AV1 can be written after a look-up that failed', async () => {
    // The list of encoders doesn't come the first time (a busy PC).
    encodersList = '';
    encodersCode = 1;
    expect(await service.status()).toMatchObject({
      available: true,
      av1: false,
    });

    encodersList = ' V..... libsvtav1  SVT-AV1 encoder\n';
    encodersCode = 0;
    expect(await service.status()).toMatchObject({
      available: true,
      av1: true,
    });
    // An answer that came is kept: the list isn't asked for a third time.
    expect(await service.status()).toMatchObject({ av1: true });
    expect(
      children.filter((child) => child.args.includes('-encoders'))
    ).toHaveLength(2);
  });

  it('says missing-binary without ffmpeg', async () => {
    await fs.rm(path.join(binDir, 'ffprobe'));
    expect(await service.status()).toEqual({
      available: false,
      reason: 'missing-binary',
    });
  });

  it('says whether both programs came with this Hub, for the page to get the window', async () => {
    expect(service.hasBinaries()).toBe(true);
    await fs.rm(path.join(binDir, 'ffprobe'));
    expect(service.hasBinaries()).toBe(false);
    // A folder named like it is no program.
    mkdirSync(path.join(binDir, 'ffprobe'));
    expect(service.hasBinaries()).toBe(false);
    await fs.rm(path.join(binDir, 'ffprobe'), { recursive: true });
    writeFileSync(path.join(binDir, 'ffprobe'), '');
    await fs.rm(path.join(binDir, 'ffmpeg'));
    expect(service.hasBinaries()).toBe(false);
  });

  it("looks for Windows' .exe names on Windows", () => {
    const windows = new VideoToolService({ ...deps, platform: 'win32' });
    expect(windows.hasBinaries()).toBe(false);
    writeFileSync(path.join(binDir, 'ffmpeg.exe'), '');
    writeFileSync(path.join(binDir, 'ffprobe.exe'), '');
    expect(windows.hasBinaries()).toBe(true);
  });
});

describe('sources', () => {
  it('keeps only existing absolute files, sized by main', async () => {
    mkdirSync(path.join(mediaDir, 'folder.mkv'));
    const sources = await service.addFiles(OWNER, [
      { path: path.join(mediaDir, 'film.mkv'), name: 'film.mkv', size: 1 },
      { path: 'relative.mkv', name: 'relative.mkv' },
      { path: path.join(mediaDir, 'gone.mkv'), name: 'gone.mkv' },
      { path: path.join(mediaDir, 'folder.mkv'), name: 'folder.mkv' },
      { path: `${mediaDir}/a\0b`, name: 'x' },
      'nonsense',
    ]);
    expect(sources).toEqual([
      { id: expect.any(String), name: 'film.mkv', size: 4096, kind: 'video' },
    ]);
    expect(await rejectionCode(service.addFiles(OWNER, 'nope' as never))).toBe(
      'invalid-request'
    );
  });

  it("opens the system's picker with the window's words, and adds what's picked", async () => {
    const pick = {
      folder: false,
      title: 'Choose videos',
      buttonLabel: 'Choose for publishing',
      filterName: 'Videos and subtitles',
    };
    deps.showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: [path.join(mediaDir, 'film.mkv')],
    }));
    const sources = await service.pickFiles(OWNER, pick);
    expect(sources).toEqual([
      { id: expect.any(String), name: 'film.mkv', size: 4096, kind: 'video' },
    ]);
    expect(deps.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Choose videos',
        buttonLabel: 'Choose for publishing',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Videos and subtitles',
            extensions: expect.arrayContaining(['mkv', 'mp4', 'vob', 'srt']),
          },
        ],
      })
    );
    deps.showOpenDialog = vi.fn(async () => ({
      canceled: true,
      filePaths: [],
    }));
    expect(await service.pickFiles(OWNER, pick)).toEqual([]);
    for (const bad of [
      null,
      { ...pick, folder: 'yes' },
      { ...pick, buttonLabel: 'x'.repeat(201) },
      { ...pick, title: 3 },
    ]) {
      expect(await rejectionCode(service.pickFiles(OWNER, bad))).toBe(
        'invalid-request'
      );
    }
  });

  it('reads a picked folder like the folder picker, without hidden files or links', async () => {
    const show = path.join(root, 'The Show');
    mkdirSync(path.join(show, 'Season 1'), { recursive: true });
    mkdirSync(path.join(show, '.hidden'));
    writeFileSync(path.join(show, 'Season 1', 'E10.mkv'), 'x');
    writeFileSync(path.join(show, 'Season 1', 'E2.mkv'), 'x');
    writeFileSync(path.join(show, 'Season 1', 'E2.srt'), 'x');
    writeFileSync(path.join(show, '.hidden', 'secret.mkv'), 'x');
    writeFileSync(path.join(show, '.DS_Store'), 'x');
    await fs.symlink(
      path.join(mediaDir, 'film.mkv'),
      path.join(show, 'link.mkv')
    );
    expect(
      (await listFolder(show, 100)).map((file) => file.relativePath)
    ).toEqual([
      'The Show/Season 1/E2.mkv',
      'The Show/Season 1/E2.srt',
      'The Show/Season 1/E10.mkv',
    ]);
    expect(await listFolder(show, 2)).toHaveLength(2);

    deps.showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: [show],
    }));
    const sources = await service.pickFiles(OWNER, {
      folder: true,
      title: 'Choose a folder',
      buttonLabel: 'Choose for publishing',
      filterName: 'Videos and subtitles',
    });
    expect(deps.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openDirectory'],
        filters: undefined,
      })
    );
    expect(sources.map((source) => [source.name, source.kind])).toEqual([
      ['E2.mkv', 'video'],
      ['E2.srt', 'subtitle'],
      ['E10.mkv', 'video'],
    ]);
  });

  it('probes once per unchanged file and only for its page', async () => {
    const source = await addFilm();
    const probe = await service.probe(OWNER, source.id);
    expect(probe).toMatchObject({ sourceId: source.id, durationSec: 10 });
    await service.probe(OWNER, source.id);
    expect(children.filter((c) => c.command.endsWith('ffprobe'))).toHaveLength(
      1
    );
    expect(children[0].args.slice(-1)[0]).toBe(
      `file:${path.join(mediaDir, 'film.mkv')}`
    );
    expect(await rejectionCode(service.probe(OWNER + 1, source.id))).toBe(
      'source-missing'
    );
  });

  describe('a video whose file does not give its length', () => {
    // A browser's screen recording (MediaRecorder's WebM).
    const recording = () =>
      ffprobeJson({ format: { format_name: 'matroska,webm' } });
    const measuring = () =>
      children.filter(
        (child) =>
          !child.command.endsWith('ffprobe') && child.args.includes('null')
      );

    it('measures it once by reading the file through, and keeps it', async () => {
      probeOf = (filePath) =>
        filePath.endsWith('video.mp4') ? outputProbe : recording();
      const source = await addFilm();
      const [first, second] = await Promise.all([
        service.probe(OWNER, source.id),
        service.probe(OWNER, source.id),
      ]);
      // out_time of the last block the run printed: 10 s.
      expect(first.durationSec).toBe(10);
      expect(second.durationSec).toBe(10);
      expect(await service.probe(OWNER, source.id)).toMatchObject({
        durationSec: 10,
      });
      expect(measuring()).toHaveLength(1);
      const [run] = measuring();
      expect(run.args).toEqual(
        expect.arrayContaining(['-map', '0:0', '-c', 'copy', '-f', 'null'])
      );
      expect(fileArgs(run.args)).toEqual([path.join(mediaDir, 'film.mkv')]);
    });

    it('spreads the cover frames over the video, not all at its start', async () => {
      probeOf = (filePath) =>
        filePath.endsWith('video.mp4') ? outputProbe : recording();
      const source = await addFilm();
      const frames = await service.frames(
        OWNER,
        { sourceId: source.id },
        { count: 4 }
      );
      expect(new Set(frames.map((entry) => entry.timeSec)).size).toBe(4);
      expect(Math.max(...frames.map((entry) => entry.timeSec))).toBeGreaterThan(
        5
      );
    });

    it('plans and shows progress with the measured length', async () => {
      probeOf = (filePath) =>
        filePath.endsWith('video.mp4') ? outputProbe : recording();
      const source = await addFilm();
      const job = service.startJob(OWNER, {
        sourceId: source.id,
        quality: '720',
        subtitles: [],
        sizeLimitBytes: 2 * 1024 * MiB,
      });
      await finished(job.jobId);
      const percents = events
        .filter((event) => event.state.jobId === job.jobId)
        .map((event) => event.state.percent);
      // Half-way at 5 s of 10, rather than 0 % until the end.
      expect(percents).toContain(50);
      // The estimate counts the 10 s, not the MP4's own bytes alone.
      expect(lastState(job.jobId)?.plan?.estimateBytes).toBeGreaterThan(
        300 * 1024
      );
    });

    it('stays unknown, read only once, when measuring fails', async () => {
      probeOf = (filePath) =>
        filePath.endsWith('video.mp4') ? outputProbe : recording();
      encode = (child) => child.exit(1);
      const source = await addFilm();
      expect((await service.probe(OWNER, source.id)).durationSec).toBe(0);
      expect((await service.probe(OWNER, source.id)).durationSec).toBe(0);
      expect(measuring()).toHaveLength(1);
    });

    it('is not measured when the file gives it', async () => {
      const source = await addFilm();
      expect((await service.probe(OWNER, source.id)).durationSec).toBe(10);
      expect(measuring()).toHaveLength(0);
    });
  });

  it('maps probe failures to codes', async () => {
    const source = await addFilm();
    probeOf = () => ({ streams: [{ index: 0, codec_type: 'audio' }] });
    expect(await rejectionCode(service.probe(OWNER, source.id))).toBe(
      'no-video'
    );
    await fs.rm(path.join(mediaDir, 'film.mkv'));
    expect(await rejectionCode(service.probe(OWNER, source.id))).toBe(
      'source-missing'
    );
  });
});

describe('jobs', () => {
  const spec = (sourceId: string, overrides = {}) => ({
    sourceId,
    quality: '720',
    subtitles: [],
    sizeLimitBytes: 2 * 1024 * MiB,
    ...overrides,
  });

  it('runs a job to done with progress and the output summary', async () => {
    const source = await addFilm();
    const started = service.startJob(OWNER, spec(source.id));
    expect(started.phase).toBe('queued');
    const done = await finished(started.jobId);
    expect(done).toMatchObject({
      phase: 'done',
      percent: 100,
      plan: { mode: 'encode', twoPass: false, width: 1280, height: 720 },
      output: {
        size: 1000,
        durationSec: 10,
        width: 1280,
        height: 720,
        mimeType: 'video/mp4',
        hasAudio: true,
        subtitles: [],
        failedSubtitles: [],
      },
    });
    const phases = events.map((event) => event.state.phase);
    expect(phases).toContain('analyzing');
    expect(phases).toContain('encoding');
    expect(
      events.some(
        (event) =>
          event.state.phase === 'encoding' &&
          event.state.percent === 50 &&
          event.state.speed === 2
      )
    ).toBe(true);
    expect(service.listJobs(OWNER)).toEqual([done]);
    expect(service.listJobs(OWNER + 1)).toEqual([]);
  });

  it('runs one encode at a time', async () => {
    const source = await addFilm();
    const held: FakeChild[] = [];
    encode = (child) => {
      held.push(child);
    };
    const first = service.startJob(OWNER, spec(source.id));
    const second = service.startJob(OWNER, spec(source.id));
    await waitFor(() => held.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(held).toHaveLength(1);
    expect(lastState(second.jobId)).toBeUndefined();
    encode = writeOutputs();
    await writeOutputs()(held[0]);
    expect((await finished(first.jobId)).phase).toBe('done');
    expect((await finished(second.jobId)).phase).toBe('done');
  });

  it('cancels a running job: kills ffmpeg and deletes partial files', async () => {
    const source = await addFilm();
    let running: FakeChild | undefined;
    encode = async (child) => {
      const [, output] = fileArgs(child.args);
      await fs.writeFile(output, 'partial');
      running = child;
    };
    const job = service.startJob(OWNER, spec(source.id));
    await waitFor(() => running);
    const dir = path.join(root, 'userData', 'video-publisher-jobs', job.jobId);
    expect((await fs.readdir(dir)).length).toBeGreaterThan(0);
    service.cancelJob(OWNER, job.jobId);
    expect(running.killedWith).toBe('SIGKILL');
    expect((await finished(job.jobId)).phase).toBe('cancelled');
    await expect(fs.stat(dir)).rejects.toThrow();
  });

  it('cancels a queued job without running it', async () => {
    const source = await addFilm();
    encode = () => undefined;
    service.startJob(OWNER, spec(source.id));
    const queued = service.startJob(OWNER, spec(source.id));
    service.cancelJob(OWNER, queued.jobId);
    expect(lastState(queued.jobId)?.phase).toBe('cancelled');
  });

  it('fails with ffmpeg-failed and its message, leaving no files', async () => {
    const source = await addFilm();
    encode = (child) => {
      child.stderr.write('Invalid data found when processing input\n');
      child.exit(1);
    };
    const job = service.startJob(OWNER, spec(source.id));
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'ffmpeg-failed',
      errorDetail: 'Invalid data found when processing input',
    });
    await expect(
      fs.stat(path.join(root, 'userData', 'video-publisher-jobs', job.jobId))
    ).rejects.toThrow();
  });

  it('refuses before encoding when the video is too long for the limit', async () => {
    const source = await addFilm();
    probeOf = () =>
      ffprobeJson({ format: { format_name: 'mkv', duration: '36000' } });
    const job = service.startJob(
      OWNER,
      spec(source.id, { sizeLimitBytes: 100 * MiB })
    );
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'too-long-for-limit',
    });
    expect(children.some((child) => child.args.includes('libx264'))).toBe(
      false
    );
  });

  it('checks free space first', async () => {
    const source = await addFilm();
    deps.freeBytes = async () => 10;
    const job = service.startJob(OWNER, spec(source.id));
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'disk-full',
    });
  });

  it('fails output-too-big when the result exceeds the limit', async () => {
    const source = await addFilm();
    // Unknown duration, and reading the file for it failed: the budget can't
    // be checked before encoding.
    probeOf = (filePath) =>
      filePath.endsWith('video.mp4')
        ? outputProbe
        : ffprobeJson({ format: { format_name: 'mkv' } });
    const write = writeOutputs(5000);
    encode = (child) =>
      child.args.includes('null') ? child.exit(1) : write(child);
    const job = service.startJob(
      OWNER,
      spec(source.id, { sizeLimitBytes: 4000 })
    );
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'output-too-big',
    });
  });

  it('re-runs pass 2 lower when a two-pass result overshoots', async () => {
    // 3 s at 720p: the cap is ~1.1 MB, so a 1 MB limit goes two-pass. The
    // source has bits to spare (3 MiB), so its own bitrate isn't the cap.
    probeOf = (filePath) =>
      filePath.endsWith('video.mp4')
        ? outputProbe
        : ffprobeJson({ format: { format_name: 'mkv', duration: '3' } });
    await fs.truncate(path.join(mediaDir, 'film.mkv'), 3 * MiB);
    const source = await addFilm();
    const secondPasses: string[][] = [];
    encode = async (child) => {
      if (child.args.includes('null')) return child.exit(0);
      secondPasses.push(child.args);
      const [, output] = fileArgs(child.args);
      // Over the limit the first time, under it the second.
      await fs.writeFile(output, '');
      await fs.truncate(
        output,
        secondPasses.length === 1 ? 1_001_000 : 990_000
      );
      child.exit(0);
    };
    const job = service.startJob(
      OWNER,
      spec(source.id, { sizeLimitBytes: 1_000_000 })
    );
    const done = await finished(job.jobId);
    expect(done).toMatchObject({
      phase: 'done',
      plan: { twoPass: true },
      output: { size: 990_000 },
    });
    expect(secondPasses).toHaveLength(2);
    const rate = (args: string[]) => parseInt(args[args.indexOf('-b:v') + 1]);
    expect(rate(secondPasses[1])).toBeLessThan(rate(secondPasses[0]));
  });

  it('converts again, lower, a result that came out bigger than its original', async () => {
    // 10 s of a 3 MiB film: the original's own bitrate caps the encode.
    await fs.truncate(path.join(mediaDir, 'film.mkv'), 3 * MiB);
    const source = await addFilm();
    const encodes: string[][] = [];
    encode = async (child) => {
      encodes.push(child.args);
      const [, output] = fileArgs(child.args);
      await fs.writeFile(output, '');
      // Bigger than the original the first time, under it the second.
      await fs.truncate(
        output,
        Math.floor(encodes.length === 1 ? 3.3 * MiB : 2.7 * MiB)
      );
      child.exit(0);
    };
    const job = service.startJob(OWNER, spec(source.id));
    const done = await finished(job.jobId);
    expect(done).toMatchObject({
      phase: 'done',
      output: { size: Math.floor(2.7 * MiB) },
    });
    expect(encodes).toHaveLength(2);
    const cap = (args: string[]) =>
      parseInt(args[args.indexOf('-maxrate') + 1]);
    expect(cap(encodes[1])).toBeLessThan(cap(encodes[0]));
  });

  it('keeps a result no bigger than its original', async () => {
    await fs.truncate(path.join(mediaDir, 'film.mkv'), 3 * MiB);
    const source = await addFilm();
    const encodes: string[][] = [];
    encode = async (child) => {
      encodes.push(child.args);
      const [, output] = fileArgs(child.args);
      await fs.writeFile(output, '');
      await fs.truncate(output, Math.floor(2.9 * MiB));
      child.exit(0);
    };
    const job = service.startJob(OWNER, spec(source.id));
    expect(await finished(job.jobId)).toMatchObject({ phase: 'done' });
    expect(encodes).toHaveLength(1);
  });

  it('fails output-too-big when a retried two-pass is still over', async () => {
    probeOf = (filePath) =>
      filePath.endsWith('video.mp4')
        ? outputProbe
        : ffprobeJson({ format: { format_name: 'mkv', duration: '3' } });
    await fs.truncate(path.join(mediaDir, 'film.mkv'), 3 * MiB);
    const source = await addFilm();
    let secondPasses = 0;
    encode = async (child) => {
      if (child.args.includes('null')) return child.exit(0);
      secondPasses += 1;
      const [, output] = fileArgs(child.args);
      await fs.writeFile(output, '');
      await fs.truncate(output, 1_200_000);
      child.exit(0);
    };
    const job = service.startJob(
      OWNER,
      spec(source.id, { sizeLimitBytes: 1_000_000 })
    );
    expect((await finished(job.jobId)).errorCode).toBe('output-too-big');
    expect(secondPasses).toBe(2);
  });

  it('fails source-missing when the file went away', async () => {
    const source = await addFilm();
    await fs.rm(path.join(mediaDir, 'film.mkv'));
    const job = service.startJob(OWNER, spec(source.id));
    expect((await finished(job.jobId)).errorCode).toBe('source-missing');
  });

  it('reports plan errors as job failures and bad specs as rejections', async () => {
    const source = await addFilm();
    const job = service.startJob(OWNER, spec(source.id, { quality: 'keep' }));
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'keep-not-allowed',
      errorDetail: 'not-playable',
    });
    expect(() =>
      service.startJob(OWNER, spec(source.id, { quality: '8k' }))
    ).toThrowError(/video-tool:invalid-request/);
    expect(() => service.startJob(OWNER, spec('unknown'))).toThrowError(
      /video-tool:source-missing/
    );
  });

  it('converts external subtitle files from their encoding, per track', async () => {
    const source = await addFilm();
    // "Žluťoučký" in Windows-1250.
    writeFileSync(
      path.join(mediaDir, 'film.cs.srt'),
      Buffer.from([
        0x31, 0x0a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30,
        0x30, 0x30, 0x20, 0x2d, 0x2d, 0x3e, 0x20, 0x30, 0x30, 0x3a, 0x30, 0x30,
        0x3a, 0x30, 0x32, 0x2c, 0x30, 0x30, 0x30, 0x0a, 0x8e, 0x6c, 0x75, 0x9d,
        0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x0a,
      ])
    );
    writeFileSync(path.join(mediaDir, 'film.sup'), Buffer.alloc(10));
    writeFileSync(path.join(mediaDir, 'big.vtt'), 'WEBVTT\n\n');
    const [cs, sup, big] = await service.addFiles(OWNER, [
      { path: path.join(mediaDir, 'film.cs.srt'), name: 'film.cs.srt' },
      { path: path.join(mediaDir, 'film.sup'), name: 'film.sup' },
      { path: path.join(mediaDir, 'big.vtt'), name: 'big.vtt' },
    ]);
    const seenInputs: string[] = [];
    encode = async (child) => {
      if (child.args.includes('0:s:0')) {
        const [input, output] = fileArgs(child.args);
        seenInputs.push(await fs.readFile(input, 'utf8'));
        await fs.writeFile(
          output,
          input.endsWith('.vtt')
            ? Buffer.alloc(3 * MiB, 0x41)
            : 'WEBVTT\n\n00:01.000 --> 00:02.000\nŽluťoučký\n'
        );
        child.exit(0);
      } else await writeOutputs()(child);
    };
    const job = service.startJob(
      OWNER,
      spec(source.id, {
        subtitles: [
          {
            source: 'file',
            sourceId: cs.id,
            language: 'cs',
            label: 'Čeština',
            encoding: 'windows-1250',
          },
          { source: 'file', sourceId: sup.id, language: 'en' },
          { source: 'file', sourceId: big.id, language: 'de' },
        ],
      })
    );
    const done = await finished(job.jobId);
    expect(done.phase).toBe('done');
    expect(seenInputs[0]).toContain('Žluťoučký');
    expect(done.output.subtitles).toEqual([
      { id: 's0', language: 'cs', label: 'Čeština', bytes: expect.any(Number) },
    ]);
    expect(done.output.failedSubtitles).toEqual([
      { specIndex: 1, language: 'en', reason: 'picture' },
      { specIndex: 2, language: 'de', reason: 'too-big' },
    ]);
    expect(events.some((event) => event.state.phase === 'subtitles')).toBe(
      true
    );
    expect(await service.readText(OWNER, job.jobId, 's0')).toContain(
      'Žluťoučký'
    );
    expect(
      await rejectionCode(service.readText(OWNER, job.jobId, 'video'))
    ).toBe('invalid-request');
    // Work files (the decoded copies) are gone.
    const dir = path.join(root, 'userData', 'video-publisher-jobs', job.jobId);
    expect((await fs.readdir(path.join(dir, 'subtitles'))).sort()).toEqual([
      's0.vtt',
    ]);
  });

  it("writes a video's own subtitles after it, leaving out a track that fails", async () => {
    const source = await addFilm();
    probeOf = (filePath) =>
      filePath.endsWith('video.mp4')
        ? outputProbe
        : ffprobeJson({
            streams: [
              ...ffprobeJson().streams,
              {
                index: 2,
                codec_type: 'subtitle',
                codec_name: 'subrip',
                tags: { language: 'eng' },
              },
              {
                index: 3,
                codec_type: 'subtitle',
                codec_name: 'mov_text',
                tags: { language: 'ger' },
              },
            ],
          });
    encode = async (child) => {
      // ffmpeg can't convert stream 3: any run that maps it fails.
      if (child.args.includes('0:3')) {
        child.stderr.write('Decoding requested, but no decoder found\n');
        child.exit(234);
      } else await writeOutputs()(child);
    };
    const job = service.startJob(
      OWNER,
      spec(source.id, {
        subtitles: [
          { source: 'stream', index: 2, language: 'en' },
          { source: 'stream', index: 3, language: 'de' },
        ],
      })
    );
    const done = await finished(job.jobId);
    expect(done.phase).toBe('done');
    expect(done.output.subtitles.map((track) => track.id)).toEqual(['s0']);
    expect(done.output.failedSubtitles).toEqual([
      { specIndex: 1, language: 'de', reason: 'failed' },
    ]);
    // The video's run maps no subtitle.
    const videoRun = children.find((child) =>
      child.args.some((arg) => arg.endsWith('video.mp4'))
    );
    expect(videoRun.args).not.toContain('webvtt');
  });

  it("times MicroDVD files at the video's rate and refuses VobSub", async () => {
    const source = await addFilm();
    writeFileSync(path.join(mediaDir, 'film.en.sub'), '{250}{300}Hello\n');
    writeFileSync(
      path.join(mediaDir, 'film.de.sub'),
      '{1}{1}25\n{250}{300}Hallo\n'
    );
    writeFileSync(
      path.join(mediaDir, 'film.fr.sub'),
      Buffer.from([0x00, 0x00, 0x01, 0xba, 0x44, 0x00])
    );
    const [en, de, fr] = await service.addFiles(OWNER, [
      { path: path.join(mediaDir, 'film.en.sub'), name: 'film.en.sub' },
      { path: path.join(mediaDir, 'film.de.sub'), name: 'film.de.sub' },
      { path: path.join(mediaDir, 'film.fr.sub'), name: 'film.fr.sub' },
    ]);
    const subtitleRuns: string[][] = [];
    encode = async (child) => {
      if (child.args.includes('0:s:0')) subtitleRuns.push(child.args);
      await writeOutputs()(child);
    };
    const job = service.startJob(
      OWNER,
      spec(source.id, {
        subtitles: [
          { source: 'file', sourceId: en.id, language: 'en' },
          { source: 'file', sourceId: de.id, language: 'de' },
          { source: 'file', sourceId: fr.id, language: 'fr' },
        ],
      })
    );
    const done = await finished(job.jobId);
    expect(done.phase).toBe('done');
    expect(subtitleRuns).toHaveLength(2);
    const [first, second] = subtitleRuns;
    expect(first.slice(first.indexOf('-f'), first.indexOf('-i'))).toEqual([
      '-f',
      'microdvd',
      '-subfps',
      '25000/1000',
    ]);
    // A file with its own rate line keeps it.
    expect(second).not.toContain('-subfps');
    expect(second).toContain('microdvd');
    expect(done.output.failedSubtitles).toEqual([
      { specIndex: 2, language: 'fr', reason: 'picture' },
    ]);
  });

  it('reports a disk that fills up during the encode as disk-full', async () => {
    const source = await addFilm();
    encode = (child) => {
      child.stderr.write('Error writing trailer: No space left on device\n');
      child.exit(1);
    };
    const job = service.startJob(OWNER, spec(source.id));
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'disk-full',
    });
  });

  it('counts two-pass stats files in the free-space check', async () => {
    // A 4 GB source (sparse): its own bitrate is no cap at 1080p.
    await fs.truncate(path.join(mediaDir, 'film.mkv'), 4 * 1024 * MiB);
    const source = await addFilm();
    // 2 h of 1080p: the MP4 fits the limit, its .mbtree doesn't fit beside it.
    probeOf = (filePath) =>
      filePath.endsWith('video.mp4')
        ? outputProbe
        : ffprobeJson({
            format: { format_name: 'matroska,webm', duration: '7200' },
          });
    deps.freeBytes = async () => 2.2 * 1024 * MiB;
    const job = service.startJob(
      OWNER,
      spec(source.id, { quality: '1080', sizeLimitBytes: 2000 * MiB })
    );
    expect(await finished(job.jobId)).toMatchObject({
      phase: 'failed',
      errorCode: 'disk-full',
      plan: { twoPass: true },
    });
    expect(
      children.filter((child) => child.command.endsWith('ffmpeg'))
    ).toHaveLength(0);
  });

  it('starts nothing more once Hub quits', async () => {
    const source = await addFilm();
    let running: FakeChild | undefined;
    encode = (child) => {
      running = child;
    };
    const first = service.startJob(OWNER, spec(source.id));
    const second = service.startJob(OWNER, spec(source.id));
    await waitFor(() => running);
    service.shutdown();
    expect(running.killedWith).toBe('SIGKILL');
    expect(await finished(first.jobId)).toMatchObject({ phase: 'cancelled' });
    expect(lastState(second.jobId)).toMatchObject({ phase: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Only the first job's probe and encode ever ran.
    expect(children).toHaveLength(2);
    expect(() => service.startJob(OWNER, spec(source.id))).toThrowError(
      /video-tool:cancelled/
    );
  });

  it('releases a job and its folder, and everything when the page goes', async () => {
    const source = await addFilm();
    const job = service.startJob(OWNER, spec(source.id));
    await finished(job.jobId);
    const jobsRoot = path.join(root, 'userData', 'video-publisher-jobs');
    await service.releaseJob(OWNER, job.jobId);
    await expect(fs.stat(path.join(jobsRoot, job.jobId))).rejects.toThrow();
    expect(service.listJobs(OWNER)).toEqual([]);

    let running: FakeChild | undefined;
    encode = (child) => {
      running = child;
    };
    const other = service.startJob(OWNER, spec(source.id));
    await waitFor(() => running);
    service.releaseOwner(OWNER);
    expect(running.killedWith).toBe('SIGKILL');
    await waitForGone(path.join(jobsRoot, other.jobId));
    expect(await rejectionCode(service.probe(OWNER, source.id))).toBe(
      'source-missing'
    );
  });

  describe('a job its page lets go of', () => {
    const jobDir = (jobId: string) =>
      path.join(root, 'userData', 'video-publisher-jobs', jobId);
    const exists = (target: string) =>
      fs.stat(target).then(
        () => true,
        () => false
      );

    it("stops a page's job when the page goes, and runs another page's", async () => {
      const source = await addFilm();
      const [other] = await service.addFiles(OWNER + 1, [
        { path: path.join(mediaDir, 'film.mkv'), name: 'film.mkv' },
      ]);
      let running: FakeChild | undefined;
      encode = async (child) => {
        const [, output] = fileArgs(child.args);
        await fs.writeFile(output, 'partial');
        running = child;
      };
      const gone = service.startJob(OWNER, spec(source.id));
      const next = service.startJob(OWNER + 1, spec(other.id));
      await waitFor(() => running);
      const seen = events.length;
      encode = writeOutputs();
      service.releaseOwner(OWNER);

      expect(running.killedWith).toBe('SIGKILL');
      expect((await finished(next.jobId)).phase).toBe('done');
      expect(await exists(jobDir(gone.jobId))).toBe(false);
      // Nothing more is said about the job of the page that left.
      expect(
        events.slice(seen).filter((event) => event.state.jobId === gone.jobId)
      ).toEqual([]);
      expect(service.listJobs(OWNER)).toEqual([]);
    });

    it('says a job has ended when its page releases it half-way', async () => {
      const source = await addFilm();
      let running: FakeChild | undefined;
      encode = async (child) => {
        const [, output] = fileArgs(child.args);
        await fs.writeFile(output, 'partial');
        running = child;
      };
      const converting = service.startJob(OWNER, spec(source.id));
      const queued = service.startJob(OWNER, spec(source.id));
      await waitFor(() => running);

      // The page stops waiting for a job once it hears its last state: it
      // comes with the release, not after it (when nothing is said any more).
      await service.releaseJob(OWNER, queued.jobId);
      expect(lastState(queued.jobId)?.phase).toBe('cancelled');
      await service.releaseJob(OWNER, converting.jobId);
      expect(running.killedWith).toBe('SIGKILL');
      expect(lastState(converting.jobId)?.phase).toBe('cancelled');

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await exists(jobDir(converting.jobId))).toBe(false);
      expect(service.listJobs(OWNER)).toEqual([]);
      // Said once.
      expect(
        events.filter(
          (event) =>
            event.state.jobId === converting.jobId &&
            event.state.phase === 'cancelled'
        )
      ).toHaveLength(1);
    });
  });

  describe('an external subtitle file in an old encoding', () => {
    it("is read as its language's, not as Western European text", async () => {
      const source = await addFilm();
      // "Привет" in Windows-1251, as most Russian .srt files were saved.
      writeFileSync(
        path.join(mediaDir, 'film.ru.srt'),
        Buffer.concat([
          Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n', 'latin1'),
          Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]),
        ])
      );
      const subtitle = await addFilm('film.ru.srt');
      const seen: string[] = [];
      encode = async (child) => {
        if (!child.args.includes('0:s:0')) return writeOutputs()(child);
        const [input, output] = fileArgs(child.args);
        seen.push(await fs.readFile(input, 'utf8'));
        await fs.writeFile(output, 'WEBVTT\n\n');
        child.exit(0);
      };
      const job = service.startJob(
        OWNER,
        spec(source.id, {
          subtitles: [
            { source: 'file', sourceId: subtitle.id, language: 'ru' },
          ],
        })
      );
      const done = await finished(job.jobId);
      expect(done.phase).toBe('done');
      // Either the text is right, or the track is left out and said so:
      // never the letters of another alphabet.
      expect(seen.join('')).not.toContain('Ïðèâåò');
      if (done.output.subtitles.length) {
        expect(seen.join('')).toContain('Привет');
      } else {
        expect(done.output.failedSubtitles).toHaveLength(1);
      }
    });
  });

  describe("a video's own subtitle tracks on a slow drive", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("doesn't read the file again for each track after the run for all of them ran out of time", async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout'],
        shouldAdvanceTime: true,
      });
      probeOf = (filePath) =>
        filePath.endsWith('video.mp4')
          ? outputProbe
          : ffprobeJson({
              streams: [
                ...ffprobeJson().streams,
                ...[2, 3, 4].map((index) => ({
                  index,
                  codec_type: 'subtitle',
                  codec_name: 'subrip',
                  tags: { language: 'eng' },
                })),
              ],
            });
      const subtitleRuns: FakeChild[] = [];
      encode = async (child) => {
        // Reading the whole file for its subtitles: too slow to finish.
        if (child.args.includes('webvtt')) subtitleRuns.push(child);
        else await writeOutputs()(child);
      };
      const source = await addFilm();
      const job = service.startJob(
        OWNER,
        spec(source.id, {
          subtitles: [2, 3, 4].map((index) => ({
            source: 'stream',
            index,
            language: 'en',
          })),
        })
      );
      await waitFor(() => subtitleRuns.length === 1, 5000);
      // The run for all three tracks hits its 30 minutes.
      await vi.advanceTimersByTimeAsync(30 * 60_000 + 1000);
      // Then the job ends, or a run for one track starts.
      await waitFor(
        () => subtitleRuns.length > 1 || lastState(job.jobId)?.phase === 'done'
      );

      // Each track alone would read the whole file again, 30 minutes each,
      // while every other video waits for this one.
      expect(subtitleRuns.map((run) => run.args.join(' '))).toHaveLength(1);
      expect(lastState(job.jobId)?.phase).toBe('done');
    });
  });

  it('removes stale job folders', async () => {
    const stale = path.join(root, 'userData', 'video-publisher-jobs', 'old');
    mkdirSync(stale, { recursive: true });
    await service.removeStaleJobs();
    await expect(fs.stat(stale)).rejects.toThrow();
  });
});

describe('pausing a conversion', () => {
  const spec = (sourceId: string, overrides = {}) => ({
    sourceId,
    quality: '720',
    subtitles: [],
    sizeLimitBytes: 2 * 1024 * MiB,
    ...overrides,
  });
  let clock: number;
  let letEncodeEnd: () => void;

  beforeEach(() => {
    clock = 1_000_000;
    deps.now = () => clock;
    service = new VideoToolService(deps);
    // An encode that reports 1 s written, then waits to be let go.
    encode = async (child) => {
      const [, ...outputs] = fileArgs(child.args);
      for (const output of outputs) {
        await fs.writeFile(
          output,
          output.endsWith('.vtt') ? 'WEBVTT\n\n' : Buffer.alloc(1000, 1)
        );
      }
      child.stdout.write(
        'out_time_us=1000000\nspeed=1.0x\nprogress=continue\n'
      );
      await new Promise<void>((resolve) => (letEncodeEnd = resolve));
      child.stdout.write('out_time_us=10000000\nspeed=1.0x\nprogress=end\n');
      child.exit(0);
    };
  });

  const encodeChild = () =>
    children.find(
      (child) => child.command.endsWith('ffmpeg') && child.args.includes('-c:v')
    );

  it('stops ffmpeg where it is and lets it go on, without the paused time in the time left', async () => {
    const source = await addFilm();
    const job = service.startJob(OWNER, spec(source.id));
    await waitFor(() => lastState(job.jobId)?.percent === 10);
    const child = encodeChild();

    const paused = service.pauseJob(OWNER, job.jobId);
    expect(paused).toMatchObject({ paused: true, etaSec: undefined });
    expect(child.signals).toEqual(['SIGSTOP']);
    expect(lastState(job.jobId)).toMatchObject({ paused: true });
    // Pausing again changes nothing.
    service.pauseJob(OWNER, job.jobId);
    expect(child.signals).toEqual(['SIGSTOP']);

    // Ten minutes later it goes on: ffmpeg's own speed now counts those
    // minutes, the time left doesn't.
    clock += 600_000;
    expect(service.resumeJob(OWNER, job.jobId)).toMatchObject({
      paused: false,
    });
    expect(child.signals).toEqual(['SIGSTOP', 'SIGCONT']);
    clock += 4_000;
    child.stdout.write(
      'out_time_us=5000000\nspeed=0.008x\nprogress=continue\n'
    );
    const after = await waitFor(() => {
      const state = lastState(job.jobId);
      return state?.percent === 50 ? state : undefined;
    });
    // 5 s of a 10 s video in the 4 s it really ran: 1.25×, 4 s left.
    expect(after.speed).toBeCloseTo(1.25, 2);
    expect(after.etaSec).toBe(4);

    letEncodeEnd();
    expect(await finished(job.jobId)).toMatchObject({ phase: 'done' });
  });

  it('starts nothing new while paused', async () => {
    const source = await addFilm();
    const job = service.startJob(OWNER, spec(source.id));
    // Paused before its encode starts (while the file is read).
    service.pauseJob(OWNER, job.jobId);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(encodeChild()).toBeUndefined();
    service.resumeJob(OWNER, job.jobId);
    await waitFor(() => encodeChild());
    letEncodeEnd();
    expect(await finished(job.jobId)).toMatchObject({ phase: 'done' });
  });

  it('cancels a paused job', async () => {
    const source = await addFilm();
    const job = service.startJob(OWNER, spec(source.id));
    await waitFor(() => lastState(job.jobId)?.percent === 10);
    service.pauseJob(OWNER, job.jobId);
    service.cancelJob(OWNER, job.jobId);
    expect(encodeChild().killedWith).toBe('SIGKILL');
    expect(await finished(job.jobId)).toMatchObject({ phase: 'cancelled' });

    // One paused before its encode: it never starts one.
    const waiting = service.startJob(OWNER, spec(source.id));
    service.pauseJob(OWNER, waiting.jobId);
    const encodes = children.filter((child) => child.args.includes('-c:v'));
    service.cancelJob(OWNER, waiting.jobId);
    expect(await finished(waiting.jobId)).toMatchObject({
      phase: 'cancelled',
    });
    expect(children.filter((child) => child.args.includes('-c:v'))).toEqual(
      encodes
    );
  });

  it("can't pause on Windows, and says so in the status", async () => {
    deps.platform = 'win32';
    writeFileSync(path.join(binDir, 'ffmpeg.exe'), '');
    writeFileSync(path.join(binDir, 'ffprobe.exe'), '');
    service = new VideoToolService(deps);
    expect(await service.status()).toMatchObject({ canPause: false });
    const source = await addFilm();
    const job = service.startJob(OWNER, spec(source.id));
    expect(() => service.pauseJob(OWNER, job.jobId)).toThrow(
      /video-tool:not-supported/
    );
    service.cancelJob(OWNER, job.jobId);
    deps.platform = 'linux';
    service = new VideoToolService(deps);
    expect(await service.status()).toMatchObject({ canPause: true });
  });
});

describe('subtitles written again after the job', () => {
  const spec = (sourceId: string, overrides = {}) => ({
    sourceId,
    quality: '720',
    subtitles: [],
    sizeLimitBytes: 2 * 1024 * MiB,
    ...overrides,
  });

  it('writes the chosen list under new names, reusing unchanged sources, and drops the old files', async () => {
    const source = await addFilm();
    writeFileSync(
      path.join(mediaDir, 'film.en.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nHi\n'
    );
    writeFileSync(
      path.join(mediaDir, 'film.de.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nHallo\n'
    );
    const [en, de] = await service.addFiles(OWNER, [
      { path: path.join(mediaDir, 'film.en.srt'), name: 'film.en.srt' },
      { path: path.join(mediaDir, 'film.de.srt'), name: 'film.de.srt' },
    ]);
    const subtitleRuns: string[] = [];
    encode = async (child) => {
      if (child.args.includes('0:s:0')) {
        const [input, output] = fileArgs(child.args);
        const text = await fs.readFile(input, 'utf8');
        subtitleRuns.push(text);
        await fs.writeFile(output, `WEBVTT\n\n${text}`);
        child.exit(0);
      } else await writeOutputs()(child);
    };
    const job = service.startJob(
      OWNER,
      spec(source.id, {
        subtitles: [{ source: 'file', sourceId: en.id, language: 'und' }],
      })
    );
    const done = await finished(job.jobId);
    expect(done.output.subtitles).toEqual([
      { id: 's0', language: 'und', bytes: expect.any(Number) },
    ]);
    expect(subtitleRuns).toHaveLength(1);
    const subtitleDir = path.join(service.jobsRoot(), job.jobId, 'subtitles');
    expect(existsSync(path.join(subtitleDir, 's0.vtt'))).toBe(true);

    // The English one gets its language; German is added afterwards.
    const again = await service.remakeSubtitles(OWNER, job.jobId, [
      { source: 'file', sourceId: en.id, language: 'en', label: 'English' },
      { source: 'file', sourceId: de.id, language: 'de' },
    ]);
    expect(again.output.subtitles).toEqual([
      {
        id: 'g1s0',
        language: 'en',
        label: 'English',
        bytes: expect.any(Number),
      },
      { id: 'g1s1', language: 'de', bytes: expect.any(Number) },
    ]);
    expect(again.output.size).toBe(done.output.size);
    // Only German was converted: English was copied.
    expect(subtitleRuns).toHaveLength(2);
    expect(subtitleRuns[1]).toContain('Hallo');
    expect(await service.readText(OWNER, job.jobId, 'g1s0')).toContain('Hi');
    expect(await service.readText(OWNER, job.jobId, 'g1s1')).toContain('Hallo');
    await expect(service.readText(OWNER, job.jobId, 's0')).rejects.toThrow();
    await waitForGone(path.join(subtitleDir, 's0.vtt'));
    expect(lastState(job.jobId).output.subtitles).toHaveLength(2);

    // Taken out again: nothing is converted for that.
    const fewer = await service.remakeSubtitles(OWNER, job.jobId, [
      { source: 'file', sourceId: de.id, language: 'de' },
    ]);
    expect(fewer.output.subtitles).toEqual([
      { id: 'g2s0', language: 'de', bytes: expect.any(Number) },
    ]);
    expect(subtitleRuns).toHaveLength(2);
  });

  it('refuses a job that is not done and a malformed list', async () => {
    const source = await addFilm();
    encode = () => undefined;
    const job = service.startJob(OWNER, spec(source.id));
    expect(
      await rejectionCode(service.remakeSubtitles(OWNER, job.jobId, []))
    ).toBe('not-ready');
    service.cancelJob(OWNER, job.jobId);
    await finished(job.jobId);
    encode = writeOutputs();
    const done = service.startJob(OWNER, spec(source.id));
    await finished(done.jobId);
    expect(
      await rejectionCode(
        service.remakeSubtitles(OWNER, done.jobId, [{ source: 'nope' }])
      )
    ).toBe('invalid-request');
    expect(
      await rejectionCode(service.remakeSubtitles(OWNER, 'not-a-job', []))
    ).toBe('job-missing');
  });
});

describe('outputs of a finished job', () => {
  let jobId: string;

  beforeEach(async () => {
    const source = await addFilm();
    encode = writeOutputs(12 * MiB);
    jobId = service.startJob(OWNER, {
      sourceId: source.id,
      quality: '720',
      subtitles: [],
      sizeLimitBytes: 2 * 1024 * MiB,
    }).jobId;
    await finished(jobId);
  });

  const upload = (overrides = {}) =>
    service.uploadChunk(OWNER, {
      jobId,
      file: 'video',
      start: 5 * MiB,
      end: 10 * MiB,
      index: 1,
      endpoint:
        'http://127.0.0.1:12391/arbitrary/VIDEO/Tester/qtube_vid_x/chunk?apiKey=k',
      ...overrides,
    });

  it('uploads one range as multipart chunk + index', async () => {
    expect(await upload()).toEqual({ ok: true });
    const [url, init] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/chunk?apiKey=k');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const body = Buffer.from(init.body as Uint8Array);
    const contentType = (init.headers as Record<string, string>)[
      'content-type'
    ];
    const form = await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData();
    const chunk = form.get('chunk') as File;
    expect(chunk.size).toBe(5 * MiB);
    expect(chunk.name).toBe('video.mp4');
    expect(form.get('index')).toBe('1');
  });

  it("reads the node's answer to the end rather than cancelling it", async () => {
    // A cancelled net.fetch answer keeps its request, and both copies of the
    // chunk, alive in main: a 2 GB upload once held 6 GB.
    const answer = new Response('true', { status: 200 });
    const cancel = vi.spyOn(answer.body, 'cancel');
    deps.fetch = vi.fn(async () => answer);
    expect(await upload()).toEqual({ ok: true });
    expect(answer.bodyUsed).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    const refusal = new Response('no', { status: 403 });
    deps.fetch = vi.fn(async () => refusal);
    expect(await upload()).toEqual({ ok: false, status: 403 });
    expect(refusal.bodyUsed).toBe(true);
  });

  it('returns the node status on refusal and 0 on network failure', async () => {
    deps.fetch = vi.fn(async () => new Response('no', { status: 403 }));
    expect(await upload()).toEqual({ ok: false, status: 403 });
    deps.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await upload()).toEqual({ ok: false, status: 0 });
  });

  it('rejects bad ranges, files, jobs and endpoints', async () => {
    for (const overrides of [
      { start: 0, end: 6 * MiB },
      { start: 10, end: 10 },
      { start: -1 },
      { end: 13 * MiB },
      { index: 1.5 },
      { file: 's9' },
      { endpoint: 'file:///etc/passwd' },
      { endpoint: 'http://node/arbitrary/VIDEO/Tester/x/upload' },
      { endpoint: 'http://u:p@node/arbitrary/VIDEO/Tester/chunk' },
    ]) {
      expect(await rejectionCode(upload(overrides))).toBe('invalid-request');
    }
    expect(await rejectionCode(upload({ jobId: 'nope' }))).toBe('job-missing');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('posts only to the node Hub uses', async () => {
    const elsewhere =
      'https://attacker.example/arbitrary/VIDEO/Tester/qtube_vid_x/chunk';
    expect(await rejectionCode(upload({ endpoint: elsewhere }))).toBe(
      'invalid-request'
    );
    expect(deps.fetch).not.toHaveBeenCalled();
    deps.allowEndpoint = (endpoint) =>
      endpoint.startsWith('https://ext-node.qortal.link/');
    expect(
      await upload({
        endpoint:
          'https://ext-node.qortal.link/arbitrary/VIDEO/Tester/qtube_vid_x/chunk',
      })
    ).toEqual({ ok: true });
    expect(await rejectionCode(upload({ endpoint: elsewhere }))).toBe(
      'invalid-request'
    );
  });

  describe('a node reached under a path of its own', () => {
    it("takes a converted video's chunks for it, as for any other node", async () => {
      // The node set in Hub sits behind a web server, under /qortal: every
      // request Hub sends it is joined under that path (createEndpoint).
      const node = 'https://node.example.org/qortal';
      deps.allowEndpoint = (endpoint) =>
        isAllowedNodeEndpoint(endpoint, [new URL(node).origin]);
      const endpoint = `${joinNodeEndpoint(
        node,
        '/arbitrary/VIDEO/Tester/qtube_vid_film_abcdef/chunk'
      )}?apiKey=k`;

      const answer = await upload({
        start: 0,
        end: 5 * MiB,
        index: 0,
        endpoint,
      }).catch((error: Error) => error.message);
      expect(answer).toEqual({ ok: true });
      expect(deps.fetch).toHaveBeenCalledWith(endpoint, expect.anything());
    });

    it('takes the chunks of a node whose address has a path', async () => {
      // A node behind a web server at https://node.example/qortal: Hub joins
      // every request under that path (joinNodeEndpoint keeps the prefix),
      // and the main window's CSP allows its origin.
      deps.allowEndpoint = (endpoint) =>
        isAllowedNodeEndpoint(endpoint, ['https://node.example']);
      const endpoint =
        'https://node.example/qortal/arbitrary/VIDEO/Tester/qtube_vid_x/chunk?apiKey=k';

      const result = await upload({ endpoint }).catch(
        (error: Error) => error.message
      );

      expect(result).toEqual({ ok: true });
      expect(deps.fetch).toHaveBeenCalledWith(endpoint, expect.anything());
    });
  });

  describe('a node on this PC building it from the file', () => {
    const endpoint =
      'http://127.0.0.1:12391/arbitrary/VIDEO/Film%20Club/qtube_vid_x?fee=1000000&title=Film&apiKey=k';
    const videoPath = () =>
      path.join(root, 'userData', 'video-publisher-jobs', jobId, 'video.mp4');
    const build = (overrides = {}) =>
      service.buildOnNode(OWNER, {
        jobId,
        file: 'video',
        endpoint,
        filename: 'Film.mp4',
        ...overrides,
      });

    it('posts the path of a link named for the node, then removes it', async () => {
      let seen: { body: string; size: number; sameFile: boolean } | null = null;
      const answer = new Response('3mJr7AoUXx2Wqd', { status: 200 });
      deps.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const body = String(init.body);
        const [linked, original] = await Promise.all([
          fs.stat(body),
          fs.stat(videoPath()),
        ]);
        seen = {
          body,
          size: linked.size,
          sameFile: linked.ino === original.ino,
        };
        return answer;
      });

      expect(await build()).toEqual({
        ok: true,
        transaction: '3mJr7AoUXx2Wqd',
      });
      const [url, init] = (deps.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe(endpoint);
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.headers).toEqual({
        'content-type': 'text/plain; charset=utf-8',
      });
      // A hard link to the converted file, under the name to publish.
      expect(path.basename(seen.body)).toBe('Film.mp4');
      expect(seen.sameFile).toBe(true);
      expect(seen.size).toBe(12 * MiB);
      // Read to the end, as every answer from the node.
      expect(answer.bodyUsed).toBe(true);
      // The link goes once the node has answered; the converted file stays.
      await expect(fs.stat(path.dirname(seen.body))).rejects.toThrow();
      expect((await fs.stat(videoPath())).size).toBe(12 * MiB);
    });

    it('names it after the file itself without a usable name', async () => {
      const bodies: string[] = [];
      deps.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response('3mJr', { status: 200 });
      });
      await build({ filename: undefined });
      await build({ filename: 'folder/Clip.mp4' });
      expect(bodies.map((body) => path.basename(body))).toEqual([
        'video.mp4',
        'Clip.mp4',
      ]);
    });

    it("says why when the node doesn't build it", async () => {
      const refusal = new Response('{"error":1000,"message":"No such file"}', {
        status: 500,
      });
      deps.fetch = vi.fn(async () => refusal);
      expect(await build()).toEqual({
        ok: false,
        status: 500,
        reason: 'refused',
      });
      expect(refusal.bodyUsed).toBe(true);

      deps.fetch = vi.fn(async () => new Response('<html>', { status: 200 }));
      expect(await build()).toEqual({
        ok: false,
        status: 200,
        reason: 'answer',
      });

      deps.fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      expect(await build()).toEqual({
        ok: false,
        status: 0,
        reason: 'network',
      });
      // No link is left behind in any case.
      const left = await fs.readdir(path.dirname(videoPath()));
      expect(left.filter((name) => name.startsWith('node-'))).toEqual([]);
    });

    it('leaves a node on another machine to an upload', async () => {
      deps.allowEndpoint = (url) => url.startsWith('http://192.168.1.20:');
      expect(
        await build({
          endpoint:
            'http://192.168.1.20:12391/arbitrary/VIDEO/Tester/qtube_vid_x?apiKey=k',
        })
      ).toEqual({ ok: false, status: 0, reason: 'not-local' });
      expect(deps.fetch).not.toHaveBeenCalled();
    });

    it("says so when it can't make the link", async () => {
      const jobDir = path.dirname(videoPath());
      await fs.chmod(jobDir, 0o500);
      try {
        expect(await build()).toEqual({
          ok: false,
          status: 0,
          reason: 'link',
        });
      } finally {
        await fs.chmod(jobDir, 0o700);
      }
      expect(deps.fetch).not.toHaveBeenCalled();
    });

    it('rejects other routes, files, jobs and nodes', async () => {
      for (const overrides of [
        { file: 's9' },
        { endpoint: 'file:///etc/passwd' },
        {
          endpoint:
            'http://127.0.0.1:12391/arbitrary/VIDEO/Tester/qtube_vid_x/chunk',
        },
        { endpoint: 'http://127.0.0.1:12391/arbitrary/VIDEO/Tester/base64' },
        { endpoint: 'http://127.0.0.1:12391/arbitrary/VIDEO/Tester/ZIP' },
        { endpoint: 'http://127.0.0.1:12391/arbitrary/video/Tester/x' },
        { endpoint: 'http://u:p@127.0.0.1:12391/arbitrary/VIDEO/Tester/x' },
        { endpoint: 'https://attacker.example/arbitrary/VIDEO/Tester/x' },
      ]) {
        expect(await rejectionCode(build(overrides))).toBe('invalid-request');
      }
      expect(await rejectionCode(build({ jobId: 'nope' }))).toBe('job-missing');
      expect(deps.fetch).not.toHaveBeenCalled();
    });
  });

  it('serves the preview with ranges, only for finished jobs', async () => {
    const url = `hub-video://job/${jobId}/video.mp4`;
    const full = await service.previewResponse(new Request(url), 'app://-');
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe(String(12 * MiB));
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    await full.body?.cancel();

    const ranged = await service.previewResponse(
      new Request(url, {
        headers: { range: 'bytes=100-199', origin: 'app://-' },
      }),
      'app://-'
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(
      `bytes 100-199/${12 * MiB}`
    );
    expect(ranged.headers.get('access-control-allow-origin')).toBe('app://-');
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);

    const foreign = await service.previewResponse(
      new Request(url, { headers: { origin: 'https://evil' } }),
      'app://-'
    );
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    await foreign.body?.cancel();

    for (const bad of [
      `hub-video://job/${jobId}/../../secret`,
      `hub-video://job/${jobId}/subtitles/s0.vtt`,
      'hub-video://job/unknown/video.mp4',
      `hub-video://other/${jobId}/video.mp4`,
    ]) {
      expect(
        (await service.previewResponse(new Request(bad), 'app://-')).status
      ).toBe(404);
    }
  });

  it('saves a copy where the user chooses', async () => {
    const target = path.join(root, 'saved.mp4');
    deps.showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: target,
    }));
    const result = await service.saveOutput(OWNER, jobId, 'My film: part 1');
    expect(result).toEqual({
      saved: true,
      savedId: expect.any(String),
      filePath: target,
    });
    expect(deps.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'My film part 1.mp4',
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      })
    );
    expect((await fs.stat(target)).size).toBe(12 * MiB);
    deps.showSaveDialog = vi.fn(async () => ({ canceled: true }));
    expect(await service.saveOutput(OWNER, jobId, 'x')).toEqual({
      saved: false,
    });
  });

  it('opens a saved video, or shows it in its folder, and nothing else', async () => {
    const target = path.join(root, 'saved again.mp4');
    deps.showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: target,
    }));
    deps.openPath = vi.fn(async () => {});
    deps.showItemInFolder = vi.fn();
    const result = await service.saveOutput(OWNER, jobId, 'x');
    if (!result.saved) throw new Error('not saved');
    await service.openSaved(OWNER, result.savedId, 'open');
    expect(deps.openPath).toHaveBeenCalledWith(target);
    await service.openSaved(OWNER, result.savedId, 'folder');
    expect(deps.showItemInFolder).toHaveBeenCalledWith(target);
    // Only ids saveOutput gave this page; never a path.
    for (const [owner, id, how] of [
      [OWNER + 1, result.savedId, 'open'],
      [OWNER, target, 'open'],
      [OWNER, result.savedId, 'run'],
      [OWNER, undefined, 'open'],
    ] as const) {
      await expect(service.openSaved(owner, id, how)).rejects.toThrow(
        '[video-tool:invalid-request]'
      );
    }
    // Moved or deleted since.
    await fs.rm(target);
    await expect(
      service.openSaved(OWNER, result.savedId, 'open')
    ).rejects.toThrow('[video-tool:saved-missing]');
    expect(deps.openPath).toHaveBeenCalledTimes(1);
    // A page that's gone takes its saved files with it.
    await fs.writeFile(target, 'x');
    service.releaseOwner(OWNER);
    await expect(
      service.openSaved(OWNER, result.savedId, 'folder')
    ).rejects.toThrow('[video-tool:invalid-request]');
  });

  it('grabs frames from the output', async () => {
    const frames = await service.frames(OWNER, { jobId }, { count: 2 });
    expect(frames).toEqual([
      { timeSec: 2.65, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
      { timeSec: 7.35, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
    ]);
  });
});

describe('frames', () => {
  it('spreads frames inside the video, sized and mapped to its stream', async () => {
    const source = await addFilm();
    const frames = await service.frames(
      OWNER,
      { sourceId: source.id },
      { count: 4, width: 4000 }
    );
    expect(frames.map((item) => item.timeSec)).toEqual([
      1.475, 3.825, 6.175, 8.525,
    ]);
    const grab = children.find((child) => child.args.includes('image2'));
    expect(grab.args).toEqual(
      expect.arrayContaining([
        '-ss',
        '1.475',
        '-map',
        '0:0',
        '-frames:v',
        '1',
        '-vf',
        'scale=1920:1080,setsar=1',
      ])
    );
  });

  it('takes given times, skips empty grabs and caps the count', async () => {
    const source = await addFilm();
    let calls = 0;
    frame = (child) => {
      calls += 1;
      if (calls === 2) child.exit(0);
      else {
        child.stdout.write(Buffer.from([0xff, 0xd8]));
        child.exit(0);
      }
    };
    const frames = await service.frames(
      OWNER,
      { sourceId: source.id },
      { times: [1, 50, 'x', 3], width: 320 }
    );
    // 50 s is past the end (10 s): its grab comes back empty.
    expect(frames.map((item) => item.timeSec)).toEqual([1, 3]);
    const sized = children.find((child) => child.args.includes('image2'));
    expect(sized.args).toContain('scale=320:180,setsar=1');
    expect(calls).toBe(3);
    expect(await rejectionCode(service.frames(OWNER, { jobId: 'x' }, {}))).toBe(
      'job-missing'
    );
  });
});

describe('helpers', () => {
  it('decodes subtitles: BOMs, strict UTF-8, chosen legacy encodings', () => {
    expect(
      decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))
    ).toEqual({ text: 'A', encoding: 'utf-8', valid: true });
    expect(
      decodeSubtitleBytes(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))
    ).toEqual({ text: 'A', encoding: 'utf-16le', valid: true });
    const legacy = new Uint8Array([0x8e, 0x6c, 0x75, 0x9d]);
    expect(decodeSubtitleBytes(legacy)).toMatchObject({
      encoding: 'utf-8',
      valid: false,
    });
    expect(decodeSubtitleBytes(legacy, 'windows-1250')).toEqual({
      text: 'Žluť',
      encoding: 'windows-1250',
      valid: true,
    });
    expect(decodeSubtitleBytes(legacy, 'cp1250').encoding).toBe('windows-1250');
    expect(() => decodeSubtitleBytes(legacy, 'klingon')).toThrowError(
      /video-tool:unsupported-encoding/
    );
  });

  it("picks a subtitle file's older encoding from its language", () => {
    expect(legacySubtitleEncoding('ru')).toBe('windows-1251');
    expect(legacySubtitleEncoding('RUS')).toBe('windows-1251');
    expect(legacySubtitleEncoding('cze')).toBe('windows-1250');
    expect(legacySubtitleEncoding('zh_Hans')).toBe('gb18030');
    expect(legacySubtitleEncoding('pt-BR')).toBe('windows-1252');
    expect(legacySubtitleEncoding('')).toBe('windows-1252');
    expect(legacySubtitleEncoding(undefined)).toBe('windows-1252');
    // Each is a label TextDecoder knows.
    for (const language of [
      'ru',
      'pl',
      'el',
      'tr',
      'he',
      'ar',
      'lt',
      'vi',
      'th',
      'ja',
      'ko',
      'zh',
    ]) {
      expect(
        () => new TextDecoder(legacySubtitleEncoding(language)),
        language
      ).not.toThrow();
    }
  });

  it('reads a subtitle file a page added', async () => {
    writeFileSync(path.join(mediaDir, 'a.srt'), 'héllo');
    const [source] = await service.addFiles(OWNER, [
      { path: path.join(mediaDir, 'a.srt'), name: 'a.srt' },
    ]);
    expect(await service.readSubtitleFile(OWNER, source.id)).toEqual({
      text: 'héllo',
      encoding: 'utf-8',
      valid: true,
    });
    writeFileSync(path.join(mediaDir, 'a.srt'), Buffer.alloc(11 * MiB));
    expect(
      await rejectionCode(service.readSubtitleFile(OWNER, source.id))
    ).toBe('too-big');
  });

  it('normalizes specs and refuses malformed ones', () => {
    expect(
      normalizeJobSpec({
        sourceId: 's',
        quality: 'original',
        audioIndex: null,
        subtitles: [
          { source: 'stream', index: 2, language: 'en', extra: 'dropped' },
          { source: 'file', sourceId: 'f', language: 'cs', encoding: 'cp1250' },
        ],
        sizeLimitBytes: 1000,
        junk: true,
      })
    ).toEqual({
      sourceId: 's',
      quality: 'original',
      audioIndex: null,
      subtitles: [
        { source: 'stream', index: 2, language: 'en' },
        { source: 'file', sourceId: 'f', language: 'cs', encoding: 'cp1250' },
      ],
      sizeLimitBytes: 1000,
    });
    const good = { sourceId: 's', quality: '720', sizeLimitBytes: 1 };
    for (const bad of [
      null,
      { ...good, quality: 'best' },
      { ...good, sizeLimitBytes: -1 },
      { ...good, sizeLimitBytes: 1.5 },
      { ...good, audioIndex: -1 },
      { ...good, subtitles: [{ source: 'stream', index: 1 }] },
      { ...good, subtitles: [{ source: 'web', language: 'en' }] },
      { ...good, sourceId: '' },
    ]) {
      expect(normalizeJobSpec(bad)).toBeNull();
    }
  });

  it("allows the CSP's node origins and no others", () => {
    const domains = [
      'https://ext-node.qortal.link',
      'http://192.168.1.5:12391',
    ];
    const isPrivate = (host: string) => host.startsWith('192.168.');
    expect(
      isAllowedNodeEndpoint('http://localhost:12391/arbitrary/X/a/chunk', [])
    ).toBe(true);
    expect(
      isAllowedNodeEndpoint(
        'https://ext-node.qortal.link/arbitrary/X/a/chunk',
        domains,
        isPrivate
      )
    ).toBe(true);
    // A local node's address in any scheme, as the CSP expands it.
    expect(
      isAllowedNodeEndpoint(
        'https://192.168.1.5:12391/arbitrary/X/a/chunk',
        domains,
        isPrivate
      )
    ).toBe(true);
    expect(
      isAllowedNodeEndpoint(
        'http://ext-node.qortal.link/arbitrary/X/a/chunk',
        domains,
        isPrivate
      )
    ).toBe(false);
    expect(
      isAllowedNodeEndpoint(
        'https://attacker.example/arbitrary/X/a/chunk',
        domains,
        isPrivate
      )
    ).toBe(false);
  });

  it('tells MicroDVD timing and binary .sub files', () => {
    expect(microdvdTiming('{0}{25}Hi')).toEqual({
      microdvd: true,
      ownRate: false,
    });
    expect(microdvdTiming('\n{1}{1}23.976\n{0}{25}Hi')).toEqual({
      microdvd: true,
      ownRate: true,
    });
    expect(microdvdTiming('1\n00:00:01,000 --> 00:00:02,000\nHi')).toEqual({
      microdvd: false,
      ownRate: false,
    });
    expect(looksLikePictureSub(new Uint8Array([0, 0, 1, 0xba]))).toBe(true);
    expect(looksLikePictureSub(new TextEncoder().encode('{0}{1}Hi'))).toBe(
      false
    );
  });

  it('accepts only chunk endpoints', () => {
    expect(
      isChunkEndpoint(
        'https://ext-node.qortal.link/arbitrary/VIDEO/A%20B/id/chunk'
      )
    ).toBe(true);
    expect(
      isChunkEndpoint('http://127.0.0.1:12391/arbitrary/FILE/Name/chunk')
    ).toBe(true);
    expect(isChunkEndpoint('ftp://x/arbitrary/VIDEO/a/chunk')).toBe(false);
    expect(isChunkEndpoint('http://x/arbitrary/VIDEO/a/b/c/chunk')).toBe(false);
    expect(isChunkEndpoint('not a url')).toBe(false);
    // A node under a path of its own (a reverse proxy).
    expect(
      isChunkEndpoint('https://node.example/qortal/arbitrary/VIDEO/A/id/chunk')
    ).toBe(true);
    expect(
      isChunkEndpoint('https://node.example/qortal/arbitrary/VIDEO/a/b/c/chunk')
    ).toBe(false);
  });

  it("accepts only Core's publish-from-path route", () => {
    expect(
      isPathPublishEndpoint(
        'http://127.0.0.1:12391/arbitrary/VIDEO/A%20B/id?fee=1&apiKey=k'
      )
    ).toBe(true);
    expect(
      isPathPublishEndpoint('http://localhost:12391/arbitrary/FILE/Name')
    ).toBe(true);
    expect(
      isPathPublishEndpoint(
        'http://localhost:12391/qortal/arbitrary/VIDEO/A/id?fee=1&apiKey=k'
      )
    ).toBe(true);
    for (const endpoint of [
      'http://x/qortal/arbitrary/VIDEO/a/b/chunk',
      'http://x/qortal/arbitrary/VIDEO/a/base64',
      'http://x/qortal/arbitrary/VIDEO/a/Zip',
      'http://x/arbitrary/VIDEO/arbitrary/FOO/base64',
      'http://x/arbitrary/VIDEO/a/b/chunk',
      'http://x/arbitrary/VIDEO/a/finalize',
      'http://x/arbitrary/VIDEO/a/String',
      'http://x/arbitrary/VIDEO/a/%7A%69%70',
      'http://x/arbitrary/check/tmp',
      'ftp://x/arbitrary/VIDEO/a',
      'not a url',
    ]) {
      expect(isPathPublishEndpoint(endpoint)).toBe(false);
    }
  });

  it('knows a node on this PC', () => {
    expect(isThisPcEndpoint('http://127.0.0.1:12391/x')).toBe(true);
    expect(isThisPcEndpoint('https://localhost:12391/x')).toBe(true);
    expect(isThisPcEndpoint('http://[::1]:12391/x')).toBe(true);
    expect(isThisPcEndpoint('http://192.168.1.20:12391/x')).toBe(false);
    expect(isThisPcEndpoint('https://ext-node.qortal.link/x')).toBe(false);
    expect(isThisPcEndpoint('nonsense')).toBe(false);
  });

  it('names the file the node reads as Core names an upload', () => {
    expect(nodeFileName('Film.mp4', 'video.mp4')).toBe('Film.mp4');
    expect(nodeFileName('a/b\\Film.mp4', 'video.mp4')).toBe('Film.mp4');
    for (const bad of [
      undefined,
      '',
      '  ',
      '..',
      'a\u0001b',
      'x'.repeat(201),
    ]) {
      expect(nodeFileName(bad, 'video.mp4')).toBe('video.mp4');
    }
    expect(nodeFileName('Who? Me.mp4', 'video.mp4', 'win32')).toBe(
      'Who_ Me.mp4'
    );
    expect(nodeFileName('Who? Me.mp4', 'video.mp4', 'linux')).toBe(
      'Who? Me.mp4'
    );
  });

  it('builds multipart bodies a FormData parser reads', async () => {
    const form = chunkFormData(new Uint8Array([1, 2, 3]), 4, 'a"b.vtt', 'XYZ');
    expect(form.contentType).toBe('multipart/form-data; boundary=XYZ');
    const parsed = await new Response(form.body, {
      headers: { 'content-type': form.contentType },
    }).formData();
    const chunk = parsed.get('chunk') as File;
    expect(new Uint8Array(await chunk.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(chunk.name).toBe('a_b.vtt');
    expect(parsed.get('index')).toBe('4');
  });

  it('makes safe save names', () => {
    expect(safeOutputName('../../etc/passwd')).toBe('etc passwd.mp4');
    expect(safeOutputName('Film.MP4')).toBe('Film.MP4');
    expect(safeOutputName('')).toBe('video.mp4');
    expect(safeOutputName(null)).toBe('video.mp4');
  });

  it('serves files with suffix ranges and 416 past the end', async () => {
    const file = path.join(mediaDir, 'range.bin');
    writeFileSync(file, Buffer.from('0123456789'));
    const suffix = await fileResponse(file, {
      mimeType: 'video/mp4',
      range: 'bytes=-3',
    });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('789');
    const open = await fileResponse(file, {
      mimeType: 'video/mp4',
      range: 'bytes=4-',
    });
    expect(await open.text()).toBe('456789');
    const past = await fileResponse(file, {
      mimeType: 'video/mp4',
      range: 'bytes=20-',
    });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */10');
    const head = await fileResponse(file, {
      mimeType: 'video/mp4',
      method: 'HEAD',
    });
    expect(head.headers.get('content-length')).toBe('10');
    expect(head.body).toBeNull();
  });

  it('resolves the binaries folder', () => {
    const common = {
      resourcesPath: '/opt/hub/resources',
      appPath: '/src/electron',
      env: {},
    };
    expect(
      resolveFfmpegDir({
        ...common,
        isPackaged: true,
        platform: 'win32',
        arch: 'x64',
      })
    ).toBe(path.join('/opt/hub/resources', 'ffmpeg', 'win-x64'));
    expect(
      resolveFfmpegDir({
        ...common,
        isPackaged: false,
        platform: 'darwin',
        arch: 'arm64',
      })
    ).toBe(path.join('/src/electron', 'resources', 'ffmpeg', 'darwin-arm64'));
    expect(
      resolveFfmpegDir({
        ...common,
        isPackaged: true,
        env: { QORTAL_HUB_FFMPEG_DIR: '/custom' },
      })
    ).toBe(path.resolve('/custom'));
  });

  it('registers every channel behind the sender check', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const checkSender = vi.fn((event: { sender: { id: number } }) => {
      if (event.sender.id !== OWNER) throw new Error('not the main window');
    });
    registerVideoToolIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      checkSender,
      service,
    } as never);
    const invokable = Object.entries(VIDEO_TOOL_CHANNELS)
      .filter(([key]) => key !== 'jobEvent')
      .map(([, channel]) => channel);
    expect([...handlers.keys()].sort()).toEqual(invokable.sort());
    expect(
      handlers.get(VIDEO_TOOL_CHANNELS.listJobs)({ sender: { id: OWNER } })
    ).toEqual([]);
    expect(() =>
      handlers.get(VIDEO_TOOL_CHANNELS.listJobs)({ sender: { id: 99 } })
    ).toThrowError('not the main window');
  });
});
