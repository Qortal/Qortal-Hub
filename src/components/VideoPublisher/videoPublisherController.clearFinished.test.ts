import { createStore } from 'jotai';
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
import {
  createFakeVideoTool,
  type FakeVideoTool,
  FRAME_DATA_URL,
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

// Runs go straight through here; preview-first is set where a test needs it.
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
  let approvals: Mock<(request: PublishApprovalRequest) => Promise<boolean>>;

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

  describe('Clear finished', () => {
    it('keeps a cancelled video whose converted file Retry would publish', async () => {
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
      // Cancelled while its approval is open: converted, kept for Retry.
      await controller.cancelItem(items()[0].id);
      answer(false);
      await settle();
      expect(items()[0]).toMatchObject({ phase: 'cancelled', jobId: 'job-1' });
      expect(controller.canRetry(items()[0])).toBe(true);

      await controller.clearFinished();
      expect(tool.releaseJob).not.toHaveBeenCalledWith('job-1');
      expect(items()).toHaveLength(1);
    });
  });
});
