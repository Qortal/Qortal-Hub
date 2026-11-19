import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Loads the real background.ts (src/test/setup.ts mocks it for every other
// test) with storage and its heaviest imports replaced, so the recipient key
// checks run against a fake node: what is encrypted to whom, what is sent, and
// what is refused before anything is encrypted.

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
const NODE = 'http://127.0.0.1:12391';

// src/test/setup.ts stubs asmcrypto out; address checks need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => {
    if (key in storage.values) return storage.values[key];
    throw new Error(`No ${key} in storage`);
  }),
  storeData: vi.fn(async () => undefined),
  removeKeysAndLogout: vi.fn(async () => undefined),
}));
vi.mock('../qortal/qortal-requests.ts', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../qortal/qortal-requests', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('./background-cases', () => ({}));
vi.mock('../qdn/publish/publish.ts', () => ({ reusableGet: vi.fn() }));
vi.mock('../qdn/publish/publish', () => ({ reusableGet: vi.fn() }));
// Chat proof of work is skipped: the fake node accepts any nonce.
vi.mock('../chatComputePow.worker.js?worker', () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;

    postMessage(task: { chatBytes: ArrayLike<number> }) {
      const chatBytesArray = Uint8Array.from(Object.values(task.chatBytes));
      void Promise.resolve().then(() =>
        this.onmessage?.({ data: { nonce: 1, chatBytesArray } })
      );
    }
  },
}));
// The real builder, wrapped so tests can see what was encrypted to whom.
vi.mock('../transactions/transactions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../transactions/transactions')>();
  return { ...actual, createTransaction: vi.fn(actual.createTransaction) };
});

import Base58Untyped from '../encryption/Base58';
import naclUntyped from '../encryption/nacl-fast';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import { PublicKeyMismatchError } from '../encryption/addressKeyCheck';
import { createTransaction } from '../transactions/transactions';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

type Background = typeof import('./background');
let bg: Background;

function account(fill: number) {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(fill));
  return {
    privateKey: Base58.encode(pair.secretKey) as string,
    publicKey: Base58.encode(pair.publicKey) as string,
    address: String(publicKeyToAddress(pair.publicKey)),
  };
}

// The signed-in account, the recipient (Account-A) and another account
// (Account-B) whose key is not the recipient's.
const self = account(1);
const accountA = account(2);
const accountB = account(3);
const LAST_REFERENCE = Base58.encode(new Uint8Array(64).fill(9)) as string;

function response(body: unknown, ok = true) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const json = async () => (typeof body === 'string' ? JSON.parse(body) : body);
  return {
    ok,
    status: ok ? 200 : 404,
    json,
    text: async () => text,
    clone: () => ({ json, text: async () => text }),
  };
}

/** A fake node answering by path; records every request. */
function stubNode(script: { publicKey?: string }) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.slice(url.indexOf('/', 'http://'.length));
    if (path.startsWith('/addresses/lastreference/')) {
      return response(LAST_REFERENCE);
    }
    if (path.startsWith('/addresses/publickey/')) {
      return response(script.publicKey ?? 'false');
    }
    if (path.startsWith('/transactions/process')) {
      return response({ signature: 'CHAT_SIG' });
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const keyLookups = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/addresses/publickey/')
  );
const chatPosts = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/transactions/process')
  );
const encryptedTo = () =>
  vi
    .mocked(createTransaction)
    .mock.calls.filter(([type]) => type === 18)
    .map(([, , params]) => params as { recipientPublicKey: string });

const directMessage = (publicKeyOfRecipient?: string) => ({
  address: accountA.address,
  directTo: accountA.address,
  typeMessage: undefined,
  chatReference: undefined,
  messageText: 'hello',
  publicKeyOfRecipient,
  otherData: undefined,
});

beforeAll(async () => {
  bg = await vi.importActual<Background>('./background');
});

