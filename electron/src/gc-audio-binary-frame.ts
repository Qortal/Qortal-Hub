/**
 * Frozen v1 binary wire format for GC_AUDIO on the P2P TCP stream.
 * See plan: magic + version + frameBodyLen (9-byte header) + body.
 *
 * Encoder (v1 product path): MUST NOT emit toNodeIdLen === 0 (reject empty toNodeId).
 * Decoder: MUST accept toNodeIdLen === 0 for hostile/fuzz/Phase-3b forward compat.
 */

import * as crypto from 'crypto';

/** `QGA\x01` — cannot start valid trimmed JSON. */
export const GC_AUDIO_BINARY_MAGIC = Buffer.from([0x51, 0x47, 0x41, 0x01]);

export const GC_AUDIO_BINARY_VERSION = 1;

export const GC_AUDIO_BINARY_HEADER_BYTES = 9;

/** Match renderer / group-call wire cap for ciphertext only. */
export const GC_AUDIO_MAX_CIPHERTEXT_WIRE_BYTES = 12_288;

/** Max UTF-8 byte length for node ids on the frame. */
export const GC_AUDIO_BINARY_MAX_NODE_ID_BYTES = 64;

/** Max UTF-8 byte length for roomId. */
export const GC_AUDIO_BINARY_MAX_ROOM_ID_BYTES = 256;

/** Align with GCALL_AUDIO_MAX_ADDR_LEN (Qortal address). */
export const GC_AUDIO_BINARY_MAX_TO_ADDRESS_BYTES = 100;

const HEADER_MAGIC_END = 4;
const HEADER_VERSION_OFF = 4;
const HEADER_FRAME_BODY_LEN_OFF = 5;

function readUInt32BE(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

function maxFrameBodyLen(): number {
  return (
    16 + // dedupId
    1 + // p2pHops
    1 +
    GC_AUDIO_BINARY_MAX_NODE_ID_BYTES + // toNodeId max
    1 +
    GC_AUDIO_BINARY_MAX_NODE_ID_BYTES + // fromNodeId max
    2 +
    GC_AUDIO_BINARY_MAX_ROOM_ID_BYTES +
    2 +
    GC_AUDIO_BINARY_MAX_TO_ADDRESS_BYTES +
    1 + // gcHopsRemaining
    4 + // ciphertextLen
    GC_AUDIO_MAX_CIPHERTEXT_WIRE_BYTES
  );
}

/** Full frame: header + body (upper bound). */
export const MAX_GC_AUDIO_BINARY_FRAME_BYTES =
  GC_AUDIO_BINARY_HEADER_BYTES + maxFrameBodyLen();

export interface GcAudioBinaryEncodeInput {
  /** If omitted, random 16 bytes. */
  dedupId?: Buffer;
  p2pHops: number;
  /** v1: non-empty. */
  toNodeId: string;
  fromNodeId: string;
  roomId: string;
  toAddress: string;
  gcHopsRemaining: number;
  ciphertext: Buffer;
}

export interface GcAudioBinaryDecoded {
  dedupId: Buffer;
  dedupKeyHex: string;
  p2pHops: number;
  toNodeId: string;
  fromNodeId: string;
  roomId: string;
  toAddress: string;
  gcHopsRemaining: number;
  ciphertext: Buffer;
}

export class GcAudioBinaryEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GcAudioBinaryEncodeError';
  }
}

/** 32-char hex for P2P seenMessages / dedup. */
export function dedupIdToSeenKey(dedupId: Buffer): string {
  if (dedupId.length !== 16) {
    throw new GcAudioBinaryEncodeError('dedupId must be 16 bytes');
  }
  return dedupId.toString('hex');
}

