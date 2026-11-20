import i18n from 'i18next';
import { Sha256 } from 'asmcrypto.js';
import Base58Untyped from './Base58';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import { ADDRESS_VERSION } from '../constants/constants';

const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

/**
 * Checks for addresses and public keys that come from the node.
 *
 * Hub asks the node for an account's public key before it encrypts a direct
 * message or a group key to that account. A Qortal address is derived from its
 * public key, so the key can be checked locally: publicKeyToAddress(key) must
 * give that address back. A key that fails the check is not used.
 */

const ADDRESS_BYTES = 25;
const ADDRESS_CHECKSUM_BYTES = 4;
const PUBLIC_KEY_BYTES = 32;

function decodeBase58(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const bytes = Base58.decode(value);
    return bytes instanceof Uint8Array ? bytes : null;
  } catch {
    return null;
  }
}

function doubleSha256(bytes: Uint8Array): Uint8Array {
  const first = new Sha256().process(bytes).finish().result;
  return new Sha256().process(first).finish().result;
}

/** Version byte of an AT (smart contract) address; these start with "A". */
export const AT_ADDRESS_VERSION = 23;

/**
 * True for 25 bytes of canonical Base58 whose first byte is one of `versions`
 * and whose last 4 bytes are the double-SHA256 checksum of the rest: Core's
 * Crypto.isValidAddress rule.
 */
export function isValidAddressWithVersion(
  address: unknown,
  versions: readonly number[]
): address is string {
  const bytes = decodeBase58(address);
  if (!bytes || bytes.length !== ADDRESS_BYTES) return false;
  if (!versions.includes(bytes[0])) return false;
  const body = bytes.subarray(0, ADDRESS_BYTES - ADDRESS_CHECKSUM_BYTES);
  const checksum = doubleSha256(body);
  for (let i = 0; i < ADDRESS_CHECKSUM_BYTES; i++) {
    if (bytes[ADDRESS_BYTES - ADDRESS_CHECKSUM_BYTES + i] !== checksum[i]) {
      return false;
    }
  }
  // Base58 of the same bytes must give the same text (no extra leading zeros).
  return Base58.encode(bytes) === address;
}

/**
 * True for a well-formed account address: 25 bytes of Base58 with the "Q"
 * version byte and a matching checksum. Only these have a public key.
 * utils/validateAddress only checks the length, so a mistyped address passes
 * there.
 */
export function isValidQortalAddress(address: unknown): address is string {
  return isValidAddressWithVersion(address, [ADDRESS_VERSION]);
}

/** True when `publicKey` (Base58, 32 bytes) derives `address`. */
export function publicKeyBelongsToAddress(
  publicKey: unknown,
  address: unknown
): boolean {
  if (typeof address !== 'string' || !address) return false;
  const key = typeof publicKey === 'string' ? publicKey.trim() : '';
  const bytes = decodeBase58(key);
  if (!bytes || bytes.length !== PUBLIC_KEY_BYTES) return false;
  try {
    return String(publicKeyToAddress(bytes)) === address;
  } catch {
    return false;
  }
}

export class PublicKeyMismatchError extends Error {
  readonly address: string;

  constructor(address: unknown) {
    const shown = typeof address === 'string' ? address : '';
    super(
      i18n.t('question:message.error.public_key_mismatch', {
        address: shown,
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'PublicKeyMismatchError';
    this.address = shown;
  }
}

/**
 * Returns the trimmed key when it belongs to `address`, and throws
 * PublicKeyMismatchError otherwise (another account's key, no key, or not an
 * address).
 */
export function assertPublicKeyForAddress(
  publicKey: unknown,
  address: unknown
): string {
  if (!publicKeyBelongsToAddress(publicKey, address)) {
    throw new PublicKeyMismatchError(address);
  }
  return (publicKey as string).trim();
}
