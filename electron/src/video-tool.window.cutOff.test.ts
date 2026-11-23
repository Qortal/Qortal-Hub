/**
 * The window's controller against the real engine (Electron main's
 * VideoToolService, with a made-up ffmpeg): a source that runs out before
 * its end.
 */
import { EventEmitter } from 'events';
import { mkdirSync, promises as fs, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoToolService, type VideoToolDeps } from './video-tool';
import type { VideoJobEvent, VideoToolBridge } from './video-tool-types';
import { videoQueueAtom } from '../../src/components/VideoPublisher/videoPublisherAtoms';
import {
  VideoPublisherController,
  type VideoPublisherDeps,
} from '../../src/components/VideoPublisher/videoPublisherController';
import { createFakeVideoTool } from '../../src/test/mocks/videoTool';

const OWNER = 7;
const MiB = 1024 * 1024;
const WEBP = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
const ACCOUNT = { name: 'Tester', publicKey: 'pubkey' };
/** The film's length, as its file's header says. */
const FILM_SEC = 7200;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number | undefined = undefined;
  private closed = false;

  constructor(
    readonly command: string,
    readonly args: string[]
  ) {
    super();
  }

  kill() {
    this.exit(null, 'SIGKILL');
    return true;
  }

  exit(code: number | null, signal: string | null = null) {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    setTimeout(() => this.emit('close', code, signal), 5);
  }
}

const probeJson = (codec: string, width: number, duration: number) => ({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: codec,
      width,
      height: Math.round((width * 9) / 16),
      sample_aspect_ratio: '1:1',
      pix_fmt: 'yuv420p',
      avg_frame_rate: '25/1',
      disposition: { default: 1 },
    },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: codec === 'h264' ? 'aac' : 'ac3',
      channels: 2,
      disposition: { default: 1 },
    },
  ],
  format: { format_name: 'matroska,webm', duration: String(duration) },
});

const fileArgs = (args: string[]) =>
  args.filter((arg) => arg.startsWith('file:')).map((arg) => arg.slice(5));

