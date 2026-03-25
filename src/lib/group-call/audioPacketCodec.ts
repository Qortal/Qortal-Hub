/**
 * Group call audio packet codec — v2 (authenticated metadata) + v1 decode fallback.
 *
 * v2 wire: nonce[24] || secretbox(inner), where inner = version|addrLen|addr|vad|seq|ts|opus.
 * v1 wire (legacy): addrLen|addr|vad|seq|ts|nonce[24]|secretbox(opus only).
 *
 * timestampMs in v2 inner is uint32 (wraps ~49 days); sufficient for ordering/telemetry per call.
 */

import nacl from '../../encryption/nacl-fast';

export const GCALL_AUDIO_PACKET_V2_VERSION = 2;

/** Match legacy parsePacketHeader guard; Qortal addresses are ~34–35 UTF-8 bytes. */
export const GCALL_AUDIO_MAX_ADDR_LEN = 100;

/** Reject absurd inner / opus sizes (DoS). */
export const GCALL_AUDIO_MAX_INNER_LEN = 8192;
export const GCALL_AUDIO_MAX_OPUS_LEN = 4096;
export const GCALL_AUDIO_MIN_OPUS_LEN = 1;

const SECRETBOX_OVERHEAD = 16;
const V2_MIN_WIRE = 24 + SECRETBOX_OVERHEAD;

export interface DecodedAudioPacket {
  sourceAddr: string;
  vad: boolean;
  seq: number;
  timestampMs: number;
  opusFrame: Uint8Array;
}

/**
 * v2 encode. Returns a new Uint8Array (byteOffset 0); .buffer is transferable as a whole.
 */
export function encodeAudioPacketV2(
  sourceAddr: string,
  vad: boolean,
  seq: number,
  timestampMs: number,
  opusFrame: Uint8Array,
  roomKey: Uint8Array
): Uint8Array {
  const addrBytes = new TextEncoder().encode(sourceAddr);
  if (addrBytes.length === 0 || addrBytes.length > GCALL_AUDIO_MAX_ADDR_LEN) {
    throw new Error('GCALL encode: invalid address length');
  }
  if (opusFrame.length < GCALL_AUDIO_MIN_OPUS_LEN || opusFrame.length > GCALL_AUDIO_MAX_OPUS_LEN) {
    throw new Error('GCALL encode: invalid opus length');
  }

  const ts32 = timestampMs >>> 0;
  const innerLen = 1 + 1 + addrBytes.length + 1 + 2 + 4 + opusFrame.length;
  if (innerLen > GCALL_AUDIO_MAX_INNER_LEN) {
    throw new Error('GCALL encode: inner too large');
  }

  const inner = new Uint8Array(innerLen);
  let o = 0;
  inner[o++] = GCALL_AUDIO_PACKET_V2_VERSION;
  inner[o++] = addrBytes.length;
  inner.set(addrBytes, o);
  o += addrBytes.length;
  inner[o++] = vad ? 1 : 0;
  inner[o++] = (seq >> 8) & 0xff;
  inner[o++] = seq & 0xff;
  inner[o++] = (ts32 >>> 24) & 0xff;
  inner[o++] = (ts32 >>> 16) & 0xff;
  inner[o++] = (ts32 >>> 8) & 0xff;
  inner[o++] = ts32 & 0xff;
  inner.set(opusFrame, o);

  const nonce = nacl.randomBytes(24);
  const ciphertext = nacl.secretbox(inner, nonce, roomKey);
  const out = new Uint8Array(24 + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, 24);
  return out;
}

