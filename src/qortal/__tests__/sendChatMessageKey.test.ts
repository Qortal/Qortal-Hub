import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Q-App's SEND_CHAT_MESSAGE to a recipient encrypts the message to the
// public key the node returns for the recipient address. The key must derive
// that address. Same factories as the other get.ts tests (see ./common.ts),
// but with the real Base58, SHA-256 and utils, which the address check needs.

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
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('../../i18n/i18n', async () =>
  (await import('./common')).i18nFactory()
);
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);

import Base58Untyped from '../../encryption/Base58';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import { PublicKeyMismatchError } from '../../encryption/addressKeyCheck';
import { sendChatMessage } from '../get';
import { simulatePermission } from './common';
import {
  createEndpoint,
  getBalanceInfo,
  getKeyPair,
  performPowTask,
  signChatFunc,
} from '../../background/background';
import { createTransaction } from '../../transactions/transactions';

const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

function account(fill: number) {
  const bytes = new Uint8Array(32).fill(fill);
  return {
    publicKey: Base58.encode(bytes) as string,
    address: String(publicKeyToAddress(bytes)),
  };
}

// The recipient (Account-A) and another account (Account-B).
const accountA = account(21);
const accountB = account(22);

/** The node answers /addresses/publickey/<address> with `key` as text. */
function stubPublicKey(key: string) {
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    headers: { get: () => 'text/plain; charset=UTF-8' },
    text: async () => key,
    json: async () => key,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const keyPairBytes = Base58.encode(new Uint8Array(32).fill(1)) as string;

beforeEach(() => {
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `http://127.0.0.1:12391${path}`
  );
  vi.mocked(getBalanceInfo).mockResolvedValue(100);
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: keyPairBytes,
    publicKey: keyPairBytes,
  });
  vi.mocked(createTransaction).mockReturnValue({
    chatBytes: new Uint8Array(4),
  });
  vi.mocked(performPowTask).mockResolvedValue({
    nonce: 1,
    chatBytesArray: new Uint8Array(4),
  });
  vi.mocked(signChatFunc).mockResolvedValue({ signature: 'CHAT_SIG' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SEND_CHAT_MESSAGE to a recipient', () => {
  const request = {
    recipient: accountA.address,
    message: 'hello',
  };

  it("encrypts to the recipient's own key", async () => {
    simulatePermission(true);
    const fetchMock = stubPublicKey(accountA.publicKey);
    await expect(
      sendChatMessage(request, false, { name: 'Opened-App' })
    ).resolves.toEqual({ signature: 'CHAT_SIG' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:12391/addresses/publickey/${accountA.address}`
    );
    expect(createTransaction).toHaveBeenCalledWith(
      18,
      expect.anything(),
      expect.objectContaining({
        recipient: accountA.address,
        recipientPublicKey: accountA.publicKey,
      })
    );
  });

  it("refuses another account's key before encrypting or sending", async () => {
    simulatePermission(true);
    stubPublicKey(accountB.publicKey);
    await expect(
      sendChatMessage(request, false, { name: 'Opened-App' })
    ).rejects.toThrow(PublicKeyMismatchError);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(performPowTask).not.toHaveBeenCalled();
    expect(signChatFunc).not.toHaveBeenCalled();
  });

  it('says the recipient has no public key on chain when the node answers "false"', async () => {
    simulatePermission(true);
    // Core's text answer for an account with no key on chain.
    stubPublicKey('false');
    await expect(
      sendChatMessage(request, false, { name: 'Opened-App' })
    ).rejects.toThrow('question:message.error.recipient_no_public_key');
    expect(createTransaction).not.toHaveBeenCalled();
    expect(signChatFunc).not.toHaveBeenCalled();
  });
});
