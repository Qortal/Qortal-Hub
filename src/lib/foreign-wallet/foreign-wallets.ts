import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { ripemd160 } from '@noble/hashes/ripemd160';

export type ForeignWalletCoin = 'BTC' | 'LTC' | 'DOGE' | 'DGB' | 'RVN';
export type ForeignWalletCrypto = {
  sha256: typeof sha256;
  sha512: typeof sha512;
  ripemd160: typeof ripemd160;
};
export const foreignCrypto: ForeignWalletCrypto = { sha256, sha512, ripemd160 };
export const foreignCoins: readonly ForeignWalletCoin[] = [
  'BTC',
  'LTC',
  'DOGE',
  'DGB',
  'RVN',
];
const prefixes = { BTC: 0, LTC: 48, DOGE: 30, DGB: 30, RVN: 60 };
export const walletVersions = (coin: ForeignWalletCoin) =>
  coin === 'DOGE'
    ? { private: 0x02fac398, public: 0x02facafd }
    : { private: 0x0488ade4, public: 0x0488b21e };

// Import the existing extended key; never rederive the wallet from a new seed scheme.
export function walletPublicKey(xprv: string, coin: ForeignWalletCoin): string {
  const root = HDKey.fromExtendedKey(xprv, walletVersions(coin));
  try {
    if (!root.privateKey || root.depth !== 0)
      throw new Error('Invalid wallet root');
    return root.publicExtendedKey;
  } finally {
    root.wipePrivateData();
  }
}

type LeafInput = {
  xprv?: string;
  xpub?: string;
  coin: ForeignWalletCoin;
  chain: number;
  index: number;
  crypto?: ForeignWalletCrypto;
};
export function withForeignWalletLeaf<T>(
  input: LeafInput,
  callback: (key: HDKey) => T
): T {
  if (
    ![0, 1].includes(input.chain) ||
    !Number.isSafeInteger(input.index) ||
    input.index < 0 ||
    input.index >= 0x80000000
  )
    throw new Error('Invalid wallet path');
  const root = HDKey.fromExtendedKey(
    input.xpub ?? input.xprv,
    walletVersions(input.coin)
  );
  let branch: HDKey;
  let leaf: HDKey;
  try {
    if (root.depth !== 0) throw new Error('Invalid wallet root');
    branch = root.deriveChild(input.chain);
    leaf = branch.deriveChild(input.index);
    return callback(leaf);
  } finally {
    leaf?.wipePrivateData();
    branch?.wipePrivateData();
    root.wipePrivateData();
  }
}
function publicData(input: LeafInput, leaf: HDKey) {
  const hash = ripemd160(sha256(leaf.publicKey));
  return {
    publicKey: Uint8Array.from(leaf.publicKey),
    path: `M/${input.chain}/${input.index}`,
    address: base58check(sha256).encode(
      Uint8Array.from([prefixes[input.coin], ...hash])
    ),
  };
}
export function deriveForeignWalletLeafPublicData(input: LeafInput) {
  return withForeignWalletLeaf(input, (leaf) => publicData(input, leaf));
}

export function walletFingerprint(xpub: string, coin: ForeignWalletCoin) {
  const root = HDKey.fromExtendedKey(xpub, walletVersions(coin));
  try {
    if (root.privateKey || root.depth !== 0)
      throw new Error('Expected a public wallet root');
    return root.fingerprint;
  } finally {
    root.wipePrivateData();
  }
}
