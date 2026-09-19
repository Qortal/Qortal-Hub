// Internal errors are mapped to localized messages at the application boundary.
import { Address, OutScript, Transaction, p2pkh } from '@scure/btc-signer';
import { hex } from '@scure/base';
import {
  deriveForeignWalletLeafPublicData,
  withForeignWalletLeaf,
  walletPublicKey,
  walletFingerprint,
  type ForeignWalletCoin,
  type ForeignWalletCrypto,
} from './foreign-wallets';

export type ForeignWalletOutputType = 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2WSH';
export type ForeignWalletRecipient = {
  address: string;
  outputType: ForeignWalletOutputType;
  scriptPubKey: Uint8Array;
};
export type ForeignWalletWatchInput = {
  address: string;
  height: number;
  path: string;
  previousTransactionHex: string;
  scriptPubKey: string;
  txHash: string;
  txPos: number;
  value: bigint;
};
export type ForeignWalletPaymentOutput = { address: string; value: bigint };
export type ForeignWalletSignedTransaction = {
  fee: bigint;
  inputAmount: bigint;
  outputAmount: bigint;
  rawTransactionHex: string;
  transactionSize: number;
  txId: string;
};
const networks = {
  BTC: { pubKeyHash: 0, scriptHash: 5, bech32: 'bc', wif: 128 },
  LTC: { pubKeyHash: 48, scriptHash: 50, bech32: 'ltc', wif: 176 },
  DOGE: { pubKeyHash: 30, scriptHash: 22, bech32: '', wif: 158 },
  DGB: { pubKeyHash: 30, scriptHash: 63, bech32: 'dgb', wif: 128 },
  RVN: { pubKeyHash: 60, scriptHash: 122, bech32: '', wif: 128 },
} as const;
const types = {
  pkh: 'P2PKH',
  sh: 'P2SH',
  wpkh: 'P2WPKH',
  wsh: 'P2WSH',
} as const;
const strict = {
  version: 1,
  lockTime: 0,
  PSBTVersion: 0,
  strictPrevoutValidation: true,
};
const equal = (a: Uint8Array, b: Uint8Array) => hex.encode(a) === hex.encode(b);
const requireValid = (condition: unknown) => {
  if (!condition) throw new Error('Invalid wallet transaction');
};
export const positiveAtomic = (value: bigint) =>
  requireValid(
    typeof value === 'bigint' && value > 0n && value <= 0x7fffffffffffffffn
  );
