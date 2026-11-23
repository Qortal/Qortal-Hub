/**
 * The runner through Hub's real publishOnQDN and publishData, with only the
 * node faked: a node that stops answering, or is busy for a moment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../background/background', () => ({
  getBaseApi: vi.fn(async () => 'http://node'),
  createEndpoint: vi.fn(async (endpoint: string) => `http://node${endpoint}`),
}));
vi.mock('../../utils/chromeStorage', () => ({ getData: vi.fn() }));

import Base58Module from '../../encryption/Base58';
import naclModule from '../../encryption/nacl-fast';
import { getData } from '../../utils/chromeStorage';
import {
  runPublishSteps,
  type RunPublishResult,
  waitForPublishSlot,
} from './runner';
import type { PublishStep } from './types';

// Both are untyped JavaScript modules.
const Base58 = Base58Module as unknown as {
  encode(bytes: Uint8Array): string;
};
const nacl = naclModule as unknown as {
  sign: { keyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } };
};
/** Any valid Base58: the node's unsigned transaction bytes. */
const UNSIGNED_TX = Base58.encode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

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

const defaultFetch = async (url: string) => {
  if (url.includes('/names/')) return response({ name: 'Me' });
  if (url.includes('/addresses/balance/')) return response(5);
  if (url.includes('/transactions/unitfee')) return response('1000000');
  if (url.includes('/arbitrary/check/tmp')) return response('');
  if (url.includes('/chunk')) return response('');
  if (url.includes('/finalize') || url.includes('/base64')) {
    return response(UNSIGNED_TX);
  }
  if (url.includes('/transactions/convert')) return response(UNSIGNED_TX);
  if (url.includes('/transactions/process')) {
    return response({ signature: 'sig' });
  }
  return response({ error: 311, message: 'TRANSACTION_UNKNOWN' }, 404);
};
const fetchMock = vi.fn(defaultFetch);

const listing = (key: string): PublishStep => ({
  key,
  kind: 'metadata',
  service: 'DOCUMENT',
  identifier: `id_${key}`,
  data: { base64: 'e30=' },
  bytes: 2,
});

const video = (key: string): PublishStep => ({
  key,
  kind: 'video',
  service: 'VIDEO',
  identifier: `id_${key}`,
  filename: 'Clip.mp4',
  data: { file: new Blob(['a converted video']) },
  bytes: 17,
});

/** Runs the timers (publishData's and the runner's waits) to the end. */
async function finish(
  running: Promise<RunPublishResult>
): Promise<RunPublishResult> {
  let done = false;
  const tracked = running.finally(() => {
    done = true;
  });
  while (!done) await vi.advanceTimersByTimeAsync(25_000);
  return tracked;
}

const posts = (part: string) =>
  fetchMock.mock.calls.filter(([url]) => url.includes(part)).length;

/** The node answers `answer` the first time `part` is asked, then as usual. */
function busyOnce(part: string, answer: () => unknown) {
  let busy = true;
  fetchMock.mockImplementation(async (url: string) => {
    if (busy && url.includes(part)) {
      busy = false;
      return answer() as ReturnType<typeof response>;
    }
    return defaultFetch(url);
  });
}

beforeEach(() => {
  const keys = nacl.sign.keyPair();
  vi.mocked(getData).mockImplementation(async (key: string) =>
    key === 'walletInfo'
      ? { address0: 'Qaddress' }
      : {
          privateKey: Base58.encode(keys.secretKey),
          publicKey: Base58.encode(keys.publicKey),
        }
  );
  fetchMock.mockClear();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runPublishSteps when the node stops answering', () => {
  it('fails a listing the node could not be reached for as a network error, and goes on', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/arbitrary/DOCUMENT/Me/id_listing/base64')) {
        throw new TypeError('Failed to fetch');
      }
      return defaultFetch(url);
    });

    const result = await finish(
      runPublishSteps([listing('listing'), listing('other')], { name: 'Me' })
    );

    expect(result.outcomes[0].status).toBe('failed');
    expect(result.outcomes[0].error?.code).toBe('network');
    // Tried twice more, as a file's chunks are.
    expect(posts('/id_listing/base64')).toBe(9);
    // What doesn't depend on it still goes up: the run isn't stopped.
    expect(result.stoppedBy).toBeUndefined();
    expect(result.outcomes[1].status).toBe('published');
  });

  it.each([
    ['answers 503', () => response('Service Unavailable', 503)],
    ['is behind a gateway that gives up (504)', () => response('', 504)],
    [
      'loses the connection on the way',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])(
    'sends no second transaction by itself when the node %s and has none yet',
    async (_, failure) => {
      // Core waits up to a minute for its blockchain lock and goes on with a
      // request whose caller is gone, so "unknown" right after isn't final.
      let built = 0;
      const sent = new Set<unknown>();
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/base64')) {
          built += 1;
          return response(Base58.encode(new Uint8Array([1, 2, 3, built])));
        }
        if (url.includes('/transactions/signature/')) {
          return response({ error: 311, message: 'TRANSACTION_UNKNOWN' }, 404);
        }
        if (url.includes('/transactions/process')) {
          sent.add(init?.body);
          return failure();
        }
        return defaultFetch(url);
      });

      const result = await finish(
        runPublishSteps([listing('listing'), listing('other')], { name: 'Me' })
      );

      // A second transaction would pay a second fee.
      expect(sent.size).toBe(1);
      expect(result.outcomes[0].status).toBe('failed');
      expect(result.outcomes[1].status).toBe('skipped');
      expect(result.stoppedBy?.code).toBe('publish-failed');
    }
  );

  it('does not send a transaction again by itself when nobody can say whether the node took it', async () => {
    // The node takes the transaction, but its answer is lost and it can't
    // be reached for a while, not even to ask whether it has it.
    let taken = 0;
    let reachable = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (!reachable) throw new TypeError('Failed to fetch');
      if (url.includes('/transactions/process')) {
        taken += 1;
        reachable = false;
        setTimeout(() => {
          reachable = true;
        }, 55_000);
        throw new TypeError('Failed to fetch');
      }
      return defaultFetch(url);
    });

    const result = await finish(
      runPublishSteps([listing('listing'), listing('other')], { name: 'Me' })
    );

    // A second transaction would pay a second fee.
    expect(taken).toBe(1);
    expect(result.outcomes[0].status).toBe('failed');
    expect(result.outcomes[1].status).toBe('skipped');
    expect(result.stoppedBy?.code).toBe('publish-failed');
  });
});

