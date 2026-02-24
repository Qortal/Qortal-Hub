import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────

vi.mock('../qortal-requests', () => ({
  isRunningGateway: vi.fn(),
  getPermission: vi.fn(),
  setPermission: vi.fn(),
  setSessionPermissions: vi.fn(),
  hasSessionPermission: vi.fn(),
  VALID_SESSION_PERMISSIONS: [],
  AUTO_GRANTED_PERMISSIONS_ON_AUTH: [],
}));

vi.mock('../../background/background', () => ({
  createEndpoint: vi.fn(),
  gateways: [],
  getApiKeyFromStorage: vi.fn(),
  getNameInfoForOthers: vi.fn(),
  getBalanceInfo: vi.fn(),
  getFee: vi.fn(),
  getKeyPair: vi.fn(),
  getLastRef: vi.fn(),
  getSaveWallet: vi.fn(),
  processTransactionVersion2: vi.fn(),
  signChatFunc: vi.fn(),
  joinGroup: vi.fn(),
  sendQortFee: vi.fn(),
  sendCoin: vi.fn(),
  createBuyOrderTx: vi.fn(),
  performPowTask: vi.fn(),
  parseErrorResponse: vi.fn(),
  groupSecretkeys: vi.fn(),
  registerName: vi.fn(),
  updateName: vi.fn(),
  leaveGroup: vi.fn(),
  inviteToGroup: vi.fn(),
  kickFromGroup: vi.fn(),
  banFromGroup: vi.fn(),
  cancelBan: vi.fn(),
  makeAdmin: vi.fn(),
  removeAdmin: vi.fn(),
  cancelInvitationToGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  sellName: vi.fn(),
  cancelSellName: vi.fn(),
  buyName: vi.fn(),
  getBaseApi: vi.fn(),
  getAssetBalanceInfo: vi.fn(),
  getNameOrAddress: vi.fn(),
  getAssetInfo: vi.fn(),
  getPublicKey: vi.fn(),
  transferAsset: vi.fn(),
  sendChatNotification: vi.fn(),
  sendChatGroup: vi.fn(),
}));

vi.mock('../../encryption/encryption', () => ({
  encryptAndPublishSymmetricKeyGroupChat: vi.fn(),
  getAllUserNames: vi.fn(),
  getNameInfo: vi.fn(),
  uint8ArrayToObject: vi.fn(),
}));

vi.mock('../../components/Chat/AdminSpaceInner', () => ({
  getPublishesFromAdminsAdminSpace: vi.fn(),
}));

vi.mock('../../components/Chat/MessageDisplay', () => ({
  extractComponents: vi.fn(),
}));

vi.mock('../../components/Group/Group', () => ({
  decryptResource: vi.fn(),
  getGroupAdmins: vi.fn(),
  getPublishesFromAdmins: vi.fn(),
  validateSecretKey: vi.fn(),
}));

vi.mock('../../qdn/encryption/group-encryption', () => ({
  base64ToUint8Array: vi.fn(),
  createSymmetricKeyAndNonce: vi.fn(),
  decryptDeprecatedSingle: vi.fn(),
  decryptGroupDataQortalRequest: vi.fn(),
  decryptGroupEncryptionWithSharingKey: vi.fn(),
  decryptSingle: vi.fn(),
  encryptDataGroup: vi.fn(),
  encryptSingle: vi.fn(),
  hasPrivateString: vi.fn(),
  objectToBase64: vi.fn(),
  uint8ArrayStartsWith: vi.fn(),
  uint8ArrayToBase64: vi.fn(),
}));

vi.mock('../../qdn/publish/publish', () => ({
  publishData: vi.fn(),
}));

vi.mock('../../transactions/TradeBotCreateRequest', () => ({
  default: vi.fn(),
}));

vi.mock('../../transactions/TradeBotDeleteRequest', () => ({
  default: vi.fn(),
}));

vi.mock('../../transactions/signTradeBotTransaction', () => ({
  default: vi.fn(),
}));

vi.mock('../../transactions/transactions', () => ({
  createTransaction: vi.fn(),
}));

vi.mock('../../utils/events', () => ({
  executeEvent: vi.fn(),
}));

vi.mock('../../utils/fileReading/index', () => ({
  fileToBase64: vi.fn(),
}));

vi.mock('../../utils/memeTypes', () => ({
  mimeToExtensionMap: {},
}));

vi.mock('../../utils/queue/queue', () => ({
  RequestQueueWithPromise: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn(),
  })),
}));

vi.mock('../../utils/utils', () => ({
  default: { some: vi.fn() },
}));

vi.mock('short-unique-id', () => ({
  default: vi.fn().mockImplementation(() => ({ rnd: vi.fn(() => 'abc123') })),
}));

vi.mock('../../utils/decode', () => ({
  isValidBase64WithDecode: vi.fn(),
  validateAesCtrIvAndKey: vi.fn(),
}));

vi.mock('i18next', () => ({
  default: { t: vi.fn((key: string) => key) },
}));

vi.mock('aes-js', () => ({ default: {} }));
vi.mock('../../encryption/Base58', () => ({ default: {} }));
vi.mock('../../encryption/ed2curve', () => ({ default: {} }));
vi.mock('../../encryption/nacl-fast', () => ({ default: {} }));
vi.mock('asmcrypto.js', () => ({ Sha256: {} }));

vi.mock('../../hooks/useQortalMessageListener', () => ({
  showSaveFilePicker: vi.fn(),
  listOfAllQortalRequests: [],
  UIQortalRequests: [],
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { deleteHostedData } from '../get';
import { isRunningGateway } from '../qortal-requests';
import { createEndpoint } from '../../background/background';

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

/**
 * Register a one-shot listener that responds to the outgoing
 * QORTAL_REQUEST_PERMISSION postMessage with an acceptance/rejection result.
 * get.ts attaches its own `handleMessage` listener at module load time, so
 * posting QORTAL_REQUEST_PERMISSION_RESPONSE back to window is enough to
 * resolve the getUserPermission() promise.
 */
function simulatePermission(accepted: boolean) {
  window.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (event.data?.action === 'QORTAL_REQUEST_PERMISSION') {
        window.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: event.data.requestId,
            result: { accepted },
          },
          window.location.origin
        );
      }
    },
    { once: true }
  );
}

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
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
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
