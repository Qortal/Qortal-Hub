import { createStore } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { PublishApprovalRequest } from './publishApproval';
import type {
  PublishStep,
  RunPublishOptions,
  RunPublishResult,
} from '../../lib/videoPublisher';
import type { VideoNodeBuildResult } from '../../../electron/src/video-tool-types';
import type { NodeBuildable } from '../../qdn/publish/nodeBuildable';
import {
  createFakeVideoTool,
  type FakeVideoTool,
  fakeProbe,
  FRAME_DATA_URL,
} from '../../test/mocks/videoTool';
import {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS,
  VIDEO_PUBLISHER_IDLE_RUN,
  videoPublisherSettingsAtom,
  videoQueueAtom,
  videoRunAtom,
} from './videoPublisherAtoms';
import {
  VideoPublisherController,
  type VideoPublisherDeps,
} from './videoPublisherController';

const WEBP = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
const ACCOUNT = { name: 'Tester', publicKey: 'pubkey' };

const file = (name: string, relativePath?: string) => {
  const value = new File(['x'], name);
  if (relativePath) {
    Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  }
  return value;
};

/** Lets pending promises and the pipeline's turns run. */
const settle = async (turns = 12) => {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

type Publish = {
  steps: readonly PublishStep[];
  options: RunPublishOptions;
  resolve: (result?: Partial<RunPublishResult>) => void;
};

// Runs go straight through in these tests (a sign-in resets the settings to
// the defaults, so it's set there); preview-first has tests of its own.
const PREVIEW_FIRST_DEFAULT = VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst;
beforeAll(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = false;
});
afterAll(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = PREVIEW_FIRST_DEFAULT;
});

