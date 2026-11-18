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

vi.mock('../monero-wallet', async (original) => ({
  ...(await original<any>()),
  getMoneroPublicWallet: vi.fn(),
}));
vi.mock('../monero-operations', () => ({
  getMoneroWalletInfo: vi.fn(),
  readMoneroWallet: vi.fn(),
  sendMoneroPayment: vi.fn(),
}));
import {
  getMoneroWalletInfo,
  readMoneroWallet,
  sendMoneroPayment,
} from '../monero-operations';
import {
  getUserWallet,
  getWalletBalance,
  getUserWalletInfo,
  getUserWalletTransactions,
  sendCoin,
} from '../get';
import { getKeyPair, getSaveWallet } from '../../background/background';
import { getMoneroPublicWallet } from '../monero-wallet';
import {
  getPermission,
  hasSessionPermission,
  isRunningGateway,
} from '../qortal-requests';

const appInfo = { name: 'xmr-fixture-app', tabId: 'xmr-fixture-tab' };
const publicWallet = {
  address: 'public-test-address',
  network: 'stagenet',
  derivationVersion: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(getMoneroPublicWallet).mockResolvedValue(publicWallet as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['balance', getWalletBalance],
  ['wallet info', getUserWalletInfo],
  ['transactions', getUserWalletTransactions],
  ['send', sendCoin],
])(
  'rejects unsupported MONERO alias for %s before legacy access',
  async (_name, operation) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      (operation as any)(
        { coin: 'MONERO', amount: '1', recipient: 'fixture' },
        false,
        appInfo
      )
    ).rejects.toThrow('question:message.error.token_not_supported');
    expect(getKeyPair).not.toHaveBeenCalled();
    expect(getSaveWallet).not.toHaveBeenCalled();
    expect(getPermission).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('uses the existing remembered XMR permission before calling the public projection', async () => {
  vi.mocked(getPermission).mockResolvedValue(true);
  expect(
    await getUserWallet({ coin: 'XMR', network: 'mainnet' }, false, appInfo)
  ).toEqual(publicWallet);
  expect(getPermission).toHaveBeenCalledWith(
    'qAPPAutoGetUserWallet-xmr-fixture-app-XMR'
  );
  expect(getMoneroPublicWallet).toHaveBeenCalledOnce();
  expect(getMoneroPublicWallet).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Number)
  );
});

it('uses the existing app session wallet permission', async () => {
  vi.mocked(getPermission).mockResolvedValue(false);
  vi.mocked(hasSessionPermission).mockReturnValue(true);
  expect(await getUserWallet({ coin: 'XMR' }, false, appInfo)).toEqual(
    publicWallet
  );
  expect(hasSessionPermission).toHaveBeenCalledWith(
    appInfo.tabId,
    appInfo.name,
    'GET_USER_WALLET'
  );
});

it('does not read XMR keys or node mode while user permission is pending or denied', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(getPermission).mockResolvedValue(false);
    vi.mocked(hasSessionPermission).mockReturnValue(false);
    const request = getUserWallet({ coin: 'XMR' }, false, appInfo);
    const rejected = expect(request).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    expect(getMoneroPublicWallet).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await rejected;
    expect(getMoneroPublicWallet).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('routes XMR balance, info, history and send to the local engine after read permission', async () => {
  vi.mocked(getPermission).mockResolvedValue(true);
  const transactions = [{ txId: 'a'.repeat(64), amountAtomic: '1' }];
  vi.mocked(readMoneroWallet).mockResolvedValue({
    balanceAtomic: '1000000000001',
    transactions,
  } as any);
  vi.mocked(getMoneroWalletInfo).mockResolvedValue({
    initialized: true,
  } as any);
  vi.mocked(sendMoneroPayment).mockResolvedValue('a'.repeat(64));
  expect(await getWalletBalance({ coin: 'XMR' }, false, false, appInfo)).toBe(
    '1.000000000001'
  );
  expect(await getUserWalletInfo({ coin: 'XMR' }, false, appInfo)).toEqual({
    initialized: true,
  });
  expect(
    await getUserWalletTransactions({ coin: 'XMR' }, false, appInfo)
  ).toEqual(transactions);
  expect(
    await sendCoin(
      { coin: 'XMR', amount: '0.000000000001', recipient: 'fixture' },
      false
    )
  ).toBe('a'.repeat(64));
  expect(getKeyPair).not.toHaveBeenCalled();
  expect(getSaveWallet).not.toHaveBeenCalled();
});
