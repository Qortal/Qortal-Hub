/**
 * audio-decrypt.worker.ts — Web Worker for off-thread audio packet decrypt/encrypt.
 *
 * Offloads nacl.secretbox from the renderer's main JS thread.
 * Packet format: shared codec in ../lib/group-call/audioPacketCodec (v2 + v1 decode).
 *
 * Message protocol (main → worker):
 *   { type: 'setRoomKey', roomKey: ArrayBuffer }
 *   { type: 'clearRoomKey' }
 *   { type: 'decrypt', id: number, buffer: ArrayBuffer } — buffer transferred
 *   { type: 'encrypt', id, sourceAddr, vad, seq, timestampMs, opusFrame } — opusFrame transferred
 *
 * Message protocol (worker → main):
 *   { type: 'result', id: number, decoded: DecryptResult | null }
 *   { type: 'encryptResult', id: number, packet: ArrayBuffer }
 */

import {
  decodeAudioPackets,
  encodeAudioPacketV2,
} from '../lib/group-call/audioPacketCodec';

export interface DecryptResult {
  sourceAddr: string;
  vad: boolean;
  seq: number;
  timestampMs: number;
  opusFrame: ArrayBuffer;
}

let roomKeyBytes: Uint8Array | null = null;

self.onmessage = (
  e: MessageEvent<
    | { type: 'setRoomKey'; roomKey: ArrayBuffer }
    | { type: 'clearRoomKey' }
    | { type: 'decrypt'; id: number; buffer: ArrayBuffer }
    | {
        type: 'encrypt';
        id: number;
        sourceAddr: string;
        vad: boolean;
        seq: number;
        timestampMs: number;
        opusFrame: ArrayBuffer;
      }
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

  if (!roomKeyBytes) {
    return;
  }

  if (data.type === 'encrypt') {
    const u8 = encodeAudioPacketV2(
      data.sourceAddr,
      data.vad,
      data.seq,
      data.timestampMs,
      new Uint8Array(data.opusFrame),
      roomKeyBytes
    );
    // encodeAudioPacketV2 uses new Uint8Array(total) → byteOffset === 0; whole buffer transferable.
    self.postMessage({ type: 'encryptResult', id: data.id, packet: u8.buffer }, [u8.buffer]);
    return;
  }

  if (data.type !== 'decrypt') {
    return;
  }

  const decodedList = decodeAudioPackets(
    new Uint8Array(data.buffer),
    roomKeyBytes
  );

  if (decodedList.length === 0) {
    self.postMessage({ type: 'result', id: data.id, decoded: null });
    return;
  }

  if (decodedList.length === 1) {
    const decoded = decodedList[0]!;
    const opusFrame = new ArrayBuffer(decoded.opusFrame.length);
    new Uint8Array(opusFrame).set(decoded.opusFrame);
    self.postMessage(
      {
        type: 'result',
        id: data.id,
        decoded: {
          sourceAddr: decoded.sourceAddr,
          vad: decoded.vad,
          seq: decoded.seq,
          timestampMs: decoded.timestampMs,
          opusFrame,
        },
      },
      [opusFrame]
    );
    return;
  }

  const transferables: ArrayBuffer[] = [];
  const decodedMulti = decodedList.map((d) => {
    const opusFrame = new ArrayBuffer(d.opusFrame.length);
    new Uint8Array(opusFrame).set(d.opusFrame);
    transferables.push(opusFrame);
    return {
      sourceAddr: d.sourceAddr,
      vad: d.vad,
      seq: d.seq,
      timestampMs: d.timestampMs,
      opusFrame,
    };
  });
  self.postMessage(
    { type: 'result', id: data.id, decodedMulti },
    transferables
  );
};
