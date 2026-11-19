import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Group keys are encrypted to the public keys the node lists for the group's
// members (or admins). These tests check that a key which does not derive its
// member's address stops the publish before anything is encrypted.

const NODE = 'http://127.0.0.1:12391';

// src/test/setup.ts stubs asmcrypto out; address checks need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../background/background.ts', () => ({
  getBaseApi: vi.fn(async () => 'http://127.0.0.1:12391'),
}));
vi.mock('../background/background', () => ({
  getBaseApi: vi.fn(async () => 'http://127.0.0.1:12391'),
}));
vi.mock('../qdn/publish/publish.ts', () => ({
  publishData: vi.fn(async () => ({ signature: 'PUBLISHED' })),
}));
vi.mock('../qdn/encryption/group-encryption.ts', () => ({
  createSymmetricKeyAndNonce: vi.fn(() => ({ messageKey: 'K', nonce: 'N' })),
  decryptGroupData: vi.fn(),
  encryptDataGroup: vi.fn(() => 'ENCRYPTED'),
  objectToBase64: vi.fn(async () => 'BASE64'),
}));
vi.mock('../utils/chromeStorage.ts', () => ({
  getData: vi.fn(async (key: string) => {
    if (key === 'keyPair') return { privateKey: 'PRIV', publicKey: 'PUB' };
    if (key === 'walletInfo') return { address0: 'QselfAddress' };
    throw new Error(`No ${key}`);
  }),
}));

import Base58Untyped from './Base58';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import {
  encryptAndPublishSymmetricKeyGroupChat,
  encryptAndPublishSymmetricKeyGroupChatForAdmins,
  getPublicKeysByAddress,
} from './encryption';
import { PublicKeyMismatchError } from './addressKeyCheck';
import { encryptDataGroup } from '../qdn/encryption/group-encryption.ts';
import { publishData } from '../qdn/publish/publish.ts';

const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

function account(fill: number) {
  const bytes = new Uint8Array(32).fill(fill);
  return {
    publicKey: Base58.encode(bytes) as string,
    address: String(publicKeyToAddress(bytes)),
  };
}

// Member-A and Member-B are in group 7; Account-C is not.
const memberA = account(11);
const memberB = account(12);
const accountC = account(13);

type Accounts = Record<string, { publicKey?: string }>;

/** A node with group 7 = [Member-A, Member-B] and the given account records. */
function stubNode(accounts: Accounts) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.slice(NODE.length);
    let body: unknown;
    if (path.startsWith('/groups/members/7')) {
      body = {
        members: [{ member: memberA.address }, { member: memberB.address }],
      };
    } else if (path.startsWith('/names/primary/')) {
      body = { name: 'Publisher' };
    } else if (path.startsWith('/addresses/')) {
      const address = path.slice('/addresses/'.length);
      body = { address, ...(accounts[address] || {}) };
    } else {
      throw new Error(`unexpected request ${url}`);
    }
    return {
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.mocked(encryptDataGroup).mockClear();
  vi.mocked(publishData).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('group key recipients', () => {
  it('returns the member keys when each derives its address', async () => {
    stubNode({
      [memberA.address]: { publicKey: memberA.publicKey },
      [memberB.address]: { publicKey: memberB.publicKey },
    });
    await expect(
      getPublicKeysByAddress([memberA.address, memberB.address])
    ).resolves.toEqual([memberA.publicKey, memberB.publicKey]);
  });

  it("refuses a member record that holds another account's key", async () => {
    stubNode({
      [memberA.address]: { publicKey: memberA.publicKey },
      [memberB.address]: { publicKey: accountC.publicKey },
    });
    await expect(
      getPublicKeysByAddress([memberA.address, memberB.address])
    ).rejects.toThrow(PublicKeyMismatchError);
  });

  it('refuses a member record without a key', async () => {
    stubNode({ [memberA.address]: {} });
    await expect(getPublicKeysByAddress([memberA.address])).rejects.toThrow(
      PublicKeyMismatchError
    );
  });

  it('refuses an entry that is not an address without asking the node', async () => {
    const fetchMock = stubNode({});
    await expect(getPublicKeysByAddress(['not-an-address'])).rejects.toThrow(
      PublicKeyMismatchError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publishes a new group key to the checked member keys', async () => {
    stubNode({
      [memberA.address]: { publicKey: memberA.publicKey },
      [memberB.address]: { publicKey: memberB.publicKey },
    });
    await encryptAndPublishSymmetricKeyGroupChat({
      groupId: 7,
      previousData: null,
    });
    expect(vi.mocked(encryptDataGroup).mock.calls[0][0].publicKeys).toEqual([
      memberA.publicKey,
      memberB.publicKey,
    ]);
    expect(publishData).toHaveBeenCalledTimes(1);
  });

  it("encrypts and publishes nothing when a member record holds another account's key", async () => {
    stubNode({
      [memberA.address]: { publicKey: memberA.publicKey },
      [memberB.address]: { publicKey: accountC.publicKey },
    });
    await expect(
      encryptAndPublishSymmetricKeyGroupChat({ groupId: 7, previousData: null })
    ).rejects.toThrow();
    expect(encryptDataGroup).not.toHaveBeenCalled();
    expect(publishData).not.toHaveBeenCalled();
  });

  it("encrypts and publishes nothing for admins when an admin record holds another account's key", async () => {
    stubNode({ [memberA.address]: { publicKey: accountC.publicKey } });
    await expect(
      encryptAndPublishSymmetricKeyGroupChatForAdmins({
        groupId: 7,
        previousData: {},
        admins: [{ address: memberA.address }],
      } as any)
    ).rejects.toThrow();
    expect(encryptDataGroup).not.toHaveBeenCalled();
    expect(publishData).not.toHaveBeenCalled();
  });
});
