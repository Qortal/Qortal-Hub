import bs58 from 'bs58';
import { Buffer } from 'buffer';

const ADDRESS_LENGTH = 25;

/**
 * Creates the payload for GET_ACCOUNT_BALANCE.
 * This function assumes you'll frame it separately using `sendMessage(type, payload, id?)`.
 */
export function createGetAccountBalancePayload(
  address: string,
  assetId: number
): Buffer {
  const addressBytes = bs58.decode(address);

  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  const assetIdBigInt = BigInt(assetId);
  const assetIdBuffer = Buffer.alloc(8);
  assetIdBuffer.writeBigUInt64BE(assetIdBigInt);

  return Buffer.concat([Buffer.from(addressBytes), assetIdBuffer]); // ✅ Just the payload
}
