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

// enqueue(fn) must call fn() so that the AT-address fetch logic inside
// createBuyOrder actually executes during tests.
vi.mock('../../utils/queue/queue', () => ({
  RequestQueueWithPromise: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn((fn: () => Promise<unknown>) => fn()),
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

import { createBuyOrder } from '../get';
import { isRunningGateway } from '../qortal-requests';
import { createEndpoint, createBuyOrderTx } from '../../background/background';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const AT_ADDRESS = 'QORTAL_AT_1';
const FOREIGN_BLOCKCHAIN = 'LITECOIN'; // ticker → 'LTC'

const DEFAULT_AT_DATA = {
  qortalAtAddress: AT_ADDRESS,
  foreignBlockchain: FOREIGN_BLOCKCHAIN,
  qortAmount: '100',
  expectedForeignAmount: '0.005',
};

// Raw fee values returned by the node (in satoshis / base units).
// getBuyingFees divides by QORT_DECIMALS (1e8) to get the displayed amount.
const UNLOCK_FEE_SATS = 50_000; // 0.0005 LTC
const LOCK_FEE_SATS = 1_000; // 0.00001 LTC

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fetch mock that responds correctly to the three URL families that
 * createBuyOrder triggers:
 *   1. /crosschain/trade/<atAddress>  – AT info fetch
 *   2. /crosschain/ltc/feerequired   – unlock fee (getForeignFee)
 *   3. /crosschain/ltc/feekb         – lock fee   (getForeignFee)
 *
 * getForeignFee calls response.clone().json() so the fee responses need a
 * clone() method. The AT trade fetch uses response.json() directly.
 */
function makeFetch({
  atData = DEFAULT_AT_DATA as object,
  unlockFee = UNLOCK_FEE_SATS,
  lockFee = LOCK_FEE_SATS,
} = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/crosschain/trade/')) {
      return { ok: true, json: async () => atData };
    }
    if (url.includes('/feerequired')) {
      return { ok: true, clone: () => ({ json: async () => unlockFee }) };
    }
    if (url.includes('/feekb')) {
      return { ok: true, clone: () => ({ json: async () => lockFee }) };
    }
    throw new Error(`Unexpected URL in test fetch mock: ${url}`);
  });
}

