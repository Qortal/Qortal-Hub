/**
 * What a video's publish pays for: the balance against the fee the approval
 * would show, through the real runner (only the publish itself is faked).
 */
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
  vi,
} from 'vitest';
import { type PublishRequest, runPublishSteps } from '../../lib/videoPublisher';
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
const ADDRESS = 'Qtester';
const ACCOUNT = { name: 'Tester', publicKey: 'pubkey', address: ADDRESS };

/** Lets pending promises and the pipeline's turns run. */
const settle = async (turns = 12) => {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const PREVIEW_FIRST_DEFAULT = VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst;
beforeAll(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = false;
});
afterAll(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = PREVIEW_FIRST_DEFAULT;
});

describe('a Q-Tube video going up', () => {
  let tool: FakeVideoTool;
  let store: ReturnType<typeof createStore>;
  let sent: PublishRequest[];
  let controller: VideoPublisherController;
  let deps: Partial<VideoPublisherDeps>;

  beforeEach(() => {
    tool = createFakeVideoTool();
    store = createStore();
    store.set(userInfoAtom, { address: ADDRESS, name: 'Tester' });
    sent = [];
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
      checkPublishBalance: vi.fn(async (_address: string, needed: number) => ({
        balance: 5,
        enough: 5 >= needed,
      })),
      requestApproval: vi.fn(async () => true),
      // The real runner; only the publish itself (publishOnQDN) is faked.
      runPublishSteps: (steps, options) =>
        runPublishSteps(steps, {
          ...options,
          retryDelayMs: 0,
          publish: async (request) => {
            sent.push(request);
            return { signature: 'sig' };
          },
        }),
    };
    controller = new VideoPublisherController(deps);
  });

  afterEach(() => controller.dispose());

  const items = () => store.get(videoQueueAtom);

  /** The videos, converted one after the other and on their way up. */
  const convertAndPublish = async (names: string[]) => {
    await controller.addFiles(names.map((name) => new File(['x'], name)));
    controller.updateSettings((current) => ({
      shared: { ...current.shared, category: 99 },
    }));
    controller.start(ACCOUNT);
    for (const [index] of names.entries()) {
      await settle();
      tool.finishJob(`job-${index + 1}`);
      await settle();
    }
  };

  it('publishes nothing when the balance does not cover the fee it asked approval for', async () => {
    // Enough for one of its two transactions. The node checks each one
    // against the confirmed balance alone, so it takes both: the listing
    // then never confirms, and the video stays unlisted, paid for.
    vi.mocked(deps.checkPublishBalance).mockImplementation(
      async (_address, needed) => ({ balance: 0.015, enough: 0.015 >= needed })
    );

    await convertAndPublish(['Clip.mp4']);

    expect(sent.map((request) => request.service)).toEqual([]);
    expect(items()[0].phase).toBe('failed');
    expect(items()[0].error?.code).toBe('balance');
  });

  it("counts the fees an earlier video of the run still owes against the next one's", async () => {
    // 0.03 QORT: the first video's two fees fit. While they are still
    // unconfirmed, the confirmed balance doesn't drop, but the node would
    // confirm only what it covers: the second video doesn't fit.
    vi.mocked(deps.checkPublishBalance).mockImplementation(
      async (_address, needed, publicKey) => {
        const pending = publicKey ? sent.length : 0;
        return {
          balance: 0.03,
          enough: 3 - pending >= Math.round(needed * 100),
        };
      }
    );

    await convertAndPublish(['A.mp4', 'B.mp4']);

    expect(sent.map((request) => request.service)).toEqual([
      'VIDEO',
      'DOCUMENT',
    ]);
    expect(items()[0].phase).toBe('done');
    expect(items()[1].phase).toBe('failed');
    expect(items()[1].error?.code).toBe('balance');
  });

  it('stops the run when the balance runs short, so the videos after it do not convert to fail the same way', async () => {
    // Enough for the first video's two fees only.
    vi.mocked(deps.checkPublishBalance).mockImplementation(
      async (_address, needed, publicKey) => {
        const pending = publicKey ? sent.length : 0;
        return {
          balance: 0.03,
          enough: 3 - pending >= Math.round(needed * 100),
        };
      }
    );

    await convertAndPublish(['A.mp4', 'B.mp4', 'C.mp4', 'D.mp4']);

    expect(sent.map((request) => request.service)).toEqual([
      'VIDEO',
      'DOCUMENT',
    ]);
    expect(items()[1].error?.code).toBe('balance');
    // The rest wait for Retry (or the next Publish) instead of failing one
    // by one after their conversions.
    expect(['ready', 'cancelled']).toContain(items()[2].phase);
    expect(items()[3].phase).toBe('ready');
    expect(vi.mocked(tool.startJob).mock.calls.length).toBeLessThanOrEqual(3);
    expect(store.get(videoRunAtom)).toMatchObject({
      active: false,
      stoppedBy: 'balance',
    });
  });
});