export function walletPath(path: string) {
  const match =
    typeof path === 'string' && /^M\/([01])\/(0|[1-9][0-9]{0,9})$/.exec(path);
  requireValid(match && Number(match[2]) < 0x80000000);
  return { chain: Number(match[1]), index: Number(match[2]) };
}
export function validateForeignWalletRecipient(input: {
  address: string;
  coin: ForeignWalletCoin;
  crypto?: ForeignWalletCrypto;
}): ForeignWalletRecipient {
  requireValid(
    typeof input.address === 'string' &&
      input.address.length <= 128 &&
      networks[input.coin]
  );
  const address = input.address.trim();
  const network = networks[input.coin];
  let decoded: ReturnType<ReturnType<typeof Address>['decode']>;
  try {
    decoded = Address(network).decode(address);
  } catch (error) {
    if (input.coin !== 'LTC') throw error;
    // Litecoin also accepts the older Bitcoin-compatible P2SH prefix.
    decoded = Address({ ...network, scriptHash: 5 }).decode(address);
    requireValid(decoded.type === 'sh');
  }
  requireValid(decoded.type in types);
  if (decoded.type === 'wpkh' || decoded.type === 'wsh')
    requireValid(!!network.bech32);
  return {
    address,
    outputType: types[decoded.type],
    scriptPubKey: OutScript.encode(decoded),
  };
}
export type ForeignWalletPreviousTransactionCache = {
  entries: Map<string, { rawHex: string; parsed: Transaction }>;
  parses: number;
};
export function createForeignWalletPreviousTransactionCache(): ForeignWalletPreviousTransactionCache {
  return { entries: new Map(), parses: 0 };
}
export function assertForeignWalletWatchInputBounds(
  inputs: readonly ForeignWalletWatchInput[]
) {
  requireValid(Array.isArray(inputs) && inputs.length <= 1000);
  const transactions = new Map<string, string>();
  let size = 0;
  for (const input of inputs) {
    requireValid(
      typeof input.txHash === 'string' && /^[a-f0-9]{64}$/.test(input.txHash)
    );
    const raw = input.previousTransactionHex;
    requireValid(
      typeof raw === 'string' &&
        raw.length > 0 &&
        raw.length <= 2000000 &&
        raw.length % 2 === 0 &&
        /^[a-f0-9]+$/i.test(raw)
    );
    if (transactions.has(input.txHash))
      requireValid(transactions.get(input.txHash) === raw);
    else {
      size += raw.length / 2;
      transactions.set(input.txHash, raw);
    }
    requireValid(size <= 8000000);
  }
}
export function assertForeignWalletSigningWorkBounds(
  count: number,
  lengths: readonly number[]
) {
  requireValid(
    Number.isSafeInteger(count) &&
      count > 0 &&
      count <= 1000 &&
      lengths.length > 0 &&
      lengths.length <= 21
  );
  requireValid(
    lengths.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000)
  );
  requireValid(
    count * (26 + count * 149 + lengths.reduce((n, len) => n + 17 + len, 0)) <=
      256 * 1024 * 1024
  );
}
type WalletInput = {
  coin: ForeignWalletCoin;
  xpub?: string;
  xprv?: string;
  crypto?: ForeignWalletCrypto;
  cache?: ForeignWalletPreviousTransactionCache;
  watchInput: ForeignWalletWatchInput;
};
export function attestForeignWalletWatchInput(input: WalletInput) {
  const u = input.watchInput;
  assertForeignWalletWatchInputBounds([u]);
  positiveAtomic(u.value);
  requireValid(
    Number.isSafeInteger(u.height) &&
      u.height > 0 &&
      Number.isSafeInteger(u.txPos) &&
      u.txPos >= 0 &&
      u.txPos <= 0xffffffff
  );
  let previous = input.cache?.entries.get(u.txHash);
  if (!previous || previous.rawHex !== u.previousTransactionHex) {
    // Previous transactions may contain unrelated scripts; only the spent output
    // must be P2PKH. Parsing never authorizes signing unknown scripts.
    const parsed = Transaction.fromRaw(hex.decode(u.previousTransactionHex), {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
      allowUnknownVersion: true,
    });
    requireValid(parsed.id === u.txHash);
    previous = { rawHex: u.previousTransactionHex, parsed };
    if (input.cache) {
      input.cache.entries.set(u.txHash, previous);
      input.cache.parses++;
    }
  }
  requireValid(u.txPos < previous.parsed.outputsLength);
  const output = previous.parsed.getOutput(u.txPos);
  const leaf = deriveForeignWalletLeafPublicData({
    ...input,
    ...walletPath(u.path),
  });
  const script = p2pkh(leaf.publicKey).script;
  requireValid(
    output.amount === u.value &&
      equal(output.script, script) &&
      hex.encode(script) === u.scriptPubKey &&
      leaf.address === u.address
  );
  return leaf;
}
export type ForeignWalletTransactionRequest = {
  coin: ForeignWalletCoin;
  xpub?: string;
  xprv?: string;
  crypto?: ForeignWalletCrypto;
  inputs: readonly ForeignWalletWatchInput[];
  outputs: readonly ForeignWalletPaymentOutput[];
  cache?: ForeignWalletPreviousTransactionCache;
  transactionVersion?: number;
};
export function prepareForeignWalletPsbt(
  input: ForeignWalletTransactionRequest
): Uint8Array {
  assertForeignWalletWatchInputBounds(input.inputs);
  requireValid(
    input.transactionVersion === undefined || input.transactionVersion === 1
  );
  const scripts = input.outputs.map((o) => {
    positiveAtomic(o.value);
    return validateForeignWalletRecipient({
      address: o.address,
      coin: input.coin,
    }).scriptPubKey;
  });
  assertForeignWalletSigningWorkBounds(
    input.inputs.length,
    scripts.map((s) => s.length)
  );
  // PSBT repeats the full previous transaction per input. Bound both the expanded
  // payload and the library's strict all-prevout checks performed for each signature.
  const previousBytes = input.inputs.reduce(
    (n, u) => n + u.previousTransactionHex.length / 2,
    0
  );
  requireValid(
    previousBytes <= 8000000 &&
      previousBytes * input.inputs.length <= 256 * 1024 * 1024
  );
  const tx = new Transaction(strict);
  const xpub = input.xpub ?? walletPublicKey(input.xprv, input.coin);
  const fingerprint = walletFingerprint(xpub, input.coin);
  const seen = new Set<string>();
  input.inputs.forEach((u) => {
    const leaf = attestForeignWalletWatchInput({
      ...input,
      xpub,
      watchInput: u,
    });
    const path = walletPath(u.path);
    const point = `${u.txHash}:${u.txPos}`;
    requireValid(!seen.has(point));
    seen.add(point);
    tx.addInput({
      txid: u.txHash,
      index: u.txPos,
      sequence: 0xffffffff,
      bip32Derivation: [
        [leaf.publicKey, { fingerprint, path: [path.chain, path.index] }],
      ],
      sighashType: 1,
      nonWitnessUtxo: hex.decode(u.previousTransactionHex),
    });
  });
  input.outputs.forEach((o, i) =>
    tx.addOutput({ amount: o.value, script: scripts[i] })
  );
  requireValid(tx.fee >= 0n);
  positiveAtomic(input.inputs.reduce((sum, u) => sum + u.value, 0n));
  return tx.toPSBT(0);
}
/** Rebuild the expected PSBT independently before using any private key. */
export function signForeignWalletPsbt(
  input: ForeignWalletTransactionRequest & { xprv: string },
  psbt: Uint8Array
): ForeignWalletSignedTransaction {
  const xpub = walletPublicKey(input.xprv, input.coin);
  requireValid(!input.xpub || input.xpub === xpub);
  const expected = prepareForeignWalletPsbt({
    ...input,
    xpub,
    xprv: undefined,
  });
  requireValid(equal(psbt, expected));
  const tx = Transaction.fromPSBT(psbt, strict);
  input.inputs.forEach((u, i) =>
    withForeignWalletLeaf(
      { coin: input.coin, xprv: input.xprv, ...walletPath(u.path) },
      (leaf) => {
        requireValid(leaf.privateKey && tx.signIdx(leaf.privateKey, i, [1]));
      }
    )
  );
  tx.finalize();
  const raw = tx.extract();
  const inputAmount = input.inputs.reduce((sum, u) => sum + u.value, 0n);
  const outputAmount = input.outputs.reduce((sum, o) => sum + o.value, 0n);
  return {
    fee: tx.fee,
    inputAmount,
    outputAmount,
    rawTransactionHex: hex.encode(raw),
    transactionSize: raw.length,
    txId: tx.id,
  };
}
export function buildForeignWalletSignedTransaction(
  input: ForeignWalletTransactionRequest & { xprv: string }
) {
  return signForeignWalletPsbt(input, prepareForeignWalletPsbt(input));
}
export function inspectSignedTransaction(rawHex: string) {
  requireValid(
    typeof rawHex === 'string' &&
      rawHex.length <= 400000 &&
      rawHex.length % 2 === 0 &&
      /^[a-f0-9]+$/.test(rawHex)
  );
  const tx = Transaction.fromRaw(hex.decode(rawHex));
  requireValid(
    tx.version === 1 &&
      tx.lockTime === 0 &&
      tx.inputsLength > 0 &&
      tx.inputsLength <= 1000
  );
  const outpoints = Array.from({ length: tx.inputsLength }, (_, i) => {
    const u = tx.getInput(i);
    requireValid(u.sequence === 0xffffffff && u.finalScriptSig?.length > 0);
    return `${hex.encode(u.txid)}:${u.index}`;
  });
  return { txId: tx.id, outpoints };
}

export function foreignWalletOutputAddress(
  script: Uint8Array,
  coin: ForeignWalletCoin
) {
  return Address(networks[coin]).encode(OutScript.decode(script));
}