function tryDecodeV2(buf: Uint8Array, roomKey: Uint8Array): DecodedAudioPacket | null {
  if (buf.length < V2_MIN_WIRE) return null;
  const nonce = buf.subarray(0, 24);
  const box = buf.subarray(24);
  const inner = nacl.secretbox.open(box, nonce, roomKey);
  if (!inner) return null;
  if (inner.length < 1 + 1 + 1 + 1 + 2 + 4 + GCALL_AUDIO_MIN_OPUS_LEN) return null;
  let o = 0;
  const version = inner[o++];
  if (version !== GCALL_AUDIO_PACKET_V2_VERSION) return null;
  const addrLen = inner[o++];
  if (addrLen === 0 || addrLen > GCALL_AUDIO_MAX_ADDR_LEN) return null;
  if (o + addrLen + 1 + 2 + 4 + GCALL_AUDIO_MIN_OPUS_LEN > inner.length) return null;
  const sourceAddr = new TextDecoder().decode(inner.subarray(o, o + addrLen));
  o += addrLen;
  const vad = inner[o++] === 1;
  const seq = (inner[o++] << 8) | inner[o++];
  const timestampMs =
    (inner[o++] << 24) | (inner[o++] << 16) | (inner[o++] << 8) | inner[o++];
  const opusFrame = inner.subarray(o);
  if (opusFrame.length < GCALL_AUDIO_MIN_OPUS_LEN || opusFrame.length > GCALL_AUDIO_MAX_OPUS_LEN) {
    return null;
  }
  return {
    sourceAddr,
    vad,
    seq,
    timestampMs,
    opusFrame: new Uint8Array(opusFrame),
  };
}

function tryDecodeV1(buf: Uint8Array, roomKey: Uint8Array): DecodedAudioPacket | null {
  try {
    let off = 0;
    const addrLen = buf[off++];
    if (addrLen === 0 || addrLen > GCALL_AUDIO_MAX_ADDR_LEN) return null;
    if (off + addrLen + 1 + 2 + 4 + 24 > buf.length) return null;
    const sourceAddr = new TextDecoder().decode(buf.subarray(off, off + addrLen));
    off += addrLen;
    const vad = buf[off++] === 1;
    const seq = (buf[off++] << 8) | buf[off++];
    const timestampMs =
      (buf[off++] << 24) | (buf[off++] << 16) | (buf[off++] << 8) | buf[off++];
    const nonce = buf.subarray(off, off + 24);
    off += 24;
    const ciphertext = buf.subarray(off);
    const plaintext = nacl.secretbox.open(ciphertext, nonce, roomKey);
    if (!plaintext) return null;
    if (plaintext.length < GCALL_AUDIO_MIN_OPUS_LEN || plaintext.length > GCALL_AUDIO_MAX_OPUS_LEN) {
      return null;
    }
    return {
      sourceAddr,
      vad,
      seq,
      timestampMs,
      opusFrame: new Uint8Array(plaintext),
    };
  } catch {
    return null;
  }
}

/**
 * Decode v2 then v1. v1 has no wire version byte; v2 failure falls through to v1 parse from buffer start.
 */
export function decodeAudioPacket(buf: Uint8Array, roomKey: Uint8Array): DecodedAudioPacket | null {
  if (roomKey.length !== 32) return null;
  const v2 = tryDecodeV2(buf, roomKey);
  if (v2) return v2;
  return tryDecodeV1(buf, roomKey);
}

/** Legacy v1 wire encoder — for tests and interop with old senders only. */
export function encodeAudioPacketV1(
  sourceAddr: string,
  vad: boolean,
  seq: number,
  timestampMs: number,
  opusFrame: Uint8Array,
  roomKey: Uint8Array
): Uint8Array {
  const addrBytes = new TextEncoder().encode(sourceAddr);
  if (addrBytes.length === 0 || addrBytes.length > GCALL_AUDIO_MAX_ADDR_LEN) {
    throw new Error('GCALL v1 encode: invalid address length');
  }
  const nonce = nacl.randomBytes(24);
  const ciphertext = nacl.secretbox(opusFrame, nonce, roomKey);
  const total = 1 + addrBytes.length + 1 + 2 + 4 + 24 + ciphertext.length;
  const out = new Uint8Array(total);
  let off = 0;
  out[off++] = addrBytes.length;
  out.set(addrBytes, off);
  off += addrBytes.length;
  out[off++] = vad ? 1 : 0;
  out[off++] = (seq >> 8) & 0xff;
  out[off++] = seq & 0xff;
  out[off++] = (timestampMs >>> 24) & 0xff;
  out[off++] = (timestampMs >>> 16) & 0xff;
  out[off++] = (timestampMs >>> 8) & 0xff;
  out[off++] = timestampMs & 0xff;
  out.set(nonce, off);
  off += 24;
  out.set(ciphertext, off);
  return out;
}
