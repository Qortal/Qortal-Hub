import bs58 from 'bs58';
import { Buffer } from 'buffer';

const ADDRESS_LENGTH = 25;

export function createHelloPayload(): Buffer {
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigInt64BE(BigInt(Date.now()));

  const version = Buffer.from('qortal-5.0.2');
  const address = Buffer.from('lite-node');
  const versionLen = Buffer.alloc(4);
  const addressLen = Buffer.alloc(4);

  versionLen.writeUInt32BE(version.length);
  addressLen.writeUInt32BE(address.length);

  return Buffer.concat([timestamp, versionLen, version, addressLen, address]);
}

export function createChallengePayload(
  publicKey: Uint8Array,
  challenge: Uint8Array
): Buffer {
  return Buffer.concat([Buffer.from(publicKey), Buffer.from(challenge)]);
}

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

export function createGetAccountMessagePayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);
  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes); // ✅ Just raw payload
}

export enum Encoding {
  BASE58 = 0,
  BASE64 = 1,
  // Add more if needed
}

export function createGetActiveChatPayload(
  address: string,
  encoding: Encoding,
  hasChatReference: boolean
): Buffer {
  const addressBytes = bs58.decode(address);

  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  const encodingByte = Buffer.from([encoding]);
  const hasChatReferenceByte = Buffer.from([hasChatReference ? 1 : 0]);

  return Buffer.concat([addressBytes, encodingByte, hasChatReferenceByte]);
}