function utf8Bytes(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

/**
 * Build one on-wire binary GC_AUDIO record. Throws GcAudioBinaryEncodeError on invalid input.
 */
export function encodeGcAudioBinaryFrame(input: GcAudioBinaryEncodeInput): Buffer {
  const { p2pHops, fromNodeId, roomId, toAddress, gcHopsRemaining, ciphertext } = input;
  const toNodeId = input.toNodeId;

  if (!toNodeId || utf8Bytes(toNodeId).length === 0) {
    throw new GcAudioBinaryEncodeError('v1 encode requires non-empty toNodeId');
  }

  if (p2pHops < 0 || p2pHops > 255 || !Number.isInteger(p2pHops)) {
    throw new GcAudioBinaryEncodeError('p2pHops must be uint8');
  }
  if (gcHopsRemaining < 0 || gcHopsRemaining > 255 || !Number.isInteger(gcHopsRemaining)) {
    throw new GcAudioBinaryEncodeError('gcHopsRemaining must be uint8');
  }

  const dedupId =
    input.dedupId ?? crypto.randomBytes(16);
  if (dedupId.length !== 16) {
    throw new GcAudioBinaryEncodeError('dedupId must be 16 bytes');
  }

  if (!Buffer.isBuffer(ciphertext) || ciphertext.length > GC_AUDIO_MAX_CIPHERTEXT_WIRE_BYTES) {
    throw new GcAudioBinaryEncodeError('ciphertext length out of range');
  }

  const toNodeBuf = utf8Bytes(toNodeId);
  const fromNodeBuf = utf8Bytes(fromNodeId);
  const roomBuf = utf8Bytes(roomId);
  const addrBuf = utf8Bytes(toAddress);

  if (toNodeBuf.length === 0 || toNodeBuf.length > GC_AUDIO_BINARY_MAX_NODE_ID_BYTES) {
    throw new GcAudioBinaryEncodeError('toNodeId utf8 length invalid');
  }
  if (fromNodeBuf.length === 0 || fromNodeBuf.length > GC_AUDIO_BINARY_MAX_NODE_ID_BYTES) {
    throw new GcAudioBinaryEncodeError('fromNodeId utf8 length invalid');
  }
  if (roomBuf.length > GC_AUDIO_BINARY_MAX_ROOM_ID_BYTES) {
    throw new GcAudioBinaryEncodeError('roomId utf8 length exceeds cap');
  }
  if (addrBuf.length > GC_AUDIO_BINARY_MAX_TO_ADDRESS_BYTES) {
    throw new GcAudioBinaryEncodeError('toAddress utf8 length exceeds cap');
  }

  const bodyLen =
    16 +
    1 +
    1 +
    toNodeBuf.length +
    1 +
    fromNodeBuf.length +
    2 +
    roomBuf.length +
    2 +
    addrBuf.length +
    1 +
    4 +
    ciphertext.length;

  if (bodyLen > maxFrameBodyLen()) {
    throw new GcAudioBinaryEncodeError('frame body exceeds max');
  }

  const body = Buffer.allocUnsafe(bodyLen);
  let o = 0;
  dedupId.copy(body, o);
  o += 16;
  body[o++] = p2pHops & 0xff;
  body[o++] = toNodeBuf.length & 0xff;
  toNodeBuf.copy(body, o);
  o += toNodeBuf.length;
  body[o++] = fromNodeBuf.length & 0xff;
  fromNodeBuf.copy(body, o);
  o += fromNodeBuf.length;
  body.writeUInt16BE(roomBuf.length, o);
  o += 2;
  roomBuf.copy(body, o);
  o += roomBuf.length;
  body.writeUInt16BE(addrBuf.length, o);
  o += 2;
  addrBuf.copy(body, o);
  o += addrBuf.length;
  body[o++] = gcHopsRemaining & 0xff;
  body.writeUInt32BE(ciphertext.length, o);
  o += 4;
  ciphertext.copy(body, o);

  const out = Buffer.allocUnsafe(GC_AUDIO_BINARY_HEADER_BYTES + bodyLen);
  GC_AUDIO_BINARY_MAGIC.copy(out, 0);
  out[HEADER_VERSION_OFF] = GC_AUDIO_BINARY_VERSION;
  out.writeUInt32BE(bodyLen, HEADER_FRAME_BODY_LEN_OFF);
  body.copy(out, GC_AUDIO_BINARY_HEADER_BYTES);
  return out;
}

export type ParseGcAudioBinaryResult =
  | { ok: true; consumed: number; frame: GcAudioBinaryDecoded }
  | { ok: false; code: 'incomplete' }
  | { ok: false; code: 'malformed'; consumed: number };

/**
 * If buffer starts with magic, attempt to parse a full frame.
 * Caller should only invoke when the first 4 bytes equal GC_AUDIO_BINARY_MAGIC.
 */
export function parseGcAudioBinaryFrame(buf: Buffer): ParseGcAudioBinaryResult {
  if (buf.length < GC_AUDIO_BINARY_HEADER_BYTES) {
    return { ok: false, code: 'incomplete' };
  }

  if (!buf.subarray(0, 4).equals(GC_AUDIO_BINARY_MAGIC)) {
    return { ok: false, code: 'malformed', consumed: 0 };
  }

  const version = buf[HEADER_VERSION_OFF];
  if (version !== GC_AUDIO_BINARY_VERSION) {
    return { ok: false, code: 'malformed', consumed: 4 };
  }

  const frameBodyLen = readUInt32BE(buf, HEADER_FRAME_BODY_LEN_OFF);
  /** Minimum body: dedup + p2p + toLen(0) + fromLen(1) + min from + empty room/addr + gcHop + ctLen + ct(0). */
  const MIN_FRAME_BODY_LEN = 29;
  if (frameBodyLen < MIN_FRAME_BODY_LEN || frameBodyLen > maxFrameBodyLen()) {
    return { ok: false, code: 'malformed', consumed: 4 };
  }

  const total = GC_AUDIO_BINARY_HEADER_BYTES + frameBodyLen;
  if (buf.length < total) {
    return { ok: false, code: 'incomplete' };
  }

  const body = buf.subarray(GC_AUDIO_BINARY_HEADER_BYTES, total);
  let o = 0;

  const dedupId = body.subarray(o, o + 16);
  o += 16;

  const p2pHops = body[o++];

  const toNodeIdLen = body[o++];
  if (toNodeIdLen > GC_AUDIO_BINARY_MAX_NODE_ID_BYTES) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  if (o + toNodeIdLen > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const toNodeId = body.subarray(o, o + toNodeIdLen).toString('utf8');
  o += toNodeIdLen;

  const fromNodeIdLen = body[o++];
  if (fromNodeIdLen > GC_AUDIO_BINARY_MAX_NODE_ID_BYTES || fromNodeIdLen === 0) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  if (o + fromNodeIdLen > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const fromNodeId = body.subarray(o, o + fromNodeIdLen).toString('utf8');
  o += fromNodeIdLen;

  if (o + 2 > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const roomIdLen = body.readUInt16BE(o);
  o += 2;
  if (roomIdLen > GC_AUDIO_BINARY_MAX_ROOM_ID_BYTES) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  if (o + roomIdLen > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const roomId = body.subarray(o, o + roomIdLen).toString('utf8');
  o += roomIdLen;

  if (o + 2 > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const toAddressLen = body.readUInt16BE(o);
  o += 2;
  if (toAddressLen > GC_AUDIO_BINARY_MAX_TO_ADDRESS_BYTES) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  if (o + toAddressLen > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const toAddress = body.subarray(o, o + toAddressLen).toString('utf8');
  o += toAddressLen;

  if (o + 1 + 4 > body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  const gcHopsRemaining = body[o++];

  const ciphertextLen = body.readUInt32BE(o);
  o += 4;

  if (ciphertextLen > GC_AUDIO_MAX_CIPHERTEXT_WIRE_BYTES) {
    return { ok: false, code: 'malformed', consumed: total };
  }
  if (o + ciphertextLen !== body.length) {
    return { ok: false, code: 'malformed', consumed: total };
  }

  const ciphertext = body.subarray(o, o + ciphertextLen);

  return {
    ok: true,
    consumed: total,
    frame: {
      dedupId: Buffer.from(dedupId),
      dedupKeyHex: dedupIdToSeenKey(Buffer.from(dedupId)),
      p2pHops,
      toNodeId,
      fromNodeId,
      roomId,
      toAddress,
      gcHopsRemaining,
      ciphertext,
    },
  };
}

/** True if buf has at least 4 bytes and they equal the binary magic. */
export function bufferStartsWithGcAudioBinaryMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(GC_AUDIO_BINARY_MAGIC);
}
