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

export function handleUnitFee(payload: Buffer): bigint {
  if (payload.length !== 8) {
    throw new Error(
      `❌ Invalid payload length for UnitFeeResponseMessage. Expected 8 bytes, got ${payload.length}`
    );
  }

  const unitFee = payload.readBigUInt64BE(0);
  return unitFee;
}
