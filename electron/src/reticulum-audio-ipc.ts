/**
 * Binary framing for Reticulum group audio over extra stdio pipes (fd 3 / fd 4).
 * Must stay in sync with presence_bridge.py (AUDIO_MAGIC, parse/encode).
 *
 * Runtime diagnostics: grep main + Python bridge logs for `target=reticulum-audio-ipc`.
 * Narrowing chain: `stage=fd3-first-batch-from-parent-parsed` (Python read fd3) →
 * `rns-first-packet-send-ok` or `rns-send-failed-first-code` → `fd4-first-chunk-enqueued-to-parent` (Python) →
 * `fd4-first-raw-chunk-from-child` / `fd4=first-message-decoded` (Electron).
 */

import { Buffer } from 'buffer';

export const RETICULUM_AUDIO_MAGIC = Buffer.from('QAUD', 'ascii');
export const RETICULUM_AUDIO_VERSION = 1;
export const RETICULUM_AUDIO_HEADER_BYTES = 9;

/** Max single-frame Opus-ish payload per frame (before base64 expansion in RNS JSON wire). */
export const RETICULUM_AUDIO_MAX_PAYLOAD = 8192;
export const RETICULUM_AUDIO_MAX_LINK_ID_LEN = 36;
export const RETICULUM_AUDIO_MAX_ROOM_ID_LEN = 255;
export const RETICULUM_AUDIO_MAX_HASH_LEN = 128;
export const RETICULUM_AUDIO_MAX_FRAMES_PER_BATCH = 32;
export const RETICULUM_AUDIO_MAX_BODY_BYTES = 65536;

export type ReticulumAudioFrame = {
  linkId: string;
  roomId: string;
  /** Outbound from Electron: omit or empty. Inbound from bridge: peer presence hash hex. */
  peerPresenceHash?: string;
  /** Inbound: peer destination hash hex (`r` on GCA wire). */
  peerDestinationHash?: string;
  payload: Buffer;
};

export class ReticulumAudioIpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReticulumAudioIpcError';
  }
}

function writeU16BE(buf: Buffer, offset: number, v: number): void {
  buf.writeUInt16BE(v & 0xffff, offset);
}

function readU16BE(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset);
}

/**
 * Encode one or more frames into a single message (parent → child or child → parent).
 */
export function encodeReticulumAudioBatch(frames: ReticulumAudioFrame[]): Buffer {
  if (frames.length === 0 || frames.length > RETICULUM_AUDIO_MAX_FRAMES_PER_BATCH) {
    throw new ReticulumAudioIpcError('invalid frame count');
  }

  const chunks: Buffer[] = [];
  let bodySize = 2; // frame_count

  for (const f of frames) {
    const lid = Buffer.from(f.linkId, 'utf8');
    const rid = Buffer.from(f.roomId, 'utf8');
    const pph = Buffer.from(f.peerPresenceHash ?? '', 'utf8');
    const pch = Buffer.from(f.peerDestinationHash ?? '', 'utf8');
    if (
      lid.length > RETICULUM_AUDIO_MAX_LINK_ID_LEN ||
      rid.length > RETICULUM_AUDIO_MAX_ROOM_ID_LEN ||
      pph.length > RETICULUM_AUDIO_MAX_HASH_LEN ||
      pch.length > RETICULUM_AUDIO_MAX_HASH_LEN ||
      f.payload.length > RETICULUM_AUDIO_MAX_PAYLOAD
    ) {
      throw new ReticulumAudioIpcError('field too large');
    }
    bodySize +=
      1 +
      lid.length +
      1 +
      rid.length +
      1 +
      pph.length +
      1 +
      pch.length +
      2 +
      f.payload.length;
  }

  if (bodySize > RETICULUM_AUDIO_MAX_BODY_BYTES) {
    throw new ReticulumAudioIpcError('batch body too large');
  }

  const body = Buffer.allocUnsafe(bodySize);
  let o = 0;
  writeU16BE(body, o, frames.length);
  o += 2;
  for (const f of frames) {
    const lid = Buffer.from(f.linkId, 'utf8');
    const rid = Buffer.from(f.roomId, 'utf8');
    const pph = Buffer.from(f.peerPresenceHash ?? '', 'utf8');
    const pch = Buffer.from(f.peerDestinationHash ?? '', 'utf8');
    body[o++] = lid.length;
    lid.copy(body, o);
    o += lid.length;
    body[o++] = rid.length;
    rid.copy(body, o);
    o += rid.length;
    body[o++] = pph.length;
    pph.copy(body, o);
    o += pph.length;
    body[o++] = pch.length;
    pch.copy(body, o);
    o += pch.length;
    writeU16BE(body, o, f.payload.length);
    o += 2;
    f.payload.copy(body, o);
    o += f.payload.length;
  }

  const total = RETICULUM_AUDIO_HEADER_BYTES + bodySize;
  const out = Buffer.allocUnsafe(total);
  RETICULUM_AUDIO_MAGIC.copy(out, 0);
  out[4] = RETICULUM_AUDIO_VERSION;
  out.writeUInt32BE(bodySize, 5);
  body.copy(out, RETICULUM_AUDIO_HEADER_BYTES);
  return out;
}

