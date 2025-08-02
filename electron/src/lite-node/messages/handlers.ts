import bs58 from 'bs58';
import { XMLParser } from 'fast-xml-parser';

import Decimal from 'decimal.js';

function toBigDecimal(amountBigInt) {
  return new Decimal(amountBigInt.toString()).div(1e8);
}

export async function handleAccountBalance(payload: Buffer) {
  if (payload.length < 41) {
    console.error('❌ Invalid payload length for AccountBalanceMessage');
    return;
  }

  const addressBytes = payload.subarray(0, 25);
  const address = bs58.encode(addressBytes);

  const assetId = payload.readBigUInt64BE(25); // offset = 25
  const balance = payload.readBigUInt64BE(33); // offset = 33

  console.log('📬 Received Account Balance:');
  console.log('🏷️ Address:', address);
  console.log('🪙 Asset ID:', assetId.toString());
  console.log('💰 Balance:', balance.toString());

  return toBigDecimal(balance);

  // Optionally store or use the data here
}

export async function handleAccount(payload: Buffer) {
  const ADDRESS_LENGTH = 25;
  const REFERENCE_LENGTH = 64;
  const PUBLIC_KEY_LENGTH = 32;

  if (
    payload.length <
    ADDRESS_LENGTH + REFERENCE_LENGTH + PUBLIC_KEY_LENGTH + 5 * 4
  ) {
    console.error('❌ Invalid payload length for AccountMessage');
    return;
  }

  let offset = 0;

  const addressBytes = payload.subarray(offset, offset + ADDRESS_LENGTH);
  const address = bs58.encode(addressBytes);
  offset += ADDRESS_LENGTH;

  const reference = payload.subarray(offset, offset + REFERENCE_LENGTH);
  offset += REFERENCE_LENGTH;

  const publicKey = payload.subarray(offset, offset + PUBLIC_KEY_LENGTH);
  offset += PUBLIC_KEY_LENGTH;

  const defaultGroupId = payload.readInt32BE(offset);
  offset += 4;

  const flags = payload.readInt32BE(offset);
  offset += 4;

  const level = payload.readInt32BE(offset);
  offset += 4;

  const blocksMinted = payload.readInt32BE(offset);
  offset += 4;

  const blocksMintedAdjustment = payload.readInt32BE(offset);
  offset += 4;

  const blocksMintedPenalty = payload.readInt32BE(offset);
  offset += 4;

  console.log('📬 Received Account Info:');
  console.log('🏷️ Address:', address);
  console.log('🧬 Reference:', bs58.encode(reference));
  console.log('🔑 Public Key:', bs58.encode(publicKey));
  console.log('👥 Default Group ID:', defaultGroupId);
  console.log('🚩 Flags:', flags);
  console.log('⭐ Level:', level);
  console.log('⛏️ Blocks Minted:', blocksMinted);
  console.log('📈 Adjustment:', blocksMintedAdjustment);
  console.log('📉 Penalty:', blocksMintedPenalty);

  return {
    address: address,
    reference: bs58.encode(reference),
    publicKey: bs58.encode(publicKey),
    defaultGroupId: defaultGroupId,
    flags: flags,
    level: level,
    blocksMinted: blocksMinted,
    blocksMintedAdjustment: blocksMintedAdjustment,
    blocksMintedPenalty: blocksMintedPenalty,
  };

  // Use/store this information as needed
}

function readInt(buffer, offset) {
  return { value: buffer.readInt32BE(offset), size: 4 };
}

function readLong(buffer, offset) {
  return { value: Number(buffer.readBigInt64BE(offset)), size: 8 };
}

function readSizedInt(buffer, offset) {
  return readInt(buffer, offset);
}

function readNullableString(buffer, offset) {
  const { value: length, size: lenSize } = readInt(buffer, offset);
  if (length === 0) return { value: null, size: lenSize };
  const str = buffer.toString(
    'utf-8',
    offset + lenSize,
    offset + lenSize + length
  );
  return { value: str, size: lenSize + length };
}

function readNullableData(buffer, offset) {
  const { value: length, size: lenSize } = readInt(buffer, offset);
  if (length === 0) return { value: null, size: lenSize };
  const data = buffer.slice(offset + lenSize, offset + lenSize + length);
  return { value: data, size: lenSize + length };
}

