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

export async function handleSupply(payload: Buffer) {
  if (payload.length < 8) {
    console.error('❌ Invalid payload length for SupplyMessage');
    return;
  }

  const supply = payload.readBigUInt64BE(0); // Read 8 bytes from start

  console.log('📬 Received Total Supply:');
  console.log('💰 Supply:', supply.toString());

  return toBigDecimal(supply); // Or just return supply if no formatting needed
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
      encoding: encoding === 0 ? 'BASE58' : 'BASE64',
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
      salePrice = toBigDecimal(value);
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

export function handlePollsMessage(buffer) {
  let offset = 0;

  const { value: count, size: countSize } = readInt(buffer, offset);
  offset += countSize;

  const polls = [];

  for (let i = 0; i < count; i++) {
    const publicKeyBytes = buffer.subarray(offset, offset + 32);
    const creatorPublicKey = bs58.encode(publicKeyBytes);
    offset += 32;

    const ownerBytes = buffer.subarray(offset, offset + 25);
    const owner = bs58.encode(ownerBytes);
    offset += 25;

    const { value: pollName, size: s1 } = readNullableString(buffer, offset);
    offset += s1;

    const { value: description, size: s2 } = readNullableString(buffer, offset);
    offset += s2;

    const { value: published, size: s3 } = readLong(buffer, offset);
    offset += s3;

    const { value: optionCount, size: s4 } = readInt(buffer, offset);
    offset += s4;

    const options = [];
    for (let j = 0; j < optionCount; j++) {
      const { value: optionName, size: s5 } = readNullableString(
        buffer,
        offset
      );
      offset += s5;

      options.push({
        optionName,
      });
    }

    polls.push({
      creatorPublicKey,
      owner,
      pollName,
      description,
      published,
      options,
    });
  }

  return polls;
}

// export function handlePollVotesMessage(buffer) {
//   let offset = 0;

//   const { value: totalVotes, size: s1 } = readInt(buffer, offset);
//   offset += s1;

//   const { value: totalWeight, size: s2 } = readInt(buffer, offset);
//   offset += s2;

//   const { value: countSize, size: s3 } = readInt(buffer, offset);
//   offset += s3;

//   const voteCounts = [];
//   for (let i = 0; i < countSize; i++) {
//     const { value: optionName, size: s4 } = readSizedString(buffer, offset);
//     offset += s4;

//     const { value: voteCount, size: s5 } = readInt(buffer, offset);
//     offset += s5;

//     voteCounts.push({ optionName, voteCount });
//   }

//   const { value: weightSize, size: s6 } = readInt(buffer, offset);
//   offset += s6;

//   const voteWeights = [];
//   for (let i = 0; i < weightSize; i++) {
//     const { value: optionName, size: s7 } = readSizedString(buffer, offset);
//     offset += s7;

//     const { value: voteWeight, size: s8 } = readInt(buffer, offset);
//     offset += s8;

//     voteWeights.push({ optionName, voteWeight });
//   }

//   const { value: hasVotes, size: s9 } = readInt(buffer, offset);
//   offset += s9;

//   let votes = null;
//   if (hasVotes === 1) {
//     const { value: votesCount, size: s10 } = readInt(buffer, offset);
//     offset += s10;

//     votes = [];
//     for (let i = 0; i < votesCount; i++) {
//       const voterPublicKeyBytes = buffer.subarray(offset, offset + 32);
//       const voterPublicKey = bs58.encode(voterPublicKeyBytes);
//       offset += 32;

//       const { value: optionIndex, size: s11 } = readInt(buffer, offset);
//       offset += s11;

//       votes.push({ voterPublicKey, optionIndex });
//     }
//   }

//   return {
//     totalVotes,
//     totalWeight,
//     voteCounts,
//     voteWeights,
//     votes,
//   };
// }

// Debugger version of handlePollVotesMessage

export function handlePollVotesMessage(buffer) {
  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  let offset = 0;

  const readInt = () => {
    const value = dataView.getInt32(offset, false); // big-endian
    offset += 4;
    return value;
  };

  const readSizedString = () => {
    const length = readInt();
    if (length === 0) return '';
    const strBytes = buffer.subarray(offset, offset + length);
    offset += length;
    return new TextDecoder().decode(strBytes);
  };

  const readBytes = (length) => {
    const bytes = buffer.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };

  const log = (...args) => console.log('[Offset:', offset, ']', ...args);

  // hasVotes flag
  const hasVotes = readInt();
  log('hasVotes:', hasVotes);

  let votes = null;
  if (hasVotes === 1) {
    const votesCount = readInt();
    log('votesCount:', votesCount);

    votes = [];
    for (let i = 0; i < votesCount; i++) {
      const pollName = readSizedString();
      log(`vote[${i}] pollName:`, pollName);

      const voterPublicKeyBytes = readBytes(32);
      const voterPublicKey = bs58.encode(voterPublicKeyBytes);
      log(`vote[${i}] voterPublicKey:`, voterPublicKey);

      const optionIndex = readInt();
      log(`vote[${i}] optionIndex:`, optionIndex);

      votes.push({ pollName, voterPublicKey, optionIndex });
    }
  }

  const totalVotes = readInt();
  log('totalVotes:', totalVotes);

  const totalWeight = readInt();
  log('totalWeight:', totalWeight);

  const voteCountsSize = readInt();
  log('voteCounts size:', voteCountsSize);

  const voteCounts = [];
  for (let i = 0; i < voteCountsSize; i++) {
    const optionName = readSizedString();
    const voteCount = readInt();
    log(`voteCount[${i}] optionName:`, optionName, 'count:', voteCount);
    voteCounts.push({ optionName, voteCount });
  }

  const voteWeightsSize = readInt();
  log('voteWeights size:', voteWeightsSize);

  const voteWeights = [];
  for (let i = 0; i < voteWeightsSize; i++) {
    const optionName = readSizedString();
    const voteWeight = readInt();
    log(`voteWeight[${i}] optionName:`, optionName, 'weight:', voteWeight);
    voteWeights.push({ optionName, voteWeight });
  }

  log('Final offset:', offset, '/', buffer.length);

  return {
    hasVotes: hasVotes === 1,
    votes,
    totalVotes,
    totalWeight,
    voteCounts,
    voteWeights,
  };
}

export async function handleBlockDataMessage(buffer) {
  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  let offset = 0;

  const readInt = () => {
    const value = dataView.getInt32(offset, false);
    offset += 4;
    return value;
  };

  const readLong = () => {
    const high = dataView.getInt32(offset, false);
    const low = dataView.getInt32(offset + 4, false);
    offset += 8;
    return (BigInt(high) << 32n) | BigInt(low >>> 0);
  };

  const readBytes = (length) => {
    const bytes = buffer.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };

  const readNullableBytes = () => {
    const length = readInt();
    if (length === 0) return null;
    return readBytes(length);
  };

  const readNullableTimestamp = () => {
    const size = readInt();
    if (size === 0) return null;
    if (size !== 8) throw new Error('Invalid timestamp size');
    return readLong();
  };

  const readNullableString = () => {
    const length = readInt();
    if (length === 0) return null;
    const bytes = readBytes(length);
    return new TextDecoder().decode(bytes);
  };

  // === Read fields ===
  const version = readInt();
  const reference = readNullableBytes();
  const transactionCount = readInt();
  const totalFees = readLong();
  const transactionsSignature = readNullableBytes();
  const height = readInt();
  const timestamp = readLong();
  const minterPublicKey = readNullableBytes();
  const minterSignature = readNullableBytes();
  const atCount = readInt();
  const atFees = readLong();
  const encodedOnlineAccounts = readNullableBytes();
  const onlineAccountsCount = readInt();
  const onlineAccountsTimestamp = readNullableTimestamp();
  const onlineAccountsSignatures = readNullableBytes();
  const signature = readNullableBytes();

  // === New extra fields ===
  const minterAddress = readNullableString();
  const minterLevel = readInt();

  return {
    signature: signature ? bs58.encode(signature) : null,
    version,
    reference: reference ? bs58.encode(reference) : null,
    transactionCount,
    totalFees: (Number(totalFees) / 1e8).toFixed(8),
    transactionsSignature: transactionsSignature
      ? bs58.encode(transactionsSignature)
      : null,
    height,
    timestamp: Number(timestamp),
    minterPublicKey: minterPublicKey ? bs58.encode(minterPublicKey) : null,
    minterSignature: minterSignature ? bs58.encode(minterSignature) : null,
    atCount,
    atFees: (Number(atFees) / 1e8).toFixed(8),
    encodedOnlineAccounts: encodedOnlineAccounts
      ? bs58.encode(encodedOnlineAccounts)
      : '',
    onlineAccountsCount,
    onlineAccountsTimestamp: onlineAccountsTimestamp
      ? Number(onlineAccountsTimestamp)
      : null,
    onlineAccountsSignatures: onlineAccountsSignatures
      ? bs58.encode(onlineAccountsSignatures)
      : null,
    minterAddress,
    minterLevel,
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

export function handleGroupsMessage(buffer, includeAdmin) {
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

    let isAdmin = false;
    if (isAdminFlag === 1) isAdmin = false;
    if (isAdminFlag === 2) isAdmin = true;

    const { value: memberCount, size: s13 } = readInt(buffer, offset);
    offset += s13;

    const groupData: any = {
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
    };

    if (includeAdmin) {
      groupData.isAdmin = isAdmin;
    }

    groups.push(groupData);
  }

  return groups;
}

export function handleGroupBansMessage(buffer) {
  let offset = 0;

  const { value: count, size: countSize } = readInt(buffer, offset);
  offset += countSize;

  const bans = [];

  for (let i = 0; i < count; i++) {
    const { value: groupId, size: s1 } = readInt(buffer, offset);
    offset += s1;

    const offenderBytes = buffer.subarray(offset, offset + 25);
    const offender = bs58.encode(offenderBytes);
    offset += 25;

    const adminBytes = buffer.subarray(offset, offset + 25);
    const admin = bs58.encode(adminBytes);
    offset += 25;

    const { value: banned, size: s2 } = readLong(buffer, offset);
    offset += s2;

    const { value: reason, size: s3 } = readNullableString(buffer, offset);
    offset += s3;

    const { value: hasExpiry, size: s4 } = readInt(buffer, offset);
    offset += s4;

    let expiry = null;
    if (hasExpiry === 1) {
      const { value, size } = readLong(buffer, offset);
      expiry = value;
      offset += size;
    }

    const referenceBytes = buffer.subarray(offset, offset + 64);
    const reference = bs58.encode(referenceBytes);
    offset += 64;

    bans.push({
      groupId,
      offender,
      admin,
      banned,
      reason,
      expiry,
    });
  }

  return bans;
}

export function handleAddressGroupInvitesMessage(buffer) {
  let offset = 0;

  const { value: count, size: countSize } = readInt(buffer, offset);
  offset += countSize;

  const invites = [];

  for (let i = 0; i < count; i++) {
    const { value: groupId, size: s1 } = readInt(buffer, offset);
    offset += s1;

    const inviterBytes = buffer.subarray(offset, offset + 25);
    const inviter = bs58.encode(inviterBytes);
    offset += 25;

    const inviteeBytes = buffer.subarray(offset, offset + 25);
    const invitee = bs58.encode(inviteeBytes);
    offset += 25;

    const { value: hasExpiry, size: s2 } = readInt(buffer, offset);
    offset += s2;

    let expiry = null;
    if (hasExpiry === 1) {
      const { value, size } = readLong(buffer, offset);
      expiry = value;
      offset += size;
    }

    const referenceBytes = buffer.subarray(offset, offset + 64);
    const reference = bs58.encode(referenceBytes);
    offset += 64;

    invites.push({
      groupId,
      inviter,
      invitee,
      expiry,
    });
  }

  return invites;
}

export function handleGroupJoinRequestsMessage(buffer) {
  let offset = 0;

  const { value: count, size: countSize } = readInt(buffer, offset);
  offset += countSize;

  const joinRequests = [];

  for (let i = 0; i < count; i++) {
    const { value: groupId, size: s1 } = readInt(buffer, offset);
    offset += s1;

    const joinerBytes = buffer.subarray(offset, offset + 25);
    const joiner = bs58.encode(joinerBytes);
    offset += 25;

    const referenceBytes = buffer.subarray(offset, offset + 64);
    const reference = bs58.encode(referenceBytes);
    offset += 64;

    joinRequests.push({
      groupId,
      joiner,
    });
  }

  return joinRequests;
}

export function handleGroupMembersMessage(buffer) {
  let offset = 0;

  // Read memberCount
  const { value: memberCount, size: s1 } = readInt(buffer, offset);
  offset += s1;

  // Read adminCount
  const { value: adminCount, size: s2 } = readInt(buffer, offset);
  offset += s2;

  // Read members count
  const { value: membersCount, size: s3 } = readInt(buffer, offset);
  offset += s3;

  const members = [];

  for (let i = 0; i < membersCount; i++) {
    // member (25 bytes base58 address)
    const memberBytes = buffer.subarray(offset, offset + 25);
    const member = bs58.encode(memberBytes);
    offset += 25;

    // joined (nullable long)
    const { value: hasJoined, size: s4 } = readInt(buffer, offset);
    offset += s4;

    let joined = null;
    if (hasJoined === 1) {
      const { value: joinedValue, size: s5 } = readLong(buffer, offset);
      joined = joinedValue;
      offset += s5;
    }

    // isAdmin (nullable flag: 0 = null, 1 = false, 2 = true)
    const { value: isAdminFlag, size: s6 } = readInt(buffer, offset);
    offset += s6;

    let isAdmin = false;
    if (isAdminFlag === 1) isAdmin = false;
    if (isAdminFlag === 2) isAdmin = true;

    members.push({
      member,
      joined,
      isAdmin,
    });
  }

  return {
    memberCount,
    adminCount,
    members,
  };
}

export function handlePublicKeyMessage(buffer: Buffer) {
  if (buffer.length !== 32) {
    throw new Error(
      `Invalid public key message length: expected 32, got ${buffer.length}`
    );
  }

  const publicKeyBytes = buffer.subarray(0, 32);

  return bs58.encode(publicKeyBytes);
}

export function handleChatMessages(buffer) {
  let offset = 0;

  const encoding = buffer.readUInt8(offset); // global encoding byte
  offset += 1;

  const { value: messageCount, size: messageCountSize } = readInt(
    buffer,
    offset
  );
  offset += messageCountSize;

  const messages = [];

  for (let i = 0; i < messageCount; i++) {
    const { value: timestamp, size: s1 } = readTimestamp(buffer, offset);
    offset += s1;

    const { value: txGroupId, size: s2 } = readInt(buffer, offset);
    offset += s2;

    const reference = buffer.subarray(offset, offset + 64);
    offset += 64;

    const senderPublicKey = buffer.subarray(offset, offset + 32);
    offset += 32;

    const { value: sender, size: s3 } = readNullableString(buffer, offset);
    offset += s3;

    const { value: senderName, size: s4 } = readNullableString(buffer, offset);
    offset += s4;

    const { value: recipient, size: s5 } = readNullableString(buffer, offset);
    offset += s5;

    const { value: recipientName, size: s6 } = readNullableString(
      buffer,
      offset
    );
    offset += s6;

    const { value: hasChatReference, size: s7 } = readInt(buffer, offset);
    offset += s7;

    let chatReference = null;
    if (hasChatReference === 1) {
      chatReference = buffer.subarray(offset, offset + 64);
      offset += 64;
    }

    const { value: data, size: s8 } = readNullableString(buffer, offset);
    offset += s8;

    const { value: isText, size: s9 } = readInt(buffer, offset);
    offset += s9;

    const { value: isEncrypted, size: s10 } = readInt(buffer, offset);
    offset += s10;

    const signature = buffer.subarray(offset, offset + 64);
    offset += 64;

    messages.push({
      timestamp,
      txGroupId,
      reference: bs58.encode(reference),
      senderPublicKey: bs58.encode(senderPublicKey),
      sender,
      senderName,
      recipient,
      recipientName,
      chatReference: chatReference ? bs58.encode(chatReference) : null,
      encoding: encoding === 0 ? 'BASE58' : 'BASE64',
      data,
      isText: isText === 1,
      isEncrypted: isEncrypted === 1,
      signature: bs58.encode(signature),
    });
  }

  return messages;
}
