vi.unmock('asmcrypto.js');
vi.unmock('asmcrypto.js/asmcrypto.all.js');
import { describe, expect, it, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { base58check } from '@scure/base';
import {
  foreignCrypto,
  foreignCoins,
  deriveForeignWalletLeafPublicData,
  walletPublicKey,
} from './foreign-wallets';
import { buildForeignWalletSignedTransaction } from './foreign-wallet-transaction';
import {
  sendForeignCoin,
  reconcilePendingForeignCoin,
  atomicAmount,
  type PendingSend,
} from './send';
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';

function uint64Le(value: bigint) {
  return Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt(index * 8)) & 0xffn)
      .toString(16)
      .padStart(2, '0')
  ).join('');
}

function fixture(
  coin: (typeof foreignCoins)[number],
  inputValue = 1000000000n,
  fundingMarker = '11'
) {
  const wallet = new PhraseWallet(new Uint8Array(32).fill(7), 2);
  const original = wallet.addresses[0][`${coin.toLowerCase()}Wallet`];
  const xprv = original.derivedMasterPrivateKey;
  const leaf = deriveForeignWalletLeafPublicData({
    xprv,
    coin,
    crypto: foreignCrypto,
    chain: 0,
    index: 0,
  });
  const script = `76a914${bytesToHex(ripemd160(sha256(leaf.publicKey)))}88ac`;
  // Non-coinbase funding fixture paying the requested value to the Hub wallet.
  const previousTransactionHex = `0100000001${fundingMarker.repeat(32)}0000000000ffffffff01${uint64Le(inputValue)}19${script}00000000`;
  const txHash = bytesToHex(
    sha256(
      sha256(
        Uint8Array.from(
          previousTransactionHex.match(/../g)!.map((v) => parseInt(v, 16))
        )
      )
    ).reverse()
  );
  const input = {
    address: leaf.address,
    height: 100,
    path: 'M/0/0',
    previousTransactionHex,
    scriptPubKey: script,
    txHash,
    txPos: 0,
    value: inputValue,
  };
  const context = {
    version: 1,
    blockchain: {
      BTC: 'BITCOIN',
      LTC: 'LITECOIN',
      DOGE: 'DOGECOIN',
      DGB: 'DIGIBYTE',
      RVN: 'RAVENCOIN',
    }[coin],
    currencyCode: coin,
    activeNetwork: 'MAIN',
    chainId: getForeignWalletMainnetChainId(coin),
    tipHeight: 200,
    confirmedOnly: true,
    transactionFormat: 'LEGACY',
    transactionVersion: 1,
    sighashType: 1,
    sequence: 0xffffffff,
    lockTime: 0,
    minimumNonDustOutput: '546',
    recommendedFeePerByte: '10',
    previousTransactions: { [txHash]: previousTransactionHex },
    utxos: [
      {
        ...input,
        path: [0, 0],
        pathAsString: input.path,
        outputIndex: input.txPos,
        scriptPubKeyHex: input.scriptPubKey,
        value: input.value.toString(),
      },
    ],
  };
  return { xprv, original, leaf, input, context };
}

function transactionStatus(
  coin: (typeof foreignCoins)[number],
  txId: string,
  status: 'UNKNOWN' | 'MEMPOOL' | 'CONFIRMED'
) {
  return {
    version: 1,
    currencyCode: coin,
    activeNetwork: 'MAIN',
    chainId: getForeignWalletMainnetChainId(coin),
    txId,
    status,
  };
}

