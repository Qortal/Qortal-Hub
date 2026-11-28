/**
 * A series' episodes: the series' card can't be closed while one of them is
 * being retried (converting, waiting to be checked, or going up), or that
 * episode would go up, paid for, with no playlist taking it in; and untitled
 * episodes keep the numbers they started with.
 */
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
import { VideoPublisherController } from './videoPublisherController';

const WEBP = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
const ACCOUNT = { name: 'Tester', publicKey: 'pubkey' };

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

const PREVIEW_FIRST_DEFAULT = VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst;
beforeAll(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = false;
});
afterAll(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = PREVIEW_FIRST_DEFAULT;
});

describe("the series' card while an episode of it is retried", () => {
  let tool: FakeVideoTool;
  let store: ReturnType<typeof createStore>;
  let publishes: Publish[];
  let controller: VideoPublisherController;

  beforeEach(() => {
    window.localStorage.clear();
    tool = createFakeVideoTool();
    store = createStore();
    publishes = [];
    controller = new VideoPublisherController({
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
                const outcomes = steps.map((step) => ({
                  key: step.key,
                  status: 'published' as const,
                }));
                outcomes.forEach((outcome) => options.onStepDone?.(outcome));
                resolve({ ok: true, outcomes, ...result } as RunPublishResult);
              },
            });
          })
      ),
    });
  });

  afterEach(() => controller.dispose());

  const items = () => store.get(videoQueueAtom);
  const run = () => store.get(videoRunAtom);
  const lastJob = () => `job-${vi.mocked(tool.startJob).mock.calls.length}`;
  const playlists = () =>
    publishes.filter((publish) => publish.steps[0].kind === 'playlist');

  it('takes the retried episode into the playlist, even when its card is closed meanwhile', async () => {
    await controller.addFiles(
      ['Show S01E01.mkv', 'Show S01E02.mkv'].map(
        (name) => new File(['x'], name)
      )
    );
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
    // The series goes up without the failed episode.
    expect(controller.publishSeriesWithoutFailed()).toBe(true);
    await settle();
    publishes[1].resolve();
    await settle();
    expect(run().series.phase).toBe('done');
    expect(playlists()).toHaveLength(1);

    // Retry: the episode converts again, to go up as one of the series'.
    const failed = items()[1];
    expect(controller.retry(failed.id)).toBe(true);
    await settle();
    expect(items()[1].phase).toBe('converting');
    // The card's Close (✕) while it converts.
    controller.dismissSeries();
    await settle();

    tool.finishJob(lastJob());
    await settle();
    expect(publishes[2].steps.map((step) => step.kind)).toContain('video');
    publishes[2].resolve();
    await settle();
    // Paid for as an episode: the playlist has to list it.
    expect(playlists()).toHaveLength(2);
  });

  it('does not give two untitled episodes the same number when a failed one is taken off the list mid-run', async () => {
    const titleOf = (publish: Publish) => {
      const metadata = publish.steps.find((step) => step.kind === 'metadata');
      const data = 'base64' in metadata.data ? metadata.data.base64 : '';
      return JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        )
      ).title;
    };
    // Files without episode numbers: each is titled by its place.
    await controller.addFiles(
      ['Pilot.mkv', 'Middle.mkv', 'Finale.mkv'].map(
        (name) => new File(['x'], name)
      )
    );
    controller.setDestination('subscreen-series');
    controller.updateSettings((current) => ({
      series: { ...current.series, title: 'Show', genre: 201 },
    }));
    controller.start(ACCOUNT);
    await settle();
    tool.failJob('job-1', 'ffmpeg-failed');
    await settle();
    tool.finishJob('job-2');
    await settle();
    expect(titleOf(publishes[0])).toBe('Show — Episode 2');
    // The failed one off the list (its ✕) while the run goes on.
    await controller.removeItem(items()[0].id);
    publishes[0].resolve();
    await settle();
    tool.finishJob('job-3');
    await settle();
    expect(titleOf(publishes[1])).not.toBe('Show — Episode 2');
  });
});
