import bs58 from 'bs58';

import Decimal from 'decimal.js';

function toBigDecimal(amountBigInt) {
  return new Decimal(amountBigInt.toString()).div(1e8);
}

export async function handleAccountBalance(payload: Buffer) {
  console.log('payload100', payload);
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
