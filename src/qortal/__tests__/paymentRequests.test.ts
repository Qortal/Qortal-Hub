import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

// The Q-App requests that move QORT or an asset: SEND_COIN (QORT),
// TRANSFER_ASSET, MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA and the app fee of a
// publish. Same factories as the other get.ts tests (see ./common.ts), with
// the real Base58 and SHA-256 for the address checks, and an i18n stub that
// keeps the parameters so the dialog text can be checked. The tests of names
// with invisible characters use the real resolveRecipient from background.ts,
// and those of the asset balance use its real getAssetBalanceInfo.

// src/test/setup.ts stubs asmcrypto out.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
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
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
const i18nStub = vi.hoisted(() => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) => {
      const params = { ...(options || {}) };
      delete params.postProcess;
      return Object.keys(params).length
        ? `${key} ${JSON.stringify(params)}`
        : key;
    },
  },
}));
vi.mock('i18next', () => i18nStub);
vi.mock('../../i18n/i18n', () => i18nStub);
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../foreign-coin-send', () => ({ sendLocalForeignCoin: vi.fn() }));
// The real background.ts is loaded below without its worker and its handlers
// for Hub's own messages.
vi.mock('../../background/background-cases', () => ({}));
vi.mock('../../chatComputePow.worker.js?worker', () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage() {}
  },
}));

import { SecureStoragePlugin } from '@evva/capacitor-secure-storage-plugin';
import enAuth from '../../i18n/locales/en/auth.json';
import enCore from '../../i18n/locales/en/core.json';
import enQuestion from '../../i18n/locales/en/question.json';
import { capitalizeFirstChar } from '../../i18n/processors';
import Base58Untyped from '../../encryption/Base58';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import {
  deployAt,
  multiPaymentWithPrivateData,
  payAppFeeAfterPublish,
  publishMultipleQDNResources,
  publishQDNResource,
  sendCoin,
  transferAssetRequest,
} from '../get';
import { hasSessionPermission, isRunningGateway } from '../qortal-requests';
import { sendLocalForeignCoin } from '../foreign-coin-send';
import {
  createEndpoint,
  getAssetBalanceInfo,
  getAssetInfo,
  getBalanceInfo,
  getFee,
  getKeyPair,
  getPublicKey,
  getSaveWallet,
  resolveRecipient,
  sendCoin as sendCoinFunc,
  sendQortFee,
  transferAsset,
} from '../../background/background';
import { getAllUserNames, getNameInfo } from '../../encryption/encryption';
import {
  encryptDataGroup,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { publishData } from '../../qdn/publish/publish';
import { isValidBase64WithDecode } from '../../utils/decode';
import { executeEvent } from '../../utils/events';
import {
  checkValueTransferFee,
  parseDecimalAmount,
} from '../../transactions/paymentSafety';
import { serializeQortalRequestError } from '../qortal-request-errors';

const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

function address(fill: number): string {
  return String(publicKeyToAddress(new Uint8Array(32).fill(fill)));
}

// Account-A is Recipient B's address, Account-C is Recipient D's; the
// signed-in account is Account-S. Account-X owns names with invisible
// characters. Requests come from Opened-App's tab.
const ACCOUNT_A = address(31);
const ACCOUNT_C = address(32);
const ACCOUNT_S = address(33);
const ACCOUNT_X = address(34);
const FEE = '0.01000000';
const OPENED_APP = { name: 'Opened-App', service: 'APP', tabId: 4 };

type Background = typeof import('../../background/background');
/** The real resolveRecipient; the module mock above stands in for it. */
let realResolveRecipient: Background['resolveRecipient'];
/** The real getAssetBalanceInfo, for the tests that run it against a node. */
let realGetAssetBalanceInfo: Background['getAssetBalanceInfo'];

beforeAll(async () => {
  const background = await vi.importActual<Background>(
    '../../background/background'
  );
  realResolveRecipient = background.resolveRecipient;
  realGetAssetBalanceInfo = background.getAssetBalanceInfo;
});

/** Answers every approval request and records what it showed. */
function answerPrompts(result: { accepted: boolean; checkbox1?: boolean }) {
  const payloads: Record<string, any>[] = [];
  const listener = (event: MessageEvent) => {
    if (event.data?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    payloads.push(event.data.payload);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: event.data.requestId,
          result,
        },
        origin: window.location.origin,
        source: window,
      })
    );
  };
  window.addEventListener('message', listener);
  onTestFinished(() => window.removeEventListener('message', listener));
  return payloads;
}

