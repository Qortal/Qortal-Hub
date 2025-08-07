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

export function createGetPollsPayload(
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

export function createGetPollPayload(pollName: string): Buffer {
  const pollNameBuffer = Buffer.from(pollName, 'utf-8');
  const pollNameLength = Buffer.alloc(4);
  pollNameLength.writeInt32BE(pollNameBuffer.length);

  const payloadParts = [pollNameLength, pollNameBuffer];

  return Buffer.concat(payloadParts);
}

export function createGetPollVotesPayload(pollName, onlyCounts) {
  const pollNameBuffer = Buffer.from(pollName, 'utf-8');
  const pollNameLengthBuffer = Buffer.alloc(4);
  pollNameLengthBuffer.writeInt32BE(pollNameBuffer.length);

  const onlyCountsBuffer = Buffer.alloc(4);
  onlyCountsBuffer.writeInt32BE(onlyCounts ? 1 : 0);

  const buffer = Buffer.concat([
    pollNameLengthBuffer,
    pollNameBuffer,
    onlyCountsBuffer,
  ]);

  return buffer;
}

export function createGetArbitraryLatestTransactionPayload(
  service: number,
  name: string,
  identifier: string | null
): Buffer {
  const serviceBuffer = Buffer.alloc(4);
  serviceBuffer.writeInt32BE(service); // Assuming service is numeric in string form

  const nameBuffer = Buffer.from(name, 'utf-8');
  const nameLengthBuffer = Buffer.alloc(4);
  nameLengthBuffer.writeInt32BE(nameBuffer.length);

  let identifierBuffer = Buffer.alloc(0);
  const hasIdentifierBuffer = Buffer.alloc(4);

  if (identifier) {
    const rawIdentifierBuffer = Buffer.from(identifier, 'utf-8');
    const identifierLengthBuffer = Buffer.alloc(4);
    identifierLengthBuffer.writeInt32BE(rawIdentifierBuffer.length);
    hasIdentifierBuffer.writeInt32BE(1);
    identifierBuffer = Buffer.concat([
      identifierLengthBuffer,
      rawIdentifierBuffer,
    ]);
  } else {
    hasIdentifierBuffer.writeInt32BE(0);
  }

  return Buffer.concat([
    serviceBuffer,
    nameLengthBuffer,
    nameBuffer,
    hasIdentifierBuffer,
    identifierBuffer,
  ]);
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

export function createGetLastBlockHeightPayload(
  includeOnlineSignatures: boolean
): Buffer {
  const onlyAdminsBuffer = Buffer.alloc(4);
  onlyAdminsBuffer.writeInt32BE(includeOnlineSignatures ? 1 : 0);

  return Buffer.concat([onlyAdminsBuffer]);
}

export function createGetChatMessagesPayload(
  txGroupId: number | null,
  involving: string[] | null | undefined,
  encoding: number, // Assuming Encoding is a number (adjust if Enum)
  reference: string | null,
  before: number | null,
  after: number | null,
  chatReference: string | null,
  hasChatReference: boolean,
  sender: string | null,
  offset: number,
  limit: number,
  reverse: boolean
): Buffer {
  const buffers: Buffer[] = [];

  // txGroupId (nullable int)
  const txGroupIdBuffer = Buffer.alloc(4);
  txGroupIdBuffer.writeInt32BE(txGroupId !== null ? txGroupId : -1);
  buffers.push(txGroupIdBuffer);

  // involving count (handle undefined/null)
  const involvingSafe = involving || [];
  const involvingCountBuffer = Buffer.alloc(4);
  involvingCountBuffer.writeInt32BE(involvingSafe.length);
  buffers.push(involvingCountBuffer);

  // involving addresses
  for (const addr of involvingSafe) {
    const addrBytes = bs58.decode(addr);
    if (addrBytes.length !== 25) throw new Error('Invalid address length');
    buffers.push(Buffer.from(addrBytes));
  }

  // encoding (1 byte)
  const encodingBuffer = Buffer.alloc(1);
  encodingBuffer.writeUInt8(encoding);
  buffers.push(encodingBuffer);

  // reference (nullable 64 bytes)
  if (reference) {
    buffers.push(Buffer.alloc(4, 1)); // hasReference = 1
    const refBytes = bs58.decode(reference);
    if (refBytes.length !== 64) throw new Error('Invalid reference length');
    buffers.push(Buffer.from(refBytes));
  } else {
    buffers.push(Buffer.alloc(4, 0)); // hasReference = 0
  }

  // before (nullable long)
  if (before !== null && before !== undefined) {
    buffers.push(Buffer.alloc(4, 1)); // hasBefore = 1
    const beforeBuffer = Buffer.alloc(8);
    beforeBuffer.writeBigInt64BE(BigInt(before));
    buffers.push(beforeBuffer);
  } else {
    buffers.push(Buffer.alloc(4, 0)); // hasBefore = 0
  }

  // after (nullable long)
  if (after !== null && after !== undefined) {
    buffers.push(Buffer.alloc(4, 1)); // hasAfter = 1
    const afterBuffer = Buffer.alloc(8);
    afterBuffer.writeBigInt64BE(BigInt(after));
    buffers.push(afterBuffer);
  } else {
    buffers.push(Buffer.alloc(4, 0)); // hasAfter = 0
  }

  // chatReference (nullable 64 bytes)
  const hasChatReferenceBuffer = Buffer.alloc(4);
  if (hasChatReference === true && chatReference) {
    hasChatReferenceBuffer.writeInt32BE(1);
    buffers.push(hasChatReferenceBuffer);

    const chatRefBytes = bs58.decode(chatReference);
    if (chatRefBytes.length !== 64)
      throw new Error('Invalid chatReference length');
    buffers.push(Buffer.from(chatRefBytes));
  } else if (hasChatReference === false) {
    hasChatReferenceBuffer.writeInt32BE(0);
    buffers.push(hasChatReferenceBuffer);
  } else {
    // hasChatReference === null
    hasChatReferenceBuffer.writeInt32BE(-1);
    buffers.push(hasChatReferenceBuffer);
  }

  // sender (nullable address 25 bytes)
  if (sender) {
    buffers.push(Buffer.alloc(4, 1)); // hasSender = 1
    const senderBytes = bs58.decode(sender);
    if (senderBytes.length !== 25)
      throw new Error('Invalid sender address length');
    buffers.push(Buffer.from(senderBytes));
  } else {
    buffers.push(Buffer.alloc(4, 0)); // hasSender = 0
  }

  // offset (int)
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeInt32BE(offset);
  buffers.push(offsetBuffer);

  // limit (int)
  const limitBuffer = Buffer.alloc(4);
  limitBuffer.writeInt32BE(limit);
  buffers.push(limitBuffer);

  // reverse (int)
  const reverseBuffer = Buffer.alloc(4);
  reverseBuffer.writeInt32BE(reverse ? 1 : 0);
  buffers.push(reverseBuffer);

  return Buffer.concat(buffers);
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

export function createGetPublickeyFromAddressPayload(address: string): Buffer {
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

export function writeSizedStringV2(str: string): Buffer {
  const stringBuffer = Buffer.from(str, 'utf-8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeInt32BE(stringBuffer.length);
  return Buffer.concat([lengthBuffer, stringBuffer]);
}

export function createGetArbitraryDataFileListPayload(
  signature, // Buffer of length 64
  hashes, // Array of Buffers, each 32 bytes (SHA256)
  requestTime, // Number (timestamp)
  requestHops, // Number (int)
  requestingPeer // String | undefined
) {
  const buffers = [];

  // Signature (64 bytes)
  buffers.push(signature);

  // Request Time (8 bytes)
  const requestTimeBuffer = Buffer.alloc(8);
  requestTimeBuffer.writeBigInt64BE(BigInt(requestTime));
  buffers.push(requestTimeBuffer);

  // Request Hops (4 bytes)
  const hopsBuffer = Buffer.alloc(4);
  hopsBuffer.writeInt32BE(requestHops);
  buffers.push(hopsBuffer);

  // Hash count and hash list
  const hashCountBuffer = Buffer.alloc(4);
  const hashList = hashes || [];
  hashCountBuffer.writeInt32BE(hashList.length);
  buffers.push(hashCountBuffer);

  for (const hash of hashList) {
    if (!(hash instanceof Buffer) || hash.length !== 32) {
      throw new Error('Each hash must be a Buffer of 32 bytes');
    }
    buffers.push(hash);
  }

  // Requesting Peer (optional)
  if (requestingPeer) {
    buffers.push(writeSizedStringV2(requestingPeer));
  }

  return Buffer.concat(buffers);
}