beforeEach(() => {
  storage.values = {
    apiKey: { url: NODE, apikey: '' },
    walletInfo: { address0: self.address },
    keyPair: { privateKey: self.privateKey, publicKey: self.publicKey },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(createTransaction).mockClear();
});

describe('getPublicKey', () => {
  it('returns the key when it derives the address', async () => {
    stubNode({ publicKey: `${accountA.publicKey}\n` });
    await expect(bg.getPublicKey(accountA.address)).resolves.toBe(
      accountA.publicKey
    );
  });

  it("refuses another account's key for the address", async () => {
    stubNode({ publicKey: accountB.publicKey });
    const expected = new PublicKeyMismatchError(accountA.address).message;
    await expect(bg.getPublicKey(accountA.address)).rejects.toThrow(expected);
  });

  it('refuses an answer without a key, saying the key could not be fetched', async () => {
    stubNode({ publicKey: 'false' });
    await expect(bg.getPublicKey(accountA.address)).rejects.toThrow(
      /failed to fetch recipient's public key/i
    );
  });

  it('refuses a non-address without asking the node', async () => {
    const fetchMock = stubNode({});
    await expect(bg.getPublicKey('not-an-address')).rejects.toThrow();
    await expect(bg.getPublicKey('Account-A')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendChatDirect recipient key', () => {
  it('encrypts and sends nothing when the node returns another key', async () => {
    const fetchMock = stubNode({ publicKey: accountB.publicKey });
    await expect(bg.sendChatDirect(directMessage())).rejects.toThrow(
      new PublicKeyMismatchError(accountA.address).message
    );
    expect(encryptedTo()).toHaveLength(0);
    expect(chatPosts(fetchMock)).toHaveLength(0);
  });

  it('encrypts to the key the node returns when it is the recipient’s', async () => {
    const fetchMock = stubNode({ publicKey: accountA.publicKey });
    await expect(bg.sendChatDirect(directMessage())).resolves.toMatchObject({
      signature: 'CHAT_SIG',
    });
    expect(encryptedTo()).toEqual([
      expect.objectContaining({
        recipient: accountA.address,
        recipientPublicKey: accountA.publicKey,
      }),
    ]);
    expect(chatPosts(fetchMock)).toHaveLength(1);
  });

  it('uses a caller key that belongs to the recipient without asking the node', async () => {
    const fetchMock = stubNode({});
    await expect(
      bg.sendChatDirect(directMessage(accountA.publicKey))
    ).resolves.toMatchObject({ signature: 'CHAT_SIG' });
    expect(keyLookups(fetchMock)).toHaveLength(0);
    expect(encryptedTo()).toEqual([
      expect.objectContaining({ recipientPublicKey: accountA.publicKey }),
    ]);
  });

  it('uses a caller key with spaces around it as the key itself', async () => {
    const fetchMock = stubNode({});
    await expect(
      bg.sendChatDirect(directMessage(` ${accountA.publicKey}\n`))
    ).resolves.toMatchObject({ signature: 'CHAT_SIG' });
    expect(keyLookups(fetchMock)).toHaveLength(0);
    expect(encryptedTo()).toEqual([
      expect.objectContaining({ recipientPublicKey: accountA.publicKey }),
    ]);
  });

  it("replaces a caller key that is not the recipient's with a checked one", async () => {
    const fetchMock = stubNode({ publicKey: accountA.publicKey });
    await expect(
      bg.sendChatDirect(directMessage(accountB.publicKey))
    ).resolves.toMatchObject({ signature: 'CHAT_SIG' });
    expect(String(keyLookups(fetchMock)[0]?.[0])).toBe(
      `${NODE}/addresses/publickey/${accountA.address}`
    );
    expect(encryptedTo()).toEqual([
      expect.objectContaining({
        recipient: accountA.address,
        recipientPublicKey: accountA.publicKey,
      }),
    ]);
    expect(chatPosts(fetchMock)).toHaveLength(1);
  });

  it('encrypts and sends nothing when the caller key and the node key are both wrong', async () => {
    const fetchMock = stubNode({ publicKey: accountB.publicKey });
    await expect(
      bg.sendChatDirect(directMessage(accountB.publicKey))
    ).rejects.toThrow(new PublicKeyMismatchError(accountA.address).message);
    expect(encryptedTo()).toHaveLength(0);
    expect(chatPosts(fetchMock)).toHaveLength(0);
  });
});
