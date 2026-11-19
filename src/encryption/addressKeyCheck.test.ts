import { describe, expect, it, vi } from 'vitest';

// src/test/setup.ts stubs asmcrypto out; address checks need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
import Base58Untyped from './Base58';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import {
  assertPublicKeyForAddress,
  AT_ADDRESS_VERSION,
  isAddressShaped,
  isValidAddressWithVersion,
  isValidQortalAddress,
  publicKeyBelongsToAddress,
  PublicKeyMismatchError,
} from './addressKeyCheck';
import { Sha256 } from 'asmcrypto.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function keyBytes(seed: number): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i * 7) & 0xff;
  return bytes;
}

// Account-A and Account-B: made-up keys and the addresses they derive.
const accountAKeyBytes = keyBytes(1);
const accountAKey = Base58.encode(accountAKeyBytes) as string;
const accountAAddress = String(publicKeyToAddress(accountAKeyBytes));
const accountBKey = Base58.encode(keyBytes(2)) as string;
const accountBAddress = String(publicKeyToAddress(keyBytes(2)));

/** An AT address ("A…") with a correct checksum. */
const atAddress = (() => {
  const body = new Uint8Array(21).fill(3);
  body[0] = AT_ADDRESS_VERSION;
  const first = new Sha256().process(body).finish().result;
  const checksum = new Sha256().process(first).finish().result.slice(0, 4);
  const bytes = new Uint8Array(25);
  bytes.set(body);
  bytes.set(checksum, 21);
  return Base58.encode(bytes) as string;
})();

/** The address with one character swapped for another Base58 character. */
function mistyped(address: string): string {
  const index = 10;
  const replacement = address[index] === 'A' ? 'B' : 'A';
  return address.slice(0, index) + replacement + address.slice(index + 1);
}

describe('isValidQortalAddress', () => {
  it('accepts addresses derived from a public key', () => {
    expect(accountAAddress.startsWith('Q')).toBe(true);
    expect(isValidQortalAddress(accountAAddress)).toBe(true);
    expect(isValidQortalAddress(accountBAddress)).toBe(true);
  });

  it('refuses a mistyped address (checksum) and non-addresses', () => {
    expect(isValidQortalAddress(mistyped(accountAAddress))).toBe(false);
    expect(isValidQortalAddress('')).toBe(false);
    expect(isValidQortalAddress('Account-A')).toBe(false);
    expect(isValidQortalAddress('not-an-address')).toBe(false);
    expect(isValidQortalAddress(undefined)).toBe(false);
    expect(isValidQortalAddress(42)).toBe(false);
    // A public key is valid Base58 but not 25 bytes.
    expect(isValidQortalAddress(accountAKey)).toBe(false);
  });

  it('refuses 25 bytes with another version byte', () => {
    const bytes = Base58.decode(accountAAddress) as Uint8Array;
    const other = new Uint8Array(bytes);
    other[0] = AT_ADDRESS_VERSION;
    expect(isValidQortalAddress(Base58.encode(other))).toBe(false);
  });

  it('refuses a valid AT address: it has no public key', () => {
    expect(isValidQortalAddress(atAddress)).toBe(false);
  });
});

describe('isValidAddressWithVersion', () => {
  it('accepts only the listed version bytes, with a valid checksum', () => {
    expect(atAddress.startsWith('A')).toBe(true);
    expect(isValidAddressWithVersion(atAddress, [AT_ADDRESS_VERSION])).toBe(
      true
    );
    expect(isValidAddressWithVersion(atAddress, [58, AT_ADDRESS_VERSION])).toBe(
      true
    );
    expect(isValidAddressWithVersion(atAddress, [58])).toBe(false);
    expect(
      isValidAddressWithVersion(mistyped(atAddress), [AT_ADDRESS_VERSION])
    ).toBe(false);
  });
});

describe('isAddressShaped', () => {
  it('is true for anything that decodes to 25 bytes, valid or not', () => {
    expect(isAddressShaped(accountAAddress)).toBe(true);
    expect(isAddressShaped(mistyped(accountAAddress))).toBe(true);
    expect(isAddressShaped(atAddress)).toBe(true);
  });

  it('is false for names, keys and other text', () => {
    expect(isAddressShaped('Account-A')).toBe(false);
    expect(isAddressShaped('Recipient B')).toBe(false);
    expect(isAddressShaped('Who?#1')).toBe(false);
    expect(isAddressShaped(accountAKey)).toBe(false);
    expect(isAddressShaped('')).toBe(false);
    expect(isAddressShaped(undefined)).toBe(false);
  });
});

describe('publicKeyBelongsToAddress', () => {
  it('is true only for the key that derives the address', () => {
    expect(publicKeyBelongsToAddress(accountAKey, accountAAddress)).toBe(true);
    expect(
      publicKeyBelongsToAddress(` ${accountAKey}\n`, accountAAddress)
    ).toBe(true);
    expect(publicKeyBelongsToAddress(accountBKey, accountAAddress)).toBe(false);
  });

  it('is false for missing, malformed or wrong-length keys', () => {
    expect(publicKeyBelongsToAddress(undefined, accountAAddress)).toBe(false);
    expect(publicKeyBelongsToAddress('', accountAAddress)).toBe(false);
    expect(publicKeyBelongsToAddress('false', accountAAddress)).toBe(false);
    expect(
      publicKeyBelongsToAddress('{"error":102,"message":"x"}', accountAAddress)
    ).toBe(false);
    expect(
      publicKeyBelongsToAddress(
        Base58.encode(accountAKeyBytes.slice(0, 31)),
        accountAAddress
      )
    ).toBe(false);
    expect(publicKeyBelongsToAddress(accountAKey, '')).toBe(false);
    expect(publicKeyBelongsToAddress(accountAKey, undefined)).toBe(false);
  });
});

describe('assertPublicKeyForAddress', () => {
  it('returns the trimmed key when it matches', () => {
    expect(assertPublicKeyForAddress(`${accountAKey} `, accountAAddress)).toBe(
      accountAKey
    );
  });

  it("throws PublicKeyMismatchError for another account's key", () => {
    expect(() =>
      assertPublicKeyForAddress(accountBKey, accountAAddress)
    ).toThrow(PublicKeyMismatchError);
    try {
      assertPublicKeyForAddress(accountBKey, accountAAddress);
    } catch (error) {
      expect((error as PublicKeyMismatchError).address).toBe(accountAAddress);
    }
  });

  it('throws for a missing key', () => {
    expect(() => assertPublicKeyForAddress(undefined, accountAAddress)).toThrow(
      PublicKeyMismatchError
    );
  });
});