describe('local foreign wallet signing', () => {
  for (const coin of foreignCoins) {
    it(`${coin}: preserves existing Hub derivation and signs valid input scripts`, async () => {
      const { xprv, original, leaf, input } = fixture(coin);
      expect(walletPublicKey(xprv, coin)).toBe(original.derivedMasterPublicKey);
      expect(leaf.address).toBe(original.address);
      const result = buildForeignWalletSignedTransaction({
        coin,
        xprv,
        crypto: foreignCrypto,
        inputs: [input],
        outputs: [{ address: leaf.address, value: 999990000n }],
      });
      expect(result.fee).toBe(10000n);
      expect(result.rawTransactionHex).not.toContain(xprv);
      expect(result.txId).toMatch(/^[a-f0-9]{64}$/);
      // Independent bitcoinj validation consumes these fixtures in Core tests.
      if (process.env.FOREIGN_FIXTURE_DIR) {
        const fs = await import('node:fs');
        fs.writeFileSync(
          `${process.env.FOREIGN_FIXTURE_DIR}/${coin}.json`,
          JSON.stringify({
            coin,
            xprv,
            publicKey: bytesToHex(leaf.publicKey),
            raw: result.rawTransactionHex,
            previous: input.previousTransactionHex,
            txId: result.txId,
          })
        );
      }
    });
  }
  it('plans multiple trade outputs, change and send-max without floating point fees', async () => {
    const { planForeignWalletSpend } =
      await import('./foreign-wallet-spend-plan');
    const { xprv, leaf, input } = fixture('LTC');
    const secondAddress = deriveForeignWalletLeafPublicData({
      coin: 'LTC',
      xprv,
      crypto: foreignCrypto,
      chain: 1,
      index: 7,
    }).address;
    const common = {
      coin: 'LTC' as const,
      xprv,
      crypto: foreignCrypto,
      feePerByte: 30n,
      minimumNonDustOutput: 100000n,
      utxos: [input],
      recipientAddress: leaf.address,
    };
    const payments = [
      { address: leaf.address, value: 100000000n },
      { address: secondAddress, value: 200000000n },
    ];
    const plan = planForeignWalletSpend({
      ...common,
      amount: 300000000n,
      payments,
    });
    expect(plan.outputs.slice(0, 2)).toEqual(payments);
    expect(plan.outputs).toHaveLength(3);
    expect(plan.amount + plan.change + plan.fee).toBe(input.value);
    const signed = buildForeignWalletSignedTransaction({
      ...common,
      inputs: plan.inputs,
      outputs: plan.outputs,
    });
    expect(signed.fee).toBe(plan.fee);
    expect(signed.transactionSize).toBeLessThanOrEqual(
      plan.estimatedMaximumSize
    );
    const max = planForeignWalletSpend({ ...common, sendMax: true });
    expect(max.change).toBe(0n);
    expect(max.amount + max.fee).toBe(input.value);
    expect(() => planForeignWalletSpend({ ...common, amount: 1n })).toThrow();
  });
  it('uses current chain policy instead of stale altcoinj change constants', async () => {
    const { planForeignWalletSpend } =
      await import('./foreign-wallet-spend-plan');
    const p2shRecipient = base58check(sha256).encode(
      Uint8Array.from([50, ...new Uint8Array(20).fill(9)])
    );
    const single = fixture('LTC', 42946194n, '12');
    const common = {
      coin: 'LTC' as const,
      xprv: single.xprv,
      crypto: foreignCrypto,
      feePerByte: 10n,
      // This is the stale value currently returned by altcoinj through Core.
      minimumNonDustOutput: 100000n,
      recipientAddress: p2shRecipient,
    };
    const singlePlan = planForeignWalletSpend({
      ...common,
      amount: 42921000n,
      utxos: [single.input],
    });
    expect(singlePlan.fee).toBe(2250n);
    expect(singlePlan.change).toBe(22944n);
    expect(singlePlan.outputs).toHaveLength(2);
    expect(
      buildForeignWalletSignedTransaction({
        coin: 'LTC',
        xprv: single.xprv,
        crypto: foreignCrypto,
        inputs: singlePlan.inputs,
        outputs: singlePlan.outputs,
      }).fee
    ).toBe(singlePlan.fee);
    const dustPlan = planForeignWalletSpend({
      ...common,
      amount: single.input.value - 2500n,
      utxos: [single.input],
    });
    expect(dustPlan.fee).toBe(2500n);
    expect(dustPlan.change).toBe(0n);
    expect(dustPlan.outputs).toHaveLength(1);

    const multiple = [
      fixture('LTC', 5000000n, '13'),
      fixture('LTC', 4900000n, '14'),
      fixture('LTC', 9811n, '15'),
    ];
    const multiplePlan = planForeignWalletSpend({
      ...common,
      amount: 9901000n,
      utxos: multiple.map(({ input }) => input),
    });
    expect(multiplePlan.inputs).toHaveLength(3);
    expect(multiplePlan.fee).toBe(8811n);
    expect(multiplePlan.change).toBe(0n);
    expect(multiplePlan.outputs).toHaveLength(1);
    expect(
      buildForeignWalletSignedTransaction({
        coin: 'LTC',
        xprv: single.xprv,
        crypto: foreignCrypto,
        inputs: multiplePlan.inputs,
        outputs: multiplePlan.outputs,
      }).fee
    ).toBe(multiplePlan.fee);

    const policies = [
      ['BTC', 546n, 546n],
      ['LTC', 100000n, 5460n],
      ['DOGE', 100000000n, 1000000n],
      ['DGB', 546n, 5460n],
      ['RVN', 2730n, 546n],
    ] as const;
    for (const [coin, reportedMinimum, minimumChange] of policies) {
      const wallet = fixture(coin);
      const exactPlan = planForeignWalletSpend({
        coin,
        xprv: wallet.xprv,
        crypto: foreignCrypto,
        feePerByte: 10n,
        minimumNonDustOutput: reportedMinimum,
        recipientAddress: wallet.leaf.address,
        amount: wallet.input.value - 2270n - minimumChange,
        utxos: [wallet.input],
      });
      expect(exactPlan.change, coin).toBe(minimumChange);
      expect(exactPlan.fee, coin).toBe(2270n);

      expect(
        planForeignWalletSpend({
          coin,
          xprv: wallet.xprv,
          crypto: foreignCrypto,
          feePerByte: 10n,
          minimumNonDustOutput: reportedMinimum,
          recipientAddress: wallet.leaf.address,
          amount: minimumChange,
          utxos: [wallet.input],
        }).amount,
        coin
      ).toBe(minimumChange);
      expect(() =>
        planForeignWalletSpend({
          coin,
          xprv: wallet.xprv,
          crypto: foreignCrypto,
          feePerByte: 10n,
          minimumNonDustOutput: reportedMinimum,
          recipientAddress: wallet.leaf.address,
          amount: minimumChange - 1n,
          utxos: [wallet.input],
        })
      ).toThrow();

      const belowPlan = planForeignWalletSpend({
        coin,
        xprv: wallet.xprv,
        crypto: foreignCrypto,
        feePerByte: 10n,
        minimumNonDustOutput: reportedMinimum,
        recipientAddress: wallet.leaf.address,
        amount: wallet.input.value - 2270n - minimumChange + 1n,
        utxos: [wallet.input],
      });
      expect(belowPlan.change, coin).toBe(0n);
      expect(belowPlan.outputs, coin).toHaveLength(1);
    }
  }, 15000);
  it('does not broadcast when journal persistence fails', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    let broadcasts = 0;
    const deps = {
      approve: async () => true,
      stillValid: async () => true,
      readPending: async () => null,
      writePending: async () => {
        throw new Error('disk failure');
      },
      post: async (path: string) => {
        if (path.endsWith('/send/broadcast')) broadcasts++;
        return context;
      },
    };
    await expect(
      sendForeignCoin(
        { coin: 'LTC', xprv, amount: '1', recipient: leaf.address },
        deps
      )
    ).rejects.toThrow('disk failure');
    expect(broadcasts).toBe(0);
  });
  it('retains a reservation while the exact transaction is in the mempool', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    let pending: PendingSend = null;
    const deps = {
      approve: async () => true,
      stillValid: async () => true,
      readPending: async () => pending,
      writePending: async (value: PendingSend) => {
        pending = value;
      },
      post: async (path: string, body: any) =>
        path.endsWith('/send/broadcast')
          ? pending.txId
          : path.endsWith('transaction-status')
            ? transactionStatus('LTC', body.txId, 'MEMPOOL')
            : context,
    };
    const req = {
      coin: 'LTC' as const,
      xprv,
      amount: '1',
      recipient: leaf.address,
    };
    const txId = await sendForeignCoin(req, deps);
    expect(pending.txId).toBe(txId);
    await expect(sendForeignCoin(req, deps)).rejects.toMatchObject({
      code: 'confirming',
      txId,
    });
    expect(pending.txId).toBe(txId);
  });
  it('clears a confirmed old payment and asks normally about the current one', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    let pending: PendingSend = null;
    let status: 'UNKNOWN' | 'CONFIRMED' = 'UNKNOWN';
    const approve = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const post = vi.fn(async (path: string, body: any) => {
      if (path.endsWith('/send/broadcast')) return pending.txId;
      if (path.endsWith('transaction-status'))
        return transactionStatus('LTC', body.txId, status);
      return context;
    });
    const deps = {
      approve,
      stillValid: async () => true,
      readPending: async () => pending,
      writePending: async (value: PendingSend) => {
        pending = value;
      },
      post,
    };
    const req = {
      coin: 'LTC' as const,
      xprv,
      amount: '1',
      recipient: leaf.address,
    };
    const previousTxId = await sendForeignCoin(req, deps);
    status = 'CONFIRMED';

    await expect(sendForeignCoin(req, deps)).rejects.toMatchObject({
      code: 'declined',
    });
    expect(pending).toBeNull();
    expect(approve).toHaveBeenCalledTimes(2);
    expect(
      post.mock.calls.filter(([path]) => path.endsWith('/send/broadcast'))
    ).toHaveLength(1);
  });
  it('rejects forged amounts and previous transactions', () => {
    const { xprv, leaf, input } = fixture('LTC');
    for (const changed of [
      { ...input, value: input.value + 1n },
      {
        ...input,
        previousTransactionHex: input.previousTransactionHex.replace(
          '00ca9a3b',
          '01ca9a3b'
        ),
      },
      { ...input, path: 'M/1/0' },
    ]) {
      expect(() =>
        buildForeignWalletSignedTransaction({
          coin: 'LTC',
          xprv,
          crypto: foreignCrypto,
          inputs: [changed],
          outputs: [{ address: leaf.address, value: 100000n }],
        })
      ).toThrow();
    }
  });
  it('accepts existing numeric fee values and rejects fractional atomic units', () => {
    expect(atomicAmount(0.0000003)).toBe(30n);
    expect(atomicAmount('0.00000001')).toBe(1n);
    for (const raw of [0, -1, NaN, Infinity, '1e3', '0.000000001', 0.000000001])
      expect(() => atomicAmount(raw)).toThrow();
  });
  it('honors an explicit fee below the Core recommendation', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    const approve = vi.fn(async () => false);

    await expect(
      sendForeignCoin(
        {
          coin: 'LTC',
          xprv,
          amount: '0.07',
          recipient: leaf.address,
          fee: '0.00000009',
        },
        {
          post: async () => context,
          stillValid: async () => true,
          approve,
          readPending: async () => null,
          writePending: vi.fn(),
        }
      )
    ).rejects.toMatchObject({ code: 'declined' });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 7000000n,
        feePerByte: 9n,
      })
    );
  });
  it('keeps an explicit fee when the Core recommendation changes', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    let pending: PendingSend = null;
    let reads = 0;
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/send/broadcast')) return pending.txId;
      reads++;
      return reads === 1
        ? context
        : { ...context, recommendedFeePerByte: '11' };
    });

    const txId = await sendForeignCoin(
      {
        coin: 'LTC',
        xprv,
        amount: '0.07',
        recipient: leaf.address,
        fee: '0.00000009',
      },
      {
        post,
        stillValid: async () => true,
        approve: async () => true,
        readPending: async () => null,
        writePending: async (value) => {
          pending = value;
        },
      }
    );

    expect(txId).toBe(pending.txId);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it('still rejects an explicit fee above the local safety ceiling', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    const approve = vi.fn(async () => true);

    await expect(
      sendForeignCoin(
        {
          coin: 'LTC',
          xprv,
          amount: '0.07',
          recipient: leaf.address,
          fee: '0.00020001',
        },
        {
          post: async () => context,
          stillValid: async () => true,
          approve,
          readPending: async () => null,
          writePending: vi.fn(),
        }
      )
    ).rejects.toThrow('Wallet fee policy exceeded');
    expect(approve).not.toHaveBeenCalled();
  });
  it('retains ambiguous broadcasts and never sends the key to Core', async () => {
    const { xprv, leaf, context } = fixture('LTC');
    let pending: PendingSend = null;
    let broadcasts = 0;
    const bodies: string[] = [];
    const deps = {
      stillValid: async () => true,
      approve: async () => true,
      readPending: async () => pending,
      writePending: async (value: PendingSend) => {
        pending = value;
      },
      post: async (path: string, body: unknown) => {
        bodies.push(JSON.stringify(body));
        if (path.endsWith('spend-context')) return context;
        if (path.endsWith('transaction-status'))
          return transactionStatus('LTC', pending.txId, 'UNKNOWN');
        broadcasts++;
        throw new Error('timeout');
      },
    };
    const req = {
      coin: 'LTC' as const,
      xprv,
      amount: '1',
      recipient: leaf.address,
    };
    await expect(sendForeignCoin(req, deps)).rejects.toMatchObject({
      code: 'unknown',
    });
    expect(pending?.txId).toMatch(/^[a-f0-9]{64}$/);
    await expect(sendForeignCoin(req, deps)).rejects.toMatchObject({
      code: 'pending',
    });
    expect(broadcasts).toBe(1);
    expect(bodies.join('')).not.toContain(xprv);
  });
  it('refuses a changed wallet after approval without broadcasting', async () => {
    const { xprv, leaf, context } = fixture('BTC');
    const deps = {
      post: async () => context,
      stillValid: async () => false,
      approve: async () => true,
      readPending: async () => null,
      writePending: async () => {
        throw new Error('must not stage');
      },
    };
    await expect(
      sendForeignCoin(
        { coin: 'BTC', xprv, amount: '1', recipient: leaf.address },
        deps
      )
    ).rejects.toMatchObject({ code: 'changed' });
  });
});

