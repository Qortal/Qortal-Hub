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
// test) with storage and its heaviest imports replaced, so the payment checks
// run against a fake node: what is signed, what is sent, and what is refused
// before anything is signed.

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
// getFee reads the node through publish.ts; answer it from the same fake node.
const publishMock = vi.hoisted(() => () => ({
  reusableGet: async (endpoint: string) => {
    const response = await fetch(`http://127.0.0.1:12391${endpoint}`);
    return response.json();
  },
}));
vi.mock('../qdn/publish/publish.ts', publishMock);
vi.mock('../qdn/publish/publish', publishMock);
vi.mock('../chatComputePow.worker.js?worker', () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage() {}
  },
}));
// The real builder, wrapped so tests can see whether anything was signed.
vi.mock('../transactions/transactions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../transactions/transactions')>();
  return { ...actual, createTransaction: vi.fn(actual.createTransaction) };
});

import { Sha256 } from 'asmcrypto.js';
import Base58Untyped from '../encryption/Base58';
import naclUntyped from '../encryption/nacl-fast';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import {
  FeeNotApprovedError,
  InvalidAmountError,
  InvalidAssetIdError,
  InvalidRecipientError,
  parseDecimalAmount,
  RecipientInvisibleCharactersError,
  RecipientLookupFailedError,
  RecipientNameNotFoundError,
} from '../transactions/paymentSafety';
import { createTransaction } from '../transactions/transactions';

const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

type Background = typeof import('./background');
let bg: Background;

function account(fill: number) {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(fill));
  return {
    privateKey: Base58.encode(pair.secretKey) as string,
    publicKey: Base58.encode(pair.publicKey) as string,
    publicKeyBytes: pair.publicKey as Uint8Array,
    address: String(publicKeyToAddress(pair.publicKey)),
  };
}

/** An AT address: version 23, so it starts with "A". */
function atAddress(fill: number): string {
  const body = new Uint8Array(21).fill(fill);
  body[0] = 23;
  const first = new Sha256().process(body).finish().result;
  const checksum = new Sha256().process(first).finish().result.slice(0, 4);
  const bytes = new Uint8Array(25);
  bytes.set(body);
  bytes.set(checksum, 21);
  return Base58.encode(bytes) as string;
}

/** `address` with its last character changed: same length, bad checksum. */
function withTypo(address: string): string {
  const last = address[address.length - 1];
  return address.slice(0, -1) + (last === 'z' ? 'y' : 'z');
}

// The signed-in account; the recipient Account-A, whose registered name is
// Recipient B; Account-X, which owns names with invisible characters; an AT
// address (Opened-App's crowdfund, say).
const self = account(1);
const accountA = account(2);
const accountX = account(3);
const crowdfund = atAddress(7);
const LAST_REFERENCE = Base58.encode(new Uint8Array(64).fill(9)) as string;
const NODE_FEE_ATOMIC = '1000000'; // 0.01 QORT
const APPROVED_FEE = '0.01000000';

type Reply = unknown | Error | ((url: string, init?: RequestInit) => unknown);

type NodeScript = {
  /** /transactions/unitfee answer (atomic units, or any JSON). */
  fee?: unknown;
  /** /transactions/process answer. */
  process?: Reply;
  /** /names/<name> answer. */
  name?: Reply;
};

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

/** An answer with this HTTP status and body text, JSON or not. */
class RawAnswer {
  constructor(
    readonly status: number,
    readonly body: string
  ) {}

  toResponse() {
    const json = async () => JSON.parse(this.body);
    const text = async () => this.body;
    return {
      ok: this.status >= 200 && this.status < 300,
      status: this.status,
      json,
      text,
      clone: () => ({ json, text }),
    };
  }
}

function resolveReply(reply: Reply, url: string, init?: RequestInit) {
  const value = typeof reply === 'function' ? reply(url, init) : reply;
  if (value instanceof Error) throw value;
  return value;
}

/** The signature of the bytes a POST sent: its last 64 bytes. */
function signatureOf(init?: RequestInit): string {
  const bytes = Base58.decode(String(init?.body)) as Uint8Array;
  return Base58.encode(bytes.slice(bytes.length - 64));
}

