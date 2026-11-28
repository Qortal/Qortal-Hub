/**
 * A Subscreen title's cast & crew through the controller: people looked up
 * before the approval, which lists them and the credits with their fee;
 * the credits in the title's record (Remove), never a person.
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
  type Mock,
  vi,
} from 'vitest';
import { userInfoAtom } from '../../atoms/global';
import type {
  PublishStep,
  RunPublishOptions,
  RunPublishResult,
  SubscreenCredit,
  SubscreenPersonRef,
} from '../../lib/videoPublisher';
import { subscreenCreditsIdentifier } from '../../lib/videoPublisher';
import {
  createFakeVideoTool,
  type FakeVideoTool,
} from '../../test/mocks/videoTool';
import type { PublishApprovalRequest } from './publishApproval';
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
const ACCOUNT = { name: 'Tester', publicKey: 'pubkey', address: 'Qfirst' };

const file = (name: string) => new File(['x'], name);

const settle = async (turns = 12) => {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const json = (step: PublishStep) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob((step.data as { base64: string }).base64), (c) =>
        c.charCodeAt(0)
      )
    )
  );

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

/** Already on Subscreen, someone else's. */
const BRUCE: SubscreenPersonRef = {
  name: 'Other',
  identifier: 'subscreen_person_owen-marsh_s5ULO',
  service: 'DOCUMENT',
};