it('recovers only the identical persisted bytes and never reports an old payment as a new send', async () => {
  const { xprv, leaf, context } = fixture('LTC');
  let pending: PendingSend = null;
  const sent: unknown[] = [];
  let allowBroadcast = false;
  const deps = {
    stillValid: async () => true,
    approve: vi.fn(async () => true),
    approveRecovery: vi.fn(async () => true),
    readPending: async () => pending,
    writePending: async (value: PendingSend) => {
      pending = value;
    },
    post: async (path: string, body: any) => {
      if (path.endsWith('spend-context')) return context;
      if (path.endsWith('transaction-status'))
        return transactionStatus('LTC', pending.txId, 'UNKNOWN');
      sent.push(body);
      if (!allowBroadcast) throw new Error('lost connection');
      return pending.txId;
    },
  };
  const request = {
    coin: 'LTC' as const,
    xprv,
    recipient: leaf.address,
    amount: '1',
  };
  await expect(sendForeignCoin(request, deps)).rejects.toMatchObject({
    code: 'unknown',
  });
  expect(pending.rawTransactionHex).toBeTruthy();
  allowBroadcast = true;
  await expect(
    sendForeignCoin({ ...request, amount: '2' }, deps)
  ).rejects.toMatchObject({ code: 'pending' });
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(deps.approve).toHaveBeenCalledOnce();
  expect(deps.approveRecovery).toHaveBeenCalledOnce();
});
it('rejects corrupt recovery bytes and respects expired trade funding deadlines', async () => {
  const { xprv, leaf, input } = fixture('LTC');
  const signed = buildForeignWalletSignedTransaction({
    coin: 'LTC',
    xprv,
    inputs: [input],
    outputs: [{ address: leaf.address, value: 999990000n }],
  });
  const approveRecovery = vi.fn(async () => true);
  const post = vi.fn(async (_path: string, body: any) =>
    transactionStatus('LTC', body.txId, 'UNKNOWN')
  );
  for (const entry of [
    { txId: 'a'.repeat(64), rawTransactionHex: signed.rawTransactionHex },
    {
      txId: signed.txId,
      rawTransactionHex: signed.rawTransactionHex,
      broadcastBefore: Date.now() - 1000,
    },
  ]) {
    await expect(
      sendForeignCoin(
        { coin: 'LTC', xprv, recipient: leaf.address, amount: '1' },
        {
          stillValid: async () => true,
          approve: async () => true,
          approveRecovery,
          post,
          readPending: async () => ({
            ...entry,
            outpoints: [`${input.txHash}:0`],
          }),
          writePending: vi.fn(),
        }
      )
    ).rejects.toMatchObject({ code: 'pending' });
  }
  expect(approveRecovery).not.toHaveBeenCalled();
  expect(
    post.mock.calls.every(([path]) => path.endsWith('transaction-status'))
  ).toBe(true);
});