/** A fake node answering by path; records every request. */
function stubNode(script: NodeScript = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(url.indexOf('/', 'http://'.length));
    if (path.startsWith('/addresses/lastreference/')) {
      return response(LAST_REFERENCE);
    }
    if (path.startsWith('/transactions/unitfee')) {
      return response(script.fee ?? NODE_FEE_ATOMIC);
    }
    if (path.startsWith('/transactions/process')) {
      const reply =
        script.process ??
        ((_url, sent) => ({
          signature: signatureOf(sent),
        }));
      return response(resolveReply(reply, url, init));
    }
    if (path.startsWith('/names/')) {
      const record = resolveReply(
        script.name ?? { error: 401, message: 'name unknown' },
        url,
        init
      );
      if (record instanceof RawAnswer) return record.toResponse();
      return response(record, !(record as { error?: unknown })?.error);
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/transactions/process')
  );
const nameLookups = (fetchMock: ReturnType<typeof stubNode>) =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/names/'));

/** Field offsets in signed PAYMENT / TRANSFER_ASSET bytes. */
const BASE_BYTES = 4 + 8 + 4 + 64 + 32; // type, timestamp, group, ref, key
const ADDRESS_BYTES = 25;

function readInt64(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 8; i++) value = value * 256 + bytes[offset + i];
  return value;
}

/** What the one POST carried, read back from the signed bytes. */
function sentTransaction(
  fetchMock: ReturnType<typeof stubNode>,
  type: 'PAYMENT' | 'TRANSFER_ASSET'
) {
  const sent = posts(fetchMock);
  expect(sent).toHaveLength(1);
  const bytes = Base58.decode(String(sent[0][1]?.body)) as Uint8Array;
  const signature = bytes.slice(bytes.length - 64);
  const recipient = Base58.encode(
    bytes.slice(BASE_BYTES, BASE_BYTES + ADDRESS_BYTES)
  ) as string;
  let offset = BASE_BYTES + ADDRESS_BYTES;
  let assetId: number | undefined;
  if (type === 'TRANSFER_ASSET') {
    assetId = readInt64(bytes, offset);
    offset += 8;
  }
  return {
    recipient,
    assetId,
    amount: readInt64(bytes, offset),
    fee: readInt64(bytes, offset + 8),
    signedBySelf: nacl.sign.detached.verify(
      bytes.slice(0, bytes.length - 64),
      signature,
      self.publicKeyBytes
    ) as boolean,
  };
}

/** The amount the one POST carried, in 1e-8 units, read without rounding. */
function signedAmount(
  fetchMock: ReturnType<typeof stubNode>,
  type: 'PAYMENT' | 'TRANSFER_ASSET'
): bigint {
  const sent = posts(fetchMock);
  expect(sent).toHaveLength(1);
  const bytes = Base58.decode(String(sent[0][1]?.body)) as Uint8Array;
  const offset =
    BASE_BYTES + ADDRESS_BYTES + (type === 'TRANSFER_ASSET' ? 8 : 0);
  let amount = BigInt(0);
  for (let i = 0; i < 8; i++) {
    amount = amount * BigInt(256) + BigInt(bytes[offset + i]);
  }
  return amount;
}

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

