import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../pirate-wallet-initialization', () => ({ ensurePirateWalletInitialization: vi.fn(async () => {}) }));

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

import { getWalletBalance } from '../get';
import {
  createEndpoint,
  getKeyPair,
  getSaveWallet,
} from '../../background/background';
import { isRunningGateway } from '../qortal-requests';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'Q-fixture' } as any);
  vi.mocked(getKeyPair).mockResolvedValue({
    arrrSeed58: 'synthetic-fixture-entropy',
  } as any);
  vi.mocked(createEndpoint).mockImplementation(
    async (path) => `http://core.test${path}`
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ARRR spendable balance option', () => {
  it.each([true, false, undefined, 'true'])(
    'only explicit verified=true requests spendable funds (%s)',
    async (verified) => {
      const endpoint = `http://core.test/crosschain/arrr/walletbalance${verified === true ? '?verified=true' : ''}`;
      const fetch = vi.fn(
        async (url: string) =>
          new Response(
            url.endsWith('/syncstatus')
              ? JSON.stringify('Synchronized')
              : '75000000',
            { status: 200 }
          )
      );
      vi.stubGlobal('fetch', fetch);
      const result = await getWalletBalance({ coin: 'ARRR', verified }, true);
      expect(result).toBe('0.75000000');
      expect(createEndpoint).toHaveBeenCalledWith(
        endpoint.replace('http://core.test', '')
      );
      expect(fetch).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({
          method: 'POST',
          body: 'synthetic-fixture-entropy',
        })
      );
      expect(result).not.toContain('entropy');
    }
  );
});