describe('VideoPublisherController', () => {
  let tool: FakeVideoTool;
  let store: ReturnType<typeof createStore>;
  let publishes: Publish[];
  let controller: VideoPublisherController;
  let deps: Partial<VideoPublisherDeps>;
  /** Hub's approval: accepted unless a test says otherwise. */
  let approvals: Mock<(request: PublishApprovalRequest) => Promise<boolean>>;

  const published = (steps: readonly PublishStep[]) => ({
    ok: true,
    outcomes: steps.map((step) => ({
      key: step.key,
      status: 'published' as const,
    })),
  });

  beforeEach(() => {
    window.localStorage.clear();
    tool = createFakeVideoTool();
    store = createStore();
    publishes = [];
    deps = {
      store,
      bridge: () => tool,
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
      requestApproval: (approvals = vi.fn(async () => true)),
      runPublishSteps: vi.fn(
        (steps, options) =>
          new Promise<RunPublishResult>((resolve) => {
            publishes.push({
              steps,
              options,
              resolve: (result) => {
                const full = { ...published(steps), ...result };
                full.outcomes.forEach((outcome) =>
                  options.onStepDone?.(outcome)
                );
                resolve(full as RunPublishResult);
              },
            });
          })
      ),
    };
    controller = new VideoPublisherController(deps);
  });

  afterEach(() => controller.dispose());

  const items = () => store.get(videoQueueAtom);
  const setShared = (shared: object) =>
    controller.updateSettings((current) => ({
      shared: { ...current.shared, ...shared },
    }));
  const run = () => store.get(videoRunAtom);
  /** The job started last. */
  const lastJob = () => `job-${vi.mocked(tool.startJob).mock.calls.length}`;

  /** The node refuses the publish: the run stops. */
  const refuse = (publish: Publish) => {
    const refused = { code: 'refused' } as never;
    publish.resolve({
      ok: false,
      stoppedBy: refused,
      outcomes: [
        { key: publish.steps[0].key, status: 'failed', error: refused },
      ],
    });
  };

  /** What a step publishes, as text. */
  const decode = (step: PublishStep) =>
    'base64' in step.data
      ? new TextDecoder().decode(
          Uint8Array.from(atob(step.data.base64), (c) => c.charCodeAt(0))
        )
      : '';

  /** A series of two episodes, started. */
  const seriesOfTwo = async () => {
    await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
    await settle();
  };

  it('queues videos with their probes and attaches subtitle files by name', async () => {
    tool.probes.set(
      'Movie.mkv',
      fakeProbe({
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'ger',
            isDefault: false,
            kind: 'text',
            isForced: false,
          },
          {
            index: 3,
            codec: 'hdmv_pgs_subtitle',
            language: 'eng',
            isDefault: false,
            kind: 'picture',
            isForced: false,
          },
        ],
      })
    );
    const result = await controller.addFiles([
      file('Movie.mkv'),
      file('Movie.en.srt'),
      file('Other.Film.2019.1080p.x264.mp4'),
      file('cover.jpg'),
    ]);
    expect(result).toEqual({
      added: 2,
      skipped: 1,
      leftOut: [{ name: 'cover.jpg', reason: 'other' }],
    });
    const [movie, other] = items();
    expect(movie.phase).toBe('ready');
    expect(
      movie.subtitles.map((track) => [track.key, track.language, track.include])
    ).toEqual([
      ['stream:2', 'de', true],
      ['stream:3', 'en', false],
      ['file:source-2', 'en', true],
    ]);
    expect(movie.subtitles[1].picture).toBe(true);
    expect(other.fields).toMatchObject({ title: 'Other Film', year: 2019 });
    expect(other.subtitles).toEqual([]);
    expect(tool.forgetSource).toHaveBeenCalledWith('source-4');
  });

  it('marks a file it cannot read as unusable', async () => {
    tool.probes.set('broken.mp4', new Error('[video-tool:no-video] none'));
    await controller.addFiles([file('broken.mp4')]);
    expect(items()[0]).toMatchObject({
      phase: 'unusable',
      error: { code: 'no-video', stage: 'probe' },
    });
  });

  it('suggests a Subscreen series for a folder of episodes, sorted', async () => {
    await controller.addFiles([
      file('Show.S01E02.Second.mkv', 'Show (2021)/Show.S01E02.Second.mkv'),
      file('Show.S01E10.mkv', 'Show (2021)/Show.S01E10.mkv'),
      file('Show.S01E01.Pilot.mkv', 'Show (2021)/Show.S01E01.Pilot.mkv'),
    ]);
    const settings = store.get(videoPublisherSettingsAtom);
    expect(settings.destination).toBe('subscreen-series');
    expect(settings.series.title).toBe('Show');
    expect(items().map((item) => item.fields.episode)).toEqual([1, 2, 10]);
    expect(items()[0].fields.episodeTitle).toBe('Pilot');
  });

  it('publishes only the ticked videos; a Publish during the run sends the rest to another app', async () => {
    await controller.loadNodeLimit();
    await controller.addFiles([file('First.mp4'), file('Second.mp4')]);
    setShared({ category: 99 });
    const [first, second] = items();
    controller.setTicked(second.id, false);
    expect(controller.publishableIds()).toEqual([first.id]);
    controller.start(ACCOUNT);
    await settle();
    expect(items().map((item) => item.phase)).toEqual(['converting', 'ready']);
    expect(store.get(videoRunAtom).itemIds).toEqual([first.id]);

    // A series can't join (its playlist is planned at the start).
    controller.setDestination('subscreen-series');
    controller.setTicked(second.id, true);
    expect(controller.joinableIds()).toEqual([]);

    controller.setDestination('torq');
    expect(controller.joinableIds()).toEqual([second.id]);
    controller.start(ACCOUNT);
    await settle();
    expect(items()[1].phase).toBe('waiting');
    expect(items()[0].context.destination).toBe('qtube');
    expect(items()[1].context.destination).toBe('torq');
    // One run: its counts and Cancel all cover both.
    expect(items()[1].context.id).toBe(items()[0].context.id);
    expect(store.get(videoRunAtom).itemIds).toEqual([first.id, second.id]);

    tool.finishJob('job-1');
    await settle();
    expect(publishes[0].steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
    ]);
    publishes[0].resolve();
    await settle();
    tool.finishJob('job-2');
    await settle();
    expect(publishes[1].steps.map((step) => step.kind)).toContain('post');
    publishes[1].resolve();
    await settle();
    expect(items().map((item) => item.phase)).toEqual(['done', 'done']);
  });

  it("weights an upload's progress by the bytes of its steps", async () => {
    await controller.loadNodeLimit();
    await controller.addFiles([file('First.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    const [video] = publishes[0].steps;
    publishes[0].options.onStepStart(video, 0);
    expect(items()[0].publish).toMatchObject({
      bytesBefore: 0,
      stepBytes: video.bytes,
      bytesTotal: publishes[0].steps.reduce(
        (sum, step) => sum + Math.max(1, step.bytes || 0),
        0
      ),
    });
    publishes[0].resolve();
    await settle();
  });

  it('shows the node preparing the video while it reads it itself', async () => {
    let finish: (result: VideoNodeBuildResult) => void = () => undefined;
    vi.mocked(tool.buildOnNode).mockImplementation(
      () =>
        new Promise<VideoNodeBuildResult>((resolve) => {
          finish = resolve;
        })
    );
    await controller.loadNodeLimit();
    await controller.addFiles([file('First.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    const [video] = publishes[0].steps;
    publishes[0].options.onStepStart(video, 0);
    const reference = ('file' in video.data
      ? video.data.file
      : null) as unknown as NodeBuildable;
    const endpoint =
      'http://127.0.0.1:12391/arbitrary/VIDEO/Me/qtube_vid_x?apiKey=k';

    const building = reference.buildOnNode(endpoint);
    await settle();
    expect(items()[0].publish.onNode).toBe(true);
    expect(tool.buildOnNode).toHaveBeenCalledWith({
      jobId: 'job-1',
      file: 'video',
      endpoint,
      filename: 'First.mp4',
    });
    finish({ ok: true, transaction: '3mJr' });
    expect(await building).toBe('3mJr');
    expect(items()[0].publish.onNode).toBeUndefined();
    publishes[0].resolve();
    await settle();
  });

  it('converts to AV1 on a fast PC, else H.264, and passes it to the job', async () => {
    // Before the converter's status is known: H.264.
    expect(controller.codec()).toBe('h264');
    controller.setEncoderInfo({ av1: true, cpuThreads: 16 });
    expect(controller.codec()).toBe('av1');
    controller.setEncoderInfo({ av1: true, cpuThreads: 4 });
    expect(controller.codec()).toBe('h264');
    controller.updateSettings({ codec: 'av1' });
    expect(controller.codec()).toBe('av1');
    // Never AV1 when this Hub can't write it.
    controller.setEncoderInfo({ av1: false, cpuThreads: 16 });
    expect(controller.codec()).toBe('h264');

    controller.setEncoderInfo({ av1: true, cpuThreads: 16 });
    controller.updateSettings({ codec: null });
    await controller.loadNodeLimit();
    await controller.addFiles([file('First.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    expect(vi.mocked(tool.startJob).mock.calls[0][0]).toMatchObject({
      codec: 'av1',
    });
  });

  it('keeps a destination the user picked', async () => {
    controller.setDestination('torq');
    await controller.addFiles([file('A E01.mkv'), file('A E02.mkv')]);
    expect(store.get(videoPublisherSettingsAtom).destination).toBe('torq');
  });

  it('converts the next video while the one before it uploads, in order', async () => {
    await controller.loadNodeLimit();
    await controller.addFiles([file('First.mp4'), file('Second.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(1);
    const firstSpec = vi.mocked(tool.startJob).mock.calls[0][0];
    expect(firstSpec).toMatchObject({ quality: '720', subtitles: [] });
    expect(firstSpec.sizeLimitBytes).toBe(2000 * 1024 * 1024);
    expect(items()[0].phase).toBe('converting');

    tool.emit({
      ...tool.jobs.get('job-1'),
      phase: 'encoding',
      percent: 42,
      etaSec: 170,
    });
    expect(items()[0]).toMatchObject({ percent: 42, etaSec: 170 });

    tool.finishJob('job-1');
    await settle();
    // The first uploads and the second converts at the same time.
    expect(publishes).toHaveLength(1);
    expect(tool.startJob).toHaveBeenCalledTimes(2);
    expect(items().map((item) => item.phase)).toEqual([
      'publishing',
      'converting',
    ]);
    expect(publishes[0].steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
    ]);
    expect(publishes[0].options.name).toBe('Tester');

    tool.finishJob('job-2');
    await settle();
    // The second waits for the first: one upload at a time, in order.
    expect(publishes).toHaveLength(1);
    expect(items()[1].phase).toBe('converted');

    publishes[0].resolve();
    await settle();
    expect(items()[0].phase).toBe('done');
    expect(items()[0].record.link).toMatch(
      /^qortal:\/\/APP\/Q-Tube\/video\/Tester\//
    );
    expect(tool.releaseJob).toHaveBeenCalledWith('job-1');
    expect(publishes).toHaveLength(2);
    publishes[1].resolve();
    await settle();
    expect(items()[1].phase).toBe('done');
    expect(store.get(videoRunAtom).active).toBe(false);
    expect(tool.listenerCount()).toBe(0);
  });

  it('publishes subtitles between the video and its listing', async () => {
    await controller.loadNodeLimit();
    tool.probes.set(
      'Film.mkv',
      fakeProbe({
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            isDefault: true,
            kind: 'text',
            isForced: false,
          },
        ],
      })
    );
    await controller.addFiles([file('Film.mkv')]);
    setShared({ category: 1 });
    controller.start(ACCOUNT);
    await settle();
    expect(vi.mocked(tool.startJob).mock.calls[0][0].subtitles).toEqual([
      { source: 'stream', index: 2, language: 'en' },
    ]);
    tool.finishJob('job-1', {
      subtitles: [{ id: 's0', language: 'en', bytes: 20 }],
    });
    await settle();
    expect(tool.readText).toHaveBeenCalledWith('job-1', 's0');
    expect(publishes[0].steps.map((step) => step.kind)).toEqual([
      'video',
      'subtitle',
      'metadata',
    ]);
  });

  it('waits for the user when each video is to be checked first', async () => {
    controller.updateSettings({ reviewFirst: true });
    await controller.addFiles([file('Clip.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    expect(items()[0].phase).toBe('review');
    expect(publishes).toHaveLength(0);
    expect(store.get(videoRunAtom).active).toBe(true);
    controller.approve(items()[0].id);
    await settle();
    expect(publishes).toHaveLength(1);
  });

  it('discards a checked video and moves on', async () => {
    controller.updateSettings({ reviewFirst: true });
    await controller.addFiles([file('Clip.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    await controller.discard(items()[0].id);
    await settle();
    expect(items()[0].phase).toBe('discarded');
    expect(tool.releaseJob).toHaveBeenCalledWith('job-1');
    expect(store.get(videoRunAtom).active).toBe(false);
  });

  it('shows why a conversion failed, and converts again on Retry', async () => {
    await controller.addFiles([file('Long.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.failJob('job-1', 'disk-full');
    await settle();
    expect(items()[0]).toMatchObject({
      phase: 'failed',
      error: { code: 'disk-full', stage: 'convert' },
    });
    // Nothing went up: Retry converts again (the upload asks for
    // approval when it goes).
    expect(controller.retry(items()[0].id)).toBe(true);
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(2);
    expect(items()[0].phase).toBe('converting');
  });

  it('fails a video too long for every quality before converting', async () => {
    tool.probes.set('Epic.mkv', fakeProbe({ durationSec: 40 * 3600 }));
    await controller.addFiles([file('Epic.mkv')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    expect(tool.startJob).not.toHaveBeenCalled();
    expect(items()[0].error).toEqual({
      code: 'no-quality-fits',
      stage: 'convert',
    });
  });

  it('stops the run on a refusal and keeps converted videos for Retry', async () => {
    await controller.addFiles([file('A.mp4'), file('B.mp4'), file('C.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    tool.finishJob('job-2');
    await settle();
    const refused = { code: 'refused' } as never;
    publishes[0].resolve({
      ok: false,
      stoppedBy: refused,
      outcomes: [
        { key: publishes[0].steps[0].key, status: 'failed', error: refused },
      ],
    });
    await settle();
    expect(items().map((item) => item.phase)).toEqual([
      'failed',
      'failed',
      'ready',
    ]);
    expect(items()[0].error.code).toBe('refused');
    expect(items()[1].error.code).toBe('stopped');
    expect(store.get(videoRunAtom)).toMatchObject({
      active: false,
      stoppedBy: 'refused',
    });

    // Retry publishes again, skipping what went through (the run stopped:
    // once confirmed again).
    controller.retry(items()[1].id);
    await settle();
    expect(publishes).toHaveLength(2);
    expect(tool.startJob).toHaveBeenCalledTimes(2);
  });

  it('publishes a series: every episode, then the playlist', async () => {
    await controller.addFiles([
      file('Show S01E01.mkv'),
      file('Show S01E02.mkv'),
    ]);
    controller.updateSettings((current) => ({
      series: { ...current.series, title: 'Show', genre: 201 },
    }));
    controller.start(ACCOUNT);
    for (const job of ['job-1', 'job-2']) {
      await settle();
      tool.finishJob(job);
      await settle();
      publishes[publishes.length - 1].resolve();
    }
    await settle();
    expect(publishes).toHaveLength(3);
    expect(publishes[2].steps.map((step) => step.kind)).toEqual(['playlist']);
    // The episodes' listings went up before: the playlist may go.
    expect([...publishes[2].options.completed]).toEqual(
      publishes[2].steps[0].dependsOn
    );
    expect(publishes[2].steps[0].dependsOn).toHaveLength(2);
    expect(store.get(videoRunAtom).series.phase).toBe('publishing');
    publishes[2].resolve();
    await settle();
    const run = store.get(videoRunAtom);
    expect(run.series.phase).toBe('done');
    expect(run.series.record.link).toMatch(/^qortal:\/\/APP\/Subscreen\//);
    expect(run.series.record.resources).toHaveLength(5);
    // Each episode links to its own page.
    expect(items()[0].link).toMatch(/Q-Tube\/video\/Tester\/qtube_vid_/);
  });

  it('waits to publish a series while an episode failed', async () => {
    await controller.addFiles([
      file('Show S01E01.mkv'),
      file('Show S01E02.mkv'),
    ]);
    controller.updateSettings((current) => ({
      series: { ...current.series, title: 'Show', genre: 201 },
    }));
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    publishes[0].resolve();
    await settle();
    tool.failJob('job-2', 'ffmpeg-failed');
    await settle();
    expect(publishes).toHaveLength(1);
    expect(store.get(videoRunAtom).series.phase).toBe('waiting');
    // The playlist asks for approval when it goes, not before.
    expect(controller.publishSeriesWithoutFailed()).toBe(true);
    await settle();
    expect(publishes).toHaveLength(2);
    expect(publishes[1].steps[0].kind).toBe('playlist');
  });

  it('asks for approval again before a failed playlist goes up again', async () => {
    await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
    for (const job of ['job-1', 'job-2']) {
      await settle();
      tool.finishJob(job);
      await settle();
      publishes[publishes.length - 1].resolve();
    }
    await settle();
    expect(publishes[2].steps[0].kind).toBe('playlist');
    failSteps(publishes[2], ':playlist');
    await settle();
    expect(store.get(videoRunAtom)).toMatchObject({
      active: false,
      series: { phase: 'failed' },
    });
    // Two episodes and the playlist each asked.
    expect(approvals).toHaveBeenCalledTimes(3);
    expect(controller.retrySeries()).toBe(true);
    await settle();
    expect(approvals).toHaveBeenCalledTimes(4);
    expect(approvals.mock.calls[3][0].resources).toHaveLength(1);
    expect(publishes).toHaveLength(4);
    expect(publishes[3].steps[0].kind).toBe('playlist');
  });

  it('saves to this PC without a name and releases the job', async () => {
    controller.setDestination('save');
    await controller.addFiles([file('Holiday.MOV')]);
    controller.start({ name: null, publicKey: null });
    await settle();
    expect(vi.mocked(tool.startJob).mock.calls[0][0].sizeLimitBytes).toBe(
      64 * 1024 ** 3
    );
    tool.finishJob('job-1');
    await settle();
    expect(tool.saveOutput).toHaveBeenCalledWith('job-1', 'Holiday.mp4');
    expect(items()[0]).toMatchObject({ phase: 'done', saved: true });
    expect(tool.releaseJob).toHaveBeenCalledWith('job-1');
  });

  it('keeps the file when the save dialog is closed, for Save later', async () => {
    vi.mocked(tool.saveOutput).mockResolvedValueOnce({ saved: false });
    controller.setDestination('save');
    await controller.addFiles([file('Holiday.MOV')]);
    controller.start({ name: null, publicKey: null });
    await settle();
    tool.finishJob('job-1');
    await settle();
    expect(items()[0]).toMatchObject({ phase: 'converted', saved: false });
    expect(store.get(videoRunAtom).active).toBe(false);
    await controller.saveItem(items()[0].id);
    expect(items()[0].phase).toBe('done');
  });

  it('cancels a conversion', async () => {
    await controller.addFiles([file('A.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    await controller.cancelItem(items()[0].id);
    await settle();
    expect(tool.cancelJob).toHaveBeenCalledWith('job-1');
    expect(items()[0].phase).toBe('cancelled');
    expect(store.get(videoRunAtom).active).toBe(false);
  });

  describe('subtitles after the conversion started', () => {
    it('writes subtitles added during the conversion once it is done, and publishes those', async () => {
      await controller.loadNodeLimit();
      await controller.addFiles([file('Film.mkv')]);
      setShared({ category: 1 });
      controller.start(ACCOUNT);
      await settle();
      expect(vi.mocked(tool.startJob).mock.calls[0][0].subtitles).toEqual([]);
      const id = items()[0].id;
      expect(items()[0].phase).toBe('converting');

      // Added while it converts: nothing to write yet.
      expect(await controller.addSubtitleFiles(id, [file('Film.en.srt')])).toBe(
        1
      );
      await settle();
      expect(tool.remakeSubtitles).not.toHaveBeenCalled();

      tool.finishJob('job-1');
      await settle();
      expect(tool.remakeSubtitles).toHaveBeenCalledTimes(1);
      const [jobId, list] = vi.mocked(tool.remakeSubtitles).mock.calls[0];
      expect(jobId).toBe('job-1');
      expect(list).toEqual([
        { source: 'file', sourceId: expect.any(String), language: 'en' },
      ]);
      // What goes up is what was written again.
      expect(tool.readText).toHaveBeenCalledWith('job-1', 'g1s0');
      expect(publishes[0].steps.map((step) => step.kind)).toEqual([
        'video',
        'subtitle',
        'metadata',
      ]);
      expect(items()[0].subtitlesBusy).toBeUndefined();
    });

    it('writes them again when they change on a converted video, once the edits stop', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        controller.updateSettings({ reviewFirst: true });
        await controller.addFiles([file('Film.mkv')]);
        setShared({ category: 1 });
        controller.start(ACCOUNT);
        await settle();
        tool.finishJob('job-1');
        await settle();
        const id = items()[0].id;
        expect(items()[0].phase).toBe('review');
        expect(tool.remakeSubtitles).not.toHaveBeenCalled();

        await controller.addSubtitleFiles(id, [file('Film.de.srt')]);
        controller.changeSubtitles(id, (subtitles) =>
          subtitles.map((track) => ({ ...track, label: 'Deutsch' }))
        );
        // One write for both edits.
        await vi.advanceTimersByTimeAsync(500);
        await settle();
        expect(tool.remakeSubtitles).toHaveBeenCalledTimes(1);
        expect(vi.mocked(tool.remakeSubtitles).mock.calls[0][1]).toEqual([
          {
            source: 'file',
            sourceId: expect.any(String),
            language: 'de',
            label: 'Deutsch',
          },
        ]);
        expect(items()[0].output.subtitles).toEqual([
          { id: 'g1s0', language: 'de', label: 'Deutsch', bytes: 100 },
        ]);
        // Nothing changed since: nothing is written again.
        controller.subtitlesChanged(id);
        await vi.advanceTimersByTimeAsync(500);
        await settle();
        expect(tool.remakeSubtitles).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('converts a cancelled video again with what was changed after the Cancel', async () => {
      await controller.addFiles([file('Film.mkv')]);
      setShared({ category: 1 });
      controller.start(ACCOUNT);
      await settle();
      const id = items()[0].id;
      await controller.cancelItem(id);
      await settle();
      expect(items()[0].phase).toBe('cancelled');

      await controller.addSubtitleFiles(id, [file('Film.en.srt')]);
      expect(controller.retry(id)).toBe(true);
      await settle();
      expect(tool.startJob).toHaveBeenCalledTimes(2);
      expect(vi.mocked(tool.startJob).mock.calls[1][0].subtitles).toEqual([
        { source: 'file', sourceId: expect.any(String), language: 'en' },
      ]);
    });

    it('takes subtitles chosen while it waited its turn into its job', async () => {
      await controller.addFiles([file('A.mkv'), file('B.mkv')]);
      setShared({ category: 1 });
      controller.start(ACCOUNT);
      await settle();
      const second = items()[1].id;
      expect(items()[1].phase).toBe('waiting');
      await controller.addSubtitleFiles(second, [file('B.en.srt')]);
      tool.finishJob('job-1');
      await settle();
      expect(vi.mocked(tool.startJob).mock.calls[1][0].subtitles).toEqual([
        { source: 'file', sourceId: expect.any(String), language: 'en' },
      ]);
    });
  });

  describe('pausing a conversion', () => {
    it('pauses and resumes the job, and shows no time left meanwhile', async () => {
      controller.setEncoderInfo({ av1: true, cpuThreads: 16, canPause: true });
      expect(controller.canPause()).toBe(true);
      await controller.addFiles([file('Film.mkv')]);
      setShared({ category: 1 });
      controller.start(ACCOUNT);
      await settle();
      const id = items()[0].id;
      tool.emit({
        ...tool.jobs.get('job-1'),
        phase: 'encoding',
        percent: 40,
        etaSec: 90,
      });
      expect(items()[0]).toMatchObject({ percent: 40, etaSec: 90 });

      await controller.pauseItem(id);
      expect(tool.pauseJob).toHaveBeenCalledWith('job-1');
      expect(items()[0]).toMatchObject({ paused: true, etaSec: undefined });
      // A late progress event keeps it paused, without a time left.
      tool.emit({ ...tool.jobs.get('job-1'), percent: 41, etaSec: 80 });
      expect(items()[0]).toMatchObject({ paused: true, etaSec: undefined });

      await controller.resumeItem(id);
      expect(tool.resumeJob).toHaveBeenCalledWith('job-1');
      expect(items()[0].paused).toBeUndefined();
      tool.finishJob('job-1');
      await settle();
      expect(items()[0].paused).toBeUndefined();
    });

    it("can't pause where the converter says so, or a video that isn't converting", async () => {
      controller.setEncoderInfo({ av1: true, cpuThreads: 16, canPause: false });
      expect(controller.canPause()).toBe(false);
      await controller.addFiles([file('Film.mkv')]);
      await settle();
      await controller.pauseItem(items()[0].id);
      expect(tool.pauseJob).not.toHaveBeenCalled();
    });
  });

  it('removes what a video published by replacing each resource', async () => {
    await controller.addFiles([file('A.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    publishes[0].resolve();
    await settle();
    const id = items()[0].id;
    expect(controller.removalCount(items()[0].record)).toBe(2);
    const removing = controller.removePublished(id, ACCOUNT);
    await settle();
    expect(items()[0].removal).toBe('removing');
    const removal = publishes[1];
    expect(removal.steps.map((step) => [step.kind, step.data])).toEqual([
      ['metadata', { base64: 'RA==' }],
      ['video', { base64: 'RA==' }],
    ]);
    removal.resolve();
    await removing;
    expect(items()[0].removal).toBe('removed');
  });

  it('refuses to remove as another name', async () => {
    await controller.addFiles([file('A.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    publishes[0].resolve();
    await settle();
    await controller.removePublished(items()[0].id, {
      name: 'Someone',
      publicKey: null,
    });
    expect(items()[0].removal).toBe('failed');
    expect(publishes).toHaveLength(1);
  });

  /** Fails the steps whose key ends with one of `failing` (network). */
  const failSteps = (publish: Publish, ...failing: string[]) => {
    const network = { code: 'network' } as never;
    publish.resolve({
      ok: false,
      outcomes: publish.steps.map((entry) =>
        failing.some((end) => entry.key.endsWith(end))
          ? { key: entry.key, status: 'failed' as const, error: network }
          : { key: entry.key, status: 'published' as const }
      ),
    });
  };

  const startSeries = async (names: string[]) => {
    await controller.addFiles(names.map((name) => file(name)));
    controller.updateSettings((current) => ({
      series: { ...current.series, title: 'Show', genre: 201 },
    }));
    controller.start(ACCOUNT);
  };

  /** The run's account, signed in before anything is queued. */
  const SIGNED_IN = { ...ACCOUNT, address: 'Qfirst' };
  const signIn = () => {
    store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
    controller.dispose();
    controller = new VideoPublisherController(deps);
  };

  it('keeps an episode removable when it went up only in part', async () => {
    tool.probes.set(
      'Show S01E01.mkv',
      fakeProbe({
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            isDefault: true,
            kind: 'text',
            isForced: false,
          },
        ],
      })
    );
    await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
    await settle();
    tool.finishJob('job-1', {
      subtitles: [{ id: 's0', language: 'en', bytes: 20 }],
    });
    await settle();
    // The VIDEO went up, its subtitle didn't.
    failSteps(publishes[0], ':subtitle:0', ':metadata');
    await settle();
    const [episode] = items();
    expect(episode.phase).toBe('failed');
    expect(episode.record.resources.map((r) => r.kind)).toEqual(['video']);
    expect(controller.removalCount(episode.record)).toBe(1);
  });

  it('retries a failed video where its own run sent it, skipping what went up', async () => {
    await controller.addFiles([file('A.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    failSteps(publishes[0], ':metadata');
    await settle();
    const first = items()[0];
    expect(first.phase).toBe('failed');
    const videoStep = publishes[0].steps[0];

    // A new run, to Torq, with another video.
    await controller.addFiles([file('B.mp4')]);
    controller.setDestination('torq');
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-2');
    await settle();
    publishes[1].resolve();
    await settle();
    // Only the new run's video counts in its progress.
    expect(store.get(videoRunAtom).itemIds).toEqual([items()[1].id]);

    controller.retry(first.id);
    await settle();
    const retried = publishes[2];
    // Q-Tube still, with the same VIDEO: it's not uploaded (or paid) again.
    expect(retried.steps.map((entry) => entry.kind)).toEqual([
      'video',
      'metadata',
    ]);
    expect(retried.steps[0].identifier).toBe(videoStep.identifier);
    expect(retried.options.completed.has(videoStep.key)).toBe(true);
    expect(items()[0].context.destination).toBe('qtube');
  });

  it('does not retry once what went up was removed', async () => {
    await controller.addFiles([file('A.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    failSteps(publishes[0], ':metadata');
    await settle();
    const id = items()[0].id;
    const removing = controller.removePublished(id, ACCOUNT);
    await settle();
    publishes[1].resolve();
    await removing;
    expect(items()[0].removal).toBe('removed');
    expect(controller.canRetry(items()[0])).toBe(false);
    controller.retry(id);
    await settle();
    // No listing goes up for the replaced VIDEO.
    expect(publishes).toHaveLength(2);
  });

  it('converts a retried video above one already converted', async () => {
    await controller.addFiles([file('A.mp4'), file('B.mp4'), file('C.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    tool.failJob('job-1', 'ffmpeg-failed');
    await settle();
    tool.finishJob('job-2');
    await settle();
    tool.finishJob('job-3');
    await settle();
    expect(items().map((item) => item.phase)).toEqual([
      'failed',
      'publishing',
      'converted',
    ]);
    controller.retry(items()[0].id);
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(4);
    tool.finishJob('job-4');
    publishes[0].resolve();
    await settle();
    publishes[1].resolve();
    await settle();
    publishes[2].resolve();
    await settle();
    expect(items().map((item) => item.phase)).toEqual(['done', 'done', 'done']);
    expect(store.get(videoRunAtom).active).toBe(false);
  });

  it('keeps the shared fields a run started with', async () => {
    await controller.addFiles([file('A.mp4'), file('B.mp4')]);
    setShared({ category: 99 });
    controller.start(ACCOUNT);
    await settle();
    // Cleared while the first converts: the second still has its category.
    setShared({ category: null });
    tool.finishJob('job-1');
    await settle();
    tool.finishJob('job-2');
    await settle();
    publishes[0].resolve();
    await settle();
    expect(publishes).toHaveLength(2);
    expect(items()[1].phase).toBe('publishing');
  });

  it('keeps episodes listed and removable until the playlist takes them in', async () => {
    await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
    await settle();
    tool.finishJob('job-1');
    await settle();
    publishes[0].resolve();
    await settle();
    tool.failJob('job-2', 'ffmpeg-failed');
    await settle();
    const [done] = items();
    expect(done.record.app).toBe('subscreen');
    expect(controller.isHeldBySeries(done)).toBe(true);
    await controller.clearFinished();
    await controller.removeItem(done.id);
    expect(items()).toHaveLength(2);

    controller.publishSeriesWithoutFailed();
    await settle();
    publishes[1].resolve();
    await settle();
    expect(store.get(videoRunAtom).series.phase).toBe('done');
    // The series' record covers it now.
    expect(items()[0].record).toBeUndefined();

    // The failed one, retried after: the playlist goes up again with it.
    controller.retry(items()[1].id);
    await settle();
    tool.finishJob('job-3');
    await settle();
    publishes[2].resolve();
    await settle();
    expect(publishes[3].steps[0].kind).toBe('playlist');
    expect(publishes[3].steps[0].identifier).toBe(
      publishes[1].steps[0].identifier
    );
    expect(publishes[3].steps[0].dependsOn).toHaveLength(2);
  });

  it('stops and clears everything when another account signs in', async () => {
    store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
    controller.dispose();
    controller = new VideoPublisherController(deps);
    await controller.addFiles([file('A.mp4')]);
    setShared({ category: 99 });
    controller.start({ ...ACCOUNT, address: 'Qfirst' });
    await settle();
    tool.finishJob('job-1');
    await settle();
    expect(publishes).toHaveLength(1);
    store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
    await settle();
    expect(publishes[0].options.signal.aborted).toBe(true);
    expect(items()).toEqual([]);
    expect(store.get(videoRunAtom)).toEqual(VIDEO_PUBLISHER_IDLE_RUN);
    expect(tool.releaseJob).toHaveBeenCalledWith('job-1');
    publishes[0].resolve();
    await settle();
    expect(items()).toEqual([]);
  });

  describe("a series' playlist when another account signs in", () => {
    /** One episode converted, as the signed-in account. */
    const episodeConverted = async () => {
      signIn();
      await controller.addFiles([file('Show S01E01.mkv')]);
      controller.setDestination('subscreen-series');
      controller.updateSettings((current) => ({
        series: { ...current.series, title: 'Show', genre: 201 },
      }));
      controller.start(SIGNED_IN);
      await settle();
      tool.finishJob('job-1');
      await settle();
    };

    it('leaves no series card behind when the switch comes while its approval is open', async () => {
      let answer: (accepted: boolean) => void = () => undefined;
      await episodeConverted();
      expect(publishes).toHaveLength(1);
      // The episode's approval went; the playlist's waits for an answer.
      approvals.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      publishes[0].resolve();
      await settle();
      expect(store.get(videoRunAtom).series?.awaitingApproval).toBe(true);

      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      expect(store.get(videoRunAtom).series).toBeUndefined();

      answer(false);
      await settle();

      // The next account's window has no series of its own.
      expect(store.get(videoRunAtom).series).toBeUndefined();
    });

    it('does not ask the next account to approve the playlist when the switch comes while its fee is asked', async () => {
      let giveFee: () => void = () => undefined;
      vi.mocked(deps.estimatePublishFee).mockImplementation(
        (count) =>
          new Promise((resolve) => {
            giveFee = () =>
              resolve({
                unitFee: 0.01,
                count: Number(count),
                total: Number(count) * 0.01,
              });
          })
      );
      await episodeConverted();
      giveFee();
      await settle();
      publishes[0].resolve();
      await settle();
      // The playlist's fee is being asked.
      expect(approvals).toHaveBeenCalledTimes(1);

      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      giveFee();
      await settle();

      expect(approvals).toHaveBeenCalledTimes(1);
      expect(store.get(videoRunAtom).series).toBeUndefined();
    });
  });

  describe("Remove while the series' playlist goes up", () => {
    /** Episode 1 up, episode 2 failed, and the playlist up without it. */
    const seriesUpWithoutEpisode2 = async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.finishJob('job-2');
      await settle();
      failSteps(publishes[1], ':video', ':metadata');
      await settle();
      expect(controller.publishSeriesWithoutFailed()).toBe(true);
      await settle();
      publishes[2].resolve();
      await settle();
      expect(store.get(videoRunAtom).series.phase).toBe('done');
    };

    /** Episode 2 retried and up, so the playlist goes again. */
    const episode2Again = async () => {
      expect(controller.retry(items()[1].id)).toBe(true);
      await settle();
      publishes[3].resolve();
      await settle();
    };

    it('does not remove an episode while the playlist that lists it goes up', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.finishJob('job-2');
      await settle();
      publishes[1].resolve();
      await settle();
      // The playlist was approved and is going up.
      expect(store.get(videoRunAtom).series.phase).toBe('publishing');
      expect(publishes[2].steps[0].kind).toBe('playlist');
      const [first] = items();
      const entry = controller.published.find(
        (current) => current.id === `item:${first.id}`
      );
      expect(controller.removalBlocked(first.id)).toBe(true);
      expect(controller.canRemoveSaved(entry)).toBe(false);

      // Its card's Remove, or the list's, confirmed meanwhile.
      await controller.removePublished(first.id, ACCOUNT);
      await controller.removeSaved(entry.id, ACCOUNT);
      await settle();

      // Nothing replaced: Subscreen would list an episode that's gone.
      expect(publishes).toHaveLength(3);
      expect(items()[0].removal).toBeUndefined();
      publishes[2].resolve();
      await settle();
      expect(store.get(videoRunAtom).series.phase).toBe('done');
      expect(controller.removalBlocked('series')).toBe(false);
    });

    it('does not publish the playlist again once the series was removed', async () => {
      await seriesUpWithoutEpisode2();
      // Episode 2 goes up; the playlist's approval is declined.
      approvals.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await episode2Again();
      expect(store.get(videoRunAtom).series).toMatchObject({
        phase: 'failed',
        error: { code: 'approval-declined' },
      });
      expect(store.get(videoRunAtom).series.record).toBeDefined();

      // The series' card: Remove from Subscreen.
      const removing = controller.removePublished('series', ACCOUNT);
      await settle();
      publishes[4].resolve();
      await removing;
      expect(store.get(videoRunAtom).series.removal).toBe('removed');

      // Retry would list replaced episodes again.
      expect(controller.retrySeries()).toBe(false);
      expect(controller.publishSeriesWithoutFailed()).toBe(false);
      await settle();
      expect(publishes).toHaveLength(5);
    });

    it('does not remove the series while its playlist goes up again', async () => {
      await seriesUpWithoutEpisode2();
      await episode2Again();
      expect(store.get(videoRunAtom).series.phase).toBe('publishing');
      expect(publishes[4].steps[0].kind).toBe('playlist');
      const { historyId } = store.get(videoRunAtom).series;
      const entry = controller.published.find(
        (current) => current.id === historyId
      );
      expect(controller.removalBlocked('series')).toBe(true);
      expect(controller.canRemoveSaved(entry)).toBe(false);

      // The series' card's Remove, or the list's, confirmed meanwhile.
      await controller.removePublished('series', ACCOUNT);
      await controller.removeSaved(entry.id, ACCOUNT);
      await settle();

      expect(publishes).toHaveLength(5);
      expect(store.get(videoRunAtom).series.removal).toBeUndefined();
    });
  });

  describe('approval right before publishing', () => {
    it('asks right before a video goes up, with its resources and fee', async () => {
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      // Converting starts without asking.
      controller.start(ACCOUNT);
      await settle();
      expect(approvals).not.toHaveBeenCalled();
      expect(items()[0].phase).toBe('converting');
      tool.finishJob('job-1');
      await settle();
      expect(approvals).toHaveBeenCalledTimes(1);
      const { resources, fee } = approvals.mock.calls[0][0];
      expect(resources.map((r: { service: string }) => r.service)).toEqual(
        publishes[0].steps.map((step) => step.service)
      );
      expect(resources[0]).toMatchObject({
        name: 'Tester',
        identifier: publishes[0].steps[0].identifier,
      });
      expect(fee).toBeCloseTo(0.01 * publishes[0].steps.length, 8);
      publishes[0].resolve();
      await settle();
      expect(items()[0].phase).toBe('done');
    });

    it('ends as cancelled when Cancel is pressed while the approval is open', async () => {
      let answer: (accepted: boolean) => void = () => undefined;
      approvals.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      const id = items()[0].id;
      expect(items()[0]).toMatchObject({
        phase: 'publishing',
        awaitingApproval: true,
      });
      await controller.cancelItem(id);
      // Accepted after the Cancel: still nothing goes up.
      answer(true);
      await settle();
      expect(items()[0].phase).toBe('cancelled');
      expect(items()[0].awaitingApproval).toBeUndefined();
      expect(publishes).toHaveLength(0);
      expect(store.get(videoRunAtom).active).toBe(false);
      // Its converted file stays for Retry.
      expect(controller.canRetry(items()[0])).toBe(true);
    });

    it('waits for the approval, and keeps the file when it is declined', async () => {
      let answer: (accepted: boolean) => void = () => undefined;
      approvals.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(items()[0]).toMatchObject({
        phase: 'publishing',
        awaitingApproval: true,
      });
      expect(publishes).toHaveLength(0);
      answer(false);
      await settle();
      expect(items()[0]).toMatchObject({
        phase: 'failed',
        error: { code: 'approval-declined', stage: 'publish' },
      });
      expect(items()[0].awaitingApproval).toBeUndefined();
      expect(publishes).toHaveLength(0);
      // Retry asks again, and goes once accepted: no conversion again.
      approvals.mockResolvedValue(true);
      expect(controller.retry(items()[0].id)).toBe(true);
      await settle();
      expect(approvals).toHaveBeenCalledTimes(2);
      expect(publishes).toHaveLength(1);
      expect(tool.startJob).toHaveBeenCalledTimes(1);
    });

    it('publishes nothing when the node does not say the fee', async () => {
      vi.mocked(deps.estimatePublishFee).mockRejectedValue(new Error('down'));
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(approvals).not.toHaveBeenCalled();
      expect(publishes).toHaveLength(0);
      expect(items()[0].error).toMatchObject({ code: 'fee-unknown' });
    });

    it('asks nothing and publishes nothing when the balance cannot pay for all of it', async () => {
      // A VIDEO and its listing: 0.02 QORT, with 0.015 in the balance. Each
      // publish alone passes its own one-fee check (the balance only drops
      // once the first transaction confirms), so only a check of the whole
      // can say.
      vi.mocked(deps.checkPublishBalance).mockImplementation(
        async (_address, needed) => ({
          balance: 0.015,
          enough: 0.015 >= needed,
        })
      );
      signIn();
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(SIGNED_IN);
      await settle();
      tool.finishJob('job-1');
      await settle();

      expect(approvals).not.toHaveBeenCalled();
      expect(publishes).toHaveLength(0);
      expect(items()[0].error).toMatchObject({
        code: 'balance',
        stage: 'publish',
      });
      // With the account's key, so its unconfirmed fees count too.
      expect(deps.checkPublishBalance).toHaveBeenCalledWith(
        'Qfirst',
        0.02,
        'pubkey'
      );
    });

    it.each([
      ['is declined', () => approvals.mockResolvedValue(false)],
      [
        'cannot be asked (no fee from the node)',
        () =>
          vi
            .mocked(deps.estimatePublishFee)
            .mockRejectedValue(new Error('down')),
      ],
    ])(
      'keeps what went up removable from its card when the approval for the rest %s',
      async (_what, answer) => {
        await controller.addFiles([file('Clip.mp4')]);
        setShared({ category: 99 });
        controller.start(ACCOUNT);
        await settle();
        tool.finishJob('job-1');
        await settle();
        // The VIDEO goes up; its listing fails (the node couldn't be reached).
        failSteps(publishes[0], ':metadata');
        await settle();
        const video = publishes[0].steps.find((step) => step.kind === 'video');
        expect(items()[0].phase).toBe('failed');
        expect(items()[0].record?.resources.map((r) => r.identifier)).toEqual([
          video.identifier,
        ]);

        answer();
        expect(controller.retry(items()[0].id)).toBe(true);
        await settle();

        expect(items()[0].phase).toBe('failed');
        expect(publishes).toHaveLength(1);
        // The VIDEO is still on QDN: its card still says so, with Remove.
        expect(items()[0].record?.resources.map((r) => r.identifier)).toEqual([
          video.identifier,
        ]);
      }
    );

    it('asks again on Retry for what is left of a failed upload', async () => {
      await controller.addFiles([file('A.mp4'), file('B.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      failSteps(publishes[0], ':metadata');
      await settle();
      const first = items()[0];
      expect(first.phase).toBe('failed');
      expect(controller.retry(first.id)).toBe(true);
      await settle();
      const last = approvals.mock.calls[approvals.mock.calls.length - 1][0];
      // Only the listing is left of it.
      expect(last.resources).toHaveLength(1);
      expect(publishes).toHaveLength(2);
      expect(
        publishes[1].options.completed.has(publishes[0].steps[0].key)
      ).toBe(true);
    });

    it('goes back to be checked after Cancel all, then asks when it goes', async () => {
      controller.updateSettings({ reviewFirst: true });
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(items()[0].phase).toBe('review');
      await controller.cancelAll();
      await settle();
      expect(items()[0].phase).toBe('cancelled');
      const id = items()[0].id;
      expect(controller.retry(id)).toBe(true);
      await settle();
      // It waits for the check its run asked for, still.
      expect(items()[0].phase).toBe('review');
      expect(approvals).not.toHaveBeenCalled();
      controller.approve(id);
      await settle();
      expect(approvals).toHaveBeenCalledTimes(1);
      expect(publishes).toHaveLength(1);
    });

    it('does not ask before saving to this PC', async () => {
      controller.setDestination('save');
      await controller.addFiles([file('Holiday.MOV')]);
      controller.start({ name: null, publicKey: null });
      await settle();
      tool.failJob('job-1', 'disk-full');
      await settle();
      expect(controller.retry(items()[0].id)).toBe(true);
      expect(approvals).not.toHaveBeenCalled();
    });
  });

  describe('checking each video first', () => {
    it('keeps converting while videos wait, three at most, and publishes them as approved', async () => {
      controller.updateSettings({ reviewFirst: true });
      await controller.addFiles([
        file('A.mp4'),
        file('B.mp4'),
        file('C.mp4'),
        file('D.mp4'),
      ]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      for (const job of ['job-1', 'job-2', 'job-3']) {
        tool.finishJob(job);
        await settle();
      }
      expect(items().map((item) => item.phase)).toEqual([
        'review',
        'review',
        'review',
        'waiting',
      ]);
      expect(tool.startJob).toHaveBeenCalledTimes(3);
      expect(store.get(videoRunAtom).waitingForChecks).toBe(true);

      // The third, approved first, goes up first; the fourth converts.
      controller.approve(items()[2].id);
      await settle();
      expect(publishes).toHaveLength(1);
      expect(items()[2].phase).toBe('publishing');
      expect(tool.startJob).toHaveBeenCalledTimes(4);
      expect(store.get(videoRunAtom).waitingForChecks).toBeUndefined();
      expect(items()[3].phase).toBe('converting');
    });

    it('uploads approved videos while a retried one ahead waits to convert', async () => {
      controller.updateSettings({ reviewFirst: true });
      await controller.addFiles([
        file('A.mp4'),
        file('B.mp4'),
        file('C.mp4'),
        file('D.mp4'),
      ]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.failJob('job-1', 'ffmpeg-failed');
      await settle();
      for (const job of ['job-2', 'job-3', 'job-4']) {
        tool.finishJob(job);
        await settle();
      }
      expect(items().map((item) => item.phase)).toEqual([
        'failed',
        'review',
        'review',
        'review',
      ]);
      // The run is live: no confirmation. A waits, three are held.
      expect(controller.retry(items()[0].id)).toBe(true);
      await settle();
      expect(items()[0].phase).toBe('waiting');
      for (const index of [1, 2, 3]) controller.approve(items()[index].id);
      await settle();
      // B goes up although A, ahead of it, isn't converted yet; A converts.
      expect(publishes).toHaveLength(1);
      expect(items()[1].phase).toBe('publishing');
      expect(tool.startJob).toHaveBeenCalledTimes(5);
      expect(items()[0].phase).toBe('converting');
      tool.finishJob('job-5');
      for (let index = 0; index < 3; index += 1) {
        publishes[publishes.length - 1].resolve();
        await settle();
      }
      expect(items()[0].phase).toBe('review');
      controller.approve(items()[0].id);
      await settle();
      publishes[publishes.length - 1].resolve();
      await settle();
      expect(items().map((item) => item.phase)).toEqual([
        'done',
        'done',
        'done',
        'done',
      ]);
      expect(publishes).toHaveLength(4);
    });

    it('puts a series’ playlist last however its episodes were approved', async () => {
      controller.updateSettings({ reviewFirst: true });
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      tool.finishJob('job-2');
      await settle();
      expect(items().map((item) => item.phase)).toEqual(['review', 'review']);
      controller.approve(items()[1].id);
      await settle();
      expect(publishes).toHaveLength(1);
      publishes[0].resolve();
      await settle();
      // The first still waits for its check: no playlist yet.
      expect(publishes).toHaveLength(1);
      controller.approve(items()[0].id);
      await settle();
      publishes[1].resolve();
      await settle();
      expect(publishes).toHaveLength(3);
      const playlist = publishes[2];
      expect(playlist.steps.map((step) => step.kind)).toEqual(['playlist']);
      // Listed in the queue's order, episode 1 first.
      const listed = JSON.parse(
        atob((playlist.steps[0].data as { base64: string }).base64)
      );
      expect(JSON.stringify(listed)).toMatch(/S01E01[\s\S]*S01E02/);
    });
  });

  describe('the published list', () => {
    const publishOne = async (name = 'A.mp4') => {
      await controller.addFiles([file(name)]);
      setShared({ category: 99 });
      controller.start({ ...ACCOUNT, address: 'Qfirst' });
      await settle();
      tool.finishJob(`job-${vi.mocked(tool.startJob).mock.calls.length}`);
      await settle();
      publishes[publishes.length - 1].resolve();
      await settle();
    };

    beforeEach(() => {
      window.localStorage.clear();
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      controller.dispose();
      controller = new VideoPublisherController(deps);
    });

    it('keeps what went up after Clear finished and a restart', async () => {
      await publishOne();
      const [entry] = controller.published;
      expect(entry).toMatchObject({
        kind: 'qtube',
        record: { app: 'qtube', name: 'Tester', title: 'A' },
      });
      expect(entry.record.resources).toHaveLength(2);
      expect(
        window.localStorage.getItem('video-publisher-published-v1:Qfirst')
      ).toContain(entry.record.link);
      await controller.clearFinished();
      expect(items()).toEqual([]);
      expect(controller.published).toHaveLength(1);

      // A restart: a new controller reads it back.
      controller.dispose();
      controller = new VideoPublisherController(deps);
      expect(controller.published.map((current) => current.id)).toEqual([
        entry.id,
      ]);
      const removing = controller.removeSaved(entry.id, {
        ...ACCOUNT,
        address: 'Qfirst',
      });
      await settle();
      expect(controller.published[0].removal).toBe('removing');
      expect(publishes[1].steps.map((step) => step.data)).toEqual([
        { base64: 'RA==' },
        { base64: 'RA==' },
      ]);
      publishes[1].resolve();
      await removing;
      expect(controller.published[0].removal).toBe('removed');
      controller.dismissSaved(entry.id);
      expect(controller.published).toEqual([]);
      expect(
        window.localStorage.getItem('video-publisher-published-v1:Qfirst')
      ).toBe('[]');
    });

    it('takes one still published off the list without removing it', async () => {
      await publishOne();
      const [entry] = controller.published;
      controller.dismissSaved(entry.id);
      expect(controller.published).toEqual([]);
      // Nothing was replaced on QDN.
      expect(publishes).toHaveLength(1);
    });

    it('marks the card and the list alike, from either', async () => {
      await publishOne();
      const id = items()[0].id;
      const entryId = controller.published[0].id;
      // From the list: the card's own removal runs.
      const removing = controller.removeSaved(entryId, ACCOUNT);
      await settle();
      expect(items()[0].removal).toBe('removing');
      publishes[1].resolve();
      await removing;
      expect(items()[0].removal).toBe('removed');
      expect(controller.published[0].removal).toBe('removed');
      expect(controller.canRetry(items()[0])).toBe(false);

      // From a card: the list follows.
      await publishOne('B.mp4');
      const second = items()[1];
      const fromCard = controller.removePublished(second.id, ACCOUNT);
      await settle();
      publishes[publishes.length - 1].resolve();
      await fromCard;
      expect(
        controller.published.find((current) => current.itemId === second.id)
          ?.removal
      ).toBe('removed');
      expect(id).not.toBe(second.id);
    });

    it('keeps what a failed upload put on QDN, as only part', async () => {
      await controller.addFiles([file('A.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      failSteps(publishes[0], ':metadata');
      await settle();
      const [entry] = controller.published;
      expect(entry.partial).toBe(true);
      expect(entry.record.resources.map((resource) => resource.kind)).toEqual([
        'video',
      ]);
      // A retry going on: the list doesn't remove under it.
      controller.retry(items()[0].id);
      await settle();
      expect(controller.canRemoveSaved(controller.published[0])).toBe(false);
      publishes[1].resolve();
      await settle();
      expect(controller.published[0].partial).toBeUndefined();
      expect(controller.published[0].record.resources).toHaveLength(2);
    });

    it('lists a series once its playlist is up, in place of its episodes', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      for (const job of ['job-1', 'job-2']) {
        await settle();
        tool.finishJob(job);
        await settle();
        publishes[publishes.length - 1].resolve();
      }
      await settle();
      expect(controller.published.map((entry) => entry.kind)).toEqual([
        'episode',
        'episode',
      ]);
      publishes[2].resolve();
      await settle();
      expect(controller.published).toHaveLength(1);
      expect(controller.published[0]).toMatchObject({
        kind: 'series',
        id: store.get(videoRunAtom).series.historyId,
      });
      expect(controller.published[0].record.resources).toHaveLength(5);
    });

    it('keeps what went up on the run’s account after a switch mid-upload', async () => {
      await controller.addFiles([file('A.mp4')]);
      setShared({ category: 99 });
      controller.start({ ...ACCOUNT, address: 'Qfirst' });
      await settle();
      tool.finishJob('job-1');
      await settle();
      const upload = publishes[0];
      // The VIDEO goes up; then another account signs in.
      upload.options.onStepDone?.({
        key: upload.steps[0].key,
        status: 'published',
      });
      expect(controller.published).toHaveLength(1);
      expect(controller.published[0].partial).toBe(true);
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      expect(items()).toEqual([]);
      expect(controller.published).toEqual([]);
      // The listing was refused once the run stopped: the VIDEO stays listed.
      const cancelled = { code: 'cancelled' } as never;
      upload.resolve({
        ok: false,
        stoppedBy: cancelled,
        outcomes: [
          { key: upload.steps[0].key, status: 'published' },
          { key: upload.steps[1].key, status: 'failed', error: cancelled },
        ],
      });
      await settle();
      expect(controller.published).toEqual([]);
      const kept = JSON.parse(
        window.localStorage.getItem('video-publisher-published-v1:Qfirst')
      );
      expect(kept).toHaveLength(1);
      expect(kept[0]).toMatchObject({ partial: true, kind: 'qtube' });
      expect(kept[0].record.resources.map((r) => r.kind)).toEqual(['video']);
      expect(
        window.localStorage.getItem('video-publisher-published-v1:Qsecond')
      ).toBeNull();
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      await settle();
      expect(controller.published).toHaveLength(1);
    });

    it('keeps a whole upload that ended after a switch', async () => {
      await controller.addFiles([file('A.mp4')]);
      setShared({ category: 99 });
      controller.start({ ...ACCOUNT, address: 'Qfirst' });
      await settle();
      tool.finishJob('job-1');
      await settle();
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      publishes[0].resolve();
      await settle();
      const kept = JSON.parse(
        window.localStorage.getItem('video-publisher-published-v1:Qfirst')
      );
      expect(kept).toHaveLength(1);
      expect(kept[0].partial).toBeUndefined();
      expect(kept[0].record.resources).toHaveLength(2);
    });

    it('keeps a series’ playlist that went up during a switch', async () => {
      await controller.addFiles([
        file('Show S01E01.mkv'),
        file('Show S01E02.mkv'),
      ]);
      controller.updateSettings((current) => ({
        series: { ...current.series, title: 'Show', genre: 201 },
      }));
      controller.start({ ...ACCOUNT, address: 'Qfirst' });
      for (const job of ['job-1', 'job-2']) {
        await settle();
        tool.finishJob(job);
        await settle();
        publishes[publishes.length - 1].resolve();
      }
      await settle();
      expect(publishes[2].steps[0].kind).toBe('playlist');
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      publishes[2].resolve();
      await settle();
      expect(store.get(videoRunAtom)).toEqual(VIDEO_PUBLISHER_IDLE_RUN);
      const kept = JSON.parse(
        window.localStorage.getItem('video-publisher-published-v1:Qfirst')
      );
      expect(kept.map((entry) => entry.kind)).toEqual(['series']);
    });

    it('follows the signed-in account', async () => {
      await publishOne();
      expect(controller.published).toHaveLength(1);
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      expect(controller.published).toEqual([]);
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      await settle();
      expect(controller.published).toHaveLength(1);
    });
  });

  it('quotes the fee and the balance', async () => {
    await expect(controller.quote(3, 'Qaddress')).resolves.toEqual({
      unitFee: 0.01,
      total: 0.03,
      balance: 5,
      enough: true,
    });
  });

  describe('Cancel while a converted video is prepared', () => {
    it('ends a video cancelled while its cover is made, without asking', async () => {
      // The converted video's frames take a moment.
      let release: () => void = () => undefined;
      const frames = vi.mocked(tool.frames);
      const plain = frames.getMockImplementation();
      frames.mockImplementation(async (target, options) => {
        if ('jobId' in target) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return plain(target, options);
      });
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(items()[0].phase).toBe('publishing');

      await controller.cancelItem(items()[0].id);
      release();
      await settle();
      expect(approvals).not.toHaveBeenCalled();
      expect(publishes).toHaveLength(0);
      expect(items()[0].phase).toBe('cancelled');
      expect(run().active).toBe(false);
      // Its converted file is kept: Retry asks, then publishes it.
      expect(controller.retry(items()[0].id)).toBe(true);
      await settle();
      release();
      await settle();
      expect(approvals).toHaveBeenCalledTimes(1);
      expect(publishes).toHaveLength(1);
      expect(tool.startJob).toHaveBeenCalledTimes(1);
    });

    it('ends a video cancelled while its approval is open', async () => {
      let answer: (accepted: boolean) => void = () => undefined;
      approvals.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(items()[0]).toMatchObject({
        phase: 'publishing',
        awaitingApproval: true,
      });

      await controller.cancelAll();
      answer(true);
      await settle();
      expect(publishes).toHaveLength(0);
      expect(items()[0].phase).toBe('cancelled');
      expect(run().active).toBe(false);
    });
  });

  describe('Retry right after Cancel', () => {
    it('converts again although the cancelled job ends only afterwards', async () => {
      // The engine says a job is cancelled a moment after it is told to.
      vi.mocked(tool.cancelJob).mockImplementation(async () => undefined);
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      const id = items()[0].id;
      await controller.cancelItem(id);
      expect(items()[0].phase).toBe('cancelled');
      expect(controller.retry(id)).toBe(true);
      tool.emit({ ...tool.jobs.get('job-1'), phase: 'cancelled' });
      await settle();
      expect(tool.startJob).toHaveBeenCalledTimes(2);
      expect(items()[0].phase).toBe('converting');
      expect(run().active).toBe(true);
    });
  });

  describe('going on after a failure', () => {
    it('converts at the quality picked since when a failed conversion is retried', async () => {
      await controller.loadNodeLimit();
      await controller.addFiles([file('Long.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      expect(vi.mocked(tool.startJob).mock.calls[0][0].quality).toBe('720');
      tool.failJob('job-1', 'output-too-big');
      await settle();
      // "Pick a lower quality", its error says.
      controller.updateSettings({ quality: '480' });
      expect(controller.retry(items()[0].id)).toBe(true);
      await settle();
      expect(tool.startJob).toHaveBeenCalledTimes(2);
      expect(vi.mocked(tool.startJob).mock.calls[1][0].quality).toBe('480');
    });

    it('lets a video that waited go on while the refused one is retried', async () => {
      await controller.addFiles([file('A.mp4'), file('B.mp4'), file('C.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      refuse(publishes[0]);
      await settle();
      expect(items().map((item) => item.phase)).toEqual([
        'failed',
        'cancelled',
        'ready',
      ]);
      // The reason sorted out: the first again, the third with the main
      // button, as its card (ready) offers.
      expect(controller.retry(items()[0].id)).toBe(true);
      await settle();
      expect(run().active).toBe(true);
      controller.start(ACCOUNT, [items()[2].id]);
      await settle();
      expect(['waiting', 'converting']).toContain(items()[2].phase);
      // The run counts the videos in it.
      expect(run().itemIds).toContain(items()[2].id);
    });

    it('leaves out a subtitle file dropped for a video already converting', async () => {
      await controller.addFiles([file('Clip.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      expect(items()[0].phase).toBe('converting');
      // Its conversion was planned without it: it can't go along any more.
      const result = await controller.addFiles([file('Clip.en.srt')]);
      expect(result.leftOut).toEqual([
        { name: 'Clip.en.srt', reason: 'subtitle' },
      ]);
      expect(items()[0].subtitles).toEqual([]);
    });
  });

  describe('subtitle files in season folders', () => {
    it('gives a subtitle file to the video of its own folder when names repeat', async () => {
      await controller.addFiles([
        file('E01.mkv', 'Show/Season 1/E01.mkv'),
        file('E01.mkv', 'Show/Season 2/E01.mkv'),
        file('E01.en.srt', 'Show/Season 2/E01.en.srt'),
      ]);
      const of = (season: string) =>
        items().find((item) => item.source.relativePath.includes(season));
      expect(of('Season 2').subtitles.map((track) => track.fileName)).toEqual([
        'E01.en.srt',
      ]);
      expect(of('Season 1').subtitles).toEqual([]);
    });
  });

  describe('a retried video that does not get to go up', () => {
    /** A's VIDEO is up, its listing isn't; B is going up; A is retried. */
    const retryBehindAnother = async () => {
      await controller.addFiles([file('A.mp4'), file('B.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      const network = { code: 'network' } as never;
      publishes[0].resolve({
        ok: false,
        outcomes: publishes[0].steps.map((step) =>
          step.key.endsWith(':metadata')
            ? { key: step.key, status: 'failed' as const, error: network }
            : { key: step.key, status: 'published' as const }
        ),
      });
      await settle();
      tool.finishJob('job-2');
      await settle();
      expect(items().map((item) => item.phase)).toEqual([
        'failed',
        'publishing',
      ]);
      const video = publishes[0].steps[0].identifier;
      expect(items()[0].record.resources.map((r) => r.identifier)).toEqual([
        video,
      ]);
      expect(controller.retry(items()[0].id)).toBe(true);
      await settle();
      // It waits its turn behind the one going up.
      expect(items()[0].phase).toBe('converted');
      return video;
    };

    it('keeps what went up removable from its card when it is cancelled', async () => {
      const video = await retryBehindAnother();
      await controller.cancelItem(items()[0].id);
      expect(items()[0].phase).toBe('cancelled');
      expect(items()[0].record?.resources.map((r) => r.identifier)).toEqual([
        video,
      ]);
    });

    it('keeps what went up removable from its card when a refusal stops the run', async () => {
      const video = await retryBehindAnother();
      refuse(publishes[1]);
      await settle();
      expect(items()[0]).toMatchObject({
        phase: 'failed',
        error: { code: 'stopped' },
      });
      expect(items()[0].record?.resources.map((r) => r.identifier)).toEqual([
        video,
      ]);
    });
  });

  describe('Remove confirmed twice', () => {
    it('replaces what a video published once', async () => {
      await controller.addFiles([file('A.mp4')]);
      setShared({ category: 99 });
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      const id = items()[0].id;

      const first = controller.removePublished(id, ACCOUNT);
      const second = controller.removePublished(id, ACCOUNT);
      await settle();
      // The upload, and one removal.
      expect(publishes).toHaveLength(2);
      publishes[1].resolve();
      await Promise.all([first, second]);
      expect(items()[0].removal).toBe('removed');
    });
  });

  describe('a series that did not go through in one go', () => {
    it('publishes the playlist once the failed episode is taken off the list', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.failJob('job-2', 'ffmpeg-failed');
      await settle();
      expect(run()).toMatchObject({
        active: false,
        series: { phase: 'waiting' },
      });

      // Not that episode, then: the series goes without it.
      await controller.removeItem(items()[1].id);
      await settle();
      expect(publishes).toHaveLength(2);
      expect(publishes[1].steps[0].kind).toBe('playlist');
      publishes[1].resolve();
      await settle();
      expect(run().series.phase).toBe('done');
      expect(run().active).toBe(false);
    });

    it('no longer says the run stopped once the playlist went without the refused episode', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.finishJob('job-2');
      await settle();
      refuse(publishes[1]);
      await settle();
      expect(run()).toMatchObject({
        active: false,
        stoppedBy: 'refused',
        series: { phase: 'waiting' },
      });

      await controller.removeItem(items()[1].id);
      await settle();
      expect(publishes[2].steps[0].kind).toBe('playlist');
      publishes[2].resolve();
      await settle();
      expect(run().series.phase).toBe('done');
      expect(run().active).toBe(false);
      expect(run().stoppedBy).toBeUndefined();
    });

    it('leaves the run as it was when the playlist still waits for an episode', async () => {
      await startSeries([
        'Show S01E01.mkv',
        'Show S01E02.mkv',
        'Show S01E03.mkv',
      ]);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.finishJob('job-2');
      await settle();
      refuse(publishes[1]);
      await settle();
      // The third was stopped too: one of the two leaves, one still waits.
      expect(['failed', 'cancelled']).toContain(items()[2].phase);
      await controller.removeItem(items()[1].id);
      await settle();
      expect(publishes).toHaveLength(2);
      expect(run()).toMatchObject({
        active: false,
        stoppedBy: 'refused',
        series: { phase: 'waiting' },
      });
    });

    it('takes the card of a series of one off with its failed episode', async () => {
      await controller.addFiles([file('Show S01E01.mkv')]);
      controller.setDestination('subscreen-series');
      controller.updateSettings((current) => ({
        series: { ...current.series, title: 'Show', genre: 201 },
      }));
      controller.start(ACCOUNT);
      await settle();
      tool.failJob('job-1', 'ffmpeg-failed');
      await settle();
      expect(run()).toMatchObject({
        active: false,
        series: { phase: 'waiting' },
      });
      await controller.removeItem(items()[0].id);
      await settle();
      expect(items()).toHaveLength(0);
      expect(run().series).toBeUndefined();
      expect(publishes).toHaveLength(0);
      expect(approvals).not.toHaveBeenCalled();
    });

    it('publishes the episodes retried twice, then the playlist without the one taken off', async () => {
      await startSeries([
        'Show S01E01.mkv',
        'Show S01E02.mkv',
        'Show S01E03.mkv',
      ]);
      await settle();
      tool.failJob('job-1', 'ffmpeg-failed');
      await settle();
      tool.failJob('job-2', 'ffmpeg-failed');
      await settle();
      tool.failJob('job-3', 'ffmpeg-failed');
      await settle();
      expect(items().map((item) => item.phase)).toEqual([
        'failed',
        'failed',
        'failed',
      ]);
      // The first two: Retry fails once more, then goes.
      const [first, second, third] = items().map((item) => item.id);
      for (const id of [first, second]) {
        expect(controller.retry(id)).toBe(true);
        await settle();
        tool.failJob(
          `job-${vi.mocked(tool.startJob).mock.calls.length}`,
          'ffmpeg-failed'
        );
        await settle();
        expect(controller.retry(id)).toBe(true);
        await settle();
        tool.finishJob(`job-${vi.mocked(tool.startJob).mock.calls.length}`);
        await settle();
        publishes[publishes.length - 1].resolve();
        await settle();
      }
      expect(items().map((item) => item.phase)).toEqual([
        'done',
        'done',
        'failed',
      ]);
      // Still waiting for the third, until it's taken off the list.
      expect(publishes).toHaveLength(2);
      await controller.removeItem(third);
      await settle();
      expect(publishes).toHaveLength(3);
      expect(publishes[2].steps[0].kind).toBe('playlist');
      expect(publishes[2].steps[0].dependsOn).toHaveLength(2);
      publishes[2].resolve();
      await settle();
      expect(run().series.phase).toBe('done');
      // Each episode asked once, and the playlist once.
      expect(approvals).toHaveBeenCalledTimes(3);
    });

    it('publishes the playlist once a cancelled episode is cleared', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      await controller.cancelItem(items()[1].id);
      await settle();
      expect(run()).toMatchObject({
        active: false,
        series: { phase: 'waiting' },
      });

      await controller.clearFinished();
      await settle();
      expect(items()).toHaveLength(1);
      expect(publishes).toHaveLength(2);
      expect(publishes[1].steps[0].kind).toBe('playlist');
    });

    it('keeps its episodes in one playlist after a refusal stopped it', async () => {
      await startSeries([
        'Show S01E01.mkv',
        'Show S01E02.mkv',
        'Show S01E03.mkv',
      ]);
      await settle();
      tool.finishJob('job-1');
      await settle();
      // The first goes up while the second converts and the third waits.
      expect(items().map((item) => item.phase)).toEqual([
        'publishing',
        'converting',
        'waiting',
      ]);
      refuse(publishes[0]);
      await settle();
      expect(run()).toMatchObject({ active: false, stoppedBy: 'refused' });

      // The reason sorted out, each episode goes on the way the window
      // offers for it: Retry, or the main button for one that is ready.
      const goOn = async (index: number) => {
        const episode = items()[index];
        if (episode.phase === 'ready') controller.start(ACCOUNT);
        else expect(controller.retry(episode.id)).toBe(true);
        await settle();
        if (items()[index].phase === 'converting') {
          tool.finishJob(`job-${vi.mocked(tool.startJob).mock.calls.length}`);
          await settle();
        }
        expect(items()[index].phase).toBe('publishing');
        publishes[publishes.length - 1].resolve();
        await settle();
        expect(items()[index].phase).toBe('done');
      };
      await goOn(0);
      await goOn(1);
      await goOn(2);
      await settle();

      const playlists = publishes.filter(
        (publish) => publish.steps[0].kind === 'playlist'
      );
      expect(playlists).toHaveLength(1);
      // One series, with its three episodes.
      expect(playlists[0].steps[0].dependsOn).toHaveLength(3);
    });

    it('goes up when the episode its poster came from was taken off the queue', async () => {
      // As main: no frames of a source it forgot.
      const frames = vi.mocked(tool.frames);
      const plain = frames.getMockImplementation();
      frames.mockImplementation(async (target, options) => {
        if ('sourceId' in target && !tool.sources.has(target.sourceId)) {
          throw new Error('[video-tool:source-missing] source');
        }
        return plain(target, options);
      });
      await controller.addFiles([
        file('Show S01E01.mkv'),
        file('Show S01E02.mkv'),
        file('Show S01E03.mkv'),
      ]);
      const [pilot] = items();
      controller.updateSettings((current) => ({
        series: {
          ...current.series,
          title: 'Show',
          genre: 201,
          poster: {
            kind: 'frame',
            sourceId: pilot.source.id,
            timeSec: 30,
            preview: FRAME_DATA_URL,
          },
        },
      }));
      await controller.removeItem(pilot.id);
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(items()[0].error).toBeUndefined();
      expect(items()[0].phase).toBe('publishing');
      expect(publishes).toHaveLength(1);
    });

    it('lets an episode removed from the app, and its series, off the list', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.failJob('job-2', 'ffmpeg-failed');
      await settle();
      const [up, failed] = items();

      // The series is given up: what went up is removed.
      const removing = controller.removePublished(up.id, ACCOUNT);
      await settle();
      publishes[1].resolve();
      await removing;
      expect(items()[0].removal).toBe('removed');

      await controller.removeItem(failed.id);
      await controller.clearFinished();
      await settle();
      expect(items()).toHaveLength(0);
      expect(run().series).toBeUndefined();
      // No playlist went up for it.
      expect(publishes).toHaveLength(2);
    });
  });

  describe('a removal that ends after another account signed in', () => {
    beforeEach(() => {
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      controller.dispose();
      controller = new VideoPublisherController(deps);
    });

    it('keeps on the first account what its removal replaced meanwhile', async () => {
      const first = { ...ACCOUNT, address: 'Qfirst' };
      await controller.addFiles([file('A.mp4')]);
      setShared({ category: 99 });
      controller.start(first);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();

      const removing = controller.removePublished(items()[0].id, first);
      await settle();
      const removal = publishes[1];
      expect(removal.steps).toHaveLength(2);
      // The listing is replaced; then another account signs in while the
      // VIDEO's replacement, already signed, goes through.
      removal.options.onStepDone?.({
        key: removal.steps[0].key,
        status: 'published',
      });
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      removal.resolve();
      await removing;

      // Back on the first account: both replacements went through, so a
      // second Remove has nothing left to pay for.
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      await settle();
      const [entry] = controller.published;
      expect(entry.removedKeys ?? []).toEqual(
        expect.arrayContaining(removal.steps.map((step) => step.key))
      );
      expect(entry.removal).toBe('removed');
    });

    it('remembers the replacement that went through, so a second Remove does not pay for it again', async () => {
      const first = { ...ACCOUNT, address: 'Qfirst' };
      await controller.addFiles([file('A.mp4')]);
      setShared({ category: 99 });
      controller.start(first);
      await settle();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();

      const removing = controller.removePublished(items()[0].id, first);
      await settle();
      const removal = publishes[1];
      // The first replacement is signed and on its way; another account
      // signs in before it ends.
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      const cancelled = { code: 'cancelled' } as never;
      removal.resolve({
        ok: false,
        stoppedBy: cancelled,
        outcomes: [
          { key: removal.steps[0].key, status: 'published' },
          { key: removal.steps[1].key, status: 'cancelled', error: cancelled },
        ],
      });
      await removing;
      await settle();

      // Back to the first account: Remove again.
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      await settle();
      const [entry] = controller.published;
      const again = controller.removeSaved(entry.id, first);
      await settle();
      expect(publishes).toHaveLength(3);
      // What went through before is skipped, not paid for a second time.
      expect([...(publishes[2].options.completed ?? [])]).toContain(
        removal.steps[0].key
      );
      publishes[2].resolve();
      await again;
    });
  });

  describe('a long series with many subtitle languages', () => {
    beforeEach(() => {
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      controller.dispose();
      controller = new VideoPublisherController(deps);
    });

    it('stays on the published list after a restart, with its Remove', async () => {
      // 16 episodes, each with 30 text subtitle languages (a streaming
      // release's usual set), all ticked.
      const languages = [
        'af',
        'am',
        'ar',
        'az',
        'be',
        'bg',
        'bn',
        'bs',
        'ca',
        'cs',
        'cy',
        'da',
        'de',
        'el',
        'en',
        'es',
        'et',
        'eu',
        'fa',
        'fi',
        'fr',
        'he',
        'hi',
        'hr',
        'hu',
        'it',
        'ja',
        'ko',
        'nl',
        'pl',
      ];
      const tracks = languages.map((language, index) => ({
        id: String(index),
        language,
        bytes: 1000,
      }));
      const names = Array.from(
        { length: 16 },
        (_, index) => `Show S01E${String(index + 1).padStart(2, '0')}.mkv`
      );
      await controller.addFiles(names.map((name) => file(name)));
      controller.updateSettings((current) => ({
        series: { ...current.series, title: 'Show', genre: 201 },
      }));
      controller.start({ ...ACCOUNT, address: 'Qfirst' });
      for (let index = 1; index <= names.length; index += 1) {
        await settle();
        tool.finishJob(`job-${index}`, { subtitles: tracks });
        await settle();
        publishes[publishes.length - 1].resolve();
      }
      await settle();
      expect(publishes[publishes.length - 1].steps[0].kind).toBe('playlist');
      publishes[publishes.length - 1].resolve();
      await settle();
      expect(controller.published.map((entry) => entry.kind)).toEqual([
        'series',
      ]);
      const [series] = controller.published;
      expect(controller.removalCount(series.record)).toBe(16 * 32 + 1);

      // Hub starts again: the series is still there to remove.
      controller.dispose();
      controller = new VideoPublisherController(deps);
      expect(controller.published.map((entry) => entry.id)).toEqual([
        series.id,
      ]);
    }, 30_000);
  });

  describe('a description typed for another app', () => {
    it('is not published with a Torq post when it was the video’s own', async () => {
      await controller.addFiles([file('Clip.mp4')]);
      // Typed while Q-Tube was the destination.
      controller.updateItem(items()[0].id, (current) => ({
        fields: { ...current.fields, description: 'Only for Q-Tube viewers' },
      }));
      setShared({ category: 99 });
      controller.setDestination('torq');
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(publishes).toHaveLength(1);
      const sent = publishes[0].steps.map((step) => {
        const data = (step.data ?? {}) as { base64?: string };
        return [
          step.description ?? '',
          data.base64 ? atob(data.base64) : '',
        ].join('\n');
      });
      expect(sent.join('\n')).not.toContain('Only for Q-Tube viewers');
    });

    it('is not published with a Torq post when it was the same for all videos', async () => {
      await controller.addFiles([file('A.mp4'), file('B.mp4')]);
      // Typed while Q-Tube was chosen, "same for all"…
      setShared({ category: 99, description: 'Private notes for Q-Tube' });
      // …then Torq is chosen: its form shows no description.
      controller.setDestination('torq');
      controller.start(ACCOUNT);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(publishes).toHaveLength(1);
      const sent = publishes[0].steps
        .map((step) => `${step.description ?? ''}\n${decode(step)}`)
        .join('\n');
      expect(sent).not.toContain('Private notes for Q-Tube');
    });
  });

  describe('a refusal from the node', () => {
    it('lets a video being converted to save to this PC go on', async () => {
      await controller.addFiles([file('A.mp4'), file('B.mp4')]);
      setShared({ category: 99 });
      controller.setTicked(items()[1].id, false);
      controller.start(ACCOUNT);
      await settle();
      // B joins the run, to be saved to this PC.
      controller.setDestination('save');
      controller.start(ACCOUNT, [items()[1].id]);
      await settle();
      tool.finishJob('job-1');
      await settle();
      expect(items().map((item) => item.phase)).toEqual([
        'publishing',
        'converting',
      ]);
      expect(items()[1].context.destination).toBe('save');

      refuse(publishes[0]);
      await settle();
      // Saving publishes nothing: the node's refusal has nothing to stop.
      expect(tool.cancelJob).not.toHaveBeenCalled();
      expect(items()[1].phase).toBe('converting');
    });
  });

  describe('a subtitle file added with another video', () => {
    it('goes with the queued video it is named after, not the one beside it', async () => {
      await controller.addFiles([file('Movie.mkv')]);
      // Later: another video, and the first one's subtitles, picked together.
      await controller.addFiles([file('Other.mkv'), file('Movie.en.srt')]);
      const named = (name: string) =>
        items().find((item) => item.source.name === name);
      expect(named('Other.mkv').subtitles).toEqual([]);
      expect(
        named('Movie.mkv').subtitles.map((track) => track.fileName)
      ).toEqual(['Movie.en.srt']);
    });
  });

  describe('Retry of a video from an earlier run', () => {
    it('is counted by the run it goes on in', async () => {
      await controller.addFiles([file('A.mp4'), file('B.mp4')]);
      setShared({ category: 99 });
      const [a, b] = items();
      controller.setTicked(b.id, false);
      controller.start(ACCOUNT);
      await settle();
      tool.failJob('job-1', 'ffmpeg-failed');
      await settle();
      expect(run().active).toBe(false);

      // Another run, for B, goes through.
      controller.start(ACCOUNT, [b.id]);
      await settle();
      tool.finishJob(lastJob());
      await settle();
      publishes[0].resolve();
      await settle();
      expect(run()).toMatchObject({ active: false, itemIds: [b.id] });

      // A again: the run pane counts it, not only B, which is done.
      expect(controller.retry(a.id)).toBe(true);
      await settle();
      expect(items()[0].phase).toBe('converting');
      expect(run().active).toBe(true);
      expect(run().itemIds).toContain(a.id);
    });
  });

  describe('the order the user set', () => {
    it('stays when more videos are added', async () => {
      await controller.addFiles([
        file('Show S01E01.mkv'),
        file('Show S01E02.mkv'),
        file('Show S01E03.mkv'),
      ]);
      const names = () => items().map((item) => item.source.name);
      // Episode 3 first, by hand.
      controller.moveItem(items()[2].id, -1);
      controller.moveItem(items()[1].id, -1);
      expect(names()).toEqual([
        'Show S01E03.mkv',
        'Show S01E01.mkv',
        'Show S01E02.mkv',
      ]);
      await controller.addFiles([file('Show S01E04.mkv')]);
      expect(names().slice(0, 3)).toEqual([
        'Show S01E03.mkv',
        'Show S01E01.mkv',
        'Show S01E02.mkv',
      ]);
    });
  });

  describe('a series whose playlist goes up', () => {
    it('stops the playlist when Cancel all is pressed while it waits to go up', async () => {
      await seriesOfTwo();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.finishJob('job-2');
      await settle();
      publishes[1].resolve();
      await settle();
      expect(publishes[2].steps[0].kind).toBe('playlist');
      expect(run()).toMatchObject({
        active: true,
        series: { phase: 'publishing' },
      });
      // It waits for a slot (the account's many unconfirmed episodes):
      // the run's Cancel all is on screen.
      await controller.cancelAll();
      expect(publishes[2].options.signal?.aborted).toBe(true);
      // Its wait for a slot ends with it.
      await publishes[2].options.waitForSlot?.(publishes[2].steps[0]);
      expect(deps.waitForPublishSlot).toHaveBeenLastCalledWith(
        'pubkey',
        expect.objectContaining({ signal: publishes[2].options.signal })
      );
      // Stopped before its upload: it ends there, with Retry.
      const cancelled = { code: 'cancelled' } as never;
      publishes[2].resolve({
        ok: false,
        stoppedBy: cancelled,
        outcomes: [
          {
            key: publishes[2].steps[0].key,
            status: 'cancelled',
            error: cancelled,
          },
        ],
      });
      await settle();
      expect(run()).toMatchObject({
        active: false,
        series: { phase: 'failed', error: { code: 'cancelled' } },
      });
      expect(run().series.record).toBeUndefined();
      expect(controller.retrySeries()).toBe(true);
    });

    it('holds an episode’s Remove while the playlist that lists it goes up', async () => {
      await seriesOfTwo();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.finishJob('job-2');
      await settle();
      publishes[1].resolve();
      await settle();
      const playlist = publishes[2];
      expect(playlist.steps[0].kind).toBe('playlist');
      const [first] = items();
      const firstResources = first.record.resources.map(
        (resource) => resource.identifier
      );

      // Remove from Subscreen on episode 1, confirmed while the playlist
      // that lists it is going up: nothing is replaced.
      await controller.removePublished(first.id, ACCOUNT);
      await settle();
      expect(publishes).toHaveLength(3);
      expect(items()[0].removal).toBeUndefined();

      playlist.resolve();
      await settle();
      // The series lists it, and its Remove takes it along.
      const listed = (run().series?.record?.resources ?? []).map(
        (resource) => resource.identifier
      );
      expect(listed).toEqual(expect.arrayContaining(firstResources));
    });

    it('shows no series to the next account after a sign-out while the playlist’s approval was open', async () => {
      store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
      controller.dispose();
      controller = new VideoPublisherController(deps);
      let answer: (accepted: boolean) => void = () => undefined;
      // The playlist's approval waits for an answer.
      approvals.mockImplementation((request) =>
        request.resources[0]?.service === 'PLAYLIST'
          ? new Promise<boolean>((resolve) => {
              answer = resolve;
            })
          : Promise.resolve(true)
      );
      await seriesOfTwo();
      for (const job of ['job-1', 'job-2']) {
        tool.finishJob(job);
        await settle();
        publishes[publishes.length - 1].resolve();
        await settle();
      }
      expect(run().series).toMatchObject({ awaitingApproval: true });
      // Signed out (the window is answered, or times out, meanwhile), then
      // another account signs in.
      store.set(userInfoAtom, null);
      await settle();
      expect(run().series).toBeUndefined();
      answer(false);
      await settle();
      store.set(userInfoAtom, { address: 'Qsecond', name: 'Other' });
      await settle();
      expect(publishes).toHaveLength(2);
      expect(run().series).toBeUndefined();
    });
  });

  describe('a series after its playlist went up', () => {
    it('leaves a run started meanwhile alone when the series removal ends', async () => {
      await seriesOfTwo();
      for (const job of ['job-1', 'job-2']) {
        tool.finishJob(job);
        await settle();
        publishes[publishes.length - 1].resolve();
        await settle();
      }
      publishes[2].resolve();
      await settle();
      expect(run().series.phase).toBe('done');

      // Remove from Subscreen: many replacements, it takes a while…
      const removing = controller.removePublished('series', ACCOUNT);
      await settle();
      const removal = publishes[3];
      // …meanwhile another video goes to Q-Tube, all the way.
      await controller.addFiles([file('Clip.mp4')]);
      controller.setDestination('qtube');
      setShared({ category: 99 });
      const clip = items().find((item) => item.source.name === 'Clip.mp4');
      controller.start(ACCOUNT, [clip.id]);
      await settle();
      tool.finishJob(lastJob());
      await settle();
      publishes[4].resolve();
      await settle();
      expect(run().series).toBeUndefined();

      removal.resolve();
      await removing;
      await settle();
      // The Q-Tube run has no series; its video can leave the list.
      expect(
        controller.isHeldBySeries(items().find((item) => item.id === clip.id))
      ).toBe(false);
      expect(run().series).toBeUndefined();
    });

    it('numbers an untitled episode among its own series, not an earlier one', async () => {
      await seriesOfTwo();
      for (const job of ['job-1', 'job-2']) {
        tool.finishJob(job);
        await settle();
        publishes[publishes.length - 1].resolve();
        await settle();
      }
      publishes[2].resolve();
      await settle();
      expect(run().series.phase).toBe('done');

      // Another series, its files without episode numbers; the first one's
      // episodes are still on the list.
      await controller.addFiles([file('Finale.mkv'), file('Pilot.mkv')]);
      controller.setDestination('subscreen-series');
      controller.updateSettings((current) => ({
        series: { ...current.series, title: 'Beta' },
      }));
      // The cards' placeholders count the same way, before and during.
      const beta = () =>
        items().filter((item) => !item.source.name.startsWith('Show'));
      expect(beta().map((item) => controller.episodeIndex(item))).toEqual([
        0, 1,
      ]);
      controller.start(ACCOUNT);
      await settle();
      expect(beta().map((item) => controller.episodeIndex(item))).toEqual([
        0, 1,
      ]);
      tool.finishJob(lastJob());
      await settle();
      const metadata = publishes[3].steps.find(
        (step) => step.kind === 'metadata'
      );
      expect(JSON.parse(decode(metadata)).title).toBe('Beta — Episode 1');
    });

    it('keeps its card while an episode can be retried, and takes that episode in', async () => {
      await seriesOfTwo();
      tool.finishJob('job-1');
      await settle();
      publishes[0].resolve();
      await settle();
      tool.failJob('job-2', 'ffmpeg-failed');
      await settle();
      expect(controller.publishSeriesWithoutFailed()).toBe(true);
      await settle();
      expect(publishes[1].steps[0].kind).toBe('playlist');
      publishes[1].resolve();
      await settle();
      expect(run().series.phase).toBe('done');

      // The failed episode still offers Retry: the series card stays.
      const failed = items()[1];
      expect(controller.canRetry(failed)).toBe(true);
      expect(controller.canDismissSeries()).toBe(false);
      controller.dismissSeries();
      expect(run().series?.phase).toBe('done');
      expect(controller.retry(failed.id)).toBe(true);
      await settle();
      tool.finishJob(lastJob());
      await settle();
      expect(publishes[2].steps.map((step) => step.kind)).toContain('video');
      publishes[2].resolve();
      await settle();
      // Paid for as an episode: the series' playlist takes it in.
      const playlists = publishes.filter(
        (publish) => publish.steps[0].kind === 'playlist'
      );
      expect(playlists).toHaveLength(2);
    });
  });
});
