/**
 * Cross-compat tests between the main-thread {@link defaultSecretBoxProvider} (tweetnacl-js)
 * and the worker-side libsodium-backed provider. Wire-compat is the entire reason for the
 * dual-impl split — if these diverge, a browser with the new worker can no longer decode
 * packets from a peer still on the main-thread fallback.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nacl from '../../encryption/nacl-fast';
import {
  decodeAudioPacket,
  decodeAudioPackets,
  defaultSecretBoxProvider,
  encodeAudioPacketV2,
  encodeAudioPacketV3,
} from './audioPacketCodec';
import {
  __resetLibsodiumSecretBoxProviderForTests,
  initLibsodiumSecretBoxProvider,
} from './audioPacketCodecSodium';

function randomKey(): Uint8Array {
  return nacl.randomBytes(32);
}

describe('audioPacketCodecSodium', () => {
  beforeEach(() => {
    __resetLibsodiumSecretBoxProviderForTests();
  });
  afterEach(() => {
    __resetLibsodiumSecretBoxProviderForTests();
  });

  it('initLibsodiumSecretBoxProvider resolves once and is memoised', async () => {
    const a = await initLibsodiumSecretBoxProvider();
    const b = await initLibsodiumSecretBoxProvider();
    expect(a).toBe(b);
  });

  it('libsodium-open can decode a v2 packet encoded with tweetnacl (main→worker path)', async () => {
    const key = randomKey();
    const addr = 'QsodiumCompat123456789012345678901';
    const opus = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const packet = encodeAudioPacketV2(
      addr,
      true,
      1234,
      567_890,
      opus,
      key,
      defaultSecretBoxProvider
    );

    const sodiumProvider = await initLibsodiumSecretBoxProvider();
    const decoded = decodeAudioPacket(packet, key, sodiumProvider);

    expect(decoded).not.toBeNull();
    expect(decoded!.sourceAddr).toBe(addr);
    expect(decoded!.vad).toBe(true);
    expect(decoded!.seq).toBe(1234);
    expect(decoded!.timestampMs).toBe(567_890);
    expect([...decoded!.opusFrame]).toEqual([...opus]);
  });

  it('tweetnacl-open can decode a v2 packet sealed by libsodium (worker→main fallback path)', async () => {
    const key = randomKey();
    const sodiumProvider = await initLibsodiumSecretBoxProvider();
    const addr = 'Qtweetnacl-consumes';
    const opus = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const packet = encodeAudioPacketV2(
      addr,
      false,
      42,
      9999,
      opus,
      key,
      sodiumProvider
    );
    const decoded = decodeAudioPacket(packet, key, defaultSecretBoxProvider);

    expect(decoded).not.toBeNull();
    expect(decoded!.sourceAddr).toBe(addr);
    expect(decoded!.vad).toBe(false);
    expect(decoded!.seq).toBe(42);
    expect(decoded!.timestampMs).toBe(9999);
    expect([...decoded!.opusFrame]).toEqual([...opus]);
  });

  it('v3 multi-frame packets decode bit-for-bit identically under both providers', async () => {
    const key = randomKey();
    const sodiumProvider = await initLibsodiumSecretBoxProvider();
    const addr = 'Qv3MultiFrame';
    const frames = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
      new Uint8Array([6]),
    ];
    const startSeq = 10;
    const tsMs = 500;
    const packet = encodeAudioPacketV3(
      addr,
      true,
      startSeq,
      tsMs,
      frames,
      key,
      defaultSecretBoxProvider
    );

    const viaTweetnacl = decodeAudioPackets(packet, key, defaultSecretBoxProvider);
    const viaLibsodium = decodeAudioPackets(packet, key, sodiumProvider);
    expect(viaLibsodium.length).toBe(viaTweetnacl.length);
    for (let i = 0; i < viaTweetnacl.length; i++) {
      const a = viaTweetnacl[i]!;
      const b = viaLibsodium[i]!;
      expect(b.sourceAddr).toBe(a.sourceAddr);
      expect(b.vad).toBe(a.vad);
      expect(b.seq).toBe(a.seq);
      expect(b.timestampMs).toBe(a.timestampMs);
      expect([...b.opusFrame]).toEqual([...a.opusFrame]);
    }
  });

  it('returns null (not throws) when the key does not match', async () => {
    const keyA = randomKey();
    const keyB = randomKey();
    const sodiumProvider = await initLibsodiumSecretBoxProvider();
    const packet = encodeAudioPacketV2(
      'Qfoo',
      false,
      1,
      1,
      new Uint8Array([1]),
      keyA,
      sodiumProvider
    );
    expect(decodeAudioPacket(packet, keyB, sodiumProvider)).toBeNull();
    expect(decodeAudioPacket(packet, keyB, defaultSecretBoxProvider)).toBeNull();
  });

  it('randomNonce produces 24-byte nonces', async () => {
    const sodiumProvider = await initLibsodiumSecretBoxProvider();
    const nonce = sodiumProvider.randomNonce();
    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.byteLength).toBe(24);
  });
});
