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

export function createGetAddressGroupInvitesPayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);
  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes); // ✅ Just raw payload
}

export function createGetAccountGroupsPayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);
  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes); // ✅ Just raw payload
}

export function createGetOwnerGroupsPayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);
  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes); // ✅ Just raw payload
}

export function createProcessTransactionMessagePayload(
  signedBytes: string
): Buffer {
  const signedBytesToBytes = bs58.decode(signedBytes);

  return Buffer.from(signedBytesToBytes); // ✅ Just raw payload
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

export function createGetUnitFeePayload(
  txType: string,
  timestamp?: number
): Buffer {
  const txTypeBuffer = Buffer.from(txType, 'utf-8');
  const txTypeLength = Buffer.alloc(4);
  txTypeLength.writeInt32BE(txTypeBuffer.length);

  const payloadParts = [txTypeLength, txTypeBuffer];

  if (timestamp !== undefined) {
    const timestampBuffer = Buffer.alloc(8);
    timestampBuffer.writeBigUInt64BE(BigInt(timestamp));
    payloadParts.push(timestampBuffer);
  }

  return Buffer.concat(payloadParts);
}

export function createGetGroupsPayload(
  limit: number,
  offset: number,
  reverse: boolean
): Buffer {
  const limitBuffer = Buffer.alloc(4);
  limitBuffer.writeInt32BE(limit);

  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeInt32BE(offset);

  const reverseBuffer = Buffer.alloc(4);
  reverseBuffer.writeInt32BE(reverse ? 1 : 0);

  return Buffer.concat([limitBuffer, offsetBuffer, reverseBuffer]);
}

export function createGetNamesForSalePayload(
  limit: number,
  offset: number,
  reverse: boolean
): Buffer {
  const limitBuffer = Buffer.alloc(4);
  limitBuffer.writeInt32BE(limit);

  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeInt32BE(offset);

  const reverseBuffer = Buffer.alloc(4);
  reverseBuffer.writeInt32BE(reverse ? 1 : 0);

  return Buffer.concat([limitBuffer, offsetBuffer, reverseBuffer]);
}

export function createGetGroupMembersPayload(
  groupId: number,
  onlyAdmins: boolean,
  limit: number,
  offset: number,
  reverse: boolean
): Buffer {
  const groupIdBuffer = Buffer.alloc(4);
  groupIdBuffer.writeInt32BE(groupId);

  const onlyAdminsBuffer = Buffer.alloc(4);
  onlyAdminsBuffer.writeInt32BE(onlyAdmins ? 1 : 0);

  const limitBuffer = Buffer.alloc(4);
  limitBuffer.writeInt32BE(limit);

  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeInt32BE(offset);

  const reverseBuffer = Buffer.alloc(4);
  reverseBuffer.writeInt32BE(reverse ? 1 : 0);

  return Buffer.concat([
    groupIdBuffer,
    onlyAdminsBuffer,
    limitBuffer,
    offsetBuffer,
    reverseBuffer,
  ]);
}

export function createGetNamesPayload(
  limit: number,
  offset: number,
  reverse: boolean,
  after?: number
): Buffer {
  const limitBuffer = Buffer.alloc(4);
  limitBuffer.writeInt32BE(limit);

  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeInt32BE(offset);

  const reverseBuffer = Buffer.alloc(4);
  reverseBuffer.writeInt32BE(reverse ? 1 : 0);

  const buffers = [limitBuffer, offsetBuffer, reverseBuffer];

  // after (nullable timestamp in milliseconds)
  if (after !== undefined && after !== null) {
    const hasAfterBuffer = Buffer.alloc(4);
    hasAfterBuffer.writeInt32BE(1);

    const afterBuffer = Buffer.alloc(8);
    afterBuffer.writeBigInt64BE(BigInt(after));

    buffers.push(hasAfterBuffer, afterBuffer);
  } else {
    const hasAfterBuffer = Buffer.alloc(4);
    hasAfterBuffer.writeInt32BE(0);
    buffers.push(hasAfterBuffer);
  }

  return Buffer.concat(buffers);
}

export function createSearchNamesPayload(
  query: string,
  limit: number,
  offset: number,
  reverse: boolean,
  prefix: boolean
): Buffer {
  const limitBuffer = Buffer.alloc(4);
  limitBuffer.writeInt32BE(limit);

  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeInt32BE(offset);

  const reverseBuffer = Buffer.alloc(4);
  reverseBuffer.writeInt32BE(reverse ? 1 : 0);

  const prefixBuffer = Buffer.alloc(4);
  prefixBuffer.writeInt32BE(prefix ? 1 : 0);

  const queryBuffer = Buffer.from(query, 'utf-8');
  const queryLengthBuffer = Buffer.alloc(4);
  queryLengthBuffer.writeInt32BE(queryBuffer.length);

  return Buffer.concat([
    limitBuffer,
    offsetBuffer,
    reverseBuffer,
    prefixBuffer,
    queryLengthBuffer,
    queryBuffer,
  ]);
}

export function createGetGroupPayload(groupId: number): Buffer {
  const groupIdBuffer = Buffer.alloc(4);
  groupIdBuffer.writeInt32BE(groupId);
  return groupIdBuffer;
}

export function createGetBansPayload(groupId: number): Buffer {
  const groupIdBuffer = Buffer.alloc(4);
  groupIdBuffer.writeInt32BE(groupId);
  return groupIdBuffer;
}

export function createGetGroupInvitesPayload(groupId: number): Buffer {
  const groupIdBuffer = Buffer.alloc(4);
  groupIdBuffer.writeInt32BE(groupId);
  return groupIdBuffer;
}

export function createGetGroupJoinRequestsPayload(groupId: number): Buffer {
  const groupIdBuffer = Buffer.alloc(4);
  groupIdBuffer.writeInt32BE(groupId);
  return groupIdBuffer;
}

export function createGetLastReferencePayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);

  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes);
}

export function createGetPrimaryNamePayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);

  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes);
}

export function createGetAddressNamesPayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);

  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes);
}

export function createGetNameInfoPayload(name: string): Buffer {
  const nameBuffer = Buffer.from(name, 'utf-8');

  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeInt32BE(nameBuffer.length);

  return Buffer.concat([lengthBuffer, nameBuffer]);
}