/**
 * One-shot listener that intercepts the outgoing QORTAL_REQUEST_PERMISSION
 * postMessage from getUserPermission() and immediately replies with an
 * acceptance / rejection result so the Promise resolves without a real UI.
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

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    crosschainAtInfo: [{ qortalAtAddress: AT_ADDRESS }],
    foreignBlockchain: FOREIGN_BLOCKCHAIN,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createBuyOrder', () => {
  beforeEach(() => {
    vi.mocked(isRunningGateway).mockResolvedValue(false);
    vi.mocked(createEndpoint).mockImplementation(
      async (path: string) => `http://localhost${path}`
    );
    vi.mocked(createBuyOrderTx).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Input validation ────────────────────────────────────────────────────────

  describe('required-field validation', () => {
    it('throws when crosschainAtInfo is missing', async () => {
      await expect(
        createBuyOrder({ foreignBlockchain: FOREIGN_BLOCKCHAIN }, false)
      ).rejects.toThrow('question:message.error.missing_fields');
    });

    it('throws when foreignBlockchain is missing', async () => {
      await expect(
        createBuyOrder({ crosschainAtInfo: [{ qortalAtAddress: AT_ADDRESS }] }, false)
      ).rejects.toThrow('question:message.error.missing_fields');
    });

    it('throws when both required fields are absent', async () => {
      await expect(createBuyOrder({}, false)).rejects.toThrow(
        'question:message.error.missing_fields'
      );
    });
  });

  // ── AT-address blockchain validation ────────────────────────────────────────

  describe('AT-address blockchain validation', () => {
    it('throws when the fetched AT has a different foreignBlockchain', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetch({ atData: { ...DEFAULT_AT_DATA, foreignBlockchain: 'BITCOIN' } })
      );

      await expect(createBuyOrder(makeInput(), false)).rejects.toThrow(
        'core:message.error.same_foreign_blockchain'
      );
    });

    it('still validates each address in a multi-AT batch', async () => {
      // Second AT has the wrong blockchain
      let callCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/crosschain/trade/')) {
            callCount++;
            const blockchain =
              callCount === 2 ? 'BITCOIN' : FOREIGN_BLOCKCHAIN;
            return {
              ok: true,
              json: async () => ({ ...DEFAULT_AT_DATA, foreignBlockchain: blockchain }),
            };
          }
          if (url.includes('/feerequired'))
            return { ok: true, clone: () => ({ json: async () => UNLOCK_FEE_SATS }) };
          if (url.includes('/feekb'))
            return { ok: true, clone: () => ({ json: async () => LOCK_FEE_SATS }) };
          throw new Error(`Unexpected URL: ${url}`);
        })
      );

      await expect(
        createBuyOrder(
          {
            crosschainAtInfo: [
              { qortalAtAddress: 'AT_1' },
              { qortalAtAddress: 'AT_2' },
            ],
            foreignBlockchain: FOREIGN_BLOCKCHAIN,
          },
          false
        )
      ).rejects.toThrow('core:message.error.same_foreign_blockchain');
    });
  });

  // ── Fee-fetching errors ─────────────────────────────────────────────────────

  describe('fee-fetching errors', () => {
    it('propagates the error message when the fee endpoint returns non-ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/crosschain/trade/'))
            return { ok: true, json: async () => DEFAULT_AT_DATA };
          // Both fee endpoints fail
          return { ok: false };
        })
      );

      await expect(createBuyOrder(makeInput(), false)).rejects.toThrow(
        'question:message.error.fetch_generic'
      );
    });
  });

  // ── Permission guard ────────────────────────────────────────────────────────

  describe('permission guard', () => {
    it('throws when the user declines the permission prompt', async () => {
      vi.stubGlobal('fetch', makeFetch());
      simulatePermission(false);

      await expect(createBuyOrder(makeInput(), false)).rejects.toThrow(
        'question:message.generic.user_declined_request'
      );
    });
  });

  // ── Successful flow ─────────────────────────────────────────────────────────

  describe('successful buy order', () => {
    it('returns the result from createBuyOrderTx', async () => {
      vi.stubGlobal('fetch', makeFetch());
      simulatePermission(true);

      const result = await createBuyOrder(makeInput(), false);

      expect(result).toEqual({ success: true });
    });

    it('passes the resolved crosschainAtInfo and foreignBlockchain to createBuyOrderTx', async () => {
      vi.stubGlobal('fetch', makeFetch());
      simulatePermission(true);

      await createBuyOrder(makeInput(), false);

      expect(createBuyOrderTx).toHaveBeenCalledOnce();
      expect(createBuyOrderTx).toHaveBeenCalledWith(
        expect.objectContaining({
          crosschainAtInfo: [DEFAULT_AT_DATA],
          foreignBlockchain: FOREIGN_BLOCKCHAIN,
          isGateway: false,
        })
      );
    });

    it('passes isGateway=true to createBuyOrderTx when on a gateway node', async () => {
      vi.mocked(isRunningGateway).mockResolvedValue(true);
      vi.stubGlobal('fetch', makeFetch());
      simulatePermission(true);

      await createBuyOrder(makeInput(), false);

      expect(createBuyOrderTx).toHaveBeenCalledWith(
        expect.objectContaining({ isGateway: true })
      );
    });

    it('aggregates crosschainAtInfo for multiple AT addresses', async () => {
      const AT_ADDRESS_2 = 'QORTAL_AT_2';
      const at2 = { ...DEFAULT_AT_DATA, qortalAtAddress: AT_ADDRESS_2 };

      // Dispatch on URL so each AT address reliably returns its own data,
      // regardless of parallel fetch execution order inside Promise.all.
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes(`/crosschain/trade/${AT_ADDRESS}`))
            return { ok: true, json: async () => DEFAULT_AT_DATA };
          if (url.includes(`/crosschain/trade/${AT_ADDRESS_2}`))
            return { ok: true, json: async () => at2 };
          if (url.includes('/feerequired'))
            return { ok: true, clone: () => ({ json: async () => UNLOCK_FEE_SATS }) };
          if (url.includes('/feekb'))
            return { ok: true, clone: () => ({ json: async () => LOCK_FEE_SATS }) };
          throw new Error(`Unexpected URL: ${url}`);
        })
      );
      simulatePermission(true);

      await createBuyOrder(
        {
          crosschainAtInfo: [
            { qortalAtAddress: AT_ADDRESS },
            { qortalAtAddress: AT_ADDRESS_2 },
          ],
          foreignBlockchain: FOREIGN_BLOCKCHAIN,
        },
        false
      );

      const received = vi.mocked(createBuyOrderTx).mock.calls[0][0];
      expect(received.crosschainAtInfo).toHaveLength(2);
      expect(received.crosschainAtInfo).toEqual(
        expect.arrayContaining([DEFAULT_AT_DATA, at2])
      );
    });

    it('fetches the trade endpoint once per AT address', async () => {
      const mockFetch = makeFetch();
      vi.stubGlobal('fetch', mockFetch);
      simulatePermission(true);

      await createBuyOrder(
        {
          crosschainAtInfo: [
            { qortalAtAddress: 'AT_1' },
            { qortalAtAddress: 'AT_2' },
            { qortalAtAddress: 'AT_3' },
          ],
          foreignBlockchain: FOREIGN_BLOCKCHAIN,
        },
        false
      );

      const tradeCalls = vi
        .mocked(mockFetch)
        .mock.calls.filter(([url]) =>
          (url as string).includes('/crosschain/trade/')
        );
      expect(tradeCalls).toHaveLength(3);
    });
  });
});
