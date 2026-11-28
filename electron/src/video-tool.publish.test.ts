/**
 * Publishing a converted video through Electron main's engine (with a
 * made-up ffmpeg), the way publishData and the job's file reference meet
 * main's answers: what a refusal from main turns into.
 */
import { EventEmitter } from 'events';
import { mkdirSync, promises as fs, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The node set in Hub (a test may put one on this PC). */
const node = vi.hoisted(() => ({ base: 'https://node.example.org/qortal' }));

vi.mock('../../src/background/background', async () => {
  const { joinNodeEndpoint } = await import('../../src/utils/nodeEndpointPath');
  return {
    getBaseApi: vi.fn(async () => node.base),
    // As Hub's own: joined under the node's path, with its API key.
    createEndpoint: vi.fn(
      async (endpoint: string) =>
        `${joinNodeEndpoint(node.base, endpoint)}${
          endpoint.includes('?') ? '&' : '?'
        }apiKey=k`
    ),
  };
});
vi.mock('../../src/utils/chromeStorage', () => ({ getData: vi.fn() }));

import Base58Module from '../../src/encryption/Base58';
import naclModule from '../../src/encryption/nacl-fast';
import { getData } from '../../src/utils/chromeStorage';
import { createJobFileReference } from '../../src/lib/videoPublisher/fileReference';
import { classifyPublishError } from '../../src/lib/videoPublisher/runner';
import { publishData } from '../../src/qdn/publish/publish';
import {
  VideoToolService,
  isAllowedNodeEndpoint,
  type VideoToolDeps,
} from './video-tool';
import type {
  VideoJobEvent,
  VideoNodeBuildRequest,
  VideoUploadRequest,
} from './video-tool-types';

const Base58 = Base58Module as unknown as {
  encode(bytes: Uint8Array): string;
};
const nacl = naclModule as unknown as {
  sign: { keyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } };
};

const OWNER = 7;
const MiB = 1024 * 1024;
const NODE = 'https://node.example.org/qortal';
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) =>
  new Promise((resolve) => realSetTimeout(resolve, ms));

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
    realSetTimeout(() => this.emit('close', code, signal), 5);
  }
}

const probeJson = (codec: string, duration: string) => ({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: codec,
      width: 1280,
      height: 720,
      pix_fmt: 'yuv420p',
      avg_frame_rate: '25/1',
    },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 },
  ],
  format: { format_name: 'matroska,webm', duration },
});

const fileArgs = (args: string[]) =>
  args.filter((arg) => arg.startsWith('file:')).map((arg) => arg.slice(5));

const response = (body: unknown, status = 200) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const answer = {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => answer,
  };
  return answer;
};

