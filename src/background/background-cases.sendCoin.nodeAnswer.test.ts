import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Hub's Send QORT dialog sends its payment as the 'sendCoin' message. Here the
// real sendCoinCase hands it to the real background.sendCoin, which signs it
// and posts it to a fake node, so what the dialog is told comes from what the
// node answered.

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
const NODE = 'http://127.0.0.1:12391';

// src/test/setup.ts stubs asmcrypto out; addresses need the real SHA-256.
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
// The real background.ts for sendCoinCase (src/test/setup.ts mocks it), whose
// own import of the message handlers is left out; the handlers are loaded
// below. What else the handlers import isn't used by sendCoinCase.
vi.mock('./background.ts', async (importOriginal) => importOriginal());
vi.mock('./background-cases', () => ({}));
vi.mock('../qortal/get.ts', () => ({}));
vi.mock('../qdn/encryption/group-encryption', () => ({}));

import Base58Untyped from '../encryption/Base58';
import naclUntyped from '../encryption/nacl-fast';
import enQuestion from '../i18n/locales/en/question.json';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';

const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

type Cases = typeof import('./background-cases');
let sendCoinCase: Cases['sendCoinCase'];

function account(fill: number) {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(fill));
  return {
    privateKey: Base58.encode(pair.secretKey) as string,
    publicKey: Base58.encode(pair.publicKey) as string,
    address: String(publicKeyToAddress(pair.publicKey)),
  };
}

// The signed-in account, and Account-A, which gets the payment.
const self = account(1);
const accountA = account(2);
const LAST_REFERENCE = Base58.encode(new Uint8Array(64).fill(9)) as string;
const APPROVED_FEE = '0.01000000';
const GATEWAY_PAGE =
  '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>';

/** A fake node; `process` answers /transactions/process from the sent body. */
function stubNode(process: (sentBody: string) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(NODE.length);
    let body: unknown;
    if (path.startsWith('/addresses/lastreference/')) body = LAST_REFERENCE;
    else if (path.startsWith('/transactions/unitfee')) body = '1000000';
    else if (path.startsWith('/transactions/process')) {
      body = process(String(init?.body));
      if (body instanceof Error) throw body;
    } else throw new Error(`unexpected request ${url}`);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const json = async () => JSON.parse(text);
    return {
      ok: true,
      status: 200,
      json,
      text: async () => text,
      clone: () => ({ json, text: async () => text }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The signature of the transaction a POST sent: its last 64 bytes. */
const signatureOf = (sentBody: string) => {
  const bytes = Base58.decode(sentBody) as Uint8Array;
  return Base58.encode(bytes.slice(bytes.length - 64)) as string;
};

/** Sends Account-A 1 QORT as Hub's Send QORT does; returns what it posted. */
async function sendFromDialog() {
  const event = { source: { postMessage: vi.fn() }, origin: 'app://hub' };
  await sendCoinCase(
    {
      requestId: 'send-1',
      payload: {
        amount: 1,
        receiver: accountA.address,
        password: null,
        approvedFee: APPROVED_FEE,
        skipConfirmPassword: true,
      },
    },
    event
  );
  expect(event.source.postMessage).toHaveBeenCalledTimes(1);
  const [message, origin] = event.source.postMessage.mock.calls[0];
  expect(origin).toBe('app://hub');
  return message;
}

beforeAll(async () => {
  ({ sendCoinCase } = await vi.importActual<Cases>('./background-cases'));
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
  vi.restoreAllMocks();
});

describe("Hub's Send QORT and the node's answer", () => {
  it('says the payment was sent when the answer carries its signature', async () => {
    const fetchMock = stubNode((sent) => ({
      type: 'PAYMENT',
      signature: signatureOf(sent),
    }));
    expect(await sendFromDialog()).toEqual({
      requestId: 'send-1',
      action: 'sendCoin',
      payload: true,
      type: 'backgroundMessageResponse',
    });
    const processed = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/transactions/process')
    );
    expect(processed).toHaveLength(1);
  });

  it('does not say the payment was sent when the node answers with an error page', async () => {
    stubNode(() => GATEWAY_PAGE);
    expect(await sendFromDialog()).toEqual({
      requestId: 'send-1',
      action: 'sendCoin',
      error: enQuestion.message.error.payment_outcome_unknown,
      code: 'PAYMENT_OUTCOME_UNKNOWN',
      type: 'backgroundMessageResponse',
    });
  });

  it('says Hub cannot tell whether the payment went through when no answer comes back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubNode(() => new TypeError('Failed to fetch'));
    expect(await sendFromDialog()).toMatchObject({
      error: enQuestion.message.error.payment_outcome_unknown,
      code: 'PAYMENT_OUTCOME_UNKNOWN',
    });
  });

  it("gives the node's reason when it refuses the payment", async () => {
    stubNode(() => ({
      error: 312,
      message: 'transaction invalid: insufficient balance (NO_BALANCE)',
    }));
    expect(await sendFromDialog()).toEqual({
      requestId: 'send-1',
      action: 'sendCoin',
      error: 'transaction invalid: insufficient balance (NO_BALANCE)',
      type: 'backgroundMessageResponse',
    });
  });

  // Errors Core can give for a payment it has added: the same signed payment
  // arriving a second time, or closing the database failing after the import.
  it.each([
    [
      'the payment already being there',
      {
        error: 312,
        message:
          'transaction invalid: transaction already exists (TRANSACTION_ALREADY_EXISTS)',
      },
    ],
    [
      'a repository error after the import',
      { error: 5, message: 'repository error' },
    ],
  ])(
    'says Hub cannot tell whether the payment went through for %s',
    async (_label, answer) => {
      stubNode(() => answer);
      expect(await sendFromDialog()).toEqual({
        requestId: 'send-1',
        action: 'sendCoin',
        error: enQuestion.message.error.payment_outcome_unknown,
        code: 'PAYMENT_OUTCOME_UNKNOWN',
        type: 'backgroundMessageResponse',
      });
    }
  );
});
