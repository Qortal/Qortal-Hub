import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Factories live in ./common.ts; async dynamic import is used because vi.mock()
// is hoisted before regular imports.

vi.mock('../qortal-requests', async () =>
  (await import('./common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () =>
  (await import('./common')).backgroundFactory()
);
vi.mock('../../encryption/encryption', async () =>
  (await import('./common')).encryptionFactory()
);
vi.mock('../../components/Chat/AdminSpaceInner', async () =>
  (await import('./common')).adminSpaceFactory()
);
vi.mock('../../components/Chat/MessageDisplay', async () =>
  (await import('./common')).messageDisplayFactory()
);
vi.mock('../../components/Group/Group', async () =>
  (await import('./common')).groupFactory()
);
vi.mock('../../qdn/encryption/group-encryption', async () =>
  (await import('./common')).groupEncryptionFactory()
);
vi.mock('../../qdn/publish/publish', async () =>
  (await import('./common')).publishFactory()
);
vi.mock('../../transactions/TradeBotCreateRequest', async () =>
  (await import('./common')).tradeBotCreateFactory()
);
vi.mock('../../transactions/TradeBotDeleteRequest', async () =>
  (await import('./common')).tradeBotDeleteFactory()
);
vi.mock('../../transactions/signTradeBotTransaction', async () =>
  (await import('./common')).signTradeBotFactory()
);
vi.mock('../../transactions/transactions', async () =>
  (await import('./common')).transactionsFactory()
);
vi.mock('../../utils/events', async () =>
  (await import('./common')).eventsFactory()
);
vi.mock('../../utils/fileReading/index', async () =>
  (await import('./common')).fileReadingFactory()
);
vi.mock('../../utils/memeTypes', async () =>
  (await import('./common')).mimeTypesFactory()
);
vi.mock('../../utils/queue/queue', async () =>
  (await import('./common')).queueFactory()
);
vi.mock('../../utils/utils', async () =>
  (await import('./common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../encryption/Base58', async () =>
  (await import('./common')).base58Factory()
);
vi.mock('../../encryption/ed2curve', async () =>
  (await import('./common')).ed2curveFactory()
);
vi.mock('../../encryption/nacl-fast', async () =>
  (await import('./common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('./common')).asmcryptoFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { deleteHostedData } from '../get';
import { isRunningGateway } from '../qortal-requests';
import { createEndpoint } from '../../background/background';
import { simulatePermission } from './common';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface HostedDataItem {
  service: string;
  name: string;
  identifier: string;
}

const makeItem = (n: number): HostedDataItem => ({
  service: 'APP',
  name: `name${n}`,
  identifier: `id${n}`,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('deleteHostedData', () => {
  beforeEach(() => {
    vi.mocked(isRunningGateway).mockResolvedValue(false);
    vi.mocked(createEndpoint).mockImplementation(
      async (path: string) => `http://localhost${path}`
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Permission / gateway guards ───────────────────────────────────────────

  it('throws when running on a gateway node', async () => {
    vi.mocked(isRunningGateway).mockResolvedValue(true);

    await expect(
      deleteHostedData({ hostedData: [makeItem(1)] }, false)
    ).rejects.toThrow();
  });

  it('throws when the user declines the permission prompt', async () => {
    simulatePermission(false);

    await expect(
      deleteHostedData({ hostedData: [makeItem(1)] }, false)
    ).rejects.toThrow(
      'question:message.generic.user_declined_delete_hosted_resources'
    );
  });

  // ── All items succeed ─────────────────────────────────────────────────────

  it('returns deletedCount=N and empty failures when every DELETE succeeds', async () => {
    simulatePermission(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );

    const result = await deleteHostedData(
      { hostedData: [makeItem(1), makeItem(2), makeItem(3)] },
      false
    );

    expect(result).toEqual({ deletedCount: 3, failedCount: 0, failures: [] });
  });

  // ── Individual failure modes ──────────────────────────────────────────────

  it('records a failure when a DELETE returns a non-ok HTTP status', async () => {
    simulatePermission(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('Not Found'),
      })
    );

    const result = await deleteHostedData({ hostedData: [makeItem(1)] }, false);

    expect(result).toEqual({
      deletedCount: 0,
      failedCount: 1,
      failures: [
        {
          service: 'APP',
          name: 'name1',
          identifier: 'id1',
          status: 404,
          error: 'Not Found',
        },
      ],
    });
  });

  it('records a failure with status 0 when fetch throws a network error', async () => {
    simulatePermission(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error'))
    );

    const result = await deleteHostedData({ hostedData: [makeItem(1)] }, false);

    expect(result).toEqual({
      deletedCount: 0,
      failedCount: 1,
      failures: [
        {
          service: 'APP',
          name: 'name1',
          identifier: 'id1',
          status: 0,
          error: 'Network error',
        },
      ],
    });
  });

  // ── Mixed outcomes ────────────────────────────────────────────────────────

  it('correctly separates successes and failures in a mixed batch', async () => {
    simulatePermission(true);
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // item 1: ok
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal Server Error'),
        }) // item 2: fail
        .mockResolvedValueOnce({ ok: true, status: 200 }) // item 3: ok
    );

    const result = await deleteHostedData(
      { hostedData: [makeItem(1), makeItem(2), makeItem(3)] },
      false
    );

    expect(result.deletedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      service: 'APP',
      name: 'name2',
      identifier: 'id2',
      status: 500,
      error: 'Internal Server Error',
    });
  });

  it('returns deletedCount=0 and failedCount=N when every item fails', async () => {
    simulatePermission(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('Forbidden'),
      })
    );

    const result = await deleteHostedData(
      { hostedData: [makeItem(1), makeItem(2)] },
      false
    );

    expect(result.deletedCount).toBe(0);
    expect(result.failedCount).toBe(2);
    expect(result.failures).toHaveLength(2);
  });

  // ── Endpoint construction ─────────────────────────────────────────────────

  it('issues a DELETE request to the correct URL for each item', async () => {
    simulatePermission(true);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    await deleteHostedData(
      { hostedData: [makeItem(1), makeItem(2)] },
      false
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/arbitrary/resource/APP/name1/id1',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/arbitrary/resource/APP/name2/id2',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('continues processing remaining items after a single item fails', async () => {
    simulatePermission(true);
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout')) // item 1 throws
      .mockResolvedValueOnce({ ok: true, status: 200 }); // item 2 succeeds
    vi.stubGlobal('fetch', mockFetch);

    const result = await deleteHostedData(
      { hostedData: [makeItem(1), makeItem(2)] },
      false
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.deletedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});
