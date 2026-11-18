import { ed25519 } from '@noble/curves/ed25519';
import { bytesToNumberLE, numberToBytesLE } from '@noble/curves/abstract/utils';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base58xmr } from '@scure/base';
import i18n from 'i18next';

export const XMR_DERIVATION_VERSION = 1 as const;
export type MoneroNetwork = 'mainnet' | 'stagenet';

export interface MoneroAccountKeys {
  derivationVersion: typeof XMR_DERIVATION_VERSION;
  network: MoneroNetwork;
  address: string;
  publicSpendKey: string;
  publicViewKey: string;
  privateSpendKey: string;
  privateViewKey: string;
}

export type MoneroAccount = Record<MoneroNetwork, MoneroAccountKeys>;
export type MoneroPublicWallet = Omit<
  MoneroAccountKeys,
  'privateSpendKey' | 'privateViewKey'
>;

const DOMAIN = utf8ToBytes('QortalHub/XMR/spend/v1\0');
const ORDER = ed25519.CURVE.n;
const PREFIX = { mainnet: 18, stagenet: 24 } as const;

function invalidAccount(): never {
  throw new Error(
    i18n.t('auth:wallet_errors.invalid_security_data', {
      postProcess: 'capitalizeFirstChar',
    })
  );
}

function uint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

/**
 * Hub account derivation v1, not BIP32 or EdDSA seed expansion.
 * The 32-byte input is PhraseWallet's existing per-address seed. The Qortal
 * wallet version and nonce are explicit domain inputs, including for legacy
 * version 1 where the per-address seed did not vary by nonce.
 * Never change these bytes for a funded wallet; introduce a recovery version.
 */
export function deriveMoneroAccountKeys(
  addressSeed: Uint8Array,
  walletVersion: number,
  nonce: number,
  network: MoneroNetwork
): MoneroAccountKeys {
  if (
    !(addressSeed instanceof Uint8Array) ||
    addressSeed.length !== 32 ||
    ![1, 2].includes(walletVersion) ||
    !Number.isInteger(nonce) ||
    nonce < 0 ||
    nonce > 0x7fffffff ||
    (network !== 'mainnet' && network !== 'stagenet')
  ) {
    return invalidAccount();
  }
  const context = concatBytes(
    DOMAIN,
    utf8ToBytes(network + '\0'),
    uint32BE(walletVersion),
    uint32BE(nonce)
  );
  for (let counter = 0; counter <= 0xffffffff; counter++) {
    const material = hmac(
      sha512,
      addressSeed,
      concatBytes(context, uint32BE(counter))
    );
    const spend = bytesToNumberLE(material) % ORDER;
    material.fill(0);
    if (spend === 0n) continue;
    const spendBytes = numberToBytesLE(spend, 32);
    const viewHash = keccak_256(spendBytes);
    const view = bytesToNumberLE(viewHash) % ORDER;
    viewHash.fill(0);
    if (view === 0n) {
      spendBytes.fill(0);
      continue;
    }
    const viewBytes = numberToBytesLE(view, 32);
    // Monero multiplies the scalar directly; ed25519.getPublicKey() would
    // instead hash/clamp an EdDSA seed and produce an incompatible key.
    const publicSpend = ed25519.ExtendedPoint.BASE.multiply(spend).toRawBytes();
    const publicView = ed25519.ExtendedPoint.BASE.multiply(view).toRawBytes();
    const payload = concatBytes(
      Uint8Array.of(PREFIX[network]),
      publicSpend,
      publicView
    );
    const result: MoneroAccountKeys = {
      derivationVersion: XMR_DERIVATION_VERSION,
      network,
      address: base58xmr.encode(
        concatBytes(payload, keccak_256(payload).slice(0, 4))
      ),
      publicSpendKey: bytesToHex(publicSpend),
      publicViewKey: bytesToHex(publicView),
      privateSpendKey: bytesToHex(spendBytes),
      privateViewKey: bytesToHex(viewBytes),
    };
    spendBytes.fill(0);
    viewBytes.fill(0);
    return result;
  }
  return invalidAccount();
}

export function deriveMoneroAccount(
  addressSeed: Uint8Array,
  walletVersion: number,
  nonce: number
): MoneroAccount {
  return {
    mainnet: deriveMoneroAccountKeys(
      addressSeed,
      walletVersion,
      nonce,
      'mainnet'
    ),
    stagenet: deriveMoneroAccountKeys(
      addressSeed,
      walletVersion,
      nonce,
      'stagenet'
    ),
  };
}

export function moneroNetworkForNodeInfo(nodeInfo: unknown): MoneroNetwork {
  if (
    !nodeInfo ||
    typeof nodeInfo !== 'object' ||
    !('isTestNet' in nodeInfo) ||
    typeof nodeInfo.isTestNet !== 'boolean'
  ) {
    throw new Error(
      i18n.t('question:message.error.node_info', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return nodeInfo.isTestNet ? 'stagenet' : 'mainnet';
}

/** Explicit projection: Q-Apps must never receive the account/key record. */
export function moneroPublicWallet(
  account: MoneroAccount,
  network: MoneroNetwork
): MoneroPublicWallet {
  const keys = account?.[network];
  if (
    (network !== 'mainnet' && network !== 'stagenet') ||
    keys?.derivationVersion !== XMR_DERIVATION_VERSION ||
    keys.network !== network ||
    typeof keys.address !== 'string' ||
    keys.address.length !== 95 ||
    !/^[0-9a-f]{64}$/.test(keys.publicSpendKey) ||
    !/^[0-9a-f]{64}$/.test(keys.publicViewKey)
  ) {
    return invalidAccount();
  }
  return {
    derivationVersion: keys.derivationVersion,
    network: keys.network,
    address: keys.address,
    publicSpendKey: keys.publicSpendKey,
    publicViewKey: keys.publicViewKey,
  };
}
