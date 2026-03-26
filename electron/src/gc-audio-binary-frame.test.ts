import { describe, expect, it } from 'vitest';
import {
  encodeGcAudioBinaryFrame,
  parseGcAudioBinaryFrame,
  GC_AUDIO_BINARY_MAGIC,
  GC_AUDIO_BINARY_HEADER_BYTES,
  GcAudioBinaryEncodeError,
  dedupIdToSeenKey,
  bufferStartsWithGcAudioBinaryMagic,
  MAX_GC_AUDIO_BINARY_FRAME_BYTES,
} from './gc-audio-binary-frame';

const baseInput = () => ({
  p2pHops: 0,
  toNodeId: 'peer-node-id-abc',
  fromNodeId: 'self-node-id-xyz',
  roomId: 'room-1',
  toAddress: 'QaddrRecipient',
  gcHopsRemaining: 2,
  ciphertext: Buffer.from([1, 2, 3, 4, 5]),
});

describe('encodeGcAudioBinaryFrame', () => {
  it('round-trips', () => {
    const wire = encodeGcAudioBinaryFrame(baseInput());
    expect(bufferStartsWithGcAudioBinaryMagic(wire)).toBe(true);
    const r = parseGcAudioBinaryFrame(wire);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.consumed).toBe(wire.length);
    expect(r.frame.toNodeId).toBe(baseInput().toNodeId);
    expect(r.frame.fromNodeId).toBe(baseInput().fromNodeId);
    expect(r.frame.roomId).toBe('room-1');
    expect(r.frame.toAddress).toBe('QaddrRecipient');
    expect(r.frame.gcHopsRemaining).toBe(2);
    expect(r.frame.p2pHops).toBe(0);
    expect(Buffer.compare(r.frame.ciphertext, baseInput().ciphertext)).toBe(0);
    expect(r.frame.dedupKeyHex).toHaveLength(32);
    expect(dedupIdToSeenKey(r.frame.dedupId)).toBe(r.frame.dedupKeyHex);
  });

  it('rejects empty toNodeId', () => {
    expect(() =>
      encodeGcAudioBinaryFrame({
        ...baseInput(),
        toNodeId: '',
      })
    ).toThrow(GcAudioBinaryEncodeError);
  });

  it('rejects whitespace-only toNodeId (zero utf8 bytes is impossible for non-empty string with visible chars — use empty)', () => {
    expect(() =>
      encodeGcAudioBinaryFrame({
        ...baseInput(),
        toNodeId: '',
      })
    ).toThrow(GcAudioBinaryEncodeError);
  });
});

describe('parseGcAudioBinaryFrame decoder robustness', () => {
  it('parses crafted toNodeIdLen === 0', () => {
    const good = encodeGcAudioBinaryFrame(baseInput());
    const bodyFull = good.subarray(GC_AUDIO_BINARY_HEADER_BYTES);
    const oldToLen = bodyFull[17]!;
    const fromSuffixStart = 18 + oldToLen;
    const forgedBody = Buffer.concat([
      bodyFull.subarray(0, 17),
      Buffer.from([0]),
      bodyFull.subarray(fromSuffixStart),
    ]);
    const header = Buffer.alloc(9);
    GC_AUDIO_BINARY_MAGIC.copy(header, 0);
    header[4] = 1;
    header.writeUInt32BE(forgedBody.length, 5);
    const full = Buffer.concat([header, forgedBody]);
    const r = parseGcAudioBinaryFrame(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.toNodeId).toBe('');
    expect(r.frame.fromNodeId).toBe(baseInput().fromNodeId);
  });

  it('returns incomplete when truncated', () => {
    const wire = encodeGcAudioBinaryFrame(baseInput());
    const r = parseGcAudioBinaryFrame(wire.subarray(0, wire.length - 1));
    expect(r.ok === false && r.code === 'incomplete').toBe(true);
  });

  it('rejects wrong version with malformed consume 4', () => {
    const wire = encodeGcAudioBinaryFrame(baseInput());
    const bad = Buffer.from(wire);
    bad[4] = 99;
    const r = parseGcAudioBinaryFrame(bad);
    expect(r.ok === false && r.code === 'malformed' && r.consumed === 4).toBe(true);
  });

  it('rejects oversized frameBodyLen with malformed consume 4', () => {
    const wire = encodeGcAudioBinaryFrame(baseInput());
    const bad = Buffer.from(wire);
    bad.writeUInt32BE(MAX_GC_AUDIO_BINARY_FRAME_BYTES * 2, 5);
    const r = parseGcAudioBinaryFrame(bad);
    expect(r.ok === false && r.code === 'malformed' && r.consumed === 4).toBe(true);
  });

  it('interleaves JSON-looking prefix: magic not at 0', () => {
    const wire = encodeGcAudioBinaryFrame(baseInput());
    const combined = Buffer.concat([Buffer.from('{"type":"ping"}\n'), wire]);
    expect(bufferStartsWithGcAudioBinaryMagic(combined)).toBe(false);
    const after = combined.subarray(combined.indexOf(0x51));
    expect(parseGcAudioBinaryFrame(after).ok).toBe(true);
  });
});
