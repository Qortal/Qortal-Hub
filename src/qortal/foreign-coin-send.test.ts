import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
vi.mock('../background/background', () => ({
  getKeyPair: vi.fn(),
  getSaveWallet: vi.fn(),
  createEndpoint: vi.fn(),
}));
vi.mock('../lib/foreign-wallet/send', async (original) => ({
  ...(await original<any>()),
  sendForeignCoin: vi.fn(),
}));
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
import {
  getKeyPair,
  getSaveWallet,
  createEndpoint,
} from '../background/background';
import { ForeignSendError, sendForeignCoin } from '../lib/foreign-wallet/send';
import {
  reconcilePendingLocalForeignCoinSends,
  sendLocalForeignCoin,
} from './foreign-coin-send';

beforeEach(() => {
  const key = HDKey.fromMasterSeed(new Uint8Array(32).fill(5));
  vi.mocked(getKeyPair).mockResolvedValue({
    ltcPrivateKey: key.privateExtendedKey,
  });
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'QORT' });
  vi.mocked(createEndpoint).mockImplementation(
    async (path) => `https://node.test${path}`
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  delete window.foreignWalletJournal;
  delete window.foreignWalletSigner;
  localStorage.clear();
});
it('awaits Electron journal persistence before posting signed bytes', async () => {
  let stored: string;
  const calls: string[] = [];
  window.foreignWalletJournal = {
    get: vi.fn(async () => stored),
    set: vi.fn(async (_key, value) => {
      calls.push('persist');
      stored = value;
    }),
    delete: vi.fn(),
  } as any;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls.push('broadcast');
      return new Response('a'.repeat(64));
    })
  );
  vi.mocked(sendForeignCoin).mockImplementation(async (_request, deps) => {
    const entry = { txId: 'a'.repeat(64), outpoints: ['b'.repeat(64) + ':0'] };
    await deps.writePending(entry);
    expect(await deps.readPending()).toEqual(entry);
    await deps.post('/crosschain/ltc/send/broadcast', {
      rawTransactionHex: '01000000',
    });
    return entry.txId;
  });
  await expect(
    sendLocalForeignCoin(
      { coin: 'LTC', recipient: 'LTC', amount: '1' },
      async () => ({ accepted: true })
    )
  ).resolves.toBe('a'.repeat(64));
  expect(calls).toEqual(['persist', 'broadcast']);
  expect(localStorage.length).toBe(0);
  expect(vi.mocked(fetch).mock.calls[0][1].body).toBe(
    '{"rawTransactionHex":"01000000"}'
  );
});
it('requires upgraded Core without falling back to the private-key send API', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 }))
  );
  vi.mocked(sendForeignCoin).mockImplementation(
    async (_request, deps) =>
      deps.post('/crosschain/ltc/wallet/public/spend-context', {
        xpub58: 'public',
      }) as any
  );
  await expect(sendLocalForeignCoin({ coin: 'LTC' }, vi.fn())).rejects.toThrow(
    'question:local_send.upgrade'
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not post after the selected wallet changes', async () => {
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(sendForeignCoin).mockImplementation(async (_request, deps) => {
    vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'OTHER' });
    return deps.post('/crosschain/ltc/send/broadcast', {
      rawTransactionHex: '01000000',
    }) as any;
  });
  await expect(sendLocalForeignCoin({ coin: 'LTC' }, vi.fn())).rejects.toThrow(
    'question:local_send.changed'
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('reports when an earlier payment is still awaiting confirmation', async () => {
  vi.mocked(sendForeignCoin).mockRejectedValue(
    new ForeignSendError('confirming', 'a'.repeat(64))
  );
  await expect(sendLocalForeignCoin({ coin: 'LTC' }, vi.fn())).rejects.toThrow(
    'question:local_send.confirming'
  );
});

it('automatically clears a confirmed journal entry without exposing wallet keys', async () => {
  const keys = await getKeyPair();
  const xpub = HDKey.fromExtendedKey(keys.ltcPrivateKey).publicExtendedKey;
  const fingerprint = bytesToHex(sha256(new TextEncoder().encode(xpub)));
  const storageKey = `foreign-send-v1:LTC:${fingerprint}`;
  const txId = 'a'.repeat(64);
  localStorage.setItem(
    storageKey,
    JSON.stringify({ txId, outpoints: [`${'b'.repeat(64)}:0`] })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body as string);
      return Response.json({
        version: 1,
        currencyCode: 'LTC',
        activeNetwork: 'MAIN',
        chainId: 'bip122:12a765e31ffd4059bada1e25190f6e98',
        txId: body.txId,
        status: 'CONFIRMED',
      });
    })
  );

  await reconcilePendingLocalForeignCoinSends();

  expect(localStorage.getItem(storageKey)).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  const requestBody = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body;
  expect(requestBody).toBe(
    JSON.stringify({
      expectedChainId: 'bip122:12a765e31ffd4059bada1e25190f6e98',
      txId,
    })
  );
  expect(requestBody).not.toContain(keys.ltcPrivateKey);
  expect(requestBody).not.toContain(xpub);
});

it('routes desktop signing through native IPC without passing a private key', async () => {
  const root = HDKey.fromMasterSeed(new Uint8Array(32).fill(5));
  vi.mocked(getKeyPair).mockResolvedValue({
    ltcPublicKey: root.publicExtendedKey,
  });
  const signed = { txId: 'a'.repeat(64) };
  window.foreignWalletSigner = {
    importKeys: vi.fn(),
    clear: vi.fn(),
    publicKey: vi.fn(async () => root.publicExtendedKey),
    sign: vi.fn(async () => ({ signed: signed as any })),
  };
  vi.mocked(sendForeignCoin).mockImplementation(async (request, deps) => {
    expect(request.xprv).toBeUndefined();
    expect(request.xpub).toBe(root.publicExtendedKey);
    expect(await deps.stillValid()).toBe(true);
    expect(
      await deps.sign({ inputs: [], outputs: [] } as any, new Uint8Array([1]))
    ).toEqual(signed);
    return signed.txId;
  });
  expect(await sendLocalForeignCoin({ coin: 'LTC' }, vi.fn())).toBe(
    signed.txId
  );
  expect(
    JSON.stringify(vi.mocked(window.foreignWalletSigner.sign).mock.calls)
  ).not.toContain(root.privateExtendedKey);
});

it('uses the separate recovery approval without invoking new-payment approval', async () => {
  const approve = vi.fn();
  const approveRecovery = vi.fn(async () => ({ accepted: true }));
  vi.mocked(sendForeignCoin).mockImplementation(async (_request, deps) => {
    expect(
      await deps.approveRecovery({
        txId: 'a'.repeat(64),
        outpoints: ['b'.repeat(64) + ':0'],
        rawTransactionHex: `0100000001${'11'.repeat(32)}0000000000ffffffff0100e1f505000000001976a914${'22'.repeat(20)}88ac00000000`,
      })
    ).toBe(true);
    return 'recovery-test';
  });
  await sendLocalForeignCoin(
    { coin: 'LTC' },
    approve,
    undefined,
    undefined,
    approveRecovery
  );
  expect(approve).not.toHaveBeenCalled();
  expect(approveRecovery).toHaveBeenCalledWith(
    expect.objectContaining({
      text1: 'question:local_send.recovery',
      text2: 'a'.repeat(64),
      confirmCheckbox: true,
    })
  );
});