describe('sendCoin', () => {
  it('signs the amount and the approved fee for the given address', async () => {
    const fetchMock = stubNode();
    const { res } = await bg.sendCoin(
      { amount: 1.5, receiver: accountA.address, approvedFee: APPROVED_FEE },
      true
    );
    expect(res.success).toBe(true);
    expect(sentTransaction(fetchMock, 'PAYMENT')).toEqual({
      recipient: accountA.address,
      assetId: undefined,
      amount: 150000000,
      fee: 1000000,
      signedBySelf: true,
    });
  });

  it('signs the amount a confirmation showed, given as get.ts hands it on', async () => {
    // get.ts and QortPayment.tsx show `text` and hand `value` on.
    const shown = parseDecimalAmount('100000000.1');
    const fetchMock = stubNode();
    await bg.sendCoin(
      {
        amount: shown.value,
        receiver: accountA.address,
        approvedFee: APPROVED_FEE,
      },
      true
    );
    expect(signedAmount(fetchMock, 'PAYMENT')).toBe(shown.atomic);
  });

  it('refuses a node fee above the approved fee, before signing', async () => {
    const fetchMock = stubNode({ fee: String(4e7) }); // 0.4 QORT
    await expect(
      bg.sendCoin(
        { amount: 1, receiver: accountA.address, approvedFee: APPROVED_FEE },
        true
      )
    ).rejects.toThrow(
      /0\.4 QORT.*0\.01 QORT you approved\. This payment wasn't signed\.$/
    );
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('refuses a fee above the ceiling when no fee was approved', async () => {
    const fetchMock = stubNode({ fee: String(90 * 1e8) });
    await expect(
      bg.sendCoin({ amount: 1, receiver: accountA.address }, true)
    ).rejects.toThrow(
      /90 QORT, above the 1 QORT limit\. This payment wasn't signed\.$/
    );
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('refuses a fee answer it cannot read, before signing', async () => {
    const fetchMock = stubNode({ fee: { error: 1000, message: 'busy' } });
    await expect(
      bg.sendCoin(
        { amount: 1, receiver: accountA.address, approvedFee: APPROVED_FEE },
        true
      )
    ).rejects.toThrow(/invalid fee\. This payment wasn't signed\.$/);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('pays an AT address without looking it up as a name', async () => {
    const fetchMock = stubNode();
    await bg.sendCoin(
      { amount: 2, receiver: crowdfund, approvedFee: APPROVED_FEE },
      true
    );
    expect(sentTransaction(fetchMock, 'PAYMENT').recipient).toBe(crowdfund);
    expect(nameLookups(fetchMock)).toEqual([]);
  });

  it('pays the owner of a name with a space, looked up with the name encoded', async () => {
    const fetchMock = stubNode({
      name: { name: 'Recipient B', owner: accountA.address },
    });
    await bg.sendCoin(
      { amount: '2.50', receiver: 'Recipient B', approvedFee: APPROVED_FEE },
      true
    );
    expect(nameLookups(fetchMock)).toEqual([`${NODE}/names/Recipient%20B`]);
    const sent = sentTransaction(fetchMock, 'PAYMENT');
    expect(sent.recipient).toBe(accountA.address);
    expect(sent.amount).toBe(250000000);
  });

  it('sends nothing for a name the node does not know', async () => {
    const fetchMock = stubNode();
    await expect(
      bg.sendCoin(
        { amount: 1, receiver: 'Recipient B', approvedFee: APPROVED_FEE },
        true
      )
    ).rejects.toThrow(new RecipientNameNotFoundError().message);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('sends nothing when the owner the node gives is not an address', async () => {
    const fetchMock = stubNode({
      name: { name: 'Recipient B', owner: 'QnotAnAddress' },
    });
    await expect(
      bg.sendCoin(
        { amount: 1, receiver: 'Recipient B', approvedFee: APPROVED_FEE },
        true
      )
    ).rejects.toThrow(new InvalidRecipientError().message);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it.each(['1e3', '0x10', '-1', '0.000000001', 'Infinity'])(
    'refuses the amount %j before asking the node anything',
    async (amount) => {
      const fetchMock = stubNode();
      await expect(
        bg.sendCoin(
          { amount, receiver: accountA.address, approvedFee: APPROVED_FEE },
          true
        )
      ).rejects.toThrow(new InvalidAmountError().message);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(createTransaction).not.toHaveBeenCalled();
    }
  );

  it('refuses a mistyped address without looking it up as a name', async () => {
    const fetchMock = stubNode({
      name: { name: 'x', owner: accountA.address },
    });
    await expect(
      bg.sendCoin(
        {
          amount: 1,
          receiver: withTypo(accountA.address),
          approvedFee: APPROVED_FEE,
        },
        true
      )
    ).rejects.toThrow(new InvalidRecipientError().message);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('transferAsset', () => {
  it('signs the amount, the asset and the approved fee for the given address', async () => {
    const fetchMock = stubNode();
    await expect(
      bg.transferAsset({
        amount: '2.50',
        recipient: accountA.address,
        assetId: 5,
        approvedFee: APPROVED_FEE,
      })
    ).resolves.toHaveProperty('signature');
    expect(sentTransaction(fetchMock, 'TRANSFER_ASSET')).toEqual({
      recipient: accountA.address,
      assetId: 5,
      amount: 250000000,
      fee: 1000000,
      signedBySelf: true,
    });
  });

  it('refuses a node fee above the approved fee before signing', async () => {
    const fetchMock = stubNode({ fee: '5000000' }); // 0.05 QORT
    await expect(
      bg.transferAsset({
        amount: 1,
        recipient: accountA.address,
        assetId: 0,
        approvedFee: APPROVED_FEE,
      })
    ).rejects.toBeInstanceOf(FeeNotApprovedError);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('refuses a fee above the ceiling even without an approved fee', async () => {
    const fetchMock = stubNode({ fee: String(500 * 1e8) });
    await expect(
      bg.transferAsset({ amount: 1, recipient: accountA.address, assetId: 0 })
    ).rejects.toBeInstanceOf(FeeNotApprovedError);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('transfers to an AT address', async () => {
    const fetchMock = stubNode();
    await bg.transferAsset({
      amount: 1,
      recipient: crowdfund,
      assetId: 0,
      approvedFee: APPROVED_FEE,
    });
    expect(sentTransaction(fetchMock, 'TRANSFER_ASSET').recipient).toBe(
      crowdfund
    );
  });

  it('refuses a recipient that is not an address, a malformed amount and an asset id it cannot read', async () => {
    const fetchMock = stubNode();
    await expect(
      bg.transferAsset({ amount: 1, recipient: 'Recipient B', assetId: 0 })
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(
      bg.transferAsset({
        amount: 1,
        recipient: withTypo(accountA.address),
        assetId: 0,
      })
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(
      bg.transferAsset({
        amount: '1e3',
        recipient: accountA.address,
        assetId: 0,
      })
    ).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(
      bg.transferAsset({
        amount: 1,
        recipient: accountA.address,
        assetId: 'abc',
      })
    ).rejects.toBeInstanceOf(InvalidAssetIdError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('signs a transfer of 100000000 units exactly', async () => {
    const fetchMock = stubNode();
    await bg.transferAsset({
      amount: '100000000',
      recipient: accountA.address,
      assetId: 5,
      approvedFee: APPROVED_FEE,
    });
    expect(signedAmount(fetchMock, 'TRANSFER_ASSET')).toBe(
      BigInt('10000000000000000')
    );
  });

  it('signs the amount a confirmation showed, given as get.ts hands it on', async () => {
    const shown = parseDecimalAmount('200000000.3');
    const fetchMock = stubNode();
    await bg.transferAsset({
      amount: shown.value,
      recipient: accountA.address,
      assetId: 5,
      approvedFee: APPROVED_FEE,
    });
    expect(signedAmount(fetchMock, 'TRANSFER_ASSET')).toBe(shown.atomic);
  });

  it('refuses an amount too large for a transaction, before asking the node', async () => {
    const fetchMock = stubNode();
    await expect(
      bg.transferAsset({
        amount: '200000000000',
        recipient: accountA.address,
        assetId: 5,
        approvedFee: APPROVED_FEE,
      })
    ).rejects.toBeInstanceOf(InvalidAmountError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('refuses an amount it cannot sign exactly, before asking the node', async () => {
    const fetchMock = stubNode();
    await expect(
      bg.transferAsset({
        amount: '90071992.54740993',
        recipient: accountA.address,
        assetId: 5,
        approvedFee: APPROVED_FEE,
      })
    ).rejects.toBeInstanceOf(InvalidAmountError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createTransaction).not.toHaveBeenCalled();
  });
});

describe('getAssetBalanceInfo', () => {
  /** A node that answers `body` to /assets/balances. */
  function stubAssetBalances(body: unknown, ok = true) {
    const fetchMock = vi.fn(async (_url: string) => response(body, ok));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const row = (balance: string) => ({
    address: self.address,
    assetId: 5,
    balance,
    assetName: 'TESTASSET',
  });

  it.each(['0.00000001', '900.00000000', '90071992.54740993'])(
    'gives the decimal text the node answers, unrounded: %s',
    async (balance) => {
      const fetchMock = stubAssetBalances([row(balance)]);
      await expect(bg.getAssetBalanceInfo(5)).resolves.toBe(balance);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${NODE}/assets/balances?address=${self.address}&assetid=5&ordering=ASSET_BALANCE_ACCOUNT&limit=1`,
      ]);
    }
  );

  it('gives undefined for an asset the account never held', async () => {
    stubAssetBalances([]);
    await expect(bg.getAssetBalanceInfo(5)).resolves.toBeUndefined();
  });

  it('throws when the node refuses the request', async () => {
    stubAssetBalances({ error: 601, message: 'invalid asset ID' }, false);
    await expect(bg.getAssetBalanceInfo(5)).rejects.toThrow(
      'Cannot fetch asset balance'
    );
  });
});

describe('resolveRecipient', () => {
  it('returns an address as given, without asking the node', async () => {
    const fetchMock = stubNode();
    await expect(bg.resolveRecipient(` ${accountA.address} `)).resolves.toEqual(
      { address: accountA.address, name: '' }
    );
    await expect(bg.resolveRecipient(crowdfund)).resolves.toEqual({
      address: crowdfund,
      name: '',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a mistyped address without looking it up as a name', async () => {
    const fetchMock = stubNode({
      name: { name: 'x', owner: accountA.address },
    });
    for (const typo of [withTypo(accountA.address), withTypo(crowdfund)]) {
      await expect(bg.resolveRecipient(typo)).rejects.toBeInstanceOf(
        InvalidRecipientError
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes the name in the path and returns the owner and the name as Core spells it', async () => {
    const fetchMock = stubNode({
      name: { name: 'Who?#1', owner: accountA.address },
    });
    await expect(bg.resolveRecipient('who?#1')).resolves.toEqual({
      address: accountA.address,
      name: 'Who?#1',
    });
    expect(nameLookups(fetchMock)).toEqual([`${NODE}/names/who%3F%231`]);
  });

  it.each(['../names', 'a/b', 'a\\b', '..', 'a  b', '', '   '])(
    'refuses %j without asking the node',
    async (name) => {
      const fetchMock = stubNode();
      await expect(bg.resolveRecipient(name)).rejects.toBeInstanceOf(
        InvalidRecipientError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('refuses an owner that is not a valid account address', async () => {
    stubNode({ name: { name: 'Recipient B', owner: crowdfund } });
    await expect(bg.resolveRecipient('Recipient B')).rejects.toBeInstanceOf(
      InvalidRecipientError
    );
  });

  it('reports a name the node does not know', async () => {
    stubNode();
    await expect(bg.resolveRecipient('Recipient B')).rejects.toBeInstanceOf(
      RecipientNameNotFoundError
    );
  });

  it.each([
    ['HTTP 404 without JSON', new RawAnswer(404, 'Not Found')],
    ['error 401 with another status', new RawAnswer(400, '{"error":401}')],
  ])('reports a name the node does not know: %s', async (_label, answer) => {
    stubNode({ name: answer });
    await expect(bg.resolveRecipient('Recipient B')).rejects.toBeInstanceOf(
      RecipientNameNotFoundError
    );
  });

  it.each([
    [
      'a 503 page',
      new RawAnswer(503, '<html><body>Service Unavailable</body></html>'),
    ],
    [
      'another node error',
      new RawAnswer(500, '{"error":1000,"message":"busy"}'),
    ],
    ['an answer that is not JSON', new RawAnswer(200, 'Recipient B')],
    ['no answer at all', new TypeError('Failed to fetch')],
  ])(
    'says the lookup failed, not that the name does not exist, for %s',
    async (_label, answer) => {
      stubNode({ name: answer });
      const error = await bg.resolveRecipient('Recipient B').then(
        () => null,
        (e: Error) => e
      );
      expect(error).toBeInstanceOf(RecipientLookupFailedError);
      expect(error?.message).toBe(
        new RecipientLookupFailedError('Recipient B').message
      );
      expect(error?.message).toContain('Recipient B');
    }
  );

  it('signs nothing when the lookup fails', async () => {
    const fetchMock = stubNode({
      name: new RawAnswer(503, '<html><body>Service Unavailable</body></html>'),
    });
    await expect(
      bg.sendCoin(
        { amount: 1, receiver: 'Recipient B', approvedFee: APPROVED_FEE },
        true
      )
    ).rejects.toThrow(new RecipientLookupFailedError('Recipient B').message);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});

describe('names with invisible characters', () => {
  // The node answers that Account-X owns each of these names.
  const invisibleNames = [
    ['a braille blank (U+2800)', 'Recipient B\u2800'],
    ['a zero-width space (U+200B)', 'Recipient\u200B B'],
  ];

  it.each(invisibleNames)(
    'resolveRecipient refuses a name with %s before looking it up',
    async (_label, name) => {
      const fetchMock = stubNode({ name: { name, owner: accountX.address } });
      await expect(bg.resolveRecipient(name)).rejects.toBeInstanceOf(
        RecipientInvisibleCharactersError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(invisibleNames)(
    "Hub's Send QORT signs nothing for a name with %s",
    async (_label, name) => {
      // QortPayment.tsx resolves the name, then pays the address it got.
      const fetchMock = stubNode({ name: { name, owner: accountX.address } });
      const outcome = await bg.resolveRecipient(name).then(
        async ({ address }) => {
          await bg.sendCoin(
            { amount: 1, receiver: address, approvedFee: APPROVED_FEE },
            true
          );
          return 'paid';
        },
        (error: Error) => error.message
      );
      expect(outcome).toBe(new RecipientInvisibleCharactersError().message);
      expect(createTransaction).not.toHaveBeenCalled();
      expect(posts(fetchMock)).toHaveLength(0);
    }
  );

  it.each(invisibleNames)(
    'sendCoin refuses a name with %s, with the translated message',
    async (_label, name) => {
      const fetchMock = stubNode({ name: { name, owner: accountX.address } });
      await expect(
        bg.sendCoin(
          { amount: 1, receiver: name, approvedFee: APPROVED_FEE },
          true
        )
      ).rejects.toThrow(new RecipientInvisibleCharactersError().message);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(createTransaction).not.toHaveBeenCalled();
    }
  );
});
