// Hub payment policy. All amounts are atomic units; planning needs only an xpub.
import { CompactSize } from '@scure/btc-signer';
import {
  assertForeignWalletWatchInputBounds,
  assertForeignWalletSigningWorkBounds,
  attestForeignWalletWatchInput,
  validateForeignWalletRecipient,
  positiveAtomic,
  type ForeignWalletWatchInput,
  type ForeignWalletPaymentOutput,
  type ForeignWalletPreviousTransactionCache,
} from './foreign-wallet-transaction';
import type { ForeignWalletCoin, ForeignWalletCrypto } from './foreign-wallets';
export type ForeignWalletSpendPlan = {
  amount: bigint;
  change: bigint;
  changeAddress: string | null;
  estimatedMaximumSize: number;
  fee: bigint;
  feePerByte: bigint;
  inputAmount: bigint;
  inputs: ForeignWalletWatchInput[];
  outputAmount: bigint;
  outputs: ForeignWalletPaymentOutput[];
  recipientAddress: string;
  sendMax: boolean;
};
export function estimateMaximumForeignWalletTransactionSize(
  count: number,
  lengths: readonly number[]
) {
  assertForeignWalletSigningWorkBounds(count, lengths);
  // Compressed P2PKH: 149 bytes bounds DER signature length without relying on low-R grinding.
  return (
    8 +
    CompactSize.encode(BigInt(count)).length +
    count * 149 +
    CompactSize.encode(BigInt(lengths.length)).length +
    lengths.reduce(
      (sum, n) => sum + 8 + CompactSize.encode(BigInt(n)).length + n,
      0
    )
  );
}
export function planForeignWalletSpend(input: {
  amount?: bigint;
  payments?: readonly ForeignWalletPaymentOutput[];
  cache?: ForeignWalletPreviousTransactionCache;
  coin: ForeignWalletCoin;
  crypto?: ForeignWalletCrypto;
  feePerByte: bigint;
  minimumNonDustOutput: bigint;
  recipientAddress: string;
  xpub?: string;
  xprv?: string;
  sendMax?: boolean;
  utxos: readonly ForeignWalletWatchInput[];
}): ForeignWalletSpendPlan {
  const fail = () => {
    throw new Error('Invalid or unfunded wallet payment');
  };
  positiveAtomic(input.feePerByte);
  positiveAtomic(input.minimumNonDustOutput);
  const sendMax = input.sendMax === true;
  if (
    sendMax
      ? input.amount !== undefined || !!input.payments
      : input.amount === undefined
  )
    fail();
  const recipientAddress = validateForeignWalletRecipient({
    coin: input.coin,
    address: input.recipientAddress,
  }).address;
  const payments = input.payments
    ? input.payments.map((p) => ({ ...p }))
    : [{ address: recipientAddress, value: input.amount }];
  if (!payments.length || payments.length > 20) fail();
  if (!sendMax) {
    positiveAtomic(input.amount);
    if (payments.reduce((sum, p) => sum + p.value, 0n) !== input.amount) fail();
    payments.forEach((p) => {
      positiveAtomic(p.value);
      if (p.value < input.minimumNonDustOutput) fail();
    });
  }
  const lengths = payments.map(
    (p) =>
      validateForeignWalletRecipient({ coin: input.coin, address: p.address })
        .scriptPubKey.length
  );
  assertForeignWalletWatchInputBounds(input.utxos);
  const seen = new Set<string>();
  const candidates = input.utxos
    .map((u) => {
      const point = `${u.txHash}:${u.txPos}`;
      if (seen.has(point)) fail();
      seen.add(point);
      attestForeignWalletWatchInput({ ...input, watchInput: u });
      return { ...u };
    })
    .sort((a, b) =>
      a.value !== b.value
        ? a.value > b.value
          ? -1
          : 1
        : a.txHash.localeCompare(b.txHash) || a.txPos - b.txPos
    );
  if (!candidates.length) fail();
  const selected: ForeignWalletWatchInput[] = [];
  let inputAmount = 0n;
  const finish = (
    amount: bigint,
    fee: bigint,
    change: bigint,
    size: number
  ): ForeignWalletSpendPlan => {
    const changeAddress = change ? selected[0].address : null;
    return {
      amount,
      fee,
      change,
      changeAddress,
      estimatedMaximumSize: size,
      feePerByte: input.feePerByte,
      inputAmount,
      inputs: selected,
      outputAmount: inputAmount - fee,
      recipientAddress,
      sendMax,
      outputs: sendMax
        ? [{ address: recipientAddress, value: amount }]
        : [
            ...payments,
            ...(change ? [{ address: changeAddress, value: change }] : []),
          ],
    };
  };
  for (const u of candidates) {
    selected.push(u);
    inputAmount += u.value;
    positiveAtomic(inputAmount);
    if (sendMax && selected.length !== candidates.length) continue;
    const size = estimateMaximumForeignWalletTransactionSize(
      selected.length,
      lengths
    );
    const minimumFee = BigInt(size) * input.feePerByte;
    if (sendMax) {
      const amount = inputAmount - minimumFee;
      if (amount < input.minimumNonDustOutput) fail();
      return finish(amount, minimumFee, 0n, size);
    }
    if (inputAmount < input.amount + minimumFee) continue;
    const changeSize = estimateMaximumForeignWalletTransactionSize(
      selected.length,
      [...lengths, 25]
    );
    const fee = BigInt(changeSize) * input.feePerByte;
    const change = inputAmount - input.amount - fee;
    if (change >= input.minimumNonDustOutput)
      return finish(input.amount, fee, change, changeSize);
    return finish(input.amount, inputAmount - input.amount, 0n, size);
  }
  return fail();
}