it('background reconciliation clears only a confirmed exact transaction', async () => {
  const { xprv } = fixture('LTC');
  const xpub = walletPublicKey(xprv, 'LTC');
  const txId = 'a'.repeat(64);
  let pending: PendingSend = {
    txId,
    outpoints: [`${'b'.repeat(64)}:0`],
  };
  const writePending = vi.fn(async (value: PendingSend) => {
    pending = value;
  });
  const state = await reconcilePendingForeignCoin('LTC', xpub, {
    stillValid: async () => true,
    readPending: async () => pending,
    writePending,
    post: async (_path, body: any) =>
      transactionStatus('LTC', body.txId, 'CONFIRMED'),
  });
  expect(state).toBe('confirmed');
  expect(pending).toBeNull();
  expect(writePending).toHaveBeenCalledWith(null);
});

it.each(['UNKNOWN', 'MEMPOOL'] as const)(
  'background reconciliation keeps a %s transaction reserved',
  async (status) => {
    const { xprv } = fixture('LTC');
    const xpub = walletPublicKey(xprv, 'LTC');
    const pending: PendingSend = {
      txId: 'a'.repeat(64),
      outpoints: [`${'b'.repeat(64)}:0`],
    };
    const writePending = vi.fn();
    expect(
      await reconcilePendingForeignCoin('LTC', xpub, {
        stillValid: async () => true,
        readPending: async () => pending,
        writePending,
        post: async (_path, body: any) =>
          transactionStatus('LTC', body.txId, status),
      })
    ).toBe(status.toLowerCase());
    expect(writePending).not.toHaveBeenCalled();
  }
);

