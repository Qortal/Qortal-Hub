/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import crypto from 'crypto';

export function encodeMessage(type: number, payload: any): Buffer {
  // For demo purposes, we assume payload is JSON
  const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf-8');
  const payloadLength = payloadBuffer.length;

  const buffer = Buffer.alloc(4 + 8 + payloadLength); // type + nonce + payload

  buffer.writeInt32BE(type, 0);

  // Random nonce (8 bytes)
  const nonce = crypto.randomBytes(8);
  nonce.copy(buffer, 4);

  // Payload
  payloadBuffer.copy(buffer, 12);

  return buffer;
}

export function decodeMessage(buffer: Buffer): {
  type: number;
  nonce: Buffer;
  payload: any;
} {
  const type = buffer.readInt32BE(0);
  const nonce = buffer.subarray(4, 12);
  const payloadBuffer = buffer.subarray(12);
  let payload;

  try {
    payload = JSON.parse(payloadBuffer.toString('utf-8'));
  } catch {
    payload = payloadBuffer;
  }

  return { type, nonce, payload };
}