function readNullableTimestamp(buffer, offset) {
  const { value: size, size: lenSize } = readInt(buffer, offset);
  if (size === 0) return { value: null, size: lenSize };
  if (size !== 8) throw new Error('Invalid timestamp size');
  const timestamp = Number(buffer.readBigInt64BE(offset + lenSize));
  return { value: timestamp, size: lenSize + 8 };
}

function readTimestamp(buffer, offset) {
  return readLong(buffer, offset);
}

export function handleActiveChat(buffer) {
  let offset = 0;

  // GROUP CHATS
  const { value: groupCount, size: groupCountSize } = readSizedInt(
    buffer,
    offset
  );
  offset += groupCountSize;
  const groups = [];

  for (let i = 0; i < groupCount; i++) {
    const { value: groupId, size: s1 } = readInt(buffer, offset);
    offset += s1;

    const { value: groupName, size: s2 } = readNullableString(buffer, offset);
    offset += s2;

    const { value: timestamp, size: s3 } = readNullableTimestamp(
      buffer,
      offset
    );
    offset += s3;

    const { value: sender, size: s4 } = readNullableString(buffer, offset);
    offset += s4;

    const { value: senderName, size: s5 } = readNullableString(buffer, offset);
    offset += s5;

    const { value: signature, size: s6 } = readNullableData(buffer, offset);
    offset += s6;

    const encoding = buffer.readUInt8(offset); // single byte
    offset += 1;

    const { value: data, size: s7 } = readNullableString(buffer, offset);
    offset += s7;

    groups.push({
      groupId,
      groupName,
      timestamp,
      sender,
      senderName,
      signature: signature ? bs58.encode(signature) : null,
      encoding,
      data,
    });
  }

  // DIRECT CHATS
  const { value: directCount, size: directCountSize } = readSizedInt(
    buffer,
    offset
  );
  offset += directCountSize;
  const direct = [];

  for (let i = 0; i < directCount; i++) {
    const { value: address, size: s1 } = readNullableString(buffer, offset);
    offset += s1;

    const { value: name, size: s2 } = readNullableString(buffer, offset);
    offset += s2;

    const { value: timestamp, size: s3 } = readTimestamp(buffer, offset);
    offset += s3;

    const { value: sender, size: s4 } = readNullableString(buffer, offset);
    offset += s4;

    const { value: senderName, size: s5 } = readNullableString(buffer, offset);
    offset += s5;

    direct.push({
      address,
      name,
      timestamp,
      sender,
      senderName,
    });
  }
  return { groups, direct };
}

export function handleProcessTransactionResponseMessage(payload: Buffer) {
  const jsonString = payload.toString('utf-8');

  try {
    const parsed = JSON.parse(jsonString);

    console.log('📬 Received ProcessTransactionResponseMessage:');
    console.dir(parsed, { depth: null });

    return parsed;
  } catch (err) {
    console.error('❌ Failed to parse JSON:', jsonString);
    return null;
  }
}

export async function handleLastReference(payload: Buffer) {
  const lastReference = bs58.encode(payload);

  console.log('🧾 lastReference:', lastReference);

  return lastReference;
}

export function handlePrimaryNameMessage(buffer) {
  let offset = 0;

  const { value: name, size: nameSize } = readNullableString(buffer, offset);
  offset += nameSize;

  const addressBytes = buffer.subarray(offset, offset + 25);
  offset += 25;

  const owner = bs58.encode(addressBytes);

  return {
    name,
    owner,
  };
}

