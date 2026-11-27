import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The approval of SEND_COIN with ARRR, BUY_NAME, SELL_NAME, DEPLOY_AT and
// SIGN_TRANSACTION asks for "I have read this request" (`confirmCheckbox`:
// Accept stays off until it is ticked), and a declined request signs and
// sends nothing. TRANSFER_ASSET, multi-payments and app fees are tested in
// paymentRequests.test.ts, trade orders in createBuyOrder.test.ts and foreign
// fees in signForeignFees.test.ts.

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
vi.mock('../../i18n/i18n', async () =>
  (await import('./common')).i18nFactory()
);
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
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  buyNameRequest,
  deployAt,
  sellNameRequest,
  sendCoin,
  signTransaction,
} from '../get';
import { isRunningGateway } from '../qortal-requests';
import {
  buyName,
  createEndpoint,
  getBaseApi,
  getFee,
  getKeyPair,
  getSaveWallet,
  processTransactionVersion2,
  sellName,
} from '../../background/background';
import { createTransaction } from '../../transactions/transactions';
import { simulatePermission } from './common';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NODE = 'https://core.invalid';
const FEE = '0.01000000';
const DECLINED = 'question:message.generic.user_declined_request';
// Requests come from Opened-App's tab. The signed-in account owns the name
// Publisher.
const OPENED_APP = { name: 'Opened-App', service: 'APP', tabId: 4 };

/**
 * A node that answers each request whose URL holds one of the paths in
 * `answers` with that path's JSON.
 */
function stubNode(answers: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = Object.keys(answers).find((key) => url.includes(key));
    if (path === undefined) throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(answers[path]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The URLs the node was asked for, in order. */
const requestedUrls = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.map(([url]) => url);

beforeEach(() => {
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `${NODE}${path}`
  );
  vi.mocked(getBaseApi).mockResolvedValue(NODE);
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'QORT_ADDRESS' });
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: 'PRIVATE',
    publicKey: 'PUBLIC',
    arrrSeed58: 'ARRR_SEED',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SEND_COIN with ARRR', () => {
  it('asks for "I have read this request", and sends nothing when declined', async () => {
    const fetchMock = stubNode({
      '/crosschain/arrr/syncstatus': 'Synchronized',
      '/crosschain/arrr/walletbalance': 500000000, // 5 ARRR
      '/crosschain/arrr/send': 'ARRR_TX',
    });
    const payloads = simulatePermission(false);

    await expect(
      sendCoin(
        { coin: 'ARRR', amount: '1', recipient: 'arrr-address' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(DECLINED);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    // Only the wallet's sync status and balance were read.
    expect(requestedUrls(fetchMock)).toEqual([
      `${NODE}/crosschain/arrr/syncstatus`,
      `${NODE}/crosschain/arrr/walletbalance`,
    ]);
  });
});

describe('BUY_NAME', () => {
  it('asks for "I have read this request", and buys nothing when declined', async () => {
    stubNode({
      '/names/': {
        name: 'Name-For-Sale',
        owner: 'SELLER_ADDRESS',
        isForSale: true,
        salePrice: '5.00000000',
      },
    });
    const payloads = simulatePermission(false);

    await expect(
      buyNameRequest({ nameForSale: 'Name-For-Sale' }, false, OPENED_APP)
    ).rejects.toThrow(DECLINED);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(buyName).not.toHaveBeenCalled();
  });
});

describe('SELL_NAME', () => {
  it('asks for "I have read this request", and lists nothing for sale when declined', async () => {
    stubNode({
      '/names/': { name: 'Publisher', owner: 'QORT_ADDRESS', isForSale: false },
    });
    const payloads = simulatePermission(false);

    await expect(
      sellNameRequest(
        { nameForSale: 'Publisher', salePrice: 5 },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(DECLINED);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(sellName).not.toHaveBeenCalled();
  });
});

describe('DEPLOY_AT', () => {
  it('asks for "I have read this request", and deploys nothing when declined', async () => {
    const fetchMock = stubNode({});
    const payloads = simulatePermission(false);

    await expect(
      deployAt(
        {
          name: 'Test AT',
          description: 'Holds 1 QORT',
          tags: 'test',
          creationBytes: 'CREATION_BYTES',
          amount: 1,
          assetId: 0,
          type: 'TEST',
        },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(DECLINED);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(getKeyPair).not.toHaveBeenCalled();
    expect(createTransaction).not.toHaveBeenCalled();
    expect(processTransactionVersion2).not.toHaveBeenCalled();
    expect(requestedUrls(fetchMock)).toEqual([]);
  });
});

describe('SIGN_TRANSACTION', () => {
  it('asks for "I have read this request", and signs and sends nothing when declined', async () => {
    const fetchMock = stubNode({
      // A real decode carries the fee. The fixture used to omit it, which is not
      // something Core answers; now that the fee is bounded before signing, a
      // valued transaction with no fee is refused rather than signed unchecked.
      '/transactions/decode': {
        type: 'PAYMENT',
        amount: '1.00000000',
        fee: '0.01000000',
      },
      '/transactions/convert': 'BYTES_TO_SIGN',
    });
    const payloads = simulatePermission(false);

    await expect(
      signTransaction(
        { unsignedBytes: 'UNSIGNED_BYTES', process: true },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(DECLINED);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    // The node was only asked to decode the transaction for the dialog.
    expect(requestedUrls(fetchMock)).toEqual([
      `${NODE}/transactions/decode?ignoreValidityChecks=false`,
    ]);
    expect(getKeyPair).not.toHaveBeenCalled();
    expect(processTransactionVersion2).not.toHaveBeenCalled();
  });

  it('refuses to sign a PAYMENT the requester loaded with an enormous fee', async () => {
    // The requester builds these bytes, so no node quoted the fee and there is
    // no approval to compare against: this request is a PAYMENT carrying a
    // 500 QORT fee, refused before the user is asked to approve it.
    const fetchMock = stubNode({
      '/transactions/decode': {
        type: 'PAYMENT',
        amount: '1.00000000',
        fee: '500.00000000',
      },
      '/transactions/convert': 'BYTES_TO_SIGN',
    });
    const payloads = simulatePermission(true);

    await expect(
      signTransaction(
        { unsignedBytes: 'UNSIGNED_BYTES', process: true },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(/fee/i);

    expect(payloads).toHaveLength(0);
    expect(getKeyPair).not.toHaveBeenCalled();
    expect(processTransactionVersion2).not.toHaveBeenCalled();
    expect(requestedUrls(fetchMock)).toEqual([
      `${NODE}/transactions/decode?ignoreValidityChecks=false`,
    ]);
  });
});