async function waitFor<T>(check: () => T | undefined | false, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a film whose file runs out before its end', () => {
  let root: string;
  let mediaDir: string;
  let service: VideoToolService;
  let controller: VideoPublisherController;
  let store: ReturnType<typeof createStore>;
  let runPublishSteps: ReturnType<typeof vi.fn>;
  /** How far ffmpeg gets before the source has nothing more to read. */
  let readableSec: number;

  beforeEach(() => {
    root = path.join(
      os.homedir(),
      '.cache',
      'video-publisher-test',
      `window2-${process.pid}-${Math.random().toString(36).slice(2)}`
    );
    mediaDir = path.join(root, 'media');
    const binDir = path.join(root, 'bin');
    mkdirSync(mediaDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, 'ffmpeg'), '');
    writeFileSync(path.join(binDir, 'ffprobe'), '');
    readableSec = FILM_SEC;
    const listeners = new Set<(event: VideoJobEvent) => void>();
    const deps: VideoToolDeps = {
      userDataDir: () => path.join(root, 'userData'),
      binDir: () => binDir,
      emit: (_owner, event) => listeners.forEach((listener) => listener(event)),
      fetch: vi.fn(async () => new Response('ok', { status: 200 })),
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      freeBytes: async () => 1024 * 1024 * MiB,
      cpuThreads: () => 16,
      platform: 'linux',
      spawn: ((command: string, args: string[]) => {
        const child = new FakeChild(command, args);
        setTimeout(async () => {
          const [input, output] = fileArgs(args);
          if (command.endsWith('ffprobe')) {
            // The header says the whole film; the MP4 written is as long
            // as what could be read.
            child.stdout.write(
              JSON.stringify(
                input.endsWith('video.mp4')
                  ? probeJson('h264', 1280, readableSec)
                  : probeJson('hevc', 1920, FILM_SEC)
              )
            );
            child.exit(0);
          } else if (args.includes('image2')) {
            child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
            child.exit(0);
          } else {
            // Reading stops where the file stops: ffmpeg ends as at the end
            // of any input.
            await fs.writeFile(output, Buffer.alloc(64 * 1024, 1));
            child.stdout.write(
              `out_time_us=${readableSec * 1_000_000}\nprogress=end\n`
            );
            child.exit(0);
          }
        }, 1);
        return child as never;
      }) as VideoToolDeps['spawn'],
    };
    service = new VideoToolService(deps);

    // What preload's bridge does, without Electron.
    const bridge: VideoToolBridge = {
      ...createFakeVideoTool(),
      addFiles: async (files) =>
        service.addFiles(
          OWNER,
          Array.from(files).map((entry) => ({
            path: path.join(mediaDir, entry.name),
            name: entry.name,
          }))
        ),
      forgetSource: async (id) => service.forgetSource(OWNER, id),
      probe: async (id) => service.probe(OWNER, id),
      frames: async (target, options) => service.frames(OWNER, target, options),
      startJob: async (spec) => service.startJob(OWNER, spec),
      cancelJob: async (id) => service.cancelJob(OWNER, id),
      listJobs: async () => service.listJobs(OWNER),
      releaseJob: async (id) => service.releaseJob(OWNER, id),
      readText: async (id, file) => service.readText(OWNER, id, file),
      onJobEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    store = createStore();
    runPublishSteps = vi.fn(async (steps) => ({
      ok: true,
      outcomes: steps.map((step) => ({
        key: step.key,
        status: 'published' as const,
      })),
    }));
    const controllerDeps: Partial<VideoPublisherDeps> = {
      store,
      bridge: () => bridge,
      isPublicNode: async () => false,
      makeCover: vi.fn(async () => WEBP),
      makeExtracts: vi.fn(async (frames) => frames.map(() => WEBP)),
      makeQshareThumbnail: vi.fn(async () => WEBP),
      waitForPublishSlot: vi.fn(async () => true),
      estimatePublishFee: vi.fn(async (count) => ({
        unitFee: 0.01,
        count: Number(count),
        total: Number(count) * 0.01,
      })),
      checkPublishBalance: vi.fn(async () => ({ balance: 5, enough: true })),
      requestApproval: vi.fn(async () => true),
      runPublishSteps: runPublishSteps as never,
    };
    controller = new VideoPublisherController(controllerDeps);
    // Published as soon as it's converted (no preview first).
    controller.updateSettings((current) => ({
      reviewFirst: false,
      shared: { ...current.shared, category: 1 },
    }));
  });

  afterEach(async () => {
    controller.dispose();
    service.shutdown();
    await pause(20);
    await fs.rm(root, { recursive: true, force: true });
  });

  const publishFilm = async (name: string) => {
    writeFileSync(path.join(mediaDir, name), Buffer.alloc(4 * MiB, 2));
    await controller.addFiles([new File(['x'], name)]);
    controller.start(ACCOUNT);
    await waitFor(() => {
      const [item] = store
        .get(videoQueueAtom)
        .filter((entry) => entry.source.name.startsWith(name.split('.')[0]));
      return item &&
        ['done', 'failed', 'review', 'cancelled'].includes(item.phase)
        ? item
        : undefined;
    });
    await pause(50);
  };

  it("isn't published as the film, unasked, with three quarters of it missing", async () => {
    // A whole film goes straight up, as asked.
    await publishFilm('Whole.mkv');
    expect(runPublishSteps).toHaveBeenCalledTimes(1);
    await controller.clearFinished();

    // A film still downloading (or on a drive unplugged half-way): its
    // header says two hours, ffmpeg reads 30 minutes and ends normally.
    readableSec = 1800;
    runPublishSteps.mockClear();
    await publishFilm('Cut.mkv');
    const [cut] = store
      .get(videoQueueAtom)
      .filter((item) => item.source.name === 'Cut.mkv');
    expect(
      runPublishSteps,
      `${cut.output?.durationSec} s converted of a ${cut.probe?.durationSec} s film, then ${cut.phase}`
    ).not.toHaveBeenCalled();
  });
});