describe('VideoPublisherController: Subscreen cast & crew', () => {
  let tool: FakeVideoTool;
  let store: ReturnType<typeof createStore>;
  let publishes: Publish[];
  let controller: VideoPublisherController;
  let deps: Partial<VideoPublisherDeps>;
  let approvals: Mock<(request: PublishApprovalRequest) => Promise<boolean>>;
  let findPerson: Mock<
    (name: string, signal?: AbortSignal) => Promise<SubscreenPersonRef | null>
  >;
  /** Lookups and approvals, in the order they happened. */
  let events: string[];

  beforeEach(() => {
    window.localStorage.clear();
    tool = createFakeVideoTool();
    store = createStore();
    store.set(userInfoAtom, { address: 'Qfirst', name: 'Tester' });
    publishes = [];
    events = [];
    approvals = vi.fn(async (request: PublishApprovalRequest) => {
      events.push(`approval:${request.resources.length}`);
      return true;
    });
    findPerson = vi.fn(async (name: string) => {
      events.push(`lookup:${name}`);
      return name === 'Owen Marsh' ? BRUCE : null;
    });
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
      requestApproval: approvals,
      findSubscreenPerson: findPerson,
      runPublishSteps: vi.fn(
        (steps, options) =>
          new Promise<RunPublishResult>((resolve) => {
            publishes.push({
              steps,
              options,
              resolve: (result) => {
                const full = {
                  ok: true,
                  outcomes: steps.map((step) => ({
                    key: step.key,
                    status: 'published' as const,
                  })),
                  ...result,
                };
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
  const lastApproval = () =>
    approvals.mock.calls[approvals.mock.calls.length - 1][0];

  /** Publishes these steps but fails those whose key ends so. */
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

  const addFilm = async (name: string, credits?: SubscreenCredit[]) => {
    await controller.addFiles([file(name)]);
    const item = items()[items().length - 1];
    controller.updateItem(item.id, (current) => ({
      fields: {
        ...current.fields,
        genre: 101,
        ...(credits ? { credits } : {}),
      },
    }));
    return item.id;
  };

  const FILM_CREDITS: SubscreenCredit[] = [
    { role: 'director', displayName: 'Sam Brandt' },
    { role: 'actor', displayName: 'Owen Marsh', character: 'Ash' },
  ];

  it('looks up a film’s people, then asks once for all of it', async () => {
    controller.setDestination('subscreen-film');
    await addFilm('The Cabin Film (1981).mkv', FILM_CREDITS);
    controller.start(ACCOUNT);
    await settle();
    expect(findPerson).not.toHaveBeenCalled();
    tool.finishJob('job-1');
    await settle();

    // Looked up before the approval; Owen Marsh is known already.
    expect(events).toEqual([
      'lookup:Sam Brandt',
      'lookup:Owen Marsh',
      'approval:4',
    ]);
    const [publish] = publishes;
    expect(publish.steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
      'person',
      'credits',
    ]);
    const [video, metadata, person, credits] = publish.steps;
    const { resources, fee } = approvals.mock.calls[0][0];
    expect(resources).toEqual(
      publish.steps.map((step) => ({
        service: step.service,
        name: 'Tester',
        identifier: step.identifier,
        ...(step.filename ? { filename: step.filename } : {}),
      }))
    );
    expect(resources[2]).toMatchObject({
      service: 'DOCUMENT',
      identifier: expect.stringMatching(
        /^subscreen_person_sam-brandt_[A-Za-z0-9]{5}$/
      ),
      filename: 'person.json',
    });
    expect(resources[3]).toMatchObject({ filename: 'credits.json' });
    expect(fee).toBeCloseTo(0.04, 8);

    // The credits name the film's listing, after it and the new person.
    const titleRef = {
      name: 'Tester',
      identifier: metadata.identifier,
      service: 'DOCUMENT',
    };
    expect(credits.identifier).toBe(
      subscreenCreditsIdentifier(titleRef as never)
    );
    expect(credits.dependsOn).toEqual([metadata.key, person.key]);
    expect(person.dependsOn).toEqual([metadata.key]);
    const document = json(credits);
    expect(document).toMatchObject({
      titleRef,
      people: [
        {
          personRef: {
            name: 'Tester',
            identifier: person.identifier,
            service: 'DOCUMENT',
          },
          role: 'director',
          displayName: 'Sam Brandt',
        },
        {
          personRef: BRUCE,
          role: 'actor',
          displayName: 'Owen Marsh',
          character: 'Ash',
        },
      ],
      version: 2,
    });

    publish.resolve();
    await settle();
    const item = items()[0];
    expect(item.phase).toBe('done');
    // Remove takes the credits first, never the person.
    expect(item.record.resources.map((resource) => resource.kind)).toEqual([
      'video',
      'metadata',
      'credits',
    ]);
    expect(controller.removalCount(item.record)).toBe(3);
    const removing = controller.removePublished(item.id, ACCOUNT);
    await settle();
    expect(
      publishes[1].steps.map((step) => [step.kind, step.identifier])
    ).toEqual([
      ['credits', credits.identifier],
      ['metadata', metadata.identifier],
      ['video', video.identifier],
    ]);
    publishes[1].resolve();
    await removing;
    expect(items()[0].removal).toBe('removed');
  });

  it('publishes no credits for a film without names', async () => {
    controller.setDestination('subscreen-film');
    await addFilm('Plain.mkv', [{ role: 'actor', displayName: '   ' }]);
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    expect(findPerson).not.toHaveBeenCalled();
    expect(publishes[0].steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
    ]);
  });

  it('keeps a person it published for the next film, and its people on Retry', async () => {
    controller.setDestination('subscreen-film');
    await addFilm('First.mkv', [
      { role: 'director', displayName: 'Sam Brandt' },
    ]);
    await addFilm('Second.mkv', [
      { role: 'director', displayName: 'sam  brandt' },
      { role: 'writer', displayName: 'Ivan Brandt' },
    ]);
    controller.start(ACCOUNT);
    await settle();
    tool.finishJob('job-1');
    await settle();
    const first = publishes[0];
    const sam = first.steps.find((step) => step.kind === 'person');
    first.resolve();
    await settle();
    tool.finishJob('job-2');
    await settle();

    // The node may not list it yet: the second film points at it.
    expect(findPerson.mock.calls.map(([name]) => name)).toEqual([
      'Sam Brandt',
      'Ivan Brandt',
    ]);
    const second = publishes[1];
    expect(second.steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
      'person',
      'credits',
    ]);
    const credits = json(second.steps[3]);
    expect(credits.people[0].personRef.identifier).toBe(sam.identifier);
    const ivan = second.steps[2];
    expect(credits.people[1].personRef.identifier).toBe(ivan.identifier);

    // Its people went up, its credits didn't: Retry sends only them, with
    // the same people (no new ones).
    failSteps(second, ':credits');
    await settle();
    expect(items()[1]).toMatchObject({ phase: 'failed' });
    expect(items()[1].record.resources.map((r) => r.kind)).toEqual([
      'video',
      'metadata',
    ]);
    expect(controller.retry(items()[1].id)).toBe(true);
    await settle();
    expect(lastApproval().resources).toEqual([
      expect.objectContaining({ filename: 'credits.json' }),
    ]);
    const retried = publishes[2];
    expect(retried.steps.map((step) => step.identifier)).toEqual(
      second.steps.map((step) => step.identifier)
    );
    expect([...retried.options.completed]).toEqual(
      second.steps.slice(0, 3).map((step) => step.key)
    );
    expect(findPerson).toHaveBeenCalledTimes(2);
  });

  describe('a series', () => {
    const SERIES_CREDITS: SubscreenCredit[] = [
      { role: 'writer', displayName: 'Hal Bremer' },
      { role: 'actor', displayName: 'Owen Marsh', character: 'Himself' },
    ];

    const publishEpisodes = async () => {
      await controller.addFiles([
        file('Show S01E01.mkv'),
        file('Show S01E02.mkv'),
      ]);
      controller.updateSettings((current) => ({
        destination: 'subscreen-series',
        series: {
          ...current.series,
          title: 'Show',
          genre: 201,
          credits: SERIES_CREDITS,
        },
      }));
      controller.start(ACCOUNT);
      for (const job of ['job-1', 'job-2']) {
        await settle();
        tool.finishJob(job);
        await settle();
        publishes[publishes.length - 1].resolve();
      }
      await settle();
    };

    it('credits the playlist, never an episode, in the playlist’s approval', async () => {
      await publishEpisodes();
      // The episodes went up without any people.
      for (const episode of publishes.slice(0, 2)) {
        expect(episode.steps.map((step) => step.kind)).toEqual([
          'video',
          'metadata',
        ]);
      }
      const playlist = publishes[2];
      expect(playlist.steps.map((step) => step.kind)).toEqual([
        'playlist',
        'person',
        'credits',
      ]);
      expect(approvals.mock.calls[2][0].resources).toHaveLength(3);
      expect([...playlist.options.completed]).toEqual(
        playlist.steps[0].dependsOn
      );
      const [list, bremer, credits] = playlist.steps;
      const titleRef = {
        name: 'Tester',
        identifier: list.identifier,
        service: 'PLAYLIST',
      };
      expect(json(credits)).toMatchObject({
        titleRef,
        people: [
          {
            personRef: { identifier: bremer.identifier },
            role: 'writer',
            displayName: 'Hal Bremer',
          },
          {
            personRef: BRUCE,
            role: 'actor',
            displayName: 'Owen Marsh',
            character: 'Himself',
          },
        ],
      });
      expect(credits.identifier).toBe(
        subscreenCreditsIdentifier(titleRef as never)
      );
      playlist.resolve();
      await settle();
      const { series } = store.get(videoRunAtom);
      expect(series.phase).toBe('done');
      expect(series.record.resources.map((r) => r.kind)).toEqual([
        'video',
        'metadata',
        'video',
        'metadata',
        'playlist',
        'credits',
      ]);
    });

    it('keeps the series removable when its credits fail, and sends only them again', async () => {
      await publishEpisodes();
      const playlist = publishes[2];
      failSteps(playlist, ':credits');
      await settle();
      const run = store.get(videoRunAtom);
      expect(run.series).toMatchObject({
        phase: 'failed',
        error: { code: 'network' },
      });
      // The playlist is up: removable, and on the list in part.
      expect(run.series.record.resources.map((r) => r.kind)).toContain(
        'playlist'
      );
      expect(run.series.record.resources.map((r) => r.kind)).not.toContain(
        'credits'
      );
      expect(controller.published[0]).toMatchObject({
        kind: 'series',
        partial: true,
      });

      expect(controller.retrySeries()).toBe(true);
      await settle();
      // Only the credits: the playlist and the new person are up.
      expect(lastApproval().resources).toEqual([
        expect.objectContaining({ filename: 'credits.json' }),
      ]);
      const again = publishes[3];
      expect(again.steps.map((step) => step.identifier)).toEqual(
        playlist.steps.map((step) => step.identifier)
      );
      expect(again.options.completed.has(playlist.steps[0].key)).toBe(true);
      expect(again.options.completed.has(playlist.steps[1].key)).toBe(true);
      expect(findPerson).toHaveBeenCalledTimes(2);
      again.resolve();
      await settle();
      const done = store.get(videoRunAtom).series;
      expect(done.phase).toBe('done');
      expect(done.record.resources.map((r) => r.kind)).toContain('credits');
      expect(controller.published[0].partial).toBeUndefined();
    });

    it('does not send its credits again once a Remove started', async () => {
      await publishEpisodes();
      failSteps(publishes[2], ':credits');
      await settle();
      const removing = controller.removePublished('series', ACCOUNT);
      await settle();
      expect(controller.retrySeries()).toBe(false);
      publishes[3].resolve();
      await removing;
      expect(controller.retrySeries()).toBe(false);
    });
  });
});
