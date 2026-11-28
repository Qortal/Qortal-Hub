/**
 * The window's controller against the real engine (Electron main's
 * VideoToolService, with a made-up ffmpeg), rather than against the fake
 * bridge: what the two agree on about a job's end.
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
import {
  videoQueueAtom,
  videoRunAtom,
} from '../../src/components/VideoPublisher/videoPublisherAtoms';
import { VideoPublisherController } from '../../src/components/VideoPublisher/videoPublisherController';
import { createFakeVideoTool } from '../../src/test/mocks/videoTool';

const OWNER = 7;
const MiB = 1024 * 1024;

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number | undefined = undefined;
  killedWith: string | null = null;
  private closed = false;

  constructor(
    readonly command: string,
    readonly args: string[]
  ) {
    super();
  }

  kill(signal?: string) {
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

const sourceProbe = {
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
};

const fileArgs = (args: string[]) =>
  args.filter((arg) => arg.startsWith('file:')).map((arg) => arg.slice(5));

async function waitFor<T>(check: () => T | undefined | false, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the Video publisher window with the real engine', () => {
  let root: string;
  let mediaDir: string;
  let children: FakeChild[];
  let service: VideoToolService;
  let store: ReturnType<typeof createStore>;
  let controller: VideoPublisherController;

  /** ffmpeg runs that convert a video (they stay running in these tests). */
  const conversions = () =>
    children.filter(
      (child) =>
        child.command.endsWith('ffmpeg') && child.args.includes('-progress')
    );
  const items = () => store.get(videoQueueAtom);
  const file = (name: string) => {
    writeFileSync(path.join(mediaDir, name), Buffer.alloc(4 * MiB, 2));
    return new File(['x'], name);
  };

  beforeEach(() => {
    root = path.join(
      os.homedir(),
      '.cache',
      'video-publisher-test',
      `window-${process.pid}-${Math.random().toString(36).slice(2)}`
    );
    mediaDir = path.join(root, 'media');
    const binDir = path.join(root, 'bin');
    mkdirSync(mediaDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, 'ffmpeg'), '');
    writeFileSync(path.join(binDir, 'ffprobe'), '');
    children = [];
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
        children.push(child);
        setTimeout(() => {
          if (command.endsWith('ffprobe')) {
            child.stdout.write(JSON.stringify(sourceProbe));
            child.exit(0);
          } else if (args.includes('image2')) {
            child.stdout.write(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
            child.exit(0);
          }
          // A conversion keeps running until it's killed.
        }, 1);
        return child as never;
      }) as VideoToolDeps['spawn'],
    };
    service = new VideoToolService(deps);

    // What preload's bridge does, without Electron: every call goes to the
    // engine as this page, and the engine's events come back.
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
      onJobEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    store = createStore();
    controller = new VideoPublisherController({
      store,
      bridge: () => bridge,
      isPublicNode: async () => false,
    });
    controller.setDestination('save');
  });

  afterEach(async () => {
    controller.dispose();
    service.shutdown();
    await pause(20);
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * A double click on a converting video's stop button: the first click
   * cancels it, the button becomes the card's × in the same place, and the
   * second click takes the video off the queue while its ffmpeg is still
   * ending.
   */
  const stopThenRemove = async (id: string) => {
    await controller.cancelItem(id);
    await controller.removeItem(id);
  };

  it('converts the next video after one is stopped and removed at once', async () => {
    await controller.addFiles([file('First.mkv'), file('Second.mkv')]);
    controller.start({ name: null, publicKey: null });
    await waitFor(() => conversions().length === 1);
    const [first] = items();
    expect(first.phase).toBe('converting');

    await stopThenRemove(first.id);
    expect(conversions()[0].killedWith).toBe('SIGKILL');
    await pause(300);

    expect(items().map((item) => item.phase)).toEqual(['converting']);
    expect(conversions()).toHaveLength(2);
    expect(fileArgs(conversions()[1].args)[0]).toBe(
      path.join(mediaDir, 'Second.mkv')
    );
  });

  it('ends the run when its only video is stopped and removed at once', async () => {
    await controller.addFiles([file('Only.mkv')]);
    controller.start({ name: null, publicKey: null });
    await waitFor(() => conversions().length === 1);
    expect(store.get(videoRunAtom).active).toBe(true);

    await stopThenRemove(items()[0].id);
    await pause(300);

    expect(items()).toEqual([]);
    expect(store.get(videoRunAtom).active).toBe(false);
  });
});
