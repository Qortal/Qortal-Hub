/**
 * audio-decrypt.worker.ts — Web Worker for off-thread audio packet decryption.
 *
 * Offloads nacl.secretbox.open from the renderer's main JS thread.
 * The main thread runs React reconciliation and the 20ms jitter-drain loop;
 * keeping heavy crypto off it eliminates the primary source of lag during calls
 * with 5+ concurrent participants.
 *
 * Message protocol (main → worker):
 *   { type: 'setRoomKey', roomKey: ArrayBuffer }
 *   { type: 'clearRoomKey' }
 *   { type: 'decrypt', id: number, buffer: ArrayBuffer }
 *   - buffer: transferred (zero-copy) packet bytes
 *   - roomKey is cached in the worker so the main thread doesn't clone it
 *     for every 20 ms packet.
 *
 * Message protocol (worker → main):
 *   { type: 'result', id: number, decoded: DecryptResult | null }
 *
 * The `id` field allows the main thread to correlate out-of-order results.
 */

import nacl from '../encryption/nacl-fast';

export interface DecryptResult {
  sourceAddr: string;
  vad: boolean;
  seq: number;
  timestampMs: number;
  opusFrame: ArrayBuffer; // transferred back to main thread
}

/** Decode an encrypted audio packet. Returns null if decryption fails. */
function decodePacket(
  buf: Uint8Array,
  roomKey: Uint8Array
): DecryptResult | null {
  try {
    let off = 0;
    const addrLen = buf[off++];
    const sourceAddr = new TextDecoder().decode(buf.slice(off, off + addrLen));
    off += addrLen;
    const vad = buf[off++] === 1;
    const seq = (buf[off++] << 8) | buf[off++];
    const timestampMs =
      (buf[off++] << 24) | (buf[off++] << 16) | (buf[off++] << 8) | buf[off++];
    const nonce = buf.slice(off, off + 24);
    off += 24;
    const ciphertext = buf.slice(off);
    const plaintext = (nacl as any).secretbox.open(ciphertext, nonce, roomKey);
    if (!plaintext) return null;

    // Copy the Opus frame into its own buffer so we can transfer it back.
    const opusFrame = new ArrayBuffer(plaintext.length);
    new Uint8Array(opusFrame).set(plaintext);

    return { sourceAddr, vad, seq, timestampMs, opusFrame };
  } catch {
    return null;
  }
}

let roomKeyBytes: Uint8Array | null = null;

self.onmessage = (
  e: MessageEvent<
    | { type: 'setRoomKey'; roomKey: ArrayBuffer }
    | { type: 'clearRoomKey' }
    | { type: 'decrypt'; id: number; buffer: ArrayBuffer }
  >
) => {
  const data = e.data;
  if (data.type === 'setRoomKey') {
    roomKeyBytes = new Uint8Array(data.roomKey);
    return;
  }

  if (data.type === 'clearRoomKey') {
    roomKeyBytes = null;
    return;
  }

  if (data.type !== 'decrypt' || !roomKeyBytes) {
    return;
  }

  const decoded = decodePacket(new Uint8Array(data.buffer), roomKeyBytes);

  if (decoded) {
    // Transfer the decoded Opus frame back to the main thread without copying.
    self.postMessage({ type: 'result', id: data.id, decoded }, [decoded.opusFrame]);
  } else {
    self.postMessage({ type: 'result', id: data.id, decoded: null });
  }
};