it('does not clear a confirmed reservation after the wallet or Core changes', async () => {
  const { xprv } = fixture('LTC');
  const xpub = walletPublicKey(xprv, 'LTC');
  const pending: PendingSend = {
    txId: 'a'.repeat(64),
    outpoints: [`${'b'.repeat(64)}:0`],
  };
  const writePending = vi.fn();
  expect(
    await reconcilePendingForeignCoin('LTC', xpub, {
      stillValid: async () => false,
      readPending: async () => pending,
      writePending,
      post: async (_path, body: any) =>
        transactionStatus('LTC', body.txId, 'CONFIRMED'),
    })
  ).toBe('unknown');
  expect(writePending).not.toHaveBeenCalled();
});

it('rejects a transaction-status response for a different transaction', async () => {
  const { xprv } = fixture('LTC');
  const xpub = walletPublicKey(xprv, 'LTC');
  const pending: PendingSend = {
    txId: 'a'.repeat(64),
    outpoints: [`${'b'.repeat(64)}:0`],
  };
  const writePending = vi.fn();
  await expect(
    reconcilePendingForeignCoin('LTC', xpub, {
      stillValid: async () => true,
      readPending: async () => pending,
      writePending,
      post: async () => transactionStatus('LTC', 'c'.repeat(64), 'CONFIRMED'),
    })
  ).rejects.toMatchObject({ code: 'invalid' });
  expect(writePending).not.toHaveBeenCalled();
});

