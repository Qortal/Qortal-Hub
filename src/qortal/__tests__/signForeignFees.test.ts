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
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../encryption/ed2curve', async () =>
  (await import('./common')).ed2curveFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);

import { signForeignFees } from '../get';
import {
  getKeyPair,
  getSaveWallet,
  createEndpoint,
} from '../../background/background';
import { hasSessionPermission } from '../qortal-requests';
import { base58 as Base58 } from '@scure/base';
import nacl from 'tweetnacl';
import PaymentTransaction from '../../transactions/PaymentTransaction';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const user = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(17));
const other = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(29));
function address(key: Uint8Array) {
  const hash = createHash('ripemd160')
    .update(createHash('sha256').update(key).digest())
    .digest();
  const payload = Buffer.concat([Buffer.from([58]), hash]);
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest()
    .subarray(0, 4);
  return Base58.encode(new Uint8Array(Buffer.concat([payload, checksum])));
}
const fee = {
  timestamp: 1700000000123,
  atAddress: 'AFsBXShNPGXJCSpxmFnTWEm3UHqyohhEgP',
  fee: 250,
  data: '119wyg1KH1Pbyvqbx5Xe862QJ4bw2Bn66q4A5CV9T4skC4utM',
};
let accepted = true;
let prompts: any[];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  accepted = true;
  prompts = [];
  vi.mocked(hasSessionPermission).mockReturnValue(true); // A stale auto-grant must never bypass review.
  vi.mocked(getSaveWallet).mockResolvedValue({
    address0: address(user.publicKey),
    publicKey: Base58.encode(user.publicKey),
  } as any);
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: Base58.encode(user.secretKey),
    publicKey: Base58.encode(user.publicKey),
  } as any);
  vi.mocked(createEndpoint).mockImplementation(
    async (path) => 'https://core.invalid' + path
  );
  fetchMock = vi.fn(
    async (_url, options) =>
      new Response(JSON.stringify(options?.method === 'POST' ? true : [fee]))
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message.action !== 'QORTAL_REQUEST_PERMISSION') return;
    prompts.push(message.payload);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: message.requestId,
          result: { accepted },
        },
      })
    );
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('requires batch approval even with a pre-existing session grant, and posts a valid fee signature', async () => {
  expect(
    await signForeignFees({}, { name: 'test-qapp', tabId: 42 }, true)
  ).toBe(true);
  expect(prompts).toHaveLength(1);
  expect(prompts[0].json).toEqual([
    { timestamp: fee.timestamp, atAddress: fee.atAddress, fee: fee.fee },
  ]);
  expect(hasSessionPermission).not.toHaveBeenCalled();
  const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(
    nacl.sign.detached.verify(
      Base58.decode(fee.data),
      Base58.decode(posted[0].data),
      user.publicKey
    )
  ).toBe(true);
});

it('blocks the original attack: a real QORT payment returned as foreign-fee data', async () => {
  const tx = new PaymentTransaction();
  tx.keyPair = { publicKey: user.publicKey, privateKey: user.secretKey };
  tx.recipient = address(other.publicKey);
  tx.amount = 7;
  tx.fee = 0.01;
  tx.lastReference = new Uint8Array(64).fill(11);
  const paymentBytes = tx.generateBase();
  expect(new DataView(paymentBytes.buffer).getUint32(0)).toBe(2);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify([{ ...fee, data: Base58.encode(paymentBytes) }])
    )
  );
  await expect(
    signForeignFees({}, { name: 'test-qapp', tabId: 42 }, true)
  ).rejects.toThrow('foreign_fees.invalid');
  expect(prompts).toEqual([]);
  expect(getKeyPair).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('does not access the private key or submit signatures after refusal', async () => {
  accepted = false;
  await expect(signForeignFees({}, {}, true)).rejects.toThrow(
    'foreign_fees.declined'
  );
  expect(getKeyPair).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('rejects overlapping requests rather than replacing the pending approval', async () => {
  let finish: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = signForeignFees({}, {}, true);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await expect(signForeignFees({}, {}, true)).rejects.toThrow(
    'foreign_fees.busy'
  );
  finish!(new Response(JSON.stringify([fee])));
  await expect(pending).resolves.toBe(true);
  expect(prompts).toHaveLength(1);
});

it('does not advertise fee signing as a session permission or auto-grant it on authentication', () => {
  // The real request module has substantial UI side effects; inspect only its
  // exported policy declarations rather than importing a mocked policy here.
  const source = readFileSync(resolve('src/qortal/qortal-requests.ts'), 'utf8');
  for (const name of [
    'VALID_SESSION_PERMISSIONS',
    'AUTO_GRANTED_PERMISSIONS_ON_AUTH',
  ]) {
    const declaration = source.match(
      new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`)
    );
    expect(declaration).not.toBeNull();
    expect(declaration![1]).not.toContain("'SIGN_FOREIGN_FEES'");
  }
});