export function handleNamesMessage(buffer) {
  let offset = 0;

  const { value: count, size: countSize } = readInt(buffer, offset);
  offset += countSize;

  const names = [];

  for (let i = 0; i < count; i++) {
    const { value: name, size: s1 } = readNullableString(buffer, offset);
    offset += s1;

    const { value: reducedName, size: s2 } = readNullableString(buffer, offset);
    offset += s2;

    const addressBytes = buffer.subarray(offset, offset + 25);
    const owner = bs58.encode(addressBytes);
    offset += 25;

    const { value: data, size: s3 } = readNullableString(buffer, offset);
    offset += s3;

    const { value: registered, size: s4 } = readLong(buffer, offset);
    offset += s4;

    const { value: wasUpdated, size: s5 } = readInt(buffer, offset);
    offset += s5;

    let updated = null;
    if (wasUpdated === 1) {
      const { value, size } = readLong(buffer, offset);
      updated = value;
      offset += size;
    }

    const { value: isForSaleInt, size: s6 } = readInt(buffer, offset);
    offset += s6;
    const isForSale = isForSaleInt === 1;

    let salePrice = null;
    if (isForSale) {
      const { value, size } = readLong(buffer, offset);
      salePrice = value;
      offset += size;
    }

    const reference = buffer.subarray(offset, offset + 64);
    offset += 64;

    const { value: creationGroupId, size: s7 } = readInt(buffer, offset);
    offset += s7;

    names.push({
      name,
      reducedName,
      owner,
      data,
      registered,
      updated,
      isForSale,
      salePrice,
      reference: bs58.encode(reference), // keep as Buffer, or convert if needed
      creationGroupId,
    });
  }

  return names;
}

export function handleUnitFee(payload: Buffer): bigint {
  if (payload.length !== 8) {
    throw new Error(
      `❌ Invalid payload length for UnitFeeResponseMessage. Expected 8 bytes, got ${payload.length}`
    );
  }

  const unitFee = payload.readBigUInt64BE(0);
  return unitFee;
}

export function handleGroupsMessage(buffer) {
  let offset = 0;

  const { value: count, size: countSize } = readInt(buffer, offset);
  offset += countSize;

  const APPROVAL_THRESHOLDS = {
    0: 'NONE',
    1: 'ONE',
    20: 'PCT20',
    40: 'PCT40',
    60: 'PCT60',
    80: 'PCT80',
    100: 'PCT100',
  };

  const groups = [];

  for (let i = 0; i < count; i++) {
    const { value: groupIdInt, size: s1 } = readInt(buffer, offset);
    offset += s1;
    const groupId = groupIdInt === 0 ? null : groupIdInt;

    const ownerBytes = buffer.subarray(offset, offset + 25);
    const owner = bs58.encode(ownerBytes);
    offset += 25;

    const { value: groupName, size: s2 } = readNullableString(buffer, offset);
    offset += s2;

    const { value: description, size: s3 } = readNullableString(buffer, offset);
    offset += s3;

    const { value: created, size: s4 } = readLong(buffer, offset);
    offset += s4;

    const { value: hasUpdated, size: s5 } = readInt(buffer, offset);
    offset += s5;

    let updated = null;
    if (hasUpdated === 1) {
      const { value, size } = readLong(buffer, offset);
      updated = value;
      offset += size;
    }

    const { value: isOpenInt, size: s6 } = readInt(buffer, offset);
    offset += s6;
    const isOpen = isOpenInt === 1;

    const { value: approvalThresholdValue, size: s7 } = readInt(buffer, offset);
    offset += s7;
    const approvalThreshold =
      APPROVAL_THRESHOLDS[approvalThresholdValue] || 'UNKNOWN';

    const { value: minimumBlockDelay, size: s8 } = readInt(buffer, offset);
    offset += s8;

    const { value: maximumBlockDelay, size: s9 } = readInt(buffer, offset);
    offset += s9;

    const reference = buffer.subarray(offset, offset + 64);
    offset += 64;

    const { value: creationGroupId, size: s10 } = readInt(buffer, offset);
    offset += s10;

    const { value: reducedGroupName, size: s11 } = readNullableString(
      buffer,
      offset
    );
    offset += s11;

    const { value: isAdminFlag, size: s12 } = readInt(buffer, offset);
    offset += s12;

    let isAdmin = null;
    if (isAdminFlag === 1) isAdmin = false;
    if (isAdminFlag === 2) isAdmin = true;

    const { value: memberCount, size: s13 } = readInt(buffer, offset);
    offset += s13;

    groups.push({
      groupId,
      owner,
      groupName,
      description,
      created,
      updated,
      isOpen,
      approvalThreshold,
      minimumBlockDelay,
      maximumBlockDelay,
      memberCount,
    });
  }

  return groups;
}
