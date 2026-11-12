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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  addListItems,
  deleteListItems,
  getCrossChainServerInfo,
  getForeignFee,
  getListItems,
  updateForeignFee,
} from '../get';
import { getPermission, isRunningGateway } from '../qortal-requests';
import { createEndpoint } from '../../background/background';

// ── Helpers ──────────────────────────────────────────────────────────────────

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    clone() {
      return this;
    },
  });

/** Records every permission dialog a request opens. */
const watchPermissionPrompts = () => {
  const prompts: unknown[] = [];
  const listener = (event: MessageEvent) => {
    if (event.data?.action === 'QORTAL_REQUEST_PERMISSION') {
      prompts.push(event.data.payload);
    }
  };
  window.addEventListener('message', listener);
  return {
    prompts,
    stop: () => window.removeEventListener('message', listener),
  };
};

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('node paths built from Q-App requests', () => {
  let watcher: ReturnType<typeof watchPermissionPrompts>;

  beforeEach(() => {
    vi.mocked(isRunningGateway).mockResolvedValue(false);
    vi.mocked(createEndpoint).mockImplementation(
      async (path: string) => `http://localhost${path}`
    );
    watcher = watchPermissionPrompts();
  });

  afterEach(() => {
    watcher.stop();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** The request was refused before any dialog or node call. */
  const expectRefusedEarly = async (promise: Promise<unknown>, key: string) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(promise).rejects.toThrow(key);
    await nextTick();
    expect(createEndpoint).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(watcher.prompts).toEqual([]);
  };

  describe('GET_FOREIGN_FEE', () => {
    it('reads the fee from the coin and type the Q-App named', async () => {
      vi.stubGlobal('fetch', okJson(1000));

      await expect(getForeignFee({ coin: 'BTC', type: 'feekb' })).resolves.toBe(
        1000
      );
      expect(createEndpoint).toHaveBeenCalledWith('/crosschain/btc/feekb');
    });

    it('accepts chain names and any case', async () => {
      vi.stubGlobal('fetch', okJson(5));

      await getForeignFee({ coin: 'LITECOIN', type: 'FEEREQUIRED' });
      expect(createEndpoint).toHaveBeenCalledWith(
        '/crosschain/ltc/feerequired'
      );
    });

    it('refuses a type that is not a fee type', async () => {
      await expectRefusedEarly(
        getForeignFee({ coin: 'BTC', type: '../../other/path' }),
        'question:message.error.invalid_type'
      );
    });

    it('refuses a coin that is not a foreign coin', async () => {
      await expectRefusedEarly(
        getForeignFee({ coin: '../../other/path?', type: 'feekb' }),
        'question:message.error.token_not_supported'
      );
    });
  });

  describe('GET_CROSSCHAIN_SERVER_INFO', () => {
    it('reads the server list of a foreign coin', async () => {
      vi.stubGlobal('fetch', okJson({ servers: ['a'] }));

      await expect(getCrossChainServerInfo({ coin: 'LTC' })).resolves.toEqual([
        'a',
      ]);
      expect(createEndpoint).toHaveBeenCalledWith(
        '/crosschain/ltc/serverinfos'
      );
    });

    it('refuses anything else as the coin', async () => {
      await expectRefusedEarly(
        getCrossChainServerInfo({ coin: 'ltc/../../other' }),
        'question:message.error.token_not_supported'
      );
    });
  });

  describe('UPDATE_FOREIGN_FEE', () => {
    it('refuses a bad fee type before asking the user', async () => {
      await expectRefusedEarly(
        updateForeignFee(
          { coin: 'LTC', type: '/../../other/path', value: 1 },
          false
        ),
        'question:message.error.invalid_type'
      );
    });
  });

  describe('lists', () => {
    it('reads a list by its name', async () => {
      vi.mocked(getPermission).mockResolvedValue(true);
      vi.stubGlobal('fetch', okJson(['someone']));

      await expect(
        getListItems({ list_name: 'followedNames_q-tube' }, {}, false)
      ).resolves.toEqual(['someone']);
      expect(createEndpoint).toHaveBeenCalledWith(
        '/lists/followedNames_q-tube'
      );
    });

    it('encodes characters a list name may contain', async () => {
      vi.mocked(getPermission).mockResolvedValue(true);
      vi.stubGlobal('fetch', okJson([]));

      await getListItems({ list_name: 'my list?' }, {}, false);
      expect(createEndpoint).toHaveBeenCalledWith('/lists/my%20list%3F');
    });

    it.each([
      ['GET_LIST_ITEMS', () => getListItems({ list_name: '..' }, {}, false)],
      [
        'ADD_LIST_ITEMS',
        () => addListItems({ list_name: '../x', items: ['a'] }, false),
      ],
      [
        'DELETE_LIST_ITEM',
        () => deleteListItems({ list_name: 'a\\..\\b', item: 'a' }, false),
      ],
    ])('%s refuses a list name with a path in it', async (_action, run) => {
      await expectRefusedEarly(
        run(),
        'question:message.error.invalid_list_name'
      );
    });
  });
});
