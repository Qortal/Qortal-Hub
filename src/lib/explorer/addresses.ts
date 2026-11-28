/**
 * What a typed or linked value is, by its form only: the node decides
 * whether an address is valid (its checksum) and whether it was ever used.
 */

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';

const Q_ADDRESS = new RegExp(`^Q${BASE58}{33}$`);
const AT_ADDRESS = new RegExp(`^A${BASE58}{33}$`);
/** Written like an address, but not one (a letter wrong, missing or extra). */
const ADDRESS_LIKE = /^[QA][0-9A-Za-z]{25,40}$/;
/** A transaction signature: 64 bytes in base58. */
const SIGNATURE = new RegExp(`^${BASE58}{86,90}$`);

/** A Qortal account address by its form: Q and 33 more base58 characters. */
export const isQortAddress = (value: unknown): value is string =>
  typeof value === 'string' && Q_ADDRESS.test(value);

/** An AT (a program on the chain) address: A and 33 more base58 characters. */
export const isAtAddress = (value: unknown): value is string =>
  typeof value === 'string' && AT_ADDRESS.test(value);

/** Not an address, but written so much like one that a typo is likely. */
export const looksLikeAddress = (value: string): boolean =>
  ADDRESS_LIKE.test(value) && !isQortAddress(value) && !isAtAddress(value);

/** A transaction signature, by its form. */
export const isSignature = (value: unknown): value is string =>
  typeof value === 'string' && SIGNATURE.test(value);

/** "QWWByH…MUgKx": the start and end of an address. */
export const shortAddress = (address: string): string =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-5)}` : address;