it('plans with only a public key when using the isolated signer', async () => {
  const { xprv, leaf, context } = fixture('LTC');
  let pending: PendingSend = null;
  const sign = vi.fn(async (plan, psbt) => {
    const { signForeignWalletPsbt } =
      await import('./foreign-wallet-transaction');
    return signForeignWalletPsbt(
      { coin: 'LTC', xprv, inputs: plan.inputs, outputs: plan.outputs },
      psbt
    );
  });
  const result = await sendForeignCoin(
    {
      coin: 'LTC',
      xpub: walletPublicKey(xprv, 'LTC'),
      recipient: leaf.address,
      amount: '1',
    },
    {
      sign,
      stillValid: async () => true,
      approve: async () => true,
      readPending: async () => null,
      writePending: async (value) => {
        pending = value;
      },
      post: async (path) =>
        path.endsWith('/send/broadcast') ? pending.txId : context,
    }
  );
  expect(result).toBe(pending.txId);
  expect(sign).toHaveBeenCalledOnce();
  expect(
    JSON.stringify(sign.mock.calls, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    )
  ).not.toContain(xprv);
});

it('rejects a private extended key mislabeled as xpub before making any network request', async () => {
  const { xprv, leaf } = fixture('LTC');
  const post = vi.fn();
  await expect(
    sendForeignCoin(
      { coin: 'LTC', xpub: xprv, recipient: leaf.address, amount: '1' },
      {
        post,
        stillValid: async () => true,
        approve: async () => true,
        readPending: async () => null,
        writePending: vi.fn(),
      }
    )
  ).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

it('rejects a busy cross-tab lock without queuing another send', async () => {
  const { xprv, leaf } = fixture('LTC');
  const post = vi.fn();
  const requestLock = vi.fn(async (_name, options, callback) => {
    expect(options).toEqual({ ifAvailable: true });
    return callback(null);
  });
  vi.stubGlobal('navigator', { locks: { request: requestLock } });
  try {
    await expect(
      sendForeignCoin(
        { coin: 'LTC', xprv, amount: '1', recipient: leaf.address },
        { post } as any
      )
    ).rejects.toMatchObject({ code: 'pending' });
    expect(post).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('retains signed bytes but does not broadcast if a trade expires during persistence', async () => {
  const { xprv, leaf, context } = fixture('LTC');
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  let saved: PendingSend;
  const post = vi.fn(async () => context);
  try {
    await expect(
      sendForeignCoin(
        {
          coin: 'LTC',
          xprv,
          amount: '1',
          recipient: leaf.address,
          broadcastBefore: now + 1000,
        },
        {
          post,
          approve: async () => true,
          stillValid: async () => true,
          readPending: async () => null,
          writePending: async (entry) => {
            saved = entry;
            clock.mockReturnValue(now + 1001);
          },
        }
      )
    ).rejects.toMatchObject({ code: 'changed' });
    expect(saved.rawTransactionHex).toBeTruthy();
    expect(post.mock.calls).toHaveLength(2);
  } finally {
    clock.mockRestore();
  }
});

it('does not sign or broadcast when the normal Hub permission is declined', async () => {
  const { xprv, leaf, context } = fixture('LTC');
  const sign = vi.fn();
  const writePending = vi.fn();
  const post = vi.fn(async () => context);
  await expect(
    sendForeignCoin(
      { coin: 'LTC', xprv, amount: '1', recipient: leaf.address },
      {
        post,
        sign,
        writePending,
        readPending: async () => null,
        stillValid: async () => true,
        approve: async () => false,
      }
    )
  ).rejects.toMatchObject({ code: 'declined' });
  expect(sign).not.toHaveBeenCalled();
  expect(writePending).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1);
});