describe('publishing a converted video when Electron main refuses the request', () => {
  let root: string;
  let service: VideoToolService;
  let events: VideoJobEvent[];
  let nodeFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    node.base = NODE;
    root = path.join(
      os.homedir(),
      '.cache',
      'video-publisher-test',
      `publish2-${process.pid}-${Math.random().toString(36).slice(2)}`
    );
    const mediaDir = path.join(root, 'media');
    const binDir = path.join(root, 'bin');
    mkdirSync(mediaDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, 'ffmpeg'), '');
    writeFileSync(path.join(binDir, 'ffprobe'), '');
    writeFileSync(path.join(mediaDir, 'film.mkv'), Buffer.alloc(4096, 2));
    events = [];
    nodeFetch = vi.fn(async () => new Response('true', { status: 200 }));
    const deps: VideoToolDeps = {
      userDataDir: () => path.join(root, 'userData'),
      binDir: () => binDir,
      emit: (_owner, event) => events.push(event),
      fetch: nodeFetch,
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      freeBytes: async () => 1024 * 1024 * MiB,
      cpuThreads: () => 16,
      platform: 'linux',
      // The node Hub uses (its origin is in the main window's CSP).
      allowEndpoint: (endpoint) =>
        isAllowedNodeEndpoint(endpoint, [new URL(NODE).origin]),
      spawn: ((command: string, args: string[]) => {
        const child = new FakeChild(command, args);
        realSetTimeout(async () => {
          const [input, output] = fileArgs(args);
          if (command.endsWith('ffprobe')) {
            child.stdout.write(
              JSON.stringify(
                input.endsWith('video.mp4')
                  ? probeJson('h264', '10.0')
                  : probeJson('hevc', '10.0')
              )
            );
            child.exit(0);
            return;
          }
          await fs.writeFile(output, Buffer.alloc(6 * MiB, 1));
          child.stdout.write('out_time_us=10000000\nprogress=end\n');
          child.exit(0);
        }, 1);
        return child as never;
      }) as VideoToolDeps['spawn'],
    };
    service = new VideoToolService(deps);

    const keys = nacl.sign.keyPair();
    vi.mocked(getData).mockImplementation(async (key: string) =>
      key === 'walletInfo'
        ? { address0: 'Qaddress' }
        : {
            privateKey: Base58.encode(keys.secretKey),
            publicKey: Base58.encode(keys.publicKey),
          }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/names/')) return response({ name: 'Me' });
        if (url.includes('/transactions/unitfee')) return response('1000000');
        if (url.includes('/arbitrary/check/tmp')) return response('');
        return response('not found', 404);
      })
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    service.shutdown();
    await realSleep(20);
    await fs.rm(root, { recursive: true, force: true });
  });

  /** A converted video, done in the engine. */
  const convertedJob = async () => {
    const [source] = await service.addFiles(OWNER, [
      { path: path.join(root, 'media', 'film.mkv'), name: 'film.mkv' },
    ]);
    const { jobId } = service.startJob(OWNER, {
      sourceId: source.id,
      quality: '720',
      subtitles: [],
      sizeLimitBytes: 2 * 1024 * MiB,
    });
    for (let tries = 0; tries < 300; tries += 1) {
      const state = [...events]
        .reverse()
        .find((event) => event.state.jobId === jobId)?.state;
      if (state?.phase === 'done') return { jobId, size: state.output.size };
      await realSleep(10);
    }
    throw new Error('the conversion did not finish');
  };

  /** What preload hands the page: main's error, wrapped by Electron. */
  const viaElectron = <T>(channel: string, call: () => Promise<T>) =>
    call().catch((error) => {
      throw new Error(`Error invoking remote method '${channel}': ${error}`);
    });

  it("ends at once, as a refusal, rather than waiting as for a node that can't be reached", async () => {
    const { jobId, size } = await convertedJob();
    // Main turns down every request for this file: here its job is gone
    // (job-missing).
    node.base = 'http://127.0.0.1:12391';
    await service.releaseJob(OWNER, jobId);
    const bridge = {
      uploadChunk: vi.fn((request: VideoUploadRequest) =>
        viaElectron('videoTool:uploadChunk', () =>
          service.uploadChunk(OWNER, request)
        )
      ),
      buildOnNode: vi.fn((request: VideoNodeBuildRequest) =>
        viaElectron('videoTool:buildOnNode', () =>
          service.buildOnNode(OWNER, request)
        )
      ),
    };
    const file = createJobFileReference({
      jobId,
      file: 'video',
      size,
      name: 'Film.mp4',
      type: 'video/mp4',
      bridge,
    });

    // publishData waits 25 s between tries of a chunk.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let outcome: unknown = 'still going';
    const publishing = publishData({
      registeredName: 'Me',
      data: file,
      service: 'VIDEO',
      identifier: 'qtube_vid_film_abcdef',
      filename: 'Film.mp4',
      uploadType: 'file',
      withFee: true,
    }).then(
      () => (outcome = 'published'),
      (error) => (outcome = error)
    );
    await realSleep(300);
    const settledAtOnce = outcome !== 'still going';
    const triesAtOnce = bridge.uploadChunk.mock.calls.length;

    // Let it end, however long it would have waited.
    for (let round = 0; round < 12 && outcome === 'still going'; round += 1) {
      await vi.advanceTimersByTimeAsync(25_000);
      await realSleep(30);
    }
    await publishing;

    // Main refused the request (it will refuse it every time): nothing
    // reached the node, and that's no lost connection.
    expect(nodeFetch).not.toHaveBeenCalled();
    expect(outcome).toBeInstanceOf(Error);
    expect(
      { settledAtOnce, triesAtOnce },
      'main turned the chunk down; publishData waited to try it again'
    ).toEqual({ settledAtOnce: true, triesAtOnce: 1 });
    // Not a network failure, which the runner would try twice more (each
    // again with 25 s waits) and then call "The node couldn't be reached".
    expect(classifyPublishError(outcome).error.code).not.toBe('network');
  });
});
