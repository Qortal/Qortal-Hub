import { describe, it, expect, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import { hex } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { Transaction, p2pkh } from '@scure/btc-signer';
import {
  createDesktopWalletSigner,
  desktopWalletTranslations,
} from './desktop-engine';
import {
  foreignCoins,
  walletVersions,
  deriveForeignWalletLeafPublicData,
} from './foreign-wallets';
import {
  prepareForeignWalletPsbt,
  signForeignWalletPsbt,
  inspectSignedTransaction,
  validateForeignWalletRecipient,
} from './foreign-wallet-transaction';
import { normalizeForeignWalletSpendContext } from './foreign-wallet-spend-context';

const roots = Object.fromEntries(
  foreignCoins.map((coin) => [
    coin,
    HDKey.fromMasterSeed(new Uint8Array(32).fill(9), walletVersions(coin)),
  ])
);
const keys = Object.fromEntries(
  foreignCoins.map((coin) => [
    `${coin.toLowerCase()}PrivateKey`,
    roots[coin].privateExtendedKey,
  ])
);
function fixture(coin: (typeof foreignCoins)[number] = 'LTC') {
  const xprv = roots[coin].privateExtendedKey;
  const xpub = roots[coin].publicExtendedKey;
  const leaf = deriveForeignWalletLeafPublicData({
    coin,
    xpub,
    chain: 0,
    index: 0,
  });
  const scriptPubKey = hex.encode(p2pkh(leaf.publicKey).script);
  const previousTransactionHex = `0100000001${'11'.repeat(32)}0000000000ffffffff0100ca9a3b0000000019${scriptPubKey}00000000`;
  const txHash = hex.encode(
    sha256(sha256(hex.decode(previousTransactionHex))).reverse()
  );
  const inputs = [
    {
      address: leaf.address,
      height: 100,
      path: 'M/0/0',
      previousTransactionHex,
      scriptPubKey,
      txHash,
      txPos: 0,
      value: 1000000000n,
    },
  ];
  const outputs = [{ address: leaf.address, value: 999990000n }];
  const request = { coin, xpub, inputs, outputs };
  return { ...request, xprv, psbt: prepareForeignWalletPsbt(request) };
}
describe('PSBT and isolated desktop signing', () => {
  it.each(foreignCoins)(
    '%s includes full previous transactions and public derivation metadata',
    (coin) => {
      const f = fixture(coin);
      const tx = Transaction.fromPSBT(f.psbt);
      expect(tx.getInput(0).nonWitnessUtxo).toBeDefined();
      expect(tx.getInput(0).bip32Derivation[0][1]).toEqual({
        fingerprint: roots[coin].fingerprint,
        path: [0, 0],
      });
      expect(tx.getInput(0).sighashType).toBe(1);
      const signed = signForeignWalletPsbt(f, f.psbt);
      expect(inspectSignedTransaction(signed.rawTransactionHex)).toEqual({
        txId: signed.txId,
        outpoints: [`${f.inputs[0].txHash}:0`],
      });
    }
  );
  it('refuses altered outputs, sighash flags, version, and added PSBT metadata', () => {
    const f = fixture();
    for (const mutate of [
      (tx: Transaction) => tx.updateOutput(0, { amount: 999980000n }),
      (tx: Transaction) => tx.updateInput(0, { sighashType: 2 }),
      (tx: Transaction) => tx.updateInput(0, { sequence: 0xfffffffe }),
      (tx: Transaction) =>
        tx.updateInput(0, {
          bip32Derivation: [
            [
              new Uint8Array([2, ...new Uint8Array(32).fill(1)]),
              { fingerprint: 1, path: [0, 0] },
            ],
          ],
        }),
    ]) {
      const tx = Transaction.fromPSBT(f.psbt);
      mutate(tx);
      expect(() => signForeignWalletPsbt(f, tx.toPSBT())).toThrow();
    }
    expect(() =>
      prepareForeignWalletPsbt({ ...f, transactionVersion: 2 })
    ).toThrow();
  });
  it('rejects missing previous bytes, forged scripts, duplicate inputs and wrong paths', () => {
    const f = fixture();
    for (const change of [
      { previousTransactionHex: '' },
      { value: 1n },
      { scriptPubKey: '00'.repeat(25) },
      { path: 'M/0/2147483648' },
      { txPos: 1 },
      { height: 0 },
    ])
      expect(() =>
        prepareForeignWalletPsbt({
          ...f,
          inputs: [{ ...f.inputs[0], ...change }],
        })
      ).toThrow();
    expect(() =>
      prepareForeignWalletPsbt({ ...f, inputs: [f.inputs[0], f.inputs[0]] })
    ).toThrow();
  });
  it('does not accept Bitcoin witness recipients for Dogecoin or Ravencoin', () => {
    const f = fixture('BTC');
    expect(() =>
      validateForeignWalletRecipient({
        coin: 'LTC',
        address: f.outputs[0].address,
      })
    ).toThrow();
    for (const coin of ['DOGE', 'RVN'] as const)
      expect(() =>
        validateForeignWalletRecipient({
          coin,
          address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        })
      ).toThrow();
  });
  it('returns public keys only and requires native approval for every signature', async () => {
    const signer = createDesktopWalletSigner();
    const f = fixture();
    expect(signer.importKeys(keys)).toEqual(
      Object.fromEntries(
        foreignCoins.map((coin) => [coin, roots[coin].publicExtendedKey])
      )
    );
    const approve = vi.fn(async () => false);
    const request = {
      coin: f.coin,
      xpub: f.xpub,
      inputs: f.inputs,
      outputs: f.outputs,
      psbtHex: hex.encode(f.psbt),
    };
    await expect(signer.sign(request, approve)).rejects.toThrow();
    expect(approve).toHaveBeenCalledOnce();
    const signed = await signer.sign(request, async (details) => {
      expect(details.fee).toBe(10000n);
      expect(details.outputs).toEqual(f.outputs);
      return true;
    });
    expect(signed.txId).toMatch(/^[a-f0-9]{64}$/);
    signer.clear();
    expect(() => signer.publicKey('LTC')).toThrow();
    await expect(signer.sign(request, approve)).rejects.toThrow();
    expect(approve).toHaveBeenCalledOnce();
  });
  it('binds approval to an immutable snapshot and cancels on logout or account replacement', async () => {
    const f = fixture();
    const signer = createDesktopWalletSigner();
    signer.importKeys(keys);
    const request = { ...f, psbtHex: hex.encode(f.psbt) };
    const signed = await signer.sign(request, async () => {
      request.outputs[0].value = 1n;
      return true;
    });
    expect(signed.outputAmount).toBe(999990000n);
    const next = fixture();
    const req = { ...next, psbtHex: hex.encode(next.psbt) };
    await expect(
      signer.sign(req, async () => {
        signer.clear();
        return true;
      })
    ).rejects.toThrow();
    signer.importKeys(keys);
    await expect(
      signer.sign(req, async () => {
        signer.importKeys(keys);
        return true;
      })
    ).rejects.toThrow();
  });
  it('rejects concurrent approvals and tampering before showing the native dialog', async () => {
    const f = fixture();
    const signer = createDesktopWalletSigner();
    signer.importKeys(keys);
    const req = { ...f, psbtHex: hex.encode(f.psbt) };
    const approve = vi.fn(async () => true);
    await expect(
      signer.sign({ ...req, psbtHex: req.psbtHex + '00' }, approve)
    ).rejects.toThrow();
    expect(approve).not.toHaveBeenCalled();
    await signer.sign(req, async () => {
      await expect(signer.sign(req, approve)).rejects.toThrow();
      return true;
    });
  });
  it('provides localized native confirmations and falls back for unknown languages', () => {
    expect(
      desktopWalletTranslations('de').t('question:local_send.native_title')
    ).toBe('Wallet-Zahlung bestätigen');
    expect(
      desktopWalletTranslations('unsupported').t(
        'question:local_send.native_title'
      )
    ).toBe('Confirm wallet payment');
  });
  it('rejects unsupported public context contracts', () => {
    for (const input of [
      null,
      {},
      { version: 1, currencyCode: 'LTC', chainId: 'wrong' },
    ])
      expect(() => normalizeForeignWalletSpendContext(input, 'LTC')).toThrow();
  });
});
it('accepts the intended address formats while rejecting unsupported Taproot outputs', async () => {
  const { Address, OutScript, p2tr } = await import('@scure/btc-signer');
  const hash = new Uint8Array(20).fill(3);
  const legacy = Address({
    pubKeyHash: 48,
    scriptHash: 5,
    bech32: 'ltc',
    wif: 176,
  }).encode({ type: 'sh', hash });
  const current = Address({
    pubKeyHash: 48,
    scriptHash: 50,
    bech32: 'ltc',
    wif: 176,
  }).encode({ type: 'sh', hash });
  expect(
    validateForeignWalletRecipient({ coin: 'LTC', address: legacy })
      .scriptPubKey
  ).toEqual(
    validateForeignWalletRecipient({ coin: 'LTC', address: current })
      .scriptPubKey
  );
  for (const [coin, bech32] of [
    ['BTC', 'bc'],
    ['LTC', 'ltc'],
    ['DGB', 'dgb'],
  ] as const) {
    const address = Address({
      pubKeyHash: 0,
      scriptHash: 5,
      bech32,
      wif: 128,
    }).encode({ type: 'wpkh', hash });
    expect(
      validateForeignWalletRecipient({ coin, address }).scriptPubKey
    ).toEqual(OutScript.encode({ type: 'wpkh', hash }));
  }
  const taproot = p2tr(roots.BTC.publicKey.slice(1));
  expect(() =>
    validateForeignWalletRecipient({ coin: 'BTC', address: taproot.address })
  ).toThrow();
});
it('uses the non-witness transaction ID when spending a P2PKH output funded by a witness transaction', () => {
  const f = fixture();
  const original = f.inputs[0].previousTransactionHex;
  const previousTransactionHex =
    original.slice(0, 8) +
    '0001' +
    original.slice(8, -8) +
    '010101' +
    original.slice(-8);
  const inputs = [{ ...f.inputs[0], previousTransactionHex }];
  expect(() => prepareForeignWalletPsbt({ ...f, inputs })).not.toThrow();
});
