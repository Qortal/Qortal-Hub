import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../background/background', () => ({
  getBaseApi: vi.fn(async () => 'http://node'),
}));
vi.mock('../../encryption/encryption', () => ({
  publishOnQDN: vi.fn(async () => ({ signature: 'sig' })),
}));

import { publishOnQDN } from '../../encryption/encryption';
import { NodeAnswerError } from '../../qdn/publish/nodeAnswer';
import {
  checkPublishBalance,
  classifyPublishError,
  estimatePublishFee,
  type PublishRequest,
  runPublishSteps,
  waitForPublishSlot,
} from './runner';
import type { PublishStep } from './types';

const step = (
  key: string,
  overrides: Partial<PublishStep> = {}
): PublishStep => ({
  key,
  kind: 'metadata',
  service: 'DOCUMENT',
  identifier: `id_${key}`,
  title: `T ${key}`,
  data: { base64: 'e30=' },
  bytes: 2,
  ...overrides,
});

const VIDEO_FILE = new Blob(['mp4']);

/** video → (subtitle, metadata) → post */
const chain = (): PublishStep[] => [
  step('video', {
    kind: 'video',
    service: 'VIDEO',
    filename: 'Clip.mp4',
    data: { file: VIDEO_FILE },
  }),
  step('sub', { kind: 'subtitle', service: 'FILE', dependsOn: ['video'] }),
  step('meta', { dependsOn: ['video'] }),
  step('post', { kind: 'post', dependsOn: ['meta'] }),
];

const run = (
  steps: PublishStep[],
  publish: (request: PublishRequest) => Promise<unknown>,
  extra = {}
) =>
  runPublishSteps(steps, {
    name: 'Me',
    publish,
    retryDelayMs: 0,
    ...extra,
  });

