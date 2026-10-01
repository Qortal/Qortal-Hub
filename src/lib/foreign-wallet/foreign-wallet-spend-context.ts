// Validate the public Core API contract before constructing a transaction.
import {
  assertForeignWalletWatchInputBounds,
  walletPath,
  type ForeignWalletWatchInput,
} from './foreign-wallet-transaction';
import type { ForeignWalletCoin } from './foreign-wallets';
export const FOREIGN_WALLET_MAINNET_CHAIN_IDS = Object.freeze({
  BTC: 'bip122:000000000019d6689c085ae165831e93',
  LTC: 'bip122:12a765e31ffd4059bada1e25190f6e98',
  DOGE: 'bip122:1a91e3dace36e2be3bf030a65679fe82',
  DGB: 'bip122:7497ea1b465eb39f1c8f507bc877078f',
  RVN: 'bip122:0000006b444bc2f2ffe627be9d9e7e7a',
});
const blockchains = {
  BTC: 'BITCOIN',
  LTC: 'LITECOIN',
  DOGE: 'DOGECOIN',
  DGB: 'DIGIBYTE',
  RVN: 'RAVENCOIN',
};
export const FOREIGN_WALLET_SPEND_CONTEXT_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;
export const FOREIGN_WALLET_SPEND_CONTEXT_MAX_RAW_TRANSACTION_BYTES = 1000000;
export const FOREIGN_WALLET_SPEND_CONTEXT_MAX_TOTAL_RAW_TRANSACTION_BYTES = 8000000;
export type ForeignWalletSpendContext = Readonly<{
  activeNetwork: string;
  blockchain: string;
  chainId: string;
  coin: ForeignWalletCoin;
  minimumNonDustOutput: bigint;
  recommendedFeePerByte: bigint;
  tipHeight: number;
  transactionVersion: number;
  utxos: readonly ForeignWalletWatchInput[];
}>;
const assert = (ok: unknown) => {
  if (!ok) throw new Error('Invalid public wallet context');
};
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown) => {
  assert(typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v as string));
  const n = BigInt(v as string);
  assert(n <= 0x7fffffffffffffffn);
  return n;
};
export function getForeignWalletMainnetChainId(coin: ForeignWalletCoin) {
  assert(
    Object.prototype.hasOwnProperty.call(FOREIGN_WALLET_MAINNET_CHAIN_IDS, coin)
  );
  return FOREIGN_WALLET_MAINNET_CHAIN_IDS[coin];
}
export function normalizeForeignWalletSpendContext(
  raw: unknown,
  coin: ForeignWalletCoin
): ForeignWalletSpendContext {
  assert(record(raw));
  const v = raw as Record<string, any>;
  const chainId = getForeignWalletMainnetChainId(coin);
  assert(
    v.version === 1 &&
      v.chainId === chainId &&
      v.currencyCode === coin &&
      v.blockchain === blockchains[coin] &&
      v.activeNetwork === 'MAIN'
  );
  assert(
    v.confirmedOnly === true &&
      v.transactionFormat === 'LEGACY' &&
      v.transactionVersion === 1 &&
      v.sighashType === 1 &&
      v.sequence === 0xffffffff &&
      v.lockTime === 0
  );
  assert(Number.isSafeInteger(v.tipHeight) && v.tipHeight > 0);
  assert(
    Array.isArray(v.utxos) &&
      v.utxos.length <= 1000 &&
      record(v.previousTransactions)
  );
  const hashes = Object.keys(v.previousTransactions);
  assert(
    hashes.length <= 1000 && hashes.every((h) => /^[a-f0-9]{64}$/.test(h))
  );
  const referenced = new Set<string>();
  const seen = new Set<string>();
  const utxos: ForeignWalletWatchInput[] = v.utxos.map((u: any) => {
    assert(
      record(u) &&
        typeof u.txHash === 'string' &&
        Object.prototype.hasOwnProperty.call(v.previousTransactions, u.txHash)
    );
    assert(
      Number.isSafeInteger(u.height) && u.height > 0 && u.height <= v.tipHeight
    );
    assert(
      Number.isSafeInteger(u.outputIndex) &&
        u.outputIndex >= 0 &&
        u.outputIndex <= 0xffffffff
    );
    assert(
      typeof u.address === 'string' &&
        u.address.length <= 128 &&
        /^[a-f0-9]{50}$/.test(u.scriptPubKeyHex)
    );
    const path = walletPath(u.pathAsString);
    assert(
      Array.isArray(u.path) &&
        u.path.length === 2 &&
        u.path[0] === path.chain &&
        u.path[1] === path.index
    );
    const point = `${u.txHash}:${u.outputIndex}`;
    assert(!seen.has(point));
    seen.add(point);
    referenced.add(u.txHash);
    return Object.freeze({
      address: u.address,
      height: u.height,
      path: u.pathAsString,
      previousTransactionHex: v.previousTransactions[u.txHash],
      scriptPubKey: u.scriptPubKeyHex,
      txHash: u.txHash,
      txPos: u.outputIndex,
      value: amount(u.value),
    });
  });
  assert(referenced.size === hashes.length);
  assertForeignWalletWatchInputBounds(utxos);
  return Object.freeze({
    coin,
    chainId,
    activeNetwork: 'MAIN',
    blockchain: blockchains[coin],
    transactionVersion: 1,
    tipHeight: v.tipHeight,
    minimumNonDustOutput: amount(v.minimumNonDustOutput),
    recommendedFeePerByte: amount(v.recommendedFeePerByte),
    utxos: Object.freeze(utxos),
  });
}
