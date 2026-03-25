import { describe, expect, it } from 'vitest';
import nacl from '../../encryption/nacl-fast';
import {
  GCALL_AUDIO_PACKET_V2_VERSION,
  decodeAudioPacket,
  encodeAudioPacketV1,
  encodeAudioPacketV2,
} from './audioPacketCodec';

function randomKey(): Uint8Array {
  return nacl.randomBytes(32);
}

describe('audioPacketCodec', () => {
  it('v2 round-trip preserves fields', () => {
    const key = randomKey();
    const opus = new Uint8Array([0x80, 0x01, 0x02]);
    const addr = 'QtestAddress123456789012345678901';
    const pkt = encodeAudioPacketV2(addr, true, 0xbeef, 0x11223344, opus, key);
    const dec = decodeAudioPacket(pkt, key);
    expect(dec).not.toBeNull();
    expect(dec!.sourceAddr).toBe(addr);
    expect(dec!.vad).toBe(true);
    expect(dec!.seq).toBe(0xbeef);
    expect(dec!.timestampMs).toBe(0x11223344);
    expect([...dec!.opusFrame]).toEqual([...opus]);
  });

  it('v2 inner layout: version and addrLen at start of plaintext', () => {
    const key = randomKey();
    const opus = new Uint8Array([0x01]);
    const addr = 'Qshort';
    const pkt = encodeAudioPacketV2(addr, false, 1, 100, opus, key);
    const nonce = pkt.subarray(0, 24);
    const box = pkt.subarray(24);
    const inner = nacl.secretbox.open(box, nonce, key);
    expect(inner).toBeTruthy();
    const i = inner as Uint8Array;
    expect(i[0]).toBe(GCALL_AUDIO_PACKET_V2_VERSION);
    const addrLen = i[1];
    expect(addrLen).toBe(new TextEncoder().encode(addr).length);
    const dec = decodeAudioPacket(pkt, key);
    expect(dec?.sourceAddr).toBe(addr);
  });

  it('v2 tamper fails decode', () => {
    const key = randomKey();
    const pkt = encodeAudioPacketV2('Qa', true, 1, 2, new Uint8Array([3]), key);
    const tampered = new Uint8Array(pkt);
    tampered[tampered.length - 1] ^= 0xff;
    expect(decodeAudioPacket(tampered, key)).toBeNull();
  });

  it('rejects wrong key length', () => {
    const key = randomKey();
    const pkt = encodeAudioPacketV2('Qa', true, 1, 2, new Uint8Array([3]), key);
    expect(decodeAudioPacket(pkt, new Uint8Array(31))).toBeNull();
  });

  it('v1 encode decodes via decodeAudioPacket', () => {
    const key = randomKey();
    const opus = new Uint8Array([9, 8, 7]);
    const pkt = encodeAudioPacketV1('Qlegacy', true, 0x00ff, 0xdeadbeef, opus, key);
    const dec = decodeAudioPacket(pkt, key);
    expect(dec).not.toBeNull();
    expect(dec!.sourceAddr).toBe('Qlegacy');
    expect(dec!.vad).toBe(true);
    expect(dec!.seq).toBe(0x00ff);
    expect([...dec!.opusFrame]).toEqual([...opus]);
  });

  it('v1 packet is decoded when v2 attempt fails', () => {
    const key = randomKey();
    const pkt = encodeAudioPacketV1('Qonlyv1', false, 3, 4, new Uint8Array([5]), key);
    expect(decodeAudioPacket(pkt, key)?.sourceAddr).toBe('Qonlyv1');
  });

  it('oversized addr rejects encode', () => {
    const key = randomKey();
    const longAddr = 'x'.repeat(101);
    expect(() =>
      encodeAudioPacketV2(longAddr, true, 1, 2, new Uint8Array([1]), key)
    ).toThrow();
  });
});