describe('runPublishSteps', () => {
  it('publishes every step in order, files as files', async () => {
    const publish = vi.fn(async (_request: PublishRequest) => 'ok');
    const onStepStart = vi.fn();
    const result = await run(chain(), publish, { onStepStart });
    expect(result.ok).toBe(true);
    expect(publish.mock.calls.map(([r]) => r.identifier)).toEqual([
      'id_video',
      'id_sub',
      'id_meta',
      'id_post',
    ]);
    expect(publish.mock.calls[0][0]).toMatchObject({
      data: VIDEO_FILE,
      uploadType: 'file',
      service: 'VIDEO',
      name: 'Me',
      filename: 'Clip.mp4',
      title: 'T video',
    });
    expect(publish.mock.calls[1][0]).toMatchObject({
      data: 'e30=',
      uploadType: 'base64',
    });
    expect(onStepStart).toHaveBeenCalledTimes(4);
    expect(result.outcomes.every((o) => o.status === 'published')).toBe(true);
  });

  it('reports chunk progress per step', async () => {
    const onProgress = vi.fn();
    await run(
      [step('a')],
      async (request) => {
        request.onProgress(1, 3);
        request.onProgress(3, 3);
      },
      { onProgress }
    );
    expect(onProgress.mock.calls).toEqual([
      ['a', 0, 1],
      ['a', 1, 3],
      ['a', 3, 3],
    ]);
  });

  it('retries network failures twice, then goes on with what does not depend on it', async () => {
    let videoTries = 0;
    const publish = vi.fn(async (request: PublishRequest) => {
      if (request.identifier === 'id_video') {
        videoTries += 1;
        throw new TypeError('Failed to fetch');
      }
      return 'ok';
    });
    const steps = [...chain(), step('other')];
    const result = await run(steps, publish);
    expect(videoTries).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.stoppedBy).toBeUndefined();
    expect(
      result.outcomes.map((o) => [o.key, o.status, o.error?.code])
    ).toEqual([
      ['video', 'failed', 'network'],
      ['sub', 'skipped', 'dependency-failed'],
      ['meta', 'skipped', 'dependency-failed'],
      ['post', 'skipped', 'dependency-failed'],
      ['other', 'published', undefined],
    ]);
  });

  it('succeeds on a retry', async () => {
    let tries = 0;
    const publish = vi.fn(async (_request: PublishRequest) => {
      tries += 1;
      if (tries === 1) throw new NodeAnswerError('busy', 503);
      return 'ok';
    });
    const result = await run([step('a')], publish);
    expect(result.ok).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('stops everything on a refusal, without retrying', async () => {
    const publish = vi.fn(async (request: PublishRequest) => {
      if (request.identifier === 'id_sub') {
        throw new NodeAnswerError('Invalid name', 400);
      }
      return 'ok';
    });
    const result = await run([...chain(), step('other')], publish);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.stoppedBy?.code).toBe('refused');
    expect(result.stoppedBy?.detail).toBe('Invalid name');
    expect(
      result.outcomes.map((o) => [o.key, o.status, o.error?.code])
    ).toEqual([
      ['video', 'published', undefined],
      ['sub', 'failed', 'refused'],
      ['meta', 'skipped', 'stopped'],
      ['post', 'skipped', 'stopped'],
      ['other', 'skipped', 'stopped'],
    ]);
  });

  it('skips what an earlier run published', async () => {
    const publish = vi.fn(async (_request: PublishRequest) => 'ok');
    const result = await run(chain(), publish, {
      completed: new Set(['video', 'meta']),
    });
    expect(publish.mock.calls.map(([r]) => r.identifier)).toEqual([
      'id_sub',
      'id_post',
    ]);
    expect(result.ok).toBe(true);
  });

  it('runs a step whose dependency was published in an earlier run', async () => {
    const publish = vi.fn(async (_request: PublishRequest) => 'ok');
    const result = await run([step('post', { dependsOn: ['meta'] })], publish, {
      completed: new Set(['meta']),
    });
    expect(result.ok).toBe(true);
  });

  it('stops on cancel and marks the rest cancelled', async () => {
    const controller = new AbortController();
    const publish = vi.fn(async (_request: PublishRequest) => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const result = await run(chain(), publish, { signal: controller.signal });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.outcomes.map((o) => o.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(result.stoppedBy?.code).toBe('cancelled');
  });

  it('hands the cancel signal to the publish, so an upload stops before it is signed', async () => {
    const controller = new AbortController();
    const publish = vi.fn(async (_request: PublishRequest) => 'ok');
    await run([step('video')], publish, { signal: controller.signal });
    expect(publish.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it('waits for a publish slot before each step, and stops when none comes', async () => {
    const waitForSlot = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const publish = vi.fn(async (_request: PublishRequest) => 'ok');
    const result = await run([step('a'), step('b'), step('c')], publish, {
      waitForSlot,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.stoppedBy?.code).toBe('slot-timeout');
    expect(result.outcomes.map((o) => o.status)).toEqual([
      'published',
      'skipped',
      'skipped',
    ]);
  });

  it('refuses duplicate step keys', async () => {
    await expect(run([step('a'), step('a')], vi.fn())).rejects.toThrow();
  });

  it("publishes through Hub's publishOnQDN by default", async () => {
    await runPublishSteps(chain().slice(0, 1), { name: 'Me' });
    expect(publishOnQDN).toHaveBeenCalledWith(
      expect.objectContaining({
        data: VIDEO_FILE,
        uploadType: 'file',
        filename: 'Clip.mp4',
        identifier: 'id_video',
        service: 'VIDEO',
        name: 'Me',
        tag1: undefined,
        onProgress: expect.any(Function),
      })
    );
  });
});

describe('classifyPublishError', () => {
  it.each([
    [new NodeAnswerError('no key', 401), false, 'needs-api-key'],
    [new NodeAnswerError('bad', 400), false, 'refused'],
    [new NodeAnswerError('down', 502), true, 'network'],
    [new TypeError('Failed to fetch'), true, 'network'],
    [new Error('Chunk 3 failed after 3 attempts'), true, 'network'],
    [new Error('Insufficient balance'), false, 'publish-failed'],
  ])('%s', (error, retry, code) => {
    const sorted = classifyPublishError(error);
    expect(sorted.retry).toBe(retry);
    expect(sorted.error.code).toBe(code);
  });
});

describe('fees and the account', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const answer = (body: unknown, ok = true) =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    });

  it('adds up one unit fee per resource', async () => {
    fetchMock.mockReturnValue(answer('1000000'));
    const fee = await estimatePublishFee([step('a'), step('b'), step('c')]);
    expect(fee).toEqual({ unitFee: 0.01, count: 3, total: 0.03 });
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^http:\/\/node\/transactions\/unitfee\?txType=ARBITRARY&timestamp=\d+$/
    );
  });

  it('checks the balance', async () => {
    fetchMock.mockReturnValue(answer(0.5));
    await expect(checkPublishBalance('Qaddr', 0.03)).resolves.toEqual({
      balance: 0.5,
      enough: true,
    });
    await expect(checkPublishBalance('Qaddr', 0.6)).resolves.toMatchObject({
      enough: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://node/addresses/balance/Qaddr'
    );
  });

  it("takes the fees of the account's unconfirmed transactions off the balance", async () => {
    // A video published a moment ago: its two fees aren't confirmed yet.
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/transactions/unconfirmed')
        ? answer([
            { type: 'ARBITRARY', fee: '0.01000000' },
            { type: 'ARBITRARY', fee: '0.01000000' },
            { type: 'CHAT', fee: '0.00000000' },
          ])
        : answer(0.035)
    );
    await expect(
      checkPublishBalance('Qaddr', 0.02, 'pubkey')
    ).resolves.toMatchObject({ balance: 0.035, enough: false });
    await expect(
      checkPublishBalance('Qaddr', 0.01, 'pubkey')
    ).resolves.toMatchObject({ enough: true });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://node/transactions/unconfirmed?creator=pubkey'
    );
  });

  it('takes off the QORT its unconfirmed payments send, not other assets', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/transactions/unconfirmed')
        ? answer([
            { type: 'PAYMENT', fee: '0.01000000', amount: '1.00000000' },
            {
              type: 'TRANSFER_ASSET',
              fee: '0.01000000',
              assetId: 1,
              amount: '500.00000000',
            },
            {
              type: 'MULTI_PAYMENT',
              fee: '0.01000000',
              payments: [
                { assetId: 0, amount: '0.50000000' },
                { assetId: 3, amount: '9.00000000' },
              ],
            },
          ])
        : answer(1.6)
    );
    // 1.6 less 1 + 0.5 sent and 0.03 in fees leaves 0.07.
    await expect(
      checkPublishBalance('Qaddr', 0.07, 'pubkey')
    ).resolves.toMatchObject({ enough: true });
    await expect(
      checkPublishBalance('Qaddr', 0.08, 'pubkey')
    ).resolves.toMatchObject({ enough: false });
  });

  it("gives no answer when the node can't list what's unconfirmed", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/transactions/unconfirmed')
        ? answer({ error: 'busy' }, false)
        : answer(100)
    );
    // Even a big balance: what's pending is unknown, never "nothing".
    await expect(
      checkPublishBalance('Qaddr', 0.01, 'pubkey')
    ).rejects.toBeTruthy();
    // Without the public key nothing pending is asked for.
    await expect(checkPublishBalance('Qaddr', 0.01)).resolves.toMatchObject({
      enough: true,
    });
  });

  it('waits while too many transactions are unconfirmed, as Subscreen does', async () => {
    const pending = (count: number) =>
      answer([
        ...Array(count).fill({ type: 'ARBITRARY' }),
        { type: 'CHAT' },
        { type: 'CHAT' },
      ]);
    fetchMock
      .mockReturnValueOnce(pending(25))
      .mockReturnValueOnce(pending(24))
      .mockReturnValueOnce(pending(20));
    const onWait = vi.fn();
    await expect(
      waitForPublishSlot('pubkey', { batch: 3, pollMs: 0, onWait })
    ).resolves.toBe(true);
    expect(onWait.mock.calls).toEqual([[25], [24]]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://node/transactions/unconfirmed?creator=pubkey'
    );
  });

  it('does not hold publishing up when the node cannot say', async () => {
    fetchMock.mockReturnValue(answer(null, false));
    await expect(waitForPublishSlot('pubkey', { pollMs: 0 })).resolves.toBe(
      true
    );
  });

  it('gives up after its time, or when cancelled', async () => {
    fetchMock.mockReturnValue(answer(Array(30).fill({ type: 'ARBITRARY' })));
    await expect(
      waitForPublishSlot('pubkey', { pollMs: 0, timeoutMs: 20 })
    ).resolves.toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForPublishSlot('pubkey', { signal: controller.signal })
    ).resolves.toBe(false);
  });
});
