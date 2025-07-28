import bs58 from 'bs58';

const ADDRESS_LENGTH = 25;

export function createGetAccountMessagePayload(address: string): Buffer {
  const addressBytes = bs58.decode(address);
  if (addressBytes.length !== ADDRESS_LENGTH) {
    throw new Error(
      `Invalid address length. Expected ${ADDRESS_LENGTH}, got ${addressBytes.length}`
    );
  }

  return Buffer.from(addressBytes); // ✅ Just raw payload
}