/** The node's answer to /addresses/balance/<address>. */
function stubBalance(balance: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => balance,
    text: async () => String(balance),
    clone: () => ({
      json: async () => balance,
      text: async () => String(balance),
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * A node that answers a balance of 100 QORT, and gives `owner` as the owner
 * of any name looked up with /names/<name>.
 */
function stubNodeWithNamesOf(owner: string) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = String(url);
    const body = path.includes('/names/')
      ? { name: decodeURIComponent(path.split('/names/')[1]), owner }
      : 100;
    const json = async () => body;
    const text = async () => JSON.stringify(body);
    return { ok: true, status: 200, json, text, clone: () => ({ json, text }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * A node that answers `body` to /assets/balances, read by the real
 * getAssetBalanceInfo for the signed-in account.
 */
function stubAssetBalances(body: unknown) {
  vi.mocked(getAssetBalanceInfo).mockImplementation(realGetAssetBalanceInfo);
  const storage = vi.mocked(SecureStoragePlugin.get);
  const emptyStorage = storage.getMockImplementation();
  storage.mockImplementation(async ({ key }) => ({
    value:
      key === 'walletInfo' ? btoa(JSON.stringify({ address0: ACCOUNT_S })) : '',
  }));
  onTestFinished(() => {
    if (emptyStorage) storage.mockImplementation(emptyStorage);
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (!String(url).includes('/assets/balances?')) {
      throw new Error(`unexpected request ${url}`);
    }
    const json = async () => body;
    const text = async () => JSON.stringify(body);
    return { ok: true, status: 200, json, text, clone: () => ({ json, text }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** One row of /assets/balances, as Core writes it: a balance in decimal text. */
const assetBalanceRow = (balance: unknown) => ({
  address: ACCOUNT_S,
  assetId: 5,
  balance,
  assetName: 'TESTASSET',
});

/** Answers of /assets/balances that hold no balance Hub can read. */
const unreadableAssetBalances: [string, unknown][] = [
  ['no row, as Core answers for an asset never held', []],
  ['a row without a balance', [assetBalanceRow(undefined)]],
  ['null', [assetBalanceRow(null)]],
  ['empty text', [assetBalanceRow('')]],
  ['text that is not a number', [assetBalanceRow('abc')]],
  ['NaN', [assetBalanceRow('NaN')]],
  ['Infinity', [assetBalanceRow('Infinity')]],
  ['scientific notation', [assetBalanceRow('1e12')]],
  ['a negative balance', [assetBalanceRow('-100.00000000')]],
  ['an error object', { error: 601, message: 'invalid asset ID' }],
  ['null for the whole list', null],
];

const nameLookups = (fetchMock: ReturnType<typeof stubNodeWithNamesOf>) =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/names/'));

/** Real i18next with the English strings, for this test only. */
async function useEnglish() {
  const { default: realI18next } =
    await vi.importActual<typeof import('i18next')>('i18next');
  const instance = realI18next
    .createInstance()
    .use({ ...capitalizeFirstChar, type: 'postProcessor' as const });
  await instance.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['auth', 'core', 'question'],
    defaultNS: 'core',
    resources: {
      en: { auth: enAuth, core: enCore, question: enQuestion },
    },
    interpolation: { escapeValue: false },
  });
  const stubT = i18nStub.default.t;
  i18nStub.default.t = instance.t.bind(instance) as unknown as typeof stubT;
  onTestFinished(() => {
    i18nStub.default.t = stubT;
  });
}

/**
 * Runs `request` with fake timers, so its waits (the pause between publishes,
 * the retries of a publish) pass at once. Resolves to its result, or to the
 * error it threw.
 */
async function withFakeTimers<T>(request: () => Promise<T>) {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const outcome = request().then(
    (value) => value,
    (error: Error) => error
  );
  await vi.runAllTimersAsync();
  return outcome;
}

beforeEach(() => {
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `http://127.0.0.1:12391${path}`
  );
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: ACCOUNT_S });
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: 'PRIVATE',
    publicKey: 'PUBLIC',
  });
  vi.mocked(sendQortFee).mockResolvedValue(FEE as unknown as number);
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
  vi.mocked(getBalanceInfo).mockResolvedValue(100);
  // Decimal text, as Core answers /assets/balances: 10000 units.
  vi.mocked(getAssetBalanceInfo).mockResolvedValue('10000.00000000');
  vi.mocked(getAssetInfo).mockResolvedValue({ name: 'TESTASSET' });
  vi.mocked(resolveRecipient).mockImplementation(async (value: unknown) => {
    if (value === 'Recipient B')
      return { address: ACCOUNT_A, name: 'Recipient B' };
    if (value === 'Recipient D')
      return { address: ACCOUNT_C, name: 'Recipient D' };
    return { address: String(value), name: '' };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── SEND_COIN (QORT) ─────────────────────────────────────────────────────────

describe('SEND_COIN with QORT', () => {
  it('shows the name, the full address and the amount as signed, and pays that address with the fee it showed', async () => {
    stubBalance(100);
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, outcome: 'sent', data: { signature: 'SIG' } },
      validApi: null,
    });

    await expect(
      sendCoin(
        { coin: 'QORT', amount: '1.50', recipient: 'Recipient B' },
        false,
        OPENED_APP
      )
    ).resolves.toEqual({ signature: 'SIG' });

    expect(resolveRecipient).toHaveBeenCalledWith('Recipient B');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].text2).toContain('Recipient B');
    expect(payloads[0].text2).toContain(ACCOUNT_A);
    expect(payloads[0].highlightedText).toBe('1.5 QORT');
    expect(payloads[0].fee).toBe(FEE);
    expect(sendCoinFunc).toHaveBeenCalledWith(
      { amount: 1.5, password: null, receiver: ACCOUNT_A, approvedFee: FEE },
      true
    );
  });

  it('pays an address as given, with a number amount', async () => {
    stubBalance(100);
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, outcome: 'sent', data: { signature: 'SIG' } },
      validApi: null,
    });

    await sendCoin(
      { coin: 'QORT', amount: 2, destinationAddress: ACCOUNT_C },
      false,
      OPENED_APP
    );

    expect(payloads[0].text2).toBe(
      `question:to_recipient ${JSON.stringify({ recipient: ACCOUNT_C })}`
    );
    expect(payloads[0].highlightedText).toBe('2 QORT');
    expect(sendCoinFunc).toHaveBeenCalledWith(
      { amount: 2, password: null, receiver: ACCOUNT_C, approvedFee: FEE },
      true
    );
  });

  it.each(['1e3', '0x10', 'Infinity', '-1', '0.000000001'])(
    'refuses the amount %j before asking',
    async (amount) => {
      const fetchMock = stubBalance(100);
      const payloads = answerPrompts({ accepted: true });
      await expect(
        sendCoin(
          { coin: 'QORT', amount, recipient: 'Recipient B' },
          false,
          OPENED_APP
        )
      ).rejects.toThrow('core:message.error.invalid_amount');
      expect(payloads).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sendCoinFunc).not.toHaveBeenCalled();
    }
  );

  it('takes String(x) as it takes the number x, rounded to 8 places', async () => {
    stubBalance(100);
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, outcome: 'sent', data: { signature: 'SIG' } },
      validApi: null,
    });
    const amount = 0.1 + 0.2; // 0.30000000000000004

    for (const sent of [amount, String(amount)]) {
      await expect(
        sendCoin(
          { coin: 'QORT', amount: sent, recipient: 'Recipient B' },
          false,
          OPENED_APP
        )
      ).resolves.toEqual({ signature: 'SIG' });
    }
    expect(payloads.map((payload) => payload.highlightedText)).toEqual([
      '0.3 QORT',
      '0.3 QORT',
    ]);
    expect(
      vi.mocked(sendCoinFunc).mock.calls.map(([call]) => call.amount)
    ).toEqual([0.3, 0.3]);
  });

  it('resolves the name before asking, so a name that does not resolve never reaches the dialog', async () => {
    stubBalance(100);
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(resolveRecipient).mockRejectedValueOnce(
      new Error('auth:message.error.name_not_existing')
    );
    await expect(
      sendCoin(
        { coin: 'QORT', amount: 1, recipient: 'Recipient X' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('auth:message.error.name_not_existing');
    expect(payloads).toHaveLength(0);
    expect(sendCoinFunc).not.toHaveBeenCalled();
  });

  it('refuses a node fee above the ceiling before asking', async () => {
    stubBalance(100);
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(sendQortFee).mockResolvedValue('5.00000000' as unknown as number);
    await expect(
      sendCoin(
        { coin: 'QORT', amount: 1, recipient: 'Recipient B' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('question:message.error.fee_above_limit');
    expect(payloads).toHaveLength(0);
    expect(sendCoinFunc).not.toHaveBeenCalled();
  });

  // background.ts sendCoin reports `sent` only when the node's answer
  // carries the payment's signature.
  it("rejects with the node's reason when it refuses the payment", async () => {
    stubBalance(100);
    answerPrompts({ accepted: true });
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: {
        success: false,
        outcome: 'refused',
        data: {
          error: 312,
          message: 'transaction invalid: insufficient balance (NO_BALANCE)',
        },
      },
      validApi: null,
    });
    const error = await sendCoin(
      { coin: 'QORT', amount: '1', recipient: ACCOUNT_A },
      false,
      OPENED_APP
    ).catch((rejected) => rejected);
    expect(error).toBeInstanceOf(Error);
    expect(serializeQortalRequestError(error)).toEqual({
      error: 'transaction invalid: insufficient balance (NO_BALANCE)',
      message: 'transaction invalid: insufficient balance (NO_BALANCE)',
    });
  });

  it('rejects with PAYMENT_OUTCOME_UNKNOWN when the answer does not say whether the payment went through', async () => {
    stubBalance(100);
    answerPrompts({ accepted: true });
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: {
        success: false,
        outcome: 'unknown',
        data: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      },
      validApi: null,
    });
    const error = await sendCoin(
      { coin: 'QORT', amount: '1', recipient: ACCOUNT_A },
      false,
      OPENED_APP
    ).catch((rejected) => rejected);
    expect(error).toBeInstanceOf(Error);
    // What the Q-App gets back (qortal-requests.ts serializes it).
    expect(serializeQortalRequestError(error)).toEqual({
      error: 'PAYMENT_OUTCOME_UNKNOWN',
      code: 'PAYMENT_OUTCOME_UNKNOWN',
      message: 'question:message.error.payment_outcome_unknown',
    });
    expect(sendCoinFunc).toHaveBeenCalledTimes(1);
  });

  it('leaves a foreign coin "send max" request as it was', async () => {
    vi.mocked(sendLocalForeignCoin).mockResolvedValue('LTC_TX');
    await expect(
      sendCoin(
        { coin: 'LTC', sendMax: true, recipient: 'ltc-receiver' },
        false,
        OPENED_APP
      )
    ).resolves.toBe('LTC_TX');
    expect(sendLocalForeignCoin).toHaveBeenCalledTimes(1);
    expect(resolveRecipient).not.toHaveBeenCalled();
  });
});

