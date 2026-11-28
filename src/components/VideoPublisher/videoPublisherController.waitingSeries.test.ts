import { createStore } from 'jotai';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  PublishStep,
  RunPublishOptions,
  RunPublishResult,
} from '../../lib/videoPublisher';
import {
  createFakeVideoTool,
  type FakeVideoTool,
} from '../../test/mocks/videoTool';
import {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS,
  videoQueueAtom,
  videoRunAtom,
} from './videoPublisherAtoms';
import {
  VideoPublisherController,
  type VideoPublisherDeps,
} from './videoPublisherController';

const WEBP = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
const ACCOUNT = { name: 'Tester', publicKey: 'pubkey' };

const file = (name: string) => new File(['x'], name);

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

// Runs go straight through here, without the preview.
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

  const published = (steps: readonly PublishStep[]) => ({
    ok: true,
    outcomes: steps.map((step) => ({
      key: step.key,
      status: 'published' as const,
    })),
  });

  beforeEach(() => {
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
      requestApproval: vi.fn(async () => true),
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
  const run = () => store.get(videoRunAtom);
  const setShared = (shared: object) =>
    controller.updateSettings((current) => ({
      shared: { ...current.shared, ...shared },
    }));

  const startSeries = async (names: string[]) => {
    await controller.addFiles(names.map((name) => file(name)));
    controller.updateSettings((current) => ({
      series: { ...current.series, title: 'Show', genre: 201 },
    }));
    controller.start(ACCOUNT);
    await settle();
  };

  describe('a series that waits for its playlist', () => {
    it('keeps a series that waits for its playlist when another video is published', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
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

      // Meanwhile, another video, to Q-Tube: it waits for the series.
      await controller.addFiles([file('Clip.mp4')]);
      controller.setDestination('qtube');
      setShared({ category: 99 });
      expect(controller.seriesOwesPlaylist()).toBe(true);
      controller.start(ACCOUNT, [items()[2].id]);
      await settle();
      expect(items()[2].phase).toBe('ready');
      expect(tool.startJob).toHaveBeenCalledTimes(2);

      // The episode that went up still gets its series.
      expect(controller.publishSeriesWithoutFailed()).toBe(true);
      await settle();
      expect(publishes).toHaveLength(2);
      expect(publishes[1].steps[0].kind).toBe('playlist');
      publishes[1].resolve();
      await settle();
      expect(run().series?.phase).toBe('done');

      // Then the video goes.
      expect(controller.seriesOwesPlaylist()).toBe(false);
      controller.start(ACCOUNT, [items()[2].id]);
      await settle();
      expect(items()[2].phase).toBe('converting');
    });

    it('does not hold another run for a series with no episode up', async () => {
      await startSeries(['Show S01E01.mkv', 'Show S01E02.mkv']);
      tool.failJob('job-1', 'ffmpeg-failed');
      await settle();
      tool.failJob('job-2', 'ffmpeg-failed');
      await settle();

      await controller.addFiles([file('Clip.mp4')]);
      controller.setDestination('qtube');
      setShared({ category: 99 });
      expect(controller.seriesOwesPlaylist()).toBe(false);
      controller.start(ACCOUNT, [items()[2].id]);
      await settle();
      expect(items()[2].phase).toBe('converting');
    });
  });
});