/**
 * Decode one message; returns frames and bytes consumed (entire buffer must be one message).
 */
export function decodeReticulumAudioMessage(buf: Buffer): ReticulumAudioFrame[] {
  if (buf.length < RETICULUM_AUDIO_HEADER_BYTES) {
    throw new ReticulumAudioIpcError('truncated header');
  }
  if (!buf.subarray(0, 4).equals(RETICULUM_AUDIO_MAGIC)) {
    throw new ReticulumAudioIpcError('bad magic');
  }
  if (buf[4] !== RETICULUM_AUDIO_VERSION) {
    throw new ReticulumAudioIpcError('bad version');
  }
  const bodyLen = buf.readUInt32BE(5);
  if (bodyLen > RETICULUM_AUDIO_MAX_BODY_BYTES || bodyLen < 2) {
    throw new ReticulumAudioIpcError('bad body length');
  }
  if (buf.length < RETICULUM_AUDIO_HEADER_BYTES + bodyLen) {
    throw new ReticulumAudioIpcError('truncated body');
  }
  if (buf.length > RETICULUM_AUDIO_HEADER_BYTES + bodyLen) {
    throw new ReticulumAudioIpcError('trailing junk');
  }

  const body = buf.subarray(RETICULUM_AUDIO_HEADER_BYTES);
  const n = readU16BE(body, 0);
  if (n === 0 || n > RETICULUM_AUDIO_MAX_FRAMES_PER_BATCH) {
    throw new ReticulumAudioIpcError('bad frame_count');
  }

  const out: ReticulumAudioFrame[] = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    if (o >= body.length) throw new ReticulumAudioIpcError('truncated frame meta');
    const ll = body[o++];
    if (ll > RETICULUM_AUDIO_MAX_LINK_ID_LEN || o + ll > body.length) {
      throw new ReticulumAudioIpcError('bad link id');
    }
    const linkId = body.subarray(o, o + ll).toString('utf8');
    o += ll;

    if (o >= body.length) throw new ReticulumAudioIpcError('truncated room');
    const rl = body[o++];
    if (rl > RETICULUM_AUDIO_MAX_ROOM_ID_LEN || o + rl > body.length) {
      throw new ReticulumAudioIpcError('bad room id');
    }
    const roomId = body.subarray(o, o + rl).toString('utf8');
    o += rl;

    if (o >= body.length) throw new ReticulumAudioIpcError('truncated pph');
    const pl = body[o++];
    if (pl > RETICULUM_AUDIO_MAX_HASH_LEN || o + pl > body.length) {
      throw new ReticulumAudioIpcError('bad peer presence hash');
    }
    const peerPresenceHash = body.subarray(o, o + pl).toString('utf8');
    o += pl;

    if (o >= body.length) throw new ReticulumAudioIpcError('truncated pch');
    const cl = body[o++];
    if (cl > RETICULUM_AUDIO_MAX_HASH_LEN || o + cl > body.length) {
      throw new ReticulumAudioIpcError('bad peer destination hash');
    }
    const peerDestinationHash = body.subarray(o, o + cl).toString('utf8');
    o += cl;

    if (o + 2 > body.length) throw new ReticulumAudioIpcError('truncated len');
    const plen = readU16BE(body, o);
    o += 2;
    if (plen > RETICULUM_AUDIO_MAX_PAYLOAD || o + plen > body.length) {
      throw new ReticulumAudioIpcError('bad payload length');
    }
    const payload = Buffer.from(body.subarray(o, o + plen));
    o += plen;
    out.push({ linkId, roomId, peerPresenceHash, peerDestinationHash, payload });
  }
  if (o !== body.length) {
    throw new ReticulumAudioIpcError('leftover bytes in body');
  }
  return out;
}