// ── TRANSFER_ASSET ───────────────────────────────────────────────────────────

describe('TRANSFER_ASSET', () => {
  it('shows the asset, the name and full address and the amount as signed, and transfers to that address with the fee it showed', async () => {
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(transferAsset).mockResolvedValue({ signature: 'SIG' });

    await expect(
      transferAssetRequest(
        { amount: '2.50', assetId: '5', recipient: 'Recipient B' },
        false,
        OPENED_APP
      )
    ).resolves.toEqual({ signature: 'SIG' });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].text2).toContain('TESTASSET');
    expect(payloads[0].text3).toContain('question:to_recipient');
    expect(payloads[0].text3).toContain('Recipient B');
    expect(payloads[0].text3).toContain(ACCOUNT_A);
    expect(payloads[0].highlightedText).toContain('"quantity":"2.5"');
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(getAssetBalanceInfo).toHaveBeenCalledWith(5);
    expect(transferAsset).toHaveBeenCalledWith({
      amount: 2.5,
      recipient: ACCOUNT_A,
      assetId: 5,
      approvedFee: FEE,
    });
  });

  it('asks for "I have read this request", and transfers nothing when declined', async () => {
    const payloads = answerPrompts({ accepted: false });

    await expect(
      transferAssetRequest(
        { amount: '2.50', assetId: '5', recipient: 'Recipient B' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('question:message.generic.user_declined_request');

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(transferAsset).not.toHaveBeenCalled();
  });

  it('transfers 100000000 units, an amount the builder signs exactly', async () => {
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(getAssetBalanceInfo).mockResolvedValue('10000000000.00000000');
    vi.mocked(transferAsset).mockResolvedValue({ signature: 'SIG' });

    await expect(
      transferAssetRequest(
        { amount: '100000000', assetId: 5, recipient: 'Recipient B' },
        false,
        OPENED_APP
      )
    ).resolves.toEqual({ signature: 'SIG' });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].highlightedText).toContain('"quantity":"100000000"');
    expect(transferAsset).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100000000 })
    );
  });

  it.each([
    [{ amount: '0x10', assetId: 0, recipient: 'Recipient B' }],
    [{ amount: '1e3', assetId: 0, recipient: 'Recipient B' }],
    [{ amount: '90071992.54740993', assetId: 0, recipient: 'Recipient B' }],
    [{ amount: 1, assetId: 'abc', recipient: 'Recipient B' }],
    [{ amount: 1, assetId: 1.5, recipient: 'Recipient B' }],
    [{ amount: 1, assetId: -1, recipient: 'Recipient B' }],
  ])('refuses %j before asking or asking the node', async (data) => {
    const payloads = answerPrompts({ accepted: true });
    await expect(transferAssetRequest(data, false, OPENED_APP)).rejects.toThrow(
      /core:message\.error\.invalid_amount|question:message\.error\.invalid_asset_id/
    );
    expect(payloads).toHaveLength(0);
    expect(getFee).not.toHaveBeenCalled();
    expect(getAssetBalanceInfo).not.toHaveBeenCalled();
    expect(transferAsset).not.toHaveBeenCalled();
  });

  // [the amount, the balance, whether it funds the amount]
  const transferBalances: [string, string, boolean][] = [
    ['2.5', '2.50000000', true],
    ['2.5', '900.00000000', true],
    ['2.5', '2.49999999', false],
    ['2.5', '0.00000000', false],
    ['0.00000001', '0.00000001', true],
    ['0.00000002', '0.00000001', false],
    // Above 2^53 of the smallest unit, where a float no longer holds each one.
    ['100000000.1', '100000000.10000001', true],
    ['100000000.1', '100000000.09999999', false],
  ];

  it.each(transferBalances)(
    'reads an amount of %s against a balance of %s to the last digit',
    async (amount, balance, funded) => {
      const payloads = answerPrompts({ accepted: true });
      stubAssetBalances([assetBalanceRow(balance)]);
      vi.mocked(transferAsset).mockResolvedValue({ signature: 'SIG' });
      const outcome = await transferAssetRequest(
        { amount, assetId: 5, recipient: 'Recipient B' },
        false,
        OPENED_APP
      ).catch((error: Error) => error.message);

      expect(outcome).toEqual(
        funded
          ? { signature: 'SIG' }
          : 'question:message.error.insufficient_balance'
      );
      expect(payloads).toHaveLength(funded ? 1 : 0);
      expect(transferAsset).toHaveBeenCalledTimes(funded ? 1 : 0);
    }
  );

  it.each(unreadableAssetBalances)(
    'is refused when the asset balance cannot be read, before asking: %s',
    async (_label, body) => {
      const payloads = answerPrompts({ accepted: true });
      stubAssetBalances(body);

      await expect(
        transferAssetRequest(
          { amount: '2.5', assetId: 5, recipient: 'Recipient B' },
          false,
          OPENED_APP
        )
      ).rejects.toThrow(/^question:message\.error\.insufficient_balance$/);

      expect(payloads).toHaveLength(0);
      expect(transferAsset).not.toHaveBeenCalled();
    }
  );

  it('never shows a recipient that does not resolve', async () => {
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(resolveRecipient).mockRejectedValueOnce(
      new Error('question:message.error.invalid_receiver')
    );
    await expect(
      transferAssetRequest(
        { amount: 1, assetId: 0, recipient: 'Recipient X' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('question:message.error.invalid_receiver');
    expect(payloads).toHaveLength(0);
    expect(transferAsset).not.toHaveBeenCalled();
  });

  it('accepts a send that spends the balance exactly, plus its fee', async () => {
    // 0.28 + 0.01 fee against exactly 0.29 QORT. The old check scaled the
    // balance through toFixed(0) but left `Number(amount) * 1e8` unrounded, so
    // the sum came out one float ulp over the balance and the send was refused
    // as insufficient.
    stubBalance('0.29000000');
    vi.mocked(sendQortFee).mockResolvedValue('0.01000000');
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, outcome: 'sent', data: { signature: 'SIG' } },
      validApi: null,
    });
    const payloads = answerPrompts({ accepted: true });

    await sendCoin(
      { coin: 'QORT', amount: '0.28', destinationAddress: ACCOUNT_C },
      false,
      OPENED_APP
    );

    expect(payloads).toHaveLength(1);
    expect(sendCoinFunc).toHaveBeenCalledTimes(1);
  });

  it('still refuses a send one unit past the balance', async () => {
    // The boundary above must not have been loosened into "never refuse".
    stubBalance('0.29000000');
    vi.mocked(sendQortFee).mockResolvedValue('0.01000000');
    const payloads = answerPrompts({ accepted: true });

    await expect(
      sendCoin(
        { coin: 'QORT', amount: '0.29', destinationAddress: ACCOUNT_C },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('question:message.error.insufficient_funds');

    expect(payloads).toHaveLength(0);
    expect(sendCoinFunc).not.toHaveBeenCalled();
  });

  it('refuses a node fee above the ceiling before asking', async () => {
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: '3.00000000' });
    await expect(
      transferAssetRequest(
        { amount: 1, assetId: 0, recipient: 'Recipient B' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('question:message.error.fee_above_limit');
    expect(payloads).toHaveLength(0);
    expect(transferAsset).not.toHaveBeenCalled();
  });
});

// ── MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA ───────────────────────────────────

describe('DEPLOY_AT amount', () => {
  it('parses the amount before showing it, so the box shows what the AT is funded with', async () => {
    // The dialog renders `amount` verbatim, while DeployAtTransaction does
    // Math.round(rAmount * 1e8). Passing the raw request value let '1e3' read as
    // "1e3 QORT" in the box the user ticks, then fund the AT with 1000 QORT.
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
    const payloads = answerPrompts({ accepted: false });

    await expect(
      deployAt(
        {
          name: 'at',
          description: 'd',
          tags: 't',
          creationBytes: 'BYTES',
          amount: '1e3',
          assetId: 0,
          type: 'CODE',
        },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(/invalid_amount/i);

    expect(payloads).toHaveLength(0);
  });
});

describe('MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA', () => {
  const request = {
    assetId: 0,
    payments: [
      {
        recipient: 'Recipient B',
        amount: 1,
        arbitraryTxs: [
          { service: 'DOCUMENT_PRIVATE', identifier: 'b', base64: 'QQ==' },
        ],
      },
      {
        recipient: 'Recipient D',
        amount: '2.25',
        arbitraryTxs: [
          { service: 'DOCUMENT_PRIVATE', identifier: 'd', base64: 'Qg==' },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(getNameInfo).mockResolvedValue('Publisher');
    vi.mocked(isValidBase64WithDecode).mockReturnValue(true);
    vi.mocked(getPublicKey).mockResolvedValue('RECIPIENT_PUBLIC_KEY');
    vi.mocked(objectToBase64).mockResolvedValue('BASE64');
    vi.mocked(encryptDataGroup).mockReturnValue('ENCRYPTED');
    vi.mocked(publishData).mockResolvedValue({ signature: 'PUBLISH_SIG' });
  });

  it('shows each recipient as name and address with the amounts as signed, and pays each with the fee it showed', async () => {
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(transferAsset)
      .mockResolvedValueOnce({ signature: 'PAY_1' })
      .mockResolvedValueOnce({ signature: 'PAY_2' });

    await expect(
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    ).resolves.toEqual(['PAY_1', 'PUBLISH_SIG', 'PAY_2', 'PUBLISH_SIG']);

    const { payments } = payloads[0].details;
    expect(payments).toHaveLength(2);
    expect(payments[0].recipientAddress).toContain('Recipient B');
    expect(payments[0].recipientAddress).toContain(ACCOUNT_A);
    expect(payments[1].recipientAddress).toContain('Recipient D');
    expect(payments[1].recipientAddress).toContain(ACCOUNT_C);
    expect(payments[0].amount).toBe('1');
    expect(payments[1].amount).toBe('2.25');
    expect(payloads[0].highlightedText).toBe(
      `question:total_amount ${JSON.stringify({ amount: '3.25' })}`
    );
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(getPublicKey).toHaveBeenNthCalledWith(1, ACCOUNT_A);
    expect(getPublicKey).toHaveBeenNthCalledWith(2, ACCOUNT_C);
    expect(transferAsset).toHaveBeenNthCalledWith(1, {
      amount: 1,
      assetId: 0,
      recipient: ACCOUNT_A,
      approvedFee: FEE,
    });
    expect(transferAsset).toHaveBeenNthCalledWith(2, {
      amount: 2.25,
      assetId: 0,
      recipient: ACCOUNT_C,
      approvedFee: FEE,
    });
  });

  it('asks for "I have read this request", and pays and publishes nothing when declined', async () => {
    const payloads = answerPrompts({ accepted: false });

    await expect(
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    ).rejects.toThrow('question:message.generic.user_declined_request');

    expect(payloads).toHaveLength(1);
    expect(payloads[0].confirmCheckbox).toBe(true);
    expect(transferAsset).not.toHaveBeenCalled();
    expect(publishData).not.toHaveBeenCalled();
  });

  it('sends a transfer of a large amount it showed, as background transferAsset reads it', async () => {
    const payloads = answerPrompts({ accepted: true });
    // background transferAsset parses the amount it is given again.
    vi.mocked(transferAsset).mockImplementation(async ({ amount }) => {
      parseDecimalAmount(amount);
      return { signature: 'PAY' };
    });
    // This case is about a large amount surviving the round trip, so the balance
    // must fund it.
    vi.mocked(getAssetBalanceInfo).mockResolvedValue('200000000.00000000');
    const large = {
      ...request,
      assetId: 5,
      payments: [
        request.payments[0],
        { ...request.payments[1], amount: '100000000.1' },
      ],
    };

    await expect(
      multiPaymentWithPrivateData(large, false, OPENED_APP)
    ).resolves.toEqual(['PAY', 'PUBLISH_SIG', 'PAY', 'PUBLISH_SIG']);
    expect(payloads[0].details.payments[1].amount).toBe('100000000.1');
  });

  it('calls each transfer once and reports the payments already sent when a later one fails', async () => {
    answerPrompts({ accepted: true });
    vi.mocked(transferAsset).mockImplementation(async ({ recipient }) => {
      if (recipient === ACCOUNT_A) return { signature: 'PAY_1' };
      throw new Error('node unreachable');
    });

    await expect(
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    ).rejects.toThrow(
      `question:message.error.payments_partially_sent ${JSON.stringify({
        sent: 1,
        total: 2,
        error: 'node unreachable',
      })}`
    );
    expect(transferAsset).toHaveBeenCalledTimes(2);
  });

  // The request totals 3.25 units (1 + 2.25).
  it.each(['0.00000000', '1.00000000', '3.00000000', '3.24999999'])(
    'refuses a multi-payment an asset balance of %s cannot fund, before asking',
    async (balance) => {
      const payloads = answerPrompts({ accepted: true });
      const fetchMock = stubAssetBalances([assetBalanceRow(balance)]);

      await expect(
        multiPaymentWithPrivateData(
          { ...request, assetId: 5 },
          false,
          OPENED_APP
        )
      ).rejects.toThrow(/^question:message\.error\.insufficient_balance$/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        `/assets/balances?address=${ACCOUNT_S}&assetid=5&`
      );
      expect(payloads).toHaveLength(0);
      expect(transferAsset).not.toHaveBeenCalled();
    }
  );

  it.each(['3.25000000', '3.25000001', '900.00000000'])(
    'sends a multi-payment an asset balance of %s funds',
    async (balance) => {
      const payloads = answerPrompts({ accepted: true });
      stubAssetBalances([assetBalanceRow(balance)]);
      vi.mocked(transferAsset).mockResolvedValue({ signature: 'PAY' });

      await expect(
        multiPaymentWithPrivateData(
          { ...request, assetId: 5 },
          false,
          OPENED_APP
        )
      ).resolves.toEqual(['PAY', 'PUBLISH_SIG', 'PAY', 'PUBLISH_SIG']);

      expect(payloads).toHaveLength(1);
      expect(transferAsset).toHaveBeenCalledTimes(2);
    }
  );

  // [the two amounts, the balance, whether it funds them]
  const fractionalBalances: [string, string, string, boolean][] = [
    ['0.00000001', '0.00000001', '0.00000002', true],
    ['0.00000001', '0.00000001', '0.00000001', false],
    // As floats, 0.1 + 0.2 is more than 0.3.
    ['0.1', '0.2', '0.30000000', true],
    ['0.1', '0.2', '0.29999999', false],
    // Above 2^53 of the smallest unit, where a float no longer holds each one.
    ['90071992', '0.54740993', '90071992.54740993', true],
    ['90071992', '0.54740994', '90071992.54740993', false],
    ['10000000000', '0.00000001', '10000000000.00000001', true],
    ['10000000000', '0.00000001', '10000000000.00000000', false],
  ];

  it.each(fractionalBalances)(
    'reads %s + %s against a balance of %s to the last digit',
    async (first, second, balance, funded) => {
      const payloads = answerPrompts({ accepted: true });
      stubAssetBalances([assetBalanceRow(balance)]);
      vi.mocked(transferAsset).mockResolvedValue({ signature: 'PAY' });
      const outcome = await multiPaymentWithPrivateData(
        {
          assetId: 5,
          payments: [
            { recipient: 'Recipient B', amount: first },
            { recipient: 'Recipient D', amount: second },
          ],
          additionalArbitraryTxsWithoutPayment: [
            { service: 'DOCUMENT_PRIVATE', identifier: 'all', base64: 'Qw==' },
          ],
        },
        false,
        OPENED_APP
      ).catch((error: Error) => error.message);

      expect(outcome).toEqual(
        funded
          ? ['PAY', 'PAY', 'PUBLISH_SIG']
          : 'question:message.error.insufficient_balance'
      );
      expect(payloads).toHaveLength(funded ? 1 : 0);
      expect(transferAsset).toHaveBeenCalledTimes(funded ? 2 : 0);
    }
  );

  it.each(unreadableAssetBalances)(
    'refuses a multi-payment when the asset balance cannot be read, before asking: %s',
    async (_label, body) => {
      const payloads = answerPrompts({ accepted: true });
      stubAssetBalances(body);

      await expect(
        multiPaymentWithPrivateData(
          { ...request, assetId: 5 },
          false,
          OPENED_APP
        )
      ).rejects.toThrow(/^question:message\.error\.insufficient_balance$/);

      expect(payloads).toHaveLength(0);
      expect(transferAsset).not.toHaveBeenCalled();
    }
  );

  it('passes the first failure through when nothing was sent', async () => {
    answerPrompts({ accepted: true });
    vi.mocked(transferAsset).mockRejectedValue(new Error('NO_BALANCE'));

    await expect(
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    ).rejects.toThrow(/^NO_BALANCE$/);
    expect(transferAsset).toHaveBeenCalledTimes(1);
    expect(publishData).not.toHaveBeenCalled();
  });

  it('does not try a failed transfer again', async () => {
    answerPrompts({ accepted: true });
    vi.mocked(transferAsset)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ signature: 'PAY_1' });

    const outcome = await withFakeTimers(() =>
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    );

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('Failed to fetch');
    expect(transferAsset).toHaveBeenCalledTimes(1);
    expect(publishData).not.toHaveBeenCalled();
  });

  it('says how many payments went through when the private data of a sent payment fails', async () => {
    answerPrompts({ accepted: true });
    // The private data is published with retries, each one logged.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    vi.mocked(transferAsset).mockResolvedValue({ signature: 'PAY_1' });
    vi.mocked(publishData).mockRejectedValue(new Error('publish failed'));

    const outcome = await withFakeTimers(() =>
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    );

    expect((outcome as Error).message).toBe(
      `question:message.error.payments_partially_sent ${JSON.stringify({
        sent: 1,
        total: 2,
        error: 'publish failed',
      })}`
    );
    expect(transferAsset).toHaveBeenCalledTimes(1);
  });

  // [what fails, the request, the publishes that go through before it]
  const lastPublishFails: [string, Record<string, unknown>, number][] = [
    ["the last payment's private data", request, 1],
    [
      'the data published without a payment',
      {
        ...request,
        additionalArbitraryTxsWithoutPayment: [
          { service: 'DOCUMENT_PRIVATE', identifier: 'all', base64: 'Qw==' },
        ],
      },
      2,
    ],
  ];

  it.each(lastPublishFails)(
    'says both payments went through when %s fails after them',
    async (_label, data, publishesBefore) => {
      answerPrompts({ accepted: true });
      // The private data is published with retries, each one logged.
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      onTestFinished(() => quiet.mockRestore());
      vi.mocked(transferAsset)
        .mockResolvedValueOnce({ signature: 'PAY_1' })
        .mockResolvedValueOnce({ signature: 'PAY_2' });
      for (let i = 0; i < publishesBefore; i++) {
        vi.mocked(publishData).mockResolvedValueOnce({
          signature: 'PUBLISH_SIG',
        });
      }
      vi.mocked(publishData).mockRejectedValue(new Error('publish failed'));

      const outcome = await withFakeTimers(() =>
        multiPaymentWithPrivateData(data, false, OPENED_APP)
      );

      expect((outcome as Error).message).toBe(
        `question:message.error.payments_partially_sent ${JSON.stringify({
          sent: 2,
          total: 2,
          error: 'publish failed',
        })}`
      );
      expect(transferAsset).toHaveBeenCalledTimes(2);
    }
  );

  it('says in English how many went through, then why the next one was not signed', async () => {
    await useEnglish();
    answerPrompts({ accepted: true });
    // The second transfer's node fee rose after the dialog: the real
    // transferAsset refuses it with checkValueTransferFee before signing.
    vi.mocked(transferAsset)
      .mockResolvedValueOnce({ signature: 'PAY_1' })
      .mockImplementationOnce(async ({ approvedFee }) =>
        checkValueTransferFee('0.05000000', approvedFee)
      );

    const error = await multiPaymentWithPrivateData(
      request,
      false,
      OPENED_APP
    ).then(
      () => null,
      (e: Error) => e
    );

    expect(error?.message).toBe(
      '1 of 2 payments went through before this error. Check your ' +
        'transactions before trying again. The node asked for a fee of ' +
        '0.05 QORT, more than the 0.01 QORT you approved. This payment ' +
        "wasn't signed."
    );
  });

  it('names an AT recipient as an invalid recipient, not a missing public key', async () => {
    // A MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA encrypts to the recipient's public
    // key, and an AT has none. The recipient gate accepted the AT address and the
    // very next line threw a public-key error, so the user was told their
    // recipient had a key problem rather than that an AT cannot receive a
    // private payment.
    const payloads = answerPrompts({ accepted: true });
    const atAddress = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    await expect(
      multiPaymentWithPrivateData(
        {
          ...request,
          payments: [{ ...request.payments[0], recipient: atAddress }],
        },
        false,
        OPENED_APP
      )
    ).rejects.toThrow(/invalid_receiver|recipient/i);

    expect(payloads).toHaveLength(0);
    expect(transferAsset).not.toHaveBeenCalled();
  });

  it('refuses an asset id it cannot read before asking', async () => {
    const payloads = answerPrompts({ accepted: true });
    await expect(
      multiPaymentWithPrivateData(
        { ...request, assetId: 'abc' },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('question:message.error.invalid_asset_id');
    expect(payloads).toHaveLength(0);
    expect(getAssetBalanceInfo).not.toHaveBeenCalled();
  });

  it('refuses a malformed amount before asking', async () => {
    const payloads = answerPrompts({ accepted: true });
    await expect(
      multiPaymentWithPrivateData(
        {
          ...request,
          payments: [{ ...request.payments[0], amount: '1e3' }],
        },
        false,
        OPENED_APP
      )
    ).rejects.toThrow('core:message.error.invalid_amount');
    expect(payloads).toHaveLength(0);
    expect(transferAsset).not.toHaveBeenCalled();
  });

  it('refuses a node fee above the ceiling before asking', async () => {
    const payloads = answerPrompts({ accepted: true });
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: '2.00000000' });
    await expect(
      multiPaymentWithPrivateData(request, false, OPENED_APP)
    ).rejects.toThrow('question:message.error.fee_above_limit');
    expect(payloads).toHaveLength(0);
    expect(transferAsset).not.toHaveBeenCalled();
  });
});

// ── App fee after a publish ──────────────────────────────────────────────────

describe('app fee after a publish', () => {
  const payment = { amount: 1, receiver: ACCOUNT_A, approvedFee: FEE };

  it('pays with the fee the dialog showed and says nothing when it goes through', async () => {
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: { success: true, outcome: 'sent', data: {} },
      validApi: null,
    });
    await expect(payAppFeeAfterPublish(payment)).resolves.toBeUndefined();
    expect(sendCoinFunc).toHaveBeenCalledWith(payment, true);
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('tells the user when the payment is refused, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    vi.mocked(sendCoinFunc).mockRejectedValue(new Error('fee above approved'));
    await expect(payAppFeeAfterPublish(payment)).resolves.toBeUndefined();
    expect(executeEvent).toHaveBeenCalledWith(
      'openGlobalSnackBar',
      expect.objectContaining({
        type: 'error',
        message: `question:message.error.app_fee_not_sent ${JSON.stringify({
          error: 'fee above approved',
        })}`,
      })
    );
  });

  it('tells the user when the node does not take the payment', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: {
        success: false,
        outcome: 'refused',
        data: { error: 2, message: 'NO_BALANCE' },
      },
      validApi: null,
    });
    await expect(payAppFeeAfterPublish(payment)).resolves.toBeUndefined();
    expect(executeEvent).toHaveBeenCalledWith(
      'openGlobalSnackBar',
      expect.objectContaining({
        type: 'error',
        message: `question:message.error.app_fee_not_sent ${JSON.stringify({
          error: 'NO_BALANCE',
        })}`,
      })
    );
  });

  it('tells the user to check their transactions when the answer does not say whether the fee was paid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    vi.mocked(sendCoinFunc).mockResolvedValue({
      res: {
        success: false,
        outcome: 'unknown',
        data: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      },
      validApi: null,
    });
    await expect(payAppFeeAfterPublish(payment)).resolves.toBeUndefined();
    expect(sendCoinFunc).toHaveBeenCalledTimes(1);
    expect(executeEvent).toHaveBeenCalledTimes(1);
    expect(executeEvent).toHaveBeenCalledWith(
      'openGlobalSnackBar',
      expect.objectContaining({
        type: 'warning',
        message: 'question:message.error.app_fee_outcome_unknown',
      })
    );
  });

  // The publish requests that carry an app fee, each publishing one resource
  // as Publisher, and what each returns when it goes through.
  type Publish = (fee: {
    appFee: unknown;
    appFeeRecipient: unknown;
  }) => Promise<unknown>;
  const publishes: [string, Publish, unknown][] = [
    [
      'PUBLISH_QDN_RESOURCE',
      (fee) =>
        publishQDNResource(
          {
            service: 'DOCUMENT',
            identifier: 'notes',
            name: 'Publisher',
            data64: 'QQ==',
            ...fee,
          },
          null,
          false,
          OPENED_APP
        ),
      { signature: 'PUBLISH_SIG' },
    ],
    [
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      (fee) =>
        publishMultipleQDNResources(
          {
            resources: [
              { service: 'DOCUMENT', identifier: 'notes', data64: 'QQ==' },
            ],
            ...fee,
          },
          null,
          false,
          OPENED_APP
        ),
      [{ signature: 'PUBLISH_SIG' }],
    ],
  ];
  const malformedAppFees = publishes.flatMap(([kind, publish]) =>
    ['0x10', '1e3', 'Infinity', '-1', '1,5'].map(
      (appFee): [string, string, Publish] => [kind, appFee, publish]
    )
  );
  // As on develop: a zero app fee, or one without a recipient, is no app fee.
  const noAppFees = publishes.flatMap(([kind, publish]) =>
    [
      { appFee: 0, appFeeRecipient: 'Recipient B' },
      { appFee: '0', appFeeRecipient: 'Recipient B' },
      { appFee: '0.00', appFeeRecipient: 'Recipient B' },
      { appFee: '0.000000001', appFeeRecipient: 'Recipient B' },
      { appFee: '', appFeeRecipient: 'Recipient B' },
      { appFee: '1.5', appFeeRecipient: undefined },
    ].map((fee): [string, Parameters<Publish>[0], Publish] => [
      kind,
      fee,
      publish,
    ])
  );

  describe('in a publish request', () => {
    beforeEach(() => {
      vi.mocked(getNameInfo).mockResolvedValue('Publisher');
      vi.mocked(getAllUserNames).mockResolvedValue(['Publisher']);
      vi.mocked(publishData).mockResolvedValue({ signature: 'PUBLISH_SIG' });
      vi.mocked(sendCoinFunc).mockResolvedValue({
        res: { success: true, outcome: 'sent', data: {} },
        validApi: null,
      });
    });

    it.each(publishes)(
      '%s names who gets the app fee, then pays that address the amount shown with the fee it checked',
      async (_kind, publish, published) => {
        const payloads = answerPrompts({ accepted: true, checkbox1: true });

        await expect(
          withFakeTimers(() =>
            publish({ appFee: '1.50', appFeeRecipient: 'Recipient B' })
          )
        ).resolves.toEqual(published);

        expect(resolveRecipient).toHaveBeenCalledWith('Recipient B');
        expect(payloads).toHaveLength(1);
        expect(payloads[0].appFee).toBe('1.51');
        expect(payloads[0].checkbox1.label).toBe(
          `question:accept_app_fee_to ${JSON.stringify({
            recipient: `question:recipient_name_address ${JSON.stringify({
              name: 'Recipient B',
              address: ACCOUNT_A,
            })}`,
          })}`
        );
        expect(payloads[0].confirmCheckbox).toBe(true);
        expect(sendCoinFunc).toHaveBeenCalledTimes(1);
        expect(sendCoinFunc).toHaveBeenCalledWith(
          { amount: 1.5, receiver: ACCOUNT_A, approvedFee: FEE },
          true
        );
      }
    );

    it.each(publishes)(
      '%s asks for "I have read this request" with an app fee, and publishes and pays nothing when declined',
      async (_kind, publish) => {
        const payloads = answerPrompts({ accepted: false });

        await expect(
          publish({ appFee: '1.50', appFeeRecipient: 'Recipient B' })
        ).rejects.toThrow('question:message.generic.user_declined_request');

        expect(payloads).toHaveLength(1);
        expect(payloads[0].appFee).toBe('1.51');
        expect(payloads[0].confirmCheckbox).toBe(true);
        expect(publishData).not.toHaveBeenCalled();
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );

    it.each(malformedAppFees)(
      '%s refuses the app fee %j before asking',
      async (_kind, appFee, publish) => {
        const payloads = answerPrompts({ accepted: true, checkbox1: true });
        await expect(
          publish({ appFee, appFeeRecipient: 'Recipient B' })
        ).rejects.toThrow('core:message.error.invalid_amount');
        expect(payloads).toHaveLength(0);
        expect(publishData).not.toHaveBeenCalled();
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );

    it.each(noAppFees)(
      '%s publishes %j without an app fee',
      async (_kind, fee, publish) => {
        const payloads = answerPrompts({ accepted: true, checkbox1: true });
        await withFakeTimers(() => publish(fee));
        expect(payloads).toHaveLength(1);
        expect(payloads[0].appFee).toBeUndefined();
        expect(payloads[0].checkbox1).toBeUndefined();
        expect(payloads[0].confirmCheckbox).toBeUndefined();
        expect(publishData).toHaveBeenCalled();
        expect(resolveRecipient).not.toHaveBeenCalled();
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );

    it.each(publishes)(
      '%s publishes without paying the app fee when its box is unticked',
      async (_kind, publish) => {
        const payloads = answerPrompts({ accepted: true, checkbox1: false });
        await withFakeTimers(() =>
          publish({ appFee: '1.5', appFeeRecipient: 'Recipient B' })
        );
        expect(payloads[0].appFee).toBe('1.51');
        expect(publishData).toHaveBeenCalledTimes(1);
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );

    it.each(publishes)(
      '%s passes the fee it showed to publishData, so signing uses it',
      async (_kind, publish) => {
        // Without `feeAmount` publishData re-reads the ARBITRARY fee at signing
        // time and the amount the user approved is discarded. `?fee=` takes
        // atomic units, and getFee answers decimal text, so the value passed
        // must be the atomic form of FEE ('0.01000000' -> 1000000).
        const payloads = answerPrompts({ accepted: true });

        await withFakeTimers(() => publish({}));

        expect(payloads).toHaveLength(1);
        expect(publishData).toHaveBeenCalledWith(
          expect.objectContaining({ feeAmount: 1000000 })
        );
      }
    );

    it.each(publishes)(
      '%s still shows the app fee when the tab already holds the publish grant',
      async (_kind, publish) => {
        // A session grant covers the publish. It does not cover the app fee,
        // which is a separate amount of QORT leaving the wallet that the user
        // has never been shown. Skipping the dialog on a grant meant the fee was
        // never displayed AND `checkbox1` stayed false, so the branch that pays
        // the app fee was skipped too: the app was silently never paid.
        vi.mocked(hasSessionPermission).mockReturnValue(true);
        const payloads = answerPrompts({ accepted: true, checkbox1: true });

        await withFakeTimers(() =>
          publish({ appFee: '1.50', appFeeRecipient: 'Recipient B' })
        );

        expect(payloads).toHaveLength(1);
        expect(payloads[0].appFee).toBe('1.51');
        expect(payloads[0].confirmCheckbox).toBe(true);
        expect(sendCoinFunc).toHaveBeenCalledTimes(1);
        expect(sendCoinFunc).toHaveBeenCalledWith(
          { amount: 1.5, receiver: ACCOUNT_A, approvedFee: FEE },
          true
        );
      }
    );

    it.each(publishes)(
      '%s still skips the dialog on a grant when there is no app fee',
      async (_kind, publish) => {
        // The grant is still honoured for a plain publish: nothing leaves the
        // wallet, so there is nothing new to show.
        vi.mocked(hasSessionPermission).mockReturnValue(true);
        const payloads = answerPrompts({ accepted: true });

        await withFakeTimers(() => publish({}));

        expect(payloads).toHaveLength(0);
        expect(publishData).toHaveBeenCalledTimes(1);
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );

    it('PUBLISH_MULTIPLE_QDN_RESOURCES counts the app fee and its fee in the balance it needs', async () => {
      const payloads = answerPrompts({ accepted: true, checkbox1: true });
      // 0.01 to publish, 1.5 app fee and 0.01 to pay it: 1.52 needed.
      vi.mocked(getBalanceInfo).mockResolvedValue(1.51);
      const outcome = await withFakeTimers(() =>
        publishes[1][1]({ appFee: '1.5', appFeeRecipient: 'Recipient B' })
      );
      expect((outcome as Error).message).toBe(
        'question:message.error.insufficient_balance_qort'
      );
      expect(payloads).toHaveLength(0);
      expect(publishData).not.toHaveBeenCalled();
    });

    it.each(publishes)(
      '%s refuses an app fee recipient that does not resolve, before asking',
      async (_kind, publish) => {
        const payloads = answerPrompts({ accepted: true, checkbox1: true });
        vi.mocked(resolveRecipient).mockRejectedValue(
          new Error('auth:message.error.name_not_existing')
        );
        await expect(
          publish({ appFee: 1, appFeeRecipient: 'Recipient X' })
        ).rejects.toThrow('auth:message.error.name_not_existing');
        expect(payloads).toHaveLength(0);
        expect(publishData).not.toHaveBeenCalled();
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );

    it.each(publishes)(
      '%s refuses a PAYMENT fee above the ceiling before asking',
      async (_kind, publish) => {
        const payloads = answerPrompts({ accepted: true, checkbox1: true });
        vi.mocked(getFee).mockImplementation(async (type: string) => ({
          timestamp: 1,
          fee: type === 'PAYMENT' ? '5.00000000' : FEE,
        }));
        await expect(
          publish({ appFee: 1, appFeeRecipient: ACCOUNT_A })
        ).rejects.toThrow('question:message.error.fee_above_limit');
        expect(payloads).toHaveLength(0);
        expect(publishData).not.toHaveBeenCalled();
        expect(sendCoinFunc).not.toHaveBeenCalled();
      }
    );
  });
});

// ── Names with invisible characters ─────────────────────────────────────────

describe('a recipient name with invisible characters', () => {
  // The node would answer that Account-X owns each of these names.
  const invisibleNames = [
    ['a braille blank (U+2800)', 'Recipient B\u2800'],
    ['a zero-width space (U+200B)', 'Recipient\u200B B'],
  ];

  beforeEach(() => {
    vi.mocked(resolveRecipient).mockImplementation(realResolveRecipient);
    vi.mocked(getNameInfo).mockResolvedValue('Publisher');
    vi.mocked(isValidBase64WithDecode).mockReturnValue(true);
    vi.mocked(getPublicKey).mockResolvedValue('RECIPIENT_PUBLIC_KEY');
  });

  it.each(invisibleNames)(
    'is refused by SEND_COIN before asking: %s',
    async (_label, name) => {
      const fetchMock = stubNodeWithNamesOf(ACCOUNT_X);
      const payloads = answerPrompts({ accepted: true });
      await expect(
        sendCoin(
          { coin: 'QORT', amount: 1, recipient: name },
          false,
          OPENED_APP
        )
      ).rejects.toThrow(
        'question:message.error.recipient_invisible_characters'
      );
      expect(payloads).toHaveLength(0);
      expect(nameLookups(fetchMock)).toEqual([]);
      expect(sendCoinFunc).not.toHaveBeenCalled();
    }
  );

  it.each(invisibleNames)(
    'is refused by TRANSFER_ASSET before asking: %s',
    async (_label, name) => {
      const fetchMock = stubNodeWithNamesOf(ACCOUNT_X);
      const payloads = answerPrompts({ accepted: true });
      await expect(
        transferAssetRequest(
          { amount: 1, assetId: 0, recipient: name },
          false,
          OPENED_APP
        )
      ).rejects.toThrow(
        'question:message.error.recipient_invisible_characters'
      );
      expect(payloads).toHaveLength(0);
      expect(nameLookups(fetchMock)).toEqual([]);
      expect(transferAsset).not.toHaveBeenCalled();
    }
  );

  it.each(invisibleNames)(
    'is refused by a multi-payment before asking, also after a payment to an address: %s',
    async (_label, name) => {
      const fetchMock = stubNodeWithNamesOf(ACCOUNT_X);
      const payloads = answerPrompts({ accepted: true });
      const arbitraryTxs = [
        { service: 'DOCUMENT_PRIVATE', identifier: 'b', base64: 'QQ==' },
      ];
      await expect(
        multiPaymentWithPrivateData(
          {
            assetId: 0,
            payments: [
              { recipient: ACCOUNT_A, amount: 1, arbitraryTxs },
              { recipient: name, amount: 2, arbitraryTxs },
            ],
          },
          false,
          OPENED_APP
        )
      ).rejects.toThrow(
        'question:message.error.recipient_invisible_characters'
      );
      expect(payloads).toHaveLength(0);
      expect(nameLookups(fetchMock)).toEqual([]);
      expect(transferAsset).not.toHaveBeenCalled();
      expect(publishData).not.toHaveBeenCalled();
    }
  );

  it.each(invisibleNames)(
    'is refused as the app fee recipient before asking: %s',
    async (_label, name) => {
      const fetchMock = stubNodeWithNamesOf(ACCOUNT_X);
      const payloads = answerPrompts({ accepted: true, checkbox1: true });
      await expect(
        publishQDNResource(
          {
            service: 'DOCUMENT',
            identifier: 'notes',
            name: 'Publisher',
            data64: 'QQ==',
            appFee: 1,
            appFeeRecipient: name,
          },
          null,
          false,
          OPENED_APP
        )
      ).rejects.toThrow(
        'question:message.error.recipient_invisible_characters'
      );
      expect(payloads).toHaveLength(0);
      expect(nameLookups(fetchMock)).toEqual([]);
      expect(publishData).not.toHaveBeenCalled();
      expect(sendCoinFunc).not.toHaveBeenCalled();
    }
  );
});