describe('runPublishSteps when the node is busy for a moment', () => {
  it.each([
    ['the balance', '/addresses/balance/'],
    ['the fee', '/transactions/unitfee'],
    ['the name', '/names/Me'],
  ])(
    'tries again when the node answers 503 once while asked for %s, and does not stop the run',
    async (_what, part) => {
      busyOnce(part, () => response('Service Unavailable', 503));

      const result = await finish(
        runPublishSteps([listing('first'), listing('other')], { name: 'Me' })
      );

      // A node answer worth retrying is tried again; the run goes on.
      expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
        'published',
        'published',
      ]);
      expect(result.stoppedBy).toBeUndefined();
    }
  );

  it("tries again when the node's blockchain was too busy to take the transaction", async () => {
    // Core gives up waiting for its blockchain lock after a minute and
    // answers 400, before it takes the transaction in.
    busyOnce('/transactions/process', () =>
      response(
        {
          error: 312,
          message:
            "transaction invalid: node's blockchain currently busy (NO_BLOCKCHAIN_LOCK)",
        },
        400
      )
    );

    const result = await finish(
      runPublishSteps([listing('first'), listing('other')], { name: 'Me' })
    );

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'published',
      'published',
    ]);
    expect(result.stoppedBy).toBeUndefined();
  });
});

describe('runPublishSteps when the node cannot take a video', () => {
  it('stops the run when the node says its disk is full', async () => {
    busyOnce('/arbitrary/check/tmp', () =>
      response('Insufficient disk space', 507)
    );

    const result = await finish(
      runPublishSteps([video('video'), listing('other')], { name: 'Me' })
    );

    // Waiting 10 s doesn't free a disk: nothing is uploaded or tried again.
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'failed',
      'skipped',
    ]);
    expect(result.stoppedBy?.code).toBe('publish-failed');
    expect(posts('/arbitrary/check/tmp')).toBe(1);
    expect(posts('/chunk')).toBe(0);
  });

  it('stops the run, without uploading the video again, when the node cannot join its upload', async () => {
    busyOnce('/finalize', () =>
      response(
        {
          error: 500,
          message: 'Failed to merge chunks: Disk quota exceeded',
        },
        500
      )
    );

    const result = await finish(
      runPublishSteps([video('video'), listing('other')], { name: 'Me' })
    );

    // The node dropped the chunks: another try would upload it all again.
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'failed',
      'skipped',
    ]);
    expect(result.stoppedBy?.code).toBe('publish-failed');
    expect(posts('/chunk')).toBe(1);
  });
});

describe('waitForPublishSlot for an account that also chats', () => {
  it("waits while the account's publishes fill Core's limit, whatever its chat messages", async () => {
    vi.useRealTimers();
    // Core lists the account's unconfirmed transactions oldest first and
    // cuts the list at `limit`. Chat messages stay unconfirmed for a day;
    // Core's limit of 25 counts everything else.
    const pending = [
      ...Array.from({ length: 100 }, (_, index) => ({
        type: 'CHAT',
        timestamp: 1_000 + index,
      })),
      ...Array.from({ length: 25 }, (_, index) => ({
        type: 'ARBITRARY',
        timestamp: 5_000 + index,
      })),
    ];
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes('/transactions/unconfirmed')) return defaultFetch(url);
      const limit = Number(new URL(url).searchParams.get('limit') || 0);
      return response(limit > 0 ? pending.slice(0, limit) : pending);
    });
    const onWait = vi.fn();

    const may = await waitForPublishSlot('pubkey', {
      pollMs: 0,
      timeoutMs: 30,
      onWait,
    });

    // 25 publishes pending: the next one would be refused.
    expect(onWait).toHaveBeenCalledWith(25);
    expect(may).toBe(false);
  });
});
